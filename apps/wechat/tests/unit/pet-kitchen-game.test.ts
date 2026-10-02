import {
  KITCHEN_INGREDIENTS, KITCHEN_LEVELS, KITCHEN_RECIPES, advanceKitchenGame,
  applyKitchenAction, createKitchenGame,
} from '../../src/utils/pet-kitchen-game'
import type { KitchenGameState } from '../../src/utils/pet-kitchen-game'

const start = (level = 1) => applyKitchenAction(createKitchenGame(level), { type: 'start' })
const recipeFor = (id: string) => KITCHEN_RECIPES.find(recipe => recipe.id === id)!

function prepare(state: KitchenGameState, orderId: string): KitchenGameState {
  const order = state.orders.find(item => item.id === orderId)!
  state = applyKitchenAction(state, { type: 'select-order', orderId })
  for (const ingredientId of recipeFor(order.recipeId).ingredients) state = applyKitchenAction(state, { type: 'toggle-ingredient', ingredientId })
  return applyKitchenAction(state, { type: 'prepare' })
}

function readyPlate(state: KitchenGameState, orderId: string, cookingFactor = 1): KitchenGameState {
  const recipe = recipeFor(state.orders.find(item => item.id === orderId)!.recipeId)
  state = prepare(state, orderId)
  state = advanceKitchenGame(state, recipe.prepMs)
  state = applyKitchenAction(state, { type: 'move', from: 'prep' })
  state = advanceKitchenGame(state, Math.ceil(recipe.cookMs * cookingFactor))
  state = applyKitchenAction(state, { type: 'move', from: 'cook' })
  return advanceKitchenGame(state, recipe.plateMs)
}

test('all six ninety-second levels have valid recipes, bounded ingredient pools and six production techniques', () => {
  expect(KITCHEN_RECIPES).toHaveLength(12)
  expect(KITCHEN_LEVELS).toHaveLength(6)
  expect(new Set(KITCHEN_RECIPES.flatMap(recipe => [recipe.prepLabel, recipe.cookLabel])).size).toBe(6)
  for (const level of KITCHEN_LEVELS) {
    expect(level.durationMs).toBe(90000)
    expect(level.maxOrders).toBe(3)
    expect(level.recipeIds.every(id => KITCHEN_RECIPES.some(recipe => recipe.id === id))).toBe(true)
    const ingredients = new Set(createKitchenGame(level.id).menuIds.flatMap(id => recipeFor(id).ingredients))
    expect(ingredients.size).toBeLessThanOrEqual(6)
    expect([...ingredients].every(id => KITCHEN_INGREDIENTS.some(ingredient => ingredient.id === id))).toBe(true)
  }
  expect(new Set(KITCHEN_LEVELS[0].recipeIds.flatMap(id => recipeFor(id).ingredients)).size).toBeLessThanOrEqual(6)
})

test('start is explicit, starts two real orders, and cannot be spammed to reset the clock', () => {
  const ready = createKitchenGame()
  expect(ready.orders).toEqual([])
  expect(advanceKitchenGame(ready, 5000)).toBe(ready)
  let state = start()
  expect(state.orders.map(order => order.id)).toEqual(['order-1', 'order-2'])
  state = advanceKitchenGame(state, 1000)
  expect(applyKitchenAction(state, { type: 'start' })).toBe(state)
  expect(state.remainingMs).toBe(89000)
})

test('wrong recipe ingredients reset combo without occupying a station or changing the previous snapshot', () => {
  const original = start()
  const selected = applyKitchenAction(original, { type: 'toggle-ingredient', ingredientId: 'rice' })
  const state = applyKitchenAction({ ...selected, combo: 3 }, { type: 'prepare' })
  expect(state.mistakes).toBe(1)
  expect(state.combo).toBe(0)
  expect(state.stations.prep.job).toBeNull()
  expect(state.feedback.message).toContain('食材与配方不一致')
  expect(original.selectedIngredients).toEqual([])
  expect(original.mistakes).toBe(0)
})

test('three stations work concurrently and never transfer or serve automatically', () => {
  let state = prepare(start(), 'order-1')
  state = advanceKitchenGame(state, 2000)
  expect(state.stations.prep.job?.stage).toBe('ready')
  state = applyKitchenAction(state, { type: 'move', from: 'prep' })
  state = prepare(state, 'order-2')
  state = advanceKitchenGame(state, 2200)
  expect(state.stations.prep.job?.stage).toBe('ready')
  expect(state.stations.cook.job?.progress).toBeCloseTo(0.55)
  const blocked = applyKitchenAction(state, { type: 'move', from: 'prep' })
  expect(blocked.stations.prep.job?.orderId).toBe('order-2')
  expect(blocked.stations.cook.job?.orderId).toBe('order-1')
  state = advanceKitchenGame(blocked, 1800)
  state = applyKitchenAction(state, { type: 'move', from: 'cook' })
  state = applyKitchenAction(state, { type: 'move', from: 'prep' })
  state = advanceKitchenGame(state, 1500)
  expect(state.stations.plate.job?.stage).toBe('ready')
  expect(state.stations.cook.job?.orderId).toBe('order-2')
  expect(state.stations.cook.job?.progress).toBeGreaterThan(0)
  expect(state.served).toBe(0)
})

