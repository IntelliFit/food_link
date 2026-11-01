import type {
  CommissionStatus,
  PromoterCommission,
  PromoterMe,
  PromoterStatus,
  PromoterWithdrawal,
  WithdrawalStatus,
} from '../../../utils/promoter-api'

/** 分转元；余额在退款冲回后可能为负，保留符号。 */
export function formatCents(cents: number): string {
  const value = Number(cents) || 0
  const sign = value < 0 ? '-' : ''
  return `${sign}${(Math.abs(value) / 100).toFixed(2)}`
}

export function formatRate(bps: number): string {
  const percent = (Number(bps) || 0) / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`
}

/** 一次提现的金额：全部可提现余额，超过单笔上限时按上限；不满门槛时为 0。 */
export function withdrawAmount(me: Pick<PromoterMe, 'withdraw_min_cents' | 'withdraw_max_cents'>, availableCents: number): number {
  const amount = Math.min(Number(availableCents) || 0, me.withdraw_max_cents)
  return amount >= me.withdraw_min_cents ? amount : 0
}

export function withdrawRuleText(me: Pick<PromoterMe, 'withdraw_min_cents' | 'withdraw_max_cents'>): string {
  return `满 ¥${formatCents(me.withdraw_min_cents)} 可提现，单笔最多 ¥${formatCents(me.withdraw_max_cents)}，每天 1 次。审核通过后转到你的微信零钱，需要时在提现记录里点「收款」确认，到账后会显示「已到账」。`
}

/** 推广规则同时作为 v1 推广协议正文展示，申请时需勾选同意。 */
export function ruleLines(me: Pick<PromoterMe, 'rate_bps' | 'settle_delay_days'>): string[] {
  return [
    '新用户通过你的推广码或分享链接进入，并在注册后 24 小时内登录，即与你绑定；每位用户只绑定一次。',
    `绑定后 365 天内，对方购买会员的实付金额按 ${formatRate(me.rate_bps)} 计算佣金。小程序虚拟支付订单暂不计佣。`,
    `订单支付 ${me.settle_delay_days} 天后佣金转为可提现；在此之前退款的订单不计佣，之后退款的会从余额中扣回。`,
    '只按真实付费订单结算，不奖励转发、点击或注册本身。不得自买自返、刷单或诱导分享，违规将取消资格并扣回佣金。',
    '佣金属于推广劳务报酬，公司按国家规定处理相关税费。',
  ]
}

export interface StatusCopy {
  title: string
  body: string
}

export function statusCopy(status: PromoterStatus, reviewNote?: string): StatusCopy | null {
  switch (status) {
    case 'pending_review':
      return { title: '申请审核中', body: '我们会核实你的信息，通过后这里会显示你的专属推广码。' }
    case 'rejected':
      return { title: '申请未通过', body: reviewNote ? `原因：${reviewNote}。调整后可以重新申请。` : '调整后可以重新申请。' }
    case 'suspended':
      return { title: '推广资格已暂停', body: '暂停期间新订单的佣金照常记录，如有疑问请联系客服。' }
    case 'terminated':
      return { title: '推广资格已终止', body: '新订单不再产生佣金。如有疑问请联系客服。' }
    default:
      return null
  }
}

const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  pending: '待结算',
  available: '已结算',
  cancelled: '订单退款，不计佣',
  reversed: '订单退款，已扣回',
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface CommissionLine {
  title: string
  sub: string
  amount: string
  status: string
  muted: boolean
}

export function commissionLine(item: PromoterCommission): CommissionLine {
  const muted = item.status === 'cancelled' || item.status === 'reversed'
  const status = item.status === 'pending' && item.settle_at
    ? `${formatDate(item.settle_at)} 可结算`
    : COMMISSION_STATUS_LABEL[item.status] || ''
  return {
    title: `${item.invitee_nickname} 开通会员`,
    sub: `${formatDate(item.paid_at)} · 实付 ¥${formatCents(item.order_amount_cents)} × ${formatRate(item.rate_bps)}`,
    amount: `${muted ? '' : '+'}¥${formatCents(item.commission_cents)}`,
    status,
    muted,
  }
}

/** 分享出去的落地页：首页带上推广码，打开即记录归因。 */
export function sharePath(promoCode: string): string {
  return `/pages/index/index?promo=${encodeURIComponent(promoCode)}`
}

const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  reviewing: '审核中',
  approved: '待打款',
  transferring: '转账中',
  succeeded: '已到账',
  rejected: '未通过',
  failed: '打款失败',
}

export function withdrawalLine(item: PromoterWithdrawal): CommissionLine {
  const muted = item.status === 'rejected' || item.status === 'failed'
  const when = item.status === 'succeeded' && item.finished_at ? item.finished_at : item.created_at
  let sub = `${item.status === 'succeeded' ? '到账' : '申请'}于 ${when ? formatDate(when) : ''}`
  if (muted && item.note) sub = `${item.note}，金额已退回余额`
  else if (item.status === 'transferring' && item.note) sub = item.note
  return {
    title: '佣金提现',
    sub,
    amount: `¥${formatCents(item.amount_cents)}`,
    status: item.receive ? '待收款' : WITHDRAWAL_STATUS_LABEL[item.status] || '',
    muted,
  }
}
