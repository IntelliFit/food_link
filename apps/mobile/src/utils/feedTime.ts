const CHINA_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000
const ISO_TIMEZONE_SUFFIX_RE = /(Z|[+-]\d{2}:?\d{2})$/i
const ISO_LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/

function parseFeedRecordTime(recordTime: string): Date | null {
  const raw = String(recordTime || '').trim()
  if (!raw) return null
  if (!ISO_TIMEZONE_SUFFIX_RE.test(raw)) {
    const localMatch = raw.match(ISO_LOCAL_DATETIME_RE)
    if (localMatch) {
      const [, year, month, day, hour, minute, second = '0'] = localMatch
      return new Date(Date.UTC(
        Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
      ) - CHINA_TIMEZONE_OFFSET_MS)
    }
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function chinaTimeParts(date: Date) {
  const shifted = new Date(date.getTime() + CHINA_TIMEZONE_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

export function formatFeedTime(recordTime: string, nowMs = Date.now()): string {
  const date = parseFeedRecordTime(recordTime)
  if (!date) return recordTime ? recordTime.slice(0, 16).replace('T', ' ') : ''
  const parts = chinaTimeParts(date)
  const now = chinaTimeParts(new Date(nowMs))
  const clock = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  const diff = nowMs - date.getTime()
  if (diff > -60000 && diff < 60000) return `刚刚 · ${clock}`
  if (diff >= 60000 && diff < 3600000) return `${Math.floor(diff / 60000)}分钟前 · ${clock}`
  if (diff >= 3600000 && diff < 86400000) return `${Math.floor(diff / 3600000)}小时前 · ${clock}`
  if (parts.year === now.year && parts.month === now.month && parts.day === now.day) return `今天 ${clock}`
  if (parts.year === now.year) return `${parts.month}月${parts.day}日 ${clock}`
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${clock}`
}
