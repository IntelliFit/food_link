import { ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { communityGetOwnComments, type OwnCommentHistoryItem } from '../../../utils/api'
import { formatFeedTime } from '../../../utils/feed-time'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import './index.scss'

function CommentHistoryPage() {
  const [items, setItems] = useState<OwnCommentHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const cursor = useRef('')
  const busy = useRef(false)
  const sequence = useRef(0)
  useEffect(() => () => { sequence.current += 1 }, [])

  const load = async (reset: boolean) => {
    if (!reset && (busy.current || !hasMore)) return
    const request = ++sequence.current
    busy.current = true
    setLoading(true)
    setError(false)
    try {
      const page = await communityGetOwnComments(reset ? '' : cursor.current)
      if (request !== sequence.current) return
      setItems(previous => {
        const next = reset ? [] : [...previous]
        const ids = new Set(next.map(item => item.id))
        for (const item of page.list) if (!ids.has(item.id)) { next.push(item); ids.add(item.id) }
        return next
      })
      cursor.current = page.next_cursor || ''
      setHasMore(page.has_more && Boolean(cursor.current))
    } catch {
      if (request === sequence.current) setError(true)
    } finally {
      if (request === sequence.current) { busy.current = false; setLoading(false); Taro.stopPullDownRefresh() }
    }
  }

  useDidShow(() => { void load(true) })
  usePullDownRefresh(() => { void load(true) })

  const open = (item: OwnCommentHistoryItem) => {
    if (!item.target_available) return
    const query = `targetId=${encodeURIComponent(item.target_id)}&targetType=${encodeURIComponent(item.target_type)}&commentId=${encodeURIComponent(item.id)}`
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/interaction-feed-detail/index')}?${query}` })
  }

  return (
    <FlPageThemeRoot><View className='comment-history-page'>
      <ScrollView scrollY className='comment-history-scroll' onScrollToLower={() => void load(false)}>
        <Text className='comment-history-heading'>我的评论</Text>
        <Text className='comment-history-caption'>你发过的评论和回复</Text>
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
        {!loading && error && <View className='comment-history-state' onClick={() => void load(items.length === 0)}><Text>评论获取失败，点击重试</Text></View>}
        {!loading && !error && items.length === 0 && <View className='comment-history-state'><Text>还没有发过评论</Text></View>}
        {!loading && !error && hasMore && <View className='comment-history-state' onClick={() => void load(false)}><Text>查看更多</Text></View>}
      </ScrollView>
    </View></FlPageThemeRoot>
  )
}

export default withAuth(CommentHistoryPage)
