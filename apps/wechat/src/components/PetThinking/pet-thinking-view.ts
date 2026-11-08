/** 等待时显示几步：太多会把气泡撑得很长，只留最近做完的两步 */
const DONE_SHOWN = 2

export const PET_THINKING_FALLBACK = '在想…'

function clean(step: string): string {
  return String(step || '').trim().replace(/[…\.]+$/, '')
}

/**
 * 把进度事件变成「正在做的一件事 + 刚做完的几件」。同一句连续出现只算一次；
 * 「在…」开头的是还在做的事，其余（看完了、找到了…）是做完的。
 */
export function petThinkingView(steps: readonly string[], fallback = PET_THINKING_FALLBACK): { current: string; done: string[] } {
  const unique: string[] = []
  for (const step of steps) {
    const text = clean(step)
    if (text && unique[unique.length - 1] !== text) unique.push(text)
  }
  const lastIndex = unique.length - 1
  const last = unique[lastIndex]
  if (!last) return { current: clean(fallback) || clean(PET_THINKING_FALLBACK), done: [] }
  const running = last.startsWith('在') || last.startsWith('正在') || last.startsWith('挑了')
  const done = unique.slice(0, running ? lastIndex : unique.length).filter((step) => !step.startsWith('在') && !step.startsWith('正在'))
  return {
    current: running ? last : '在整理回答',
    done: done.slice(-DONE_SHOWN),
  }
}

/** 把一条进度接到已有步骤后面；同一句不重复，最多留 8 条 */
export function appendThinkingStep(steps: readonly string[] | undefined, label: string): string[] {
  const text = String(label || '').trim()
  const list = [...(steps || [])]
  if (!text || list[list.length - 1] === text) return list
  list.push(text)
  return list.slice(-8)
}
