import AsyncStorage from '@react-native-async-storage/async-storage'

export const ANALYSIS_ENGINE_STORAGE_KEY = 'mobile_analysis_engine_v1'
export const SUGGEST_RATIO_STORAGE_KEY = 'analyzeSuggestRatioEnabled'

export async function readSuggestRatioPreference(): Promise<boolean> {
  const saved = await AsyncStorage.getItem(SUGGEST_RATIO_STORAGE_KEY)
  if (saved === '0' || saved === 'false') return false
  if (saved === '1' || saved === 'true') return true
  return true
}

export async function writeSuggestRatioPreference(value: boolean): Promise<void> {
  await AsyncStorage.setItem(SUGGEST_RATIO_STORAGE_KEY, value ? 'true' : 'false')
}
