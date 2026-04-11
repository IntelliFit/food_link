/**
 * 与后端 `list_food_records` 一致：按 Asia/Shanghai 自然日解析 `record_time`。
 * 避免设备本地时区与 UTC 导致「昨日」日期错一天，从而拉不到昨日同餐对比数据。
 */

/** 将任意可解析时间转为 `YYYY-MM-DD`（上海时区日历日） */
export function getChinaCalendarDateKey(isoOrTime: string): string {
  const d = new Date(isoOrTime)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (!y || !m || !day) return ''
  return `${y}-${m}-${day}`
}

/** 纯日历日加减（与 `YYYY-MM-DD` 语义一致，不涉夏令时） */
export function addCalendarDaysYmd(ymd: string, deltaDays: number): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  if (!y || !mo || !d) return ''
  const dt = new Date(Date.UTC(y, mo - 1, d))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  const y2 = dt.getUTCFullYear()
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d2 = String(dt.getUTCDate()).padStart(2, '0')
  return `${y2}-${m2}-${d2}`
}
