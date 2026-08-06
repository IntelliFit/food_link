#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { extractHierarchyEvidence } from './crawl-indexed-content-evidence.mjs'

const repoRoot = path.resolve(process.argv[2] || process.cwd())
const crawlPath = path.join(repoRoot, 'docs', 'campus-directory-proofreading', 'beijing-orientation-official-source-crawl.json')
const pdfPath = path.join(repoRoot, 'docs', 'campus-directory-proofreading', 'beijing-orientation-pdf-content-evidence.json')
const auditPath = path.join(repoRoot, 'docs', 'campus-directory-proofreading', 'nationwide-school-dining-audit.json')
const outputPath = path.join(repoRoot, 'docs', 'campus-directory-proofreading', 'beijing-orientation-auto-review.json')

const [crawl, pdfEvidence, audit] = await Promise.all(
  [crawlPath, pdfPath, auditPath].map(async (file) => JSON.parse(await fs.readFile(file, 'utf8'))),
)

const ownerSchools = new Set(['北京联合大学', '首都医科大学'])
const schoolById = new Map(crawl.schools.map((school) => [school.school_id, school]))
const auditById = new Map(audit.schools.filter((school) => school.province === '北京市').map((school) => [school.school_id, school]))

function sourceRows() {
  const rows = []
  for (const school of crawl.schools) {
    for (const source of school.sources ?? []) {
      if (source.status !== 'candidate_evidence') continue
      rows.push({
        school_id: school.school_id,
        official_code: school.official_code,
        school_name: school.name,
        source_kind: 'official_web',
        url: source.url,
        title: source.title ?? '',
        text: source.evidence_excerpt ?? '',
      })
    }
  }
  for (const source of pdfEvidence.sources ?? []) {
    if (!['candidate_evidence', 'dining_tokens_only'].includes(source.status)) continue
    rows.push({
      school_id: source.school_id,
      official_code: source.official_code,
      school_name: source.school_name,
      source_kind: 'official_pdf',
      url: source.url,
      title: '官方 PDF',
      text: source.text ?? '',
    })
  }
  return rows
}

function relationReview(relation, source) {
  const canteen = relation.canteen ?? ''
  const window = relation.window ?? ''
  const excerpt = relation.evidence_excerpt ?? ''
  const noiseReason = [
    [/运动场馆|多功能运动场馆|体育教学/, '楼层已改作运动空间，不是餐饮楼层'],
    [/供应商地址|供应商名称|中标信息/, '楼层来自供应商地址，不属于食堂'],
    [/一起去大食堂|唯一的食堂|食堂或三层餐厅/, '食堂名称是叙述性泛称'],
    [/进行修缮改造做为|改造后的食堂|位于馨园食堂/, '抽取名称包含动作或位置前缀'],
    [/餐厅的开业弥补|校友们前往|学生会联合组织/, '抽取名称包含叙述性前缀'],
  ].find(([pattern]) => pattern.test(`${canteen} ${excerpt}`))?.[1]
  if (noiseReason) return { status: '已排除噪声', reason: noiseReason, publishable: false }
  if (window && (/^(?:号窗口|为风味档口|至三层为基本伙档口|改造后的食堂窗口)$/.test(window) || /^(?:风味|特色|服务)窗口$/.test(window))) {
    return { status: '已排除噪声', reason: '窗口名称不稳定或缺少编号', publishable: false }
  }
  if (/cupk\.edu\.cn\/.*2017/.test(source.url)) {
    return { status: '我继续复核', reason: '关系明确但来源较早，需要确认现行运营', publishable: false }
  }
  if (relation.relation_type === 'canteen_window_floor_unresolved') {
    return { status: '我继续复核', reason: '窗口尚未绑定到明确楼层', publishable: false }
  }
  return {
    status: '官方关系已闭合',
    reason: '完整校名、官方来源及同段父子关系均明确',
    publishable: true,
  }
}

