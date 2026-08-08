import { useEffect, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconfontText } from '../components/Iconfont'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors, radius, shadow } from '../theme'
import { requestHomeRecordMenu } from '../utils/home-record-menu'
import {
  onProfileTabBadgeChanged,
  readProfileTabBadgeCount,
  refreshProfileTabBadge,
} from '../utils/profileTabBadge'

const TAB_LABELS: Record<string, { label: string; iconClass: string }> = {
  HomeTab: { label: '首页', iconClass: 'iconfont icon-shouye' },
  StatsTab: { label: '分析', iconClass: 'iconfont icon-weibiaoti1' },
  CommunityTab: { label: '圈子', iconClass: 'iconfont icon-quanzi' },
  ProfileTab: { label: '我的', iconClass: 'iconfont icon-user' },
}

const TAB_SELECTED_COLOR = colors.tabSelected

export function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const bottomInset = Math.max(insets.bottom, 8)
  const { isDark } = useColorScheme()
  const [profileBadgeCount, setProfileBadgeCount] = useState(0)
  const leftRoutes = state.routes.slice(0, 2)
  const rightRoutes = state.routes.slice(2)

  useEffect(() => {
    let active = true
    void readProfileTabBadgeCount().then((count) => {
      if (active) setProfileBadgeCount(count)
    })
    const unsubscribe = onProfileTabBadgeChanged((count) => {
      if (active) setProfileBadgeCount(count)
    })
    void refreshProfileTabBadge()
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refreshProfileTabBadge()
    })
    return () => {
      active = false
      unsubscribe()
      appStateSubscription.remove()
    }
  }, [state.index])

  const openHomeRecordMenu = () => {
    navigation.navigate('HomeTab')
    void requestHomeRecordMenu()
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
        <View style={styles.tabIconWrap}>
          <IconfontText
            className={meta.iconClass}
            size={21}
            color={focused ? TAB_SELECTED_COLOR : isDark ? 'rgba(255,255,255,0.55)' : '#9ca3af'}
          />
          {route.name === 'ProfileTab' && profileBadgeCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{profileBadgeCount > 99 ? '99+' : profileBadgeCount}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.tabText, focused && styles.tabTextActive, isDark && styles.tabTextDark]} numberOfLines={1}>{meta.label}</Text>
      </Pressable>
    )
  }

  return (
    <>
      <View style={styles.wrap}>
        <View style={[styles.bar, { minHeight: 66 + bottomInset, paddingBottom: bottomInset, backgroundColor: isDark ? '#181f1d' : colors.surface }]}>
          <View style={styles.side}>{leftRoutes.map(renderTab)}</View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="记录一餐"
            style={({ pressed }) => [styles.centerButton, pressed && styles.pressed]}
            onPress={() => openHomeRecordMenu()}
          >
            <IconfontText className="iconfont icon-paizhao-xianxing" size={29} color="#fff" />
          </Pressable>
          <View style={styles.side}>{rightRoutes.map(renderTab)}</View>
        </View>
      </View>
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
    color: TAB_SELECTED_COLOR,
    fontWeight: '700',
  },
  tabTextDark: {
    color: 'rgba(255,255,255,0.55)',
  },
  tabIconWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -7,
    left: 13,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '800',
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
