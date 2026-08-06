#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { extractHierarchyEvidence } from './crawl-indexed-content-evidence.mjs'

const repoRoot = path.resolve(process.argv[2] || process.cwd())
const readJson = async (relativePath) =>
  JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'))

const [orientation, floorGap, floorPdf, audit, confirmed] = await Promise.all([
  readJson('docs/campus-directory-proofreading/beijing-orientation-official-source-crawl.json'),
  readJson('docs/campus-directory-proofreading/beijing-floor-gap-official-source-crawl.json'),
  readJson('docs/campus-directory-proofreading/beijing-floor-gap-pdf-content-evidence.json'),
  readJson('docs/campus-directory-proofreading/nationwide-school-dining-audit.json'),
  readJson('docs/campus-directory-proofreading/beijing-owner-confirmed-dining-relations.json'),
])

const outputPath = path.join(
  repoRoot,
  'docs',
  'campus-directory-proofreading',
  'beijing-campus-dining-gap-auto-review.json',
)
const beijingCodes = new Set(orientation.schools.map((school) => school.official_code))
const auditSchools = audit.schools.filter((school) => beijingCodes.has(school.official_code))
const auditByCode = new Map(auditSchools.map((school) => [school.official_code, school]))
const confirmedCodes = new Set(confirmed.schools.map((school) => school.official_code))
const noCanteenCodes = new Set(
  auditSchools
    .filter((school) => !(school.active_canteen_count || 0) && !confirmedCodes.has(school.official_code))
    .map((school) => school.official_code),
)

const normalizeName = (value) =>
  String(value || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/(?:地下一层|负一层|一楼|二楼|三楼|四楼|五楼|一层|二层|三层|四层|五层|B1|B2)$/gi, '')
    .replace(/[\s·、，,。:：]/g, '')
    .toLowerCase()

const activeCanteensByCode = new Map(
  auditSchools.map((school) => [
    school.official_code,
    (school.canteens || [])
      .filter((canteen) => canteen.status === 'active')
      .map((canteen) => ({
        name: canteen.name,
        campus_name: canteen.campus_name || '',
        normalized: normalizeName(canteen.name),
        existing_floor: canteen.building_or_floor || '',
      })),
  ]),
)

const sources = []
for (const school of orientation.schools) {
  if (!noCanteenCodes.has(school.official_code)) continue
  for (const source of school.sources || []) {
    if (source.status !== 'candidate_evidence') continue
    sources.push({
      school_id: school.school_id,
      official_code: school.official_code,
      school_name: school.name,
      collection_stage: 'no_active_canteen',
      source_kind: 'official_web',
      url: source.url,
      text: source.evidence_excerpt || '',
    })
  }
}
for (const school of floorGap.schools) {
  for (const source of school.sources || []) {
    if (source.status !== 'candidate_evidence') continue
    sources.push({
      school_id: school.school_id,
      official_code: school.official_code,
      school_name: school.name,
      collection_stage: 'missing_floor',
      source_kind: 'official_web',
      url: source.url,
      text: source.evidence_excerpt || '',
    })
  }
}
for (const source of floorPdf.sources || []) {
  if (!['candidate_evidence', 'dining_tokens_only'].includes(source.status)) continue
  sources.push({
    school_id: source.school_id,
    official_code: source.official_code,
    school_name: source.school_name,
    collection_stage: noCanteenCodes.has(source.official_code) ? 'no_active_canteen' : 'missing_floor',
    source_kind: 'official_pdf',
    url: source.url,
    text: source.text || '',
  })
}

const relationKeys = new Set()
const relations = []
const unresolved = []
for (const source of sources) {
  const extracted = extractHierarchyEvidence(source.text, source.school_name)
  for (const relation of extracted.hierarchy_candidates) {
    const key = [
      source.official_code,
      normalizeName(relation.canteen),
      relation.floor || '',
      relation.window || '',
      source.url,
    ].join('|')
    if (relationKeys.has(key)) continue
    relationKeys.add(key)
    const active = activeCanteensByCode.get(source.official_code) || []
    const relationName = normalizeName(relation.canteen)
    const exact = active.find((canteen) =>
      canteen.normalized === relationName ||
      (canteen.normalized.length >= 4 && relationName.includes(canteen.normalized)) ||
      (relationName.length >= 4 && canteen.normalized.includes(relationName)),
    )
    const stableWindow = relation.window
      ? /^\d+号(?:窗口|档口)$/.test(relation.window) ||
        (/^[\u3400-\u9fffA-Za-z0-9·]{2,12}(?:窗口|档口)$/.test(relation.window) &&
          !/(?:为|至|的|食堂|改造|基本伙|风味|特色|服务)/.test(relation.window))
      : false
    const possibleSupplierAddressFloor =
      /供应商地址|中标信息/.test(relation.evidence_excerpt || '') &&
      /中标|采购|外包/.test(relation.evidence_excerpt || '')
    let review_status = 'agent_review_required'
    let review_reason = '候选食堂尚未和现有目录名称安全匹配'
    if (possibleSupplierAddressFloor) {
      review_status = 'agent_review_required'
      review_reason = '楼层可能来自供应商地址或中标信息，不能绑定到学校食堂'
    } else if (source.collection_stage === 'no_active_canteen' && relation.floor) {
      review_status = 'safe_new_canteen_candidate'
      review_reason = '学校当前无已发布食堂，官方同段文本直接给出食堂与楼层'
    } else if (exact && relation.floor && !exact.existing_floor) {
      review_status = 'safe_existing_floor_candidate'
      review_reason = '官方同段文本直接给出现有食堂与楼层，可补齐空白楼层'
    } else if (exact && relation.floor && exact.existing_floor) {
      review_status = 'already_covered_or_conflict_check'
      review_reason = '现有目录已有楼层，需要核对是否重复或冲突'
    }
    relations.push({
      ...source,
      ...relation,
      matched_existing_canteen: exact?.name || '',
      matched_existing_campus: exact?.campus_name || '',
      existing_floor: exact?.existing_floor || '',
      stable_window_candidate: Boolean(stableWindow),
      review_status,
      review_reason,
      owner_action_required: false,
    })
  }
  for (const passage of extracted.unresolved_passages) {
    unresolved.push({
      ...source,
      ...passage,
      owner_action_required: false,
      next_action: '继续自动复核，不交给产品负责人',
    })
  }
}

const countBy = (rows, field) =>
  rows.reduce((result, row) => {
    const value = row[field] || 'blank'
    result[value] = (result[value] || 0) + 1
    return result
  }, {})

const output = {
  generated_at: new Date().toISOString(),
  scope: '北京剩余食堂与楼层缺口自动复核；所有结果仅为待审核候选，不写数据库',
  summary: {
    no_canteen_target_schools: noCanteenCodes.size,
    floor_gap_target_schools: floorGap.schools.length,
    reviewed_sources: sources.length,
    extracted_relations: relations.length,
    safe_new_canteen_candidates: relations.filter((row) => row.review_status === 'safe_new_canteen_candidate').length,
    safe_existing_floor_candidates: relations.filter((row) => row.review_status === 'safe_existing_floor_candidate').length,
    already_covered_or_conflict_check: relations.filter((row) => row.review_status === 'already_covered_or_conflict_check').length,
    agent_review_required: relations.filter((row) => row.review_status === 'agent_review_required').length,
    stable_window_candidates: relations.filter((row) => row.stable_window_candidate).length,
    unresolved_passages: unresolved.length,
    relation_status: countBy(relations, 'review_status'),
  },
  relations,
  unresolved_passages: unresolved,
}

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(output.summary, null, 2))