test('unattended cooked food burns once and must be cleared before the stove is reusable', () => {
  let state = prepare(start(), 'order-1')
  state = advanceKitchenGame(state, 2000)
  state = applyKitchenAction(state, { type: 'move', from: 'prep' })
  state = advanceKitchenGame(state, 6200)
  expect(state.stations.cook.job?.stage).toBe('burnt')
  expect(state.stations.cook.job?.quality).toBe(0)
  expect(state.wasted).toBe(1)
  state = advanceKitchenGame(state, 1000)
  state = applyKitchenAction(state, { type: 'move', from: 'cook' })
  expect(state.stations.plate.job).toBeNull()
  expect(state.wasted).toBe(1)
  state = applyKitchenAction(state, { type: 'discard', station: 'cook' })
  expect(state.stations.cook.job).toBeNull()
  expect(state.wasted).toBe(1)
})

test('a wrong customer cannot receive or score the meal, and an identical second serve cannot score twice', () => {
  let state = readyPlate(start(), 'order-1')
  state = applyKitchenAction(state, { type: 'serve', orderId: 'order-2' })
  expect(state.score).toBe(0)
  expect(state.mistakes).toBe(1)
  expect(state.stations.plate.job?.orderId).toBe('order-1')
  state = applyKitchenAction(state, { type: 'serve', orderId: 'order-1' })
  expect(state.score).toBe(120)
  expect(state.served).toBe(1)
  expect(state.orders[0].status).toBe('served')
  expect(applyKitchenAction(state, { type: 'serve', orderId: 'order-1' }).score).toBe(120)
})

test('quality and consecutive correct deliveries affect points with a bounded combo bonus', () => {
  let state = readyPlate(start(), 'order-1')
  state = applyKitchenAction(state, { type: 'serve' })
  expect(state.score).toBe(120)
  state = readyPlate(state, 'order-2', 0.65)
  expect(state.stations.plate.job?.quality).toBe(75)
  state = applyKitchenAction(state, { type: 'serve' })
  expect(state.score).toBe(120 + 116)
  expect(state.combo).toBe(2)
  expect(state.bestCombo).toBe(2)
  let capped = readyPlate(start(), 'order-1')
  capped = applyKitchenAction({ ...capped, combo: 100 }, { type: 'serve' })
  expect(capped.score).toBe(156)
})

test('higher heat speeds cooking but heat mismatch reduces quality; unsafe input cannot poison the simulation', () => {
  let state = prepare(start(), 'order-1')
  state = advanceKitchenGame(state, 2000)
  state = applyKitchenAction(state, { type: 'move', from: 'prep' })
  expect(applyKitchenAction(state, { type: 'heat', value: NaN })).toBe(state)
  state = applyKitchenAction(state, { type: 'heat', value: 1000 })
  expect(state.stations.cook.job?.heat).toBe(100)
  state = advanceKitchenGame(state, 2800)
  expect(state.stations.cook.job?.progress).toBe(1)
  expect(state.stations.cook.job?.quality).toBeLessThan(100)
  state = applyKitchenAction(state, { type: 'move', from: 'cook' })
  expect(state.stations.plate.job?.quality).toBe(85)
})

test('plated meals lose quality if left waiting; meals for departed customers are not rewarded', () => {
  let cooled = readyPlate(start(), 'order-1')
  cooled = advanceKitchenGame(cooled, 16000)
  expect(cooled.stations.plate.job?.quality).toBe(94)
  cooled = applyKitchenAction(cooled, { type: 'serve' })
  expect(cooled.score).toBe(120)
  let expired = readyPlate(start(), 'order-1')
  expired = advanceKitchenGame(expired, 36000 - expired.elapsedMs)
  expect(expired.orders[0].status).toBe('expired')
  expect(expired.missed).toBe(2)
  expired = applyKitchenAction(expired, { type: 'serve' })
  expect(expired.score).toBe(0)
  expect(expired.stations.plate.job).not.toBeNull()
})

test('orders stay within capacity and include shorter-patience express customers after the opening phase', () => {
  let state = readyPlate(start(2), 'order-1')
  state = applyKitchenAction(state, { type: 'serve' })
  state = advanceKitchenGame(state, 25000 - state.elapsedMs)
  expect(state.orders.filter(order => order.status === 'waiting')).toHaveLength(3)
  const express = state.orders.find(order => order.express)!
  expect(express.arrivedAtMs).toBeGreaterThanOrEqual(15000)
  expect(express.patienceMs).toBeLessThan(KITCHEN_LEVELS[1].patienceMs)
})

