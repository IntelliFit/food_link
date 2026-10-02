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
  createKey: (appId: string, name: string, scopes: string[]) => request<KeyMaterial>(`/api/developer/apps/${appId}/keys`, { method: 'POST', body: JSON.stringify({ name, scopes }) }),
  revokeKey: (appId: string, keyId: string) => request<{ revoked: boolean }>(`/api/developer/apps/${appId}/keys/${keyId}`, { method: 'DELETE' }),
  listLedger: (appId: string) => request<{ entries: Array<{ id: string; entry_type: string; delta_units: number; balance_after: number; description: string; created_at?: string }> }>(`/api/developer/apps/${appId}/ledger?limit=50`),
  listPackages: () => request<{ packages: CreditPackage[] }>('/api/developer/packages', {}, false),
  createPayment: (appId: string, packageCode: string) => request<PaymentOrder>('/api/developer/payment-orders', { method: 'POST', body: JSON.stringify({ app_id: appId, package_code: packageCode }) }),
  getPayment: (orderNo: string) => request<PaymentOrder>(`/api/developer/payment-orders/${orderNo}`),
  syncPayment: (orderNo: string) => request<PaymentOrder>(`/api/developer/payment-orders/${orderNo}/sync`, { method: 'POST' }),
}

export const openApiBaseURL = `${API_BASE_URL}/open/v1`

export type OpenAPIConnectionResult = {
  account: { app_id: string; app_name: string; balance_units: number; scopes: string[] }
  searchMessage: string
}

export async function checkOpenAPIConnection(rawKey: string): Promise<OpenAPIConnectionResult> {
  const key = rawKey.trim()
  if (!key.startsWith('flk_beta_') || key.includes('…') || key.includes('...')) throw new Error('请使用创建时保存的完整密钥，不能使用列表中的密钥前缀。')
  async function get<T>(path: string): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${openApiBaseURL}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) })
    } catch {
      throw new Error('API 连接超时或网络未连通，请检查网络后重试。')
    }
    const payload = await response.json().catch(() => ({})) as Partial<ApiEnvelope<T>> & { detail?: string }
    if (!response.ok) {
      if (response.status === 401) throw new Error('密钥无效或已吊销。请新建并保存完整密钥后再试。')
      if (response.status === 403) throw new Error('这把密钥缺少所需功能权限，请重新创建包含相应权限的密钥。')
      throw new Error(`验证暂未成功（${response.status}），请稍后再试。`)
    }
    if (payload.code !== undefined && payload.code !== 0) throw new Error('API 未返回成功结果，请稍后再试。')
    return (payload.data ?? payload) as T
  }
  const account = await get<OpenAPIConnectionResult['account']>('/account')
  if (!account || !Array.isArray(account.scopes) || typeof account.balance_units !== 'number') throw new Error('账户返回内容不完整，请稍后再试。')
  if (!account.scopes.includes('food:search')) return { account, searchMessage: '这把密钥没有营养查询权限，已跳过搜索验证。' }
  try {
    const search = await get<{ items: unknown[] }>('/foods/search?query=%E9%B8%A1%E8%83%B8%E8%82%89&limit=3')
    if (!Array.isArray(search?.items)) throw new Error('营养查询返回内容不完整，请稍后再试。')
    return { account, searchMessage: `营养查询成功：找到 ${search.items.length} 条结果。` }
  } catch (e) {
    return { account, searchMessage: `账户已连通，营养查询未通过：${e instanceof Error ? e.message : '请稍后再试。'}` }
  }
}
