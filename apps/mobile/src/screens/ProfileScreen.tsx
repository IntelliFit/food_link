import { useCallback, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { FoodExpiryDashboard, MembershipStatus, RewardCenterResponse, UserInfo } from '@food-link/core'
import {
  Activity,
  Bell,
  BookOpen,
  ChevronRight,
  CreditCard,
  FileText,
  LineChart,
  Lock,
  MapPin,
  Package,
  Search,
  Shield,
  Sparkles,
  Star,
  Trophy,
  User,
  UserPlus,
  type LucideIcon,
} from 'lucide-react-native'
import { apiClient, clearRecentRequestTraces } from '../api'
import { APP_VERSION } from '../config'
import { clearRecentConsoleLogs } from '../diagnostics/consoleLogBuffer'
import { IconfontText } from '../components/Iconfont'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../providers/AuthProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, radius } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type MenuTone = 'green' | 'blue' | 'gold' | 'purple' | 'slate' | 'danger'

interface MenuEntry {
  title: string
  subtitle: string
  icon?: LucideIcon
  iconClass?: string
  tone: MenuTone
  badgeCount?: number
  onPress: () => void
}

type RewardLevelMeta = {
  level: number
  title: string
  min: number
  max: number | null
}

const toneMeta: Record<MenuTone, { backgroundColor: string; color: string }> = {
  green: { backgroundColor: '#ecfcf4', color: '#41a17a' },
  blue: { backgroundColor: '#ecf7fc', color: '#4c92b3' },
  gold: { backgroundColor: '#faf5e8', color: '#987f42' },
  purple: { backgroundColor: '#f3e8ff', color: '#7c68d8' },
  slate: { backgroundColor: '#f1f5f9', color: '#6b7280' },
  danger: { backgroundColor: '#fee2e2', color: colors.danger },
}

const rewardLevels: RewardLevelMeta[] = [
  { level: 1, title: '探味新芽', min: 0, max: 10 },
  { level: 2, title: '零食巡逻队', min: 10, max: 50 },
  { level: 3, title: '风味侦察员', min: 50, max: 200 },
  { level: 4, title: '菜单收藏家', min: 200, max: 1000 },
  { level: 5, title: '热量驯龙师', min: 1000, max: 3000 },
  { level: 6, title: '传说食探长', min: 3000, max: null },
]

