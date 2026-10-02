import {
  EXPLORE_LEVELS, advanceExploreGame, applyExploreAction, continueExploreGame, createExploreGame,
  exploreNode, exploreSlatePattern, exportExploreCheckpoint, type ExploreGameState,
} from '../../src/utils/pet-explore-game'

function start(levelId = 1) { return applyExploreAction(createExploreGame(levelId), { type: 'start' }) }
function move(state: ExploreGameState, nodeId: string) { return applyExploreAction(state, { type: 'move', nodeId }) }
function solve(state: ExploreGameState): ExploreGameState {
  const target = exploreNode(state)
  let next = applyExploreAction(state, { type: 'challenge' })
  if (target.kind === 'canal') {
    target.canal!.initial.forEach((rotation, index) => {
      for (let turn = 0; turn < (4 - rotation) % 4; turn += 1) next = applyExploreAction(next, { type: 'rotate', index })
    })
    next = applyExploreAction(next, { type: 'check-canal' })
  } else if (target.kind === 'slate') {
    for (const symbol of exploreSlatePattern(next)) next = applyExploreAction(next, { type: 'slate', symbol })
  } else if (target.kind === 'treasure') {
    // 玩家策略：在安全区收线，较紧时松开，回到 30 再拉。
    for (let step = 0; step < 500 && next.phase === 'haul'; step += 1) {
      if (!next.haul.pulling && next.haul.tension <= 30) next = applyExploreAction(next, { type: 'pull', value: true })
      if (next.haul.pulling && next.haul.tension >= 55) next = applyExploreAction(next, { type: 'pull', value: false })
      next = advanceExploreGame(next, 100)
    }
    expect(next.phase).toBe('map')
  }
  return next
}
function visit(state: ExploreGameState, nodeId: string) {
  let next = move(state, nodeId)
  expect(next.nodeId).toBe(nodeId)
  const target = exploreNode(next)
  if (target.kind === 'clue') return applyExploreAction(next, { type: 'observe' })
  if (['canal', 'slate', 'treasure'].includes(target.kind) && !next.claimed.includes(nodeId) && (target.requires || []).every(id => next.clues.includes(id) || next.solved.includes(id))) next = solve(next)
  return next
}

const feasibleRoutes: Record<number, string[][]> = {
  1: [['clue', 'canal', 'pebble'], ['lookout', 'clue', 'canal', 'pebble'], ['clue', 'rest', 'canal', 'pebble']],
  2: [['fork', 'clue', 'canal', 'slate', 'letter'], ['fork', 'clue', 'fork', 'canal', 'slate', 'letter'], ['fork', 'clue', 'fork', 'stable', 'slate', 'letter']],
  3: [['bridge', 'clue', 'west-canal', 'west-treasure', 'west-canal', 'bridge', 'east-canal', 'east-treasure'], ['bridge', 'clue', 'west-canal', 'west-treasure', 'west-canal', 'rest', 'east-canal', 'east-treasure'], ['bridge', 'clue', 'east-canal', 'east-treasure', 'east-canal', 'bridge', 'west-canal', 'west-treasure']],
  4: [['fork', 'clue', 'slate', 'near', 'lookout', 'canal', 'lookout', 'far'], ['fork', 'clue', 'fork', 'canal', 'lookout', 'slate', 'near', 'lookout', 'far'], ['fork', 'clue', 'slate', 'lookout', 'canal', 'lookout', 'far', 'lookout', 'near']],
  5: [['fork', 'leaf-clue', 'fork', 'flower-clue', 'slate', 'wood', 'flower'], ['fork', 'flower-clue', 'fork', 'leaf-clue', 'slate', 'flower', 'wood'], ['fork', 'flower-clue', 'lookout', 'slate', 'leaf-clue', 'slate', 'wood', 'flower']],
  6: [['fork', 'clue', 'canal', 'slate', 'stamp', 'frame', 'story'], ['fork', 'clue', 'canal', 'slate', 'frame', 'stamp', 'frame', 'story'], ['fork', 'clue', 'canal', 'stamp', 'slate', 'story', 'frame', 'stamp']],
}

