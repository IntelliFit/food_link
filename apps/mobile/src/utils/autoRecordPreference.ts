import AsyncStorage from '@react-native-async-storage/async-storage'

const AUTO_RECORD_PREFERENCE_KEY = 'analyze_auto_record_preference_v1'

export async function readAutoRecordPreference(): Promise<boolean> {
  return (await AsyncStorage.getItem(AUTO_RECORD_PREFERENCE_KEY)) === 'true'
}

export async function writeAutoRecordPreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_RECORD_PREFERENCE_KEY, enabled ? 'true' : 'false')
}
