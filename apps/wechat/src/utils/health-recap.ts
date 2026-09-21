export type RecapDay = { date: string; calories: number; has_record: boolean }

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export type RecapKind = 'week' | 'month' | 'year'
export function recapPeriod(kind: RecapKind, year: number, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = kind === 'year' ? new Date(Math.min(year, today.getFullYear() - 1), 11, 31)
    : kind === 'month' ? new Date(today.getFullYear(), today.getMonth(), 0)
      : new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) - 1)
  const start = kind === 'year' ? new Date(end.getFullYear(), 0, 1)
    : kind === 'month' ? new Date(end.getFullYear(), end.getMonth(), 1)
      : new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6)
  const dates: string[] = []
  for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) dates.push(localDay(day))
  return { start: localDay(start), end: localDay(end), dates, months: [...new Set(dates.map(day => day.slice(0, 7)))] }
}

export function summarizeRecap(rows: RecapDay[], dates: string[]) {
  const lookup = new Map(rows.map(row => [row.date, row]))
  const days = dates.map(date => ({ date, calories: lookup.get(date)?.calories ?? 0, has_record: lookup.get(date)?.has_record === true }))
  const recorded = days.filter(day => day.has_record)
  let streak = 0
  let longest = 0
  for (const day of days) {
    streak = day.has_record ? streak + 1 : 0
    longest = Math.max(longest, streak)
  }
  const months = [...new Set(dates.map(date => date.slice(0, 7)))].map(month => ({
    month, count: recorded.filter(day => day.date.startsWith(month)).length,
  }))
  const weekdayCounts = Array.from({ length: 7 }, (_, day) => ({ day, count: recorded.filter(row => new Date(`${row.date}T12:00:00`).getDay() === day).length }))
  const favoriteDay = weekdayCounts.sort((a, b) => b.count - a.count || a.day - b.day)[0]
  const total = recorded.reduce((sum, day) => sum + (Number.isFinite(day.calories) ? Math.max(0, day.calories) : 0), 0)
  return { favoriteDay, days, months, recorded: recorded.length, longest, average: recorded.length ? Math.round(total / recorded.length) : null,
    coverage: dates.length ? Math.round(recorded.length / dates.length * 100) : 0,
    bestMonth: [...months].sort((a, b) => b.count - a.count)[0],
    title: recorded.length === 0 ? '故事等待开篇' : longest >= 7 ? '记录冒险家' : longest >= 3 ? '习惯发芽家' : '生活观察员' }
}


export function summarizeExercise(rows: Array<{ id: string; recorded_on?: string | null; calories_burned: number }>, start: string, end: string) {
  const unique = new Map(rows.map(row => [row.id, row]))
  const entries = [...unique.values()].filter(row => row.recorded_on && row.recorded_on >= start && row.recorded_on <= end)
  const days = new Set(entries.map(row => row.recorded_on)).size
  return { days, count: entries.length, calories: Math.round(entries.reduce((sum, row) => sum + (Number.isFinite(row.calories_burned) ? Math.max(0, row.calories_burned) : 0), 0)),
    title: days >= 7 ? '活力探索家' : days >= 3 ? '行动派队友' : days > 0 ? '迈步新朋友' : '下一次出发，等你来记录' }
}
