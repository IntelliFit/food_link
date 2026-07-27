import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractHierarchyEvidence,
  htmlToVisibleText,
  parseArgs,
  selectTasks,
  summarizeState,
  upsertSourceResult,
} from './crawl-indexed-content-evidence.mjs'

test('parseArgs validates and clamps worker settings', () => {
  const options = parseArgs([
    '--dry-run',
    '--concurrency', '20',
    '--per-host-delay-ms', '1500',
    '--limit', '0',
  ], 'D:/food_link')
  assert.equal(options.concurrency, 8)
  assert.equal(options.perHostDelayMs, 1500)
  assert.equal(options.limit, 0)
  assert.throws(() => parseArgs(['--request-timeout-ms', '0']), /正整数/)
})

test('htmlToVisibleText removes scripts and preserves passage boundaries', () => {
  const text = htmlToVisibleText('<div>示例大学第一食堂一层</div><script>错误食堂</script><p>清真窗口</p>')
  assert.match(text, /示例大学第一食堂一层\n清真窗口/)
  assert.doesNotMatch(text, /错误食堂/)
})

test('extractHierarchyEvidence creates only same-passage single-parent relations', () => {
  const text = [
    '示例大学第一食堂一层设有清真窗口。',
    '第二食堂和第三食堂位于二层，设有面食窗口。',
    '四层另有民族窗口。',
  ].join('')
  const evidence = extractHierarchyEvidence(text, '示例大学')
  assert.ok(evidence.canteen_candidates.some((item) => item.endsWith('第一食堂')))
  assert.deepEqual(evidence.stable_canteen_candidates, ['第一食堂'])
  assert.ok(evidence.stable_window_candidates.includes('清真窗口'))
  assert.ok(evidence.hierarchy_candidates.some((item) => item.relation_type === 'canteen_floor'))
  assert.ok(evidence.hierarchy_candidates.some((item) => item.relation_type === 'canteen_floor_window'))
  assert.ok(evidence.hierarchy_candidates.every((item) => item.review_status === 'pending_manual_review'))
  assert.ok(evidence.unresolved_passages.some((item) => item.reason === 'missing_stable_canteen_parent'))
})

test('narrative fragments never become hierarchy parents or named windows', () => {
  const evidence = extractHierarchyEvidence(
    '中餐低价菜1.5元每份）食堂一楼不少于5种，二楼不少于3种。天鲜配食堂不仅开设有大窗口。',
    '示例大学',
  )
  assert.equal(evidence.hierarchy_candidates.length, 0)
  assert.ok(evidence.canteen_candidates.length > 0)
  assert.deepEqual(evidence.stable_window_candidates, [])
})

test('embedded floor binds only to the adjacent canteen instead of every floor in a passage', () => {
  const evidence = extractHierarchyEvidence(
    '河东 1层经济，2层清真餐厅。一楼中点、面条、快餐，二楼自选、小炒、煲仔饭，三楼教师餐厅。',
    '示例大学',
  )
  assert.ok(evidence.hierarchy_candidates.some((item) => item.canteen === '清真餐厅' && item.floor === '2层'))
  assert.ok(evidence.hierarchy_candidates.some((item) => item.canteen === '教师餐厅' && item.floor === '三楼'))
  assert.ok(evidence.hierarchy_candidates.every((item) => !(item.canteen === '清真餐厅' && item.floor === '1层')))
  assert.ok(evidence.hierarchy_candidates.every((item) => !(item.canteen === '教师餐厅' && ['一楼', '二楼'].includes(item.floor))))
})

test('floor-count wording is not treated as a concrete floor relation', () => {
  const evidence = extractHierarchyEvidence(
    '二食堂共有两层，一层主要有营养早餐，二层提供风味小吃。',
    '示例大学',
  )
  const floors = evidence.hierarchy_candidates
    .filter((item) => item.canteen === '二食堂' && item.relation_type === 'canteen_floor')
    .map((item) => item.floor)
  assert.deepEqual(floors, ['一层', '二层'])
})

