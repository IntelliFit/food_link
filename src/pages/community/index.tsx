import { View, Text, ScrollView, Image, Input, Textarea, Button } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'

import {
  getAccessToken,
  friendSearch,
  friendSendRequest,
  friendGetRequests,
  friendRespondRequest,
  friendGetList,
  friendCleanupDuplicates,
  communityGetFeed,
  communityGetPublicFeed,
  communityLike,
  communityUnlike,
  communityPostComment,
  type FriendSearchUser,
  type FriendRequestItem,
  type FriendListItem,
  type CommunityFeedItem
} from '../../utils/api'
import { IconCamera } from '../../components/iconfont'
import { Button as TaroifyButton, Divider } from '@taroify/core'
import '@taroify/core/button/style'
import '@taroify/core/divider/style'

import './index.scss'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

function formatFeedTime(recordTime: string): string {
  if (!recordTime) return ''
  try {
    const d = new Date(recordTime)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return d.toLocaleDateString()
  } catch {
    return recordTime.slice(0, 16).replace('T', ' ')
  }
}

// 缓存键名常量
const CACHE_KEYS = {
  FEED: 'community_feed_cache',
  FRIENDS: 'community_friends_cache',
  REQUESTS: 'community_requests_cache',
  FEED_TIMESTAMP: 'community_feed_timestamp',
  FRIENDS_TIMESTAMP: 'community_friends_timestamp'
}

// 缓存有效期（5分钟）
const CACHE_DURATION = 5 * 60 * 1000

function getLocalUserDisplay(): { nickname: string; avatar: string } {
  try {
    const raw = Taro.getStorageSync('userInfo')
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return {
      nickname: parsed?.name || parsed?.nickname || '用户',
      avatar: parsed?.avatar || ''
    }
  } catch {
    return { nickname: '用户', avatar: '' }
  }
}

