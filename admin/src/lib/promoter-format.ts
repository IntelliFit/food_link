import type { CommissionStatus, PromoterStatus, WithdrawalStatus } from '../types/promoter.ts'

export const PROMOTER_STATUS_LABEL: Record<PromoterStatus, string> = {
  pending_review: '待审核',
  active: '正常',
  suspended: '已暂停',
  terminated: '已终止',
  rejected: '已驳回',
}

export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  reviewing: '待审核',
  approved: '待打款',
  transferring: '转账中',
  succeeded: '已打款',
  rejected: '已驳回',
  failed: '打款失败',
}

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: '冻结中',
  available: '已结算',
  cancelled: '已取消',
  reversed: '已扣回',
}

/** 分转元，保留负号（退款扣回后余额可能为负）。 */
export function yuan(cents: number): string {
  const value = Number(cents) || 0
  return `${value < 0 ? '-' : ''}¥${(Math.abs(value) / 100).toFixed(2)}`
}

/** 个人比例为空时用默认比例；返回如 20%、12.5%。 */
export function ratePercent(bps: number | null | undefined, defaultBps = 2000): string {
  const percent = (bps ?? defaultBps) / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, '')}%`
}

/** 解析运营输入的百分比；空串表示恢复默认（null），非法输入返回 undefined。 */
export function parseRateInput(raw: string): number | null | undefined {
  const text = raw.trim().replace(/%$/, '')
  if (text === '') return null
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return undefined
  const bps = Math.round(Number(text) * 100)
  return bps >= 0 && bps <= 10000 ? bps : undefined
}

/** 每个状态下运营可以把推广员改成的状态，和后端 adminTransitions 一致。 */
export function promoterStatusActions(status: PromoterStatus): Array<{ target: PromoterStatus; label: string; destructive: boolean }> {
  switch (status) {
    case 'active':
      return [{ target: 'suspended', label: '暂停', destructive: false }, { target: 'terminated', label: '终止', destructive: true }]
    case 'suspended':
      return [{ target: 'active', label: '恢复', destructive: false }, { target: 'terminated', label: '终止', destructive: true }]
    default:
      return []
  }
}
