import Taro from '@tarojs/taro'
import { saveHomeExperienceConfig, type HomeExperienceMode } from './home-experience'
import { BALANCED_THEME_EVENT, BALANCED_THEME_STORAGE_KEY, getBalancedThemeStorageKey, isBalancedThemeId } from './balanced-theme'
import type { ModeIntroductionChoice } from './mode-introduction-chapters'

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
export function completeModeIntroduction(choice: ModeIntroductionChoice | HomeExperienceMode, session: { userId: string; token: string }): boolean {
  const mode = typeof choice === 'string' ? choice : choice.mode
  if (mode !== 'balanced' && mode !== 'wellness') return false
  const theme = typeof choice === 'object' && choice.mode === 'balanced' ? choice.theme : undefined
  if (typeof choice === 'object' && choice.mode === 'balanced' && !isBalancedThemeId(theme)) return false
  const current = getModeIntroductionSession()
  if (!session.userId || !session.token || current.userId !== session.userId || current.token !== session.token) return false
  const configKey = `home_experience_config_v2:${session.userId}`, introKey = `${MODE_INTRODUCTION_PREFIX}${session.userId}`
  const writes: Array<[string, unknown]> = [[configKey, { version: 2, mode }]]
  if (theme) writes.push([getBalancedThemeStorageKey(session.userId), theme], [BALANCED_THEME_STORAGE_KEY, theme])
  writes.push([introKey, { version: 1, completed: true }])
  const previous: Array<[string, unknown]> = []
  try {
    for (const [key] of writes) previous.push([key, Taro.getStorageSync(key)])
    for (const [key, value] of writes) Taro.setStorageSync(key, value)
    const persisted = getModeIntroductionSession()
    if (Taro.getStorageSync(configKey)?.mode !== mode || persisted.required || persisted.userId !== session.userId || persisted.token !== session.token || (theme && (Taro.getStorageSync(getBalancedThemeStorageKey(session.userId)) !== theme || Taro.getStorageSync(BALANCED_THEME_STORAGE_KEY) !== theme))) throw new Error('Mode preference not persisted')
  } catch {
    for (const [key, value] of previous.reverse()) {
      try { if (value === undefined || value === null || value === '') Taro.removeStorageSync(key); else Taro.setStorageSync(key, value) } catch { /* Keep the introduction pending if storage is unavailable. */ }
    }
    return false
  }
  // Commit visible consumers only after both durable values were written.
  if (theme) { try { Taro.eventCenter.trigger(BALANCED_THEME_EVENT, { theme }) } catch { /* The durable choice remains valid. */ } }
  saveHomeExperienceConfig({ version: 2, mode })
  return true
}
