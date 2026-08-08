import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ActivityIndicator, Alert, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
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
  MealType,
} from '@food-link/core'
import {
  ChevronRight,
  Filter,
  Heart,
  MessageCircle,
  MoreHorizontal,
  PenLine,
  Search,
  Trophy,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native'
import { apiClient, getStoredUserId } from '../api'
import { IconfontText } from '../components/Iconfont'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, compactFont, radius } from '../theme'
import { formatDateTime } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'

const hairline = 'rgba(92,184,150,0.14)'
const softBorder = 'rgba(92,184,150,0.18)'
const authorBlue = '#576b95'
const feedPageSize = 10
const feedCacheTtlMs = 5 * 60 * 1000
const feedCachePrefix = 'mobile_community_feed_v2:'
const priorityAuthorsPrefix = 'mobile_community_priority_authors_v1:'
const feedFiltersPrefix = 'mobile_community_filters_v1:'

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

export function CommunityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [feed, setFeed] = useState<CommunityFeedItem[]>([])
  const feedRef = useRef<CommunityFeedItem[]>([])
  const [leaderboard, setLeaderboard] = useState<CheckinLeaderboardItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
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
  const [friendSearching, setFriendSearching] = useState(false)
  const [friendSendingId, setFriendSendingId] = useState<string | null>(null)
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
    author_scope: filterAuthorId ? 'all' : authorScope,
    priority_author_ids: filterAuthorId || authorScope !== 'priority' ? undefined : priorityAuthorIds,
    author_id: filterAuthorId || undefined,
  }), [authorScope, contentType, dietGoal, filterAuthorId, mealType, priorityAuthorIds, sortBy])
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
        apiClient.communityGetFeed({ offset: 0, limit: feedPageSize, includeComments: true, commentsLimit: 5, params: queryParams }),
        apiClient.communityGetCheckinLeaderboard().catch(() => ({ list: [] as CheckinLeaderboardItem[], week_start: '', week_end: '' })),
      ])
      if (requestGenerationRef.current !== requestGeneration) return
      const list = dedupeFeedItems(feedData.list || [])
      const nextHasMore = feedData.has_more ?? list.length >= feedPageSize
      applyFeed(list)
      setHasMore(nextHasMore)
      setLeaderboard(leaderboardData.list || [])
      await saveFeedCache(list, nextHasMore)
    } catch (error) {
      if (requestGenerationRef.current === requestGeneration && !cacheShown) {
        void dialog.alert('获取圈子失败', userFacingErrorMessage(error), 'danger')
      }
    } finally {
      if (requestGenerationRef.current === requestGeneration) setLoading(false)
    }
  }, [applyFeed, dialog, queryKey, queryParams, saveFeedCache, sessionUserId])

  const loadMore = useCallback(async () => {
    if (!sessionUserId || loadingMoreRef.current || !hasMore || loading) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const requestGeneration = requestGenerationRef.current
    const offset = feedRef.current.length
    try {
      const data = await apiClient.communityGetFeed({
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
        void dialog.alert('加载更多失败', userFacingErrorMessage(error), 'danger')
      }
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [applyFeed, dialog, hasMore, loading, queryParams, saveFeedCache, sessionUserId])

  useFocusEffect(
    useCallback(() => {
      let active = true
      void (async () => {
        const nextUserId = String(await getStoredUserId() || 'guest').trim() || 'guest'
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
          setAuthorScope(storedFilters.authorScope)
          setFilterAuthorId(storedFilters.authorId)
          setFilterAuthorName(storedFilters.authorName)
        }
        setAccountReady(true)
      })()
      return () => {
        active = false
      }
    }, []),
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
    const targetId = item.target_id || item.record.id
    const targetType = item.target_type || item.record.feed_type || 'food_record'
    const itemKey = getFeedTargetKey(item)
    const previous = feedRef.current
    const next = previous.map((entry) => (
      getFeedTargetKey(entry) === itemKey ? { ...entry, liked: !entry.liked, like_count: Math.max(0, entry.like_count + (entry.liked ? -1 : 1)) } : entry
    ))
    applyFeed(next)
    void saveFeedCache(next, hasMore)
    try {
      if (item.liked) await apiClient.communityUnlike(targetId, targetType)
      else await apiClient.communityLike(targetId, targetType)
    } catch (error) {
      applyFeed(previous)
      void saveFeedCache(previous, hasMore)
      void dialog.alert('操作失败', userFacingErrorMessage(error), 'danger')
    }
  }

  const closeAddFriend = useCallback(() => {
    setAddFriendOpen(false)
    setFriendSearchKeyword('')
    setFriendSearchResults([])
    setFriendSearchAttempted(false)
    setFriendSendingId(null)
  }, [])

  const handleFriendSearchTypeChange = useCallback((type: FriendSearchType) => {
    setFriendSearchType(type)
    setFriendSearchResults([])
    setFriendSearchAttempted(false)
  }, [])

  const handleFriendKeywordChange = useCallback((value: string) => {
    setFriendSearchKeyword(value)
    setFriendSearchAttempted(false)
  }, [])

  const handleFriendSearch = useCallback(async () => {
    const keyword = friendSearchKeyword.trim()
    if (!keyword) {
      void dialog.alert('请输入昵称或手机号', undefined, 'warning')
      return
    }
    setFriendSearchAttempted(true)
    setFriendSearching(true)
    setFriendSearchResults([])
    try {
      const data = await apiClient.searchFriends(friendSearchType === 'telephone' ? { telephone: keyword } : { nickname: keyword })
      setFriendSearchResults(data.list || [])
    } catch (error) {
      void dialog.alert('搜索失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setFriendSearching(false)
    }
  }, [dialog, friendSearchKeyword, friendSearchType])

  const handleFriendRequest = useCallback(async (userId: string) => {
    setFriendSendingId(userId)
    try {
      await apiClient.sendFriendRequest(userId)
      setFriendSearchResults((prev) => prev.map((item) => (item.id === userId ? { ...item, is_pending: true } : item)))
      void dialog.alert('已发送好友请求', undefined, 'success')
    } catch (error) {
      void dialog.alert('发送失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setFriendSendingId(null)
    }
  }, [dialog])

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

  const handleFeedAuthorActions = useCallback((item: CommunityFeedItem) => {
    const authorId = String(item.author?.id || '').trim()
    if (!authorId) return
    const isPriority = priorityAuthorIds.includes(authorId)
    Alert.alert(item.author?.nickname || '动态作者', undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: isPriority ? '取消特别关注' : '设为特别关注',
        onPress: () => togglePriorityAuthor(authorId),
      },
      {
        text: '拉黑用户',
        style: 'destructive',
        onPress: () => void handleBlockFeedAuthor(item),
      },
    ])
  }, [handleBlockFeedAuthor, priorityAuthorIds, togglePriorityAuthor])

  const handleFilterAuthorSearch = useCallback(async () => {
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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(true)} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.quickBar}>
          <View style={styles.quickGrid}>
            <QuickEntry label="互动消息" iconClass="icon-pinglun" onPress={() => navigation.navigate('Notifications')} />
            <QuickEntry label="私信" iconClass="icon-comment" onPress={() => navigation.navigate('Conversations')} />
            <QuickEntry label="好友管理" iconClass="icon-duoren" onPress={() => navigation.navigate('Friends')} />
            <QuickEntry label="添加好友" iconClass="icon-tianjiahaoyou" onPress={() => setAddFriendOpen(true)} />
          </View>
        </View>

        <Pressable style={({ pressed }) => [styles.rankingBanner, pressed && styles.pressed]} onPress={() => navigation.navigate('CheckinLeaderboard')}>
          <View style={styles.rankingHead}>
            <View style={styles.rankingIconWrap}>
              <Trophy size={22} color="rgba(255,255,255,0.96)" strokeWidth={2.5} />
            </View>
            <View style={styles.rankingHeadText}>
              <Text style={styles.rankingTitle}>本周打卡排行榜</Text>
              <Text style={styles.rankingSubtitle}>看看谁是本周最活跃</Text>
            </View>
            <ChevronRight size={18} color="rgba(255,255,255,0.82)" strokeWidth={2.4} />
          </View>

          {leaderboard.length > 0 ? (
            <View style={styles.rankingPreviewRow}>
              {leaderboard.slice(0, 3).map((item, index) => (
                <RankMini key={item.user_id} item={item} rank={item.rank || index + 1} />
              ))}
            </View>
          ) : (
            <Text style={styles.rankingPlaceholder}>暂无预览，下拉刷新试试</Text>
          )}
        </Pressable>

        <View style={styles.feedSection}>
          <View style={styles.feedSectionHeader}>
            <Text style={styles.feedSectionTitle}>公开动态</Text>
            <Pressable hitSlop={8} onPress={() => navigation.navigate('PublicFood', { mode: 'all' })}>
              <Text style={styles.feedSectionLink}>食物库</Text>
            </Pressable>
          </View>

          <View style={styles.feedFilterPanel}>
            <View style={styles.feedFilterTopRow}>
              <Pressable style={({ pressed }) => [styles.feedSearchWrap, pressed && styles.pressed]} onPress={() => navigation.navigate('CommunitySearch')}>
                <Search size={18} color="#94a3b8" strokeWidth={2.2} />
                <Text style={styles.feedSearchText} numberOfLines={1}>搜索动态内容或用户...</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.feedFilterTrigger, pressed && styles.pressed]} onPress={() => setFilterOpen(true)}>
                <View style={[styles.feedFilterFunnelBtn, filterActive && styles.feedFilterFunnelBtnActive]}>
                  <Filter size={17} color={filterActive ? colors.brand : '#94a3b8'} strokeWidth={2.3} />
                </View>
                <Text style={[styles.feedFilterSummary, filterActive && styles.feedFilterSummaryActive]} numberOfLines={1}>{filterSummary}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.feedPublishBtn, pressed && styles.pressed]} onPress={() => navigation.navigate('CirclePostEdit')}>
                <PenLine size={15} color="#fff" strokeWidth={2.4} />
                <Text style={styles.feedPublishText}>发布</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.secondaryChips}>
            <ShortcutChip label="校园餐" onPress={() => navigation.navigate('CampusCanteen')} />
            <ShortcutChip label="分享食物" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'public' })} />
            <ShortcutChip label="补校园餐" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'campus' })} />
          </View>

          {loading && feed.length === 0 ? (
            <FeedSkeleton />
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
                  onOpen={() => navigation.navigate('CommunityFeedDetail', {
                    targetId: item.target_id || item.record.id,
                    targetType: item.target_type || item.record.feed_type || 'food_record',
                  })}
                  onOpenAuthor={() => navigation.navigate('ProfileSettings', { userId: item.author.id })}
                  onLike={() => void toggleLike(item)}
                  onManageAuthor={() => handleFeedAuthorActions(item)}
                />
              ))}
              <View style={styles.loadMoreFooter}>
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.brand} />
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
        onAuthorScopeChange={setAuthorScope}
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
        searching={friendSearching}
        sendingId={friendSendingId}
        onClose={closeAddFriend}
        onSearchTypeChange={handleFriendSearchTypeChange}
        onKeywordChange={handleFriendKeywordChange}
        onSearch={handleFriendSearch}
        onSendRequest={handleFriendRequest}
      />
    </View>
  )
}

