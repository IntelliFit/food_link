/**
 * 首页 dashboard 本地快照（v4）：与 `pages/index` 共用 storage。
 * 饮食记录保存成功后拉取当日 dashboard 写入缓存，回首页可先读到新摄入，无需等整页重拉。
 */
import Taro from '@tarojs/taro'
import {
  type FoodRecord,
  getAccessToken,
  getExerciseLogs,
  getHomeDashboard,
  mapCalendarDateToApi,
  type HomeAchievement,
  type HomeFoodExpirySummary,
  type HomeIntakeData,
  type HomeMealItem,
  type HomeMealRecordEntry,
  type SaveFoodRecordRequest
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

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '加餐',
}

const MEAL_TARGET_WEIGHTS: Record<string, number> = {
  breakfast: 3,
  lunch: 4,
  dinner: 3,
}

const DEFAULT_SNACK_TARGET_KCAL = 150

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

function clampNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function formatLocalTimeHHmm(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function deriveMealTargetKcal(mealType: string, intakeTarget: number, existingMeal?: HomeMealItem): number {
  const existingTarget = Number(existingMeal?.target)
  if (Number.isFinite(existingTarget) && existingTarget > 0) {
    return existingTarget
  }
  if (mealType in MEAL_TARGET_WEIGHTS) {
    const totalWeight = Object.values(MEAL_TARGET_WEIGHTS).reduce((sum, val) => sum + val, 0)
    if (intakeTarget > 0 && totalWeight > 0) {
      return Math.round((intakeTarget * MEAL_TARGET_WEIGHTS[mealType]) / totalWeight)
    }
  }
  return DEFAULT_SNACK_TARGET_KCAL
}

function buildOptimisticFoodRecord(
  payload: SaveFoodRecordRequest,
  recordId: string,
  createdAt = new Date()
): FoodRecord {
  return {
    id: recordId,
    user_id: '',
    meal_type: payload.meal_type,
    image_path: payload.image_path || null,
    image_paths: payload.image_paths || null,
    description: payload.description || null,
    insight: payload.insight || null,
    pfc_ratio_comment: payload.pfc_ratio_comment || null,
    absorption_notes: payload.absorption_notes || null,
    context_advice: payload.context_advice || null,
    items: payload.items.map((item) => ({
      name: item.name,
      weight: item.weight,
      ratio: item.ratio,
      intake: item.intake,
      nutrients: item.nutrients,
    })),
    total_calories: payload.total_calories,
    total_protein: payload.total_protein,
    total_carbs: payload.total_carbs,
    total_fat: payload.total_fat,
    total_weight_grams: payload.total_weight_grams,
    record_time: createdAt.toISOString(),
    created_at: createdAt.toISOString(),
    diet_goal: payload.diet_goal || null,
    activity_timing: payload.activity_timing || null,
    source_task_id: payload.source_task_id || null,
  }
}

export function applyOptimisticFoodRecordToHomeDashboardSnapshot(
  calendarDate: string,
  payload: SaveFoodRecordRequest,
  recordId: string
): boolean {
  const apiDate = mapCalendarDateToApi(calendarDate) || calendarDate
  const currentSnapshot = getStoredHomeDashboardSnapshotByDate(apiDate)
  if (!currentSnapshot) {
    return false
  }

  const now = new Date()
  const recordTitle =
    (payload.description || '').trim() ||
    String(payload.items?.[0]?.name || '').trim() ||
    MEAL_NAMES[payload.meal_type] ||
    '饮食记录'
  const recordTime = formatLocalTimeHHmm(now)
  const optimisticRecord = buildOptimisticFoodRecord(payload, recordId, now)
  const existingMealIndex = currentSnapshot.meals.findIndex((item) => item.type === payload.meal_type)
  const existingMeal = existingMealIndex >= 0 ? currentSnapshot.meals[existingMealIndex] : undefined

  const nextMealEntries: HomeMealRecordEntry[] = [
    {
      id: recordId,
      record_time: optimisticRecord.record_time,
      total_calories: payload.total_calories,
      title: recordTitle,
      full_record: optimisticRecord,
    },
    ...((existingMeal?.meal_record_entries || []).filter((entry) => String(entry?.id || '').trim() !== recordId)),
  ]

  const nextMealTarget = deriveMealTargetKcal(payload.meal_type, currentSnapshot.intakeData.target, existingMeal)
  const nextMealCalories = clampNumber((existingMeal?.calorie || 0) + payload.total_calories)
  const nextMealProtein = clampNumber((existingMeal?.protein || 0) + payload.total_protein)
  const nextMealCarbs = clampNumber((existingMeal?.carbs || 0) + payload.total_carbs)
  const nextMealFat = clampNumber((existingMeal?.fat || 0) + payload.total_fat)
  const nextMealProgress = nextMealTarget > 0 ? Number(((nextMealCalories / nextMealTarget) * 100).toFixed(1)) : 0
  const nextMeal: HomeMealItem = {
    type: payload.meal_type,
    name: recordTitle,
    time: recordTime,
    calorie: nextMealCalories,
    target: nextMealTarget,
    progress: nextMealProgress,
    tags: existingMeal?.tags || [],
    image_path: payload.image_path || payload.image_paths?.[0] || existingMeal?.image_path || null,
    image_paths: payload.image_paths || existingMeal?.image_paths || null,
    images: payload.image_paths || existingMeal?.images || null,
    primary_record_id: recordId,
    primaryRecordId: recordId,
    meal_record_entries: nextMealEntries,
    protein: nextMealProtein,
    carbs: nextMealCarbs,
    fat: nextMealFat,
    description: payload.description || existingMeal?.description || recordTitle,
  }

  const nextMeals =
    existingMealIndex >= 0
      ? currentSnapshot.meals.map((meal, index) => (index === existingMealIndex ? nextMeal : meal))
      : [nextMeal, ...currentSnapshot.meals]

  const nextIntakeCurrent = clampNumber(currentSnapshot.intakeData.current + payload.total_calories)
  const nextProteinCurrent = clampNumber(currentSnapshot.intakeData.macros.protein.current + payload.total_protein)
  const nextCarbsCurrent = clampNumber(currentSnapshot.intakeData.macros.carbs.current + payload.total_carbs)
  const nextFatCurrent = clampNumber(currentSnapshot.intakeData.macros.fat.current + payload.total_fat)
  const intakeTarget = clampNumber(currentSnapshot.intakeData.target)
  const nextIntakeData: HomeIntakeData = {
    ...currentSnapshot.intakeData,
    current: nextIntakeCurrent,
    progress: intakeTarget > 0 ? Number((nextIntakeCurrent / intakeTarget).toFixed(4)) : 0,
    macros: {
      protein: {
        ...currentSnapshot.intakeData.macros.protein,
        current: nextProteinCurrent,
      },
      carbs: {
        ...currentSnapshot.intakeData.macros.carbs,
        current: nextCarbsCurrent,
      },
      fat: {
        ...currentSnapshot.intakeData.macros.fat,
        current: nextFatCurrent,
      },
    },
  }

  saveHomeDashboardSnapshot({
    ...currentSnapshot,
    date: apiDate,
    updatedAt: Date.now(),
    intakeData: nextIntakeData,
    meals: nextMeals,
  })
  return true
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
