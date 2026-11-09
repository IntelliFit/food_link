import Taro from '@tarojs/taro'
import {
  getUserProfile,
  login,
  publicRequest,
  updateUserInfo,
  type AnalyzeResponse,
  type FoodItem,
  type LoginResponse,
} from './api'
import { experiments } from './experiments'
import { loginWithFreshWechatCodeRetry } from './wechat-login-retry'
import { resolveRegistrationNickname } from './default-user-profile'
import { getInitialRegistrationAvatar } from './new-user-profile-form'
import { cleanupGeneratedUserFiles } from './weapp-user-files'

export type TrustBadgeIcon = 'shield' | 'school' | 'data' | 'star'

export interface OnboardingTrustConfig {
  badges: Array<{ icon: TrustBadgeIcon; text: string }>
  source_lines: string[]
  result_line: string
}

export interface OnboardingStats {
  standard_foods: number
  authoritative_foods: number
  campus_dishes: number
  campus_schools: number
  packaged_foods: number
  users: number
  food_records: number
  as_of: string
}

export type OnboardingFoodItem = FoodItem & { nutrition_source_label?: string }
export type OnboardingTryResult = Omit<AnalyzeResponse, 'items'> & { items: OnboardingFoodItem[] }

const EMPTY_CONFIG: OnboardingTrustConfig = { badges: [], source_lines: [], result_line: '' }

/** 读不到就不显示徽章，不影响流程 */
export async function getOnboardingTrustConfig(): Promise<OnboardingTrustConfig> {
  try {
    const res = await publicRequest('/api/onboarding/config', { method: 'GET', timeout: 5000 })
    const data = (res.data || {}) as Partial<OnboardingTrustConfig>
    return {
      badges: Array.isArray(data.badges) ? data.badges.filter((b) => b && String(b.text || '').trim()) : [],
      source_lines: Array.isArray(data.source_lines) ? data.source_lines.filter((l) => String(l || '').trim()) : [],
      result_line: String(data.result_line || '').trim(),
    }
  } catch {
    return EMPTY_CONFIG
  }
}

/** 读不到就不显示数据条 */
export async function getOnboardingStats(): Promise<OnboardingStats | null> {
  try {
    const res = await publicRequest('/api/onboarding/stats', { method: 'GET', timeout: 5000 })
    return (res.data || null) as OnboardingStats | null
  } catch {
    return null
  }
}

/** 游客体验识别；note + previous 时按纠错重算 */
export async function tryAnalyzeMeal(input: {
  base64Image: string
  note?: string
  previous?: OnboardingTryResult | null
}): Promise<OnboardingTryResult> {
  const res = await publicRequest('/api/onboarding/try', {
    method: 'POST',
    timeout: 90000,
    data: {
      anon_id: experiments.anonId(),
      base64Image: input.base64Image,
      note: input.note || '',
      // 服务端只取每项的名称、重量和四项营养，这里也只发这些
      previous_result: input.note && input.previous
        ? {
          items: input.previous.items.slice(0, 15).map((it) => ({
            name: it.name,
            estimatedWeightGrams: it.estimatedWeightGrams,
            nutrients: {
              calories: it.nutrients?.calories,
              protein: it.nutrients?.protein,
              carbs: it.nutrients?.carbs,
              fat: it.nutrients?.fat,
            },
          })),
        }
        : undefined,
    },
  })
  const data = res.data as OnboardingTryResult
  return { ...data, items: Array.isArray(data?.items) ? data.items : [] }
}

/**
 * 新流程里的手机号快捷登录：拿到会话后补一个默认昵称，不弹头像昵称表单。
 * 返回账号是否已完成过健康档案（老用户在新设备上登录时为 true）。
 */
export async function onboardingPhoneLogin(phoneCode: string): Promise<{ loginData: LoginResponse; onboardingCompleted: boolean }> {
  await cleanupGeneratedUserFiles().catch(() => undefined)
  const first = await Taro.login()
  if (!first.code) throw new Error('获取登录凭证失败')
  const loginData = await loginWithFreshWechatCodeRetry<LoginResponse>({
    initialCode: first.code,
    request: (code) => login(code, phoneCode),
    getFreshCode: async () => (await Taro.login()).code || '',
  })
  Taro.setStorageSync('openid', loginData.openid)
  const phone = String(loginData.purePhoneNumber || loginData.phoneNumber || '').trim()
  if (phone) Taro.setStorageSync('phoneNumber', phone)
  Taro.setStorageSync('isLoggedIn', true)
  let onboardingCompleted = false
  try {
    const profile = await getUserProfile()
    onboardingCompleted = profile.onboarding_completed === true
    if (profile.create_time) Taro.setStorageSync('userRegisterTime', profile.create_time)
    const nickname = String(profile.nickname || '').trim()
    const displayName = resolveRegistrationNickname(nickname, loginData.openid)
    if (!nickname) {
      await updateUserInfo({ nickname: displayName }).catch(() => undefined)
    }
    Taro.setStorageSync('userInfo', {
      avatar: getInitialRegistrationAvatar(profile.avatar),
      name: displayName,
      meta: '已记录 0 天',
    })
  } catch {
    // 资料读不到时按老用户处理，绝不覆盖服务端昵称。
    onboardingCompleted = true
  }
  return { loginData, onboardingCompleted }
}
