import Taro from '@tarojs/taro'
import { authenticatedRequest, getAccessToken } from './api'

/** 推广佣金：推广员申请、推广码归因和佣金明细。金额单位都是分。 */
export type PromoterStatus = 'none' | 'pending_review' | 'active' | 'suspended' | 'terminated' | 'rejected'
export type CommissionStatus = 'pending' | 'available' | 'cancelled' | 'reversed'
export type WithdrawalStatus = 'reviewing' | 'approved' | 'transferring' | 'succeeded' | 'rejected' | 'failed'

export interface PromoterSummary {
  available_cents: number
  pending_cents: number
  total_earned_cents: number
  withdrawing_cents: number
  withdrawn_cents: number
  invitee_count: number
  paid_order_count: number
}

export interface PromoterMe {
  enabled: boolean
  status: PromoterStatus
  promo_code?: string
  rate_bps: number
  review_note?: string
  agreement_version: string
  settle_delay_days: number
  withdraw_min_cents: number
  withdraw_max_cents: number
  summary?: PromoterSummary
}

export interface PromoterCommission {
  id: string
  invitee_nickname: string
  plan_code: string
  order_amount_cents: number
  rate_bps: number
  commission_cents: number
  status: CommissionStatus
  paid_at: string
  settle_at: string
  settled_at?: string
}

export interface PromoterCommissionPage {
  items: PromoterCommission[]
  total: number
}

export interface PromoterWithdrawal {
  id: string
  amount_cents: number
  net_amount_cents: number
  status: WithdrawalStatus
  /** 驳回或打款失败的原因 */
  note: string
  created_at?: string
  finished_at?: string
}

export interface PromoterWithdrawalPage {
  items: PromoterWithdrawal[]
  total: number
}

export type BindReason = 'bound' | 'disabled' | 'invalid_code' | 'self' | 'not_new_user' | 'already_bound'

const BASE = '/api/promoter'

async function call<T>(path: string, options: Parameters<typeof authenticatedRequest>[1] = {}): Promise<T> {
  const response = await authenticatedRequest(`${BASE}${path}`, { timeout: 15000, ...options })
  return response.data as T
}

export function getPromoterMe(): Promise<PromoterMe> {
  return call('/me', { method: 'GET' })
}

export function applyPromoter(agreementVersion: string, applyNote: string): Promise<PromoterMe> {
  return call('/apply', {
    method: 'POST',
    data: { agreement_version: agreementVersion, agreement_accepted: true, apply_note: applyNote },
  })
}

export function getPromoterCommissions(page: number, limit = 20): Promise<PromoterCommissionPage> {
  return call(`/commissions?page=${page}&limit=${limit}`, { method: 'GET' })
}

export function getPromoterWithdrawals(page: number, limit = 20): Promise<PromoterWithdrawalPage> {
  return call(`/withdrawals?page=${page}&limit=${limit}`, { method: 'GET' })
}

/** requestKey 由调用方生成；网络失败后用同一个 key 重试，后端只会记一笔。 */
export function createPromoterWithdrawal(amountCents: number, requestKey: string): Promise<PromoterWithdrawal> {
  return call('/withdrawals', { method: 'POST', data: { amount_cents: amountCents, request_key: requestKey } })
}

function bindPromoCode(promoCode: string, source: string): Promise<{ bound: boolean; reason: BindReason }> {
  return call('/bind', { method: 'POST', data: { promo_code: promoCode, source } })
}

// 推广码只对注册 24 小时内的新用户有效，本地保留稍长一点，覆盖先浏览后登录的情况。
const PENDING_PROMO_CODE_KEY = 'pending_promo_code_v1'
const PENDING_PROMO_CODE_TTL_MS = 48 * 60 * 60 * 1000
const PROMO_CODE_PATTERN = /^[A-Z0-9]{6,12}$/

interface PendingPromoCode {
  code: string
  source: string
  createdAt: number
}

export function normalizePromoCode(raw: unknown): string {
  const code = String(raw || '').trim().toUpperCase()
  return PROMO_CODE_PATTERN.test(code) ? code : ''
}

/** 从启动参数读推广码：分享链接带 promo=，小程序码 scene 里是 pc=。 */
export function parsePromoCodeFromLaunchOptions(options?: any): { code: string; source: string } {
  const fromQuery = normalizePromoCode(options?.query?.promo)
  if (fromQuery) return { code: fromQuery, source: 'share_link' }
  const rawScene = String(options?.query?.scene || '').trim()
  let decodedScene = rawScene
  try {
    decodedScene = decodeURIComponent(rawScene)
  } catch {
    // 保留原始 scene，继续兼容未编码参数。
  }
  const fromScene = normalizePromoCode(new URLSearchParams(decodedScene).get('pc'))
  return fromScene ? { code: fromScene, source: 'qr' } : { code: '', source: '' }
}

export function writePendingPromoCode(code: string, source: string) {
  const normalized = normalizePromoCode(code)
  if (!normalized) return
  try {
    // 同一台设备只记第一次带进来的推广码，避免后打开的链接覆盖最初的归因。
    if (readPendingPromoCode()) return
    const payload: PendingPromoCode = { code: normalized, source, createdAt: Date.now() }
    Taro.setStorageSync(PENDING_PROMO_CODE_KEY, JSON.stringify(payload))
  } catch {
    // 归因是尽力而为，存储失败不影响使用。
  }
}

export function clearPendingPromoCode() {
  try {
    Taro.removeStorageSync(PENDING_PROMO_CODE_KEY)
  } catch {
    // ignore storage errors
  }
}

export function readPendingPromoCode(): PendingPromoCode | null {
  try {
    const raw = Taro.getStorageSync(PENDING_PROMO_CODE_KEY)
    if (!raw || typeof raw !== 'string') return null
    const payload = JSON.parse(raw) as Partial<PendingPromoCode>
    const code = normalizePromoCode(payload.code)
    const createdAt = Number(payload.createdAt || 0)
    if (!code || !Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_PROMO_CODE_TTL_MS) {
      clearPendingPromoCode()
      return null
    }
    return { code, source: String(payload.source || 'promo_code'), createdAt }
  } catch {
    clearPendingPromoCode()
    return null
  }
}

let bindInFlight = false

/**
 * 登录后把待绑定的推广码交给后端。后端给出明确结果（绑定成功、已绑定、不是新用户等）
 * 就清掉本地记录；网络失败时保留，下次启动或登录再试。
 */
export async function bindPendingPromoCode(): Promise<BindReason | ''> {
  const pending = readPendingPromoCode()
  if (!pending || !getAccessToken() || bindInFlight) return ''
  bindInFlight = true
  try {
    const result = await bindPromoCode(pending.code, pending.source)
    clearPendingPromoCode()
    return result.reason
  } catch (error) {
    console.warn('[promoter] 推广码绑定失败，稍后重试', String((error as any)?.message || error || ''))
    return ''
  } finally {
    bindInFlight = false
  }
}
