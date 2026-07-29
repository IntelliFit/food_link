#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_QUEUE = 'docs/campus-directory-proofreading/beijing-mvp-xiaohongshu-query-queue.json'
const DEFAULT_OUTPUT = 'docs/campus-directory-proofreading/beijing-mvp-xiaohongshu-raw-evidence.json'
const DEFAULT_PROFILE = '.local-state/xiaohongshu-chrome-profile'
const COMPLETED_STATUSES = new Set([
  'captured',
  'captured_search_results',
  'captured_explicit_no_results',
  'captured_no_exact_match',
])
const RETRYABLE_STATUSES = new Set(['capture_failed', 'unreadable', 'login_required', 'captured_no_results'])
const VALID_QUERY_KINDS = new Set(['overview', 'floors', 'windows'])

export function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    queuePath: path.resolve(cwd, DEFAULT_QUEUE),
    outputPath: path.resolve(cwd, DEFAULT_OUTPUT),
    profileDir: path.resolve(cwd, DEFAULT_PROFILE),
    chromePath: findChromeExecutable(),
    province: '',
    excludeProvinces: [],
    schoolCodes: [],
    auditStatuses: [],
    queryKinds: ['overview', 'floors', 'windows'],
    concurrency: 2,
    limit: 0,
    maxResults: 12,
    maxNotesPerQuery: 0,
    minDelayMs: 1500,
    maxDelayMs: 3500,
    navigationTimeoutMs: 30000,
    settleMs: 2500,
    loginTimeoutMs: 10 * 60 * 1000,
    manualRecoveryTimeoutMs: 0,
    retries: 1,
    headless: false,
    loginOnly: false,
    dryRun: false,
    force: false,
    retryFailures: true,
  }

  const takeValue = (index, flag) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数`)
    return value
  }
  const toPositiveInt = (value, flag, allowZero = false) => {
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
    else if (arg === '--profile-dir') options.profileDir = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--chrome') options.chromePath = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--province') options.province = takeValue(index++, arg).trim()
    else if (arg === '--exclude-provinces') options.excludeProvinces = takeValue(index++, arg).split(',').map((item) => item.trim()).filter(Boolean)
    else if (arg === '--school-codes') options.schoolCodes = takeValue(index++, arg).split(',').map((item) => item.trim()).filter(Boolean)
    else if (arg === '--audit-statuses') options.auditStatuses = takeValue(index++, arg).split(',').map((item) => item.trim()).filter(Boolean)
    else if (arg === '--query-kinds') {
      const raw = takeValue(index++, arg)
      const kinds = raw === 'all' ? [...VALID_QUERY_KINDS] : raw.split(',').map((item) => item.trim()).filter(Boolean)
      if (kinds.length === 0 || kinds.some((kind) => !VALID_QUERY_KINDS.has(kind))) {
        throw new Error('--query-kinds 仅支持 overview,floors,windows 或 all')
      }
      options.queryKinds = [...new Set(kinds)]
    } else if (arg === '--concurrency') options.concurrency = Math.min(4, toPositiveInt(takeValue(index++, arg), arg))
    else if (arg === '--limit') options.limit = toPositiveInt(takeValue(index++, arg), arg, true)
    else if (arg === '--max-results') options.maxResults = toPositiveInt(takeValue(index++, arg), arg)
    else if (arg === '--max-notes-per-query') options.maxNotesPerQuery = toPositiveInt(takeValue(index++, arg), arg, true)
    else if (arg === '--min-delay-ms') options.minDelayMs = toPositiveInt(takeValue(index++, arg), arg, true)
    else if (arg === '--max-delay-ms') options.maxDelayMs = toPositiveInt(takeValue(index++, arg), arg, true)
    else if (arg === '--navigation-timeout-ms') options.navigationTimeoutMs = toPositiveInt(takeValue(index++, arg), arg)
    else if (arg === '--settle-ms') options.settleMs = toPositiveInt(takeValue(index++, arg), arg, true)
    else if (arg === '--login-timeout-ms') options.loginTimeoutMs = toPositiveInt(takeValue(index++, arg), arg)
    else if (arg === '--manual-recovery-timeout-ms') options.manualRecoveryTimeoutMs = toPositiveInt(takeValue(index++, arg), arg, true)
    else if (arg === '--retries') options.retries = toPositiveInt(takeValue(index++, arg), arg, true)
    else if (arg === '--headless') options.headless = true
    else if (arg === '--login-only') options.loginOnly = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--no-retry-failures') options.retryFailures = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数: ${arg}`)
  }

  if (options.minDelayMs > options.maxDelayMs) {
    throw new Error('--min-delay-ms 不能大于 --max-delay-ms')
  }
  if (!options.chromePath && !options.dryRun) {
    throw new Error('未找到 Google Chrome；可通过 --chrome 指定 chrome.exe')
  }
  return options
}

