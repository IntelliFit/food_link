import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'

import {
  getAccessToken,
  friendSearch,
  friendSendRequest,
  friendGetRequests,
  friendGetList,
  friendCleanupDuplicates,
  communityGetFeed,
  communityGetPublicFeed,
  communityLike,
  communityUnlike,
  communityGetComments,
  communityGetFeedContext,
  communityGetCommentTasks,
  communityGetNotifications,
  communityPostComment,
  communityDeleteComment,
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
  type MealType,
  type DietGoal
} from '../../utils/api'
import { Button as TaroifyButton } from '@taroify/core'
import '@taroify/core/button/style'

import { IconTrendingUp } from '../../components/iconfont'

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { COMMUNITY_FEED_CHANGED_EVENT } from '../../utils/home-events'

/** 同一条动态、同一回复目标、同一内容在短窗口内视为重复点击 */
const COMMENT_SEND_DEBOUNCE_MS = 450
/** 发送后短锁，与签名防抖一起防止连点 */
const COMMENT_TAP_LOCK_MS = 320

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

/** 与首页一致的细线搜索图标（替代「搜」字） */
function FeedSearchGlyph() {
  return (
    <View className='feed-search-svg'>
      <svg viewBox='0 0 24 24' fill='none' style={{ width: '100%', height: '100%' }}>
        <circle cx='11' cy='11' r='7' stroke='#94a3b8' strokeWidth='2' />
        <path d='M20 20l-4.35-4.35' stroke='#94a3b8' strokeWidth='2' strokeLinecap='round' />
      </svg>
    </View>
  )
}

/** 当前列表中某条评论及其所有子回复的 id（用于删除） */
function buildCommentSubtreeIds(comments: FeedCommentItem[], rootId: string): Set<string> {
  const toRemove = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    if (toRemove.has(id)) continue
    toRemove.add(id)
    for (const c of comments) {
      if (String(c.parent_comment_id || '') === id) stack.push(c.id)
    }
  }
  return toRemove
}

