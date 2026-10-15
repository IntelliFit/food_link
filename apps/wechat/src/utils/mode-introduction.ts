import Taro from '@tarojs/taro'
import { saveHomeExperienceConfig, type HomeExperienceMode } from './home-experience'

export const MODE_INTRODUCTION_PREFIX = 'mode_introduction_completed_v1:'

export function getModeIntroductionSession() {
  try {
    const userId = String(Taro.getStorageSync('user_id') || '').trim()
    const token = String(Taro.getStorageSync('access_token') || '')
    const completion = Taro.getStorageSync(`${MODE_INTRODUCTION_PREFIX}${userId}`)
    const config = Taro.getStorageSync(`home_experience_config_v2:${userId}`)
    const configured = config?.mode === 'balanced' || config?.mode === 'wellness'
    return { userId, token, required: Boolean(userId && token && !(completion?.version === 1 && completion?.completed === true && configured)) }
  } catch { return { userId: '', token: '', required: false } }
}

/** Confirm once for this authenticated account; defaults and previews never complete the introduction. */
export function completeModeIntroduction(mode: HomeExperienceMode, session: { userId: string; token: string }): boolean {
  const current = getModeIntroductionSession()
  if (!session.userId || !session.token || current.userId !== session.userId || current.token !== session.token) return false
  const configKey = `home_experience_config_v2:${session.userId}`, introKey = `${MODE_INTRODUCTION_PREFIX}${session.userId}`
  const previousConfig = Taro.getStorageSync(configKey), previousIntro = Taro.getStorageSync(introKey)
  try {
    Taro.setStorageSync(configKey, { version: 2, mode })
    Taro.setStorageSync(introKey, { version: 1, completed: true })
    const persisted = getModeIntroductionSession()
    if (Taro.getStorageSync(configKey)?.mode !== mode || persisted.required || persisted.userId !== session.userId || persisted.token !== session.token) throw new Error('Mode preference not persisted')
  } catch {
    for (const [key, value] of [[configKey, previousConfig], [introKey, previousIntro]] as const) {
      try { if (value === undefined || value === null || value === '') Taro.removeStorageSync(key); else Taro.setStorageSync(key, value) } catch { /* Keep the introduction pending if storage is unavailable. */ }
    }
    return false
  }
  // Commit visible consumers only after both durable values were written.
  saveHomeExperienceConfig({ version: 2, mode })
  return true
}
