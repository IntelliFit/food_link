import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBingSearchUrl,
  buildCombinedQuery,
  classifyPlatform,
  classifySearchResponse,
  extractIndexedPublicResults,
  parseArgs,
  selectSchools,
  summarizeState,
  upsertSchoolResult,
} from './crawl-indexed-social-campus-dining.mjs'

const queue = {
  schools: [
    {
      school_id: 'school-1',
      official_code: '4111000001',
      name: '示例学院',
      province: '北京市',
      audit_status: 'not_started',
    },
    {
      school_id: 'school-2',
      official_code: '4123000002',
      name: '第二学院',
      province: '黑龙江省',
      audit_status: 'source_backed_partial',
    },
  ],
}

const defaultSelectionOptions = {
  province: '',
  excludeProvinces: [],
  schoolCodes: [],
  auditStatuses: [],
  force: false,
  retryFailures: true,
  limit: 0,
}

test('builds one combined indexed query per school', () => {
  const query = buildCombinedQuery('示例学院')
  assert.doesNotMatch(query, /site:xiaohongshu/)
  assert.match(query, /"示例学院"/)
  assert.match(query, /食堂$/)
  const url = new URL(buildBingSearchUrl(query))
  assert.equal(url.hostname, 'cn.bing.com')
  assert.equal(url.searchParams.get('q'), query)
})

test('parseArgs validates numeric settings and clamps concurrency', () => {
  const options = parseArgs([
    '--dry-run',
    '--concurrency', '20',
    '--request-delay-ms', '900',
    '--block-threshold', '3',
  ], 'D:/food_link')
  assert.equal(options.concurrency, 8)
  assert.equal(options.requestDelayMs, 900)
  assert.equal(options.blockThreshold, 3)
  assert.throws(() => parseArgs(['--limit', '-1']), /非负整数/)
})

test('extracts exact-school dining results and classifies public platforms', () => {
  const target = 'https://www.xiaohongshu.com/explore/abc123'
  const encoded = `a1${Buffer.from(target).toString('base64url')}`
  const html = `
    <ol>
      <li class="b_algo">
        <h2><a href="${target}?xsec_token=discarded">示例学院第一食堂</a></h2>
        <div><p>示例学院食堂共有三层，还有清真窗口。</p></div>
      </li>
      <li class="b_algo">
        <h2><a href="https://www.bing.com/ck/a?u=${encoded}">重复链接</a></h2>
      </li>
      <li class="b_algo">
        <h2><a href="https://mp.weixin.qq.com/s/def456">示例学院第二食堂</a></h2>
        <p>示例学院迎新餐厅指南</p>
      </li>
      <li class="b_algo">
        <h2><a href="https://example.com/other">另一所学院食堂</a></h2>
        <p>与示例学院无关的结果</p>
      </li>
    </ol>
  `
  const results = extractIndexedPublicResults(html, '示例学院', 12)
  assert.equal(results.length, 2)
  assert.equal(results[0].url, target)
  assert.equal(results[0].exact_school_name_in_text, true)
  assert.equal(results[0].platform, 'xiaohongshu')
  assert.equal(results[1].url, 'https://mp.weixin.qq.com/s/def456')
  assert.equal(results[1].platform, 'wechat_official_account')
  assert.equal(classifyPlatform('https://www.zhihu.com/question/1'), 'zhihu')
})

test('selectSchools resumes by school and supports filters', () => {
  const state = {
    schools: [
      { school_id: 'school-1', status: 'captured_no_indexed_candidates' },
    ],
  }
  const selected = selectSchools(queue, state, {
    ...defaultSelectionOptions,
    province: '黑龙江省',
    schoolCodes: ['4123000002'],
    auditStatuses: ['source_backed_partial'],
  })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].schoolId, 'school-2')
  assert.match(selected[0].queryId, /indexed-public-combined-v1$/)
})

test('selectSchools retries failures unless disabled', () => {
  const state = { schools: [{ school_id: 'school-1', status: 'search_failed' }] }
  assert.equal(selectSchools(queue, state, defaultSelectionOptions).length, 2)
  assert.equal(selectSchools(queue, state, { ...defaultSelectionOptions, retryFailures: false }).length, 1)
})

test('classifies access restrictions before parsing results', () => {
  assert.equal(classifySearchResponse(429, ''), 'blocked')
  assert.equal(classifySearchResponse(200, '请输入验证码'), 'blocked')
  assert.equal(classifySearchResponse(500, ''), 'failed')
  assert.equal(classifySearchResponse(200, '<html>results</html>'), 'ok')
})

test('upsert replaces one school and refreshes summary', () => {
  const state = { schools: [] }
  upsertSchoolResult(state, {
    school_id: 'school-1',
    status: 'search_failed',
    candidate_count: 0,
  })
  upsertSchoolResult(state, {
    school_id: 'school-1',
    status: 'captured_indexed_candidates',
    candidate_count: 2,
  })
  assert.equal(state.schools.length, 1)
  assert.deepEqual(summarizeState(state), {
    schools: 1,
    candidates: 2,
    status: { captured_indexed_candidates: 1 },
  })
})