test('procurement addresses and narrative dining phrases never create hierarchy', () => {
  const evidence = extractHierarchyEvidence(
    [
      '山东石油化工学院2026年食堂鲜肉采购项目在企业公馆B1号楼获取招标文件。',
      '当天食堂生意很好，周到君到达时只剩2个档口开放。',
      '坐在窗口抬头见绿，模式堪比宜家餐厅。',
    ].join(''),
    '山东石油化工学院',
  )
  assert.equal(evidence.hierarchy_candidates.length, 0)
})

test('list tails and combined window names stay unresolved', () => {
  const evidence = extractHierarchyEvidence(
    '学府食堂一楼设有五谷渔粉、滑蛋饭、特色牛肉面等特色档口，二楼有米线窗口、毛毛肉香锅和无碘盐窗口。',
    '示例大学',
  )
  assert.ok(evidence.stable_window_candidates.includes('米线窗口'))
  assert.ok(!evidence.stable_window_candidates.some((item) => item.includes('等特色档口')))
  assert.ok(!evidence.stable_window_candidates.some((item) => item.includes('和无碘盐窗口')))
})

test('floor descriptors are removed from distinctive canteen names', () => {
  const evidence = extractHierarchyEvidence(
    '益新二层茶餐厅。山明一层智慧餐厅。三四楼为秋林阁餐厅。西部一楼餐厅。',
    '示例大学',
  )
  assert.ok(evidence.stable_canteen_candidates.includes('益新茶餐厅'))
  assert.ok(evidence.stable_canteen_candidates.includes('山明智慧餐厅'))
  assert.ok(evidence.stable_canteen_candidates.includes('秋林阁餐厅'))
  assert.ok(evidence.stable_canteen_candidates.includes('西部餐厅'))
  assert.ok(evidence.hierarchy_candidates.some((item) => item.canteen === '秋林阁餐厅' && item.floor === '三楼'))
  assert.ok(evidence.hierarchy_candidates.some((item) => item.canteen === '秋林阁餐厅' && item.floor === '四楼'))
})

test('selectTasks resumes per URL and retries only retryable states', () => {
  const input = {
    schools: [{
      school_id: 'school-1',
      official_code: '4111000001',
      name: '示例大学',
      province: '北京市',
      sources: [
        { url: 'https://example.edu.cn/one', status: 'indexed_candidate' },
        { url: 'https://example.edu.cn/two', status: 'indexed_candidate' },
      ],
    }],
  }
  const state = {
    schools: [{
      school_id: 'school-1',
      sources: [
        { url: 'https://example.edu.cn/one', status: 'candidate_tokens_only' },
        { url: 'https://example.edu.cn/two', status: 'fetch_failed' },
      ],
    }],
  }
  const options = { province: '', schoolCodes: [], force: false, retryFailures: true, limit: 0 }
  assert.deepEqual(selectTasks(input, state, options).map((task) => task.url), ['https://example.edu.cn/two'])
  assert.equal(selectTasks(input, state, { ...options, retryFailures: false }).length, 0)
})

test('upsert replaces one URL without deleting sibling evidence', () => {
  const state = { schools: [] }
  const task = {
    schoolId: 'school-1',
    officialCode: '4111000001',
    schoolName: '示例大学',
    province: '北京市',
    auditStatus: 'not_started',
    url: 'https://example.edu.cn/one',
  }
  upsertSourceResult(state, task, { url: task.url, status: 'fetch_failed' })
  upsertSourceResult(state, task, {
    url: task.url,
    status: 'candidate_hierarchy_evidence',
    hierarchy_candidates: [{ canteen: '第一食堂', floor: '一层' }],
    unresolved_passages: [],
  })
  assert.equal(state.schools.length, 1)
  assert.equal(state.schools[0].sources.length, 1)
  assert.deepEqual(summarizeState(state), {
    schools: 1,
    sources: 1,
    hierarchy_candidates: 1,
    unresolved_passages: 0,
    status: { candidate_hierarchy_evidence: 1 },
  })
})