function buildMoreItems(navigation: NativeStackNavigationProp<RootStackParamList>): MenuEntry[] {
  return [
    { title: 'AI 助手', subtitle: '风险解读、饮食建议和关注卡片', icon: Sparkles, tone: 'green', onPress: () => navigation.navigate('AiAssistant') },
    { title: '账号安全', subtitle: '手机号密码与备用登录方式', icon: Lock, tone: 'slate', onPress: () => navigation.navigate('AccountSecurity') },
    { title: '互动消息', subtitle: '点赞、评论、回复和审核结果', icon: Bell, tone: 'purple', onPress: () => navigation.navigate('Notifications') },
    { title: '邀请好友', subtitle: '分享邀请码和好友奖励', icon: UserPlus, tone: 'gold', onPress: () => navigation.navigate('InviteFriends') },
    { title: '打卡排行榜', subtitle: '查看本周打卡排名', icon: Trophy, tone: 'gold', onPress: () => navigation.navigate('CheckinLeaderboard') },
    { title: '代谢分析', subtitle: 'BMR、TDEE 和摄入差额', icon: Activity, tone: 'green', onPress: () => navigation.navigate('StatsMetabolic') },
    { title: '身体趋势', subtitle: '查看体重、饮水和月度摄入趋势', icon: LineChart, tone: 'blue', onPress: () => navigation.navigate('BodyTrends') },
    { title: '包装食品', subtitle: '上传营养成分表和商品包装', icon: Package, tone: 'blue', onPress: () => navigation.navigate('PackagedFoodEdit') },
    { title: '收藏食谱', subtitle: '常吃组合一键写入饮食记录', icon: Star, tone: 'gold', onPress: () => navigation.navigate('Recipes') },
    { title: '食物库', subtitle: '营养库、自定义食物和手动记录', icon: Search, tone: 'blue', onPress: () => navigation.navigate('FoodLibrary') },
    { title: '分享到公共库', subtitle: '上传外食、校园餐或自制餐食', icon: BookOpen, tone: 'purple', onPress: () => navigation.navigate('PublicFoodShare', { mode: 'public' }) },
    { title: '定位搜索', subtitle: '搜索商家、食堂或地点', icon: MapPin, tone: 'slate', onPress: () => navigation.navigate('LocationSearch') },
    { title: '自动续费审核', subtitle: '续费状态与支付渠道说明', icon: CreditCard, tone: 'slate', onPress: () => navigation.navigate('AutoRenewAudit') },
    { title: '用户协议', subtitle: '服务条款摘要', icon: FileText, tone: 'slate', onPress: () => navigation.navigate('Agreements') },
    { title: '会员协议', subtitle: '会员权益、续费和订单说明', icon: FileText, tone: 'slate', onPress: () => navigation.navigate('MembershipAgreement') },
    { title: '隐私政策', subtitle: '数据、图片和缓存说明', icon: Shield, tone: 'slate', onPress: () => navigation.navigate('PrivacyPolicy') },
  ]
}

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const { logout } = useAuth()
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [reward, setReward] = useState<RewardCenterResponse | null>(null)
  const [expiry, setExpiry] = useState<FoodExpiryDashboard | null>(null)
  const [recordDays, setRecordDays] = useState(0)
  const [counts, setCounts] = useState({ analyze: 0, friends: 0, favorites: 0 })
  const [friendRequestCount, setFriendRequestCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [
        profileData,
        membershipData,
        rewardData,
        expiryData,
        recordDayData,
        analyzeCount,
        friendCount,
        favoriteCount,
        friendRequestsData,
      ] = await Promise.all([
        apiClient.getUserProfile(),
        apiClient.getMyMembership().catch(() => null),
        apiClient.getRewardCenter().catch(() => null),
        apiClient.getFoodExpiryDashboard().catch(() => null),
        apiClient.getUserRecordDays().catch(() => ({ record_days: 0 })),
        apiClient.getAnalyzeTaskCount().catch(() => ({ count: 0 })),
        apiClient.getFriendCount().catch(() => ({ count: 0 })),
        apiClient.getFavoriteCount().catch(() => ({ count: 0 })),
        apiClient.getFriendRequestsOverview().catch(() => null),
      ])
      setProfile(profileData)
      setMembership(membershipData)
      setReward(rewardData)
      setExpiry(expiryData)
      setRecordDays(recordDayData.record_days || 0)
      setFriendRequestCount(friendRequestsData?.received?.filter((item) => item.status === 'pending').length || 0)
      setCounts({
        analyze: analyzeCount.count || 0,
        friends: friendCount.count || 0,
        favorites: favoriteCount.count || 0,
      })
    } catch (error) {
      void dialog.alert('获取我的页面失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const copyUserId = useCallback(async () => {
    if (!profile?.id) return
    await Clipboard.setStringAsync(profile.id)
    void dialog.alert('已复制用户 ID', shortUserId(profile.id), 'success')
  }, [dialog, profile?.id])

  const openPublicProfile = useCallback(() => {
    navigation.navigate('ProfileSettings')
  }, [navigation])

  const clearCache = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const removable = keys.filter((key) => (
        key.startsWith('food_link_mobile_') &&
        !key.includes('access_token') &&
        !key.includes('refresh_token') &&
        !key.includes('user_id')
      ))
      if (removable.length) await AsyncStorage.multiRemove(removable)
      clearRecentRequestTraces()
      clearRecentConsoleLogs()
      void dialog.alert('已清除', '本地缓存和诊断记录已清理，登录状态已保留。', 'success')
    } catch (error) {
      void dialog.alert('清除失败', userFacingErrorMessage(error), 'danger')
    }
  }, [dialog])

  const confirmClearCache = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: '清除缓存',
      message: '首页、识别记录和圈子会在下次进入时重新加载，登录状态会保留。',
      confirmText: '清除',
      kind: 'warning',
    })
    if (confirmed) void clearCache()
  }, [clearCache, dialog])

  const confirmLogout = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: '退出登录',
      message: '退出后将移除本机登录状态。',
      confirmText: '退出',
      kind: 'danger',
    })
    if (confirmed) void logout()
  }, [dialog, logout])

  const openHealthProfile = () => {
    navigation.navigate(profile?.onboarding_completed ? 'HealthProfileView' : 'HealthProfile')
  }

  const credits = membership?.total_credits_available ?? membership?.daily_credits_remaining ?? 0
  const todayEarned = reward?.today_earned_credits || 0
  const expiryText = expiry ? `${expiry.active_count || 0} 样保鲜中，${expiry.soon_count || 0} 样临期` : '管理临期食物'
  const expiryBadge = expiry ? (expiry.expired_count || 0) + (expiry.today_count || 0) + (expiry.soon_count || 0) : 0
  const systemMax = membership?.daily_credits_max ?? membership?.daily_limit ?? 0
  const systemUsed = membership?.daily_credits_used ?? membership?.daily_used ?? 0
  const systemRemain = membership?.system_credits_remaining
    ?? membership?.daily_credits_remaining
    ?? membership?.daily_remaining
    ?? Math.max(systemMax - systemUsed, 0)
  const earnedBalance = membership?.earned_credits_balance ?? 0
  const rewardLevel = getRewardLevelMeta(earnedBalance)
  const systemProgressPct = systemMax > 0 ? Math.min((systemRemain / systemMax) * 100, 100) : 0
  const rewardProgressPct = getRewardLevelProgress(earnedBalance, rewardLevel)
  const isTrial = !membership?.is_pro && Boolean(membership?.trial_active)
  const memberTier = membership?.is_pro ? membershipTierLabel(membership.current_plan_code) : isTrial ? '试用中' : '未开通'
  const founderBenefitText = membership?.early_user_rank
    ? `会员权益×2（前${membership.early_user_limit || 1000}名用户优惠政策） ${membership.early_user_rank}/${membership.early_user_limit || 1000}`
    : membership?.early_user_paid_bonus_active || membership?.early_user_paid_bonus_eligible
      ? `会员权益×2（前${membership.early_user_limit || 1000}名用户优惠政策）`
      : ''

  const serviceItems: MenuEntry[] = [
    { title: '健康档案', subtitle: '身体数据、病史偏好和饮食目标', iconClass: 'icon-shentinianling', tone: 'green', onPress: openHealthProfile },
    { title: '食物保质期', subtitle: expiryText, iconClass: 'icon-guoqi1', tone: 'gold', badgeCount: expiryBadge, onPress: () => navigation.navigate('Expiry') },
    { title: '我的宠物', subtitle: '查看成长伙伴、任务和奖励', iconClass: 'icon-good', tone: 'purple', onPress: () => navigation.navigate('PetHome') },
    { title: '赚积分', subtitle: `今日已赚 ${todayEarned} 积分`, iconClass: 'icon-zengji', tone: 'slate', onPress: () => navigation.navigate('RewardCenter') },
    { title: '公共食物库', subtitle: '外食、校园餐和我的分享', iconClass: 'icon-foodshop', tone: 'blue', onPress: () => navigation.navigate('PublicFood', { mode: 'all' }) },
    { title: '校园食堂', subtitle: '校园餐、食堂窗口和价格', iconClass: 'icon-dizhi', tone: 'slate', onPress: () => navigation.navigate('CampusCanteen') },
    { title: '加入用户群', subtitle: '进群反馈体验与获取更新', iconClass: 'icon-pengyouquan', tone: 'purple', onPress: () => navigation.navigate('UserGroup') },
    { title: '意见反馈', subtitle: '反馈问题、建议或体验感受', iconClass: 'icon-pinglun', tone: 'green', onPress: () => navigation.navigate('AboutFeedback') },
  ]

  const settingsItems: MenuEntry[] = [
    { title: '隐私设置', subtitle: '搜索可见性和公开记录', iconClass: 'icon-jiesuo', tone: 'green', onPress: () => navigation.navigate('PrivacySettings') },
    { title: '关于我们', subtitle: '应用说明、协议和联系方式', iconClass: 'icon-all', tone: 'gold', onPress: () => navigation.navigate('About') },
  ]

  return (
    <View style={styles.profilePage}>
      <View style={styles.profileWash} pointerEvents="none" />
      <ScrollView
        style={styles.profileScroll}
        contentContainerStyle={[
          styles.profileContent,
          { paddingTop: Math.max(insets.top + 8, 20), paddingBottom: insets.bottom + 180 },
        ]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileHeaderSection}>
          <Pressable style={({ pressed }) => [styles.userCard, pressed && styles.pressed]} onPress={() => navigation.navigate('ProfileSettings')}>
            {profile?.avatar ? (
              <Image source={{ uri: profile.avatar }} style={styles.userAvatar} />
            ) : (
              <View style={styles.userAvatarFallback}>
                <User size={42} color="#cbd5e1" strokeWidth={1.9} />
              </View>
            )}
            <View style={styles.userInfoMain}>
              <View style={styles.userNameRow}>
                <Text style={styles.userName} numberOfLines={1}>{profile?.nickname || '用户昵称'}</Text>
                <View style={styles.userNameActions}>
                  <View style={styles.userDaysPill}>
                    <Text style={styles.userDaysPillText}>已记录 {recordDays} 天</Text>
                  </View>
                  {profile?.id ? (
                    <Pressable style={({ pressed }) => [styles.userIdChip, pressed && styles.pressed]} onPress={copyUserId}>
                      <Text style={styles.userIdChipText}>复制ID</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <Pressable style={({ pressed }) => [styles.userMetaRow, pressed && styles.pressed]} onPress={openPublicProfile}>
                <Text style={styles.userMetaText}>个人主页</Text>
                <ChevronRight size={15} color="#9ca3af" strokeWidth={2.3} />
              </Pressable>
            </View>
          </Pressable>

          <View style={styles.quickActions}>
            <QuickAction title="识别记录" value={formatCount(counts.analyze)} onPress={() => navigation.navigate('AnalyzeHistory')} />
            <QuickAction title="好友管理" value={formatCount(counts.friends)} badgeCount={friendRequestCount} onPress={() => navigation.navigate('Friends')} />
            <QuickAction title="我的收藏" value={formatCount(counts.favorites)} onPress={() => navigation.navigate('Recipes')} />
          </View>
        </View>

        {profile && profile.onboarding_completed === false ? (
          <Pressable style={({ pressed }) => [styles.onboardingCard, pressed && styles.pressed]} onPress={() => navigation.navigate('HealthProfile')}>
            <Text style={styles.onboardingText}>完善健康档案，获取个性化饮食建议</Text>
            <ChevronRight size={18} color="#166534" strokeWidth={2.4} />
          </Pressable>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.memberCard,
            membership?.is_pro ? styles.memberCardPro : styles.memberCardFree,
            pressed && styles.pressed,
          ]}
          onPress={() => navigation.navigate('MembershipCenter')}
        >
          <View style={styles.memberCardHeader}>
            <Text style={styles.memberCardTitle}>食探会员</Text>
            <Text style={styles.memberBadge}>{memberTier}</Text>
          </View>
          <View style={styles.memberMeter}>
            <View style={styles.memberMeterHead}>
              <Text style={styles.memberMeterLabel}>系统可用（次日清0）</Text>
              <Text style={styles.memberMeterValue}>
                {systemMax > 0 ? `可用 ${systemRemain}/${systemMax}` : `可用 ${systemRemain}`}
              </Text>
            </View>
            <View style={styles.memberProgressBar}>
              <View style={[styles.memberProgressInner, { width: `${Math.max(0, Math.min(systemProgressPct, 100))}%` }]} />
            </View>
          </View>
          <View style={styles.memberMeter}>
            <View style={styles.memberMeterHead}>
              <Text style={styles.memberMeterLabel}>奖励可用（一直持有）</Text>
              <Text style={styles.memberMeterValue}>
                {`${formatRewardLevelRange(earnedBalance, rewardLevel)} · Lv${rewardLevel.level} ${rewardLevel.title}`}
              </Text>
            </View>
            <View style={styles.segmentedProgress}>
              {Array.from({ length: 10 }).map((_, index) => (
                <View
                  key={index}
                  style={[
                    styles.segmentedProgressBar,
                    index < Math.min(Math.max(Math.ceil(rewardProgressPct / 10), 0), 10) && styles.segmentedProgressFilled,
                  ]}
                />
              ))}
            </View>
          </View>
          {founderBenefitText ? <Text style={styles.memberBenefit} numberOfLines={1}>{founderBenefitText}</Text> : null}
          <Text style={styles.memberCardTip}>当前可用 {credits} 积分 · 今日已赚 {todayEarned}</Text>
        </Pressable>

        <View style={styles.listCard}>
          {serviceItems.map((item, index) => (
            <ProfileListItem key={item.title} item={item} first={index === 0} />
          ))}
          {settingsItems.map((item) => <ProfileListItem key={item.title} item={item} />)}
          <ProfileListItem
            item={{
              title: '更多功能',
              subtitle: '账号安全、身体趋势和更多个人工具',
              icon: Sparkles,
              tone: 'slate',
              onPress: () => navigation.navigate('ProfileMoreFeatures'),
            }}
          />
        </View>

        <Pressable style={({ pressed }) => [styles.toolCard, pressed && styles.pressed]} onPress={confirmClearCache}>
          <Text style={styles.toolText}>清除缓存</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.toolCard, pressed && styles.pressed]} onPress={confirmLogout}>
          <Text style={styles.toolTextLogout}>退出登录</Text>
        </Pressable>

        <Text style={styles.profileVersion}>版本号 v{APP_VERSION}</Text>
      </ScrollView>
    </View>
  )
}