function AddFriendModal({
  visible,
  searchType,
  keyword,
  results,
  searchAttempted,
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
  searching: boolean
  sendingId: string | null
  onClose: () => void
  onSearchTypeChange: (type: FriendSearchType) => void
  onKeywordChange: (value: string) => void
  onSearch: () => void
  onSendRequest: (userId: string) => void
}) {
  const hasKeyword = keyword.trim().length > 0

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.addFriendMask} onPress={onClose}>
        <Pressable style={styles.addFriendCard} onPress={(event) => event.stopPropagation()}>
          <View style={styles.addFriendHeader}>
            <Text style={styles.addFriendTitle}>添加好友</Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.addFriendCloseText}>关闭</Text>
            </Pressable>
          </View>

          <View style={styles.addFriendTypeRow}>
            <Pressable
              style={({ pressed }) => [styles.addFriendTypeBtn, searchType === 'nickname' && styles.addFriendTypeBtnActive, pressed && styles.pressed]}
              onPress={() => onSearchTypeChange('nickname')}
            >
              <Text style={[styles.addFriendTypeText, searchType === 'nickname' && styles.addFriendTypeTextActive]}>昵称</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.addFriendTypeBtn, searchType === 'telephone' && styles.addFriendTypeBtnActive, pressed && styles.pressed]}
              onPress={() => onSearchTypeChange('telephone')}
            >
              <Text style={[styles.addFriendTypeText, searchType === 'telephone' && styles.addFriendTypeTextActive]}>手机号</Text>
            </Pressable>
          </View>

          <View style={styles.addFriendSearchRow}>
            <TextInput
              value={keyword}
              onChangeText={onKeywordChange}
              onSubmitEditing={onSearch}
              returnKeyType="search"
              keyboardType={searchType === 'telephone' ? 'phone-pad' : 'default'}
              placeholder={searchType === 'telephone' ? '输入手机号搜索' : '输入昵称搜索'}
              placeholderTextColor="#9ca3af"
              style={styles.addFriendInput}
            />
            <Pressable
              style={({ pressed }) => [styles.addFriendSearchBtn, (!hasKeyword || searching) && styles.addFriendSearchBtnDisabled, pressed && hasKeyword && !searching && styles.pressed]}
              onPress={onSearch}
              disabled={!hasKeyword || searching}
            >
              {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addFriendSearchText}>搜索</Text>}
            </Pressable>
          </View>

          <ScrollView
            style={styles.addFriendResults}
            contentContainerStyle={styles.addFriendResultsContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {results.length > 0 ? (
              results.map((user) => (
                <View key={user.id} style={styles.addFriendResultItem}>
                  <View style={styles.addFriendAvatar}>
                    {user.avatar ? <Image source={{ uri: user.avatar }} style={styles.addFriendAvatarImage} /> : <IconfontText className="iconfont icon-user" size={18} color={colors.brand} />}
                  </View>
                  <View style={styles.addFriendResultMain}>
                    <Text style={styles.addFriendResultName} numberOfLines={1}>{user.nickname || '用户'}</Text>
                  </View>
                  {user.is_friend ? (
                    <Text style={[styles.addFriendStatus, styles.addFriendStatusAdded]}>已添加</Text>
                  ) : user.is_pending ? (
                    <Text style={styles.addFriendStatus}>已发送</Text>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.addFriendRequestBtn, sendingId === user.id && styles.addFriendRequestBtnDisabled, pressed && !sendingId && styles.pressed]}
                      onPress={() => onSendRequest(user.id)}
                      disabled={!!sendingId}
                    >
                      {sendingId === user.id ? <ActivityIndicator size="small" color={colors.brandDark} /> : <Text style={styles.addFriendRequestText}>加好友</Text>}
                    </Pressable>
                  )}
                </View>
              ))
            ) : (
              <View style={styles.addFriendEmpty}>
                <Text style={styles.addFriendEmptyText}>{searchAttempted ? '没有搜索结果' : '输入昵称或手机号查找好友'}</Text>
              </View>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function QuickEntry({ label, iconClass, badgeCount, onPress }: { label: string; iconClass: string; badgeCount?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickEntry, pressed && styles.pressed]}>
      <View style={styles.quickEntryIconWrap}>
        <IconfontText className={`iconfont ${iconClass}`} size={22} color={colors.brand} />
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

function RankMini({ item, rank }: { item: CheckinLeaderboardItem; rank: number }) {
  const checkinCount = item.checkin_count ?? item.record_count ?? 0
  return (
    <View style={[styles.rankingPreviewCell, item.is_me && styles.rankingPreviewCellMe]}>
      <Text style={[styles.rankingRank, rank === 1 && styles.rankingRankFirst, rank === 2 && styles.rankingRankSecond, rank === 3 && styles.rankingRankThird]}>{rank}</Text>
      <View style={styles.rankingAvatarWrap}>
        {item.avatar ? <Image source={{ uri: item.avatar }} style={styles.rankingAvatar} /> : <IconfontText className="iconfont icon-user" size={17} color="rgba(255,255,255,0.88)" />}
      </View>
      <Text style={styles.rankingName} numberOfLines={1}>{item.nickname || '食友'}</Text>
      <Text style={styles.rankingCount}>{checkinCount}次</Text>
    </View>
  )
}

function ShortcutChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.shortcutChip, pressed && styles.pressed]} onPress={onPress}>
      <Utensils size={14} color={colors.brandDark} strokeWidth={2.2} />
      <Text style={styles.shortcutText}>{label}</Text>
    </Pressable>
  )
}

