import type {
  DailyNutritionState,
  NutrientReading,
  NutritionCount,
  NutritionEvidenceGap,
  NutritionFocusScore,
  NutritionHabitMark,
  NutritionNextMeal,
  NutritionPlanSummary,
  NutritionScores,
  NutritionWeek,
  NutritionWeekDelta,
  RiskCard,
  RiskTone,
} from '../../utils/api'

/**
 * 把引擎的「每日营养状态」转成分析页展示数据。
 * 约定见 docs/algorithms/daily-nutrition-state.md：缺数据是“不知道”，任何地方都不能显示成 0。
 */

const BEIJING_OFFSET_MS = 8 * 3600 * 1000
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function scoreToTone(score: number): RiskTone {
  if (score >= 78) return 'positive'
  if (score >= 60) return 'neutral'
  if (score >= 42) return 'warning'
  return 'danger'
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function finiteOr(value: unknown, fallback: number): number {
  const n = finiteOrNull(value)
  return n === null ? fallback : n
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as T[] : []
}

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

/** 接口返回的是外部数据：缺字段补默认值，不是对象就当没有（页面不显示新模块）。 */
export function normalizeNutritionState(raw: unknown): DailyNutritionState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const src = raw as Record<string, any>
  const date = text(src.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const coverage = (src.coverage && typeof src.coverage === 'object') ? src.coverage : {}
  const plan = (src.plan && typeof src.plan === 'object') ? src.plan : {}
  const week = (src.week && typeof src.week === 'object') ? src.week : {}
  const scores = (src.scores && typeof src.scores === 'object') ? src.scores : {}
  const context = (src.context && typeof src.context === 'object') ? src.context : {}
  const nextMeal = src.next_meal && typeof src.next_meal === 'object' ? src.next_meal : null
  return {
    date,
    generated_at: text(src.generated_at),
    coverage: {
      recorded_days: Math.max(0, finiteOr(coverage.recorded_days, 0)),
      meals: Math.max(0, finiteOr(coverage.meals, 0)),
      today_meals: Math.max(0, finiteOr(coverage.today_meals, 0)),
      nutrient_completeness: finiteOr(coverage.nutrient_completeness, 0),
      enough_data: coverage.enough_data === true,
    },
    plan: {
      goal: text(plan.goal),
      goal_label: text(plan.goal_label),
      energy_kcal: finiteOr(plan.energy_kcal, 0),
      protein_g: finiteOr(plan.protein_g, 0),
      source: text(plan.source),
    },
    today: list<Record<string, unknown>>(src.today).map(item => ({
      key: text(item.key),
      label: text(item.label),
      unit: text(item.unit),
      value: finiteOrNull(item.value),
      target: finiteOr(item.target, 0),
      kind: text(item.kind) || 'min',
      status: text(item.status) || 'unknown',
      gap: finiteOr(item.gap, 0),
      unknown_meals: Math.max(0, finiteOr(item.unknown_meals, 0)),
    })).filter(item => item.key && item.label),
    gaps: list<Record<string, unknown>>(src.gaps).map(item => ({
      key: text(item.key),
      label: text(item.label),
      text: text(item.text),
      severity: finiteOr(item.severity, 0),
    })),
    next_meal: nextMeal ? {
      meal_type: text(nextMeal.meal_type),
      label: text(nextMeal.label),
      advice: text(nextMeal.advice),
      fills: textList(nextMeal.fills),
      limits: textList(nextMeal.limits),
    } : null,
    week: {
      days: textList(week.days),
      habits: list<Record<string, unknown>>(week.habits).map(item => ({
        key: text(item.key),
        label: text(item.label),
        marks: textList(item.marks),
        hit: Math.max(0, finiteOr(item.hit, 0)),
        of: Math.max(0, finiteOr(item.of, 0)),
      })).filter(item => item.label),
      counts: list<Record<string, unknown>>(week.counts).map(item => ({
        key: text(item.key),
        label: text(item.label),
        value: finiteOr(item.value, 0),
        target: finiteOr(item.target, 0),
        unit: text(item.unit),
      })).filter(item => item.label),
      vs_last_week: list<Record<string, unknown>>(week.vs_last_week).map(item => ({
        key: text(item.key),
        label: text(item.label),
        last: finiteOr(item.last, 0),
        this: finiteOr(item.this, 0),
        unit: text(item.unit),
        better: item.better === true,
      })).filter(item => item.label),
    },
    scores: {
      overall: finiteOrNull(scores.overall),
      overall_last_week: finiteOrNull(scores.overall_last_week),
      focus: list<Record<string, unknown>>(scores.focus).map(item => ({
        key: text(item.key),
        title: text(item.title),
        score: finiteOrNull(item.score),
        reason: text(item.reason),
        evidence: textList(item.evidence),
      })).filter(item => item.key),
    },
    evidence_gaps: list<Record<string, unknown>>(src.evidence_gaps).map(item => ({
      key: text(item.key),
      text: text(item.text),
      hint: text(item.hint),
      action: text(item.action) || 'none',
    })).filter(item => item.text),
    context: {
      weight_trend: context.weight_trend && typeof context.weight_trend === 'object'
        ? { kg_change: finiteOr(context.weight_trend.kg_change, 0), days: finiteOr(context.weight_trend.days, 0) }
        : null,
      training_today: context.training_today === true,
      water_ml_today: finiteOrNull(context.water_ml_today),
      sleep_hours: finiteOrNull(context.sleep_hours),
      notes: textList(context.notes),
    },
    headline: text(src.headline),
    findings: list<Record<string, unknown>>(src.findings).map(item => ({
      key: text(item.key),
      kind: text(item.kind),
      text: text(item.text),
      value: text(item.value) || undefined,
    })).filter(item => item.text),
  }
}

/** 52 → "52"，0.6 → "0.6"，1849.6 → "1850" */
export function formatAmount(value: number): string {
  if (Math.abs(value) >= 10) return String(Math.round(value))
  return String(Math.round(value * 10) / 10)
}

/** 拉丁单位紧贴数字（43g），中文单位留空格（2 份） */
export function withUnit(amount: string, unit: string): string {
  if (!unit) return amount
  return /^[a-zA-Z%]+$/.test(unit) ? `${amount}${unit}` : `${amount} ${unit}`
}

function beijingClock(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms + BEIJING_OFFSET_MS)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** "小麦 · 今天 07:30 的观察" */
export function observationMetaText(petName: string, generatedAt: string): string {
  const clock = beijingClock(generatedAt)
  return `${petName || '小伙伴'} · ${clock ? `今天 ${clock} ` : '今天'}的观察`
}

/** 引擎的一句话；没有时退到第一条事实，都没有就不显示观察条 */
export function observationHeadline(state: Pick<DailyNutritionState, 'headline' | 'findings'>): string {
  return state.headline || state.findings[0]?.text || ''
}

export function petChatStarter(headline: string): string {
  return headline ? `分析页说：${headline}我该先从哪里改？` : '看了这周的饮食分析，我该先从哪里改？'
}

export type OverallDeltaView = { text: string; direction: 'up' | 'down' | 'flat' }

/** 「比上周 +6」；任意一周没有分数就不显示，不拿 0 去比 */
export function overallDelta(scores: Pick<NutritionScores, 'overall' | 'overall_last_week'>): OverallDeltaView | null {
  if (scores.overall === null || scores.overall_last_week === null) return null
  const diff = Math.round(scores.overall - scores.overall_last_week)
  if (diff === 0) return { text: '和上周持平', direction: 'flat' }
  return { text: `比上周 ${diff > 0 ? '+' : ''}${diff}`, direction: diff > 0 ? 'up' : 'down' }
}

/** ["已记录 6 天 · 15 餐", "营养数据完整 72%"] */
export function coverageLines(coverage: DailyNutritionState['coverage']): string[] {
  const lines = [`已记录 ${coverage.recorded_days} 天 · ${coverage.meals} 餐`]
  if (coverage.meals > 0) {
    const pct = Math.round(Math.max(0, Math.min(1, coverage.nutrient_completeness)) * 100)
    lines.push(`营养数据完整 ${pct}%`)
  }
  return lines
}

/** "按你的减脂计划：每天 1650 千卡，蛋白质 95g" */
export function planLineText(plan: NutritionPlanSummary): string {
  const parts: string[] = []
  if (plan.energy_kcal > 0) parts.push(`每天 ${Math.round(plan.energy_kcal)} 千卡`)
  if (plan.protein_g > 0) parts.push(`蛋白质 ${Math.round(plan.protein_g)}g`)
  if (parts.length === 0) return ''
  return `按你的${plan.goal_label}计划：${parts.join('，')}`
}

/** "到 13:10 · 已记 2 餐" */
export function todayMetaText(state: Pick<DailyNutritionState, 'generated_at' | 'coverage'>): string {
  const meals = state.coverage.today_meals
  const mealsText = meals > 0 ? `已记 ${meals} 餐` : '今天还没记录'
  const clock = beijingClock(state.generated_at)
  return clock ? `到 ${clock} · ${mealsText}` : mealsText
}

export type TodayRowTone = 'good' | 'short' | 'warn' | 'over'

export type TodayRowView =
  | { key: string; label: string; known: false; note: string }
  | {
    key: string
    label: string
    known: true
    tone: TodayRowTone
    valueText: string
    targetText: string
    gapText: string
    badge: string
    percent: number
    note: string
  }

function gapAmount(reading: NutrientReading, value: number): number {
  if (reading.gap > 0) return reading.gap
  return Math.abs(reading.target - value)
}

export function todayRowView(reading: NutrientReading): TodayRowView {
  const value = reading.value
  if (value === null || reading.status === 'unknown') {
    return {
      key: reading.key,
      label: reading.label,
      known: false,
      note: reading.unknown_meals > 0
        ? `还不知道：今天有 ${reading.unknown_meals} 餐没有${reading.label}数据，不算成 0`
        : `还不知道：今天还没有${reading.label}数据，不算成 0`,
    }
  }
  const unit = reading.unit
  const percent = reading.target > 0 ? Math.max(0, Math.min(100, Math.round(value / reading.target * 100))) : 0
  const gap = formatAmount(gapAmount(reading, value))
  let tone: TodayRowTone = 'good'
  let gapText = ''
  let badge = ''
  if (reading.status === 'short') {
    tone = 'short'
    gapText = `差 ${withUnit(gap, unit)}`
  } else if (reading.status === 'near_limit') {
    tone = 'warn'
    badge = '快到上限'
  } else if (reading.status === 'over') {
    tone = 'over'
    badge = '超上限'
    gapText = `超出 ${withUnit(gap, unit)}`
  } else if (reading.kind === 'min') {
    gapText = '已达标'
  }
  return {
    key: reading.key,
    label: reading.label,
    known: true,
    tone,
    valueText: formatAmount(value),
    targetText: reading.target > 0 ? `/ ${formatAmount(reading.target)} ${unit}`.trim() : unit,
    gapText,
    badge,
    percent,
    // 有一部分餐缺数据时，已知的数只是下限
    note: reading.unknown_meals > 0 ? `另有 ${reading.unknown_meals} 餐没有${reading.label}数据，没算进来` : '',
  }
}

export type NextMealView = {
  title: string
  advice: string
  /** 宠物聊天的下一餐入口只认这几种餐次 */
  petMealType: 'breakfast' | 'lunch' | 'dinner' | 'evening_snack' | ''
  mealLabel: string
}

const PET_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'evening_snack'])

