import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CommonActions } from '@react-navigation/native'
import { BarChart3, Camera, Home, UserRound, UsersRound, type LucideIcon } from 'lucide-react-native'
import { colors, radius, shadow } from '../theme'
import { RecordActionSheet, type RecordAction } from '../components/RecordActionSheet'
import type { RootStackParamList } from './types'

const TAB_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  HomeTab: { label: '首页', icon: Home },
  StatsTab: { label: '分析', icon: BarChart3 },
  CommunityTab: { label: '圈子', icon: UsersRound },
  ProfileTab: { label: '我的', icon: UserRound },
}

export function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const [recordMenuVisible, setRecordMenuVisible] = useState(false)
  const leftRoutes = state.routes.slice(0, 2)
  const rightRoutes = state.routes.slice(2)

  const navigateRecordAction = (action: RecordAction) => {
    setRecordMenuVisible(false)
    const rootNavigation = navigation.getParent()
    const target: keyof RootStackParamList =
      action === 'camera' || action === 'library'
        ? 'Analyze'
        : action === 'text'
          ? 'TextRecord'
          : action === 'manual'
            ? 'ManualRecord'
            : action === 'packagedFood'
              ? 'PackagedFoodEdit'
              : action === 'history'
                ? 'AnalyzeHistory'
              : action === 'recipes'
                ? 'Recipes'
                : 'FoodLibrary'
    rootNavigation?.dispatch(CommonActions.navigate(
      target,
      action === 'camera' || action === 'library' ? { source: action } : undefined,
    ))
  }

  const renderTab = (route: BottomTabBarProps['state']['routes'][number]) => {
    const index = state.routes.findIndex((item) => item.key === route.key)
    const focused = state.index === index
    const meta = TAB_LABELS[route.name]
    if (!meta) return null
    const Icon = meta.icon
    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        onPress={() => navigation.navigate(route.name)}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <Icon size={25} color={focused ? colors.brand : '#9ca3af'} strokeWidth={focused ? 2.6 : 2.2} />
        <Text style={[styles.tabText, focused && styles.tabTextActive]}>{meta.label}</Text>
      </Pressable>
    )
  }

  return (
    <>
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.bar}>
          <View style={styles.side}>{leftRoutes.map(renderTab)}</View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="记录一餐"
            style={({ pressed }) => [styles.centerButton, pressed && styles.pressed]}
            onPress={() => setRecordMenuVisible(true)}
          >
            <Camera size={36} color="#fff" strokeWidth={2.4} />
          </Pressable>
          <View style={styles.side}>{rightRoutes.map(renderTab)}</View>
        </View>
      </View>
      <RecordActionSheet
        visible={recordMenuVisible}
        onClose={() => setRecordMenuVisible(false)}
        onSelect={navigateRecordAction}
      />
    </>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  bar: {
    minHeight: 78,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    ...shadow,
  },
  side: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.76,
  },
  tabText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.brandDark,
    fontWeight: '700',
  },
  centerButton: {
    width: 68,
    height: 68,
    marginHorizontal: 8,
    marginTop: -34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  centerIcon: {
    width: 34,
    height: 34,
    tintColor: '#fff',
  },
})
