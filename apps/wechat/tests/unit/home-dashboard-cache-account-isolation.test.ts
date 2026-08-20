import Taro from '@tarojs/taro'
import {
  getStoredHomeDashboardSnapshotByDate,
  getStoredHomeDashboardSnapshots,
  HOME_DASHBOARD_LOCAL_CACHE_KEY,
  saveHomeDashboardSnapshot,
  type HomeDashboardLocalSnapshot,
} from '../../src/utils/home-dashboard-local-cache'

const storage = new Map<string, unknown>()

function snapshot(date = '2026-08-20'): HomeDashboardLocalSnapshot {
  return {
    date,
    updatedAt: 1,
    intakeData: {
      current: 100,
      target: 2000,
      progress: 0.05,
      macros: {
        protein: { current: 10, target: 100 },
        carbs: { current: 20, target: 200 },
        fat: { current: 5, target: 60 },
      },
    },
    meals: [],
    expirySummary: { pendingCount: 0, soonCount: 0, overdueCount: 0, items: [] },
    exerciseBurnedKcal: 0,
    achievement: { streak_days: 0, green_days: 0 },
  }
}

describe('home dashboard cache account isolation', () => {
  beforeEach(() => {
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => storage.set(key, value))
    storage.set('user_id', 'user-a')
  })

  it('writes the current user id and only returns that user cache', () => {
    saveHomeDashboardSnapshot(snapshot())

    expect(storage.get(HOME_DASHBOARD_LOCAL_CACHE_KEY)).toEqual([
      expect.objectContaining({ user_id: 'user-a', date: '2026-08-20' }),
    ])
    expect(getStoredHomeDashboardSnapshotByDate('2026-08-20')).not.toBeNull()

    storage.set('user_id', 'user-b')
    expect(getStoredHomeDashboardSnapshots()).toEqual([])
    expect(getStoredHomeDashboardSnapshotByDate('2026-08-20')).toBeNull()
  })

  it('ignores legacy cache entries without an owner', () => {
    storage.set(HOME_DASHBOARD_LOCAL_CACHE_KEY, [snapshot()])
    expect(getStoredHomeDashboardSnapshots()).toEqual([])
  })
})
