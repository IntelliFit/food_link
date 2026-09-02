// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { developerApi, getDeveloperToken, loginWithSMS, resolveDeveloperAPIBaseURL, setDeveloperToken } from './developer-api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('developer api client', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('routes Cloudflare previews to dev while keeping the official domain on production', () => {
    expect(resolveDeveloperAPIBaseURL(undefined, 'dev.food-link.pages.dev')).toBe('https://dev.api.healthymax.cn')
    expect(resolveDeveloperAPIBaseURL(undefined, 'a1b2c3.food-link.pages.dev')).toBe('https://dev.api.healthymax.cn')
    expect(resolveDeveloperAPIBaseURL(undefined, 'healthymax.cn')).toBe('https://api.healthymax.cn')
    expect(resolveDeveloperAPIBaseURL('https://custom-api.example/', 'healthymax.cn')).toBe('https://custom-api.example')
  })

  it('stores SMS login token only in the current browser session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ access_token: 'jwt-session-token' })))
    await loginWithSMS('13800138000', '123456')
    expect(getDeveloperToken()).toBe('jwt-session-token')
    expect(localStorage.getItem('foodlink_developer_access_token')).toBeNull()
  })

  it('adds bearer auth and clears an invalid session on 401', async () => {
    setDeveloperToken('expired-token')
    const mockedFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer expired-token')
      return jsonResponse({ detail: '登录状态无效' }, 401)
    })
    vi.stubGlobal('fetch', mockedFetch)
    await expect(developerApi.listApps()).rejects.toThrow('登录状态无效')
    expect(getDeveloperToken()).toBe('')
  })

  it('actively syncs a pending WeChat order with a POST request', async () => {
    setDeveloperToken('valid-token')
    const mockedFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/api/developer/payment-orders/OA123/sync')
      expect(init?.method).toBe('POST')
      return jsonResponse({ code: 0, data: { order_no: 'OA123', status: 'paid' } })
    })
    vi.stubGlobal('fetch', mockedFetch)
    const order = await developerApi.syncPayment('OA123')
    expect(order.status).toBe('paid')
  })
})
