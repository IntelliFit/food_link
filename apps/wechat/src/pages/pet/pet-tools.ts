import type { PetChatHomeMealEntry } from '../../utils/pet-navigation'

/** 伙伴页上的跳转：都去现有页面，伙伴页本身只放一屏摘要。 */
export type PetActionId = 'pick_meal' | 'ask' | 'stats' | 'dress'

export const STATS_DETAIL_URL = '/packageStats/pages/stats/index'

const CHAT_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'evening_snack'] as const

export interface PetNextMealInput {
  meal_type: string
  label: string
  advice: string
  starter_question: string
}

export type PetActionTarget =
  | { kind: 'navigateTo'; url: string }
  | { kind: 'petChat'; starter: string }
  | { kind: 'petContinue' }
  | { kind: 'petChatMeal'; entry: PetChatHomeMealEntry }
  | { kind: 'petSettings' }

/** 「让 X 挑一份」：有餐次就按首页下一餐的格式带进聊天，宠物直接给这一餐的推荐 */
export function pickMealTarget(meal: PetNextMealInput | null | undefined, date: string): PetActionTarget {
  const mealType = CHAT_MEAL_TYPES.find((type) => type === meal?.meal_type)
  const starter = String(meal?.starter_question || '').trim() || '下一餐吃什么？'
  if (!meal || !mealType) return { kind: 'petChat', starter }
  return {
    kind: 'petChatMeal',
    entry: {
      source: 'home_next_meal',
      date,
      mealType,
      mealLabel: meal.label,
      basicAdvice: String(meal.advice || '').trim(),
      starterQuestion: starter,
    },
  }
}

/** 「问问」入口：进聊天页接着最近一次对话，不替用户发话 */
export function askTarget(): PetActionTarget {
  return { kind: 'petContinue' }
}

export function petActionTarget(id: 'stats' | 'dress'): PetActionTarget {
  return id === 'stats' ? { kind: 'navigateTo', url: STATS_DETAIL_URL } : { kind: 'petSettings' }
}

/** 游客能先看伙伴页和完整分析；聊天、换装、改关注要读写个人数据，点了再登录。 */
export function petActionNeedsLogin(id: PetActionId): boolean {
  return id !== 'stats'
}

/** 任务下面那行小字 */
export function petTaskHint(task: { kind: string; progress: number; goal: number; done: boolean; exp_reward: number }): string {
  if (task.done) return `完成啦 · +${task.exp_reward} 经验已到账`
  if (task.kind === 'water') return `${Math.floor(task.progress)}/${task.goal} 杯 · 喝够自动完成 · +${task.exp_reward} 经验`
  return `记录这一餐就自动完成 · +${task.exp_reward} 经验`
}

/** 本周那一行：分数和比上周；数据不够时说清楚还在攒 */
export function petWeekTitle(week: { score: number | null; delta: number | null }): { score: string; delta: string; better: boolean } {
  if (week.score == null) return { score: '本周分数还在攒', delta: '', better: false }
  const delta = week.delta == null || week.delta === 0 ? '' : `比上周 ${week.delta > 0 ? '+' : ''}${week.delta}`
  return { score: `本周 ${week.score} 分`, delta, better: (week.delta || 0) > 0 }
}

/** 简报卡右上角的本周标签：有分数写分数和比上周，没有就说还在攒 */
export function petWeekChip(week: { score: number | null; delta: number | null } | null | undefined): string {
  if (!week || week.score == null) return '本周分数还在攒'
  if (!week.delta) return `本周 ${week.score} 分`
  return `本周 ${week.score} 分 · ${week.delta > 0 ? '+' : ''}${week.delta}`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 「今天 · 11月8日 周日」；日期读不出来就只写「今天」 */
export function petDayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim())
  if (!match) return '今天'
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return `今天 · ${Number(match[2])}月${Number(match[3])}日 ${WEEKDAYS[day.getDay()]}`
}

/** 下一餐建议拆成两行：第一个逗号前是吃什么（大字），后面是怎么吃（小字） */
export function petMealLines(advice: string): { dish: string; note: string } {
  const text = String(advice || '').trim()
  const index = text.search(/[，,；;]/)
  if (index <= 0) return { dish: text, note: '' }
  return { dish: text.slice(0, index).trim(), note: text.slice(index + 1).trim() }
}

/**
 * 简报卡上那一句，只说今天（本周的话在完整分析页）：拿「今天还差」排第一的一项，
 * 配上下一顿怎么办。快到上限 / 超了就让下一顿清淡点，差的就让下一顿补上。
 */
export function petTodayLine(gaps: ReadonlyArray<{ label: string; text: string; status: string }>, mealLabel: string): string {
  const meal = mealLabel || '下一顿'
  const top = gaps[0]
  if (!top) return `今天都在范围里，${meal}照这样吃就好。`
  if (top.status === 'over') return `今天${top.label}已经超了，${meal}清淡一点。`
  if (top.status === 'near_limit') return `今天${top.label}快到上限了，${meal}清淡一点。`
  return `今天${top.label}${top.text}，${meal}补上就好。`
}

/**
 * 今天的任务如果就是「吃好下一餐 / 记一餐」，和上面的「下一顿怎么补」是一回事：
 * 并成餐卡底下一行字。喝水任务和吃饭无关，仍然单独一行（带 +1 杯）。
 */
export function petMealReward(task: { kind: string; done: boolean; exp_reward: number } | null | undefined): { text: string; done: boolean } | null {
  if (!task || task.kind === 'water') return null
  if (task.done) return { text: `今天的任务完成了 · +${task.exp_reward} 经验已到账`, done: true }
  return { text: `记下这一餐就完成今天的任务 · +${task.exp_reward} 经验`, done: false }
}
