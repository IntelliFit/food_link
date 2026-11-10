import Taro from '@tarojs/taro'

const AI_INSIGHT_COLLAPSED_KEY = 'ai_insight_collapsed_v1'

export function getAiInsightCollapsed(): boolean {
  try {
    const raw = Taro.getStorageSync(AI_INSIGHT_COLLAPSED_KEY)
    // 默认收起（结果页别一打开就满屏字）；用户手动展开过才记住展开
    return raw !== false
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
