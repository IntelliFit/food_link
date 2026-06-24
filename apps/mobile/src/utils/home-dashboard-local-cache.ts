import AsyncStorage from '@react-native-async-storage/async-storage'
import { todayKey } from './date'
import {
  type HomeAchievement,
  type HomeDashboard,
  type HomeFoodExpirySummary,
  type HomeIntakeData,
  type HomeMealItem,
  type HomeMealRecordEntry,
  type HomeNutritionTarget,
} from '@food-link/core'
import { apiClient } from '../api'

export const HOME_DASHBOARD_LOCAL_CACHE_KEY = 'home_dashboard_local_cache'
export const HOME_DASHBOARD_LOCAL_CACHE_LIMIT = 14

export interface HomeDashboardLocalSnapshot {
  date: string
  updatedAt: number
  intakeData: HomeIntakeData
  meals: HomeMealItem[]
  expirySummary: HomeFoodExpirySummary
  exerciseBurnedKcal: number
  achievement: HomeAchievement
  nutritionTarget?: HomeNutritionTarget | null
}

function parseExerciseBurnedKcal(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = parseFloat(raw.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function mergeExerciseKcalFromDashboardAndLogs(dashboardRaw: unknown, logsTotal: unknown): number {
  const dashboard = parseExerciseBurnedKcal(dashboardRaw)
  const fromLogs = typeof logsTotal === 'number' && Number.isFinite(logsTotal)
    ? logsTotal
    : typeof logsTotal === 'string'
      ? parseFloat(logsTotal.trim())
      : NaN
  if (Number.isFinite(fromLogs)) {
    return Math.max(dashboard, fromLogs)
  }
  return dashboard
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stripMealFullRecords(meals: HomeMealItem[]): HomeMealItem[] {
  return (meals || []).map((meal) => ({
    ...meal,
    meal_record_entries:
      meal.meal_record_entries?.map((entry) => {
        if (!isObject(entry)) return entry
        const { full_record: _fullRecord, ...rest } = entry as HomeMealRecordEntry & { full_record?: unknown }
        return rest as HomeMealRecordEntry
      }) || null,
  }))
}

function readSnapshotsSync(raw: unknown): HomeDashboardLocalSnapshot[] {
  if (!Array.isArray(raw)) return []
  const normalized = raw
    .filter((item): item is HomeDashboardLocalSnapshot => {
      return (
        isObject(item) &&
        typeof item.date === 'string' &&
        item.date.length > 0 &&
        Array.isArray(item.meals) &&
        isObject(item.intakeData) &&
        isObject(item.expirySummary)
      )
    })
    .map((item) => ({
      ...item,
      meals: stripMealFullRecords(item.meals || []),
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, HOME_DASHBOARD_LOCAL_CACHE_LIMIT)
  return normalized
}

export async function getStoredHomeDashboardSnapshots(): Promise<HomeDashboardLocalSnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(HOME_DASHBOARD_LOCAL_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return readSnapshotsSync(parsed)
  } catch {
    return []
  }
}

export async function getStoredHomeDashboardSnapshotByDate(
  date: string,
): Promise<HomeDashboardLocalSnapshot | null> {
  const snapshots = await getStoredHomeDashboardSnapshots()
  return snapshots.find((item) => item.date === date) || null
}

export async function saveHomeDashboardSnapshot(snapshot: HomeDashboardLocalSnapshot): Promise<void> {
  const cleaned = {
    ...snapshot,
    meals: stripMealFullRecords(snapshot.meals || []),
  }
  const all = await getStoredHomeDashboardSnapshots()
  const next = [cleaned, ...all.filter((item) => item.date !== cleaned.date)]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, HOME_DASHBOARD_LOCAL_CACHE_LIMIT)
  await AsyncStorage.setItem(HOME_DASHBOARD_LOCAL_CACHE_KEY, JSON.stringify(next))
}

export async function refreshHomeDashboardLocalSnapshotFromCloud(
  calendarDate: string,
): Promise<boolean> {
  try {
    const [dashboardData, exerciseLogsData] = await Promise.all([
      apiClient.getHomeDashboard(calendarDate),
      apiClient.getExerciseLogs({ date: calendarDate }).catch(() => null),
    ])
    const data = dashboardData as HomeDashboard
    const exerciseBurnedKcal = mergeExerciseKcalFromDashboardAndLogs(
      data.exerciseBurnedKcal,
      exerciseLogsData?.total_calories,
    )
    await saveHomeDashboardSnapshot({
      date: calendarDate,
      updatedAt: Date.now(),
      intakeData: data.intakeData,
      meals: data.meals || [],
      expirySummary: data.expirySummary || { active_count: 0, expired_count: 0, today_count: 0, soon_count: 0, preview_items: [] },
      exerciseBurnedKcal,
      achievement: data.achievement || { streak_days: 0, green_days: 0 },
      nutritionTarget: data.nutritionTarget || null,
    })
    return true
  } catch {
    return false
  }
}

/**
 * 当本地快照不足时，后台并行补齐接近 7 天。
 */
export async function ensureHomeDashboardCache(): Promise<void> {
  const snapshots = await getStoredHomeDashboardSnapshots()
  if (snapshots.length >= 7) return

  const today = new Date()
  const missingDates: string[] = []
  for (let i = -6; i <= 0; i += 1) {
    const date = new Date(today)
    date.setDate(today.getDate() + i)
    const dateKey = todayKey(date)
    if (!snapshots.some((item) => item.date === dateKey)) {
      missingDates.push(dateKey)
    }
  }
  if (missingDates.length === 0) return

  await Promise.allSettled(missingDates.map((dateKey) => refreshHomeDashboardLocalSnapshotFromCloud(dateKey)))
}

export function isHomeDashboardSnapshotFresh(snapshot: HomeDashboardLocalSnapshot | null, ttlMs: number): boolean {
  if (!snapshot) return false
  return Date.now() - (snapshot.updatedAt || 0) < ttlMs
}
