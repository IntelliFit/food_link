import type { CanonicalMealType } from './api'

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
