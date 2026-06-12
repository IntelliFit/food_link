import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  getFollowers,
  getFollowing,
  followUser,
  unfollowUser,
  type FollowUser,
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import './index.scss'

type ListType = 'followers' | 'following'

export default function FollowListPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()

  const listType = (router.params.type || 'followers') as ListType
  const targetUserId = String(router.params.user_id || '').trim()
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()

  const [list, setList] = useState<FollowUser[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({})

  const pageTitle = listType === 'followers' ? '被关注' : '关注'

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
    Taro.setNavigationBarTitle({ title: pageTitle })
  }, [scheme, pageTitle])

  useEffect(() => {
    if (targetUserId) {
      loadList(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUserId, listType])

  const loadList = async (reset = false) => {
    if (!targetUserId) return
    if (loading) return
    const currentOffset = reset ? 0 : offset
    if (!reset && !hasMore) return

    setLoading(true)
    try {
      const res = listType === 'followers'
        ? await getFollowers(targetUserId, currentOffset, 20)
        : await getFollowing(targetUserId, currentOffset, 20)
      const newList = res.list || []
      if (reset) {
        setList(newList)
        // 初始化关注状态
        const states: Record<string, boolean> = {}
        newList.forEach(u => {
          // 关注列表默认都是已关注；粉丝列表默认未知（简化处理）
          states[u.id] = listType === 'following'
        })
        setFollowStates(states)
      } else {
        setList(prev => [...prev, ...newList])
      }
      setHasMore(res.has_more ?? (newList.length >= 20))
      setOffset(currentOffset + newList.length)
    } catch (error) {
      console.error(`[follow-list] 加载${pageTitle}列表失败:`, error)
    } finally {
      setLoading(false)
    }
  }

  const handleScrollToLower = () => {
    if (hasMore && !loading) {
      loadList(false)
    }
  }

  const handleToggleFollow = useCallback(async (userId: string) => {
    if (!currentUserId || currentUserId === userId) return
    const currentlyFollowing = followStates[userId] || false
    try {
      if (currentlyFollowing) {
        await unfollowUser(userId)
        setFollowStates(prev => ({ ...prev, [userId]: false }))
      } else {
        await followUser(userId)
        setFollowStates(prev => ({ ...prev, [userId]: true }))
      }
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '操作失败', icon: 'none' })
    }
  }, [currentUserId, followStates])

  const handleGoProfile = (userId: string) => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/profile-settings/index')}?user_id=${encodeURIComponent(userId)}` })
  }

  return (
    <FlPageThemeRoot>
      <View className={`follow-list-page ${scheme === 'dark' ? 'follow-list-page--dark' : ''}`}>
        {list.length === 0 && !loading ? (
          <View className='follow-list-empty'>
            <Text className='follow-list-empty-text'>暂无{pageTitle}</Text>
          </View>
        ) : (
          <View
            className='follow-list-content'
          >
            {list.map((item) => {
              const isSelf = item.id === currentUserId
              const isFollowing = followStates[item.id] || false
              return (
                <View key={item.id} className='follow-list-item'>
                  <View className='follow-item-left' onClick={() => handleGoProfile(item.id)}>
                    <View className='follow-item-avatar'>
                      {item.avatar ? (
                        <Image src={item.avatar} className='follow-item-avatar-img' mode='aspectFill' />
                      ) : (
                        <Text className='follow-item-avatar-placeholder'>👤</Text>
                      )}
                    </View>
                    <Text className='follow-item-nickname'>{item.nickname || '用户'}</Text>
                  </View>
                  {!isSelf && (
                    <View
                      className={`follow-item-btn ${isFollowing ? 'follow-item-btn--active' : ''}`}
                      onClick={() => handleToggleFollow(item.id)}
                    >
                      <Text className='follow-item-btn-text'>
                        {isFollowing ? '已关注' : '+ 关注'}
                      </Text>
                    </View>
                  )}
                </View>
              )
            })}
            {loading && (
              <View className='follow-list-loading'>
                <View className='follow-list-spinner' />
              </View>
            )}
          </View>
        )}
      </View>
    </FlPageThemeRoot>
  )
}
