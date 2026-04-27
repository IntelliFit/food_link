import Taro from '@tarojs/taro'

export type AppColorScheme = 'light' | 'dark'

export const APP_COLOR_SCHEME_STORAGE_KEY = 'fl_app_color_scheme'

/** 从本地读取主题；非法值回退浅色 */
export function getStoredAppColorScheme(): AppColorScheme {
  try {
    const v = Taro.getStorageSync(APP_COLOR_SCHEME_STORAGE_KEY)
    return v === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function setStoredAppColorScheme(scheme: AppColorScheme): void {
  try {
    Taro.setStorageSync(APP_COLOR_SCHEME_STORAGE_KEY, scheme)
  } catch {
    /* ignore */
  }
}
