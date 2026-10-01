import {
  ADVENTURE_SHOP_ITEMS, createAdventureProgress, deriveAdventureProgress, equipAdventureItem,
  normalizeAdventureProgress, placeAdventureItem, purchaseAdventureItem, settleAdventureRound,
} from '../../src/utils/pet-adventure-progress'
import type { AdventureResult } from '../../src/utils/pet-adventure-game'

const today = '2026-10-01'
const result = (overrides: Partial<AdventureResult> = {}): AdventureResult => ({
  levelId: 1, completed: true, score: 1000, stars: 3, leaves: 20, collectedStars: 10,
  hearts: 3, distance: 270, elapsedMs: 45000, experience: 50, ...overrides,
})

test('new pets have an independent starter journey and known fixed-price cosmetic catalog', () => {
  const first = createAdventureProgress()
  const second = createAdventureProgress()
  expect(first.unlockedLevels).toEqual([1])
  expect(first.starBalance).toBe(0)
  expect(first.inventory).toEqual([])
  expect(first.equipment).toEqual({ board: null, scarf: null })
  first.inventory.push('plant')
  expect(second.inventory).toEqual([])
  expect(ADVENTURE_SHOP_ITEMS.map(item => [item.id, item.cost])).toEqual([
    ['plant', 20], ['lamp', 30], ['leafboard', 40], ['explorer-scarf', 30],
  ])
})

test('settlement awards actual local stars and experience, records bests and opens the next chapter route immutably', () => {
  const old = createAdventureProgress()
  const settled = settleAdventureRound(old, 'round-one', result(), today)
  expect(settled.ok).toBe(true)
  expect(settled.earnedStars).toBe(13)
  expect(settled.earnedExperience).toBe(50)
  expect(settled.progress.starBalance).toBe(13)
  expect(settled.progress.xp).toBe(50)
  expect(settled.progress.unlockedLevels).toEqual([1, 2])
  expect(settled.progress.clearedLevels).toEqual([1])
  expect(settled.progress.storyChapters).toEqual([1])
  expect(settled.progress.bests['1']).toEqual({ score: 1000, stars: 3, completed: true })
  expect(old).toEqual(createAdventureProgress())
})

test('round IDs permanently prevent duplicate stars, experience and repeated first-clear events', () => {
  const first = settleAdventureRound(createAdventureProgress(), 'unique-round', result(), today).progress
  const repeated = settleAdventureRound(first, 'unique-round', result(), '2026-10-02')
  expect(repeated.ok).toBe(false)
  expect(repeated.progress).toBe(first)
  expect(repeated.earnedStars).toBe(0)
  expect(repeated.earnedExperience).toBe(0)
  expect(first.settledRoundIds).toEqual(['unique-round'])
})

test('the daily sixty-star cap limits earnings, preserves experience and resets only on a newer day', () => {
  let progress = createAdventureProgress()
  for (let index = 0; index < 4; index++) progress = settleAdventureRound(progress, `day-one-${index}`, result(), today).progress
  expect(progress.starBalance).toBe(52)
  const fifth = settleAdventureRound(progress, 'day-one-4', result(), today)
  expect(fifth.earnedStars).toBe(8)
  expect(fifth.progress.daily.earnedStars).toBe(60)
  const capped = settleAdventureRound(fifth.progress, 'day-one-5', result(), today)
  expect(capped.earnedStars).toBe(0)
  expect(capped.earnedExperience).toBe(50)
  expect(capped.progress.xp).toBe(300)
  const nextDay = settleAdventureRound(capped.progress, 'day-two', result(), '2026-10-02')
  expect(nextDay.earnedStars).toBe(13)
  expect(nextDay.progress.daily.earnedStars).toBe(13)
  expect(settleAdventureRound(nextDay.progress, 'old-day', result(), today).ok).toBe(false)
})

test('failed journeys retain real collected items but do not unlock new levels or receive completion bonus', () => {
  const settled = settleAdventureRound(createAdventureProgress(), 'failed-but-played', result({ completed: false, hearts: 0, stars: 0, score: 100, leaves: 3, collectedStars: 2, elapsedMs: 5000 }), today)
  expect(settled.ok).toBe(true)
  expect(settled.earnedStars).toBe(2)
  expect(settled.earnedExperience).toBe(4)
  expect(settled.progress.unlockedLevels).toEqual([1])
  expect(settled.progress.storyChapters).toEqual([])
})

test('early exits, invalid results, locked stages and invalid dates cannot award currency or experience', () => {
  const progress = createAdventureProgress()
  for (const invalid of [result({ completed: true, elapsedMs: 1000 }), result({ score: NaN }), result({ collectedStars: 1000 }), result({ levelId: 2 }), result({ elapsedMs: 500 })]) {
    const rejected = settleAdventureRound(progress, 'invalid', invalid, today)
    expect(rejected.ok).toBe(false)
    expect(rejected.progress).toBe(progress)
  }
  expect(settleAdventureRound(progress, '', result(), today).ok).toBe(false)
  expect(settleAdventureRound(progress, 'date', result(), '2026-02-30').ok).toBe(false)
  const claimedXp = settleAdventureRound(progress, 'correct-but-inflated-xp', result({ experience: 999999 }), today)
  expect(claimedXp.earnedExperience).toBe(50)
})

