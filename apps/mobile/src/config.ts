import Constants from 'expo-constants'
import rootPackage from '../../../package.json'

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string; shareBaseUrl?: string; wechatAppId?: string } | undefined

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  extra?.apiBaseUrl ||
  'http://127.0.0.1:3010'

export const SHARE_BASE_URL =
  process.env.EXPO_PUBLIC_SHARE_BASE_URL ||
  extra?.shareBaseUrl ||
  'https://healthymax.cn'

export const SHOW_DEBUG_LOGIN =
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEBUG_LOGIN === 'true'

export const APP_VERSION = rootPackage.version || Constants.expoConfig?.version || '0.0.0'

export const WECHAT_APP_ID =
  process.env.EXPO_PUBLIC_WECHAT_APP_ID ||
  extra?.wechatAppId ||
  'wx62da2262ae3ff06c'
