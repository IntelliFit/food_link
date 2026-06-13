import Taro from '@tarojs/taro'
import { getAccessToken } from './api'

export const ONBOARDING_HOME_RECORD_GUIDE_KEY = 'onboarding_home_record_guide_v1'
export const ONBOARDING_ANALYZE_PREP_GUIDE_KEY = 'onboarding_analyze_prep_guide_v1'
export const ONBOARDING_RECORD_DETAIL_GUIDE_KEY = 'onboarding_record_detail_guide_v1'

const ALL_ONBOARDING_KEYS = [
  ONBOARDING_HOME_RECORD_GUIDE_KEY,
  ONBOARDING_ANALYZE_PREP_GUIDE_KEY,
  ONBOARDING_RECORD_DETAIL_GUIDE_KEY,
] as const

export type OnboardingGuideStorageKey = (typeof ALL_ONBOARDING_KEYS)[number]

export function isGuideCompleted(key: OnboardingGuideStorageKey): boolean {
  try {
    return Taro.getStorageSync(key) === true
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
    Taro.setStorageSync(key, true)
  } catch {
    /* ignore */
  }
}

export function clearAllOnboardingGuides(): void {
  ALL_ONBOARDING_KEYS.forEach((key) => {
    try {
      Taro.removeStorageSync(key)
    } catch {
      /* ignore */
    }
  })
}