export function queryKind(queryId) {
  if (queryId.endsWith('xiaohongshu-overview')) return 'overview'
  if (queryId.endsWith('xiaohongshu-floors')) return 'floors'
  if (queryId.endsWith('xiaohongshu-windows')) return 'windows'
  return 'unknown'
}

export function flattenQueue(queue) {
  return (queue.schools ?? []).flatMap((school) =>
    (school.queries ?? []).map((query) => ({
      schoolId: school.school_id,
      officialCode: school.official_code ?? '',
      schoolName: school.name ?? '',
      province: school.province ?? '',
      auditStatus: school.audit_status ?? '',
      ...query,
      kind: queryKind(query.query_id ?? ''),
    })),
  )
}

export function captureIndex(state) {
  const result = new Map()
  for (const school of state.schools ?? []) {
    for (const source of school.sources ?? []) {
      if (source.query_id) result.set(source.query_id, source)
    }
  }
  return result
}

export function selectTasks(queue, state, options) {
  const kinds = new Set(options.queryKinds)
  const schoolCodes = new Set(options.schoolCodes ?? [])
  const auditStatuses = new Set(options.auditStatuses ?? [])
  const excludeProvinces = new Set(options.excludeProvinces ?? [])
  const existing = captureIndex(state)
  let tasks = flattenQueue(queue).filter((task) =>
    kinds.has(task.kind)
    && (!options.province || task.province === options.province)
    && !excludeProvinces.has(task.province)
    && (schoolCodes.size === 0 || schoolCodes.has(task.officialCode))
    && (auditStatuses.size === 0 || auditStatuses.has(task.auditStatus)),
  )
  if (!options.force) {
    tasks = tasks.filter((task) => {
      const previous = existing.get(task.query_id)
      if (!previous) return true
      if (COMPLETED_STATUSES.has(previous.status)) return false
      if (RETRYABLE_STATUSES.has(previous.status)) return options.retryFailures
      return false
    })
  }
  if (options.limit > 0) tasks = tasks.slice(0, options.limit)
  return tasks
}

export function upsertCapture(state, task, source) {
  state.generated_at = new Date().toISOString()
  let school = (state.schools ?? []).find((item) => item.school_id === task.schoolId)
  if (!school) {
    school = {
      school_id: task.schoolId,
      official_code: task.officialCode,
      name: task.schoolName,
      province: task.province,
      sources: [],
    }
    state.schools ??= []
    state.schools.push(school)
  }
  school.sources ??= []
  const index = school.sources.findIndex((item) => item.query_id === task.query_id)
  if (index >= 0) school.sources[index] = source
  else school.sources.push(source)
  state.summary = summarizeState(state)
  return state
}

export function summarizeState(state) {
  const sources = (state.schools ?? []).flatMap((school) => school.sources ?? [])
  const status = {}
  for (const source of sources) status[source.status] = (status[source.status] ?? 0) + 1
  return {
    schools: (state.schools ?? []).filter((school) => (school.sources ?? []).length > 0).length,
    queries: sources.length,
    status,
  }
}

export function normalizeSearchResults(rows, maxResults = 12) {
  const seen = new Set()
  const results = []
  for (const row of rows ?? []) {
    const url = String(row.url ?? '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    const visibleText = compactText(row.visible_text ?? '', 1200)
    results.push({
      rank: results.length + 1,
      url,
      title: compactText(row.title ?? '', 300),
      author: compactText(row.author ?? '', 120),
      author_url: String(row.author_url ?? '').trim(),
      visible_text: visibleText,
    })
    if (results.length >= maxResults) break
  }
  return results
}

export function buildSearchUrl(query) {
  const url = new URL('https://www.xiaohongshu.com/search_result/')
  url.searchParams.set('keyword', query)
  url.searchParams.set('type', '51')
  return url.toString()
}

export function shouldStopBatch(status) {
  return status === 'login_required' || status === 'unreadable'
}

function findChromeExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES ?? '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium']
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? ''
}

