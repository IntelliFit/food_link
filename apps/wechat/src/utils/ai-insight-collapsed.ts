import Taro from '@tarojs/taro'

const AI_INSIGHT_COLLAPSED_KEY = 'ai_insight_collapsed_v1'

export function getAiInsightCollapsed(): boolean {
  try {
    const raw = Taro.getStorageSync(AI_INSIGHT_COLLAPSED_KEY)
    return raw === true
  } catch {
    return false
  }
}

export function setAiInsightCollapsed(collapsed: boolean): void {
  try {
    Taro.setStorageSync(AI_INSIGHT_COLLAPSED_KEY, collapsed)
  } catch {
    // ignore storage errors
  }
}
