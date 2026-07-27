#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_QUEUE = 'docs/campus-directory-proofreading/nationwide-xiaohongshu-query-queue.json'
const DEFAULT_OUTPUT = 'docs/campus-directory-proofreading/nationwide-indexed-social-raw-evidence.json'
const QUERY_VERSION = 'indexed-public-combined-v1'
const COMPLETED_STATUSES = new Set([
  'captured_indexed_candidates',
  'captured_no_indexed_candidates',
])
const RETRYABLE_STATUSES = new Set(['search_failed', 'search_blocked'])

export function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    queuePath: path.resolve(cwd, DEFAULT_QUEUE),
    outputPath: path.resolve(cwd, DEFAULT_OUTPUT),
    province: '',
    excludeProvinces: [],
    schoolCodes: [],
    auditStatuses: [],
    concurrency: 4,
    limit: 0,
    maxResults: 12,
    requestDelayMs: 700,
    requestTimeoutMs: 20000,
    blockThreshold: 4,
    force: false,
    retryFailures: true,
    dryRun: false,
  }

  const takeValue = (index, flag) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数`)
    return value
  }
  const toInteger = (value, flag, allowZero = false) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
      throw new Error(`${flag} 必须是${allowZero ? '非负' : '正'}整数`)
    }
    return parsed
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--queue') options.queuePath = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--output') options.outputPath = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--province') options.province = takeValue(index++, arg).trim()
    else if (arg === '--exclude-provinces') options.excludeProvinces = splitCSV(takeValue(index++, arg))
    else if (arg === '--school-codes') options.schoolCodes = splitCSV(takeValue(index++, arg))
    else if (arg === '--audit-statuses') options.auditStatuses = splitCSV(takeValue(index++, arg))
    else if (arg === '--concurrency') options.concurrency = Math.min(8, toInteger(takeValue(index++, arg), arg))
    else if (arg === '--limit') options.limit = toInteger(takeValue(index++, arg), arg, true)
    else if (arg === '--max-results') options.maxResults = toInteger(takeValue(index++, arg), arg)
    else if (arg === '--request-delay-ms') options.requestDelayMs = toInteger(takeValue(index++, arg), arg, true)
    else if (arg === '--request-timeout-ms') options.requestTimeoutMs = toInteger(takeValue(index++, arg), arg)
    else if (arg === '--block-threshold') options.blockThreshold = toInteger(takeValue(index++, arg), arg)
    else if (arg === '--force') options.force = true
    else if (arg === '--no-retry-failures') options.retryFailures = false
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数: ${arg}`)
  }
  return options
}

