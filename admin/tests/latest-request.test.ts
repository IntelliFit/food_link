import assert from 'node:assert/strict'
import test from 'node:test'

import { createLatestRequestGate } from '../src/lib/latest-request.ts'

test('only the latest photo filter request may update the list', async () => {
  const gate = createLatestRequestGate()
  const first = gate.begin()
  const second = gate.begin()

  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, false)
  assert.equal(gate.isLatest(first.id), false)
  assert.equal(gate.isLatest(second.id), true)

  gate.dispose()
  assert.equal(second.signal.aborted, true)
  assert.equal(gate.isLatest(second.id), false)
})
