import type { FoodRecord } from '../../src/utils/api'
import {
  computeWatermarkPosterHeight, drawWatermarkRecordPoster, WATERMARK_STYLES, type WatermarkStyle,
} from '../../src/utils/watermark-record-poster'

function textWidth(text: string): number {
  // 中文按 10px、其它字符按 5px 估算，足以检验布局与截断。
  return Array.from(text).reduce((sum, c) => sum + (/[一-鿿]/.test(c) ? 10 : 5), 0)
}

function mockCtx() {
  const texts: Array<{ text: string; x: number; y: number }> = []
  const images: unknown[][] = []
  const gradient = { addColorStop: jest.fn() }
  const ctx = {
    font: '',
    fillStyle: '' as unknown,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    closePath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    quadraticCurveTo: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    createLinearGradient: jest.fn(() => gradient),
    drawImage: jest.fn((...args: unknown[]) => { images.push(args) }),
    fillText: jest.fn((text: string, x: number, y: number) => { texts.push({ text, x, y }) }),
    measureText: jest.fn((text: string) => ({ width: textWidth(text) })),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, texts, images }
}

const record = {
  id: 'r1',
  user_id: 'u1',
  meal_type: 'lunch',
  record_time: '2026-10-29T12:05:00',
  total_calories: 923.7,
  total_protein: 32.4,
  total_carbs: 88.6,
  total_fat: 40.2,
} as FoodRecord

const portrait = { width: 1080, height: 2400 }
const landscape = { width: 1600, height: 1200 }
const qr = { width: 200, height: 200 }
const ALL_STYLES = WATERMARK_STYLES.map(s => s.id)

function draw(style: WatermarkStyle, overrides: Partial<Parameters<typeof drawWatermarkRecordPoster>[1]> = {}) {
  const mock = mockCtx()
  const image = overrides.image ?? portrait
  drawWatermarkRecordPoster(mock.ctx, {
    style, width: 375, height: computeWatermarkPosterHeight(style, image, 375), image, record, labels: 'nutrients',
    nickname: '小马哥', qrCodeImage: qr, ...overrides,
  })
  return mock
}

describe('watermark record poster', () => {
  it('sizes each style from the photo: 3:4 for portrait, own ratio for landscape', () => {
    expect(computeWatermarkPosterHeight('strip', portrait, 375)).toBe(500 + 76)
    expect(computeWatermarkPosterHeight('strip', landscape, 375)).toBe(281 + 76)
    expect(computeWatermarkPosterHeight('overlay', portrait, 375)).toBe(500)
    expect(computeWatermarkPosterHeight('frame', portrait, 375)).toBe(14 + 463 + 96)
    expect(computeWatermarkPosterHeight('grid', landscape, 375)).toBe(14 + 260 + 118)
  })

  it.each(ALL_STYLES)('%s shows calories, macros, date, meal and the QR code', style => {
    const { texts, images } = draw(style)
    const all = texts.map(t => t.text)
    expect(all).toContain('923.7')
    expect(all.join(' ')).toMatch(/32g/)
    expect(all.join(' ')).toMatch(/89g/)
    expect(all.join(' ')).toMatch(/40g/)
    expect(all.some(t => t.startsWith('10.29  午餐'))).toBe(true)
    expect(images).toHaveLength(2)
    expect(images[1][0]).toBe(qr)
  })

  it.each(['strip', 'dark', 'frame', 'grid'] as WatermarkStyle[])('%s never draws text on the photo', style => {
    const { texts, images } = draw(style)
    const photoArgs = images[0] as number[]
    const photoBottom = photoArgs[6] + photoArgs[8]
    expect(texts.every(t => t.y > photoBottom)).toBe(true)
  })

  it('overlay keeps the photo height and fades the bottom so text stays readable', () => {
    const { raw, texts, images } = draw('overlay')
    expect(images[0].slice(5)).toEqual([0, 0, 375, 500])
    expect(raw.createLinearGradient).toHaveBeenCalled()
    expect(texts.every(t => t.y > 500 - 76)).toBe(true)
  })

  it.each(ALL_STYLES)('%s drops macros in calories-only mode', style => {
    const all = draw(style, { labels: 'calories' }).texts.map(t => t.text)
    expect(all).toContain('923.7')
    expect(all.join(' ')).not.toMatch(/蛋白|碳水|脂肪/)
  })

  it('the grid swaps macro columns for date and meal in calories-only mode', () => {
    const all = draw('grid', { labels: 'calories' }).texts.map(t => t.text)
    expect(all).toEqual(expect.arrayContaining(['热量', '日期', '10.29', '餐次', '午餐']))
  })

  it.each(ALL_STYLES)('%s truncates a long nickname', style => {
    const nickname = '一个非常非常非常非常非常非常非常非常非常非常长的昵称'
    const { texts } = draw(style, { nickname })
    expect(texts.some(t => t.text.includes(nickname))).toBe(false)
    expect(texts.some(t => t.text.endsWith('…'))).toBe(true)
  })

  it('keeps layout intact without a QR code or nickname', () => {
    ALL_STYLES.forEach(style => {
      const { images, texts } = draw(style, { qrCodeImage: null, nickname: undefined })
      expect(images).toHaveLength(1)
      expect(texts.map(t => t.text)).toContain('923.7')
    })
  })

  it('shows a dash instead of NaN for missing nutrition', () => {
    const { texts } = draw('grid', { record: { ...record, total_calories: undefined, total_protein: undefined } as unknown as FoodRecord })
    const all = texts.map(t => t.text)
    expect(all).toContain('—')
    expect(all.join(' ')).not.toMatch(/NaN/)
  })
})
