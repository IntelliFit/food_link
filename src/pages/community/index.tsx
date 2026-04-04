import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
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
  getPublicFoodLibraryList,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  communityLike,
  communityUnlike,
  communityGetComments,
  communityGetCommentTasks,
  communityGetNotifications,
  communityPostComment,
  communityGetCheckinLeaderboard,
  communityHideFeed,
  type FriendSearchUser,
  type FriendRequestItem,
  type FriendListItem,
  type CommunityFeedItem,
  type CommunityFeedSortBy,
  type CommunityAuthorScope,
  type FeedCommentItem,
  type CheckinLeaderboardItem,
  type PublicFoodLibraryItem,
  type MealType,
  type DietGoal
} from '../../utils/api'
import { Button as TaroifyButton, Divider } from '@taroify/core'
import '@taroify/core/button/style'
import '@taroify/core/divider/style'

import './index.scss'
import { withAuth } from '../../utils/withAuth'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const DIET_GOAL_NAMES: Record<string, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  maintain: '维持',
  none: '不限'
}

const FEED_SORT_OPTIONS: Array<{ value: CommunityFeedSortBy; label: string }> = [
  { value: 'recommended', label: '推荐' },
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '高赞' },
  { value: 'balanced', label: '均衡' },
]

const FEED_MEAL_OPTIONS: Array<{ value: MealType | 'all'; label: string }> = [
  { value: 'all', label: '全部餐次' },
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'afternoon_snack', label: '加餐' },
]

const FEED_GOAL_OPTIONS: Array<{ value: DietGoal | 'all'; label: string }> = [
  { value: 'all', label: '全部目标' },
  { value: 'fat_loss', label: '减脂' },
  { value: 'muscle_gain', label: '增肌' },
  { value: 'maintain', label: '维持' },
]

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

function formatLibraryLocation(item: PublicFoodLibraryItem): string {
  return (
    item.merchant_address
    || item.detail_address
    || [item.province, item.city, item.district].filter(Boolean).join(' ')
    || ''
  )
}

// 缓存键名常量
const CACHE_KEYS = {
  FEED: 'community_feed_cache',
  FRIENDS: 'community_friends_cache',
  REQUESTS: 'community_requests_cache',
  FEED_TIMESTAMP: 'community_feed_timestamp',
  FRIENDS_TIMESTAMP: 'community_friends_timestamp',
  FEED_FILTERS: 'community_feed_filters_v2',
  PRIORITY_AUTHORS: 'community_priority_authors_v1'
}

// 缓存有效期（5分钟）
const CACHE_DURATION = 5 * 60 * 1000
const TEMP_COMMENT_MAX_AGE_MS = 5 * 60 * 1000
const COMMENT_DEDUPE_WINDOW_MS = 10 * 60 * 1000
const COMMUNITY_NOTIFICATION_TARGET_STORAGE_KEY = 'community_notification_target_v1'
const COMMUNITY_NOTIFICATION_TARGET_MAX_AGE_MS = 10 * 60 * 1000

type PendingCommunityNotificationTarget = {
  recordId: string
  notificationType?: 'like_received' | 'comment_received' | 'reply_received' | 'comment_rejected' | ''
  commentId?: string | null
  parentCommentId?: string | null
  createdAt?: number
}

function clearPendingCommunityNotificationTarget() {
  try {
    Taro.removeStorageSync(COMMUNITY_NOTIFICATION_TARGET_STORAGE_KEY)
  } catch (e) {
    console.error('清除互动消息跳转目标失败:', e)
  }
}

function readPendingCommunityNotificationTarget(): PendingCommunityNotificationTarget | null {
  try {
    const raw = Taro.getStorageSync(COMMUNITY_NOTIFICATION_TARGET_STORAGE_KEY)
    if (!raw) return null

    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const recordId = typeof parsed?.recordId === 'string' ? parsed.recordId.trim() : ''
    if (!recordId) {
      clearPendingCommunityNotificationTarget()
      return null
    }

    const createdAt = Number(parsed?.createdAt)
    if (Number.isFinite(createdAt) && Date.now() - createdAt > COMMUNITY_NOTIFICATION_TARGET_MAX_AGE_MS) {
      clearPendingCommunityNotificationTarget()
      return null
    }

    return {
      recordId,
      notificationType: typeof parsed?.notificationType === 'string' ? parsed.notificationType.trim() as PendingCommunityNotificationTarget['notificationType'] : '',
      commentId: typeof parsed?.commentId === 'string' ? parsed.commentId.trim() : '',
      parentCommentId: typeof parsed?.parentCommentId === 'string' ? parsed.parentCommentId.trim() : '',
      createdAt: Number.isFinite(createdAt) ? createdAt : undefined
    }
  } catch (e) {
    console.error('读取互动消息跳转目标失败:', e)
    clearPendingCommunityNotificationTarget()
    return null
  }
}

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

