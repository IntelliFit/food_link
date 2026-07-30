import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSearchUrl,
  normalizeSearchResults,
  parseArgs,
  selectTasks,
  shouldStopBatch,
  summarizeState,
  upsertCapture,
} from './crawl-xiaohongshu-campus-dining.mjs'

const queue = {
  schools: [
    {
      school_id: 'school-1',
      official_code: '4111000001',
      name: '示例学院',
      province: '北京市',
      queries: [
        { query_id: 'school-1:xiaohongshu-overview', query: '示例学院 食堂', purpose: '总览' },
        { query_id: 'school-1:xiaohongshu-floors', query: '示例学院 食堂 楼层', purpose: '楼层' },
        { query_id: 'school-1:xiaohongshu-windows', query: '示例学院 食堂 窗口', purpose: '窗口' },
      ],
    },
  ],
}

test('parseArgs validates query kinds and clamps concurrency', () => {
  const options = parseArgs([
    '--dry-run',
    '--query-kinds', 'overview,floors',
    '--concurrency', '9',
    '--manual-recovery-timeout-ms', '1800000',
  ], 'D:/food_link')
  assert.deepEqual(options.queryKinds, ['overview', 'floors'])
  assert.equal(options.concurrency, 4)
  assert.equal(options.manualRecoveryTimeoutMs, 1800000)
  assert.throws(() => parseArgs(['--dry-run', '--query-kinds', 'notes']), /仅支持/)
})

test('selectTasks skips completed work and retries failures', () => {
  const state = {
    schools: [
      {
        school_id: 'school-1',
        sources: [
          { query_id: 'school-1:xiaohongshu-overview', status: 'captured_search_results' },
          { query_id: 'school-1:xiaohongshu-floors', status: 'capture_failed' },
        ],
      },
    ],
  }
  const options = { queryKinds: ['overview', 'floors', 'windows'], province: '', excludeProvinces: [], schoolCodes: [], auditStatuses: [], force: false, retryFailures: true, limit: 0 }
  assert.deepEqual(selectTasks(queue, state, options).map((task) => task.kind), ['floors', 'windows'])
  assert.deepEqual(selectTasks(queue, state, { ...options, retryFailures: false }).map((task) => task.kind), ['windows'])
})

test('legacy ambiguous no-result captures are retried', () => {
  const state = {
    schools: [{ school_id: 'school-1', sources: [{ query_id: 'school-1:xiaohongshu-overview', status: 'captured_no_results' }] }],
  }
  const options = {
    queryKinds: ['overview'], province: '', excludeProvinces: [], schoolCodes: [], auditStatuses: [],
    force: false, retryFailures: true, limit: 0,
  }
  assert.equal(selectTasks(queue, state, options).length, 1)
})

test('selectTasks supports province, school code, and audit status filters', () => {
  const filteredQueue = {
    schools: [
      { ...queue.schools[0], audit_status: 'not_started' },
      {
        ...queue.schools[0],
        school_id: 'school-2',
        official_code: '4112000002',
        name: '天津示例学院',
        province: '天津市',
        audit_status: 'source_backed_partial',
        queries: [{ query_id: 'school-2:xiaohongshu-overview', query: '天津示例学院 食堂' }],
      },
    ],
  }
  const options = {
    queryKinds: ['overview'], province: '天津市', excludeProvinces: [], schoolCodes: ['4112000002'], auditStatuses: ['source_backed_partial'],
    force: false, retryFailures: true, limit: 0,
  }
  const tasks = selectTasks(filteredQueue, { schools: [] }, options)
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].schoolName, '天津示例学院')
})

test('selectTasks can exclude completed provinces', () => {
  const options = {
    queryKinds: ['overview'], province: '', excludeProvinces: ['北京市'], schoolCodes: [], auditStatuses: [],
    force: false, retryFailures: true, limit: 0,
  }
  assert.equal(selectTasks(queue, { schools: [] }, options).length, 0)
})

test('upsertCapture replaces one query without deleting sibling evidence', () => {
  const state = { schools: [] }
  const task = {
    schoolId: 'school-1',
    officialCode: '4111000001',
    schoolName: '示例学院',
    province: '北京市',
    query_id: 'school-1:xiaohongshu-overview',
  }
  upsertCapture(state, task, { query_id: task.query_id, status: 'capture_failed' })
  upsertCapture(state, task, { query_id: task.query_id, status: 'captured_search_results' })
  assert.equal(state.schools.length, 1)
  assert.equal(state.schools[0].sources.length, 1)
  assert.equal(state.schools[0].sources[0].status, 'captured_search_results')
  assert.deepEqual(summarizeState(state).status, { captured_search_results: 1 })
})

test('normalizeSearchResults deduplicates URLs and limits text', () => {
  const rows = [
    { url: 'https://www.xiaohongshu.com/search_result/one', title: '  第一篇  ', author: '甲', visible_text: 'a'.repeat(1300) },
    { url: 'https://www.xiaohongshu.com/search_result/one', title: '重复' },
    { url: 'https://www.xiaohongshu.com/search_result/two', title: '第二篇', author: '乙' },
  ]
  const results = normalizeSearchResults(rows, 2)
  assert.equal(results.length, 2)
  assert.equal(results[0].rank, 1)
  assert.equal(results[0].title, '第一篇')
  assert.ok(results[0].visible_text.endsWith('…'))
})

test('buildSearchUrl preserves the literal Chinese query', () => {
  const url = new URL(buildSearchUrl('北京经贸职业学院 食堂'))
  assert.equal(url.searchParams.get('keyword'), '北京经贸职业学院 食堂')
  assert.equal(url.searchParams.get('type'), '51')
})

test('login and safety states stop the unattended batch', () => {
  assert.equal(shouldStopBatch('login_required'), true)
  assert.equal(shouldStopBatch('unreadable'), true)
  assert.equal(shouldStopBatch('capture_failed'), false)
  assert.equal(shouldStopBatch('captured_search_results'), false)
})
