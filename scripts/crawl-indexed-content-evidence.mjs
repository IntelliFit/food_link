#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_INPUT = 'docs/campus-directory-proofreading/nationwide-indexed-social-raw-evidence.json'
const DEFAULT_OUTPUT = 'docs/campus-directory-proofreading/nationwide-indexed-content-evidence.json'
const COMPLETED_STATUSES = new Set([
  'candidate_hierarchy_evidence',
  'candidate_tokens_only',
  'no_structured_dining_evidence',
  'school_name_not_found',
  'http_error',
  'needs_pdf_extraction',
  'skipped_platform_policy',
])
const RETRYABLE_STATUSES = new Set(['fetch_failed', 'request_blocked'])
const DINING_PATTERN = /食堂|餐厅|饭堂|餐饮|美食城|美食广场|窗口|档口/
const CANTEEN_PATTERN = /[\p{Script=Han}A-Za-z0-9·（）()]{1,18}(?:学生食堂|教工食堂|清真食堂|食堂|餐厅|美食城|美食广场|饭堂)/gu
const FLOOR_PATTERN = /(?:负?[一二三四五六七八九十两0-9]+(?:楼|层)|地下[一二三四五六七八九十两0-9]+层|B[0-9]+|[一二三四五六七八九十两0-9]+[至到~-][一二三四五六七八九十两0-9]+(?:楼|层))/gu
const WINDOW_PATTERN = /[\p{Script=Han}A-Za-z0-9·（）()]{1,18}(?:窗口|档口)/gu
const FLOOR_TOKEN_SOURCE = '(?:负?[一二三四五六七八九十两0-9]+(?:楼|层)|地下[一二三四五六七八九十两0-9]+层|B[0-9]+|[一二三四五六七八九十两0-9]+[至到~-][一二三四五六七八九十两0-9]+(?:楼|层))'
const FLOOR_PREFIX_PATTERN = new RegExp(`^${FLOOR_TOKEN_SOURCE}(?:均?为|是|的)?`, 'u')
const WINDOW_FLOOR_PREFIX_PATTERN = new RegExp(`^${FLOOR_TOKEN_SOURCE}(?:有|设有|的)?`, 'u')
const EMBEDDED_FLOOR_PATTERN = new RegExp(`^(.{1,8}?)(${FLOOR_TOKEN_SOURCE})(.{0,10}(?:食堂|餐厅|美食城|美食广场|饭堂))$`, 'u')

