import { readFileSync } from 'fs'
import { join } from 'path'
import Taro from '@tarojs/taro'

import {
  getWaterLogItems,
  isEditableWaterLog,
  isFoodDerivedWaterLog,
} from '../../src/packageExtra/pages/body-metrics-shared'
import { clearWaterFromBodyMetricsStorage } from '../../src/utils/home-dashboard-local-cache'

const storage = new Map<string, unknown>()

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8')
}

describe('dietary water is a read-only derived record', () => {
  beforeEach(() => {
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => storage.set(key, value))
    storage.set('user_id', 'user-1')
  })

  it('preserves source metadata and identifies current and legacy food-derived logs', () => {
    const logs = getWaterLogItems({
      date: '2026-09-28',
      total: 560,
      logs: [250, 180, 90, 40],
      log_items: [
        { id: 'manual', date: '2026-09-28', amount_ml: 250, source_type: 'manual' },
        { id: 'food', date: '2026-09-28', amount_ml: 180, source_type: 'ai_food_record:record-1' },
        { id: 'legacy-food', date: '2026-09-28', amount_ml: 90, source_type: 'ai' },
        { id: 'unknown', date: '2026-09-28', amount_ml: 40, source_type: 'future-source' },
      ],
    })

    expect(isFoodDerivedWaterLog(logs[0])).toBe(false)
    expect(isFoodDerivedWaterLog(logs[1])).toBe(true)
    expect(isFoodDerivedWaterLog(logs[2])).toBe(true)
    expect(isEditableWaterLog(logs[0])).toBe(true)
    expect(isEditableWaterLog(logs[1])).toBe(false)
    expect(isEditableWaterLog(logs[3])).toBe(false)
  })

  it('clears editable water from local cache while retaining dietary water', () => {
    storage.set('body_metrics_storage', {
      userId: 'user-1',
      weightEntries: [],
      waterGoalMl: 2000,
      waterByDate: {
        '2026-09-28': {
          date: '2026-09-28',
          total: 520,
          logs: [210, 180, 90, 40],
          log_items: [
            { id: 'manual', date: '2026-09-28', amount_ml: 210, source_type: 'manual' },
            { id: 'food', date: '2026-09-28', amount_ml: 180, source_type: 'ai_food_record:record-1' },
            { id: 'legacy-food', date: '2026-09-28', amount_ml: 90, source_type: 'ai' },
            { id: 'unknown', date: '2026-09-28', amount_ml: 40, source_type: 'future-source' },
          ],
        },
      },
    })

    clearWaterFromBodyMetricsStorage('2026-09-28')

    expect(storage.get('body_metrics_storage')).toEqual(expect.objectContaining({
      waterByDate: {
        '2026-09-28': expect.objectContaining({
          total: 310,
          logs: [180, 90, 40],
          log_items: [
            expect.objectContaining({ id: 'food', source_type: 'ai_food_record:record-1' }),
            expect.objectContaining({ id: 'legacy-food', source_type: 'ai' }),
            expect.objectContaining({ id: 'unknown', source_type: 'future-source' }),
          ],
        }),
      },
    }))
  })

  it('labels derived water, hides its delete action, and names manual clearing clearly', () => {
    const recordSource = readSource('packageExtra/pages/water-record/index.tsx')
    const trendSource = readSource('packageExtra/pages/water-trend/index.tsx')
    expect(recordSource).toContain('饮食含水')
    expect(recordSource).toContain('清空手动饮水')
    expect(recordSource).toContain("isFoodDerivedWaterLog(item)")
    expect(recordSource).toContain("isEditableWaterLog(item)")
    expect(trendSource).toContain('饮食含水')
    expect(trendSource).toContain("isFoodDerivedWaterLog(item)")
    expect(trendSource).toContain("isEditableWaterLog(item)")
  })
})
