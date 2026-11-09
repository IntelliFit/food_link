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
  | { kind: 'petAsk'; question: string }
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

/** 输入框：用户写了就问写的，没写就问占位里的那句；开一段新对话直接发出去 */
export function askTarget(question: string, fallback: string): PetActionTarget {
  return { kind: 'petAsk', question: question.trim() || fallback }
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
