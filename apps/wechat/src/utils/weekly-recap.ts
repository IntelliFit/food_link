import type { BodyMetricsSummary, FoodRecord, StatsCalendarMonth } from './api'
import { collectFoodDisplayImageUrls } from './food-display-image'

/** API records are grouped by China natural day, including for users abroad. */
export function chinaDay(date: Date): string { return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10) }
export function previousRecapWeek(now = new Date()) {
  const today = new Date(`${chinaDay(now)}T00:00:00Z`)
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7 - 7)
  const dates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday); day.setUTCDate(monday.getUTCDate() + index)
    return day.toISOString().slice(0, 10)
  })
  return { start: dates[0], end: dates[6], dates, months: [...new Set(dates.map(date => date.slice(0, 7)))] }
}
export type RecapWeek = ReturnType<typeof previousRecapWeek>

export function summarizeRecapWeek(week: RecapWeek, calendars: StatsCalendarMonth[]) {
  const lookup = new Map(calendars.flatMap(calendar => calendar.days).map(day => [day.date, day]))
  if (week.dates.some(date => !lookup.has(date))) throw new Error('这一周的记录尚未完整返回，请重试。')
  const days = week.dates.map(date => ({ date, recorded: lookup.get(date)!.has_record === true }))
  let streak = 0; let longest = 0
  for (const day of days) { streak = day.recorded ? streak + 1 : 0; longest = Math.max(longest, streak) }
  return { ...week, days, recordedDays: days.filter(day => day.recorded).length, longestStreak: longest }
}
export type WeeklyRecapSummary = ReturnType<typeof summarizeRecapWeek>

export function summarizeRecapWater(week: RecapWeek, body?: BodyMetricsSummary | null) {
  if (!body || body.start_date > week.start || body.end_date < week.end) return null
  const rows = new Map(body.water_daily.filter(day => day.date >= week.start && day.date <= week.end).map(day => [day.date, day]))
  if (week.dates.some(date => !rows.has(date))) return null
  if ([...rows.values()].some(day => !Number.isFinite(day.total) || day.total < 0)) return null
  const totals = [...rows.values()].map(day => day.total)
  return { totalMl: totals.reduce((sum, total) => sum + total, 0), recordedDays: totals.filter(total => total > 0).length }
}

export type RecapPhoto = { src: string; date: string; recordId: string }
export function selectRecapPhotoCandidates(records: FoodRecord[], week: RecapWeek, userId: string): RecapPhoto[] {
  const result: RecapPhoto[] = []; const seen = new Set<string>()
  for (const record of records) {
    if (record.user_id !== userId) continue
    const instant = new Date(record.record_time)
    if (!Number.isFinite(instant.getTime())) continue
    const date = chinaDay(instant)
    if (date < week.start || date > week.end) continue
    for (const src of collectFoodDisplayImageUrls(record)) {
      if (!seen.has(src)) { seen.add(src); result.push({ src, date, recordId: record.id }) }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}
