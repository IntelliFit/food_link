/**
 * 调试 / 本地预览：将「保存记录」请求体或 AnalyzeResponse 转为 FoodRecord，
 * 供 `record-detail` 从 `recordDetail` storage 读取，免走后端即可调海报与分享样式。
 */
import type { AnalyzeResponse, FoodRecord, FoodRecordItemRow, MealType, SaveFoodRecordRequest } from './api'

export function foodRecordFromSavePayload(
  payload: SaveFoodRecordRequest,
  userId: string
): FoodRecord {
  const now = new Date().toISOString()
  return {
    id: `debug-${Date.now()}`,
    user_id: userId,
    meal_type: payload.meal_type,
    image_path: payload.image_path ?? null,
    image_paths: payload.image_paths && payload.image_paths.length > 0 ? payload.image_paths : null,
    description: payload.description ?? null,
    insight: payload.insight ?? null,
    pfc_ratio_comment: payload.pfc_ratio_comment ?? null,
    absorption_notes: payload.absorption_notes ?? null,
    context_advice: payload.context_advice ?? null,
    items: payload.items.map((it): FoodRecordItemRow => {
      const n = it.nutrients
      return {
        name: it.name,
        weight: it.weight,
        ratio: it.ratio,
        intake: it.intake,
        image_path: it.image_path ?? null,
        image_paths: it.image_paths ?? null,
        gross_weight_grams: it.gross_weight_grams,
        grossWeightGrams: it.gross_weight_grams,
        edible_portion_ratio: it.edible_portion_ratio,
        ediblePortionRatio: it.edible_portion_ratio,
        edible_portion_reason: it.edible_portion_reason,
        ediblePortionReason: it.edible_portion_reason,
        edible_portion_source: it.edible_portion_source,
        ediblePortionSource: it.edible_portion_source,
        suggested_ratio: it.suggested_ratio,
        suggestedRatio: it.suggested_ratio,
        suggested_ratio_reason: it.suggested_ratio_reason,
        suggestedRatioReason: it.suggested_ratio_reason,
        suggested_ratio_source: it.suggested_ratio_source,
        suggestedRatioSource: it.suggested_ratio_source,
        water_ml: it.water_ml,
        waterMl: it.water_ml,
        nutrition_source: it.nutrition_source,
        nutritionSource: it.nutrition_source,
        nutrition_source_category: it.nutrition_source_category,
        nutritionSourceCategory: it.nutrition_source_category,
        matched_food_id: it.matched_food_id,
        matchedFoodId: it.matched_food_id,
        packaged_food_id: it.packaged_food_id,
        packagedFoodId: it.packaged_food_id,
        package_match_status: it.package_match_status,
        packageMatchStatus: it.package_match_status,
        package_match_confidence: it.package_match_confidence,
        packageMatchConfidence: it.package_match_confidence,
        package_weight_source: it.package_weight_source,
        packageWeightSource: it.package_weight_source,
        package_weight_applied: it.package_weight_applied,
        packageWeightApplied: it.package_weight_applied,
        package_weight_reason: it.package_weight_reason,
        packageWeightReason: it.package_weight_reason,
        packaged_candidates: it.packaged_candidates,
        packagedCandidates: it.packaged_candidates,
        nutrients: {
          ...n,
          fiber: n.fiber ?? 0,
          sugar: n.sugar ?? 0,
        },
        manual_source: it.manual_source as FoodRecordItemRow['manual_source'],
        manual_source_id: it.manual_source_id,
        manual_source_title: it.manual_source_title,
        manual_portion_label: it.manual_portion_label,
      }
    }),
    total_calories: payload.total_calories,
    total_protein: payload.total_protein,
    total_carbs: payload.total_carbs,
    total_fat: payload.total_fat,
    total_weight_grams: payload.total_weight_grams,
    record_time: now,
    created_at: now,
    diet_goal: payload.diet_goal ?? null,
    activity_timing: payload.activity_timing ?? null,
    source_task_id: payload.source_task_id ?? null,
  }
}

export function foodRecordFromAnalyzeResponse(
  res: AnalyzeResponse,
  opts: {
    mealType: MealType
    dietGoal?: string
    activityTiming?: string
    imagePaths: string[]
    userId: string
  }
): FoodRecord {
  const now = new Date().toISOString()
  const items = res.items.map((it): FoodRecordItemRow => {
    const weight = it.estimatedWeightGrams
    const ratio = 100
    const intake = Math.round(weight * 100) / 100
    return {
      name: it.name,
      weight,
      ratio,
      intake,
      gross_weight_grams: it.gross_weight_grams ?? it.grossWeightGrams,
      grossWeightGrams: it.grossWeightGrams ?? it.gross_weight_grams,
      edible_portion_ratio: it.edible_portion_ratio ?? it.ediblePortionRatio,
      ediblePortionRatio: it.ediblePortionRatio ?? it.edible_portion_ratio,
      edible_portion_reason: it.edible_portion_reason ?? it.ediblePortionReason,
      ediblePortionReason: it.ediblePortionReason ?? it.edible_portion_reason,
      edible_portion_source: it.edible_portion_source ?? it.ediblePortionSource,
      ediblePortionSource: it.ediblePortionSource ?? it.edible_portion_source,
      suggested_ratio: it.suggested_ratio ?? it.suggestedRatio,
      suggestedRatio: it.suggestedRatio ?? it.suggested_ratio,
      suggested_ratio_reason: it.suggested_ratio_reason ?? it.suggestedRatioReason,
      suggestedRatioReason: it.suggestedRatioReason ?? it.suggested_ratio_reason,
      suggested_ratio_source: it.suggested_ratio_source ?? it.suggestedRatioSource,
      suggestedRatioSource: it.suggestedRatioSource ?? it.suggested_ratio_source,
      water_ml: it.water_ml ?? it.waterMl,
      waterMl: it.waterMl ?? it.water_ml,
      nutrients: {
        ...it.nutrients,
        fiber: it.nutrients.fiber ?? 0,
        sugar: it.nutrients.sugar ?? 0,
      },
    }
  })

  let totalCal = 0
  let totalP = 0
  let totalC = 0
  let totalF = 0
  let totalW = 0
  for (const it of res.items) {
    totalCal += it.nutrients.calories
    totalP += it.nutrients.protein
    totalC += it.nutrients.carbs
    totalF += it.nutrients.fat
    totalW += it.estimatedWeightGrams
  }

  return {
    id: `debug-${Date.now()}`,
    user_id: opts.userId,
    meal_type: opts.mealType,
    image_path: opts.imagePaths[0] ?? null,
    image_paths: opts.imagePaths.length > 0 ? opts.imagePaths : null,
    description: res.description ?? null,
    insight: res.insight ?? null,
    pfc_ratio_comment: res.pfc_ratio_comment ?? null,
    absorption_notes: res.absorption_notes ?? null,
    context_advice: res.context_advice ?? null,
    items,
    total_calories: totalCal,
    total_protein: totalP,
    total_carbs: totalC,
    total_fat: totalF,
    total_weight_grams: Math.round(totalW),
    record_time: now,
    created_at: now,
    diet_goal: opts.dietGoal ?? null,
    activity_timing: opts.activityTiming ?? null,
    source_task_id: 'debug-preview',
  }
}
