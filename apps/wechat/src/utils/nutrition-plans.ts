import Taro from '@tarojs/taro'
import { authenticatedRequest } from './api'
import { HOME_DASHBOARD_REFRESH_EVENT } from './home-events'
import { HOME_DASHBOARD_LOCAL_CACHE_KEY } from './home-dashboard-local-cache'

export type PlanValues = {
  name: string
  targets: Record<string, number>
  micro_mode: 'profile' | 'custom'
  fat_min: number
  fat_max: number
  auto_carb: boolean
  style?: 'balanced' | 'protein' | 'cycle' | 'mediterranean' | 'dash' | ''
}
export type NutritionPlan = PlanValues & { id: string; revision: number }
export type PlanSnapshot = PlanValues & { plan_id: string; revision: number }
export type NutritionDay = { date: string; snapshot: PlanSnapshot; source: string; historical_reference: boolean; change_token: string }
export type PlanLibrary = { plans: NutritionPlan[]; default_id: string; base_targets: Record<string, number> }
export type DayBackup = { snapshot: PlanSnapshot; source: string }
export type DayChange = { day: NutritionDay; previous: DayBackup | null }
export const NUTRITION_PLANS_CHANGED = 'nutrition-plans:changed'
export const planToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

async function request<T>(path = '', method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', data?: object): Promise<T> {
  const res = await authenticatedRequest(`/api/user/nutrition-plans${path}`, { method, data, timeout: 15000 })
  if (res.statusCode !== 200) {
    const error = new Error(res.statusCode === 404 && (!path || path.startsWith('/day/')) ? '饮食方案尚未启用，请更新后端后再试' : res.data?.message || '操作失败，请重试')
    Object.assign(error, { statusCode: res.statusCode }); throw error
  }
  if (!res.data?.data || typeof res.data.data !== 'object') throw new Error('方案数据不完整，请刷新重试')
  return res.data.data as T
}
function notify(date = planToday()) {
  Taro.removeStorageSync(HOME_DASHBOARD_LOCAL_CACHE_KEY)
  Taro.eventCenter.trigger(NUTRITION_PLANS_CHANGED, { date })
  Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, { date, force: true })
}
export const getPlanLibrary = () => request<PlanLibrary>()
export const getNutritionDay = (date: string) => request<NutritionDay>(`/day/${encodeURIComponent(date)}`)
export async function createNutritionPlans(plans: PlanValues[]) { const result = await request<PlanLibrary>('', 'POST', { plans }); notify(); return result }
export async function updateNutritionPlan(plan: NutritionPlan) { const result = await request<PlanLibrary>(`/${encodeURIComponent(plan.id)}`, 'PUT', plan); notify(); return result }
export async function deleteNutritionPlan(id: string) { const result = await request<PlanLibrary>(`/${encodeURIComponent(id)}`, 'DELETE'); notify(); return result }
export async function setDefaultNutritionPlan(id: string) { const result = await request<PlanLibrary>('/default', 'PUT', { plan_id: id }); notify(); return result }
export async function changeNutritionDay(date: string, expectedToken: string, action: { plan_id?: string; values?: PlanValues; restore?: DayBackup; clear?: boolean }) {
  const result = await request<DayChange>(`/day/${encodeURIComponent(date)}`, 'PUT', { ...action, expected_token: expectedToken }); notify(date); return result
}

export const PLAN_STYLES = [
  { id: 'balanced', name: '均衡日常', caption: '从你的基础目标开始', detail: '沿用个人热量与三大营养目标，关注食物多样性。适合先建立稳定的记录习惯。', foods: '谷薯、蔬果、奶豆、鱼肉蛋合理搭配' },
  { id: 'protein', name: '高蛋白', caption: '提高蛋白，碳水自动调整', detail: '以基础蛋白质目标上调 20% 作为可编辑起点，保持基础热量和脂肪参考值。具体需求应结合体重与训练。', foods: '分餐安排蛋白质，兼顾蔬菜与主食' },
  { id: 'cycle', name: '碳循环', caption: '训练／休息，一次创建两套', detail: '以基础热量的 110%／90% 作为可编辑起点，蛋白质与脂肪参考值保持一致，差额由碳水承担。维矿沿用基础目标，不随热量缩放。', foods: '训练日与休息日都保留蔬菜、蛋白质与必需脂肪' },
  { id: 'mediterranean', name: '地中海风格', caption: '更关注食物结构', detail: '沿用个人目标；以蔬果、全谷、豆类、坚果、鱼类和不饱和脂肪为食物方向。没有唯一的三大营养比例。', foods: '多植物性食物，适量鱼类与橄榄油' },
  { id: 'dash', name: 'DASH 风格', caption: '蔬果、低脂奶与少盐', detail: '沿用个人目标；以蔬果、全谷、低脂奶、豆类和少盐为方向。此预设不自动增加钾或设置治疗剂量。', foods: '少盐、少加工食品，兼顾奶豆与蔬果' },
] as const

export function planFromPreset(style: PlanValues['style'], base: Record<string, number>): PlanValues[] {
  const title = PLAN_STYLES.find(s => s.id === style)?.name || '新方案'
  const fat = base.fat_target
  const make = (name: string, factor = 1): PlanValues => {
    const targets = { calorie_target: Math.round(base.calorie_target * factor), protein_target: base.protein_target, fat_target: fat, carbs_target: base.carbs_target }
    if (style === 'protein') targets.protein_target = Math.round(base.protein_target * 1.2)
    targets.carbs_target = Math.round((targets.calorie_target - targets.protein_target * 4 - fat * 9) / 4 * 10) / 10
    return { name, targets, fat_min: Math.max(0, Math.round(fat * .85)), fat_max: Math.round(fat * 1.15), auto_carb: true, micro_mode: 'profile', style }
  }
  return style === 'cycle' ? [make('训练日', 1.1), make('休息日', .9)] : [make(title)]
}
