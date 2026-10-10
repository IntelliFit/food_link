import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { mealPath, mealRequest, mealStatus, mealWhen, type MealMeetup } from '../../../utils/meal-meetup'
import '../../common.scss'

function MyMeals() {
  const [rows, setRows] = useState<MealMeetup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0)
  const account = useRef(getAccessToken())
  const load = async (append = false) => {
    if (append && busy) return
    const turn = ++epoch.current; const token = getAccessToken()
    if (account.current !== token) { setRows([]); account.current = token; append = false }
    setLoading(true); setError('')
    try { const next = await mealRequest<{ list: MealMeetup[] }>('/mine', 'GET', { limit: 20, offset: append ? rows.length : 0 }, true); if (turn === epoch.current && token === getAccessToken()) { setRows(append ? [...rows, ...next.list] : next.list); setMore(next.list.length === 20) } }
    catch (e) { if (turn === epoch.current) setError(e instanceof Error ? e.message : '获取失败') }
    finally { if (turn === epoch.current) setLoading(false) }
  }
  useDidShow(() => { void load() })
  useEffect(() => () => { epoch.current++ }, [])
  const cleanup = async (row: MealMeetup) => {
    if (busy) return
    const answer = await Taro.showModal({ title: row.is_host ? '取消约饭' : '退出或撤回', content: '确认后会通知发起人或参与者，并更新名额。' })
    if (!answer.confirm) return
    setBusy(true)
    try { await mealRequest(`/${row.id}/${row.is_host ? 'cancel' : 'leave'}`, 'POST', row.is_host ? {} : { revision: row.own_revision }); await load() }
    catch (e) { void showUnifiedApiError(e) }
    finally { setBusy(false) }
  }
  return <View className='meal-page'><Text className='meal-page-title'>我的约饭</Text>
    {loading && !rows.length && <View className='meal-spinner' />}
    {error && <View className='meal-error'><Text>{error}</Text><Button onClick={() => { void load() }}>重试</Button></View>}
    {!loading && !error && !rows.length && <View className='meal-panel'><Text className='meal-copy'>还没有约饭，发起你的第一顿饭。</Text></View>}
    {rows.map((row) => <View className='meal-panel' key={row.id}><View onClick={() => { void Taro.navigateTo({ url: mealPath('detail', row.id) }) }}><Text className='meal-title'>{row.title}</Text><Text className='meal-copy'>{mealWhen(row.starts_at)} · {row.venue_name}</Text><Text className='meal-state'>{mealStatus[row.own_status] || '已参与'} · {mealStatus[row.status]} · {row.member_count}/{row.capacity}人</Text><Text className='meal-muted'>查看详情与申请 ›</Text></View>
      {(row.is_host || ['pending', 'accepted'].includes(row.own_status)) && ['active', 'full', 'started'].includes(row.status) && <Button className='meal-secondary' disabled={busy} onClick={() => { void cleanup(row) }}>{row.is_host ? '取消约饭' : row.own_status === 'pending' ? '撤回申请' : '退出约饭'}</Button>}
    </View>)}
    {more && <Button className='meal-secondary' disabled={loading} onClick={() => { void load(true) }}>查看更多</Button>}
    <Button className='meal-primary' onClick={() => { void Taro.navigateTo({ url: mealPath('create') }) }}>发起一顿饭</Button>
  </View>
}
export default withAuth(MyMeals)
