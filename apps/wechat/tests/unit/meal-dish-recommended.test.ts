const mockStore = new Map<string, unknown>()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: (key: string) => mockStore.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => { mockStore.set(key, value) },
    removeStorageSync: (key: string) => { mockStore.delete(key) },
  },
}))

import {
  RECOMMENDED_TTL_MS,
  clearRecommendedDish,
  recentRecommendedDish,
  rememberRecommendedDish,
} from '../../src/utils/meal-dish-recommended'

describe('home recommendation memory for the meal-dish prompt', () => {
  beforeEach(() => mockStore.clear())

  it('only remembers canteen dishes', () => {
    rememberRecommendedDish('food_record', 'r1', 'navigated', 1000)
    rememberRecommendedDish('public_food_library', '', 'navigated', 1000)
    expect(recentRecommendedDish(1000)).toBeNull()
    rememberRecommendedDish('public_food_library', 'd1', 'shown', 1000)
    expect(recentRecommendedDish(1000)).toEqual({ item_id: 'd1', kind: 'shown', at: 1000 })
  })

  it('keeps the strongest signal within three hours', () => {
    rememberRecommendedDish('public_food_library', 'd1', 'navigated', 1000)
    rememberRecommendedDish('public_food_library', 'd2', 'shown', 2000)
    expect(recentRecommendedDish(3000)?.item_id).toBe('d1')
    rememberRecommendedDish('public_food_library', 'd3', 'navigated', 4000)
    expect(recentRecommendedDish(5000)?.item_id).toBe('d3')
    rememberRecommendedDish('public_food_library', 'd4', 'shown', 4000 + RECOMMENDED_TTL_MS + 1)
    expect(recentRecommendedDish(4000 + RECOMMENDED_TTL_MS + 2)?.item_id).toBe('d4')
  })

  it('expires after three hours and can be cleared', () => {
    rememberRecommendedDish('public_food_library', 'd1', 'chatted', 1000)
    expect(recentRecommendedDish(1000 + RECOMMENDED_TTL_MS + 1)).toBeNull()
    expect(recentRecommendedDish(1000 + 60_000)?.kind).toBe('chatted')
    clearRecommendedDish()
    expect(recentRecommendedDish(1000)).toBeNull()
  })
})
