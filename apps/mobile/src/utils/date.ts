export function todayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatShortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return month && day ? `${Number(month)}月${Number(day)}日` : dateKey
}

export function formatDateTime(value?: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace('T', ' ')
  const now = new Date()
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate()
  const time = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `今天 ${time}`
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${time}`
}
