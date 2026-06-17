import AsyncStorage from '@react-native-async-storage/async-storage'

const HOME_PET_HIDDEN_KEY = 'home_pet_companion_hidden_v1'

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
