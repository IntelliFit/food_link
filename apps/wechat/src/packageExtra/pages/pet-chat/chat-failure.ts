import type { PetChatHistoryMessage } from '../../../utils/api'

/**
 * 回答没到时给用户的话：说清楚是哪件事没完成、问题还在、可以一键重试。
 * 不再说「没读完记录、换 7 天小范围分析」——问吃什么失败时那句话和问题对不上。
 */
export function petChatFailureText({ petName, mealTurn, keptOptions }: {
  petName: string
  mealTurn: boolean
  /** 规则先挑的几份已经显示了 */
  keptOptions: boolean
}): string {
  if (mealTurn && keptOptions) return `${petName}还没比完，先看这几份按你的条件挑的。想让${petName}再细挑一次，点「重试」。`
  if (mealTurn) return `${petName}这次没挑完这一餐，你的问题还在。点「重试」再挑一次。`
  return `${petName}这次没答完，你的问题还在。点「重试」再问一次。`
}

/**
 * 连接断了以后，服务端可能已经答完并存好了：最近一段对话里，最后一句用户的话就是这次的问题，
 * 而且后面跟着回答，就直接显示存好的回答。
 */
export function savedAnswerFor(messages: readonly PetChatHistoryMessage[], question: string): boolean {
  const asked = question.trim()
  if (!asked || messages.length < 2) return false
  const last = messages[messages.length - 1]
  const before = messages[messages.length - 2]
  return last.role !== 'user' && Boolean(String(last.content || '').trim() || last.meta?.diet_recommendation) &&
    before.role === 'user' && String(before.content || '').trim() === asked
}
