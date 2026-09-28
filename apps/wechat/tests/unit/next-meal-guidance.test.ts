import {
  buildNextMealGuidance,
  nextMealLabel,
  normalizeNextMainMeal,
} from '../../src/pages/index/utils/next-meal-guidance'

describe('next meal guidance', () => {
  it('prioritizes protein without repeating dashboard numbers', () => {
    const result = buildNextMealGuidance({
      calories: { current: 850, target: 2000 },
      protein: { current: 32, target: 110 },
      carbs: { current: 135, target: 240 },
      fat: { current: 38, target: 65 },
    })

    expect(result.title).toBe('优先补蛋白，搭配适量主食')
    expect(`${result.title}${result.detail}`).not.toMatch(/\d|kcal|千卡/)
  })

  it('switches to a lighter direction when the daily allowance is nearly used', () => {
    const result = buildNextMealGuidance({
      calories: { current: 1880, target: 2000 },
      protein: { current: 80, target: 110 },
      carbs: { current: 210, target: 240 },
      fat: { current: 64, target: 65 },
    })

    expect(result.title).toContain('清淡')
    expect(result.detail).toContain('低脂')
  })

  it('maps snack periods to the next main meal', () => {
    expect(normalizeNextMainMeal('morning_snack')).toBe('lunch')
    expect(normalizeNextMainMeal('afternoon_snack')).toBe('dinner')
    expect(nextMealLabel('dinner')).toBe('晚餐')
  })
})
