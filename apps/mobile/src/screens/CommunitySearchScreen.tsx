import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type {
  CommunityFeedTargetType,
  CommunitySearchTab,
  ContentSearchResult,
  UserSearchResult,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { formatDateTime } from '../utils/date'
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
  const [loading, setLoading] = useState(false)
  const [likingKey, setLikingKey] = useState('')
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({})
  const [likeCountMap, setLikeCountMap] = useState<Record<string, number>>({})

  const currentResults = activeTab === 'content' ? contentResults : userResults
  const currentSearched = searchedTabs[activeTab]
  const hasMore = activeTab === 'content' ? contentHasMore : userHasMore
  const currentOffset = activeTab === 'content' ? contentOffset : userOffset

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
    await AsyncStorage.removeItem(HISTORY_KEY).catch(() => undefined)
  }

  const runSearch = useCallback(async (
    tab: CommunitySearchTab = activeTab,
    offset = 0,
    append = false,
    keywordOverride?: string,
  ) => {
    const q = (keywordOverride ?? keyword).trim()
    if (!q) {
      await dialog.alert('请输入搜索关键词', '可搜索公开动态内容或允许被搜索的用户。', 'warning')
      return
    }
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
    setContentResults([])
    setUserResults([])
    setContentOffset(0)
    setUserOffset(0)
    setContentHasMore(false)
    setUserHasMore(false)
    setSearchedTabs({ content: false, users: false })
    void runSearch(activeTab, 0, false)
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

  const subtitle = useMemo(() => {
    if (!currentSearched) return '搜索公开动态和用户'
    if (activeTab === 'content') return `动态内容 ${formatCount(contentCount)}`
    return `用户 ${formatCount(userCount)}`
  }, [activeTab, contentCount, currentSearched, userCount])

  return (
    <Page title="圈子搜索" subtitle={subtitle}>
      <Card>
        <Text style={styles.sectionTitle}>搜索</Text>
        <View style={styles.searchRow}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="搜索动态内容或用户"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={submitSearch}
            style={styles.input}
          />
          {keyword.trim() ? (
            <Pressable style={styles.clearButton} onPress={() => setKeyword('')}>
              <Text style={styles.clearText}>清除</Text>
            </Pressable>
          ) : null}
        </View>
        <AppButton label="搜索" loading={loading} onPress={submitSearch} />
      </Card>

      {history.length ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>搜索记录</Text>
            <Pressable onPress={clearHistory}>
              <Text style={styles.linkText}>清空</Text>
            </Pressable>
          </View>
          <View style={styles.chipWrap}>
            {history.slice(0, 12).map((item) => (
              <Pressable key={item} style={styles.historyChip} onPress={() => openHistory(item)}>
                <Text style={styles.historyText}>{item}</Text>
                <Pressable onPress={() => void removeHistoryItem(item)} hitSlop={8}>
                  <Text style={styles.historyRemove}>×</Text>
                </Pressable>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      <View style={styles.tabRow}>
        <TabButton label={`动态内容${contentCount > 0 ? `(${formatCount(contentCount)})` : ''}`} active={activeTab === 'content'} onPress={() => switchTab('content')} />
        <TabButton label={`用户${userCount > 0 ? `(${formatCount(userCount)})` : ''}`} active={activeTab === 'users'} onPress={() => switchTab('users')} />
      </View>

      {loading && currentResults.length === 0 ? (
        <Card style={styles.spinnerCard}>
          <ActivityIndicator color={colors.brand} />
        </Card>
      ) : null}

      {!loading && !currentSearched ? (
        <EmptyState title="输入关键词搜索" text="可以搜索公开动态、圈子帖子、运动记录和可被搜索的用户。" />
      ) : null}

      {!loading && currentSearched && currentResults.length === 0 ? (
        <EmptyState
          title={activeTab === 'content' ? `未找到匹配“${keyword.trim()}”的动态内容` : `未找到匹配“${keyword.trim()}”的用户`}
          text="换一个关键词试试。"
        />
      ) : null}

      {activeTab === 'content'
        ? contentResults.map((item, index) => (
          <ContentCard
            key={`${contentKey(item)}-${index}`}
            item={item}
            liked={likeMap[contentKey(item)] ?? Boolean(item.liked)}
            likeCount={likeCountMap[contentKey(item)] ?? Number(item.like_count || 0)}
            onPress={() => openContent(item)}
            onComment={() => openContent(item)}
            onLike={() => void toggleLike(item)}
          />
        ))
        : userResults.map((item) => (
          <UserCard key={item.id} item={item} onPress={() => openUser(item)} />
        ))}

      {currentSearched && hasMore ? (
        <AppButton label="查看更多" variant="secondary" loading={loading} onPress={() => void runSearch(activeTab, currentOffset, true)} />
      ) : null}

      {currentSearched && !hasMore && currentResults.length > 0 ? (
        <Text style={styles.endText}>没有更多了</Text>
      ) : null}
    </Page>
  )
}

function ContentCard({
  item,
  liked,
  likeCount,
  onPress,
  onLike,
  onComment,
}: {
  item: ContentSearchResult
  liked: boolean
  likeCount: number
  onPress: () => void
  onLike: () => void
  onComment: () => void
}) {
  const images = contentImages(item)
  return (
    <Pressable onPress={onPress}>
      <Card>
        <View style={styles.authorRow}>
          {item.author?.avatar ? (
            <Image source={{ uri: item.author.avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{initial(item.author?.nickname)}</Text>
            </View>
          )}
          <View style={styles.flex}>
            <Text style={styles.authorName}>{item.author?.nickname || '用户'}</Text>
            <Text style={styles.meta}>
              {targetTypeLabel(item.target_type)}{item.record_time || item.created_at ? ` · ${formatDateTime(item.record_time || item.created_at)}` : ''}
            </Text>
          </View>
        </View>
        <Text style={styles.itemTitle}>{contentTitle(item)}</Text>
        {contentBody(item) ? <Text style={styles.bodyText}>{contentBody(item)}</Text> : null}
        {images.length ? (
          <View style={styles.imageGrid}>
            {images.slice(0, 3).map((url, index) => (
              <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.resultImage} />
            ))}
          </View>
        ) : null}
        <View style={styles.metricRow}>
          {nutritionLabels(item).map((label) => <Pill key={label} text={label} />)}
        </View>
        <View style={styles.actionRow}>
          <Pressable onPress={onLike}>
            <Text style={[styles.actionText, liked && styles.actionTextActive]}>{liked ? '已赞' : '点赞'} {likeCount}</Text>
          </Pressable>
          <Pressable onPress={onComment}>
            <Text style={styles.actionText}>评论 {item.comment_count || 0}</Text>
          </Pressable>
        </View>
      </Card>
    </Pressable>
  )
}

function UserCard({ item, onPress }: { item: UserSearchResult; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card>
        <View style={styles.userRow}>
          {item.avatar ? (
            <Image source={{ uri: item.avatar }} style={styles.userAvatar} />
          ) : (
            <View style={styles.userAvatarFallback}>
              <Text style={styles.avatarText}>{initial(item.nickname)}</Text>
            </View>
          )}
          <View style={styles.flex}>
            <View style={styles.userNameRow}>
              <Text style={styles.itemTitle}>{item.nickname || '用户'}</Text>
              {item.is_self ? <Pill text="我" /> : null}
              {item.is_friend && !item.is_self ? <Pill text="好友" /> : null}
            </View>
            <Text style={styles.meta}>{item.is_self ? '查看我的主页' : item.is_friend ? '已在好友列表' : '查看公开主页'}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>
      </Card>
    </Pressable>
  )
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </Card>
  )
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
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

function contentTitle(item: ContentSearchResult): string {
  return String(item.title || item.description || item.exercise_desc || targetTypeLabel(item.target_type)).trim()
}

function contentBody(item: ContentSearchResult): string {
  const body = String(item.body || '').trim()
  return body && body !== contentTitle(item) ? body : ''
}

function contentImages(item: ContentSearchResult): string[] {
  const paths = Array.isArray(item.image_paths) ? item.image_paths : []
  const urls = [item.image_path || '', ...paths].map((url) => String(url || '').trim()).filter(Boolean)
  return Array.from(new Set(urls))
}

function nutritionLabels(item: ContentSearchResult): string[] {
  const labels = [
    numberLabel(item.total_calories, 'kcal'),
    numberLabel(item.total_protein, '蛋白', 'g'),
    numberLabel(item.total_carbs, '碳水', 'g'),
    numberLabel(item.total_fat, '脂肪', 'g'),
    numberLabel(item.calories_burned, '消耗', 'kcal'),
    numberLabel(item.duration_min, '时长', '分钟'),
  ].filter(Boolean) as string[]
  return labels.slice(0, 4)
}

function numberLabel(value: unknown, prefix: string, suffix = ''): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (prefix === 'kcal') return `${Math.round(n)} kcal`
  return `${prefix} ${Math.round(n)}${suffix}`
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  clearButton: {
    minHeight: 42,
    justifyContent: 'center',
  },
  clearText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  historyChip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceMuted,
  },
  historyText: {
    color: colors.text,
    fontWeight: '800',
  },
  historyRemove: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '900',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  tabButtonActive: {
    backgroundColor: colors.brand,
  },
  tabText: {
    color: colors.textSecondary,
    fontWeight: '900',
  },
  tabTextActive: {
    color: '#fff',
  },
  spinnerCard: {
    alignItems: 'center',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceMuted,
  },
  avatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  avatarText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  authorName: {
    color: colors.text,
    fontWeight: '800',
  },
  meta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  itemTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  bodyText: {
    marginTop: 8,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  imageGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  resultImage: {
    flex: 1,
    minWidth: 0,
    height: 92,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 22,
    marginTop: 16,
  },
  actionText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  actionTextActive: {
    color: colors.brandDark,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  userAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.surfaceMuted,
  },
  userAvatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 28,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.brandSoft,
  },
  pillText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  linkText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  endText: {
    color: colors.textMuted,
    textAlign: 'center',
    fontWeight: '800',
    marginTop: 2,
  },
})
