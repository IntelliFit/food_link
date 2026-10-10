import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useCallback, useEffect, useRef, useState } from 'react'
import { communityGetOwnComments, type OwnCommentHistoryItem } from '../../utils/api'
import { formatFeedTime } from '../../utils/feed-time'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import './OwnCommentHistory.scss'

export function OwnCommentHistory() {
  const [items, setItems] = useState<OwnCommentHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const cursor = useRef('')
  const busy = useRef(false)
  const moreAvailable = useRef(false)
  const failedReset = useRef(true)
  const sequence = useRef(0)

  const load = useCallback(async (reset: boolean) => {
    if (!reset && (busy.current || !moreAvailable.current)) return
    const request = ++sequence.current
    failedReset.current = reset
    busy.current = true
    setLoading(true)
    setError(false)
    try {
      const page = await communityGetOwnComments(reset ? '' : cursor.current)
      if (request !== sequence.current) return
      setItems(previous => {
        const next = reset ? [] : [...previous]
        const ids = new Set(next.map(item => item.id))
        for (const item of page.list) {
          if (!ids.has(item.id)) { next.push(item); ids.add(item.id) }
        }
        return next
      })
      cursor.current = page.next_cursor || ''
      moreAvailable.current = page.has_more && Boolean(cursor.current)
      setHasMore(moreAvailable.current)
    } catch {
      if (request === sequence.current) setError(true)
    } finally {
      if (request === sequence.current) {
        busy.current = false
        setLoading(false)
        Taro.stopPullDownRefresh()
      }
    }
  }, [])

  useEffect(() => {
    if (!busy.current) void load(true)
    return () => { sequence.current += 1; busy.current = false }
  }, [load])
  useDidShow(() => { if (!busy.current) void load(true) })
  useDidHide(() => { sequence.current += 1; busy.current = false })
  usePullDownRefresh(() => { void load(true) })

  const open = (item: OwnCommentHistoryItem) => {
    if (!item.target_available) return
    const query = `targetId=${encodeURIComponent(item.target_id)}&targetType=${encodeURIComponent(item.target_type)}&commentId=${encodeURIComponent(item.id)}`
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/interaction-feed-detail/index')}?${query}` })
  }

  return (
    <ScrollView scrollY className='comment-history-scroll' onScrollToLower={() => void load(false)}>
      {items.map(item => (
        <View key={item.id} className='comment-history-card' onClick={() => open(item)}>
          <View className='comment-history-meta'><Text>{item.parent_comment_id ? '回复' : '评论'}</Text><Text>{item.created_at ? formatFeedTime(item.created_at) : ''}</Text></View>
          <Text className='comment-history-content'>{item.content}</Text>
          <View className='comment-history-target'>
            <Text>{item.target_available ? item.target_preview || '查看原动态' : '原动态已删除或暂不可见'}</Text>
            {item.target_available && <Text className='comment-history-arrow'>›</Text>}
          </View>
        </View>
      ))}
      {loading && <View className='comment-history-spinner' />}
      {!loading && error && <View className='comment-history-state' onClick={() => void load(failedReset.current)}><Text>评论获取失败，点击重试</Text></View>}
      {!loading && !error && items.length === 0 && <View className='comment-history-state'><Text>还没有发过评论</Text></View>}
      {!loading && !error && hasMore && <View className='comment-history-state' onClick={() => void load(false)}><Text>查看更多</Text></View>}
    </ScrollView>
  )
}