test('pausing freezes every timer and action; chunked elapsed time deterministically reproduces one-step simulation', () => {
  let state = prepare(start(), 'order-1')
  state = advanceKitchenGame(state, 2000)
  state = applyKitchenAction(state, { type: 'move', from: 'prep' })
  const paused = applyKitchenAction(state, { type: 'pause' })
  expect(advanceKitchenGame(paused, 60000)).toBe(paused)
  expect(applyKitchenAction(paused, { type: 'prepare' })).toBe(paused)
  const resumed = applyKitchenAction(paused, { type: 'resume' })
  const once = advanceKitchenGame(resumed, 40000)
  let chunks = resumed
  for (const elapsed of [23, 177, 3900, 541, 7959, 27400]) chunks = advanceKitchenGame(chunks, elapsed)
  expect(chunks).toEqual(once)
  expect(advanceKitchenGame(state, Infinity)).toBe(state)
  expect(advanceKitchenGame(state, -500)).toBe(state)
})

test('ninety-second termination produces goal-based stars, rejects later updates and can restart cleanly', () => {
  let failed = advanceKitchenGame(start(), 120000)
  expect(failed.elapsedMs).toBe(90000)
  expect(failed.status).toBe('finished')
  expect(failed.result?.passed).toBe(false)
  expect(failed.result?.stars).toBe(0)
  expect(failed.result?.advice).toContain('耐心')
  expect(advanceKitchenGame(failed, 1000)).toBe(failed)
  expect(applyKitchenAction(failed, { type: 'resume' })).toBe(failed)
  expect(applyKitchenAction(failed, { type: 'serve' })).toBe(failed)
  const level = KITCHEN_LEVELS[0]
  failed = advanceKitchenGame({ ...start(), served: level.targetServed, score: level.targetScore * 2, nextOrderAtMs: 90000, orders: [] }, 90000)
  expect(failed.result?.passed).toBe(true)
  expect(failed.result?.stars).toBe(3)
  const restarted = start(failed.levelId)
  expect(restarted.elapsedMs).toBe(0)
  expect(restarted.score).toBe(0)
  expect(restarted.result).toBeNull()
  expect(restarted.orders).toHaveLength(2)
})

test.each(KITCHEN_LEVELS.map(level => [level.id, level.name]))('level %s %s is winnable with a normal earliest-patience pipeline', levelId => {
  let state = start(levelId as number)
  while (state.status === 'running') {
    if (state.stations.plate.job?.stage === 'ready') state = applyKitchenAction(state, { type: 'serve' })
    if (state.stations.cook.job?.stage === 'ready' && !state.stations.plate.job) state = applyKitchenAction(state, { type: 'move', from: 'cook' })
    if (state.stations.prep.job?.stage === 'ready' && !state.stations.cook.job) state = applyKitchenAction(state, { type: 'move', from: 'prep' })
    if (!state.stations.prep.job) {
      const inProgress = Object.values(state.stations).map(station => station.job?.orderId)
      const next = state.orders.filter(order => order.status === 'waiting' && !inProgress.includes(order.id))
        .sort((a, b) => a.expiresAtMs - b.expiresAtMs)[0]
      if (next) state = prepare(state, next.id)
    }
    state = advanceKitchenGame(state, 100)
  }
  expect(state.result?.passed).toBe(true)
  expect(state.served).toBeGreaterThanOrEqual(KITCHEN_LEVELS[(levelId as number) - 1].targetServed)
  expect(state.score).toBeGreaterThanOrEqual(KITCHEN_LEVELS[(levelId as number) - 1].targetScore)
  expect(state.mistakes).toBe(0)
  expect(state.wasted).toBe(0)
})

test('two prepared portions create a scheduling choice while the single stove stays occupied', () => {
  let state = prepare(start(), 'order-1')
  state = advanceKitchenGame(state, 2000)
  state = prepare(state, 'order-2')
  expect(state.bufferedPrep.map(job => job.orderId)).toEqual(['order-1'])
  state = advanceKitchenGame(state, 2200)
  expect(state.stations.prep.job?.stage).toBe('ready')
  state = applyKitchenAction(state, { type: 'move', from: 'prep', orderId: 'order-1' })
  expect(state.stations.cook.job?.orderId).toBe('order-1')
  expect(state.stations.prep.job?.orderId).toBe('order-2')
  const blocked = applyKitchenAction(state, { type: 'move', from: 'prep' })
  expect(blocked.stations.cook.job?.orderId).toBe('order-1')
  expect(blocked.feedback.message).toContain('灶台还没有空位')
})

