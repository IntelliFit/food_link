import Taro from '@tarojs/taro'
import { getTodayRecordDateKey } from './record-date'

const RETURN_DATE_KEY = 'record_return_date_v1'
const runtimeId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
export const HOME_RECORD_DATE_GETTER = 'getHomeRecordDate'

/** Accept real, non-future calendar dates without narrowing water/weight history. */
export function isCalendarRecordDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match || date > getTodayRecordDateKey()) return false
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return parsed.getFullYear() === Number(match[1]) && parsed.getMonth() + 1 === Number(match[2]) && parsed.getDate() === Number(match[3])
}

export function rememberRecordReturnDate(date: string): void {
  if (!isCalendarRecordDate(date)) return
  const owner = String(Taro.getStorageSync('user_id') || '')
  if (owner) Taro.setStorageSync(RETURN_DATE_KEY, { date, owner, runtimeId })
}

export function consumeRecordReturnDate(): string {
  const value = Taro.getStorageSync(RETURN_DATE_KEY)
  Taro.removeStorageSync(RETURN_DATE_KEY)
  if (value?.runtimeId !== runtimeId || value?.owner !== String(Taro.getStorageSync('user_id') || '')) return ''
  return typeof value.date === 'string' && isCalendarRecordDate(value.date) ? value.date : ''
}

/** A historical supplement intake belongs to the selected China calendar day. */
export function supplementTakenAtForDate(date: string, now = new Date()): string {
  if (!isCalendarRecordDate(date)) throw new Error('请选择有效的记录日期')
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const time = chinaTime.toISOString().slice(11, 19)
  return `${date}T${time}+08:00`
}
