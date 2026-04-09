/**
 * 调试 / 本地预览：将「保存记录」请求体或 AnalyzeResponse 转为 FoodRecord，
 * 供 `record-detail` 从 `recordDetail` storage 读取，免走后端即可调海报与分享样式。
 */
import type { AnalyzeResponse, FoodRecord, MealType, SaveFoodRecordRequest } from './api'

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
    items: payload.items.map((it) => ({
      name: it.name,
      weight: it.weight,
      ratio: it.ratio,
      intake: it.intake,
      nutrients: {
        calories: it.nutrients.calories,
        protein: it.nutrients.protein,
        carbs: it.nutrients.carbs,
        fat: it.nutrients.fat,
        fiber: it.nutrients.fiber ?? 0,
        sugar: it.nutrients.sugar ?? 0,
      },
    })),
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
  const items = res.items.map((it) => ({
    name: it.name,
    weight: it.estimatedWeightGrams,
    ratio: 100,
    intake: Math.round(it.estimatedWeightGrams * 100) / 100,
    nutrients: {
      calories: it.nutrients.calories,
      protein: it.nutrients.protein,
      carbs: it.nutrients.carbs,
      fat: it.nutrients.fat,
      fiber: it.nutrients.fiber ?? 0,
      sugar: it.nutrients.sugar ?? 0,
    },
  }))

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
