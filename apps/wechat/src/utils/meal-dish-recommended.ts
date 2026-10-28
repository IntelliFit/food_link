import Taro from '@tarojs/taro'

/** 首页推荐过的食堂菜：拍照识别时作为“是刚才推荐的这道吗？”一键确认的线索。 */
export type RecommendedKind = 'navigated' | 'chatted' | 'shown'

export interface RecommendedDish {
  item_id: string
  kind: RecommendedKind
  at: number
}

const STORAGE_KEY = 'meal_dish_recommended_v1'
/** 推荐之后多久内拍照还算“刚才推荐的”。 */
export const RECOMMENDED_TTL_MS = 3 * 60 * 60 * 1000
const STRENGTH: Record<RecommendedKind, number> = { shown: 1, chatted: 2, navigated: 3 }

function read(): RecommendedDish | null {
  try {
    const raw = Taro.getStorageSync(STORAGE_KEY)
    const value = typeof raw === 'string' && raw ? JSON.parse(raw) : raw
    if (!value?.item_id || !STRENGTH[value.kind as RecommendedKind] || !Number.isFinite(value.at)) return null
    return value as RecommendedDish
  } catch {
    return null
  }
}

/** 只记食堂菜（public_food_library）；在有效期内，“看过”不覆盖“导航过/问过”。 */
export function shouldReplace(current: RecommendedDish | null, next: RecommendedDish): boolean {
  if (!current || next.at - current.at > RECOMMENDED_TTL_MS) return true
  return STRENGTH[next.kind] >= STRENGTH[current.kind]
}

export function rememberRecommendedDish(source: string | undefined, itemId: string | undefined, kind: RecommendedKind, now = Date.now()): void {
  if (source !== 'public_food_library' || !itemId) return
  const next: RecommendedDish = { item_id: itemId, kind, at: now }
  try {
    if (shouldReplace(read(), next)) Taro.setStorageSync(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 本地存储失败只是少一个线索，不影响首页。
  }
}

export function recentRecommendedDish(now = Date.now()): RecommendedDish | null {
  const value = read()
  if (!value || now - value.at > RECOMMENDED_TTL_MS || value.at > now + 60_000) return null
  return value
}

export function clearRecommendedDish(): void {
  try {
    Taro.removeStorageSync(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
