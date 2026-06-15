import {
  buildFoodRecordItemPayloadFromAnalyzeItem,
  buildSaveFoodRecordRequestFromTask,
  type AnalysisTask,
  type FoodItem,
} from '../src'

const sampleFood: FoodItem = {
  name: '米饭',
  estimatedWeightGrams: 120,
  originalWeightGrams: 120,
  nutrients: {
    calories: 156,
    protein: 3,
    carbs: 34,
    fat: 0.4,
    fiber: 0.5,
    sugar: 0.1,
  },
}

describe('food record helpers', () => {
  it('builds a save item payload from analyze item', () => {
    const item = buildFoodRecordItemPayloadFromAnalyzeItem(sampleFood)

    expect(item.name).toBe('米饭')
    expect(item.weight).toBe(120)
    expect(item.ratio).toBe(100)
    expect(item.intake).toBe(120)
    expect(item.nutrients.calories).toBe(156)
  })

  it('builds a save request from analysis task', () => {
    const task: AnalysisTask = {
      id: 'task-1',
      user_id: 'user-1',
      task_type: 'food_image',
      status: 'done',
      image_url: 'https://example.com/food.jpg',
      result: {
        description: '米饭',
        items: [sampleFood],
      },
      created_at: '2026-06-14T00:00:00Z',
      updated_at: '2026-06-14T00:01:00Z',
    }

    const payload = buildSaveFoodRecordRequestFromTask(task, {
      mealType: 'lunch',
      date: '2026-06-14',
    })

    expect(payload.meal_type).toBe('lunch')
    expect(payload.source_task_id).toBe('task-1')
    expect(payload.total_calories).toBe(156)
    expect(payload.total_weight_grams).toBe(120)
    expect(payload.items).toHaveLength(1)
  })

  it('allows overriding save request entry type for text analysis tasks', () => {
    const task: AnalysisTask = {
      id: 'task-text-1',
      user_id: 'user-1',
      task_type: 'food_text',
      status: 'done',
      text_input: '午餐吃了一碗米饭',
      result: {
        description: '文字饮食记录',
        items: [sampleFood],
      },
      created_at: '2026-06-14T00:00:00Z',
      updated_at: '2026-06-14T00:01:00Z',
    }

    const payload = buildSaveFoodRecordRequestFromTask(task, {
      mealType: 'lunch',
      date: '2026-06-14',
      entryType: 'food_text',
    })

    expect(payload.entry_type).toBe('food_text')
    expect(payload.image_path).toBeUndefined()
    expect(payload.source_task_id).toBe('task-text-1')
  })
})
