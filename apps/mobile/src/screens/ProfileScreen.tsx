import { useCallback, useEffect, useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { FoodExpiryDashboard, MembershipStatus, RewardCenterResponse, UserInfo } from '@food-link/core'
import { apiClient } from '../api'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../providers/AuthProvider'
import { colors } from '../theme'

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { logout } = useAuth()
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [reward, setReward] = useState<RewardCenterResponse | null>(null)
  const [expiry, setExpiry] = useState<FoodExpiryDashboard | null>(null)
  const [recordDays, setRecordDays] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [profileData, membershipData, rewardData, expiryData, recordDayData] = await Promise.all([
        apiClient.getUserProfile(),
        apiClient.getMyMembership().catch(() => null),
        apiClient.getRewardCenter().catch(() => null),
        apiClient.getFoodExpiryDashboard().catch(() => null),
        apiClient.getUserRecordDays().catch(() => ({ record_days: 0 })),
      ])
      setProfile(profileData)
      setMembership(membershipData)
      setReward(rewardData)
      setExpiry(expiryData)
      setRecordDays(recordDayData.record_days || 0)
    } catch (error) {
      Alert.alert('获取我的页面失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title="我的" subtitle="账户、会员、服务和设置入口。" refreshing={loading} onRefresh={load}>
      <Card>
        <View style={styles.profileRow}>
          {profile?.avatar ? <Image source={{ uri: profile.avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
          <View style={styles.profileMain}>
            <Text style={styles.nickname}>{profile?.nickname || 'Food Link 用户'}</Text>
            <Text style={styles.meta}>已记录 {recordDays} 天</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>会员积分</Text>
        <Text style={styles.bigNumber}>{membership?.total_credits_available ?? membership?.daily_credits_remaining ?? 0}</Text>
        <Text style={styles.subtitle}>
          {membership?.is_pro ? 'Pro 会员生效中' : '当前为基础账号'} · 今日已赚 {reward?.today_earned_credits || 0} 积分
        </Text>
        <Pressable onPress={() => navigation.navigate('RewardCenter')}>
          <Text style={styles.link}>去赚积分</Text>
        </Pressable>
      </Card>

      <View style={styles.statGrid}>
        <StatCard title="识别记录" value="查看" onPress={() => navigation.navigate('AnalyzeHistory')} />
        <StatCard title="好友" value="管理" onPress={() => navigation.navigate('Friends')} />
        <StatCard title="收藏" value="食物库" onPress={() => navigation.navigate('FoodLibrary')} />
      </View>

      <Card>
        <Text style={styles.sectionTitle}>服务</Text>
        <MenuItem title="健康档案" subtitle="完善身体数据与目标" onPress={() => navigation.navigate('HealthProfile')} />
        <MenuItem title="食物保质期" subtitle={expiry ? `${expiry.active_count} 样保鲜中` : '管理临期食物'} onPress={() => navigation.navigate('Expiry')} />
        <MenuItem title="体重/喝水/运动" subtitle="记录身体指标" onPress={() => navigation.navigate('BodyMetricRecord', { type: 'weight' })} />
        <MenuItem title="关于与反馈" subtitle="协议、设置、用户群等入口后续迁移" onPress={() => navigation.navigate('NativePlaceholder', { title: '关于与反馈', description: '小程序中的协议、反馈、用户群和设置页已作为 App 入口保留，后续会逐步补齐。' })} />
      </Card>

      <Pressable onPress={logout} style={styles.logout}>
        <Text style={styles.logoutText}>退出登录</Text>
      </Pressable>
    </Page>
  )
}

function StatCard({ title, value, onPress }: { title: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.statCard, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.statTitle}>{title}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </Pressable>
  )
}

function MenuItem({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.menuMain}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginRight: 14,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginRight: 14,
    backgroundColor: colors.brandSoft,
  },
  profileMain: {
    flex: 1,
  },
  nickname: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  meta: {
    marginTop: 6,
    color: colors.textSecondary,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  bigNumber: {
    color: colors.brandDark,
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  link: {
    marginTop: 12,
    color: colors.brandDark,
    fontWeight: '800',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
  },
  pressed: {
    opacity: 0.72,
  },
  statTitle: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  statValue: {
    marginTop: 8,
    color: colors.text,
    fontWeight: '900',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  menuMain: {
    flex: 1,
  },
  menuTitle: {
    color: colors.text,
    fontWeight: '800',
  },
  menuSubtitle: {
    marginTop: 3,
    color: colors.textSecondary,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 28,
  },
  logout: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  logoutText: {
    color: colors.danger,
    fontWeight: '800',
  },
})
