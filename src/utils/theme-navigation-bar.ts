import Taro from '@tarojs/taro'
import type { AppColorScheme } from './app-color-scheme'

/** 主包 Tab 页使用 navigationStyle: custom，无系统顶栏 */
const TAB_PAGES_WITHOUT_SYSTEM_NAV = new Set([
  '/pages/index/index',
  '/pages/stats/index',
  '/pages/community/index',
  '/pages/profile/index',
])

interface NavigationBarThemeOptions {
  lightBackground?: string
  darkBackground?: string
}

export function isTabPageWithoutSystemNavigation(route?: string): boolean {
  const normalized = (route || '').split('?')[0]
  return TAB_PAGES_WITHOUT_SYSTEM_NAV.has(normalized)
}

export function applyThemeNavigationBar(
  scheme: AppColorScheme,
  options?: NavigationBarThemeOptions
): void {
  try {
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1]
    const route = current?.route ? `/${current.route}` : ''
    if (isTabPageWithoutSystemNavigation(route)) {
      return
    }
  } catch {
    /* ignore */
  }
  const lightBackground = options?.lightBackground || '#ffffff'
  const darkBackground = options?.darkBackground || '#101716'
  const isDark = scheme === 'dark'

  try {
    Taro.setNavigationBarColor({
      frontColor: isDark ? '#ffffff' : '#000000',
      backgroundColor: isDark ? darkBackground : lightBackground,
      animation: {
        duration: 0,
        timingFunc: 'linear',
      },
    })
  } catch {
    /* ignore */
  }
}
