/**
 * 注册新流程（onboarding_v2 实验组 pet_flow）里「② 你最想改善哪方面？」的逻辑和保存。
 *
 * 只让 pages/profile/FocusPicker.tsx 引用（页面本身只引类型）：Taro 会把被两个以上模块
 * 引用的 src 文件打进主包 common.js，而主包已经超限。同理不放在 utils/onboarding-v2.ts。
 */
import { addHealthFocus, saveHealthFocusKeys } from '../utils/api'

/** 关注最多 3 项（服务器同样限制），自己写的一项也算在里面 */
export const FOCUS_LIMIT = 3
/** 自己写的关注：和分析页「我的关注」接口一样要求 2–12 个字 */
export const CUSTOM_FOCUS_MIN = 2
export const CUSTOM_FOCUS_MAX = 12
export const CUSTOM_FOCUS_PREFIX = 'custom:'

export type FocusKey = 'hypertension' | 'diabetes' | 'cardio' | 'weight' | 'colorectal' | 'longevity' | 'micronutrient'

/**
 * 注册时可选的关注。key 与分析页关注卡一致；watch 是引擎为这项关注优先看的东西
 * （backend nutrition_state_focus.go），小麦的回复只说这些，不多承诺。
 */
export const FOCUS_OPTIONS: ReadonlyArray<{ key: FocusKey; label: string; watch: readonly string[] }> = [
  { key: 'hypertension', label: '控血压', watch: ['盐'] },
  { key: 'diabetes', label: '控血糖', watch: ['糖'] },
  { key: 'weight', label: '管体重', watch: ['热量'] },
  { key: 'cardio', label: '护心血管', watch: ['油', '盐'] },
  { key: 'colorectal', label: '肠道舒服', watch: ['蔬菜', '纤维'] },
  { key: 'longevity', label: '吃饭更规律', watch: ['三餐规律'] },
  { key: 'micronutrient', label: '补够钙和钾', watch: ['钙', '钾'] },
]

export function focusLabel(key: FocusKey): string {
  return FOCUS_OPTIONS.find((o) => o.key === key)?.label || ''
}

/** 点一下选中或取消；已经满了（room 项）再选新的不生效，blocked=true 让页面提示 */
export function toggleFocus(
  selected: readonly FocusKey[],
  key: FocusKey,
  room: number = FOCUS_LIMIT,
): { next: FocusKey[]; blocked: boolean } {
  if (selected.includes(key)) return { next: selected.filter((k) => k !== key), blocked: false }
  if (selected.length >= room) return { next: [...selected], blocked: true }
  return { next: [...selected, key], blocked: false }
}

/** 自己写的关注：合并空白、去掉首尾空白，2–12 个字才算数，不合格返回空串 */
export function normalizeCustomFocus(input: string): string {
  const text = String(input || '').replace(/\s+/g, ' ').trim()
  const length = Array.from(text).length
  return length >= CUSTOM_FOCUS_MIN && length <= CUSTOM_FOCUS_MAX ? text : ''
}

const joinZh = (words: readonly string[]) =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join('、')}和${words[words.length - 1]}`

/** 选完关注后小麦回的一句话（固定文案，只说引擎真的会看的东西） */
export function focusReply(keys: readonly FocusKey[], customLabel = ''): string {
  const watch = Array.from(new Set(
    keys.flatMap((key) => FOCUS_OPTIONS.find((o) => o.key === key)?.watch || []),
  )).slice(0, 4)
  const custom = customLabel ? `「${customLabel}」` : ''
  if (watch.length && custom) return `好，我会帮你盯着${joinZh(watch)}，${custom}我也记下了。`
  if (watch.length) return `好，我会帮你盯着${joinZh(watch)}。`
  if (custom) return `好，${custom}我记下了。`
  return '没关系，我先帮你看整体吃得均不均衡，以后想改随时说。'
}

/** 用户那条气泡：选了哪几项，或「先跳过」 */
export function focusSaid(keys: readonly FocusKey[], customLabel = ''): string {
  const labels = [...keys.map(focusLabel), customLabel].filter(Boolean)
  return labels.length ? labels.join('、') : '先跳过'
}

/** 保存用的 keys：内置项在前，自己写的以 custom:<id> 放最后，总数不超过 3 */
export function buildFocusKeys(keys: readonly FocusKey[], customId = ''): string[] {
  const id = String(customId || '').trim()
  const builtIn = Array.from(new Set(keys)).slice(0, id ? FOCUS_LIMIT - 1 : FOCUS_LIMIT)
  return id ? [...builtIn, `${CUSTOM_FOCUS_PREFIX}${id}`] : builtIn
}

/**
 * 保存注册时选的关注：自己写的先用「我的关注」接口建出来，再以 custom:<id> 和内置项一起
 * PUT /api/health/focus。哪一步失败都只记日志、返回 false，不影响注册。
 */
export async function saveOnboardingFocus(keys: readonly FocusKey[], customLabel = ''): Promise<boolean> {
  let customId = ''
  if (customLabel) {
    try {
      const res = await addHealthFocus(customLabel)
      customId = res.focus_id || res.focuses?.find((f) => f.label === customLabel)?.id || ''
    } catch (error) {
      console.warn('[onboarding] add custom focus failed', error)
    }
  }
  const saveKeys = buildFocusKeys(keys, customId)
  if (!saveKeys.length) return false
  try {
    await saveHealthFocusKeys(saveKeys)
    return true
  } catch (error) {
    console.warn('[onboarding] save focus failed', error)
    return false
  }
}
