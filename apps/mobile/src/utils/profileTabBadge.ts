import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiClient } from '../api'

const BADGE_COUNT_KEY = 'mobile_profile_tab_badge_count'
const EXPIRY_COUNT_KEY = 'mobile_profile_tab_badge_expiry_count'
const FRIEND_COUNT_KEY = 'mobile_profile_tab_badge_friend_count'
const FRIEND_PENDING_IDS_KEY = 'mobile_profile_tab_badge_friend_pending_ids'
const FRIEND_SEEN_IDS_KEY = 'mobile_profile_tab_badge_friend_seen_ids'
const EXPIRY_LAST_SEEN_DATE_KEY = 'mobile_food_expiry_last_seen_date'

type Listener = (count: number) => void
const listeners = new Set<Listener>()

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseCount(value: string | null): number {
  const count = Number(value || 0)
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
}

function parseIdList(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

function publish(count: number): void {
  for (const listener of Array.from(listeners)) listener(count)
}

async function persistAndPublish(expiryCount: number, friendCount: number): Promise<number> {
  const total = Math.max(0, expiryCount) + Math.max(0, friendCount)
  await AsyncStorage.multiSet([
    [BADGE_COUNT_KEY, String(total)],
    [EXPIRY_COUNT_KEY, String(Math.max(0, expiryCount))],
    [FRIEND_COUNT_KEY, String(Math.max(0, friendCount))],
  ])
  publish(total)
  return total
}

export function onProfileTabBadgeChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function readProfileTabBadgeCount(): Promise<number> {
  return parseCount(await AsyncStorage.getItem(BADGE_COUNT_KEY))
}

export async function refreshProfileTabBadge(): Promise<number> {
  const [expiryResult, friendResult, cached] = await Promise.all([
    apiClient.getFoodExpiryDashboard().catch(() => null),
    apiClient.getFriendRequestsOverview().catch(() => null),
    AsyncStorage.multiGet([
      EXPIRY_COUNT_KEY,
      FRIEND_COUNT_KEY,
      FRIEND_SEEN_IDS_KEY,
      EXPIRY_LAST_SEEN_DATE_KEY,
    ]),
  ])
  const cachedValues = Object.fromEntries(cached)

  let expiryCount = parseCount(cachedValues[EXPIRY_COUNT_KEY] || null)
  if (expiryResult) {
    const expiryTodo = (expiryResult.expired_count || 0)
      + (expiryResult.today_count || 0)
      + (expiryResult.soon_count || 0)
    expiryCount = cachedValues[EXPIRY_LAST_SEEN_DATE_KEY] === todayKey() ? 0 : expiryTodo
  }

  let friendCount = parseCount(cachedValues[FRIEND_COUNT_KEY] || null)
  if (friendResult) {
    const pendingIds = (friendResult.received || [])
      .filter((item) => String(item.status || '').toLowerCase() === 'pending')
      .map((item) => String(item.id || '').trim())
      .filter(Boolean)
    const pendingSet = new Set(pendingIds)
    const seenIds = parseIdList(cachedValues[FRIEND_SEEN_IDS_KEY] || null)
      .filter((id) => pendingSet.has(id))
    const seenSet = new Set(seenIds)
    friendCount = pendingIds.filter((id) => !seenSet.has(id)).length
    await AsyncStorage.multiSet([
      [FRIEND_PENDING_IDS_KEY, JSON.stringify(pendingIds)],
      [FRIEND_SEEN_IDS_KEY, JSON.stringify(seenIds)],
    ])
  }

  return persistAndPublish(expiryCount, friendCount)
}

export async function markFoodExpiryBadgeSeen(): Promise<void> {
  const friendCount = parseCount(await AsyncStorage.getItem(FRIEND_COUNT_KEY))
  await AsyncStorage.setItem(EXPIRY_LAST_SEEN_DATE_KEY, todayKey())
  await persistAndPublish(0, friendCount)
}

export async function markFriendRequestsBadgeSeen(): Promise<void> {
  const [expiryCountRaw, pendingIdsRaw] = await Promise.all([
    AsyncStorage.getItem(EXPIRY_COUNT_KEY),
    AsyncStorage.getItem(FRIEND_PENDING_IDS_KEY),
  ])
  await AsyncStorage.setItem(FRIEND_SEEN_IDS_KEY, JSON.stringify(parseIdList(pendingIdsRaw)))
  await persistAndPublish(parseCount(expiryCountRaw), 0)
}
