import {
  convertApiFoodItemsToNutritionItems,
  normalizeItemNutrients,
} from '../../src/packageExtra/pages/result/result-item-converter'
import {
  buildCorrectionItemsPayload,
  buildCorrectionPreviousResultItems,
} from '../../src/packageExtra/pages/result/correction-payload'
import { buildFoodRecordItemPayloadFromResultItem } from '../../src/utils/food-record-item-payload'
import type { FoodItem, Nutrients } from '../../src/utils/api'

const baseNutrients = (overrides: Partial<Nutrients> = {}): Nutrients => ({
  calories: 178,
  protein: 1.2,
  carbs: 42,
  fat: 0,
  fiber: 0.6,
  sugar: 28,
  waterMl: 258,
  water_ml: 258,
  sodium_mg: 22,
  ...overrides,
})

describe('result item converter', () => {
  it('keeps actual intake at 100 percent while preserving AI ratio and packaged metadata', () => {
    const item: FoodItem = {
      itemId: 9,
      name: '喜之郎CiCi果粒爽橙汁饮料',
      type: 'packaged_food',
      category: '饮料',
      estimatedWeightGrams: 258,
      originalWeightGrams: 240,
      grossWeightGrams: 258,
      ediblePortionRatio: 100,
      ediblePortionReason: '包装净含量可见',
      ediblePortionSource: 'packaged_food_library',
      suggestedRatio: 60,
      suggestedRatioReason: '含糖饮料建议分次饮用',
      suggestedRatioSource: 'ai',
      waterMl: 258,
      nutrients: baseNutrients(),
      unit_nutrition_per_100g: baseNutrients({ calories: 69, waterMl: 100, water_ml: 100 }),
      nutrition_source: 'packaged_food_library',
      matched_food_id: 'nutrition:jelly-drink',
      packaged_food_id: 'packaged:cici-orange-258g',
      package_match_status: 'matched',
      package_match_confidence: 0.93,
      package_weight_source: 'packaged_food_library',
      package_weight_applied: true,
      package_weight_reason: '命中包装库净含量258g',
      packaged_candidates: [{ id: 'packaged:cici-orange-258g', net_weight_g: 258 }],
    }

    const [converted] = convertApiFoodItemsToNutritionItems([item])

    expect(converted).toMatchObject({
      id: 9,
      sourceItemId: 9,
      sourceName: '喜之郎CiCi果粒爽橙汁饮料',
      name: '喜之郎CiCi果粒爽橙汁饮料',
      weight: 258,
      originalWeight: 240,
      grossWeight: 258,
      ediblePortionRatio: 100,
      calorie: 178,
      ratio: 100,
      intake: 258,
      suggestedRatio: 60,
      suggestedRatioSource: 'ai',
      nutritionSource: 'packaged_food_library',
      matchedFoodId: 'nutrition:jelly-drink',
      packagedFoodId: 'packaged:cici-orange-258g',
      packageMatchStatus: 'matched',
      packageMatchConfidence: 0.93,
      packageWeightSource: 'packaged_food_library',
      packageWeightApplied: true,
      packageWeightReason: '命中包装库净含量258g',
      packagedCandidates: [{ id: 'packaged:cici-orange-258g', net_weight_g: 258 }],
      waterMl: 258,
      nutrients: expect.objectContaining({
        calories: 178,
        waterMl: 258,
        water_ml: 258,
      }),
    })
  })

  it('accepts snake_case AI ratio fields from persisted or compatibility payloads', () => {
    const item: FoodItem = {
      itemId: 3,
      name: '士力架花生夹心巧克力',
      estimatedWeightGrams: 70,
      originalWeightGrams: 70,
      suggested_ratio: 50,
      suggested_ratio_reason: '高糖零食建议半份',
      suggested_ratio_source: 'ai',
      nutrients: baseNutrients({ calories: 340, waterMl: 0, water_ml: 0 }),
      nutrition_source: 'packaged_food_library',
      packaged_food_id: 'packaged:snickers-70g',
      package_weight_source: 'packaged_food_library',
      package_weight_applied: true,
      packaged_candidates: [{ id: 'packaged:snickers-70g', net_weight_g: 70 }],
    }

    const [converted] = convertApiFoodItemsToNutritionItems([item])

    expect(converted).toMatchObject({
      ratio: 100,
      intake: 70,
      suggestedRatio: 50,
      suggestedRatioReason: '高糖零食建议半份',
      suggestedRatioSource: 'ai',
      packagedFoodId: 'packaged:snickers-70g',
      packageWeightSource: 'packaged_food_library',
      packageWeightApplied: true,
    })
  })

  it('accepts camelCase packaged metadata from compatibility payloads', () => {
    const item: FoodItem = {
      itemId: 7,
      name: '雀巢咖啡1+2奶香',
      type: 'packaged_food',
      estimatedWeightGrams: 105,
      originalWeightGrams: 105,
      suggestedRatio: 75,
      suggestedRatioSource: 'ai',
      nutrients: baseNutrients({ calories: 42.16, protein: 1.1, carbs: 8.6, fat: 0.7, waterMl: 0, water_ml: 0 }),
      nutritionSource: 'packaged_food_library',
      matchedFoodId: 'nutrition:coffee',
      packagedFoodId: 'packaged:nescafe-105g',
      packageMatchStatus: 'matched',
      packageMatchConfidence: 0.96,
      packageWeightSource: 'packaged_food_library',
      packageWeightApplied: true,
      packageWeightReason: '命中包装库净含量105g',
      packagedCandidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
    }

    const [converted] = convertApiFoodItemsToNutritionItems([item])

    expect(converted).toMatchObject({
      nutritionSource: 'packaged_food_library',
      matchedFoodId: 'nutrition:coffee',
      packagedFoodId: 'packaged:nescafe-105g',
      packageMatchStatus: 'matched',
      packageMatchConfidence: 0.96,
      packageWeightSource: 'packaged_food_library',
      packageWeightApplied: true,
      packageWeightReason: '命中包装库净含量105g',
      packagedCandidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
      ratio: 100,
      intake: 105,
      suggestedRatioSource: 'ai',
    })
  })

  it('preserves packaged metadata from API result through save and correction payloads', () => {
    const item: FoodItem = {
      itemId: 12,
      name: '雀巢咖啡1+2奶香',
      type: 'packaged_food',
      estimatedWeightGrams: 105,
      originalWeightGrams: 105,
      suggestedRatio: 75,
      suggestedRatioReason: '建议只喝四分之三包',
      suggestedRatioSource: 'ai',
      nutrients: baseNutrients({ calories: 42.16, protein: 1.1, carbs: 8.6, fat: 0.7, waterMl: 0, water_ml: 0 }),
      nutritionSource: 'packaged_food_library',
      matchedFoodId: 'nutrition:coffee',
      packagedFoodId: 'packaged:nescafe-105g',
      packageMatchStatus: 'matched',
      packageMatchConfidence: 0.96,
      packageWeightSource: 'packaged_food_library',
      packageWeightApplied: true,
      packageWeightReason: '命中包装库净含量105g',
      packagedCandidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
    }

    const [resultItem] = convertApiFoodItemsToNutritionItems([item])
    const savePayload = buildFoodRecordItemPayloadFromResultItem(resultItem, resultItem.nutrients)
    const previousItems = buildCorrectionPreviousResultItems([resultItem], (entry) => entry.nutrients)
    const correctedItem = {
      ...resultItem,
      name: '雀巢咖啡1+2奶香（半包）',
      weight: 52.5,
      calorie: 52.5,
      protein: 1,
      carbs: 10,
      fat: 1,
      nutrients: baseNutrients({ calories: 52.5, protein: 1, carbs: 10, fat: 1, waterMl: 0, water_ml: 0 }),
      nutritionEdited: true,
    }
    const correctionItems = buildCorrectionItemsPayload([correctedItem], [resultItem], (entry) => entry.nutrients)

    expect(savePayload).toMatchObject({
      name: '雀巢咖啡1+2奶香',
      weight: 105,
      ratio: 100,
      intake: 105,
      suggested_ratio: 75,
      suggested_ratio_source: 'ai',
      nutrition_source: 'packaged_food_library',
      matched_food_id: 'nutrition:coffee',
      packaged_food_id: 'packaged:nescafe-105g',
      package_match_status: 'matched',
      package_match_confidence: 0.96,
      package_weight_source: 'packaged_food_library',
      package_weight_applied: true,
      package_weight_reason: '命中包装库净含量105g',
      packaged_candidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
    })
    expect(previousItems[0]).toMatchObject({
      itemId: 12,
      suggestedRatio: 75,
      suggestedRatioSource: 'ai',
      nutrition_source: 'packaged_food_library',
      matched_food_id: 'nutrition:coffee',
      packaged_food_id: 'packaged:nescafe-105g',
      package_weight_source: 'packaged_food_library',
      package_weight_applied: true,
      packaged_candidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
    })
    expect(correctionItems[0]).toMatchObject({
      name: '雀巢咖啡1+2奶香（半包）',
      sourceName: '雀巢咖啡1+2奶香',
      sourceItemId: 12,
      weight: 52.5,
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

  it('normalizes missing nutrients and keeps both water aliases', () => {
    expect(normalizeItemNutrients(undefined, 120)).toMatchObject({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      waterMl: 120,
      water_ml: 120,
      sodium_mg: 0,
    })
  })

  it('caps impossible water values at estimated food weight', () => {
    const [converted] = convertApiFoodItemsToNutritionItems([{
      itemId: 21,
      name: '西瓜',
      estimatedWeightGrams: 1200,
      originalWeightGrams: 1200,
      waterMl: 1840,
      nutrients: baseNutrients({ calories: 360, carbs: 91.2, waterMl: 1840, water_ml: 1840 }),
    }])

    expect(converted.waterMl).toBe(1200)
    expect(converted.nutrients.waterMl).toBe(1200)
    expect(converted.nutrients.water_ml).toBe(1200)
  })
})
