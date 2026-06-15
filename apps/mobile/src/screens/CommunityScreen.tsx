import { useCallback, useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { CheckinLeaderboardItem, CommunityFeedItem } from '@food-link/core'
import { apiClient } from '../api'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime } from '../utils/date'

export function CommunityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
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
      Alert.alert('获取圈子失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

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
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后重试')
    }
  }

  return (
    <Page title="圈子" subtitle="公开动态、好友互动和打卡排行。" refreshing={loading} onRefresh={load}>
      <View style={styles.quickRow}>
        <QuickEntry label="发布" onPress={() => navigation.navigate('CirclePostEdit')} />
        <QuickEntry label="好友" onPress={() => navigation.navigate('Friends')} />
        <QuickEntry label="消息" onPress={() => navigation.navigate('Notifications')} />
      </View>
      <View style={styles.quickRow}>
        <QuickEntry label="公共食物" onPress={() => navigation.navigate('PublicFood', { mode: 'all' })} />
        <QuickEntry label="校园餐" onPress={() => navigation.navigate('CampusCanteen')} />
        <QuickEntry label="私信" onPress={() => navigation.navigate('Conversations')} />
      </View>
      <View style={styles.quickRow}>
        <QuickEntry label="排行榜" onPress={() => navigation.navigate('CheckinLeaderboard')} />
        <QuickEntry label="分享食物" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'public' })} />
        <QuickEntry label="补校园餐" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'campus' })} />
      </View>

      <Card>
        <Text style={styles.sectionTitle}>本周打卡</Text>
        {leaderboard.length === 0 ? (
          <Text style={styles.empty}>暂无排行数据。</Text>
        ) : (
          leaderboard.slice(0, 3).map((item, index) => (
            <View key={item.user_id} style={styles.rankRow}>
              <Text style={styles.rankNo}>#{index + 1}</Text>
              <Text style={styles.rankName}>{item.nickname || '食友'}</Text>
              <Text style={styles.rankCount}>{item.record_count} 次</Text>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.feedTitle}>全部公开</Text>
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
                <Pressable onPress={() => navigation.navigate('ProfileSettings', { userId: item.author.id })}>
                  {item.author.avatar ? <Image source={{ uri: item.author.avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
                </Pressable>
                <View style={styles.authorMain}>
                  <Text style={styles.authorName}>{item.author.nickname || '食友'}</Text>
                  <Text style={styles.feedTime}>{formatDateTime(item.record.record_time || item.record.created_at)}</Text>
                </View>
              </View>
              <Text style={[styles.recordDesc, styles.recordTitle]}>{feedTitle(item)}</Text>
              {feedBody(item) ? <Text style={styles.recordDesc}>{feedBody(item)}</Text> : null}
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
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Page>
  )
}

function QuickEntry({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickEntry, pressed && styles.pressed]}>
      <Text style={styles.quickEntryText}>{label}</Text>
    </Pressable>
  )
}

function feedTitle(item: CommunityFeedItem): string {
  return String(item.record.title || item.record.description || item.record.items?.[0]?.name || '分享了一条饮食动态')
}

function feedBody(item: CommunityFeedItem): string {
  const body = String(item.record.body || '').trim()
  return body && body !== feedTitle(item) ? body : ''
}

const styles = StyleSheet.create({
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickEntry: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: colors.brandSoft,
    paddingVertical: 13,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  quickEntryText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  empty: {
    color: colors.textMuted,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rankNo: {
    width: 42,
    color: colors.warning,
    fontWeight: '900',
  },
  rankName: {
    flex: 1,
    color: colors.text,
    fontWeight: '700',
  },
  rankCount: {
    color: colors.textSecondary,
  },
  feedTitle: {
    marginBottom: 10,
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 10,
  },
  avatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 10,
    backgroundColor: colors.brandSoft,
  },
  authorMain: {
    flex: 1,
  },
  authorName: {
    color: colors.text,
    fontWeight: '800',
  },
  feedTime: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
  },
  recordDesc: {
    color: colors.text,
    lineHeight: 22,
  },
  recordTitle: {
    fontWeight: '800',
    marginBottom: 4,
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
