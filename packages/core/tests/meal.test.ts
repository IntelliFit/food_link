import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime } from '../src'

describe('meal helpers', () => {
  it('infers default meal type from local time', () => {
    expect(inferDefaultMealTypeFromLocalTime(new Date(2026, 0, 1, 6, 0))).toBe('breakfast')
    expect(inferDefaultMealTypeFromLocalTime(new Date(2026, 0, 1, 12, 0))).toBe('lunch')
    expect(inferDefaultMealTypeFromLocalTime(new Date(2026, 0, 1, 18, 0))).toBe('dinner')
    expect(inferDefaultMealTypeFromLocalTime(new Date(2026, 0, 1, 23, 0))).toBe('evening_snack')
  })

  it('returns readable meal labels', () => {
    expect(getMealTypeLabel('breakfast')).toBe('早餐')
    expect(getMealTypeLabel('unknown')).toBe('餐食')
  })
})
