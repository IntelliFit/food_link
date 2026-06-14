import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CommonActions } from '@react-navigation/native'
import { colors, radius, shadow } from '../theme'
import { RecordActionSheet, type RecordAction } from '../components/RecordActionSheet'
import type { RootStackParamList } from './types'

const TAB_LABELS: Record<string, { label: string; icon: string }> = {
  HomeTab: { label: '首页', icon: 'H' },
  StatsTab: { label: '分析', icon: 'A' },
  CommunityTab: { label: '圈子', icon: 'C' },
  ProfileTab: { label: '我的', icon: 'M' },
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
            : 'FoodLibrary'
    rootNavigation?.dispatch(
      CommonActions.navigate({
        name: target,
        params: action === 'camera' || action === 'library' ? { source: action } : undefined,
      }),
    )
  }

  const renderTab = (route: BottomTabBarProps['state']['routes'][number]) => {
    const index = state.routes.findIndex((item) => item.key === route.key)
    const focused = state.index === index
    const meta = TAB_LABELS[route.name] || { label: route.name, icon: '?' }
    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        onPress={() => navigation.navigate(route.name)}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <View style={[styles.tabIconCircle, focused && styles.tabIconCircleActive]}>
          <Text style={[styles.tabIcon, focused && styles.tabIconActive]}>{meta.icon}</Text>
        </View>
        <Text style={[styles.tabText, focused && styles.tabTextActive]}>{meta.label}</Text>
      </Pressable>
    )
  }

  return (
    <>
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.bar}>
          <View style={styles.side}>{leftRoutes.map(renderTab)}</View>
          <Pressable style={({ pressed }) => [styles.centerButton, pressed && styles.pressed]} onPress={() => setRecordMenuVisible(true)}>
            <Text style={styles.centerIcon}>+</Text>
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
    paddingHorizontal: 18,
    backgroundColor: 'transparent',
  },
  bar: {
    minHeight: 74,
    borderRadius: 30,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
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
  tabIconCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  tabIconCircleActive: {
    backgroundColor: colors.brandSoft,
  },
  tabIcon: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textMuted,
  },
  tabIconActive: {
    color: colors.brandDark,
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
    marginTop: -32,
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
    color: '#fff',
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '600',
  },
})
