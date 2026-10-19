import { mealBudgetLabel, mealPaymentLabel, MEAL_PAYMENT_OPTIONS } from '../../src/utils/meal-meetup'
import { appendMealText, clipMealText, MEAL_EMOJIS, MEAL_MESSAGE_MAX, MEAL_QUICK_PHRASES, mealMessageLength } from '../../src/packageMeal/meal-chat'

describe('meal meetup payment labels', () => {
  it('labels every selectable payment option distinctly', () => {
    const labels = MEAL_PAYMENT_OPTIONS.map((o) => mealPaymentLabel(o.value))
    expect(labels).toEqual(['AA', '各自付款', '我请客', '到店商量'])
    expect(new Set(labels).size).toBe(labels.length)
  })
  it('never mislabels an unknown payment value as split-the-bill', () => {
    expect(mealPaymentLabel('guest_treat')).toBe('付款方式见详情')
  })
  it('combines budget and payment per payment type', () => {
    expect(mealBudgetLabel({ budget: 30, payment: 'aa' })).toBe('人均30元以内 · AA')
    expect(mealBudgetLabel({ budget: 0, payment: 'separate' })).toBe('人均预算协商 · 各自付款')
    expect(mealBudgetLabel({ budget: 40, payment: 'host_treat' })).toBe('我请客 · 约人均40元')
    expect(mealBudgetLabel({ budget: 0, payment: 'host_treat' })).toBe('我请客')
    expect(mealBudgetLabel({ budget: 25, payment: 'negotiate' })).toBe('到店商量')
  })
})

describe('meal room composer helpers', () => {
  it('offers unique emoji and short quick phrases within the message limit', () => {
    expect(new Set(MEAL_EMOJIS).size).toBe(MEAL_EMOJIS.length)
    expect(MEAL_EMOJIS.length).toBeGreaterThanOrEqual(40)
    for (const phrase of MEAL_QUICK_PHRASES) expect(mealMessageLength(phrase)).toBeLessThanOrEqual(MEAL_MESSAGE_MAX)
  })
  it('counts an emoji as one character, like the server', () => {
    expect(mealMessageLength('吃😋')).toBe(2)
  })
  it('appends emoji until the limit and never splits one', () => {
    const full = '好'.repeat(MEAL_MESSAGE_MAX - 1)
    expect(appendMealText(full, '😋')).toBe(`${full}😋`)
    expect(appendMealText(`${full}😋`, '😋')).toBe(`${full}😋`)
  })
  it('clips pasted text on a character boundary', () => {
    const text = `${'好'.repeat(MEAL_MESSAGE_MAX - 1)}😋😋`
    const clipped = clipMealText(text)
    expect(mealMessageLength(clipped)).toBe(MEAL_MESSAGE_MAX)
    expect(clipped.endsWith('😋')).toBe(true)
    expect(clipMealText('短消息')).toBe('短消息')
  })
})
