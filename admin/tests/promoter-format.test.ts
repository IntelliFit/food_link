import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRateInput, promoterStatusActions, ratePercent, yuan } from '../src/lib/promoter-format.ts'

test('formats signed yuan amounts', () => {
  assert.equal(yuan(398), '¥3.98')
  assert.equal(yuan(-3000), '-¥30.00')
  assert.equal(yuan(0), '¥0.00')
})

test('shows rates with the default when no override is set', () => {
  assert.equal(ratePercent(null), '20%')
  assert.equal(ratePercent(1250), '12.5%')
  assert.equal(ratePercent(1234), '12.34%')
})

test('parses rate input into basis points', () => {
  assert.equal(parseRateInput(''), null)
  assert.equal(parseRateInput(' 25 '), 2500)
  assert.equal(parseRateInput('12.5%'), 1250)
  assert.equal(parseRateInput('100'), 10000)
  assert.equal(parseRateInput('101'), undefined)
  assert.equal(parseRateInput('-1'), undefined)
  assert.equal(parseRateInput('abc'), undefined)
  assert.equal(parseRateInput('1.234'), undefined)
})

test('offers only the status changes the backend allows', () => {
  assert.deepEqual(promoterStatusActions('active').map((a) => a.target), ['suspended', 'terminated'])
  assert.deepEqual(promoterStatusActions('suspended').map((a) => a.target), ['active', 'terminated'])
  assert.deepEqual(promoterStatusActions('terminated'), [])
  assert.deepEqual(promoterStatusActions('pending_review'), [])
})
