import { Button, Input, Picker, Text, View } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import { showUnifiedApiError } from '../../../utils/api'
import {
  createCampaignStation,
  setCampaignCoreMember,
  type CampaignLeader,
  type CampaignStation,
} from '../../../utils/campus-campaign-api'
import { Chips, Field } from '../research-weight/controls'
import { PRECISIONS } from '../research-weight/model'
import { DishPicker, type PickedDish } from './dish-picker'
import { MEAL_LABELS, ROLE_LABELS, chinaToday } from './labels'
import { HowTo, LEADER_STEPS } from './how-to'

interface LeaderPanelProps {
  leader: CampaignLeader
  onChange: (leader: CampaignLeader) => void
  onStationCreated: () => void
}

const MEALS = (Object.keys(MEAL_LABELS) as Array<CampaignStation['meal_period']>).map((key) => ({ key, label: MEAL_LABELS[key] }))
const KINDS: Array<{ key: CampaignStation['kind']; label: string }> = [
  { key: 'weigh_station', label: '称重日（大家端饭来称）' },
  { key: 'same_dish', label: '同一道菜称多份' },
]

/** 负责人：勾核心成员（名额内自动开会员）、建称重日。 */
export function LeaderPanel({ leader, onChange, onStationCreated }: LeaderPanelProps) {
  const [busy, setBusy] = useState('')
  const [date, setDate] = useState(chinaToday())
  const [meal, setMeal] = useState<CampaignStation['meal_period']>('lunch')
  const [kind, setKind] = useState<CampaignStation['kind']>('weigh_station')
  const [location, setLocation] = useState('')
  const [precision, setPrecision] = useState(1)
  const [dish, setDish] = useState<PickedDish | null>(null)
  const [picking, setPicking] = useState(false)
  const campaign = leader.campaign

  const toggleCore = async (userId: string, core: boolean) => {
    if (busy) return
    setBusy(userId)
    try {
      onChange(await setCampaignCoreMember(campaign.id, userId, core))
      Taro.showToast({ title: core ? '已设为核心成员，会员已开通' : '已取消核心成员', icon: 'none' })
    } catch (error) {
      await showUnifiedApiError(error, '操作失败')
    } finally {
      setBusy('')
    }
  }

  const createStation = async () => {
    if (busy) return
    if (!location.trim()) {
      Taro.showToast({ title: '写一下在哪称，如 紫荆操场', icon: 'none' })
      return
    }
    if (kind === 'same_dish' && !dish) {
      Taro.showToast({ title: '同菜多份请先选是哪道菜', icon: 'none' })
      return
    }
    setBusy('station')
    try {
      await createCampaignStation(campaign.id, {
        session_date: date, meal_period: meal, kind, location_text: location.trim(), scale_precision_grams: precision,
        ...(kind === 'same_dish' && dish ? { catalog_item_id: dish.catalogItemId } : {}),
      })
      Taro.showToast({ title: '称重日已创建，成员在活动页能看到', icon: 'none' })
      setLocation('')
      onStationCreated()
    } catch (error) {
      await showUnifiedApiError(error, '创建失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <View>
      <HowTo title='负责人要做的三件事' steps={LEADER_STEPS} />
      <View className='rw-card'>
        <Text className='rw-card__title'>邀请成员</Text>
        <Text className='cc-code-big'>加入码 {campaign.join_code}</Text>
        <Text className='rw-tip'>成员在「我的 → 科研共建 → 高校共建」输入加入码，或点你转发的卡片加入。</Text>
        <Button className='rw-submit cc-share' openType='share'>转发活动卡片给成员</Button>
      </View>
      <View className='rw-card'>
        <Text className='rw-card__title'>核心成员 {leader.core_count}/{leader.core_cap}</Text>
        <Text className='rw-tip'>核心成员活动期间免费使用标准版（含精准模式），到活动结束自动到期。</Text>
        {leader.members.map((member) => (
          <View key={member.user_id} className='cc-member'>
            <View className='cc-member__copy'>
              <Text className='cc-member__name'>{member.nickname || '匿名同学'}</Text>
              <Text className='cc-member__meta'>{ROLE_LABELS[member.role]}{member.has_scale ? ' · 有秤' : ''} · 称重 {member.approved}/{member.submitted} · 拍照 {member.photo_records}</Text>
            </View>
            {member.role === 'leader' ? null : (
              <Text
                className={`cc-member__toggle ${member.role === 'core' ? 'cc-member__toggle--on' : ''}`}
                onClick={() => void toggleCore(member.user_id, member.role !== 'core')}
              >
                {busy === member.user_id ? '…' : member.role === 'core' ? '取消核心' : '设为核心'}
              </Text>
            )}
          </View>
        ))}
      </View>

      <View className='rw-card'>
        <Text className='rw-card__title'>建一个称重日</Text>
        <Field label='日期'>
          <Picker mode='date' value={date} start={campaign.starts_at.slice(0, 10)} end={campaign.ends_at.slice(0, 10)} onChange={(e) => setDate(e.detail.value)}>
            <View className='rw-input cc-picker'><Text>{date}</Text></View>
          </Picker>
        </Field>
        <Field label='餐次'><Chips<CampaignStation['meal_period']> small options={MEALS} value={meal} onChange={setMeal} /></Field>
        <Field label='类型'><Chips<CampaignStation['kind']> small options={KINDS} value={kind} onChange={setKind} /></Field>
        {kind === 'same_dish' ? (
          <View className='rw-link-row' onClick={() => setPicking(true)}>
            <Text>{dish ? dish.name : '选一道菜'}</Text>
            <Text className='rw-link-row__meta'>›</Text>
          </View>
        ) : null}
        <Field label='地点'>
          <Input className='rw-input' value={location} maxlength={60} placeholder='如 紫荆操场、桃李园二楼靠窗' onInput={(e) => setLocation(e.detail.value)} />
        </Field>
        <Field label='秤的精度'>
          <Chips<number> small options={PRECISIONS.map((key) => ({ key, label: `${key}g` }))} value={precision} onChange={setPrecision} />
        </Field>
        <View className={`rw-submit ${busy === 'station' ? 'rw-submit--disabled' : ''}`} onClick={() => void createStation()}>
          {busy === 'station' ? <View className='loading-spinner' /> : <Text>创建</Text>}
        </View>
      </View>

      {leader.stations.length ? (
        <View className='rw-card'>
          <Text className='rw-card__title'>已建的称重日</Text>
          {leader.stations.map((station) => (
            <Text key={station.id} className='cc-later'>
              {station.session_date} {MEAL_LABELS[station.meal_period]} · {station.location_text}{station.kind === 'same_dish' ? ' · 同菜多份' : ''}
            </Text>
          ))}
        </View>
      ) : null}

      {picking ? <DishPicker schoolId={campaign.school_id} onPick={(picked) => { setDish(picked); setPicking(false) }} onClose={() => setPicking(false)} /> : null}
    </View>
  )
}
