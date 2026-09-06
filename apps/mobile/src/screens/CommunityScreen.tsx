import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AccessibilityInfo, ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type {
  CheckinLeaderboardItem,
  CommunityAuthorScope,
  CommunityFeedContentType,
  CommunityFeedItem,
  CommunityFeedQueryParams,
  CommunityFeedSortBy,
  CommunityFeedTargetType,
  DietGoal,
  FriendUserItem,
  FeedCommentItem,
  MealType,
} from '@food-link/core'
import {
  Ban,
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Dumbbell,
  Filter,
  Flag,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  PenLine,
  Phone,
  Search,
  Send,
  Trash2,
  UserPlus,
  UserRound,
  UsersRound,
  X,
  Trophy,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useAuth } from '../providers/AuthProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { compactFont, radius } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'

const hairline = 'rgba(92,184,150,0.14)'
const softBorder = 'rgba(92,184,150,0.18)'
const feedPageSize = 10
const feedCacheTtlMs = 5 * 60 * 1000
const feedCachePrefix = 'mobile_community_feed_v2:'
const priorityAuthorsPrefix = 'mobile_community_priority_authors_v1:'
const feedFiltersPrefix = 'mobile_community_filters_v1:'
const commentDraftPrefix = 'mobile_community_comment_draft_v1:'

const sortOptions: Array<{ value: CommunityFeedSortBy; label: string }> = [
  { value: 'latest', label: '最新' },
  { value: 'recommended', label: '推荐' },
  { value: 'hot', label: '高赞' },
  { value: 'balanced', label: '均衡' },
]

const contentOptions: Array<{ value: CommunityFeedContentType; label: string }> = [
  { value: 'all', label: '全部内容' },
  { value: 'food_record', label: '饮食' },
  { value: 'exercise_log', label: '运动' },
  { value: 'campus_food', label: '校园食堂' },
  { value: 'circle_post', label: '自定义' },
]

const mealOptions: Array<{ value: MealType | 'all'; label: string }> = [
  { value: 'all', label: '全部餐次' },
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'afternoon_snack', label: '加餐' },
]

const dietGoalOptions: Array<{ value: DietGoal | 'all'; label: string }> = [
  { value: 'all', label: '全部目标' },
  { value: 'fat_loss', label: '减脂' },
  { value: 'muscle_gain', label: '增肌' },
  { value: 'maintain', label: '维持' },
]

const authorScopeOptions: Array<{ value: CommunityAuthorScope; label: string }> = [
  { value: 'public', label: '全部公开' },
  { value: 'all', label: '仅好友' },
  { value: 'priority', label: '特别关注' },
]

type FeedCacheEntry = {
  savedAt: number
  list: CommunityFeedItem[]
  hasMore: boolean
}

type FeedFilterPreferences = {
  sortBy: CommunityFeedSortBy
  contentType: CommunityFeedContentType
  mealType: MealType | 'all'
  dietGoal: DietGoal | 'all'
  authorScope: CommunityAuthorScope
  authorId: string
  authorName: string
}

type FriendSearchType = 'nickname' | 'telephone'
type FeedReportReasonValue = 'spam' | 'inappropriate' | 'false_information' | 'harassment' | 'other'
type FeedActionState = { item: CommunityFeedItem; mode: 'manage' | 'report' } | null
type FeedImagePreviewState = { images: string[]; index: number; title: string } | null
type FeedCommentTarget = {
  targetId: string
  targetType: CommunityFeedTargetType
  targetKey: string
  authorName: string
  reply: FeedCommentItem | null
} | null

const reportReasons: Array<{ value: FeedReportReasonValue; label: string }> = [
  { value: 'spam', label: '垃圾广告' },
  { value: 'inappropriate', label: '不适宜内容' },
  { value: 'false_information', label: '虚假信息' },
  { value: 'harassment', label: '骚扰攻击' },
  { value: 'other', label: '其他原因' },
]

