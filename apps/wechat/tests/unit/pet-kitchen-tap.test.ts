import { advanceKitchenGame, applyKitchenAction, createKitchenGame } from '../../src/utils/pet-kitchen-game'
import type { KitchenGameState } from '../../src/utils/pet-kitchen-game'

const start = (level = 1) => applyKitchenAction(createKitchenGame(level, 'tap'), { type: 'start' })
const take = (state: KitchenGameState, orderId = 'order-1') => applyKitchenAction(state, { type: 'take-order', orderId })
const lift = (state: KitchenGameState) => applyKitchenAction(state, { type: 'move', from: 'cook' })
const jobs = (state: KitchenGameState) => [...Object.values(state.stations).flatMap(station => station.job ? [station.job] : []), ...state.bufferedPrep]

test('one order tap starts real preparation, timing remains manual, and delivery uses the original order', () => {
  let state = take(start())
  const snapshot = state
  state = advanceKitchenGame(state, 2000)
  expect(snapshot.stations.prep.job?.progress).toBe(0)
  expect(state.stations.cook.job?.orderId).toBe('order-1')
  state = take(state, 'order-2')
  state = advanceKitchenGame(state, 4000)
  expect(state.stations.plate.job).toBeNull()
  expect(state.score).toBe(0)
  state = lift(state)
  state = advanceKitchenGame(state, 1500)
  expect(state.orders.find(order => order.id === 'order-1')?.status).toBe('served')
  expect(state.orders.find(order => order.id === 'order-2')?.status).toBe('waiting')
  expect(state.stations.cook.job?.orderId).toBe('order-2')
  expect(state.score).toBe(120)
  expect(state.combo).toBe(1)
})

test('repeated order taps cannot duplicate a dish or restart its preparation', () => {
  let state = advanceKitchenGame(take(start()), 1000)
  expect(take(state)).toBe(state)
  expect(jobs(state)).toHaveLength(1)
  expect(state.stations.prep.job?.elapsedMs).toBe(1000)
  state = advanceKitchenGame(state, 5000)
  expect(take(state)).toBe(state)
  state = lift(state)
  expect(take(state)).toBe(state)
})

test('the next pot follows the accepted order queue even when two customers arrived together', () => {
  let state = advanceKitchenGame(start(), 14000)
  state = advanceKitchenGame(take(state, 'order-3'), 2000)
  state = advanceKitchenGame(take(state, 'order-1'), 2000)
  state = advanceKitchenGame(take(state, 'order-2'), 2300)
  state = advanceKitchenGame(lift(state), 1)
  expect(state.stations.cook.job?.orderId).toBe('order-1')
  expect(jobs(state).filter(job => job.orderId === 'order-2')).toHaveLength(1)
})

test('one event advance and many clock ticks produce identical automatic pipeline and scores', () => {
  const initial = lift(advanceKitchenGame(take(start()), 6000))
  let segmented = initial
  for (let i = 0; i < 250; i++) segmented = advanceKitchenGame(segmented, 100)
  expect(advanceKitchenGame(initial, 25000)).toEqual(segmented)
})

test('expiry at the same instant as completed plating cannot award delivery and cleans the expired work', () => {
  let state = lift(advanceKitchenGame(take(start()), 6000))
  state = { ...state, orders: state.orders.map(order => order.id === 'order-1' ? { ...order, expiresAtMs: 7500 } : order) }
  state = advanceKitchenGame(state, 1500)
  expect(state.score).toBe(0)
  expect(state.served).toBe(0)
  expect(state.missed).toBe(1)
  expect(state.wasted).toBe(1)
  expect(state.stations.plate.job).toBeNull()
  const later = advanceKitchenGame(state, 1000)
  expect(later.mistakes).toBe(0)
  expect(later.wasted).toBe(1)
})

test('plating congestion never overwrites a meal and resumes the queued recipe after a pot leaves', () => {
  let state = advanceKitchenGame(take(start()), 2000)
  state = advanceKitchenGame(take(state, 'order-2'), 4000)
  state = lift(state)
  state = advanceKitchenGame(state, 1)
  const blocked = lift(state)
  expect(blocked.stations.plate.job?.orderId).toBe('order-1')
  expect(blocked.stations.cook.job?.orderId).toBe('order-2')
  state = advanceKitchenGame(blocked, 1499)
  expect(state.served).toBe(1)
  expect(state.stations.plate.job).toBeNull()
})

test('early lifting loses quality, burning still breaks the combo and requires two seconds of cleanup', () => {
  let early = advanceKitchenGame(take(start()), 4600)
  early = advanceKitchenGame(lift(early), 1500)
  expect(early.score).toBe(110)
  let burnt = advanceKitchenGame(take(start()), 8200)
  expect(burnt.stations.cook.job?.stage).toBe('burnt')
  expect(burnt.wasted).toBe(1)
  burnt = applyKitchenAction(burnt, { type: 'discard', station: 'cook' })
  expect(burnt.cleaningMs).toBe(2000)
  expect(burnt.wasted).toBe(1)
  burnt = advanceKitchenGame(take(burnt, 'order-1'), 2000)
  expect(burnt.cleaningMs).toBe(0)
  expect(burnt.stations.cook.job?.orderId).toBe('order-1')
})

test('picnic pair remains distinct, oven duration stays longer, and paused preparation consumes no time', () => {
  let pair = advanceKitchenGame(take(start(3)), 2500)
  expect(jobs(pair).map(job => job.orderId).sort()).toEqual(['order-1', 'order-2'])
  expect(pair.stations.cook.job?.orderId).toBe('order-1')
  pair = applyKitchenAction(pair, { type: 'pause' })
  expect(advanceKitchenGame(pair, 90000)).toBe(pair)
  const oven = advanceKitchenGame(take(start(4)), 3000 + 6500)
  expect(oven.stations.cook.job?.cookDurationMs).toBe(6500 * 1.7)
  expect(oven.stations.cook.job?.progress).toBeCloseTo(1 / 1.7)
})

test('a player who never takes an order cannot earn a completed dish or collectible', () => {
  const state = advanceKitchenGame(start(), 90000)
  expect(state.result).toMatchObject({ passed: false, score: 0, served: 0, collectibleIds: [] })
})