export function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    inputPath: path.resolve(cwd, DEFAULT_INPUT),
    outputPath: path.resolve(cwd, DEFAULT_OUTPUT),
    province: '',
    schoolCodes: [],
    concurrency: 4,
    limit: 0,
    requestDelayMs: 300,
    perHostDelayMs: 1200,
    requestTimeoutMs: 20000,
    maxBodyBytes: 6 * 1024 * 1024,
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
    if (arg === '--input') options.inputPath = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--output') options.outputPath = path.resolve(cwd, takeValue(index++, arg))
    else if (arg === '--province') options.province = takeValue(index++, arg).trim()
    else if (arg === '--school-codes') options.schoolCodes = takeValue(index++, arg).split(',').map((item) => item.trim()).filter(Boolean)
    else if (arg === '--concurrency') options.concurrency = Math.min(8, toInteger(takeValue(index++, arg), arg))
    else if (arg === '--limit') options.limit = toInteger(takeValue(index++, arg), arg, true)
    else if (arg === '--request-delay-ms') options.requestDelayMs = toInteger(takeValue(index++, arg), arg, true)
    else if (arg === '--per-host-delay-ms') options.perHostDelayMs = toInteger(takeValue(index++, arg), arg, true)
    else if (arg === '--request-timeout-ms') options.requestTimeoutMs = toInteger(takeValue(index++, arg), arg)
    else if (arg === '--max-body-bytes') options.maxBodyBytes = toInteger(takeValue(index++, arg), arg)
    else if (arg === '--force') options.force = true
    else if (arg === '--no-retry-failures') options.retryFailures = false
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数: ${arg}`)
  }
  return options
}

export function selectTasks(input, state, options) {
  const schoolCodes = new Set(options.schoolCodes)
  const previous = new Map()
  for (const school of state?.schools ?? []) {
    for (const source of school.sources ?? []) previous.set(`${school.school_id}\n${source.url}`, source)
  }
  const tasks = []
  for (const school of input.schools ?? []) {
    if (options.province && school.province !== options.province) continue
    if (schoolCodes.size > 0 && !schoolCodes.has(school.official_code)) continue
    for (const source of school.sources ?? []) {
      if (!source.url || source.status !== 'indexed_candidate') continue
      const old = previous.get(`${school.school_id}\n${source.url}`)
      if (!options.force && old) {
        if (COMPLETED_STATUSES.has(old.status)) continue
        if (RETRYABLE_STATUSES.has(old.status) && !options.retryFailures) continue
      }
      tasks.push({
        schoolId: school.school_id,
        officialCode: school.official_code,
        schoolName: school.name,
        province: school.province,
        auditStatus: school.audit_status,
        url: source.url,
        searchTitle: source.title ?? '',
        searchSnippet: source.snippet ?? '',
        platform: source.platform ?? 'public_web',
        discoveredVia: source.discovered_via ?? 'bing',
      })
      if (options.limit > 0 && tasks.length >= options.limit) return tasks
    }
  }
  return tasks
}

function decodeHTMLEntities(value) {
  return String(value)
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
}

export function htmlToVisibleText(html) {
  return decodeHTMLEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, ' ')
      .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|li|article|section|h1|h2|h3|h4|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim()
}

function compact(value, limit = 800) {
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function normalizeMatches(pattern, text, schoolName = '') {
  const seen = new Set()
  const results = []
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    let value = compact(match[0], 80)
    if (schoolName && value.startsWith(schoolName)) value = value.slice(schoolName.length)
    value = value.replace(/^(?:学校|学院|校内|现有|设有|共有|包括|提供)+/, '').trim()
    if (!value || [...value].length > 24 || seen.has(value)) continue
    seen.add(value)
    results.push(value)
    if (results.length >= 80) break
  }
  return results
}

function normalizedMatchEntries(pattern, text, schoolName = '') {
  const entries = []
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    let value = compact(match[0], 80)
    if (schoolName && value.startsWith(schoolName)) value = value.slice(schoolName.length)
    value = value.replace(/^(?:学校|学院|校内|现有|设有|共有|包括|提供)+/, '').trim()
    if (!value || [...value].length > 24) continue
    entries.push({
      raw: match[0],
      value,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return entries
}

function cleanStableCanteen(value) {
  let result = String(value)
  for (const marker of ['总体来说', '我觉得', '介绍了', '开设有', '设有', '包括', '共有', '关于', '命名', '开展', '举办', '提供', '以及', '还有', '其中']) {
    const index = result.lastIndexOf(marker)
    if (index >= 0) result = result.slice(index + marker.length)
  }
  result = result.trim().replace(FLOOR_PREFIX_PATTERN, '')
  const embedded = result.match(EMBEDDED_FLOOR_PATTERN)
  if (embedded) result = `${embedded[1]}${embedded[3]}`
  return result.replace(/^(?:均?为|是|的)+/, '').trim()
}

function isStableCanteen(value) {
  const result = cleanStableCanteen(value)
  if (![...result].length || [...result].length > 14) return false
  if (!/(?:食堂|餐厅|美食城|美食广场|饭堂)$/.test(result)) return false
  if (/^(?:食堂|餐厅|饭堂|学生食堂|教工食堂|清真食堂|学校食堂|学院食堂|各食堂|所有食堂|校内食堂|几个食堂|多个食堂|一二三食堂)$/.test(result)) return false
  if (/^[（(]|^(?:的|为|由|对|在)|为了|加强|做好|切实|我校|学校|学院|同学|监管|管理|检查|销售|场所|每份|元|不少于|有哪些|有几个|有三个|有两个|有很多|有[一二三四五六七八九十两0-9]+|每个|各食堂|所有餐厅|通过|负责人|团队|部门|指导|持续|推进|建设|年度|营养健康|按照|邀请|监督|主动|春季|学期|首次|建立|进入|总体来说|我觉得|之前|两个食堂|一个大的|一个小的|校区有|本部的|的高校|等\d*家|\d{4}年|年食堂|当天食堂|当日食堂|是师生|网红打卡|模式堪比|堪比|类似于|像是|来到|走进/.test(result)) return false
  if (/^(?:大众食堂|大众餐厅|特色美食餐厅|特色风味餐厅|招待餐厅|民族风味餐厅|智慧餐厅|一楼餐厅|二楼餐厅|三楼餐厅|四楼餐厅)$/.test(result)) return false
  if (/[、和及与]/.test(result.replace(/(?:食堂|餐厅|美食城|美食广场|饭堂)$/, ''))) return false
  return true
}

function stableCanteens(values) {
  return [...new Set(values.map(cleanStableCanteen).filter(isStableCanteen))]
}

function cleanStableWindow(value) {
  let result = String(value)
  for (const marker of ['开设有', '设有', '包含', '包括', '以及', '还有', '另有', '其中', '通过']) {
    const index = result.lastIndexOf(marker)
    if (index >= 0) result = result.slice(index + marker.length)
  }
  return result.trim().replace(WINDOW_FLOOR_PREFIX_PATTERN, '').trim()
}

function isStableWindow(value) {
  const result = cleanStableWindow(value)
  if (![...result].length || [...result].length > 12) return false
  if (!/(?:窗口|档口)$/.test(result)) return false
  if (/^(?:窗口|档口|大窗口|小窗口|风味窗口|特色窗口|服务窗口|示范窗口|各窗口|所有窗口)$/.test(result)) return false
  if (/^(?:各|所有)|不仅|开设|各食堂|其中|包含|通过|作为|成为|以及|示范窗口|这一|营养健康餐厅|坐在|站在|来到|到达|只剩|剩余|设立|设置/.test(result)) return false
  if (/[、和及与]|等(?:特色)?(?:窗口|档口)$|[0-9一二三四五六七八九十两]+个(?:窗口|档口)$/.test(result)) return false
  return true
}

function stableWindows(values) {
  return [...new Set(values.map(cleanStableWindow).filter(isStableWindow))]
}

function isFloorCountMention(text, entry) {
  const before = text.slice(Math.max(0, entry.start - 10), entry.start)
  return /(?:共|共有|共计|总共|一共|分为|分成|共分|设有|拥有)\s*$/.test(before)
}

function floorEntries(text) {
  return normalizedMatchEntries(FLOOR_PATTERN, text)
    .filter((entry) => !isFloorCountMention(text, entry))
    .flatMap((entry) => {
      const compactPair = entry.value.match(/^([一二三四五六七八九])([一二三四五六七八九])([楼层])$/)
      if (!compactPair || compactPair[1] === compactPair[2]) return [entry]
      return [
        { ...entry, value: `${compactPair[1]}${compactPair[3]}` },
        { ...entry, value: `${compactPair[2]}${compactPair[3]}` },
      ]
    })
}

function canteenEntries(text, schoolName) {
  return normalizedMatchEntries(CANTEEN_PATTERN, text, schoolName)
    .map((entry) => ({ ...entry, normalized: cleanStableCanteen(entry.value) }))
    .filter((entry) => isStableCanteen(entry.normalized))
}

function windowEntries(text) {
  return normalizedMatchEntries(WINDOW_PATTERN, text)
    .map((entry) => ({ ...entry, normalized: cleanStableWindow(entry.value) }))
    .filter((entry) => isStableWindow(entry.normalized))
}

function distanceBetween(left, right) {
  if (left.end < right.start) return right.start - left.end
  if (right.end < left.start) return left.start - right.end
  return 0
}

function uniqueEntryValues(entries, property = 'value') {
  return [...new Set(entries.map((entry) => entry[property]))]
}

function associatedFloors(canteenEntry, floors) {
  const embedded = floors.filter((floor) => floor.start >= canteenEntry.start && floor.end <= canteenEntry.end)
  if (embedded.length > 0) {
    const latestStart = Math.max(...embedded.map((floor) => floor.start))
    return embedded.filter((floor) => floor.start === latestStart)
  }

  const after = floors.filter((floor) => floor.start >= canteenEntry.end)
  const before = floors.filter((floor) => floor.end <= canteenEntry.start)
  if (before.length === 0 && after.length > 0) {
    return after.filter((floor) => floor.start - canteenEntry.end <= 160)
  }

  return [...floors]
    .filter((floor) => distanceBetween(canteenEntry, floor) <= 32)
    .sort((left, right) => distanceBetween(canteenEntry, left) - distanceBetween(canteenEntry, right))
    .slice(0, 1)
}

function nearestFloor(entry, floors, maxDistance = 36) {
  const overlapping = floors.filter((floor) => distanceBetween(entry, floor) === 0)
  if (overlapping.length > 0) return [...overlapping].sort((left, right) => right.start - left.start)[0]
  const preceding = floors.filter((floor) => floor.end <= entry.start && entry.start - floor.end <= maxDistance)
  if (preceding.length > 0) return [...preceding].sort((left, right) => right.end - left.end)[0]
  const following = floors.filter((floor) => floor.start >= entry.end && floor.start - entry.end <= maxDistance)
  if (following.length === 0) return null
  return [...following].sort((left, right) => left.start - right.start)[0]
}

function splitPassages(text) {
  const raw = String(text).split(/[。！？!?；;\n\r]+/).map((item) => item.trim()).filter(Boolean)
  const passages = []
  for (const item of raw) {
    if (!DINING_PATTERN.test(item)) continue
    if ([...item].length <= 900) {
      passages.push(item)
      continue
    }
    const runes = [...item]
    for (const match of item.matchAll(/食堂|餐厅|饭堂|美食城|美食广场|窗口|档口/g)) {
      const position = [...item.slice(0, match.index)].length
      passages.push(runes.slice(Math.max(0, position - 180), Math.min(runes.length, position + 420)).join(''))
    }
  }
  return [...new Set(passages.map((item) => compact(item, 900)))]
}

export function extractHierarchyEvidence(text, schoolName) {
  const canteens = normalizeMatches(CANTEEN_PATTERN, text, schoolName)
  const floors = uniqueEntryValues(floorEntries(text))
  const windows = normalizeMatches(WINDOW_PATTERN, text)
  const namedCanteens = stableCanteens(canteens)
  const namedWindows = stableWindows(windows)
  const relations = []
  const unresolvedPassages = []
  const relationKeys = new Set()

  for (const passage of splitPassages(text)) {
    const passageCanteens = normalizeMatches(CANTEEN_PATTERN, passage, schoolName)
    const passageFloorEntries = floorEntries(passage)
    const passageFloors = uniqueEntryValues(passageFloorEntries)
    const passageWindows = normalizeMatches(WINDOW_PATTERN, passage)
    const passageCanteenEntries = canteenEntries(passage, schoolName)
    const passageWindowEntries = windowEntries(passage)
    const passageNamedCanteens = uniqueEntryValues(passageCanteenEntries, 'normalized')
    const passageNamedWindows = uniqueEntryValues(passageWindowEntries, 'normalized')
    if (passageCanteens.length === 1 && passageNamedCanteens.length === 1 && passageFloors.length + passageNamedWindows.length > 0) {
      const canteen = passageNamedCanteens[0]
      const relevantCanteenEntries = passageCanteenEntries.filter((entry) => entry.normalized === canteen)
      const relatedFloorEntries = relevantCanteenEntries.flatMap((entry) => associatedFloors(entry, passageFloorEntries))
      for (const floor of uniqueEntryValues(relatedFloorEntries)) {
        addRelation(relations, relationKeys, {
          relation_type: 'canteen_floor',
          canteen,
          floor,
          window: '',
          evidence_excerpt: compact(passage, 700),
          evidence_scope: 'same_passage',
          review_status: 'pending_manual_review',
        })
      }
      for (const windowEntry of passageWindowEntries) {
        const floorEntry = nearestFloor(windowEntry, relatedFloorEntries)
        addRelation(relations, relationKeys, {
          relation_type: floorEntry ? 'canteen_floor_window' : 'canteen_window_floor_unresolved',
          canteen,
          floor: floorEntry?.value ?? '',
          window: windowEntry.normalized,
          evidence_excerpt: compact(passage, 700),
          evidence_scope: floorEntry ? 'same_passage_nearest_floor' : 'same_passage',
          review_status: 'pending_manual_review',
        })
      }
    }
    if (
      passageFloors.length + passageWindows.length > 0 &&
      (
        passageCanteens.length !== 1 ||
        passageNamedCanteens.length !== 1 ||
        passageNamedWindows.length < passageWindows.length
      )
    ) {
      unresolvedPassages.push({
        canteen_candidates: passageCanteens,
        stable_canteen_candidates: passageNamedCanteens,
        floor_mentions: passageFloors,
        window_candidates: passageWindows,
        stable_window_candidates: passageNamedWindows,
        reason: passageNamedCanteens.length === 0
          ? 'missing_stable_canteen_parent'
          : passageCanteens.length !== 1 || passageNamedCanteens.length > 1
            ? 'multiple_canteen_parents'
            : 'unstable_window_name',
        evidence_excerpt: compact(passage, 700),
      })
    }
  }
  return {
    canteen_candidates: canteens,
    stable_canteen_candidates: namedCanteens,
    floor_mentions: floors,
    window_candidates: windows,
    stable_window_candidates: namedWindows,
    hierarchy_candidates: relations,
    unresolved_passages: deduplicateObjects(unresolvedPassages),
  }
}

function addRelation(relations, keys, relation) {
  const key = [relation.relation_type, relation.canteen, relation.floor, relation.window, relation.evidence_excerpt].join('\n')
  if (keys.has(key)) return
  keys.add(key)
  relations.push(relation)
}

function deduplicateObjects(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function detectCharset(contentType, bytes) {
  const header = String(contentType).match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
  if (header) return normalizeCharset(header)
  const prefix = Buffer.from(bytes.slice(0, Math.min(bytes.length, 4096))).toString('latin1')
  const meta = prefix.match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1]
  return normalizeCharset(meta || 'utf-8')
}

function normalizeCharset(value) {
  const normalized = String(value).trim().toLowerCase()
  if (['gb2312', 'gbk', 'x-gbk'].includes(normalized)) return 'gb18030'
  return normalized
}

function decodeBody(bytes, contentType) {
  const charset = detectCharset(contentType, bytes)
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function isBlockedResponse(status, text) {
  return status === 403 || status === 429 || /访问频繁|异常流量|安全验证|请输入验证码|unusual traffic|captcha/i.test(text)
}

async function fetchAndInspect(task, options, waitForRequest, fetchCache) {
  let parsed
  try {
    parsed = new URL(task.url)
  } catch {
    return baseResult(task, 'fetch_failed', { error: '候选 URL 无效' })
  }
  if (/(^|\.)xiaohongshu\.com$/i.test(parsed.hostname)) {
    return baseResult(task, 'skipped_platform_policy', {
      note: '全国正文任务不直接访问小红书页面；保留链接供后续少量人工核验',
    })
  }

  let responseDataPromise = fetchCache.get(task.url)
  if (!responseDataPromise) {
    responseDataPromise = fetchPage(task.url, options, waitForRequest)
    fetchCache.set(task.url, responseDataPromise)
  }
  const fetched = await responseDataPromise
  if (fetched.error) return baseResult(task, 'fetch_failed', { error: fetched.error })
  if (fetched.blocked) return baseResult(task, 'request_blocked', { content_type: fetched.contentType, error: fetched.error })
  if (fetched.status < 200 || fetched.status >= 300) {
    return baseResult(task, 'http_error', { content_type: fetched.contentType, error: `HTTP ${fetched.status}` })
  }
  if (/pdf/i.test(fetched.contentType) || parsed.pathname.toLowerCase().endsWith('.pdf')) {
    return baseResult(task, 'needs_pdf_extraction', { content_type: fetched.contentType })
  }

  const text = htmlToVisibleText(decodeBody(fetched.bytes, fetched.contentType))
  if (!text.includes(task.schoolName) && !task.searchTitle.includes(task.schoolName)) {
    return baseResult(task, 'school_name_not_found', { content_type: fetched.contentType })
  }
  const evidence = extractHierarchyEvidence(text, task.schoolName)
  const tokenCount = evidence.canteen_candidates.length + evidence.floor_mentions.length + evidence.window_candidates.length
  const status = evidence.hierarchy_candidates.length > 0
    ? 'candidate_hierarchy_evidence'
    : tokenCount > 0
      ? 'candidate_tokens_only'
      : 'no_structured_dining_evidence'
  return baseResult(task, status, {
    content_type: fetched.contentType,
    final_url: fetched.finalURL,
    ...evidence,
    note: '层级候选只来自同一段且仅有一个食堂父级；仍需人工核验校区、名称稳定性和营业现状后才能入库',
  })
}

async function fetchPage(url, options, waitForRequest) {
  await waitForRequest(new URL(url).hostname)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 FoodLinkCampusDirectoryResearch/1.0',
        Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    })
    const bytes = new Uint8Array((await response.arrayBuffer()).slice(0, options.maxBodyBytes))
    const contentType = response.headers.get('content-type') ?? ''
    const preview = /pdf/i.test(contentType) ? '' : decodeBody(bytes.slice(0, Math.min(bytes.length, 200000)), contentType)
    return {
      status: response.status,
      contentType,
      finalURL: response.url,
      bytes,
      blocked: isBlockedResponse(response.status, preview),
      error: isBlockedResponse(response.status, preview) ? `页面返回访问限制，HTTP ${response.status}` : '',
    }
  } catch (error) {
    const message = error?.name === 'AbortError' ? `请求超过 ${options.requestTimeoutMs}ms` : String(error?.message ?? error)
    return { error: message }
  } finally {
    clearTimeout(timeout)
  }
}

function baseResult(task, status, extra = {}) {
  return {
    url: task.url,
    search_title: task.searchTitle,
    search_snippet: task.searchSnippet,
    host: safeHost(task.url),
    platform: task.platform,
    discovered_via: task.discoveredVia,
    status,
    checked_at: new Date().toISOString(),
    ...extra,
  }
}

function safeHost(value) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function upsertSourceResult(state, task, result) {
  let school = state.schools.find((item) => item.school_id === task.schoolId)
  if (!school) {
    school = {
      school_id: task.schoolId,
      official_code: task.officialCode,
      name: task.schoolName,
      province: task.province,
      audit_status: task.auditStatus,
      sources: [],
    }
    state.schools.push(school)
  }
  const index = school.sources.findIndex((source) => source.url === result.url)
  if (index >= 0) school.sources[index] = result
  else school.sources.push(result)
  state.generated_at = new Date().toISOString()
  state.summary = summarizeState(state)
}

export function summarizeState(state) {
  const status = {}
  let sources = 0
  let hierarchyCandidates = 0
  let unresolvedPassages = 0
  for (const school of state.schools ?? []) {
    for (const source of school.sources ?? []) {
      sources += 1
      status[source.status ?? 'unknown'] = (status[source.status ?? 'unknown'] ?? 0) + 1
      hierarchyCandidates += source.hierarchy_candidates?.length ?? 0
      unresolvedPassages += source.unresolved_passages?.length ?? 0
    }
  }
  return {
    schools: state.schools?.length ?? 0,
    sources,
    hierarchy_candidates: hierarchyCandidates,
    unresolved_passages: unresolvedPassages,
    status,
  }
}

function createState(inputPath, existing) {
  return {
    generated_at: existing?.generated_at ?? new Date().toISOString(),
    scope: existing?.scope ?? '全国高校公开索引候选正文证据；同段单一食堂父级才生成层级候选，所有结果待人工核验且不得直接入库',
    source_input: existing?.source_input ?? path.relative(process.cwd(), inputPath).replaceAll('\\', '/'),
    summary: existing?.summary ?? { schools: 0, sources: 0, hierarchy_candidates: 0, unresolved_passages: 0, status: {} },
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

function createRequestLimiter(globalDelayMs, perHostDelayMs) {
  let globalNextAt = 0
  const hostNextAt = new Map()
  let tail = Promise.resolve()
  return async (host) => {
    let release
    const previous = tail
    tail = new Promise((resolve) => { release = resolve })
    await previous
    const now = Date.now()
    const waitMs = Math.max(0, globalNextAt - now, (hostNextAt.get(host) ?? 0) - now)
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    const startedAt = Date.now()
    globalNextAt = startedAt + globalDelayMs
    hostNextAt.set(host, startedAt + perHostDelayMs)
    release()
  }
}

async function runWorkers(tasks, state, options) {
  let cursor = 0
  let completed = 0
  let stopping = false
  let saveChain = Promise.resolve()
  const waitForRequest = createRequestLimiter(options.requestDelayMs, options.perHostDelayMs)
  const fetchCache = new Map()
  const stop = () => { stopping = true }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  const worker = async (workerIndex) => {
    while (!stopping) {
      const index = cursor++
      if (index >= tasks.length) break
      const task = tasks[index]
      const result = await fetchAndInspect(task, options, waitForRequest, fetchCache)
      upsertSourceResult(state, task, result)
      saveChain = saveChain.then(() => writeJSONAtomic(options.outputPath, state))
      await saveChain
      completed += 1
      console.log(`[${completed}/${tasks.length}] worker=${workerIndex + 1} school=${task.schoolName} status=${result.status} relations=${result.hierarchy_candidates?.length ?? 0} url=${task.url}`)
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
  console.log(`高校食堂公开候选正文证据处理器