function compactText(value, limit) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw new Error(`读取 JSON 失败 ${filePath}: ${error.message}`)
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, filePath)
}

function createState(queuePath, existing) {
  return {
    generated_at: existing?.generated_at ?? new Date().toISOString(),
    scope: existing?.scope ?? '小红书登录态批量搜索原始证据；仅供发现和人工核验，不直接发布到目录',
    source_queue: existing?.source_queue ?? path.relative(process.cwd(), queuePath).replaceAll('\\', '/'),
    summary: existing?.summary ?? { schools: 0, queries: 0, status: {} },
    schools: existing?.schools ?? [],
  }
}

async function isLoggedIn(page) {
  return page.evaluate(() => {
    const mine = document.querySelector('a[title="我"][href*="/user/profile/"]')
    const loginButton = [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '登录')
    return Boolean(mine) && !loginButton
  }).catch(() => false)
}

async function hasExplicitLoginPrompt(page) {
  return page.evaluate(() => {
    const loginButton = [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '登录')
    const visibleText = document.body?.innerText ?? ''
    return loginButton || /登录后查看|请先登录/.test(visibleText)
  }).catch(() => false)
}

async function waitForLogin(page, options) {
  await page.goto('https://www.xiaohongshu.com/explore', {
    waitUntil: 'domcontentloaded',
    timeout: options.navigationTimeoutMs,
  }).catch(() => undefined)
  if (await isLoggedIn(page)) return
  if (options.headless) throw new Error('专用浏览器资料尚未登录，小红书登录不能在 headless 模式完成')
  console.log('请在打开的 Chrome 窗口中登录小红书；登录成功后脚本会自动继续。')
  const deadline = Date.now() + options.loginTimeoutMs
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000)
    if (await isLoggedIn(page)) return
  }
  throw new Error('等待小红书登录超时；可先运行 npm run xhs:crawl -- --login-only')
}

async function scrapeVisibleResults(page, maxResults) {
  const rows = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a[href*="/search_result/"]')]
    const grouped = new Map()
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href')
      if (!href) continue
      const url = new URL(href, location.origin)
      if (!/^\/search_result\/[A-Za-z0-9]+/.test(url.pathname)) continue
      const key = url.pathname
      const existing = grouped.get(key) ?? { url: url.href, title: '', author: '', author_url: '', visible_text: '' }
      const anchorText = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      if (anchorText.length > existing.title.length) existing.title = anchorText
      let container = anchor.closest('section') ?? anchor.parentElement
      for (let depth = 0; depth < 4 && container && !container.querySelector('a[href*="/user/profile/"]'); depth += 1) {
        container = container.parentElement
      }
      if (container) {
        const author = container.querySelector('a[href*="/user/profile/"]')
        existing.author = author?.textContent?.replace(/\s+/g, ' ').trim() ?? existing.author
        existing.author_url = author?.href ?? existing.author_url
        const cardText = container.innerText?.replace(/\s+/g, ' ').trim() ?? ''
        if (cardText.length > existing.visible_text.length) existing.visible_text = cardText
      }
      grouped.set(key, existing)
    }
    return [...grouped.values()]
  })
  return normalizeSearchResults(rows, maxResults)
}

async function hydrateNoteBodies(page, results, limit, options) {
  for (const result of results.slice(0, limit)) {
    try {
      await page.goto(result.url, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeoutMs })
      await page.waitForTimeout(options.settleMs)
      const body = await page.evaluate(() => {
        const title = document.querySelector('#detail-title, .title')?.textContent ?? ''
        const description = document.querySelector('#detail-desc, .desc, .note-content')?.textContent ?? ''
        const pageText = document.body?.innerText ?? ''
        return { title, description, pageText }
      })
      result.note_title = compactText(body.title || result.title, 500)
      result.note_excerpt = compactText(body.description || body.pageText, 8000)
    } catch (error) {
      result.note_error = compactText(error.message, 500)
    }
    await randomDelay(page, options)
  }
}

