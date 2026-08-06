import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractResults,
  parseArgs,
} from './crawl-beijing-wechat-public-index.mjs'

test('dining-platform query mode is parsed without changing safety defaults', () => {
  const options = parseArgs(['--query-mode', 'dining-platform'])
  assert.equal(options.queryMode, 'dining-platform')
  assert.equal(options.concurrency, 1)
  assert.equal(options.force, false)
})

test('exact school evidence from a dining platform account is retained and classified', () => {
  const html = `
    <li>
      <div class="img-box"><img src="/proxy?url=https%3A%2F%2Fexample.com%2Fcover.jpg"></div>
      <div class="txt-box">
        <h3><a href="/link?url=abc">北京航空航天大学食堂服务指南</a></h3>
        <p class="txt-info">沙河校区学生食堂一层窗口开放安排</p>
        <span class="all-time-y2">北航后勤</span>
      </div>
    </li>`
  const rows = extractResults(
    html,
    { name: '北京航空航天大学' },
    8,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].account_name, '北航后勤')
  assert.equal(rows[0].dining_platform_account_candidate, true)
  assert.equal(
    rows[0].account_classification,
    'school_dining_platform_account_candidate',
  )
})

test('result without the exact school name is not accepted from an alias alone', () => {
  const html = `
    <li>
      <div class="txt-box">
        <h3><a href="/link?url=abc">校园食堂服务指南</a></h3>
        <p class="txt-info">沙河校区学生食堂一层窗口开放安排</p>
        <span class="all-time-y2">北航后勤</span>
      </div>
    </li>`
  const rows = extractResults(
    html,
    { name: '北京航空航天大学' },
    8,
  )
  assert.equal(rows.length, 0)
})
