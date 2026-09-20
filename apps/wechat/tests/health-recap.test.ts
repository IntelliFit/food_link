import { recapPeriod, summarizeRecap, summarizeExercise } from '../src/utils/health-recap'

describe('health recap', () => {
  test('week crosses the year boundary and has exactly seven local dates', () => {
    const period = recapPeriod('week', 2026, new Date(2026, 0, 3))
    expect(period.dates).toHaveLength(7)
    expect(period.start).toBe('2025-12-22')
    expect(period.months).toEqual(['2025-12'])
  })
  test('completed leap year includes February 29 and current year resolves to the last completed year', () => {
    expect(recapPeriod('year', 2024, new Date(2026, 8, 16)).dates).toHaveLength(366)
    expect(recapPeriod('year', 2026, new Date(2026, 0, 3)).dates).toHaveLength(365)
  })
  test('zero-calorie records count; absent dates break a streak; duplicates do not inflate totals', () => {
    const report = summarizeRecap([
      { date: '2026-01-01', calories: 0, has_record: true },
      { date: '2026-01-02', calories: 600, has_record: true },
      { date: '2026-01-02', calories: 600, has_record: true },
      { date: '2026-01-04', calories: 900, has_record: true },
      { date: '2025-12-31', calories: 3000, has_record: true },
    ], ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])
    expect(report.recorded).toBe(3)
    expect(report.longest).toBe(2)
    expect(report.average).toBe(500)
    expect(report.coverage).toBe(75)
  })
  test('empty report does not invent averages or achievements', () => {
    const report = summarizeRecap([], ['2026-01-01'])
    expect(report.average).toBeNull()
    expect(report.longest).toBe(0)
    expect(report.title).toBe('故事等待开篇')
  })
})


test('exercise recap deduplicates IDs, filters dates and does not count missing dates', () => {
  const report = summarizeExercise([
    { id: 'a', recorded_on: '2026-01-01', calories_burned: 120 },
    { id: 'a', recorded_on: '2026-01-01', calories_burned: 120 },
    { id: 'b', recorded_on: '2026-01-01', calories_burned: 80 },
    { id: 'c', recorded_on: '2025-12-31', calories_burned: 100 },
    { id: 'd', calories_burned: 100 },
  ], '2026-01-01', '2026-01-07')
  expect(report.count).toBe(2)
  expect(report.days).toBe(1)
  expect(report.calories).toBe(200)
})

test('month uses the complete previous calendar month', () => { const p = recapPeriod('month', 2026, new Date(2024, 2, 1)); expect(p.start).toBe('2024-02-01'); expect(p.end).toBe('2024-02-29'); expect(p.dates).toHaveLength(29) })
