import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CommonActions } from '@react-navigation/native'
import { IconfontText } from '../components/Iconfont'
import { colors, radius, shadow } from '../theme'
import { RecordActionSheet, type RecordAction } from '../components/RecordActionSheet'
import type { RootStackParamList } from './types'

const TAB_LABELS: Record<string, { label: string; iconClass: string }> = {
  HomeTab: { label: '首页', iconClass: 'iconfont icon-shouye' },
  StatsTab: { label: '分析', iconClass: 'iconfont icon-tubiao-zhuzhuangtu' },
  CommunityTab: { label: '圈子', iconClass: 'iconfont icon-quanzi' },
  ProfileTab: { label: '我的', iconClass: 'iconfont icon-user' },
}

export function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const bottomInset = Math.max(insets.bottom, 8)
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
                  : action === 'gooseDuckChicken'
                    ? 'GooseDuckChicken'
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
    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        onPress={() => navigation.navigate(route.name)}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <IconfontText
          className={meta.iconClass}
          size={21}
          color={focused ? colors.brand : '#9ca3af'}
        />
        <Text style={[styles.tabText, focused && styles.tabTextActive]} numberOfLines={1}>{meta.label}</Text>
      </Pressable>
    )
  }

  return (
    <>
      <View style={styles.wrap}>
        <View style={[styles.bar, { minHeight: 66 + bottomInset, paddingBottom: bottomInset }]}>
          <View style={styles.side}>{leftRoutes.map(renderTab)}</View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="记录一餐"
            style={({ pressed }) => [styles.centerButton, pressed && styles.pressed]}
            onPress={() => setRecordMenuVisible(true)}
          >
            <IconfontText className="iconfont icon-paizhao-xianxing" size={29} color="#fff" />
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
    minHeight: 66,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
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
    paddingVertical: 6,
  },
  pressed: {
    opacity: 0.76,
  },
  tabText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.brandDark,
    fontWeight: '700',
  },
  centerButton: {
    width: 56,
    height: 56,
    marginHorizontal: 7,
    marginTop: -28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  centerIcon: {
    width: 34,
    height: 34,
    tintColor: '#fff',
  },
})