export function CommunityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const { isAuthenticated } = useAuth()
  const openLogin = useCallback(() => {
    navigation.getParent()?.navigate('Login', { redirectTab: 'CommunityTab' })
  }, [navigation])
  const requireAuth = useCallback((action: () => void) => {
    if (!isAuthenticated) {
      openLogin()
      return
    }
    action()
  }, [isAuthenticated, openLogin])
  const openPublish = useCallback(() => {
    if (!isAuthenticated) {
      navigation.getParent()?.navigate('Login', { redirectTo: 'CirclePostEdit' })
      return
    }
    navigation.navigate('CirclePostEdit')
  }, [isAuthenticated, navigation])
  const [feed, setFeed] = useState<CommunityFeedItem[]>([])
  const feedRef = useRef<CommunityFeedItem[]>([])
  const [leaderboard, setLeaderboard] = useState<CheckinLeaderboardItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [loadMoreError, setLoadMoreError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [addFriendOpen, setAddFriendOpen] = useState(false)
  const [sortBy, setSortBy] = useState<CommunityFeedSortBy>('latest')
  const [contentType, setContentType] = useState<CommunityFeedContentType>('all')
  const [mealType, setMealType] = useState<MealType | 'all'>('all')
  const [dietGoal, setDietGoal] = useState<DietGoal | 'all'>('all')
  const [authorScope, setAuthorScope] = useState<CommunityAuthorScope>('public')
  const [filterAuthorId, setFilterAuthorId] = useState('')
  const [filterAuthorName, setFilterAuthorName] = useState('')
  const [filterAuthorKeyword, setFilterAuthorKeyword] = useState('')
  const [filterAuthorResults, setFilterAuthorResults] = useState<FriendUserItem[]>([])
  const [filterAuthorSearching, setFilterAuthorSearching] = useState(false)
  const [sessionUserId, setSessionUserId] = useState('')
  const [accountReady, setAccountReady] = useState(false)
  const [priorityAuthorIds, setPriorityAuthorIds] = useState<string[]>([])
  const [friendSearchType, setFriendSearchType] = useState<FriendSearchType>('nickname')
  const [friendSearchKeyword, setFriendSearchKeyword] = useState('')
  const [friendSearchResults, setFriendSearchResults] = useState<FriendUserItem[]>([])
  const [friendSearchAttempted, setFriendSearchAttempted] = useState(false)
  const [friendSearchError, setFriendSearchError] = useState('')
  const [friendSearching, setFriendSearching] = useState(false)
  const [friendSendingId, setFriendSendingId] = useState<string | null>(null)
  const [notificationUnread, setNotificationUnread] = useState(0)
  const [messageUnread, setMessageUnread] = useState(0)
  const [friendRequestUnread, setFriendRequestUnread] = useState(0)
  const [feedAction, setFeedAction] = useState<FeedActionState>(null)
  const [reportTarget, setReportTarget] = useState<CommunityFeedItem | null>(null)
  const [reportReason, setReportReason] = useState<FeedReportReasonValue>('spam')
  const [reportExtra, setReportExtra] = useState('')
  const [feedMutatingKey, setFeedMutatingKey] = useState('')
  const [likingKeys, setLikingKeys] = useState<string[]>([])
  const [imagePreview, setImagePreview] = useState<FeedImagePreviewState>(null)
  const [commentTarget, setCommentTarget] = useState<FeedCommentTarget>(null)
  const [commentContent, setCommentContent] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [commentError, setCommentError] = useState('')
  const commentInputRef = useRef<TextInput | null>(null)
  const commentOpenGenerationRef = useRef(0)
  const friendSearchGenerationRef = useRef(0)
  const quickCountsGenerationRef = useRef(0)
  const likeInFlightRef = useRef(new Set<string>())
  const loadingMoreRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const filterActive = sortBy !== 'latest'
    || contentType !== 'all'
    || mealType !== 'all'
    || dietGoal !== 'all'
    || authorScope !== 'public'
    || Boolean(filterAuthorId)
  const filterSummary = useMemo(() => {
    if (!filterActive) return '更多筛选'
    const labels = [
      sortBy === 'latest' ? '' : sortOptions.find((option) => option.value === sortBy)?.label,
      contentType === 'all' ? '' : contentOptions.find((option) => option.value === contentType)?.label,
      mealType === 'all' || contentType === 'exercise_log' || contentType === 'campus_food' ? '' : mealOptions.find((option) => option.value === mealType)?.label,
      dietGoal === 'all' || contentType === 'exercise_log' || contentType === 'campus_food' ? '' : dietGoalOptions.find((option) => option.value === dietGoal)?.label,
      filterAuthorId ? filterAuthorName || '指定作者' : authorScopeOptions.find((option) => option.value === authorScope)?.label,
    ].filter(Boolean)
    return labels.slice(0, 2).join(' · ') || '更多筛选'
  }, [authorScope, contentType, dietGoal, filterActive, filterAuthorId, filterAuthorName, mealType, sortBy])

  const queryParams = useMemo<CommunityFeedQueryParams>(() => ({
    sort_by: sortBy,
    content_type: contentType,
    meal_type: contentType === 'exercise_log' || contentType === 'campus_food' || mealType === 'all' ? undefined : mealType,
    diet_goal: contentType === 'exercise_log' || contentType === 'campus_food' || dietGoal === 'all' ? undefined : dietGoal,
    author_scope: !isAuthenticated ? 'public' : filterAuthorId ? 'all' : authorScope,
    priority_author_ids: !isAuthenticated || filterAuthorId || authorScope !== 'priority' ? undefined : priorityAuthorIds,
    author_id: isAuthenticated ? filterAuthorId || undefined : undefined,
  }), [authorScope, contentType, dietGoal, filterAuthorId, isAuthenticated, mealType, priorityAuthorIds, sortBy])
  const queryKey = useMemo(() => buildFeedQueryKey(queryParams), [queryParams])

  const applyFeed = useCallback((list: CommunityFeedItem[]) => {
    feedRef.current = list
    setFeed(list)
  }, [])

  const saveFeedCache = useCallback(async (list: CommunityFeedItem[], nextHasMore: boolean) => {
    if (!sessionUserId) return
    const entry: FeedCacheEntry = {
      savedAt: Date.now(),
      list: list.slice(0, 30),
      hasMore: nextHasMore,
    }
    await AsyncStorage.setItem(feedCacheStorageKey(sessionUserId, queryKey), JSON.stringify(entry)).catch(() => undefined)
  }, [queryKey, sessionUserId])

  const load = useCallback(async (force = false) => {
    if (!sessionUserId) return
    const requestGeneration = ++requestGenerationRef.current
    let cacheShown = false
    setLoading(true)
    setFeedError('')
    if (force) setRefreshError('')

    if (!force) {
      const cacheKey = feedCacheStorageKey(sessionUserId, queryKey)
      try {
        const raw = await AsyncStorage.getItem(cacheKey)
        const cached = raw ? JSON.parse(raw) as FeedCacheEntry : null
        if (cached && Date.now() - Number(cached.savedAt || 0) <= feedCacheTtlMs && Array.isArray(cached.list)) {
          const list = dedupeFeedItems(cached.list)
          applyFeed(list)
          setHasMore(Boolean(cached.hasMore))
          cacheShown = true
          setLoading(false)
        } else if (raw) {
          await AsyncStorage.removeItem(cacheKey)
        }
      } catch {
        await AsyncStorage.removeItem(cacheKey).catch(() => undefined)
      }
    }

    try {
      const [feedData, leaderboardData] = await Promise.all([
        isAuthenticated
          ? apiClient.communityGetFeed({ offset: 0, limit: feedPageSize, includeComments: true, commentsLimit: 5, params: queryParams })
          : apiClient.communityGetPublicFeed({ offset: 0, limit: feedPageSize, includeComments: true, commentsLimit: 5, params: queryParams }),
        isAuthenticated
          ? apiClient.communityGetCheckinLeaderboard().catch(() => ({ list: [] as CheckinLeaderboardItem[], week_start: '', week_end: '' }))
          : Promise.resolve({ list: [] as CheckinLeaderboardItem[], week_start: '', week_end: '' }),
      ])
      if (requestGenerationRef.current !== requestGeneration) return
      const list = dedupeFeedItems(feedData.list || [])
      const nextHasMore = feedData.has_more ?? list.length >= feedPageSize
      applyFeed(list)
      setHasMore(nextHasMore)
      setLeaderboard(leaderboardData.list || [])
      await saveFeedCache(list, nextHasMore)
    } catch (error) {
      if (requestGenerationRef.current === requestGeneration) {
        const message = userFacingErrorMessage(error)
        if (cacheShown || feedRef.current.length > 0) setRefreshError(message)
        else setFeedError(message)
      }
    } finally {
      if (requestGenerationRef.current === requestGeneration) setLoading(false)
    }
  }, [applyFeed, isAuthenticated, queryKey, queryParams, saveFeedCache, sessionUserId])

  const loadMore = useCallback(async () => {
    if (!sessionUserId || loadingMoreRef.current || !hasMore || loading) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError('')
    const requestGeneration = requestGenerationRef.current
    const offset = feedRef.current.length
    try {
      const data = isAuthenticated
        ? await apiClient.communityGetFeed({
            offset,
            limit: feedPageSize,
            includeComments: true,
            commentsLimit: 5,
            params: queryParams,
          })
        : await apiClient.communityGetPublicFeed({
            offset,
            limit: feedPageSize,
            includeComments: true,
            commentsLimit: 5,
            params: queryParams,
          })
      if (requestGenerationRef.current !== requestGeneration) return
      const incoming = dedupeFeedItems(data.list || [])
      const merged = appendUniqueFeedItems(feedRef.current, incoming)
      const nextHasMore = (data.has_more ?? incoming.length >= feedPageSize) && merged.added > 0
      applyFeed(merged.list)
      setHasMore(nextHasMore)
      await saveFeedCache(merged.list, nextHasMore)
    } catch (error) {
      if (requestGenerationRef.current === requestGeneration) {
        setLoadMoreError(userFacingErrorMessage(error))
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [applyFeed, hasMore, isAuthenticated, loading, queryParams, saveFeedCache, sessionUserId])

  useFocusEffect(
    useCallback(() => {
      let active = true
      void (async () => {
        const nextUserId = isAuthenticated ? String(await getStoredUserId() || 'guest').trim() || 'guest' : 'guest'
        const [storedPriorityIds, storedFilters] = await Promise.all([
          readPriorityAuthorIds(nextUserId),
          readFeedFilterPreferences(nextUserId),
        ])
        if (!active) return
        setSessionUserId(nextUserId)
        setPriorityAuthorIds((current) => sameStringList(current, storedPriorityIds) ? current : storedPriorityIds)
        if (storedFilters) {
          setSortBy(storedFilters.sortBy)
          setContentType(storedFilters.contentType)
          setMealType(storedFilters.mealType)
          setDietGoal(storedFilters.dietGoal)
          setAuthorScope(isAuthenticated ? storedFilters.authorScope : 'public')
          setFilterAuthorId(isAuthenticated ? storedFilters.authorId : '')
          setFilterAuthorName(isAuthenticated ? storedFilters.authorName : '')
        }
        setAccountReady(true)
      })()
      return () => {
        active = false
      }
    }, [isAuthenticated]),
  )

  useEffect(() => {
    if (!accountReady || !sessionUserId) return
    const preferences: FeedFilterPreferences = {
      sortBy,
      contentType,
      mealType,
      dietGoal,
      authorScope,
      authorId: filterAuthorId,
      authorName: filterAuthorName,
    }
    void AsyncStorage.setItem(feedFiltersStorageKey(sessionUserId), JSON.stringify(preferences)).catch(() => undefined)
  }, [accountReady, authorScope, contentType, dietGoal, filterAuthorId, filterAuthorName, mealType, sessionUserId, sortBy])

  const loadQuickCounts = useCallback(async () => {
    const generation = ++quickCountsGenerationRef.current
    if (!isAuthenticated) {
      setNotificationUnread(0)
      setMessageUnread(0)
      setFriendRequestUnread(0)
      return
    }
    const [notifications, messages, requests] = await Promise.all([
      apiClient.listCommunityNotifications({ limit: 1 }).catch(() => null),
      apiClient.getUnreadPrivateMessageCount().catch(() => null),
      apiClient.getFriendRequestsOverview().catch(() => null),
    ])
    if (quickCountsGenerationRef.current !== generation) return
    setNotificationUnread(Math.max(0, Number(notifications?.unread_count || 0)))
    setMessageUnread(Math.max(0, Number(messages?.count || 0)))
    setFriendRequestUnread((requests?.received || []).filter((request) => request.status === 'pending').length)
  }, [isAuthenticated])

  useFocusEffect(
    useCallback(() => {
      void loadQuickCounts()
      return () => {
        quickCountsGenerationRef.current += 1
      }
    }, [loadQuickCounts]),
  )

  useFocusEffect(
    useCallback(() => {
      if (!accountReady || !sessionUserId) return undefined
      applyFeed([])
      setHasMore(true)
      void load()
      return () => {
        requestGenerationRef.current += 1
        loadingMoreRef.current = false
      }
    }, [accountReady, applyFeed, load, sessionUserId]),
  )

  const toggleLike = async (item: CommunityFeedItem) => {
    if (!isAuthenticated) {
      openLogin()
      return
    }
    const targetId = item.target_id || item.record.id
    const targetType = item.target_type || item.record.feed_type || 'food_record'
    const itemKey = getFeedTargetKey(item)
    if (likeInFlightRef.current.has(itemKey)) return
    likeInFlightRef.current.add(itemKey)
    setLikingKeys((current) => current.includes(itemKey) ? current : [...current, itemKey])
    const previousLiked = Boolean(item.liked)
    const next = feedRef.current.map((entry) => (
      getFeedTargetKey(entry) === itemKey ? { ...entry, liked: !previousLiked, like_count: Math.max(0, entry.like_count + (previousLiked ? -1 : 1)) } : entry
    ))
    applyFeed(next)
    void saveFeedCache(next, hasMore)
    try {
      if (previousLiked) await apiClient.communityUnlike(targetId, targetType)
      else await apiClient.communityLike(targetId, targetType)
    } catch (error) {
      const reverted = feedRef.current.map((entry) => (
        getFeedTargetKey(entry) === itemKey ? { ...entry, liked: previousLiked, like_count: Math.max(0, entry.like_count + (previousLiked ? 1 : -1)) } : entry
      ))
      applyFeed(reverted)
      void saveFeedCache(reverted, hasMore)
      void dialog.alert('操作失败', userFacingErrorMessage(error), 'danger')
    } finally {
      likeInFlightRef.current.delete(itemKey)
      setLikingKeys((current) => current.filter((key) => key !== itemKey))
    }
  }

  const openImagePreview = useCallback((images: string[], index: number, title: string) => {
    if (images.length === 0) return
    setImagePreview({ images, index: Math.max(0, Math.min(index, images.length - 1)), title })
  }, [])

  const closeCommentComposer = useCallback((saveDraft = true) => {
    commentOpenGenerationRef.current += 1
    if (commentTarget) {
      const key = commentDraftStorageKey(sessionUserId, commentTarget.targetType, commentTarget.targetId)
      if (saveDraft && commentContent.trim()) {
        void AsyncStorage.setItem(key, commentContent).catch(() => undefined)
      } else {
        void AsyncStorage.removeItem(key).catch(() => undefined)
      }
    }
    setCommentTarget(null)
    setCommentContent('')
    setCommentError('')
    Keyboard.dismiss()
  }, [commentContent, commentTarget, sessionUserId])

  const openCommentComposer = useCallback(async (item: CommunityFeedItem, reply: FeedCommentItem | null = null) => {
    if (!isAuthenticated) {
      openLogin()
      return
    }
    const targetId = getFeedTargetId(item)
    const targetType = getFeedTargetType(item)
    const targetKey = getFeedTargetKey(item)
    if (commentTarget?.targetKey === targetKey && !reply) {
      closeCommentComposer()
      return
    }
    if (commentTarget && commentContent.trim()) {
      const currentDraftKey = commentDraftStorageKey(sessionUserId, commentTarget.targetType, commentTarget.targetId)
      void AsyncStorage.setItem(currentDraftKey, commentContent).catch(() => undefined)
    }
    const generation = ++commentOpenGenerationRef.current
    const draft = await AsyncStorage.getItem(commentDraftStorageKey(sessionUserId, targetType, targetId)).catch(() => '')
    if (generation !== commentOpenGenerationRef.current) return
    setCommentContent(draft || '')
    setCommentError('')
    setCommentTarget({
      targetId,
      targetType,
      targetKey,
      authorName: item.is_mine ? '我' : item.author?.nickname || '食友',
      reply,
    })
    setTimeout(() => commentInputRef.current?.focus(), 90)
  }, [closeCommentComposer, commentContent, commentTarget, isAuthenticated, openLogin, sessionUserId])

  const submitComment = useCallback(async () => {
    const target = commentTarget
    const content = commentContent.trim()
    if (!target || !content || commentSubmitting) return
    const pendingId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const optimistic: FeedCommentItem = {
      id: pendingId,
      user_id: sessionUserId || 'pending',
      target_type: target.targetType,
      target_id: target.targetId,
      record_id: target.targetType === 'food_record' ? target.targetId : null,
      parent_comment_id: target.reply?.parent_comment_id || target.reply?.id || null,
      reply_to_user_id: target.reply?.user_id || null,
      reply_to_nickname: target.reply?.nickname,
      content,
      created_at: new Date().toISOString(),
      nickname: '我',
      avatar: '',
    }
    const optimisticFeed = feedRef.current.map((entry) => getFeedTargetKey(entry) === target.targetKey ? {
      ...entry,
      comments: [...(entry.comments || []), optimistic],
      comment_count: Math.max(entry.comment_count || 0, entry.comments?.length || 0) + 1,
    } : entry)
    applyFeed(optimisticFeed)
    void saveFeedCache(optimisticFeed, hasMore)
    setCommentContent('')
    setCommentError('')
    setCommentSubmitting(true)
    try {
      const response = await apiClient.communityAddComment({
        targetId: target.targetId,
        targetType: target.targetType,
        content,
        parentCommentId: target.reply?.parent_comment_id || target.reply?.id,
        replyToUserId: target.reply?.user_id,
      })
      const confirmedComment: FeedCommentItem = {
        ...response.comment,
        nickname: response.comment.nickname || '我',
        avatar: response.comment.avatar || '',
        reply_to_nickname: target.reply?.nickname || response.comment.reply_to_nickname,
      }
      const confirmedFeed = feedRef.current.map((entry) => getFeedTargetKey(entry) === target.targetKey ? {
        ...entry,
        comments: (entry.comments || []).map((comment) => comment.id === pendingId ? confirmedComment : comment),
      } : entry)
      applyFeed(confirmedFeed)
      void saveFeedCache(confirmedFeed, hasMore)
      void AsyncStorage.removeItem(commentDraftStorageKey(sessionUserId, target.targetType, target.targetId)).catch(() => undefined)
      commentOpenGenerationRef.current += 1
      setCommentTarget(null)
      setCommentContent('')
      Keyboard.dismiss()
      AccessibilityInfo.announceForAccessibility('评论已发送')
    } catch (error) {
      const revertedFeed = feedRef.current.map((entry) => getFeedTargetKey(entry) === target.targetKey ? {
        ...entry,
        comments: (entry.comments || []).filter((comment) => comment.id !== pendingId),
        comment_count: Math.max(0, (entry.comment_count || 0) - 1),
      } : entry)
      applyFeed(revertedFeed)
      void saveFeedCache(revertedFeed, hasMore)
      setCommentContent(content)
      setCommentError(`发送失败：${userFacingErrorMessage(error)}`)
      AccessibilityInfo.announceForAccessibility('评论发送失败')
    } finally {
      setCommentSubmitting(false)
    }
  }, [applyFeed, commentContent, commentSubmitting, commentTarget, hasMore, saveFeedCache, sessionUserId])
  const closeAddFriend = useCallback(() => {
    friendSearchGenerationRef.current += 1
    setAddFriendOpen(false)
    setFriendSearchKeyword('')
    setFriendSearchResults([])
    setFriendSearchAttempted(false)
    setFriendSearchError('')
    setFriendSearching(false)
    setFriendSendingId(null)
  }, [])

  const handleFriendSearchTypeChange = useCallback((type: FriendSearchType) => {
    friendSearchGenerationRef.current += 1
    setFriendSearchType(type)
    setFriendSearchResults([])
    setFriendSearchAttempted(false)
    setFriendSearchError('')
    setFriendSearching(false)
  }, [])

  const handleFriendKeywordChange = useCallback((value: string) => {
    friendSearchGenerationRef.current += 1
    setFriendSearchKeyword(value)
    setFriendSearchResults([])
    setFriendSearchAttempted(false)
    setFriendSearchError('')
    setFriendSearching(false)
  }, [])

  const handleFriendSearch = useCallback(async () => {
    const keyword = friendSearchKeyword.trim()
    if (!keyword) {
      setFriendSearchError(friendSearchType === 'telephone' ? '请输入手机号' : '请输入昵称')
      return
    }
    const generation = ++friendSearchGenerationRef.current
    setFriendSearchAttempted(true)
    setFriendSearching(true)
    setFriendSearchError('')
    setFriendSearchResults([])
    try {
      const data = await apiClient.searchFriends(friendSearchType === 'telephone' ? { telephone: keyword } : { nickname: keyword })
      if (generation !== friendSearchGenerationRef.current) return
      setFriendSearchResults(data.list || [])
    } catch (error) {
      if (generation !== friendSearchGenerationRef.current) return
      setFriendSearchError(`搜索失败：${userFacingErrorMessage(error)}`)
    } finally {
      if (generation === friendSearchGenerationRef.current) setFriendSearching(false)
    }
  }, [friendSearchKeyword, friendSearchType])

  const handleFriendRequest = useCallback(async (userId: string) => {
    if (!userId || friendSendingId) return
    setFriendSendingId(userId)
    setFriendSearchError('')
    try {
      await apiClient.sendFriendRequest(userId)
      setFriendSearchResults((prev) => prev.map((item) => (item.id === userId ? { ...item, is_pending: true } : item)))
      AccessibilityInfo.announceForAccessibility('好友申请已发送')
    } catch (error) {
      setFriendSearchError(`发送失败：${userFacingErrorMessage(error)}`)
    } finally {
      setFriendSendingId(null)
    }
  }, [friendSendingId])

  const handleBlockFeedAuthor = useCallback(async (item: CommunityFeedItem) => {
    const authorId = String(item.author?.id || '').trim()
    if (!authorId) return
    const confirmed = await dialog.confirm({
      title: '拉黑用户',
      message: `拉黑后将不再看到「${item.author?.nickname || '用户'}」的内容，双方也不能私信或重新添加好友。`,
      kind: 'danger',
      confirmText: '拉黑',
      cancelText: '取消',
    })
    if (!confirmed) return
    try {
      await apiClient.blockUser(authorId)
      const next = feedRef.current.filter((entry) => String(entry.author?.id || '') !== authorId)
      applyFeed(next)
      void saveFeedCache(next, hasMore)
      void dialog.alert('已加入黑名单', undefined, 'success')
    } catch (error) {
      void dialog.alert('无法操作', userFacingErrorMessage(error), 'danger')
    }
  }, [applyFeed, dialog, hasMore, saveFeedCache])

  const togglePriorityAuthor = useCallback((authorId: string) => {
    if (!authorId || !sessionUserId) return
    const already = priorityAuthorIds.includes(authorId)
    const next = already ? priorityAuthorIds.filter((id) => id !== authorId) : [...priorityAuthorIds, authorId]
    setPriorityAuthorIds(next)
    void AsyncStorage.setItem(priorityAuthorsStorageKey(sessionUserId), JSON.stringify(next)).then(() => {
      void dialog.alert(already ? '已取消特别关注' : '已设为特别关注', undefined, 'success')
    }).catch(() => {
      setPriorityAuthorIds(priorityAuthorIds)
      void dialog.alert('保存特别关注失败', '请稍后重试。', 'danger')
    })
  }, [dialog, priorityAuthorIds, sessionUserId])

  const handleFeedActions = useCallback((item: CommunityFeedItem) => {
    if (!isAuthenticated) {
      openLogin()
      return
    }
    setFeedAction({ item, mode: item.is_mine ? 'manage' : 'report' })
  }, [isAuthenticated, openLogin])

  const handleEditFeedItem = useCallback((item: CommunityFeedItem) => {
    const targetId = getFeedTargetId(item)
    const targetType = getFeedTargetType(item)
    setFeedAction(null)
    if (targetType === 'circle_post') navigation.navigate('CirclePostEdit', { postId: targetId })
    else if (targetType === 'food_record') navigation.navigate('RecordDetail', { recordId: targetId, initialAction: 'edit' })
    else if (targetType === 'campus_food') navigation.navigate('PublicFoodShare', { editId: targetId, mode: 'campus' })
    else navigation.navigate('ExerciseLogEdit', { logId: targetId, date: feedRecordDate(item) })
  }, [navigation])

  const handleDeleteFeedItem = useCallback(async (item: CommunityFeedItem) => {
    setFeedAction(null)
    const targetId = getFeedTargetId(item)
    const targetType = getFeedTargetType(item)
    const targetKey = getFeedTargetKey(item)
    const confirmed = await dialog.confirm({
      title: '确认删除',
      message: '删除后不可恢复，是否继续？',
      kind: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (!confirmed) return
    setFeedMutatingKey(targetKey)
    try {
      if (targetType === 'circle_post') await apiClient.deleteCirclePost(targetId)
      else if (targetType === 'food_record') await apiClient.deleteFoodRecord(targetId)
      else if (targetType === 'exercise_log') await apiClient.deleteExerciseLog(targetId)
      else await apiClient.deletePublicFood(targetId)
      const next = feedRef.current.filter((entry) => getFeedTargetKey(entry) !== targetKey)
      applyFeed(next)
      void saveFeedCache(next, hasMore)
      void dialog.alert('已删除', undefined, 'success')
    } catch (error) {
      void dialog.alert('删除失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setFeedMutatingKey('')
    }
  }, [applyFeed, dialog, hasMore, saveFeedCache])

  const handleFeedActionSelect = useCallback((action: 'priority' | 'block' | 'report' | 'edit' | 'delete') => {
    const current = feedAction
    if (!current) return
    const item = current.item
    const authorId = String(item.author?.id || '').trim()
    if (action === 'priority') {
      setFeedAction(null)
      togglePriorityAuthor(authorId)
    } else if (action === 'block') {
      setFeedAction(null)
      void handleBlockFeedAuthor(item)
    } else if (action === 'report') {
      setFeedAction(null)
      setReportReason('spam')
      setReportExtra('')
      setReportTarget(item)
    } else if (action === 'edit') {
      handleEditFeedItem(item)
    } else {
      void handleDeleteFeedItem(item)
    }
  }, [feedAction, handleBlockFeedAuthor, handleDeleteFeedItem, handleEditFeedItem, togglePriorityAuthor])

  const submitFeedReport = useCallback(async () => {
    if (!reportTarget) return
    const targetKey = getFeedTargetKey(reportTarget)
    setFeedMutatingKey(targetKey)
    try {
      await apiClient.communityReport({
        targetId: getFeedTargetId(reportTarget),
        targetType: getFeedTargetType(reportTarget),
        reason: reportReason,
        extraContent: reportExtra,
      })
      setReportTarget(null)
      setReportExtra('')
      void dialog.alert('举报已提交', '感谢你的反馈，我们会尽快处理。', 'success')
    } catch (error) {
      void dialog.alert('举报失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setFeedMutatingKey('')
    }
  }, [dialog, reportExtra, reportReason, reportTarget])

  const handleFilterAuthorSearch = useCallback(async () => {
    if (!isAuthenticated) {
      openLogin()
      return
    }
    const keyword = filterAuthorKeyword.trim()
    if (!keyword) return
    setFilterAuthorSearching(true)
    setFilterAuthorResults([])
    try {
      const data = await apiClient.listFriends()
      const normalizedKeyword = keyword.toLocaleLowerCase()
      setFilterAuthorResults((data.list || []).filter((friend) => (
        String(friend.nickname || '').toLocaleLowerCase().includes(normalizedKeyword)
      )))
    } catch (error) {
      void dialog.alert('搜索作者失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setFilterAuthorSearching(false)
    }
  }, [dialog, filterAuthorKeyword])

  const selectFilterAuthor = useCallback((author: FriendUserItem) => {
    setFilterAuthorId(author.id)
    setFilterAuthorName(author.nickname || '用户')
    setFilterAuthorResults([])
    setFilterAuthorKeyword('')
  }, [])

  const clearFilterAuthor = useCallback(() => {
    setFilterAuthorId('')
    setFilterAuthorName('')
    setFilterAuthorResults([])
    setFilterAuthorKeyword('')
  }, [])

  const handleFeedScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 240) {
      void loadMore()
    }
  }, [loadMore])

  return (
    <View style={styles.page}>
      <View style={styles.topWash} pointerEvents="none" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 10, 18),
            paddingBottom: insets.bottom + 108,
          },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={handleFeedScroll}
        scrollEventThrottle={120}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void Promise.all([load(true), loadQuickCounts()])} tintColor={palette.brand} colors={[palette.brand]} />}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开本周打卡排行榜"
          style={({ pressed }) => [styles.rankingBanner, pressed && styles.pressed]}
          onPress={() => requireAuth(() => navigation.navigate('CheckinLeaderboard', { section: 'user', ranking: 'checkin' }))}
        >
          <View style={styles.rankingHubHead}>
            <View style={styles.rankingIconWrap}>
              <Trophy size={20} color="rgba(255,255,255,0.96)" strokeWidth={2.5} />
            </View>
            <View style={styles.rankingHeadText}>
              <Text style={styles.rankingTitle}>本周打卡排行榜</Text>
              <Text style={styles.rankingSubtitle}>看看谁是本周最活跃</Text>
            </View>
            <ChevronRight size={20} color="rgba(255,255,255,0.82)" strokeWidth={2.4} />
          </View>
          {isAuthenticated ? (
            <View style={styles.rankingPreview}>
              {leaderboard.length > 0 ? (
                <View style={styles.rankingPreviewRow}>
                  {leaderboard.slice(0, 3).map((item, index) => (
                    <RankPreviewCell key={item.user_id} item={item} rank={item.rank || index + 1} />
                  ))}
                </View>
              ) : (
                <Text style={styles.rankingPreviewPlaceholder}>暂无预览，下拉刷新试试</Text>
              )}
            </View>
          ) : null}
        </Pressable>
        {isAuthenticated ? (
          <View style={styles.quickBar}>
            <View style={styles.quickGrid}>
              <QuickEntry label="互动消息" icon={Bell} badgeCount={notificationUnread} onPress={() => navigation.navigate('Notifications')} />
              <QuickEntry label="私信" icon={MessageCircle} badgeCount={messageUnread} onPress={() => navigation.navigate('Conversations')} />
              <QuickEntry label="好友管理" icon={UsersRound} badgeCount={friendRequestUnread} onPress={() => navigation.navigate('Friends', friendRequestUnread > 0 ? { initialTab: 'received' } : undefined)} />
              <QuickEntry label="添加好友" icon={UserPlus} onPress={() => setAddFriendOpen(true)} />
            </View>
          </View>
        ) : null}

        {!isAuthenticated ? (
          <View style={styles.loginTip}>
            <Text style={styles.loginTipText}>登录后可添加好友、点赞和评论</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="去登录使用圈子互动" style={({ pressed }) => [styles.loginTipButton, pressed && styles.pressed]} onPress={openLogin}>
              <Text style={styles.loginTipButtonText}>去登录</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.feedSection}>
          <View style={styles.feedSectionHeader}>
            <Text style={styles.feedSectionTitle}>公开动态</Text>
            {isAuthenticated ? (
              <Pressable hitSlop={8} onPress={() => navigation.navigate('PublicFood', { mode: 'all' })}>
                <Text style={styles.feedSectionLink}>食物库</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.feedFilterPanel}>
            <View style={styles.feedFilterTopRow}>
              <Pressable style={({ pressed }) => [styles.feedSearchWrap, pressed && styles.pressed]} onPress={() => requireAuth(() => navigation.navigate('CommunitySearch'))}>
                <Search size={18} color={palette.textMuted} strokeWidth={2.2} />
                <Text style={styles.feedSearchText} numberOfLines={1}>搜索动态内容或用户...</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.feedFilterTrigger, pressed && styles.pressed]} onPress={() => setFilterOpen(true)}>
                <View style={[styles.feedFilterFunnelBtn, filterActive && styles.feedFilterFunnelBtnActive]}>
                  <Filter size={17} color={filterActive ? palette.brand : palette.textMuted} strokeWidth={2.3} />
                </View>
                <Text style={[styles.feedFilterSummary, filterActive && styles.feedFilterSummaryActive]} numberOfLines={1}>{filterSummary}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.feedPublishBtn, pressed && styles.pressed]} onPress={openPublish}>
                <PenLine size={15} color="#fff" strokeWidth={2.4} />
                <Text style={styles.feedPublishText}>发布</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.secondaryChips}>
            <ShortcutChip label="校园餐" onPress={() => requireAuth(() => navigation.navigate('CampusCanteen'))} />
            <ShortcutChip label="分享食物" onPress={() => requireAuth(() => navigation.navigate('PublicFoodShare', { mode: 'public' }))} />
            <ShortcutChip label="补校园餐" onPress={() => requireAuth(() => navigation.navigate('PublicFoodShare', { mode: 'campus' }))} />
          </View>

          {refreshError && feed.length > 0 ? (
            <View accessibilityRole="alert" style={styles.inlineErrorBanner}>
              <CircleAlert size={18} color={palette.danger} />
              <Text style={styles.inlineErrorText} numberOfLines={2}>{refreshError}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="重新刷新动态" style={({ pressed }) => [styles.inlineRetryButton, pressed && styles.pressed]} onPress={() => void load(true)}>
                <Text style={styles.inlineRetryText}>重试</Text>
              </Pressable>
            </View>
          ) : null}
          {loading && feed.length === 0 ? (
            <FeedSkeleton />
          ) : feedError && feed.length === 0 ? (
            <View accessibilityRole="alert" style={styles.feedErrorState}>
              <CircleAlert size={28} color={palette.danger} />
              <Text style={styles.feedErrorTitle}>动态加载失败</Text>
              <Text style={styles.feedErrorMessage}>{feedError}</Text>
              <Pressable accessibilityRole="button" style={({ pressed }) => [styles.feedErrorRetry, pressed && styles.pressed]} onPress={() => void load(true)}>
                <Text style={styles.feedErrorRetryText}>重新加载</Text>
              </Pressable>
            </View>
          ) : feed.length === 0 ? (
            <View style={styles.feedEmpty}>
              <Text style={styles.feedEmptyText}>暂无公开动态，记录一餐后会出现在这里。</Text>
            </View>
          ) : (
            <View style={styles.feedList}>
              {feed.map((item) => (
                <CommunityFeedCard
                  key={`${item.target_type || 'food'}-${item.target_id || item.record.id}`}
                  item={item}
                  onOpen={() => requireAuth(() => navigation.navigate('CommunityFeedDetail', {
                    targetId: getFeedTargetId(item),
                    targetType: getFeedTargetType(item),
                  }))}
                  onOpenAuthor={() => requireAuth(() => navigation.navigate('PublicProfile', { userId: item.author.id }))}
                  onLike={() => void toggleLike(item)}
                  onComment={() => void openCommentComposer(item)}
                  onReply={(comment) => void openCommentComposer(item, comment)}
                  onPreviewImages={(images, index) => openImagePreview(images, index, feedTitle(item))}
                  onManage={() => handleFeedActions(item)}
                  liking={likingKeys.includes(getFeedTargetKey(item))}
                  busy={feedMutatingKey === getFeedTargetKey(item)}
                />
              ))}
              <View style={styles.loadMoreFooter}>
                {loadingMore ? (
                  <ActivityIndicator size="small" color={palette.brand} />
                ) : loadMoreError ? (
                  <Pressable accessibilityRole="button" style={({ pressed }) => [styles.loadMoreRetry, pressed && styles.pressed]} onPress={() => void loadMore()}>
                    <CircleAlert size={16} color={palette.danger} />
                    <Text style={styles.loadMoreRetryText}>加载失败，点此重试</Text>
                  </Pressable>
                ) : hasMore ? (
                  <Text style={styles.loadMoreText}>继续上滑加载更多</Text>
                ) : (
                  <Text style={styles.loadMoreText}>已经到底啦</Text>
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      <FilterDrawer
        visible={filterOpen}
        sortBy={sortBy}
        contentType={contentType}
        mealType={mealType}
        dietGoal={dietGoal}
        authorScope={authorScope}
        authorId={filterAuthorId}
        authorName={filterAuthorName}
        authorKeyword={filterAuthorKeyword}
        authorResults={filterAuthorResults}
        authorSearching={filterAuthorSearching}
        onClose={() => setFilterOpen(false)}
        onSortChange={setSortBy}
        onContentChange={setContentType}
        onMealChange={setMealType}
        onDietGoalChange={setDietGoal}
        onAuthorScopeChange={(scope) => {
          if (!isAuthenticated && scope !== 'public') {
            openLogin()
            return
          }
          setAuthorScope(scope)
        }}
        onAuthorKeywordChange={(value) => {
          setFilterAuthorKeyword(value)
          setFilterAuthorResults([])
        }}
        onAuthorSearch={handleFilterAuthorSearch}
        onAuthorSelect={selectFilterAuthor}
        onAuthorClear={clearFilterAuthor}
      />
      <AddFriendModal
        visible={addFriendOpen}
        searchType={friendSearchType}
        keyword={friendSearchKeyword}
        results={friendSearchResults}
        searchAttempted={friendSearchAttempted}
        error={friendSearchError}
        searching={friendSearching}
        sendingId={friendSendingId}
        onClose={closeAddFriend}
        onSearchTypeChange={handleFriendSearchTypeChange}
        onKeywordChange={handleFriendKeywordChange}
        onSearch={handleFriendSearch}
        onSendRequest={handleFriendRequest}
      />
      <FeedActionModal
        action={feedAction}
        priority={Boolean(feedAction && priorityAuthorIds.includes(String(feedAction.item.author?.id || '').trim()))}
        onClose={() => setFeedAction(null)}
        onSelect={handleFeedActionSelect}
      />
      <FeedReportModal
        item={reportTarget}
        reason={reportReason}
        extra={reportExtra}
        submitting={Boolean(reportTarget && feedMutatingKey === getFeedTargetKey(reportTarget))}
        onReasonChange={setReportReason}
        onExtraChange={setReportExtra}
        onClose={() => {
          setReportTarget(null)
          setReportExtra('')
        }}
        onSubmit={() => void submitFeedReport()}
      />
      <CommunityImagePreviewModal state={imagePreview} onClose={() => setImagePreview(null)} />
      <CommunityCommentComposer
        target={commentTarget}
        value={commentContent}
        error={commentError}
        submitting={commentSubmitting}
        inputRef={commentInputRef}
        onChange={(value) => {
          setCommentContent(value)
          if (commentError) setCommentError('')
        }}
        onClose={() => closeCommentComposer()}
        onSubmit={() => void submitComment()}
      />
    </View>
  )
}

function CommunityImagePreviewModal({ state, onClose }: { state: FeedImagePreviewState; onClose: () => void }) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const scrollRef = useRef<ScrollView | null>(null)
  const images = state?.images || []

  useEffect(() => {
    if (!state) return
    setIndex(state.index)
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ x: state.index * width, animated: false }), 40)
    return () => clearTimeout(timer)
  }, [state, width])

  const goTo = (next: number) => {
    const safe = Math.max(0, Math.min(next, images.length - 1))
    setIndex(safe)
    scrollRef.current?.scrollTo({ x: safe * width, animated: true })
  }

  return (
    <Modal visible={Boolean(state)} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={previewStyles.page}>
        <View style={[previewStyles.header, { paddingTop: Math.max(insets.top, 12) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={({ pressed }) => [previewStyles.closeButton, pressed && previewStyles.controlPressed]} onPress={onClose}>
            <X size={24} color="#ffffff" strokeWidth={2.4} />
          </Pressable>
          <Text style={previewStyles.title} numberOfLines={1}>{state?.title || '图片预览'}</Text>
          <Text style={previewStyles.counter}>{images.length ? `${index + 1}/${images.length}` : ''}</Text>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => setIndex(Math.max(0, Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1)))))}
          style={previewStyles.scroller}
          contentOffset={{ x: (state?.index || 0) * width, y: 0 }}
          accessibilityLabel="动态图片预览"
        >
          {images.map((image, imageIndex) => (
            <View key={`${image}-preview-${imageIndex}`} style={{ width, height }}>
              <Image source={{ uri: image }} style={previewStyles.image} resizeMode="contain" accessibilityLabel={`${state?.title || '动态'}图片 ${imageIndex + 1}`} />
            </View>
          ))}
        </ScrollView>
        {images.length > 1 ? (
          <View style={[previewStyles.controls, { paddingBottom: Math.max(insets.bottom, 18) }]} pointerEvents="box-none">
            <Pressable accessibilityRole="button" accessibilityLabel="上一张图片" accessibilityState={{ disabled: index === 0 }} disabled={index === 0} style={({ pressed }) => [previewStyles.control, index === 0 && previewStyles.controlDisabled, pressed && previewStyles.controlPressed]} onPress={() => goTo(index - 1)}>
              <ChevronLeft size={25} color="#ffffff" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="下一张图片" accessibilityState={{ disabled: index >= images.length - 1 }} disabled={index >= images.length - 1} style={({ pressed }) => [previewStyles.control, index >= images.length - 1 && previewStyles.controlDisabled, pressed && previewStyles.controlPressed]} onPress={() => goTo(index + 1)}>
              <ChevronRight size={25} color="#ffffff" />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

function CommunityCommentComposer({ target, value, error, submitting, inputRef, onChange, onClose, onSubmit }: {
  target: FeedCommentTarget
  value: string
  error: string
  submitting: boolean
  inputRef: RefObject<TextInput | null>
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const insets = useSafeAreaInsets()
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardHeight(event.endCoordinates.height))
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0))
    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])
  if (!target) return null
  const placeholder = target.reply ? `回复 ${target.reply.nickname || '用户'}...` : `评论 ${target.authorName} 的动态...`
  const ready = Boolean(value.trim()) && !submitting
  return (
    <KeyboardAvoidingView
      pointerEvents="box-none"
      style={[styles.commentComposerLayer, { bottom: keyboardHeight || 66 }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.commentComposer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.commentComposerHeader}>
          <Text style={styles.commentComposerContext} numberOfLines={1}>{target.reply ? `回复 ${target.reply.nickname || '用户'}` : `评论 ${target.authorName}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭评论输入" style={({ pressed }) => [styles.commentComposerClose, pressed && styles.pressed]} onPress={onClose} disabled={submitting}>
            <X size={18} color={palette.textSecondary} />
          </Pressable>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.commentComposerError}>{error}</Text> : null}
        <View style={styles.commentComposerMain}>
          <TextInput
            ref={inputRef}
            accessibilityLabel={placeholder}
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={palette.textMuted}
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={onSubmit}
            editable={!submitting}
            style={styles.commentComposerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={target.reply ? '发送回复' : '发送评论'}
            accessibilityState={{ disabled: !ready, busy: submitting }}
            disabled={!ready}
            style={({ pressed }) => [styles.commentComposerSend, !ready && styles.commentComposerSendDisabled, pressed && ready && styles.pressed]}
            onPress={onSubmit}
          >
            {submitting ? <ActivityIndicator size="small" color="#ffffff" /> : <Send size={19} color="#ffffff" strokeWidth={2.4} />}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
function FeedActionModal({ action, priority, onClose, onSelect }: {
  action: FeedActionState
  priority: boolean
  onClose: () => void
  onSelect: (action: 'priority' | 'block' | 'report' | 'edit' | 'delete') => void
}) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const insets = useSafeAreaInsets()
  const item = action?.item
  const isMine = action?.mode === 'manage'
  const title = isMine ? '管理动态' : item?.author?.nickname || '动态操作'
  return (
    <Modal visible={Boolean(action)} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭动态操作" style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.actionSheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.actionSheetTitle}>{title}</Text>
          {isMine ? (
            <>
              <ActionSheetButton icon={Pencil} label="编辑" color={palette.brandStrong} onPress={() => onSelect('edit')} />
              <ActionSheetButton icon={Trash2} label="删除" color={palette.danger} danger onPress={() => onSelect('delete')} />
            </>
          ) : (
            <>
              <ActionSheetButton icon={Heart} label={priority ? '取消特别关注' : '设为特别关注'} color={palette.brandStrong} onPress={() => onSelect('priority')} />
              <ActionSheetButton icon={Ban} label="拉黑用户" color={palette.danger} danger onPress={() => onSelect('block')} />
              <ActionSheetButton icon={Flag} label="举报" color={palette.danger} danger onPress={() => onSelect('report')} />
            </>
          )}
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.sheetCancelButton, pressed && styles.pressed]} onPress={onClose}>
            <Text style={styles.sheetCancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

function ActionSheetButton({ icon: Icon, label, color, danger = false, onPress }: { icon: LucideIcon; label: string; color: string; danger?: boolean; onPress: () => void }) {
  const { isDark } = useColorScheme()
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.actionSheetButton, danger && styles.actionSheetButtonDanger, pressed && styles.pressed]} onPress={onPress}>
      <Icon size={20} color={color} strokeWidth={2.2} />
      <Text style={[styles.actionSheetButtonText, danger && styles.actionSheetButtonTextDanger]}>{label}</Text>
    </Pressable>
  )
}

function FeedReportModal({ item, reason, extra, submitting, onReasonChange, onExtraChange, onClose, onSubmit }: {
  item: CommunityFeedItem | null
  reason: FeedReportReasonValue
  extra: string
  submitting: boolean
  onReasonChange: (reason: FeedReportReasonValue) => void
  onExtraChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={Boolean(item)} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭举报" style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.reportSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.reportHeader}>
            <View style={styles.reportHeaderCopy}>
              <Text style={styles.actionSheetTitle}>举报动态</Text>
              <Text style={styles.reportSubtitle}>请选择最符合的原因，我们会谨慎处理</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭举报" style={({ pressed }) => [styles.reportClose, pressed && styles.pressed]} onPress={onClose}>
              <X size={20} color={palette.textSecondary} />
            </Pressable>
          </View>
          <View accessibilityRole="radiogroup" style={styles.reportReasons}>
            {reportReasons.map((option) => (
              <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: reason === option.value }} style={({ pressed }) => [styles.reportReason, reason === option.value && styles.reportReasonActive, pressed && styles.pressed]} onPress={() => onReasonChange(option.value)}>
                <View style={[styles.reportRadio, reason === option.value && styles.reportRadioActive]}>{reason === option.value ? <View style={styles.reportRadioDot} /> : null}</View>
                <Text style={[styles.reportReasonText, reason === option.value && styles.reportReasonTextActive]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput accessibilityLabel="举报补充说明" value={extra} onChangeText={onExtraChange} placeholder="补充说明（选填）" placeholderTextColor={palette.textMuted} maxLength={200} multiline textAlignVertical="top" style={styles.reportInput} />
          <View style={styles.reportFooter}>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.reportCancel, pressed && styles.pressed]} onPress={onClose} disabled={submitting}>
              <Text style={styles.reportCancelText}>取消</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ busy: submitting, disabled: submitting }} style={({ pressed }) => [styles.reportSubmit, submitting && styles.disabled, pressed && !submitting && styles.pressed]} onPress={onSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.reportSubmitText}>提交举报</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function AddFriendModal({
  visible,
  searchType,
  keyword,
  results,
  searchAttempted,
  error,
  searching,
  sendingId,
  onClose,
  onSearchTypeChange,
  onKeywordChange,
  onSearch,
  onSendRequest,
}: {
  visible: boolean
  searchType: FriendSearchType
  keyword: string
  results: FriendUserItem[]
  searchAttempted: boolean
  error: string
  searching: boolean
  sendingId: string | null
  onClose: () => void
  onSearchTypeChange: (type: FriendSearchType) => void
  onKeywordChange: (value: string) => void
  onSearch: () => void
  onSendRequest: (userId: string) => void
}) {
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const palette = isDark ? darkAddFriendPalette : lightAddFriendPalette
  const sheetStyles = useMemo(() => createAddFriendStyles(palette), [palette])
  const [reduceMotion, setReduceMotion] = useState(false)
  const hasKeyword = keyword.trim().length > 0

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReduceMotion(enabled))
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={sheetStyles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭添加好友" style={sheetStyles.backdrop} onPress={onClose} />
        <View style={[sheetStyles.card, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.header}>
            <View style={sheetStyles.headerCopy}>
              <Text style={sheetStyles.title}>添加好友</Text>
              <Text style={sheetStyles.subtitle}>通过昵称或手机号找到食友</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭添加好友" onPress={onClose} style={({ pressed }) => [sheetStyles.closeButton, pressed && sheetStyles.pressed]}>
              <X size={21} color={palette.textSecondary} />
            </Pressable>
          </View>

          <View accessibilityRole="radiogroup" style={sheetStyles.typeRow}>
            <Pressable accessibilityRole="radio" accessibilityLabel="按昵称搜索" accessibilityState={{ checked: searchType === 'nickname' }} style={({ pressed }) => [sheetStyles.typeButton, searchType === 'nickname' && sheetStyles.typeButtonActive, pressed && sheetStyles.pressed]} onPress={() => onSearchTypeChange('nickname')}>
              <UserRound size={18} color={searchType === 'nickname' ? palette.brandStrong : palette.textSecondary} />
              <Text style={[sheetStyles.typeText, searchType === 'nickname' && sheetStyles.typeTextActive]}>昵称</Text>
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityLabel="按手机号搜索" accessibilityState={{ checked: searchType === 'telephone' }} style={({ pressed }) => [sheetStyles.typeButton, searchType === 'telephone' && sheetStyles.typeButtonActive, pressed && sheetStyles.pressed]} onPress={() => onSearchTypeChange('telephone')}>
              <Phone size={18} color={searchType === 'telephone' ? palette.brandStrong : palette.textSecondary} />
              <Text style={[sheetStyles.typeText, searchType === 'telephone' && sheetStyles.typeTextActive]}>手机号</Text>
            </Pressable>
          </View>

          <View style={sheetStyles.searchRow}>
            <View style={sheetStyles.inputWrap}>
              <Search size={19} color={palette.textMuted} />
              <TextInput accessibilityLabel={searchType === 'telephone' ? '手机号' : '好友昵称'} accessibilityHint="输入后点击搜索" value={keyword} onChangeText={onKeywordChange} onSubmitEditing={onSearch} returnKeyType="search" keyboardType={searchType === 'telephone' ? 'phone-pad' : 'default'} autoCapitalize="none" autoCorrect={false} placeholder={searchType === 'telephone' ? '输入手机号' : '输入昵称'} placeholderTextColor={palette.textMuted} style={sheetStyles.input} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="搜索好友" accessibilityState={{ disabled: !hasKeyword || searching, busy: searching }} style={({ pressed }) => [sheetStyles.searchButton, (!hasKeyword || searching) && sheetStyles.disabled, pressed && hasKeyword && !searching && sheetStyles.pressed]} onPress={onSearch} disabled={!hasKeyword || searching}>
              {searching ? <ActivityIndicator accessibilityLabel="正在搜索好友" size="small" color="#ffffff" /> : <Text style={sheetStyles.searchButtonText}>搜索</Text>}
            </Pressable>
          </View>

          {error ? <View accessibilityRole="alert" style={sheetStyles.errorBox}><CircleAlert size={18} color={palette.danger} /><Text style={sheetStyles.errorText}>{error}</Text></View> : null}

          <ScrollView style={sheetStyles.results} contentContainerStyle={sheetStyles.resultsContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {results.length > 0 ? results.map((user) => {
              const userId = String(user.id || '').trim()
              const name = String(user.nickname || '用户').trim() || '用户'
              const sending = sendingId === userId
              return (
                <View key={userId} style={sheetStyles.resultItem}>
                  {user.avatar ? <Image accessibilityLabel={`${name}的头像`} source={{ uri: user.avatar }} style={sheetStyles.avatar} /> : <View accessibilityLabel={`${name}的默认头像`} style={sheetStyles.avatarFallback}><UserRound size={21} color={palette.brandStrong} /></View>}
                  <Text style={sheetStyles.resultName} numberOfLines={2}>{name}</Text>
                  {user.is_friend ? <View style={sheetStyles.statusPill}><Text style={sheetStyles.statusText}>已添加</Text></View> : user.is_pending ? <View style={sheetStyles.statusPill}><Text style={sheetStyles.statusText}>已发送</Text></View> : (
                    <Pressable accessibilityRole="button" accessibilityLabel={`添加好友${name}`} accessibilityState={{ busy: sending, disabled: Boolean(sendingId) }} style={({ pressed }) => [sheetStyles.requestButton, Boolean(sendingId) && sheetStyles.disabled, pressed && !sendingId && sheetStyles.pressed]} onPress={() => onSendRequest(userId)} disabled={!userId || Boolean(sendingId)}>
                      {sending ? <ActivityIndicator size="small" color={palette.brandStrong} /> : <Text style={sheetStyles.requestButtonText}>加好友</Text>}
                    </Pressable>
                  )}
                </View>
              )
            }) : (
              <View style={sheetStyles.empty}>
                <UserRound size={30} color={palette.textMuted} />
                <Text style={sheetStyles.emptyTitle}>{searchAttempted ? '没有找到匹配用户' : '查找一位食友'}</Text>
                <Text style={sheetStyles.emptyText}>{searchAttempted ? '可以检查关键词，或换一种搜索方式' : '搜索结果只会显示与你输入内容匹配的用户'}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

type AddFriendPalette = {
  surface: string
  surfaceMuted: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  brand: string
  brandStrong: string
  brandSoft: string
  danger: string
  dangerSoft: string
  backdrop: string
  shadow: string
}

const lightAddFriendPalette: AddFriendPalette = {
  surface: '#ffffff', surfaceMuted: '#f3f7f5', text: '#17211d', textSecondary: '#56645e', textMuted: '#74847c', border: '#dfe9e3', brand: '#00a76f', brandStrong: '#087f58', brandSoft: '#e3f7ef', danger: '#c83d3d', dangerSoft: '#fff0f0', backdrop: 'rgba(7, 15, 11, 0.56)', shadow: '#102019',
}

const darkAddFriendPalette: AddFriendPalette = {
  surface: '#18211e', surfaceMuted: '#1f2a26', text: '#f2f7f4', textSecondary: '#b4c1bb', textMuted: '#8fa098', border: '#2a3832', brand: '#69d6ad', brandStrong: '#83e1bc', brandSoft: '#183b2e', danger: '#ff8b8b', dangerSoft: '#402326', backdrop: 'rgba(0, 0, 0, 0.72)', shadow: '#000000',
}

function createAddFriendStyles(palette: AddFriendPalette) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: palette.backdrop },
    card: { width: '100%', maxHeight: '88%', paddingTop: 10, paddingHorizontal: 16, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: { width: 0, height: -8 }, elevation: 16 },
    handle: { alignSelf: 'center', width: 40, height: 4, marginBottom: 14, borderRadius: 2, backgroundColor: palette.border },
    header: { minHeight: 58, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerCopy: { flex: 1, minWidth: 0 },
    title: { color: palette.text, fontSize: 21, lineHeight: 28, fontWeight: '900' },
    subtitle: { marginTop: 2, color: palette.textSecondary, fontSize: 13, lineHeight: 19 },
    closeButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    typeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    typeButton: { flex: 1, minHeight: 48, paddingHorizontal: 12, borderRadius: 24, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted, borderWidth: 1, borderColor: palette.border },
    typeButtonActive: { backgroundColor: palette.brandSoft, borderColor: palette.brand },
    typeText: { color: palette.textSecondary, fontSize: 14, lineHeight: 19, fontWeight: '800' },
    typeTextActive: { color: palette.brandStrong },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    inputWrap: { flex: 1, minWidth: 0, minHeight: 52, paddingLeft: 14, borderRadius: 26, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.surfaceMuted, borderWidth: 1, borderColor: palette.border },
    input: { flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 0, paddingRight: 12, color: palette.text, fontSize: 15 },
    searchButton: { minWidth: 78, minHeight: 48, paddingHorizontal: 16, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    searchButtonText: { color: '#ffffff', fontSize: 14, lineHeight: 19, fontWeight: '900' },
    errorBox: { minHeight: 48, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.dangerSoft, borderWidth: 1, borderColor: palette.danger },
    errorText: { flex: 1, color: palette.text, fontSize: 13, lineHeight: 19 },
    results: { maxHeight: 300 },
    resultsContent: { paddingBottom: 4 },
    resultItem: { minHeight: 72, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.surfaceMuted },
    avatarFallback: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.border },
    resultName: { flex: 1, minWidth: 0, color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
    statusPill: { minWidth: 72, minHeight: 36, paddingHorizontal: 11, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    statusText: { color: palette.brandStrong, fontSize: 12, lineHeight: 17, fontWeight: '800' },
    requestButton: { minWidth: 82, minHeight: 48, paddingHorizontal: 14, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brand },
    requestButtonText: { color: palette.brandStrong, fontSize: 13, lineHeight: 18, fontWeight: '900' },
    empty: { minHeight: 150, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { marginTop: 10, color: palette.text, fontSize: 15, lineHeight: 21, fontWeight: '900', textAlign: 'center' },
    emptyText: { maxWidth: 310, marginTop: 5, color: palette.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.52 },
  })
}
function QuickEntry({ label, icon: Icon, badgeCount, onPress }: { label: string; icon: LucideIcon; badgeCount?: number; onPress: () => void }) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const badgeLabel = badgeCount ? `${label}，${badgeCount > 99 ? '99 条以上' : `${badgeCount} 条`}未读` : label
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={badgeLabel} onPress={onPress} style={({ pressed }) => [styles.quickEntry, pressed && styles.pressed]}>
      <View style={styles.quickEntryIconWrap}>
        <Icon size={22} color={palette.brand} strokeWidth={2.25} />
        {badgeCount ? (
          <View style={styles.quickEntryBadge}>
            <Text style={styles.quickEntryBadgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.quickEntryText} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function RankPreviewCell({ item, rank }: { item: CheckinLeaderboardItem; rank: number }) {
  const { isDark } = useColorScheme()
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const checkinCount = Number(item.checkin_count ?? item.record_count ?? 0)
  return (
    <View style={[styles.rankingPreviewCell, item.is_me && styles.rankingPreviewCellMe]}>
      <Text style={styles.rankingPreviewRank}>#{rank}</Text>
      <View style={styles.rankingPreviewAvatarWrap}>
        {item.avatar ? <Image source={{ uri: item.avatar }} style={styles.rankingPreviewAvatar} /> : <UsersRound size={14} color="rgba(255,255,255,0.88)" />}
      </View>
      <Text style={styles.rankingPreviewName} numberOfLines={1}>{item.nickname || '食友'}</Text>
      <Text style={styles.rankingPreviewCount}>{checkinCount}次</Text>
    </View>
  )
}
function ShortcutChip({ label, onPress }: { label: string; onPress: () => void }) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.shortcutChip, pressed && styles.pressed]} onPress={onPress}>
      <Utensils size={14} color={palette.brandStrong} strokeWidth={2.2} />
      <Text style={styles.shortcutText}>{label}</Text>
    </Pressable>
  )
}

function CommunityFeedCard({
  item,
  onOpen,
  onOpenAuthor,
  onLike,
  onComment,
  onReply,
  onPreviewImages,
  onManage,
  liking,
  busy,
}: {
  item: CommunityFeedItem
  onOpen: () => void
  onOpenAuthor: () => void
  onLike: () => void
  onComment: () => void
  onReply: (comment: FeedCommentItem) => void
  onPreviewImages: (images: string[], index: number) => void
  onManage: () => void
  liking: boolean
  busy: boolean
}) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const images = feedImages(item)
  const body = feedBody(item)
  const title = feedTitle(item)
  const targetType = getFeedTargetType(item)
  const isExercise = targetType === 'exercise_log'
  const isCampus = targetType === 'campus_food'
  const isCircle = targetType === 'circle_post'
  const commentsCount = item.comment_count || item.comments?.length || 0
  const calories = Math.round(Number(isExercise ? item.record.calories_burned : item.record.total_calories) || 0)
  const protein = Math.round(Number(item.record.total_protein) || 0)
  const carbs = Math.round(Number(item.record.total_carbs) || 0)
  const fat = Math.round(Number(item.record.total_fat) || 0)
  const hasNutrition = calories > 0 || protein > 0 || carbs > 0 || fat > 0
  const location = [item.record.school, item.record.canteen].map((part) => String(part || '').trim()).filter(Boolean).join(' · ')
  const price = Number(item.record.price || 0)
  const authorName = item.is_mine ? '我' : item.author.nickname || '食友'

  return (
    <View style={[styles.feedCard, busy && styles.feedCardBusy]}>
      <View style={styles.feedMomentsRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看${authorName}的主页`} style={({ pressed }) => [styles.feedAvatarCol, pressed && styles.pressed]} onPress={onOpenAuthor} hitSlop={8}>
          {item.author.avatar ? <Image source={{ uri: item.author.avatar }} style={styles.userAvatar} /> : <View style={styles.userAvatarFallback}><UserRound size={19} color={palette.brand} /></View>}
        </Pressable>

        <View style={styles.feedMainCol}>
          <Pressable accessibilityRole="button" accessibilityLabel={`查看${authorName}的主页`} style={({ pressed }) => [styles.feedNameBlock, pressed && styles.pressed]} onPress={onOpenAuthor}>
            <Text style={styles.userName} numberOfLines={1}>{authorName}</Text>
            <View style={styles.feedSubMetaRow}>
              <Text style={styles.postTime} numberOfLines={1}>{feedMeta(item)}</Text>
              {feedTag(item) ? <Text style={[styles.feedTagPlain, isExercise && styles.feedTagExercise]} numberOfLines={1}>{feedTag(item)}</Text> : null}
            </View>
          </Pressable>

          <Pressable accessibilityRole="button" accessibilityLabel="查看动态详情" style={({ pressed }) => [styles.feedContentButton, pressed && styles.pressed]} onPress={onOpen}>
            {title ? <Text style={styles.feedContent} numberOfLines={2}>{title}</Text> : null}
            {body ? <Text style={styles.feedContentMuted} numberOfLines={3}>{body}</Text> : null}
          </Pressable>
          {images.length > 0 ? (
            <FeedImageGallery
              images={images}
              circlePost={isCircle}
              onOpenDetail={onOpen}
              onPreview={onPreviewImages}
            />
          ) : null}

          {(isExercise || isCampus || !isCircle || hasNutrition) ? (
            <View style={styles.feedMeta}>
              {isCampus && price > 0 ? <View style={styles.feedPrice}><Text style={styles.feedPriceText}>¥{price.toFixed(price % 1 === 0 ? 0 : 1)}</Text></View> : null}
              <View style={[styles.feedCalorie, isExercise && styles.feedCalorieExercise]}>
                {isExercise ? <Dumbbell size={14} color={palette.exerciseText} /> : null}
                <Text style={[styles.feedCalorieText, isExercise && styles.feedCalorieTextExercise]}>{calories} kcal{isExercise ? ' 消耗' : ''}</Text>
              </View>
              {!isExercise ? (
                <View style={styles.feedMacros}>
                  <Text style={styles.feedMacrosText} numberOfLines={1}>P {protein}g / C {carbs}g / F {fat}g</Text>
                </View>
              ) : Number(item.record.duration_min || 0) > 0 ? <Text style={styles.feedDuration}>{Math.round(Number(item.record.duration_min))} 分钟</Text> : null}
            </View>
          ) : null}
          {isCampus && location ? <View style={styles.feedLocation}><MapPin size={14} color={palette.textMuted} /><Text style={styles.feedLocationText} numberOfLines={1}>{location}</Text></View> : null}

          <View style={styles.feedActions}>
            <View style={styles.feedActionsLeft}>
              <Pressable accessibilityRole="button" accessibilityLabel={item.liked ? '取消点赞' : '点赞'} accessibilityState={{ busy: liking, disabled: liking || busy }} style={({ pressed }) => [styles.actionItem, pressed && !liking && styles.pressed]} onPress={onLike} disabled={liking || busy} hitSlop={8}>
                <Heart size={19} color={item.liked ? palette.danger : palette.textSecondary} fill={item.liked ? palette.danger : 'transparent'} strokeWidth={2.2} />
                <Text style={[styles.actionCount, item.liked && styles.actionCountActive]}>{item.like_count}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`评论，当前${commentsCount}条`} style={({ pressed }) => [styles.actionItem, pressed && styles.pressed]} onPress={onComment} hitSlop={8}>
                <MessageCircle size={19} color={palette.textSecondary} strokeWidth={2.2} />
                <Text style={styles.actionCount}>评论 {commentsCount}</Text>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={item.is_mine ? '管理动态' : '更多操作'} accessibilityState={{ disabled: busy }} style={({ pressed }) => [styles.actionManageBox, pressed && styles.pressed]} onPress={onManage} disabled={busy} hitSlop={8}>
              {item.is_mine ? <Pencil size={18} color={palette.textSecondary} strokeWidth={2.2} /> : <MoreHorizontal size={19} color={palette.textSecondary} strokeWidth={2.3} />}
            </Pressable>
          </View>

          {(item.comments?.length ?? 0) > 0 ? (
            <View style={styles.feedComments}>
              {item.comments?.slice(0, 2).map((comment) => (
                <Pressable key={comment.id} accessibilityRole="button" accessibilityLabel={`回复${comment.nickname || '用户'}：${comment.content}`} style={({ pressed }) => [styles.feedCommentItem, pressed && styles.pressed]} onPress={() => onReply(comment)}>
                  <View style={styles.commentAvatar}>
                    {comment.avatar ? <Image source={{ uri: comment.avatar }} style={styles.commentAvatarImage} /> : <UserRound size={12} color={palette.textMuted} />}
                  </View>
                  <View style={styles.commentBody}>
                    <View style={styles.commentMetaLine}>
                      <Text style={styles.commentAuthor} numberOfLines={1}>{comment.nickname || '用户'}</Text>
                      {comment.reply_to_user_id ? <Text style={styles.commentReplyTo} numberOfLines={1}>回复 {comment.reply_to_nickname || '用户'}</Text> : null}
                    </View>
                    <Text style={styles.commentContentText} numberOfLines={2}>{comment.content}</Text>
                  </View>
                </Pressable>
              ))}
              {commentsCount > 2 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`查看全部${commentsCount}条评论`} style={({ pressed }) => [styles.viewAllCommentsButton, pressed && styles.pressed]} onPress={onOpen}>
                  <Text style={styles.viewAllComments}>查看全部 {commentsCount} 条评论</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function FeedImageGallery({ images, circlePost, onOpenDetail, onPreview }: {
  images: string[]
  circlePost: boolean
  onOpenDetail: () => void
  onPreview: (images: string[], index: number) => void
}) {
  const { isDark } = useColorScheme()
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const [page, setPage] = useState(0)
  const [galleryWidth, setGalleryWidth] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [images.join('|')])

  if (circlePost) {
    return (
      <View style={[styles.feedImageGrid, images.length === 1 && styles.feedImageGridSingle]}>
        {images.map((image, index) => (
          <Pressable
            key={`${image}-${index}`}
            accessibilityRole="imagebutton"
            accessibilityLabel={`预览动态图片 ${index + 1}，共 ${images.length} 张`}
            style={({ pressed }) => [styles.feedImageTile, images.length === 1 && styles.feedImageTileSingle, pressed && styles.feedImagePressed]}
            onPress={() => onPreview(images, index)}
          >
            <Image source={{ uri: image }} style={styles.feedImage} resizeMode="cover" />
          </Pressable>
        ))}
      </View>
    )
  }

  if (images.length === 1) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="查看动态详情" style={({ pressed }) => [styles.feedImageSingle, pressed && styles.feedImagePressed]} onPress={onOpenDetail}>
        <Image source={{ uri: images[0] }} style={styles.feedImage} resizeMode="cover" />
      </Pressable>
    )
  }

  return (
    <View
      style={styles.feedImageCarousel}
      onLayout={(event) => setGalleryWidth(Math.round(event.nativeEvent.layout.width))}
      accessibilityLabel={`动态图片 ${page + 1}，共 ${images.length} 张，可左右滑动`}
    >
      {galleryWidth > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          onMomentumScrollEnd={(event) => setPage(Math.max(0, Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / galleryWidth))))}
          scrollEventThrottle={16}
        >
          {images.map((image, index) => (
            <Pressable
              key={`${image}-slide-${index}`}
              accessibilityRole="imagebutton"
              accessibilityLabel={`预览动态图片 ${index + 1}，共 ${images.length} 张`}
              style={({ pressed }) => [styles.feedImageSlide, { width: galleryWidth }, pressed && styles.feedImagePressed]}
              onPress={() => onPreview(images, index)}
            >
              <Image source={{ uri: image }} style={styles.feedImage} resizeMode="cover" />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.feedImageCounter} pointerEvents="none">
        <Text style={styles.feedImageCounterText}>{page + 1}/{images.length}</Text>
      </View>
    </View>
  )
}
function FeedSkeleton() {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((item) => (
        <View key={item} style={styles.skeletonFeedCard}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonMain}>
            <View style={[styles.skeletonLine, styles.skeletonName]} />
            <View style={[styles.skeletonLine, styles.skeletonTime]} />
            <View style={[styles.skeletonLine, styles.skeletonText]} />
            <View style={[styles.skeletonLine, styles.skeletonTextShort]} />
            <View style={styles.skeletonImage}>
              {item === 1 ? <ActivityIndicator color={palette.brand} /> : null}
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

function FilterDrawer({
  visible,
  sortBy,
  contentType,
  mealType,
  dietGoal,
  authorScope,
  authorId,
  authorName,
  authorKeyword,
  authorResults,
  authorSearching,
  onClose,
  onSortChange,
  onContentChange,
  onMealChange,
  onDietGoalChange,
  onAuthorScopeChange,
  onAuthorKeywordChange,
  onAuthorSearch,
  onAuthorSelect,
  onAuthorClear,
}: {
  visible: boolean
  sortBy: CommunityFeedSortBy
  contentType: CommunityFeedContentType
  mealType: MealType | 'all'
  dietGoal: DietGoal | 'all'
  authorScope: CommunityAuthorScope
  authorId: string
  authorName: string
  authorKeyword: string
  authorResults: FriendUserItem[]
  authorSearching: boolean
  onClose: () => void
  onSortChange: (value: CommunityFeedSortBy) => void
  onContentChange: (value: CommunityFeedContentType) => void
  onMealChange: (value: MealType | 'all') => void
  onDietGoalChange: (value: DietGoal | 'all') => void
  onAuthorScopeChange: (value: CommunityAuthorScope) => void
  onAuthorKeywordChange: (value: string) => void
  onAuthorSearch: () => void
  onAuthorSelect: (author: FriendUserItem) => void
  onAuthorClear: () => void
}) {
  const { isDark } = useColorScheme()
  const palette = isDark ? darkCommunityPalette : lightCommunityPalette
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  const [reduceMotion, setReduceMotion] = useState(false)
  const showMealAndGoal = contentType !== 'exercise_log' && contentType !== 'campus_food'

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReduceMotion(enabled))
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.filterDrawerMask} onPress={onClose}>
        <Pressable style={styles.filterDrawer} onPress={(event) => event.stopPropagation()}>
          <View style={styles.filterDrawerHandle} />
          <View style={styles.filterDrawerHeader}>
            <Text style={styles.filterDrawerTitle}>更多筛选</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="完成筛选" style={({ pressed }) => [styles.filterDoneButton, pressed && styles.pressed]} onPress={onClose}>
              <Text style={styles.filterDrawerDone}>完成</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.filterDrawerScroll} contentContainerStyle={styles.filterDrawerScrollContent} keyboardShouldPersistTaps="handled">
            <FilterGroup title="排序">
              {sortOptions.map((option) => (
                <FilterChip key={option.value} label={option.label} active={sortBy === option.value} onPress={() => onSortChange(option.value)} />
              ))}
            </FilterGroup>
            <FilterGroup title="内容">
              {contentOptions.map((option) => (
                <FilterChip key={option.value} label={option.label} active={contentType === option.value} onPress={() => onContentChange(option.value)} />
              ))}
            </FilterGroup>
            <FilterGroup title="来源">
              {authorScopeOptions.map((option) => (
                <FilterChip key={option.value} label={option.label} active={!authorId && authorScope === option.value} onPress={() => {
                  onAuthorClear()
                  onAuthorScopeChange(option.value)
                }} />
              ))}
            </FilterGroup>
            {showMealAndGoal ? (
              <>
                <FilterGroup title="餐次">
                  {mealOptions.map((option) => (
                    <FilterChip key={option.value} label={option.label} active={mealType === option.value} onPress={() => onMealChange(option.value)} />
                  ))}
                </FilterGroup>
                <FilterGroup title="目标">
                  {dietGoalOptions.map((option) => (
                    <FilterChip key={option.value} label={option.label} active={dietGoal === option.value} onPress={() => onDietGoalChange(option.value)} />
                  ))}
                </FilterGroup>
              </>
            ) : null}
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>指定好友作者</Text>
              {authorId ? (
                <View style={styles.filterSelectedAuthor}>
                  <Text style={styles.filterSelectedAuthorText} numberOfLines={1}>{authorName || '已选作者'}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="清除指定作者" style={({ pressed }) => [styles.filterClearButton, pressed && styles.pressed]} onPress={onAuthorClear}>
                    <Text style={styles.filterSelectedAuthorClear}>清除</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <View style={styles.filterAuthorSearchRow}>
                    <TextInput
                      value={authorKeyword}
                      onChangeText={onAuthorKeywordChange}
                      onSubmitEditing={onAuthorSearch}
                      returnKeyType="search"
                      placeholder="输入好友昵称"
                      placeholderTextColor={palette.textMuted}
                      style={styles.filterAuthorInput}
                    />
                    <Pressable
                      style={[styles.filterAuthorSearchButton, (!authorKeyword.trim() || authorSearching) && styles.filterAuthorSearchButtonDisabled]}
                      onPress={onAuthorSearch}
                      disabled={!authorKeyword.trim() || authorSearching}
                    >
                      {authorSearching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.filterAuthorSearchButtonText}>搜索</Text>}
                    </Pressable>
                  </View>
                  {authorResults.map((author) => (
                    <Pressable key={author.id} style={styles.filterAuthorResult} onPress={() => onAuthorSelect(author)}>
                      {author.avatar ? <Image source={{ uri: author.avatar }} style={styles.filterAuthorAvatar} /> : <View style={styles.filterAuthorAvatarFallback}><UserRound size={15} color={palette.brand} /></View>}
                      <Text style={styles.filterAuthorResultName} numberOfLines={1}>{author.nickname || '用户'}</Text>
                      <Text style={styles.filterAuthorSelectText}>选择</Text>
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  const { isDark } = useColorScheme()
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{title}</Text>
      <View style={styles.filterChipRow}>{children}</View>
    </View>
  )
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { isDark } = useColorScheme()
  const styles = isDark ? darkCommunityStyles : lightCommunityStyles
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.pressed]} onPress={onPress}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  )
}

