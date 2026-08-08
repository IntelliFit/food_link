import AsyncStorage from '@react-native-async-storage/async-storage'

export const HOME_RECORD_BACKFILL_WINDOW_DAYS = 3
export const HOME_HEALTH_PROFILE_SNOOZE_DAYS = 7

const HEALTH_PROFILE_REMINDER_PREFIX = 'healthProfileReminderSnoozedUntil:'
const BACKFILL_DISMISSED_PREFIX = 'home_backfill_hint_dismissed_dates_v1:'
const HOME_RECORD_GUIDE_PREFIX = 'onboarding_home_record_guide_v1:user:'

function scopedKey(prefix: string, userId: string): string | null {
  const normalized = String(userId || '').trim()
  return normalized ? `${prefix}${encodeURIComponent(normalized)}` : null
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function listAllowedHomeRecordDates(baseDate = new Date()): string[] {
  return Array.from({ length: HOME_RECORD_BACKFILL_WINDOW_DAYS }, (_, index) => {
    const date = new Date(baseDate)
    date.setDate(baseDate.getDate() - index)
    return formatDateKey(date)
  })
}

export function isAllowedHomeRecordDate(date: string, baseDate = new Date()): boolean {
  return listAllowedHomeRecordDates(baseDate).includes(String(date || '').trim())
}

export async function isHealthProfileReminderSnoozed(userId: string, now = Date.now()): Promise<boolean> {
  const key = scopedKey(HEALTH_PROFILE_REMINDER_PREFIX, userId)
  if (!key) return false
  const value = Number(await AsyncStorage.getItem(key) || 0)
  return Number.isFinite(value) && value > now
}

export async function snoozeHealthProfileReminder(
  userId: string,
  days = HOME_HEALTH_PROFILE_SNOOZE_DAYS,
): Promise<void> {
  const key = scopedKey(HEALTH_PROFILE_REMINDER_PREFIX, userId)
  if (!key) return
  const snoozeDays = Math.max(1, Math.round(days))
  await AsyncStorage.setItem(key, String(Date.now() + snoozeDays * 24 * 60 * 60 * 1000))
}

export async function getDismissedHomeBackfillDates(userId: string): Promise<string[]> {
  const key = scopedKey(BACKFILL_DISMISSED_PREFIX, userId)
  if (!key) return []
  try {
    const value: unknown = JSON.parse(await AsyncStorage.getItem(key) || '[]')
    return Array.isArray(value)
      ? Array.from(new Set(value.filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))))
      : []
  } catch {
    return []
  }
}

export async function dismissHomeBackfillDate(userId: string, date: string): Promise<string[]> {
  const key = scopedKey(BACKFILL_DISMISSED_PREFIX, userId)
  if (!key) return []
  const current = await getDismissedHomeBackfillDates(userId)
  const next = Array.from(new Set([...current, date])).slice(-90)
  await AsyncStorage.setItem(key, JSON.stringify(next))
  return next
}

export async function isHomeRecordGuideCompleted(userId: string): Promise<boolean> {
  const key = scopedKey(HOME_RECORD_GUIDE_PREFIX, userId)
  return key ? (await AsyncStorage.getItem(key)) === 'true' : true
}

export async function markHomeRecordGuideCompleted(userId: string): Promise<void> {
  const key = scopedKey(HOME_RECORD_GUIDE_PREFIX, userId)
  if (key) await AsyncStorage.setItem(key, 'true')
}
