import { buildSleepInput, shiftSleepDate, sleepDurationLabel, sleepLocalParts } from '../../src/utils/sleep-record'
import { defaultHomeModuleLayout, isHomeModuleVisible, moveHomeModule, normalizeHomeModuleLayout } from '../../src/pages/index/utils/home-module-layout'

describe('manual sleep records', () => {
  const now = new Date('2026-09-28T12:00:00+08:00')
  it('preserves explicit midnight crossing and waking-day grouping', () => {
    const record = buildSleepInput('2026-09-28', '2026-09-27', '23:30', '07:00', 'good', '  半夜醒过一次  ', now)
    expect(record.note).toBe('半夜醒过一次')
    expect((Date.parse(record.wake_time) - Date.parse(record.bedtime)) / 60000).toBe(450)
    expect(buildSleepInput('2026-09-28', '2026-09-28', '01:00', '08:00', '', '', now).bedtime).toContain('2026-09-28T01:00')
    expect(sleepLocalParts('2026-09-27T23:00:00Z')).toEqual({ date: '2026-09-28', time: '07:00' })
    expect(shiftSleepDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(sleepDurationLabel(450)).toBe('7小时30分')
  })
  it('rejects reversed, future, invalid and excessively long periods', () => {
    for (const [date, bedDate, bed, wake] of [
      ['2026-09-28', '2026-09-28', '23:00', '07:00'],
      ['2026-09-28', '2026-09-26', '23:00', '07:00'],
      ['2026-09-28', '2026-09-28', '07:00', '18:00'],
      ['2026-02-30', '2026-02-29', '23:00', '07:00'],
    ]) expect(() => buildSleepInput(date, bedDate, bed, wake, '', '', now)).toThrow()
  })
  it('adds sleep to old layouts and allows hiding and ordering it', () => {
    const old = normalizeHomeModuleLayout({ order: ['diet', 'body'], hidden: [] })
    expect(old.order).toContain('sleep')
    expect(isHomeModuleVisible({ ...old, hidden: ['sleep'] }, 'sleep')).toBe(false)
    const moved = moveHomeModule(defaultHomeModuleLayout(), 'sleep', -1)
    expect(moved.order.indexOf('sleep')).toBe(defaultHomeModuleLayout().order.indexOf('sleep') - 1)
  })
})
