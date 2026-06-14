import type { CanonicalMealType } from './types'

/**
 * 根据设备本地时间推断默认餐次，作为分析/记录页默认选中项。
 */
export function inferDefaultMealTypeFromLocalTime(date: Date = new Date()): CanonicalMealType {
  const minutes = date.getHours() * 60 + date.getMinutes()
  if (minutes < 5 * 60) return 'evening_snack'
  if (minutes < 10 * 60 + 30) return 'breakfast'
  if (minutes < 11 * 60 + 30) return 'morning_snack'
  if (minutes < 14 * 60 + 30) return 'lunch'
  if (minutes < 17 * 60) return 'afternoon_snack'
  if (minutes < 21 * 60) return 'dinner'
  return 'evening_snack'
}

export const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '加餐',
}

export function getMealTypeLabel(value?: string | null): string {
  return MEAL_TYPE_LABELS[String(value || '')] || '餐食'
}
