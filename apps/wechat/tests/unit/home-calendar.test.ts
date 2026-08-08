import {
  buildCalendarRecordMap,
  buildCenteredWeekCells,
  canApplyCalendarResponse,
  mergeCalendarMonthRecords,
  resolveCalendarRecordTarget,
  buildMonthCalendarCells,
  formatCalendarMonthLabel,
  getCalendarMonthKey,
  shiftCalendarMonth,
} from '../../src/pages/index/utils/home-calendar'
import { type WeekHeatmapCell } from '../../src/pages/index/types'

function record(date: string, calories = 600, target = 1800): WeekHeatmapCell {
  const parsed = new Date(`${date}T00:00:00`)
  return {
    date,
    dayName: ['日', '一', '二', '三', '四', '五', '六'][parsed.getDay()],
    dayNum: String(Number(date.slice(-2))),
    calories,
    target,
    intakeRatio: calories / target,
    state: calories > target ? 'surplus' : 'deficit',
    isToday: false,
    hasRecord: true,
  }
}

describe('home calendar helpers', () => {
  it('builds a stable six-row month grid and carries record state', () => {
    const records = buildCalendarRecordMap([
      record('2026-08-05'),
      record('2026-08-06', 2100, 1800),
    ])
    const cells = buildMonthCalendarCells('2026-08', records, '2026-08-07')

    expect(cells).toHaveLength(42)
    expect(cells.slice(0, 6).every(cell => !cell.isCurrentMonth)).toBe(true)
    expect(cells[6].date).toBe('2026-08-01')
    expect(cells.find(cell => cell.date === '2026-08-05')?.record?.state).toBe('deficit')
    expect(cells.find(cell => cell.date === '2026-08-06')?.record?.state).toBe('surplus')
    expect(cells.find(cell => cell.date === '2026-08-08')?.isFuture).toBe(true)
  })

  it('moves across year boundaries and formats the month label', () => {
    expect(shiftCalendarMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftCalendarMonth('2025-12', 1)).toBe('2026-01')
    expect(getCalendarMonthKey('2026-08-07')).toBe('2026-08')
    expect(formatCalendarMonthLabel('2026-08')).toBe('2026年8月')
  })

  it('centers the compact week around a historical selection', () => {
    const records = buildCalendarRecordMap([record('2026-07-10')])
    const cells = buildCenteredWeekCells('2026-07-10', records, '2026-08-07')

    expect(cells.map(cell => cell.date)).toEqual([
      '2026-07-07',
      '2026-07-08',
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
      '2026-07-13',
    ])
    expect(cells[3].hasRecord).toBe(true)
  })

  it('replaces only the requested month while preserving cached months', () => {
    const result = mergeCalendarMonthRecords(
      [record('2026-06-02'), record('2026-07-02')],
      '2026-07',
      [record('2026-07-03', 900)]
    )

    expect(result.map(cell => cell.date)).toEqual(['2026-06-02', '2026-07-03'])
  })

  it('uses the actual home calorie target for red and green thresholds', () => {
    expect(resolveCalendarRecordTarget(1650, 2100)).toBe(1650)
    expect(resolveCalendarRecordTarget(0, 2100)).toBe(2100)
  })

  it('rejects a calendar response after logout or account change', () => {
    expect(canApplyCalendarResponse('token-a', 'token-a', 3, 3)).toBe(true)
    expect(canApplyCalendarResponse('token-a', null, 3, 3)).toBe(false)
    expect(canApplyCalendarResponse('token-a', 'token-b', 3, 3)).toBe(false)
    expect(canApplyCalendarResponse('token-a', 'token-a', 3, 4)).toBe(false)
  })
})
