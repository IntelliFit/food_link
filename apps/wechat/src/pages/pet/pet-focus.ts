import type { NutritionFocusChoice } from '../../utils/api'

/** 「我在意的」最多 3 项（服务器同样限制） */
export const PET_FOCUS_LIMIT = 3

/**
 * 可选的关注，key 与分析页关注卡一致。文案和 packageOnboarding/focus.ts 的 FOCUS_OPTIONS 相同，
 * 以那份为准；这里不直接引用，是因为主包页面引分包文件会把它拉进主包。
 */
export const PET_FOCUS_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'hypertension', label: '控血压' },
  { key: 'diabetes', label: '控血糖' },
  { key: 'weight', label: '管体重' },
  { key: 'cardio', label: '护心血管' },
  { key: 'colorectal', label: '肠道舒服' },
  { key: 'longevity', label: '吃饭更规律' },
  { key: 'micronutrient', label: '补够钙和钾' },
]

export type PetFocusOption = { key: string; label: string; custom: boolean }

/** 选项 = 内置 7 项 + 用户已经选着的自定义关注（不显示出来的话，保存时会被悄悄去掉） */
export function petFocusOptions(current: NutritionFocusChoice[]): PetFocusOption[] {
  const builtIn = PET_FOCUS_OPTIONS.map((option) => ({ ...option, custom: false }))
  const custom = current
    .filter((item) => item.custom || item.key.startsWith('custom:'))
    .map((item) => ({ key: item.key, label: item.title || '自定义关注', custom: true }))
  return [...builtIn, ...custom]
}

export function petFocusLabel(key: string, current: NutritionFocusChoice[]): string {
  return current.find((item) => item.key === key)?.title
    || PET_FOCUS_OPTIONS.find((option) => option.key === key)?.label
    || ''
}

/** 点一下：已选就取消；没选且不满 3 项就加到最后；满了就不动，blocked=true 让页面提示 */
export function togglePetFocus(keys: readonly string[], key: string): { keys: string[]; blocked: boolean } {
  if (keys.includes(key)) return { keys: keys.filter((item) => item !== key), blocked: false }
  if (keys.length >= PET_FOCUS_LIMIT) return { keys: [...keys], blocked: true }
  return { keys: [...keys, key], blocked: false }
}

/** 顶部入口上的字：选了就列名字，没选就请用户去选 */
export function petFocusSummary(current: NutritionFocusChoice[]): string {
  const labels = current.map((item) => item.title || petFocusLabel(item.key, current)).filter(Boolean)
  return labels.length ? labels.join('·') : '选一选'
}
