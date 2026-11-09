/** 聊天里等回答时最多显示几步：最新一步在气泡里，前面两步打勾，再多会把气泡撑长 */
const SHOWN_STEPS = 3

export const CHAT_THINKING_FALLBACK = '在想…'

/** 把一条进度接到已有步骤后面；同一句不重复，最多留 8 条 */
export function appendThinkingStep(steps: readonly string[] | undefined, label: string): string[] {
  const text = String(label || '').trim()
  const list = [...(steps || [])]
  if (!text || list[list.length - 1] === text) return list
  list.push(text)
  return list.slice(-8)
}

/** 交给共用的 PetThinking：没有进度时先说一句，有了就只给最近几步 */
export function chatThinkingSteps(steps: readonly string[] | undefined, fallback = CHAT_THINKING_FALLBACK): string[] {
  const list = (steps || []).filter((step) => String(step || '').trim())
  return list.length ? list.slice(-SHOWN_STEPS) : [fallback]
}
