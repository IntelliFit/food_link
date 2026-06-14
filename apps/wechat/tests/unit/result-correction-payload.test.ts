import {
  buildCorrectionItemsPayload,
  buildCorrectionPreviousResultItems,
  formatCorrectionWeight,
  hasCorrectionWeightChanged,
  normalizeCorrectionWeight,
  normalizeFoodNameForCorrection,
  type ResultCorrectionItem,
} from '../../src/packageExtra/pages/result/correction-payload'
import type { Nutrients } from '../../src/utils/api'

const makeNutrients = (overrides: Partial<Nutrients> = {}): Nutrients => ({
  calories: 42.16,
  protein: 1.1,
  carbs: 8.6,
  fat: 0.7,
  fiber: 0,
  sugar: 0,
  waterMl: 0,
  water_ml: 0,
  sodium_mg: 12,
  ...overrides,
})

const buildNutrients = (item: ResultCorrectionItem) => item.nutrients

describe('result correction payload helpers', () => {
  it('preserves packaged resolution fields in previousResult items', () => {
    const item: ResultCorrectionItem = {
      id: 11,
      sourceItemId: 7,
      name: '雀巢咖啡1+2奶香',
      weight: 105,
      originalWeight: 105,
      calorie: 42.16,
      protein: 1.1,
      carbs: 8.6,
      fat: 0.7,
      waterMl: 0,
      nutrients: makeNutrients(),
      suggestedRatio: 75,
      suggestedRatioReason: '建议只喝四分之三包',
      suggestedRatioSource: 'ai',
      nutritionSource: 'packaged_food_library',
      matchedFoodId: 'nutrition:coffee',
      packagedFoodId: 'packaged:nescafe-105g',
      packageMatchStatus: 'matched',
      packageMatchConfidence: 0.96,
      packageWeightSource: 'packaged_food_library',
      packageWeightApplied: true,
      packageWeightReason: '命中净含量105g',
      packagedCandidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
    }

    const previousItems = buildCorrectionPreviousResultItems([item], buildNutrients)

    expect(previousItems[0]).toMatchObject({
      itemId: 7,
      name: '雀巢咖啡1+2奶香',
      estimatedWeightGrams: 105,
      originalWeightGrams: 105,
      suggestedRatio: 75,
      suggestedRatioReason: '建议只喝四分之三包',
      suggestedRatioSource: 'ai',
      nutrition_source: 'packaged_food_library',
      matched_food_id: 'nutrition:coffee',
      packaged_food_id: 'packaged:nescafe-105g',
      package_match_status: 'matched',
      package_match_confidence: 0.96,
      package_weight_source: 'packaged_food_library',
      package_weight_applied: true,
      package_weight_reason: '命中净含量105g',
      packaged_candidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
      nutrients: expect.objectContaining({
        calories: 42.16,
        sodium_mg: 12,
      }),
    })
  })

  it('keeps decimal user correction weight and nutrition edit flags', () => {
    const baseline: ResultCorrectionItem = {
      id: 11,
      sourceItemId: 7,
      name: '雀巢咖啡1+2奶香',
      weight: 105,
      originalWeight: 105,
      calorie: 42.16,
      protein: 1.1,
      carbs: 8.6,
      fat: 0.7,
      waterMl: 0,
      nutrients: makeNutrients(),
      nutritionSource: 'packaged_food_library',
      packageWeightSource: 'packaged_food_library',
      packageWeightApplied: true,
    }
    const corrected: ResultCorrectionItem = {
      ...baseline,
      name: '雀巢咖啡1+2奶香（半包）',
      weight: 52.5,
      calorie: 52.5,
      protein: 1,
      carbs: 10,
      fat: 1,
      nutrients: makeNutrients({
        calories: 52.5,
        protein: 1,
        carbs: 10,
        fat: 1,
      }),
      nutritionEdited: true,
    }

    const payload = buildCorrectionItemsPayload([corrected], [baseline], buildNutrients)

    expect(payload[0]).toMatchObject({
      name: '雀巢咖啡1+2奶香（半包）',
      weight: 52.5,
      sourceName: '雀巢咖啡1+2奶香',
      sourceItemId: 7,
      nameEdited: true,
      weightEdited: true,
      nutritionEdited: true,
      nutrients: expect.objectContaining({
        calories: 52.5,
        protein: 1,
        carbs: 10,
        fat: 1,
      }),
    })
  })

  it('normalizes names and weights without integer rounding', () => {
    expect(normalizeFoodNameForCorrection(' 雀巢咖啡1+2奶香（半包） ')).toBe('雀巢咖啡1+2奶香半包')
    expect(normalizeCorrectionWeight(52.555)).toBe(52.56)
    expect(formatCorrectionWeight(52.5)).toBe('52.5')
    expect(hasCorrectionWeightChanged(52.5, 52.51)).toBe(false)
    expect(hasCorrectionWeightChanged(52.5, 53)).toBe(true)
  })
})
