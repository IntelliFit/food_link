import { readFileSync } from 'fs'
import { join } from 'path'
import Taro from '@tarojs/taro'
import {
  currentPageHasSharedSpot,
  findSharedMapSpot,
  fitShareName,
  foodMapShareMessage,
  parseSharedSpot,
  shareableFoodImage,
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

const CDN = 'https://cdn-food-images.coachlink.fit'

jest.mock('../../src/utils/static-asset-cdn-url', () => ({
  getFoodImagesCdnBaseUrl: () => 'https://cdn-food-images.coachlink.fit',
  LOGIN_LOGO_URL: 'https://cdn-food-images.coachlink.fit/wechat/source-login-logo.png',
}))

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

  it('turns a merchant upload into the spot it lands on, with its dish and photo, but not homemade food', () => {
    expect(uploadedSpotFromPayload({ merchant_name: '街角小馆', merchant_address: '人民路 1 号', latitude: 31.2, longitude: 121.5 }))
      .toEqual({ latitude: 31.2, longitude: 121.5, name: '街角小馆', address: '人民路 1 号' })
    expect(uploadedSpotFromPayload({
      merchant_name: '街角小馆', food_name: '牛肉面', latitude: 31.2, longitude: 121.5, image_paths: [`${CDN}/food/a.jpg`],
    })).toEqual({ latitude: 31.2, longitude: 121.5, name: '街角小馆', address: '', dish: '牛肉面', image: `${CDN}/food/a.jpg` })
    expect(uploadedSpotFromPayload({ food_name: '家常菜' })).toBeNull()
  })

  it('carries the dish, calories and photo so a guest sees them before logging in', () => {
    const shared = sharedSpotFromMapSpot(spot('food:31.27490:121.54230', 31.2749, 121.5423, {
      featuredItem: { id: 'x', food_name: '红豆面包', image_path: `${CDN}/food/b.jpg` } as PublicFoodLibraryItem,
    }))
    expect(shared).toMatchObject({ dish: '红豆面包', image: `${CDN}/food/b.jpg` })
    const parsed = parseSharedSpot(queryParams(sharedSpotQuery({ ...shared, kcal: 320 })))
    expect(parsed).toMatchObject({ name: '街角小馆', dish: '红豆面包', kcal: 320, image: `${CDN}/food/b.jpg` })
  })

  it('accepts only photos on the food image CDN, so a link cannot show any picture', () => {
    expect(shareableFoodImage(`${CDN}/food/a.jpg`)).toBe(`${CDN}/food/a.jpg`)
    expect(shareableFoodImage('http://cdn-food-images.coachlink.fit/food/a.jpg')).toBe(`${CDN}/food/a.jpg`)
    expect(shareableFoodImage('https://evil.example.com/a.jpg')).toBe('')
    expect(shareableFoodImage('https://cdn-food-images.coachlink.fit.evil.com/a.jpg')).toBe('')
    expect(shareableFoodImage('http://tmp/abc.jpg')).toBe('')
    expect(shareableFoodImage('food/a.jpg')).toBe('')
    expect(parseSharedSpot({ lat: '31.2', lng: '121.5', name: '店', img: encodeURIComponent('https://evil.example.com/a.jpg') })?.image)
      .toBeUndefined()
    expect(parseSharedSpot({ lat: '31.2', lng: '121.5', name: '店', kcal: '-3' })?.kcal).toBeUndefined()
    expect(parseSharedSpot({ lat: '31.2', lng: '121.5', name: '店', kcal: '99999' })?.kcal).toBeUndefined()
  })

  it('puts the place name first in a title short enough for a chat card', () => {
    const shared = { latitude: 31.2, longitude: 121.5, name: 'GooddyBread&好好面包', address: '' }
    expect(foodMapShareMessage(shared, 'share').title).toBe('GooddyBread&好好面包｜食探上发现的好吃的')
    expect(foodMapShareMessage({ ...shared, name: '街角小馆' }, 'upload').title).toBe('街角小馆｜我刚在食探点亮了它')
    expect(fitShareName('老北京炸酱面馆二十四小时营业总店分店')).toBe('老北京炸酱面馆二十四小时营业…')
    expect(fitShareName('GooddyBread&好好面包')).toBe('GooddyBread&好好面包')
  })

  it('writes a share message that opens the same spot', () => {
    const shared = { latitude: 31.2, longitude: 121.5, name: '街角小馆', address: '' }
    const uploaded = foodMapShareMessage(shared, 'upload', 'https://img/1.jpg')
    expect(uploaded.path).toMatch(/^\/packageExtra\/pages\/food-library\/index\?lat=31\.200000&lng=121\.500000&name=/)
    expect(uploaded.path).toMatch(/&from=share$/)
    expect(uploaded.imageUrl).toBe('https://img/1.jpg')
    expect(foodMapShareMessage(null, 'share')).toEqual({ title: '食探美食图谱：一起点亮身边的好吃的', path: '/packageExtra/pages/food-library/index' })
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
