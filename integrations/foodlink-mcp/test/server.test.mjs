import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('stdio MCP forwards analyze tool to FoodLink HTTP API', async (t) => {
  let received
  const api = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      received = { url: request.url, method: request.method, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      response.writeHead(202, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 0, data: { task_id: 'task-mcp-e2e', status: 'queued' } }))
    })
  })
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  t.after(() => api.close())
  const address = api.address()
  assert.equal(typeof address, 'object')

  const secretDir = await mkdtemp(join(tmpdir(), 'foodlink-mcp-test-'))
  const secretPath = join(secretDir, 'api-key')
  await writeFile(secretPath, 'flk_beta_e2e\n', { mode: 0o600 })
  t.after(() => rm(secretDir, { recursive: true, force: true }))

  const serverPath = fileURLToPath(new URL('../src/server.mjs', import.meta.url))
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, FOODLINK_API_KEY: '', FOODLINK_API_KEY_FILE: secretPath, FOODLINK_API_BASE_URL: `http://127.0.0.1:${address.port}/open/v1` },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  const messages = []
  const waiters = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    const waiterIndex = waiters.findIndex((waiter) => waiter.id === message.id)
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(message)
    else messages.push(message)
  })
  function request(message) {
    const cachedIndex = messages.findIndex((item) => item.id === message.id)
    if (cachedIndex >= 0) return Promise.resolve(messages.splice(cachedIndex, 1)[0])
    child.stdin.write(`${JSON.stringify(message)}\n`)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP response timeout for id ${message.id}`)), 3000)
      waiters.push({ id: message.id, resolve: (value) => { clearTimeout(timer); resolve(value) } })
    })
  }

  const initialized = await request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
  assert.equal(initialized.result.serverInfo.name, 'foodlink-mcp')
  assert.match(initialized.result.instructions, /Idempotency-Key|idempotency_key/)
  assert.match(initialized.result.instructions, /不得自动付款/)
  const called = await request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'foodlink_analyze_text', arguments: { text: '一碗牛肉面', idempotency_key: 'mcp-e2e-1' } } })
  assert.equal(called.result.structuredContent.task_id, 'task-mcp-e2e')
  assert.equal(received.url, '/open/v1/food-analyses')
  assert.equal(received.headers.authorization, 'Bearer flk_beta_e2e')
  assert.equal(received.headers['idempotency-key'], 'mcp-e2e-1')
  assert.equal(received.body.text, '一碗牛肉面')
})
