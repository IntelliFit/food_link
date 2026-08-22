import assert from 'node:assert/strict'
import test from 'node:test'

import { recognizedLabelOptions } from '../src/lib/photo-annotation.ts'

test('compact photo cards expose only recognized food labels', () => {
  const options: Array<['snack' | 'fruit' | 'beverage', string]> = [
    ['snack', '零食'],
    ['fruit', '水果'],
    ['beverage', '饮品'],
  ]

  assert.deepEqual(recognizedLabelOptions(['beverage'], options), [['beverage', '饮品']])
  assert.deepEqual(recognizedLabelOptions([], options), [])
})
