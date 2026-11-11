import type { FoodRecord } from '../../src/utils/api'
import { computePhotoPosterHeight, drawPhotoRecordPoster } from '../../src/utils/photo-record-poster'

const record: FoodRecord = {
  id: 'poster-ratio-fixture', user_id: 'fixture', meal_type: 'breakfast', items: [],
  total_calories: 636, total_protein: 26.6, total_carbs: 64, total_fat: 33.4,
  total_weight_grams: 320, record_time: '2026-10-25T08:00:00+08:00', created_at: '',
}

function render(width: number, height: number, labels: 'nutrients' | 'calories' = 'nutrients') {
  const calls: Record<string, jest.Mock> = {
    measureText: jest.fn((text: string) => ({ width: text.length * 7 })),
  }
  const ctx = new Proxy({}, {
    get: (_, name: string) => calls[name] ?? (calls[name] = jest.fn()),
    set: () => true,
  }) as CanvasRenderingContext2D
  const image = { width, height }
  const posterHeight = computePhotoPosterHeight(image, 375)
  drawPhotoRecordPoster(ctx, { width: 375, height: posterHeight, image, record, labels })
  return { calls, posterHeight, photo: calls.drawImage.mock.calls[0] as number[] }
}

describe('photo poster orientation', () => {
  it.each([[540, 1200], [1080, 2400], [540, 720], [800, 1000]])(
    'keeps a compact 3:4 photo area for portrait %i × %i', (width, height) => {
      const { photo, posterHeight } = render(width, height)
      const [, sx, sy, sw, sh, dx, dy, dw, dh] = photo
      expect(posterHeight).toBeLessThan(750)
      expect(dw / dh).toBeCloseTo(3 / 4, 2)
      expect(sw / sh).toBeCloseTo(dw / dh, 2)
      expect(sx).toBeGreaterThanOrEqual(0)
      expect(sy).toBeGreaterThanOrEqual(0)
      expect(sx + sw).toBeLessThanOrEqual(width + 0.001)
      expect(sy + sh).toBeLessThanOrEqual(height + 0.001)
      expect(dx).toBeGreaterThan(0)
      expect(dy).toBeGreaterThan(0)
      expect(dy + dh).toBeLessThan(posterHeight)
    },
  )

  it('preserves the whole photo for a native 3:4 portrait', () => {
    const { photo } = render(540, 720)
    expect(photo.slice(1, 5)).toEqual([0, 0, 540, 720])
  })

  it.each(['calories', 'nutrients'] as const)('puts %s labels below the portrait photo', labels => {
    const { calls, photo } = render(540, 1200, labels)
    const photoTop = photo[6]
    const photoBottom = photoTop + photo[8]
    const texts = calls.fillText.mock.calls as [string, number, number][]
    expect(texts.find(([text]) => text.includes('早餐'))![2]).toBeLessThan(photoTop)
    expect(texts.find(([text]) => text === '636')![2]).toBeGreaterThan(photoBottom)
    if (labels === 'nutrients') {
      expect(texts.find(([text]) => text.startsWith('蛋白质'))![2]).toBeGreaterThan(photoBottom)
    }
  })

  it.each([[1200, 900], [1600, 900], [540, 540]])(
    'preserves landscape or square composition for %i × %i', (width, height) => {
      const { photo, posterHeight } = render(width, height)
      expect(photo).toHaveLength(5)
      expect(photo.slice(1, 3)).toEqual([0, 0])
      expect(photo[3] / photo[4]).toBeCloseTo(width / height, 2)
      expect(posterHeight).toBeGreaterThan(photo[4])
    },
  )
})
