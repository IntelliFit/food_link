import {
  MERGE_LEVELS, MERGE_RECIPES, applyMergeAction, createMergeGame, exportMergeCheckpoint,
  getAvailableMergeRecipes, getMergePreview, getRecipeCells, isMergeBlocked, mergeLevelFor,
  type MergeCategory, type MergeDirection, type MergeGameState, type MergeTile,
} from '../../src/utils/pet-merge-game'

const start = (level = 1, seed?: number) => applyMergeAction(createMergeGame(level, seed), { type: 'start' })
function submit(state: MergeGameState, recipeId: string): MergeGameState {
  const recipe = MERGE_RECIPES.find(item => item.id === recipeId)!
  const cells = getRecipeCells(state, recipe)
  expect(cells).not.toBeNull()
  state = applyMergeAction(state, { type: 'choose-recipe', recipeId })
  for (const cell of cells!) state = applyMergeAction(state, { type: 'toggle-cell', cell })
  return applyMergeAction(state, { type: 'submit' })
}
function fixture(items: [number, MergeCategory, number][], level = 1): MergeGameState {
  const state = start(level)
  return { ...state,
    board: Array.from({ length: 25 }, (_, cell) => {
      const item = items.find(([index]) => index === cell)
      return item ? { id: `fixture-${cell}`, category: item[1], rank: item[2] } : null
    }), nextTileId: 100 }
}
function playNormalRoute(levelId: number): MergeGameState {
  let state = start(levelId)
  const level = mergeLevelFor(levelId)
  while (state.status === 'running') {
    const ready = getAvailableMergeRecipes(state).find(recipe => getRecipeCells(state, recipe))
    if (ready) { state = submit(state, ready.id); continue }
    const candidates = (['left', 'down', 'right', 'up'] as MergeDirection[]).map(direction => applyMergeAction(state, { type: 'slide', direction })).filter(next => next !== state)
    expect(candidates.length).toBeGreaterThan(0)
    const utility = (next: MergeGameState) => {
      if (next.result?.completed) return 100000
      const remaining = getAvailableMergeRecipes(next)
      const complete = remaining.filter(recipe => getRecipeCells(next, recipe)).length
      const useful = remaining.reduce((sum, recipe) => sum + recipe.requirements.filter(requirement => next.board.some(tile => tile?.category === requirement.category && tile.rank === requirement.rank)).length, 0)
      return complete * 5000 + useful * 100 + next.board.filter(tile => !tile).length * 10 + (state.highestRank < level.targetRank && next.highestRank >= level.targetRank ? 50000 : 0) - next.board.filter(tile => tile && tile.rank > 2 && tile.rank < 4).length * 20
    }
    candidates.sort((a, b) => utility(b) - utility(a))
    state = candidates[0]
  }
  return state
}

test('six levels introduce real layout, ordered, staged, scarce-ingredient and fourth-rank changes', () => {
  expect(MERGE_LEVELS.map(level => level.name)).toEqual(['早餐三色', '清爽午餐', '篮中整理', '露营便当', '共享餐桌', '季节拼盘'])
  expect(MERGE_LEVELS[2].obstacles).toEqual([7, 17])
  expect(MERGE_LEVELS[3].ordered).toBe(true)
  expect(MERGE_LEVELS[3].recipeIds).toEqual(['bento-main', 'bento-side'])
  expect(MERGE_LEVELS[4].recipeIds).toHaveLength(3)
  expect(MERGE_LEVELS[5].targetRank).toBe(4)
  for (const level of MERGE_LEVELS) {
    expect(level.initial.every(item => item.cell >= 0 && item.cell < 25 && !level.obstacles.includes(item.cell))).toBe(true)
    expect(level.recipeIds.every(id => MERGE_RECIPES.some(recipe => recipe.id === id))).toBe(true)
    expect(level.maxSteps).toBeGreaterThanOrEqual(28)
    expect(level.maxSteps).toBeLessThanOrEqual(36)
  }
})

