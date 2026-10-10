import { View, Text, Input, Textarea, Picker, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useRef, useState } from 'react'
import { showUnifiedApiError } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { chinaDate, mealPath, mealRequest, mealRequestKey, type CreateMealMeetup } from '../../../utils/meal-meetup'
import '../../common.scss'

function MealCreate() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(chinaDate())
  const [time, setTime] = useState('18:30')
  const [venue, setVenue] = useState<{ name: string; address: string; latitude?: number; longitude?: number }>({ name: '', address: '' })
  const [budget, setBudget] = useState('30')
  const [capacity, setCapacity] = useState(3)
  const [payment, setPayment] = useState<'aa' | 'separate'>('aa')
  const [busy, setBusy] = useState(false)
  const submitLock = useRef(false)
  const draftKey = useRef({ id: mealRequestKey(), signature: '' })
  const chooseVenue = () => {
    // WeChat's place picker and nearby positioning both use GCJ-02 coordinates.
    void Taro.chooseLocation({}).then((p) => setVenue({ name: p.name, address: p.address, latitude: p.latitude, longitude: p.longitude })).catch((e) => {
      if (!/cancel/i.test(String(e?.errMsg || ''))) void showUnifiedApiError(e, '可手动填写公共地点；地图权限可在设置中开启')
    })
  }
  const submit = async () => {
    if (submitLock.current) return
    const starts = new Date(`${date}T${time}:00+08:00`)
    if (!title.trim() || !venue.name.trim() || !venue.address.trim() || !Number.isFinite(starts.getTime()) || starts.getTime() <= Date.now() || !/^\d{1,4}$/.test(budget) || Number(budget) > 2000) {
      void Taro.showToast({ title: '请填写标题、公共地点和未来时间，检查预算', icon: 'none' }); return
    }
    const payload = { title: title.trim(), description: description.trim(), venue_name: venue.name.trim(), address: venue.address.trim(), latitude: venue.latitude, longitude: venue.longitude, starts_at: starts.toISOString(), timezone: 'Asia/Shanghai', budget: Number(budget), capacity, payment }
    const signature = JSON.stringify(payload)
    if (draftKey.current.signature && draftKey.current.signature !== signature) draftKey.current.id = mealRequestKey()
    draftKey.current.signature = signature
    const req: CreateMealMeetup = { ...payload, request_id: draftKey.current.id }
    submitLock.current = true; setBusy(true)
    try {
      const result = await mealRequest<{ id: string }>('', 'POST', req)
      await Taro.redirectTo({ url: mealPath('detail', result.id) })
    } catch (e) { void showUnifiedApiError(e) }
    finally { submitLock.current = false; setBusy(false) }
  }
  return <View className='meal-page'><Text className='meal-page-title'>发起一顿饭</Text><Text className='meal-muted'>约定好时间、地点，等身边的饭搭子加入。</Text>
    <View className='meal-panel'>
      <Text className='meal-label'>这顿饭怎么约</Text><Input className='meal-field' value={title} maxlength={60} placeholder='如：下课一起去二食堂吃晚饭' onInput={(e) => setTitle(e.detail.value)} />
      <Text className='meal-label'>时间 · 北京时间</Text><View className='meal-row'><Picker mode='date' value={date} start={chinaDate()} onChange={(e) => setDate(e.detail.value)}><View className='meal-field'>{date} ›</View></Picker><Picker mode='time' value={time} onChange={(e) => setTime(e.detail.value)}><View className='meal-field'>{time} ›</View></Picker></View><Text className='meal-muted'>默认时长90分钟，开始后停止报名。</Text>
      <Text className='meal-label'>公共餐厅或食堂</Text><Button className='meal-secondary' onClick={chooseVenue}>搜索并选择地点</Button><Input className='meal-field' value={venue.name} maxlength={120} placeholder='餐厅或食堂名称，也可手动填写' onInput={(e) => setVenue({ name: e.detail.value, address: venue.address })} /><Input className='meal-field' value={venue.address} maxlength={240} placeholder='详细地址；手动填写不参与附近筛选' onInput={(e) => setVenue({ name: venue.name, address: e.detail.value })} />
      <Text className='meal-label'>总人数（含你）</Text><View className='meal-choice'>{[2, 3, 4].map((n) => <Text className={capacity === n ? 'selected' : ''} key={n} onClick={() => setCapacity(n)}>{n}人</Text>)}</View>
      <Text className='meal-label'>人均预算上限（元，0表示协商）</Text><Input className='meal-field' type='number' value={budget} maxlength={4} onInput={(e) => setBudget(e.detail.value)} />
      <View className='meal-choice'><Text className={payment === 'aa' ? 'selected' : ''} onClick={() => setPayment('aa')}>AA</Text><Text className={payment === 'separate' ? 'selected' : ''} onClick={() => setPayment('separate')}>各自付款</Text></View>
      <Text className='meal-label'>补充说明（可选）</Text><Textarea className='meal-field meal-field-area' value={description} maxlength={500} placeholder='口味、集合位置、校园通行要求等' onInput={(e) => setDescription(e.detail.value)} />
    </View>
    <Text className='meal-muted'>发布后时间、地点和人数不可修改，需要调整时请取消后重新发起。公开活动会经过内容审核。</Text><Button className='meal-primary' disabled={busy} onClick={() => { void submit() }}>发布约饭</Button>{busy && <View className='meal-spinner' />}
  </View>
}
export default withAuth(MealCreate)
