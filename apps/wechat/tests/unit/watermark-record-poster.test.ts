import type { FoodRecord } from '../../src/utils/api'
import {
  computeWatermarkPosterHeight, drawWatermarkRecordPoster, WATERMARK_STRIP_HEIGHT,
} from '../../src/utils/watermark-record-poster'

function mockCtx() {
  const texts: Array<{ text: string; x: number; y: number }> = []
  const images: unknown[][] = []
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    drawImage: jest.fn((...args: unknown[]) => { images.push(args) }),
    fillText: jest.fn((text: string, x: number, y: number) => { texts.push({ text, x, y }) }),
    // 中文按 10px、其它字符按 5px 估算，足以检验布局与截断。
    measureText: jest.fn((text: string) => ({
      width: Array.from(text).reduce((sum, c) => sum + (/[一-鿿]/.test(c) ? 10 : 5), 0),
    })),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, images }
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

describe('watermark record poster', () => {
  it('crops portrait photos to 3:4 and adds the info strip', () => {
    expect(computeWatermarkPosterHeight({ width: 1080, height: 2400 }, 375)).toBe(500 + WATERMARK_STRIP_HEIGHT)
  })

  it('keeps landscape photos at their own ratio', () => {
    expect(computeWatermarkPosterHeight({ width: 1600, height: 1200 }, 375)).toBe(281 + WATERMARK_STRIP_HEIGHT)
  })

  it('puts calories, macros, date and meal in the bottom strip only', () => {
    const { ctx, texts, images } = mockCtx()
    const height = 500 + WATERMARK_STRIP_HEIGHT
    drawWatermarkRecordPoster(ctx, {
      width: 375, height, image: { width: 1080, height: 2400 }, record, labels: 'nutrients',
      nickname: '小马哥', qrCodeImage: { width: 200, height: 200 },
    })
    const all = texts.map(t => t.text)
    expect(all).toContain('923.7')
    expect(all).toContain('蛋白 32g  碳水 89g  脂肪 40g')
    expect(all.some(t => t.startsWith('10.29  午餐'))).toBe(true)
    // 照片区不再叠任何文字或贴纸。
    expect(texts.every(t => t.y > 500)).toBe(true)
    // 照片铺满整宽；小程序码画在底栏右侧。
    expect(images[0].slice(5)).toEqual([0, 0, 375, 500])
    expect(images[1][1]).toBe(375 - 16 - 44)
  })

  it('shows the slogan instead of macros in calories-only mode', () => {
    const { ctx, texts } = mockCtx()
    drawWatermarkRecordPoster(ctx, {
      width: 375, height: 500 + WATERMARK_STRIP_HEIGHT, image: { width: 1080, height: 2400 }, record, labels: 'calories',
    })
    const all = texts.map(t => t.text)
    expect(all).toContain('好好吃饭，好好生活')
    expect(all.some(t => t.includes('蛋白'))).toBe(false)
  })

  it('truncates a long nickname so it never runs into the right column', () => {
    const { ctx, texts } = mockCtx()
    drawWatermarkRecordPoster(ctx, {
      width: 375, height: 500 + WATERMARK_STRIP_HEIGHT, image: { width: 1080, height: 2400 }, record, labels: 'nutrients',
      nickname: '一个非常非常非常非常非常长的昵称', qrCodeImage: { width: 200, height: 200 },
    })
    const meta = texts.find(t => t.text.startsWith('10.29'))
    expect(meta?.text.endsWith('…')).toBe(true)
  })
})
