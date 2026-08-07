import { type WeekHeatmapCell } from '../types'

export interface MonthCalendarCell {
  date: string
  dayNum: string
  isCurrentMonth: boolean
  isToday: boolean
  isFuture: boolean
  record?: WeekHeatmapCell
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function parseCalendarDate(dateKey: string): Date | null {
  const matched = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return null
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
  if (Number.isNaN(date.getTime())) return null
  const normalized = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  return normalized === dateKey ? date : null
}

export function getCalendarMonthKey(dateKey: string): string {
  const parsed = parseCalendarDate(dateKey)
  if (!parsed) {
    const today = new Date()
    return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`
  }
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}`
}

export function formatCalendarMonthLabel(monthKey: string): string {
  const matched = monthKey.match(/^(\d{4})-(\d{2})$/)
  if (!matched) return monthKey
  return `${Number(matched[1])}年${Number(matched[2])}月`
}

export function shiftCalendarMonth(monthKey: string, offset: number): string {
  const matched = monthKey.match(/^(\d{4})-(\d{2})$/)
  const base = matched
    ? new Date(Number(matched[1]), Number(matched[2]) - 1, 1)
    : new Date()
  base.setMonth(base.getMonth() + offset)
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`
}

export function buildCalendarRecordMap(cells: WeekHeatmapCell[]): Map<string, WeekHeatmapCell> {
  const result = new Map<string, WeekHeatmapCell>()
  cells.forEach((cell) => {
    if (parseCalendarDate(cell.date)) result.set(cell.date, cell)
  })
  return result
}

export function buildCenteredWeekCells(
  selectedDate: string,
  records: Map<string, WeekHeatmapCell>,
  todayKey: string
): WeekHeatmapCell[] {
  const selected = parseCalendarDate(selectedDate) || parseCalendarDate(todayKey) || new Date()
  const result: WeekHeatmapCell[] = []
  for (let offset = -3; offset <= 3; offset += 1) {
    const date = new Date(selected)
    date.setDate(selected.getDate() + offset)
    const dateKey = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    result.push(records.get(dateKey) || {
      date: dateKey,
      dayName: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      dayNum: String(date.getDate()),
      calories: 0,
      target: 2000,
      intakeRatio: 0,
      state: 'none',
      isToday: dateKey === todayKey,
      hasRecord: false,
    })
  }
  return result
}

export function buildMonthCalendarCells(
  monthKey: string,
  records: Map<string, WeekHeatmapCell>,
  todayKey: string
): MonthCalendarCell[] {
  const matched = monthKey.match(/^(\d{4})-(\d{2})$/)
  const base = matched
    ? new Date(Number(matched[1]), Number(matched[2]) - 1, 1)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const firstWeekday = base.getDay()
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  const result: MonthCalendarCell[] = []

  for (let index = 0; index < 42; index += 1) {
    const day = index - firstWeekday + 1
    if (day < 1 || day > daysInMonth) {
      result.push({ date: '', dayNum: '', isCurrentMonth: false, isToday: false, isFuture: false })
      continue
    }
    const dateKey = `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(day)}`
    result.push({
      date: dateKey,
      dayNum: String(day),
      isCurrentMonth: true,
      isToday: dateKey === todayKey,
      isFuture: dateKey > todayKey,
      record: records.get(dateKey),
    })
  }
  return result
}