export function nextMealView(next: NutritionNextMeal | null): NextMealView | null {
  if (!next || !next.advice) return null
  const mealLabel = next.label || '下一餐'
  return {
    title: `${mealLabel}这样补`,
    advice: next.advice,
    petMealType: PET_MEAL_TYPES.has(next.meal_type) ? next.meal_type as NextMealView['petMealType'] : '',
    mealLabel,
  }
}

function weekdayOf(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()
}

/** ["四", "五", …, "今"]；按日期算星期，不受手机时区影响 */
export function weekDayLabels(days: string[], today: string): string[] {
  return days.map(day => {
    if (day === today) return '今'
    const weekday = weekdayOf(day)
    return weekday === null ? '' : WEEKDAY_LABELS[weekday]
  })
}

export type WeekHabitRowView = {
  key: string
  label: string
  cells: NutritionHabitMark[]
  countText: string
  warn: boolean
}

const HABIT_MARKS = new Set(['hit', 'miss', 'today', 'none'])

export function weekHabitRows(week: Pick<NutritionWeek, 'days' | 'habits'>): WeekHabitRowView[] {
  const dayCount = week.days.length
  return week.habits.map(habit => {
    const cells = Array.from({ length: dayCount }, (_, index) => {
      const mark = habit.marks[index]
      return (HABIT_MARKS.has(mark) ? mark : 'none') as NutritionHabitMark
    })
    return {
      key: habit.key || habit.label,
      label: habit.label,
      cells,
      countText: habit.of > 0 ? `${habit.hit}/${habit.of}` : '',
      warn: habit.of > 0 && habit.hit * 2 < habit.of,
    }
  })
}

