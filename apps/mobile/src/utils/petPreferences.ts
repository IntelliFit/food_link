import AsyncStorage from '@react-native-async-storage/async-storage'

const HOME_PET_HIDDEN_KEY = 'home_pet_companion_hidden_v1'
const HOME_PET_COLLAPSED_KEY = 'home_pet_companion_collapsed_v1'
const HOME_PET_FLOAT_POSITION_KEY = 'home_pet_companion_float_position_v1'

export interface HomePetFloatPosition {
  left: number
  top: number
}

export async function getHomePetHidden(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HOME_PET_HIDDEN_KEY)) === '1'
  } catch {
    return false
  }
}

export async function setHomePetHidden(hidden: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(HOME_PET_HIDDEN_KEY, hidden ? '1' : '0')
  } catch {
    // Local preference only; failing to persist should not block the page.
  }
}

export async function getHomePetCollapsed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HOME_PET_COLLAPSED_KEY)) === '1'
  } catch {
    return false
  }
}

export async function setHomePetCollapsed(collapsed: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(HOME_PET_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Local preference only; failing to persist should not block the page.
  }
}

export async function getHomePetFloatPosition(): Promise<HomePetFloatPosition | null> {
  try {
    const raw = await AsyncStorage.getItem(HOME_PET_FLOAT_POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<HomePetFloatPosition>
    const left = Number(parsed.left)
    const top = Number(parsed.top)
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null
    return { left, top }
  } catch {
    return null
  }
}

export async function setHomePetFloatPosition(position: HomePetFloatPosition): Promise<void> {
  try {
    await AsyncStorage.setItem(HOME_PET_FLOAT_POSITION_KEY, JSON.stringify({
      left: Math.round(position.left),
      top: Math.round(position.top),
    }))
  } catch {
    // Local preference only; failing to persist should not block the page.
  }
}
