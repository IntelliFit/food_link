import type { MealImpact, MealImpactChange, PetDailyBrief, SaveFoodRecordRequest } from '../../utils/api'

/** 一行前后对比条：浅色段是这一餐之前，深色段是这一餐。 */
export interface MealImpactRow {
  key: string
  label: string
  /** warn：上限类快到或超过上限，用橙色 */
  tone: 'good' | 'warn'
  /** 「+6g」「+1 份」；这一餐没有这项数据时为空 */
  deltaText: string
  /** 记完之后的今天总量，「17」 */
  totalText: string
  /** 「/ 25 g」 */
  targetText: string
  badge: string
  beforePct: number
  deltaPct: number
  /** 有说明时不画条：这一餐或今天其他餐缺这项数据 */
  note: string
}

export interface MealImpactMeal {
  title: string
  calories?: number
  protein?: number
  imageUrl?: string
  mealType?: string
  date?: string
}

export interface PetFeedback {
  line: string
  /** 刚保存的这条记录完成了今日任务才有 */
  exp: number | null
  pet: PetDailyBrief['pet']
  mood?: string
}

export const MAX_IMPACT_ROWS = 5

const MEAL_LABELS: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '加餐',
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 10 以上取整，小的留一位小数：17、0.5、1850 */
export function formatAmount(value: number): string {
  const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return String(rounded === 0 ? 0 : rounded)
}

/** 英文单位紧跟数字（6g、900mg），中文单位前留空格（1 份） */
function withUnit(text: string, unit: string): string {
  if (!unit) return text
  return /^[A-Za-zμ]+$/.test(unit) ? `${text}${unit}` : `${text} ${unit}`
}

export function formatDelta(delta: number, unit: string): string {
  const sign = delta < 0 ? '-' : '+'
  return withUnit(`${sign}${formatAmount(Math.abs(delta))}`, unit)
}

function badgeOf(change: MealImpactChange): string {
  if (change.status === 'near_limit') return '快到上限'
  if (change.status === 'over') return change.kind === 'max' ? '超过上限' : '超过目标'
  return ''
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function buildImpactRow(change: MealImpactChange): MealImpactRow {
  const unit = String(change.unit || '')
  const target = isNumber(change.target) && change.target > 0 ? change.target : 0
  const base = {
    key: change.key,
    label: change.label || change.key,
    tone: (change.status === 'near_limit' || change.status === 'over' ? 'warn' : 'good') as MealImpactRow['tone'],
    badge: badgeOf(change),
    // 总量那边按设计稿留空格：17 / 25 g
    targetText: target ? `/ ${formatAmount(target)}${unit ? ` ${unit}` : ''}` : '',
  }
  if (!isNumber(change.delta)) {
    // 不知道就是不知道，不画成 0
    return { ...base, tone: 'good', badge: '', deltaText: '', totalText: '', targetText: '', beforePct: 0, deltaPct: 0, note: '这一餐没有这项数据' }
  }
  const deltaText = formatDelta(change.delta, unit)
  if (!isNumber(change.before) || !isNumber(change.after)) {
    return { ...base, deltaText, totalText: '', targetText: '', beforePct: 0, deltaPct: 0, note: '今天其他餐没有这项数据' }
  }
  const scale = Math.max(target, change.after, change.before + Math.max(change.delta, 0))
  const beforePct = scale > 0 ? clampPct((change.before / scale) * 100) : 0
  const deltaPct = scale > 0 ? clampPct((Math.max(change.delta, 0) / scale) * 100) : 0
  return {
    ...base,
    deltaText,
    totalText: formatAmount(change.after),
    beforePct,
    deltaPct: Math.min(deltaPct, 100 - beforePct),
    note: '',
  }
}

export function buildImpactRows(impact: MealImpact | null | undefined, max = MAX_IMPACT_ROWS): MealImpactRow[] {
  const changes = Array.isArray(impact?.changes) ? impact!.changes : []
  return changes.filter(change => change && change.key).slice(0, max).map(buildImpactRow)
}

/**
 * 宠物说今天的日报那句话；只有这次读取刚完成任务（just_done，刚发了经验）才报「任务完成」，
 * 早上完成的任务午饭后不再报一次。
 */
export function pickPetFeedback(daily: PetDailyBrief | null | undefined): PetFeedback | null {
  if (!daily) return null
  const line = String(daily.report?.today || daily.mood?.reason || '').trim()
  const task = daily.task
  const exp = task?.just_done === true && isNumber(task.exp_reward) && task.exp_reward > 0
    ? Math.round(task.exp_reward)
    : null
  if (!line && exp == null) return null
  return { line, exp, pet: daily.pet || null, mood: daily.mood?.key || undefined }
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** 「今天」或「11月3日」：补记昨天的一餐时，说的是那一天 */
export function dayWord(date: string | undefined, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''))
  if (!match || `${match[1]}-${match[2]}-${match[3]}` === localDateKey(now)) return '今天'
  return `${Number(match[2])}月${Number(match[3])}日`
}

/** 「已记录 · 午餐 12:20」；补记别的日子时写日期不写时间 */
export function headerText(mealType: string | undefined, date: string | undefined, now: Date): string {
  const meal = MEAL_LABELS[String(mealType || '')] || ''
  const day = dayWord(date, now)
  const when = day === '今天' ? `${pad2(now.getHours())}:${pad2(now.getMinutes())}` : day
  return ['已记录', [meal, when].filter(Boolean).join(' ')].join(' · ')
}

export function mealSummaryFromSavePayload(payload: SaveFoodRecordRequest): MealImpactMeal {
  const names = (payload.items || []).map(item => String(item.name || '').trim()).filter(Boolean)
  const description = String(payload.description || '').trim().replace(/^手动记录[：:]\s*/, '')
  return {
    title: names.length ? names.join('、') : description,
    calories: isNumber(payload.total_calories) ? payload.total_calories : undefined,
    protein: isNumber(payload.total_protein) ? payload.total_protein : undefined,
    imageUrl: String(payload.image_paths?.[0] || payload.image_path || '').trim() || undefined,
    mealType: payload.meal_type,
    date: payload.date,
  }
}

export function mealSubtitle(meal: MealImpactMeal): string {
  const parts: string[] = []
  if (isNumber(meal.calories) && meal.calories > 0) parts.push(`约 ${Math.round(meal.calories)} 千卡`)
  if (isNumber(meal.protein) && meal.protein > 0) parts.push(`蛋白质 ${formatAmount(meal.protein)}g`)
  return parts.join(' · ')
}

/** 超时就当没拿到：记录后反馈不值得让用户多等 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
