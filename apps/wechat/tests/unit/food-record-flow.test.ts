import Taro from '@tarojs/taro'
import type { FoodRecord, Nutrients } from '../../src/utils/api'
import { buildFoodRecordFavoriteDraft, returnHomeAfterFoodRecord } from '../../src/utils/food-record-flow'

const nutrients: Nutrients = {
  calories: 120,
  protein: 8,
  carbs: 12,
  fat: 4,
  fiber: 2,
  sugar: 1,
  waterMl: 30,
  water_ml: 30,
  sodium_mg: 80,
}

const createRecord = (overrides: Partial<FoodRecord> = {}): FoodRecord => ({
  id: 'record-1',
  user_id: 'user-1',
  meal_type: 'lunch',
  description: '手动记录：鸡胸肉、米饭',
  image_path: 'user-1/meal.jpg',
  items: [{
    name: '鸡胸肉',
    weight: 100,
    ratio: 80,
    intake: 80,
    water_ml: 30,
    packaged_food_id: 'packaged-1',
    package_match_status: 'matched',
    nutrients,
  }],
  total_calories: 120,
  total_protein: 8,
  total_carbs: 12,
  total_fat: 4,
  total_weight_grams: 100,
  source_task_id: 'task-1',
  record_time: '2026-08-04T12:00:00Z',
  created_at: '2026-08-04T12:00:00Z',
  ...overrides,
})

describe('food record flow', () => {
  it('builds a reusable favorite without losing item metadata', () => {
    const draft = buildFoodRecordFavoriteDraft(createRecord())

    expect(draft).toMatchObject({
      suggestedName: '鸡胸肉、米饭',
      image_path: 'user-1/meal.jpg',
      meal_type: 'lunch',
      is_favorite: true,
      source_task_id: 'task-1',
      total_calories: 120,
    })
    expect(draft.items[0]).toMatchObject({
      name: '鸡胸肉',
      weight: 100,
      ratio: 80,
      intake: 80,
      water_ml: 30,
      packaged_food_id: 'packaged-1',
      package_match_status: 'matched',
      nutrients: expect.objectContaining({ water_ml: 30 }),
    })
  })

  it('falls back to food names when the record has no description', () => {
    expect(buildFoodRecordFavoriteDraft(createRecord({ description: null })).suggestedName).toBe('鸡胸肉')
  })

  it('switches to the home tab after a successful record', async () => {
    jest.useFakeTimers()
    ;(Taro.switchTab as jest.Mock).mockResolvedValueOnce(undefined)

    returnHomeAfterFoodRecord(600)
    jest.advanceTimersByTime(600)
    await Promise.resolve()

    expect(Taro.switchTab).toHaveBeenCalledWith({ url: '/pages/index/index' })
    jest.useRealTimers()
  })
})
