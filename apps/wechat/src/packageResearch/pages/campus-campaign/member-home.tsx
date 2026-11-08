import { Image, Text, View } from '@tarojs/components'
import { useCallback, useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getFoodRecordList, type FoodRecord } from '../../../utils/api'
import { linkCampaignRecord, type CampaignMine, type CampaignStation } from '../../../utils/campus-campaign-api'
import { DishPicker, type PickedDish } from './dish-picker'
import { MEAL_LABELS, ROLE_LABELS, chinaToday } from './labels'
import { HowTo, MEMBER_STEPS } from './how-to'

/** 拍照记一餐走自建相机页（小程序已没有「记录」Tab）。 */
const FOOD_CAMERA_PAGE = '/packageCamera/pages/shoot/index'

interface MemberHomeProps {
  mine: CampaignMine
  /** 计入了一餐之后刷新活动页的计数。 */
  onChanged: () => void
}

/** 一整串文字：Text 里空串变成文字时 Taro 会更新失败。 */
const recordMeta = (record: FoodRecord, dishName?: string) =>
  `${dishName ? `挂在：${dishName} · ` : ''}${record.total_weight_grams ? `约 ${record.total_weight_grams}g（估算）` : '估算'}`

const recordTitle = (record: FoodRecord) =>
  String(record.description || '').trim() || record.items?.map((item) => item.name).filter(Boolean).slice(0, 3).join('、') || '这一餐'

function stationUrl(station: CampaignStation, campaignTitle: string): string {
  const label = station.kind === 'same_dish' ? `${campaignTitle} · 同菜多份` : `${campaignTitle} · ${MEAL_LABELS[station.meal_period]}称重日`
  const query = [`station=${encodeURIComponent(station.id)}`, `label=${encodeURIComponent(label)}`]
  return extraPkgUrl(`/pages/research-weight-record/index?${query.join('&')}`)
}

/** 成员的活动首页：进度、记录入口、今天的称重日和把拍照记录挂到食堂的菜上。 */
export function MemberHome({ mine, onChanged }: MemberHomeProps) {
  const campaign = mine.campaign
  const [records, setRecords] = useState<FoodRecord[]>([])
  const [linking, setLinking] = useState<FoodRecord | null>(null)
  const [linked, setLinked] = useState<Record<string, string>>({})

  const loadRecords = useCallback(async () => {
    try {
      const { records: today } = await getFoodRecordList(chinaToday())
      setRecords(today || [])
    } catch (error) {
      console.warn('[campus-campaign] load today records failed', error)
    }
  }, [])

  useEffect(() => { void loadRecords() }, [loadRecords])

  if (!campaign) return null
  const today = chinaToday()
  const counted: Record<string, string> = { ...Object.fromEntries((mine.linked || []).map((row) => [row.food_record_id, row.dish_name])), ...linked }
  const todayStations = mine.stations.filter((station) => station.session_date === today)
  const laterStations = mine.stations.filter((station) => station.session_date > today).slice(0, 3)
  const canPrecision = mine.role === 'core' || mine.role === 'leader'

  const openCamera = () => {
    Taro.navigateTo({ url: `${FOOD_CAMERA_PAGE}?date=${encodeURIComponent(today)}` }).catch(() => {
      Taro.showToast({ title: '打开相机失败，请从首页「记一餐」拍照', icon: 'none' })
    })
  }

  const pickDish = async (dish: PickedDish) => {
    const record = linking
    setLinking(null)
    if (!record) return
    try {
      const done = await linkCampaignRecord({ food_record_id: record.id, catalog_item_id: dish.catalogItemId, dish_name: dish.name })
      setLinked((current) => ({ ...current, [record.id]: dish.name }))
      onChanged()
      Taro.showToast({ title: done ? '已计入活动' : '这一餐已计入过', icon: 'none' })
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '没计入，请重试', icon: 'none' })
    }
  }

  return (
    <View>
      <View className='rw-stats'>
        <View className='rw-stat'><Text className='rw-stat__value'>{mine.stats.approved}</Text><Text className='rw-stat__label'>称重通过</Text></View>
        <View className='rw-stat'><Text className='rw-stat__value'>{mine.stats.submitted}</Text><Text className='rw-stat__label'>称重提交</Text></View>
        <View className='rw-stat'><Text className='rw-stat__value'>{mine.stats.photo_records}</Text><Text className='rw-stat__label'>拍照计入</Text></View>
      </View>
      <Text className='cc-role'>{`${ROLE_LABELS[mine.role || 'member']}${canPrecision ? ' · 活动期间可用精准模式' : ''}`}</Text>

      {todayStations.length ? (
        <View className='rw-card'>
          <Text className='rw-card__title'>今天的称重日</Text>
          {todayStations.map((station) => (
            <View key={station.id} className='rw-link-row cc-station' onClick={() => Taro.navigateTo({ url: stationUrl(station, campaign.title) })}>
              <Text>{`${MEAL_LABELS[station.meal_period]} · ${station.location_text}${station.kind === 'same_dish' ? ' · 同菜多份' : ''}`}</Text>
              <Text className='rw-link-row__meta'>去称重 ›</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className='cc-actions'>
        <View className='rw-submit cc-action' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/research-weight-record/index') })}>
          <Text>用秤记一顿</Text>
        </View>
        <View className='rw-submit cc-action cc-action--ghost' onClick={openCamera}>
          <Text>拍照记一顿</Text>
        </View>
      </View>
      <Text className='rw-tip'>
        {`${canPrecision ? '拍照时选「精准模式」，俯拍和斜拍各一张；' : ''}拍照记完要回到这里，把这一餐挂到食堂的菜上才会计入活动。`}
      </Text>
      <HowTo title='怎么参与' steps={MEMBER_STEPS} />

      <View className='rw-card'>
        <Text className='rw-card__title'>今天的拍照记录</Text>
        {records.length === 0 ? <Text className='rw-tip'>今天还没有记录</Text> : null}
        {records.map((record) => (
          <View key={record.id} className='cc-record'>
            {record.image_path ? <Image className='cc-record__image' src={record.image_path} mode='aspectFill' /> : null}
            <View className='cc-record__copy'>
              <Text className='cc-record__name'>{recordTitle(record)}</Text>
              <Text className='cc-record__meta'>{recordMeta(record, counted[record.id])}</Text>
            </View>
            {/* 同一个 Text 换样式和文字：换成另一个 Text 时 Taro 更新报错，后面的计数也可能不刷新。 */}
            <Text
              className={record.id in counted ? 'cc-record__done' : 'cc-record__link'}
              onClick={() => { if (!(record.id in counted)) setLinking(record) }}
            >
              {record.id in counted ? '已计入' : '挂到食堂菜'}
            </Text>
          </View>
        ))}
      </View>

      {laterStations.length ? (
        <View className='rw-card'>
          <Text className='rw-card__title'>接下来的称重日</Text>
          {laterStations.map((station) => (
            <Text key={station.id} className='cc-later'>{station.session_date} {MEAL_LABELS[station.meal_period]} · {station.location_text}</Text>
          ))}
        </View>
      ) : null}

      {linking ? <DishPicker campaignId={campaign.id} onPick={(dish) => void pickDish(dish)} onClose={() => setLinking(null)} /> : null}
    </View>
  )
}