test('shared picnic orders can be prepared as a pair, but a third portion cannot be stockpiled', () => {
  let state = start(3)
  expect(state.orders[0].recipeId).toBe(state.orders[1].recipeId)
  for (const id of recipeFor(state.orders[0].recipeId).ingredients) state = applyKitchenAction(state, { type: 'toggle-ingredient', ingredientId: id })
  state = applyKitchenAction(state, { type: 'prepare-batch' })
  expect(state.stations.prep.job?.batch).toBe(true)
  expect(state.bufferedPrep).toHaveLength(1)
  state = advanceKitchenGame(state, recipeFor(state.orders[0].recipeId).prepMs)
  expect(state.bufferedPrep[0].stage).toBe('ready')
  const blocked = applyKitchenAction(state, { type: 'prepare-stock' })
  expect(blocked.bufferedPrep).toHaveLength(1)
  expect(blocked.feedback.message).toContain('最多留两份')
  const cleared = applyKitchenAction(blocked, { type: 'discard-prepared', orderId: blocked.bufferedPrep[0].orderId })
  expect(cleared.bufferedPrep).toHaveLength(0)
  expect(cleared.score).toBe(state.score)
})

test('rain meals cool sooner and the baking level really occupies the stove for longer', () => {
  let rain = readyPlate(start(2), 'order-1')
  rain = advanceKitchenGame(rain, 8000)
  expect(rain.stations.plate.job?.quality).toBeLessThan(100)
  let baking = prepare(start(4), 'order-1')
  const recipe = recipeFor(baking.orders[0].recipeId)
  baking = advanceKitchenGame(baking, recipe.prepMs)
  baking = applyKitchenAction(baking, { type: 'move', from: 'prep' })
  baking = advanceKitchenGame(baking, recipe.cookMs)
  expect(baking.stations.cook.job?.progress).toBeCloseTo(1 / 1.7)
  expect(baking.stations.cook.job?.stage).toBe('working')
})

test('clearing a burnt pot takes two frozen-pausable seconds without deducting past score', () => {
  let state = prepare(start(), 'order-1')
  state = advanceKitchenGame(state, 2000)
  state = applyKitchenAction(state, { type: 'move', from: 'prep' })
  state = advanceKitchenGame(state, 6300)
  state = applyKitchenAction({ ...state, score: 120 }, { type: 'discard', station: 'cook' })
  expect(state.cleaningMs).toBe(2000)
  state = prepare(state, 'order-2')
  const paused = applyKitchenAction(state, { type: 'pause' })
  expect(advanceKitchenGame(paused, 5000).cleaningMs).toBe(2000)
  state = advanceKitchenGame(state, 2200)
  expect(state.cleaningMs).toBe(0)
  expect(state.score).toBe(120)
})

test('banquet menu has exactly three chosen recipes and at most six ingredients, with real order waves', () => {
  const ready = createKitchenGame(6)
  const invalid = applyKitchenAction(ready, { type: 'set-menu', recipeIds: ['egg-rice', 'fish-soup', 'chicken-bake'] })
  expect(invalid.menuIds).toEqual(ready.menuIds)
  let state = applyKitchenAction(ready, { type: 'set-menu', recipeIds: ['fish-rice', 'veggie-rice', 'chicken-rice'] })
  expect(state.menuIds).toEqual(['fish-rice', 'veggie-rice', 'chicken-rice'])
  state = applyKitchenAction(state, { type: 'start' })
  expect(state.orders.map(order => order.recipeId)).toEqual(['fish-rice', 'veggie-rice'])
  state = advanceKitchenGame(state, 8000)
  expect(state.orders).toHaveLength(3)
  expect(state.nextOrderAtMs).toBe(16000)
})

test('base completion needs correct deliveries, then result carries stable level and fixed collectible ids', () => {
  const level = KITCHEN_LEVELS[0]
  const state = advanceKitchenGame({ ...start(), orders: [], nextOrderAtMs: 90000, served: level.targetServed, score: 0 }, 90000)
  expect(state.result).toMatchObject({ levelId: 1, passed: true, stars: 1, collectibleIds: ['breakfast-page'], stoveIdleMs: 90000 })
  expect(state.result?.advice).toContain('灶台空了90秒')
})

test('buffered prep and cleanup simulation stay deterministic over differently sized frames', () => {
  let state = prepare(start(), 'order-1')
  state = advanceKitchenGame(state, 2000)
  state = prepare(state, 'order-2')
  const once = advanceKitchenGame(state, 12000)
  let chunks = state
  for (const amount of [1000, 1500, 3200, 6300]) chunks = advanceKitchenGame(chunks, amount)
  expect(chunks).toEqual(once)
})