function detectBlocked(text) {
  return /访问频繁|操作频繁|安全验证|请完成验证|验证码|当前内容无法展示/.test(text)
}

async function captureTask(page, task, options) {
  const searchUrl = buildSearchUrl(task.query)
  let lastError
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeoutMs })
      await page.waitForTimeout(options.settleMs)
      await page.locator('a[href*="/search_result/"]').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => undefined)
      const pageText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '')
      if (detectBlocked(pageText)) {
        return buildSource(task, searchUrl, 'unreadable', [], '页面出现安全验证或访问频繁提示')
      }
      const results = await scrapeVisibleResults(page, options.maxResults)
      if (results.length === 0 && !(await isLoggedIn(page)) && await hasExplicitLoginPrompt(page)) {
        return buildSource(task, searchUrl, 'login_required', [], '页面明确要求重新登录，批次将停止并保留断点')
      }
      if (results.length === 0 && !/暂无搜索结果|没有找到|未找到相关/.test(pageText)) {
        return buildSource(task, searchUrl, 'unreadable', [], '等待后页面仍未出现搜索结果，也没有明确的无结果提示；批次将停止以避免误判')
      }
      if (options.maxNotesPerQuery > 0 && results.length > 0) {
        await hydrateNoteBodies(page, results, options.maxNotesPerQuery, options)
      }
      const status = results.length > 0 ? 'captured_search_results' : 'captured_explicit_no_results'
      return buildSource(task, searchUrl, status, results)
    } catch (error) {
      lastError = error
      if (attempt < options.retries) await randomDelay(page, options)
    }
  }
  return buildSource(task, searchUrl, 'capture_failed', [], compactText(lastError?.message ?? '未知错误', 1000))
}

function buildSource(task, searchUrl, status, results, error = '') {
  const excerpt = results.length > 0
    ? results.slice(0, 5).map((item) => `${item.title || '(无标题)'} / ${item.author || '(无作者)'}`).join('；')
    : status === 'captured_explicit_no_results'
      ? '搜索页已读取，当前可见区域没有笔记结果'
      : ''
  return {
    url: searchUrl,
    title: `${task.schoolName} ${task.purpose ?? task.kind} - 小红书批量搜索`,
    host: 'www.xiaohongshu.com',
    channel: 'xiaohongshu',
    query_id: task.query_id,
    search_query: task.query,
    status,
    checked_at: new Date().toISOString(),
    official_code: task.officialCode,
    school_name: task.schoolName,
    ...(excerpt ? { evidence_excerpt: compactText(excerpt, 3000) } : {}),
    ...(error ? { error } : {}),
    search_results: results,
  }
}

async function randomDelay(page, options) {
  const spread = options.maxDelayMs - options.minDelayMs
  const duration = options.minDelayMs + (spread > 0 ? Math.floor(Math.random() * (spread + 1)) : 0)
  if (duration > 0) await page.waitForTimeout(duration)
}

async function waitForManualRecovery(page, task, options) {
  if (options.manualRecoveryTimeoutMs <= 0) return false

  console.log(`等待人工恢复: school=${task.schoolName}，请在打开的 Chrome 中完成登录或安全验证`)
  const deadline = Date.now() + options.manualRecoveryTimeoutMs
  const searchUrl = buildSearchUrl(task.query)
  let lastNavigationAt = 0

  while (Date.now() < deadline) {
    await page.waitForTimeout(2000)
    const pageText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
    const hasResults = await page.locator('a[href*="/search_result/"]').first().isVisible().catch(() => false)
    const explicitNoResults = /暂无搜索结果|没有找到|未找到相关/.test(pageText)
    if (!detectBlocked(pageText) && !await hasExplicitLoginPrompt(page) && (hasResults || explicitNoResults)) {
      return true
    }

    if (!detectBlocked(pageText) && await isLoggedIn(page) && Date.now() - lastNavigationAt >= 10000) {
      lastNavigationAt = Date.now()
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: options.navigationTimeoutMs,
      }).catch(() => undefined)
      await page.waitForTimeout(options.settleMs)
    }
  }

  console.log(`人工恢复超时: school=${task.schoolName}`)
  return false
}