export default function CommunityPage() {
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken())
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [requests, setRequests] = useState<FriendRequestItem[]>([])
  const [feedList, setFeedList] = useState<CommunityFeedItem[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [showRequests, setShowRequests] = useState(false)

  // 首次加载标志（用于判断是否显示骨架屏）
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(false)

  // 上次刷新时间（用于条件刷新）
  const lastFeedRefreshTime = useRef<number>(0)
  const lastFriendsRefreshTime = useRef<number>(0)

  // 评论：当前评论的 recordId、输入内容、提交中、延迟聚焦
  const [expandedCommentRecordId, setExpandedCommentRecordId] = useState<string | null>(null)
  const [commentContent, setCommentContent] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [commentInputFocus, setCommentInputFocus] = useState(false)

  // 固定页面高度
  const [pageHeight, setPageHeight] = useState(0)

  // 分页状态
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const PAGE_SIZE = 10

  // 添加好友：搜索类型、关键词、结果、发送中
  const [searchType, setSearchType] = useState<'nickname' | 'telephone'>('nickname')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<FriendSearchUser[]>([])
  const [searching, setSearching] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

  /**
   * 从缓存加载数据（立即展示，无等待）
   */
  const loadFromCache = useCallback(() => {
    try {
      const cachedFeed = Taro.getStorageSync(CACHE_KEYS.FEED)
      const cachedFriends = Taro.getStorageSync(CACHE_KEYS.FRIENDS)
      const cachedRequests = Taro.getStorageSync(CACHE_KEYS.REQUESTS)

      let hasCache = false

      if (cachedFeed) {
        try {
          const parsed = JSON.parse(cachedFeed)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setFeedList(parsed)
            setOffset(parsed.length) // 同步更新 offset，确保后续 loadMore 正确
            hasCache = true
          }
        } catch (e) {
          console.error('解析 Feed 缓存失败:', e)
        }
      }

      if (cachedFriends) {
        try {
          const parsed = JSON.parse(cachedFriends)
          if (Array.isArray(parsed)) {
            setFriends(parsed)
          }
        } catch (e) {
          console.error('解析好友缓存失败:', e)
        }
      }

      if (cachedRequests) {
        try {
          const parsed = JSON.parse(cachedRequests)
          if (Array.isArray(parsed)) {
            setRequests(parsed)
          }
        } catch (e) {
          console.error('解析请求缓存失败:', e)
        }
      }

      return hasCache
    } catch (e) {
      console.error('加载缓存失败:', e)
      return false
    }
  }, [])

  /**
   * 保存数据到缓存
   */
  const saveToCache = useCallback((feedData?: CommunityFeedItem[], friendsData?: FriendListItem[], requestsData?: FriendRequestItem[]) => {
    try {
      if (feedData) {
        // 只缓存前30条，避免缓存过大
        const dataToCache = feedData.slice(0, 30)
        Taro.setStorageSync(CACHE_KEYS.FEED, JSON.stringify(dataToCache))
        Taro.setStorageSync(CACHE_KEYS.FEED_TIMESTAMP, Date.now().toString())
      }
      if (friendsData !== undefined) {
        Taro.setStorageSync(CACHE_KEYS.FRIENDS, JSON.stringify(friendsData))
        Taro.setStorageSync(CACHE_KEYS.FRIENDS_TIMESTAMP, Date.now().toString())
      }
      if (requestsData !== undefined) {
        Taro.setStorageSync(CACHE_KEYS.REQUESTS, JSON.stringify(requestsData))
      }
    } catch (e) {
      console.error('保存缓存失败:', e)
    }
  }, [])

  /**
   * 清除缓存（发布新内容、点赞等操作后调用）
   */
  const clearCache = useCallback(() => {
    try {
      Taro.removeStorageSync(CACHE_KEYS.FEED)
      Taro.removeStorageSync(CACHE_KEYS.FEED_TIMESTAMP)
    } catch (e) {
      console.error('清除缓存失败:', e)
    }
  }, [])

  const loadFriendsAndRequests = useCallback(async (silent = false) => {
    if (!getAccessToken()) return
    if (!silent) setLoadingFriends(true)
    try {
      // 先清理可能存在的重复好友记录
      await friendCleanupDuplicates().catch(() => { })

      const [listRes, reqRes] = await Promise.all([
        friendGetList(),
        friendGetRequests()
      ])

      const friendsList = listRes.list || []
      const requestsList = reqRes.list || []

      setFriends(friendsList)
      setRequests(requestsList)

      // 保存到缓存
      saveToCache(undefined, friendsList, requestsList)

      // 更新刷新时间
      lastFriendsRefreshTime.current = Date.now()
    } catch (e) {
      if (!silent) {
        Taro.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
      }
    } finally {
      if (!silent) setLoadingFriends(false)
    }
  }, [saveToCache])

  /**
   * 刷新 Feed（静默或显示 loading）
   * @param silent 是否静默刷新（不显示 loading）
   * @param force 是否强制刷新（忽略时间间隔）
   */
  const refreshFeed = useCallback(async (silent = false, force = false) => {
    const now = Date.now()
    if (!force && now - lastFeedRefreshTime.current < CACHE_DURATION) {
      return
    }

    if (!silent) setLoadingFeed(true)

    try {
      const token = getAccessToken()
      // 已登录：好友 Feed；未登录：公共 Feed
      const res = token
        ? await communityGetFeed(undefined, 0, PAGE_SIZE, true, 5)
        : await communityGetPublicFeed(0, PAGE_SIZE, true, 5)
      const list = res.list || []

      list.forEach(item => {
        const tempCommentsKey = `temp_comments_${item.record.id}`
        try {
          Taro.removeStorageSync(tempCommentsKey)
        } catch (e) {
          console.error('清理临时评论缓存失败:', e)
        }
      })

      setFeedList(list)
      setOffset(list.length)
      setHasMore(res.has_more ?? list.length >= PAGE_SIZE)

      saveToCache(list)
      lastFeedRefreshTime.current = Date.now()
    } catch (e) {
      if (!silent) {
        Taro.showToast({ title: (e as Error).message || '刷新失败', icon: 'none' })
      }
    } finally {
      if (!silent) setLoadingFeed(false)
      setRefreshing(false)
      setShowSkeleton(false)
    }
  }, [saveToCache])

  const loadMoreFeed = useCallback(async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const token = getAccessToken()
      const res = token
        ? await communityGetFeed(undefined, offset, PAGE_SIZE, true, 5)
        : await communityGetPublicFeed(offset, PAGE_SIZE, true, 5)
      const list = res.list || []
      setFeedList(prev => [...prev, ...list])
      setOffset(prev => prev + list.length)
      setHasMore(res.has_more ?? list.length >= PAGE_SIZE)
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '加载更多失败', icon: 'none' })
    } finally {
      setLoadingMore(false)
    }
  }, [offset, hasMore, loadingMore])

  // ScrollView 自带下拉刷新（页面级下拉被内部 ScrollView 接管，需用 refresher）
  const handleRefresherRefresh = useCallback(() => {
    setRefreshing(true)
    const tasks: Promise<void>[] = [refreshFeed(false, true)]
    if (getAccessToken()) {
      tasks.push(loadFriendsAndRequests(false))
    }
    Promise.all(tasks)
  }, [loadFriendsAndRequests, refreshFeed])

  // 评论栏弹出后延迟聚焦，等滑入动画完成
  useEffect(() => {
    if (expandedCommentRecordId) {
      const t = setTimeout(() => setCommentInputFocus(true), 300)
      return () => clearTimeout(t)
    }
    setCommentInputFocus(false)
  }, [expandedCommentRecordId])

  // 获取固定页面高度
  useEffect(() => {
    try {
      const info = Taro.getSystemInfoSync()
      setPageHeight(info.windowHeight)
    } catch (e) {
      console.error('获取系统信息失败:', e)
    }
  }, [])

  useEffect(() => {
    setLoggedIn(!!getAccessToken())
    Taro.showShareMenu({
      withShareTicket: true,
      // @ts-ignore
      menus: ['shareAppMessage', 'shareTimeline']
    })
  }, [])

  useShareAppMessage(() => ({
    title: '食探 - 和好友一起健康饮食',
    path: '/pages/community/index'
  }))

  useShareTimeline(() => ({
    title: '食探 - 和好友一起健康饮食'
  }))

  // 每次页面显示时的智能加载策略（已登录 / 未登录均可）
  Taro.useDidShow(() => {
    const token = getAccessToken()
    setLoggedIn(!!token)

    // 已有数据（从其他页面返回）→ 保持当前列表
    if (feedList.length > 0) return

    // 1. 立即从缓存加载
    const hasCache = loadFromCache()

    // 2. 判断是否需要刷新
    const now = Date.now()
    const needRefreshFeed = now - lastFeedRefreshTime.current > CACHE_DURATION
    const needRefreshFriends = token && (
      friends.length === 0 || now - lastFriendsRefreshTime.current > CACHE_DURATION
    )

    if (needRefreshFeed || needRefreshFriends) {
      if (hasCache || !isFirstLoad) {
        if (needRefreshFeed) refreshFeed(true, false)
        if (needRefreshFriends) loadFriendsAndRequests(true)
      } else {
        setShowSkeleton(true)
        refreshFeed(false, true)
        if (token) loadFriendsAndRequests(false)
        setIsFirstLoad(false)
      }
    }
  })

  const handleSearchUser = async () => {
    const kw = searchKeyword.trim()
    if (!kw) {
      Taro.showToast({ title: '请输入昵称或手机号', icon: 'none' })
      return
    }
    setSearching(true)
    setSearchResults([])
    try {
      const params = searchType === 'telephone' ? { telephone: kw } : { nickname: kw }
      const res = await friendSearch(params)
      setSearchResults(res.list || [])
      if (!res.list?.length) Taro.showToast({ title: '未找到用户', icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '搜索失败', icon: 'none' })
    } finally {
      setSearching(false)
    }
  }

  const handleSendRequest = async (userId: string) => {
    setSendingId(userId)
    try {
      await friendSendRequest(userId)
      Taro.showToast({ title: '已发送好友请求', icon: 'success' })
      setSearchResults(prev => prev.filter(u => u.id !== userId))
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '发送失败', icon: 'none' })
    } finally {
      setSendingId(null)
    }
  }

  const handleRespondRequest = async (requestId: string, accept: boolean) => {
    try {
      await friendRespondRequest(requestId, accept ? 'accept' : 'reject')
      Taro.showToast({ title: accept ? '已添加好友' : '已拒绝', icon: 'success' })
      setRequests(prev => prev.filter(r => r.id !== requestId))
      if (accept) {
        // 清除缓存，强制刷新
        clearCache()
        loadFriendsAndRequests(false)
        refreshFeed(false, true)
      }
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '操作失败', icon: 'none' })
    }
  }

  const handleLike = async (item: CommunityFeedItem) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    // 乐观更新：立即更新 UI
    const newList = feedList.map(f =>
      f.record.id === item.record.id
        ? {
          ...f,
          liked: !f.liked,
          like_count: f.like_count + (f.liked ? -1 : 1)
        }
        : f
    )
    setFeedList(newList)

    // 更新缓存
    saveToCache(newList)

    try {
      if (item.liked) {
        await communityUnlike(item.record.id)
      } else {
        await communityLike(item.record.id)
      }
    } catch (e) {
      // 失败则回滚
      setFeedList(feedList)
      saveToCache(feedList)
      Taro.showToast({ title: (e as Error).message || '操作失败', icon: 'none' })
    }
  }

  /** 点击帖子查看详情（通过 URL 参数传递记录 ID，从数据库获取最新数据） */
  const handleViewDetail = (record: CommunityFeedItem['record']) => {
    if (!record.id) {
      Taro.showToast({ title: '记录 ID 缺失', icon: 'none' })
      return
    }
    try {
      Taro.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(record.id)}` })
    } catch (e) {
      Taro.showToast({ title: '打开详情失败', icon: 'none' })
    }
  }

  /** 暂存草稿的 key */
  const draftKey = (recordId: string) => `comment_draft_${recordId}`

  /** 关闭评论输入栏并暂存草稿 */
  const closeCommentModal = () => {
    if (expandedCommentRecordId == null) return
    if (commentContent.trim()) {
      try { Taro.setStorageSync(draftKey(expandedCommentRecordId), commentContent) } catch (_) {}
    }
    setExpandedCommentRecordId(null)
  }

  /** 点击评论：打开底部输入栏，同一帖再点则关闭 */
  const openCommentModal = (recordId: string) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (expandedCommentRecordId === recordId) {
      closeCommentModal()
      return
    }
    if (expandedCommentRecordId && commentContent.trim()) {
      try { Taro.setStorageSync(draftKey(expandedCommentRecordId), commentContent) } catch (_) {}
    }
    let draft = ''
    try { draft = Taro.getStorageSync(draftKey(recordId)) || '' } catch (_) {}
    setCommentContent(draft)
    setExpandedCommentRecordId(recordId)
  }

  const submitComment = async () => {
    if (!expandedCommentRecordId || !commentContent.trim()) return
    setCommentSubmitting(true)
    try {
      // 调用新接口，获取临时评论数据
      const { task_id, temp_comment } = await communityPostComment(expandedCommentRecordId, commentContent.trim())
      const localUserDisplay = getLocalUserDisplay()
      const displayTempComment = {
        ...temp_comment,
        nickname: temp_comment.nickname || localUserDisplay.nickname,
        avatar: temp_comment.avatar || localUserDisplay.avatar
      }

      // 立即将临时评论添加到当前记录的评论列表（乐观更新）
      const newList = feedList.map(item =>
        item.record.id === expandedCommentRecordId
          ? {
            ...item,
            comments: [displayTempComment, ...(item.comments || [])].slice(0, 5),
            comment_count: (item.comment_count || 0) + 1
          }
          : item
      )
      setFeedList(newList)

      // 将临时评论缓存到本地存储
      const tempCommentsKey = `temp_comments_${expandedCommentRecordId}`
      try {
        const existingTemp = Taro.getStorageSync(tempCommentsKey) || []
        existingTemp.push({ task_id, comment: displayTempComment, timestamp: Date.now() })
        Taro.setStorageSync(tempCommentsKey, existingTemp)
      } catch (e) {
        console.error('缓存临时评论失败:', e)
      }

      saveToCache(newList)

      try { Taro.removeStorageSync(draftKey(expandedCommentRecordId)) } catch (_) {}
      setCommentContent('')
      setExpandedCommentRecordId(null)
      Taro.showToast({ title: '评论成功', icon: 'success' })
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '发表失败', icon: 'none' })
    } finally {
      setCommentSubmitting(false)
    }
  }

  /**
   * 拍照识别：直接进入拍照分析流程（需先登录）
   */
  const handlePhotoAnalyze = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const imagePath = res.tempFilePaths[0]
        Taro.setStorageSync('analyzeImagePath', imagePath)
        Taro.navigateTo({ url: '/pages/analyze/index' })
      },
      fail: (err) => {
        if (err?.errMsg?.includes('cancel')) return
        console.error('选择图片失败:', err)
        Taro.showToast({ title: '选择图片失败', icon: 'none' })
      }
    })
  }

  const topics = [
    { id: 1, name: '#减脂成功经验' },
    { id: 2, name: '#增肌食谱分享' },
    { id: 3, name: '#运动打卡' },
    { id: 4, name: '#健康饮食' },
    { id: 5, name: '#数据记录' }
  ]

  return (
    <View
      className='community-page'
      style={pageHeight ? { height: `${pageHeight}px` } : undefined}
    >
      <View className='community-scroll-wrap'>
        <ScrollView
          id='community-main-scroll'
          className='community-scroll'
          scrollY
          showScrollbar={false}
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresherRefresh}
          refresherDefaultStyle='black'
          onScrollToLower={loadMoreFeed}
          lowerThreshold={100}
        >
          <View className='community-scroll-content'>
            <Divider className="refresh-divider">下拉刷新</Divider>
            <View className='page-header'>
              <Text className='page-title'>健康圈子</Text>
              <Text className='page-subtitle'>与好友一起分享健康饮食</Text>
            </View>

            {/* 好友区域（仅登录后显示） */}
            {loggedIn && (
              <View className='friends-section'>
                <View className='section-header'>
                  <Text className='section-title'>好友</Text>
                  <View className='header-actions'>
                    {requests.length > 0 && (
                      <View className='requests-badge' onClick={() => setShowRequests(true)}>
                        <Text className='requests-badge-text'>好友请求 ({requests.length})</Text>
                      </View>
                    )}
                    <View className='view-all-btn' onClick={() => setShowAddFriend(true)}>
                      <Text className='view-all-text'>添加好友</Text>
                      <Text className='arrow'>{'>'}</Text>
                    </View>
                  </View>
                </View>
                {loadingFriends ? (
                  <Text className='loading-text'>加载中...</Text>
                ) : friends.length === 0 ? (
                  <Text className='empty-text'>暂无好友，点击「添加好友」搜索昵称或手机号添加</Text>
                ) : (
                  <ScrollView
                    className='friends-list'
                    scrollX
                    enhanced
                    showScrollbar={false}
                  >
                    <View className='friends-list-inner'>
                      {friends.map((f) => (
                        <View key={f.id} className='friend-item'>
                          <View className='friend-avatar'>
                            {f.avatar ? (
                              <Image src={f.avatar} mode='aspectFill' className='friend-avatar-img' />
                            ) : (
                              <Text className='friend-avatar-placeholder'>👤</Text>
                            )}
                          </View>
                          <Text className='friend-name' numberOfLines={1}>{f.nickname || '用户'}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </View>
            )}

            {/* 未登录提示条 */}
            {!loggedIn && (
              <View className='login-tip'>
                <Text className='login-tip-text'>登录后可添加好友、点赞和评论</Text>
                <TaroifyButton
                  className='login-tip-btn'
                  shape="round"
                  style={{ background: 'linear-gradient(to right, #00bc7d 0%, #00bba7 100%)', border: 'none', color: '#fff' }}
                  onClick={() => Taro.navigateTo({ url: '/pages/login/index' })}
                >
                  去登录
                </TaroifyButton>
              </View>
            )}

            {/* 发现 */}
            <View className='my-circles-section'>
              <View className='section-header'>
                <Text className='section-title'>发现</Text>
              </View>
              <View className='circles-list'>
                <View
                  className='circle-card'
                  onClick={() => Taro.navigateTo({ url: '/pages/food-library/index' })}
                >
                  <Text className='circle-icon iconfont icon-shiwu' />
                  <Text className='circle-name'>公共食物库</Text>
                  <View className='circle-members'>
                    <Text className='member-count'>健康外卖推荐</Text>
                  </View>
                </View>
                <View
                  className='circle-card'
                  onClick={() => Taro.showToast({ title: '敬请期待', icon: 'none' })}
                >
                  <Text className='circle-icon iconfont icon-weibiaoti-_huabanfuben' />
                  <Text className='circle-name'>打卡排行榜</Text>
                  <View className='circle-members'>
                    <Text className='member-count'>本周活跃</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* 本周打卡排行榜 */}
            <View
              className='ranking-banner'
              onClick={() => Taro.showToast({ title: '敬请期待', icon: 'none' })}
            >
              <View className='ranking-content'>
                <View className='ranking-text'>
                  <Text className='ranking-title'>本周打卡排行榜</Text>
                  <Text className='ranking-subtitle'>看看谁是本周最活跃</Text>
                </View>
              </View>
              <Text className='ranking-arrow'>{'>'}</Text>
            </View>

            {/* 热门话题 */}
            <View className='topics-section'>
              <View className='section-header'>
                <View className='section-title-wrapper'>
                  <Text className='section-title-icon iconfont icon-shangzhang' />
                  <Text className='section-title'>热门话题</Text>
                </View>
              </View>
              <ScrollView className='topics-list-wrapper' scrollX enhanced showScrollbar={false}>
                <View className='topics-list'>
                  {topics.map((t) => (
                    <View key={t.id} className='topic-tag'>
                      <Text>{t.name}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* 饮食动态 */}
            <View className='feed-section'>
              <View className='section-header'>
                <Text className='section-title'>{loggedIn ? '好友饮食动态' : '饮食动态'}</Text>
              </View>
              {showSkeleton ? (
                <View className='skeleton-container'>
                  {[1, 2, 3].map(i => (
                    <View key={i} className='skeleton-feed-card'>
                      <View className='skeleton-feed-header'>
                        <View className='skeleton-avatar' />
                        <View className='skeleton-user-info'>
                          <View className='skeleton-line' style={{ width: '120rpx', height: '28rpx' }} />
                          <View className='skeleton-line' style={{ width: '200rpx', height: '24rpx', marginTop: '8rpx' }} />
                        </View>
                      </View>
                      <View className='skeleton-content'>
                        <View className='skeleton-line' style={{ width: '100%', height: '24rpx' }} />
                        <View className='skeleton-line' style={{ width: '80%', height: '24rpx', marginTop: '12rpx' }} />
                      </View>
                      <View className='skeleton-image' />
                      <View className='skeleton-meta'>
                        <View className='skeleton-line' style={{ width: '150rpx', height: '24rpx' }} />
                      </View>
                    </View>
                  ))}
                </View>
              ) : loadingFeed && feedList.length === 0 ? (
                <Text className='loading-text'>加载中...</Text>
              ) : feedList.length === 0 ? (
                <View className='feed-empty'>
                  <Text className='feed-empty-text'>
                    {loggedIn ? '暂无好友今日饮食动态，添加好友后这里会显示他们的记录' : '暂无动态'}
                  </Text>
                </View>
              ) : (
                <View className='feed-list'>
                  {feedList.map((item) => (
                    <View
                      key={item.record.id}
                      id={`feed-card-${item.record.id}`}
                      className='feed-card'
                      onClick={() => handleViewDetail(item.record)}
                    >
                      <View className='feed-header'>
                        <View className='user-avatar'>
                          {item.author.avatar ? (
                            <Image src={item.author.avatar} mode='aspectFill' className='user-avatar-img' />
                          ) : (
                            <Text className='user-avatar-placeholder'>👤</Text>
                          )}
                        </View>
                        <View className='user-info'>
                          <Text className='user-name'>{item.is_mine ? '我' : item.author.nickname}</Text>
                          <Text className='post-time'>
                            {MEAL_NAMES[item.record.meal_type] || item.record.meal_type} · {formatFeedTime(item.record.record_time)}
                          </Text>
                        </View>
                      </View>
                      {item.record.description && (
                        <Text className='feed-content'>{item.record.description}</Text>
                      )}
                      {item.record.image_path && (
                        <View className='feed-image'>
                          <Image
                            src={item.record.image_path}
                            mode='aspectFill'
                            className='feed-image-content'
                          />
                        </View>
                      )}
                      <View className='feed-meta'>
                        <Text className='feed-calorie'>
                          {Number(item.record.total_calories || 0).toFixed(0)} kcal
                        </Text>
                        <Text className='feed-macros'>
                          蛋白质 {Math.round(item.record.total_protein ?? 0)}g · 碳水 {Math.round(item.record.total_carbs ?? 0)}g · 脂肪 {Math.round(item.record.total_fat ?? 0)}g
                        </Text>
                      </View>
                      <View
                        className='feed-actions'
                        onClick={(e) => e.stopPropagation()}
                      >
                        <View
                          className='action-item'
                          onClick={() => handleLike(item)}
                        >
                          <Text
                            className={`action-icon iconfont icon-good ${item.liked ? 'liked' : ''}`}
                          />
                          <Text className='action-count'>{item.like_count}</Text>
                        </View>
                        <View
                          className='action-item'
                          onClick={() => openCommentModal(item.record.id)}
                        >
                          <Text className='action-icon iconfont icon-pinglun' />
                          <Text className='action-count'>评论</Text>
                        </View>
                      </View>
                      {/* 前 5 条评论 */}
                      {(item.comments?.length ?? 0) > 0 && (
                        <View className='feed-comments' onClick={(e) => e.stopPropagation()}>
                          {(item.comments || []).map((c) => (
                            <View key={c.id} className='feed-comment-item'>
                              <View className='comment-avatar'>
                                {c.avatar ? (
                                  <Image src={c.avatar} mode='aspectFill' className='comment-avatar-img' />
                                ) : (
                                  <Text className='comment-avatar-placeholder'>👤</Text>
                                )}
                              </View>
                              <View className='comment-body'>
                                <Text className='comment-text'>
                                  <Text className='comment-author'>{c.nickname || '用户'}</Text>
                                  <Text> {c.content}</Text>
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
              {/* 加载更多提示 */}
              {feedList.length > 0 && (
                <View className='load-more-wrapper'>
                  {loadingMore ? (
                    <View className='load-more-loading'>
                      <View className='loading-spinner'>
                        <View className='spinner-dot' />
                        <View className='spinner-dot' />
                        <View className='spinner-dot' />
                      </View>
                      <Text className='load-more-text'>正在加载</Text>
                    </View>
                  ) : hasMore ? (
                    <View className='load-more-idle'>
                      <View className='load-more-line' />
                      <Text className='load-more-text'>上拉加载更多</Text>
                      <View className='load-more-line' />
                    </View>
                  ) : (
                    <View className='load-more-end'>
                      <View className='load-more-line' />
                      <Text className='load-more-text'>已经到底啦</Text>
                      <View className='load-more-line' />
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* 底部评论输入栏：mask 和 bar 始终渲染，通过 CSS 切换可见性，避免 DOM 增删导致 ScrollView 重置 */}
      <View
        className={`comment-bottom-mask ${expandedCommentRecordId ? 'visible' : ''}`}
        onClick={closeCommentModal}
      />
      <View className={`comment-bottom-bar ${expandedCommentRecordId ? 'visible' : ''}`}>
        <Textarea
          className='comment-bottom-input'
          placeholder='说点什么...'
          placeholderClass='comment-bottom-placeholder'
          value={commentContent}
          onInput={(e) => setCommentContent(e.detail.value)}
          confirmType='send'
          onConfirm={submitComment}
          focus={commentInputFocus}
          autoHeight
          maxlength={500}
        />
        <View
          className={`comment-bottom-send ${(!commentContent.trim() || commentSubmitting) ? 'disabled' : ''}`}
          onClick={submitComment}
        >
          <Text>{commentSubmitting ? '...' : '发送'}</Text>
        </View>
      </View>

      {/* 添加好友弹窗 */}
      {showAddFriend && (
        <View className='modal-mask' onClick={() => setShowAddFriend(false)}>
          <View className='modal-box add-friend-modal' onClick={e => e.stopPropagation()}>
            <Text className='modal-title'>添加好友</Text>
            <View className='search-type-row'>
              <View
                className={`search-type-btn ${searchType === 'nickname' ? 'active' : ''}`}
                onClick={() => setSearchType('nickname')}
              >
                <Text>昵称</Text>
              </View>
              <View
                className={`search-type-btn ${searchType === 'telephone' ? 'active' : ''}`}
                onClick={() => setSearchType('telephone')}
              >
                <Text>手机号</Text>
              </View>
            </View>
            <View className='search-row'>
              <Input
                className='search-input'
                placeholder={searchType === 'nickname' ? '输入昵称搜索' : '输入手机号搜索'}
                value={searchKeyword}
                onInput={e => setSearchKeyword(e.detail.value)}
              />
              <Button className='search-btn' onClick={handleSearchUser} disabled={searching}>
                {searching ? '搜索中' : '搜索'}
              </Button>
            </View>
            <ScrollView className='search-results' scrollY>
              {searchResults.map((u) => (
                <View key={u.id} className='search-result-item'>
                  <View className='result-avatar'>
                    {u.avatar ? (
                      <Image src={u.avatar} mode='aspectFill' className='result-avatar-img' />
                    ) : (
                      <Text>👤</Text>
                    )}
                  </View>
                  <Text className='result-name'>{u.nickname || '用户'}</Text>
                  {u.is_friend ? (
                    <Text className='result-status-tag added'>已添加</Text>
                  ) : u.is_pending ? (
                    <Text className='result-status-tag pending'>已发送</Text>
                  ) : (
                    <Button
                      className='result-add-btn'
                      size='mini'
                      onClick={() => handleSendRequest(u.id)}
                      disabled={!!sendingId}
                    >
                      {sendingId === u.id ? '发送中' : '加好友'}
                    </Button>
                  )}
                </View>
              ))}
            </ScrollView>
            <Button className='modal-close-btn' onClick={() => setShowAddFriend(false)}>关闭</Button>
          </View>
        </View>
      )}

      {/* 收到的请求弹窗 */}
      {showRequests && (
        <View className='modal-mask' onClick={() => setShowRequests(false)}>
          <View className='modal-box requests-modal' onClick={e => e.stopPropagation()}>
            <Text className='modal-title'>好友请求</Text>
            <ScrollView className='requests-list' scrollY>
              {requests.map((r) => (
                <View key={r.id} className='request-item'>
                  <View className='request-avatar'>
                    {r.from_avatar ? (
                      <Image src={r.from_avatar} mode='aspectFill' className='request-avatar-img' />
                    ) : (
                      <Text>👤</Text>
                    )}
                  </View>
                  <Text className='request-name'>{r.from_nickname}</Text>
                  <View className='request-actions'>
                    <Button size='mini' className='request-reject' onClick={() => handleRespondRequest(r.id, false)}>拒绝</Button>
                    <Button size='mini' className='request-accept' onClick={() => handleRespondRequest(r.id, true)}>接受</Button>
                  </View>
                </View>
              ))}
            </ScrollView>
            <Button className='modal-close-btn' onClick={() => setShowRequests(false)}>关闭</Button>
          </View>
        </View>
      )}

      {/* 去记录一餐（记录后好友可在圈子看到） */}
      {loggedIn && (
        <View
          className='fab-button'
          onClick={handlePhotoAnalyze}
        >
          <View className='fab-icon'>
            <IconCamera size={48} color="#ffffff" />
          </View>
        </View>
      )}
    </View>
  )
}