function readPriorityAuthorIds(): string[] {
  try {
    const raw = Taro.getStorageSync(CACHE_KEYS.PRIORITY_AUTHORS)
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.map((id) => String(id || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

function savePriorityAuthorIds(ids: string[]) {
  try {
    Taro.setStorageSync(CACHE_KEYS.PRIORITY_AUTHORS, JSON.stringify(Array.from(new Set(ids.filter(Boolean)))))
  } catch (e) {
    console.error('保存特别关注失败:', e)
  }
}

function buildFeedQueryParams(
  sortBy: CommunityFeedSortBy,
  mealType: MealType | 'all',
  dietGoal: DietGoal | 'all',
  authorScope: CommunityAuthorScope,
  priorityAuthorIds: string[],
) {
  return {
    sort_by: sortBy,
    meal_type: mealType === 'all' ? undefined : mealType,
    diet_goal: dietGoal === 'all' ? undefined : dietGoal,
    author_scope: authorScope,
    priority_author_ids: authorScope === 'priority' ? priorityAuthorIds : undefined,
  }
}

function getLibraryRecommendParams(
  sortBy: CommunityFeedSortBy,
  dietGoal: DietGoal | 'all',
) {
  if (sortBy === 'balanced') {
    return { sort_by: 'balanced' as const }
  }
  if (sortBy === 'hot') {
    return { sort_by: 'hot' as const }
  }
  if (dietGoal === 'fat_loss') {
    return { sort_by: 'recommended' as const, suitable_for_fat_loss: true }
  }
  if (dietGoal === 'muscle_gain') {
    return { sort_by: 'high_protein' as const }
  }
  return { sort_by: 'recommended' as const }
}

function CommunityPage() {
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
  const [replyTargetComment, setReplyTargetComment] = useState<FeedCommentItem | null>(null)
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const [feedScrollIntoView, setFeedScrollIntoView] = useState('')

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

  /** 打卡榜预览（横幅内展示前三名，点开看完整榜） */
  const [lbPreviewTop, setLbPreviewTop] = useState<CheckinLeaderboardItem[]>([])
  const [lbPreviewMyRank, setLbPreviewMyRank] = useState<number | null>(null)
  /** 下拉刷新时横幅内显示加载态 */
  const [lbPreviewLoading, setLbPreviewLoading] = useState(false)
  /** 任意请求进行中（含静默），用于首次进入时骨架 */
  const [lbPreviewFetching, setLbPreviewFetching] = useState(false)
  const [libraryRecommendList, setLibraryRecommendList] = useState<PublicFoodLibraryItem[]>([])
  const [feedSortBy, setFeedSortBy] = useState<CommunityFeedSortBy>('recommended')
  const [feedMealType, setFeedMealType] = useState<MealType | 'all'>('all')
  const [feedDietGoal, setFeedDietGoal] = useState<DietGoal | 'all'>('all')
  const [feedAuthorScope, setFeedAuthorScope] = useState<CommunityAuthorScope>('all')
  const [priorityAuthorIds, setPriorityAuthorIds] = useState<string[]>([])
  const [feedSearchKeyword, setFeedSearchKeyword] = useState('')
  const pendingNotificationNavigationRef = useRef(false)
  const feedScrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextFilterRefreshRef = useRef(true)

  const loadCheckinPreview = useCallback(async (silent = true) => {
    if (!getAccessToken()) {
      setLbPreviewTop([])
      setLbPreviewMyRank(null)
      setLbPreviewFetching(false)
      return
    }
    if (!silent) setLbPreviewLoading(true)
    setLbPreviewFetching(true)
    try {
      const res = await communityGetCheckinLeaderboard()
      const list = res.list || []
      setLbPreviewTop(list.slice(0, 3))
      const me = list.find((r) => r.is_me)
      setLbPreviewMyRank(me ? me.rank : null)
    } catch {
      // 保留上次预览，避免请求失败时横幅突然变空
    } finally {
      setLbPreviewFetching(false)
      if (!silent) setLbPreviewLoading(false)
    }
  }, [])

  const loadLibraryRecommend = useCallback(async () => {
    if (!getAccessToken()) {
      setLibraryRecommendList([])
      return
    }
    try {
      const params = getLibraryRecommendParams(feedSortBy, feedDietGoal)
      const res = await getPublicFoodLibraryList({
        ...params,
        limit: 4
      })
      setLibraryRecommendList(res.list || [])
    } catch {
      // 保留上次推荐，避免页面闪空
    }
  }, [feedDietGoal, feedSortBy])

  const loadInteractionNotificationsBadge = useCallback(async () => {
    if (!getAccessToken()) {
      setUnreadNotificationCount(0)
      return
    }
    try {
      const res = await communityGetNotifications(20)
      setUnreadNotificationCount(res.unread_count || 0)
    } catch (e) {
      console.error('加载互动消息失败:', e)
    }
  }, [])

  /**
   * 从缓存加载数据（立即展示，无等待）
   */
  const loadFromCache = useCallback(() => {
    try {
      const cachedFeed = Taro.getStorageSync(CACHE_KEYS.FEED)
      const cachedFriends = Taro.getStorageSync(CACHE_KEYS.FRIENDS)
      const cachedRequests = Taro.getStorageSync(CACHE_KEYS.REQUESTS)
      const cachedFeedFilters = Taro.getStorageSync(CACHE_KEYS.FEED_FILTERS)

      let hasCache = false

      if (cachedFeedFilters) {
        try {
          const parsed = typeof cachedFeedFilters === 'string' ? JSON.parse(cachedFeedFilters) : cachedFeedFilters
          setFeedSortBy((parsed?.sortBy as CommunityFeedSortBy) || 'recommended')
          setFeedMealType((parsed?.mealType as MealType | 'all') || 'all')
          setFeedDietGoal((parsed?.dietGoal as DietGoal | 'all') || 'all')
          setFeedAuthorScope((parsed?.authorScope as CommunityAuthorScope) || 'all')
        } catch (e) {
          console.error('解析 Feed 筛选缓存失败:', e)
        }
      }

      setPriorityAuthorIds(readPriorityAuthorIds())

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
      Taro.setStorageSync(CACHE_KEYS.FEED_FILTERS, JSON.stringify({
        sortBy: feedSortBy,
        mealType: feedMealType,
        dietGoal: feedDietGoal,
        authorScope: feedAuthorScope,
      }))
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
  }, [feedAuthorScope, feedDietGoal, feedMealType, feedSortBy])

  const updateFeedItem = useCallback((recordId: string, updater: (item: CommunityFeedItem) => CommunityFeedItem) => {
    setFeedList((prev) => {
      const next = prev.map((item) => item.record.id === recordId ? updater(item) : item)
      saveToCache(next)
      return next
    })
  }, [saveToCache])

  const getTempCommentsKey = useCallback((recordId: string) => `temp_comments_${recordId}`, [])

  const mergeFeedTempComments = useCallback(async (list: CommunityFeedItem[], includeTaskState: boolean = false) => {
    if (!getAccessToken()) return list

    let taskMap = new Map<string, { status: string }>()
    if (includeTaskState) {
      try {
        const res = await communityGetCommentTasks(100)
        taskMap = new Map((res.list || []).map((task) => [task.id, { status: task.status }]))
      } catch (e) {
        console.error('获取评论任务状态失败:', e)
      }
    }

    return list.map((item) => {
      const tempCommentsKey = getTempCommentsKey(item.record.id)
      let cachedTemp: Array<{ task_id: string; comment: FeedCommentItem; timestamp: number }> = []
      try {
        const raw = Taro.getStorageSync(tempCommentsKey)
        cachedTemp = Array.isArray(raw) ? raw : []
      } catch (e) {
        console.error('读取临时评论缓存失败:', e)
      }

      const now = Date.now()
      const serverComments = item.comments || []
      const remainingTemp = cachedTemp.filter((entry) => {
        if (!entry || typeof entry.timestamp !== 'number') return false
        if (now - entry.timestamp > TEMP_COMMENT_MAX_AGE_MS) return false
        const taskStatus = taskMap.get(entry.task_id)?.status
        if (taskStatus === 'violated' || taskStatus === 'failed') return false

        const tTime = new Date(entry.comment.created_at).getTime()
        return !serverComments.some((serverComment) => {
          const scTime = new Date(serverComment.created_at).getTime()
          return (
            serverComment.user_id === entry.comment.user_id &&
            serverComment.content === entry.comment.content &&
            serverComment.parent_comment_id === entry.comment.parent_comment_id &&
            serverComment.reply_to_user_id === entry.comment.reply_to_user_id &&
            (Number.isNaN(tTime) || Number.isNaN(scTime) ? false : Math.abs(scTime - tTime) <= COMMENT_DEDUPE_WINDOW_MS)
          )
        })
      }).map((entry) => ({
        ...entry,
        comment: {
          ...entry.comment,
          _is_temp: true
        }
      }))

      try {
        if (remainingTemp.length > 0) {
          Taro.setStorageSync(tempCommentsKey, remainingTemp)
        } else {
          Taro.removeStorageSync(tempCommentsKey)
        }
      } catch (e) {
        console.error('更新临时评论缓存失败:', e)
      }

      return {
        ...item,
        comments: [...remainingTemp.map((entry) => entry.comment), ...serverComments],
        comment_count: Math.max(item.comment_count || 0, serverComments.length) + remainingTemp.length
      }
    })
  }, [getTempCommentsKey])

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
      setPriorityAuthorIds((prev) => {
        const allowed = prev.filter((id) => friendsList.some((friend) => friend.id === id))
        if (allowed.length !== prev.length) {
          savePriorityAuthorIds(allowed)
        }
        return allowed
      })

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
      const params = buildFeedQueryParams(
        feedSortBy,
        feedMealType,
        feedDietGoal,
        token ? feedAuthorScope : 'all',
        priorityAuthorIds,
      )
      // 已登录：好友 Feed；未登录：公共 Feed
      const res = token
        ? await communityGetFeed(undefined, 0, PAGE_SIZE, true, 5, params)
        : await communityGetPublicFeed(0, PAGE_SIZE, true, 5, params)
      const baseList = res.list || []
      const list = token ? await mergeFeedTempComments(baseList, true) : baseList

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
  }, [feedAuthorScope, feedDietGoal, feedMealType, feedSortBy, mergeFeedTempComments, priorityAuthorIds, saveToCache])

  const loadMoreFeed = useCallback(async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const token = getAccessToken()
      const params = buildFeedQueryParams(
        feedSortBy,
        feedMealType,
        feedDietGoal,
        token ? feedAuthorScope : 'all',
        priorityAuthorIds,
      )
      const res = token
        ? await communityGetFeed(undefined, offset, PAGE_SIZE, true, 5, params)
        : await communityGetPublicFeed(offset, PAGE_SIZE, true, 5, params)
      const baseList = res.list || []
      const list = token ? await mergeFeedTempComments(baseList, false) : baseList
      setFeedList(prev => [...prev, ...list])
      setOffset(prev => prev + list.length)
      setHasMore(res.has_more ?? list.length >= PAGE_SIZE)
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '加载更多失败', icon: 'none' })
    } finally {
      setLoadingMore(false)
    }
  }, [feedAuthorScope, feedDietGoal, feedMealType, feedSortBy, hasMore, loadingMore, mergeFeedTempComments, offset, priorityAuthorIds])

  // ScrollView 自带下拉刷新（页面级下拉被内部 ScrollView 接管，需用 refresher）
  const handleRefresherRefresh = useCallback(() => {
    setRefreshing(true)
    const tasks: Promise<void>[] = [refreshFeed(false, true)]
    if (getAccessToken()) {
      tasks.push(loadFriendsAndRequests(false))
      tasks.push(loadCheckinPreview(false))
      tasks.push(loadLibraryRecommend())
      tasks.push(loadInteractionNotificationsBadge())
    }
    Promise.all(tasks)
  }, [loadFriendsAndRequests, refreshFeed, loadCheckinPreview, loadLibraryRecommend, loadInteractionNotificationsBadge])

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
  }, [feedAuthorScope, feedDietGoal, feedMealType, feedSortBy])

  useEffect(() => () => {
    if (feedScrollResetTimerRef.current) {
      clearTimeout(feedScrollResetTimerRef.current)
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

  useEffect(() => {
    try {
      Taro.setStorageSync(CACHE_KEYS.FEED_FILTERS, JSON.stringify({
        sortBy: feedSortBy,
        mealType: feedMealType,
        dietGoal: feedDietGoal,
        authorScope: feedAuthorScope,
      }))
    } catch (e) {
      console.error('保存 Feed 筛选状态失败:', e)
    }
  }, [])

  useEffect(() => {
    if (skipNextFilterRefreshRef.current) {
      skipNextFilterRefreshRef.current = false
      return
    }
    clearCache()
    setFeedList([])
    setOffset(0)
    setHasMore(true)
    lastFeedRefreshTime.current = 0
    refreshFeed(false, true)
    if (loggedIn) {
      loadLibraryRecommend()
    }
  }, [
    clearCache,
    feedAuthorScope,
    feedDietGoal,
    feedMealType,
    feedSortBy,
    loadLibraryRecommend,
    loggedIn,
    priorityAuthorIds,
    refreshFeed,
  ])

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
    setPriorityAuthorIds((prev) => {
      const next = readPriorityAuthorIds()
      return prev.join('|') === next.join('|') ? prev : next
    })

    if (token) {
      loadCheckinPreview(true)
      loadLibraryRecommend()
      loadInteractionNotificationsBadge()
    } else {
      setLbPreviewTop([])
      setLbPreviewMyRank(null)
      setLibraryRecommendList([])
      setUnreadNotificationCount(0)
    }

    const now = Date.now()
    const needRefreshFriends = Boolean(
      token &&
        (friends.length === 0 || now - lastFriendsRefreshTime.current > CACHE_DURATION)
    )

    // 已有 Feed 时不再走下方冷启动，但仍需按需拉取好友（否则仅从缓存恢复 Feed 时会 early return，永远不请求 /api/friend/list）
    if (feedList.length > 0) {
      setIsFirstLoad(false)
      if (token) {
        mergeFeedTempComments(feedList, true)
          .then((merged) => {
            setFeedList(merged)
            saveToCache(merged)
          })
          .catch((e) => console.error('同步临时评论状态失败:', e))
      }
      if (needRefreshFriends) {
        loadFriendsAndRequests(true)
      }
      handlePendingNotificationNavigation()
      return
    }

    // 1. 立即从缓存加载
    const hasCache = loadFromCache()

    // 2. 判断是否需要刷新 Feed
    const needRefreshFeed = now - lastFeedRefreshTime.current > CACHE_DURATION

    if (needRefreshFeed || needRefreshFriends) {
      if (hasCache || !isFirstLoad) {
        if (hasCache) setIsFirstLoad(false)
        if (needRefreshFeed) refreshFeed(true, false)
        if (needRefreshFriends) loadFriendsAndRequests(true)
      } else {
        setShowSkeleton(true)
        refreshFeed(false, true)
        if (token) loadFriendsAndRequests(false)
        setIsFirstLoad(false)
      }
    }

    handlePendingNotificationNavigation()
  })

  const togglePriorityAuthor = useCallback((authorId: string) => {
    if (!authorId) return
    const already = priorityAuthorIds.includes(authorId)
    const next = already
      ? priorityAuthorIds.filter((id) => id !== authorId)
      : [...priorityAuthorIds, authorId]
    setPriorityAuthorIds(next)
    savePriorityAuthorIds(next)
    Taro.showToast({
      title: already ? '已取消特别关注' : '已设为特别关注',
      icon: 'none',
    })
  }, [priorityAuthorIds])

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
        loadCheckinPreview(true)
        loadLibraryRecommend()
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

  const handleHideFeed = async (item: CommunityFeedItem) => {
    if (!getAccessToken()) return
    Taro.showModal({
      title: '确认移除',
      content: '从圈子中移除这条动态？你的饮食记录不会被删除。',
      confirmText: '移除',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await communityHideFeed(item.record.id)
          const newList = feedList.filter(f => f.record.id !== item.record.id)
          setFeedList(newList)
          saveToCache(newList)
          Taro.showToast({ title: '已从圈子移除', icon: 'success' })
        } catch (e) {
          Taro.showToast({ title: (e as Error).message || '操作失败', icon: 'none' })
        }
      }
    })
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

  const openFoodLibrary = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.navigateTo({ url: '/pages/food-library/index' })
  }

  const handleLibraryLike = async (item: PublicFoodLibraryItem) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const previousList = libraryRecommendList
    const nextList = previousList.map((it) =>
      it.id === item.id
        ? {
          ...it,
          liked: !it.liked,
          like_count: it.liked ? Math.max(0, it.like_count - 1) : it.like_count + 1
        }
        : it
    )
    setLibraryRecommendList(nextList)

    try {
      if (item.liked) {
        await unlikePublicFoodLibraryItem(item.id)
      } else {
        await likePublicFoodLibraryItem(item.id)
      }
    } catch (e) {
      setLibraryRecommendList(previousList)
      Taro.showToast({ title: (e as Error).message || '操作失败', icon: 'none' })
    }
  }

  const recommendedLibraryItems = libraryRecommendList.slice(0, 3)
  const shouldInsertLibraryAfter = (feedIndex: number) => (feedIndex + 1) % 4 === 0

  const filteredFeedList = feedSearchKeyword.trim()
    ? feedList.filter((item) => {
      const kw = feedSearchKeyword.trim().toLowerCase()
      const desc = (item.record.description || '').toLowerCase()
      const author = (item.author.nickname || '').toLowerCase()
      return desc.includes(kw) || author.includes(kw)
    })
    : feedList

  const renderLibraryCard = (libItem: PublicFoodLibraryItem, key: string) => {
    const locationText = formatLibraryLocation(libItem)

    return (
      <View
        key={key}
        className='library-feed-card'
        onClick={() => Taro.navigateTo({ url: `/pages/food-library-detail/index?id=${libItem.id}` })}
      >
        <View className='library-feed-image-wrap'>
          {libItem.image_path ? (
            <Image className='library-feed-image' src={libItem.image_path} mode='aspectFill' />
          ) : (
            <View className='library-feed-image-placeholder'>暂无图片</View>
          )}
          {libItem.suitable_for_fat_loss ? (
            <Text className='library-feed-badge'>适合减脂</Text>
          ) : null}
        </View>
        <View className='library-feed-body'>
          <View className='library-feed-top'>
            <Text className='library-feed-eyebrow'>
              {libItem.recommend_reason ? `公共食物库推荐 · ${libItem.recommend_reason}` : '公共食物库推荐'}
            </Text>
            <Text className='library-feed-title' numberOfLines={1}>
              {libItem.food_name || libItem.description || '健康餐'}
            </Text>
            {libItem.description ? (
              <Text className='library-feed-desc' numberOfLines={2}>{libItem.description}</Text>
            ) : null}
          </View>

          {libItem.merchant_name ? (
            <View className='library-feed-line'>
              <Text className='library-feed-line-icon'>店</Text>
              <Text className='library-feed-line-text' numberOfLines={1}>{libItem.merchant_name}</Text>
            </View>
          ) : null}

          {locationText ? (
            <View className='library-feed-line'>
              <Text className='library-feed-line-icon'>址</Text>
              <Text className='library-feed-line-text' numberOfLines={1}>{locationText}</Text>
            </View>
          ) : null}

          <View className='library-feed-footer'>
            <View className='library-feed-metas'>
              <Text className='library-feed-calorie'>{Math.round(libItem.total_calories || 0)} kcal</Text>
              <Text className='library-feed-meta'>藏 {libItem.collection_count || 0}</Text>
            </View>
            <View
              className='library-feed-like'
              onClick={(e) => {
                e.stopPropagation()
                handleLibraryLike(libItem)
              }}
            >
              <Text className={`library-feed-like-icon iconfont icon-good ${libItem.liked ? 'liked' : ''}`} />
              <Text className='library-feed-like-text'>{libItem.like_count}</Text>
            </View>
          </View>
        </View>
      </View>
    )
  }

  /** 暂存草稿的 key */
  const draftKey = (recordId: string) => `comment_draft_${recordId}`

  /** 关闭评论输入栏并暂存草稿 */
  const closeCommentModal = () => {
    if (expandedCommentRecordId == null) return
    if (commentContent.trim()) {
      try { Taro.setStorageSync(draftKey(expandedCommentRecordId), commentContent) } catch (_) {}
    }
    setCommentInputFocus(false)
    setExpandedCommentRecordId(null)
    setReplyTargetComment(null)
  }

  /** 点击评论：打开底部输入栏，同一帖再点则关闭 */
  const openCommentModal = (recordId: string, replyComment?: FeedCommentItem | null) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (expandedCommentRecordId === recordId && !replyComment) {
      closeCommentModal()
      return
    }
    if (expandedCommentRecordId && commentContent.trim()) {
      try { Taro.setStorageSync(draftKey(expandedCommentRecordId), commentContent) } catch (_) {}
    }
    let draft = ''
    try { draft = Taro.getStorageSync(draftKey(recordId)) || '' } catch (_) {}
    setCommentInputFocus(false)
    setCommentContent(draft)
    setExpandedCommentRecordId(recordId)
    setReplyTargetComment(replyComment || null)
  }

  const scrollToFeedCard = useCallback((recordId: string) => {
    const nextTarget = `feed-card-${recordId}`
    setFeedScrollIntoView(nextTarget)
    if (feedScrollResetTimerRef.current) {
      clearTimeout(feedScrollResetTimerRef.current)
    }
    feedScrollResetTimerRef.current = setTimeout(() => {
      setFeedScrollIntoView((current) => current === nextTarget ? '' : current)
    }, 1200)
  }, [])

  const ensureFeedReadyForNotification = useCallback(async (
    recordId: string,
    targetCommentId?: string | null
  ): Promise<CommunityFeedItem | null> => {
    if (!getAccessToken()) return null

    let accumulated = [...feedList]
    let nextHasMore = hasMore

    const syncAccumulatedState = (nextList: CommunityFeedItem[], hasMoreValue: boolean) => {
      setFeedList(nextList)
      setOffset(nextList.length)
      setHasMore(hasMoreValue)
      saveToCache(nextList)
    }

    const fetchFeedPage = async (nextOffset: number) => {
      const res = await communityGetFeed(undefined, nextOffset, PAGE_SIZE, true, 5)
      const mergedPage = await mergeFeedTempComments(res.list || [], nextOffset === 0)
      return {
        list: mergedPage,
        hasMore: res.has_more ?? mergedPage.length >= PAGE_SIZE
      }
    }

    if (!accumulated.some((item) => item.record.id === recordId)) {
      if (accumulated.length === 0) {
        const firstPage = await fetchFeedPage(0)
        accumulated = firstPage.list
        nextHasMore = firstPage.hasMore
      }

      let nextOffset = accumulated.length
      while (!accumulated.some((item) => item.record.id === recordId) && nextHasMore) {
        const page = await fetchFeedPage(nextOffset)
        if (!page.list.length) {
          nextHasMore = false
          break
        }

        const existingIds = new Set(accumulated.map((item) => item.record.id))
        const dedupedPage = page.list.filter((item) => !existingIds.has(item.record.id))
        accumulated = [...accumulated, ...dedupedPage]
        nextHasMore = page.hasMore
        nextOffset = accumulated.length
      }

      syncAccumulatedState(accumulated, nextHasMore)
    }

    let targetItem = accumulated.find((item) => item.record.id === recordId) || null
    if (!targetItem) return null

    const previewComments = targetItem.comments || []
    const needLoadAllComments = Boolean(targetCommentId) || (targetItem.comment_count || 0) > previewComments.length
    if (!needLoadAllComments) {
      return targetItem
    }

    const res = await communityGetComments(recordId)
    const comments = res.list || []
    accumulated = await mergeFeedTempComments(
      accumulated.map((item) => item.record.id === recordId ? {
        ...item,
        comments,
        comment_count: Math.max(item.comment_count || 0, comments.length)
      } : item),
      true
    )
    syncAccumulatedState(accumulated, nextHasMore)
    targetItem = accumulated.find((item) => item.record.id === recordId) || null
    return targetItem
  }, [PAGE_SIZE, feedList, hasMore, mergeFeedTempComments, saveToCache])

  const handlePendingNotificationNavigation = useCallback(async () => {
    if (pendingNotificationNavigationRef.current) return

    const pendingTarget = readPendingCommunityNotificationTarget()
    if (!pendingTarget?.recordId) return

    clearPendingCommunityNotificationTarget()
    pendingNotificationNavigationRef.current = true
    try {
      const targetItem = await ensureFeedReadyForNotification(
        pendingTarget.recordId,
        pendingTarget.commentId
      )

      if (!targetItem) {
        Taro.showToast({ title: '未找到对应动态', icon: 'none' })
        return
      }

      scrollToFeedCard(pendingTarget.recordId)
      const shouldOpenReplyComposer = pendingTarget.notificationType === 'comment_received'
        || pendingTarget.notificationType === 'reply_received'
        || Boolean(pendingTarget.commentId || pendingTarget.parentCommentId)

      if (shouldOpenReplyComposer) {
        const replyTarget =
          (pendingTarget.commentId
            ? targetItem.comments?.find((comment) => comment.id === pendingTarget.commentId)
            : null)
          || (pendingTarget.parentCommentId
            ? targetItem.comments?.find((comment) => comment.id === pendingTarget.parentCommentId)
            : null)
          || null

        openCommentModal(pendingTarget.recordId, replyTarget)
      }
    } catch (e) {
      console.error('处理互动消息跳转失败:', e)
      Taro.showToast({ title: '打开评论区失败', icon: 'none' })
    } finally {
      pendingNotificationNavigationRef.current = false
    }
  }, [ensureFeedReadyForNotification, openCommentModal, scrollToFeedCard])

  const handleLoadAllComments = async (recordId: string) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      const res = await communityGetComments(recordId)
      const comments = res.list || []
      const mergedList = await mergeFeedTempComments(feedList.map((item) => item.record.id === recordId ? {
        ...item,
        comments,
        comment_count: Math.max(item.comment_count || 0, comments.length)
      } : item), true)
      setFeedList(mergedList)
      saveToCache(mergedList)
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '获取评论失败', icon: 'none' })
    }
  }

  const handleOpenNotifications = () => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: '/pages/interaction-notifications/index' })
  }

  const submitComment = async () => {
    if (!expandedCommentRecordId || !commentContent.trim()) return
    setCommentSubmitting(true)
    try {
      const { comment } = await communityPostComment(
        expandedCommentRecordId,
        commentContent.trim(),
        {
          parent_comment_id: replyTargetComment?.id,
          reply_to_user_id: replyTargetComment?.user_id
        }
      )
      const localUserDisplay = getLocalUserDisplay()
      const displayComment = {
        ...comment,
        reply_to_nickname: replyTargetComment?.nickname || comment.reply_to_nickname || '',
        nickname: comment.nickname || localUserDisplay.nickname,
        avatar: comment.avatar || localUserDisplay.avatar
      }

      const newList = feedList.map(item => {
        if (item.record.id !== expandedCommentRecordId) return item
        const currentComments = item.comments || []
        const nextComments = [...currentComments, displayComment]
        return {
          ...item,
          comments: nextComments.slice(-Math.max(5, nextComments.length)),
          comment_count: (item.comment_count || 0) + 1
        }
      })
      setFeedList(newList)

      saveToCache(newList)

      try { Taro.removeStorageSync(draftKey(expandedCommentRecordId)) } catch (_) {}
      setCommentContent('')
      setExpandedCommentRecordId(null)
      setReplyTargetComment(null)
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
      sizeType: ['compressed'],
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
          scrollIntoView={feedScrollIntoView || undefined}
          showScrollbar={false}
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresherRefresh}
          refresherDefaultStyle='black'
          onScrollToLower={loadMoreFeed}
          lowerThreshold={100}
        >
          <View className='community-scroll-content'>
            <Divider className='refresh-divider' />
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
                        <View className='view-all-btn notification-entry' onClick={handleOpenNotifications}>
                          <Text className='view-all-text'>
                            互动消息{unreadNotificationCount > 0 ? ` (${unreadNotificationCount})` : ''}
                          </Text>
                          <Text className='arrow'>{'>'}</Text>
                        </View>
                        <View className='view-all-btn' onClick={() => Taro.navigateTo({ url: '/pages/friends/index' })}>
                          <Text className='view-all-text'>好友管理</Text>
                          <Text className='arrow'>{'>'}</Text>
                        </View>
                        <View className='view-all-btn' onClick={() => setShowAddFriend(true)}>
                          <Text className='view-all-text'>添加好友</Text>
                          <Text className='arrow'>{'>'}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}

            {/* 未登录提示条 */}
            {!loggedIn && (
              <View className='login-tip'>
                <Text className='login-tip-text'>登录后可添加好友、点赞和评论</Text>
                <TaroifyButton
                  className='login-tip-btn'
                  shape='round'
                  style={{ background: 'linear-gradient(to right, #00bc7d 0%, #00bba7 100%)', border: 'none', color: '#fff' }}
                  onClick={() => Taro.navigateTo({ url: '/pages/login/index' })}
                >
                  去登录
                </TaroifyButton>
              </View>
            )}

            {/* 本周打卡排行榜（内嵌前三名预览） */}
            <View
              className='ranking-banner'
              onClick={() => {
                if (!getAccessToken()) {
                  Taro.navigateTo({ url: '/pages/login/index' })
                  return
                }
                Taro.navigateTo({ url: '/pages/checkin-leaderboard/index' })
              }}
            >
              <View className='ranking-content'>
                <View className='ranking-icon-wrap'>
                  <Text className='ranking-icon-emoji'>🏆</Text>
                </View>
                <View className='ranking-text-block'>
                  <View className='ranking-text'>
                    <Text className='ranking-title'>本周打卡排行榜</Text>
                    <Text className='ranking-subtitle'>看看谁是本周最活跃</Text>
                  </View>
                  {loggedIn ? (
                    <View className='ranking-preview'>
                      {(lbPreviewLoading || (lbPreviewFetching && lbPreviewTop.length === 0)) ? (
                        <View className='ranking-preview-skeleton'>
                          <View className='ranking-preview-sk-dot' />
                          <View className='ranking-preview-sk-dot' />
                          <View className='ranking-preview-sk-dot' />
                        </View>
                      ) : lbPreviewTop.length > 0 ? (
                        <>
                          <View className='ranking-preview-row'>
                            {lbPreviewTop.map((row) => (
                              <View key={row.user_id} className='ranking-preview-cell'>
                                <Text
                                  className={`ranking-preview-rank ${row.rank === 1 ? 'r1' : row.rank === 2 ? 'r2' : 'r3'}`}
                                >
                                  {row.rank}
                                </Text>
                                <View className='ranking-preview-avatar-wrap'>
                                  {row.avatar ? (
                                    <Image
                                      className='ranking-preview-avatar'
                                      src={row.avatar}
                                      mode='aspectFill'
                                    />
                                  ) : (
                                    <Text className='ranking-preview-avatar-fallback'>👤</Text>
                                  )}
                                </View>
                                <Text className='ranking-preview-name' numberOfLines={1}>
                                  {row.nickname}
                                </Text>
                                <Text className='ranking-preview-count'>{row.checkin_count}次</Text>
                              </View>
                            ))}
                          </View>
                          <Text className='ranking-preview-cta'>
                            {lbPreviewMyRank != null
                              ? lbPreviewMyRank > 3
                                ? `你当前第${lbPreviewMyRank}名 · 点我查看完整榜单`
                                : lbPreviewMyRank >= 1
                                  ? '你已进前三 · 点我查看完整榜单'
                                  : '点我查看完整榜单'
                              : '点我查看完整榜单'}
                          </Text>
                        </>
                      ) : (
                        <Text className='ranking-preview-placeholder'>暂无预览，下拉刷新试试</Text>
                      )}
                    </View>
                  ) : null}
                </View>
              </View>
              <Text className='ranking-arrow'>{'>'}</Text>
            </View>

            {/* 饮食动态 */}
            <View className='feed-section'>
              <View className='section-header feed-section-header'>
                <Text className='section-title'>{loggedIn ? '好友动态与推荐' : '饮食动态'}</Text>
                {loggedIn ? (
                  <Text className='feed-section-link' onClick={openFoodLibrary}>食物库</Text>
                ) : null}
              </View>
              <View className='feed-filter-panel'>
                <View className='feed-search-wrap'>
                  <View className='feed-search-icon-wrap'>
                    <Text className='feed-search-icon'>搜</Text>
                  </View>
                  <Input
                    className='feed-search-input'
                    placeholder='搜索动态内容或用户...'
                    placeholderClass='feed-search-placeholder'
                    value={feedSearchKeyword}
                    onInput={(e) => setFeedSearchKeyword(e.detail.value)}
                    confirmType='search'
                  />
                  {feedSearchKeyword ? (
                    <Text className='feed-search-clear' onClick={() => setFeedSearchKeyword('')}>清除</Text>
                  ) : null}
                </View>
                <View className='feed-filter-labeled-row'>
                  <Text className='feed-filter-label'>排序</Text>
                  <ScrollView className='feed-filter-chips-scroll' scrollX enhanced showScrollbar={false}>
                    <View className='feed-filter-row-inner'>
                      {FEED_SORT_OPTIONS.map((opt) => (
                        <View
                          key={opt.value}
                          className={`feed-filter-chip ${feedSortBy === opt.value ? 'active' : ''}`}
                          onClick={() => setFeedSortBy(opt.value)}
                        >
                          <Text className='feed-filter-chip-text'>{opt.label}</Text>
                        </View>
                      ))}
                      {loggedIn ? (
                        <View
                          className={`feed-filter-chip ${feedAuthorScope === 'priority' ? 'active' : ''}`}
                          onClick={() => setFeedAuthorScope(feedAuthorScope === 'priority' ? 'all' : 'priority')}
                        >
                          <Text className='feed-filter-chip-text'>
                            {feedAuthorScope === 'priority' ? '特别关注中' : '特别关注'}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </ScrollView>
                </View>
                <View className='feed-filter-labeled-row'>
                  <Text className='feed-filter-label'>餐次</Text>
                  <ScrollView className='feed-filter-chips-scroll' scrollX enhanced showScrollbar={false}>
                    <View className='feed-filter-row-inner'>
                      {FEED_MEAL_OPTIONS.map((opt) => (
                        <View
                          key={opt.value}
                          className={`feed-filter-chip ${feedMealType === opt.value ? 'active' : ''}`}
                          onClick={() => setFeedMealType(opt.value)}
                        >
                          <Text className='feed-filter-chip-text'>{opt.label}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
                <View className='feed-filter-labeled-row'>
                  <Text className='feed-filter-label'>目标</Text>
                  <ScrollView className='feed-filter-chips-scroll' scrollX enhanced showScrollbar={false}>
                    <View className='feed-filter-row-inner'>
                      {FEED_GOAL_OPTIONS.map((opt) => (
                        <View
                          key={opt.value}
                          className={`feed-filter-chip ${feedDietGoal === opt.value ? 'active' : ''}`}
                          onClick={() => setFeedDietGoal(opt.value)}
                        >
                          <Text className='feed-filter-chip-text'>{opt.label}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
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
                <View className='loading-spinner-md' />
              ) : filteredFeedList.length === 0 ? (
                feedSearchKeyword.trim() ? (
                  <View className='feed-empty'>
                    <Text className='feed-empty-text'>未找到匹配「{feedSearchKeyword.trim()}」的动态</Text>
                  </View>
                ) : recommendedLibraryItems.length > 0 ? (
                  <View className='feed-list'>
                    {recommendedLibraryItems.map((libItem, idx) => renderLibraryCard(libItem, `library-empty-${libItem.id}-${idx}`))}
                  </View>
                ) : (
                  <View className='feed-empty'>
                    <Text className='feed-empty-text'>
                      {loggedIn
                        ? (feedAuthorScope === 'priority'
                          ? '你还没有特别关注的人，先点好友头像设置吧'
                          : '暂无符合当前筛选条件的好友动态')
                        : '暂无符合当前筛选条件的动态'}
                    </Text>
                  </View>
                )
              ) : (
                <View className='feed-list'>
                  {filteredFeedList.map((item, index) => (
                    <View key={item.record.id}>
                      <View
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
                        {(item.recommend_reason || item.record.diet_goal) ? (
                          <View className='feed-tags'>
                            {item.recommend_reason ? (
                              <Text className='feed-tag highlight'>{item.recommend_reason}</Text>
                            ) : null}
                            {item.record.diet_goal && item.record.diet_goal !== 'none' ? (
                              <Text className='feed-tag'>{DIET_GOAL_NAMES[item.record.diet_goal] || item.record.diet_goal}</Text>
                            ) : null}
                          </View>
                        ) : null}
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
                          <Text className='action-count'>评论 {item.comment_count || 0}</Text>
                          </View>
                          {item.is_mine ? (
                            <View
                              className='action-item action-delete'
                              onClick={() => handleHideFeed(item)}
                            >
                              <Text className='action-icon action-delete-icon'>×</Text>
                              <Text className='action-count action-delete-text'>移除</Text>
                            </View>
                          ) : null}
                        </View>
                        {(item.comments?.length ?? 0) > 0 && (
                          <View className='feed-comments' onClick={(e) => e.stopPropagation()}>
                            {(item.comments || []).map((c) => (
                              <View
                                key={c.id}
                                className={`feed-comment-item ${c._is_temp ? 'is-temp' : ''} ${c.reply_to_user_id ? 'is-reply' : ''}`}
                                onClick={() => openCommentModal(item.record.id, c)}
                              >
                                <View className='comment-avatar'>
                                  {c.avatar ? (
                                    <Image src={c.avatar} mode='aspectFill' className='comment-avatar-img' />
                                  ) : (
                                    <Text className='comment-avatar-placeholder'>👤</Text>
                                  )}
                                </View>
                                <View className={`comment-body ${c.reply_to_user_id ? 'is-reply' : ''}`}>
                                  <View className='comment-meta-line'>
                                    <Text className='comment-author'>{c.nickname || '用户'}</Text>
                                    {c.reply_to_user_id ? (
                                      <>
                                        <Text className='comment-reply-arrow'>回复</Text>
                                        <Text className='comment-reply-target'>{c.reply_to_nickname || '用户'}</Text>
                                      </>
                                    ) : null}
                                  </View>
                                  <View className={`comment-content-bubble ${c.reply_to_user_id ? 'is-reply' : ''}`}>
                                    <Text className='comment-content-text'>{c.content}</Text>
                                  </View>
                                  {c._is_temp ? (
                                    <Text className='comment-status-badge'>审核中</Text>
                                  ) : null}
                                </View>
                              </View>
                            ))}
                            {(item.comment_count || 0) > (item.comments?.length || 0) ? (
                              <View className='feed-comments-more' onClick={() => handleLoadAllComments(item.record.id)}>
                                <Text className='feed-comments-more-text'>查看全部评论</Text>
                              </View>
                            ) : null}
                          </View>
                        )}
                      </View>
                      {shouldInsertLibraryAfter(index) ? (() => {
                        const libraryIndex = Math.floor((index + 1) / 4) - 1
                        const libraryItem = recommendedLibraryItems[libraryIndex]
                        return libraryItem
                          ? renderLibraryCard(libraryItem, `library-inline-${libraryItem.id}-${index}`)
                          : null
                      })() : null}
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
      <View
        className={`comment-bottom-bar ${expandedCommentRecordId ? 'visible' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {replyTargetComment ? (
          <View className='comment-reply-tip'>
            <Text className='comment-reply-tip-text'>正在回复 {replyTargetComment.nickname || '用户'}</Text>
            <Text className='comment-reply-tip-close' onClick={() => setReplyTargetComment(null)}>取消</Text>
          </View>
        ) : null}
        <View className='comment-bottom-main'>
          <Input
            className='comment-bottom-input'
            placeholder={replyTargetComment ? `回复 ${replyTargetComment.nickname || '用户'}...` : '说点什么...'}
            placeholderClass='comment-bottom-placeholder'
            value={commentContent}
            onInput={(e) => setCommentContent(e.detail.value)}
            confirmType='send'
            onConfirm={submitComment}
            focus={commentInputFocus}
            maxlength={500}
            cursorSpacing={24}
          />
          <View
            className={`comment-bottom-send ${(!commentContent.trim() || commentSubmitting) ? 'disabled' : ''}`}
            onClick={submitComment}
          >
            <Text>{commentSubmitting ? '...' : '发送'}</Text>
          </View>
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

    </View>
  )
}

export default withAuth(CommunityPage)