import { useCallback, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { FoodExpiryDashboard, MembershipStatus, RewardCenterResponse, UserInfo } from '@food-link/core'
import { apiClient, clearRecentRequestTraces } from '../api'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import { clearRecentConsoleLogs } from '../diagnostics/consoleLogBuffer'
import type { RootStackParamList } from '../navigation/types'
import { useAuth } from '../providers/AuthProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

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
      Alert.alert('获取我的页面失败', userFacingErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const confirmClearCache = () => {
    Alert.alert(
      '清除缓存',
      '确定要清除本地缓存吗？首页、识别记录和圈子会在下次进入时重新加载，登录状态会保留。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: () => {
            void clearCache()
          },
        },
      ],
    )
  }

  const clearCache = async () => {
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
      Alert.alert('已清除', '本地缓存和诊断记录已清理，登录状态已保留。')
    } catch (error) {
      Alert.alert('清除失败', userFacingErrorMessage(error))
    }
  }

  const confirmLogout = () => {
    Alert.alert(
      '退出登录',
      '确定要退出登录吗？退出后将移除本机登录状态。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出',
          style: 'destructive',
          onPress: () => {
            void logout()
          },
        },
      ],
    )
  }

  return (
    <Page title="我的" subtitle="账户、会员、服务和设置入口。" refreshing={loading} onRefresh={load}>
      <Card>
        <Pressable style={styles.profileRow} onPress={() => navigation.navigate('ProfileSettings')}>
          {profile?.avatar ? <Image source={{ uri: profile.avatar }} style={styles.avatar} /> : <View style={styles.avatarFallback} />}
          <View style={styles.profileMain}>
            <Text style={styles.nickname}>{profile?.nickname || 'Food Link 用户'}</Text>
            <Text style={styles.meta}>已记录 {recordDays} 天 · 编辑资料与个人主页</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>会员积分</Text>
        <Text style={styles.bigNumber}>{membership?.total_credits_available ?? membership?.daily_credits_remaining ?? 0}</Text>
        <Text style={styles.subtitle}>
          {membership?.is_pro ? 'Pro 会员生效中' : '当前为基础账号'} · 今日已赚 {reward?.today_earned_credits || 0} 积分
        </Text>
        <View style={styles.inlineActions}>
          <Pressable onPress={() => navigation.navigate('MembershipCenter')}>
            <Text style={styles.link}>会员中心</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('RewardCenter')}>
            <Text style={styles.link}>去赚积分</Text>
          </Pressable>
        </View>
      </Card>

      <View style={styles.statGrid}>
        <StatCard title="识别记录" value="查看" onPress={() => navigation.navigate('AnalyzeHistory')} />
        <StatCard title="好友" value="管理" onPress={() => navigation.navigate('Friends')} />
        <StatCard title="私信" value="会话" onPress={() => navigation.navigate('Conversations')} />
      </View>
      <View style={styles.statGrid}>
        <StatCard title="邀请好友" value="有礼" onPress={() => navigation.navigate('InviteFriends')} />
        <StatCard title="互动消息" value="通知" onPress={() => navigation.navigate('Notifications')} />
        <StatCard title="成长伙伴" value="查看" onPress={() => navigation.navigate('PetHome')} />
      </View>

      <Card>
        <Text style={styles.sectionTitle}>服务</Text>
        <MenuItem title="AI 助手" subtitle="风险解读、饮食建议和关注卡片" onPress={() => navigation.navigate('AiAssistant')} />
        <MenuItem title="账号安全" subtitle="设置手机号密码，作为微信登录之外的备用方式" onPress={() => navigation.navigate('AccountSecurity')} />
        <MenuItem title="互动消息" subtitle="点赞、评论、回复和审核结果" onPress={() => navigation.navigate('Notifications')} />
        <MenuItem title="打卡排行榜" subtitle="查看本周打卡排名" onPress={() => navigation.navigate('CheckinLeaderboard')} />
        <MenuItem title="代谢分析" subtitle="BMR、TDEE 和摄入差额" onPress={() => navigation.navigate('StatsMetabolic')} />
        <MenuItem title="健康档案详情" subtitle="查看病史、偏好、体检报告和执行模式" onPress={() => navigation.navigate('HealthProfileView')} />
        <MenuItem title="健康档案与目标" subtitle="完善身体数据与首页目标" onPress={() => navigation.navigate('HealthProfile')} />
        <MenuItem title="身体趋势" subtitle="查看体重、饮水和月度摄入趋势" onPress={() => navigation.navigate('BodyTrends')} />
        <MenuItem title="包装食品" subtitle="上传营养成分表和商品包装" onPress={() => navigation.navigate('PackagedFoodEdit')} />
        <MenuItem title="收藏食谱" subtitle="常吃组合一键写入饮食记录" onPress={() => navigation.navigate('Recipes')} />
        <MenuItem title="公共食物库" subtitle="外食、校园餐、收藏和我的分享" onPress={() => navigation.navigate('PublicFood', { mode: 'all' })} />
        <MenuItem title="校园食堂" subtitle="校园餐、食堂窗口和价格" onPress={() => navigation.navigate('CampusCanteen')} />
        <MenuItem title="食物库" subtitle="营养库、自定义食物和手动记录" onPress={() => navigation.navigate('FoodLibrary')} />
        <MenuItem title="食物保质期" subtitle={expiry ? `${expiry.active_count} 样保鲜中` : '管理临期食物'} onPress={() => navigation.navigate('Expiry')} />
        <MenuItem title="体重/喝水/运动" subtitle="记录身体指标" onPress={() => navigation.navigate('BodyMetricRecord', { type: 'weight' })} />
        <MenuItem title="分享到公共库" subtitle="上传外食、校园餐或自制餐食" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'public' })} />
        <MenuItem title="定位搜索" subtitle="搜索商家、食堂或地点" onPress={() => navigation.navigate('LocationSearch')} />
        <MenuItem title="自动续费审核" subtitle="续费状态与支付渠道说明" onPress={() => navigation.navigate('AutoRenewAudit')} />
        <MenuItem title="用户协议" subtitle="服务条款摘要" onPress={() => navigation.navigate('Agreements')} />
        <MenuItem title="会员协议" subtitle="会员权益、续费和订单说明" onPress={() => navigation.navigate('MembershipAgreement')} />
        <MenuItem title="隐私政策" subtitle="数据、图片和缓存说明" onPress={() => navigation.navigate('PrivacyPolicy')} />
        <MenuItem title="隐私设置" subtitle="搜索可见性和公开记录" onPress={() => navigation.navigate('PrivacySettings')} />
        <MenuItem title="用户群" subtitle="加入交流群反馈体验" onPress={() => navigation.navigate('UserGroup')} />
        <MenuItem title="关于与反馈" subtitle="提交反馈、隐私设置、协议与用户群" onPress={() => navigation.navigate('AboutFeedback')} />
        <MenuItem title="清除缓存" subtitle="重置本机页面缓存，保留登录状态" onPress={confirmClearCache} />
      </Card>

      <Pressable onPress={confirmLogout} style={styles.logout}>
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
  inlineActions: {
    flexDirection: 'row',
    gap: 20,
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
