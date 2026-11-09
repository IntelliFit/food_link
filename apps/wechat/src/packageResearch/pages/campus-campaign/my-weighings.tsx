import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getMyResearchSamples, type ResearchSample } from '../../../utils/research-weight-api'
import { STATUS_LABELS } from '../research-weight/model'
import { isCampaignWeighing, weighingResult } from './labels'

const POLL_MS = 3000
/** 自动审核一般十秒内出结果；最多等 45 秒，之后回到页面再刷新。 */
const POLL_ROUNDS = 15
const SHOWN = 3

interface MyWeighingsProps {
  /** 有一份审核完了：刷新活动页的计数。 */
  onReviewed: () => void
}

/** 活动里最近的几次称重和自动审核结果，审核中的会自己刷新。 */
export function MyWeighings({ onReviewed }: MyWeighingsProps) {
  const [items, setItems] = useState<ResearchSample[]>([])
  const rounds = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIds = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    let latest: ResearchSample[] = []
    try {
      latest = ((await getMyResearchSamples()).items || []).filter(isCampaignWeighing).slice(0, SHOWN)
      setItems(latest)
    } catch (error) {
      console.warn('[campus-campaign] load weighings failed', error)
    }
    const pending = new Set(latest.filter((item) => item.status === 'pending').map((item) => item.id))
    const finished = [...pendingIds.current].some((id) => !pending.has(id))
    pendingIds.current = pending
    if (finished) onReviewed()
    if (pending.size && rounds.current < POLL_ROUNDS) {
      rounds.current += 1
      timer.current = setTimeout(() => void load(), POLL_MS)
    }
  }, [onReviewed])

  const refresh = useRef(load)
  refresh.current = load
  // 这张卡在活动数据回来之后才出现，错过了页面第一次 onShow，所以挂载时先拉一次。
  useEffect(() => {
    void refresh.current()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [])
  useDidShow(() => {
    rounds.current = 0
    void refresh.current()
  })

  if (!items.length) return null
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>我的称重</Text>
      {items.map((item) => (
        <View key={item.id} className='rw-mine'>
          <View className='rw-mine__copy'>
            <Text className='rw-mine__name'>{item.dish_name || '这一顿'}</Text>
            <Text className='rw-mine__meta'>{weighingResult(item)}</Text>
          </View>
          <Text className={`rw-status rw-status--${item.status}`}>{STATUS_LABELS[item.status] || item.status}</Text>
        </View>
      ))}
    </View>
  )
}