function removeCommentSubtreeFromList(comments: FeedCommentItem[], rootId: string): FeedCommentItem[] {
  const toRemove = buildCommentSubtreeIds(comments, rootId)
  return comments.filter((c) => !toRemove.has(c.id))
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
  authorId?: string,
) {
  return {
    sort_by: sortBy,
    meal_type: mealType === 'all' ? undefined : mealType,
    diet_goal: dietGoal === 'all' ? undefined : dietGoal,
    author_scope: authorId ? 'all' : authorScope,
    priority_author_ids: authorId ? undefined : (authorScope === 'priority' ? priorityAuthorIds : undefined),
    author_id: authorId || undefined,
  }
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

  // 首次加载标志（用于判断是否显示骨架屏）
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(false)

  // 上次刷新时间（用于条件刷新）
  const lastFeedRefreshTime = useRef<number>(0)
  const lastFriendsRefreshTime = useRef<number>(0)

  // 评论：当前评论的 recordId、输入内容、提交中、延迟聚焦
  const [expandedCommentRecordId, setExpandedCommentRecordId] = useState<string | null>(null)
  const [commentContent, setCommentContent] = useState('')
  /** 后台发表评论中的请求数，用于发送按钮 spinner（不阻塞继续输入） */
  const [commentInFlightCount, setCommentInFlightCount] = useState(0)
  /** 短锁：与签名防抖一起防止连点 */
  const commentTapLockRef = useRef(false)
  /** 长按评论后忽略紧随其后的 tap，避免误触打开回复框 */
  const commentLongPressIgnoreRef = useRef(false)
  const [commentInputFocus, setCommentInputFocus] = useState(false)
  const [replyTargetComment, setReplyTargetComment] = useState<FeedCommentItem | null>(null)
  const lastCommentSubmitRef = useRef<{ signature: string; timestamp: number }>({
    signature: '',
    timestamp: 0
  })
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const [feedScrollIntoView, setFeedScrollIntoView] = useState('')
  /** 动态卡片内评论：超过 3 条时默认只展示 2 条，点此展开/收起（仿微信朋友圈） */
  const [feedCommentPreviewExpanded, setFeedCommentPreviewExpanded] = useState<Record<string, boolean>>({})

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
  /** 下拉刷新时横幅内显示加载态 */
  const [lbPreviewLoading, setLbPreviewLoading] = useState(false)
  /** 任意请求进行中（含静默），用于首次进入时骨架 */
  const [lbPreviewFetching, setLbPreviewFetching] = useState(false)
  const [feedSortBy, setFeedSortBy] = useState<CommunityFeedSortBy>('recommended')
  /** 动态筛选：漏斗展开后再显示排序/餐次/目标，避免占满一屏 */
  const [feedFilterExpanded, setFeedFilterExpanded] = useState(false)
  const [feedMealType, setFeedMealType] = useState<MealType | 'all'>('all')
  const [feedDietGoal, setFeedDietGoal] = useState<DietGoal | 'all'>('all')
  const [feedAuthorScope, setFeedAuthorScope] = useState<CommunityAuthorScope>('all')
  const [priorityAuthorIds, setPriorityAuthorIds] = useState<string[]>([])
  const [feedSearchKeyword, setFeedSearchKeyword] = useState('')
  /** 搜索框输入后，从好友列表匹配到的昵称好友 */
  const [feedSearchMatchedFriends, setFeedSearchMatchedFriends] = useState<FriendListItem[]>([])
  /** 当前按特定作者筛选的动态（搜索好友后点击选中） */
  const [feedSearchAuthorId, setFeedSearchAuthorId] = useState<string>('')
  const pendingNotificationNavigationRef = useRef(false)
  const feedScrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextFilterRefreshRef = useRef(true)

  const loadCheckinPreview = useCallback(async (silent = true) => {
    if (!getAccessToken()) {
      setLbPreviewTop([])
      setLbPreviewFetching(false)
      return
    }
    if (!silent) setLbPreviewLoading(true)
    setLbPreviewFetching(true)
    try {
      const res = await communityGetCheckinLeaderboard()
      const list = res.list || []
      setLbPreviewTop(list.slice(0, 3))
    } catch {
      // 保留上次预览，避免请求失败时横幅突然变空
    } finally {
      setLbPreviewFetching(false)
      if (!silent) setLbPreviewLoading(false)
    }
  }, [])

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
        // 乐观评论未落库，不写入缓存，避免冷启动出现幽灵评论
        const dataToCache = feedData.slice(0, 30).map((item) => {
          const comments = item.comments || []
          const pending = comments.filter((c) => c._is_pending)
          if (pending.length === 0) return item
          return {
            ...item,
            comments: comments.filter((c) => !c._is_pending),
            comment_count: Math.max(0, (item.comment_count || 0) - pending.length)
          }
        })
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
   * 仅同步「收到的待处理好友申请」列表（轻量），每次进入圈子页调用，
   * 避免好友页处理完后仍沿用 5 分钟缓存导致角标不消失。
   */
  const syncPendingFriendRequests = useCallback(async () => {
    if (!getAccessToken()) {
      setRequests([])
      return
    }
    try {
      const reqRes = await friendGetRequests()
      const requestsList = reqRes.list || []
      setRequests(requestsList)
      saveToCache(undefined, undefined, requestsList)
    } catch (e) {
      console.error('同步好友申请失败:', e)
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
        feedSearchAuthorId,
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
  }, [feedAuthorScope, feedDietGoal, feedMealType, feedSortBy, feedSearchAuthorId, mergeFeedTempComments, priorityAuthorIds, saveToCache])

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
        feedSearchAuthorId,
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
  }, [feedAuthorScope, feedDietGoal, feedMealType, feedSortBy, feedSearchAuthorId, hasMore, loadingMore, mergeFeedTempComments, offset, priorityAuthorIds])

  // ScrollView 自带下拉刷新（页面级下拉被内部 ScrollView 接管，需用 refresher）
  const handleRefresherRefresh = useCallback(() => {
    setRefreshing(true)
    const tasks: Promise<void>[] = [refreshFeed(false, true)]
    if (getAccessToken()) {
      tasks.push(loadFriendsAndRequests(false))
      tasks.push(loadCheckinPreview(false))
      tasks.push(loadInteractionNotificationsBadge())
    }
    Promise.all(tasks)
  }, [loadFriendsAndRequests, refreshFeed, loadCheckinPreview, loadInteractionNotificationsBadge])

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

  // 监听外部事件：饮食记录被删除后强制刷新 Feed
  useEffect(() => {
    const handleFeedChanged = () => {
      lastFeedRefreshTime.current = 0
      clearCache()
      setFeedList([])
      setOffset(0)
      setHasMore(true)
      refreshFeed(false, true)
    }
    Taro.eventCenter.on(COMMUNITY_FEED_CHANGED_EVENT, handleFeedChanged)
    return () => {
      Taro.eventCenter.off(COMMUNITY_FEED_CHANGED_EVENT, handleFeedChanged)
    }
  }, [clearCache, refreshFeed])

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
  }, [
    clearCache,
    feedAuthorScope,
    feedDietGoal,
    feedMealType,
    feedSortBy,
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
      loadInteractionNotificationsBadge()
      void syncPendingFriendRequests()
    } else {
      setLbPreviewTop([])
      setUnreadNotificationCount(0)
      setRequests([])
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

    // 1. 立即从缓存加载（先标记跳过 useEffect 刷新，避免 loadFromCache 设置状态后触发重复请求）
    skipNextFilterRefreshRef.current = true
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

  const handleSelectSearchFriend = (friend: FriendListItem) => {
    setFeedSearchAuthorId(friend.id)
    setFeedSearchMatchedFriends([])
    setFeedSearchKeyword(friend.nickname || '')
    setFeedList([])
    setOffset(0)
    setHasMore(true)
    refreshFeed(false, true)
  }

  const handleClearSearchAuthor = () => {
    setFeedSearchAuthorId('')
    setFeedSearchKeyword('')
    setFeedSearchMatchedFriends([])
    setFeedList([])
    setOffset(0)
    setHasMore(true)
    refreshFeed(false, true)
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

  /** 点击帖子图片/热量/营养进入识别记录详情 */
  const handleViewDetail = (record: CommunityFeedItem['record']) => {
    if (!record.id) {
      Taro.showToast({ title: '记录 ID 缺失', icon: 'none' })
      return
    }
    try {
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(record.id)}`
      })
    } catch (e) {
      Taro.showToast({ title: '打开详情失败', icon: 'none' })
    }
  }

  const openFoodLibrary = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    Taro.navigateTo({ url: extraPkgUrl('/pages/food-library/index') })
  }

  // 搜索框输入时，先从好友列表匹配昵称；点击好友后按 author_id 拉取该用户动态
  useEffect(() => {
    const kw = feedSearchKeyword.trim().toLowerCase()
    if (!kw) {
      setFeedSearchMatchedFriends([])
      if (feedSearchAuthorId) {
        setFeedSearchAuthorId('')
        refreshFeed(false, true)
      }
      return
    }
    const matched = friends.filter((f) => (f.nickname || '').toLowerCase().includes(kw))
    setFeedSearchMatchedFriends(matched)
  }, [feedSearchKeyword, friends])

  const filteredFeedList = feedSearchAuthorId
    ? feedList
    : (feedSearchKeyword.trim()
      ? feedList.filter((item) => {
        const kw = feedSearchKeyword.trim().toLowerCase()
        const desc = (item.record.description || '').toLowerCase()
        const author = (item.author.nickname || '').toLowerCase()
        return desc.includes(kw) || author.includes(kw)
      })
      : feedList)

  const feedFilterSummary = useMemo(() => {
    const sortLabel = FEED_SORT_OPTIONS.find(o => o.value === feedSortBy)?.label ?? ''
    const mealLabel = FEED_MEAL_OPTIONS.find(o => o.value === feedMealType)?.label ?? ''
    const goalLabel = FEED_GOAL_OPTIONS.find(o => o.value === feedDietGoal)?.label ?? ''
    const priority = loggedIn && feedAuthorScope === 'priority' ? '特别关注' : ''
    return [sortLabel, mealLabel, goalLabel, priority].filter(Boolean).join(' · ')
  }, [feedSortBy, feedMealType, feedDietGoal, feedAuthorScope, loggedIn])

  /** 筛选图标：展开面板或任一筛选项非默认时为主题色 */
  const feedFilterIconActive = useMemo(
    () =>
      feedFilterExpanded ||
      feedSortBy !== 'recommended' ||
      feedMealType !== 'all' ||
      feedDietGoal !== 'all' ||
      (loggedIn && feedAuthorScope === 'priority'),
    [feedFilterExpanded, feedSortBy, feedMealType, feedDietGoal, feedAuthorScope, loggedIn]
  )

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

  /** 仅写 storage，由 custom-tab-bar 轮询 updateHidden 隐藏底栏；勿调 showTabBar/hideTabBar（自定义 tabBar 下易双导航栏） */
  useEffect(() => {
    if (expandedCommentRecordId) {
      try {
        Taro.setStorageSync('community_comment_bar_visible', '1')
      } catch (_) {}
    } else {
      try {
        Taro.removeStorageSync('community_comment_bar_visible')
      } catch (_) {}
    }
  }, [expandedCommentRecordId])

  useEffect(() => {
    return () => {
      try {
        Taro.removeStorageSync('community_comment_bar_visible')
      } catch (_) {}
    }
  }, [])

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

    let targetItem = accumulated.find((item) => item.record.id === recordId) || null
    if (!targetItem) {
      const contextRes = await communityGetFeedContext(recordId, 5)
      const contextItem = contextRes.item
      if (!contextItem?.record?.id) return null

      const mergedContext = await mergeFeedTempComments([contextItem], true)
      targetItem = mergedContext[0] || null
      if (!targetItem) return null

      accumulated = [targetItem, ...accumulated.filter((item) => item.record.id !== recordId)]
      syncAccumulatedState(accumulated, nextHasMore)
    }

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
  }, [feedList, hasMore, mergeFeedTempComments, saveToCache])

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
      setFeedCommentPreviewExpanded((prev) => ({ ...prev, [recordId]: true }))
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '获取评论失败', icon: 'none' })
    }
  }

  const removeTempCommentFromStorage = useCallback((recordId: string, comment: FeedCommentItem) => {
    const key = getTempCommentsKey(recordId)
    try {
      const raw = Taro.getStorageSync(key)
      const cachedTemp: Array<{ task_id: string; comment: FeedCommentItem; timestamp: number }> = Array.isArray(raw) ? raw : []
      const filtered = cachedTemp.filter((entry) => entry?.comment?.id !== comment.id)
      if (filtered.length > 0) {
        Taro.setStorageSync(key, filtered)
      } else {
        Taro.removeStorageSync(key)
      }
    } catch (e) {
      console.error('更新临时评论缓存失败:', e)
    }
  }, [getTempCommentsKey])

  const handleRemoveCommentLocally = useCallback(
    (recordId: string, comment: FeedCommentItem) => {
      setFeedList((prev) => {
        const target = prev.find((i) => i.record.id === recordId)
        const comments = target?.comments || []
        const subtreeIds = buildCommentSubtreeIds(comments, comment.id)
        const nextComments = removeCommentSubtreeFromList(comments, comment.id)
        const removedCount = comments.length - nextComments.length
        const next = prev.map((it) => {
          if (it.record.id !== recordId) return it
          return {
            ...it,
            comments: nextComments,
            comment_count: Math.max(0, (it.comment_count || 0) - removedCount)
          }
        })
        saveToCache(next)
        queueMicrotask(() => {
          setReplyTargetComment((rt) => {
            if (!rt) return null
            if (expandedCommentRecordId !== recordId) return rt
            if (subtreeIds.has(rt.id)) return null
            return rt
          })
        })
        return next
      })
    },
    [saveToCache, expandedCommentRecordId]
  )

  const handleCommentLongPress = useCallback(
    (recordId: string, feedItem: CommunityFeedItem, comment: FeedCommentItem) => {
      commentLongPressIgnoreRef.current = true
      setTimeout(() => {
        commentLongPressIgnoreRef.current = false
      }, 420)
      if (!getAccessToken()) {
        Taro.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      const myUid = String(Taro.getStorageSync('user_id') || '')
      const canDelete = (Boolean(myUid) && comment.user_id === myUid) || Boolean(feedItem.is_mine)
      if (!canDelete) {
        return
      }
      void Taro.showModal({
        title: '删除评论',
        content: '删除后无法恢复',
        confirmText: '删除',
        cancelText: '取消'
      }).then((res) => {
        if (!res.confirm) return
        if (comment._is_pending || comment.id.startsWith('pending_')) {
          handleRemoveCommentLocally(recordId, comment)
          Taro.showToast({ title: '已删除', icon: 'success' })
          return
        }
        if (comment._is_temp) {
          removeTempCommentFromStorage(recordId, comment)
          handleRemoveCommentLocally(recordId, comment)
          Taro.showToast({ title: '已删除', icon: 'success' })
          return
        }
        Taro.showLoading({ title: '删除中...', mask: true })
        void communityDeleteComment(recordId, comment.id)
          .then(() => {
            handleRemoveCommentLocally(recordId, comment)
            Taro.showToast({ title: '已删除', icon: 'success' })
          })
          .catch((e: Error) => {
            Taro.showToast({ title: e.message || '删除失败', icon: 'none' })
          })
          .finally(() => {
            Taro.hideLoading()
          })
      })
    },
    [handleRemoveCommentLocally, removeTempCommentFromStorage]
  )

  const handleOpenNotifications = () => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: extraPkgUrl('/pages/interaction-notifications/index') })
  }

  const submitComment = async () => {
    if (!expandedCommentRecordId) return
    const trimmed = commentContent.trim()
    if (!trimmed) return

    const dedupeSig = `${expandedCommentRecordId}|${replyTargetComment?.id || ''}|${trimmed}`
    const now = Date.now()
    if (
      lastCommentSubmitRef.current.signature === dedupeSig &&
      now - lastCommentSubmitRef.current.timestamp < COMMENT_SEND_DEBOUNCE_MS
    ) {
      return
    }
    lastCommentSubmitRef.current = { signature: dedupeSig, timestamp: now }

    if (commentTapLockRef.current) return
    commentTapLockRef.current = true
    setTimeout(() => {
      commentTapLockRef.current = false
    }, COMMENT_TAP_LOCK_MS)

    const recordId = expandedCommentRecordId
    const replySnap = replyTargetComment
    const clientKey = `pending_${now}_${Math.random().toString(36).slice(2, 9)}`
    const uid = String(Taro.getStorageSync('user_id') || '')
    const localUserDisplay = getLocalUserDisplay()

    const optimistic: FeedCommentItem = {
      id: clientKey,
      user_id: uid || 'pending',
      record_id: recordId,
      parent_comment_id: replySnap?.id ?? null,
      reply_to_user_id: replySnap?.user_id ?? null,
      reply_to_nickname: replySnap?.nickname,
      content: trimmed,
      created_at: new Date().toISOString(),
      nickname: localUserDisplay.nickname,
      avatar: localUserDisplay.avatar,
      _is_pending: true
    }

    setFeedList((prev) => {
      const next = prev.map((item) => {
        if (item.record.id !== recordId) return item
        const currentComments = item.comments || []
        const nextComments = [...currentComments, optimistic]
        return {
          ...item,
          comments: nextComments.slice(-Math.max(5, nextComments.length)),
          comment_count: (item.comment_count || 0) + 1
        }
      })
      saveToCache(next)
      return next
    })

    try {
      Taro.removeStorageSync(draftKey(recordId))
    } catch (_) {}
    setCommentContent('')
    setReplyTargetComment(null)

    setCommentInFlightCount((c) => c + 1)
    try {
      const { comment } = await communityPostComment(recordId, trimmed, {
        parent_comment_id: replySnap?.id,
        reply_to_user_id: replySnap?.user_id
      })
      const displayComment: FeedCommentItem = {
        ...comment,
        reply_to_nickname: replySnap?.nickname || comment.reply_to_nickname || '',
        nickname: comment.nickname || localUserDisplay.nickname,
        avatar: comment.avatar || localUserDisplay.avatar,
        _is_pending: false
      }

      setFeedList((prev) => {
        const next = prev.map((item) => {
          if (item.record.id !== recordId) return item
          const comments = item.comments || []
          const idx = comments.findIndex((c) => c.id === clientKey)
          if (idx === -1) {
            if (comments.some((existing) => existing.id === displayComment.id)) {
              return item
            }
            const appended = [...comments, displayComment]
            return {
              ...item,
              comments: appended.slice(-Math.max(5, appended.length))
            }
          }
          const nextComments = [...comments]
          nextComments[idx] = displayComment
          return { ...item, comments: nextComments }
        })
        saveToCache(next)
        return next
      })
    } catch (e) {
      lastCommentSubmitRef.current = { signature: '', timestamp: 0 }
      setFeedList((prev) => {
        const next = prev.map((item) => {
          if (item.record.id !== recordId) return item
          const comments = (item.comments || []).filter((c) => c.id !== clientKey)
          return {
            ...item,
            comments,
            comment_count: Math.max(0, (item.comment_count || 0) - 1)
          }
        })
        saveToCache(next)
        return next
      })
      Taro.showToast({ title: (e as Error).message || '发表失败', icon: 'none' })
    } finally {
      setCommentInFlightCount((c) => Math.max(0, c - 1))
    }
  }

  /**
   * 拍照识别：直接进入拍照分析流程（需先登录）
   */
  const handlePhotoAnalyze = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const imagePath = res.tempFilePaths[0]
        Taro.setStorageSync('analyzeImagePath', imagePath)
        Taro.navigateTo({ url: extraPkgUrl('/pages/analyze/index') })
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
          <View
            className='community-scroll-content'
            onClick={() => {
              if (expandedCommentRecordId) closeCommentModal()
            }}
          >
            {/* 快捷入口：三键等分；有待处理申请时在「好友管理」右上角绝对定位角标（不占流），点击进入「收到的请求」 */}
            {loggedIn && (
              <View className='friends-quick-bar' onClick={(e) => e.stopPropagation()}>
                <View className='friends-quick-grid'>
                  <View className='friends-quick-cell' onClick={handleOpenNotifications}>
                    <Text className='friends-quick-cell-icon iconfont icon-pinglun' />
                    <Text className='friends-quick-cell-label'>互动消息</Text>
                    {unreadNotificationCount > 0 ? (
                      <View className='friends-quick-cell-badge'>
                        <Text className='friends-quick-cell-badge-text'>
                          {unreadNotificationCount > 99 ? '99+' : String(unreadNotificationCount)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View
                    className='friends-quick-cell'
                    onClick={() => {
                      const url =
                        requests.length > 0 ? `${extraPkgUrl('/pages/friends/index')}?tab=received` : extraPkgUrl('/pages/friends/index')
                      Taro.navigateTo({ url })
                    }}
                  >
                    <Text className='friends-quick-cell-icon iconfont icon-duoren' />
                    <Text className='friends-quick-cell-label'>好友管理</Text>
                    {requests.length > 0 ? (
                      <View className='friends-quick-cell-badge'>
                        <Text className='friends-quick-cell-badge-text'>
                          {requests.length > 99 ? '99+' : String(requests.length)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View className='friends-quick-cell' onClick={() => setShowAddFriend(true)}>
                    <Text className='friends-quick-cell-icon iconfont icon-zengji' />
                    <Text className='friends-quick-cell-label'>添加好友</Text>
                  </View>
                </View>
              </View>
            )}

            {/* 未登录提示条 */}
            {!loggedIn && (
              <View className='login-tip' onClick={(e) => e.stopPropagation()}>
                <Text className='login-tip-text'>登录后可添加好友、点赞和评论</Text>
                <TaroifyButton
                  className='login-tip-btn'
                  shape='round'
                  style={{ background: 'linear-gradient(to right, #00bc7d 0%, #00bba7 100%)', border: 'none', color: '#fff' }}
                  onClick={() => redirectToLogin()}
                >
                  去登录
                </TaroifyButton>
              </View>
            )}

            {/* 本周打卡排行榜：标题一行 + 前三名直接铺在绿底上，无内嵌浅底容器 */}
            <View
              className='ranking-banner'
              onClick={(e) => {
                e.stopPropagation()
                if (!getAccessToken()) {
                  redirectToLogin()
                  return
                }
                Taro.navigateTo({ url: extraPkgUrl('/pages/checkin-leaderboard/index') })
              }}
            >
              <View className='ranking-head'>
                <View className='ranking-icon-wrap'>
                  <IconTrendingUp size={36} color='rgb(255 255 255 / 95%)' />
                </View>
                <View className='ranking-head-text'>
                  <Text className='ranking-title'>本周打卡排行榜</Text>
                  <Text className='ranking-subtitle'>看看谁是本周最活跃</Text>
                </View>
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
                    <View className='ranking-preview-row'>
                      {lbPreviewTop.map((row) => (
                        <View
                          key={row.user_id}
                          className={`ranking-preview-cell${row.is_me ? ' is-me' : ''}`}
                        >
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
                              <View className='ranking-preview-avatar-fallback'>
                                <Text className='iconfont icon-duoren ranking-preview-avatar-ico' />
                              </View>
                            )}
                          </View>
                          <Text className='ranking-preview-name' numberOfLines={1}>
                            {row.nickname}
                          </Text>
                          <Text className='ranking-preview-count'>{row.checkin_count}次</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text className='ranking-preview-placeholder'>暂无预览，下拉刷新试试</Text>
                  )}
                </View>
              ) : null}
            </View>

            {/* 饮食动态 */}
            <View className='feed-section'>
              <View className='section-header feed-section-header'>
                <Text className='section-title feed-section-title'>{loggedIn ? '好友动态' : '饮食动态'}</Text>
                {loggedIn ? (
                  <Text
                    className='feed-section-link'
                    onClick={(e) => {
                      e.stopPropagation()
                      openFoodLibrary()
                    }}
                  >
                    食物库
                  </Text>
                ) : null}
              </View>
              <View className='feed-filter-panel' onClick={(e) => e.stopPropagation()}>
                <View className='feed-filter-top-row'>
                  <View className='feed-search-wrap'>
                    <View className='feed-search-icon-wrap'>
                      <FeedSearchGlyph />
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
                  <View
                    className='feed-filter-trigger-combined'
                    onClick={() => setFeedFilterExpanded((v) => !v)}
                  >
                    <View
                      className={`feed-filter-funnel-btn ${feedFilterExpanded ? 'is-open' : ''} ${feedFilterIconActive ? 'is-active' : ''}`}
                    >
                      <Text className='iconfont icon-filter-filling' />
                    </View>
                    <Text className='feed-filter-summary'>更多筛选</Text>
                  </View>
                </View>
                {feedFilterExpanded ? (
                  <View className='feed-filter-expanded'>
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
                ) : null}
              </View>
              {/* 搜索框输入后匹配到的好友列表 */}
              {feedSearchMatchedFriends.length > 0 && !feedSearchAuthorId && (
                <View className='feed-search-friends-panel'>
                  <View className='feed-search-friends-header'>
                    <Text className='feed-search-friends-title'>匹配到的好友</Text>
                    <Text className='feed-search-friends-clear' onClick={() => { setFeedSearchKeyword(''); setFeedSearchMatchedFriends([]); }}>清除</Text>
                  </View>
                  {feedSearchMatchedFriends.map((friend) => (
                    <View
                      key={friend.id}
                      className='feed-search-friend-item'
                      onClick={() => handleSelectSearchFriend(friend)}
                    >
                      <View className='feed-search-friend-avatar'>
                        {friend.avatar ? (
                          <Image src={friend.avatar} mode='aspectFill' className='feed-search-friend-avatar-img' />
                        ) : (
                          <Text className='feed-search-friend-avatar-placeholder'>👤</Text>
                        )}
                      </View>
                      <View className='feed-search-friend-info'>
                        <Text className='feed-search-friend-name'>{friend.nickname || '用户'}</Text>
                        <Text className='feed-search-friend-action'>查看动态</Text>
                      </View>
                      <Text className='iconfont icon-right-arrow feed-search-friend-arrow' />
                    </View>
                  ))}
                </View>
              )}
              {/* 已选中特定作者，显示顶部标签 */}
              {feedSearchAuthorId && (
                <View className='feed-search-author-bar'>
                  <Text className='feed-search-author-label'>正在查看：</Text>
                  <Text className='feed-search-author-name'>
                    {friends.find((f) => f.id === feedSearchAuthorId)?.nickname || '该用户'}
                  </Text>
                  <Text className='feed-search-author-clear' onClick={handleClearSearchAuthor}>清除筛选</Text>
                </View>
              )}
              {(showSkeleton || (loadingFeed && feedList.length === 0)) ? (
                <View className='skeleton-container' onClick={(e) => e.stopPropagation()}>
                  {[1, 2, 3].map(i => (
                    <View key={i} className='skeleton-feed-card'>
                      <View className='skeleton-feed-moments'>
                        <View className='skeleton-feed-avatar-col'>
                          <View className='skeleton-avatar' />
                        </View>
                        <View className='skeleton-feed-main-col'>
                          <View className='skeleton-user-info'>
                            <View className='skeleton-line' style={{ width: '160rpx', height: '32rpx' }} />
                            <View className='skeleton-line' style={{ width: '220rpx', height: '24rpx', marginTop: '8rpx' }} />
                          </View>
                      <View className='skeleton-content'>
                        <View className='skeleton-line' style={{ width: '100%', height: '24rpx' }} />
                        <View className='skeleton-line' style={{ width: '80%', height: '24rpx', marginTop: '12rpx' }} />
                      </View>
                      <View className='skeleton-image' />
                      <View className='skeleton-meta'>
                        <View className='skeleton-line skeleton-meta-pill' />
                        <View className='skeleton-line skeleton-meta-wide' />
                      </View>
                      <View className='skeleton-feed-actions'>
                        <View className='skeleton-line skeleton-action' />
                        <View className='skeleton-line skeleton-action' />
                      </View>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : filteredFeedList.length === 0 ? (
                feedSearchKeyword.trim() ? (
                  <View className='feed-empty'>
                    <Text className='feed-empty-text'>未找到匹配「{feedSearchKeyword.trim()}」的动态</Text>
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
                  {filteredFeedList.map((item) => (
                    <View key={item.record.id}>
                      <View
                        id={`feed-card-${item.record.id}`}
                        className={`feed-card${item.record.description?.trim() && !item.record.image_path ? ' feed-card-text-only' : ''}`}
                      >
                        <View className='feed-card-moments'>
                          <View className='feed-card-avatar-col'>
                            <View className='user-avatar'>
                              {item.author.avatar ? (
                                <Image src={item.author.avatar} mode='aspectFill' className='user-avatar-img' />
                              ) : (
                                <Text className='user-avatar-placeholder'>👤</Text>
                              )}
                            </View>
                          </View>
                          <View className='feed-card-main-col'>
                            <View className='feed-card-name-block'>
                              <Text className='user-name'>{item.is_mine ? '我' : item.author.nickname}</Text>
                              <View className='feed-sub-meta-row'>
                                <Text className='post-time'>
                                  {MEAL_NAMES[item.record.meal_type] || item.record.meal_type} · {formatFeedTime(item.record.record_time)}
                                </Text>
                                {item.record.diet_goal && item.record.diet_goal !== 'none' ? (
                                  <Text className='feed-tag-plain'>{DIET_GOAL_NAMES[item.record.diet_goal] || item.record.diet_goal}</Text>
                                ) : null}
                              </View>
                            </View>
                            {item.record.description &&
                              (item.record.image_path ? (
                                <Text className='feed-content'>{item.record.description}</Text>
                              ) : (
                                <View className='feed-content-wrap feed-content-wrap--text-only'>
                                  <Text className='feed-content'>{item.record.description}</Text>
                                </View>
                              ))}
                            {item.record.image_path && (
                              <View
                                className='feed-image feed-tap-to-detail'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleViewDetail(item.record)
                                }}
                              >
                                <Image
                                  src={item.record.image_path}
                                  mode='aspectFill'
                                  className='feed-image-content'
                                />
                              </View>
                            )}
                            <View className='feed-meta'>
                              <View
                                className='feed-calorie feed-tap-to-detail'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleViewDetail(item.record)
                                }}
                              >
                                <Text className='feed-calorie-num'>
                                  {Number(item.record.total_calories || 0).toFixed(0)}
                                </Text>
                                <Text className='feed-calorie-unit'> kcal</Text>
                              </View>
                              <View
                                className='feed-macros feed-tap-to-detail'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleViewDetail(item.record)
                                }}
                              >
                                <Text className='feed-macros-text'>
                                  蛋白质 {Math.round(item.record.total_protein ?? 0)}g · 碳水 {Math.round(item.record.total_carbs ?? 0)}g · 脂肪 {Math.round(item.record.total_fat ?? 0)}g
                                </Text>
                              </View>
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
                                className='action-item feed-action-comment'
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
                            {(item.comments?.length ?? 0) > 0 && (() => {
                              const list = item.comments || []
                              const rid = item.record.id
                              const isListExpanded = feedCommentPreviewExpanded[rid] === true
                              const shouldFoldList = list.length > 3 && !isListExpanded
                              const displayed = shouldFoldList ? list.slice(0, 2) : list
                              const foldedHiddenCount = shouldFoldList ? list.length - 2 : 0
                              return (
                              <View className='feed-comments' onClick={(e) => e.stopPropagation()}>
                                {displayed.map((c) => (
                                  <View
                                    key={c.id}
                                    className={`feed-comment-item ${c._is_temp ? 'is-temp' : ''} ${c._is_pending ? 'is-pending' : ''} ${c.reply_to_user_id ? 'is-reply' : ''}`}
                                    onLongPress={(e) => {
                                      e.stopPropagation()
                                      handleCommentLongPress(rid, item, c)
                                    }}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (commentLongPressIgnoreRef.current) {
                                        commentLongPressIgnoreRef.current = false
                                        return
                                      }
                                      openCommentModal(item.record.id, c)
                                    }}
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
                                          <View className='comment-reply-join'>
                                            <Text className='comment-reply-arrow'>回复</Text>
                                            <Text className='comment-reply-target'>{c.reply_to_nickname || '用户'}</Text>
                                          </View>
                                        ) : null}
                                      </View>
                                      <Text className='comment-content-text'>{c.content}</Text>
                                      {c._is_temp ? (
                                        <Text className='comment-status-badge'>审核中</Text>
                                      ) : null}
                                    </View>
                                  </View>
                                ))}
                                {foldedHiddenCount > 0 ? (
                                  <View
                                    className='feed-comments-expand-row'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setFeedCommentPreviewExpanded((prev) => ({ ...prev, [rid]: true }))
                                    }}
                                  >
                                    <Text className='feed-comments-expand-text'>
                                      展开 {foldedHiddenCount} 条评论
                                    </Text>
                                  </View>
                                ) : null}
                                {isListExpanded && list.length > 3 ? (
                                  <View
                                    className='feed-comments-expand-row feed-comments-collapse-row'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setFeedCommentPreviewExpanded((prev) => ({ ...prev, [rid]: false }))
                                    }}
                                  >
                                    <Text className='feed-comments-expand-text'>收起</Text>
                                  </View>
                                ) : null}
                                {(item.comment_count || 0) > (item.comments?.length || 0) ? (
                                  <View
                                    className='feed-comments-more'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleLoadAllComments(item.record.id)
                                    }}
                                  >
                                    <Text className='feed-comments-more-text'>查看全部评论</Text>
                                  </View>
                                ) : null}
                              </View>
                              )
                            })()}
                          </View>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              {/* 加载更多提示 */}
              {feedList.length > 0 && (
                <View className='load-more-wrapper' onClick={(e) => e.stopPropagation()}>
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

      {/* 底部评论输入栏：始终渲染，通过 CSS 切换可见性，避免 DOM 增删导致 ScrollView 重置 */}
      <View
        className={`comment-bottom-bar ${expandedCommentRecordId ? 'visible' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <View className='comment-bottom-main'>
          <Input
            className='comment-bottom-input'
            placeholder={replyTargetComment ? `回复 ${replyTargetComment.nickname || '用户'}...` : '说点什么...'}
            placeholderClass='comment-bottom-placeholder'
            value={commentContent}
            onInput={(e) => setCommentContent(e.detail.value)}
            confirmType='send'
            onConfirm={() => {
              void submitComment()
            }}
            focus={commentInputFocus}
            maxlength={500}
            cursorSpacing={24}
          />
          <View
            className={`comment-bottom-send ${!commentContent.trim() && commentInFlightCount === 0 ? 'disabled' : ''} ${commentInFlightCount > 0 ? 'is-submitting' : ''} ${commentContent.trim() ? 'is-ready' : ''}`}
            hoverClass='none'
            onClick={() => {
              void submitComment()
            }}
          >
            {commentInFlightCount > 0 ? (
              <View className='comment-bottom-send-spinner' />
            ) : (
              <Text className='iconfont icon-send comment-bottom-send-icon' />
            )}
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

    </View>
  )
}

export default withAuth(CommunityPage, { public: true })
