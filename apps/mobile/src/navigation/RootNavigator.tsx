import { useEffect, useRef } from 'react'
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native'
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { HomeScreen } from '../screens/HomeScreen'
import { StatsScreen } from '../screens/StatsScreen'
import { CommunityScreen } from '../screens/CommunityScreen'
import { ProfileScreen } from '../screens/ProfileScreen'
import { ProfileSettingsScreen } from '../screens/ProfileSettingsScreen'
import { AccountSecurityScreen } from '../screens/AccountSecurityScreen'
import { HealthProfileViewScreen } from '../screens/HealthProfileViewScreen'
import { LoginScreen } from '../screens/LoginScreen'
import { AnalyzeScreen } from '../screens/AnalyzeScreen'
import { AnalyzeLoadingScreen } from '../screens/AnalyzeLoadingScreen'
import { ResultScreen } from '../screens/ResultScreen'
import { TextResultScreen } from '../screens/TextResultScreen'
import {
  AboutFeedbackScreen,
  AnalyzeHistoryScreen,
  BodyMetricRecordScreen,
  CirclePostEditScreen,
  DayRecordScreen,
  ExpiryScreen,
  FoodLibraryScreen,
  FriendsScreen,
  HealthProfileScreen,
  ManualRecordScreen,
  NotificationsScreen,
  RecordDetailScreen,
  RewardCenterScreen,
  TextRecordScreen,
} from '../screens/DetailScreens'
import {
  BodyTrendsScreen,
  CommunityFeedDetailScreen,
  ConversationsScreen,
  MembershipCenterScreen,
  PrivateChatScreen,
  PublicFoodDetailScreen,
  PublicFoodScreen,
  PublicProfileScreen,
  RecipesScreen,
} from '../screens/MigrationScreens'
import {
  AgreementsScreen,
  AutoRenewAuditScreen,
  CheckinLeaderboardScreen,
  FollowListScreen,
  InviteFriendsScreen,
  PetHomeScreen,
  PetLabScreen,
  PrivacyPolicyScreen,
  PublicFoodShareScreen,
  RecipeEditScreen,
} from '../screens/SecondaryMigrationScreens'
import {
  AiAssistantScreen,
  CampusCanteenScreen,
  ExpiryEditScreen,
  FoodLibraryDetailScreen,
  LocationSearchScreen,
  MembershipAgreementScreen,
  PackagedFoodEditScreen,
  PackagedFoodTaskDetailScreen,
  PrivacySettingsScreen,
  StatsMetabolicScreen,
  TrendDetailScreen,
  UserGroupScreen,
} from '../screens/TertiaryMigrationScreens'
import { useAuth } from '../providers/AuthProvider'
import { colors } from '../theme'
import { CustomTabBar } from './CustomTabBar'
import type { MainTabParamList, RootStackParamList } from './types'

const Tab = createBottomTabNavigator<MainTabParamList>()
const Stack = createNativeStackNavigator<RootStackParamList>()
const navigationRef = createNavigationContainerRef<RootStackParamList>()

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    primary: colors.brand,
  },
}

function MainTabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} />
      <Tab.Screen name="StatsTab" component={StatsScreen} />
      <Tab.Screen name="CommunityTab" component={CommunityScreen} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} />
    </Tab.Navigator>
  )
}

