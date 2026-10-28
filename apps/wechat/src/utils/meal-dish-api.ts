import { authenticatedRequest } from './api'

/** 识别等待时“这一餐是哪个食堂的哪道菜”的提示。 */
export interface MealDishCanteen {
  id: string
  name: string
  school_name: string
  campus_name?: string
  distance_m?: number
  reason: 'recommended' | 'recent' | 'nearby' | 'school' | 'manual'
  reason_text: string
  dish_count: number
}

export interface MealDishItem {
  id: string
  name: string
  window_name: string
  price_text: string
  image_url?: string
  has_real_photo: boolean
  score?: number
  canteen_id?: string
  canteen_name?: string
}

export interface MealDishPrompt {
  id: string
  analysis_task_id: string
  surface: 'wait' | 'result'
  chosen_canteen_id?: string
  chosen_item_id?: string
  gap_kind: 'none' | 'photo' | 'menu'
  photo_consent?: boolean
  photo_contributed_at?: string
  reward_credits: number
  skipped_at?: string
  cohort?: 'regular' | 'active' | 'contributor'
  recommended_item_id?: string
  price_asked_at?: string
  price_answer_kind?: '' | 'same' | 'changed' | 'skipped'
  price_applied_at?: string
}

/** 积极用户的价格追问：当前价格（有的话）和展示文字。 */
export interface MealDishPriceAsk {
  current_price?: number
  price_text: string
}

export interface MealDishView {
  eligible: boolean
  prompt?: MealDishPrompt
  canteens: MealDishCanteen[]
  chosen_canteen?: MealDishCanteen
  chosen_dish?: MealDishItem
  candidates?: MealDishItem[]
  candidates_from?: MealDishCanteen
  /** 首页刚推荐过的这道菜，一键确认。 */
  recommended_dish?: MealDishItem
  price_ask?: MealDishPriceAsk
}

export interface MealDishDishes {
  canteen: MealDishCanteen
  windows: Array<{ name: string; dish_count: number }>
  dishes: MealDishItem[]
  recognition_ready: boolean
  best_dish_id?: string
}

export interface MealDishStartInput {
  task_id: string
  surface?: 'wait' | 'result'
  location_status?: 'granted' | 'denied' | 'unavailable' | 'unknown'
  latitude?: number
  longitude?: number
  force?: boolean
  recommended_item_id?: string
  recommended_kind?: 'navigated' | 'chatted' | 'shown'
}

export interface MealDishAnswer {
  step: 'canteen' | 'dish' | 'photo' | 'price' | 'skip'
  surface?: 'wait' | 'result'
  canteen_id?: string
  item_id?: string
  suggested_item_ids?: string[]
  photo_consent?: boolean
  /** 跳过时说明是菜单上没有这道菜，用于统计菜单缺口。 */
  not_listed?: boolean
  latitude?: number
  longitude?: number
  accuracy_m?: number
  price_kind?: 'same' | 'changed' | 'skipped'
  price?: number
}

async function call<T>(path: string, options: Parameters<typeof authenticatedRequest>[1] = {}): Promise<T> {
  const response = await authenticatedRequest(path, { timeout: 15000, ...options })
  return response.data as T
}

export function startMealDishPrompt(input: MealDishStartInput): Promise<MealDishView> {
  return call('/api/meal-dish/prompts', { method: 'POST', data: input })
}

export function getMealDishPrompt(taskId: string): Promise<MealDishView> {
  return call(`/api/meal-dish/prompts?task_id=${encodeURIComponent(taskId)}`, { method: 'GET' })
}

export function answerMealDishPrompt(promptId: string, answer: MealDishAnswer): Promise<MealDishView> {
  return call(`/api/meal-dish/prompts/${encodeURIComponent(promptId)}/answers`, { method: 'POST', data: answer })
}

export function getMealDishCanteenDishes(canteenId: string, taskId: string): Promise<MealDishDishes> {
  return call(`/api/meal-dish/canteens/${encodeURIComponent(canteenId)}/dishes?task_id=${encodeURIComponent(taskId)}`, { method: 'GET' })
}