function feedTitle(item: CommunityFeedItem): string {
  const record = item.record
  const targetType = item.target_type || record.feed_type || 'food_record'
  if (targetType === 'exercise_log') return String(record.exercise_desc || record.description || record.exercise_type || '运动打卡').trim()
  if (targetType === 'circle_post') return String(record.title || record.body || '分享了一条动态').trim()
  return String(record.title || record.description || record.items?.[0]?.name || '分享了一条饮食动态').trim()
}

function feedBody(item: CommunityFeedItem): string {
  const record = item.record
  const targetType = item.target_type || record.feed_type || 'food_record'
  const value = targetType === 'circle_post'
    ? String(record.body || '').trim()
    : String(record.insight || '').trim()
  return value && value !== feedTitle(item) ? value : ''
}

function feedImages(item: CommunityFeedItem): string[] {
  if (getFeedTargetType(item) === 'exercise_log') return []
  const paths = Array.isArray(item.record.image_paths) ? item.record.image_paths : []
  const single = String(item.record.image_path || '').trim()
  return Array.from(new Set([...paths, single].map((value) => String(value || '').trim()).filter(Boolean)))
}

function feedRecordDate(item: CommunityFeedItem): string {
  const raw = String(item.record.record_time || item.record.created_at || '').trim()
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] || todayKey()
}
function feedMeta(item: CommunityFeedItem): string {
  const type = (item.target_type || item.record.feed_type || 'food_record') as CommunityFeedTargetType
  const label = type === 'circle_post'
    ? '自定义动态'
    : type === 'exercise_log'
      ? '运动打卡'
      : type === 'campus_food'
        ? '校园食堂'
        : mealLabel(item.record.meal_type)
  return `${label} · ${formatDateTime(item.record.record_time || item.record.created_at)}`
}

