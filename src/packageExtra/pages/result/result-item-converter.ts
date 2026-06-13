import type { FoodItem, Nutrients } from '../../../utils/api'

export interface NutritionItem {
  id: number
  sourceItemId?: number
  sourceName?: string
  name: string
  weight: number
  originalWeight: number
  grossWeight: number
  ediblePortionRatio: number
  ediblePortionReason?: string
  ediblePortionSource?: string
  calorie: number
  intake: number
  ratio: number
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
  packageWeightSource?: string
  packageWeightApplied?: boolean
  packageWeightReason?: string
  matchedFoodId?: string | null
  packagedFoodId?: string
  packageMatchStatus?: string
  packageMatchConfidence?: number
  packagedCandidates?: Array<Record<string, unknown>>
  packagedPending?: boolean
  itemType?: string
  category?: string
  nutritionSource?: string | null
  nutritionSourceCategory?: string | null
  isUnresolved?: boolean
  unitNutritionPer100g?: Nutrients
  nutritionEdited?: boolean
  protein: number
  carbs: number
  fat: number
  waterMl: number
  nutrients: Nutrients
}

const normalizeNutrientValue = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

export const normalizeItemNutrients = (nutrients: FoodItem['nutrients'] | undefined, waterMl: number): Nutrients => ({
  calories: normalizeNutrientValue(nutrients?.calories),
  protein: normalizeNutrientValue(nutrients?.protein),
  carbs: normalizeNutrientValue(nutrients?.carbs),
  fat: normalizeNutrientValue(nutrients?.fat),
  fiber: normalizeNutrientValue(nutrients?.fiber),
  sugar: normalizeNutrientValue(nutrients?.sugar),
  waterMl,
  water_ml: waterMl,
  saturatedFat: normalizeNutrientValue(nutrients?.saturatedFat),
  cholesterolMg: normalizeNutrientValue(nutrients?.cholesterolMg),
  sodiumMg: normalizeNutrientValue(nutrients?.sodiumMg),
  sodium_mg: normalizeNutrientValue(nutrients?.sodiumMg ?? nutrients?.sodium_mg),
  potassiumMg: normalizeNutrientValue(nutrients?.potassiumMg),
  calciumMg: normalizeNutrientValue(nutrients?.calciumMg),
  ironMg: normalizeNutrientValue(nutrients?.ironMg),
  magnesiumMg: normalizeNutrientValue(nutrients?.magnesiumMg),
  zincMg: normalizeNutrientValue(nutrients?.zincMg),
  vitaminARaeMcg: normalizeNutrientValue(nutrients?.vitaminARaeMcg),
  vitaminCMg: normalizeNutrientValue(nutrients?.vitaminCMg),
  vitaminDMcg: normalizeNutrientValue(nutrients?.vitaminDMcg),
  vitaminEMg: normalizeNutrientValue(nutrients?.vitaminEMg),
  vitaminKMcg: normalizeNutrientValue(nutrients?.vitaminKMcg),
  thiaminMg: normalizeNutrientValue(nutrients?.thiaminMg),
  riboflavinMg: normalizeNutrientValue(nutrients?.riboflavinMg),
  niacinMg: normalizeNutrientValue(nutrients?.niacinMg),
  vitaminB6Mg: normalizeNutrientValue(nutrients?.vitaminB6Mg),
  folateMcg: normalizeNutrientValue(nutrients?.folateMcg),
  vitaminB12Mcg: normalizeNutrientValue(nutrients?.vitaminB12Mcg)
})

const normalizeWaterMl = (...values: unknown[]) => {
  for (const value of values) {
    const num = Number(value)
    if (Number.isFinite(num) && num > 0) {
      return Math.round(num)
    }
  }
  return 0
}

const isPackagedCandidatePending = (
  status: unknown,
  weightApplied: unknown,
  candidates: unknown
) => {
  const normalizedStatus = String(status || '').trim().toLowerCase()
  const hasCandidates = Array.isArray(candidates) && candidates.length > 0
  const applied = weightApplied === true
  return hasCandidates && !applied && (
    normalizedStatus === 'packaged_needs_confirmation' ||
    normalizedStatus === 'multiple_candidates'
  )
}

export const convertApiFoodItemsToNutritionItems = (items: FoodItem[]): NutritionItem[] => (
  items.map((item, index) => {
    const grossWeightRaw = item.grossWeightGrams ?? item.gross_weight_grams ?? item.originalWeightGrams ?? item.estimatedWeightGrams
    const grossWeight = Math.max(0, Math.round(grossWeightRaw || 0))
    const edibleRatioRaw = item.ediblePortionRatio ?? item.edible_portion_ratio
    const ediblePortionRatio = Math.max(1, Math.min(100, Math.round(
      edibleRatioRaw || (grossWeight > 0 ? (item.estimatedWeightGrams / grossWeight) * 100 : 100)
    )))
    const aiWeight = item.originalWeightGrams ?? item.estimatedWeightGrams
    const itemId = item.itemId ?? (index + 1)
    const waterMl = normalizeWaterMl(item.waterMl, item.water_ml, item.nutrients?.waterMl, item.nutrients?.water_ml)
    const nutrients = normalizeItemNutrients(item.nutrients, waterMl)
    const suggestedRatio = Math.max(0, Math.min(100, Math.round(item.suggestedRatio ?? item.suggested_ratio ?? 100)))
    const actualRatio = 100
    const intake = Math.round(item.estimatedWeightGrams * (actualRatio / 100))
    const packageMatchStatus = item.package_match_status ?? item.packageMatchStatus
    const packageWeightApplied = item.package_weight_applied ?? item.packageWeightApplied
    const packagedCandidates = item.packaged_candidates ?? item.packagedCandidates
    const packagedPending = isPackagedCandidatePending(packageMatchStatus, packageWeightApplied, packagedCandidates)

    return {
      id: itemId,
      sourceItemId: itemId,
      sourceName: item.name,
      name: item.name,
      weight: item.estimatedWeightGrams,
      originalWeight: aiWeight,
      grossWeight,
      ediblePortionRatio,
      ediblePortionReason: item.ediblePortionReason ?? item.edible_portion_reason,
      ediblePortionSource: item.ediblePortionSource ?? item.edible_portion_source,
      calorie: nutrients.calories,
      intake,
      ratio: actualRatio,
      suggestedRatio,
      suggestedRatioReason: item.suggestedRatioReason ?? item.suggested_ratio_reason,
      suggestedRatioSource: item.suggestedRatioSource ?? item.suggested_ratio_source,
      packageWeightSource: item.package_weight_source ?? item.packageWeightSource,
      packageWeightApplied,
      packageWeightReason: item.package_weight_reason ?? item.packageWeightReason,
      matchedFoodId: item.matched_food_id ?? item.matchedFoodId,
      packagedFoodId: item.packaged_food_id ?? item.packagedFoodId,
      packageMatchStatus,
      packageMatchConfidence: item.package_match_confidence ?? item.packageMatchConfidence,
      packagedCandidates,
      packagedPending,
      itemType: item.type || item.food_type,
      category: item.category,
      nutritionSource: item.nutrition_source ?? item.nutritionSource,
      nutritionSourceCategory: item.nutrition_source_category ?? item.nutritionSourceCategory,
      isUnresolved: Boolean(item.is_unresolved),
      unitNutritionPer100g: item.unit_nutrition_per_100g,
      protein: nutrients.protein,
      carbs: nutrients.carbs,
      fat: nutrients.fat,
      waterMl,
      nutrients
    }
  })
)
