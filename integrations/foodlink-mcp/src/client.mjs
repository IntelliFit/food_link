import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'

export class FoodLinkClient {
  constructor({ apiKey, baseURL = 'https://api.healthymax.cn/open/v1', developerURL = 'https://healthymax.cn/developer/console', fetchImpl = fetch } = {}) {
    this.apiKey = String(apiKey || '').trim()
    this.baseURL = String(baseURL).replace(/\/+$/, '')
    this.developerURL = developerURL
    this.fetch = fetchImpl
  }

  async request(path, init = {}) {
    if (!this.apiKey) throw new Error('缺少 FOODLINK_API_KEY，请先在食探开发者控制台创建密钥')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${this.apiKey}`)
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await this.fetch(`${this.baseURL}${path}`, { ...init, headers })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = payload?.message || payload?.detail || `食探 API 请求失败（${response.status}）`
      const error = new Error(message)
      error.status = response.status
      error.rechargeURL = response.status === 402 ? this.developerURL : undefined
      throw error
    }
    return payload?.data ?? payload
  }

  account() { return this.request('/account') }
  analyzeText({ text, mode = 'standard', meal_type = '', additional_context = '', date = '', idempotency_key = randomUUID() }) {
    return this.request('/food-analyses', { method: 'POST', headers: { 'Idempotency-Key': idempotency_key }, body: JSON.stringify({ text, mode, meal_type, additional_context, date }) })
  }
  async uploadImage(filePath) {
    const bytes = await readFile(filePath)
    const form = new FormData()
    form.append('file', new Blob([bytes]), basename(filePath))
    return this.request('/uploads', { method: 'POST', body: form })
  }
  analyzeImages({ image_urls, mode = 'standard', meal_type = '', additional_context = '', date = '', idempotency_key = randomUUID() }) {
    return this.request('/food-analyses', { method: 'POST', headers: { 'Idempotency-Key': idempotency_key }, body: JSON.stringify({ image_urls, mode, meal_type, additional_context, date }) })
  }
  getAnalysis(taskId) { return this.request(`/food-analyses/${encodeURIComponent(taskId)}`) }
  listAnalyses(limit = 20, offset = 0) {
    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20))
    const normalizedOffset = Math.max(0, Number(offset) || 0)
    return this.request(`/food-analyses?limit=${normalizedLimit}&offset=${normalizedOffset}`)
  }
  listFoodRecords(date = '', limit = 20, offset = 0) {
    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20))
    const normalizedOffset = Math.max(0, Number(offset) || 0)
    const query = new URLSearchParams({ limit: String(normalizedLimit), offset: String(normalizedOffset) })
    if (String(date || '').trim()) query.set('date', String(date).trim())
    return this.request(`/me/food-records?${query}`)
  }
  getHealthSummary(range = 'week') {
    return this.request(`/me/health-summary?range=${encodeURIComponent(String(range || 'week'))}`)
  }
  searchFood(query, limit = 5) { return this.request(`/foods/search?query=${encodeURIComponent(query)}&limit=${Math.max(1, Math.min(20, Number(limit) || 5))}`) }
}
