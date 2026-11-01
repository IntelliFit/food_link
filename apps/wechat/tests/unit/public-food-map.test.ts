import {
  buildFoodMapSpots,
  buildFoodMapSpotsFromPayload,
  clusterFoodMapSpots,
  foodMapClusterCellSize,
  foodMapDistanceKm,
  foodMapMarkerItemsInView,
  formatFoodMapClusterCount,
  type FoodMapSpot,
  formatFoodMapDistance,
  hasValidFoodCoordinates,
  mapSpotDishesLabel,
  mapSpotOpensDishList,
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
    expect(pageSource).toContain('复制外卖搜索词')
    expect(pageSource).toContain('外卖关键词已复制')
    expect(pageSource).toContain('补充地图餐食')
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

  it('uses server-aggregated university locations and preserves their food counts', () => {
    const payload: PublicFoodMapSpotPayload = {
      key: 'canteen:thu-zijing',
      latitude: 40.003,
      longitude: 116.326,
      location_level: 'canteen',
      location_name: '清华大学 · 紫荆园',
      address: '清华园校区',
      food_count: 614,
      featured_item: food({ id: 'thu-food', food_name: '紫荆园套餐' }),
    }

    const spots = buildFoodMapSpotsFromPayload([payload], { latitude: 40, longitude: 116.32 })

    expect(spots).toHaveLength(1)
    expect(spots[0].locationName).toBe('清华大学 · 紫荆园')
    expect(spots[0].locationLevel).toBe('canteen')
    expect(spots[0].foodCount).toBe(614)
    expect(spots[0].featuredItem.id).toBe('thu-food')
    expect(spots[0].distanceKm).toBeDefined()
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

describe('food map clustering', () => {
  function spot(key: string, latitude: number, longitude: number): FoodMapSpot {
    const featuredItem = food({ id: key })
    return { key, latitude, longitude, items: [featuredItem], featuredItem, foodCount: 1, locationLevel: 'food', locationName: key, address: '' }
  }
  const nearA = spot('a', 39.9001, 116.4001)
  const nearB = spot('b', 39.9002, 116.4002)
  const far = spot('far', 23.1, 113.3)

  it('merges nearby spots into a counted cluster and leaves distant ones alone', () => {
    const items = clusterFoodMapSpots([nearA, nearB, far], 5)
    const cluster = items.find(item => item.kind === 'cluster')
    expect(items).toHaveLength(2)
    expect(cluster?.kind === 'cluster' && cluster.spots.map(item => item.key)).toEqual(['a', 'b'])
    expect(cluster?.latitude).toBeCloseTo(39.90015)
    expect(items.find(item => item.kind === 'spot')?.key).toBe('far')
  })

  it('separates every spot at street level so each one can be opened', () => {
    expect(foodMapClusterCellSize(17)).toBe(0)
    expect(clusterFoodMapSpots([nearA, nearB], 17).every(item => item.kind === 'spot')).toBe(true)
  })

  it('uses smaller cells as the map zooms in', () => {
    const sizes = [4, 6, 8, 10, 12, 14, 16].map(foodMapClusterCellSize)
    expect(sizes).toEqual([...sizes].sort((left, right) => right - left))
    expect(new Set(sizes).size).toBe(sizes.length)
  })

  it('keeps the selected spot as its own marker inside a cluster area', () => {
    const items = clusterFoodMapSpots([nearA, nearB], 5, 'a')
    expect(items.map(item => [item.kind, item.key])).toEqual([['spot', 'a'], ['spot', 'b']])
  })

  it('drops far markers when zoomed in but keeps the selected one', () => {
    const center = { latitude: 39.9, longitude: 116.4 }
    const items = clusterFoodMapSpots([nearA, far], 15)
    expect(foodMapMarkerItemsInView(items, center, 15).map(item => item.key)).toEqual(['a'])
    expect(foodMapMarkerItemsInView(items, center, 15, 'far').map(item => item.key)).toEqual(['a', 'far'])
  })

  it('keeps every marker when zoomed out', () => {
    const items = clusterFoodMapSpots([nearA, far], 6)
    expect(foodMapMarkerItemsInView(items, { latitude: 39.9, longitude: 116.4 }, 6)).toHaveLength(2)
  })

  it('caps the cluster label', () => {
    expect(formatFoodMapClusterCount(99)).toBe('99')
    expect(formatFoodMapClusterCount(100)).toBe('99+')
  })
})

describe('map spot dish list', () => {
  it('opens a list only when a spot has more than one dish', () => {
    expect(mapSpotOpensDishList({ foodCount: 279 })).toBe(true)
    expect(mapSpotOpensDishList({ foodCount: 1 })).toBe(false)
  })

  it('says how many dishes the button leads to', () => {
    expect(mapSpotDishesLabel(279)).toBe('查看 279 道餐食')
    expect(mapSpotDishesLabel(1)).toBe('查看餐食')
  })
})