const reviewedRelations = []
const unresolved = []
const relationKeys = new Set()
for (const source of sourceRows()) {
  const extracted = extractHierarchyEvidence(source.text, source.school_name)
  for (const relation of extracted.hierarchy_candidates) {
    const key = [source.school_id, relation.canteen, relation.floor, relation.window, source.url].join('\n')
    if (relationKeys.has(key)) continue
    relationKeys.add(key)
    const review = relationReview(relation, source)
    reviewedRelations.push({
      school_id: source.school_id,
      official_code: source.official_code,
      school_name: source.school_name,
      source_kind: source.source_kind,
      source_title: source.title,
      url: source.url,
      ...relation,
      agent_status: review.status,
      agent_reason: review.reason,
      publishable_after_controlled_review: review.publishable,
      owner_action_required: false,
    })
  }
  for (const passage of extracted.unresolved_passages) {
    unresolved.push({
      school_id: source.school_id,
      official_code: source.official_code,
      school_name: source.school_name,
      source_kind: source.source_kind,
      url: source.url,
      ...passage,
      owner_action_required: false,
      next_action: '由代理继续补采或复核，不要求产品负责人现在处理',
    })
  }
}

const relationSchools = new Set(reviewedRelations.filter((row) => row.agent_status !== '已排除噪声').map((row) => row.school_id))
const unresolvedSchools = new Set(unresolved.map((row) => row.school_id))
const schoolSummary = crawl.schools
  .map((school) => {
    const auditSchool = auditById.get(school.school_id)
    let owner_state
    let next_action
    if (ownerSchools.has(school.name)) {
      owner_state = '必须你确认'
      next_action = school.name === '北京联合大学'
        ? '确认四层餐饮楼的现行正式名称'
        : '确认现行餐厅清单，并把楼层和7号窗口绑定到正式父食堂'
    } else if (relationSchools.has(school.school_id)) {
      owner_state = '无需你现在操作'
      next_action = '已有官方父子关系，由代理继续受控复核'
    } else if (school.status === 'pending_manual_review' || unresolvedSchools.has(school.school_id)) {
      owner_state = '无需你现在操作'
      next_action = '已有候选但关系未闭合，由代理继续复核'
    } else {
      owner_state = '无需你现在操作'
      next_action = '当前无可发布关系，继续自动补采'
    }
    return {
      school_id: school.school_id,
      official_code: school.official_code,
      school_name: school.name,
      audit_status: school.audit_status,
      crawl_status: school.status,
      existing_active_canteens: auditSchool?.active_canteen_count ?? 0,
      source_count: (school.sources ?? []).length,
      candidate_source_count: (school.sources ?? []).filter((source) => source.status === 'candidate_evidence').length,
      reviewed_relation_count: reviewedRelations.filter((row) => row.school_id === school.school_id && row.agent_status !== '已排除噪声').length,
      unresolved_count: unresolved.filter((row) => row.school_id === school.school_id).length,
      owner_state,
      next_action,
    }
  })
  .sort((left, right) => left.official_code.localeCompare(right.official_code))

const statusCounts = (items, field) => items.reduce((result, item) => {
  const value = item[field]
  result[value] = (result[value] ?? 0) + 1
  return result
}, {})

const output = {
  generated_at: new Date().toISOString(),
  scope: '北京92所高校官网与官方PDF自动初审；仅供审核，不写数据库',
  summary: {
    schools: schoolSummary.length,
    owner_required_schools: schoolSummary.filter((school) => school.owner_state === '必须你确认').length,
    owner_not_required_now: schoolSummary.filter((school) => school.owner_state !== '必须你确认').length,
    reviewed_relations: reviewedRelations.length,
    publishable_relations_after_controlled_review: reviewedRelations.filter((row) => row.publishable_after_controlled_review).length,
    excluded_noise_relations: reviewedRelations.filter((row) => row.agent_status === '已排除噪声').length,
    agent_followup_relations: reviewedRelations.filter((row) => row.agent_status === '我继续复核').length,
    unresolved_passages: unresolved.length,
    pdf_sources: pdfEvidence.summary?.sources ?? 0,
    pdf_status: pdfEvidence.summary?.status ?? {},
    school_owner_state: statusCounts(schoolSummary, 'owner_state'),
  },
  schools: schoolSummary,
  reviewed_relations: reviewedRelations,
  unresolved_passages: unresolved,
  pdf_sources: pdfEvidence.sources ?? [],
}

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(output.summary, null, 2))
