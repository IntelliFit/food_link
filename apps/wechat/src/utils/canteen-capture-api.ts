import { authenticatedRequest, uploadAuthenticatedFile } from './api'

/** 窗口采集：一次到店采集一个窗口的菜单、实物照片和奖励。 */
export type CaptureVenueType = 'university' | 'community' | 'office_park' | 'corporate'
export type CaptureServiceMode = 'unknown' | 'fixed_portion' | 'combo' | 'self_select'
export type CaptureSessionStatus = 'draft' | 'extracting' | 'extracted' | 'extract_failed' | 'submitted'
export type CaptureAssetKind = 'menu' | 'dish' | 'stall' | 'other'
export type CaptureItemStatus = 'passed' | 'exception' | 'published' | 'discarded' | 'kept'
export type CaptureRewardStatus = 'eligible' | 'no_items' | 'window_taken' | 'rejected' | 'confirmed' | 'rate_pending'

export interface CaptureSession {
  id: string
  venue_type: CaptureVenueType
  organization_name: string
  area_name?: string
  canteen_name: string
  floor?: string
  window_name: string
  service_mode: CaptureServiceMode
  status: CaptureSessionStatus
  extract_error?: string
  exception_status: 'none' | 'pending' | 'resolved'
  menu_item_count: number
  published_item_count: number
  exception_item_count: number
  photo_item_count: number
  submitted_at?: string
  created_at?: string
}

export interface CaptureAsset {
  id: string
  session_id: string
  kind: CaptureAssetKind
  item_key?: string
  dish_name?: string
  url?: string
}

export interface CaptureItem {
  key: string
  kind: 'dish' | 'combo' | 'ingredient'
  name: string
  price_text?: string
  prices?: number[]
  price_unit?: string
  option_groups?: Array<{ title: string; choices: string[] }>
  note?: string
  status: CaptureItemStatus
  source: 'model' | 'collector' | 'local_agent'
  dish_asset_ids?: string[]
  dish_photo_urls: string[]
}

export interface CaptureReward {
  status: CaptureRewardStatus
  amount_cents: number
  rates_published: boolean
  photo_tier: 'none' | 'half' | 'full'
  sellable_items: number
  photo_items: number
  message: string
}

export interface CaptureSessionView {
  session: CaptureSession
  assets: CaptureAsset[]
  items: CaptureItem[]
  reward: CaptureReward
}

export interface CaptureSessionInput {
  client_session_key: string
  venue_type: CaptureVenueType
  school_id?: string
  campus_id?: string
  canteen_id?: string
  organization_name?: string
  area_name?: string
  canteen_name?: string
  floor?: string
  window_name: string
  service_mode: CaptureServiceMode
}

export interface CapturedWindow {
  window_key: string
  floor: string
  window_name: string
  rewarded: boolean
  last_at?: string
  sessions: number
}

export interface CaptureLedgerEntry {
  id: string
  entry_type: 'window_reward' | 'membership_redeem' | 'withdrawal'
  status: 'confirmed' | 'rate_pending' | 'rejected' | 'requested' | 'paid' | 'cancelled'
  amount_cents: number
  review_note?: string
  meta?: Record<string, unknown>
  created_at?: string
}

export interface CaptureMembershipOption {
  code: string
  title: string
  days: number
  cost_cents: number
}

export interface CaptureEarnings {
  totals: {
    earned_cents: number
    spent_cents: number
    withdrawing_cents: number
    withdrawn_cents: number
    available_cents: number
    rate_pending_windows: number
    reward_windows: number
  }
  rates_published: boolean
  window_cents: number
  photo_half_cents: number
  photo_full_cents: number
  withdraw_min_cents: number
  membership_options: CaptureMembershipOption[]
  entries: CaptureLedgerEntry[]
  sessions: CaptureSession[]
  session_total: number
}

const BASE = '/api/canteen-capture'

async function call<T>(path: string, options: Parameters<typeof authenticatedRequest>[1] = {}): Promise<T> {
  const response = await authenticatedRequest(`${BASE}${path}`, { timeout: 30000, ...options })
  return response.data as T
}

export function createCaptureSession(input: CaptureSessionInput): Promise<CaptureSessionView> {
  return call('/sessions', { method: 'POST', data: input })
}

export function getCaptureSession(sessionId: string): Promise<CaptureSessionView> {
  return call(`/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' })
}

/** 上传一张原图；实物照片可直接绑定识别出的菜（item_key）或写上菜名（dish_name）。 */
export async function uploadCaptureAsset(
  sessionId: string,
  localPath: string,
  kind: CaptureAssetKind,
  binding: { itemKey?: string; dishName?: string } = {},
): Promise<CaptureAsset> {
  const payload = await uploadAuthenticatedFile(localPath, `${BASE}/sessions/${encodeURIComponent(sessionId)}/assets`, {
    kind,
    item_key: binding.itemKey || '',
    dish_name: binding.dishName || '',
  })
  if (!payload?.id) throw new Error('照片上传失败，请重试')
  return payload as CaptureAsset
}

export function updateCaptureAsset(
  sessionId: string,
  assetId: string,
  patch: { kind?: CaptureAssetKind; item_key?: string; dish_name?: string; remove?: boolean },
): Promise<CaptureSessionView> {
  return call(`/sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(assetId)}`, { method: 'PATCH', data: patch })
}

export function startCaptureExtraction(sessionId: string): Promise<CaptureSessionView> {
  return call(`/sessions/${encodeURIComponent(sessionId)}/extract`, { method: 'POST', data: {} })
}

export function submitCaptureSession(sessionId: string): Promise<CaptureSessionView> {
  return call(`/sessions/${encodeURIComponent(sessionId)}/submit`, { method: 'POST', data: {}, timeout: 60000 })
}

export async function listCapturedWindows(params: {
  venue_type: CaptureVenueType
  canteen_id?: string
  organization_name?: string
  canteen_name?: string
}): Promise<CapturedWindow[]> {
  const query = Object.entries(params)
    .filter(([, value]) => !!value)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&')
  const data = await call<{ items: CapturedWindow[] }>(`/windows?${query}`, { method: 'GET' })
  return data?.items || []
}

export function getCaptureEarnings(): Promise<CaptureEarnings> {
  return call('/earnings', { method: 'GET' })
}

export function redeemCaptureMembership(optionCode: string, requestKey: string): Promise<CaptureEarnings> {
  return call('/earnings/membership', { method: 'POST', data: { option_code: optionCode, request_key: requestKey } })
}

export function requestCaptureWithdrawal(amountCents: number, requestKey: string): Promise<CaptureEarnings> {
  return call('/earnings/withdrawals', { method: 'POST', data: { amount_cents: amountCents, request_key: requestKey } })
}

export function newCaptureKey(prefix: string): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined
  return `${prefix}-${cryptoObject?.randomUUID?.call(cryptoObject) || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}
