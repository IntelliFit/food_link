import assert from 'node:assert/strict'
import test from 'node:test'

import { annotationLabelOptions, recognizedLabelOptions } from '../src/lib/photo-annotation.ts'

test('photo annotation taxonomy keeps only ranking labels', () => {
  assert.deepEqual(annotationLabelOptions.map(([value]) => value), [
    'rankable', 'snack', 'fruit', 'takeout', 'home_cooked', 'restaurant', 'beverage',
  ])
})

test('compact photo cards expose only recognized food labels', () => {
  const options: Array<['snack' | 'fruit' | 'beverage', string]> = [
    ['snack', '零食'],
    ['fruit', '水果'],
    ['beverage', '饮品'],
  ]

  assert.deepEqual(recognizedLabelOptions(['beverage'], options), [['beverage', '饮品']])
  assert.deepEqual(recognizedLabelOptions([], options), [])
})
