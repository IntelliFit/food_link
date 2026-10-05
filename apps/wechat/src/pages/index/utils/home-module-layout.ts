import Taro from '@tarojs/taro'

export const HOME_MODULES = [
  { id: 'diet', label: '饮食与营养', description: '当日摄入、目标和营养概览' },
  { id: 'nextMeal', label: '下一餐建议', description: '查看具体菜品与份量，继续调整方案' },
  { id: 'body', label: '快捷记录', description: '体重、喝水、运动和睡眠集中显示' },
  { id: 'supplements', label: '今日补剂', description: '补剂计划和快捷记录' },
  { id: 'expiry', label: '食物保质期', description: '查看临期食物和保质期' },
  { id: 'rewards', label: '活动横幅', description: '积分任务、校园活动等首页横幅' },
  { id: 'meals', label: '今日餐食', description: '已记录的餐食和营养明细' },
  { id: 'recap', label: '上周回顾', description: '回看真实记录，留下一周的小结' },
] as const

export const HOME_QUICK_STATS = [
  { id: 'weight', label: '体重' },
  { id: 'water', label: '喝水' },
  { id: 'exercise', label: '运动' },
  { id: 'sleep', label: '睡眠' },
] as const

export type HomeModuleId = typeof HOME_MODULES[number]['id']
export type HomeQuickStatId = typeof HOME_QUICK_STATS[number]['id']
export type HomeLayoutDensity = 'smart' | 'comfortable' | 'compact'
export type HomeModuleLayout = { order: HomeModuleId[]; hidden: HomeModuleId[]; quickStats: HomeQuickStatId[]; density: HomeLayoutDensity }
export type HomeModuleLocks = Partial<Record<HomeModuleId, string>>
const ids: HomeModuleId[] = HOME_MODULES.map(item => item.id)
const legacyDefaultOrder: HomeModuleId[] = ['nextMeal', 'diet', 'supplements', 'rewards', 'body', 'meals', 'expiry', 'recap']
const quickStatIds: HomeQuickStatId[] = HOME_QUICK_STATS.map(item => item.id)
const defaultQuickStats: HomeQuickStatId[] = ['weight', 'exercise', 'sleep']
const legacyDefaultQuickStats: HomeQuickStatId[] = ['weight', 'water', 'sleep']
export const HOME_MODULE_LAYOUT_PREFIX = 'home_module_layout_v4:'
const PREVIOUS_HOME_MODULE_LAYOUT_PREFIX = 'home_module_layout_v3:'
const LEGACY_HOME_MODULE_LAYOUT_PREFIX = 'home_module_layout_v2:'

export function defaultHomeModuleLayout(): HomeModuleLayout {
  return { order: [...ids], hidden: ['supplements'], quickStats: [...defaultQuickStats], density: 'smart' }
}

export function normalizeHomeModuleLayout(value: unknown): HomeModuleLayout {
  if (!value || typeof value !== 'object') return defaultHomeModuleLayout()
  const raw = value as { order?: unknown; hidden?: unknown; quickStats?: unknown; density?: unknown }
  const validModules = (list: unknown): HomeModuleId[] => Array.isArray(list)
    ? [...new Set(list.filter((id): id is HomeModuleId => ids.includes(id)))] : []
  const validQuickStats = (list: unknown): HomeQuickStatId[] => Array.isArray(list)
    ? quickStatIds.filter(id => list.includes(id)) : []
  const rawOrder = Array.isArray(raw.order) ? raw.order : []
  const legacyHidden = Array.isArray(raw.hidden) ? raw.hidden : []
  const hasLegacyLayout = Array.isArray(raw.order) || Array.isArray(raw.hidden)
  const anchorBodyAtLegacySleep = !Array.isArray(raw.quickStats)
    && legacyHidden.includes('body')
    && !legacyHidden.includes('sleep')
    && Array.isArray(raw.order)
  const legacyOrder = anchorBodyAtLegacySleep
    ? rawOrder.reduce<unknown[]>((result, id) => {
        if (id === 'body') return result
        result.push(id === 'sleep' ? 'body' : id)
        return result
      }, [])
    : raw.order
  const order = validModules(legacyOrder)
  const quickStats: HomeQuickStatId[] = Array.isArray(raw.quickStats)
    ? validQuickStats(raw.quickStats)
    : hasLegacyLayout
      ? legacyHidden.includes('body')
        ? legacyHidden.includes('sleep') ? [] : ['sleep']
        : legacyHidden.includes('sleep')
          ? ['weight', 'water', 'exercise']
          : [...defaultQuickStats]
      : [...defaultQuickStats]
  return {
    order: [...order, ...ids.filter(id => !order.includes(id))],
    hidden: validModules(raw.hidden).filter(id => id !== 'diet' && id !== 'body'),
    quickStats,
    density: raw.density === 'comfortable' || raw.density === 'compact' ? raw.density : 'smart',
  }
}

