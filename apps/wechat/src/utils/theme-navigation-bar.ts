import Taro from '@tarojs/taro'
import type { AppColorScheme } from './app-color-scheme'
import { HOME_DISPLAY_MODE_STORAGE_KEY } from './home-display-mode'
import { getStoredBalancedTheme } from './balanced-theme'

interface NavigationBarThemeOptions {
  lightBackground?: string
  darkBackground?: string
  wellnessBackground?: string
}

function isWellnessMode(): boolean {
  try {
    return Taro.getStorageSync(HOME_DISPLAY_MODE_STORAGE_KEY) === 'wellness'
  } catch {
    return false
  }
}

export function applyThemeNavigationBar(
  scheme: AppColorScheme,
  options?: NavigationBarThemeOptions
): void {
  const lightBackground = isWellnessMode()
    ? options?.wellnessBackground || '#f7f3e8'
    : options?.lightBackground || '#ffffff'
  const darkBackground = options?.darkBackground || '#101716'
  const pages = Taro.getCurrentPages()
  const route = pages[pages.length - 1]?.route?.replace(/^\//, '')
  const isBalancedTab = !isWellnessMode() && ['pages/index/index', 'pages/stats/index', 'pages/community/index', 'pages/profile/index'].includes(route || '')
  const theme = getStoredBalancedTheme()
  const darkArtTheme = isBalancedTab && (theme === 'way-of-water' || theme === 'picturebook-companion')
  const isDark = scheme === 'dark' || darkArtTheme
  const background = darkArtTheme && scheme !== 'dark'
    ? (theme === 'picturebook-companion' ? '#10222a' : '#07111a')
    : isDark ? darkBackground : lightBackground

  try {
    Taro.setNavigationBarColor({
      frontColor: isDark ? '#ffffff' : '#000000',
      backgroundColor: background,
      animation: {
        duration: 0,
        timingFunc: 'linear',
      },
    })
  } catch {
    /* ignore */
  }

  try {
    ;(Taro as any).setBackgroundColor?.({
      backgroundColor: background,
      backgroundColorTop: background,
      backgroundColorBottom: background,
    })
  } catch {
    /* ignore */
  }

  try {
    ;(Taro as any).setBackgroundTextStyle?.({
      textStyle: isDark ? 'light' : 'dark',
    })
  } catch {
    /* ignore */
  }
}
