#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  buildBingSearchUrl,
  classifySearchResponse,
  extractIndexedPublicResults,
} from './crawl-indexed-social-campus-dining.mjs'

const repoRoot = path.resolve(process.argv[2] || process.cwd())
const auditPath = path.join(repoRoot, 'docs', 'campus-directory-proofreading', 'nationwide-school-dining-audit.json')
const rosterPath = path.join(repoRoot, 'docs', 'campus-directory-proofreading', 'beijing-orientation-official-source-crawl.json')
const outputPath = path.join(repoRoot, 'docs', 'campus-directory-proofreading', 'beijing-canteen-floor-indexed-raw-evidence.json')
const [audit, roster] = await Promise.all(
  [auditPath, rosterPath].map(async (file) => JSON.parse(await fs.readFile(file, 'utf8'))),
)

const beijingCodes = new Set(roster.schools.map((school) => school.official_code))
const schools = audit.schools.filter((school) => beijingCodes.has(school.official_code))
const tasks = schools.flatMap((school) =>
  (school.canteens || [])
    .filter((canteen) => canteen.status === 'active' && !canteen.building_or_floor)
    .map((canteen) => ({
      school_id: school.school_id,
      official_code: school.official_code,
      school_name: school.name,
      province: school.province,
      audit_status: school.audit_status,
      campus_name: canteen.campus_name || '',
      canteen_name: canteen.name,
      query: `"${school.name}" "${canteen.name}" 楼层`,
    })),
)

const state = {
  generated_at: new Date().toISOString(),
  scope: '北京现有食堂逐食堂楼层公开索引补采；只生成候选证据，不写数据库',
  summary: {},
  schools: schools.map((school) => ({
    school_id: school.school_id,
    official_code: school.official_code,
    name: school.name,
    province: school.province,
    audit_status: school.audit_status,
    sources: [],
  })),
  task_results: [],
}
const stateBySchool = new Map(state.schools.map((school) => [school.school_id, school]))
const seenSourceKeys = new Set()
let nextRequestAt = 0
let saveChain = Promise.resolve()

const waitForRequest = async () => {
  const now = Date.now()
  const startAt = Math.max(now, nextRequestAt)
  nextRequestAt = startAt + 700
  if (startAt > now) await new Promise((resolve) => setTimeout(resolve, startAt - now))
}
const writeAtomic = async () => {
  const temporary = `${outputPath}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await fs.rename(temporary, outputPath)
}
const fetchTask = async (task) => {
  await waitForRequest()
  const searchUrl = buildBingSearchUrl(task.query)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 FoodLinkCampusDirectoryResearch/1.0',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    })
    const body = (await response.text()).slice(0, 6 * 1024 * 1024)
    const classification = classifySearchResponse(response.status, body)
    if (classification !== 'ok') {
      return { ...task, status: classification === 'blocked' ? 'search_blocked' : 'search_failed', search_url: searchUrl, sources: [] }
    }
    const sources = extractIndexedPublicResults(body, task.school_name, 8).map((source) => ({
      ...source,
      host: new URL(source.url).hostname,
      channel: 'indexed_public_web',
      discovered_via: 'bing_canteen_floor_query',
      status: 'indexed_candidate',
      target_campus: task.campus_name,
      target_canteen: task.canteen_name,
      search_query: task.query,
    }))
    return {
      ...task,
      status: sources.length ? 'captured_indexed_candidates' : 'captured_no_indexed_candidates',
      search_url: searchUrl,
      sources,
    }
  } catch (error) {
    return {
      ...task,
      status: 'search_failed',
      search_url: searchUrl,
      error: error?.name === 'AbortError' ? 'request_timeout' : String(error?.message || error),
      sources: [],
    }
  } finally {
    clearTimeout(timeout)
  }
}

let cursor = 0
let completed = 0
const workers = Array.from({ length: 4 }, async (_, workerIndex) => {
  while (true) {
    const index = cursor
    cursor += 1
    if (index >= tasks.length) return
    const result = await fetchTask(tasks[index])
    state.task_results.push(result)
    const schoolState = stateBySchool.get(result.school_id)
    for (const source of result.sources) {
      const key = `${result.school_id}\n${source.url}`
      if (seenSourceKeys.has(key)) continue
      seenSourceKeys.add(key)
      schoolState.sources.push(source)
    }
    completed += 1
    state.generated_at = new Date().toISOString()
    state.summary = {
      schools: state.schools.length,
      target_canteens: tasks.length,
      completed_tasks: completed,
      candidate_urls: state.schools.reduce((sum, school) => sum + school.sources.length, 0),
      status: state.task_results.reduce((counts, row) => {
        counts[row.status] = (counts[row.status] || 0) + 1
        return counts
      }, {}),
    }
    saveChain = saveChain.then(writeAtomic)
    console.log(`[${completed}/${tasks.length}] worker=${workerIndex + 1} school=${result.school_name} canteen=${result.canteen_name} status=${result.status} candidates=${result.sources.length}`)
  }
})

await Promise.all(workers)
await saveChain
console.log(JSON.stringify(state.summary, null, 2))