export function ProfileMoreFeaturesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const moreItems = buildMoreItems(navigation)

  return (
    <View style={styles.profilePage}>
      <View style={styles.profileWash} pointerEvents="none" />
      <ScrollView
        style={styles.profileScroll}
        contentContainerStyle={[
          styles.profileContent,
          styles.moreFeaturesContent,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.listCard}>
          {moreItems.map((item, index) => (
            <ProfileListItem key={item.title} item={item} first={index === 0} />
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

function QuickAction({
  title,
  value,
  badgeCount,
  onPress,
}: {
  title: string
  value: string
  badgeCount?: number
  onPress: () => void
}) {
  return (
    <Pressable style={({ pressed }) => [styles.quickActionItem, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.quickActionNumWrap}>
        <Text style={styles.quickActionNum}>{value}</Text>
        {badgeCount ? (
          <View style={styles.quickActionBadge}>
            <Text style={styles.quickActionBadgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.quickActionText}>{title}</Text>
    </Pressable>
  )
}

function ProfileListItem({
  item,
  first,
  chevronStyle,
}: {
  item: MenuEntry
  first?: boolean
  chevronStyle?: object
}) {
  const Icon = item.icon
  const tone = toneMeta[item.tone]
  return (
    <Pressable style={({ pressed }) => [styles.listItem, first && styles.listItemFirst, pressed && styles.pressed]} onPress={item.onPress}>
      <View style={[styles.listIcon, { backgroundColor: tone.backgroundColor }]}>
        {item.iconClass ? (
          <IconfontText className={`iconfont ${item.iconClass}`} size={20} color={tone.color} />
        ) : Icon ? (
          <Icon size={18} color={tone.color} strokeWidth={2.35} />
        ) : null}
      </View>
      <Text style={styles.listTitle} numberOfLines={1}>{item.title}</Text>
      {item.badgeCount ? (
        <View style={styles.listBadge}>
          <Text style={styles.listBadgeText}>{item.badgeCount > 99 ? '99+' : item.badgeCount}</Text>
        </View>
      ) : null}
      <ChevronRight size={18} color="#c8c9cc" strokeWidth={2.35} style={chevronStyle} />
    </Pressable>
  )
}

function shortUserId(id: string): string {
  const value = id.trim()
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function formatCount(value: number): string {
  if (value >= 1000) return `${Math.floor(value / 100) / 10}k`
  return String(Math.max(0, value))
}

function getRewardLevelMeta(points: number): RewardLevelMeta {
  const normalized = Math.max(Number(points || 0), 0)
  return rewardLevels.find((level) => level.max == null ? normalized >= level.min : normalized >= level.min && normalized < level.max) || rewardLevels[0]
}

function getRewardLevelProgress(points: number, meta: RewardLevelMeta): number {
  const normalized = Math.max(Number(points || 0), 0)
  if (meta.max == null) return 100
  const span = Math.max(meta.max - meta.min, 1)
  return Math.max(0, Math.min(((normalized - meta.min) / span) * 100, 100))
}

function formatRewardLevelRange(points: number, meta: RewardLevelMeta): string {
  const normalized = Math.max(Number(points || 0), 0)
  if (meta.max == null) return `${normalized}+`
  return `${normalized}/${meta.max}`
}

function membershipTierLabel(planCode?: string | null): string {
  const text = String(planCode || '').toLowerCase()
  if (text.includes('advanced')) return '进阶版'
  if (text.includes('standard')) return '标准版'
  if (text.includes('light')) return '轻享版'
  return 'Pro'
}

const styles = StyleSheet.create({
  profilePage: {
    flex: 1,
    backgroundColor: '#f0f3f6',
  },
  profileWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  profileScroll: {
    flex: 1,
  },
  profileContent: {
    paddingBottom: 120,
  },
  moreFeaturesContent: {
    paddingTop: 12,
  },
  profileHeaderSection: {
    marginHorizontal: 12,
    marginBottom: 12,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 10,
  },
  userAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#e2e8f0',
  },
  userAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  userInfoMain: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 20,
  },
  userName: {
    flexShrink: 1,
    color: '#111827',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  userNameActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  userDaysPill: {
    overflow: 'hidden',
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#c8e6c9',
    backgroundColor: '#e8f5e9',
  },
  userDaysPillText: {
    color: '#2e7d32',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  userIdChip: {
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 4,
    backgroundColor: 'rgba(92, 184, 150, 0.08)',
  },
  userIdChipText: {
    color: '#5a9e82',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
  },
  userMetaRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 2,
  },
  userMetaText: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 17,
  },
  quickActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  quickActionItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  quickActionNumWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionNum: {
    color: '#1f2937',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
  },
  quickActionText: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 16,
  },
  quickActionBadge: {
    position: 'absolute',
    top: -6,
    right: -24,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
  },
  quickActionBadgeText: {
    color: '#fff',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
  },
  onboardingCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0fdf4',
  },
  onboardingText: {
    color: '#166534',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  memberCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 14,
    overflow: 'hidden',
  },
  memberCardFree: {
    backgroundColor: '#5cb896',
    shadowColor: '#5cb896',
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  memberCardPro: {
    backgroundColor: '#0a3d28',
    shadowColor: '#003c28',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  memberCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  memberCardTitle: {
    color: '#fff',
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
  },
  memberBadge: {
    overflow: 'hidden',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.22)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  memberMeter: {
    marginBottom: 13,
  },
  memberMeterHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 7,
  },
  memberMeterLabel: {
    color: 'rgba(255,255,255,0.94)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  memberMeterValue: {
    flex: 1,
    color: '#fff',
    textAlign: 'right',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  memberProgressBar: {
    height: 6,
    overflow: 'hidden',
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.13)',
  },
  memberProgressInner: {
    height: 6,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  segmentedProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 6,
  },
  segmentedProgressBar: {
    flex: 1,
    height: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  segmentedProgressFilled: {
    backgroundColor: '#fbbf24',
  },
  memberBenefit: {
    marginTop: -2,
    color: 'rgba(255,255,255,0.98)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  memberCardTip: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.74)',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  listCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 61,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f1f5f9',
    paddingVertical: 13,
  },
  listItemFirst: {
    borderTopWidth: 0,
  },
  listIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listTitle: {
    flex: 1,
    color: '#1f2937',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
  listBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
  },
  listBadgeText: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  toolCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  toolText: {
    color: '#64748b',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  toolTextLogout: {
    color: '#ef4444',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  profileVersion: {
    marginTop: 4,
    marginBottom: 6,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
})
