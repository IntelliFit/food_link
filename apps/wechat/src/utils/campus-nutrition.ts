import type { PublicFoodLibraryItem } from './api'

export function campusNutritionState(item: PublicFoodLibraryItem) {
  const status = String(item.analysis_status || item.nutrition_status || '').trim().toLowerCase()
  const hasNutrition = [item.total_calories, item.total_protein, item.total_carbs, item.total_fat]
    .some(value => Number.isFinite(value) && value > 0)
  const failed = status === 'failed' || status === 'timed_out'
  const stale = status === 'stale'
  const pending = status === 'pending' || status === 'processing' || stale
  const analyzing = status === 'processing' || (status === 'pending' && !!item.analysis_task_id)
  // Catalog imports carry macro estimates, but do not submit an analysis task.
  // An edited/recalculating version must not reuse the original estimate as current.
  const estimated = hasNutrition && !failed && !stale && !item.analysis_task_id &&
    (item.content_version || 1) <= 1 && !!item.items?.length &&
    item.items.every(food => food.micronutrient_analysis === 'estimated_v1')
  const displayNutrition = hasNutrition && !stale && !failed
  return { analyzing, failed, estimated, displayNutrition, pending, canRecord: displayNutrition && !pending }
}
