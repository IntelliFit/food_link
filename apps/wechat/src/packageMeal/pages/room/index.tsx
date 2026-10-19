import { View, Text, Textarea, Button, ScrollView } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { MEAL_EXTEND_OPTIONS, MEAL_REPORT_REASONS, mealPath, mealRequest, mealRequestKey, mealStatus, mealWhen, type MealEvent, type MealMeetup } from '../../../utils/meal-meetup'
import { appendMealText, clipMealText, MEAL_EMOJIS, MEAL_QUICK_PHRASES } from '../../meal-chat'
import '../../common.scss'

const CLOSING_SOON_MS = 15 * 60 * 1000
const extendLabel = (minutes: number) => (minutes % 60 ? `延长${minutes}分钟` : `延长${minutes / 60}小时`)
const clock = (value: string) => mealWhen(value).slice(-5)

function MealRoom() {
  const id = String(Taro.getCurrentInstance().router?.params.id || '')
  const [row, setRow] = useState<MealMeetup>()
  const [events, setEvents] = useState<MealEvent[]>([])
  const [content, setContent] = useState('')
  const [showEmoji, setShowEmoji] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval>>()
  const visible = useRef(false)
  const fetching = useRef(false)
  const sending = useRef(false)
  const extending = useRef(false)
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
  // One retry key per distinct text, so a timed-out request that is re-sent cannot post twice.
  const post = async (raw: string): Promise<boolean> => {
    const text = raw.trim()
    if (sending.current || !text) return false
    sending.current = true; setBusy(true)
    if (messageKey.current.content && messageKey.current.content !== text) messageKey.current.id = mealRequestKey()
    messageKey.current.content = text
    try {
      await mealRequest(`/${id}/messages`, 'POST', { request_id: messageKey.current.id, content: text })
      messageKey.current = { id: mealRequestKey(), content: '' }
      await load()
      return true
    } catch (e) { void showUnifiedApiError(e); return false }
    finally { sending.current = false; setBusy(false) }
  }
  const send = async () => { if (await post(content)) { setContent(''); setShowEmoji(false) } }
  const extend = async () => {
    if (extending.current) return
    const choice = await Taro.showActionSheet({ itemList: MEAL_EXTEND_OPTIONS.map(extendLabel) }).catch(() => undefined)
    if (!choice) return
    extending.current = true; setBusy(true)
    try {
      await mealRequest(`/${id}/extend`, 'POST', { request_id: mealRequestKey(), minutes: MEAL_EXTEND_OPTIONS[choice.tapIndex] })
      void Taro.showToast({ title: '已延长', icon: 'none' })
      await load()
    } catch (e) { void showUnifiedApiError(e) }
    finally { extending.current = false; setBusy(false) }
  }
  const report = async (eventID?: string) => {
    const choice = await Taro.showActionSheet({ itemList: MEAL_REPORT_REASONS.map((r) => r.label) }).catch(() => undefined)
    if (!choice) return
    try { await mealRequest(`/${id}/reports`, 'POST', { event_id: eventID, reason: MEAL_REPORT_REASONS[choice.tapIndex].value }); void Taro.showToast({ title: '已提交举报', icon: 'none' }) } catch (e) { void showUnifiedApiError(e) }
  }
  const open = row ? ['active', 'full', 'started'].includes(row.status) : false
  const closesIn = row ? Date.parse(row.ends_at) - Date.now() : Infinity
  return <View className='meal-page meal-room-page'>
    {error ? <View className='meal-error'><Text>{error}</Text><Button onClick={() => { void load() }}>重试</Button><Button onClick={() => { void Taro.navigateTo({ url: mealPath('mine') }) }}>我的约饭</Button><Button onClick={() => { void report() }}>举报这场约饭</Button></View> : !row ? <View className='meal-spinner' /> : <>
      <Text className='meal-title meal-room-title'>{row.title}</Text>
      <View className='meal-room-meta'>
        <Text className='meal-muted'>{row.venue_name} · {mealWhen(row.starts_at)} · {mealStatus[row.status]}</Text>
        {open && <Text className='meal-muted'>房间 {clock(row.ends_at)} 关闭{row.can_extend && <Text className='meal-room-extend' onClick={() => { void extend() }}> · 延长</Text>}</Text>}
      </View>
      {open && !row.can_extend && closesIn > 0 && closesIn <= CLOSING_SOON_MS && <Text className='meal-state meal-room-notice'>房间将在 {clock(row.ends_at)} 关闭，如需继续聊请让发起人延长。</Text>}
      <ScrollView className='meal-room-scroll' scrollY scrollIntoView={events.length ? `event-${events[events.length - 1].id}` : undefined}>
        {events.map((event) => <View id={`event-${event.id}`} key={event.id} className={event.kind === 'text' ? 'meal-message' : 'meal-message-system'}>{event.kind === 'text' && <Text className='meal-muted'>{event.actor.nickname || '饭搭子'} · {mealWhen(event.created_at)}</Text>}<Text className='meal-copy'>{event.content}</Text>{event.kind === 'text' && <Text className='meal-message-report' onClick={() => { void report(event.id) }}>举报</Text>}</View>)}
      </ScrollView>
      {open ? <View className='meal-composer'>
        <ScrollView className='meal-quick' scrollX enableFlex>{MEAL_QUICK_PHRASES.map((phrase) => <Text key={phrase} className={`meal-quick-chip ${busy ? 'is-disabled' : ''}`} onClick={() => { void post(phrase) }}>{phrase}</Text>)}</ScrollView>
        <View className='meal-composer-row'>
          <Text className='meal-emoji-toggle' onClick={() => setShowEmoji((v) => !v)}>{showEmoji ? '⌨️' : '😊'}</Text>
          <Textarea className='meal-composer-input' value={content} disabled={busy} autoHeight maxlength={-1} showConfirmBar={false} cursorSpacing={24} placeholder='聊聊集合位置、口味或到达时间' onFocus={() => setShowEmoji(false)} onInput={(e) => setContent(clipMealText(e.detail.value))} />
          <Button className='meal-composer-send' disabled={busy || !content.trim()} onClick={() => { void send() }}>发送</Button>
        </View>
        {showEmoji && <View className='meal-emoji-panel'>{MEAL_EMOJIS.map((emoji) => <Text key={emoji} className='meal-emoji' onClick={() => setContent((prev) => appendMealText(prev, emoji))}>{emoji}</Text>)}</View>}
      </View> : <>
        <Text className='meal-state'>{row.status === 'cancelled' || row.status === 'hidden' ? '约饭已取消，保留历史留言。' : '房间已关闭，保留历史留言。'}</Text>
        {row.can_extend && <Button className='meal-primary' disabled={busy} onClick={() => { void extend() }}>还没聊完？重新开放房间</Button>}
      </>}
    </>}
  </View>
}
export default withAuth(MealRoom)
