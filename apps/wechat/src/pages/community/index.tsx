import { View, Text, ScrollView, Image, Input, Button, Swiper, SwiperItem } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'

import {
  getAccessToken,
  friendSearch,
  friendBlockUser,
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
  getUnreadMessageCount,
  deleteCirclePost,
  deleteFoodRecord,
  deleteExerciseLog,
  deletePublicFoodLibraryItem,
  showUnifiedApiError,
  type FriendSearchUser,
  type FriendRequestItem,
  type FriendListItem,
  type CommunityFeedItem,
  type CommunityFeedSortBy,
  type CommunityAuthorScope,
  type CommunityFeedContentType,
  type CommunityFeedTargetType,
  type FeedCommentItem,
  type CheckinLeaderboardItem,
  type MealType,
  type DietGoal,
  type CommunityFeedRecord,
  normalizeCommunityFeedItem
} from '../../utils/api'
import {
  extractManualFoodDisplayItems,
  shouldRenderManualFoodCards
} from '../../utils/manual-food-source'
import { FeedReportMask } from './components/FeedReportMask'
import { ManualFoodCards } from './components/ManualFoodCards'
import { ExerciseActivityCards, hasExerciseActivityCards } from './components/ExerciseActivityCards'
import { FeedReportSheet } from './components/FeedReportSheet'
import { FeedActionSheet, type FeedActionSheetAction } from './components/FeedActionSheet'
import { Button as TaroifyButton } from '@taroify/core'
import '@taroify/core/button/style'

import { IconTrendingUp } from '../../components/iconfont'

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { COMMUNITY_FEED_CHANGED_EVENT } from '../../utils/home-events'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../utils/weapp-privacy'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'
import { FlPageThemeRoot } from '../../components/FlPageThemeRoot'
import { applyThemeNavigationBar } from '../../utils/theme-navigation-bar'
import { CommunityFoodRecordEditSheet } from './components/CommunityFoodRecordEditSheet'

/** 同一条动态、同一回复目标、同一内容在短窗口内视为重复点击 */
const COMMENT_SEND_DEBOUNCE_MS = 450
/** 发送后短锁，与签名防抖一起防止连点 */
const COMMENT_TAP_LOCK_MS = 320
const COMMUNITY_FILTER_DRAWER_VISIBLE_KEY = 'community_filter_drawer_visible'
const COLLAPSIBLE_FEED_TEXT_RUNE_THRESHOLD = 90

function shouldCollapseFeedText(value: string): boolean {
  return Array.from(String(value || '').trim()).length > COLLAPSIBLE_FEED_TEXT_RUNE_THRESHOLD
}

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
  { value: 'latest', label: '最新' },
  { value: 'recommended', label: '推荐' },
  { value: 'hot', label: '高赞' },
  { value: 'balanced', label: '均衡' },
]