function CommunityFeedCard({
  item,
  onOpen,
  onOpenAuthor,
  onLike,
  onManageAuthor,
}: {
  item: CommunityFeedItem
  onOpen: () => void
  onOpenAuthor: () => void
  onLike: () => void
  onManageAuthor?: () => void
}) {
  const image = feedImage(item)
  const body = feedBody(item)
  const title = feedTitle(item)
  const targetType = item.target_type || item.record.feed_type || 'food_record'
  const isExercise = targetType === 'exercise_log'
  const commentsCount = item.comment_count || item.comments?.length || 0

  return (
    <Pressable style={({ pressed }) => [styles.feedCard, pressed && styles.pressed]} onPress={onOpen}>
      <View style={styles.feedMomentsRow}>
        <Pressable style={styles.feedAvatarCol} onPress={onOpenAuthor} hitSlop={8}>
          {item.author.avatar ? <Image source={{ uri: item.author.avatar }} style={styles.userAvatar} /> : <View style={styles.userAvatarFallback}><IconfontText className="iconfont icon-user" size={19} color={colors.brand} /></View>}
        </Pressable>

        <View style={styles.feedMainCol}>
          <Pressable style={styles.feedNameBlock} onPress={onOpenAuthor}>
            <Text style={styles.userName} numberOfLines={1}>{item.author.nickname || '食友'}</Text>
            <View style={styles.feedSubMetaRow}>
              <Text style={styles.postTime} numberOfLines={1}>{feedMeta(item)}</Text>
              {feedTag(item) ? <Text style={[styles.feedTagPlain, isExercise && styles.feedTagExercise]} numberOfLines={1}>{feedTag(item)}</Text> : null}
            </View>
          </Pressable>

          {title ? <Text style={styles.feedContent} numberOfLines={2}>{title}</Text> : null}
          {body ? <Text style={styles.feedContentMuted} numberOfLines={3}>{body}</Text> : null}
          {image ? <Image source={{ uri: image }} style={styles.feedImage} /> : null}

          <View style={styles.feedMeta}>
            <View style={[styles.feedCalorie, isExercise && styles.feedCalorieExercise]}>
              <Text style={styles.feedCalorieText}>{Math.round(item.record.total_calories || item.record.calories_burned || 0)} kcal</Text>
            </View>
            <View style={[styles.feedMacros, isExercise && styles.feedMacrosExercise]}>
              <Text style={[styles.feedMacrosText, isExercise && styles.feedMacrosTextExercise]} numberOfLines={1}>
                P {Math.round(item.record.total_protein || 0)}g / C {Math.round(item.record.total_carbs || 0)}g / F {Math.round(item.record.total_fat || 0)}g
              </Text>
            </View>
          </View>

          <View style={styles.feedActions}>
            <View style={styles.feedActionsLeft}>
              <Pressable style={styles.actionItem} onPress={onLike} hitSlop={8}>
                <IconfontText
                  className={item.liked ? 'iconfont icon-like_fill' : 'iconfont icon-like'}
                  size={19}
                  color={item.liked ? colors.danger : '#64748b'}
                />
                <Text style={[styles.actionCount, item.liked && styles.actionCountActive]}>{item.like_count}</Text>
              </Pressable>
              <View style={styles.actionItem}>
                <IconfontText className="iconfont icon-comment" size={19} color="#64748b" />
                <Text style={styles.actionCount}>评论 {commentsCount}</Text>
              </View>
            </View>
            {!item.is_mine && onManageAuthor ? (
              <Pressable
                style={({ pressed }) => [styles.actionManageBox, pressed && styles.pressed]}
                onPress={(event) => {
                  event.stopPropagation()
                  onManageAuthor()
                }}
                hitSlop={8}
              >
                <MoreHorizontal size={19} color="#64748b" strokeWidth={2.3} />
              </Pressable>
            ) : null}
          </View>

          {(item.comments?.length ?? 0) > 0 ? (
            <View style={styles.feedComments}>
              {item.comments?.slice(0, 2).map((comment) => (
                <View key={comment.id} style={styles.feedCommentItem}>
                  <View style={styles.commentAvatar}>
                    {comment.avatar ? <Image source={{ uri: comment.avatar }} style={styles.commentAvatarImage} /> : null}
                  </View>
                  <View style={styles.commentBody}>
                    <Text style={styles.commentAuthor} numberOfLines={1}>{comment.nickname || '用户'}</Text>
                    <Text style={styles.commentContentText} numberOfLines={2}>{comment.content}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

function FeedSkeleton() {
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
              {item === 1 ? <ActivityIndicator color={colors.brand} /> : null}
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
  const showMealAndGoal = contentType !== 'exercise_log' && contentType !== 'campus_food'
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.filterDrawerMask} onPress={onClose}>
        <Pressable style={styles.filterDrawer} onPress={(event) => event.stopPropagation()}>
          <View style={styles.filterDrawerHandle} />
          <View style={styles.filterDrawerHeader}>
            <Text style={styles.filterDrawerTitle}>更多筛选</Text>
            <Pressable hitSlop={10} onPress={onClose}>
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
                  <Pressable hitSlop={8} onPress={onAuthorClear}>
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
                      placeholderTextColor="#94a3b8"
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
                      {author.avatar ? <Image source={{ uri: author.avatar }} style={styles.filterAuthorAvatar} /> : <View style={styles.filterAuthorAvatarFallback}><IconfontText className="iconfont icon-user" size={15} color={colors.brand} /></View>}
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
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{title}</Text>
      <View style={styles.filterChipRow}>{children}</View>
    </View>
  )
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.pressed]} onPress={onPress}>
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

function feedImage(item: CommunityFeedItem): string {
  const images = Array.isArray(item.record.image_paths) ? item.record.image_paths : []
  return String(images[0] || item.record.image_path || '').trim()
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

function getFeedTargetKey(item: CommunityFeedItem): string {
  const targetType = item.target_type || item.record.feed_type || 'food_record'
  const targetId = item.target_id || item.record.id
  return `${targetType}:${targetId}`
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

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
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
    color: colors.textSecondary,
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
    backgroundColor: colors.danger,
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
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: colors.brand,
    shadowColor: colors.brandDark,
    shadowOpacity: 0.26,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  rankingHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    fontSize: compactFont(18, 16),
    lineHeight: 22,
    fontWeight: '700',
  },
  rankingSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  rankingPreviewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 14,
  },
  rankingPreviewCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 3,
  },
  rankingPreviewCellMe: {
    opacity: 1,
  },
  rankingRank: {
    color: '#fef3c6',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
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
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  rankingAvatar: {
    width: '100%',
    height: '100%',
  },
  rankingName: {
    maxWidth: '100%',
    color: '#fff',
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
  },
  rankingCount: {
    color: '#fef3c6',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
  },
  rankingPlaceholder: {
    marginTop: 14,
    color: 'rgba(255,255,255,0.86)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '600',
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
    color: colors.text,
    fontSize: compactFont(18, 17),
    lineHeight: 23,
    fontWeight: '700',
  },
  feedSectionLink: {
    color: colors.brandDark,
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
    height: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: softBorder,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
  },
  feedSearchText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  feedFilterTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  feedFilterFunnelBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: softBorder,
  },
  feedFilterFunnelBtnActive: {
    borderColor: colors.brand,
    backgroundColor: 'rgba(92,184,150,0.08)',
  },
  feedFilterSummary: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  feedFilterSummaryActive: {
    color: colors.brandDark,
  },
  feedPublishBtn: {
    minHeight: 32,
    borderRadius: 16,
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
    backgroundColor: colors.brandSoft,
  },
  shortcutText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '700',
  },
  feedList: {
    backgroundColor: 'transparent',
  },
  feedEmpty: {
    paddingHorizontal: 12,
    paddingVertical: 36,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: hairline,
  },
  feedEmptyText: {
    color: colors.textSecondary,
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
    backgroundColor: colors.brandSoft,
  },
  userAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
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
    color: authorBlue,
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
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  feedTagPlain: {
    color: colors.brandDark,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.brandSoft,
  },
  feedTagExercise: {
    color: '#0f766e',
    backgroundColor: '#f0fdfa',
  },
  feedContent: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: 6,
  },
  feedContentMuted: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  feedImage: {
    width: '100%',
    height: 192,
    borderRadius: 4,
    marginTop: 6,
    marginBottom: 10,
    backgroundColor: colors.brandSoft,
  },
  feedMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  feedCalorie: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  feedCalorieExercise: {
    backgroundColor: colors.orange,
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
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  feedMacrosExercise: {
    borderColor: '#99f6e4',
    backgroundColor: '#f0fdfa',
  },
  feedMacrosText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  feedMacrosTextExercise: {
    color: '#0f766e',
  },
  feedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f0f0f0',
    marginTop: 9,
  },
  feedActionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  actionCountActive: {
    color: colors.danger,
  },
  actionManageBox: {
    width: 28,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  feedComments: {
    marginTop: 8,
    paddingHorizontal: 7,
    paddingVertical: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(248,250,252,0.72)',
  },
  loadMoreFooter: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: hairline,
  },
  loadMoreText: {
    color: colors.textMuted,
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
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
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
    color: authorBlue,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  commentContentText: {
    color: colors.text,
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
    backgroundColor: '#e5eee9',
  },
  skeletonMain: {
    flex: 1,
    minWidth: 0,
  },
  skeletonLine: {
    borderRadius: 4,
    backgroundColor: '#e5eee9',
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
    backgroundColor: '#dbe9e2',
  },
  addFriendMask: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(15,23,42,0.42)',
  },
  addFriendCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '78%',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: '#fff',
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
    color: colors.text,
    fontSize: compactFont(18, 17),
    lineHeight: 24,
    fontWeight: '800',
  },
  addFriendCloseText: {
    color: colors.textSecondary,
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
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  addFriendTypeBtnActive: {
    borderColor: 'rgba(92,184,150,0.46)',
    backgroundColor: colors.brandSoft,
  },
  addFriendTypeText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  addFriendTypeTextActive: {
    color: colors.brandDark,
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
    borderColor: '#dbe4ea',
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    backgroundColor: '#f8fafc',
  },
  addFriendSearchBtn: {
    width: 76,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
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
    borderTopColor: '#edf2f7',
  },
  addFriendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
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
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  addFriendStatus: {
    flexShrink: 0,
    minWidth: 58,
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  addFriendStatusAdded: {
    color: colors.brandDark,
  },
  addFriendRequestBtn: {
    minWidth: 70,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.brandSoft,
  },
  addFriendRequestBtnDisabled: {
    opacity: 0.58,
  },
  addFriendRequestText: {
    color: colors.brandDark,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  addFriendEmpty: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#edf2f7',
  },
  addFriendEmptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  filterDrawerMask: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.42)',
  },
  filterDrawer: {
    maxHeight: '82%',
    paddingTop: 8,
    paddingHorizontal: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#fff',
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
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
  },
  filterDrawerDone: {
    color: colors.brandDark,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  filterGroup: {
    marginBottom: 16,
  },
  filterLabel: {
    color: colors.textSecondary,
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
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  filterChipActive: {
    borderColor: 'rgba(92,184,150,0.42)',
    backgroundColor: colors.brandSoft,
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: colors.brandDark,
  },
  filterSelectedAuthor: {
    minHeight: 42,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.brandSoft,
  },
  filterSelectedAuthorText: {
    flex: 1,
    color: colors.brandDark,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  filterSelectedAuthorClear: {
    color: colors.danger,
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
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#dbe4ea',
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
    backgroundColor: '#f8fafc',
  },
  filterAuthorSearchButton: {
    width: 68,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
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
    borderBottomColor: '#edf2f7',
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
    backgroundColor: colors.brandSoft,
  },
  filterAuthorResultName: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  filterAuthorSelectText: {
    color: colors.brandDark,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
})
