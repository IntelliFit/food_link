import { useCallback, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { CheckinLeaderboardItem, CommunityFeedItem } from '@food-link/core'
import { Bell, ChevronRight, Filter, MessageCircle, PenLine, Search, Send, Trophy, UserPlus, UsersRound, Utensils, type LucideIcon } from 'lucide-react-native'
import { apiClient } from '../api'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, radius, shadow } from '../theme'
import { formatDateTime } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'

type QuickTone = 'green' | 'blue' | 'purple' | 'gold'

const quickToneMeta: Record<QuickTone, { backgroundColor: string; color: string }> = {
  green: { backgroundColor: '#ecfdf5', color: colors.brandDark },
  blue: { backgroundColor: '#eff6ff', color: '#2b8ab7' },
  purple: { backgroundColor: '#f2efff', color: '#7057d8' },
  gold: { backgroundColor: '#fff7e6', color: '#a67518' },
}

export function CommunityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [feed, setFeed] = useState<CommunityFeedItem[]>([])
  const [leaderboard, setLeaderboard] = useState<CheckinLeaderboardItem[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [feedData, leaderboardData] = await Promise.all([
        apiClient.communityGetFeed({ limit: 10, params: { sort_by: 'latest', content_type: 'all' } }),
        apiClient.communityGetCheckinLeaderboard().catch(() => ({ list: [] as CheckinLeaderboardItem[], week_start: '', week_end: '' })),
      ])
      setFeed(feedData.list || [])
      setLeaderboard(leaderboardData.list || [])
    } catch (error) {
      void dialog.alert('获取圈子失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

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
    <Page title="圈子" subtitle="公开动态、好友互动和打卡排行。" refreshing={loading} onRefresh={load}>
      <View style={styles.quickGrid}>
        <QuickEntry label="互动消息" icon={Bell} tone="green" onPress={() => navigation.navigate('Notifications')} />
        <QuickEntry label="私信" icon={MessageCircle} tone="blue" onPress={() => navigation.navigate('Conversations')} />
        <QuickEntry label="好友管理" icon={UsersRound} tone="purple" onPress={() => navigation.navigate('Friends')} />
        <QuickEntry label="添加好友" icon={UserPlus} tone="gold" onPress={() => navigation.navigate('Friends')} />
      </View>

      <Pressable style={({ pressed }) => [styles.leaderboardCard, pressed && styles.pressed]} onPress={() => navigation.navigate('CheckinLeaderboard')}>
        <View style={styles.leaderboardHeader}>
          <View style={styles.leaderboardIcon}>
            <Trophy size={25} color="#fff" strokeWidth={2.5} />
          </View>
          <View style={styles.leaderboardTitleBlock}>
            <Text style={styles.leaderboardTitle}>本周打卡排行榜</Text>
            <Text style={styles.leaderboardSubtitle}>看看谁是本周最活跃</Text>
          </View>
          <ChevronRight size={22} color="rgba(255,255,255,0.85)" />
        </View>
        <View style={styles.leaderboardPeople}>
          {leaderboard.slice(0, 3).map((item, index) => (
            <RankMini key={item.user_id} item={item} rank={item.rank || index + 1} />
          ))}
          {leaderboard.length === 0 ? (
            <Text style={styles.leaderboardEmpty}>暂无排行数据，记录一餐后会出现在这里。</Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.feedHeader}>
        <Text style={styles.feedTitle}>公开动态</Text>
        <Pressable onPress={() => navigation.navigate('PublicFood', { mode: 'all' })}>
          <Text style={styles.foodLink}>食物库</Text>
        </Pressable>
      </View>

      <View style={styles.feedTools}>
        <Pressable style={({ pressed }) => [styles.searchBar, pressed && styles.pressed]} onPress={() => navigation.navigate('CommunitySearch')}>
          <Search size={19} color={colors.textMuted} strokeWidth={2.2} />
          <Text style={styles.searchPlaceholder}>搜索动态内容或用户...</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]} onPress={() => navigation.navigate('CommunitySearch')}>
          <Filter size={19} color={colors.textSecondary} strokeWidth={2.2} />
          <Text style={styles.filterText}>筛选</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.publishButton, pressed && styles.pressed]} onPress={() => navigation.navigate('CirclePostEdit')}>
          <PenLine size={18} color="#fff" strokeWidth={2.3} />
          <Text style={styles.publishText}>发布</Text>
        </Pressable>
      </View>

      <View style={styles.secondaryChips}>
        <ShortcutChip label="校园餐" onPress={() => navigation.navigate('CampusCanteen')} />
        <ShortcutChip label="分享食物" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'public' })} />
        <ShortcutChip label="补校园餐" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'campus' })} />
      </View>

      {feed.length === 0 ? (
        <Card>
          <Text style={styles.empty}>还没有动态，记录一餐后会在这里出现。</Text>
        </Card>
      ) : (
        feed.map((item) => (
          <Pressable
            key={`${item.target_type || 'food'}-${item.target_id || item.record.id}`}
            onPress={() => navigation.navigate('CommunityFeedDetail', {
              targetId: item.target_id || item.record.id,
              targetType: item.target_type || item.record.feed_type || 'food_record',
            })}
          >
            <Card>
              <View style={styles.authorRow}>
                <Pressable onPress={() => navigation.navigate('PublicProfile', { userId: item.author.id })}>
                  {item.author.avatar ? <Image source={{ uri: item.author.avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
                </Pressable>
                <View style={styles.authorMain}>
                  <Text style={styles.authorName}>{item.author.nickname || '食友'}</Text>
                  <Text style={styles.feedTime}>{feedMeta(item)}</Text>
                </View>
              </View>
              <Text style={styles.recordTitle}>{feedTitle(item)}</Text>
              {feedBody(item) ? <Text style={styles.recordDesc}>{feedBody(item)}</Text> : null}
              {feedImage(item) ? <Image source={{ uri: feedImage(item) }} style={styles.feedImage} /> : null}
              <View style={styles.nutritionRow}>
                <Text style={styles.nutritionItem}>{Math.round(item.record.total_calories || 0)} kcal</Text>
                <Text style={styles.nutritionItem}>P {Math.round(item.record.total_protein || 0)}g</Text>
                <Text style={styles.nutritionItem}>C {Math.round(item.record.total_carbs || 0)}g</Text>
                <Text style={styles.nutritionItem}>F {Math.round(item.record.total_fat || 0)}g</Text>
              </View>
              <View style={styles.actionRow}>
                <Pressable onPress={() => toggleLike(item)}>
                  <Text style={[styles.actionText, item.liked && styles.actionTextActive]}>{item.liked ? '已赞' : '点赞'} {item.like_count}</Text>
                </Pressable>
                <Text style={styles.actionText}>评论 {item.comment_count || item.comments?.length || 0}</Text>
                <Send size={17} color={colors.textMuted} strokeWidth={2.2} />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Page>
  )
}

function QuickEntry({ label, icon, tone, onPress }: { label: string; icon: LucideIcon; tone: QuickTone; onPress: () => void }) {
  const Icon = icon
  const meta = quickToneMeta[tone]
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickEntry, pressed && styles.pressed]}>
      <View style={[styles.quickIcon, { backgroundColor: meta.backgroundColor }]}>
        <Icon size={24} color={meta.color} strokeWidth={2.3} />
      </View>
      <Text style={styles.quickEntryText}>{label}</Text>
    </Pressable>
  )
}

function RankMini({ item, rank }: { item: CheckinLeaderboardItem; rank: number }) {
  const checkinCount = item.checkin_count ?? item.record_count ?? 0
  return (
    <View style={styles.rankMini}>
      <Text style={styles.rankNo}>{rank}</Text>
      {item.avatar ? <Image source={{ uri: item.avatar }} style={styles.rankAvatar} /> : <View style={styles.rankAvatarFallback} />}
      <Text style={styles.rankName} numberOfLines={1}>{item.nickname || '食友'}</Text>
      <Text style={styles.rankCount}>{checkinCount}次</Text>
    </View>
  )
}

function ShortcutChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.shortcutChip, pressed && styles.pressed]} onPress={onPress}>
      <Utensils size={16} color={colors.brandDark} strokeWidth={2.2} />
      <Text style={styles.shortcutText}>{label}</Text>
    </Pressable>
  )
}

