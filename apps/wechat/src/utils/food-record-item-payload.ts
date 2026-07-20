import type { FoodItem, FoodRecordItemPayload, Nutrients } from './api'

type PackagedAnalysisMetaSource = {
  name?: string
  grossWeight?: number
  grossWeightGrams?: number
  gross_weight_grams?: number
  ediblePortionRatio?: number
  edible_portion_ratio?: number
  ediblePortionReason?: string
  edible_portion_reason?: string
  ediblePortionSource?: string
  edible_portion_source?: string
  suggestedRatio?: number
  suggested_ratio?: number
  suggestedRatioReason?: string
  suggested_ratio_reason?: string
  suggestedRatioSource?: string
  suggested_ratio_source?: string
  waterMl?: number
  water_ml?: number
  nutritionSource?: string | null
  nutrition_source?: string | null
  nutritionSourceCategory?: string | null
  nutrition_source_category?: string | null
  matchedFoodId?: string | null
  matched_food_id?: string | null
  packagedFoodId?: string
  packaged_food_id?: string
  packageMatchStatus?: string
  package_match_status?: string
  packageMatchConfidence?: number
  package_match_confidence?: number
  packageWeightSource?: string
  package_weight_source?: string
  packageWeightApplied?: boolean
  package_weight_applied?: boolean
  packageWeightReason?: string
  package_weight_reason?: string
  packagedCandidates?: Array<Record<string, unknown>>
  packaged_candidates?: Array<Record<string, unknown>>
  manual_source?: 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom' | null
  manualSource?: 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom' | null
  manual_source_id?: string | null
  manualSourceId?: string | null
  manual_source_title?: string | null
  manualSourceTitle?: string | null
}

type ResultRecordItemSource = PackagedAnalysisMetaSource & {
  name: string
  weight: number
  ratio: number
  intake: number
}

const firstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => (
  values.find((value) => value !== undefined && value !== null) as T | undefined
)

export const normalizeFoodRecordNumber = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const macroCalories = (protein: number, carbs: number, fat: number): number => (
  Math.max(0, protein) * 4 + Math.max(0, carbs) * 4 + Math.max(0, fat) * 9
)

export const buildFoodRecordNutrients = (
  nutrients: Partial<Nutrients> | undefined,
  waterMl: number,
): Nutrients => {
  const protein = normalizeFoodRecordNumber(nutrients?.protein)
  const carbs = normalizeFoodRecordNumber(nutrients?.carbs)
  const fat = normalizeFoodRecordNumber(nutrients?.fat)
  return {
  ...(nutrients || {}),
  calories: macroCalories(protein, carbs, fat),
  protein,
  carbs,
  fat,
  fiber: normalizeFoodRecordNumber(nutrients?.fiber),
  sugar: normalizeFoodRecordNumber(nutrients?.sugar),
  waterMl,
  water_ml: waterMl,
  sodium_mg: normalizeFoodRecordNumber(nutrients?.sodium_mg ?? nutrients?.sodiumMg),
  }
}

const clampFoodRecordWaterMl = (value: unknown, maxWeight: number): number => {
  const waterMl = normalizeFoodRecordNumber(value)
  if (waterMl <= 0) return 0
  if (maxWeight <= 0) return waterMl
  return Math.min(waterMl, maxWeight)
}