/** "鱼或豆制品 2/3 次" */
export function weekCountText(count: NutritionCount): string {
  const value = formatAmount(count.value)
  return count.target > 0
    ? `${count.label} ${withUnit(`${value}/${formatAmount(count.target)}`, count.unit)}`
    : `${count.label} ${withUnit(value, count.unit)}`
}

export type WeekDeltaView = { key: string; text: string; better: boolean }

/** "比上周：蔬菜够量 +2 天" */
export function weekDeltaView(delta: NutritionWeekDelta): WeekDeltaView {
  const diff = delta.this - delta.last
  const body = diff === 0
    ? `${delta.label}和上周一样`
    : `${delta.label} ${withUnit(`${diff > 0 ? '+' : '-'}${formatAmount(Math.abs(diff))}`, delta.unit)}`
  return { key: delta.key || delta.label, text: `比上周：${body}`, better: delta.better }
}

/** 标题旁只放一条：优先放变好的那条，其余跟在计数后面 */
export function splitWeekDeltas(deltas: NutritionWeekDelta[]): { headline: WeekDeltaView | null; rest: WeekDeltaView[] } {
  const views = deltas.map(weekDeltaView)
  const index = Math.max(0, views.findIndex(view => view.better))
  if (views.length === 0) return { headline: null, rest: [] }
  return { headline: views[index], rest: views.filter((_, i) => i !== index) }
}