function feedTag(item: CommunityFeedItem): string {
  const type = item.target_type || item.record.feed_type || 'food_record'
  if (type === 'exercise_log') return item.record.exercise_type || '运动'
  if (type === 'campus_food') return '校园食堂'
  if (item.record.diet_goal && item.record.diet_goal !== 'none') return dietGoalLabel(item.record.diet_goal)
  return ''
}

function mealLabel(value?: string | null): string {
  const labels: Record<string, string> = {
    breakfast: '早餐',
    morning_snack: '早加餐',
    lunch: '午餐',
    afternoon_snack: '午加餐',
    dinner: '晚餐',
    evening_snack: '晚加餐',
    snack: '加餐',
  }
  return value ? labels[value] || value : '饮食记录'
}

function dietGoalLabel(value: string): string {
  const labels: Record<string, string> = {
    fat_loss: '减脂',
    muscle_gain: '增肌',
    maintain: '维持',
  }
  return labels[value] || value
}

function getFeedTargetType(item: CommunityFeedItem): CommunityFeedTargetType {
  return (item.target_type || item.record.feed_type || 'food_record') as CommunityFeedTargetType
}

function getFeedTargetId(item: CommunityFeedItem): string {
  return String(item.target_id || item.record.id || '').trim()
}

function getFeedTargetKey(item: CommunityFeedItem): string {
  return `${getFeedTargetType(item)}:${getFeedTargetId(item)}`
}

