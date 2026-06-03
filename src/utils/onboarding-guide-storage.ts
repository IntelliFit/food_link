import Taro from '@tarojs/taro'

export const ONBOARDING_HOME_RECORD_GUIDE_KEY = 'onboarding_home_record_guide_v1'
export const ONBOARDING_ANALYZE_PREP_GUIDE_KEY = 'onboarding_analyze_prep_guide_v1'

const ALL_ONBOARDING_KEYS = [
  ONBOARDING_HOME_RECORD_GUIDE_KEY,
  ONBOARDING_ANALYZE_PREP_GUIDE_KEY,
] as const

export type OnboardingGuideStorageKey = (typeof ALL_ONBOARDING_KEYS)[number]

export function isGuideCompleted(key: OnboardingGuideStorageKey): boolean {
  try {
    return Taro.getStorageSync(key) === true
  } catch {
    return false
  }
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
