import Taro from '@tarojs/taro'
import type { CreateRecipeRequest, FoodRecord } from './api'
import { buildFoodRecordItemPayloadFromResultItem } from './food-record-item-payload'

const HOME_TAB_URL = '/pages/index/index'

export const returnHomeAfterFoodRecord = (delay = 600): ReturnType<typeof setTimeout> => (
  setTimeout(() => {
    void Taro.switchTab({ url: HOME_TAB_URL }).catch(() => {
      void Taro.reLaunch({ url: HOME_TAB_URL })
    })
  }, delay)
)

const getDefaultFavoriteName = (record: FoodRecord): string => {
  const description = String(record.description || '').trim().replace(/^手动记录[：:]\s*/, '')
  if (description) return description

  const itemNames = (record.items || [])
    .map((item) => String(item.name || '').trim())
    .filter(Boolean)
    .join('、')
  return itemNames || '收藏餐食'
}

export type FoodRecordFavoriteDraft = Omit<CreateRecipeRequest, 'recipe_name'> & {
  suggestedName: string
}

export const buildFoodRecordFavoriteDraft = (record: FoodRecord): FoodRecordFavoriteDraft => ({
  suggestedName: getDefaultFavoriteName(record),
  description: String(record.description || '').trim() || undefined,
  image_path: String(record.image_path || '').trim() || undefined,
  items: (record.items || []).map((item) => buildFoodRecordItemPayloadFromResultItem(item, item.nutrients)),
  total_calories: Number(record.total_calories) || 0,
  total_protein: Number(record.total_protein) || 0,
  total_carbs: Number(record.total_carbs) || 0,
  total_fat: Number(record.total_fat) || 0,
  total_weight_grams: Number(record.total_weight_grams) || 0,
  meal_type: record.meal_type,
  tags: ['今日餐食'],
  is_favorite: true,
  source_task_id: String(record.source_task_id || '').trim() || undefined,
})
