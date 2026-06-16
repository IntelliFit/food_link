import { withAuth } from '../../../utils/withAuth'
import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useCallback, useMemo, useRef, useState } from 'react'
import Taro from '@tarojs/taro'

import {
  communityGetNotifications,
  communityMarkNotificationsRead,
  showUnifiedApiError,
  type FeedInteractionNotification
} from '../../../utils/api'

import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

type NotificationTab = 'all' | 'like' | 'comment'

const PAGE_SIZE = 20

function formatTimeLabel(timeStr: string): string {
  if (!timeStr) return ''
  try {
    const date = new Date(timeStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    if (diff < 60 * 1000) return '刚刚'
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 1000)))}分钟前`
    if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 60 * 1000)))}小时前`
    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return timeStr
  }
}

function getNotificationType(item: FeedInteractionNotification): string {
  return String((item as { notification_type?: unknown }).notification_type || '').trim().toLowerCase()
}

function buildNotificationTitle(item: FeedInteractionNotification): string {
  const notificationType = getNotificationType(item)
  if (notificationType === 'like_received') {
    return `${item.actor.nickname || '有人'}赞了你的动态`
  }
  if (notificationType === 'comment_received') {
    return `${item.actor.nickname || '有人'}评论了你的动态`
  }
  if (notificationType === 'reply_received') {
    return `${item.actor.nickname || '有人'}回复了你的评论`
  }
  if (notificationType === 'comment_rejected') {
    return '你的评论未通过审核'
  }
  return '你收到一条互动消息'
}

function buildNotificationContent(item: FeedInteractionNotification): string {
  const notificationType = getNotificationType(item)
  if (notificationType === 'comment_rejected') {
    return item.content_preview || '系统拦截了一条评论，点击查看详情'
  }
  return item.content_preview || '点击查看详情'
}

function isLikeType(nt: string) { return nt === 'like_received' }
function isCommentType(nt: string) { return nt === 'comment_received' || nt === 'reply_received' || nt === 'comment_rejected' }

function tabApiType(tab: NotificationTab): string {
  if (tab === 'like') return 'like_received'
  if (tab === 'comment') return 'comment_received'
  return ''
}

