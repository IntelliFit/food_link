import type { NutritionEvidenceGap } from '../../../utils/api'
import { weekDayLabels } from '../../../utils/nutrition-state-view'

/**
 * 完整分析页（「这一周吃得怎么样，先改哪一点」）的展示数据：只算文字和尺寸，不碰接口和存储。
 * 没数据显示「—」或整块不显示，不写成 0。
 */

export type StatsRange = 'week' | 'month'

/** 记满几天才出分（和后端 health_index.has_enough_data 一致） */
export const SCORE_MIN_DAYS = 2

type DateParts = { y: number; m: number; d: number }

function dateParts(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function periodWord(range: StatsRange): string {
  return range === 'week' ? '这一周' : '这个月'
}

/** "11月2日" */
export function monthDayText(value: string): string {
  const parts = dateParts(value)
  return parts ? `${parts.m}月${parts.d}日` : ''
}

/** 「这一周 · 11月2日–8日」；跨月写全「10月28日–11月3日」；日期不全只写「这一周」 */
export function rangeLabel(range: StatsRange, startDate: string, endDate: string): string {
  const head = periodWord(range)
  const start = dateParts(startDate)
  const end = dateParts(endDate)
  if (!start || !end) return head
  const to = start.y === end.y && start.m === end.m ? `${end.d}日` : `${end.m}月${end.d}日`
  return `${head} · ${start.m}月${start.d}日–${to}`
}

/** 「再记 1 天，这一周的分数就出来了」 */
export function gateHeadline(range: StatsRange, recordedDays: number): string {
  const days = Math.max(0, Math.floor(Number.isFinite(recordedDays) ? recordedDays : 0))
  const left = Math.max(1, SCORE_MIN_DAYS - days)
  return `再记 ${left} 天，${periodWord(range)}的分数就出来了`
}

/** 最近 7 天每天记没记（最右边是最后一天）；不足 7 天的前面补「没记」 */
export function recordedDayDots(daily: Array<{ calories: number }>, count = 7): boolean[] {
  const recent = daily.slice(-count).map(item => Number(item?.calories) > 0)
  return [...Array.from({ length: Math.max(0, count - recent.length) }, () => false), ...recent]
}

/** 「有 3 餐缺钠数据，分数可能偏高」；引擎没报缺钠就返回空 */
export function sodiumGapNote(gaps: NutritionEvidenceGap[]): string {
  const gap = gaps.find(item => item.key === 'sodium_unknown')
  if (!gap) return ''
  const count = /(\d+)\s*餐/.exec(gap.text)
  return count ? `有 ${count[1]} 餐缺钠数据，分数可能偏高` : '部分餐缺钠数据，分数可能偏高'
}

/** 「已记 6 天 · 15 餐 · 有 3 餐缺钠数据，分数可能偏高」；餐数不知道就不写餐 */
export function summaryNote(recordedDays: number, meals: number | null, gapNote = ''): string {
  const days = Math.max(0, Math.round(recordedDays))
  const parts = [meals !== null && meals >= 0 ? `已记 ${days} 天 · ${Math.round(meals)} 餐` : `已记 ${days} 天`]
  if (gapNote) parts.push(gapNote)
  return parts.join(' · ')
}

export type FocusPillTone = 'ok' | 'warn' | 'none'

/** 分数标签：60 分以上绿色，以下土黄，没分灰色「—」 */
export function focusPillTone(score: number | null): FocusPillTone {
  if (score === null || !Number.isFinite(score)) return 'none'
  return score >= 60 ? 'ok' : 'warn'
}

/** 「晚餐少喝汤，酱汁另放。这周…」→ 第一句加粗，其余跟在后面 */
export function splitAction(action: string): { lead: string; rest: string } {
  const textValue = String(action || '').trim()
  const end = textValue.search(/[。；;！？!?]/)
  if (end < 0 || end === textValue.length - 1) return { lead: textValue, rest: '' }
  return { lead: textValue.slice(0, end + 1), rest: textValue.slice(end + 1).trim() }
}

export type CalorieBarView = {
  key: string
  label: string
  /** 柱高占画图区的百分比；没记录为 0 */
  heightPct: number
  empty: boolean
  today: boolean
}

export type CalorieChartView = {
  bars: CalorieBarView[]
  /** 参考线离底部的百分比；没有参考消耗时为 null */
  referencePct: number | null
  referenceText: string
  averageText: string
  /** 一个月的柱子多，画细一点 */
  dense: boolean
}

const CHART_HEADROOM = 1.1
const MIN_VISIBLE_BAR_PCT = 3

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function monthBarLabel(date: string, index: number, total: number, today: string): string {
  if (date === today) return '今'
  // 从最后一天往回每 7 天标一个日子，避免 30 个数字挤在一起
  if ((total - 1 - index) % 7 !== 0) return ''
  const parts = dateParts(date)
  return parts ? String(parts.d) : ''
}

/** 热量柱：近一周 7 根，近一个月每天一根；参考线是估算消耗（TDEE） */
export function calorieChartView(input: {
  daily: Array<{ date: string; calories: number }>
  tdee: number
  avgCalories: number
  range: StatsRange
  today: string
}): CalorieChartView | null {
  const days = input.range === 'week' ? input.daily.slice(-7) : input.daily
  if (days.length === 0) return null
  const tdee = Number.isFinite(input.tdee) && input.tdee > 0 ? input.tdee : 0
  const calories = days.map(item => (Number.isFinite(Number(item.calories)) ? Math.max(0, Number(item.calories)) : 0))
  const scaleMax = Math.max(tdee, ...calories, 1) * CHART_HEADROOM
  const weekLabels = input.range === 'week' ? weekDayLabels(days.map(item => item.date), input.today) : []
  const bars = days.map((item, index) => {
    const value = calories[index]
    const empty = value <= 0
    return {
      key: item.date || String(index),
      label: input.range === 'week' ? weekLabels[index] : monthBarLabel(item.date, index, days.length, input.today),
      heightPct: empty ? 0 : Math.max(MIN_VISIBLE_BAR_PCT, clampPct(value / scaleMax * 100)),
      empty,
      today: item.date === input.today,
    }
  })
  const avg = Number.isFinite(input.avgCalories) ? input.avgCalories : 0
  return {
    bars,
    referencePct: tdee > 0 ? clampPct(tdee / scaleMax * 100) : null,
    referenceText: tdee > 0 ? `参考 ${Math.round(tdee)}` : '',
    averageText: avg > 0 ? `日均 ${Math.round(avg)} kcal` : '',
    dense: days.length > 10,
  }
}

export type MacroSplitView = { protein: number; carbs: number; fat: number }

/** 三大营养素的能量占比，合计凑成 100；都没有返回 null（不画比例条） */
export function macroSplit(percent: { protein: number; carbs: number; fat: number }): MacroSplitView | null {
  const values = [percent.protein, percent.carbs, percent.fat].map(value => (Number.isFinite(value) && value > 0 ? value : 0))
  const sum = values[0] + values[1] + values[2]
  if (sum <= 0) return null
  const protein = Math.round(values[0] / sum * 100)
  const carbs = Math.round(values[1] / sum * 100)
  return { protein, carbs, fat: Math.max(0, 100 - protein - carbs) }
}

export type WeightPointView = { key: string; x: number; y: number }
export type WeightSegmentView = { key: string; x: number; y: number; length: number; angle: number }

export type WeightTrendView = {
  valueText: string
  changeText: string
  countText: string
  points: WeightPointView[]
  segments: WeightSegmentView[]
}

/** 体重走势画在固定尺寸的框里（rpx），线段用旋转的 View 拼，不用 SVG */
export const WEIGHT_PLOT = { width: 320, height: 88, pad: 10 }

function signedKg(diff: number): string {
  const abs = Math.abs(Math.round(diff * 10) / 10).toFixed(1)
  return `${diff > 0 ? '+' : '−'}${abs} kg`
}

function changeText(baseline: { date: string; value: number }, latest: { value: number }): string {
  const diff = Math.round((latest.value - baseline.value) * 10) / 10
  const when = monthDayText(baseline.date)
  if (diff === 0) return `和${when}持平`
  return `比${when} ${signedKg(diff)}`
}

function plotPoints(entries: Array<{ date: string; value: number }>): WeightPointView[] {
  if (entries.length < 2) return []
  const values = entries.map(item => item.value)
  const min = Math.min(...values)
  const span = Math.max(...values) - min
  const { width, height, pad } = WEIGHT_PLOT
  return entries.map((item, index) => ({
    key: item.date,
    x: Math.round((pad + index / (entries.length - 1) * (width - pad * 2)) * 10) / 10,
    y: Math.round((span > 0 ? pad + (1 - (item.value - min) / span) * (height - pad * 2) : height / 2) * 10) / 10,
  }))
}

function plotSegments(points: WeightPointView[]): WeightSegmentView[] {
  return points.slice(1).map((point, index) => {
    const from = points[index]
    const dx = point.x - from.x
    const dy = point.y - from.y
    return {
      key: `${from.key}-${point.key}`,
      x: from.x,
      y: from.y,
      length: Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10,
      angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI * 10) / 10,
    }
  })
}

/**
 * 统计区间里的体重：最新一次、和区间第一次（只有一次时和区间前最近一次）比、每次的走势点。
 * 区间里一次都没记就返回 null（卡片不显示）。
 */
export function weightTrendView(
  entries: Array<{ date: string; value: number }>,
  startDate: string,
  endDate: string,
): WeightTrendView | null {
  const byDate = new Map<string, number>()
  entries.forEach(item => {
    const value = Number(item?.value)
    if (item && dateParts(item.date) && Number.isFinite(value) && value > 0) byDate.set(item.date.slice(0, 10), value)
  })
  const sorted = [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const inRange = sorted.filter(item => (!startDate || item.date >= startDate) && (!endDate || item.date <= endDate))
  if (inRange.length === 0) return null
  const latest = inRange[inRange.length - 1]
  const before = sorted.filter(item => startDate && item.date < startDate)
  const baseline = inRange.length >= 2 ? inRange[0] : before[before.length - 1]
  const points = plotPoints(inRange)
  return {
    valueText: latest.value.toFixed(1),
    changeText: baseline ? changeText(baseline, latest) : `${monthDayText(latest.date)}记录`,
    countText: `记了 ${inRange.length} 次`,
    points,
    segments: plotSegments(points),
  }
}
