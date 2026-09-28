import { authenticatedRequest } from './api'

export const SLEEP_CHANGED_EVENT = 'sleep-record-changed'
export const SLEEP_QUALITIES = [{ value: '', label: '未填写' }, { value: 'good', label: '好' }, { value: 'fair', label: '一般' }, { value: 'poor', label: '差' }] as const
export type SleepQuality = typeof SLEEP_QUALITIES[number]['value']
export interface SleepRecord {
  id: string
  date: string
  bedtime: string
  wake_time: string
  quality: SleepQuality
  note: string
  source: string
  duration_minutes: number
}
export type SleepInput = Pick<SleepRecord, 'bedtime' | 'wake_time' | 'quality' | 'note'>
export function sleepToday(now = new Date()): string { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10) }
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
export function buildSleepInput(date: string, bedDate: string, bedTime: string, wakeTime: string, quality: SleepQuality, note: string, now = new Date()): SleepInput {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!validDate(date) || !validDate(bedDate) || date < '1900-01-01' || date > sleepToday(now)) throw new Error('请选择有效的起床日期')
  if (![bedTime, wakeTime].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw new Error('请填写入睡和起床时间')
  const bedtime = `${bedDate}T${bedTime}:00+08:00`
  const wake_time = `${date}T${wakeTime}:00+08:00`
  const duration = (Date.parse(wake_time) - Date.parse(bedtime)) / 60000
  if (duration < 1 || duration > 1440) throw new Error('起床须晚于入睡，间隔不超过24小时；请核对入睡日期')
  if (Date.parse(wake_time) > now.getTime() + 5 * 60000) throw new Error('请在起床后记录，时间不能晚于现在')
  if ([...note.trim()].length > 500) throw new Error('补充说明最多500字')
  return { bedtime, wake_time, quality, note: note.trim() }
}
export async function getSleepRecord(date: string): Promise<SleepRecord | null> {
  return (await authenticatedRequest(`/api/sleep-records/${encodeURIComponent(date)}`, { method: 'GET' })).data
}
export async function saveSleepRecord(date: string, input: SleepInput): Promise<SleepRecord> {
  return (await authenticatedRequest(`/api/sleep-records/${encodeURIComponent(date)}`, { method: 'PUT', data: input })).data
}
export async function deleteSleepRecord(date: string): Promise<void> {
  await authenticatedRequest(`/api/sleep-records/${encodeURIComponent(date)}`, { method: 'DELETE' })
}
