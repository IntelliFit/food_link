import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ChevronRight, Heart, MessageCircle, Search, Trash2, X } from 'lucide-react-native'
import type {
  CommunityFeedTargetType,
  CommunitySearchTab,
  ContentSearchResult,
  UserSearchResult,
} from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'

const HISTORY_KEY = 'mobile_community_search_history'
const PAGE_SIZE = 20
const MAX_HISTORY = 30

export function CommunitySearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'CommunitySearch'>>()
  const dialog = useAppDialog()
  const [keyword, setKeyword] = useState(route.params?.keyword || '')
  const [activeTab, setActiveTab] = useState<CommunitySearchTab>('content')
  const [contentResults, setContentResults] = useState<ContentSearchResult[]>([])
  const [userResults, setUserResults] = useState<UserSearchResult[]>([])
  const [contentOffset, setContentOffset] = useState(0)
  const [userOffset, setUserOffset] = useState(0)
  const [contentHasMore, setContentHasMore] = useState(false)
  const [userHasMore, setUserHasMore] = useState(false)
  const [contentCount, setContentCount] = useState(0)
  const [userCount, setUserCount] = useState(0)
  const [searchedTabs, setSearchedTabs] = useState<Record<CommunitySearchTab, boolean>>({ content: false, users: false })
  const [history, setHistory] = useState<string[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [likingKey, setLikingKey] = useState('')
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({})
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>({})

  const currentResults = activeTab === 'content' ? contentResults : userResults
  const currentSearched = searchedTabs[activeTab]
  const hasMore = activeTab === 'content' ? contentHasMore : userHasMore
  const currentOffset = activeTab === 'content' ? contentOffset : userOffset
  const currentLoading = loading && currentResults.length === 0
  const visibleHistory = historyExpanded ? history : history.slice(0, 4)

  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => setHistory(parseHistory(raw)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!route.params?.keyword) return
    void runSearch('content', 0, false, route.params.keyword)
    // Route params should trigger only the initial search for this screen instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveHistory = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const next = [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, MAX_HISTORY)
    setHistory(next)
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => undefined)
  }, [history])

  const removeHistoryItem = async (value: string) => {
    const next = history.filter((item) => item !== value)
    setHistory(next)
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => undefined)
  }

  const clearHistory = async () => {
    setHistory([])
    setHistoryExpanded(false)
    await AsyncStorage.removeItem(HISTORY_KEY).catch(() => undefined)
  }

  const runSearch = useCallback(async (
    tab: CommunitySearchTab = activeTab,
    offset = 0,
    append = false,
    keywordOverride?: string,
  ) => {
    const q = (keywordOverride ?? keyword).trim()
    if (!q) return
    setLoading(true)
    try {
      await saveHistory(q)
      const data = await apiClient.communitySearch({ keyword: q, tab, offset, limit: PAGE_SIZE })
      setContentCount(data.content_count || 0)
      setUserCount(data.user_count || 0)
      setSearchedTabs((current) => ({ ...current, [tab]: true }))

      if (!append && tab === 'content' && (data.content_count || 0) === 0 && (data.user_count || 0) > 0) {
        setActiveTab('users')
        const usersData = await apiClient.communitySearch({ keyword: q, tab: 'users', offset: 0, limit: PAGE_SIZE })
        setUserResults(usersData.list as UserSearchResult[])
        setUserOffset((usersData.list || []).length)
        setUserHasMore(Boolean(usersData.has_more))
        setSearchedTabs((current) => ({ ...current, content: true, users: true }))
        return
      }

      if (tab === 'content') {
        const list = data.list as ContentSearchResult[]
        setContentResults((current) => append ? [...current, ...list] : list)
        setContentOffset(offset + list.length)
        setContentHasMore(Boolean(data.has_more))
      } else {
        const list = data.list as UserSearchResult[]
        setUserResults((current) => append ? [...current, ...list] : list)
        setUserOffset(offset + list.length)
        setUserHasMore(Boolean(data.has_more))
      }
    } catch (error) {
      await dialog.alert('搜索失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [activeTab, dialog, keyword, saveHistory])

  const submitSearch = () => {
    const q = keyword.trim()
    if (!q) return
    setContentResults([])
    setUserResults([])
    setContentOffset(0)
    setUserOffset(0)
    setContentHasMore(false)
    setUserHasMore(false)
    setSearchedTabs({ content: false, users: false })
    void runSearch(activeTab, 0, false, q)
  }

  const switchTab = (tab: CommunitySearchTab) => {
    setActiveTab(tab)
    if (keyword.trim() && !searchedTabs[tab]) {
      void runSearch(tab, 0, false)
    }
  }

  const openHistory = (value: string) => {
    setKeyword(value)
    setActiveTab('content')
    setContentResults([])
    setUserResults([])
    setSearchedTabs({ content: false, users: false })
    void runSearch('content', 0, false, value)
  }

  const loadMore = () => {
    if (!currentSearched || loading || !hasMore) return
    void runSearch(activeTab, currentOffset, true)
  }

  const onResultsScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 96) {
      loadMore()
    }
  }

  const openContent = (item: ContentSearchResult) => {
    const targetId = String(item.target_id || '').trim()
    if (!targetId) return
    navigation.navigate('CommunityFeedDetail', {
      targetId,
      targetType: normalizeTargetType(item.target_type),
    })
  }

  const openUser = (item: UserSearchResult) => {
    if (item.is_self) {
      navigation.navigate('ProfileSettings')
      return
    }
    navigation.navigate('ProfileSettings', { userId: item.id })
  }

  const toggleLike = async (item: ContentSearchResult) => {
    const key = contentKey(item)
    const targetId = String(item.target_id || '').trim()
    if (!targetId || likingKey) return
    const previousLiked = likeMap[key] ?? Boolean(item.liked)
    const previousCount = likeCountMap[key] ?? Number(item.like_count || 0)
    setLikingKey(key)
    setLikeMap((current) => ({ ...current, [key]: !previousLiked }))
    setLikeCountMap((current) => ({ ...current, [key]: Math.max(0, previousCount + (previousLiked ? -1 : 1)) }))
    try {
      if (previousLiked) await apiClient.communityUnlike(targetId, normalizeTargetType(item.target_type))
      else await apiClient.communityLike(targetId, normalizeTargetType(item.target_type))
    } catch (error) {
      setLikeMap((current) => ({ ...current, [key]: previousLiked }))
      setLikeCountMap((current) => ({ ...current, [key]: previousCount }))
      await dialog.alert('操作失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLikingKey('')
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.searchBar}>
        <View style={styles.searchInputWrap}>
          <Search size={14} color="#94a3b8" />
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="搜索动态内容或用户..."
            placeholderTextColor="#94a3b8"
            returnKeyType="search"
            onSubmitEditing={submitSearch}
            style={styles.searchInput}
          />
          {keyword.trim() ? (
            <Pressable style={styles.searchClear} onPress={() => setKeyword('')}>
              <Text style={styles.searchClearText}>清除</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.searchButton} onPress={submitSearch}>
          <Text style={styles.searchButtonText}>搜索</Text>
        </Pressable>
      </View>

      {history.length > 0 ? (
        <View style={styles.history}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>搜索记录</Text>
            <View style={styles.historyActions}>
              {history.length > 4 ? (
                <Pressable onPress={() => setHistoryExpanded((value) => !value)}>
                  <Text style={styles.historyToggle}>{historyExpanded ? '收起' : '展开'}</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.historyClear} onPress={clearHistory}>
                <Trash2 size={15} color="#94a3b8" />
              </Pressable>
            </View>
          </View>
          <View style={styles.historyTags}>
            {visibleHistory.map((item) => (
              <View key={item} style={styles.historyTag}>
                <Pressable style={styles.historyTagTextButton} onPress={() => openHistory(item)}>
                  <Text style={styles.historyTagText} numberOfLines={1}>{item}</Text>
                </Pressable>
                <Pressable style={styles.historyTagClose} onPress={() => void removeHistoryItem(item)} hitSlop={8}>
                  <X size={12} color="#94a3b8" />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.tabs}>
        <SearchTabButton
          label={`动态内容${contentCount > 0 ? `(${formatCount(contentCount)})` : ''}`}
          active={activeTab === 'content'}
          onPress={() => switchTab('content')}
        />
        <SearchTabButton
          label={`用户${userCount > 0 ? `(${formatCount(userCount)})` : ''}`}
          active={activeTab === 'users'}
          onPress={() => switchTab('users')}
        />
      </View>

      <ScrollView
        style={styles.resultsScroll}
        contentContainerStyle={styles.resultsContent}
        keyboardShouldPersistTaps="handled"
        onScroll={onResultsScroll}
        scrollEventThrottle={80}
      >
        {currentLoading ? (
          <SkeletonList />
        ) : !currentSearched ? (
          <SearchEmptyState icon="search" title="输入关键词搜索" text="搜索公开动态或可被搜索到的用户" />
        ) : currentResults.length === 0 ? (
          <SearchEmptyState
            icon="empty"
            title={activeTab === 'content' ? `未找到匹配「${keyword.trim()}」的动态内容` : `未找到匹配「${keyword.trim()}」的用户`}
            text="尝试其他关键词"
          />
        ) : activeTab === 'content' ? (
          <View style={styles.contentList}>
            {contentResults.map((item, index) => (
              <ContentCard
                key={`${contentKey(item)}-${index}`}
                item={item}
                liked={likeMap[contentKey(item)] ?? Boolean(item.liked)}
                likeCount={likeCountMap[contentKey(item)] ?? Number(item.like_count || 0)}
                liking={likingKey === contentKey(item)}
                onPress={() => openContent(item)}
                onComment={() => openContent(item)}
                onLike={() => void toggleLike(item)}
              />
            ))}
            {loading && contentResults.length > 0 ? <InlineSpinner /> : null}
            {!contentHasMore && contentResults.length > 0 ? <Text style={styles.listEnd}>- 没有更多了 -</Text> : null}
          </View>
        ) : (
          <View style={styles.userList}>
            {userResults.map((item) => (
              <UserCard key={item.id} item={item} onPress={() => openUser(item)} />
            ))}
            {loading && userResults.length > 0 ? <InlineSpinner /> : null}
            {!userHasMore && userResults.length > 0 ? <Text style={styles.listEnd}>- 没有更多了 -</Text> : null}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

function SearchTabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.tabItem} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
      {active ? <View style={styles.tabIndicator} /> : null}
    </Pressable>
  )
}

function ContentCard({
  item,
  liked,
  likeCount,
  liking,
  onPress,
  onLike,
  onComment,
}: {
  item: ContentSearchResult
  liked: boolean
  likeCount: number
  liking: boolean
  onPress: () => void
  onLike: () => void
  onComment: () => void
}) {
  const images = contentImages(item)
  const text = contentText(item)
  return (
    <Pressable style={styles.contentCard} onPress={onPress}>
      <View style={styles.cardAuthorRow}>
        <View style={styles.cardAuthorAvatar}>
          {item.author?.avatar ? (
            <Image source={{ uri: item.author.avatar }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarPlaceholder}>{initial(item.author?.nickname)}</Text>
          )}
        </View>
        <View style={styles.cardAuthorInfo}>
          <Text style={styles.cardAuthorName} numberOfLines={1}>{item.author?.nickname || '用户'}</Text>
          <View style={styles.cardMetaRow}>
            <Text style={styles.cardTypeBadge}>{targetTypeLabel(item.target_type)}</Text>
            {item.record_time || item.created_at ? (
              <Text style={styles.cardTime} numberOfLines={1}> · {formatSearchTime(item.record_time || item.created_at)}</Text>
            ) : null}
          </View>
        </View>
      </View>
      {text ? <Text style={styles.cardDesc} numberOfLines={3}>{text}</Text> : null}
      {images.length === 1 ? (
        <Image source={{ uri: images[0] }} style={styles.singleImage} />
      ) : null}
      {images.length > 1 ? (
        <View style={styles.multiImages}>
          {images.slice(0, 3).map((url, index) => (
            <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.multiImage} />
          ))}
        </View>
      ) : null}
      <View style={styles.contentActions}>
        <Pressable style={styles.contentActionItem} onPress={onLike} disabled={liking}>
          <Heart size={15} color={liked ? '#ef4444' : '#94a3b8'} fill={liked ? '#ef4444' : 'transparent'} />
          <Text style={styles.contentActionCount}>{likeCount || 0}</Text>
        </Pressable>
        <Pressable style={styles.contentActionItem} onPress={onComment}>
          <MessageCircle size={15} color="#94a3b8" />
          <Text style={styles.contentActionCount}>{item.comment_count || 0}</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

function UserCard({ item, onPress }: { item: UserSearchResult; onPress: () => void }) {
  return (
    <Pressable style={styles.userCard} onPress={onPress}>
      <View style={styles.userCardAvatar}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.userAvatarPlaceholder}>{initial(item.nickname)}</Text>
        )}
      </View>
      <View style={styles.userCardInfo}>
        <View style={styles.userNameRow}>
          <Text style={styles.userCardName} numberOfLines={1}>{item.nickname || '用户'}</Text>
          {item.is_self ? <Text style={[styles.userTag, styles.selfTag]}>我</Text> : null}
          {item.is_friend && !item.is_self ? <Text style={[styles.userTag, styles.friendTag]}>好友</Text> : null}
        </View>
      </View>
      <ChevronRight size={16} color="#cbd5e1" />
    </Pressable>
  )
}

function SearchEmptyState({ icon, title, text }: { icon: 'search' | 'empty'; title: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap}>
        {icon === 'search' ? <Search size={31} color="#94a3b8" /> : <X size={31} color="#94a3b8" />}
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDesc}>{text}</Text>
    </View>
  )
}

function SkeletonList() {
  return (
    <View style={styles.skeletonList}>
      {[1, 2, 3].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <View style={styles.skeletonRow}>
            <View style={styles.skeletonAvatar} />
            <View style={styles.skeletonLines}>
              <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
              <View style={[styles.skeletonLine, styles.skeletonLineLong]} />
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

function InlineSpinner() {
  return (
    <View style={styles.loadMoreSpinner}>
      <ActivityIndicator color="#00bc7d" size="small" />
    </View>
  )
}

function parseHistory(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

function normalizeTargetType(value: unknown): CommunityFeedTargetType {
  const text = String(value || 'food_record').trim()
  if (text === 'exercise_log' || text === 'campus_food' || text === 'circle_post') return text
  return 'food_record'
}

function contentKey(item: ContentSearchResult): string {
  return `${item.target_type || 'food_record'}:${item.target_id || ''}`
}

function formatCount(value: number): string {
  return value > 99 ? '99+' : String(Math.max(0, value))
}

function initial(value?: string): string {
  return String(value || '?').trim().slice(0, 1) || '?'
}

function targetTypeLabel(value: unknown): string {
  switch (String(value || '')) {
    case 'food_record':
      return '饮食记录'
    case 'exercise_log':
      return '运动记录'
    case 'circle_post':
      return '圈子帖子'
    case 'campus_food':
      return '校园餐'
    default:
      return '动态'
  }
}

function contentText(item: ContentSearchResult): string {
  return String(item.description || item.title || item.body || item.exercise_desc || targetTypeLabel(item.target_type)).trim()
}

function contentImages(item: ContentSearchResult): string[] {
  const paths = Array.isArray(item.image_paths) ? item.image_paths : []
  const urls = [item.image_path || '', ...paths].map((url) => String(url || '').trim()).filter(Boolean)
  return Array.from(new Set(urls))
}

function formatSearchTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  if (diff < 172_800_000) return '昨天'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  searchBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  searchInputWrap: {
    flex: 1,
    minWidth: 0,
    height: 32,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    backgroundColor: '#f5f5f5',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    color: '#1e293b',
    fontSize: 13,
    paddingVertical: 0,
  },
  searchClear: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  searchClearText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  searchButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  searchButtonText: {
    color: '#00bc7d',
    fontSize: 13,
    fontWeight: '600',
  },
  history: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  historyTitle: {
    color: '#1e293b',
    fontSize: 13,
    fontWeight: '600',
  },
  historyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyToggle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  historyClear: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  historyTag: {
    maxWidth: '62%',
    minHeight: 28,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 9,
    paddingRight: 6,
    backgroundColor: '#f1f5f9',
  },
  historyTagTextButton: {
    flexShrink: 1,
    minWidth: 0,
  },
  historyTagText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '500',
  },
  historyTagClose: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    minHeight: 48,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  tabItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 10,
    position: 'relative',
  },
  tabText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#00bc7d',
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#00bc7d',
  },
  resultsScroll: {
    flex: 1,
  },
  resultsContent: {
    flexGrow: 1,
  },
  contentList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: 28,
  },
  contentCard: {
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardAuthorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#f0fdf4',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    color: '#00bc7d',
    fontSize: 12,
    fontWeight: '700',
  },
  cardAuthorInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardAuthorName: {
    color: '#1e293b',
    fontSize: 13,
    fontWeight: '600',
  },
  cardMetaRow: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  cardTypeBadge: {
    overflow: 'hidden',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: '#f0fdf4',
    color: '#00bc7d',
    fontSize: 10,
    fontWeight: '600',
  },
  cardTime: {
    flexShrink: 1,
    minWidth: 0,
    color: '#94a3b8',
    fontSize: 11,
  },
  cardDesc: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 20,
  },
  singleImage: {
    width: '100%',
    height: 160,
    borderRadius: 6,
    marginTop: 8,
    backgroundColor: '#f1f5f9',
  },
  multiImages: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
  },
  multiImage: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 1,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
  },
  contentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  contentActionItem: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  contentActionCount: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  userList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingBottom: 28,
  },
  userCard: {
    minHeight: 64,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  userCardAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: '#f0fdf4',
  },
  userAvatarPlaceholder: {
    color: '#00bc7d',
    fontSize: 16,
    fontWeight: '700',
  },
  userCardInfo: {
    flex: 1,
    minWidth: 0,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userCardName: {
    flexShrink: 1,
    minWidth: 0,
    color: '#1e293b',
    fontSize: 14,
    fontWeight: '600',
  },
  userTag: {
    overflow: 'hidden',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 10,
    fontWeight: '600',
  },
  selfTag: {
    backgroundColor: '#f0fdf4',
    color: '#00bc7d',
  },
  friendTag: {
    backgroundColor: '#eff6ff',
    color: '#3b82f6',
  },
  skeletonList: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  skeletonCard: {
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeletonAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    backgroundColor: '#e2e8f0',
  },
  skeletonLines: {
    flex: 1,
    minWidth: 0,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 4,
    marginBottom: 5,
    backgroundColor: '#e2e8f0',
  },
  skeletonLineShort: {
    width: '50%',
  },
  skeletonLineLong: {
    width: '80%',
  },
  emptyState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyDesc: {
    marginTop: 6,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  loadMoreSpinner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  listEnd: {
    paddingVertical: 16,
    color: '#cbd5e1',
    fontSize: 11,
    textAlign: 'center',
  },
})
