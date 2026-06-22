import { getAccessToken, getRecommendMealType, type CanonicalMealType, type MealType } from './api'
import { getStoredRecordTargetDate } from './record-date'

type RoutineHourValue = unknown

export type MealTypeFromProfileInput = {
  routine_wake_hour?: RoutineHourValue
  routine_sleep_hour?: RoutineHourValue
  health_condition?: {
    routine_wake_hour?: RoutineHourValue
    routine_sleep_hour?: RoutineHourValue
    [key: string]: RoutineHourValue
  } | null
}

type NormalizedRoutineHour = number

/**
 * 根据用户设备本地时间推断默认餐次（常见中式划分，非 GPS 定位）。
 * 仅作分析/记录页的默认选中，用户可随时改选。
 *
 * 区间（闭开区间按分钟计）：
 * - 00:00–05:00 晚加餐（夜宵）
 * - 05:00–10:30 早餐
 * - 10:30–11:30 早加餐
 * - 11:30–14:30 午餐
 * - 14:30–17:00 午加餐
 * - 17:00–21:00 晚餐
 * - 21:00–24:00 晚加餐
 */
export function inferDefaultMealTypeFromLocalTime(date: Date = new Date()): CanonicalMealType {
  const minutes = date.getHours() * 60 + date.getMinutes()
  if (minutes < 5 * 60) {
    return 'evening_snack'
  }
  if (minutes < 10 * 60 + 30) {
    return 'breakfast'
  }
  if (minutes < 11 * 60 + 30) {
    return 'morning_snack'
  }
  if (minutes < 14 * 60 + 30) {
    return 'lunch'
  }
  if (minutes < 17 * 60) {
    return 'afternoon_snack'
  }
  if (minutes < 21 * 60) {
    return 'dinner'
  }
  return 'evening_snack'
}

const normalizeRoutineHour = (value: RoutineHourValue): NormalizedRoutineHour | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const next = Math.trunc(value)
    return next >= 0 && next <= 23 ? next : undefined
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) {
      const next = Math.trunc(parsed)
      return next >= 0 && next <= 23 ? next : undefined
    }
  }
  return undefined
}

/**
 * 按用户作息（wake/sleep）推断默认餐次。
 * 规则：起床后 3 小时内认为是早餐，起床后 8 小时内认为是午餐，睡前 4 小时内认为是晚餐，其余视作加餐。
 */
export function inferDefaultMealTypeFromRoutine(
  wakeHour: RoutineHourValue,
  sleepHour: RoutineHourValue,
  date: Date = new Date(),
): CanonicalMealType {
  const wake = normalizeRoutineHour(wakeHour)
  const sleep = normalizeRoutineHour(sleepHour)

  if (wake == null || sleep == null || wake === sleep) {
    return inferDefaultMealTypeFromLocalTime(date)
  }

  const hour = date.getHours()
  const hoursSinceWake = (hour - wake + 24) % 24
  if (hoursSinceWake <= 3) {
    return 'breakfast'
  }
  if (hoursSinceWake <= 8) {
    return 'lunch'
  }

  const hoursUntilSleep = (sleep - hour + 24) % 24
  if (hoursUntilSleep <= 4) {
    return 'dinner'
  }

  return 'afternoon_snack'
}

/**
 * 从 HealthProfile（含嵌套 health_condition）直接推断默认餐次。
 * 若作息字段不完整则回退为本地时段逻辑。
 */
export function inferDefaultMealTypeFromHealthProfile(
  profile: MealTypeFromProfileInput | null | undefined,
  date: Date = new Date(),
): CanonicalMealType {
  if (!profile) {
    return inferDefaultMealTypeFromLocalTime(date)
  }

  const hc = profile.health_condition
  const profileWakeHour = normalizeRoutineHour(profile.routine_wake_hour)
  const profileSleepHour = normalizeRoutineHour(profile.routine_sleep_hour)
  const hcWakeHour = normalizeRoutineHour(hc?.routine_wake_hour)
  const hcSleepHour = normalizeRoutineHour(hc?.routine_sleep_hour)

  return inferDefaultMealTypeFromRoutine(
    hcWakeHour ?? profileWakeHour,
    hcSleepHour ?? profileSleepHour,
    date,
  )
}

function isCanonicalMealType(value: string): value is CanonicalMealType {
  return ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'].includes(value)
}

function normalizeMealTypeToCanonical(value: MealType | string | undefined | null): CanonicalMealType {
  if (!value) return inferDefaultMealTypeFromLocalTime()
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'snack') return 'afternoon_snack'
  if (isCanonicalMealType(normalized)) return normalized
  return inferDefaultMealTypeFromLocalTime()
}

/**
 * 优先从后端获取推荐餐次，失败或未登录时回退到本地推断。
 * 后端已结合作息与当天已有记录做顺延推理。
 */
export async function getRecommendedMealTypeWithFallback(options?: {
  date?: string
  profile?: MealTypeFromProfileInput | null
}): Promise<CanonicalMealType> {
  if (getAccessToken()) {
    try {
      const date = options?.date ?? getStoredRecordTargetDate()
      const result = await getRecommendMealType({ date })
      return normalizeMealTypeToCanonical(result.meal_type)
    } catch (error) {
      console.warn('后端推荐餐次失败，回退本地推断:', error)
    }
  }
  return inferDefaultMealTypeFromHealthProfile(options?.profile)
}
