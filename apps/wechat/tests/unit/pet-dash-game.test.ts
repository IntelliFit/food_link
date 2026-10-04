import { adventureLevel } from '../../src/utils/pet-adventure-game'
import { advanceDashGame, createDashGame, dashAction, type DashState } from '../../src/utils/pet-dash-game'

function perfect(state: DashState, distance: number): DashState {
  const before = advanceDashGame(state, distance * 100 - state.elapsedMs - 420)
  return advanceDashGame(dashAction(before, 'jump'), 420)
}

test('unattended running crosses each hazard, fails and earns no score or collection', () => {
  const result = advanceDashGame(dashAction(createDashGame(), 'start'), 30000)
  expect(result.status).toBe('finished')
  expect(result.obstacles.filter(item => item.resolved)).toHaveLength(3)
  expect(result.result).toMatchObject({ completed: false, hearts: 0, successfulJumps: 0, jumpInputs: 0, score: 0, stars: 0, experience: 0, collectibleIds: [] })
})

test.each([1, 2, 3, 4, 5, 6])('level %i can be won by actual timed jumps, with its own three keepsakes and story', levelId => {
  let state = dashAction(createDashGame(levelId), 'start')
  for (const obstacle of state.obstacles) state = perfect(state, obstacle.distance)
  state = advanceDashGame(state, 30000 - state.elapsedMs)
  expect(state.result).toMatchObject({ completed: true, elapsedMs: 30000, distance: 300, hearts: 3, stars: 3, successfulJumps: 12, jumpInputs: 12, bestCombo: 12, perfects: 12 })
  expect(state.result!.collectibleIds).toEqual([...adventureLevel(levelId).scenes.map(item => item.collectibleId), `adventure-story-${levelId}`])
  expect(new Set(state.collectibles).size).toBe(state.collectibles.length)
})

test('three perfect crossings trigger five seconds of double scoring; a collision clears the combo and charge', () => {
  let state = dashAction(createDashGame(), 'start')
  for (const obstacle of state.obstacles.slice(0, 3)) state = perfect(state, obstacle.distance)
  expect(state).toMatchObject({ score: 360, combo: 3, feverCharge: 0, feverRemainingMs: 5000 })
  state = perfect(state, state.obstacles[3].distance)
  expect(state).toMatchObject({ score: 600, combo: 4, feverCharge: 1, feverRemainingMs: 2600 })
  state = advanceDashGame(state, state.obstacles[4].distance * 100 - state.elapsedMs)
  expect(state).toMatchObject({ hearts: 2, combo: 0, feverCharge: 0, feverRemainingMs: 0 })
})

test('a failed later run retains only the keepsake actually jumped for, and never grants a completed story', () => {
  let state = dashAction(createDashGame(), 'start')
  for (const obstacle of state.obstacles.slice(0, 4)) state = perfect(state, obstacle.distance)
  state = advanceDashGame(state, 30000)
  expect(state.result).toMatchObject({ completed: false, stars: 0, successfulJumps: 4, collectibleIds: [adventureLevel(1).scenes[0].collectibleId] })
})

test('an ordinary successful jump breaks the consecutive-perfect charge', () => {
  let state = dashAction(createDashGame(), 'start')
  state = perfect(state, state.obstacles[0].distance)
  state = advanceDashGame(state, state.obstacles[1].distance * 100 - state.elapsedMs - 150)
  state = advanceDashGame(dashAction(state, 'jump'), 150)
  expect(state).toMatchObject({ successfulJumps: 2, combo: 2, perfects: 1, feverCharge: 0, feverRemainingMs: 0 })
})

test('frame chunking preserves crossings and real elapsed time; pause freezes pending jump and distance', () => {
  const original = dashAction(createDashGame(), 'start')
  const one = advanceDashGame(original, 1700)
  let chunks = original
  for (let index = 0; index < 17; index++) chunks = advanceDashGame(chunks, 100)
  expect(chunks).toEqual(one)
  const airborne = dashAction(one, 'jump')
  const large = advanceDashGame(airborne, 1200)
  let small = airborne
  for (let index = 0; index < 120; index++) small = advanceDashGame(small, 10)
  expect(large).toEqual(small)
  expect(large.elapsedMs).toBe(2900)
  const paused = dashAction(airborne, 'pause')
  expect(advanceDashGame(paused, 20000)).toBe(paused)
  expect(advanceDashGame(dashAction(paused, 'resume'), 100).elapsedMs).toBe(1800)
  expect(original.obstacles.every(item => !item.resolved)).toBe(true)
})

test('airborne click spam cannot restart a jump or increase input count, and invalid time does nothing', () => {
  const airborne = dashAction(dashAction(createDashGame(), 'start'), 'jump')
  expect(dashAction(airborne, 'jump')).toBe(airborne)
  expect(airborne.jumpInputs).toBe(1)
  for (const delta of [NaN, Infinity, -1, 0]) expect(advanceDashGame(airborne, delta)).toBe(airborne)
  expect(dashAction(advanceDashGame(airborne, 850), 'jump').jumpInputs).toBe(2)
})
