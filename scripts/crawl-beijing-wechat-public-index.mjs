#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractHierarchyEvidence } from './crawl-indexed-content-evidence.mjs'

const DEFAULT_INPUT =
  'docs/campus-directory-proofreading/beijing-gap-indexed-social-raw-evidence.json'
const DEFAULT_OUTPUT =
  'docs/campus-directory-proofreading/beijing-wechat-public-index-evidence.json'
const USER_OVERRIDE_CODES = new Set(['4111010001', '4111010003'])
const DINING_RE = /食堂|餐厅|餐饮|饮食|美食|窗口|档口|楼层|一楼|二楼|三楼|四楼|地下/
const NEGATIVE_RE = /招聘|招标|中标|采购|供应商|转让|加盟/
const ACCOUNT_RE = /后勤|餐饮|饮食|团委|研究生|招生|迎新|校园|大学|学院|学校/
const DINING_PLATFORM_ACCOUNT_RE = /餐饮|饮食|后勤|总务|膳食|伙食|食堂/

function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    inputPath: path.resolve(cwd, DEFAULT_INPUT),
    outputPath: path.resolve(cwd, DEFAULT_OUTPUT),
    schoolCodes: [],
    concurrency: 1,
    limit: 0,
    maxResults: 8,
    requestDelayMs: 900,
    requestTimeoutMs: 20000,
    queryMode: 'standard',
    retryEmpty: false,
    force: false,
    dryRun: false,
  }
  const takeValue = (index, flag) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数`)
    return value
  }
  const takeInteger = (index, flag, allowZero = false) => {
    const parsed = Number.parseInt(takeValue(index, flag), 10)
    if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
      throw new Error(`${flag} 必须是${allowZero ? '非负' : '正'}整数`)
    }
    return parsed
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input') options.inputPath = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--output') options.outputPath = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--school-codes') {
      options.schoolCodes = takeValue(index++, arg).split(',').map((item) => item.trim()).filter(Boolean)
    } else if (arg === '--concurrency') options.concurrency = Math.min(2, takeInteger(index++, arg))
    else if (arg === '--limit') options.limit = takeInteger(index++, arg, true)
    else if (arg === '--max-results') options.maxResults = takeInteger(index++, arg)
    else if (arg === '--request-delay-ms') options.requestDelayMs = takeInteger(index++, arg, true)
    else if (arg === '--request-timeout-ms') options.requestTimeoutMs = takeInteger(index++, arg)
    else if (arg === '--query-mode') options.queryMode = takeValue(index++, arg)
    else if (arg === '--retry-empty') options.retryEmpty = true
    else if (arg === '--force') options.force = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数: ${arg}`)
  }
  return options
}

function decodeEntities(value) {
  return String(value)
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&middot;', '·')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
}

