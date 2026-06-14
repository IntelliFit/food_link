import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { HomeScreen } from '../screens/HomeScreen'
import { StatsScreen } from '../screens/StatsScreen'
import { CommunityScreen } from '../screens/CommunityScreen'
import { ProfileScreen } from '../screens/ProfileScreen'
import { LoginScreen } from '../screens/LoginScreen'
import { AnalyzeScreen } from '../screens/AnalyzeScreen'
import { AnalyzeLoadingScreen } from '../screens/AnalyzeLoadingScreen'
import { ResultScreen } from '../screens/ResultScreen'
import {
  AnalyzeHistoryScreen,
  BodyMetricRecordScreen,
  CirclePostEditScreen,
  DayRecordScreen,
  ExpiryScreen,
  FoodLibraryScreen,
  FriendsScreen,
  HealthProfileScreen,
  ManualRecordScreen,
  NativePlaceholderScreen,
  NotificationsScreen,
  RecordDetailScreen,
  RewardCenterScreen,
  TextRecordScreen,
} from '../screens/DetailScreens'
import { useAuth } from '../providers/AuthProvider'
import { colors } from '../theme'
import { CustomTabBar } from './CustomTabBar'
import type { MainTabParamList, RootStackParamList } from './types'

const Tab = createBottomTabNavigator<MainTabParamList>()
const Stack = createNativeStackNavigator<RootStackParamList>()

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

  if (isBootstrapping) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    )
  }

  return (
    <NavigationContainer theme={navigationTheme}>
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
            <Stack.Screen name="TextRecord" component={TextRecordScreen} options={{ title: '文字记录' }} />
            <Stack.Screen name="ManualRecord" component={ManualRecordScreen} options={{ title: '手动记录' }} />
            <Stack.Screen name="FoodLibrary" component={FoodLibraryScreen} options={{ title: '食物库' }} />
            <Stack.Screen name="DayRecord" component={DayRecordScreen} options={{ title: '单日记录' }} />
            <Stack.Screen name="RecordDetail" component={RecordDetailScreen} options={{ title: '记录详情' }} />
            <Stack.Screen name="AnalyzeHistory" component={AnalyzeHistoryScreen} options={{ title: '识别历史' }} />
            <Stack.Screen name="HealthProfile" component={HealthProfileScreen} options={{ title: '健康档案' }} />
            <Stack.Screen name="BodyMetricRecord" component={BodyMetricRecordScreen} options={{ title: '身体记录' }} />
            <Stack.Screen name="Expiry" component={ExpiryScreen} options={{ title: '食物保质期' }} />
            <Stack.Screen name="RewardCenter" component={RewardCenterScreen} options={{ title: '赚积分' }} />
            <Stack.Screen name="CirclePostEdit" component={CirclePostEditScreen} options={{ title: '发布动态' }} />
            <Stack.Screen name="Friends" component={FriendsScreen} options={{ title: '好友' }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: '互动消息' }} />
            <Stack.Screen name="NativePlaceholder" component={NativePlaceholderScreen} options={({ route }) => ({ title: route.params.title })} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
})
