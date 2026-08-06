#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildBingSearchUrl,
  classifySearchResponse,
} from './crawl-indexed-social-campus-dining.mjs'
import {
  extractHierarchyEvidence,
  htmlToVisibleText,
} from './crawl-indexed-content-evidence.mjs'

const DEFAULT_OUTPUT =
  'docs/campus-directory-proofreading/beijing-official-dining-center-evidence.json'
const DINING_RE =
  /食堂|餐厅|餐饮|饮食|美食|后勤|伙食|窗口|档口|楼层|一楼|二楼|三楼|四楼|地下一层|负一层/
const CENTER_RE =
  /餐饮中心|饮食服务中心|饮食中心|后勤服务中心|后勤管理处|后勤保障处|后勤集团|总务处/
const RETRYABLE = new Set(['search_failed', 'fetch_failed', 'request_blocked'])
const KNOWN_SEEDS = {
  '4111010001': [
    {
      url: 'https://cyzx.pku.edu.cn/',
      title: '北京大学餐饮中心',
      discovered_via: 'known_official_center',
    },
    {
      url: 'https://cyzx.pku.edu.cn/cydt/29820e7d9de942d5959641366db3ab6a.htm',
      title: '北京大学餐饮中心官方资讯文章',
      discovered_via: 'known_official_center_article',
    },
    {
      url: 'https://cyzx.pku.edu.cn/cydt/b6af95e5d75f4a7a805e504ff3695435.htm',
      title: '北京大学2025级新生餐饮服务保障',
      discovered_via: 'known_official_center_article',
    },
  ],
  '4111010003': [
    {
      url: 'https://www.tsinghua.edu.cn/ysfwzx/',
      title: '清华大学饮食服务中心',
      discovered_via: 'known_official_center',
    },
    {
      url: 'https://www.tsinghua.edu.cn/ysfwzx/info/1004/1009.htm',
      title: '清华大学特色餐厅',
      discovered_via: 'known_official_center_article',
    },
    {
      url: 'https://www.jiandang100.tsinghua.edu.cn/info/1063/8395.htm',
      title: '清华大学饮食服务专题文章',
      discovered_via: 'known_official_center_article',
    },
  ],
  '4111010006': [
    {
      url: 'https://bhhq.buaa.edu.cn/',
      title: '北京航空航天大学后勤服务中心',
      discovered_via: 'known_official_center',
    },
    {
      url: 'https://bhhq.buaa.edu.cn/info/1015/1088.htm',
      title: '北京航空航天大学后勤服务中心餐饮文章',
      discovered_via: 'known_official_center_article',
    },
    {
      url: 'https://news.buaa.edu.cn/info/1052/67984.htm',
      title: '北京航空航天大学餐饮服务新闻',
      discovered_via: 'known_official_center_article',
    },
  ],
}

