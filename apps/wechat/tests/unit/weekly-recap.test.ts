import { chinaDay, previousRecapWeek, selectRecapPhotoCandidates, summarizeRecapWater, summarizeRecapWeek } from '../../src/utils/weekly-recap'
import type { BodyMetricsSummary, FoodRecord, StatsCalendarMonth } from '../../src/utils/api'

describe('weekly recap uses actual private records', () => {
  const week = previousRecapWeek(new Date('2026-09-25T16:00:00Z'))
  const calendar = { days: week.dates.map((date, index) => ({ date, has_record: [0, 1, 3].includes(index), calories: 0 })) } as StatsCalendarMonth
  it('uses the last completed China calendar week across month/year boundaries', () => {
    const boundary = previousRecapWeek(new Date('2026-01-04T16:01:00Z'))
    expect(boundary.start).toBe('2025-12-29')
    expect(boundary.end).toBe('2026-01-04')
    expect(boundary.months).toEqual(['2025-12', '2026-01'])
    expect(chinaDay(new Date('2026-09-20T16:00:00Z'))).toBe('2026-09-21')
  })
  it('counts recorded days, including zero-calorie records, and does not invent missing dates', () => {
    expect(summarizeRecapWeek(week, [calendar])).toMatchObject({ recordedDays: 3, longestStreak: 2 })
    expect(() => summarizeRecapWeek(week, [{ ...calendar, days: calendar.days.slice(1) }])).toThrow('尚未完整返回')
  })
  it('distinguishes unavailable water data from a genuinely empty week', () => {
    expect(summarizeRecapWater(week, null)).toBeNull()
    const body: BodyMetricsSummary = { range: 'month', start_date: week.start, end_date: week.end, weight_entries: [], water_goal_ml: 2000, today_water: { date: week.end, total: 0, logs: [] }, total_water_ml: 0, avg_daily_water_ml: 0, water_recorded_days: 0, water_daily: week.dates.map(date => ({ date, total: 0, logs: [] })) }
    expect(summarizeRecapWater(week, body)).toEqual({ totalMl: 0, recordedDays: 0 })
    expect(summarizeRecapWater(week, { ...body, water_daily: body.water_daily.slice(1) })).toBeNull()
    expect(summarizeRecapWater(week, { ...body, water_daily: body.water_daily.map((day, index) => ({ ...day, total: index === 0 ? NaN : 0 })) })).toBeNull()
  })
  it('only uses the current user and exact China dates; images do not truncate the record summary', () => {
    const records = Array.from({ length: 20 }, (_, index) => ({ id: `record-${index}`, user_id: 'alice', record_time: `${week.start}T12:00:00+08:00`, image_path: `https://example.com/${index}.jpg` })) as FoodRecord[]
    const candidates = selectRecapPhotoCandidates([...records, { ...records[0], user_id: 'bob', image_path: 'https://example.com/private.jpg' }, { ...records[0], record_time: `${week.end}T16:00:00Z`, image_path: 'https://example.com/next-week.jpg' }], week, 'alice')
    expect(candidates).toHaveLength(20)
    expect(candidates.some(photo => photo.src.includes('private') || photo.src.includes('next-week'))).toBe(false)
  })
})
