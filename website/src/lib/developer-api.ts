const PRODUCTION_API_BASE_URL = 'https://api.healthymax.cn'
const DEVELOPMENT_API_BASE_URL = 'https://dev.api.healthymax.cn'

export function resolveDeveloperAPIBaseURL(
  explicitURL = import.meta.env.VITE_API_BASE_URL,
  hostname = typeof window === 'undefined' ? '' : window.location.hostname,
) {
  const configured = explicitURL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const normalizedHost = hostname.trim().toLowerCase()
  const isPreview = normalizedHost.endsWith('.pages.dev')
    || normalizedHost === 'dev.healthymax.cn'
    || normalizedHost === 'localhost'
    || normalizedHost === '127.0.0.1'

  return isPreview ? DEVELOPMENT_API_BASE_URL : PRODUCTION_API_BASE_URL
}

const API_BASE_URL = resolveDeveloperAPIBaseURL()
const TOKEN_KEY = 'foodlink_developer_access_token'

export type ApiKeySummary = {
  id: string
  app_id: string
  name: string
  key_prefix: string
  scopes: string[]
  status: string
  last_used_at?: string
  created_at?: string
}

export type DeveloperApp = {
  id: string
  name: string
  status: string
  balance_units: number
  created_at?: string
  keys?: ApiKeySummary[]
}

export type CreditPackage = {
  code: string
  name: string
  description: string
  units: number
  amount_fen: number
}

export type KeyMaterial = {
  app: DeveloperApp
  api_key: ApiKeySummary
  secret: string
}

export type PaymentOrder = {
  order_no: string
  app_id: string
  package_code: string
  units: number
  amount_fen: number
  status: string
  qr_code_value?: string
  code_url?: string
  expires_at?: string
}

type ApiEnvelope<T> = { code: number; message: string; data: T }

export function getDeveloperToken() {
  return sessionStorage.getItem(TOKEN_KEY) ?? ''
}

export function setDeveloperToken(token: string) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (authenticated) {
    const token = getDeveloperToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  const payload = await response.json().catch(() => ({})) as Partial<ApiEnvelope<T>> & { detail?: string }
  if (!response.ok) {
    if (response.status === 401) setDeveloperToken('')
    throw new Error(payload.detail ?? payload.message ?? `请求失败（${response.status}）`)
  }
  return (payload.data ?? payload) as T
}

export async function sendSMSCode(phone: string) {
  return request<{ cooldown_seconds: number }>('/api/app/sms/send-code', {
    method: 'POST', body: JSON.stringify({ phone }),
  }, false)
}

export async function loginWithSMS(phone: string, code: string) {
  const data = await request<{ access_token: string }>('/api/app/login/sms', {
    method: 'POST', body: JSON.stringify({ phone, code }),
  }, false)
  setDeveloperToken(data.access_token)
  return data
}

export const developerApi = {
  listApps: () => request<{ apps: DeveloperApp[] }>('/api/developer/apps'),
  createApp: (name: string) => request<KeyMaterial>('/api/developer/apps', { method: 'POST', body: JSON.stringify({ name }) }),
  createKey: (appId: string, name: string) => request<KeyMaterial>(`/api/developer/apps/${appId}/keys`, { method: 'POST', body: JSON.stringify({ name }) }),
  revokeKey: (appId: string, keyId: string) => request<{ revoked: boolean }>(`/api/developer/apps/${appId}/keys/${keyId}`, { method: 'DELETE' }),
  listLedger: (appId: string) => request<{ entries: Array<{ id: string; entry_type: string; delta_units: number; balance_after: number; description: string; created_at?: string }> }>(`/api/developer/apps/${appId}/ledger?limit=50`),
  listPackages: () => request<{ packages: CreditPackage[] }>('/api/developer/packages', {}, false),
  createPayment: (appId: string, packageCode: string) => request<PaymentOrder>('/api/developer/payment-orders', { method: 'POST', body: JSON.stringify({ app_id: appId, package_code: packageCode }) }),
  getPayment: (orderNo: string) => request<PaymentOrder>(`/api/developer/payment-orders/${orderNo}`),
  syncPayment: (orderNo: string) => request<PaymentOrder>(`/api/developer/payment-orders/${orderNo}/sync`, { method: 'POST' }),
}

export const openApiBaseURL = `${API_BASE_URL}/open/v1`
