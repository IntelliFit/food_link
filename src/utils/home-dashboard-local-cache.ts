/**
 * 首页 dashboard 本地快照（v4）：与 `pages/index` 共用 storage。
 * 饮食记录保存成功后拉取当日 dashboard 写入缓存，回首页可先读到新摄入，无需等整页重拉。
 */
import Taro from '@tarojs/taro'
import {
  getAccessToken,
  getExerciseLogs,
  getHomeDashboard,
  mapCalendarDateToApi,
  type HomeAchievement,
  type HomeFoodExpirySummary,
  type HomeIntakeData,
  type HomeMealItem,
  type HomeMealRecordEntry
} from './api'

export const HOME_DASHBOARD_LOCAL_CACHE_KEY = 'home_dashboard_local_cache_v4'
export const HOME_DASHBOARD_LOCAL_CACHE_LIMIT = 60

export interface HomeDashboardLocalSnapshot {
  date: string
  updatedAt: number
  intakeData: HomeIntakeData
  meals: HomeMealItem[]
  expirySummary: HomeFoodExpirySummary
  exerciseBurnedKcal: number
  achievement: HomeAchievement
}

export const DEFAULT_EXPIRY_SUMMARY: HomeFoodExpirySummary = {
  pendingCount: 0,
  soonCount: 0,
  overdueCount: 0,
  items: []
}

function parseExerciseBurnedKcal(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    const n = parseFloat(raw.trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** 与记运动页同源：合并 dashboard 与 exercise-logs，取较大值 */
function mergeExerciseKcalFromDashboardAndLogs(dashboardRaw: unknown, logsTotal: unknown): number {
  const dash = parseExerciseBurnedKcal(dashboardRaw)
  const fromLogs =
    typeof logsTotal === 'number' && Number.isFinite(logsTotal)
      ? logsTotal
      : typeof logsTotal === 'string'
        ? parseFloat(logsTotal.trim())
        : NaN
  if (Number.isFinite(fromLogs)) {
    return Math.max(dash, fromLogs)
  }
  return dash
}

/** 写入 storage 前去掉 full_record，减小体积并避免循环引用 */
export function stripMealFullRecords(meals: HomeMealItem[]): HomeMealItem[] {
  return meals.map((meal) => ({
    ...meal,
    meal_record_entries:
      meal.meal_record_entries?.map((entry) => {
        const { full_record: _fr, ...rest } = entry as HomeMealRecordEntry & { full_record?: unknown }
        return rest
      }) || null
  }))
}

export function getStoredHomeDashboardSnapshots(): HomeDashboardLocalSnapshot[] {
  try {
    const raw = Taro.getStorageSync(HOME_DASHBOARD_LOCAL_CACHE_KEY) as unknown
    if (!Array.isArray(raw)) return []
    const valid = raw
      .filter((item): item is HomeDashboardLocalSnapshot => {
        if (!item || typeof item !== 'object') return false
        const date = (item as { date?: unknown }).date
        if (typeof date !== 'string' || date.length === 0) return false
        return true
      })
      .map((item) => ({
        ...item,
        meals: stripMealFullRecords(item.meals || [])
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, HOME_DASHBOARD_LOCAL_CACHE_LIMIT)
    return valid
  } catch {
    return []
  }
}

export function getStoredHomeDashboardSnapshotByDate(date: string): HomeDashboardLocalSnapshot | null {
  const normalizedDate = mapCalendarDateToApi(date) || date
  const snapshots = getStoredHomeDashboardSnapshots()
  return snapshots.find((item) => item.date === normalizedDate) || null
}

export function saveHomeDashboardSnapshot(snapshot: HomeDashboardLocalSnapshot): void {
  const cleanedSnapshot = {
    ...snapshot,
    meals: stripMealFullRecords(snapshot.meals || [])
  }
  const current = getStoredHomeDashboardSnapshots().filter((item) => item.date !== cleanedSnapshot.date)
  const next = [cleanedSnapshot, ...current]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, HOME_DASHBOARD_LOCAL_CACHE_LIMIT)
  try {
    Taro.setStorageSync(HOME_DASHBOARD_LOCAL_CACHE_KEY, next)
  } catch {
    // ignore
  }
}

/**
 * 保存饮食记录成功后拉取当日 dashboard 并写入本地快照。
 * @param calendarDate `formatDateKey` 口径 YYYY-MM-DD
 */
export async function refreshHomeDashboardLocalSnapshotFromCloud(calendarDate: string): Promise<boolean> {
  if (!getAccessToken()) {
    return false
  }
  const apiDate = mapCalendarDateToApi(calendarDate) || calendarDate
  try {
    const [res, exerciseLogsRes] = await Promise.all([
      getHomeDashboard(calendarDate),
      getExerciseLogs({ date: calendarDate }).catch(() => null)
    ])
    const intake = res.intakeData
    const nextExerciseKcal = mergeExerciseKcalFromDashboardAndLogs(
      res.exerciseBurnedKcal,
      exerciseLogsRes?.total_calories
    )
    const nextAchievement = res.achievement ?? { streak_days: 0, green_days: 0 }
    saveHomeDashboardSnapshot({
      date: apiDate,
      updatedAt: Date.now(),
      intakeData: intake,
      meals: res.meals || [],
      expirySummary: res.expirySummary || DEFAULT_EXPIRY_SUMMARY,
      exerciseBurnedKcal: nextExerciseKcal,
      achievement: nextAchievement
    })
    return true
  } catch (e) {
    console.error('[home-dashboard-local-cache] refresh from cloud failed:', e)
    return false
  }
}
