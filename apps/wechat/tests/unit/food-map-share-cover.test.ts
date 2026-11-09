import Taro from '@tarojs/taro'
import {
  drawFoodMapShareCover,
  foodMapShareWithCover,
  prepareFoodMapShareCover,
} from '../../src/packageExtra/pages/food-library/food-map-share-cover'
import type { SharedFoodSpot } from '../../src/packageExtra/pages/food-library/food-map-share'

const LOGO = 'https://cdn-food-images.coachlink.fit/wechat/source-login-logo.png'
let mockCanvasAvailable = true

jest.mock('../../src/utils/static-asset-cdn-url', () => ({
  getFoodImagesCdnBaseUrl: () => 'https://cdn-food-images.coachlink.fit',
  LOGIN_LOGO_URL: 'https://cdn-food-images.coachlink.fit/wechat/source-login-logo.png',
}))

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getCurrentPages: jest.fn(() => []),
    createSelectorQuery: () => ({
      select: () => ({
        fields: () => ({
          exec: (callback: (result: unknown[]) => void) => callback(mockCanvasAvailable
            ? [{ node: { width: 0, height: 0, getContext: () => mockContext().ctx } }]
            : [null]),
        }),
      }),
    }),
    canvasToTempFilePath: jest.fn(async () => ({ tempFilePath: 'wxfile://tmp/cover.jpg' })),
  },
}))

/** A 2D context that records text and measures each character as wide as the font size. */
function mockContext() {
  const texts: string[] = []
  const ctx = {
    font: '10px sans-serif',
    fillStyle: '',
    textAlign: 'left',
    measureText: (text: string) => ({ width: Array.from(text).length * Number(/(\d+)px/.exec(ctx.font)?.[1] || 10) }),
    fillText: (text: string) => { texts.push(text) },
    fillRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, arc() {}, closePath() {}, fill() {}, scale() {},
  }
  return { ctx, texts }
}

function shared(overrides: Partial<SharedFoodSpot> = {}): SharedFoodSpot {
  return { latitude: 31.2, longitude: 121.5, key: `food:${Math.random()}`, name: '好好面包', address: '人民路 1 号', ...overrides }
}

describe('drawn share card', () => {
  it('shows the place, one dish and its calories', () => {
    const { ctx, texts } = mockContext()
    drawFoodMapShareCover(ctx as unknown as CanvasRenderingContext2D, shared({ dish: '红豆面包', kcal: 320 }))
    expect(texts).toEqual(expect.arrayContaining(['食探美食图谱', '好', '好好面包', '红豆面包', '320', '千卡', '人民路 1 号']))
  })

  it('wraps a long name onto two lines and cuts the rest', () => {
    const { ctx, texts } = mockContext()
    drawFoodMapShareCover(ctx as unknown as CanvasRenderingContext2D, shared({ name: '老北京炸酱面馆二十四小时营业总店分店' }))
    expect(texts).toContain('老北京炸酱面馆二')
    expect(texts.some(text => text.endsWith('…') && text.startsWith('十四小时'))).toBe(true)
  })

  it('draws a general invitation when no spot is chosen', () => {
    const { ctx, texts } = mockContext()
    drawFoodMapShareCover(ctx as unknown as CanvasRenderingContext2D, null)
    expect(texts).toEqual(expect.arrayContaining(['一起点亮', '身边的好吃的']))
  })
})

describe('share content with a picture', () => {
  beforeEach(() => {
    mockCanvasAvailable = true
    ;(Taro.canvasToTempFilePath as jest.Mock).mockClear()
  })

  it('shares the real photo when the spot has one, without drawing', () => {
    const image = 'https://cdn-food-images.coachlink.fit/food/a.jpg'
    const message = foodMapShareWithCover(shared({ image }), 'share')
    expect(message.imageUrl).toBe(image)
    expect(message.promise).toBeUndefined()
    expect(Taro.canvasToTempFilePath).not.toHaveBeenCalled()
  })

  it('draws a card with the fetched calories, and reuses it on the next share', async () => {
    const spot = shared({ dish: '红豆面包' })
    const first = foodMapShareWithCover(spot, 'share', async () => 320)
    expect(first.imageUrl).toBe(LOGO)
    const resolved = await first.promise
    expect(resolved?.imageUrl).toBe('wxfile://tmp/cover.jpg')
    expect(resolved?.path).toContain('kcal=320')
    const second = foodMapShareWithCover(spot, 'share')
    expect(second).toMatchObject({ imageUrl: 'wxfile://tmp/cover.jpg' })
    expect(second.promise).toBeUndefined()
    expect(Taro.canvasToTempFilePath).toHaveBeenCalledTimes(1)
  })

  it('prefers a photo over a card drawn earlier for the same place, and redraws when the dish changes', async () => {
    const place = { key: 'food:31.20000:121.50000', name: '街角小馆' }
    await prepareFoodMapShareCover(shared(place))
    const image = 'https://cdn-food-images.coachlink.fit/food/c.jpg'
    expect(foodMapShareWithCover(shared({ ...place, image }), 'share').imageUrl).toBe(image)
    expect(foodMapShareWithCover(shared({ ...place, dish: '牛肉面' }), 'share').promise).toBeDefined()
  })

  it('still draws the card when the calories cannot be fetched', async () => {
    const cover = await prepareFoodMapShareCover(shared(), () => Promise.reject(new Error('offline')))
    expect(cover.imageUrl).toBe('wxfile://tmp/cover.jpg')
    expect(cover.spot?.kcal).toBeUndefined()
  })

  it('falls back to the app logo, never a map screenshot, when the canvas is missing', async () => {
    mockCanvasAvailable = false
    const message = foodMapShareWithCover(shared(), 'share')
    expect(message.imageUrl).toBe(LOGO)
    await expect(message.promise).resolves.toMatchObject({ imageUrl: LOGO })
  })
})