用法：
  npm run campus:indexed-content:crawl -- --dry-run
  npm run campus:indexed-content:crawl -- --limit 20 --concurrency 4

参数：
  --input <json>                 公开索引候选输入
  --output <json>                正文证据断点输出
  --province <省市>              精确筛选地区
  --school-codes <代码,代码>     精确筛选学校
  --concurrency <1-8>            并发请求数，默认 4
  --limit <n>                    最多处理候选 URL 数，0 表示不限
  --request-delay-ms <n>         全局请求启动间隔，默认 300ms
  --per-host-delay-ms <n>        同域请求启动间隔，默认 1200ms
  --request-timeout-ms <n>       单页超时，默认 20000ms
  --force                        忽略断点重新处理
  --no-retry-failures            不重试网络失败
  --dry-run                      只统计断点，不联网
`)
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) return printHelp()
  const input = await loadJSON(options.inputPath, null)
  if (!input) throw new Error(`候选输入不存在: ${options.inputPath}`)
  const existing = await loadJSON(options.outputPath, null)
  const state = createState(options.inputPath, existing)
  const tasks = selectTasks(input, state, options)
  const totalCandidates = (input.schools ?? []).reduce((sum, school) => sum + (school.sources?.length ?? 0), 0)
  console.log(`候选学校=${input.summary?.status?.captured_indexed_candidates ?? 0} 候选URL=${totalCandidates} 待处理=${tasks.length} 已有断点=${state.summary.sources} 并发=${options.concurrency}`)
  if (options.dryRun || tasks.length === 0) return
  await runWorkers(tasks, state, options)
  console.log(`正文证据批次结束，输出=${options.outputPath}`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`正文证据采集失败: ${error.message}`)
    process.exitCode = 1
  })
}