test('fixed purchases atomically spend stars and add one inventory item; insufficient and repeated purchases do neither', () => {
  const old = { ...createAdventureProgress(), starBalance: 60 }
  const plant = purchaseAdventureItem(old, 'plant')
  expect(plant.ok).toBe(true)
  expect(plant.progress.starBalance).toBe(40)
  expect(plant.progress.inventory).toEqual(['plant'])
  expect(old.starBalance).toBe(60)
  const lamp = purchaseAdventureItem(plant.progress, 'lamp')
  expect(lamp.progress.starBalance).toBe(10)
  expect(purchaseAdventureItem(lamp.progress, 'leafboard').progress).toBe(lamp.progress)
  expect(purchaseAdventureItem(lamp.progress, 'plant').progress).toBe(lamp.progress)
  expect(purchaseAdventureItem(lamp.progress, 'unknown').ok).toBe(false)
})

test('equipment requires owned items of the correct kind and can restore the free default', () => {
  let progress = { ...createAdventureProgress(), starBalance: 100 }
  for (const itemId of ['leafboard', 'explorer-scarf', 'plant']) progress = purchaseAdventureItem(progress, itemId).progress
  const board = equipAdventureItem(progress, 'board', 'leafboard')
  expect(board.ok).toBe(true)
  expect(board.progress.equipment.board).toBe('leafboard')
  expect(progress.equipment.board).toBeNull()
  expect(equipAdventureItem(board.progress, 'scarf', 'leafboard').ok).toBe(false)
  expect(equipAdventureItem(board.progress, 'board', 'plant').ok).toBe(false)
  const scarf = equipAdventureItem(board.progress, 'scarf', 'explorer-scarf')
  expect(scarf.progress.equipment.scarf).toBe('explorer-scarf')
  expect(equipAdventureItem(scarf.progress, 'scarf', null).progress.equipment.scarf).toBeNull()
})

test('house placements move a single owned prop between slots instead of duplicating it', () => {
  let progress = { ...createAdventureProgress(), starBalance: 60 }
  progress = purchaseAdventureItem(progress, 'plant').progress
  progress = purchaseAdventureItem(progress, 'lamp').progress
  const left = placeAdventureItem(progress, 'left', 'plant').progress
  const moved = placeAdventureItem(left, 'center', 'plant').progress
  expect(left.placements.left).toBe('plant')
  expect(moved.placements).toEqual({ left: null, center: 'plant', right: null })
  const lamp = placeAdventureItem(moved, 'right', 'lamp').progress
  expect(lamp.placements).toEqual({ left: null, center: 'plant', right: 'lamp' })
  expect(placeAdventureItem(lamp, 'left', 'leafboard').ok).toBe(false)
  expect(placeAdventureItem(lamp, 'center', null).progress.placements.center).toBeNull()
})

test('growth derives from earned experience and collections, never a health or paid-credit balance', () => {
  const derived = deriveAdventureProgress({ ...createAdventureProgress(), xp: 240, clearedLevels: [1, 2], inventory: ['plant'] })
  expect(derived).toEqual({ level: 3, levelXp: 40, xpToNext: 60, totalXp: 240, clearedCount: 2, collectionCount: 1 })
  expect(deriveAdventureProgress({ ...createAdventureProgress(), xp: 100000 }).level).toBe(50)
})

test('local restoration removes malformed fields, duplicate props and nonsequential claimed level unlocks', () => {
  expect(normalizeAdventureProgress({ version: 9 })).toEqual(createAdventureProgress())
  const restored = normalizeAdventureProgress({
    version: 1, xp: NaN, starBalance: -1, clearedLevels: [1, 3], unlockedLevels: [6], storyChapters: [3],
    inventory: ['plant', 'plant', 'lamp', 'unknown'], equipment: { board: 'plant', scarf: 'unknown' },
    placements: { left: 'plant', center: 'plant', right: 'lamp' },
    daily: { date: today, earnedStars: 1000 }, settledRoundIds: ['round', 'round'],
  })
  expect(restored.xp).toBe(0)
  expect(restored.starBalance).toBe(0)
  expect(restored.unlockedLevels).toEqual([1, 2])
  expect(restored.clearedLevels).toEqual([1])
  expect(restored.storyChapters).toEqual([1])
  expect(restored.inventory).toEqual(['plant', 'lamp'])
  expect(restored.equipment).toEqual({ board: null, scarf: null })
  expect(restored.placements).toEqual({ left: 'plant', center: null, right: 'lamp' })
  expect(restored.daily.earnedStars).toBe(60)
  expect(restored.settledRoundIds).toEqual(['round'])
})

test('clearing the six ordered stages unlocks all three stories while repeated clears only improve bests', () => {
  let progress = createAdventureProgress()
  for (let levelId = 1; levelId <= 6; levelId++) {
    const duration = levelId <= 2 ? 45000 : levelId <= 4 ? 50000 : 60000
    progress = settleAdventureRound(progress, `level-${levelId}`, result({ levelId, elapsedMs: duration }), today).progress
  }
  expect(progress.unlockedLevels).toEqual([1, 2, 3, 4, 5, 6])
  expect(progress.storyChapters).toEqual([1, 2, 3])
  expect(progress.clearedLevels).toHaveLength(6)
  const repeat = settleAdventureRound(progress, 'better-level-one', result({ score: 1200 }), today).progress
  expect(repeat.bests['1'].score).toBe(1200)
  expect(repeat.clearedLevels).toHaveLength(6)
})
