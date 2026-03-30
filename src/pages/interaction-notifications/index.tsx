import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useCallback, useState } from 'react'
import Taro from '@tarojs/taro'

import {
  communityGetNotifications,
  communityMarkNotificationsRead,
  type FeedInteractionNotification
} from '../../utils/api'

import './index.scss'

const COMMUNITY_NOTIFICATION_TARGET_STORAGE_KEY = 'community_notification_target_v1'

function persistPendingCommunityTarget(item: FeedInteractionNotification) {
  if (!item.record_id) return
  try {
    Taro.setStorageSync(COMMUNITY_NOTIFICATION_TARGET_STORAGE_KEY, {
      recordId: item.record_id,
      commentId: item.comment_id || '',
      parentCommentId: item.parent_comment_id || '',
      createdAt: Date.now()
    })
  } catch (e) {
    console.error('缓存互动消息跳转目标失败:', e)
  }
}

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

function buildNotificationTitle(item: FeedInteractionNotification): string {
  if (item.notification_type === 'comment_received') {
    return `${item.actor.nickname || '有人'}评论了你的动态`
  }
  if (item.notification_type === 'reply_received') {
    return `${item.actor.nickname || '有人'}回复了你的评论`
  }
  return '你的评论未通过审核'
}

export default function InteractionNotificationsPage() {
  const [loading, setLoading] = useState(true)
  const [markingRead, setMarkingRead] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [list, setList] = useState<FeedInteractionNotification[]>([])

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await communityGetNotifications(100)
      setList(res.list || [])
      setUnreadCount(res.unread_count || 0)
      if ((res.unread_count || 0) > 0) {
        const readRes = await communityMarkNotificationsRead()
        setUnreadCount(readRes.unread_count || 0)
        setList((prev) => prev.map((item) => ({ ...item, is_read: true })))
      }
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [])

  Taro.useDidShow(() => {
    loadNotifications()
  })

  const handleMarkAllRead = async () => {
    if (markingRead || unreadCount <= 0) return
    setMarkingRead(true)
    try {
      const res = await communityMarkNotificationsRead()
      setUnreadCount(res.unread_count || 0)
      setList((prev) => prev.map((item) => ({ ...item, is_read: true })))
      Taro.showToast({ title: '已全部标记已读', icon: 'success' })
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '操作失败', icon: 'none' })
    } finally {
      setMarkingRead(false)
    }
  }

  const handleOpenNotification = (item: FeedInteractionNotification) => {
    if (!item.record_id) {
      Taro.showToast({ title: '未找到对应动态', icon: 'none' })
      return
    }
    persistPendingCommunityTarget(item)
    Taro.switchTab({ url: '/pages/community/index' })
  }

  return (
    <View className='interaction-notifications-page'>
      <View className='notifications-header'>
        <View>
          <Text className='notifications-title'>互动消息</Text>
          <Text className='notifications-subtitle'>评论、回复和审核结果都会显示在这里</Text>
        </View>
        <View
          className={`mark-read-btn ${(markingRead || unreadCount <= 0) ? 'disabled' : ''}`}
          onClick={handleMarkAllRead}
        >
          <Text>{markingRead ? '处理中...' : '全部已读'}</Text>
        </View>
      </View>

      {loading ? (
        <View className='notifications-loading'>
          <Text>加载中...</Text>
        </View>
      ) : list.length === 0 ? (
        <View className='notifications-empty'>
          <Text className='empty-title'>暂无互动消息</Text>
          <Text className='empty-subtitle'>有人评论或回复你时，会出现在这里</Text>
        </View>
      ) : (
        <ScrollView className='notifications-list' scrollY enhanced showScrollbar={false}>
          {list.map((item) => (
            <View
              key={item.id}
              className={`notification-card ${item.is_read ? '' : 'unread'}`}
              onClick={() => handleOpenNotification(item)}
            >
              <View className='notification-avatar'>
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
                  {item.content_preview || '点击查看详情'}
                </Text>
                <Text className='notification-time'>{formatTimeLabel(item.created_at)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}