export function moveHomeModule(layout: HomeModuleLayout, id: HomeModuleId, steps: number): HomeModuleLayout {
  const next = normalizeHomeModuleLayout(layout)
  const index = next.order.indexOf(id)
  const target = Math.max(0, Math.min(next.order.length - 1, index + Math.trunc(steps)))
  next.order.splice(index, 1)
  next.order.splice(target, 0, id)
  return next
}

export function homeModuleLocks(hasExpiryAlert: boolean): HomeModuleLocks {
  return {
    diet: '核心记录始终显示',
    ...(hasExpiryAlert ? { expiry: '有临期食物，保持提醒' } : {}),
  }
}

export function isHomeModuleVisible(layout: HomeModuleLayout, id: HomeModuleId, locks: HomeModuleLocks = {}): boolean {
  if (id === 'body') return normalizeHomeModuleLayout(layout).quickStats.length > 0
  return id === 'diet' || Boolean(locks[id]) || !layout.hidden.includes(id)
}

export function isHomeQuickStatVisible(layout: HomeModuleLayout, id: HomeQuickStatId): boolean {
  return normalizeHomeModuleLayout(layout).quickStats.includes(id)
}

export function toggleHomeQuickStat(layout: HomeModuleLayout, id: HomeQuickStatId, visible: boolean): HomeModuleLayout {
  const normalized = normalizeHomeModuleLayout(layout)
  const selected = new Set(normalized.quickStats)
  if (visible) selected.add(id)
  else selected.delete(id)
  return { ...normalized, quickStats: quickStatIds.filter(key => selected.has(key)) }
}

export function homeLayoutOwner(): string {
  return String(Taro.getStorageSync('user_id') || 'guest')
}

export function readHomeModuleLayout(): HomeModuleLayout {
  try {
    const owner = homeLayoutOwner()
    const current = Taro.getStorageSync(HOME_MODULE_LAYOUT_PREFIX + owner)
    if (current) return normalizeHomeModuleLayout(current)
    const previous = Taro.getStorageSync(PREVIOUS_HOME_MODULE_LAYOUT_PREFIX + owner)
    const legacy = previous || Taro.getStorageSync(LEGACY_HOME_MODULE_LAYOUT_PREFIX + owner)
    const migrated = normalizeHomeModuleLayout(legacy)
    // Replace the old default once; subsequent custom choices use v4.
    if (previous && migrated.quickStats.length === legacyDefaultQuickStats.length
      && legacyDefaultQuickStats.every(id => migrated.quickStats.includes(id))) {
      migrated.quickStats = [...defaultQuickStats]
    }
    const legacyOrder = legacy && typeof legacy === 'object' && Array.isArray((legacy as { order?: unknown }).order)
      ? (legacy as { order: unknown[] }).order
      : []
    if (legacyOrder.length === legacyDefaultOrder.length && legacyDefaultOrder.every((id, index) => legacyOrder[index] === id)) {
      migrated.order = [...ids]
    }
    Taro.setStorageSync(HOME_MODULE_LAYOUT_PREFIX + owner, migrated)
    return migrated
  }
  catch { return defaultHomeModuleLayout() }
}

export function saveHomeModuleLayout(layout: HomeModuleLayout): HomeModuleLayout {
  const normalized = normalizeHomeModuleLayout(layout)
  Taro.setStorageSync(HOME_MODULE_LAYOUT_PREFIX + homeLayoutOwner(), normalized)
  return normalized
}
