import Taro from '@tarojs/taro'

const HEALTH_PROFILE_REMINDER_SNOOZE_KEY_PREFIX = 'healthProfileReminderSnoozedUntil'
const DEFAULT_SNOOZE_DAYS = 7

function getCurrentUserID(): string {
  try {
    return String(Taro.getStorageSync('user_id') || '').trim()
  } catch {
    return ''
  }
}

function getSnoozeKey(): string | null {
  const userID = getCurrentUserID()
  return userID ? `${HEALTH_PROFILE_REMINDER_SNOOZE_KEY_PREFIX}:${userID}` : null
}

/** 当前账号是否仍在健康档案提醒的暂缓期内。 */
export function isHealthProfileReminderSnoozed(): boolean {
  try {
    const key = getSnoozeKey()
    if (!key) return false
    return Number(Taro.getStorageSync(key) || 0) > Date.now()
  } catch {
    return false
  }
}

/** 仅对当前账号暂缓提醒；默认 7 天后恢复。 */
export function snoozeHealthProfileReminder(days = DEFAULT_SNOOZE_DAYS): void {
  try {
    const key = getSnoozeKey()
    if (!key) return
    Taro.setStorageSync(key, Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000)
  } catch {
    /* ignore */
  }
}