function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    outputPath: path.resolve(cwd, DEFAULT_OUTPUT),
    schoolCodes: [],
    concurrency: 4,
    limit: 0,
    maxSearchResults: 6,
    maxPagesPerSchool: 3,
    requestDelayMs: 450,
    perHostDelayMs: 900,
    requestTimeoutMs: 20000,
    force: false,
    seedOnly: false,
    dryRun: false,
  }
  const valueAt = (index, flag) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数`)
    return value
  }
  const integerAt = (index, flag, allowZero = false) => {
    const parsed = Number.parseInt(valueAt(index, flag), 10)
    if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
      throw new Error(`${flag} 必须是${allowZero ? '非负' : '正'}整数`)
    }
    return parsed
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output') options.outputPath = path.resolve(cwd, valueAt(index++, arg))
    else if (arg === '--school-codes') {
      options.schoolCodes = valueAt(index++, arg).split(',').map((item) => item.trim()).filter(Boolean)
    } else if (arg === '--concurrency') options.concurrency = Math.min(8, integerAt(index++, arg))
    else if (arg === '--limit') options.limit = integerAt(index++, arg, true)
    else if (arg === '--max-search-results') options.maxSearchResults = integerAt(index++, arg)
    else if (arg === '--max-pages-per-school') options.maxPagesPerSchool = integerAt(index++, arg)
    else if (arg === '--request-delay-ms') options.requestDelayMs = integerAt(index++, arg, true)
    else if (arg === '--per-host-delay-ms') options.perHostDelayMs = integerAt(index++, arg, true)
    else if (arg === '--request-timeout-ms') options.requestTimeoutMs = integerAt(index++, arg)
    else if (arg === '--force') options.force = true
    else if (arg === '--seed-only') options.seedOnly = true
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
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
}

function stripTags(value) {
  return decodeEntities(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(value, baseUrl = '') {
  try {
    const url = new URL(decodeEntities(value), baseUrl || undefined)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (/(^|\.)bing\.com$/i.test(url.hostname)) {
      if (url.pathname !== '/ck/a') return ''
      const encoded = url.searchParams.get('u') || ''
      if (!encoded.startsWith('a1')) return ''
      return normalizeUrl(
        Buffer.from(encoded.slice(2).replaceAll('-', '+').replaceAll('_', '/'), 'base64')
          .toString('utf8'),
      )
    }
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|spm$|from$|source$)/i.test(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return ''
  }
}

function sameHostOrChild(host, allowedHost) {
  const normalized = String(host).toLowerCase()
  const allowed = String(allowedHost).toLowerCase()
  return normalized === allowed || normalized.endsWith(`.${allowed}`)
}

function isOfficialHost(host, allowedHosts) {
  return (
    [...allowedHosts].some((allowed) => sameHostOrChild(host, allowed)) ||
    /(^|\.)edu\.cn$/i.test(host)
  )
}

function extractSearchResults(html, school, allowedHosts, maxResults) {
  const results = []
  const seen = new Set()
  const blocks = [
    ...String(html).matchAll(
      /<li\b[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
    ),
  ]
  for (const match of blocks) {
    const fragment = match[1]
    const h2 = fragment.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || ''
    const href = h2.match(/href=["']([^"']+)["']/i)?.[1] || ''
    const url = normalizeUrl(href)
    if (!url || seen.has(url)) continue
    const title = stripTags(h2)
    const snippet = stripTags(fragment.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '')
    const evidenceText = `${title} ${snippet}`
    const host = new URL(url).hostname.toLowerCase()
    const onKnownOfficialHost = [...allowedHosts].some((allowed) =>
      sameHostOrChild(host, allowed),
    )
    const exactSchool = evidenceText.includes(school.name)
    const looksOfficial = isOfficialHost(host, allowedHosts)
    if (!DINING_RE.test(evidenceText)) continue
    if (!onKnownOfficialHost && !(exactSchool && looksOfficial)) continue
    seen.add(url)
    results.push({
      url,
      host,
      title,
      snippet,
      exact_school_name_in_search_text: exactSchool,
      accepted_by_official_host: onKnownOfficialHost,
      discovered_via: 'bing_official_center_query',
    })
    if (results.length >= maxResults) break
  }
  return results
}

function preferredHosts(hosts) {
  return [...hosts]
    .filter((host) => !/(^|\.)mp\.weixin\.qq\.com$/i.test(host))
    .sort((left, right) => {
      const score = (host) =>
        (/hq|houqin|cyzx|ysfw|hqfw|logistic|zcc|zcgl|fwzx/i.test(host) ? 20 : 0) +
        (/news|yjs|yz|xxgk/i.test(host) ? -5 : 0)
      return score(right) - score(left)
    })
    .slice(0, 2)
}

function buildQueries(school, allowedHosts) {
  const queries = [
    `"${school.name}" 餐饮中心 饮食服务中心 后勤服务中心 食堂 楼层`,
  ]
  const host = preferredHosts(allowedHosts)[0]
  if (host) queries.push(`site:${host} 食堂 餐厅 楼层 迎新`)
  return queries
}

function extractTitle(html) {
  return stripTags(
    String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      '',
  )
}

function imageAttribute(tag, name) {
  return (
    String(tag).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ||
    ''
  )
}

function extractImageCandidates(html, pageUrl) {
  const results = []
  const seen = new Set()
  const metaImages = [
    ...String(html).matchAll(
      /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi,
    ),
  ].map((match) => imageAttribute(match[0], 'content'))
  const imgTags = [...String(html).matchAll(/<img\b[^>]*>/gi)].map((match) => match[0])
  const records = [
    ...metaImages.map((src) => ({ src, alt: '', width: 0, height: 0, kind: 'meta' })),
    ...imgTags.map((tag) => ({
      src:
        imageAttribute(tag, 'data-src') ||
        imageAttribute(tag, 'data-original') ||
        imageAttribute(tag, 'data-lazy-src') ||
        imageAttribute(tag, 'src'),
      alt: stripTags(imageAttribute(tag, 'alt') || imageAttribute(tag, 'title')),
      width: Number.parseInt(imageAttribute(tag, 'width'), 10) || 0,
      height: Number.parseInt(imageAttribute(tag, 'height'), 10) || 0,
      kind: 'img',
    })),
  ]
  for (const record of records) {
    const url = normalizeUrl(record.src, pageUrl)
    if (!url || seen.has(url) || /^data:/i.test(url)) continue
    if (
      /(?:logo|icon|ewm|qrcode|二维码|loading|avatar|head|footer|banner|search|menu|close|bnt_|ser\.)/i.test(
        url,
      )
    ) {
      continue
    }
    if (
      record.width > 0 &&
      record.height > 0 &&
      (record.width < 240 || record.height < 160)
    ) {
      continue
    }
    seen.add(url)
    results.push({
      url,
      alt: record.alt,
      declared_width: record.width,
      declared_height: record.height,
      kind: record.kind,
      ocr_status: 'pending_candidate_selection',
    })
    if (results.length >= 24) break
  }
  return results
}

function decodeBody(bytes, contentType) {
  const charset =
    String(contentType).match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase() ||
    Buffer.from(bytes.slice(0, Math.min(bytes.length, 4096)))
      .toString('latin1')
      .match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1]?.toLowerCase() ||
    'utf-8'
  const normalized = /^(?:gbk|gb2312|gb18030)$/i.test(charset) ? 'gb18030' : charset
  try {
    return new TextDecoder(normalized).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function compact(value, limit = 1800) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function makeRequestGate(globalDelayMs, perHostDelayMs) {
  let nextGlobalAt = 0
  const nextHostAt = new Map()
  return async (url) => {
    const host = new URL(url).hostname
    const now = Date.now()
    const startAt = Math.max(now, nextGlobalAt, nextHostAt.get(host) || 0)
    nextGlobalAt = startAt + globalDelayMs
    nextHostAt.set(host, startAt + perHostDelayMs)
    if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now))
  }
}

async function fetchText(url, options, gate) {
  await gate(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 FoodLinkOfficialDiningResearch/1.0',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type') || '',
      body: decodeBody(bytes.slice(0, 8 * 1024 * 1024), response.headers.get('content-type') || ''),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: '',
      body: '',
      error:
        error?.name === 'AbortError'
          ? `request_timeout_${options.requestTimeoutMs}ms`
          : String(error?.message || error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function searchSchool(school, allowedHosts, options, gate) {
  if (options.seedOnly) return []
  const results = []
  const seen = new Set()
  for (const query of buildQueries(school, allowedHosts)) {
    const searchUrl = buildBingSearchUrl(query)
    const fetched = await fetchText(searchUrl, options, gate)
    const classification = classifySearchResponse(fetched.status, fetched.body)
    if (classification !== 'ok') {
      results.push({
        search_query: query,
        search_url: searchUrl,
        status: classification === 'blocked' ? 'search_blocked' : 'search_failed',
        candidates: [],
        error: fetched.error || `HTTP ${fetched.status}`,
      })
      continue
    }
    const candidates = extractSearchResults(
      fetched.body,
      school,
      allowedHosts,
      options.maxSearchResults,
    )
    results.push({
      search_query: query,
      search_url: searchUrl,
      status: candidates.length ? 'captured_candidates' : 'captured_no_candidates',
      candidates,
    })
    for (const candidate of candidates) {
      if (seen.has(candidate.url)) continue
      seen.add(candidate.url)
    }
  }
  return results
}

async function inspectPage(school, candidate, allowedHosts, options, gate) {
  const host = new URL(candidate.url).hostname.toLowerCase()
  if (!isOfficialHost(host, allowedHosts)) {
    return {
      ...candidate,
      status: 'rejected_non_official_host',
      checked_at: new Date().toISOString(),
    }
  }
  const fetched = await fetchText(candidate.url, options, gate)
  if (!fetched.ok) {
    return {
      ...candidate,
      status: fetched.status === 403 || fetched.status === 429 ? 'request_blocked' : 'fetch_failed',
      http_status: fetched.status,
      error: fetched.error || `HTTP ${fetched.status}`,
      checked_at: new Date().toISOString(),
    }
  }
  if (/application\/pdf/i.test(fetched.contentType)) {
    return {
      ...candidate,
      url: fetched.finalUrl,
      status: 'needs_pdf_extraction',
      http_status: fetched.status,
      content_type: fetched.contentType,
      checked_at: new Date().toISOString(),
    }
  }
  const title = extractTitle(fetched.body) || candidate.title || ''
  const visibleText = htmlToVisibleText(fetched.body)
  const sameAllowedHost = [...allowedHosts].some((allowed) => sameHostOrChild(host, allowed))
  const schoolMentioned = visibleText.includes(school.name) || title.includes(school.name)
  if (!sameAllowedHost && !schoolMentioned) {
    return {
      ...candidate,
      url: fetched.finalUrl,
      title,
      status: 'school_name_not_found',
      http_status: fetched.status,
      checked_at: new Date().toISOString(),
    }
  }
  const hierarchy = extractHierarchyEvidence(visibleText, school.name)
  const imageCandidates = extractImageCandidates(fetched.body, fetched.finalUrl)
  const hasDining = DINING_RE.test(visibleText)
  const status =
    hierarchy.hierarchy_candidates.length > 0
      ? 'candidate_hierarchy_evidence'
      : hasDining
        ? 'candidate_tokens_or_images'
        : 'no_dining_evidence'
  return {
    ...candidate,
    url: fetched.finalUrl,
    host: new URL(fetched.finalUrl).hostname.toLowerCase(),
    title,
    status,
    http_status: fetched.status,
    content_type: fetched.contentType,
    official_host_match: sameAllowedHost,
    school_name_in_page: schoolMentioned,
    organization_center_terms: [...new Set(visibleText.match(new RegExp(CENTER_RE.source, 'g')) || [])],
    evidence_excerpt: compact(
      hierarchy.hierarchy_candidates
        .map((row) => row.evidence_excerpt)
        .concat(hierarchy.unresolved_passages.map((row) => row.evidence_excerpt))
        .join(' ') || visibleText.match(/.{0,240}(?:食堂|餐厅|餐饮|饮食中心).{0,900}/s)?.[0] || '',
    ),
    canteen_candidates: hierarchy.stable_canteen_candidates,
    floor_mentions: hierarchy.floor_mentions,
    window_candidates: hierarchy.stable_window_candidates,
    hierarchy_candidates: hierarchy.hierarchy_candidates,
    unresolved_passages: hierarchy.unresolved_passages,
    image_candidates: imageCandidates,
    checked_at: new Date().toISOString(),
  }
}

function collectAllowedHosts(school, auditByCode, orientationByCode, floorByCode) {
  const hosts = new Set()
  const addUrl = (url) => {
    try {
      const host = new URL(url).hostname.toLowerCase()
      if (/(^|\.)edu\.cn$/i.test(host)) hosts.add(host)
    } catch {
      // Ignore malformed legacy source URLs.
    }
  }
  for (const canteen of auditByCode.get(school.official_code)?.canteens || []) {
    addUrl(canteen.source_url)
  }
  for (const source of orientationByCode.get(school.official_code)?.sources || []) addUrl(source.url)
  for (const source of floorByCode.get(school.official_code)?.sources || []) addUrl(source.url)
  for (const seed of KNOWN_SEEDS[school.official_code] || []) addUrl(seed.url)
  return hosts
}

function summarize(state) {
  const sources = state.schools.flatMap((school) => school.sources || [])
  const imageCandidates = sources.reduce(
    (sum, source) => sum + (source.image_candidates?.length || 0),
    0,
  )
  const hierarchyCandidates = sources.reduce(
    (sum, source) => sum + (source.hierarchy_candidates?.length || 0),
    0,
  )
  return {
    schools: state.schools.length,
    schools_with_sources: state.schools.filter((school) => school.sources?.length).length,
    sources: sources.length,
    source_status: sources.reduce((counts, source) => {
      counts[source.status] = (counts[source.status] || 0) + 1
      return counts
    }, {}),
    hierarchy_candidates: hierarchyCandidates,
    image_candidates: imageCandidates,
    retryable_sources: sources.filter((source) => RETRYABLE.has(source.status)).length,
  }
}

async function loadJson(filePath, fallback = null) {
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
      'Usage: node scripts/crawl-beijing-official-dining-centers.mjs [--school-codes codes] [--seed-only] [--force] [--dry-run]',
    )
    return
  }
  const docs = path.resolve(cwd, 'docs/campus-directory-proofreading')
  const [gap, roster, audit, orientation, floorGap, existing] = await Promise.all([
    loadJson(path.join(docs, 'beijing-gap-indexed-social-raw-evidence.json')),
    loadJson(path.join(docs, 'beijing-orientation-official-source-crawl.json')),
    loadJson(path.join(docs, 'nationwide-school-dining-audit.json')),
    loadJson(path.join(docs, 'beijing-orientation-official-source-crawl.json')),
    loadJson(path.join(docs, 'beijing-floor-gap-official-source-crawl.json'), { schools: [] }),
    loadJson(options.outputPath, { schools: [] }),
  ])
  const rosterByCode = new Map(roster.schools.map((school) => [school.official_code, school]))
  const targetCodes = new Set((gap?.schools || []).map((school) => school.official_code))
  for (const code of Object.keys(KNOWN_SEEDS)) targetCodes.add(code)
  const selectedCodes = new Set(options.schoolCodes)
  for (const code of selectedCodes) targetCodes.add(code)
  let schools = [...targetCodes]
    .map((code) => rosterByCode.get(code))
    .filter(Boolean)
    .filter((school) => selectedCodes.size === 0 || selectedCodes.has(school.official_code))
  if (options.limit > 0) schools = schools.slice(0, options.limit)
  const auditByCode = new Map(audit.schools.map((school) => [school.official_code, school]))
  const orientationByCode = new Map(orientation.schools.map((school) => [school.official_code, school]))
  const floorByCode = new Map((floorGap.schools || []).map((school) => [school.official_code, school]))
  const previousByCode = new Map((existing?.schools || []).map((school) => [school.official_code, school]))

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          selected_schools: schools.length,
          school_codes: schools.map((school) => school.official_code),
          seed_only: options.seedOnly,
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
      '北京高校官方餐饮中心、饮食服务中心、后勤服务中心页面与配图候选；仅供人工审核，不写数据库',
    method:
      '机构官网域名优先；同一官方机构域名内不要求页面标题重复完整校名；提取正文层级候选与文章配图链接',
    summary: {},
    schools: options.force ? [] : [...(existing?.schools || [])],
  }
  const byCode = new Map(state.schools.map((school) => [school.official_code, school]))
  const gate = makeRequestGate(options.requestDelayMs, options.perHostDelayMs)
  let cursor = 0
  let completed = 0
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
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= schools.length) return
      const school = schools[index]
      const previous = previousByCode.get(school.official_code)
      if (
        !options.force &&
        previous &&
        previous.status === 'completed' &&
        previous.sources?.every((source) => !RETRYABLE.has(source.status))
      ) {
        completed += 1
        console.log(
          `[${completed}/${schools.length}] worker=${workerIndex + 1} school=${school.name} reused`,
        )
        continue
      }
      const allowedHosts = collectAllowedHosts(
        school,
        auditByCode,
        orientationByCode,
        floorByCode,
      )
      const searches = await searchSchool(school, allowedHosts, options, gate)
      const candidateMap = new Map()
      for (const seed of KNOWN_SEEDS[school.official_code] || []) {
        candidateMap.set(seed.url, {
          ...seed,
          host: new URL(seed.url).hostname.toLowerCase(),
        })
      }
      for (const search of searches) {
        for (const candidate of search.candidates || []) {
          if (!candidateMap.has(candidate.url)) candidateMap.set(candidate.url, candidate)
        }
      }
      const candidates = [...candidateMap.values()]
        .sort((left, right) => {
          const score = (row) =>
            (/known_official_center/.test(row.discovered_via) ? 20 : 0) +
            (CENTER_RE.test(`${row.title || ''} ${row.snippet || ''}`) ? 10 : 0) +
            (DINING_RE.test(`${row.title || ''} ${row.snippet || ''}`) ? 5 : 0)
          return score(right) - score(left)
        })
        .slice(0, options.maxPagesPerSchool)
      const sources = []
      for (const candidate of candidates) {
        sources.push(await inspectPage(school, candidate, allowedHosts, options, gate))
      }
      const result = {
        school_id: school.school_id,
        official_code: school.official_code,
        name: school.name,
        province: school.province,
        audit_status: school.audit_status,
        official_hosts: [...allowedHosts].sort(),
        search_results: searches,
        sources,
        status:
          searches.some((search) => search.status === 'search_blocked') &&
          sources.length === 0
            ? 'search_blocked'
            : 'completed',
        checked_at: new Date().toISOString(),
      }
      byCode.set(school.official_code, result)
      state.schools = [...byCode.values()].sort((left, right) =>
        left.official_code.localeCompare(right.official_code),
      )
      completed += 1
      writeChain = writeChain.then(writeState)
      console.log(
        `[${completed}/${schools.length}] worker=${workerIndex + 1} school=${school.name} hosts=${allowedHosts.size} sources=${sources.length} hierarchy=${sources.reduce((sum, source) => sum + (source.hierarchy_candidates?.length || 0), 0)} images=${sources.reduce((sum, source) => sum + (source.image_candidates?.length || 0), 0)}`,
      )
    }
  })
  await Promise.all(workers)
  await writeChain
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
  extractImageCandidates,
  extractSearchResults,
  parseArgs,
  preferredHosts,
}
