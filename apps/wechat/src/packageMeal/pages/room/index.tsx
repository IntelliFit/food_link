import { View, Text, Input, Button, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { mealPath, mealRequest, mealRequestKey, mealStatus, mealWhen, type MealEvent, type MealMeetup } from '../../../utils/meal-meetup'
import '../../common.scss'

function MealRoom() {
  const id = String(Taro.getCurrentInstance().router?.params.id || '')
  const [row, setRow] = useState<MealMeetup>()
  const [events, setEvents] = useState<MealEvent[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval>>()
  const visible = useRef(false)
  const fetching = useRef(false)
  const sending = useRef(false)
  const messageKey = useRef({ id: mealRequestKey(), content: '' })
  const epoch = useRef(0)
  const load = async () => {
    if (fetching.current) return
    fetching.current = true; const turn = epoch.current; const token = getAccessToken()
    try {
      const next = await mealRequest<MealMeetup>(`/${id}`, 'GET', undefined, true)
      if (!next.can_enter_room) throw new Error('你已不在这场约饭中，房间访问已关闭')
      const messages = await mealRequest<{ list: MealEvent[] }>(`/${id}/messages`, 'GET', undefined, true)
      if (visible.current && turn === epoch.current && token === getAccessToken()) { setRow(next); setEvents(messages.list); setError('') }
    } catch (e) {
      if (visible.current && turn === epoch.current) { setEvents([]); setRow(undefined); setError(e instanceof Error ? e.message : '房间暂时不可用') }
    } finally { fetching.current = false }
  }
  const stop = () => { visible.current = false; epoch.current++; if (timer.current) clearInterval(timer.current) }
  useDidShow(() => { stop(); setRow(undefined); setEvents([]); visible.current = true; void load(); timer.current = setInterval(() => { void load() }, 10000) })
  useDidHide(stop)
  useEffect(() => stop, [])
  const send = async () => {
    if (sending.current || !content.trim()) return
    sending.current = true; setBusy(true)
    const text = content.trim()
    if (messageKey.current.content && messageKey.current.content !== text) messageKey.current.id = mealRequestKey()
    messageKey.current.content = text
    try { await mealRequest(`/${id}/messages`, 'POST', { request_id: messageKey.current.id, content: text }); setContent(''); messageKey.current = { id: mealRequestKey(), content: '' }; await load() }
    catch (e) { void showUnifiedApiError(e) }
    finally { sending.current = false; setBusy(false) }
  }
  const report = async (eventID?: string) => {
    const answer = await Taro.showModal({ title: eventID ? '举报留言' : '举报约饭', content: eventID ? '将这条留言提交给管理员审核？' : '将这场约饭提交给管理员审核？' })
    if (answer.confirm) { try { await mealRequest(`/${id}/reports`, 'POST', { event_id: eventID, reason: 'harassment' }); void Taro.showToast({ title: '已提交举报', icon: 'none' }) } catch (e) { void showUnifiedApiError(e) } }
  }
  return <View className='meal-page'>
    {error ? <View className='meal-error'><Text>{error}</Text><Button onClick={() => { void load() }}>重试</Button><Button onClick={() => { void Taro.navigateTo({ url: mealPath('mine') }) }}>我的约饭</Button><Button onClick={() => { void report() }}>举报这场约饭</Button></View> : !row ? <View className='meal-spinner' /> : <>
      <Text className='meal-title'>{row.title}</Text><Text className='meal-muted'>{row.venue_name} · {mealWhen(row.starts_at)} · {mealStatus[row.status]}</Text>
      <ScrollView className='meal-room-scroll' scrollY scrollIntoView={events.length ? `event-${events[events.length - 1].id}` : undefined}>
        {events.map((event) => <View id={`event-${event.id}`} key={event.id} className={event.kind === 'text' ? 'meal-message' : 'meal-message-system'}>{event.kind === 'text' && <Text className='meal-muted'>{event.actor.nickname || '饭搭子'} · {mealWhen(event.created_at)}</Text>}<Text className='meal-copy'>{event.content}</Text>{event.kind === 'text' && <Text className='meal-message-report' onClick={() => { void report(event.id) }}>举报</Text>}</View>)}
      </ScrollView>
      {['active', 'full', 'started'].includes(row.status) ? <><Input className='meal-field' disabled={busy} value={content} maxlength={500} placeholder='聊聊集合位置、口味或到达时间' onInput={(e) => setContent(e.detail.value)} /><Button className='meal-primary' disabled={busy || !content.trim()} onClick={() => { void send() }}>发送留言</Button></> : <Text className='meal-state'>约饭已结束或取消，保留历史留言。</Text>}
    </>}
  </View>
}
export default withAuth(MealRoom)