function splitCSV(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function buildCombinedQuery(schoolName) {
  return `"${schoolName}" 食堂`
}

export function buildBingSearchUrl(query) {
  const url = new URL('https://cn.bing.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', '20')
  url.searchParams.set('setlang', 'zh-hans')
  return url.toString()
}

export function selectSchools(queue, state, options) {
  const existingBySchool = new Map((state?.schools ?? []).map((school) => [school.school_id, school]))
  const excluded = new Set(options.excludeProvinces)
  const schoolCodes = new Set(options.schoolCodes)
  const auditStatuses = new Set(options.auditStatuses)
  const selected = []

  for (const school of queue.schools ?? []) {
    if (options.province && school.province !== options.province) continue
    if (excluded.has(school.province)) continue
    if (schoolCodes.size > 0 && !schoolCodes.has(school.official_code)) continue
    if (auditStatuses.size > 0 && !auditStatuses.has(school.audit_status)) continue

    const previous = existingBySchool.get(school.school_id)
    if (!options.force && previous) {
      if (COMPLETED_STATUSES.has(previous.status)) continue
      if (RETRYABLE_STATUSES.has(previous.status) && !options.retryFailures) continue
    }
    selected.push({
      schoolId: school.school_id,
      officialCode: school.official_code,
      schoolName: school.name,
      province: school.province,
      auditStatus: school.audit_status,
      queryId: `${school.school_id}:${QUERY_VERSION}`,
      query: buildCombinedQuery(school.name),
    })
    if (options.limit > 0 && selected.length >= options.limit) break
  }
  return selected
}

function decodeHTML(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
}

function stripTags(value) {
  return decodeHTML(String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeBingRedirect(value) {
  try {
    const parsed = new URL(decodeHTML(value))
    if (!/(^|\.)bing\.com$/i.test(parsed.hostname) || parsed.pathname !== '/ck/a') return parsed.toString()
    const encoded = parsed.searchParams.get('u') ?? ''
    if (!encoded.startsWith('a1')) return ''
    return Buffer.from(encoded.slice(2).replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function normalizePublicURL(value) {
  try {
    const parsed = new URL(decodeHTML(value))
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    if (/(^|\.)bing\.com$/i.test(parsed.hostname) || /(^|\.)microsoft\.com$/i.test(parsed.hostname)) return ''
    parsed.protocol = 'https:'
    parsed.hash = ''
    if (/(^|\.)xiaohongshu\.com$/i.test(parsed.hostname)) parsed.search = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|spm$|from$|source$)/i.test(key)) parsed.searchParams.delete(key)
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

function extractPrimaryResultURL(fragment) {
  const h2 = String(fragment).match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? ''
  const raw = h2.match(/href=["']([^"']+)["']/i)?.[1] ?? ''
  return normalizePublicURL(decodeBingRedirect(raw))
}

export function classifyPlatform(value) {
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (/(^|\.)xiaohongshu\.com$/.test(host)) return 'xiaohongshu'
    if (host === 'mp.weixin.qq.com') return 'wechat_official_account'
    if (/(^|\.)zhihu\.com$/.test(host)) return 'zhihu'
    if (/(^|\.)bilibili\.com$/.test(host) || host === 'b23.tv') return 'bilibili'
    if (/(^|\.)douyin\.com$/.test(host)) return 'douyin'
    return 'public_web'
  } catch {
    return 'public_web'
  }
}

export function extractIndexedPublicResults(html, schoolName, maxResults = 12) {
  const results = []
  const seen = new Set()
  const blocks = [...String(html).matchAll(/<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)]
  const diningPattern = /食堂|餐厅|饭堂|餐饮|美食|窗口|档口|楼层|后勤|迎新/

  for (const match of blocks) {
    const fragment = match[1]
    const title = stripTags(fragment.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? '')
    const snippet = stripTags(fragment.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '')
    const url = extractPrimaryResultURL(fragment)
    const evidenceText = `${title} ${snippet}`
    if (!url || seen.has(url) || !schoolName || !title.includes(schoolName) || !diningPattern.test(evidenceText)) continue
    seen.add(url)
    results.push({
      rank: results.length + 1,
      url,
      title,
      snippet,
      platform: classifyPlatform(url),
      exact_school_name_in_text: true,
    })
    if (results.length >= maxResults) break
  }
  return results
}

export function classifySearchResponse(statusCode, bodyText) {
  if (statusCode === 403 || statusCode === 429) return 'blocked'
  if (statusCode < 200 || statusCode >= 300) return 'failed'
  if (/验证码|访问频繁|异常流量|automated queries|unusual traffic|captcha/i.test(bodyText)) return 'blocked'
  return 'ok'
}

async function fetchBing(task, options, waitForRequest) {
  await waitForRequest()
  const searchURL = buildBingSearchUrl(task.query)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs)
  try {
    const response = await fetch(searchURL, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 FoodLinkCampusDirectoryResearch/1.0',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    })
    const body = (await response.text()).slice(0, 6 * 1024 * 1024)
    const classification = classifySearchResponse(response.status, body)
    if (classification === 'blocked') {
      return buildSchoolResult(task, 'search_blocked', [], searchURL, `Bing 返回访问限制，HTTP ${response.status}`)
    }
    if (classification === 'failed') {
      return buildSchoolResult(task, 'search_failed', [], searchURL, `Bing 搜索失败，HTTP ${response.status}`)
    }
    const candidates = extractIndexedPublicResults(body, task.schoolName, options.maxResults)
    return buildSchoolResult(
      task,
      candidates.length > 0 ? 'captured_indexed_candidates' : 'captured_no_indexed_candidates',
      candidates,
      searchURL,
    )
  } catch (error) {
    const message = error?.name === 'AbortError' ? `Bing 搜索超过 ${options.requestTimeoutMs}ms` : String(error?.message ?? error)
    return buildSchoolResult(task, 'search_failed', [], searchURL, message)
  } finally {
    clearTimeout(timeout)
  }
}

function buildSchoolResult(task, status, candidates, searchURL, error = '') {
  return {
    school_id: task.schoolId,
    official_code: task.officialCode,
    name: task.schoolName,
    province: task.province,
    audit_status: task.auditStatus,
    query_id: task.queryId,
    query_version: QUERY_VERSION,
    search_query: task.query,
    search_url: searchURL,
    channel: 'indexed_public_web',
    platform: 'mixed_public_web',
    discovered_via: 'bing',
    status,
    checked_at: new Date().toISOString(),
    candidate_count: candidates.length,
    sources: candidates.map((candidate) => ({
      ...candidate,
      host: new URL(candidate.url).hostname,
      channel: 'indexed_public_web',
      discovered_via: 'bing',
      status: 'indexed_candidate',
    })),
    ...(error ? { error } : {}),
    note: '搜索引擎索引只用于发现公开候选链接；未直接访问小红书站内搜索或任何候选正文，候选不得直接入库',
  }
}

export function upsertSchoolResult(state, result) {
  const index = state.schools.findIndex((school) => school.school_id === result.school_id)
  if (index >= 0) state.schools[index] = result
  else state.schools.push(result)
  state.generated_at = new Date().toISOString()
  state.summary = summarizeState(state)
}

export function summarizeState(state) {
  const status = {}
  let candidates = 0
  for (const school of state.schools ?? []) {
    status[school.status ?? 'unknown'] = (status[school.status ?? 'unknown'] ?? 0) + 1
    candidates += school.candidate_count ?? school.sources?.length ?? 0
  }
  return { schools: state.schools?.length ?? 0, candidates, status }
}

function createState(queuePath, existing) {
  return {
    generated_at: existing?.generated_at ?? new Date().toISOString(),
    scope: existing?.scope ?? '全国高校公开搜索引擎索引发现；每校一次综合查询，不访问小红书站内搜索和候选正文，仅生成待人工核验候选',
    source_queue: existing?.source_queue ?? path.relative(process.cwd(), queuePath).replaceAll('\\', '/'),
    query_version: QUERY_VERSION,
    summary: existing?.summary ?? { schools: 0, candidates: 0, status: {} },
    schools: existing?.schools ?? [],
  }
}

async function loadJSON(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw new Error(`读取 JSON 失败 ${filePath}: ${error.message}`)
  }
}

async function writeJSONAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, filePath)
}

function createRequestLimiter(delayMs) {
  let nextRequestAt = 0
  let tail = Promise.resolve()
  return async () => {
    let release
    const previous = tail
    tail = new Promise((resolve) => { release = resolve })
    await previous
    const waitMs = Math.max(0, nextRequestAt - Date.now())
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    nextRequestAt = Date.now() + delayMs
    release()
  }
}

async function runWorkers(tasks, state, options) {
  let cursor = 0
  let completed = 0
  let blockedStreak = 0
  let stopping = false
  let saveChain = Promise.resolve()
  const waitForRequest = createRequestLimiter(options.requestDelayMs)

  const stop = () => { stopping = true }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const worker = async (workerIndex) => {
    while (!stopping) {
      const taskIndex = cursor++
      if (taskIndex >= tasks.length) break
      const result = await fetchBing(tasks[taskIndex], options, waitForRequest)
      upsertSchoolResult(state, result)
      saveChain = saveChain.then(() => writeJSONAtomic(options.outputPath, state))
      await saveChain
      completed += 1
      blockedStreak = result.status === 'search_blocked' ? blockedStreak + 1 : 0
      console.log(`[${completed}/${tasks.length}] worker=${workerIndex + 1} school=${result.name} status=${result.status} candidates=${result.candidate_count}`)
      if (blockedStreak >= options.blockThreshold) {
        stopping = true
        console.log(`批次熔断：连续 ${blockedStreak} 次搜索引擎访问限制；已保存断点，稍后可直接续跑`)
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(1, tasks.length)) }, (_, index) => worker(index)))
    await saveChain
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

function printHelp() {
  console.log(`高校食堂公开索引发现批处理

用法：
  npm run campus:indexed-social:crawl -- --dry-run
  npm run campus:indexed-social:crawl -- --limit 20 --concurrency 4

参数：
  --queue <json>                 全国高校查询队列
  --output <json>                独立断点证据输出
  --province <省市>              精确筛选地区
  --exclude-provinces <省,省>    排除地区
  --school-codes <代码,代码>     按教育部官方代码筛选
  --audit-statuses <状态,状态>   按逐校审计状态筛选
  --concurrency <1-8>            并发学校数，默认 4
  --limit <n>                    最多处理学校数，0 表示不限
  --max-results <n>              每校最多保留候选链接，默认 12
  --request-delay-ms <n>         全局请求启动间隔，默认 700ms
  --request-timeout-ms <n>       单次搜索超时，默认 20000ms
  --block-threshold <n>          连续访问限制熔断阈值，默认 4
  --force                        忽略断点重新抓取
  --no-retry-failures            不重试失败项
  --dry-run                      只统计断点，不联网
`)
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) return printHelp()
  const queue = await loadJSON(options.queuePath, null)
  if (!queue) throw new Error(`查询队列不存在: ${options.queuePath}`)
  const existing = await loadJSON(options.outputPath, null)
  const state = createState(options.queuePath, existing)
  const tasks = selectSchools(queue, state, options)
  console.log(`队列学校=${queue.schools?.length ?? 0} 待处理学校=${tasks.length} 已有断点=${state.schools.length} 并发=${options.concurrency}`)
  if (options.dryRun || tasks.length === 0) return
  await runWorkers(tasks, state, options)
  console.log(`索引发现批次结束，输出=${options.outputPath}`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`索引发现失败: ${error.message}`)
    process.exitCode = 1
  })
}
