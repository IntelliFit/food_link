import { readFileSync } from 'fs'
import { join } from 'path'
import Taro from '@tarojs/taro'
import {
  currentPageHasSharedSpot,
  findSharedMapSpot,
  foodMapShareMessage,
  parseSharedSpot,
  sharedSpotFromMapSpot,
  sharedSpotOrigin,
  sharedSpotQuery,
  uploadedSpotFromPayload,
} from '../../src/packageExtra/pages/food-library/food-map-share'
import type { FoodMapSpot } from '../../src/packageExtra/pages/food-library/food-map'
import type { PublicFoodLibraryItem } from '../../src/utils/api'

function spot(key: string, latitude: number, longitude: number, overrides: Partial<FoodMapSpot> = {}): FoodMapSpot {
  const featuredItem = { id: key, merchant_name: '街角小馆', merchant_address: '人民路 1 号' } as PublicFoodLibraryItem
  return {
    key, latitude, longitude, items: [featuredItem], featuredItem, foodCount: 1,
    locationLevel: 'food', locationName: '街角小馆', address: '人民路 1 号', ...overrides,
  }
}

function queryParams(query: string): Record<string, string> {
  return Object.fromEntries(query.split('&').map(part => part.split('=') as [string, string]))
}

describe('food map share links', () => {
  it('round-trips a spot through the share query, including Chinese text and the spot key', () => {
    const shared = sharedSpotFromMapSpot(spot('food:31.27490:121.54230', 31.2749, 121.5423, { locationName: '老王 & 小李·面馆' }))
    const parsed = parseSharedSpot(queryParams(sharedSpotQuery(shared)))
    expect(parsed).toEqual({ latitude: 31.2749, longitude: 121.5423, name: '老王 & 小李·面馆', address: '人民路 1 号', key: 'food:31.27490:121.54230' })
  })

  it('rejects links without a usable place', () => {
    expect(parseSharedSpot(undefined)).toBeNull()
    expect(parseSharedSpot({ lat: '0', lng: '0', name: '店' })).toBeNull()
    expect(parseSharedSpot({ lat: '31.2', lng: '121.5' })).toBeNull()
    expect(parseSharedSpot({ lat: 'abc', lng: '121.5', name: '店' })).toBeNull()
  })

  it('keeps a malformed escape as plain text instead of throwing', () => {
    expect(parseSharedSpot({ lat: '31.2', lng: '121.5', name: '%E4%B8' })?.name).toBe('%E4%B8')
  })

  it('finds the shared spot by key, then by distance, and ignores far spots', () => {
    const near = spot('food:a', 31.27495, 121.54235)
    const far = spot('food:b', 31.3, 121.6)
    expect(findSharedMapSpot([far, near], { latitude: 31.2749, longitude: 121.5423, name: '店', address: '', key: 'food:b' })).toBe(far)
    expect(findSharedMapSpot([far, near], { latitude: 31.2749, longitude: 121.5423, name: '店', address: '' })).toBe(near)
    expect(findSharedMapSpot([far], { latitude: 31.2749, longitude: 121.5423, name: '店', address: '' })).toBeUndefined()
  })

  it('turns a merchant upload into the spot it lands on, but not homemade food', () => {
    expect(uploadedSpotFromPayload({ merchant_name: '街角小馆', merchant_address: '人民路 1 号', latitude: 31.2, longitude: 121.5 }))
      .toEqual({ latitude: 31.2, longitude: 121.5, name: '街角小馆', address: '人民路 1 号' })
    expect(uploadedSpotFromPayload({ food_name: '家常菜' })).toBeNull()
  })

  it('writes an inviting share message that opens the same spot', () => {
    const shared = { latitude: 31.2, longitude: 121.5, name: '街角小馆', address: '' }
    const uploaded = foodMapShareMessage(shared, 'upload', 'https://img/1.jpg')
    expect(uploaded.title).toContain('点亮了「街角小馆」')
    expect(uploaded.path).toMatch(/^\/packageExtra\/pages\/food-library\/index\?lat=31\.200000&lng=121\.500000&name=/)
    expect(uploaded.path).toMatch(/&from=share$/)
    expect(uploaded.imageUrl).toBe('https://img/1.jpg')
    expect(foodMapShareMessage(shared, 'share').title).toContain('发现了「街角小馆」')
    expect(foodMapShareMessage(null, 'share').path).toBe('/packageExtra/pages/food-library/index')
    expect(sharedSpotOrigin({ from: 'upload' })).toBe('upload')
    expect(sharedSpotOrigin({})).toBe('share')
  })
})

jest.mock('@tarojs/taro', () => ({ __esModule: true, default: { getCurrentPages: jest.fn(() => []) } }))

describe('guest access to shared spots', () => {
  const getCurrentPages = Taro.getCurrentPages as unknown as jest.Mock

  it('opens for guests only when the page carries a shared spot', () => {
    getCurrentPages.mockReturnValue([{ options: { lat: '31.2', lng: '121.5', name: '街角小馆', from: 'share' } }])
    expect(currentPageHasSharedSpot()).toBe(true)
    getCurrentPages.mockReturnValue([{ options: { from: 'record' } }])
    expect(currentPageHasSharedSpot()).toBe(false)
    getCurrentPages.mockReturnValue([])
    expect(currentPageHasSharedSpot()).toBe(false)
  })
})

describe('food map upload page', () => {
  const source = readFileSync(join(__dirname, '../../src/packageExtra/pages/food-library-share/index.tsx'), 'utf8')

  it('does not analyse photos on the page', () => {
    expect(source).not.toContain('analyzeFoodImage')
    expect(source).not.toContain('识别中')
  })

  it('never tells the uploader to wait for a review', () => {
    expect(source).not.toMatch(/审核/)
  })
})
