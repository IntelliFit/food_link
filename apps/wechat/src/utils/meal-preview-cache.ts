import Taro from '@tarojs/taro'
import type { DietRecommendationResult, FoodRecord } from './api'

// The home "next meal" card keeps its last answer on the phone so a cold start
// shows something at once, then refreshes it. Entries are per account, meal
// and day; anything else is ignored.
const CACHE_PREFIX = 'next-meal-preview:v1:'
const MAX_CACHE_CHARS = 300_000

type CacheEntry = { owner: string; result: DietRecommendationResult; savedAt: number }

// A short, stable tag for the signed-in account; the token itself is not stored again.
export function ownerTag(token: string): string {
  let hash = 5381
  for (let i = 0; i < token.length; i += 1) hash = ((hash << 5) + hash + token.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

export function mealPreviewCacheKey(mealType: string, date: string): string {
  return `${CACHE_PREFIX}${mealType}:${date}`
}

export function readMealPreviewCache(token: string, mealType: string, date: string): DietRecommendationResult | undefined {
  if (!token) return undefined
  try {
    const entry = Taro.getStorageSync(mealPreviewCacheKey(mealType, date)) as CacheEntry | ''
    if (!entry || entry.owner !== ownerTag(token) || !Array.isArray(entry.result?.recommendations)) return undefined
    return entry.result.recommendations.length ? entry.result : undefined
  } catch {
    return undefined
  }
}

export function writeMealPreviewCache(token: string, mealType: string, date: string, result: DietRecommendationResult, now = Date.now()): void {
  if (!token || !result.recommendations?.length) return
  try {
    const entry: CacheEntry = { owner: ownerTag(token), result, savedAt: now }
    if (JSON.stringify(entry).length > MAX_CACHE_CHARS) return
    Taro.setStorageSync(mealPreviewCacheKey(mealType, date), entry)
  } catch {
    // A full or unavailable storage only costs the instant start.
  }
}

// Decides what the card shows when the model's pick arrives after the rule pick.
// Untouched card: take the model's answer. Once the user has moved to another
// option, keep their place: switch only if that option is in the model's answer.
export function mergeJudgedPreview(
  judged: DietRecommendationResult,
  interacted: boolean,
  selectedSourceId?: string,
): { result: DietRecommendationResult; selected: number } | undefined {
  if (!Array.isArray(judged.recommendations) || !judged.recommendations.length) return undefined
  if (!interacted) return { result: judged, selected: 0 }
  const index = judged.recommendations.findIndex(item => !!selectedSourceId && item.source_id === selectedSourceId)
  if (index < 0) return undefined
  return { result: judged, selected: index }
}

// Recent records of this meal, newest first, as a stand-in when nothing can be recommended.
export function recentMealRecords(records: FoodRecord[], mealType: string, limit = 3): FoodRecord[] {
  return records
    .filter(record => record.meal_type === mealType && (record.description || record.items?.length))
    .sort((a, b) => (b.record_time || '').localeCompare(a.record_time || ''))
    .slice(0, limit)
}

export function recordMealName(record: FoodRecord): string {
  const names = (record.items || []).map(item => item.name || '').filter(Boolean)
  return names.slice(0, 3).join('、') || (record.description || '').slice(0, 24) || '一餐记录'
}
