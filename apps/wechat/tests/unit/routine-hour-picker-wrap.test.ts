import { hourToWheelIndex, wheelIndexToHour } from '../../src/components/RoutineHourPicker'

describe('RoutineHourPicker wheel wraps around midnight', () => {
  it('maps every hour to the middle cycle and back', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(wheelIndexToHour(hourToWheelIndex(hour))).toBe(hour)
    }
  })

  it('scrolling one step past 23 lands on 0, then 1', () => {
    const at23 = hourToWheelIndex(23)
    expect(wheelIndexToHour(at23 + 1)).toBe(0)
    expect(wheelIndexToHour(at23 + 2)).toBe(1)
  })

  it('scrolling one step before 0 lands on 23', () => {
    expect(wheelIndexToHour(hourToWheelIndex(0) - 1)).toBe(23)
  })

  it('keeps a full day of room on both sides after re-centering', () => {
    expect(hourToWheelIndex(0)).toBeGreaterThanOrEqual(24)
    expect(hourToWheelIndex(23) + 24).toBeLessThan(24 * 5)
  })
})
