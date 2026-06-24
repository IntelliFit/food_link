import AsyncStorage from '@react-native-async-storage/async-storage'

export const HOME_RECORD_MENU_FLAG_KEY = 'showRecordMenuModal'
export const HOME_RECORD_MENU_DATE_KEY = 'homeRecordMenuDate'
export const HOME_RECORD_MENU_REQUEST_EVENT = 'home-record-menu:request'

type Listener = () => void
const listeners = new Set<Listener>()

function isValidHomeDate(value?: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function onHomeRecordMenuRequest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emitHomeRecordMenuRequest(): void {
  for (const listener of Array.from(listeners)) {
    listener()
  }
}

export async function requestHomeRecordMenu(date?: string | null): Promise<void> {
  const normalizedDate = isValidHomeDate(date) ? date : ''
  if (normalizedDate) {
    await AsyncStorage.setItem(HOME_RECORD_MENU_DATE_KEY, normalizedDate).catch(() => undefined)
  }
  await AsyncStorage.setItem(HOME_RECORD_MENU_FLAG_KEY, '1').catch(() => undefined)
  emitHomeRecordMenuRequest()
}

export async function consumeHomeRecordMenuDate(): Promise<string | null> {
  try {
    const [flag, rawDate] = await Promise.all([
      AsyncStorage.getItem(HOME_RECORD_MENU_FLAG_KEY),
      AsyncStorage.getItem(HOME_RECORD_MENU_DATE_KEY),
    ])
    if (flag !== '1') return null
    await AsyncStorage.removeItem(HOME_RECORD_MENU_FLAG_KEY).catch(() => undefined)
    const normalized = isValidHomeDate(rawDate) ? rawDate : ''
    if (normalized) {
      await AsyncStorage.removeItem(HOME_RECORD_MENU_DATE_KEY).catch(() => undefined)
      return normalized
    }
    return ''
  } catch {
    return null
  }
}
