export type FeedbackStatus = 'open' | 'resolved' | 'closed'
export type FeedbackCategory = 'bug' | 'suggestion' | 'experience' | 'other'
export type FeedbackSource = 'app' | 'campus_location' | 'campus_food' | 'food_library'

export type RecentRequestTrace = {
  method?: string
  path?: string
  statusCode?: number
  status_code?: number
  durationMs?: number
  duration_ms?: number
  startedAt?: string
  started_at?: string
  traceId?: string
  trace_id?: string
  requestId?: string
  request_id?: string
  hostName?: string
  host_name?: string
  errorMessage?: string
  error_message?: string
}

export type ConsoleLogEntry = {
  level?: string
  message?: string
  at?: string
}

export type FeedbackItem = {
  id: string
  user_id: string
  category: FeedbackCategory
  content: string
  contact: string
  page_path: string
  app_version: string
  client_info: Record<string, unknown>
  recent_requests: RecentRequestTrace[]
  image_urls?: string[]
  submit_trace_id: string
  submit_request_id: string
  submit_host_name: string
  source?: FeedbackSource
  extra?: Record<string, unknown>
  status: FeedbackStatus
  resolution_message: string
  reward_credits: number
  reward_ledger_id?: string
  created_at: string
  updated_at: string
  user_nickname?: string
  user_avatar?: string
  user_telephone?: string
}

export const sourceLabels: Record<FeedbackSource | string, string> = {
  app: 'App',
  campus_location: '校园目录',
  campus_food: '校园食物',
  food_library: '公共食物库',
}

export type FeedbackListResponse = {
  items: FeedbackItem[]
  page: number
  limit: number
  total: number
}

export const categoryLabels: Record<string, string> = {
  bug: '问题反馈',
  suggestion: '功能建议',
  experience: '使用体验',
  other: '其他',
}

export const statusLabels: Record<FeedbackStatus, string> = {
  open: '待处理',
  resolved: '已采纳',
  closed: '不采纳',
}