export function RootNavigator() {
  const { isBootstrapping, isAuthenticated } = useAuth()
  const pendingInviteCodeRef = useRef<string | null>(null)
  const pendingPrivateChatRef = useRef<{ userId: string; nickname?: string } | null>(null)
  const pendingProfileUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return undefined

    const navigateToInvite = (code: string) => {
      pendingInviteCodeRef.current = code
      if (!navigationRef.isReady()) return
      navigationRef.navigate('InviteFriends', { fi: code })
      pendingInviteCodeRef.current = null
    }

    const navigateToPrivateChat = (params: { userId: string; nickname?: string }) => {
      pendingPrivateChatRef.current = params
      if (!navigationRef.isReady()) return
      navigationRef.navigate('PrivateChat', params)
      pendingPrivateChatRef.current = null
    }

    const navigateToProfile = (userId: string) => {
      pendingProfileUserIdRef.current = userId
      if (!navigationRef.isReady()) return
      navigationRef.navigate('ProfileSettings', { userId })
      pendingProfileUserIdRef.current = null
    }

    const handleInviteUrl = (url?: string | null) => {
      const code = extractInviteCodeFromUrl(url)
      if (code) navigateToInvite(code)
      const privateChat = extractPrivateChatFromUrl(url)
      if (privateChat) navigateToPrivateChat(privateChat)
      const profileUserId = extractProfileUserIdFromUrl(url)
      if (profileUserId) navigateToProfile(profileUserId)
    }

    Linking.getInitialURL().then(handleInviteUrl).catch(() => undefined)
    const subscription = Linking.addEventListener('url', ({ url }) => handleInviteUrl(url))
    return () => subscription.remove()
  }, [isAuthenticated])

  if (isBootstrapping) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    )
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={() => {
        const code = pendingInviteCodeRef.current
        if (code && navigationRef.isReady()) {
          navigationRef.navigate('InviteFriends', { fi: code })
          pendingInviteCodeRef.current = null
        }
        const privateChat = pendingPrivateChatRef.current
        if (privateChat && navigationRef.isReady()) {
          navigationRef.navigate('PrivateChat', privateChat)
          pendingPrivateChatRef.current = null
        }
        const profileUserId = pendingProfileUserIdRef.current
        if (profileUserId && navigationRef.isReady()) {
          navigationRef.navigate('ProfileSettings', { userId: profileUserId })
          pendingProfileUserIdRef.current = null
        }
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerTintColor: colors.brandDark,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="Analyze" component={AnalyzeScreen} options={{ title: '记录' }} />
            <Stack.Screen name="AnalyzeLoading" component={AnalyzeLoadingScreen} options={{ title: '正在分析' }} />
            <Stack.Screen name="Result" component={ResultScreen} options={{ title: '识别结果' }} />
            <Stack.Screen name="TextResult" component={TextResultScreen} options={{ title: '文字识别结果' }} />
            <Stack.Screen name="TextRecord" component={TextRecordScreen} options={{ title: '文字记录' }} />
            <Stack.Screen name="ManualRecord" component={ManualRecordScreen} options={{ title: '手动记录' }} />
            <Stack.Screen name="FoodLibrary" component={FoodLibraryScreen} options={{ title: '食物库' }} />
            <Stack.Screen name="FoodLibraryDetail" component={FoodLibraryDetailScreen} options={{ title: '食物详情' }} />
            <Stack.Screen name="DayRecord" component={DayRecordScreen} options={{ title: '单日记录' }} />
            <Stack.Screen name="RecordDetail" component={RecordDetailScreen} options={{ title: '记录详情' }} />
            <Stack.Screen name="AnalyzeHistory" component={AnalyzeHistoryScreen} options={{ title: '识别历史' }} />
            <Stack.Screen name="AiAssistant" component={AiAssistantScreen} options={{ title: 'AI 助手' }} />
            <Stack.Screen name="StatsMetabolic" component={StatsMetabolicScreen} options={{ title: '代谢分析' }} />
            <Stack.Screen name="TrendDetail" component={TrendDetailScreen} options={({ route }) => ({ title: route.params.kind === 'weight' ? '体重趋势' : route.params.kind === 'water' ? '饮水趋势' : '运动趋势' })} />
            <Stack.Screen name="HealthProfile" component={HealthProfileScreen} options={{ title: '健康档案' }} />
            <Stack.Screen name="HealthProfileView" component={HealthProfileViewScreen} options={{ title: '健康档案详情' }} />
            <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} options={{ title: '个人主页' }} />
            <Stack.Screen name="AccountSecurity" component={AccountSecurityScreen} options={{ title: '账号安全' }} />
            <Stack.Screen name="BodyMetricRecord" component={BodyMetricRecordScreen} options={{ title: '身体记录' }} />
            <Stack.Screen name="Expiry" component={ExpiryScreen} options={{ title: '食物保质期' }} />
            <Stack.Screen name="ExpiryEdit" component={ExpiryEditScreen} options={{ title: '编辑保质期' }} />
            <Stack.Screen name="RewardCenter" component={RewardCenterScreen} options={{ title: '赚积分' }} />
            <Stack.Screen name="MembershipCenter" component={MembershipCenterScreen} options={{ title: '会员中心' }} />
            <Stack.Screen name="Recipes" component={RecipesScreen} options={{ title: '收藏食谱' }} />
            <Stack.Screen name="RecipeEdit" component={RecipeEditScreen} options={{ title: '编辑食谱' }} />
            <Stack.Screen name="PublicFood" component={PublicFoodScreen} options={{ title: '公共食物库' }} />
            <Stack.Screen name="PublicFoodDetail" component={PublicFoodDetailScreen} options={{ title: '食物详情' }} />
            <Stack.Screen name="PublicFoodShare" component={PublicFoodShareScreen} options={{ title: '分享食物' }} />
            <Stack.Screen name="CommunityFeedDetail" component={CommunityFeedDetailScreen} options={{ title: '动态详情' }} />
            <Stack.Screen name="PublicProfile" component={PublicProfileScreen} options={{ title: '用户主页' }} />
            <Stack.Screen name="FollowList" component={FollowListScreen} options={{ title: '关注列表' }} />
            <Stack.Screen name="Conversations" component={ConversationsScreen} options={{ title: '私信' }} />
            <Stack.Screen name="PrivateChat" component={PrivateChatScreen} options={({ route }) => ({ title: route.params.nickname || '私信' })} />
            <Stack.Screen name="BodyTrends" component={BodyTrendsScreen} options={{ title: '身体趋势' }} />
            <Stack.Screen name="PackagedFoodEdit" component={PackagedFoodEditScreen} options={{ title: '包装食品' }} />
            <Stack.Screen name="PackagedFoodTaskDetail" component={PackagedFoodTaskDetailScreen} options={{ title: '包装识别任务' }} />
            <Stack.Screen name="LocationSearch" component={LocationSearchScreen} options={{ title: '定位搜索' }} />
            <Stack.Screen name="CampusCanteen" component={CampusCanteenScreen} options={{ title: '校园食堂' }} />
            <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} options={{ title: '隐私设置' }} />
            <Stack.Screen name="MembershipAgreement" component={MembershipAgreementScreen} options={{ title: '会员协议' }} />
            <Stack.Screen name="UserGroup" component={UserGroupScreen} options={{ title: '用户群' }} />
            <Stack.Screen name="CheckinLeaderboard" component={CheckinLeaderboardScreen} options={{ title: '打卡排行榜' }} />
            <Stack.Screen name="InviteFriends" component={InviteFriendsScreen} options={{ title: '邀请好友' }} />
            <Stack.Screen name="PetHome" component={PetHomeScreen} options={{ title: '成长伙伴' }} />
            <Stack.Screen name="PetLab" component={PetLabScreen} options={{ title: '外观实验室' }} />
            <Stack.Screen name="Agreements" component={AgreementsScreen} options={{ title: '用户协议' }} />
            <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: '隐私政策' }} />
            <Stack.Screen name="AutoRenewAudit" component={AutoRenewAuditScreen} options={{ title: '自动续费审核' }} />
            <Stack.Screen name="CirclePostEdit" component={CirclePostEditScreen} options={{ title: '发布动态' }} />
            <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: '好友' }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: '互动消息' }} />
            <Stack.Screen name="AboutFeedback" component={AboutFeedbackScreen} options={{ title: '关于与反馈' }} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

