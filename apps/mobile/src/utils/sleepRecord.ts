import type { SleepQuality, SleepRecordInput } from '@food-link/core'

// Match the existing WeChat/server contract: date is the wake-up date in China time.
export const SLEEP_QUALITIES = [{ value: '', label: '未填写' }, { value: 'good', label: '好' }, { value: 'fair', label: '一般' }, { value: 'poor', label: '差' }] as const
export function sleepToday(now = new Date()): string { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) }
export function validSleepDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value && value >= '1900-01-01' && value <= sleepToday()
}
export function shiftSleepDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function sleepLocalParts(value: string) {
  const local = new Date(new Date(value).getTime() + 8 * 3600000).toISOString()
  return { date: local.slice(0, 10), time: local.slice(11, 16) }
}
export function sleepDurationLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}小时${minutes % 60 ? `${minutes % 60}分` : ''}`
}
export function buildSleepInput(date: string, bedDate: string, bedTime: string, wakeTime: string, quality: SleepQuality, note: string, now = new Date()): SleepRecordInput {
  if (!validSleepDate(date) || !validSleepDate(bedDate)) throw new Error('请选择有效的起床日期')
  if (![bedTime, wakeTime].every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new Error('请使用 HH:mm 填写时间')
  const bedtime = `${bedDate}T${bedTime}:00+08:00`
  const wake_time = `${date}T${wakeTime}:00+08:00`
  const duration = (Date.parse(wake_time) - Date.parse(bedtime)) / 60000
  if (duration < 1 || duration > 1440) throw new Error('起床须晚于入睡，间隔不超过24小时；请核对入睡日期')
  if (Date.parse(wake_time) > now.getTime() + 5 * 60000) throw new Error('请在起床后记录，时间不能晚于现在')
  if ([...note.trim()].length > 500) throw new Error('补充说明最多500字')
  return { bedtime, wake_time, quality, note: note.trim() }
}
