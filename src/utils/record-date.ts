import Taro from '@tarojs/taro'

export const RECORD_BACKFILL_WINDOW_DAYS = 3
export const RECORD_TARGET_DATE_STORAGE_KEY = 'recordTargetDate'

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(value?: string | null): Date | null {
  if (!value) return null
  const matched = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return null
  const [, yearText, monthText, dayText] = matched
  const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
  if (Number.isNaN(date.getTime())) return null
  if (formatDateKey(date) !== `${yearText}-${monthText}-${dayText}`) return null
  return date
}

export function getTodayRecordDateKey(): string {
  return formatDateKey(new Date())
}

export function listAllowedRecordDates(baseDate = new Date()): string[] {
  const dates: string[] = []
  for (let offset = 0; offset < RECORD_BACKFILL_WINDOW_DAYS; offset += 1) {
    const next = new Date(baseDate)
    next.setDate(baseDate.getDate() - offset)
    dates.push(formatDateKey(next))
  }
  return dates
}

export function isAllowedRecordDate(value?: string | null): boolean {
  if (!value) return false
  return listAllowedRecordDates().includes(String(value).trim())
}

export function normalizeRecordDate(value?: string | null): string {
  if (isAllowedRecordDate(value)) {
    return String(value).trim()
  }
  const parsed = parseDateKey(value)
  if (!parsed) return getTodayRecordDateKey()
  const normalized = formatDateKey(parsed)
  return isAllowedRecordDate(normalized) ? normalized : getTodayRecordDateKey()
}

export function isTodayRecordDate(value?: string | null): boolean {
  return normalizeRecordDate(value) === getTodayRecordDateKey()
}

export function persistRecordTargetDate(value?: string | null): string {
  const normalized = normalizeRecordDate(value)
  try {
    Taro.setStorageSync(RECORD_TARGET_DATE_STORAGE_KEY, normalized)
  } catch {
    // ignore storage failure
  }
  return normalized
}

export function getStoredRecordTargetDate(): string {
  try {
    return normalizeRecordDate(String(Taro.getStorageSync(RECORD_TARGET_DATE_STORAGE_KEY) || ''))
  } catch {
    return getTodayRecordDateKey()
  }
}

export function clearStoredRecordTargetDate(): void {
  try {
    Taro.removeStorageSync(RECORD_TARGET_DATE_STORAGE_KEY)
  } catch {
    // ignore storage failure
  }
}
