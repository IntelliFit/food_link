import Taro from '@tarojs/taro'

export const PET_DAILY_PLAY_GOAL = 3

interface StoredPetPlayReward {
  version: 1
  completedDates: string[]
  totalStars: number
}

export interface PetPlayRewardSummary {
  streak: number
  totalStars: number
  badge: string
  completedToday: boolean
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function petPlayDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function petDailyPlayStorageKey(date = new Date()): string {
  const userId = String(Taro.getStorageSync('user_id') || 'guest').trim() || 'guest'
  return `home_pet_daily_play_v1:${userId}:${petPlayDateKey(date)}`
}

function historyStorageKey(): string {
  const userId = String(Taro.getStorageSync('user_id') || 'guest').trim() || 'guest'
  return `home_pet_play_reward_v1:${userId}`
}

function previousDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`)
  date.setDate(date.getDate() - 1)
  return petPlayDateKey(date)
}

function normalizeStored(value: unknown): StoredPetPlayReward {
  const raw = value && typeof value === 'object' ? value as Partial<StoredPetPlayReward> : {}
  const dates = Array.isArray(raw.completedDates)
    ? [...new Set(raw.completedDates.filter((date): date is string => typeof date === 'string' && DATE_PATTERN.test(date)))].sort().slice(-60)
    : []
  const totalStars = Number(raw.totalStars)
  return {
    version: 1,
    completedDates: dates,
    totalStars: Number.isFinite(totalStars) ? Math.max(dates.length, Math.floor(totalStars)) : dates.length,
  }
}

function badgeFor(totalStars: number): string {
  if (totalStars >= 30) return '健康守护者'
  if (totalStars >= 7) return '探索达人'
  if (totalStars >= 3) return '元气伙伴'
  if (totalStars >= 1) return '活力新芽'
  return '待解锁'
}

export function summarizePetPlayReward(stored: StoredPetPlayReward, today = petPlayDateKey()): PetPlayRewardSummary {
  const completed = new Set(stored.completedDates)
  const completedToday = completed.has(today)
  let cursor = completedToday ? today : previousDateKey(today)
  let streak = 0
  while (completed.has(cursor)) {
    streak += 1
    cursor = previousDateKey(cursor)
  }
  return {
    streak,
    totalStars: stored.totalStars,
    badge: badgeFor(stored.totalStars),
    completedToday,
  }
}

export function readPetPlayRewardSummary(): PetPlayRewardSummary {
  try {
    return summarizePetPlayReward(normalizeStored(Taro.getStorageSync(historyStorageKey())))
  } catch {
    return summarizePetPlayReward(normalizeStored(null))
  }
}

export function completePetPlayReward(): PetPlayRewardSummary {
  try {
    const key = historyStorageKey()
    const stored = normalizeStored(Taro.getStorageSync(key))
    const today = petPlayDateKey()
    if (!stored.completedDates.includes(today)) {
      stored.completedDates = [...stored.completedDates, today].sort().slice(-60)
      stored.totalStars += 1
      Taro.setStorageSync(key, stored)
    }
    return summarizePetPlayReward(stored, today)
  } catch {
    return readPetPlayRewardSummary()
  }
}
