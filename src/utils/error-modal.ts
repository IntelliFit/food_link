import Taro from '@tarojs/taro'

function stripTraceSuffix(message: string): string {
  return String(message || '')
    .replace(/\s*[（(]\s*traceid\s*[:：]\s*[a-zA-Z0-9-]+\s*[）)]\s*/gi, ' ')
    .replace(/\s*traceid\s*[:：]\s*[a-zA-Z0-9-]+\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function extractTraceId(error: unknown): string {
  const traceId = (error as { traceId?: unknown })?.traceId
  if (typeof traceId === 'string' && traceId.trim()) return traceId.trim()
  const message = (error as { message?: unknown })?.message
  const text = typeof message === 'string' ? message : String(error || '')
  const match = text.match(/traceid\s*[:：]\s*([a-zA-Z0-9-]+)/i)
  return (match?.[1] || '').trim() || 'no-trace-id'
}

export function formatApiErrorModalBody(summary: string): string {
  const line = stripTraceSuffix(summary) || '请求失败，请稍后重试'
  return [
    line,
    '',
    '请点击下方「复制」按钮。',
    '将剪贴板内容反馈给工作人员或开发者，便于定位问题。'
  ].join('\n')
}

export async function showUnifiedApiError(error: unknown, fallback: string): Promise<void> {
  const rawMessage = (error as { message?: unknown })?.message
  const message = typeof rawMessage === 'string' ? rawMessage : fallback
  const content = formatApiErrorModalBody(message || fallback || '请求失败，请稍后重试')
  const traceId = extractTraceId(error)
  try {
    await Taro.showModal({
      title: '请求失败',
      content,
      showCancel: false,
      confirmText: '复制',
    })
    try {
      await Taro.setClipboardData({ data: traceId })
      Taro.showToast({ title: '已复制', icon: 'success' })
    } catch {
      Taro.showToast({ title: '复制失败，请手动记录', icon: 'none' })
    }
  } catch {
    Taro.showModal({
      title: '请求失败',
      content: stripTraceSuffix(message || fallback || '请求失败，请稍后重试'),
      showCancel: false,
      confirmText: '确定',
    })
  }
}
