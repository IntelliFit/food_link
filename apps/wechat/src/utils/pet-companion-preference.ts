import Taro from '@tarojs/taro'

export const HOME_COMPANION_CHANGED_EVENT = 'home_companion_appearance_changed'
export const HOME_COMPANION_PREFERENCE_KEY = 'home_pet_companion_appearance_v1'
export const ORIGINAL_COMPANION_SRC = '/assets/pets/companions/companion-fbd87f73-v1.png'
export const JIANWEN_COMPANION_SRC = '/assets/pets/companions/jianwen-01-companion-v2.png'
export type HomeCompanionChoice = 'follow' | 'original' | 'jianwen'
export interface HomeCompanionPreference { enabledOriginal: boolean; selected: HomeCompanionChoice }

function preferenceKey(): string | undefined {
  const userId = String(Taro.getStorageSync('user_id') || '').trim()
  return userId ? `${HOME_COMPANION_PREFERENCE_KEY}:${userId}` : undefined
}

export function getHomeCompanionPreference(): HomeCompanionPreference {
  const fallback: HomeCompanionPreference = { enabledOriginal: false, selected: 'follow' }
  try {
    const key = preferenceKey()
    if (!key) return fallback
    const stored = Taro.getStorageSync(key)
    if (!stored || typeof stored !== 'object') return fallback
    const enabledOriginal = stored.enabledOriginal === true
    const selected = stored.selected === 'jianwen' || (stored.selected === 'original' && enabledOriginal) ? stored.selected : 'follow'
    return { enabledOriginal, selected }
  } catch { return fallback }
}

/** Desktop appearance is local to this device/account and never updates PetProfile. */
export function setHomeCompanionChoice(selected: HomeCompanionChoice): boolean {
  try {
    const key = preferenceKey()
    const previous = getHomeCompanionPreference()
    if (!key || (selected === 'original' && !previous.enabledOriginal)) return false
    Taro.setStorageSync(key, { ...previous, selected })
    Taro.eventCenter.trigger(HOME_COMPANION_CHANGED_EVENT)
    return true
  } catch { return false }
}

export function getHomeCompanionSpriteOverride(preference: HomeCompanionPreference): string | undefined {
  if (preference.selected === 'original' && preference.enabledOriginal) return ORIGINAL_COMPANION_SRC
  if (preference.selected === 'jianwen') return JIANWEN_COMPANION_SRC
  return undefined
}