function dedupeFeedItems(list: CommunityFeedItem[]): CommunityFeedItem[] {
  const seen = new Set<string>()
  return list.filter((item) => {
    const key = getFeedTargetKey(item)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function appendUniqueFeedItems(current: CommunityFeedItem[], incoming: CommunityFeedItem[]): { list: CommunityFeedItem[]; added: number } {
  const known = new Set(current.map(getFeedTargetKey))
  const next = [...current]
  let added = 0
  for (const item of incoming) {
    const key = getFeedTargetKey(item)
    if (!key || known.has(key)) continue
    known.add(key)
    next.push(item)
    added += 1
  }
  return { list: next, added }
}

function buildFeedQueryKey(params: CommunityFeedQueryParams): string {
  return JSON.stringify({
    sort_by: params.sort_by || 'latest',
    content_type: params.content_type || 'all',
    meal_type: params.meal_type || '',
    diet_goal: params.diet_goal || '',
    author_scope: params.author_scope || 'public',
    author_id: params.author_id || '',
    priority_author_ids: params.priority_author_ids || [],
  })
}

function feedCacheStorageKey(userId: string, queryKey: string): string {
  return `${feedCachePrefix}${encodeURIComponent(userId)}:${encodeURIComponent(queryKey)}`
}

function commentDraftStorageKey(userId: string, targetType: CommunityFeedTargetType, targetId: string): string {
  return `${commentDraftPrefix}${userId || 'guest'}:${targetType}:${targetId}`
}
function priorityAuthorsStorageKey(userId: string): string {
  return `${priorityAuthorsPrefix}${encodeURIComponent(userId)}`
}

function feedFiltersStorageKey(userId: string): string {
  return `${feedFiltersPrefix}${encodeURIComponent(userId)}`
}

async function readPriorityAuthorIds(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(priorityAuthorsStorageKey(userId))
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(parsed.map((id) => String(id || '').trim()).filter(Boolean)))
  } catch {
    return []
  }
}

async function readFeedFilterPreferences(userId: string): Promise<FeedFilterPreferences | null> {
  try {
    const raw = await AsyncStorage.getItem(feedFiltersStorageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FeedFilterPreferences>
    const sortBy = sortOptions.some((option) => option.value === parsed.sortBy) ? parsed.sortBy! : 'latest'
    const contentType = contentOptions.some((option) => option.value === parsed.contentType) ? parsed.contentType! : 'all'
    const mealType = mealOptions.some((option) => option.value === parsed.mealType) ? parsed.mealType! : 'all'
    const dietGoal = dietGoalOptions.some((option) => option.value === parsed.dietGoal) ? parsed.dietGoal! : 'all'
    const authorScope = authorScopeOptions.some((option) => option.value === parsed.authorScope) ? parsed.authorScope! : 'public'
    return {
      sortBy,
      contentType,
      mealType,
      dietGoal,
      authorScope,
      authorId: String(parsed.authorId || '').trim(),
      authorName: String(parsed.authorName || '').trim(),
    }
  } catch {
    return null
  }
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

type CommunityPalette = {
  background: string
  surface: string
  surfaceMuted: string
  surfaceRaised: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  brand: string
  brandStrong: string
  brandSoft: string
  danger: string
  dangerSoft: string
  orange: string
  exerciseText: string
  author: string
  backdrop: string
  shadow: string
  skeleton: string
}

const lightCommunityPalette: CommunityPalette = {
  background: '#f7faf8', surface: '#ffffff', surfaceMuted: '#f4f7f5', surfaceRaised: '#ffffff', text: '#17211d', textSecondary: '#58665f', textMuted: '#7b8982', border: '#dfe8e3', brand: '#00a873', brandStrong: '#087f59', brandSoft: '#e6f7f0', danger: '#d04444', dangerSoft: '#fff0f0', orange: '#e7862c', exerciseText: '#9a5515', author: '#456b60', backdrop: 'rgba(8, 18, 13, 0.56)', shadow: '#102019', skeleton: '#e4ece8',
}

const darkCommunityPalette: CommunityPalette = {
  background: '#101714', surface: '#18211e', surfaceMuted: '#1e2925', surfaceRaised: '#202b27', text: '#f2f7f4', textSecondary: '#b9c5bf', textMuted: '#8fa098', border: '#2d3b35', brand: '#43c795', brandStrong: '#79ddb7', brandSoft: '#193b2e', danger: '#ff8585', dangerSoft: '#402326', orange: '#f0a458', exerciseText: '#f4b873', author: '#91d8bf', backdrop: 'rgba(0, 0, 0, 0.72)', shadow: '#000000', skeleton: '#2a3732',
}

function createCommunityStyles(palette: CommunityPalette) {
  return StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: palette.background,
  },
  loginTip: {
    minHeight: 58,
    marginTop: 12,
    marginHorizontal: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.2)',
    backgroundColor: '#f0fdf4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  loginTipText: {
    flex: 1,
    color: '#315f4d',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  loginTipButton: {
    minWidth: 78,
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brand,
  },
  loginTipButtonText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  topWash: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 260,
    backgroundColor: 'rgba(92,184,150,0.08)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 0,
  },
  pressed: {
    opacity: 0.74,
  },
  quickBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: hairline,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  quickEntry: {
    flex: 1,
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: softBorder,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingTop: 13,
    paddingHorizontal: 5,
    backgroundColor: 'transparent',
  },
  quickEntryText: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  quickEntryIconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickEntryBadge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.danger,
  },
  quickEntryBadgeText: {
    color: '#fff',
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '800',
  },
  rankingBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: palette.brand,
    shadowColor: palette.brandStrong,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  rankingHubHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rankingIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  rankingHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rankingTitle: {
    color: '#fff',
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '800',
  },
  rankingSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  rankingPreview: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.22)',
  },
  rankingPreviewRow: {
    flexDirection: 'row',
    gap: 8,
  },
  rankingPreviewCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  rankingPreviewCellMe: {
    backgroundColor: 'rgba(255,255,255,0.19)',
  },
  rankingPreviewRank: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  rankingPreviewAvatarWrap: {
    width: 30,
    height: 30,
    marginTop: 3,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  rankingPreviewAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  rankingPreviewName: {
    color: '#fff',
    width: 72,
    marginTop: 4,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  rankingPreviewCount: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
  },
  rankingPreviewPlaceholder: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  rankingFreshness: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '700',
  },
  rankingColumns: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  rankingColumn: {
    flex: 1,
    minWidth: 0,
  },
  rankingColumnDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  rankingColumnHead: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rankingColumnTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  rankingChips: {
    minHeight: 48,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
  },
  rankingChip: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 3,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.11)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankingChipActive: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 3,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankingChipText: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  rankingChipActiveText: {
    color: '#fff',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  rankingPreviewItem: {
    minHeight: 38,
    marginTop: 4,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rankingPreviewItemMe: {
    backgroundColor: 'rgba(255,255,255,0.17)',
  },
  rankingRank: {
    width: 12,
    color: '#fef3c6',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  rankingRankFirst: {
    color: '#fef08a',
  },
  rankingRankSecond: {
    color: '#f1f5f9',
  },
  rankingRankThird: {
    color: '#fed7aa',
  },
  rankingAvatarWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  rankingAvatar: {
    width: '100%',
    height: '100%',
  },
  rankingName: {
    flex: 1,
    minWidth: 0,
    color: '#fff',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
  },
  rankingCount: {
    color: '#fef3c6',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  rankingSkeletonWrap: {
    minHeight: 80,
    paddingTop: 8,
    gap: 12,
  },
  rankingSkeletonLine: {
    height: 28,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  rankingSkeletonLineShort: {
    width: '82%',
  },
  rankingEmptyText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  rankingMore: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  rankingMoreText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  feedSection: {
    backgroundColor: 'transparent',
  },
  feedSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  feedSectionTitle: {
    color: palette.text,
    fontSize: compactFont(18, 17),
    lineHeight: 23,
    fontWeight: '700',
  },
  feedSectionLink: {
    color: palette.brandStrong,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  feedFilterPanel: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(92,184,150,0.1)',
  },
  feedFilterTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedSearchWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: softBorder,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
  },
  feedSearchText: {
    flex: 1,
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  feedFilterTrigger: {
    minHeight: 48,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  feedFilterFunnelBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: softBorder,
  },
  feedFilterFunnelBtnActive: {
    borderColor: palette.brand,
    backgroundColor: 'rgba(92,184,150,0.08)',
  },
  feedFilterSummary: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  feedFilterSummaryActive: {
    color: palette.brandStrong,
  },
  feedPublishBtn: {
    minHeight: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    backgroundColor: '#00bc7d',
  },
  feedPublishText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  secondaryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  shortcutChip: {
    minHeight: 28,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    backgroundColor: palette.brandSoft,
  },
  shortcutText: {
    color: palette.brandStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  feedList: {
    backgroundColor: 'transparent',
  },
  feedEmpty: {
    paddingHorizontal: 12,
    paddingVertical: 36,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: hairline,
  },
  feedEmptyText: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  feedCard: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: hairline,
  },
  feedMomentsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  feedAvatarCol: {
    width: 40,
    alignItems: 'center',
    flexShrink: 0,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.brandSoft,
  },
  userAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandSoft,
  },
  feedMainCol: {
    flex: 1,
    minWidth: 0,
  },
  feedNameBlock: {
    gap: 3,
    marginBottom: 7,
  },
  userName: {
    color: palette.author,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  feedSubMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  postTime: {
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  feedTagPlain: {
    color: palette.brandStrong,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: palette.brandSoft,
  },
  feedTagExercise: {
    color: palette.brandStrong,
    backgroundColor: palette.brandSoft,
  },
  feedContent: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: 6,
  },
  feedContentMuted: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  feedImage: {
    width: '100%',
    height: '100%',
    backgroundColor: palette.brandSoft,
  },
  feedMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  feedCalorie: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: palette.brand,
    shadowColor: palette.brand,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  feedCalorieExercise: {
    backgroundColor: palette.orange,
  },
  feedCalorieText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  feedMacros: {
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
  },
  feedMacrosExercise: {
    borderColor: '#99f6e4',
    backgroundColor: palette.brandSoft,
  },
  feedMacrosText: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  feedMacrosTextExercise: {
    color: palette.brandStrong,
  },
  feedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    marginTop: 9,
  },
  feedActionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  actionItem: {
    minHeight: 48,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  actionCountActive: {
    color: palette.danger,
  },
  actionManageBox: {
    width: 48,
    height: 48,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  feedComments: {
    marginTop: 8,
    paddingHorizontal: 7,
    paddingVertical: 7,
    borderRadius: 4,
    backgroundColor: palette.surfaceMuted,
  },
  loadMoreFooter: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: hairline,
  },
  loadMoreText: {
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  feedCommentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginBottom: 7,
  },
  commentAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.skeleton,
    flexShrink: 0,
  },
  commentAvatarImage: {
    width: '100%',
    height: '100%',
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentAuthor: {
    color: palette.author,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  commentMetaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
  commentReplyTo: { flexShrink: 1, color: palette.textMuted, fontSize: 11, lineHeight: 16 },
  viewAllCommentsButton: { minHeight: 44, justifyContent: 'center' },  commentContentText: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 19,
  },
  skeletonContainer: {
    backgroundColor: 'transparent',
  },
  skeletonFeedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: hairline,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.skeleton,
  },
  skeletonMain: {
    flex: 1,
    minWidth: 0,
  },
  skeletonLine: {
    borderRadius: 4,
    backgroundColor: palette.skeleton,
  },
  skeletonName: {
    width: 90,
    height: 16,
  },
  skeletonTime: {
    width: 130,
    height: 12,
    marginTop: 6,
  },
  skeletonText: {
    width: '100%',
    height: 13,
    marginTop: 14,
  },
  skeletonTextShort: {
    width: '76%',
    height: 13,
    marginTop: 7,
  },
  skeletonImage: {
    width: '100%',
    height: 192,
    borderRadius: 4,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.skeleton,
  },
  addFriendMask: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: palette.backdrop,
  },
  addFriendCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '78%',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: palette.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  addFriendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  addFriendTitle: {
    color: palette.text,
    fontSize: compactFont(18, 17),
    lineHeight: 24,
    fontWeight: '800',
  },
  addFriendCloseText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  addFriendTypeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  addFriendTypeBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
  },
  addFriendTypeBtnActive: {
    borderColor: 'rgba(92,184,150,0.46)',
    backgroundColor: palette.brandSoft,
  },
  addFriendTypeText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  addFriendTypeTextActive: {
    color: palette.brandStrong,
  },
  addFriendSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  addFriendInput: {
    flex: 1,
    minWidth: 0,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingHorizontal: 14,
    color: palette.text,
    fontSize: 14,
    lineHeight: 18,
    backgroundColor: palette.surfaceMuted,
  },
  addFriendSearchBtn: {
    width: 76,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brand,
  },
  addFriendSearchBtnDisabled: {
    opacity: 0.5,
  },
  addFriendSearchText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  addFriendResults: {
    maxHeight: 280,
  },
  addFriendResultsContent: {
    paddingBottom: 2,
  },
  addFriendResultItem: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  addFriendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandSoft,
  },
  addFriendAvatarImage: {
    width: '100%',
    height: '100%',
  },
  addFriendResultMain: {
    flex: 1,
    minWidth: 0,
  },
  addFriendResultName: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  addFriendStatus: {
    flexShrink: 0,
    minWidth: 58,
    textAlign: 'center',
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  addFriendStatusAdded: {
    color: palette.brandStrong,
  },
  addFriendRequestBtn: {
    minWidth: 70,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: palette.brandSoft,
  },
  addFriendRequestBtnDisabled: {
    opacity: 0.58,
  },
  addFriendRequestText: {
    color: palette.brandStrong,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  addFriendEmpty: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  addFriendEmptyText: {
    color: palette.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  filterDrawerMask: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: palette.backdrop,
  },
  filterDrawer: {
    maxHeight: '82%',
    paddingTop: 8,
    paddingHorizontal: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: palette.surface,
  },
  filterDrawerScroll: {
    flexGrow: 0,
  },
  filterDrawerScrollContent: {
    paddingBottom: 4,
  },
  filterDrawerHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#d1d5db',
    marginBottom: 12,
  },
  filterDrawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  filterDrawerTitle: {
    color: palette.text,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
  },
  filterDoneButton: {
    minWidth: 56,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDrawerDone: {
    color: palette.brandStrong,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  filterGroup: {
    marginBottom: 16,
  },
  filterLabel: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  filterChipActive: {
    borderColor: 'rgba(92,184,150,0.42)',
    backgroundColor: palette.brandSoft,
  },
  filterChipText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: palette.brandStrong,
  },
  filterSelectedAuthor: {
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    backgroundColor: palette.brandSoft,
  },
  filterSelectedAuthorText: {
    flex: 1,
    color: palette.brandStrong,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  filterClearButton: {
    minWidth: 52,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSelectedAuthorClear: {
    color: palette.danger,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  filterAuthorSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterAuthorInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingHorizontal: 14,
    color: palette.text,
    fontSize: 14,
    backgroundColor: palette.surfaceMuted,
  },
  filterAuthorSearchButton: {
    minWidth: 72,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brand,
  },
  filterAuthorSearchButtonDisabled: {
    opacity: 0.5,
  },
  filterAuthorSearchButtonText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  filterAuthorResult: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  filterAuthorAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  filterAuthorAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandSoft,
  },
  filterAuthorResultName: {
    flex: 1,
    minWidth: 0,
    color: palette.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  filterAuthorSelectText: {
    color: palette.brandStrong,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  feedContentButton: {
    borderRadius: 8,
  },
  feedCardBusy: {
    opacity: 0.58,
  },
  feedImageSingle: {
    width: '100%', height: 210, marginTop: 6, marginBottom: 10, overflow: 'hidden', borderRadius: 8, backgroundColor: palette.brandSoft,
  },
  feedImageCarousel: {
    position: 'relative', width: '100%', height: 220, marginTop: 6, marginBottom: 10, overflow: 'hidden', borderRadius: 8, backgroundColor: palette.brandSoft,
  },
  feedImageSlide: { height: 220, overflow: 'hidden', backgroundColor: palette.brandSoft },
  feedImageCounter: {
    position: 'absolute', right: 10, bottom: 10, minWidth: 42, height: 28, paddingHorizontal: 9, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.68)',
  },
  feedImageCounterText: { color: '#ffffff', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  feedImagePressed: { opacity: 0.82 },  feedImageGrid: {
    marginTop: 6,
    marginBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  feedImageGridSingle: {
    maxWidth: 300,
  },
  feedImageTile: {
    position: 'relative',
    width: '48.8%',
    aspectRatio: 1,
    overflow: 'hidden',
    borderRadius: 6,
    backgroundColor: palette.brandSoft,
  },
  feedImageTileSingle: {
    width: '100%',
    aspectRatio: 1.42,
  },
  feedImageMore: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  feedImageMoreText: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
  },
  feedPrice: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.dangerSoft,
  },
  feedPriceText: {
    color: palette.danger,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '900',
  },
  feedCalorieTextExercise: {
    color: '#fff',
  },
  feedDuration: {
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  feedLocation: {
    minHeight: 30,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  feedLocationText: {
    flex: 1,
    minWidth: 0,
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  viewAllComments: {
    marginTop: 2,
    color: palette.brandStrong,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  inlineErrorBanner: {
    minHeight: 52,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: palette.danger,
    backgroundColor: palette.dangerSoft,
  },
  inlineErrorText: {
    flex: 1,
    minWidth: 0,
    color: palette.text,
    fontSize: 12,
    lineHeight: 18,
  },
  inlineRetryButton: {
    minWidth: 56,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  inlineRetryText: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  feedErrorState: {
    minHeight: 220,
    paddingHorizontal: 28,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  feedErrorTitle: {
    marginTop: 10,
    color: palette.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  feedErrorMessage: {
    marginTop: 5,
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  feedErrorRetry: {
    minWidth: 116,
    minHeight: 48,
    marginTop: 16,
    paddingHorizontal: 18,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brand,
  },
  feedErrorRetryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  loadMoreRetry: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  loadMoreRetryText: {
    color: palette.danger,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: palette.backdrop,
  },
  actionSheet: {
    paddingTop: 10,
    paddingHorizontal: 14,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: palette.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  reportSheet: {
    maxHeight: '92%',
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: palette.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    marginBottom: 12,
    borderRadius: 2,
    backgroundColor: palette.border,
  },
  actionSheetTitle: {
    marginBottom: 12,
    color: palette.text,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '900',
  },
  actionSheetButton: {
    minHeight: 52,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
  },
  actionSheetButtonDanger: {
    backgroundColor: palette.dangerSoft,
  },
  actionSheetButtonText: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  actionSheetButtonTextDanger: {
    color: palette.danger,
  },
  sheetCancelButton: {
    minHeight: 52,
    marginTop: 2,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  sheetCancelText: {
    color: palette.textSecondary,
    fontSize: 15,
    fontWeight: '800',
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  reportHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  reportSubtitle: {
    marginTop: -8,
    marginBottom: 14,
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  reportClose: {
    width: 48,
    height: 48,
    marginTop: -6,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  reportReasons: {
    gap: 8,
  },
  reportReason: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
  },
  reportReasonActive: {
    borderColor: palette.brand,
    backgroundColor: palette.brandSoft,
  },
  reportRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.textMuted,
  },
  reportRadioActive: {
    borderColor: palette.brand,
  },
  reportRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.brand,
  },
  reportReasonText: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  reportReasonTextActive: {
    color: palette.brandStrong,
  },
  reportInput: {
    minHeight: 92,
    maxHeight: 130,
    marginTop: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 14,
    color: palette.text,
    fontSize: 14,
    lineHeight: 20,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceMuted,
  },
  reportFooter: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 9,
  },
  reportCancel: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceMuted,
  },
  reportCancelText: {
    color: palette.textSecondary,
    fontSize: 14,
    fontWeight: '800',
  },
  reportSubmit: {
    flex: 1.5,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.danger,
  },
  reportSubmitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  commentComposerLayer: {
    ...StyleSheet.absoluteFill, zIndex: 40, elevation: 40, justifyContent: 'flex-end',
  },
  commentComposer: {
    paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border,
    backgroundColor: palette.surface, shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 }, elevation: 16,
  },
  commentComposerHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  commentComposerContext: { flex: 1, minWidth: 0, color: palette.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  commentComposerClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  commentComposerError: { marginBottom: 6, color: palette.danger, fontSize: 12, lineHeight: 17 },
  commentComposerMain: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentComposerInput: {
    flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 15, paddingVertical: 0, borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, color: palette.text, backgroundColor: palette.surfaceMuted, fontSize: 14,
  },
  commentComposerSend: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
  commentComposerSendDisabled: { opacity: 0.42 },  disabled: {
    opacity: 0.5,
  },
  })
}

const lightCommunityStyles = createCommunityStyles(lightCommunityPalette)
const darkCommunityStyles = createCommunityStyles(darkCommunityPalette)

const previewStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000000' },
  header: {
    position: 'absolute', left: 0, right: 0, top: 0, zIndex: 3, minHeight: 76, paddingHorizontal: 12, paddingBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.62)',
  },
  closeButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, color: '#ffffff', fontSize: 15, lineHeight: 21, fontWeight: '700', textAlign: 'center' },
  counter: { minWidth: 48, color: '#ffffff', fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  scroller: { flex: 1 },
  image: { width: '100%', height: '100%' },
  controls: { position: 'absolute', left: 18, right: 18, bottom: 0, zIndex: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  control: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)' },
  controlDisabled: { opacity: 0.28 },
  controlPressed: { opacity: 0.68 },
})