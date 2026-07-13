import type { FoodItem, FoodRecordEntryType, FoodRecordItemPayload, Nutrients, SaveFoodRecordRequest, AnalysisTask, MealType } from './types'

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

export const buildFoodRecordNutrients = (
  nutrients: Partial<Nutrients> | undefined,
  waterMl: number,
): Nutrients => ({
  ...(nutrients || {}),
  calories: normalizeFoodRecordNumber(nutrients?.calories),
  protein: normalizeFoodRecordNumber(nutrients?.protein),
  carbs: normalizeFoodRecordNumber(nutrients?.carbs),
  fat: normalizeFoodRecordNumber(nutrients?.fat),
  fiber: normalizeFoodRecordNumber(nutrients?.fiber),
  sugar: normalizeFoodRecordNumber(nutrients?.sugar),
  waterMl,
  water_ml: waterMl,
  sodium_mg: normalizeFoodRecordNumber(nutrients?.sodium_mg ?? nutrients?.sodiumMg),
})

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
  const waterMl = clampFoodRecordWaterMl(
    firstDefined(item.water_ml, item.waterMl, nutrients.water_ml, nutrients.waterMl),
    weight,
  )
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
    nutrients: {
      ...nutrients,
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

export function buildSaveFoodRecordRequestFromTask(
  task: AnalysisTask,
  options: {
    mealType: MealType
    date?: string
    entryType?: FoodRecordEntryType
  },
): SaveFoodRecordRequest {
  const result = task.result || {}
  const items = Array.isArray(result.items)
    ? result.items.map((item) => buildFoodRecordItemPayloadFromAnalyzeItem(item))
    : []

  const sum = (key: keyof Nutrients): number => (
    items.reduce((total, item) => total + normalizeFoodRecordNumber(item.nutrients[key]), 0)
  )

  return {
    meal_type: options.mealType,
    image_path: task.image_url || undefined,
    image_paths: task.image_paths || undefined,
    description: typeof result.description === 'string' ? result.description : undefined,
    insight: typeof result.insight === 'string' ? result.insight : undefined,
    items,
    total_calories: normalizeFoodRecordNumber(result.total_calories ?? sum('calories')),
    total_protein: normalizeFoodRecordNumber(result.total_protein ?? sum('protein')),
    total_carbs: normalizeFoodRecordNumber(result.total_carbs ?? sum('carbs')),
    total_fat: normalizeFoodRecordNumber(result.total_fat ?? sum('fat')),
    total_weight_grams: normalizeFoodRecordNumber(
      result.total_weight_grams ?? items.reduce((total, item) => total + item.weight, 0),
    ),
    source_task_id: task.id,
    entry_type: options.entryType || 'analyze_history',
    date: options.date,
  }
}
