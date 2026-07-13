import {
  buildFoodRecordItemPayloadFromAnalyzeItem,
  buildFoodRecordItemPayloadFromResultItem,
  buildFoodRecordNutrients,
} from '../../src/utils/food-record-item-payload'
import type { FoodItem, Nutrients } from '../../src/utils/api'

const baseNutrients = (overrides: Partial<Nutrients> = {}): Nutrients => ({
  calories: 120,
  protein: 3,
  carbs: 20,
  fat: 4,
  fiber: 1,
  sugar: 6,
  waterMl: 10,
  water_ml: 10,
  sodium_mg: 30,
  ...overrides,
})

describe('food record item payload helpers', () => {
  it('preserves packaged metadata when saving from result page items', () => {
    const payload = buildFoodRecordItemPayloadFromResultItem(
      {
        name: '雀巢咖啡1+2奶香',
        weight: 52.5,
        ratio: 75,
        intake: 39.375,
        grossWeight: 105,
        ediblePortionRatio: 1,
        ediblePortionReason: '完整包装',
        ediblePortionSource: 'vision',
        suggestedRatio: 75,
        suggestedRatioReason: '建议少喝一些',
        suggestedRatioSource: 'ai',
        waterMl: 0,
        nutritionSource: 'packaged_food_library',
        matchedFoodId: 'nutrition:coffee',
        packagedFoodId: 'packaged:nescafe-105g',
        packageMatchStatus: 'matched',
        packageMatchConfidence: 0.96,
        packageWeightSource: 'packaged_food_library',
        packageWeightApplied: true,
        packageWeightReason: '命中包装库净含量105g',
        packagedCandidates: [{ id: 'packaged:nescafe-105g', net_weight_g: 105 }],
      },
      baseNutrients({ calories: 52.5 }),
    )

    expect(payload).toMatchObject({
      name: '雀巢咖啡1+2奶香',
      weight: 52.5,
      ratio: 75,
      intake: 39.375,
      gross_weight_grams: 105,
      edible_portion_ratio: 1,
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
      nutrients: expect.objectContaining({ calories: 52.5 }),
    })
  })

  it('preserves packaged metadata when quick-saving analyze history items', () => {
    const item: FoodItem = {
      name: '喜之郎CiCi果粒爽橙汁饮料',
      estimatedWeightGrams: 258,
      originalWeightGrams: 240,
      suggestedRatio: 80,
      suggestedRatioReason: '建议留一点',
      suggestedRatioSource: 'ai',
      waterMl: 258,
      nutrients: baseNutrients({ calories: 178, waterMl: 258, water_ml: 258 }),
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

    const payload = buildFoodRecordItemPayloadFromAnalyzeItem(item)

    expect(payload).toMatchObject({
      name: '喜之郎CiCi果粒爽橙汁饮料',
      weight: 258,
      ratio: 100,
      intake: 258,
      suggested_ratio: 80,
      suggested_ratio_source: 'ai',
      water_ml: 258,
      nutrition_source: 'packaged_food_library',
      packaged_food_id: 'packaged:cici-orange-258g',
      package_weight_source: 'packaged_food_library',
      package_weight_applied: true,
      packaged_candidates: [{ id: 'packaged:cici-orange-258g', net_weight_g: 258 }],
      nutrients: expect.objectContaining({
        calories: 178,
        water_ml: 258,
      }),
    })
  })

  it('preserves snake_case packaged metadata when editing an existing food record item', () => {
    const payload = buildFoodRecordItemPayloadFromResultItem(
      {
        name: '士力架花生夹心巧克力',
        weight: 70,
        ratio: 50,
        intake: 35,
        gross_weight_grams: 70,
        edible_portion_ratio: 1,
        edible_portion_reason: '完整包装',
        edible_portion_source: 'packaged_food_library',
        suggested_ratio: 50,
        suggested_ratio_reason: '高糖零食建议半份',
        suggested_ratio_source: 'ai',
        water_ml: 0,
        nutrition_source: 'packaged_food_library',
        matched_food_id: 'nutrition:snickers',
        packaged_food_id: 'packaged:snickers-70g',
        package_match_status: 'matched',
        package_match_confidence: 0.98,
        package_weight_source: 'packaged_food_library',
        package_weight_applied: true,
        package_weight_reason: '命中包装库2条装净含量70g',
        packaged_candidates: [{ id: 'packaged:snickers-70g', net_weight_g: 70 }],
      },
      baseNutrients({ calories: 170.5 }),
    )

    expect(payload).toMatchObject({
      name: '士力架花生夹心巧克力',
      weight: 70,
      ratio: 50,
      intake: 35,
      gross_weight_grams: 70,
      edible_portion_ratio: 1,
      edible_portion_source: 'packaged_food_library',
      suggested_ratio: 50,
      suggested_ratio_source: 'ai',
      water_ml: 0,
      nutrition_source: 'packaged_food_library',
      matched_food_id: 'nutrition:snickers',
      packaged_food_id: 'packaged:snickers-70g',
      package_match_status: 'matched',
      package_match_confidence: 0.98,
      package_weight_source: 'packaged_food_library',
      package_weight_applied: true,
      package_weight_reason: '命中包装库2条装净含量70g',
      packaged_candidates: [{ id: 'packaged:snickers-70g', net_weight_g: 70 }],
      nutrients: expect.objectContaining({ calories: 170.5 }),
    })
  })

  it('normalizes missing nutrients without dropping water aliases', () => {
    expect(buildFoodRecordNutrients({ calories: 10 }, 120)).toMatchObject({
      calories: 10,
      protein: 0,
      carbs: 0,
      fat: 0,
      waterMl: 120,
      water_ml: 120,
      sodium_mg: 0,
    })
  })

  it('caps saved water at the item weight', () => {
    const payload = buildFoodRecordItemPayloadFromResultItem(
      {
        name: '西瓜',
        weight: 1200,
        ratio: 100,
        intake: 1200,
        waterMl: 1840,
      },
      baseNutrients({ calories: 360, carbs: 91.2, waterMl: 1840, water_ml: 1840 }),
    )

    expect(payload.water_ml).toBe(1200)
    expect(payload.nutrients.waterMl).toBe(1200)
    expect(payload.nutrients.water_ml).toBe(1200)
  })
})