function extractInviteCodeFromUrl(url?: string | null): string {
  if (!url) return ''
  const normalized = url.toLowerCase()
  if (!normalized.includes('://invite') && !normalized.includes('/invite')) return ''
  const queryIndex = url.indexOf('?')
  if (queryIndex < 0) return ''
  const query = url.slice(queryIndex + 1)
  for (const param of query.split(/[&#]/)) {
    const [rawKey, rawValue = ''] = param.split('=')
    const key = decodeURIComponent(rawKey || '').trim()
    if (!['fi', 'invite_code', 'inviteCode'].includes(key)) continue
    try {
      return decodeURIComponent(rawValue.replace(/\+/g, ' ')).trim()
    } catch {
      return rawValue.trim()
    }
  }
  return ''
}

function extractPrivateChatFromUrl(url?: string | null): { userId: string; nickname?: string } | null {
  if (!url) return null
  const normalized = url.toLowerCase()
  if (!normalized.includes('private-chat') && !normalized.includes('private_chat')) return null
  const queryIndex = url.indexOf('?')
  if (queryIndex < 0) return null
  const params = parseUrlQuery(url.slice(queryIndex + 1))
  const userId = (params.user_id || params.userId || params.uid || '').trim()
  if (!userId) return null
  const nickname = (params.nickname || params.name || '').trim()
  return { userId, ...(nickname ? { nickname } : {}) }
}

function extractProfileUserIdFromUrl(url?: string | null): string {
  if (!url) return ''
  const normalized = url.toLowerCase()
  if (!normalized.includes('profile')) return ''
  const queryIndex = url.indexOf('?')
  if (queryIndex < 0) return ''
  const params = parseUrlQuery(url.slice(queryIndex + 1))
  return (params.pf || params.user_id || params.userId || params.uid || '').trim()
}

function parseUrlQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const param of query.split(/[&#]/)) {
    const [rawKey, rawValue = ''] = param.split('=')
    if (!rawKey) continue
    try {
      out[decodeURIComponent(rawKey).trim()] = decodeURIComponent(rawValue.replace(/\+/g, ' ')).trim()
    } catch {
      out[rawKey.trim()] = rawValue.trim()
    }
  }
  return out
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
})
