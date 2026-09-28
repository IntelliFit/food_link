import Taro from '@tarojs/taro'

export const HOME_MODULES = [
  { id: 'nextMeal', label: '下一餐建议', description: '查看基础建议，继续聊具体方案' },
  { id: 'diet', label: '饮食与营养', description: '当日摄入、目标和营养概览' },
  { id: 'supplements', label: '今日补剂', description: '补剂计划和快捷记录' },
  { id: 'rewards', label: '精选功能', description: '积分任务和校园活动' },
  { id: 'body', label: '体重、喝水与运动', description: '体重趋势、饮水和运动记录' },
  { id: 'sleep', label: '睡眠', description: '入睡、起床时间与主观睡眠感受' },
  { id: 'meals', label: '今日餐食', description: '已记录的餐食和营养明细' },
  { id: 'expiry', label: '食物保质期', description: '查看临期食物和保质期' },
  { id: 'recap', label: '上周回顾', description: '回看真实记录，留下一周的小结' },
] as const

export type HomeModuleId = typeof HOME_MODULES[number]['id']
export type HomeModuleLayout = { order: HomeModuleId[]; hidden: HomeModuleId[] }
export type HomeModuleLocks = Partial<Record<HomeModuleId, string>>
const ids: HomeModuleId[] = HOME_MODULES.map(item => item.id)
export const HOME_MODULE_LAYOUT_PREFIX = 'home_module_layout_v2:'

export function defaultHomeModuleLayout(): HomeModuleLayout {
  return { order: [...ids], hidden: [] }
}

export function normalizeHomeModuleLayout(value: unknown): HomeModuleLayout {
  const raw = value && typeof value === 'object' ? value as Partial<HomeModuleLayout> : {}
  const valid = (list: unknown): HomeModuleId[] => Array.isArray(list)
    ? [...new Set(list.filter((id): id is HomeModuleId => ids.includes(id)))] : []
  const order = valid(raw.order)
  return { order: [...order, ...ids.filter(id => !order.includes(id))], hidden: valid(raw.hidden).filter(id => id !== 'diet') }
}

export function moveHomeModule(layout: HomeModuleLayout, id: HomeModuleId, steps: number): HomeModuleLayout {
  const next = normalizeHomeModuleLayout(layout)
  const index = next.order.indexOf(id)
  const target = Math.max(0, Math.min(next.order.length - 1, index + Math.trunc(steps)))
  next.order.splice(index, 1)
  next.order.splice(target, 0, id)
  return next
}

export function homeModuleLocks(hasSupplementPlan: boolean, hasExpiryAlert: boolean): HomeModuleLocks {
  return {
    diet: '核心记录始终显示',
    ...(hasSupplementPlan ? { supplements: '有补剂计划，保持提醒' } : {}),
    ...(hasExpiryAlert ? { expiry: '有临期食物，保持提醒' } : {}),
  }
}

export function isHomeModuleVisible(layout: HomeModuleLayout, id: HomeModuleId, locks: HomeModuleLocks = {}): boolean {
  return id === 'diet' || Boolean(locks[id]) || !layout.hidden.includes(id)
}

export function homeLayoutOwner(): string {
  return String(Taro.getStorageSync('user_id') || 'guest')
}

export function readHomeModuleLayout(): HomeModuleLayout {
  try { return normalizeHomeModuleLayout(Taro.getStorageSync(HOME_MODULE_LAYOUT_PREFIX + homeLayoutOwner())) }
  catch { return defaultHomeModuleLayout() }
}

export function saveHomeModuleLayout(layout: HomeModuleLayout): HomeModuleLayout {
  const normalized = normalizeHomeModuleLayout(layout)
  Taro.setStorageSync(HOME_MODULE_LAYOUT_PREFIX + homeLayoutOwner(), normalized)
  return normalized
}