describe.each(EXPLORE_LEVELS)('$name', level => {
  test.each(feasibleRoutes[level.id].map((path, index) => [index + 1, path] as const))('main route %s is achievable through actual controls within its budget', (_number, path) => {
    let state = start(level.id)
    for (const nodeId of path) state = visit(state, nodeId)
    state = applyExploreAction(state, { type: 'finish' })
    expect(state.result?.completed).toBe(true)
    expect(state.remaining).toBe(level.budget - path.length)
    expect(state.result?.detail.moves).toBe(path.length)
    expect(state.result?.stars).toBeGreaterThanOrEqual(1)
    expect(state.result?.stars).toBeLessThanOrEqual(3)
    expect(new Set(state.claimed).size).toBe(state.claimed.length)
    expect(level.nodes.length).toBeGreaterThanOrEqual(6)
    expect(level.nodes.length).toBeLessThanOrEqual(9)
  })
})

test('clue prerequisites prevent puzzle guessing, and non-adjacent moves consume nothing', () => {
  let state = start(1)
  expect(move(state, 'pebble')).toBe(state)
  state = move(move(state, 'lookout'), 'canal')
  state = applyExploreAction(state, { type: 'challenge' })
  expect(state.phase).toBe('map')
  expect(state.feedback).toContain('浅滩石牌')
  expect(state.score).toBe(0)
  expect(state.remaining).toBe(6)
})

test('one node scores once; complete mainline awards one bonus and actual safe-haul quality', () => {
  let state = visit(start(), 'clue')
  state = applyExploreAction(state, { type: 'observe' })
  expect(state.score).toBe(50)
  expect(state.remaining).toBe(7)
  state = visit(visit(state, 'canal'), 'pebble')
  expect(state.score).toBe(400)
  expect(state.qualityPoints).toBe(50)
  state = applyExploreAction(state, { type: 'challenge' })
  expect(state.phase).toBe('map')
  state = applyExploreAction(state, { type: 'finish' })
  expect(state.result).toMatchObject({ game: 'explore', score: 400, completed: true, stars: 3, collectibles: ['pebble-ornament', 'waterside-memory-1'] })
  let next = applyExploreAction(continueExploreGame(state), { type: 'start' })
  next = visit(visit(visit(next, 'clue'), 'canal'), 'pebble')
  next = applyExploreAction(next, { type: 'finish' })
  expect(next.result?.score).toBe(0)
  expect(next.result?.stars).toBe(0)
  expect(next.result?.collectibles).toEqual([])
})

test('wrong canal and over-tight haul reset only that challenge and allow an in-place recovery', () => {
  let state = visit(start(), 'clue')
  state = move(state, 'canal')
  state = applyExploreAction(state, { type: 'challenge' })
  state = applyExploreAction(state, { type: 'check-canal' })
  expect(state.puzzleFailures).toBe(1)
  expect(state.score).toBe(50)
  expect(state.clues).toEqual(['clue'])
  expect(state.remaining).toBe(6)
  state = applyExploreAction(state, { type: 'close-challenge' })
  state = solve(state)
  state = move(state, 'pebble')
  state = applyExploreAction(state, { type: 'challenge' })
  state = applyExploreAction(state, { type: 'pull', value: true })
  // 平缓目标需要 8 秒实际收线；8 秒尚未越界，另测试浪涌目标。
  let surge = visit(start(2), 'fork')
  surge = visit(surge, 'clue')
  surge = visit(surge, 'canal')
  surge = visit(surge, 'slate')
  surge = move(surge, 'letter')
  surge = applyExploreAction(surge, { type: 'challenge' })
  surge = applyExploreAction(surge, { type: 'pull', value: true })
  surge = advanceExploreGame(surge, 10000)
  expect(surge.haulFailures).toBe(1)
  expect(surge.haul.progress).toBe(0)
  expect(surge.phase).toBe('haul')
  expect(surge.haul.pulling).toBe(false)
  expect(surge.clues).toEqual(['clue'])
  expect(surge.solved).toEqual(['canal', 'slate'])
  expect(surge.remaining).toBe(4)
  surge = applyExploreAction(surge, { type: 'close-challenge' })
  surge = solve(surge)
  expect(surge.collectibles).toContain('reed-bottle')
  expect(surge.remaining).toBe(4)
})

