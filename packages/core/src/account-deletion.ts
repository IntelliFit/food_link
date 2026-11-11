export interface AccountDeletionStatus {
  state: 'active' | 'pending' | 'cleaning' | 'completed' | 'cancelled'
  requested_at?: string
  execute_at?: string
  can_cancel: boolean
}

export const ACCOUNT_DELETION_COPY = {
  title: '注销账号',
  warning: '最终注销后，健康档案、饮食与运动记录、照片、收藏和对话将无法恢复。必要的交易与安全凭证按规定单独保留。',
  cooling: '保留 7 天撤销机会',
  immediate: '立即注销，跳过冷静期',
  pending: '注销申请已提交',
  cleaning: '正在永久清理',
  completed: '账号已注销',
  note: '打开应用或登录不会自动撤销。截止前可明确撤销，截止后自动开始永久清理。正在进行的识别会停止，恢复后可重新发起。',
  rights: '冷静期内暂停使用，会员按原到期时间计算。剩余权益与退款问题可通过客服处理。注销账号不代表已取消第三方自动续费。',
} as const

export function formatDeletionTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
