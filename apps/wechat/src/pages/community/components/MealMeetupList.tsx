import { View, Text, Input, ScrollView, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '../../../utils/api'
import { redirectToLogin } from '../../../utils/withAuth'
import { chinaDate, MEAL_CHANGED, mealPath, mealRequest, mealStatus, mealWhen, type MealMeetup } from '../../../utils/meal-meetup'
import './MealMeetupList.scss'

export function MealMeetupList() {
  const [rows, setRows] = useState<MealMeetup[]>([])
  const [keyword, setKeyword] = useState('')
  const [area, setArea] = useState('')
  const [meal, setMeal] = useState('')
  const [day, setDay] = useState('')
  const [budget, setBudget] = useState(0)
  const [nearby, setNearby] = useState<{ latitude: number; longitude: number }>()
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const epoch = useRef(0)
  const busy = useRef(false)
  const account = useRef(getAccessToken())
  const currentRows = useRef(rows)
  currentRows.current = rows
  const load = useCallback(async (append = false) => {
    if (append && busy.current) return
    const turn = ++epoch.current
    const token = getAccessToken()
    if (account.current !== token) { setRows([]); currentRows.current = []; account.current = token }
    busy.current = true
    setLoading(true); setError('')
    const offset = append ? currentRows.current.length : 0
    try {
      const result = await mealRequest<{ list: MealMeetup[] }>('', 'GET', {
        keyword: area, meal_type: meal, date: day, budget, limit: 20, offset,
        ...(nearby ? { ...nearby, radius_km: 3 } : {}),
      })
      if (turn !== epoch.current || token !== getAccessToken()) return
      setRows(append ? [...currentRows.current, ...result.list] : result.list)
      setMore(result.list.length === 20)
    } catch (e) {
      if (turn === epoch.current) setError(e instanceof Error ? e.message : '约饭暂时无法获取，请重试')
    } finally {
      if (turn === epoch.current) { setLoading(false); busy.current = false }
    }
  }, [area, meal, day, budget, nearby])
  useEffect(() => {
    setRows([]); void load()
    const refresh = () => { void load() }
    Taro.eventCenter.on(MEAL_CHANGED, refresh)
    return () => { epoch.current++; Taro.eventCenter.off(MEAL_CHANGED, refresh) }
  }, [load])
  useDidShow(() => { void load() })
  const open = (page: 'create' | 'mine') => {
    if (!getAccessToken()) { redirectToLogin(); return }
    void Taro.navigateTo({ url: mealPath(page) })
  }
  const locate = async () => {
    if (locating) return
    if (nearby) { setNearby(undefined); return }
    setLocating(true)
    try { const p = await Taro.getLocation({ type: 'gcj02' }); setNearby({ latitude: p.latitude, longitude: p.longitude }) }
    catch { void Taro.showModal({ title: '暂时无法定位', content: '可以搜索学校、园区或餐厅，也可以在设置中开启位置权限。', confirmText: '去设置' }).then((r) => { if (r.confirm) void Taro.openSetting() }) }
    finally { setLocating(false) }
  }
  return <View className='meal-discovery'>
    <View className='meal-discovery-head'><View><Text className='meal-eyebrow'>一顿饭，认识身边的人</Text><Text className='meal-heading'>今天和谁一起吃？</Text></View><Text className='meal-mine' onClick={() => open('mine')}>我的约饭 ›</Text></View>
    <View className='meal-search'><Text className='iconfont icon-sousuo' /><Input value={keyword} placeholder='搜索学校、园区或餐厅' onInput={(e) => setKeyword(e.detail.value)} onConfirm={() => setArea(keyword.trim())} /><Text onClick={() => setArea(keyword.trim())}>搜索</Text></View>
    <View className='meal-filter-row'>
      {[['', '不限餐次'], ['lunch', '午餐'], ['dinner', '晚餐'], ['breakfast', '早餐']].map(([value, label]) => <Text key={value} className={`meal-chip ${meal === value ? 'is-active' : ''}`} onClick={() => setMeal(value)}>{label}</Text>)}
    </View>
    <View className='meal-filter-row'>
      <Text className={`meal-chip ${day ? 'is-active' : ''}`} onClick={() => setDay(day ? '' : chinaDate())}>{day ? '今天' : '不限日期'}</Text>
      <Text className={`meal-chip ${nearby ? 'is-active' : ''}`} onClick={() => { void locate() }}>{locating ? '◎' : nearby ? '附近3公里' : '附近'}</Text>
      <Text className={`meal-chip ${budget ? 'is-active' : ''}`} onClick={() => setBudget(budget ? 0 : 30)}>{budget ? '人均≤30元' : '不限预算'}</Text>
    </View>
    <ScrollView className='meal-discovery-scroll' scrollY refresherEnabled refresherTriggered={loading && !rows.length} onRefresherRefresh={() => { void load() }} onScrollToLower={() => { if (more) void load(true) }}>
      <View className='meal-list-content'>
        {error && <View className='meal-empty'><Text>{error}</Text><Button onClick={() => { void load() }}>重试</Button></View>}
        {loading && !rows.length && <View className='meal-skeleton'><View /><View /><View /></View>}
        {!loading && !error && !rows.length && <View className='meal-empty'><Text>还没有合适的约饭</Text><Text>换个筛选，或者发起这顿饭。</Text><Button onClick={() => open('create')}>发起约饭</Button></View>}
        {rows.map((row) => <View key={row.id} className='meal-card' onClick={() => { void Taro.navigateTo({ url: mealPath('detail', row.id) }) }}>
          <View className='meal-card-top'><Text>{mealWhen(row.starts_at)} · 北京时间</Text><Text className='meal-capacity'>{row.member_count}/{row.capacity}人</Text></View>
          <Text className='meal-card-title'>{row.title}</Text><Text className='meal-venue'>{row.venue_name}</Text><Text className='meal-address'>{row.address}</Text>
          <View className='meal-card-tags'><Text>人均 {row.budget ? `${row.budget}元以内` : '协商'}</Text><Text>{row.payment === 'aa' ? 'AA' : '各自付款'}</Text><Text>{mealStatus[row.own_status] || mealStatus[row.status]}</Text></View>
          <View className='meal-card-bottom'><Text>{row.host.nickname} 发起</Text><Text className='meal-card-action'>{row.own_status === 'pending' ? '查看申请' : row.can_enter_room ? '查看约饭' : row.status === 'full' ? '查看详情' : '一起吃 ›'}</Text></View>
        </View>)}
        {more && rows.length > 0 && <Button className='meal-more' disabled={loading} onClick={() => { void load(true) }}>查看更多</Button>}
      </View>
    </ScrollView>
    <View className='meal-publish-wrap'><Button className='meal-publish' onClick={() => open('create')}>＋ 发起一顿饭</Button></View>
  </View>
}
