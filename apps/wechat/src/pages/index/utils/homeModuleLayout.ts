export const HOME_MODULE_DEFINITIONS = [
  { id: 'greeting', label: '问候助手', description: '宠物问候与首页模式切换', iconClass: 'icon-pinglun', accent: '#3f9d7d', tint: '#e4f5ef' },
  { id: 'calendar', label: '日期日历', description: '日期选择与历史补录入口', iconClass: 'icon-shizhong', accent: '#548fcd', tint: '#e7f1fb' },
  { id: 'diet', label: '今日饮食进度', description: '热量与营养摄入概览', iconClass: 'icon-a-144-lvye', accent: '#5a9f79', tint: '#e8f4ec' },
  { id: 'supplements', label: '今日补剂', description: '补剂计划与快捷打卡', iconClass: 'icon-supplement-capsule', accent: '#8b74c7', tint: '#f0ecfa' },
  { id: 'rewards', label: '精选功能', description: '奖励任务与校园活动', iconClass: 'icon-youhuiquan', accent: '#d39a32', tint: '#fff5dc' },
  { id: 'meals', label: '今日餐食', description: '当日餐食与营养明细', iconClass: 'icon-canciguanli', accent: '#b57c43', tint: '#f8eee3' },
  { id: 'health', label: '健康日常', description: '体重、喝水与运动记录', iconClass: 'icon-a-144-lvye', accent: '#4f9675', tint: '#e7f4ed' },
  { id: 'expiry', label: '食物保质期', description: '即将过期食物提醒', iconClass: 'icon-guoqi1', accent: '#cf6f68', tint: '#fbeceb' },
] as const

export type HomeModuleId = typeof HOME_MODULE_DEFINITIONS[number]['id']

export type HomeModuleLayout = {
  order: HomeModuleId[]
  hidden: HomeModuleId[]
}

export const DEFAULT_HOME_MODULE_ORDER: HomeModuleId[] = HOME_MODULE_DEFINITIONS.map(({ id }) => id)

export const DEFAULT_HOME_MODULE_LAYOUT: HomeModuleLayout = {
  order: DEFAULT_HOME_MODULE_ORDER,
  hidden: ['supplements', 'rewards', 'expiry'],
}

export const HOME_MODULE_LAYOUT_STORAGE_VERSION = 'v1'

const LEGACY_HEALTH_MODULE_IDS = ['weight', 'water', 'exercise'] as const
const LEGACY_DIET_MODULE_IDS = ['calories', 'nutrition'] as const

export function getHomeModuleLayoutStorageKey(userId?: string | number | null): string {
  const account = String(userId || '').trim() || 'guest'
  return `home_module_layout_${HOME_MODULE_LAYOUT_STORAGE_VERSION}_${account}`
}

function isHomeModuleId(value: unknown): value is HomeModuleId {
  return DEFAULT_HOME_MODULE_ORDER.includes(value as HomeModuleId)
}

function uniqueModuleIds(value: unknown): HomeModuleId[] {
  if (!Array.isArray(value)) return []
  return value.filter(isHomeModuleId).filter((id, index, list) => list.indexOf(id) === index)
}

export function normalizeHomeModuleLayout(value: unknown): HomeModuleLayout {
  const candidate = value && typeof value === 'object' ? value as Partial<HomeModuleLayout> : {}
  const rawOrder = Array.isArray(candidate.order) ? candidate.order : []
  if (rawOrder.length === 0) {
    return { order: [...DEFAULT_HOME_MODULE_LAYOUT.order], hidden: [...DEFAULT_HOME_MODULE_LAYOUT.hidden] }
  }
  const storedOrder = uniqueModuleIds(rawOrder)
  const legacyDietPosition = rawOrder.findIndex((id) => LEGACY_DIET_MODULE_IDS.includes(id as typeof LEGACY_DIET_MODULE_IDS[number]))
  if (!storedOrder.includes('diet')) {
    const insertAt = legacyDietPosition >= 0
      ? Math.min(legacyDietPosition, storedOrder.length)
      : Math.min(Math.max(storedOrder.indexOf('calendar') + 1, 0), storedOrder.length)
    storedOrder.splice(insertAt, 0, 'diet')
  }
  const legacyHealthPosition = rawOrder.findIndex((id) => LEGACY_HEALTH_MODULE_IDS.includes(id as typeof LEGACY_HEALTH_MODULE_IDS[number]))
  if (!storedOrder.includes('health')) {
    const mealsIndex = storedOrder.indexOf('meals')
    const insertAt = mealsIndex >= 0
      ? mealsIndex + 1
      : legacyHealthPosition >= 0
        ? Math.min(legacyHealthPosition, storedOrder.length)
        : storedOrder.length
    storedOrder.splice(insertAt, 0, 'health')
  }
  const order = [...storedOrder, ...DEFAULT_HOME_MODULE_ORDER.filter((id) => !storedOrder.includes(id))]
  const rawHidden = Array.isArray(candidate.hidden) ? candidate.hidden : []
  const hidden = uniqueModuleIds(rawHidden)
  const allLegacyDietHidden = LEGACY_DIET_MODULE_IDS.every((id) => rawHidden.includes(id as never))
  if (allLegacyDietHidden && !hidden.includes('diet')) hidden.push('diet')
  const allLegacyHealthHidden = LEGACY_HEALTH_MODULE_IDS.every((id) => rawHidden.includes(id as never))
  if (allLegacyHealthHidden && !hidden.includes('health')) hidden.push('health')
  return { order, hidden }
}

export function setHomeModuleVisibility(
  layout: HomeModuleLayout,
  id: HomeModuleId,
  visible: boolean,
): HomeModuleLayout {
  const normalized = normalizeHomeModuleLayout(layout)
  const hidden = visible
    ? normalized.hidden.filter((item) => item !== id)
    : [...normalized.hidden.filter((item) => item !== id), id]
  return { ...normalized, hidden }
}

export function moveVisibleHomeModule(
  layout: HomeModuleLayout,
  id: HomeModuleId,
  direction: -1 | 1,
): HomeModuleLayout {
  return moveVisibleHomeModuleBySteps(layout, id, direction)
}

export function moveVisibleHomeModuleBySteps(
  layout: HomeModuleLayout,
  id: HomeModuleId,
  steps: number,
): HomeModuleLayout {
  const normalized = normalizeHomeModuleLayout(layout)
  const visible = normalized.order.filter((item) => !normalized.hidden.includes(item))
  const index = visible.indexOf(id)
  if (index < 0 || !Number.isFinite(steps)) return normalized

  const targetIndex = Math.max(0, Math.min(visible.length - 1, index + Math.trunc(steps)))
  if (targetIndex === index) return normalized

  const nextVisible = visible.filter((item) => item !== id)
  nextVisible.splice(targetIndex, 0, id)
  const hiddenInOrder = normalized.order.filter((item) => normalized.hidden.includes(item))
  return { order: [...nextVisible, ...hiddenInOrder], hidden: normalized.hidden }
}

export function getHomeModuleDragClientY(event: unknown): number | null {
  const source = event as any
  const points = [
    source?.touches?.[0],
    source?.changedTouches?.[0],
    source?.mpEvent?.touches?.[0],
    source?.mpEvent?.changedTouches?.[0],
    source?.nativeEvent?.touches?.[0],
    source?.nativeEvent?.changedTouches?.[0],
    source?.detail,
  ]

  for (const point of points) {
    const value = Number(point?.clientY ?? point?.pageY ?? point?.y)
    if (Number.isFinite(value)) return value
  }
  return null
}