test('start is explicit and pause blocks all board and recipe actions', () => {
  const ready = createMergeGame()
  expect(applyMergeAction(ready, { type: 'slide', direction: 'left' })).toBe(ready)
  const paused = applyMergeAction(start(), { type: 'pause' })
  expect(applyMergeAction(paused, { type: 'slide', direction: 'left' })).toBe(paused)
  expect(applyMergeAction(paused, { type: 'choose-recipe', recipeId: 'breakfast' })).toBe(paused)
  expect(applyMergeAction(applyMergeAction(paused, { type: 'resume' }), { type: 'slide', direction: 'left' }).steps).toBe(1)
})

test('each original tile merges only once in a slide, with no cross-category combination', () => {
  const original = fixture([[0, 'grain', 1], [1, 'grain', 1], [2, 'grain', 1], [3, 'grain', 1], [5, 'greens', 1], [6, 'protein', 1]])
  const next = applyMergeAction(original, { type: 'slide', direction: 'left' })
  expect(next.board[0]).toMatchObject({ category: 'grain', rank: 2 })
  expect(next.board[1]).toMatchObject({ category: 'grain', rank: 2 })
  expect(next.board[5]).toMatchObject({ category: 'greens', rank: 1 })
  expect(next.board[6]).toMatchObject({ category: 'protein', rank: 1 })
  expect(next.score).toBe(80)
  expect(next.merges).toBe(2)
  expect(original.board[0]?.rank).toBe(1)
  expect(original.score).toBe(0)
})

test('fixed baskets split a row and fourth-rank tiles never become a fifth rank', () => {
  const split = applyMergeAction(fixture([[5, 'grain', 1], [8, 'grain', 1]], 3), { type: 'slide', direction: 'right' })
  expect(split.board[6]).toMatchObject({ category: 'grain', rank: 1 })
  expect(split.board[9]).toMatchObject({ category: 'grain', rank: 1 })
  expect(split.board[7]).toBeNull()
  expect(split.merges).toBe(0)
  const capped = applyMergeAction(fixture([[0, 'grain', 4], [1, 'grain', 4]]), { type: 'slide', direction: 'right' })
  expect(capped.board.filter(tile => tile?.rank === 4)).toHaveLength(2)
  expect(capped.board.every(tile => !tile || tile.rank <= 4)).toBe(true)
})

test('a no-op costs no step, advances no generator and does not consume undo', () => {
  const state = fixture([[0, 'grain', 1]])
  const unchanged = applyMergeAction(state, { type: 'slide', direction: 'left' })
  expect(unchanged).toBe(state)
  expect(unchanged.steps).toBe(0)
  expect(unchanged.cursor).toBe(0)
  expect(unchanged.previous).toBeNull()
})

test('an exact player-selected recipe consumes only those tiles, charges one step and never spawns', () => {
  const original = start()
  const next = submit(original, 'breakfast')
  expect(next.score).toBe(210)
  expect(next.steps).toBe(1)
  expect(next.cursor).toBe(0)
  expect(next.board.filter(Boolean)).toHaveLength(1)
  expect(next.completedRecipeIds).toEqual(['breakfast'])
  expect(getAvailableMergeRecipes(next).map(recipe => recipe.id)).toEqual(['morning-bowl'])
  expect(applyMergeAction(next, { type: 'choose-recipe', recipeId: 'breakfast' })).toBe(next)
  expect(original.board.filter(Boolean)).toHaveLength(4)
})

test('wrong level or missing ingredient preserves the board and score', () => {
  let state = applyMergeAction(start(2), { type: 'choose-recipe', recipeId: 'lunch-rice' })
  for (const cell of [0, 10, 20]) state = applyMergeAction(state, { type: 'toggle-cell', cell })
  const next = applyMergeAction(state, { type: 'submit' })
  expect(next.steps).toBe(0)
  expect(next.score).toBe(0)
  expect(next.board).toEqual(state.board)
  expect(next.feedback.warning).toBe(true)
  expect(applyMergeAction(state, { type: 'toggle-cell', cell: 99 })).toBe(state)
})

