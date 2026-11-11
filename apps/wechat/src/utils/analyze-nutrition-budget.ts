import { getHomeDashboard, type DietGoal, type HomeDashboard, type UserGoal } from './api'

export interface AnalyzeNutritionBudget {
  remaining_calories?: number
  diet_goal?: DietGoal
  user_goal?: UserGoal
}

export const ANALYZE_NUTRITION_BUDGET_TIMEOUT_MS = 2500

/** Use the selected day's actual target and intake; missing data is not a zero budget. */
export function analyzeNutritionBudgetFromDashboard(dashboard?: HomeDashboard | null): AnalyzeNutritionBudget {
  const result: AnalyzeNutritionBudget = {}
  const goal = dashboard?.nutritionTarget?.diet_goal
  if (goal === 'fat_loss' || goal === 'muscle_gain' || goal === 'maintain' || goal === 'none') {
    result.diet_goal = goal
    if (goal !== 'none') result.user_goal = goal
  }

  const target = dashboard?.intakeData?.target
  const current = dashboard?.intakeData?.current
  if (typeof target === 'number' && Number.isFinite(target) && target > 0
    && typeof current === 'number' && Number.isFinite(current) && current >= 0) {
    result.remaining_calories = Math.max(0, target - current)
  }
  return result
}

interface AnalyzeNutritionBudgetOptions {
  enabled?: boolean
  timeoutMs?: number
  fetchDashboard?: (date: string) => Promise<HomeDashboard>
}

/** Budget lookup must not turn a slow/unavailable dashboard into a failed analysis. */
export async function loadAnalyzeNutritionBudget(
  date: string,
  options: AnalyzeNutritionBudgetOptions = {},
): Promise<AnalyzeNutritionBudget> {
  if (options.enabled === false || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return {}
  const fetchDashboard = options.fetchDashboard || getHomeDashboard
  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs : ANALYZE_NUTRITION_BUDGET_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const dashboard = await Promise.race([
      Promise.resolve().then(() => fetchDashboard(date)),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
    return analyzeNutritionBudgetFromDashboard(dashboard)
  } catch {
    return {}
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