function InteractionNotificationsPage() {
  const [loading, setLoading] = useState(true)
  const [markingRead, setMarkingRead] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [list, setList] = useState<FeedInteractionNotification[]>([])
  const [activeTab, setActiveTab] = useState<NotificationTab>('all')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const offsetRef = useRef(0)
  const loadedRef = useRef(false)

  const filteredList = useMemo(() => {
    if (activeTab === 'all') return list
    if (activeTab === 'like') return list.filter((item) => isLikeType(getNotificationType(item)))
    return list.filter((item) => isCommentType(getNotificationType(item)))
  }, [list, activeTab])

  const likeCount = useMemo(() => list.filter((item) => isLikeType(getNotificationType(item))).length, [list])
  const commentCount = useMemo(() => list.filter((item) => isCommentType(getNotificationType(item))).length, [list])

  const loadNotifications = useCallback(async (tab: NotificationTab, offset: number, append: boolean) => {
    const isFirst = !append
    if (isFirst) {
      setLoading(true)
      loadedRef.current = false
    } else {
      setLoadingMore(true)
    }

    try {
      const apiType = tabApiType(tab)
      const res = await communityGetNotifications(PAGE_SIZE, apiType || undefined, offset)
      const newList = res.list || []

      if (append) {
        setList((prev) => [...prev, ...newList])
      } else {
        setList(newList)
        setUnreadCount(res.unread_count || 0)
        if ((res.unread_count || 0) > 0) {
          const readRes = await communityMarkNotificationsRead()
          setUnreadCount(readRes.unread_count || 0)
          setList((prev) => prev.map((item) => ({ ...item, is_read: true })))
        }
      }

      setHasMore(res.has_more)
      offsetRef.current = offset + newList.length
      loadedRef.current = true
    } catch (e) {
      await showUnifiedApiError(e, '加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  Taro.useDidShow(() => {
    if (!loadedRef.current) {
      offsetRef.current = 0
      loadNotifications(activeTab, 0, false)
    }
  })

  const handleTabChange = (tab: NotificationTab) => {
    if (tab === activeTab) return
    setActiveTab(tab)
    offsetRef.current = 0
    loadNotifications(tab, 0, false)
  }

  const handleMarkAllRead = async () => {
    if (markingRead || unreadCount <= 0) return
    setMarkingRead(true)
    try {
      const res = await communityMarkNotificationsRead()
      setUnreadCount(res.unread_count || 0)
      setList((prev) => prev.map((item) => ({ ...item, is_read: true })))
      Taro.showToast({ title: '已全部标记已读', icon: 'success' })
    } catch (e) {
      await showUnifiedApiError(e, '操作失败')
    } finally {
      setMarkingRead(false)
    }
  }

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return
    loadNotifications(activeTab, offsetRef.current, true)
  }

  const handleOpenNotification = (item: FeedInteractionNotification) => {
    const targetType = item.target_type || 'food_record'
    const targetId = item.target_id || item.record_id || ''
    if (!targetId) {
      Taro.showToast({ title: '未找到对应动态', icon: 'none' })
      return
    }
    const query = [
      `recordId=${encodeURIComponent(targetId)}`,
      `targetId=${encodeURIComponent(targetId)}`,
      `targetType=${encodeURIComponent(targetType)}`,
      `notificationType=${encodeURIComponent(item.notification_type || '')}`,
      `commentId=${encodeURIComponent(item.comment_id || '')}`,
      `parentCommentId=${encodeURIComponent(item.parent_comment_id || '')}`
    ].join('&')
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/interaction-feed-detail/index')}?${query}` })
  }

  const handleAvatarClick = (e: any, actorId?: string | null) => {
    e.stopPropagation()
    if (!actorId) return
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/profile-settings/index')}?user_id=${encodeURIComponent(actorId)}` })
  }

  return (
    <View className='interaction-notifications-page'>
      <View className='notifications-header'>
        <View>
          <Text className='notifications-title'>互动消息</Text>
          <Text className='notifications-subtitle'>点赞、评论、回复和审核结果都会显示在这里</Text>
        </View>
        <View
          className={`mark-read-btn ${(markingRead || unreadCount <= 0) ? 'disabled' : ''}`}
          onClick={handleMarkAllRead}
        >
          {markingRead ? <View className='btn-spinner' /> : <Text>全部已读</Text>}
        </View>
      </View>

      {/* Tab 切换 */}
      <View className='notifications-tabs'>
        <View
          className={`tab-item ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => handleTabChange('all')}
        >
          <Text className='tab-text'>全部</Text>
          {activeTab === 'all' && <View className='tab-indicator' />}
        </View>
        <View
          className={`tab-item ${activeTab === 'like' ? 'active' : ''}`}
          onClick={() => handleTabChange('like')}
        >
          <Text className='tab-text'>点赞</Text>
          {likeCount > 0 && (
            <Text className={`tab-badge ${activeTab === 'like' ? 'active' : ''}`}>{likeCount}</Text>
          )}
          {activeTab === 'like' && <View className='tab-indicator' />}
        </View>
        <View
          className={`tab-item ${activeTab === 'comment' ? 'active' : ''}`}
          onClick={() => handleTabChange('comment')}
        >
          <Text className='tab-text'>评论</Text>
          {commentCount > 0 && (
            <Text className={`tab-badge ${activeTab === 'comment' ? 'active' : ''}`}>{commentCount}</Text>
          )}
          {activeTab === 'comment' && <View className='tab-indicator' />}
        </View>
      </View>

      {loading ? (
        <View className='notifications-loading'>
          <View className='loading-spinner-md' />
        </View>
      ) : filteredList.length === 0 ? (
        <View className='notifications-empty'>
          <Text className='empty-title'>
            {activeTab === 'all' ? '暂无互动消息' : activeTab === 'like' ? '暂无点赞' : '暂无评论'}
          </Text>
          <Text className='empty-subtitle'>
            {activeTab === 'all' ? '有人评论或回复你时，会出现在这里' : '切换到"全部"查看所有互动'}
          </Text>
        </View>
      ) : (
        <ScrollView
          className='notifications-list'
          scrollY
          enhanced
          showScrollbar={false}
          onScrollToLower={handleLoadMore}
          lowerThreshold={100}
        >
          {filteredList.map((item) => (
            <View
              key={item.id}
              className={`notification-card ${item.is_read ? '' : 'unread'}`}
              onClick={() => handleOpenNotification(item)}
            >
              <View
                className='notification-avatar'
                onClick={(e) => handleAvatarClick(e, item.actor.id)}
              >
                {item.actor.avatar ? (
                  <Image className='notification-avatar-img' src={item.actor.avatar} mode='aspectFill' />
                ) : (
                  <Text className='notification-avatar-placeholder'>信</Text>
                )}
              </View>
              <View className='notification-main'>
                <View className='notification-top'>
                  <Text className='notification-title'>{buildNotificationTitle(item)}</Text>
                  {!item.is_read ? <View className='notification-dot' /> : null}
                </View>
                <Text className='notification-content' numberOfLines={2}>
                  {buildNotificationContent(item)}
                </Text>
                <Text className='notification-time'>{formatTimeLabel(item.created_at)}</Text>
              </View>
            </View>
          ))}
          {loadingMore && (
            <View className='load-more-spinner'>
              <View className='mini-spinner' />
            </View>
          )}
          {!hasMore && filteredList.length > 0 && (
            <View className='list-end'>— 没有更多了 —</View>
          )}
        </ScrollView>
      )}
    </View>
  )
}

export default withAuth(InteractionNotificationsPage)
