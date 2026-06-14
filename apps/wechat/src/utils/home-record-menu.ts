import Taro from '@tarojs/taro'
import { normalizeRecordDate, persistRecordTargetDate } from './record-date'

export const HOME_RECORD_MENU_FLAG_KEY = 'showRecordMenuModal'
export const HOME_RECORD_MENU_DATE_KEY = 'homeRecordMenuDate'

export function requestHomeRecordMenu(date?: string | null): void {
  const normalizedDate = date ? persistRecordTargetDate(date) : ''
  try {
    if (normalizedDate) {
      Taro.setStorageSync(HOME_RECORD_MENU_DATE_KEY, normalizedDate)
    }
    Taro.setStorageSync(HOME_RECORD_MENU_FLAG_KEY, true)
  } catch {
    // ignore storage failure; the switch still returns users to the main entry.
  }
  Taro.switchTab({ url: '/pages/index/index' })
}

export function consumeHomeRecordMenuDate(): string {
  try {
    const raw = String(Taro.getStorageSync(HOME_RECORD_MENU_DATE_KEY) || '')
    Taro.removeStorageSync(HOME_RECORD_MENU_DATE_KEY)
    return raw ? normalizeRecordDate(raw) : ''
  } catch {
    return ''
  }
}