async function runWorkers(context, loginPage, tasks, state, options) {
  let cursor = 0
  let completed = 0
  let stopping = false
  let saveChain = Promise.resolve()
  const pages = [loginPage]
  for (let index = 1; index < Math.min(options.concurrency, tasks.length); index += 1) {
    pages.push(await context.newPage())
  }
  const stop = () => { stopping = true }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  const worker = async (page, workerIndex) => {
    while (!stopping) {
      const taskIndex = cursor++
      if (taskIndex >= tasks.length) break
      const task = tasks[taskIndex]
      let source
      while (true) {
        source = await captureTask(page, task, options)
        if (!shouldStopBatch(source.status)) break
        if (!await waitForManualRecovery(page, task, options)) break
        console.log(`人工恢复已检测，自动重试: school=${task.schoolName} kind=${task.kind}`)
      }
      upsertCapture(state, task, source)
      saveChain = saveChain.then(() => writeJsonAtomic(options.outputPath, state))
      await saveChain
      completed += 1
      console.log(`[${completed}/${tasks.length}] worker=${workerIndex + 1} school=${task.schoolName} kind=${task.kind} status=${source.status} results=${source.search_results.length}`)
      if (shouldStopBatch(source.status)) {
        stopping = true
        console.log(`批次熔断: status=${source.status}，请恢复登录或完成安全验证后重新运行`)
        break
      }
      await randomDelay(page, options)
    }
  }

  try {
    await Promise.all(pages.map((page, index) => worker(page, index)))
    await saveChain
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

function printHelp() {
  console.log(`小红书高校食堂批量采集器

用法：
  npm run xhs:crawl -- --login-only
  npm run xhs:crawl -- --query-kinds overview --concurrency 2
  npm run xhs:crawl -- --query-kinds floors,windows --concurrency 2

常用参数：
  --queue <json>                 查询队列
  --output <json>                断点证据输出
  --profile-dir <dir>            专用 Chrome 资料目录（默认在 .local-state）
  --province <省市>              精确筛选省份，例如 北京市
  --exclude-provinces <省,省>    排除已完成省份，例如 北京市
  --school-codes <代码,代码>     按教育部官方代码筛选
  --audit-statuses <状态,状态>   按逐校审计状态筛选
  --query-kinds <kinds|all>      overview,floors,windows
  --concurrency <1-4>            并发页面数，默认 2
  --limit <n>                    本次最多处理多少条，0 表示不限
  --max-results <n>              每个搜索保留的可见结果数，默认 12
  --max-notes-per-query <n>      额外读取前 n 篇笔记正文，默认 0
  --manual-recovery-timeout-ms <n> 登录/验证熔断后保留 Chrome 并等待人工恢复
  --dry-run                      只检查队列和断点，不打开浏览器
  --force                        忽略已完成状态重新抓取
  --no-retry-failures            本次不重试失败项
`)
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) return printHelp()
  const queue = await loadJson(options.queuePath, null)
  if (!queue) throw new Error(`查询队列不存在: ${options.queuePath}`)
  const existing = await loadJson(options.outputPath, null)
  const state = createState(options.queuePath, existing)
  const tasks = selectTasks(queue, state, options)
  console.log(`队列学校=${queue.schools?.length ?? 0} 待处理任务=${tasks.length} 类型=${options.queryKinds.join(',')} 并发=${options.concurrency}`)
  if (options.dryRun) return

  const { chromium } = await import('playwright-core')
  await mkdir(options.profileDir, { recursive: true })
  const context = await chromium.launchPersistentContext(options.profileDir, {
    executablePath: options.chromePath,
    headless: options.headless,
    viewport: null,
    acceptDownloads: false,
    args: ['--start-maximized'],
  })
  try {
    const loginPage = context.pages()[0] ?? await context.newPage()
    loginPage.setDefaultTimeout(15000)
    await waitForLogin(loginPage, options)
    console.log('小红书登录态已确认。')
    if (options.loginOnly) return
    if (tasks.length === 0) return
    await runWorkers(context, loginPage, tasks, state, options)
    console.log(`采集完成，输出=${options.outputPath}`)
  } finally {
    await context.close()
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`采集失败: ${error.message}`)
    process.exitCode = 1
  })
}
