import { useCallback, useState, type ReactNode } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CheckinLeaderboardItem, CommunityFeedContentType, CommunityFeedItem, CommunityFeedSortBy, CommunityFeedTargetType } from '@food-link/core'
import {
  Bell,
  ChevronRight,
  Filter,
  Heart,
  MessageCircle,
  MoreHorizontal,
  PenLine,
  Search,
  Trophy,
  UserPlus,
  UsersRound,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, compactFont, radius } from '../theme'
import { formatDateTime } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'

const hairline = 'rgba(92,184,150,0.14)'
const softBorder = 'rgba(92,184,150,0.18)'
const authorBlue = '#576b95'

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

export function CommunityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [feed, setFeed] = useState<CommunityFeedItem[]>([])
  const [leaderboard, setLeaderboard] = useState<CheckinLeaderboardItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortBy, setSortBy] = useState<CommunityFeedSortBy>('latest')
  const [contentType, setContentType] = useState<CommunityFeedContentType>('all')
  const filterActive = sortBy !== 'latest' || contentType !== 'all'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [feedData, leaderboardData] = await Promise.all([
        apiClient.communityGetFeed({ limit: 10, params: { sort_by: sortBy, content_type: contentType } }),
        apiClient.communityGetCheckinLeaderboard().catch(() => ({ list: [] as CheckinLeaderboardItem[], week_start: '', week_end: '' })),
      ])
      setFeed(feedData.list || [])
      setLeaderboard(leaderboardData.list || [])
    } catch (error) {
      void dialog.alert('获取圈子失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [contentType, dialog, sortBy])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const toggleLike = async (item: CommunityFeedItem) => {
    const targetId = item.target_id || item.record.id
    const targetType = item.target_type || item.record.feed_type || 'food_record'
    const next = feed.map((entry) => (
      entry === item ? { ...entry, liked: !entry.liked, like_count: Math.max(0, entry.like_count + (entry.liked ? -1 : 1)) } : entry
    ))
    setFeed(next)
    try {
      if (item.liked) await apiClient.communityUnlike(targetId, targetType)
      else await apiClient.communityLike(targetId, targetType)
    } catch (error) {
      setFeed(feed)
      void dialog.alert('操作失败', userFacingErrorMessage(error), 'danger')
    }
  }

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
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.quickBar}>
          <View style={styles.quickGrid}>
            <QuickEntry label="互动消息" icon={Bell} onPress={() => navigation.navigate('Notifications')} />
            <QuickEntry label="私信" icon={MessageCircle} onPress={() => navigation.navigate('Conversations')} />
            <QuickEntry label="好友管理" icon={UsersRound} onPress={() => navigation.navigate('Friends')} />
            <QuickEntry label="添加好友" icon={UserPlus} onPress={() => navigation.navigate('Friends')} />
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
                <Text style={[styles.feedFilterSummary, filterActive && styles.feedFilterSummaryActive]}>更多筛选</Text>
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
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <FilterDrawer
        visible={filterOpen}
        sortBy={sortBy}
        contentType={contentType}
        onClose={() => setFilterOpen(false)}
        onSortChange={setSortBy}
        onContentChange={setContentType}
      />
    </View>
  )
}

function QuickEntry({ label, icon, onPress }: { label: string; icon: LucideIcon; onPress: () => void }) {
  const Icon = icon
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickEntry, pressed && styles.pressed]}>
      <Icon size={21} color={colors.brand} strokeWidth={2.35} />
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
        {item.avatar ? <Image source={{ uri: item.avatar }} style={styles.rankingAvatar} /> : <UsersRound size={17} color="rgba(255,255,255,0.88)" strokeWidth={2.2} />}
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
}: {
  item: CommunityFeedItem
  onOpen: () => void
  onOpenAuthor: () => void
  onLike: () => void
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
          {item.author.avatar ? <Image source={{ uri: item.author.avatar }} style={styles.userAvatar} /> : <View style={styles.userAvatarFallback}><UsersRound size={19} color={colors.brand} /></View>}
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
                <Heart size={19} color={item.liked ? colors.danger : '#64748b'} fill={item.liked ? colors.danger : 'transparent'} strokeWidth={2.2} />
                <Text style={[styles.actionCount, item.liked && styles.actionCountActive]}>{item.like_count}</Text>
              </Pressable>
              <View style={styles.actionItem}>
                <MessageCircle size={19} color="#64748b" strokeWidth={2.2} />
                <Text style={styles.actionCount}>评论 {commentsCount}</Text>
              </View>
            </View>
            <View style={styles.actionManageBox}>
              <MoreHorizontal size={19} color="#64748b" strokeWidth={2.3} />
            </View>
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
  onClose,
  onSortChange,
  onContentChange,
}: {
  visible: boolean
  sortBy: CommunityFeedSortBy
  contentType: CommunityFeedContentType
  onClose: () => void
  onSortChange: (value: CommunityFeedSortBy) => void
  onContentChange: (value: CommunityFeedContentType) => void
}) {
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
  filterDrawerMask: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.42)',
  },
  filterDrawer: {
    paddingTop: 8,
    paddingHorizontal: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#fff',
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
})
