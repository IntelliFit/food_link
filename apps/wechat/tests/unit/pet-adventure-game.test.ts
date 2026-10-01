import { ADVENTURE_LEVELS, advanceAdventureGame, applyAdventureAction, createAdventureGame } from '../../src/utils/pet-adventure-game'
import type { AdventureGameState, AdventureLane, AdventureObstacle } from '../../src/utils/pet-adventure-game'

const start = (level = 1, seed?: number) => applyAdventureAction(createAdventureGame(level, seed), { type: 'start' })
const obstacle = (distance: number, type: AdventureObstacle['type'] = 'rock', lane: AdventureLane = 0): AdventureObstacle => ({ id: `test-${distance}`, distance, type, lane, resolved: false })
const isolated = (obstacles: AdventureObstacle[]) => ({ ...start(), obstacles, pickups: [] })

test('six handcrafted levels cover three chapters and every obstacle scene leaves a clear lane', () => {
  expect(ADVENTURE_LEVELS).toHaveLength(6)
  expect(new Set(ADVENTURE_LEVELS.map(level => level.chapterId))).toEqual(new Set([1, 2, 3]))
  for (const level of ADVENTURE_LEVELS) {
    expect([45000, 50000, 60000]).toContain(level.durationMs)
    const state = createAdventureGame(level.id)
    for (const distance of new Set(state.obstacles.map(item => item.distance))) {
      expect(new Set(state.obstacles.filter(item => item.distance === distance).map(item => item.lane)).size).toBeLessThan(3)
    }
  }
})

test('seeded terrain is reproducible, mirrored variations retain fairness, and restart begins cleanly', () => {
  expect(createAdventureGame(3, 19)).toEqual(createAdventureGame(3, 19))
  expect(createAdventureGame(3, 19).pickups).not.toEqual(createAdventureGame(3, 20).pickups)
  const ready = createAdventureGame()
  expect(advanceAdventureGame(ready, 10000)).toBe(ready)
  expect(applyAdventureAction(ready, { type: 'jump' })).toBe(ready)
  const running = advanceAdventureGame(start(), 200)
  expect(applyAdventureAction(running, { type: 'start' })).toBe(running)
  expect(start().score).toBe(0)
  expect(start().distance).toBe(0)
})

test('lane controls are bounded and jumping cannot be repeatedly reset in midair', () => {
  let state = applyAdventureAction(start(), { type: 'move-left' })
  state = applyAdventureAction(state, { type: 'move-left' })
  expect(state.lane).toBe(-1)
  for (let index = 0; index < 4; index++) state = applyAdventureAction(state, { type: 'move-right' })
  expect(state.lane).toBe(1)
  state = applyAdventureAction(state, { type: 'jump' })
  state = advanceAdventureGame(state, 200)
  expect(state.jumpHeight).toBeGreaterThan(0.5)
  expect(applyAdventureAction(state, { type: 'jump' })).toBe(state)
})

test('timing a jump over a rock or gap works, while a jump made too early has ended at collision', () => {
  for (const type of ['rock', 'gap'] as AdventureObstacle['type'][]) {
    let state = advanceAdventureGame(isolated([obstacle(6, type)]), 600)
    state = applyAdventureAction(state, { type: 'jump' })
    state = advanceAdventureGame(state, 600)
    expect(state.hearts).toBe(3)
    expect(state.score).toBe(20)
    let early = applyAdventureAction(isolated([obstacle(6, type)]), { type: 'jump' })
    early = advanceAdventureGame(early, 1200)
    expect(early.hearts).toBe(2)
  }
})

test('dash breaks rocks and consumes a full charge, but trees and gaps still require the right movement', () => {
  for (const type of ['rock', 'tree', 'gap'] as AdventureObstacle['type'][]) {
    let state = applyAdventureAction(isolated([obstacle(6, type)]), { type: 'dash' })
    expect(state.dashCharge).toBe(0)
    expect(state.speed).toBeGreaterThan(ADVENTURE_LEVELS[0].speed)
    state = advanceAdventureGame(state, 800)
    expect(state.hearts).toBe(type === 'rock' ? 3 : 2)
    expect(state.score).toBe(type === 'rock' ? 50 : 0)
    const repeat = applyAdventureAction(state, { type: 'dash' })
    expect(repeat.dashRemainingMs).toBe(state.dashRemainingMs)
    expect(repeat.dashCharge).toBe(0)
  }
})

