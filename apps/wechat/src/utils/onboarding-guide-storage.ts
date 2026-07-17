import Taro from '@tarojs/taro'
import { getAccessToken } from './api'

export const ONBOARDING_HOME_RECORD_GUIDE_KEY = 'onboarding_home_record_guide_v1'
const ONBOARDING_HOME_RECORD_GUIDE_PENDING_USER_KEY = 'onboarding_home_record_guide_pending_user_id'
export const ONBOARDING_ANALYZE_PREP_GUIDE_KEY = 'onboarding_analyze_prep_guide_v1'
export const ONBOARDING_RECORD_DETAIL_GUIDE_KEY = 'onboarding_record_detail_guide_v1'

const ALL_ONBOARDING_KEYS = [
  ONBOARDING_HOME_RECORD_GUIDE_KEY,
  ONBOARDING_ANALYZE_PREP_GUIDE_KEY,
  ONBOARDING_RECORD_DETAIL_GUIDE_KEY,
] as const

export type OnboardingGuideStorageKey = (typeof ALL_ONBOARDING_KEYS)[number]

/**
 * 引导是否完成是账号状态，而不是设备状态：同一台设备上的新注册账号仍应获得首次引导，
 * 同一账号之后从健康档案等入口返回首页则不应重复展示。
 */
function getUserScopedGuideKey(key: OnboardingGuideStorageKey): string | null {
  try {
    const userID = String(Taro.getStorageSync('user_id') || '').trim()
    return userID ? `${key}:user:${encodeURIComponent(userID)}` : null
  } catch {
    return null
  }
}

export function isGuideCompleted(key: OnboardingGuideStorageKey): boolean {
  try {
    const scopedKey = getUserScopedGuideKey(key)
    return scopedKey ? Taro.getStorageSync(scopedKey) === true : false
  } catch {
    return false
  }
}

/** 已登录且未完成对应引导时，才在首页/拍照分析页展示 OnboardingGuide */
export function shouldOfferOnboardingGuide(key: OnboardingGuideStorageKey): boolean {
  if (!getAccessToken()) {
    return false
  }
  return !isGuideCompleted(key)
}

export function markGuideCompleted(key: OnboardingGuideStorageKey): void {
  try {
    const scopedKey = getUserScopedGuideKey(key)
    if (scopedKey) {
      Taro.setStorageSync(scopedKey, true)
    }
  } catch {
    /* ignore */
  }
}

/**
 * 注册完成后标记：用户下一次真正落到首页时，稳定地展示一次首页记录引导。
 * 标记绑定当前用户，避免在同一设备切换账号时串到其他账号。
 */
export function requestHomeRecordGuideAfterOnboarding(): void {
  try {
    const userID = String(Taro.getStorageSync('user_id') || '').trim()
    if (userID) {
      Taro.setStorageSync(ONBOARDING_HOME_RECORD_GUIDE_PENDING_USER_KEY, userID)
    }
  } catch {
    /* ignore */
  }
}

/** 仅当前用户消费注册后的首页引导请求。 */
export function consumeHomeRecordGuideAfterOnboarding(): boolean {
  try {
    const userID = String(Taro.getStorageSync('user_id') || '').trim()
    const pendingUserID = String(Taro.getStorageSync(ONBOARDING_HOME_RECORD_GUIDE_PENDING_USER_KEY) || '').trim()
    if (!userID || pendingUserID !== userID) return false
    Taro.removeStorageSync(ONBOARDING_HOME_RECORD_GUIDE_PENDING_USER_KEY)
    return true
  } catch {
    return false
  }
}

export function clearAllOnboardingGuides(): void {
  ALL_ONBOARDING_KEYS.forEach((key) => {
    try {
      const scopedKey = getUserScopedGuideKey(key)
      if (scopedKey) {
        Taro.removeStorageSync(scopedKey)
      }
      // 兼容清除旧版本遗留的设备级标记；新逻辑不会读取它。
      Taro.removeStorageSync(key)
    } catch {
      /* ignore */
    }
  })
}
