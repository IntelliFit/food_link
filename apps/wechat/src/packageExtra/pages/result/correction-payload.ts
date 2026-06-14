import type { AnalyzeTaskSubmitParams, FoodItem, Nutrients } from '../../../utils/api'

export interface ResultCorrectionItem {
  id: number
  sourceItemId?: number
  sourceName?: string
  name: string
  weight: number
  originalWeight: number
  calorie: number
  protein: number
  carbs: number
  fat: number
  waterMl: number
  nutrients: Nutrients
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
  nutritionSource?: string | null
  nutritionSourceCategory?: string | null
  matchedFoodId?: string | null
  packagedFoodId?: string
  packageMatchStatus?: string
  packageMatchConfidence?: number
  packageWeightSource?: string
  packageWeightApplied?: boolean
  packageWeightReason?: string
  packagedCandidates?: Array<Record<string, unknown>>
  nutritionEdited?: boolean
}

export type CorrectionItemPayload = NonNullable<AnalyzeTaskSubmitParams['correctionItems']>[number]

export const normalizeFoodNameForCorrection = (value: unknown) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]【】,，。./\\\-_:：;；·]/g, '')
)

export const normalizeCorrectionWeight = (value: unknown) => {
  const weight = Number(value)
  if (!Number.isFinite(weight) || weight <= 0) return 0
  return Math.round(weight * 100) / 100
}

export const hasCorrectionWeightChanged = (current: unknown, baseline: unknown) => (
  Math.abs(normalizeCorrectionWeight(current) - normalizeCorrectionWeight(baseline)) >= 0.01
)

export const formatCorrectionWeight = (value: unknown) => (
  normalizeCorrectionWeight(value).toFixed(2).replace(/\.?0+$/, '')
)

export function buildCorrectionPreviousResultItems<T extends ResultCorrectionItem>(
  items: T[],
  buildNutrients: (item: T) => Nutrients,
): FoodItem[] {
  return items.map((item) => ({
    itemId: item.sourceItemId ?? item.id,
    name: item.name,
    estimatedWeightGrams: item.weight,
    originalWeightGrams: item.originalWeight,
    waterMl: item.waterMl,
    suggestedRatio: item.suggestedRatio,
    suggestedRatioReason: item.suggestedRatioReason,
    suggestedRatioSource: item.suggestedRatioSource,
    nutrition_source: item.nutritionSource,
    nutrition_source_category: item.nutritionSourceCategory,
    matched_food_id: item.matchedFoodId,
    packaged_food_id: item.packagedFoodId,
    package_match_status: item.packageMatchStatus,
    package_match_confidence: item.packageMatchConfidence,
    package_weight_source: item.packageWeightSource,
    package_weight_applied: item.packageWeightApplied,
    package_weight_reason: item.packageWeightReason,
    packaged_candidates: item.packagedCandidates,
    nutrients: buildNutrients(item),
  }))
}

export function buildCorrectionItemsPayload<T extends ResultCorrectionItem>(
  resolvedItems: T[],
  baselineItems: T[],
  buildNutrients: (item: T) => Nutrients,
): CorrectionItemPayload[] {
  const baselineMap = new Map(baselineItems.map((item) => [item.id, item]))

  return resolvedItems.map((item) => {
    const baseline = baselineMap.get(item.id)
    const normalizedName = item.name.trim()

    return {
      name: normalizedName,
      weight: normalizeCorrectionWeight(item.weight),
      originalWeight: item.originalWeight,
      calorie: item.calorie,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      waterMl: item.waterMl,
      nutrients: buildNutrients(item),
      sourceName: baseline?.name || item.sourceName,
      sourceItemId: item.sourceItemId ?? item.id,
      nameEdited: baseline
        ? normalizeFoodNameForCorrection(normalizedName) !== normalizeFoodNameForCorrection(baseline.name)
        : true,
      weightEdited: baseline
        ? hasCorrectionWeightChanged(item.weight, baseline.weight)
        : true,
      nutritionEdited: Boolean(item.nutritionEdited),
    }
  })
}
