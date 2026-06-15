import { withAuth } from '../../../utils/withAuth'
import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useCallback, useRef, useState } from 'react'
import Taro from '@tarojs/taro'

import {
  getConversations,
  showUnifiedApiError,
  SYSTEM_MESSAGE_USER_ID,
  type ConversationSummary,
} from '../../../utils/api'

import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { DEFAULT_AVATAR_URL, LOGIN_LOGO_URL } from '../../../utils/static-asset-cdn-url'
import './index.scss'

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
    return `${date.getMonth() + 1}月${date.getDate()}日`
  } catch {
    return timeStr
  }
}

function buildPreviewText(item: ConversationSummary): string {
  const last = item.last_message
  if (!last) return ''
  if (item.user_id === SYSTEM_MESSAGE_USER_ID) {
    return last.content || ''
  }
  if (last.content_type === 'image') {
    return last.sender_id === item.user_id ? '我: [图片]' : '[图片]'
  }
  const prefix = last.sender_id === item.user_id ? '我: ' : ''
  return `${prefix}${last.content || ''}`
}

function PrivateConversationsPage() {
  const { scheme } = useAppColorScheme()
  const isDark = scheme === 'dark'
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [list, setList] = useState<ConversationSummary[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const loadMoreLockRef = useRef(false)

  const loadConversations = useCallback(async (isRefresh = false) => {
    const currentOffset = isRefresh ? 0 : offset
    if (!isRefresh) {
      if (loadingMore || !hasMore || loadMoreLockRef.current) return
      loadMoreLockRef.current = true
      setLoadingMore(true)
    }

    try {
      const res = await getConversations(currentOffset, PAGE_SIZE)
      const newList = res.list || []
      if (isRefresh) {
        setList(newList)
      } else {
        setList((prev) => {
          const existingIds = new Set(prev.map((item) => item.user_id))
          const merged = [...prev]
          newList.forEach((item) => {
            if (!existingIds.has(item.user_id)) {
              merged.push(item)
            }
          })
          return merged
        })
      }
      setOffset(currentOffset + newList.length)
      setHasMore(res.has_more ?? newList.length >= PAGE_SIZE)
    } catch (e) {
      await showUnifiedApiError(e, '加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
      loadMoreLockRef.current = false
    }
  }, [offset, hasMore, loadingMore])

  Taro.useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#ffffff', darkBackground: '#101716' })
    setOffset(0)
    setHasMore(true)
    setLoading(true)
    getConversations(0, PAGE_SIZE)
      .then((res) => {
        const newList = res.list || []
        setList(newList)
        setOffset(newList.length)
        setHasMore(res.has_more ?? newList.length >= PAGE_SIZE)
      })
      .catch(async (e) => {
        await showUnifiedApiError(e, '加载失败')
      })
      .finally(() => {
        setLoading(false)
      })
  })

  const handleRefresh = () => {
    setRefreshing(true)
    setOffset(0)
    setHasMore(true)
    loadConversations(true)
  }

  const handleLoadMore = () => {
    if (loadingMore || !hasMore || list.length === 0) return
    loadConversations(false)
  }

  const handleOpenConversation = (item: ConversationSummary) => {
    if (!item.user_id) {
      Taro.showToast({ title: '无法打开会话', icon: 'none' })
      return
    }
    Taro.navigateTo({
      url: `${extraPkgUrl('/pages/private-chat/index')}?user_id=${encodeURIComponent(item.user_id)}`,
    })
  }

  return (
    <View className={`private-conversations-page ${isDark ? 'private-conversations-page--dark' : ''}`}>
      {loading && list.length === 0 ? (
        <View className='conversations-loading'>
          <View className='conversations-spinner' />
        </View>
      ) : list.length === 0 ? (
        <View className='conversations-empty'>
          <Text className='empty-icon iconfont icon-comment' />
          <Text className='empty-title'>暂无私信</Text>
          <Text className='empty-subtitle'>有人给你发消息时会出现在这里</Text>
        </View>
      ) : (
        <ScrollView
          className='conversations-list'
          scrollY
          enhanced
          showScrollbar={false}
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresh}
          refresherDefaultStyle='black'
          lowerThreshold={100}
          onScrollToLower={handleLoadMore}
        >
          {list.map((item) => {
            const preview = buildPreviewText(item)
            const unread = (item.unread_count || 0) > 0
            return (
              <View
                key={item.user_id}
                className={`conversation-card ${unread ? 'unread' : ''}`}
                onClick={() => handleOpenConversation(item)}
              >
                <View className='conversation-avatar'>
                  {item.user_id === SYSTEM_MESSAGE_USER_ID ? (
                    <Image className='conversation-avatar-img' src={LOGIN_LOGO_URL} mode='aspectFill' />
                  ) : (
                    <Image className='conversation-avatar-img' src={item.avatar || DEFAULT_AVATAR_URL} mode='aspectFill' />
                  )}
                </View>
                <View className='conversation-main'>
                  <View className='conversation-top'>
                    <Text className='conversation-nickname' numberOfLines={1}>
                      {item.nickname || '用户'}
                    </Text>
                  </View>
                  <Text className={`conversation-preview ${unread ? 'unread' : ''}`} numberOfLines={1}>
                    {preview}
                  </Text>
                </View>
                <View className='conversation-right'>
                  <Text className='conversation-time'>
                    {formatTimeLabel(item.last_message?.created_at)}
                  </Text>
                  {unread ? (
                    <View className='conversation-badge'>
                      <Text className='conversation-badge-text'>
                        {item.unread_count > 99 ? '99+' : String(item.unread_count)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            )
          })}
          {loadingMore ? (
            <View className='conversations-load-more'>
              <View className='conversations-spinner' />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}

export default withAuth(PrivateConversationsPage)
