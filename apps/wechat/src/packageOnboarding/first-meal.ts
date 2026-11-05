/**
 * 注册新流程（pet_flow）建档存好后，小麦说的两句：从第一餐看到了什么、今天的第一个任务。
 * 只让 pages/profile/index.tsx 引用，免得 Taro 把它打进主包 common.js。
 */
import { getMealImpact, getPetDailyBrief } from '../utils/api'

/** 注册页里这些请求最多等这么久，超时当没有，不拦着用户往下走 */
export const ONBOARDING_SIDE_DEADLINE_MS = 3000

export function withDeadline<T>(promise: Promise<T>, ms: number = ONBOARDING_SIDE_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export interface FirstMealLines {
  /** 这一餐看到了什么（meal-impact 的 headline） */
  seen: string
  /** 今天的第一个任务（/api/pet/daily 的 task.title） */
  task: string
  taskReason: string
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/**
 * 接口没上线、失败或字段为空时对应那句为空，页面就不显示；
 * 任务已经完成（done）就不当「第一个任务」再说一遍。
 */
export function firstMealLines(impact: unknown, daily: unknown): FirstMealLines {
  const headline = impact && typeof impact === 'object' ? text((impact as { headline?: unknown }).headline) : ''
  const task = daily && typeof daily === 'object' ? (daily as { task?: unknown }).task : null
  const open = Boolean(task && typeof task === 'object' && (task as { done?: unknown }).done !== true)
  const t = (open ? task : {}) as { title?: unknown; reason?: unknown }
  return { seen: headline, task: text(t.title), taskReason: text(t.reason) }
}

/**
 * 两个接口同时取，各自失败或超时就空着。要在关注和档案都存好之后调：
 * /api/pet/daily 当天第一次读取时会按当时的状态定下当天任务。
 */
export async function loadFirstMealLines(recordId: string): Promise<FirstMealLines> {
  const id = String(recordId || '').trim()
  const [impact, daily] = await Promise.all([
    id ? withDeadline(getMealImpact(id, ONBOARDING_SIDE_DEADLINE_MS)).catch(() => null) : Promise.resolve(null),
    withDeadline(getPetDailyBrief(ONBOARDING_SIDE_DEADLINE_MS)).catch(() => null),
  ])
  return firstMealLines(impact, daily)
}
