import type { ConsoleLogEntry, FeedbackItem } from '@/types/feedback'

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-6)}`
}

export function formatTime(value: string, short = false): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(short ? {} : { year: 'numeric', second: '2-digit' }),
  }).format(date)
}

export function displayUser(item: FeedbackItem): string {
  return item.user_nickname || item.user_telephone || shortId(item.user_id || '') || '未知用户'
}

export function firstTraceId(item: FeedbackItem): string {
  const found = item.recent_requests?.find((trace) => trace.traceId || trace.trace_id)
  return found ? (found.traceId || found.trace_id || '') : ''
}

/** 请求 trace 状态码展示（0 是合法值，不能用 || 判断） */
export function formatTraceStatusCode(trace: { statusCode?: number; status_code?: number }): string {
  const code = trace.statusCode ?? trace.status_code
  if (code === undefined || code === null) return '无状态码'
  if (code === 0) return '0（未收到响应）'
  return String(code)
}

export function parseConsoleLogs(clientInfo: Record<string, unknown> | undefined): ConsoleLogEntry[] {
  const raw = clientInfo?.console_logs
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is ConsoleLogEntry => !!item && typeof item === 'object')
}
