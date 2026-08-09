import Taro from '@tarojs/taro'

export type HomeExperienceMode = 'wellness' | 'balanced'

export interface HomeExperienceConfig {
  version: 2
  mode: HomeExperienceMode
}

const HOME_EXPERIENCE_STORAGE_KEY = 'home_experience_config_v2'
const LEGACY_HOME_EXPERIENCE_STORAGE_KEY = 'home_experience_config_v1'

export const DEFAULT_HOME_EXPERIENCE_CONFIG: HomeExperienceConfig = {
  version: 2,
  mode: 'balanced',
}

function getStorageKey(prefix: string): string {
  try {
    const userID = String(Taro.getStorageSync('user_id') || '').trim()
    return `${prefix}:${userID || 'guest'}`
  } catch {
    return `${prefix}:guest`
  }
}

export function sanitizeHomeExperienceConfig(value: unknown): HomeExperienceConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_HOME_EXPERIENCE_CONFIG }
  const legacyMode = (value as { mode?: unknown }).mode
  return {
    version: 2,
    mode: legacyMode === 'wellness' ? 'wellness' : 'balanced',
  }
}

export function getStoredHomeExperienceConfig(): HomeExperienceConfig {
  try {
    const current = Taro.getStorageSync(getStorageKey(HOME_EXPERIENCE_STORAGE_KEY))
    if (current) return sanitizeHomeExperienceConfig(current)

    const legacy = Taro.getStorageSync(getStorageKey(LEGACY_HOME_EXPERIENCE_STORAGE_KEY))
    return sanitizeHomeExperienceConfig(legacy)
  } catch {
    return { ...DEFAULT_HOME_EXPERIENCE_CONFIG }
  }
}

export function saveHomeExperienceConfig(config: HomeExperienceConfig): HomeExperienceConfig {
  const sanitized = sanitizeHomeExperienceConfig(config)
  try {
    Taro.setStorageSync(getStorageKey(HOME_EXPERIENCE_STORAGE_KEY), sanitized)
  } catch {
    /* 模式偏好保存失败不影响首页核心记录链路 */
  }
  return sanitized
}
