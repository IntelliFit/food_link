import { applyMergeAction, createMergeGame, getMergeHint } from '../../src/utils/pet-merge-game'

it('finds an immediately available recipe without changing board, score or seed', () => {
  const state = applyMergeAction(createMergeGame(1, 42), { type: 'start' })
  const before = JSON.stringify(state)
  const hint = getMergeHint(state)
  expect(hint?.recipeId).toBe('breakfast')
  expect(hint?.cells).toEqual([0, 10, 20])
  expect(JSON.stringify(state)).toBe(before)
  expect(getMergeHint(state)).toEqual(hint)
})
it('suggests a legal slide using the real engine and does not run while paused', () => {
  const state = applyMergeAction(createMergeGame(2, 42), { type: 'start' })
  const before = JSON.stringify(state)
  const hint = getMergeHint(state)
  expect(hint?.direction).toBeDefined()
  const next = applyMergeAction(state, { type: 'slide', direction: hint!.direction! })
  expect(next.steps).toBe(1)
  expect(next.merges).toBeGreaterThan(0)
  expect(JSON.stringify(state)).toBe(before)
  expect(getMergeHint(applyMergeAction(state, { type: 'pause' }))).toBeNull()
})
