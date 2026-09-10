#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { FoodLinkClient } from './client.mjs'

function resolveAPIKey() {
  const direct = String(process.env.FOODLINK_API_KEY || '').trim()
  if (direct) return direct
  const filePath = String(process.env.FOODLINK_API_KEY_FILE || '').trim()
  if (!filePath) return ''
  return readFileSync(filePath, 'utf8').trim()
}

const client = new FoodLinkClient({
  apiKey: resolveAPIKey(),
  baseURL: process.env.FOODLINK_API_BASE_URL,
  developerURL: process.env.FOODLINK_DEVELOPER_URL,
})

const tools = [
  { name: 'foodlink_get_account', description: '查询当前食探开放平台应用、scope 和 API 点数余额。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'foodlink_analyze_text', description: '根据一段餐食文字异步分析食物与营养。余额不足时不会自动支付，而会返回充值地址。', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, mode: { type: 'string', enum: ['standard', 'precision'], default: 'standard' }, meal_type: { type: 'string' }, additional_context: { type: 'string' }, date: { type: 'string' }, idempotency_key: { type: 'string', description: '重试同一请求时必须复用同一个值。' } }, additionalProperties: false } },
  { name: 'foodlink_upload_image', description: '上传本机 JPEG、PNG 或 WebP 图片，返回仅当前应用可用的 image_url。', inputSchema: { type: 'object', required: ['file_path'], properties: { file_path: { type: 'string' } }, additionalProperties: false } },
  { name: 'foodlink_analyze_images', description: '分析已通过 foodlink_upload_image 上传的图片。', inputSchema: { type: 'object', required: ['image_urls'], properties: { image_urls: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } }, mode: { type: 'string', enum: ['standard', 'precision'], default: 'standard' }, meal_type: { type: 'string' }, additional_context: { type: 'string' }, date: { type: 'string' }, idempotency_key: { type: 'string' } }, additionalProperties: false } },
  { name: 'foodlink_get_analysis', description: '使用 task_id 查询异步分析状态和结果。', inputSchema: { type: 'object', required: ['task_id'], properties: { task_id: { type: 'string' } }, additionalProperties: false } },
  { name: 'foodlink_list_analyses', description: '分页查询当前应用产生的分析历史。只返回稳定业务字段，不返回底层模型或内部执行参数。', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } }, additionalProperties: false } },
  { name: 'foodlink_list_food_records', description: '分页读取当前开发者账号本人的饮食记录。需要 records:read，不接受其他用户 ID。', inputSchema: { type: 'object', properties: { date: { type: 'string', description: '可选，YYYY-MM-DD。' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 } }, additionalProperties: false } },
  { name: 'foodlink_get_health_summary', description: '读取当前开发者账号本人的营养统计和健康分。需要 health:read；仅供趋势参考。', inputSchema: { type: 'object', properties: { range: { type: 'string', enum: ['7d', '30d', '90d', 'week', 'month'], default: 'week' } }, additionalProperties: false } },
  { name: 'foodlink_search_food', description: '搜索食探可信营养数据库。', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, additionalProperties: false } },
  { name: 'foodlink_get_recharge_url', description: '返回食探开发者充值页。此工具不会自动发起付款。', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
]

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`) }
function content(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data } }

async function callTool(name, args = {}) {
  switch (name) {
    case 'foodlink_get_account': return client.account()
    case 'foodlink_analyze_text': return client.analyzeText(args)
    case 'foodlink_upload_image': return client.uploadImage(args.file_path)
    case 'foodlink_analyze_images': return client.analyzeImages(args)
    case 'foodlink_get_analysis': return client.getAnalysis(args.task_id)
    case 'foodlink_list_analyses': return client.listAnalyses(args.limit, args.offset)
    case 'foodlink_list_food_records': return client.listFoodRecords(args.date, args.limit, args.offset)
    case 'foodlink_get_health_summary': return client.getHealthSummary(args.range)
    case 'foodlink_search_food': return client.searchFood(args.query, args.limit)
    case 'foodlink_get_recharge_url': return { recharge_url: client.developerURL, payment_requires_user_confirmation: true }
    default: throw new Error(`未知工具：${name}`)
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || !message.method) return
  if (message.method === 'initialize') return send({
    jsonrpc: '2.0',
    id: message.id,
    result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'foodlink-mcp', version: '0.2.0' },
      instructions: '食探 MCP 用于查询营养库、分析餐食和读取历史。图片必须先调用 foodlink_upload_image，再把返回的 image_url 交给 foodlink_analyze_images。分析是异步任务，提交后用 foodlink_get_analysis 轮询到 completed 或 failed；也可用 foodlink_list_analyses 查看当前应用的历史。本人饮食记录和健康分分别需要 records:read、health:read，只能读取创建应用的开发者本人，不能指定其他用户。重试同一请求必须复用 idempotency_key，避免重复扣点。HTTP 402 表示余额不足，只能提示用户打开 foodlink_get_recharge_url 返回的地址，不得自动付款。不要在回复、日志或代码中暴露 API Key，也不要声称或猜测底层模型。',
    },
  })
  if (message.method === 'notifications/initialized' || message.method.startsWith('notifications/')) return
  if (message.method === 'ping') return send({ jsonrpc: '2.0', id: message.id, result: {} })
  if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id: message.id, result: { tools } })
  if (message.method === 'tools/call') {
    try { return send({ jsonrpc: '2.0', id: message.id, result: content(await callTool(message.params?.name, message.params?.arguments || {})) }) }
    catch (error) {
      const data = { error: error instanceof Error ? error.message : String(error), ...(error?.status === 402 ? { balance_insufficient: true, recharge_url: error.rechargeURL, payment_requires_user_confirmation: true } : {}) }
      return send({ jsonrpc: '2.0', id: message.id, result: { ...content(data), isError: true } })
    }
  }
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } })
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => { if (!line.trim()) return; try { void handle(JSON.parse(line)) } catch (error) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error instanceof Error ? error.message : 'Parse error' } }) } })
