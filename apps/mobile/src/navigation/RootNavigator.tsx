import { useEffect, useRef } from 'react'
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native'
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { HomeScreen } from '../screens/HomeScreen'
import { StatsScreen } from '../screens/StatsScreen'
import { CommunityScreen } from '../screens/CommunityScreen'
import { CommunitySearchScreen } from '../screens/CommunitySearchScreen'
import { ProfileMoreFeaturesScreen, ProfileScreen } from '../screens/ProfileScreen'
import { ProfileSettingsScreen } from '../screens/ProfileSettingsScreen'
import { AccountSecurityScreen } from '../screens/AccountSecurityScreen'
import { HealthProfileViewScreen } from '../screens/HealthProfileViewScreen'
import { PetChatScreen } from '../screens/PetChatScreen'
import { LoginScreen } from '../screens/LoginScreen'
import { AnalyzeScreen } from '../screens/AnalyzeScreen'
import { GooseDuckChickenScreen } from '../screens/GooseDuckChickenScreen'
import { AnalyzeLoadingScreen } from '../screens/AnalyzeLoadingScreen'
import { ResultScreen } from '../screens/ResultScreen'
import { TextResultScreen } from '../screens/TextResultScreen'
import {
  AboutScreen,
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
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'
import { CustomTabBar } from './CustomTabBar'
import type { MainTabParamList, RootStackParamList } from './types'

const Tab = createBottomTabNavigator<MainTabParamList>()
const Stack = createNativeStackNavigator<RootStackParamList>()
const navigationRef = createNavigationContainerRef<RootStackParamList>()

type StaticDeepLinkRoute = 'About' | 'Expiry'

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
  const { isDark } = useColorScheme()
  const { isBootstrapping, isAuthenticated } = useAuth()
  const navigationTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: isDark ? '#0d1312' : colors.background,
      primary: colors.brand,
      card: isDark ? '#181f1d' : '#ffffff',
      text: isDark ? '#f2f7f4' : colors.text,
      border: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
    },
  }
  const pendingInviteCodeRef = useRef<string | null>(null)
  const pendingPrivateChatRef = useRef<{ userId: string; nickname?: string } | null>(null)
  const pendingProfileUserIdRef = useRef<string | null>(null)
  const pendingStaticRouteRef = useRef<StaticDeepLinkRoute | null>(null)
  const pendingRecordIdRef = useRef<string | null>(null)

  useEffect(() => {
    const navigateToInvite = (code: string) => {
      pendingInviteCodeRef.current = code
      if (!isAuthenticated) return
      if (!navigationRef.isReady()) return
      navigationRef.navigate('InviteFriends', { fi: code })
      pendingInviteCodeRef.current = null
    }

    const navigateToPrivateChat = (params: { userId: string; nickname?: string }) => {
      pendingPrivateChatRef.current = params
      if (!isAuthenticated) return
      if (!navigationRef.isReady()) return
      navigationRef.navigate('PrivateChat', params)
      pendingPrivateChatRef.current = null
    }

    const navigateToProfile = (userId: string) => {
      pendingProfileUserIdRef.current = userId
      if (!isAuthenticated) return
      if (!navigationRef.isReady()) return
      navigationRef.navigate('ProfileSettings', { userId })
      pendingProfileUserIdRef.current = null
    }

    const navigateToRecordDetail = (recordId: string) => {
      pendingRecordIdRef.current = recordId
      if (!isAuthenticated) return
      if (!navigationRef.isReady()) return
      navigationRef.navigate('RecordDetail', { recordId })
      pendingRecordIdRef.current = null
    }

    const navigateToStaticRoute = (routeName: StaticDeepLinkRoute) => {
      pendingStaticRouteRef.current = routeName
      if (routeName === 'Expiry' && !isAuthenticated) return
      if (!navigationRef.isReady()) return
      if (routeName === 'About') {
        navigationRef.navigate('About')
      } else {
        navigationRef.navigate('Expiry')
      }
      pendingStaticRouteRef.current = null
    }

    const flushPendingRoutes = () => {
      const staticRoute = pendingStaticRouteRef.current
      if (staticRoute && navigationRef.isReady() && (staticRoute === 'About' || isAuthenticated)) {
        navigateToStaticRoute(staticRoute)
      }
      const code = pendingInviteCodeRef.current
      if (code && isAuthenticated) navigateToInvite(code)
      const privateChat = pendingPrivateChatRef.current
      if (privateChat && isAuthenticated) navigateToPrivateChat(privateChat)
      const profileUserId = pendingProfileUserIdRef.current
      if (profileUserId && isAuthenticated) navigateToProfile(profileUserId)
      const recordId = pendingRecordIdRef.current
      if (recordId && isAuthenticated) navigateToRecordDetail(recordId)
    }

    const handleIncomingUrl = (url?: string | null) => {
      const staticRoute = extractStaticDeepLinkRoute(url)
      if (staticRoute) navigateToStaticRoute(staticRoute)
      const code = extractInviteCodeFromUrl(url)
      if (code) navigateToInvite(code)
      const privateChat = extractPrivateChatFromUrl(url)
      if (privateChat) navigateToPrivateChat(privateChat)
      const profileUserId = extractProfileUserIdFromUrl(url)
      if (profileUserId) navigateToProfile(profileUserId)
      const recordId = extractFoodRecordIdFromUrl(url)
      if (recordId) navigateToRecordDetail(recordId)
    }

    flushPendingRoutes()
    Linking.getInitialURL().then(handleIncomingUrl).catch(() => undefined)
    const subscription = Linking.addEventListener('url', ({ url }) => handleIncomingUrl(url))
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
        if (code && isAuthenticated && navigationRef.isReady()) {
          navigationRef.navigate('InviteFriends', { fi: code })
          pendingInviteCodeRef.current = null
        }
        const privateChat = pendingPrivateChatRef.current
        if (privateChat && isAuthenticated && navigationRef.isReady()) {
          navigationRef.navigate('PrivateChat', privateChat)
          pendingPrivateChatRef.current = null
        }
        const profileUserId = pendingProfileUserIdRef.current
        if (profileUserId && isAuthenticated && navigationRef.isReady()) {
          navigationRef.navigate('ProfileSettings', { userId: profileUserId })
          pendingProfileUserIdRef.current = null
        }
        const recordId = pendingRecordIdRef.current
        if (recordId && isAuthenticated && navigationRef.isReady()) {
          navigationRef.navigate('RecordDetail', { recordId })
          pendingRecordIdRef.current = null
        }
        const staticRoute = pendingStaticRouteRef.current
        if (staticRoute && navigationRef.isReady() && (staticRoute === 'About' || isAuthenticated)) {
          if (staticRoute === 'About') {
            navigationRef.navigate('About')
          } else {
            navigationRef.navigate('Expiry')
          }
          pendingStaticRouteRef.current = null
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
            <Stack.Screen name="PetChat" component={PetChatScreen} options={{ title: '问问宠物' }} />
            <Stack.Screen name="Analyze" component={AnalyzeScreen} options={{ title: '图片分析' }} />
            <Stack.Screen name="GooseDuckChicken" component={GooseDuckChickenScreen} options={{ title: '鹅鸭鸡识别' }} />
            <Stack.Screen name="AnalyzeLoading" component={AnalyzeLoadingScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Result" component={ResultScreen} options={{ title: '识别结果' }} />
            <Stack.Screen name="TextResult" component={TextResultScreen} options={{ title: '文字记录分析' }} />
            <Stack.Screen name="TextRecord" component={TextRecordScreen} options={{ title: '文字记录' }} />
            <Stack.Screen name="ManualRecord" component={ManualRecordScreen} options={{ title: '手动记录' }} />
            <Stack.Screen name="FoodLibrary" component={FoodLibraryScreen} options={{ title: '食物库' }} />
            <Stack.Screen name="FoodLibraryDetail" component={FoodLibraryDetailScreen} options={{ title: '食物详情' }} />
            <Stack.Screen name="DayRecord" component={DayRecordScreen} options={{ title: '单日记录' }} />
            <Stack.Screen name="RecordDetail" component={RecordDetailScreen} options={{ title: '记录详情' }} />
            <Stack.Screen name="AnalyzeHistory" component={AnalyzeHistoryScreen} options={{ title: '识别历史' }} />
            <Stack.Screen name="AiAssistant" component={AiAssistantScreen} options={{ title: 'AI 助手' }} />
            <Stack.Screen name="StatsMetabolic" component={StatsMetabolicScreen} options={{ headerShown: false }} />
            <Stack.Screen name="TrendDetail" component={TrendDetailScreen} options={({ route }) => ({ title: route.params.kind === 'weight' ? '体重趋势' : route.params.kind === 'water' ? '饮水趋势' : '运动趋势' })} />
            <Stack.Screen name="HealthProfile" component={HealthProfileScreen} options={{ title: '健康档案' }} />
            <Stack.Screen name="HealthProfileView" component={HealthProfileViewScreen} options={{ title: '健康档案详情' }} />
            <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} options={{ title: '个人主页' }} />
            <Stack.Screen name="ProfileMoreFeatures" component={ProfileMoreFeaturesScreen} options={{ title: '更多功能' }} />
            <Stack.Screen name="AccountSecurity" component={AccountSecurityScreen} options={{ title: '账号安全' }} />
            <Stack.Screen
              name="BodyMetricRecord"
              component={BodyMetricRecordScreen}
              options={({ route }) => ({
                title: route.params?.type === 'water' ? '记录喝水' : route.params?.type === 'exercise' ? '记录运动' : '记录体重',
              })}
            />
            <Stack.Screen name="Expiry" component={ExpiryScreen} options={{ title: '食物保质期' }} />
            <Stack.Screen name="ExpiryEdit" component={ExpiryEditScreen} options={{ title: '编辑保质期' }} />
            <Stack.Screen name="RewardCenter" component={RewardCenterScreen} options={{ title: '赚积分' }} />
            <Stack.Screen
              name="MembershipCenter"
              component={MembershipCenterScreen}
              options={{
                title: '食探会员',
                headerStyle: { backgroundColor: '#f0fdf4' },
                headerTintColor: '#0f172a',
                headerTitleStyle: { color: '#0f172a', fontWeight: '700' },
              }}
            />
            <Stack.Screen name="Recipes" component={RecipesScreen} options={{ title: '收藏食谱' }} />
            <Stack.Screen
              name="RecipeEdit"
              component={RecipeEditScreen}
              options={({ route }) => ({
                title: route.params?.recipeId ? '编辑食谱' : '新建食谱',
                headerStyle: { backgroundColor: '#00bc7d' },
                headerTintColor: '#fff',
                headerTitleStyle: { color: '#fff', fontWeight: '700' },
              })}
            />
            <Stack.Screen name="PublicFood" component={PublicFoodScreen} options={{ title: '公共食物库' }} />
            <Stack.Screen name="PublicFoodDetail" component={PublicFoodDetailScreen} options={{ title: '食物详情' }} />
            <Stack.Screen name="PublicFoodShare" component={PublicFoodShareScreen} options={{ title: '分享食物' }} />
            <Stack.Screen name="CommunityFeedDetail" component={CommunityFeedDetailScreen} options={{ title: '动态详情' }} />
            <Stack.Screen name="CommunitySearch" component={CommunitySearchScreen} options={{ title: '圈子搜索' }} />
            <Stack.Screen name="PublicProfile" component={PublicProfileScreen} options={{ headerShown: false }} />
            <Stack.Screen name="FollowList" component={FollowListScreen} options={{ title: '关注列表' }} />
            <Stack.Screen name="Conversations" component={ConversationsScreen} options={{ title: '私信' }} />
            <Stack.Screen name="PrivateChat" component={PrivateChatScreen} options={({ route }) => ({ title: route.params.nickname || '私信' })} />
            <Stack.Screen name="BodyTrends" component={BodyTrendsScreen} options={{ headerShown: false }} />
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
            <Stack.Screen name="PetLab" component={PetLabScreen} options={{ title: '宠物试验箱' }} />
            <Stack.Screen name="Agreements" component={AgreementsScreen} options={{ title: '用户协议' }} />
            <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: '隐私政策' }} />
            <Stack.Screen
              name="AutoRenewAudit"
              component={AutoRenewAuditScreen}
              options={{
                title: '自动续费',
                headerStyle: { backgroundColor: '#f0fdf4' },
                headerTintColor: '#0f172a',
                headerTitleStyle: { color: '#0f172a', fontWeight: '700' },
              }}
            />
            <Stack.Screen name="CirclePostEdit" component={CirclePostEditScreen} options={{ title: '发布动态' }} />
            <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: '好友' }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: '互动消息' }} />
            <Stack.Screen name="About" component={AboutScreen} options={{ title: '关于' }} />
            <Stack.Screen name="AboutFeedback" component={AboutFeedbackScreen} options={{ title: '意见反馈' }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Agreements" component={AgreementsScreen} options={{ title: '用户协议' }} />
            <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: '隐私政策' }} />
            <Stack.Screen name="About" component={AboutScreen} options={{ title: '关于' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

function extractStaticDeepLinkRoute(url?: string | null): StaticDeepLinkRoute | null {
  if (!url) return null
  const normalized = url.toLowerCase()
  if (normalized.includes('about')) return 'About'
  if (
    normalized.includes('food-expiry') ||
    normalized.includes('/expiry') ||
    normalized.includes('://expiry') ||
    normalized.includes('pages/expiry')
  ) {
    return 'Expiry'
  }
  return null
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

function extractFoodRecordIdFromUrl(url?: string | null): string {
  if (!url) return ''
  const normalized = url.toLowerCase()
  if (!normalized.includes('food-record') && !normalized.includes('record-detail')) return ''
  const queryIndex = url.indexOf('?')
  if (queryIndex >= 0) {
    const params = parseUrlQuery(url.slice(queryIndex + 1))
    const queryRecordId = (params.record_id || params.recordId || params.rid || '').trim()
    if (queryRecordId) return queryRecordId
  }
  const path = url.split(/[?#]/)[0] || ''
  const match = path.match(/(?:food-record|record-detail)\/([^/?#]+)/i)
  if (!match?.[1]) return ''
  try {
    return decodeURIComponent(match[1]).trim()
  } catch {
    return match[1].trim()
  }
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
