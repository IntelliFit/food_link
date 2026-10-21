import type { CaptureEarnings, CaptureLedgerEntry, CaptureSession } from '../../../utils/canteen-capture-api'
import { formatYuan } from '../canteen-capture/capture-view'

export function rulesText(earnings: CaptureEarnings): string[] {
  if (!earnings.rates_published) {
    return ['奖励金额即将公布。你已采集窗口的奖励资格都会保留，公布后自动入账。']
  }
  const lines = [`每个新窗口 ¥${formatYuan(earnings.window_cents)}（同一窗口只奖励第一位提交者）`]
  if (earnings.photo_half_cents > 0) lines.push(`一半以上的菜有实物图，再加 ¥${formatYuan(earnings.photo_half_cents)}`)
  if (earnings.photo_full_cents > 0) lines.push(`每道菜都有实物图，再加 ¥${formatYuan(earnings.photo_full_cents)}`)
  return lines
}

const ENTRY_LABEL: Record<CaptureLedgerEntry['entry_type'], string> = {
  window_reward: '窗口奖励',
  membership_redeem: '兑换会员',
  withdrawal: '提现',
}

const STATUS_LABEL: Record<CaptureLedgerEntry['status'], string> = {
  confirmed: '',
  rate_pending: '金额待公布',
  rejected: '未计奖励',
  requested: '审核中',
  paid: '已打款',
  cancelled: '已退回',
}

export function ledgerLine(entry: CaptureLedgerEntry): { title: string; amount: string; status: string } {
  const amount = entry.amount_cents === 0 ? '' : `${entry.amount_cents > 0 ? '+' : '-'}¥${formatYuan(Math.abs(entry.amount_cents))}`
  return { title: ENTRY_LABEL[entry.entry_type] || '记录', amount, status: entry.review_note || STATUS_LABEL[entry.status] || '' }
}

export function sessionLine(session: CaptureSession): string {
  if (session.status !== 'submitted') return '未提交，点此继续'
  const parts = [`上线 ${session.published_item_count} 道`]
  if (session.exception_status === 'pending' && session.exception_item_count > 0) parts.push(`${session.exception_item_count} 道核对中`)
  if (session.photo_item_count > 0) parts.push(`${session.photo_item_count} 道有实物图`)
  return parts.join(' · ')
}

/** 输入框是元，接口是分；非法或超过可用余额时返回 0。 */
export function parseWithdrawCents(input: string, availableCents: number): number {
  const value = Number(String(input || '').trim())
  if (!Number.isFinite(value) || value <= 0) return 0
  const cents = Math.round(value * 100)
  return cents > availableCents ? 0 : cents
}
