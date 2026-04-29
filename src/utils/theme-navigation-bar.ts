import Taro from '@tarojs/taro'
import type { AppColorScheme } from './app-color-scheme'

interface NavigationBarThemeOptions {
  lightBackground?: string
  darkBackground?: string
}

export function applyThemeNavigationBar(
  scheme: AppColorScheme,
  options?: NavigationBarThemeOptions
): void {
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
