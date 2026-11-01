/** 推广佣金后台类型，金额单位都是分。 */
export type PromoterStatus = 'pending_review' | 'active' | 'suspended' | 'terminated' | 'rejected'
export type CommissionStatus = 'pending' | 'available' | 'cancelled' | 'reversed'
export type WithdrawalStatus = 'reviewing' | 'approved' | 'transferring' | 'succeeded' | 'rejected' | 'failed'

export type PromoterSummary = {
  available_cents: number
  pending_cents: number
  total_earned_cents: number
  withdrawing_cents: number
  withdrawn_cents: number
  invitee_count: number
  paid_order_count: number
}

export type AdminPromoter = {
  id: string
  user_id: string
  promo_code: string
  status: PromoterStatus
  commission_rate_bps?: number | null
  apply_note: string
  real_name_confirmed: boolean
  agreement_version: string
  review_note: string
  reviewed_by: string
  reviewed_at?: string
  created_at?: string
  nickname: string
  summary: PromoterSummary
}

export type AdminWithdrawal = {
  id: string
  promoter_id: string
  amount_cents: number
  net_amount_cents: number
  status: WithdrawalStatus
  payout_method: 'manual' | 'wechat_transfer'
  fail_reason: string
  review_note: string
  reviewed_by: string
  reviewed_at?: string
  finished_at?: string
  created_at?: string
  promo_code: string
  promoter_status: PromoterStatus
  user_id: string
  nickname: string
  available_cents: number
  /** 微信转账单状态，线下打款为空 */
  transfer_state: string
  transfer_fail_reason: string
  transfer_last_error: string
  out_bill_no: string
}

export type AdminWithdrawalPage = Page<AdminWithdrawal> & { transfer_enabled: boolean }

export type AdminCommission = {
  id: string
  payment_id: string
  order_no: string
  order_status: string
  pay_channel: string
  plan_code: string
  invitee_user_id: string
  invitee_nickname: string
  order_amount_cents: number
  rate_bps: number
  commission_cents: number
  status: CommissionStatus
  paid_at: string
  settle_at: string
  settled_at?: string
  reversed_at?: string
  reverse_reason: string
}

export type Page<T> = { items: T[]; total: number }
