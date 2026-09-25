import { InkShelfEntry } from './InkWellness'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { useRef, useState } from 'react'
import { getAccessToken, getStatsCalendarMonth } from '../utils/api'
import { localDay, recapPeriod, type RecapKind } from '../utils/health-recap'
import { RecapCelebration } from './RecapCelebration'
import './RecapDelivery.scss'

type Entry = { kind: RecapKind; anchor: string; start: string; end: string; id: string }
const labels = { week: '周报', month: '月报', year: '年报' }
// Local visual review: keep the homepage delivery available when returning to the tab.
// Production deliveries must still respect the per-period read marker.
const RECAP_CELEBRATION_PREVIEW = typeof __ENABLE_DEV_DEBUG_UI__ !== 'undefined' && __ENABLE_DEV_DEBUG_UI__
const RECAP_DELIVERY_PREVIEW_STORAGE_KEY = 'dev_recap_delivery_preview_once'
const storageKey = (owner: string) => `period-recaps-v1:${owner}`
function currentRecapOwner(): string {
  try {
    return getAccessToken() ? String(Taro.getStorageSync('user_id') || '') : ''
  } catch {
    return ''
  }
}
function readEntries(owner: string): Entry[] {
  try {
    const value = Taro.getStorageSync(storageKey(owner))
    return Array.isArray(value) ? value.filter(item => item && ['week', 'month', 'year'].includes(item.kind) && /^\d{4}-\d{2}-\d{2}$/.test(item.anchor) && typeof item.id === 'string').slice(0, 60) : []
  } catch { return [] }
}
/** Store only period metadata, never health values or access tokens. */
export function RecapDelivery({ archive = false, ink = false }: { archive?: boolean; ink?: boolean }) {
  const generation = useRef(0)
  const ownerRef = useRef('')
  const initialOwner = currentRecapOwner()
  const [, setEntries] = useState<Entry[]>(() => initialOwner ? readEntries(initialOwner) : [])
  const [pending, setPending] = useState<Entry | null>(null)
  const [owner, setOwner] = useState(initialOwner)
  // Native viewers such as wx.previewImage temporarily hide the mini program.
  // Invalidate only delivery checks; the report reader lives in its own subpackage page.
  useDidHide(() => { generation.current += 1 })
  useDidShow(() => {
    const generationID = ++generation.current
    const user = getAccessToken() ? String(Taro.getStorageSync('user_id') || '') : ''
    const accountChanged = Boolean(ownerRef.current && ownerRef.current !== user)
    ownerRef.current = user
    setOwner(user)
    if (accountChanged || !user) {
      setPending(null)
    }
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
    if (__ENABLE_DEV_DEBUG_UI__ && RECAP_CELEBRATION_PREVIEW) {
      setPending(candidates[0] ?? null)
      return
    }
    if (__ENABLE_DEV_DEBUG_UI__) {
      try {
        if (Taro.getStorageSync(RECAP_DELIVERY_PREVIEW_STORAGE_KEY) === '1') {
          Taro.removeStorageSync(RECAP_DELIVERY_PREVIEW_STORAGE_KEY)
          setPending(candidates[0] ?? null)
          return
        }
      } catch {
        /* Fall through to the real delivery check. */
      }
    }
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
  const openReader = (entry?: Entry) => {
    if (entry) remember(entry)
    const query = entry
      ? `?kind=${entry.kind}&anchor=${entry.anchor}&start=${entry.start}&end=${entry.end}&id=${encodeURIComponent(entry.id)}`
      : ''
    void Taro.navigateTo({ url: `/packageRecap/pages/recap/index${query}` })
  }
  if (!owner) return null
  return <>
    {archive ? ink ? <InkShelfEntry onOpen={() => openReader()} /> : <View className='recap-archive-entry' role='button' onClick={() => openReader()}><Text>食探书架</Text><Text>把日子收成一本书 ›</Text></View>
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
            <View role='button' className='recap-delivery__open' onClick={() => openReader(pending)}>查看报告</View>
          </View>
        </View>
      </View>}
  </>
}