/** 引擎的关注键 → 分析页现有关注卡的键 */
const FOCUS_CARD_KEY_BY_ENGINE_KEY: Record<string, string> = {
  blood_pressure: 'hypertension',
  blood_glucose: 'diabetes',
  cardiovascular: 'cardio',
  weight: 'weight',
  gut: 'colorectal',
  habits: 'longevity',
  micronutrients: 'micronutrient',
}

export function focusCardKey(engineKey: string): string {
  return FOCUS_CARD_KEY_BY_ENGINE_KEY[engineKey] || engineKey
}

/**
 * 有引擎关注分时用它的分数、理由和依据；没有的卡原样保留（回退到 health_index）。
 * 自定义关注卡不归引擎管，不动。
 */
export function applyEngineFocus(cards: RiskCard[], focus: NutritionFocusScore[]): RiskCard[] {
  if (focus.length === 0) return cards
  const byCardKey = new Map(focus.map(item => [focusCardKey(item.key), item]))
  return cards.map(card => {
    const engine = card.is_custom ? undefined : byCardKey.get(card.key)
    if (!engine) return card
    const score = engine.score
    return {
      ...card,
      ...(score !== null ? { score: Math.round(score), tone: scoreToTone(score), score_available: true } : {}),
      // 详情里的说明也换成引擎的理由，免得和新分数说法不一
      brief: engine.reason || card.brief,
      summary: engine.reason || card.summary,
      evidence: engine.evidence.length > 0 ? engine.evidence : card.evidence,
    }
  })
}

export type EvidenceRoute = { kind: 'tab' | 'page'; url: string }

/** evidence_gaps[].action → 记录页；页面里的分包路径由调用方补 extraPkgUrl */
export function evidenceRoute(action: string, today: string): EvidenceRoute | null {
  switch (action) {
    case 'record': return { kind: 'tab', url: '/pages/record/index' }
    case 'weight': return { kind: 'page', url: '/pages/weight-record/index' }
    case 'water': return { kind: 'page', url: '/pages/water-record/index' }
    case 'sleep': return { kind: 'page', url: `/pages/sleep-record/index?date=${today}` }
    default: return null
  }
}

const EVIDENCE_BUTTON_TEXT: Record<string, string> = {
  record: '去补充',
  weight: '记体重',
  water: '记喝水',
  sleep: '记睡眠',
}

export type EvidenceGapView = NutritionEvidenceGap & { buttonText: string }

export function evidenceGapViews(gaps: NutritionEvidenceGap[]): EvidenceGapView[] {
  return gaps.map(gap => ({ ...gap, buttonText: EVIDENCE_BUTTON_TEXT[gap.action] || '' }))
}
