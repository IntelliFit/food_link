import { resultRatioAdvice } from '../../src/packageExtra/pages/result/ratio-advice'
import { convertApiFoodItemsToNutritionItems } from '../../src/packageExtra/pages/result/result-item-converter'

const items = convertApiFoodItemsToNutritionItems([{
  name: '米饭', estimatedWeightGrams: 200, originalWeightGrams: 200,
  nutrients: { calories: 260, protein: 5, carbs: 56, fat: 1, fiber: 0, sugar: 0 },
}])

describe('result AI ratio status', () => {
  it.each(['', 'not_needed', 'no_items'])('does not present absent AI suggestions as a recommendation: %s', (status) => {
    expect(resultRatioAdvice(status, items)).toContain('未生成单项 AI 比例建议')
    expect(resultRatioAdvice(status, items)).not.toContain('无需')
  })
  it.each(['fallback', 'unavailable', 'empty'])('shows suggestion failures truthfully: %s', (status) => {
    expect(resultRatioAdvice(status, items)).toContain('暂不可用')
  })
  it('keeps actual intake separate from AI recommendations until the user applies one', () => {
    const suggested = [{ ...items[0], suggestedRatio: 60, suggestedRatioSource: 'ai' }]
    expect(resultRatioAdvice('applied', suggested)).toContain('米饭建议 60%')
    expect(resultRatioAdvice('applied', suggested)).toContain('应用建议')
    expect(suggested[0].ratio).toBe(100)
  })
  it('does not hide a disabled switch', () => {
    expect(resultRatioAdvice('disabled', items)).toContain('未开启')
  })

  it('does not call a partially successful suggestion a whole-meal recommendation', () => {
    const partial = [
      { ...items[0], suggestedRatio: 100, suggestedRatioSource: 'ai' },
      { ...items[0], id: 2, name: '鸡肉', suggestedRatio: 100, suggestedRatioSource: 'fallback' },
    ]
    expect(resultRatioAdvice('applied', partial)).not.toContain('AI 建议按整份安排')
    expect(resultRatioAdvice('applied', partial)).toContain('未生成单项 AI 比例建议')
  })
})
