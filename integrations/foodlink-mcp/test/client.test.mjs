import test from 'node:test'
import assert from 'node:assert/strict'
import { FoodLinkClient } from '../src/client.mjs'

test('analyzeText sends bearer auth and stable idempotency key', async () => {
  let captured
  const client = new FoodLinkClient({ apiKey: 'flk_beta_test', baseURL: 'https://example.test/open/v1', fetchImpl: async (url, init) => {
    captured = { url, init }
    return new Response(JSON.stringify({ code: 0, data: { task_id: 'task-1' } }), { status: 202, headers: { 'Content-Type': 'application/json' } })
  } })
  const result = await client.analyzeText({ text: '一碗牛肉面', idempotency_key: 'meal-1' })
  assert.equal(result.task_id, 'task-1')
  assert.equal(captured.url, 'https://example.test/open/v1/food-analyses')
  assert.equal(captured.init.headers.get('Authorization'), 'Bearer flk_beta_test')
  assert.equal(captured.init.headers.get('Idempotency-Key'), 'meal-1')
})

test('402 exposes recharge URL without initiating payment', async () => {
  const client = new FoodLinkClient({ apiKey: 'flk_beta_test', developerURL: 'https://healthymax.cn/developer/console', fetchImpl: async () => new Response(JSON.stringify({ message: 'API 点数余额不足' }), { status: 402, headers: { 'Content-Type': 'application/json' } }) })
  await assert.rejects(() => client.analyzeText({ text: '苹果' }), (error) => {
    assert.equal(error.status, 402)
    assert.equal(error.rechargeURL, 'https://healthymax.cn/developer/console')
    return true
  })
})

test('history and personal read tools use documented owner-scoped endpoints', async () => {
  const urls = []
  const client = new FoodLinkClient({ apiKey: 'flk_beta_test', baseURL: 'https://example.test/open/v1', fetchImpl: async (url) => {
    urls.push(url)
    return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } })
  await client.listAnalyses(25, 50)
  await client.listFoodRecords('2026-09-10', 30, 60)
  await client.getHealthSummary('30d')
  assert.deepEqual(urls, [
    'https://example.test/open/v1/food-analyses?limit=25&offset=50',
    'https://example.test/open/v1/me/food-records?limit=30&offset=60&date=2026-09-10',
    'https://example.test/open/v1/me/health-summary?range=30d',
  ])
})