export const buildFoodRecordItemPayloadFromResultItem = <T extends ResultRecordItemSource>(
  item: T,
  nutrients: Nutrients,
): FoodRecordItemPayload => {
  const weight = normalizeFoodRecordNumber(item.weight)
  let ratio = normalizeFoodRecordNumber(item.ratio)
  let intake = normalizeFoodRecordNumber(item.intake)
  if (ratio > 100) ratio = 100
  if (ratio < 0) ratio = 0
  if (intake > weight) intake = weight
  if (intake < 0) intake = 0

  const nutritionSource = String(firstDefined(item.nutrition_source, item.nutritionSource) || '')
  const nutritionSourceCategory = String(firstDefined(item.nutrition_source_category, item.nutritionSourceCategory) || '')
  const packagedFoodId = String(firstDefined(item.packaged_food_id, item.packagedFoodId) || '')
  const matchedFoodId = String(firstDefined(item.matched_food_id, item.matchedFoodId) || '')
  const existingManualSource = firstDefined(item.manual_source, item.manualSource) as FoodRecordItemPayload['manual_source']
  const existingManualSourceId = firstDefined(item.manual_source_id, item.manualSourceId)
  const existingManualSourceTitle = firstDefined(item.manual_source_title, item.manualSourceTitle)
  const waterMl = clampFoodRecordWaterMl(
    firstDefined(item.water_ml, item.waterMl, nutrients.water_ml, nutrients.waterMl),
    weight,
  )

  let manualSource: FoodRecordItemPayload['manual_source'] = existingManualSource
  let manualSourceId: string | undefined = existingManualSourceId
  let manualSourceTitle: string | undefined = existingManualSourceTitle

  if (!manualSource) {
    if (packagedFoodId || nutritionSource.toLowerCase().includes('packaged')) {
      manualSource = 'packaged_food'
      manualSourceId = manualSourceId || packagedFoodId || undefined
    } else if (matchedFoodId || (nutritionSourceCategory === 'database' && nutritionSource.toLowerCase().includes('library'))) {
      manualSource = 'nutrition_library'
      manualSourceId = manualSourceId || matchedFoodId || undefined
    }
  }
  if (manualSource && !manualSourceTitle) {
    manualSourceTitle = item.name
  }

  return {
    name: item.name || '未命名食物',
    weight,
    ratio,
    intake,
    gross_weight_grams: firstDefined(item.gross_weight_grams, item.grossWeight, item.grossWeightGrams),
    edible_portion_ratio: firstDefined(item.edible_portion_ratio, item.ediblePortionRatio),
    edible_portion_reason: firstDefined(item.edible_portion_reason, item.ediblePortionReason),
    edible_portion_source: firstDefined(item.edible_portion_source, item.ediblePortionSource),
    suggested_ratio: firstDefined(item.suggested_ratio, item.suggestedRatio),
    suggested_ratio_reason: firstDefined(item.suggested_ratio_reason, item.suggestedRatioReason),
    suggested_ratio_source: firstDefined(item.suggested_ratio_source, item.suggestedRatioSource),
    water_ml: waterMl,
    nutrition_source: firstDefined(item.nutrition_source, item.nutritionSource),
    nutrition_source_category: firstDefined(item.nutrition_source_category, item.nutritionSourceCategory),
    matched_food_id: firstDefined(item.matched_food_id, item.matchedFoodId),
    packaged_food_id: firstDefined(item.packaged_food_id, item.packagedFoodId),
    package_match_status: firstDefined(item.package_match_status, item.packageMatchStatus),
    package_match_confidence: firstDefined(item.package_match_confidence, item.packageMatchConfidence),
    package_weight_source: firstDefined(item.package_weight_source, item.packageWeightSource),
    package_weight_applied: firstDefined(item.package_weight_applied, item.packageWeightApplied),
    package_weight_reason: firstDefined(item.package_weight_reason, item.packageWeightReason),
    packaged_candidates: firstDefined(item.packaged_candidates, item.packagedCandidates),
    manual_source: manualSource,
    manual_source_id: manualSourceId,
    manual_source_title: manualSourceTitle,
    nutrients: {
      ...buildFoodRecordNutrients(nutrients, waterMl),
      waterMl,
      water_ml: waterMl,
    },
  }
}

export const buildFoodRecordItemPayloadFromAnalyzeItem = (item: FoodItem): FoodRecordItemPayload => {
  const weight = normalizeFoodRecordNumber(item.estimatedWeightGrams || item.originalWeightGrams)
  const ratio = 100
  const waterMl = normalizeFoodRecordNumber(item.water_ml ?? item.waterMl ?? item.nutrients?.water_ml ?? item.nutrients?.waterMl)

  return buildFoodRecordItemPayloadFromResultItem(
    {
      ...item,
      weight,
      ratio,
      intake: weight * ratio / 100,
    },
    buildFoodRecordNutrients(item.nutrients, waterMl),
  )
}
