import { authenticatedRequest, type NutritionFocusChoice, type PetProfile, type PetStatus } from '../../utils/api'

/** GET /api/pet/daily — 字段说明见 docs/algorithms/daily-nutrition-state.md「宠物每日接口」 */
export interface PetMood {
  key: string
  label: string
  reason: string
  icon: string
}

export interface PetDailyReport {
  yesterday: string
  today: string
  facts: string[]
  source: '' | 'nutrition_state' | 'habit_review'
  /** 昨天复盘的经验（只给经验，不给积分），打开小麦页时自动领取 */
  reward?: { exp: number; claimed_now: boolean } | null
}

export interface PetDailyTask {
  key: string
  kind: 'fill' | 'light' | 'water' | 'record'
  title: string
  reason: string
  unit: string
  progress: number
  goal: number
  done: boolean
  just_done: boolean
  exp_reward: number
  done_at?: string
  action: 'record' | 'water'
}

export interface PetDailyWater {
  ml: number
  goal_ml: number
  cups: number
  goal_cups: number
  cup_ml: number
  known: boolean
  is_task_goal: boolean
}

export interface PetDailyNextMeal {
  meal_type: string
  label: string
  advice: string
  starter_question: string
}

export interface PetMemory {
  key: string
  text: string
  source: string
}

/** 「今天还差」一行，按引擎顺序（用户关注的在前） */
export interface PetDailyGapRow {
  key: string
  label: string
  text: string
  status: string
  percent: number
  warn: boolean
}

export interface PetDailyWeek {
  score: number | null
  last_week: number | null
  delta: number | null
  enough_data: boolean
  habits: string[]
}

export interface PetDaily {
  date: string
  pet: PetProfile
  status: PetStatus
  mood: PetMood
  headline: string
  gaps: PetDailyGapRow[]
  meals_today: number
  report: PetDailyReport
  task: PetDailyTask | null
  water: PetDailyWater
  next_meal: PetDailyNextMeal
  week: PetDailyWeek
  focus: NutritionFocusChoice[]
  memories: PetMemory[]
  state_ready: boolean
}

export async function getPetDaily(): Promise<PetDaily> {
  const res = await authenticatedRequest('/api/pet/daily', { method: 'GET', timeout: 12000 })
  if (res.statusCode !== 200) {
    throw new Error('获取宠物日报失败')
  }
  return res.data as PetDaily
}
