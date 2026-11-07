import Taro from '@tarojs/taro'
import type { DietRecommendationResult, FoodRecord } from '../../src/utils/api'
import {
  mealPreviewCacheKey,
  mergeJudgedPreview,
  ownerTag,
  readMealPreviewCache,
  recentMealRecords,
  recordMealName,
  writeMealPreviewCache,
} from '../../src/utils/meal-preview-cache'

const option = (id: string) => ({ source: 'public_food_library', source_id: id, title: id }) as DietRecommendationResult['recommendations'][number]
const result = (...ids: string[]) => ({ recommendations: ids.map(option), recommendation_id: ids.join('-') }) as DietRecommendationResult

describe('meal preview cache', () => {
  let store: Record<string, unknown>
  beforeEach(() => {
    store = {}
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store[key] ?? '')
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => { store[key] = value })
  })

  it('returns the last answer for the same account, meal and day only', () => {
    writeMealPreviewCache('token-a', 'lunch', '2026-11-06', result('x', 'y'))
    expect(readMealPreviewCache('token-a', 'lunch', '2026-11-06')?.recommendation_id).toBe('x-y')
    expect(readMealPreviewCache('token-b', 'lunch', '2026-11-06')).toBeUndefined()
    expect(readMealPreviewCache('token-a', 'dinner', '2026-11-06')).toBeUndefined()
    expect(readMealPreviewCache('token-a', 'lunch', '2026-11-07')).toBeUndefined()
    expect(readMealPreviewCache('', 'lunch', '2026-11-06')).toBeUndefined()
  })

  it('does not store the token itself, empty answers or oversized answers', () => {
    writeMealPreviewCache('secret-token', 'lunch', '2026-11-06', result('x'))
    expect(JSON.stringify(store)).not.toContain('secret-token')
    expect((store[mealPreviewCacheKey('lunch', '2026-11-06')] as { owner: string }).owner).toBe(ownerTag('secret-token'))

    writeMealPreviewCache('t', 'dinner', '2026-11-06', result())
    expect(store[mealPreviewCacheKey('dinner', '2026-11-06')]).toBeUndefined()

    const huge = result('x')
    huge.summary = 'x'.repeat(400_000)
    writeMealPreviewCache('t', 'breakfast', '2026-11-06', huge)
    expect(store[mealPreviewCacheKey('breakfast', '2026-11-06')]).toBeUndefined()
  })

  it('survives a storage that throws', () => {
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(() => { throw new Error('denied') })
    ;(Taro.setStorageSync as jest.Mock).mockImplementation(() => { throw new Error('full') })
    expect(() => writeMealPreviewCache('t', 'lunch', '2026-11-06', result('x'))).not.toThrow()
    expect(readMealPreviewCache('t', 'lunch', '2026-11-06')).toBeUndefined()
  })
})

describe('mergeJudgedPreview', () => {
  it('takes the model answer on an untouched card', () => {
    expect(mergeJudgedPreview(result('b', 'a'), false, 'a')).toEqual({ result: result('b', 'a'), selected: 0 })
  })

  it('keeps the place of a user who moved to another option', () => {
    expect(mergeJudgedPreview(result('b', 'a', 'c'), true, 'a')?.selected).toBe(1)
    expect(mergeJudgedPreview(result('b', 'c'), true, 'a')).toBeUndefined()
  })

  it('ignores an empty model answer', () => {
    expect(mergeJudgedPreview(result(), false)).toBeUndefined()
  })
})

describe('recent meal records', () => {
  const record = (id: string, meal: string, time: string, items: string[] = ['米饭'], description = '') =>
    ({ id, meal_type: meal, record_time: time, items: items.map(name => ({ name, weight: 100 })), description }) as unknown as FoodRecord

  it('keeps this meal, newest first, up to the limit', () => {
    const records = [
      record('1', 'lunch', '2026-11-04T12:00:00Z'),
      record('2', 'dinner', '2026-11-05T18:00:00Z'),
      record('3', 'lunch', '2026-11-05T12:00:00Z'),
      record('4', 'lunch', '2026-11-03T12:00:00Z'),
      record('5', 'lunch', '2026-11-02T12:00:00Z'),
      record('6', 'lunch', '2026-11-06T12:00:00Z', []),
    ]
    expect(recentMealRecords(records, 'lunch').map(r => r.id)).toEqual(['3', '1', '4'])
  })

  it('names a record by its first dishes or its description', () => {
    expect(recordMealName(record('1', 'lunch', '', ['米饭', '番茄炒蛋', '青菜', '汤']))).toBe('米饭、番茄炒蛋、青菜')
    expect(recordMealName(record('1', 'lunch', '', [], '食堂的牛肉面'))).toBe('食堂的牛肉面')
  })
})
