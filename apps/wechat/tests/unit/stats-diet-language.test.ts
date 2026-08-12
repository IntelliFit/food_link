import { dietFocusShort, dietFocusTitle, shouldShowDietScore } from '../../src/utils/stats-diet-language'

describe('stats diet language', () => {
  it('replaces cached medical-sounding server titles with diet-only wording', () => {
    expect(dietFocusTitle('hypertension', '血压管理友好度')).toBe('餐次与能量分布')
    expect(dietFocusTitle('diabetes', '血糖稳定友好度')).toBe('碳水搭配表现')
    expect(dietFocusTitle('cardio', '心血管友好度')).toBe('控油饮食表现')
    expect(dietFocusTitle('weight', '体重管理友好度')).toBe('能量平衡表现')
    expect(dietFocusShort('hypertension', '血压')).toBe('餐次分布')
  })

  it('keeps user-created diet focus wording unchanged', () => {
    expect(dietFocusTitle('custom:abc', '少盐饮食')).toBe('少盐饮食')
    expect(dietFocusShort('custom:abc', '少盐')).toBe('少盐')
  })

  it('does not present a user-created focus as a numeric health score', () => {
    expect(shouldShowDietScore(true)).toBe(false)
    expect(shouldShowDietScore(false)).toBe(true)
  })
})
