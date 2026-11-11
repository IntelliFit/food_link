import Taro from '@tarojs/taro'
import { captureAuthSession, advanceAuthSession } from '../../src/utils/auth-session'
import { getHomeDashboard, getExerciseLogs } from '../../src/utils/api'
import {
  refreshHomeDashboardLocalSnapshotFromCloud,
  saveHomeDashboardSnapshot,
  getStoredHomeDashboardSnapshots,
  HOME_DASHBOARD_LOCAL_CACHE_KEY,
  type HomeDashboardLocalSnapshot,
} from '../../src/utils/home-dashboard-local-cache'

jest.mock('../../src/utils/api', () => ({
  getAccessToken: () => Taro.getStorageSync('access_token'),
  getHomeDashboard: jest.fn(),
  getExerciseLogs: jest.fn(),
  mapCalendarDateToApi: (date: string) => date,
}))

const date = '2026-11-10'
const snapshot = (meal = 'A private meal'): HomeDashboardLocalSnapshot => ({
  date, updatedAt: 1, intakeData: { current: 800 } as any, meals: [{ name: meal }] as any,
  expirySummary: { pendingCount: 0, soonCount: 0, overdueCount: 0, items: [] },
  exerciseBurnedKcal: 0, achievement: { streak_days: 0, green_days: 0 },
})

describe('home dashboard cache request ownership', () => {
  const storage = new Map<string, unknown>()
  function login(id: string) {
    storage.set('user_id', id)
    storage.set('access_token', `token-${id}`)
    advanceAuthSession()
  }
  beforeEach(() => {
    jest.clearAllMocks()
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
    login('A')
    ;(getExerciseLogs as jest.Mock).mockResolvedValue({ total_calories: 0 })
  })

  it.each(['B', 'A-again'])('discards pending A data after changing session to %s', async next => {
    let resolve!: (value: any) => void
    ;(getHomeDashboard as jest.Mock).mockReturnValue(new Promise(yes => { resolve = yes }))
    const pending = refreshHomeDashboardLocalSnapshotFromCloud(date)
    login('B')
    if (next === 'A-again') login('A')
    saveHomeDashboardSnapshot(snapshot('new session meal'))
    resolve({ ...snapshot(), exerciseBurnedKcal: 0 })
    await expect(pending).resolves.toBe(false)
    expect(getStoredHomeDashboardSnapshots()[0].meals[0].name).toBe('new session meal')
  })

  it('saves current-session data with a schema and the correct owner', async () => {
    ;(getHomeDashboard as jest.Mock).mockResolvedValue(snapshot())
    await expect(refreshHomeDashboardLocalSnapshotFromCloud(date)).resolves.toBe(true)
    expect(storage.get(HOME_DASHBOARD_LOCAL_CACHE_KEY)).toEqual([
      expect.objectContaining({ user_id: 'A', schema_version: 5 }),
    ])
  })

  it('writer refuses an explicit foreign owner and an expired session', () => {
    saveHomeDashboardSnapshot({ ...snapshot(), user_id: 'B' })
    expect(storage.has(HOME_DASHBOARD_LOCAL_CACHE_KEY)).toBe(false)
    const owner = captureAuthSession()
    login('B')
    saveHomeDashboardSnapshot(snapshot(), owner)
    expect(storage.has(HOME_DASHBOARD_LOCAL_CACHE_KEY)).toBe(false)
  })

  it('does not expose potentially mislabelled legacy snapshots', () => {
    storage.set(HOME_DASHBOARD_LOCAL_CACHE_KEY, [{ ...snapshot(), user_id: 'A' }])
    expect(getStoredHomeDashboardSnapshots()).toEqual([])
  })
})
