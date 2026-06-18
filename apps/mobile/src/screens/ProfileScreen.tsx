import { useCallback, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { FoodExpiryDashboard, MembershipStatus, RewardCenterResponse, UserInfo } from '@food-link/core'
import {
  Activity,
  Bell,
  BookOpen,
  Calendar,
  ChevronRight,
  CreditCard,
  FileText,
  Gift,
  Heart,
  Info,
  LineChart,
  Lock,
  LogOut,
  MapPin,
  MessageCircle,
  Package,
  PawPrint,
  Search,
  Shield,
  Sparkles,
  Star,
  Store,
  Trash2,
  Trophy,
  User,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react-native'
import { apiClient, clearRecentRequestTraces } from '../api'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { clearRecentConsoleLogs } from '../diagnostics/consoleLogBuffer'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../providers/AuthProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, radius, shadow } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type MenuTone = 'green' | 'blue' | 'gold' | 'purple' | 'slate' | 'danger'

interface MenuEntry {
  title: string
  subtitle: string
  icon: LucideIcon
  tone: MenuTone
  onPress: () => void
}

const toneMeta: Record<MenuTone, { backgroundColor: string; color: string }> = {
  green: { backgroundColor: '#ebfcf4', color: '#16a56f' },
  blue: { backgroundColor: '#ebf7fc', color: '#2b8ab7' },
  gold: { backgroundColor: '#fff7e6', color: '#a67518' },
  purple: { backgroundColor: '#f2efff', color: '#7057d8' },
  slate: { backgroundColor: '#f1f5f9', color: '#64748b' },
  danger: { backgroundColor: '#fee2e2', color: colors.danger },
}

export function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { logout } = useAuth()
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [reward, setReward] = useState<RewardCenterResponse | null>(null)
  const [expiry, setExpiry] = useState<FoodExpiryDashboard | null>(null)
  const [recordDays, setRecordDays] = useState(0)
  const [counts, setCounts] = useState({ analyze: 0, friends: 0, favorites: 0 })
  const [showMoreServices, setShowMoreServices] = useState(false)
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
      ] = await Promise.all([
        apiClient.getUserProfile(),
        apiClient.getMyMembership().catch(() => null),
        apiClient.getRewardCenter().catch(() => null),
        apiClient.getFoodExpiryDashboard().catch(() => null),
        apiClient.getUserRecordDays().catch(() => ({ record_days: 0 })),
        apiClient.getAnalyzeTaskCount().catch(() => ({ count: 0 })),
        apiClient.getFriendCount().catch(() => ({ count: 0 })),
        apiClient.getFavoriteCount().catch(() => ({ count: 0 })),
      ])
      setProfile(profileData)
      setMembership(membershipData)
      setReward(rewardData)
      setExpiry(expiryData)
      setRecordDays(recordDayData.record_days || 0)
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
    if (profile?.id) {
      navigation.navigate('PublicProfile', { userId: profile.id })
    } else {
      navigation.navigate('ProfileSettings')
    }
  }, [navigation, profile?.id])

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

  const serviceItems: MenuEntry[] = [
    { title: '健康档案', subtitle: '身体数据、病史偏好和饮食目标', icon: Heart, tone: 'green', onPress: openHealthProfile },
    { title: '食物保质期', subtitle: expiryText, icon: Calendar, tone: 'gold', onPress: () => navigation.navigate('Expiry') },
    { title: '我的宠物', subtitle: '查看成长伙伴、任务和奖励', icon: PawPrint, tone: 'green', onPress: () => navigation.navigate('PetHome') },
    { title: '赚积分', subtitle: `今日已赚 ${todayEarned} 积分`, icon: Gift, tone: 'gold', onPress: () => navigation.navigate('RewardCenter') },
    { title: '公共食物库', subtitle: '外食、校园餐和我的分享', icon: BookOpen, tone: 'blue', onPress: () => navigation.navigate('PublicFood', { mode: 'all' }) },
    { title: '校园食堂', subtitle: '校园餐、食堂窗口和价格', icon: Store, tone: 'blue', onPress: () => navigation.navigate('CampusCanteen') },
    { title: '加入用户群', subtitle: '进群反馈体验与获取更新', icon: Users, tone: 'purple', onPress: () => navigation.navigate('UserGroup') },
    { title: '意见反馈', subtitle: '反馈问题、建议或体验感受', icon: MessageCircle, tone: 'purple', onPress: () => navigation.navigate('AboutFeedback') },
  ]

  const settingsItems: MenuEntry[] = [
    { title: '隐私设置', subtitle: '搜索可见性和公开记录', icon: Shield, tone: 'slate', onPress: () => navigation.navigate('PrivacySettings') },
    { title: '关于我们', subtitle: '应用说明、协议和联系方式', icon: Info, tone: 'slate', onPress: () => navigation.navigate('About') },
  ]

  const moreItems: MenuEntry[] = [
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

  return (
    <Page title="我的" refreshing={loading} onRefresh={load}>
      <View style={styles.hero}>
        <Pressable style={({ pressed }) => [styles.profileRow, pressed && styles.pressed]} onPress={() => navigation.navigate('ProfileSettings')}>
          {profile?.avatar ? <Image source={{ uri: profile.avatar }} style={styles.avatar} /> : (
            <View style={styles.avatarFallback}>
              <User size={28} color={colors.brandDark} strokeWidth={2.4} />
            </View>
          )}
          <View style={styles.profileMain}>
            <Text style={styles.nickname}>{profile?.nickname || 'Food Link 用户'}</Text>
            <View style={styles.profileMetaRow}>
              <Text style={styles.recordPill}>已记录 {recordDays} 天</Text>
              {profile?.id ? (
                <Pressable style={({ pressed }) => [styles.idPill, pressed && styles.pressed]} onPress={copyUserId}>
                  <Text style={styles.idPillText}>ID {shortUserId(profile.id)}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <ChevronRight size={22} color={colors.textMuted} />
        </Pressable>
        <Pressable style={({ pressed }) => [styles.homepageLink, pressed && styles.pressed]} onPress={openPublicProfile}>
          <Text style={styles.homepageText}>个人主页</Text>
          <ChevronRight size={16} color={colors.brandDark} />
        </Pressable>
      </View>

      <View style={styles.statGrid}>
        <StatCard title="识别记录" value={formatCount(counts.analyze)} onPress={() => navigation.navigate('AnalyzeHistory')} />
        <StatCard title="好友管理" value={formatCount(counts.friends)} onPress={() => navigation.navigate('Friends')} />
        <StatCard title="我的收藏" value={formatCount(counts.favorites)} onPress={() => navigation.navigate('Recipes')} />
      </View>

      <Pressable style={({ pressed }) => [styles.membershipCard, pressed && styles.pressed]} onPress={() => navigation.navigate('MembershipCenter')}>
        <View style={styles.membershipTop}>
          <View>
            <Text style={styles.membershipTitle}>{membership?.is_pro ? 'Pro 会员生效中' : 'Food Link 会员'}</Text>
            <Text style={styles.membershipSubtitle}>当前可用 {credits} 积分 · 今日已赚 {todayEarned}</Text>
          </View>
          <Text style={styles.membershipAction}>查看权益</Text>
        </View>
        <View style={styles.creditTrack}>
          <View style={[styles.creditFill, { width: `${Math.max(8, Math.min(100, credits))}%` }]} />
        </View>
      </Pressable>

      <MenuSection title="常用服务" items={serviceItems} />
      <MenuSection title="设置" items={settingsItems} />

      <Card>
        <Pressable
          style={({ pressed }) => [styles.moreToggle, pressed && styles.pressed]}
          onPress={() => setShowMoreServices((value) => !value)}
        >
          <View style={styles.moreToggleMain}>
            <View style={[styles.menuIconBubble, styles.slateIcon]}>
              <Sparkles size={21} color={toneMeta.slate.color} strokeWidth={2.3} />
            </View>
            <View style={styles.menuMain}>
              <Text style={styles.menuTitle}>更多功能</Text>
              <Text style={styles.menuSubtitle}>账号安全、身体趋势和更多个人工具</Text>
            </View>
          </View>
          <ChevronRight size={21} color={colors.textMuted} style={showMoreServices ? styles.chevronOpen : undefined} />
        </Pressable>
        {showMoreServices ? moreItems.map((item) => <MenuItem key={item.title} item={item} />) : null}
      </Card>

      <View style={styles.toolGrid}>
        <Pressable style={({ pressed }) => [styles.toolButton, pressed && styles.pressed]} onPress={confirmClearCache}>
          <Trash2 size={20} color={colors.textSecondary} strokeWidth={2.3} />
          <Text style={styles.toolButtonText}>清除缓存</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.toolButton, styles.logoutButton, pressed && styles.pressed]} onPress={confirmLogout}>
          <LogOut size={20} color={colors.danger} strokeWidth={2.3} />
          <Text style={styles.logoutText}>退出登录</Text>
        </Pressable>
      </View>
    </Page>
  )
}

