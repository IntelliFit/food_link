import type { FoodItem, FoodRecordItemPayload } from './api'

export const FOOD_LIBRARY_PICKED_EVENT = 'mealFoodsPicked'

export const libraryItemToAnalyzeItem = (item: FoodRecordItemPayload, id: number): FoodItem => ({
  ...item,
  itemId: id,
  estimatedWeightGrams: item.weight,
  originalWeightGrams: item.weight,
  grossWeightGrams: item.weight,
  ediblePortionRatio: 100,
  intakeRatio: item.ratio,
  intakeGrams: item.intake,
  nutrition_source: item.manual_source === 'custom' ? 'user_custom' : 'manual_food_library',
  nutrition_source_category: item.manual_source === 'custom' ? 'user' : 'database',
  matched_food_id: item.manual_source === 'nutrition_library' ? item.manual_source_id : undefined,
})