test('undo atomically restores score, board, recipe progress and generation position exactly once', () => {
  const original = start()
  const moved = applyMergeAction(original, { type: 'slide', direction: 'left' })
  const restored = applyMergeAction(moved, { type: 'undo' })
  expect(restored.board).toEqual(original.board)
  expect(restored.score).toBe(original.score)
  expect(restored.steps).toBe(original.steps)
  expect(restored.cursor).toBe(original.cursor)
  expect(getMergePreview(restored)).toEqual(getMergePreview(original))
  expect(restored.undoAvailable).toBe(false)
  expect(applyMergeAction(restored, { type: 'undo' })).toBe(restored)
  const resubmitted = applyMergeAction(submit(original, 'breakfast'), { type: 'undo' })
  expect(resubmitted.completedRecipeIds).toEqual([])
  expect(resubmitted.score).toBe(0)
  expect(resubmitted.board).toEqual(original.board)
})

test('full board is not a deadlock when an exact meal can still be submitted', () => {
  const tiles: MergeTile[] = Array.from({ length: 25 }, (_, cell) => ({ id: `full-${cell}`, category: (['grain', 'greens', 'protein'] as MergeCategory[])[cell % 3], rank: cell < 3 ? 1 : 4 }))
  expect(isMergeBlocked({ ...start(), board: tiles })).toBe(false)
  const blocked = { ...start(), board: tiles.map(tile => ({ ...tile, rank: 4 })) }
  expect(isMergeBlocked(blocked)).toBe(true)
})

test('step exhaustion finishes a real action, preserves partial score, and refuses further scores', () => {
  const state = { ...fixture([[0, 'grain', 1], [1, 'grain', 1]]), steps: 27 }
  const finished = applyMergeAction(state, { type: 'slide', direction: 'right' })
  expect(finished.status).toBe('finished')
  expect(finished.result).toMatchObject({ game: 'merge', completed: false, stars: 0, score: 40 })
  expect(finished.result?.detail.steps).toBe(28)
  expect(applyMergeAction(finished, { type: 'slide', direction: 'left' })).toBe(finished)
  expect(applyMergeAction(finished, { type: 'undo' })).toBe(finished)
})

test('same seed and inputs reproduce all state; checkpoints detach nested mutable data', () => {
  const replay = () => {
    let state = start(3, 18000)
    for (const direction of ['down', 'left', 'up', 'right', 'down'] as MergeDirection[]) state = applyMergeAction(state, { type: 'slide', direction })
    return state
  }
  expect(replay()).toEqual(replay())
  const state = replay(); const checkpoint = exportMergeCheckpoint(state)
  expect(checkpoint.version).toBe(1)
  expect(checkpoint.state).toEqual(state)
  checkpoint.state.board[0] = null
  checkpoint.state.completedRecipeIds.push('not-a-real-recipe')
  expect(state.completedRecipeIds).not.toContain('not-a-real-recipe')
})

test.each(MERGE_LEVELS.map(level => [level.id, level.name]))('level %s %s is winnable by actual slides and selected recipes', levelId => {
  const state = playNormalRoute(levelId as number)
  const level = mergeLevelFor(levelId as number)
  expect(state.result?.completed).toBe(true)
  expect(state.completedRecipeIds).toEqual(expect.arrayContaining(level.recipeIds))
  expect(state.highestRank).toBeGreaterThanOrEqual(level.targetRank)
  expect(state.steps).toBeLessThanOrEqual(level.maxSteps)
  expect(state.result?.stars).toBeGreaterThanOrEqual(1)
  expect(state.result?.stars).toBeLessThanOrEqual(3)
  expect(state.result?.collectibles).toEqual([level.collectible])
})