function MenuSection({ title, items }: { title: string; items: MenuEntry[] }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item) => <MenuItem key={item.title} item={item} />)}
    </Card>
  )
}

function StatCard({ title, value, onPress }: { title: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.statCard, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </Pressable>
  )
}

function MenuItem({ item }: { item: MenuEntry }) {
  const Icon = item.icon
  const tone = toneMeta[item.tone]
  return (
    <Pressable style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]} onPress={item.onPress}>
      <View style={[styles.menuIconBubble, { backgroundColor: tone.backgroundColor }]}>
        <Icon size={21} color={tone.color} strokeWidth={2.3} />
      </View>
      <View style={styles.menuMain}>
        <Text style={styles.menuTitle}>{item.title}</Text>
        <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
      </View>
      <ChevronRight size={20} color={colors.textMuted} />
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

const styles = StyleSheet.create({
  hero: {
    marginBottom: 14,
  },
  profileRow: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginRight: 14,
    backgroundColor: colors.brandSoft,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    backgroundColor: colors.brandSoft,
  },
  profileMain: {
    flex: 1,
    paddingRight: 8,
  },
  nickname: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  profileMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 9,
  },
  recordPill: {
    overflow: 'hidden',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.brandSoft,
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  idPill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#f1f5f9',
  },
  idPillText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  homepageLink: {
    alignSelf: 'flex-start',
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  homepageText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.surface,
    ...shadow,
  },
  statValue: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '900',
  },
  statTitle: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  membershipCard: {
    minHeight: 112,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    backgroundColor: '#0f9f72',
    shadowColor: '#0f9f72',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  membershipTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  membershipTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  membershipSubtitle: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.78)',
    fontWeight: '700',
  },
  membershipAction: {
    color: '#fff7c2',
    fontWeight: '900',
  },
  creditTrack: {
    height: 8,
    overflow: 'hidden',
    borderRadius: 999,
    marginTop: 18,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  creditFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#fff7c2',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    marginBottom: 4,
  },
  menuItem: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
    paddingVertical: 12,
  },
  menuIconBubble: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  slateIcon: {
    backgroundColor: toneMeta.slate.backgroundColor,
  },
  menuMain: {
    flex: 1,
    paddingRight: 8,
  },
  menuTitle: {
    color: colors.text,
    fontWeight: '900',
  },
  menuSubtitle: {
    marginTop: 3,
    color: colors.textSecondary,
    lineHeight: 18,
    fontSize: 13,
  },
  moreToggle: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moreToggleMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
  toolGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
    marginBottom: 12,
  },
  toolButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
  },
  toolButtonText: {
    color: colors.textSecondary,
    fontWeight: '900',
  },
  logoutButton: {
    backgroundColor: '#fff1f2',
  },
  logoutText: {
    color: colors.danger,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.72,
  },
})
