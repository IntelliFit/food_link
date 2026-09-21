import type { BodyMetricsSummary, FoodRecord, StatsSummary } from './api'
import type { RecapDay, RecapKind } from './health-recap'

export type JournalPhotos = { counts: { breakfast: number; lunch: number; dinner: number }; images: { src: string; meal: string; date: string }[] }
export function journalHealth(summary: StatsSummary | null | undefined, start: string, end: string) {
  const score = summary?.health_index?.overall_score
  if (!summary || summary.start_date !== start || summary.end_date !== end || !Number.isFinite(score) || score! < 0 || score! > 100) return null
  return { stars: Math.round(score! / 20), label: score! >= 80 ? '活力满满' : score! >= 60 ? '温柔滋养' : '需要多一点绿色' }
}
export function journalPhotos(records: FoodRecord[], start: string, end: string): JournalPhotos {
  const counts = { breakfast: 0, lunch: 0, dinner: 0 }
  const images: JournalPhotos['images'] = []
  const meals = new Set<string>()
  for (const record of new Map(records.map(row => [row.id, row])).values()) {
    // The API uses China natural days. Do not slice UTC timestamps at midnight.
    const instant = new Date(record.record_time)
    const date = Number.isFinite(instant.getTime()) ? new Date(instant.getTime() + 8 * 3600000).toISOString().slice(0, 10) : ''
    if (date < start || date > end || !['breakfast', 'lunch', 'dinner'].includes(record.meal_type)) continue
    if (!['food_image', 'analyze_history'].includes(record.entry_type || '') && !record.source_task_id) continue
    const src = record.image_paths?.find(Boolean) || record.image_path
    if (!src) continue
    const key = `${date}:${record.meal_type}`
    if (!meals.has(key)) { counts[record.meal_type as keyof typeof counts]++; meals.add(key) }
    if (images.filter(image => image.meal === record.meal_type).length < 3) images.push({ src, meal: record.meal_type, date })
  }
  return { counts, images }
}

export function journalBody(body: BodyMetricsSummary | undefined, start: string, end: string) {
  const covered = Boolean(body && body.start_date <= start && body.end_date >= end)
  const water = covered ? body!.water_daily.filter(row => row.date >= start && row.date <= end) : []
  const ml = water.reduce((sum, row) => sum + (Number.isFinite(row.total) ? Math.max(0, row.total) : 0), 0)
  const weights = body?.weight_entries.filter(row => row.date >= start && row.date <= end && Number.isFinite(row.value) && row.value > 0).sort((a, b) => a.date.localeCompare(b.date)) || []
  const unique = [...new Map(weights.map(row => [row.date, row])).values()]
  const values = unique.map(row => row.value)
  // A fixed minimum span avoids turning tiny fluctuations into steep mountains.
  const low = Math.min(...values), high = Math.max(...values), span = Math.max(2, high - low)
  const midpoint = (low + high) / 2
  const periodStart = new Date(`${start}T12:00:00`).getTime(), periodEnd = new Date(`${end}T12:00:00`).getTime()
  const points = unique.map(row => ({ x: (new Date(`${row.date}T12:00:00`).getTime() - periodStart) / Math.max(86400000, periodEnd - periodStart), y: .5 - (row.value - midpoint) / span * .5 }))
  return { covered, cups: covered ? Math.round(ml / 250 * 10) / 10 : null, waterDays: water.filter(row => row.total > 0).length, points }
}

export function journalAdvice(days: RecapDay[], waterDays: number, hasWeight: boolean) {
  if (!days.some(day => day.has_record)) return '下一餐，留一张喜欢的照片。故事可以从任何一天开始。'
  if (waterDays === 0) return '把水杯放在手边。忙碌的间隙，也给自己一小口清凉。'
  if (!hasWeight) return '好好吃饭，也给自己留一点散步和休息的时间。照顾自己，不必着急。'
  return '继续珍惜三餐与日常的小停顿。带着喜欢的习惯，慢慢走进下一段生活。'
}

export function journalSwipeTarget(page: number, dx: number, dy: number, count = 8) {
  if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.3) return page
  return Math.max(0, Math.min(count - 1, page + (dx < 0 ? 1 : -1)))
}

export type JournalBook = { id: string; kind: RecapKind; anchor: string; start: string; end: string }
export function journalBookTitle(entry: JournalBook) {
  if (entry.kind === 'year') return `${entry.start.slice(0, 4)}年报`
  if (entry.kind === 'month') return `${entry.start.slice(0, 4)}年${Number(entry.start.slice(5, 7))}月`
  const date = new Date(`${entry.start}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 3 - (date.getUTCDay() + 6) % 7)
  const year = date.getUTCFullYear()
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)
  return `${year}年 第${week}周`
}