test('collision sweep prevents tunneling on a long frame and freezes the result at the third collision', () => {
  const state = advanceAdventureGame(isolated([obstacle(3), obstacle(15), obstacle(27)]), 6000)
  expect(state.hearts).toBe(0)
  expect(state.status).toBe('finished')
  expect(state.result?.completed).toBe(false)
  expect(state.elapsedMs).toBeLessThan(6000)
  expect(advanceAdventureGame(state, 60000)).toBe(state)
  expect(applyAdventureAction(state, { type: 'move-right' })).toBe(state)
  expect(applyAdventureAction(state, { type: 'resume' })).toBe(state)
})

test('brief invulnerability prevents duplicate damage from nearby obstacles without granting a permanent shield', () => {
  let state = advanceAdventureGame(isolated([obstacle(3), obstacle(4), obstacle(18)]), 1000)
  expect(state.hearts).toBe(2)
  expect(state.obstacles[1].resolved).toBe(true)
  state = advanceAdventureGame(state, 2500)
  expect(state.hearts).toBe(1)
})

test('only pickups on the current route count; leaves charge dash and repeated frames cannot collect twice', () => {
  let state: AdventureGameState = { ...isolated([]), dashCharge: 0, pickups: [
    { id: 'leaf', lane: 0, distance: 3, type: 'leaf', collected: false, resolved: false },
    { id: 'star', lane: 0, distance: 4, type: 'star', collected: false, resolved: false },
    { id: 'other', lane: 1, distance: 5, type: 'star', collected: false, resolved: false },
  ] }
  const before = state
  state = advanceAdventureGame(state, 1000)
  expect(state.leaves).toBe(1)
  expect(state.collectedStars).toBe(1)
  expect(state.dashCharge).toBe(8)
  expect(state.score).toBe(42)
  expect(state.combo).toBe(2)
  expect(advanceAdventureGame(state, 500).score).toBe(42)
  expect(before.pickups[0].collected).toBe(false)
})

test('pause and resume preserve physics, clock and terrain without consuming background time', () => {
  let state = applyAdventureAction(start(), { type: 'jump' })
  state = advanceAdventureGame(state, 200)
  const paused = applyAdventureAction(state, { type: 'pause' })
  expect(advanceAdventureGame(paused, 60000)).toBe(paused)
  expect(applyAdventureAction(paused, { type: 'dash' })).toBe(paused)
  const resumed = applyAdventureAction(paused, { type: 'resume' })
  expect(resumed.elapsedMs).toBe(200)
  expect(resumed.jumpRemainingMs).toBe(700)
  expect(advanceAdventureGame(resumed, 100).elapsedMs).toBe(300)
})

test('fixed twenty-millisecond steps retain partial elapsed time and replay equally across different frame batches', () => {
  const original = start(4, 37)
  const partial = advanceAdventureGame(original, 17)
  expect(partial.elapsedMs).toBe(0)
  expect(partial.pendingMs).toBe(17)
  expect(advanceAdventureGame(partial, 3)).toEqual(advanceAdventureGame(original, 20))
  const once = advanceAdventureGame(original, 4999)
  let chunks = original
  for (const delta of [23, 177, 400, 901, 1000, 2498]) chunks = advanceAdventureGame(chunks, delta)
  expect(chunks).toEqual(once)
  expect(advanceAdventureGame(original, Infinity)).toBe(original)
  expect(advanceAdventureGame(original, -20)).toBe(original)
})

test.each(ADVENTURE_LEVELS.map(level => [level.id, level.name]))('level %s %s has a playable clear route and reachable high-score target', levelId => {
  let state = start(levelId as number, 38)
  const changeLane = (lane: AdventureLane) => {
    while (state.lane < lane) state = applyAdventureAction(state, { type: 'move-right' })
    while (state.lane > lane) state = applyAdventureAction(state, { type: 'move-left' })
  }
  while (state.status === 'running') {
    const pickup = state.pickups.find(item => !item.resolved && item.distance - state.distance <= 1 && item.distance >= state.distance)
    if (pickup) changeLane(pickup.lane)
    const nearest = state.obstacles.find(item => !item.resolved && item.distance - state.distance <= 1.5 && item.distance >= state.distance)
    if (nearest) {
      const blocked = state.obstacles.filter(item => !item.resolved && item.distance === nearest.distance).map(item => item.lane)
      changeLane(([-1, 0, 1] as AdventureLane[]).find(lane => !blocked.includes(lane))!)
    }
    state = advanceAdventureGame(state, 100)
  }
  expect(state.result?.completed).toBe(true)
  expect(state.hearts).toBe(3)
  expect(state.score).toBeGreaterThanOrEqual(ADVENTURE_LEVELS[(levelId as number) - 1].targetScore)
  expect(state.leaves).toBeGreaterThan(10)
  expect(state.result?.experience).toBeGreaterThan(20)
  expect(state.result?.stars).toBeGreaterThanOrEqual(2)
})
