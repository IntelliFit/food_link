import { freshMealLocation } from '../../src/utils/meal-location'

describe('meal recommendation location lifetime', () => {
  const now = Date.now()
  const location = { latitude: 40, longitude: 116, captured_at: now, coordinate_type: 'gcj02' as const }
  it('keeps a current authorized fix', () => expect(freshMealLocation(location, now)).toEqual(location))
  it('drops an old fix, an invalid fix, and inaccurate positioning', () => {
    expect(freshMealLocation(location, now + 31 * 60000)).toBeUndefined()
    expect(freshMealLocation({ ...location, latitude: NaN }, now)).toBeUndefined()
    expect(freshMealLocation({ ...location, accuracy_m: 5000 }, now)).toBeUndefined()
  })
})
