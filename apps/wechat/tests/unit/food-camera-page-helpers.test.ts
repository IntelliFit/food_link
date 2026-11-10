import {
  buildCameraEntryUrl,
  buildLoginRedirectUrl,
  formatCameraDateChip,
  resolveCameraRecordDate,
} from '../../src/packageCamera/pages/shoot/camera-entry'
import { computeCameraFrame } from '../../src/packageCamera/pages/shoot/frame-layout'
import { getTodayRecordDateKey, resolveNewRecordDate } from '../../src/utils/record-date'

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn(),
    showToast: jest.fn(),
  },
}))

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('camera frame layout', () => {
  it('keeps a 3:4 frame and fills the width on a tall phone', () => {
    const frame = computeCameraFrame({ windowWidth: 375, windowHeight: 812, topInset: 88, panelHeight: 210, orientation: 'portrait' })
    expect(frame.width).toBe(343)
    expect(frame.height).toBe(457)
  })

  it('shrinks the 3:4 frame by height on a short phone instead of overlapping the panel', () => {
    const frame = computeCameraFrame({ windowWidth: 375, windowHeight: 667, topInset: 64, panelHeight: 190, orientation: 'portrait' })
    expect(frame.height).toBeLessThanOrEqual(667 - 64 - 190 - 24)
    expect(Math.abs(frame.width / frame.height - 3 / 4)).toBeLessThan(0.01)
  })

  it('uses 4:3 for landscape shots', () => {
    const frame = computeCameraFrame({ windowWidth: 375, windowHeight: 812, topInset: 88, panelHeight: 210, orientation: 'landscape' })
    expect(frame.width).toBe(343)
    expect(Math.abs(frame.width / frame.height - 4 / 3)).toBeLessThan(0.01)
  })
})

describe('camera entry helpers', () => {
  it('defaults a new photo to today even if an old URL supplies a valid historical date', () => {
    expect(resolveCameraRecordDate(daysAgo(3))).toEqual({ date: getTodayRecordDateKey(), fellBackToToday: false, backfill: false })
    expect(resolveNewRecordDate(daysAgo(3))).toEqual(resolveCameraRecordDate(daysAgo(3)))
  })

  it('preserves a valid history date only after an explicit backfill choice', () => {
    expect(resolveCameraRecordDate(daysAgo(3), true)).toEqual({ date: daysAgo(3), fellBackToToday: false, backfill: true })
  })

  it('falls back to today, and says so, for dates outside the window', () => {
    expect(resolveCameraRecordDate(daysAgo(40), true)).toEqual({ date: getTodayRecordDateKey(), fellBackToToday: true, backfill: false })
    expect(resolveCameraRecordDate('')).toEqual({ date: getTodayRecordDateKey(), fellBackToToday: false, backfill: false })
    expect(resolveCameraRecordDate('not-a-date', true)).toEqual({ date: getTodayRecordDateKey(), fellBackToToday: true, backfill: false })
  })

  it('carries explicit backfill through the other new-record modes', () => {
    const date = daysAgo(2)
    expect(buildCameraEntryUrl('text', date, true)).toBe(`/packageExtra/pages/record-text/index?date=${date}&backfill=1`)
    expect(buildCameraEntryUrl('library', date, true)).toBe(`/packageExtra/pages/record-manual/index?date=${date}&backfill=1`)
    expect(buildCameraEntryUrl('favorites', date, true)).toBe(`/packageExtra/pages/recipes/index?date=${date}&backfill=1`)
    expect(buildCameraEntryUrl('history', date, true)).toBe(`/packageExtra/pages/analyze-history/index?date=${date}&backfill=1`)
  })

  it('does not turn a bare date into a backfill choice when changing record modes', () => {
    expect(buildCameraEntryUrl('text', daysAgo(2))).toBe(`/packageExtra/pages/record-text/index?date=${getTodayRecordDateKey()}`)
    expect(buildCameraEntryUrl('library', daysAgo(40), true)).toBe(`/packageExtra/pages/record-manual/index?date=${getTodayRecordDateKey()}`)
  })

  it('labels the date chip', () => {
    expect(formatCameraDateChip(getTodayRecordDateKey())).toBe('记到今天')
    expect(formatCameraDateChip('2026-11-06')).toBe('记到 11月6日')
  })

  it('sends guests to login and back to the camera', () => {
    expect(buildLoginRedirectUrl('/packageCamera/pages/shoot/index?date=2026-11-08'))
      .toBe('/packageExtra/pages/login/index?redirect=%2FpackageCamera%2Fpages%2Fshoot%2Findex%3Fdate%3D2026-11-08')
  })
})
