import { libraryItemToAnalyzeItem } from '../../src/utils/food-library-picker'
import { convertApiFoodItemsToNutritionItems } from '../../src/packageExtra/pages/result/result-item-converter'
import { getResultRecordError } from '../../src/packageExtra/pages/result/record-validation'
import type { FoodItem, FoodRecordItemPayload } from '../../src/utils/api'

const AMOUNT_ERROR = '食物份量未能正确解析，请重新分析或补充重量'

const bun = { name: '素包子', weight: 90, calorie: 198, protein: 5.4, carbs: 34.2, fat: 4.5 }

const milkPayload: FoodRecordItemPayload = {
  name: '三元 极致有机纯牛奶 250ml', weight: 0, intake: 0, ratio: 100, manual_source: 'packaged_food', manual_source_id: 'milk',
  nutrients: { calories: 196, protein: 9.5, carbs: 13.75, fat: 11.5, fiber: 0, sugar: 0, sodium_mg: 0 },
  measurement: { amount: 250, unit: 'ml', basis_amount: 100, basis_unit: 'ml', nutrients_per_basis: { calories: 78.4, protein: 3.8, carbs: 5.5, fat: 4.6 } },
}

const piecePayload: FoodRecordItemPayload = {
  name: '自制点心', weight: 0, intake: 0, ratio: 100, manual_source: 'custom', manual_source_id: 'custom-food',
  nutrients: { calories: 160, protein: 6, carbs: 20, fat: 5, fiber: 1, sugar: 0, sodium_mg: 20 },
  measurement: { amount: 2, unit: 'piece', basis_amount: 1, basis_unit: 'piece', nutrients_per_basis: { calories: 80, protein: 3, carbs: 10, fat: 2.5 } },
}

const picked = (payload: FoodRecordItemPayload) => convertApiFoodItemsToNutritionItems([libraryItemToAnalyzeItem(payload, 5)])[0]

describe('result page record validation', () => {
  it('accepts a food weighed in grams', () => {
    expect(getResultRecordError([bun])).toBe('')
  })

  it('accepts a library food measured in millilitres, which has no gram weight', () => {
    const milk = picked(milkPayload)
    expect(milk.weight).toBe(0)
    expect(getResultRecordError([bun, milk])).toBe('')
  })

  it('accepts a food counted in pieces without a gram conversion', () => {
    expect(getResultRecordError([picked(piecePayload)])).toBe('')
  })

  it('accepts the corrected meal the backend returns for an added millilitre food', () => {
    const returned: FoodItem[] = [
      { itemId: 1, name: '素包子', estimatedWeightGrams: 90, originalWeightGrams: 90, nutrients: { calories: 198, protein: 5.4, carbs: 34.2, fat: 4.5, fiber: 1, sugar: 0 } },
      { itemId: 2, name: milkPayload.name, estimatedWeightGrams: 0, originalWeightGrams: 0, nutrients: milkPayload.nutrients, measurement: milkPayload.measurement },
    ] as FoodItem[]
    expect(getResultRecordError(convertApiFoodItemsToNutritionItems(returned))).toBe('')
  })

  it('still rejects a food with neither grams nor a valid measurement', () => {
    expect(getResultRecordError([{ ...bun, weight: 0 }])).toBe(AMOUNT_ERROR)
    expect(getResultRecordError([{ ...bun, weight: 0, measurement: { ...milkPayload.measurement, amount: 0 } }])).toBe(AMOUNT_ERROR)
    expect(getResultRecordError([{ ...bun, weight: 0, measurement: { amount: 250, unit: 'ml' } }])).toBe(AMOUNT_ERROR)
    expect(getResultRecordError([{ ...bun, weight: Number.NaN }])).toBe(AMOUNT_ERROR)
  })

  it('still rejects an unnamed or unknown food even when it is measured', () => {
    expect(getResultRecordError([{ ...picked(milkPayload), name: '未知食物' }])).toBe(AMOUNT_ERROR)
    expect(getResultRecordError([{ ...picked(milkPayload), name: '  ' }])).toBe(AMOUNT_ERROR)
  })

  it('still requires energy for a measured food that is not a zero-energy drink', () => {
    const milk = picked(milkPayload)
    expect(getResultRecordError([{ ...milk, calorie: 0 }])).toBe('食物营养未能正确分析，请重新分析')
    expect(getResultRecordError([{ ...milk, name: '矿泉水', calorie: 0 }])).toBe('')
  })

  it('rejects an empty meal', () => {
    expect(getResultRecordError([])).toBe('没有可记录的食物，请重新分析')
  })
})