test('wrong slate resets its sequence, while discovered order changes the rain-garden solution', () => {
  let firstLeaf = start(5)
  for (const id of ['fork', 'leaf-clue', 'fork', 'flower-clue', 'slate']) firstLeaf = visit(firstLeaf, id)
  expect(firstLeaf.solved).toContain('slate')
  let firstFlower = start(5)
  for (const id of ['fork', 'flower-clue', 'fork', 'leaf-clue']) firstFlower = visit(firstFlower, id)
  firstFlower = move(firstFlower, 'slate')
  firstFlower = applyExploreAction(firstFlower, { type: 'challenge' })
  expect(exploreSlatePattern(firstFlower)).toEqual(['flower', 'leaf', 'flower', 'leaf'])
  firstFlower = applyExploreAction(firstFlower, { type: 'slate', symbol: 'leaf' })
  expect(firstFlower.sequence).toEqual([])
  expect(firstFlower.puzzleFailures).toBe(1)
  expect(firstFlower.clues).toEqual(['flower-clue', 'leaf-clue'])
  expect(firstFlower.score).toBe(100)
  for (const symbol of ['flower', 'leaf', 'flower', 'leaf'] as const) firstFlower = applyExploreAction(firstFlower, { type: 'slate', symbol })
  expect(firstFlower.solved).toContain('slate')
})

test('budget exhaustion is a real terminal; continuation preserves nodes and scores only new harvest', () => {
  let state = visit(start(), 'clue')
  for (const id of ['camp', 'lookout', 'camp', 'lookout', 'camp', 'lookout', 'camp']) state = move(state, id)
  expect(state.status).toBe('finished')
  expect(state.result).toMatchObject({ score: 50, completed: false, stars: 0 })
  expect(move(state, 'clue')).toBe(state)
  state = applyExploreAction(continueExploreGame(state), { type: 'start' })
  expect(state.remaining).toBe(8)
  expect(state.clues).toEqual(['clue'])
  state = visit(state, 'clue')
  expect(state.score).toBe(0)
  state = visit(visit(state, 'canal'), 'pebble')
  state = applyExploreAction(state, { type: 'finish' })
  expect(state.result?.score).toBe(350)
  expect(state.result?.detail.clues).toBe(0)
})

test('reopening a level preserves real node source IDs while continuation includes earlier and newly claimed landmarks', () => {
  const shortTrip = () => applyExploreAction(move(visit(start(), 'clue'), 'camp'), { type: 'finish' })
  const first = shortTrip()
  const reopened = shortTrip()
  expect(first.result?.detail).toMatchObject({ moves: 2, nodes: 1 })
  expect(first.result?.landmarks).toEqual(['clue'])
  expect(reopened.result?.landmarks).toEqual(first.result?.landmarks)
  let continued = applyExploreAction(continueExploreGame(first), { type: 'start' })
  continued = visit(visit(visit(continued, 'clue'), 'canal'), 'pebble')
  continued = applyExploreAction(continued, { type: 'finish' })
  expect(continued.result?.detail.nodes).toBe(2)
  expect(continued.result?.landmarks).toEqual(['clue', 'canal', 'pebble'])
  expect(continued.result?.landmarks).not.toBe(continued.claimed)
  expect(new Set([...first.result!.landmarks!, ...reopened.result!.landmarks!, ...continued.result!.landmarks!]).size).toBe(3)
})

test('pause stops tension, progress and inputs; resume does not automatically restart pulling', () => {
  let state = visit(visit(start(), 'clue'), 'canal')
  state = move(state, 'pebble')
  state = applyExploreAction(state, { type: 'challenge' })
  state = applyExploreAction(state, { type: 'pull', value: true })
  state = advanceExploreGame(state, 1000)
  const progress = state.haul.progress
  state = applyExploreAction(state, { type: 'pause' })
  expect(advanceExploreGame(state, 60000)).toBe(state)
  expect(applyExploreAction(state, { type: 'pull', value: true })).toBe(state)
  state = applyExploreAction(state, { type: 'resume' })
  state = advanceExploreGame(state, 1000)
  expect(state.haul.progress).toBe(progress)
  expect(state.haul.pulling).toBe(false)
})

test('checkpoint is a versioned detached JSON snapshot and fixed input replay stays deterministic', () => {
  const replay = () => feasibleRoutes[4][0].reduce(visit, start(4))
  expect(replay()).toEqual(replay())
  const state = replay()
  const snapshot = exportExploreCheckpoint(state)
  expect(snapshot.version).toBe(1)
  expect(snapshot.game).toBe('explore')
  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  snapshot.state.claimed.length = 0
  expect(state.claimed.length).toBeGreaterThan(0)
  expect(applyExploreAction(start(), { type: 'finish' }).result).toBeNull()
})