const FEED_CONTENT_OPTIONS: Array<{ value: CommunityFeedContentType; label: string }> = [
  { value: 'all', label: '全部内容' },
  { value: 'food_record', label: '饮食' },
  { value: 'exercise_log', label: '运动' },
  { value: 'campus_food', label: '校园食堂' },
  { value: 'circle_post', label: '自定义' },
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

const CHINA_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000
const ISO_TIMEZONE_SUFFIX_RE = /(Z|[+-]\d{2}:?\d{2})$/i
const ISO_LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/

function parseFeedRecordTime(recordTime: string): Date | null {
  const raw = String(recordTime || '').trim()
  if (!raw) return null
  if (!ISO_TIMEZONE_SUFFIX_RE.test(raw)) {
    const localMatch = raw.match(ISO_LOCAL_DATETIME_RE)
    if (localMatch) {
      const [, y, mo, d, h, mi, s = '0'] = localMatch
      const utcMs = Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s)
      ) - CHINA_TIMEZONE_OFFSET_MS
      return new Date(utcMs)
    }
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getChinaTimeParts(date: Date) {
  const shifted = new Date(date.getTime() + CHINA_TIMEZONE_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

function formatChinaDateTime(date: Date): string {
  const p = getChinaTimeParts(date)
  const now = getChinaTimeParts(new Date())
  const timeText = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  if (p.year === now.year && p.month === now.month && p.day === now.day) {
    return `今天 ${timeText}`
  }
  if (p.year === now.year) {
    return `${p.month}月${p.day}日 ${timeText}`
  }
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${timeText}`
}

function formatFeedTime(recordTime: string): string {
  const d = parseFeedRecordTime(recordTime)
  if (!d) return recordTime ? recordTime.slice(0, 16).replace('T', ' ') : ''
  const diff = Date.now() - d.getTime()
  if (diff < 0 && diff > -60000) return '刚刚'
  if (diff >= 0 && diff < 60000) return '刚刚'
  if (diff >= 0 && diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff >= 0 && diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return formatChinaDateTime(d)
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
  FEED_FILTERS: 'community_feed_filters_v4',
  PRIORITY_AUTHORS: 'community_priority_authors_v1',
  FEED_SESSION_ID: 'community_feed_session_id_v1',
  FEED_CACHE_SESSION_ID: 'community_feed_cache_session_id_v1'
}

// 缓存有效期（5分钟）
const CACHE_DURATION = 5 * 60 * 1000
const TEMP_COMMENT_MAX_AGE_MS = 5 * 60 * 1000
const COMMENT_DEDUPE_WINDOW_MS = 10 * 60 * 1000
const COMMUNITY_NOTIFICATION_TARGET_STORAGE_KEY = 'community_notification_target_v1'
const COMMUNITY_NOTIFICATION_TARGET_MAX_AGE_MS = 10 * 60 * 1000

type PendingCommunityNotificationTarget = {
  recordId: string
  targetType?: CommunityFeedTargetType
  targetId?: string
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
      targetType: parsed?.targetType === 'exercise_log' ? 'exercise_log' : 'food_record',
      targetId: typeof parsed?.targetId === 'string' ? parsed.targetId.trim() : recordId,
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

function readCommunityFeedSessionId(): string {
  try {
    const existing = String(Taro.getStorageSync(CACHE_KEYS.FEED_SESSION_ID) || '').trim()
    if (existing) return existing
    const next = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    Taro.setStorageSync(CACHE_KEYS.FEED_SESSION_ID, next)
    return next
  } catch {
    return ''
  }
}

function isCommunityFeedCacheFromCurrentSession(): boolean {
  try {
    const currentSessionId = readCommunityFeedSessionId()
    const cachedSessionId = String(Taro.getStorageSync(CACHE_KEYS.FEED_CACHE_SESSION_ID) || '').trim()
    return Boolean(currentSessionId && cachedSessionId && currentSessionId === cachedSessionId)
  } catch {
    return false
  }
}

function buildFeedQueryParams(
  sortBy: CommunityFeedSortBy,
  contentType: CommunityFeedContentType,
  mealType: MealType | 'all',
  dietGoal: DietGoal | 'all',
  authorScope: CommunityAuthorScope,
  priorityAuthorIds: string[],
  authorId?: string,
) {
  return {
    sort_by: sortBy,
    content_type: contentType,
    meal_type: contentType === 'exercise_log' || contentType === 'campus_food' || mealType === 'all' ? undefined : mealType,
    diet_goal: contentType === 'exercise_log' || contentType === 'campus_food' || dietGoal === 'all' ? undefined : dietGoal,
    author_scope: authorId ? 'all' : authorScope,
    priority_author_ids: authorId ? undefined : (authorScope === 'priority' ? priorityAuthorIds : undefined),
    author_id: authorId || undefined,
  }
}

function buildFeedQueryKey(
  authed: boolean,
  params: ReturnType<typeof buildFeedQueryParams>
): string {
  return JSON.stringify({
    authed,
    sort_by: params.sort_by,
    content_type: params.content_type || 'all',
    meal_type: params.meal_type || '',
    diet_goal: params.diet_goal || '',
    author_scope: params.author_scope || '',
    author_id: params.author_id || '',
    priority_author_ids: params.priority_author_ids || [],
  })
}

function dedupeFeedItems(list: CommunityFeedItem[]): CommunityFeedItem[] {
  const seen = new Set<string>()
  const next: CommunityFeedItem[] = []
  for (const item of list) {
    const id = getFeedTargetKey(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push(item)
  }
  return next
}

function appendUniqueFeedItems(
  existing: CommunityFeedItem[],
  incoming: CommunityFeedItem[]
): { list: CommunityFeedItem[]; added: number } {
  const seen = new Set(existing.map(getFeedTargetKey).filter(Boolean))
  const unique = incoming.filter((item) => {
    const id = getFeedTargetKey(item)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
  return { list: [...existing, ...unique], added: unique.length }
}

function getFeedTargetType(item: CommunityFeedItem | null | undefined): CommunityFeedTargetType {
  return item?.target_type || item?.record?.feed_type || 'food_record'
}

function getFeedTargetId(item: CommunityFeedItem | null | undefined): string {
  return item?.target_id || item?.record?.id || ''
}

function getFeedTargetKey(item: CommunityFeedItem | null | undefined): string {
  const id = getFeedTargetId(item)
  if (!id) return ''
  return `${getFeedTargetType(item)}:${id}`
}

function isExerciseFeed(item: CommunityFeedItem | null | undefined): boolean {
  return getFeedTargetType(item) === 'exercise_log'
}

function isCampusFoodFeed(item: CommunityFeedItem | null | undefined): boolean {
  return getFeedTargetType(item) === 'campus_food'
}

function isCirclePostFeed(item: CommunityFeedItem | null | undefined): boolean {
  return getFeedTargetType(item) === 'circle_post'
}

function isCommunityFeedItem(value: CommunityFeedItem | CommunityFeedItem['record']): value is CommunityFeedItem {
  return value != null && typeof (value as CommunityFeedItem).record === 'object'
}

function CommunityPage() {
  const { scheme } = useAppColorScheme()
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken())

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
  }, [scheme])

  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [requests, setRequests] = useState<FriendRequestItem[]>([])
  const [feedList, setFeedList] = useState<CommunityFeedItem[]>([])
  const feedListRef = useRef<CommunityFeedItem[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddFriend, setShowAddFriend] = useState(false)

  // 首次加载标志（用于判断是否显示骨架屏）
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [feedInitialLoaded, setFeedInitialLoaded] = useState(false)

  // 上次刷新时间（用于条件刷新）
  const lastFeedRefreshTime = useRef<number>(0)
  const lastFriendsRefreshTime = useRef<number>(0)

  // 评论：当前评论的 recordId、输入内容、提交中、延迟聚焦
  const [expandedCommentRecordId, setExpandedCommentRecordId] = useState<string | null>(null)
  const [expandedCommentTargetType, setExpandedCommentTargetType] = useState<CommunityFeedTargetType>('food_record')
  const [commentContent, setCommentContent] = useState('')
  const commentContentRef = useRef('')
  const expandedCommentRecordIdRef = useRef<string | null>(null)
  const expandedCommentTargetTypeRef = useRef<CommunityFeedTargetType>('food_record')
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
  const [unreadMessageCount, setUnreadMessageCount] = useState(0)
  const [feedScrollIntoView, setFeedScrollIntoView] = useState('')
  /** 动态卡片内评论：超过 3 条时默认只展示 2 条，点此展开/收起（仿微信朋友圈） */
  const [feedCommentPreviewExpanded, setFeedCommentPreviewExpanded] = useState<Record<string, boolean>>({})
  const [hidingFeedIds, setHidingFeedIds] = useState<string[]>([])

  useEffect(() => {
    commentContentRef.current = commentContent
  }, [commentContent])

  useEffect(() => {
    expandedCommentRecordIdRef.current = expandedCommentRecordId
  }, [expandedCommentRecordId])

  useEffect(() => {
    expandedCommentTargetTypeRef.current = expandedCommentTargetType
  }, [expandedCommentTargetType])

  // 固定页面高度
  const [pageHeight, setPageHeight] = useState(0)

  // 分页状态
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
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
  const [feedSortBy, setFeedSortBy] = useState<CommunityFeedSortBy>('latest')
  const [feedContentType, setFeedContentType] = useState<CommunityFeedContentType>('all')
  /** 动态筛选：漏斗展开后再显示排序/餐次/目标，避免占满一屏 */
  const [feedFilterExpanded, setFeedFilterExpanded] = useState(false)
  const feedFilterExpandedRef = useRef(false)
  const [feedMealType, setFeedMealType] = useState<MealType | 'all'>('all')
  const [feedDietGoal, setFeedDietGoal] = useState<DietGoal | 'all'>('all')
  const [feedAuthorScope, setFeedAuthorScope] = useState<CommunityAuthorScope>('public')
  const [priorityAuthorIds, setPriorityAuthorIds] = useState<string[]>([])
  const [feedSearchKeyword, setFeedSearchKeyword] = useState('')
  /** 搜索框输入后，从好友列表匹配到的昵称好友 */
  const [feedSearchMatchedFriends, setFeedSearchMatchedFriends] = useState<FriendListItem[]>([])
  /** 当前按特定作者筛选的动态（搜索好友后点击选中） */
  const [feedSearchAuthorId, setFeedSearchAuthorId] = useState<string>('')
  /** 饮食记录圈子级编辑表单 */
  const [editSheetVisible, setEditSheetVisible] = useState(false)
  const [editSheetRecord, setEditSheetRecord] = useState<CommunityFeedRecord | null>(null)
  const [reportTarget, setReportTarget] = useState<{ targetType: CommunityFeedTargetType; targetId: string } | null>(null)
  const [feedActionSheet, setFeedActionSheet] = useState<{ item: CommunityFeedItem; mode: 'manage' | 'report' } | null>(null)
  const [reportMaskTarget, setReportMaskTarget] = useState<{ targetType: CommunityFeedTargetType; targetId: string } | null>(null)
  const [feedTextExpanded, setFeedTextExpanded] = useState<Record<string, boolean>>({})
  const [feedImageIndices, setFeedImageIndices] = useState<Record<string, number>>({})
  const pendingNotificationNavigationRef = useRef(false)
  const feedScrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextFilterRefreshRef = useRef(true)
  /** 避免 mergeFeedTempComments 在短时间内重复请求 comment-tasks */
  const commentTasksPromiseRef = useRef<Promise<Map<string, { status: string }>> | null>(null)
  /** 防止 refreshFeed 并发执行导致重复请求骨架屏闪烁 */
  const refreshFeedPendingRef = useRef(false)
  /** 同步分页锁：避免 onScroll 与 onScrollToLower 在同一帧重复发起相同 offset 请求 */
  const loadingMoreRef = useRef(false)
  /** 当前列表查询条件；旧查询回包不再允许写入新列表 */
  const feedQueryKeyRef = useRef('')
  /** 列表请求世代；刷新、筛选、删除会递增，挡住旧分页回包 */
  const feedRequestGenerationRef = useRef(0)
  /** 防止 useDidShow 在极短窗口内被触发两次（微信小程序 tab 切换偶发） */
  const useDidShowTsRef = useRef(0)
  /** ScrollView 触底事件在部分机型上不稳定，滚动兜底需要节流 */
  const scrollLoadMoreTsRef = useRef(0)

  useEffect(() => {
    feedListRef.current = feedList
  }, [feedList])

  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

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

  const loadUnreadMessageCount = useCallback(async () => {
    if (!getAccessToken()) {
      setUnreadMessageCount(0)
      return
    }
    try {
      const res = await getUnreadMessageCount()
      setUnreadMessageCount(res.count || 0)
    } catch (e) {
      console.error('加载私信未读数失败:', e)
    }
  }, [])

  /**
   * 从缓存加载数据（立即展示，无等待）
   */
  const loadFromCache = useCallback(() => {
    try {
      const feedCacheFromCurrentSession = isCommunityFeedCacheFromCurrentSession()
      const cachedFeed = Taro.getStorageSync(CACHE_KEYS.FEED)
      const cachedFriends = Taro.getStorageSync(CACHE_KEYS.FRIENDS)
      const cachedRequests = Taro.getStorageSync(CACHE_KEYS.REQUESTS)
      const cachedFeedFilters = Taro.getStorageSync(CACHE_KEYS.FEED_FILTERS)

      let hasCache = false

      if (cachedFeedFilters) {
        try {
          const parsed = typeof cachedFeedFilters === 'string' ? JSON.parse(cachedFeedFilters) : cachedFeedFilters
          setFeedSortBy((parsed?.sortBy as CommunityFeedSortBy) || 'latest')
          setFeedContentType((parsed?.contentType as CommunityFeedContentType) || 'all')
          setFeedMealType((parsed?.mealType as MealType | 'all') || 'all')
          setFeedDietGoal((parsed?.dietGoal as DietGoal | 'all') || 'all')
          setFeedAuthorScope((parsed?.authorScope as CommunityAuthorScope) || 'public')
        } catch (e) {
          console.error('解析 Feed 筛选缓存失败:', e)
        }
      }

      setPriorityAuthorIds(readPriorityAuthorIds())

      if (cachedFeed && feedCacheFromCurrentSession) {
        try {
          const parsed = JSON.parse(cachedFeed)
          if (Array.isArray(parsed) && parsed.length > 0) {
            const list = dedupeFeedItems(parsed)
            feedListRef.current = list
            offsetRef.current = list.length
            setFeedList(list)
            setOffset(list.length) // 同步更新 offset，确保后续 loadMore 正确
            setFeedInitialLoaded(true)
            hasCache = true
          }
        } catch (e) {
          console.error('解析 Feed 缓存失败:', e)
        }
      } else if (cachedFeed && !feedCacheFromCurrentSession) {
        try {
          Taro.removeStorageSync(CACHE_KEYS.FEED)
          Taro.removeStorageSync(CACHE_KEYS.FEED_TIMESTAMP)
          Taro.removeStorageSync(CACHE_KEYS.FEED_CACHE_SESSION_ID)
        } catch (_) {}
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
        const sessionId = readCommunityFeedSessionId()
        if (sessionId) Taro.setStorageSync(CACHE_KEYS.FEED_CACHE_SESSION_ID, sessionId)
      }
      Taro.setStorageSync(CACHE_KEYS.FEED_FILTERS, JSON.stringify({
        sortBy: feedSortBy,
        contentType: feedContentType,
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
      Taro.removeStorageSync(CACHE_KEYS.FEED_CACHE_SESSION_ID)
    } catch (e) {
      console.error('清除缓存失败:', e)
    }
  }, [feedAuthorScope, feedContentType, feedDietGoal, feedMealType, feedSortBy])

  const syncCurrentFeedQueryKey = useCallback(() => {
    const token = getAccessToken()
    const params = buildFeedQueryParams(
      feedSortBy,
      feedContentType,
      feedMealType,
      feedDietGoal,
      token ? feedAuthorScope : 'all',
      priorityAuthorIds,
      feedSearchAuthorId,
    )
    const key = buildFeedQueryKey(Boolean(token), params)
    feedQueryKeyRef.current = key
    return key
  }, [feedAuthorScope, feedContentType, feedDietGoal, feedMealType, feedSortBy, feedSearchAuthorId, priorityAuthorIds])

  const updateFeedItem = useCallback((recordId: string, updater: (item: CommunityFeedItem) => CommunityFeedItem, targetType: CommunityFeedTargetType = 'food_record') => {
    const targetKey = `${targetType}:${recordId}`
    setFeedList((prev) => {
      const next = prev.map((item) => getFeedTargetKey(item) === targetKey ? updater(item) : item)
      saveToCache(next)
      return next
    })
  }, [saveToCache])

  const getTempCommentsKey = useCallback((recordId: string, targetType: CommunityFeedTargetType = 'food_record') => `temp_comments_${targetType}_${recordId}`, [])

  const mergeFeedTempComments = useCallback(async (list: CommunityFeedItem[], includeTaskState: boolean = false) => {
    if (!getAccessToken()) return list

    let taskMap = new Map<string, { status: string }>()
    if (includeTaskState) {
      try {
        // 如果已有正在进行的 comment-tasks 请求，复用该 Promise，避免重复请求
        if (!commentTasksPromiseRef.current) {
          commentTasksPromiseRef.current = communityGetCommentTasks(100).then((res) => {
            const map = new Map((res.list || []).map((task) => [task.id, { status: task.status }]))
            return map
          }).finally(() => {
            commentTasksPromiseRef.current = null
          })
        }
        taskMap = await commentTasksPromiseRef.current
      } catch (e) {
        console.error('获取评论任务状态失败:', e)
      }
    }

    return list.map((item) => {
      const tempCommentsKey = getTempCommentsKey(getFeedTargetId(item), getFeedTargetType(item))
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
        await showUnifiedApiError(e, '加载失败')
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
    if (refreshFeedPendingRef.current && !force) {
      return
    }
    const now = Date.now()
    if (!force && now - lastFeedRefreshTime.current < CACHE_DURATION) {
      return
    }
    refreshFeedPendingRef.current = true

    if (!silent) setLoadingFeed(true)

    try {
      const token = getAccessToken()
      const params = buildFeedQueryParams(
        feedSortBy,
        feedContentType,
        feedMealType,
        feedDietGoal,
        token ? feedAuthorScope : 'all',
        priorityAuthorIds,
        feedSearchAuthorId,
      )
      const requestKey = buildFeedQueryKey(Boolean(token), params)
      feedQueryKeyRef.current = requestKey
      feedRequestGenerationRef.current += 1
      const requestGeneration = feedRequestGenerationRef.current
      loadingMoreRef.current = false
      // 登录后默认看公开广场，方便新用户与微信审核人员进入圈子就能看到内容；仅好友/特别关注仍走登录态 Feed。
      const res = token
        ? await communityGetFeed(undefined, 0, PAGE_SIZE, true, 5, params)
        : await communityGetPublicFeed(0, PAGE_SIZE, true, 5, params)
      const baseList = res.list || []
      const list = dedupeFeedItems(token ? await mergeFeedTempComments(baseList, true) : baseList).map(
        normalizeCommunityFeedItem
      )
      if (feedQueryKeyRef.current !== requestKey || feedRequestGenerationRef.current !== requestGeneration) return

      feedListRef.current = list
      offsetRef.current = list.length
      setFeedList(list)
      setOffset(list.length)
      setHasMore(res.has_more ?? list.length >= PAGE_SIZE)
      setFeedInitialLoaded(true)

      saveToCache(list)
      lastFeedRefreshTime.current = Date.now()
    } catch (e) {
      if (!silent) {
        await showUnifiedApiError(e, '刷新失败')
      }
    } finally {
      refreshFeedPendingRef.current = false
      if (!silent) setLoadingFeed(false)
      setRefreshing(false)
      setTimeout(() => setShowSkeleton(false), 0)
    }
  }, [feedAuthorScope, feedContentType, feedDietGoal, feedMealType, feedSortBy, feedSearchAuthorId, mergeFeedTempComments, priorityAuthorIds, saveToCache])

  const loadMoreFeed = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const requestedOffset = offsetRef.current
    const requestGeneration = feedRequestGenerationRef.current
    try {
      const token = getAccessToken()
      const params = buildFeedQueryParams(
        feedSortBy,
        feedContentType,
        feedMealType,
        feedDietGoal,
        token ? feedAuthorScope : 'all',
        priorityAuthorIds,
        feedSearchAuthorId,
      )
      const requestKey = buildFeedQueryKey(Boolean(token), params)
      if (!feedQueryKeyRef.current) {
        feedQueryKeyRef.current = requestKey
      }
      const res = token
        ? await communityGetFeed(undefined, requestedOffset, PAGE_SIZE, true, 5, params)
        : await communityGetPublicFeed(requestedOffset, PAGE_SIZE, true, 5, params)
      const baseList = res.list || []
      const list = dedupeFeedItems(token ? await mergeFeedTempComments(baseList, false) : baseList).map(
        normalizeCommunityFeedItem
      )
      if (
        feedQueryKeyRef.current !== requestKey ||
        feedRequestGenerationRef.current !== requestGeneration ||
        offsetRef.current !== requestedOffset
      ) {
        return
      }
      const merged = appendUniqueFeedItems(feedListRef.current, list)
      feedListRef.current = merged.list
      offsetRef.current = merged.list.length
      setFeedList(merged.list)
      setOffset(merged.list.length)
      setHasMore((res.has_more ?? list.length >= PAGE_SIZE) && merged.added > 0)
      saveToCache(merged.list)
    } catch (e) {
      await showUnifiedApiError(e, '加载更多失败')
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [feedAuthorScope, feedContentType, feedDietGoal, feedMealType, feedSortBy, feedSearchAuthorId, hasMore, mergeFeedTempComments, priorityAuthorIds, saveToCache])

  const handleCommunityScroll = useCallback((event) => {
    if (!hasMore || loadingMore) return
    const detail = event?.detail || {}
    const scrollTop = Number(detail.scrollTop)
    const scrollHeight = Number(detail.scrollHeight)
    if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || scrollHeight <= 0) {
      return
    }
    const viewportHeight = Math.max(pageHeight || 0, 1)
    const remaining = scrollHeight - scrollTop - viewportHeight
    if (remaining > 260) return

    const now = Date.now()
    if (now - scrollLoadMoreTsRef.current < 800) return
    scrollLoadMoreTsRef.current = now
    loadMoreFeed()
  }, [hasMore, loadMoreFeed, loadingMore, pageHeight])

  // ScrollView 自带下拉刷新（页面级下拉被内部 ScrollView 接管，需用 refresher）
  const handleRefresherRefresh = useCallback(() => {
    setRefreshing(true)
    const tasks: Promise<void>[] = [refreshFeed(false, true)]
    if (getAccessToken()) {
      tasks.push(loadFriendsAndRequests(false))
      tasks.push(loadCheckinPreview(false))
      tasks.push(loadInteractionNotificationsBadge())
      tasks.push(loadUnreadMessageCount())
    }
    Promise.all(tasks)
  }, [loadFriendsAndRequests, refreshFeed, loadCheckinPreview, loadInteractionNotificationsBadge, loadUnreadMessageCount])

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
  }, [feedAuthorScope, feedContentType, feedDietGoal, feedMealType, feedSortBy])

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
      feedRequestGenerationRef.current += 1
      syncCurrentFeedQueryKey()
      feedListRef.current = []
      offsetRef.current = 0
      setFeedInitialLoaded(false)
      setShowSkeleton(true)
      setFeedList([])
      setOffset(0)
      setHasMore(true)
      refreshFeed(false, true)
    }
    Taro.eventCenter.on(COMMUNITY_FEED_CHANGED_EVENT, handleFeedChanged)
    return () => {
      Taro.eventCenter.off(COMMUNITY_FEED_CHANGED_EVENT, handleFeedChanged)
    }
  }, [clearCache, refreshFeed, syncCurrentFeedQueryKey])

  useEffect(() => {
    try {
      Taro.setStorageSync(CACHE_KEYS.FEED_FILTERS, JSON.stringify({
        sortBy: feedSortBy,
        contentType: feedContentType,
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
    feedRequestGenerationRef.current += 1
    syncCurrentFeedQueryKey()
    feedListRef.current = []
    offsetRef.current = 0
    setFeedInitialLoaded(false)
    setShowSkeleton(true)
    setFeedList([])
    setOffset(0)
    setHasMore(true)
    lastFeedRefreshTime.current = 0
    refreshFeed(false, true)
  }, [
    clearCache,
    feedAuthorScope,
    feedContentType,
    feedDietGoal,
    feedMealType,
    feedSortBy,
    loggedIn,
    priorityAuthorIds,
    refreshFeed,
    syncCurrentFeedQueryKey,
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
    const didShowNow = Date.now()
    if (didShowNow - useDidShowTsRef.current < 500) {
      return
    }
    useDidShowTsRef.current = didShowNow

    try {
      if (!expandedCommentRecordIdRef.current) {
        Taro.removeStorageSync('community_comment_bar_visible')
      }
    } catch (_) {}
    try {
      if (!feedFilterExpandedRef.current) {
        Taro.removeStorageSync(COMMUNITY_FILTER_DRAWER_VISIBLE_KEY)
      }
    } catch (_) {}

    const token = getAccessToken()
    setLoggedIn(!!token)
    setPriorityAuthorIds((prev) => {
      const next = readPriorityAuthorIds()
      return prev.join('|') === next.join('|') ? prev : next
    })

    const now = Date.now()
    const needRefreshFriends = Boolean(
      token &&
        (friends.length === 0 || now - lastFriendsRefreshTime.current > CACHE_DURATION)
    )

    if (token) {
      // Feed 是首屏关键请求。排行榜、消息角标和好友申请稍后再拉，
      // 避免与 Feed/好友列表同时抢占后端仅 10 个数据库连接。
      setTimeout(() => {
        void loadCheckinPreview(true)
        void loadInteractionNotificationsBadge()
        void loadUnreadMessageCount()
        if (!needRefreshFriends) {
          void syncPendingFriendRequests()
        }
      }, 300)
    } else {
      setLbPreviewTop([])
      setUnreadNotificationCount(0)
      setUnreadMessageCount(0)
      setRequests([])
    }

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
      if (now - lastFeedRefreshTime.current > CACHE_DURATION) {
        refreshFeed(true, false)
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
      await showUnifiedApiError(e, '搜索失败')
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
      await showUnifiedApiError(e, '发送失败')
    } finally {
      setSendingId(null)
    }
  }

  const handleSelectSearchFriend = (friend: FriendListItem) => {
    setFeedSearchAuthorId(friend.id)
    setFeedSearchMatchedFriends([])
    setFeedSearchKeyword(friend.nickname || '')
    // 刷新交给 useEffect（依赖 refreshFeed → 依赖 feedSearchAuthorId）自动处理，
    // 避免此处直接调用 refreshFeed 时 feedSearchAuthorId 尚未更新导致 author_id 为空
  }

  const handleClearSearchAuthor = () => {
    setFeedSearchAuthorId('')
    setFeedSearchKeyword('')
    setFeedSearchMatchedFriends([])
    // 同上：由 useEffect 统一处理刷新，避免重复请求和 author_id 未同步
  }

  const handleFeedSearchConfirm = () => {
    Taro.navigateTo({
      url: extraPkgUrl('/pages/search-results/index?focus=1')
    })
  }

  const handlePublishPost = () => {
    if (!getAccessToken()) {
      redirectToLogin(extraPkgUrl('/pages/circle-post-edit/index'))
      return
    }
    Taro.navigateTo({ url: extraPkgUrl('/pages/circle-post-edit/index') })
  }

  const handleDeleteFeedItem = async (item: CommunityFeedItem) => {
    const targetType = getFeedTargetType(item)
    const targetId = getFeedTargetId(item)
    const { confirm } = await Taro.showModal({
      title: '确认删除',
      content: '删除后不可恢复，是否继续？',
      confirmText: '删除',
      confirmColor: '#ef4444'
    })
    if (!confirm) return
    try {
      if (targetType === 'circle_post') {
        await deleteCirclePost(targetId)
      } else if (targetType === 'food_record') {
        await deleteFoodRecord(targetId)
      } else if (targetType === 'exercise_log') {
        await deleteExerciseLog(targetId)
      } else if (targetType === 'campus_food') {
        await deletePublicFoodLibraryItem(targetId)
      }
      setFeedList((current) => {
        const next = current.filter((f) => getFeedTargetKey(f) !== getFeedTargetKey(item))
        saveToCache(next)
        return next
      })
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (e) {
      await showUnifiedApiError(e, '删除失败')
    }
  }

  const feedActionSheetActions = useMemo<FeedActionSheetAction[]>(() => {
    if (!feedActionSheet) return []
    if (feedActionSheet.mode === 'report') {
      return [
        { id: 'block-user', label: '拉黑用户', iconClass: 'icon-close', danger: true },
        { id: 'report', label: '举报', iconClass: 'icon-jinggao', danger: true },
      ]
    }
    const item = feedActionSheet.item
    const targetType = getFeedTargetType(item)
    const actions: FeedActionSheetAction[] = []
    if (targetType === 'circle_post' || targetType === 'food_record' || targetType === 'exercise_log' || targetType === 'campus_food') {
      actions.push({ id: 'edit', label: '编辑', iconClass: 'icon-edit', color: '#10b981' })
    }
    actions.push({ id: 'delete', label: '删除', iconClass: 'icon-shanchu', danger: true })
    return actions
  }, [feedActionSheet])

  const handleEditFeedItem = useCallback((item: CommunityFeedItem) => {
    const targetType = getFeedTargetType(item)
    const targetId = getFeedTargetId(item)
    if (targetType === 'circle_post') {
      Taro.navigateTo({ url: extraPkgUrl(`/pages/circle-post-edit/index?id=${encodeURIComponent(targetId)}`) })
    } else if (targetType === 'food_record') {
      setEditSheetRecord(item.record)
      setEditSheetVisible(true)
    } else if (targetType === 'exercise_log') {
      Taro.navigateTo({ url: extraPkgUrl(`/pages/exercise-record/index?log_id=${encodeURIComponent(targetId)}`) })
    } else if (targetType === 'campus_food') {
      Taro.navigateTo({ url: extraPkgUrl(`/pages/campus-food-share/index?item_id=${encodeURIComponent(targetId)}`) })
    }
  }, [])

  const handleBlockFeedAuthor = async (item: CommunityFeedItem) => {
    const authorId = item.author?.id || item.record?.user_id
    if (!authorId) return
    const ok = await Taro.showModal({
      title: '拉黑用户',
      content: `拉黑「${item.author?.nickname || '用户'}」后，双方无法私信、加好友，也不会在圈子里互相看到内容。`,
      confirmText: '拉黑',
      cancelText: '取消',
      confirmColor: '#ef4444'
    })
    if (!ok.confirm) return
    try {
      Taro.showLoading({ title: '处理中...', mask: true })
      await friendBlockUser(authorId)
      Taro.hideLoading()
      const next = feedList.filter((feed) => (feed.author?.id || feed.record?.user_id) !== authorId)
      setFeedList(next)
      saveToCache(next)
      Taro.showToast({ title: '已拉黑', icon: 'success' })
    } catch (e) {
      Taro.hideLoading()
      await showUnifiedApiError(e, '无法操作')
    }
  }

  const handleFeedActionSelect = (id: string) => {
    if (!feedActionSheet) return
    const { item, mode } = feedActionSheet
    if (mode === 'report') {
      if (id === 'block-user') {
        void handleBlockFeedAuthor(item)
        return
      }
      if (id === 'report') {
        setReportTarget({ targetType: getFeedTargetType(item), targetId: getFeedTargetId(item) })
      }
      return
    }
    if (id === 'edit') {
      handleEditFeedItem(feedActionSheet.item)
      return
    }
    if (id === 'delete') {
      void handleDeleteFeedItem(item)
    }
  }

  const handleLike = async (item: CommunityFeedItem) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const targetType = getFeedTargetType(item)
    const targetId = getFeedTargetId(item)
    const targetKey = getFeedTargetKey(item)

    // 乐观更新：立即更新 UI
    const newList = feedList.map(f =>
      getFeedTargetKey(f) === targetKey
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
        await communityUnlike(targetId, targetType)
      } else {
        await communityLike(targetId, targetType)
      }
    } catch (e) {
      // 失败则回滚
      setFeedList(feedList)
      saveToCache(feedList)
      await showUnifiedApiError(e, '操作失败')
    }
  }

  const handleHideFeed = async (item: CommunityFeedItem) => {
    if (!getAccessToken()) return
    const targetType = getFeedTargetType(item)
    const targetId = getFeedTargetId(item)
    const targetKey = getFeedTargetKey(item)
    if (hidingFeedIds.includes(targetKey)) return
    Taro.showModal({
      title: '删除动态',
      content: `从圈子中删除这条动态？你的${targetType === 'exercise_log' ? '运动记录' : targetType === 'campus_food' ? '校园食堂记录' : '饮食记录'}不会被删除。`,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        setHidingFeedIds((prev) => prev.includes(targetKey) ? prev : [...prev, targetKey])
        try {
          await communityHideFeed(targetId, targetType)
          setFeedList((prev) => {
            const next = prev.filter(f => getFeedTargetKey(f) !== targetKey)
            saveToCache(next)
            return next
          })
          clearCache()
          lastFeedRefreshTime.current = 0
          setOffset((prev) => Math.max(0, prev - 1))
          Taro.showToast({ title: '已从圈子删除', icon: 'success' })
        } catch (e) {
          await showUnifiedApiError(e, '操作失败')
        } finally {
          setHidingFeedIds((prev) => prev.filter((id) => id !== targetKey))
        }
      }
    })
  }

  /** 点击帖子图片/热量/营养进入识别记录详情 */
  const handleViewDetail = (itemOrRecord: CommunityFeedItem | CommunityFeedItem['record']) => {
    let record: CommunityFeedItem['record']
    let targetType: CommunityFeedTargetType = 'food_record'
    let targetId = ''
    if (isCommunityFeedItem(itemOrRecord)) {
      record = itemOrRecord.record
      targetType = getFeedTargetType(itemOrRecord)
      targetId = getFeedTargetId(itemOrRecord)
    } else {
      record = itemOrRecord
      targetType = (record.feed_type || 'food_record') as CommunityFeedTargetType
      targetId = record.id
    }
    if (!record.id) {
      Taro.showToast({ title: '记录 ID 缺失', icon: 'none' })
      return
    }
    const query = [
      `targetType=${encodeURIComponent(targetType)}`,
      `targetId=${encodeURIComponent(targetId)}`,
      `recordId=${encodeURIComponent(record.id)}`
    ].join('&')
    try {
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/interaction-feed-detail/index')}?${query}`
      })
    } catch (e) {
      void showUnifiedApiError(e, '打开详情失败')
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
        // 不直接调用 refreshFeed，由 useEffect（依赖 refreshFeed → 依赖 feedSearchAuthorId）统一处理
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
        const exerciseText = [
          item.record.exercise_desc,
          item.record.exercise_type,
          item.record.ai_reasoning
        ].filter(Boolean).join(' ').toLowerCase()
        const author = (item.author.nickname || '').toLowerCase()
        return desc.includes(kw) || exerciseText.includes(kw) || author.includes(kw)
      })
      : feedList)

  const toggleFeedTextExpanded = useCallback((key: string): void => {
    setFeedTextExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const renderCollapsibleFeedText = useCallback((key: string, text: string, className = 'feed-content') => {
    const expandable = shouldCollapseFeedText(text)
    const collapsed = expandable && !feedTextExpanded[key]
    return (
      <View className={`feed-collapsible-text ${collapsed ? 'is-collapsed' : ''}`}>
        <Text className={className}>{text}</Text>
        {expandable ? (
          <View
            className='feed-text-toggle'
            onClick={(e) => {
              e.stopPropagation()
              toggleFeedTextExpanded(key)
            }}
          >
            <Text className='feed-text-toggle-text'>{collapsed ? '展开' : '收起'}</Text>
          </View>
        ) : null}
      </View>
    )
  }, [feedTextExpanded, toggleFeedTextExpanded])

  const feedFilterSummary = useMemo(() => {
    const sortLabel = FEED_SORT_OPTIONS.find(o => o.value === feedSortBy)?.label ?? ''
    const contentLabel = FEED_CONTENT_OPTIONS.find(o => o.value === feedContentType)?.label ?? ''
    const mealLabel = FEED_MEAL_OPTIONS.find(o => o.value === feedMealType)?.label ?? ''
    const goalLabel = FEED_GOAL_OPTIONS.find(o => o.value === feedDietGoal)?.label ?? ''
    const scopeLabel = loggedIn
      ? (feedAuthorScope === 'priority' ? '特别关注' : feedAuthorScope === 'all' ? '仅好友' : '全部公开')
      : ''
    return [sortLabel, contentLabel, mealLabel, goalLabel, scopeLabel].filter(Boolean).join(' · ')
  }, [feedSortBy, feedContentType, feedMealType, feedDietGoal, feedAuthorScope, loggedIn])

  /** 筛选图标：展开面板或任一筛选项非默认时为主题色 */
  const feedFilterIconActive = useMemo(
    () =>
      feedFilterExpanded ||
      feedSortBy !== 'latest' ||
      feedContentType !== 'all' ||
      feedMealType !== 'all' ||
      feedDietGoal !== 'all' ||
      (loggedIn && feedAuthorScope !== 'public'),
    [feedFilterExpanded, feedSortBy, feedContentType, feedMealType, feedDietGoal, feedAuthorScope, loggedIn]
  )

  /** 暂存草稿的 key */
  const draftKey = (recordId: string, targetType: CommunityFeedTargetType = 'food_record') => `comment_draft_${targetType}_${recordId}`

  /** 关闭评论输入栏并暂存草稿 */
  const closeCommentModal = () => {
    if (expandedCommentRecordId == null) return
    if (commentContent.trim()) {
      try { Taro.setStorageSync(draftKey(expandedCommentRecordId, expandedCommentTargetType), commentContent) } catch (_) {}
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
    feedFilterExpandedRef.current = feedFilterExpanded
    if (feedFilterExpanded) {
      try {
        Taro.setStorageSync(COMMUNITY_FILTER_DRAWER_VISIBLE_KEY, '1')
      } catch (_) {}
    } else {
      try {
        Taro.removeStorageSync(COMMUNITY_FILTER_DRAWER_VISIBLE_KEY)
      } catch (_) {}
    }
  }, [feedFilterExpanded])

  useEffect(() => {
    return () => {
      try {
        Taro.removeStorageSync('community_comment_bar_visible')
      } catch (_) {}
      try {
        Taro.removeStorageSync(COMMUNITY_FILTER_DRAWER_VISIBLE_KEY)
      } catch (_) {}
    }
  }, [])

  /** 点击评论：打开底部输入栏，同一帖再点则关闭 */
  const openCommentModal = (recordId: string, replyComment?: FeedCommentItem | null, targetType: CommunityFeedTargetType = 'food_record') => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (expandedCommentRecordId === recordId && expandedCommentTargetType === targetType && !replyComment) {
      closeCommentModal()
      return
    }
    if (expandedCommentRecordId && commentContent.trim()) {
      try { Taro.setStorageSync(draftKey(expandedCommentRecordId, expandedCommentTargetType), commentContent) } catch (_) {}
    }
    let draft = ''
    try { draft = Taro.getStorageSync(draftKey(recordId, targetType)) || '' } catch (_) {}
    setCommentInputFocus(false)
    setCommentContent(draft)
    setExpandedCommentRecordId(recordId)
    setExpandedCommentTargetType(targetType)
    setReplyTargetComment(replyComment || null)
  }

  const scrollToFeedCard = useCallback((targetId: string, targetType: CommunityFeedTargetType = 'food_record') => {
    const nextTarget = `feed-card-${targetType}-${targetId}`
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
    targetCommentId?: string | null,
    targetType: CommunityFeedTargetType = 'food_record'
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

    const targetKey = `${targetType}:${recordId}`
    let targetItem = accumulated.find((item) => getFeedTargetKey(item) === targetKey) || null
    if (!targetItem) {
      const contextRes = await communityGetFeedContext(recordId, 5, targetType)
      const contextItem = contextRes.item
      if (!contextItem?.record?.id) return null

      const mergedContext = await mergeFeedTempComments([contextItem], true)
      targetItem = mergedContext[0] || null
      if (!targetItem) return null

      accumulated = [targetItem, ...accumulated.filter((item) => getFeedTargetKey(item) !== targetKey)]
      syncAccumulatedState(accumulated, nextHasMore)
    }

    if (!targetItem) return null

    const previewComments = targetItem.comments || []
    const needLoadAllComments = Boolean(targetCommentId) || (targetItem.comment_count || 0) > previewComments.length
    if (!needLoadAllComments) {
      return targetItem
    }

    const res = await communityGetComments(recordId, targetType)
    const comments = res.list || []
    accumulated = await mergeFeedTempComments(
      accumulated.map((item) => getFeedTargetKey(item) === targetKey ? {
        ...item,
        comments,
        comment_count: Math.max(item.comment_count || 0, comments.length)
      } : item),
      true
    )
    syncAccumulatedState(accumulated, nextHasMore)
    targetItem = accumulated.find((item) => getFeedTargetKey(item) === targetKey) || null
    return targetItem
  }, [feedList, hasMore, mergeFeedTempComments, saveToCache])

  const handlePendingNotificationNavigation = useCallback(async () => {
    if (pendingNotificationNavigationRef.current) return

    const pendingTarget = readPendingCommunityNotificationTarget()
    if (!pendingTarget?.recordId) return

    clearPendingCommunityNotificationTarget()
    pendingNotificationNavigationRef.current = true
    try {
      const targetType = pendingTarget.targetType || 'food_record'
      const targetId = pendingTarget.targetId || pendingTarget.recordId
      const targetItem = await ensureFeedReadyForNotification(
        targetId,
        pendingTarget.commentId,
        targetType
      )

      if (!targetItem) {
        Taro.showToast({ title: '未找到对应动态', icon: 'none' })
        return
      }

      scrollToFeedCard(targetId, targetType)
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

        openCommentModal(targetId, replyTarget, targetType)
      }
    } catch (e) {
      console.error('处理互动消息跳转失败:', e)
      void showUnifiedApiError(e, '打开评论区失败')
    } finally {
      pendingNotificationNavigationRef.current = false
    }
  }, [ensureFeedReadyForNotification, openCommentModal, scrollToFeedCard])

  const handleLoadAllComments = async (recordId: string, targetType: CommunityFeedTargetType = 'food_record') => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      const res = await communityGetComments(recordId, targetType)
      const comments = res.list || []
      const targetKey = `${targetType}:${recordId}`
      const mergedList = await mergeFeedTempComments(feedList.map((item) => getFeedTargetKey(item) === targetKey ? {
        ...item,
        comments,
        comment_count: Math.max(item.comment_count || 0, comments.length)
      } : item), true)
      setFeedList(mergedList)
      saveToCache(mergedList)
      setFeedCommentPreviewExpanded((prev) => ({ ...prev, [targetKey]: true }))
    } catch (e) {
      await showUnifiedApiError(e, '获取评论失败')
    }
  }

  const removeTempCommentFromStorage = useCallback((recordId: string, comment: FeedCommentItem, targetType: CommunityFeedTargetType = 'food_record') => {
    const key = getTempCommentsKey(recordId, targetType)
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
    (recordId: string, comment: FeedCommentItem, targetType: CommunityFeedTargetType = 'food_record') => {
      const targetKey = `${targetType}:${recordId}`
      setFeedList((prev) => {
        const target = prev.find((i) => getFeedTargetKey(i) === targetKey)
        const comments = target?.comments || []
        const subtreeIds = buildCommentSubtreeIds(comments, comment.id)
        const nextComments = removeCommentSubtreeFromList(comments, comment.id)
        const removedCount = comments.length - nextComments.length
        const next = prev.map((it) => {
          if (getFeedTargetKey(it) !== targetKey) return it
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
            if (expandedCommentRecordId !== recordId || expandedCommentTargetType !== targetType) return rt
            if (subtreeIds.has(rt.id)) return null
            return rt
          })
        })
        return next
      })
    },
    [saveToCache, expandedCommentRecordId, expandedCommentTargetType]
  )

  const handleCommentLongPress = useCallback(
    (recordId: string, feedItem: CommunityFeedItem, comment: FeedCommentItem) => {
      const targetType = getFeedTargetType(feedItem)
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
          handleRemoveCommentLocally(recordId, comment, targetType)
          Taro.showToast({ title: '已删除', icon: 'success' })
          return
        }
        if (comment._is_temp) {
          removeTempCommentFromStorage(recordId, comment, targetType)
          handleRemoveCommentLocally(recordId, comment, targetType)
          Taro.showToast({ title: '已删除', icon: 'success' })
          return
        }
        Taro.showLoading({ title: '删除中...', mask: true })
        void communityDeleteComment(recordId, comment.id, targetType)
          .then(() => {
            handleRemoveCommentLocally(recordId, comment, targetType)
            Taro.showToast({ title: '已删除', icon: 'success' })
          })
          .catch(async (e: Error) => {
            await showUnifiedApiError(e, '删除失败')
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
    const targetType = expandedCommentTargetTypeRef.current
    const targetKey = `${targetType}:${recordId}`
    const replySnap = replyTargetComment
    const clientKey = `pending_${now}_${Math.random().toString(36).slice(2, 9)}`
    const uid = String(Taro.getStorageSync('user_id') || '')
    const localUserDisplay = getLocalUserDisplay()

    const optimistic: FeedCommentItem = {
      id: clientKey,
      user_id: uid || 'pending',
      record_id: targetType === 'food_record' ? recordId : null,
      target_type: targetType,
      target_id: recordId,
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
        if (getFeedTargetKey(item) !== targetKey) return item
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
      Taro.removeStorageSync(draftKey(recordId, targetType))
    } catch (_) {}
    commentContentRef.current = ''
    setCommentContent('')
    setReplyTargetComment(null)

    setCommentInFlightCount((c) => c + 1)
    try {
      const { comment } = await communityPostComment(recordId, trimmed, {
        parent_comment_id: replySnap?.id,
        reply_to_user_id: replySnap?.user_id
      }, targetType)
      const displayComment: FeedCommentItem = {
        ...comment,
        reply_to_nickname: replySnap?.nickname || comment.reply_to_nickname || '',
        nickname: comment.nickname || localUserDisplay.nickname,
        avatar: comment.avatar || localUserDisplay.avatar,
        _is_pending: false
      }

      setFeedList((prev) => {
        const next = prev.map((item) => {
          if (getFeedTargetKey(item) !== targetKey) return item
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
      if (expandedCommentRecordIdRef.current === recordId && expandedCommentTargetTypeRef.current === targetType && !commentContentRef.current.trim()) {
        setCommentInputFocus(false)
        expandedCommentRecordIdRef.current = null
        setExpandedCommentRecordId(null)
        setReplyTargetComment(null)
      }
    } catch (e) {
      lastCommentSubmitRef.current = { signature: '', timestamp: 0 }
      setFeedList((prev) => {
        const next = prev.map((item) => {
          if (getFeedTargetKey(item) !== targetKey) return item
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
      await showUnifiedApiError(e, '发表失败')
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
    void chooseImageWithPrivacy({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
    }).then((res) => {
      const imagePath = res.tempFilePaths[0]
      Taro.setStorageSync('analyzeImagePath', imagePath)
      Taro.navigateTo({ url: extraPkgUrl('/pages/analyze/index') })
    }).catch((err) => {
      if (err?.errMsg?.includes('cancel')) return
      if (isPrivacyAuthorizeError(err)) {
        showPrivacyAuthorizeFailure(err)
        return
      }
      console.error('选择图片失败:', err)
      void showUnifiedApiError(new Error('选择图片失败'), '选择图片失败')
    })
  }

  return (
    <FlPageThemeRoot>
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
          onScroll={handleCommunityScroll}
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
                      if (!getAccessToken()) {
                        Taro.showToast({ title: '请先登录', icon: 'none' })
                        return
                      }
                      Taro.navigateTo({ url: extraPkgUrl('/pages/private-conversations/index') })
                    }}
                  >
                    <Text className='friends-quick-cell-icon iconfont icon-comment' />
                    <Text className='friends-quick-cell-label'>私信</Text>
                    {unreadMessageCount > 0 ? (
                      <View className='friends-quick-cell-badge'>
                        <Text className='friends-quick-cell-badge-text'>
                          {unreadMessageCount > 99 ? '99+' : String(unreadMessageCount)}
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
                    <Text className='friends-quick-cell-icon iconfont icon-tianjiahaoyou' />
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
                <Text className='section-title feed-section-title'>公开动态</Text>
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
                  <View className='feed-search-wrap' onClick={handleFeedSearchConfirm}>
                    <View className='feed-search-icon-wrap'>
                      <Text className='iconfont icon-search feed-search-icon' />
                    </View>
                    <Text className='feed-search-placeholder-text'>搜索动态内容或用户...</Text>
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
                  <View
                    className='feed-publish-btn'
                    onClick={() => void handlePublishPost()}
                  >
                    <Text className='iconfont icon-edit' />
                    <Text className='feed-publish-text'>发布</Text>
                  </View>
                </View>
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
              {(showSkeleton || (loadingFeed && feedList.length === 0) || (!feedInitialLoaded && feedList.length === 0)) ? (
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
                          : feedAuthorScope === 'public'
                            ? '暂无公开动态，稍后下拉刷新试试'
                            : feedAuthorScope === 'all'
                            ? '暂无符合当前筛选条件的好友动态'
                            : '暂无符合当前筛选条件的动态')
                        : '暂无符合当前筛选条件的动态'}
                    </Text>
                  </View>
                )
              ) : (
                <View className='feed-list'>
                  {filteredFeedList.map((item) => {
                    const targetType = getFeedTargetType(item)
                    const targetId = getFeedTargetId(item)
                    const targetKey = getFeedTargetKey(item)
                    const exercise = isExerciseFeed(item)
                    const isCampusFood = isCampusFoodFeed(item)
                    const isCirclePost = isCirclePostFeed(item)
                    const feedTime = String(item.record.record_time || item.record.created_at || '')
                    const exerciseTitle = item.record.exercise_type || '运动打卡'
                    const exerciseDesc = item.record.exercise_desc || item.record.description || ''
                    const circlePostTitle = isCirclePost ? (item.record.title || '') : ''
                    const circlePostBody = isCirclePost ? (item.record.body || '') : ''
                    const circlePostText = circlePostTitle || circlePostBody
                    const exerciseKcal = Number(item.record.calories_burned ?? item.record.total_calories ?? 0)
                    const isManualRecord = !exercise && !isCirclePost && shouldRenderManualFoodCards(item.record)
                    const manualFoodItems = isManualRecord
                      ? extractManualFoodDisplayItems(item.record.items)
                      : []
                    const useManualFoodCards = isManualRecord && manualFoodItems.length > 0
                    const useExerciseActivityCards = exercise && hasExerciseActivityCards(item.record.exercise_items)
                    const feedImagePaths = !exercise && !isCirclePost && !useManualFoodCards
                      ? (item.record.image_paths?.length
                        ? item.record.image_paths
                        : item.record.image_path
                          ? [item.record.image_path]
                          : [])
                      : []
                    const showReportMask = isCirclePost && reportMaskTarget?.targetType === targetType && reportMaskTarget?.targetId === targetId
                    return (
                      <View key={targetKey}>
                        <View
                          id={`feed-card-${targetType}-${targetId}`}
                          className={`feed-card${(item.record.description?.trim() || exerciseDesc || circlePostText.trim()) && !item.record.image_path && !useManualFoodCards && !useExerciseActivityCards ? ' feed-card-text-only' : ''} ${exercise ? 'feed-card-exercise' : ''} ${isCirclePost ? 'feed-card-circle-post' : ''}`}
                          style={isCirclePost ? { position: 'relative' } : undefined}
                          onLongPress={() => {
                            if (isCirclePost && !item.is_mine) {
                              setReportMaskTarget({ targetType, targetId })
                            }
                          }}
                        >
                        <View
                          className='feed-card-moments'
                          onClick={() => handleViewDetail(item)}
                        >
                          <View className='feed-card-avatar-col'>
                            <View
                              className='user-avatar'
                              onClick={(e) => {
                                e.stopPropagation()
                                if (item.author?.id) {
                                  Taro.navigateTo({ url: extraPkgUrl(`/pages/profile-settings/index?user_id=${encodeURIComponent(item.author.id)}`) })
                                }
                              }}
                            >
                              {item.author.avatar ? (
                                <Image src={item.author.avatar} mode='aspectFill' className='user-avatar-img' />
                              ) : (
                                <Text className='user-avatar-placeholder'>👤</Text>
                              )}
                            </View>
                          </View>
                          <View className='feed-card-main-col'>
                            <View className='feed-card-name-block'>
                              <View className='feed-card-name-row'>
                                <Text
                                  className='user-name'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (item.author?.id) {
                                      Taro.navigateTo({ url: extraPkgUrl(`/pages/profile-settings/index?user_id=${encodeURIComponent(item.author.id)}`) })
                                    }
                                  }}
                                >{item.is_mine ? '我' : item.author.nickname}</Text>
                              </View>
                              <View className='feed-sub-meta-row'>
                                <Text className='post-time'>
                                  {isCirclePost ? `自定义动态 · ${formatFeedTime(feedTime)}` : exercise ? `运动打卡 · ${formatFeedTime(feedTime)}` : isCampusFood ? `校园食堂 · ${formatFeedTime(feedTime)}` : `${MEAL_NAMES[item.record.meal_type] || item.record.meal_type} · ${formatFeedTime(feedTime)}`}
                                </Text>
                                {exercise ? (
                                  <Text className='feed-tag-plain feed-tag-exercise'>{exerciseTitle}</Text>
                                ) : isCampusFood ? (
                                  <Text className='feed-tag-plain feed-tag-campus'>校园食堂</Text>
                                ) : item.record.diet_goal && item.record.diet_goal !== 'none' && !isCirclePost ? (
                                  <Text className='feed-tag-plain'>{DIET_GOAL_NAMES[item.record.diet_goal] || item.record.diet_goal}</Text>
                                ) : null}
                              </View>
                            </View>
	                            {!useManualFoodCards && !useExerciseActivityCards && (exercise ? exerciseDesc : isCirclePost ? circlePostText : item.record.description) &&
                              (item.record.image_path && !isCirclePost ? (
                                exercise
                                  ? renderCollapsibleFeedText(`${targetKey}-desc`, exerciseDesc)
                                  : <Text className='feed-content'>{item.record.description}</Text>
                              ) : (
                                <View className='feed-content-wrap feed-content-wrap--text-only'>
                                  {isCirclePost ? (
                                    <>
                                      {circlePostTitle ? <Text className='feed-circle-post-title'>{circlePostTitle}</Text> : null}
                                      {circlePostBody ? <Text className='feed-content feed-circle-post-body'>{circlePostBody}</Text> : null}
                                    </>
                                  ) : (
                                    exercise
                                      ? renderCollapsibleFeedText(`${targetKey}-desc`, exerciseDesc)
                                      : <Text className='feed-content'>{item.record.description}</Text>
                                  )}
                                </View>
                              ))}
                            {useManualFoodCards && (
                              <ManualFoodCards
                                items={item.record.items}
                                onItemClick={() => handleViewDetail(item)}
                              />
                            )}
                            {useExerciseActivityCards && (
                              <ExerciseActivityCards
                                items={item.record.exercise_items}
                                onItemClick={() => handleViewDetail(item)}
                              />
                            )}
                            {feedImagePaths.length > 0 && !useManualFoodCards && !isCirclePost && (
                              <View
                                className={`feed-image ${feedImagePaths.length <= 1 ? 'feed-tap-to-detail' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (feedImagePaths.length <= 1) {
                                    handleViewDetail(item)
                                  }
                                }}
                              >
                                {feedImagePaths.length > 1 ? (
                                  <>
                                    <Swiper
                                      className='feed-image-swiper'
                                      circular
                                      indicatorDots={false}
                                      onChange={(e) => {
                                        setFeedImageIndices(prev => ({ ...prev, [targetKey]: e.detail.current }))
                                      }}
                                      current={feedImageIndices[targetKey] || 0}
                                    >
                                      {feedImagePaths.map((path, index) => (
                                        <SwiperItem key={`${targetKey}-swiper-${index}`} className='feed-image-swiper-item'>
                                          <Image
                                            src={path}
                                            mode='aspectFill'
                                            className='feed-image-swiper-image'
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              Taro.previewImage({ current: path, urls: feedImagePaths })
                                            }}
                                          />
                                        </SwiperItem>
                                      ))}
                                    </Swiper>
                                    <View className='feed-image-counter'>
                                      <Text className='feed-image-counter-text'>
                                        {(feedImageIndices[targetKey] || 0) + 1}/{feedImagePaths.length}
                                      </Text>
                                    </View>
                                  </>
                                ) : (
                                  <Image
                                    src={item.record.image_path || ''}
                                    mode='aspectFill'
                                    className='feed-image-content'
                                  />
                                )}
                              </View>
                            )}
                            {isCirclePost && (item.record.image_paths || []).length > 0 && (
                              <View className='feed-circle-post-images'>
                                {(item.record.image_paths || []).map((url, idx) => (
                                  <View
                                    key={`${targetKey}-img-${idx}`}
                                    className='feed-circle-post-image-item'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      Taro.previewImage({
                                        current: url,
                                        urls: item.record.image_paths || []
                                      })
                                    }}
                                  >
                                    <Image src={url} mode='aspectFill' className='feed-circle-post-image' />
                                  </View>
                                ))}
                              </View>
                            )}
                            {isCirclePost && (() => {
                              const n = item.record
                              const hasNutrition = Number(n.total_calories) > 0 || Number(n.total_protein) > 0 || Number(n.total_carbs) > 0 || Number(n.total_fat) > 0 || Number(n.fiber) > 0 || Number(n.sugar) > 0 || Number(n.sodium_mg) > 0 || Number(n.total_weight_grams) > 0
                              if (!hasNutrition) return null
                              return (
                                <View className='feed-meta feed-meta--circle-post'>
                                  <View className='feed-calorie'>
                                    <Text className='van-icon van-icon-fire-o taroify-icon taroify-icon--inherit feed-calorie-icon' />
                                    <Text className='feed-calorie-num'>{Math.round(Number(n.total_calories || 0))}</Text>
                                    <Text className='feed-calorie-unit'>kcal</Text>
                                  </View>
                                  <View className='feed-macros'>
                                    <Text className='feed-macros-text'>
                                      蛋白质 {Math.round(Number(n.total_protein ?? 0))}g · 碳水 {Math.round(Number(n.total_carbs ?? 0))}g · 脂肪 {Math.round(Number(n.total_fat ?? 0))}g
                                      {Number(n.fiber) > 0 ? ` · 膳食纤维 ${Math.round(Number(n.fiber ?? 0))}g` : ''}
                                      {Number(n.sugar) > 0 ? ` · 糖分 ${Math.round(Number(n.sugar ?? 0))}g` : ''}
                                      {Number(n.sodium_mg) > 0 ? ` · 钠 ${Math.round(Number(n.sodium_mg ?? 0))}mg` : ''}
                                      {Number(n.total_weight_grams) > 0 ? ` · 重量 ${Math.round(Number(n.total_weight_grams ?? 0))}g` : ''}
                                    </Text>
                                  </View>
                                </View>
                              )
                            })()}
                            {!isCirclePost && (isCampusFood ? (
                              <View className='feed-meta'>
                                {item.record.price != null ? (
                                  <View
                                    className='feed-calorie feed-calorie-campus feed-tap-to-detail'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleViewDetail(item)
                                    }}
                                  >
                                    <Text className='feed-calorie-num'>¥{Number(item.record.price).toFixed(1)}</Text>
                                  </View>
                                ) : null}
                                <View
                                  className='feed-macros feed-campus-nutrition feed-tap-to-detail'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleViewDetail(item)
                                  }}
                                >
                                  <Text className='feed-macros-text'>
                                    {Math.round(item.record.total_calories ?? 0)} kcal · 蛋白质 {Math.round(item.record.total_protein ?? 0)}g
                                  </Text>
                                </View>
                                {(item.record.school || item.record.canteen) ? (
                                  <View
                                    className='feed-macros feed-campus-location feed-tap-to-detail'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleViewDetail(item)
                                    }}
                                  >
                                    <Text className='feed-macros-text'>
                                      {[item.record.school, item.record.canteen].filter(Boolean).join(' · ')}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            ) : (
                              <View className='feed-meta'>
                                <View
                                  className='feed-calorie feed-tap-to-detail'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleViewDetail(item)
                                  }}
                                >
                                  <Text className='iconfont icon-huore feed-calorie-icon' />
                                  <Text className='feed-calorie-num'>
                                    {(exercise ? exerciseKcal : Number(item.record.total_calories || 0)).toFixed(0)}
                                  </Text>
                                  <Text className='feed-calorie-unit'>kcal{exercise ? ' 消耗' : ''}</Text>
                                </View>
                                {!exercise ? (
                                  <View
                                    className='feed-macros feed-tap-to-detail'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleViewDetail(item)
                                    }}
                                  >
                                    <Text className='feed-macros-text'>
                                      蛋白质 {Math.round(item.record.total_protein ?? 0)}g · 碳水 {Math.round(item.record.total_carbs ?? 0)}g · 脂肪 {Math.round(item.record.total_fat ?? 0)}g
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            ))}
                            <View
                              className='feed-actions'
                              onClick={(e) => e.stopPropagation()}
                            >
                              <View className='feed-actions-left'>
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
                                  onClick={() => openCommentModal(targetId, null, targetType)}
                                >
                                  <Text className='action-icon iconfont icon-pinglun' />
                                  <Text className='action-count'>评论 {item.comment_count || 0}</Text>
                                </View>
                              </View>
                              <View className='feed-actions-right'>
                                {item.is_mine && (
                                  <View
                                    className='action-item action-edit'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleEditFeedItem(item)
                                    }}
                                  >
                                    <Text className='action-icon iconfont icon-edit' />
                                  </View>
                                )}
                                <View
                                  className='action-item action-manage'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setFeedActionSheet({ item, mode: item.is_mine ? 'manage' : 'report' })
                                  }}
                                >
                                  <View className='action-manage-box'>
                                    <Text className='action-manage-icon'>⋮</Text>
                                  </View>
                                </View>
                              </View>
                            </View>
                            {(item.comments?.length ?? 0) > 0 && (() => {
                              const list = item.comments || []
                              const rid = targetId
                              const isListExpanded = feedCommentPreviewExpanded[targetKey] === true
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
                                      openCommentModal(targetId, c, targetType)
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
                                      setFeedCommentPreviewExpanded((prev) => ({ ...prev, [targetKey]: true }))
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
                                      setFeedCommentPreviewExpanded((prev) => ({ ...prev, [targetKey]: false }))
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
                                      void handleLoadAllComments(targetId, targetType)
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
                        {showReportMask ? (
                          <FeedReportMask
                            visible
                            onReport={() => {
                              setReportTarget({ targetType, targetId })
                              setReportMaskTarget(null)
                            }}
                            onCancel={() => setReportMaskTarget(null)}
                          />
                        ) : null}
                      </View>
                    </View>
                    )
                  })}
                </View>
              )}
              {/* 加载更多提示 */}
              {feedList.length > 0 && (
                <View
                  className='load-more-wrapper'
                  onClick={(e) => {
                    e.stopPropagation()
                    if (hasMore && !loadingMore) loadMoreFeed()
                  }}
                >
                  {loadingMore ? (
                    <View className='load-more-loading' />
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

      {feedFilterExpanded ? (
        <View className='feed-filter-drawer-mask' onClick={() => setFeedFilterExpanded(false)}>
          <View className='feed-filter-drawer' onClick={(e) => e.stopPropagation()}>
            <View className='feed-filter-drawer-handle' />
            <View className='feed-filter-drawer-header'>
              <Text className='feed-filter-drawer-title'>更多筛选</Text>
              <Text className='feed-filter-drawer-done' onClick={() => setFeedFilterExpanded(false)}>完成</Text>
            </View>
            <ScrollView className='feed-filter-drawer-content' scrollY enhanced showScrollbar={false}>
              <View className='feed-filter-labeled-row'>
                <Text className='feed-filter-label'>排序</Text>
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
                </View>
              </View>
              <View className='feed-filter-labeled-row'>
                <Text className='feed-filter-label'>内容</Text>
                <View className='feed-filter-row-inner'>
                  {FEED_CONTENT_OPTIONS.map((opt) => (
                    <View
                      key={opt.value}
                      className={`feed-filter-chip ${feedContentType === opt.value ? 'active' : ''}`}
                      onClick={() => setFeedContentType(opt.value)}
                    >
                      <Text className='feed-filter-chip-text'>{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {loggedIn ? (
                <View className='feed-filter-labeled-row'>
                  <Text className='feed-filter-label'>来源</Text>
                  <View className='feed-filter-row-inner'>
                    <View
                      className={`feed-filter-chip ${feedAuthorScope === 'public' ? 'active' : ''}`}
                      onClick={() => setFeedAuthorScope('public')}
                    >
                      <Text className='feed-filter-chip-text'>全部公开</Text>
                    </View>
                    <View
                      className={`feed-filter-chip ${feedAuthorScope === 'all' ? 'active' : ''}`}
                      onClick={() => setFeedAuthorScope('all')}
                    >
                      <Text className='feed-filter-chip-text'>仅好友</Text>
                    </View>
                    <View
                      className={`feed-filter-chip ${feedAuthorScope === 'priority' ? 'active' : ''}`}
                      onClick={() => setFeedAuthorScope('priority')}
                    >
                      <Text className='feed-filter-chip-text'>
                        {feedAuthorScope === 'priority' ? '特别关注中' : '特别关注'}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}
              {feedContentType !== 'exercise_log' ? (
              <View className='feed-filter-labeled-row'>
                <Text className='feed-filter-label'>餐次</Text>
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
              </View>
              ) : null}
              {feedContentType !== 'exercise_log' ? (
              <View className='feed-filter-labeled-row'>
                <Text className='feed-filter-label'>目标</Text>
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
              </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      ) : null}

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
      <CommunityFoodRecordEditSheet
        visible={editSheetVisible}
        record={editSheetRecord}
        onClose={() => {
          setEditSheetVisible(false)
          setEditSheetRecord(null)
        }}
        onSuccess={(updatedRecord) => {
          const nextList = feedListRef.current.map((item) => {
            if (item.record.id !== updatedRecord.id) return item
            return {
              ...item,
              record: {
                ...item.record,
                ...updatedRecord,
                feed_type: item.record.feed_type,
              },
            }
          })
          setFeedList(nextList)
          saveToCache(nextList)
        }}
      />
      <FeedActionSheet
        visible={!!feedActionSheet}
        actions={feedActionSheetActions}
        onClose={() => setFeedActionSheet(null)}
        onSelect={handleFeedActionSelect}
      />
      <FeedReportSheet
        visible={!!reportTarget}
        targetType={reportTarget?.targetType || 'circle_post'}
        targetId={reportTarget?.targetId || ''}
        onClose={() => setReportTarget(null)}
      />
    </FlPageThemeRoot>
  )
}

export default withAuth(CommunityPage, { public: true })
