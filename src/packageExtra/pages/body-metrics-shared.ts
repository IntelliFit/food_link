import { formatDateKey } from '../../pages/index/utils/helpers'
import type {
  BodyMetricWaterDay,
  BodyMetricWaterLogItem,
  BodyMetricWeightEntry,
  BodyMetricsSummary,
  ExerciseLogItem,
} from '../../utils/api'

export type TrendPoint = {
  date: string
  value: number | null
}

export type ExerciseDay = {
  date: string
  total: number
  count: number
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

export function buildDateRange(days: number): string[] {
  const today = new Date()
  const dates: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    dates.push(formatDateKey(addDays(today, -i)))
  }
  return dates
}

export function normalizeRouteDate(value?: string | null): string {
  const raw = String(value || '').trim()
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return formatDateKey(new Date())
  const [, yearText, monthText, dayText] = matched
  const parsed = new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
  if (Number.isNaN(parsed.getTime())) return formatDateKey(new Date())
  const normalized = formatDateKey(parsed)
  const today = formatDateKey(new Date())
  if (normalized !== raw || normalized > today) return today
  return normalized
}

export function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function formatMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month || 0)}/${Number(day || 0)}`
}

export function formatChineseMonth(dateKey: string): string {
  const [year, month] = dateKey.split('-')
  return `${year}年${month}月`
}

export function formatChineseMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${month}月${day}日`
}

export function getRouteDateLabel(dateKey: string): string {
  return dateKey === formatDateKey(new Date()) ? '今天' : formatChineseMonthDay(dateKey)
}

export function formatSignedFixed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '--'
  if (Math.abs(value) < 0.005) return Number(0).toFixed(digits)
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

export function formatWeight(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return value.toFixed(1)
}

export function getWeightSortKey(entry: BodyMetricWeightEntry): string {
  return `${entry.date} ${entry.recorded_at || ''} ${entry.id || entry.client_id || ''}`
}

export function getWaterDay(summary: BodyMetricsSummary | null, date: string): BodyMetricWaterDay {
  const normalized = date.slice(0, 10)
  const day = (summary?.water_daily || []).find((item) => item.date === normalized)
  if (day) return day
  if (summary?.today_water?.date === normalized) return summary.today_water
  return { date: normalized, total: 0, logs: [] }
}

export function getWaterLogItems(day: BodyMetricWaterDay | null | undefined): BodyMetricWaterLogItem[] {
  if (!day) return []
  if (Array.isArray(day.log_items) && day.log_items.length > 0) {
    return day.log_items
      .filter((item) => Number.isFinite(toNumber(item.amount_ml, NaN)) && toNumber(item.amount_ml) > 0)
      .map((item) => ({
        ...item,
        date: item.date || day.date,
        amount_ml: Math.round(toNumber(item.amount_ml)),
      }))
  }
  return (day.logs || [])
    .filter((amount) => Number.isFinite(toNumber(amount, NaN)) && toNumber(amount) > 0)
    .map((amount, index) => ({
      id: undefined,
      date: day.date,
      amount_ml: Math.round(toNumber(amount)),
      recorded_at: null,
      _fallback_index: index,
    } as BodyMetricWaterLogItem & { _fallback_index: number }))
}

export function buildWeightTrend(summary: BodyMetricsSummary | null, dates: string[]): TrendPoint[] {
  const daily = summary?.weight_trend_daily || []
  if (daily.length > 0) {
    const byDate = new Map(daily.map((item) => [item.date, toNumber(item.value, NaN)]))
    return dates.map((date) => {
      const value = byDate.get(date)
      return { date, value: typeof value === 'number' && Number.isFinite(value) ? value : null }
    })
  }

  const entries = [...(summary?.weight_entries || [])]
    .filter((item) => Number.isFinite(toNumber(item.value, NaN)))
    .sort((a, b) => getWeightSortKey(a).localeCompare(getWeightSortKey(b)))
  let latest: BodyMetricWeightEntry | null = null
  return dates.map((date) => {
    entries.forEach((item) => {
      if (item.date <= date) latest = item
    })
    return { date, value: latest ? latest.value : null }
  })
}

export function buildWaterTrend(summary: BodyMetricsSummary | null, dates: string[]): TrendPoint[] {
  const byDate = new Map<string, BodyMetricWaterDay>()
  ;(summary?.water_daily || []).forEach((item) => byDate.set(item.date, item))
  return dates.map((date) => ({ date, value: byDate.get(date)?.total ?? 0 }))
}

export function getExerciseDate(log: ExerciseLogItem): string {
  if (log.recorded_on) return log.recorded_on.slice(0, 10)
  const raw = log.recorded_at || log.created_at || ''
  if (!raw) return formatDateKey(new Date())
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10)
  return formatDateKey(parsed)
}

export function buildExerciseDays(logs: ExerciseLogItem[], dates: string[]): ExerciseDay[] {
  const byDate = new Map<string, ExerciseDay>()
  dates.forEach((date) => byDate.set(date, { date, total: 0, count: 0 }))
  logs.forEach((log) => {
    const date = getExerciseDate(log)
    const current = byDate.get(date)
    if (!current) return
    current.total += toNumber(log.calories_burned)
    current.count += 1
  })
  return dates.map((date) => byDate.get(date) || { date, total: 0, count: 0 })
}

export function diffDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const diff = end.getTime() - start.getTime()
  if (!Number.isFinite(diff) || diff <= 0) return 1
  return Math.max(1, Math.round(diff / 86400000))
}
