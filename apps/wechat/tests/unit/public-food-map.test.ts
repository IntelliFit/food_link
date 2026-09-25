import {
  buildFoodMapSpots,
  buildFoodMapSpotsFromPayload,
  foodMapDistanceKm,
  formatFoodMapDistance,
  hasValidFoodCoordinates,
} from '../../src/packageExtra/pages/food-library/food-map'
import type { PublicFoodLibraryItem, PublicFoodMapSpotPayload } from '../../src/utils/api'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

function food(overrides: Partial<PublicFoodLibraryItem>): PublicFoodLibraryItem {
  return {
    id: 'food-1',
    user_id: 'user-1',
    total_calories: 420,
    total_protein: 30,
    total_carbs: 42,
    total_fat: 12,
    items: [],
    suitable_for_fat_loss: false,
    user_tags: [],
    status: 'published',
    type: 'common',
    like_count: 0,
    comment_count: 0,
    avg_rating: 0,
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
    ...overrides,
  }
}

describe('public food map helpers', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/food-library/index.tsx'),
    'utf8',
  )
  const sharePageSource = readFileSync(
    join(process.cwd(), 'src/packageExtra/pages/food-library-share/index.tsx'),
    'utf8',
  )

  it('loads only map-ready foods and exposes honest navigation and delivery actions', () => {
    expect(pageSource).toContain('getPublicFoodMapSpots()')
    expect(pageSource).toContain("className='food-map'")
    expect(pageSource).toContain("'/assets/icons/food-map-marker.png'")
    expect(existsSync(join(process.cwd(), 'assets/icons/food-map-marker.png'))).toBe(true)
    expect(pageSource).toContain('导航去吃')
    expect(pageSource).toContain('导航到食堂')
    expect(pageSource).toContain('搜外卖')
    expect(pageSource).toContain('外卖关键词已复制')
    expect(pageSource).toContain('点亮一家')
    expect(pageSource).toContain('map_light=1')
    expect(sharePageSource).toContain('商家位置（点亮地图必填）')
    expect(sharePageSource).toContain('请先选择商家位置')
    expect(sharePageSource).toContain('点亮这家美食')
  })

  it('uses server-aggregated locations and preserves their food counts', () => {
    const payload: PublicFoodMapSpotPayload = {
      key: 'food:43.89423:125.28066',
      latitude: 43.894229,
      longitude: 125.280655,
      location_level: 'food',
      location_name: '三生晓',
      address: '吉林工商学院一食堂二楼',
      food_count: 73,
      featured_item: food({ id: 'fresh-juice', food_name: '鲜榨苹果汁' }),
    }

    const spots = buildFoodMapSpotsFromPayload([payload])

    expect(spots).toHaveLength(1)
    expect(spots[0].locationName).toBe('三生晓')
    expect(spots[0].foodCount).toBe(73)
    expect(spots[0].featuredItem.id).toBe('fresh-juice')
  })

  it('rejects missing, invalid, and zero coordinates', () => {
    expect(hasValidFoodCoordinates(food({ latitude: null, longitude: null }))).toBe(false)
    expect(hasValidFoodCoordinates(food({ latitude: 91, longitude: 116 }))).toBe(false)
    expect(hasValidFoodCoordinates(food({ latitude: 0, longitude: 0 }))).toBe(false)
    expect(hasValidFoodCoordinates(food({ latitude: 39.9, longitude: 116.4 }))).toBe(true)
  })

  it('groups dishes at one place, selects the stronger card, and sorts by distance', () => {
    const spots = buildFoodMapSpots([
      food({ id: 'far', latitude: 39.99, longitude: 116.4, food_name: '远处餐食' }),
      food({ id: 'near-plain', latitude: 39.901, longitude: 116.401, food_name: '普通餐食' }),
      food({
        id: 'near-photo', latitude: 39.901, longitude: 116.401, food_name: '有图餐食', image_path: 'https://cdn.example.com/food.jpg',
      }),
      food({ id: 'invalid', latitude: null, longitude: null }),
    ], { latitude: 39.9, longitude: 116.4 })

    expect(spots).toHaveLength(2)
    expect(spots[0].items).toHaveLength(2)
    expect(spots[0].featuredItem.id).toBe('near-photo')
    expect(spots[0].distanceKm).toBeLessThan(spots[1].distanceKm as number)
  })

  it('calculates and formats walking-scale and city-scale distances', () => {
    const nearby = foodMapDistanceKm(
      { latitude: 39.9, longitude: 116.4 },
      { latitude: 39.901, longitude: 116.4 },
    )
    expect(nearby).toBeGreaterThan(0.1)
    expect(nearby).toBeLessThan(0.12)
    expect(formatFoodMapDistance(nearby)).toBe('110m')
    expect(formatFoodMapDistance(2.34)).toBe('2.3km')
    expect(formatFoodMapDistance(128.8)).toBe('129km')
  })
})