function feedTitle(item: CommunityFeedItem): string {
  return String(item.record.title || item.record.description || item.record.items?.[0]?.name || '分享了一条饮食动态')
}

function feedBody(item: CommunityFeedItem): string {
  const body = String(item.record.body || item.record.insight || '').trim()
  return body && body !== feedTitle(item) ? body : ''
}

function feedImage(item: CommunityFeedItem): string {
  const images = Array.isArray(item.record.image_paths) ? item.record.image_paths : []
  return String(images[0] || item.record.image_path || '').trim()
}

function feedMeta(item: CommunityFeedItem): string {
  const type = item.target_type || item.record.feed_type || 'food_record'
  const label = type === 'circle_post'
    ? '自定义动态'
    : type === 'exercise_log'
      ? '运动打卡'
      : type === 'campus_food'
        ? '校园食堂'
        : '饮食记录'
  return `${label} · ${formatDateTime(item.record.record_time || item.record.created_at)}`
}

const styles = StyleSheet.create({
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickEntry: {
    flex: 1,
    minHeight: 86,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  quickIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  pressed: {
    opacity: 0.72,
  },
  quickEntryText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  leaderboardCard: {
    borderRadius: 22,
    padding: 18,
    marginBottom: 20,
    backgroundColor: '#55bd91',
    shadowColor: '#0f9f72',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  leaderboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaderboardIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  leaderboardTitleBlock: {
    flex: 1,
  },
  leaderboardTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  leaderboardSubtitle: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.86)',
    fontWeight: '700',
  },
  leaderboardPeople: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  leaderboardEmpty: {
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '700',
    lineHeight: 20,
  },
  rankMini: {
    flex: 1,
    alignItems: 'center',
  },
  rankNo: {
    color: '#fff7c2',
    fontWeight: '900',
  },
  rankAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginTop: 5,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  rankAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginTop: 5,
    backgroundColor: 'rgba(255,255,255,0.34)',
  },
  rankName: {
    maxWidth: '100%',
    marginTop: 5,
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  rankCount: {
    color: '#fff7c2',
    fontSize: 12,
    fontWeight: '900',
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  feedTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  foodLink: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  feedTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchBar: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  searchPlaceholder: {
    marginLeft: 8,
    color: colors.textMuted,
    fontWeight: '700',
  },
  filterButton: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  filterText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  publishButton: {
    minHeight: 46,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    backgroundColor: colors.brand,
  },
  publishText: {
    color: '#fff',
    fontWeight: '900',
  },
  secondaryChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  shortcutChip: {
    minHeight: 36,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.brandSoft,
  },
  shortcutText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  empty: {
    color: colors.textMuted,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 10,
  },
  avatarFallback: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 10,
    backgroundColor: colors.brandSoft,
  },
  authorMain: {
    flex: 1,
  },
  authorName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  feedTime: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
  },
  recordTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  recordDesc: {
    marginTop: 6,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  feedImage: {
    width: '100%',
    aspectRatio: 1.35,
    borderRadius: 16,
    marginTop: 12,
    backgroundColor: colors.surfaceMuted,
  },
  nutritionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  nutritionItem: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    marginTop: 16,
  },
  actionText: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  actionTextActive: {
    color: colors.brandDark,
  },
})
