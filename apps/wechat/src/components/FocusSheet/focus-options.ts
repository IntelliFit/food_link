import type { CustomHealthFocus } from '../../utils/api'

/** 「我在意的」最多 3 项（服务器同样限制） */
export const FOCUS_LIMIT = 3

export const CUSTOM_FOCUS_PREFIX = 'custom:'

/**
 * 内置的 7 项关注，key 与分析页关注卡、注册那一步（packageOnboarding/focus.ts）一致，三处叫法也一样。
 * 注册那份在分包里，这里不直接引用，免得把它拉进主包。
 */
export const BUILTIN_FOCUS_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'hypertension', label: '控血压' },
  { key: 'diabetes', label: '控血糖' },
  { key: 'weight', label: '管体重' },
  { key: 'cardio', label: '护心血管' },
  { key: 'colorectal', label: '肠道舒服' },
  { key: 'longevity', label: '吃饭更规律' },
  { key: 'micronutrient', label: '补够钙和钾' },
]

export type FocusOption = { key: string; label: string; customId: string }

export function isCustomFocusKey(key: string): boolean {
  return key.startsWith(CUSTOM_FOCUS_PREFIX)
}

export function customFocusKey(id: string): string {
  return `${CUSTOM_FOCUS_PREFIX}${id}`
}

/** 弹窗里的选项 = 内置 7 项 + 用户自己加的 */
export function focusOptions(custom: readonly CustomHealthFocus[]): FocusOption[] {
  return [
    ...BUILTIN_FOCUS_OPTIONS.map((option) => ({ ...option, customId: '' })),
    ...custom.filter((item) => item.id && item.label).map((item) => ({ key: customFocusKey(item.id), label: item.label, customId: item.id })),
  ]
}

/** 内置关注的短名；分析页卡片标题和注册页都用它 */
export function builtinFocusLabel(key: string): string {
  return BUILTIN_FOCUS_OPTIONS.find((option) => option.key === key)?.label || ''
}

/** 点一下：已选就取消；没选且不满 3 项就加到最后；满了就不动，blocked=true 让页面提示 */
export function toggleFocus(keys: readonly string[], key: string): { keys: string[]; blocked: boolean } {
  if (keys.includes(key)) return { keys: keys.filter((item) => item !== key), blocked: false }
  if (keys.length >= FOCUS_LIMIT) return { keys: [...keys], blocked: true }
  return { keys: [...keys, key], blocked: false }
}

/** 只留选项里还在的（自定义关注被删了就去掉），最多 3 项 */
export function keepKnownFocus(keys: readonly string[], options: readonly FocusOption[]): string[] {
  const known = new Set(options.map((option) => option.key))
  return keys.filter((key) => known.has(key)).slice(0, FOCUS_LIMIT)
}
