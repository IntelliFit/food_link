import { foodRecordFromSavePayload } from '../../src/utils/dev-record-preview'
import type { SaveFoodRecordRequest } from '../../src/utils/api'

describe('food record development preview', () => {
  test('keeps eating mood from the save payload', () => {
    const payload: SaveFoodRecordRequest = {
      meal_type: 'lunch',
      items: [],
      total_calories: 0,
      total_protein: 0,
      total_carbs: 0,
      total_fat: 0,
      total_weight_grams: 0,
      eating_mood: 'calm',
    }

    const record = foodRecordFromSavePayload(payload, 'user-1')

    expect(record.eating_mood).toBe('calm')
  })
})