function stripTags(value) {
  return decodeEntities(
    String(value)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchUrl(query) {
  const url = new URL('https://weixin.sogou.com/weixin')
  url.searchParams.set('type', '2')
  url.searchParams.set('query', query)
  return url.toString()
}

function normalizeUrl(value, base = 'https://weixin.sogou.com') {
  try {
    const url = new URL(decodeEntities(value), base)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function extractOriginalCoverUrl(imgTag) {
  const raw = String(imgTag).match(/\bsrc=["']([^"']+)["']/i)?.[1] || ''
  const thumbnail = normalizeUrl(raw)
  if (!thumbnail) return ''
  try {
    const parsed = new URL(thumbnail)
    const original = parsed.searchParams.get('url')
    return original ? normalizeUrl(original) : thumbnail
  } catch {
    return thumbnail
  }
}

function classifyAccount(account, schoolName, title, snippet) {
  const evidence = `${account} ${title} ${snippet}`
  if (!evidence.includes(schoolName)) return 'school_name_not_exact'
  if (!account) return 'account_name_missing'
  if (account.includes(schoolName)) return 'exact_school_account_name'
  if (DINING_PLATFORM_ACCOUNT_RE.test(account)) {
    return 'school_dining_platform_account_candidate'
  }
  if (ACCOUNT_RE.test(account)) return 'school_related_account_likely'
  return 'unverified_public_account'
}

function extractResults(html, school, maxResults) {
  const results = []
  const seen = new Set()
  for (const match of String(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const fragment = match[1]
    if (!/class=["'][^"']*(?:txt-box|img-box)/i.test(fragment)) continue
    const titleBlock = fragment.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || ''
    const anchor = titleBlock.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    const redirectUrl = normalizeUrl(anchor?.[1] || '')
    const title = stripTags(anchor?.[2] || titleBlock)
    const snippet = stripTags(
      fragment.match(/<p\b[^>]*class=["'][^"']*txt-info[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ||
        '',
    )
    const account = stripTags(
      fragment.match(/<span\b[^>]*class=["'][^"']*all-time-y2[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
        '',
    )
    const timestamp = Number.parseInt(
      fragment.match(/timeConvert\(['"]?(\d+)['"]?\)/i)?.[1] || '0',
      10,
    )
    const imageTag = fragment.match(/<img\b[^>]*>/i)?.[0] || ''
    const coverImageUrl = extractOriginalCoverUrl(imageTag)
    const evidence = `${account} ${title} ${snippet}`
    if (!redirectUrl || seen.has(redirectUrl)) continue
    if (!evidence.includes(school.name) || !DINING_RE.test(evidence)) continue
    seen.add(redirectUrl)
    const hierarchy = extractHierarchyEvidence(evidence, school.name)
    results.push({
      rank: results.length + 1,
      title,
      snippet,
      account_name: account,
      account_classification: classifyAccount(account, school.name, title, snippet),
      dining_platform_account_candidate: DINING_PLATFORM_ACCOUNT_RE.test(account),
      published_at: timestamp ? new Date(timestamp * 1000).toISOString() : '',
      sogou_redirect_url: redirectUrl,
      cover_image_url: coverImageUrl,
      negative_context: NEGATIVE_RE.test(evidence),
      hierarchy_candidates: hierarchy.hierarchy_candidates,
      unresolved_passages: hierarchy.unresolved_passages,
      discovered_via: 'sogou_wechat_public_index',
      content_access_policy: 'search_index_only_no_mp_weixin_article_fetch',
      review_status: 'pending_agent_review',
    })
    if (results.length >= maxResults) break
  }
  return results
}

function classifyResponse(status, body) {
  if (status === 403 || status === 429) return 'search_blocked'
  if (status < 200 || status >= 300) return 'search_failed'
  if (/请输入验证码|访问过于频繁|antispider|异常访问|您的访问出错了/i.test(body)) {
    return 'search_blocked'
  }
  return 'ok'
}

function requestGate(delayMs) {
  let nextAt = 0
  return async () => {
    const now = Date.now()
    const startAt = Math.max(now, nextAt)
    nextAt = startAt + delayMs
    if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now))
  }
}

async function fetchSearch(school, options, gate) {
  const queries =
    options.queryMode === 'gap-retry'
      ? [
          `${school.name} 后勤 食堂`,
          `${school.name} 迎新 食堂`,
          `${school.name} 餐饮中心`,
        ]
      : options.queryMode === 'dining-platform'
        ? [
            `${school.name} 餐饮中心 公众号`,
            `${school.name} 后勤服务中心 公众号`,
            `${school.name} 后勤集团 食堂`,
            `${school.name} 饮食服务中心`,
          ]
      : [`${school.name} 食堂 楼层`]
  const searchResults = []
  const sourceMap = new Map()
  for (const query of queries) {
    const url = buildSearchUrl(query)
    await gate()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 FoodLinkWechatPublicIndex/1.0',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        },
      })
      const body = (await response.text()).slice(0, 4 * 1024 * 1024)
      const classification = classifyResponse(response.status, body)
      if (classification !== 'ok') {
        searchResults.push({
          query,
          search_url: url,
          status: classification,
          error: `HTTP ${response.status}`,
          candidate_count: 0,
        })
        if (classification === 'search_blocked') break
        continue
      }
      const sources = extractResults(body, school, options.maxResults)
      searchResults.push({
        query,
        search_url: url,
        status: sources.length ? 'captured_candidates' : 'captured_no_candidates',
        candidate_count: sources.length,
      })
      for (const source of sources) {
        const previous = sourceMap.get(source.sogou_redirect_url)
        if (!previous) {
          sourceMap.set(source.sogou_redirect_url, {
            ...source,
            matched_queries: [query],
          })
        } else if (!previous.matched_queries.includes(query)) {
          previous.matched_queries.push(query)
        }
      }
    } catch (error) {
      searchResults.push({
        query,
        search_url: url,
        status: 'search_failed',
        error:
          error?.name === 'AbortError'
            ? `request_timeout_${options.requestTimeoutMs}ms`
            : String(error?.message || error),
        candidate_count: 0,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
  const sources = [...sourceMap.values()].slice(0, options.maxResults * queries.length)
  const blocked = searchResults.some((result) => result.status === 'search_blocked')
  const failed = searchResults.every((result) => result.status === 'search_failed')
  return {
    query: queries.join('；'),
    search_url: searchResults[0]?.search_url || '',
    search_queries: searchResults,
    status: blocked
      ? 'search_blocked'
      : failed
        ? 'search_failed'
        : sources.length
          ? 'captured_candidates'
          : 'captured_no_candidates',
    error: searchResults.find((result) => result.error)?.error || '',
    sources,
  }
}

function summarize(state) {
  const sources = state.schools.flatMap((school) => school.sources || [])
  return {
    schools: state.schools.length,
    schools_with_candidates: state.schools.filter((school) => school.sources?.length).length,
    candidate_articles: sources.length,
    candidate_cover_images: sources.filter((source) => source.cover_image_url).length,
    hierarchy_candidates: sources.reduce(
      (sum, source) => sum + (source.hierarchy_candidates?.length || 0),
      0,
    ),
    school_status: state.schools.reduce((counts, school) => {
      counts[school.status] = (counts[school.status] || 0) + 1
      return counts
    }, {}),
    account_classification: sources.reduce((counts, source) => {
      counts[source.account_classification] =
        (counts[source.account_classification] || 0) + 1
      return counts
    }, {}),
    dining_platform_account_articles: sources.filter(
      (source) => source.dining_platform_account_candidate,
    ).length,
    negative_context_articles: sources.filter((source) => source.negative_context).length,
  }
}

async function loadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseArgs(argv, cwd)
  if (options.help) {
    console.log(
      'Usage: node scripts/crawl-beijing-wechat-public-index.mjs [--school-codes codes] [--limit n] [--force] [--dry-run]',
    )
    return
  }
  const [input, existing] = await Promise.all([
    loadJson(options.inputPath, { schools: [] }),
    loadJson(options.outputPath, { schools: [] }),
  ])
  const selectedCodes = new Set(options.schoolCodes)
  let schools = (input.schools || [])
    .filter((school) => !USER_OVERRIDE_CODES.has(school.official_code))
    .filter((school) => selectedCodes.size === 0 || selectedCodes.has(school.official_code))
  if (options.limit > 0) schools = schools.slice(0, options.limit)
  const existingByCode = new Map(
    (existing?.schools || []).map((school) => [school.official_code, school]),
  )
  const tasks = schools.filter((school) => {
    if (options.force) return true
    const previous = existingByCode.get(school.official_code)
    return (
      !previous ||
      ['search_failed', 'search_blocked'].includes(previous.status) ||
      (options.retryEmpty && previous.status === 'captured_no_candidates')
    )
  })
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          selected_schools: schools.length,
          pending_tasks: tasks.length,
          excluded_user_override_codes: [...USER_OVERRIDE_CODES],
          output: options.outputPath,
        },
        null,
        2,
      ),
    )
    return
  }
  const state = {
    generated_at: new Date().toISOString(),
    scope:
      '北京高校微信公众号公开索引候选；仅读取搜狗微信搜索索引、摘要和封面原图，不进入 mp.weixin 正文，不写数据库',
    user_image_overrides: [...USER_OVERRIDE_CODES],
    summary: {},
    schools: options.force ? [] : [...(existing?.schools || [])],
  }
  const byCode = new Map(state.schools.map((school) => [school.official_code, school]))
  const gate = requestGate(options.requestDelayMs)
  let cursor = 0
  let completed = 0
  let consecutiveBlocked = 0
  let stopForBlock = false
  let writeChain = Promise.resolve()
  const writeState = async () => {
    state.generated_at = new Date().toISOString()
    state.summary = summarize(state)
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true })
    const temporary = `${options.outputPath}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, options.outputPath)
  }
  const workers = Array.from({ length: options.concurrency }, async (_, workerIndex) => {
    while (!stopForBlock) {
      const index = cursor
      cursor += 1
      if (index >= tasks.length) return
      const school = tasks[index]
      const result = await fetchSearch(school, options, gate)
      consecutiveBlocked = result.status === 'search_blocked' ? consecutiveBlocked + 1 : 0
      if (consecutiveBlocked >= 3) stopForBlock = true
      byCode.set(school.official_code, {
        school_id: school.school_id,
        official_code: school.official_code,
        name: school.name,
        province: school.province,
        audit_status: school.audit_status,
        query: result.query,
        search_url: result.search_url,
        search_queries: result.search_queries || [],
        status: result.status,
        error: result.error || '',
        sources: result.sources,
        checked_at: new Date().toISOString(),
      })
      state.schools = [...byCode.values()].sort((left, right) =>
        left.official_code.localeCompare(right.official_code),
      )
      completed += 1
      writeChain = writeChain.then(writeState)
      console.log(
        `[${completed}/${tasks.length}] worker=${workerIndex + 1} school=${school.name} status=${result.status} candidates=${result.sources.length}`,
      )
    }
  })
  await Promise.all(workers)
  await writeChain
  if (stopForBlock) {
    console.error('搜狗微信公开索引连续三次返回访问限制，已熔断停止。')
    process.exitCode = 2
  }
  console.log(JSON.stringify(state.summary, null, 2))
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

export {
  buildSearchUrl,
  extractOriginalCoverUrl,
  extractResults,
  parseArgs,
}
