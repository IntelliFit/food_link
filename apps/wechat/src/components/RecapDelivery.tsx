import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, getStatsCalendarMonth } from '../utils/api'
import { localDay, recapPeriod, type RecapKind } from '../utils/health-recap'
import { HealthRecap } from './HealthRecap'
import { RecapCelebration } from './RecapCelebration'
import { RecapBookshelf, readBookMarks, bookMarksKey, type BookMarks } from './RecapBookshelf'
import './RecapDelivery.scss'

type Entry = { kind: RecapKind; anchor: string; start: string; end: string; id: string }
const labels = { week: '周报', month: '月报', year: '年报' }
// Local visual review only. Disable before handing the build to acceptance testing.
const RECAP_CELEBRATION_PREVIEW = true
const storageKey = (owner: string) => `period-recaps-v1:${owner}`
function readEntries(owner: string): Entry[] {
  try {
    const value = Taro.getStorageSync(storageKey(owner))
    return Array.isArray(value) ? value.filter(item => item && ['week', 'month', 'year'].includes(item.kind) && /^\d{4}-\d{2}-\d{2}$/.test(item.anchor) && typeof item.id === 'string').slice(0, 60) : []
  } catch { return [] }
}
/** Store only period metadata, never health values or access tokens. */
export function RecapDelivery({ archive = false }: { archive?: boolean }) {
  const generation = useRef(0)
  const [entries, setEntries] = useState<Entry[]>([])
  const [pending, setPending] = useState<Entry | null>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Entry | null>(null)
  const [owner, setOwner] = useState('')
  const [marks, setMarks] = useState<BookMarks>({})
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useDidHide(() => { generation.current += 1; setOpen(false); setSelected(null) })
  useDidShow(() => {
    const generationID = ++generation.current
    const user = getAccessToken() ? String(Taro.getStorageSync('user_id') || '') : ''
    setOwner(user); setMarks(user ? readBookMarks(user) : {}); setClosing(false); setOpen(false); setSelected(null); setPending(null)
    if (!user) { setEntries([]); return }
    const saved = readEntries(user)
    setEntries(saved)
    if (archive) return
    const now = new Date()
    const anchor = localDay(now)
    const kinds: RecapKind[] = [
      'week',
      ...(now.getDate() <= 7 ? ['month' as const] : []),
      ...(now.getMonth() === 0 && now.getDate() <= 14 ? ['year' as const] : []),
    ]
    const candidates = kinds.map(kind => {
      const period = recapPeriod(kind, now.getFullYear() - 1, now)
      return { kind, anchor, start: period.start, end: period.end, id: `${kind}:${period.start}` }
    }).filter(item => RECAP_CELEBRATION_PREVIEW || !saved.some(prior => prior.id === item.id))
    const token = getAccessToken()
    void (async () => {
      for (const candidate of candidates) {
        const period = recapPeriod(candidate.kind, now.getFullYear() - 1, now)
        for (const month of [...period.months].reverse()) {
          const calendar = await getStatsCalendarMonth(month)
          if (generation.current !== generationID || getAccessToken() !== token || String(Taro.getStorageSync('user_id') || '') !== user) return
          if (calendar.days.some(day => day.has_record && day.date >= candidate.start && day.date <= candidate.end)) { setPending(candidate); return }
        }
      }
    })().catch(() => { /* A failed check must not become a false report notification. */ })

  })
  const remember = (entry: Entry) => {
    if (!owner || String(Taro.getStorageSync('user_id') || '') !== owner || !getAccessToken()) return
    const saved = readEntries(owner)
    const next = saved.some(item => item.id === entry.id) ? saved : [entry, ...saved].slice(0, 60)
    try { Taro.setStorageSync(storageKey(owner), next) } catch { /* Still allow reading when storage is full. */ }
    setEntries(next); setPending(null)
  }
  const show = (entry: Entry) => { remember(entry); setSelected(entry); setOpen(true) }
  const updateMark = (id: string, stamp?: string) => {
    if (!owner || String(Taro.getStorageSync('user_id') || '') !== owner || !getAccessToken()) return
    const fresh = readBookMarks(owner)
    if (stamp && !fresh[id]?.read) return
    const next = { ...fresh, [id]: { read: true, stamp: stamp || fresh[id]?.stamp } }
    try { Taro.setStorageSync(bookMarksKey(owner), next) } catch { Taro.showToast({ title: '本次印记暂留在这里', icon: 'none' }) }
    setMarks(next)
  }
  const returnToShelf = () => {
    if (closing) return
    setClosing(true)
    closeTimer.current = setTimeout(() => { setSelected(null); setClosing(false) }, 600)
  }
  if (!owner) return null
  return <>
    {archive ? <View className='recap-archive-entry' role='button' onClick={() => setOpen(true)}><Text>食探书架</Text><Text>把日子收成一本书 ›</Text></View>
      : pending && <View className='recap-delivery-layer' catchMove>
        <View className='recap-delivery-mask' />
        <RecapCelebration loop={RECAP_CELEBRATION_PREVIEW} />
        <View className={`recap-delivery recap-delivery--${pending.kind}`} role='dialog' aria-label={`${labels[pending.kind]}提醒`}>
          <Text className='recap-delivery__eyebrow'>{pending.kind === 'year' ? '年度珍藏时刻' : pending.kind === 'month' ? '月度成长时刻' : '本周高光时刻'}</Text>
          <Text className='recap-delivery__spark'>✦</Text>
          <Text className='recap-delivery__title'>你的{labels[pending.kind]}已经送达</Text>
          <Text className='recap-delivery__dates'>{pending.start} — {pending.end}</Text>
          <Text className='recap-delivery__summary'>这段时间的认真生活，值得被好好庆祝。</Text>
          <View className='recap-delivery__actions'>
            <View role='button' className='recap-delivery__later' onClick={() => remember(pending)}>收进往期</View>
            <View role='button' className='recap-delivery__open' onClick={() => show(pending)}>查看报告</View>
          </View>
        </View>
      </View>}
    {open && <View className={`recap-reader recap-reader--journal${selected ? ` recap-reader--story recap-reader--${selected.kind}` : ''}${closing ? ' is-closing' : ''}`} catchMove>
      <View className='recap-reader__close' role='button' aria-label={selected ? '合上书本' : '离开书架'} onClick={() => { if (selected) returnToShelf(); else setOpen(false) }}>{selected ? '✉' : '×'}</View>
      {selected ? <HealthRecap key={selected.id} active={!closing} selection={selected} onShelf={returnToShelf} onComplete={() => updateMark(selected.id)} /> : <RecapBookshelf key={owner} owner={owner} entries={entries} marks={marks} onOpen={setSelected} onMark={updateMark} />}
    </View>}
  </>
}
