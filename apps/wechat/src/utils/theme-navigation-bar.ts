import Taro from '@tarojs/taro'
import type { AppColorScheme } from './app-color-scheme'

interface NavigationBarThemeOptions {
  lightBackground?: string
  darkBackground?: string
  wellnessBackground?: string
}

const HOME_DISPLAY_MODE_KEY = 'home_display_mode_v1'

function isWellnessMode(): boolean {
  try {
    return Taro.getStorageSync(HOME_DISPLAY_MODE_KEY) === 'wellness'
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

  try {
    ;(Taro as any).setBackgroundColor?.({
      backgroundColor: isDark ? darkBackground : lightBackground,
      backgroundColorTop: isDark ? darkBackground : lightBackground,
      backgroundColorBottom: isDark ? darkBackground : lightBackground,
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
