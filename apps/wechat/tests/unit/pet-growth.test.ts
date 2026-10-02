import Taro from '@tarojs/taro'
import {
  GROWTH_CHAPTERS, GROWTH_GAMES, GROWTH_SHOP, buyGrowthItem, chapterTasks, chooseGrowthStory,
  growthLevel, newGrowthSave, newPetJourney, normalizeGrowthSave, placeGrowthItem, settleGrowthRound,
  touchGrowthPet, type GrowthGame, type GrowthRound, type GrowthSave,
} from '../../src/utils/pet-growth'
import { GROWTH_CHANGED, growthStorageKey, readGrowth, writeGrowth } from '../../src/utils/pet-growth-storage'
import { createAdventureProgress } from '../../src/utils/pet-adventure-progress'
import { advanceAdventureGame, applyAdventureAction, createAdventureGame } from '../../src/utils/pet-adventure-game'

const today = '2026-10-02'
const nextDay = '2026-10-03'
const account = 'account-a'
const petA = 'pet-a'
const petB = 'pet-b'
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
let store: Map<string, unknown>
const legacyKey = (user: string, pet: string) => `pet_adventure_progress_v1:${user}:${pet}`

beforeEach(() => {
  jest.clearAllMocks()
  store = new Map([['user_id', account]])
  ;(Taro.getStorageSync as jest.Mock).mockImplementation((key: string) => store.has(key) ? copy(store.get(key)) : undefined)
  ;(Taro.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => { store.set(key, copy(value)) })
})

function round(game: GrowthGame, extra: Partial<GrowthRound> = {}): GrowthRound {
  const landmarks = extra.completed === false ? ['clue'] : extra.levelId === 2 ? ['clue', 'slate', 'letter'] : ['clue', 'canal', 'pebble']
  return { game, levelId: 1, score: 200, completed: true, stars: 2, collectibles: [`${game}-keepsake`],
    ...(game === 'explore' ? { landmarks } : {}),
    detail: { served: 1, steps: 4, moves: extra.levelId === 2 ? 5 : 3, nodes: landmarks.length, distance: extra.completed === false ? 60 : 300 }, ...extra }
}
function finish(save: GrowthSave, game: GrowthGame, id: string, pet = petA, levelId = 1, day = today): GrowthSave {
  const update = settleGrowthRound(save, pet, round(game, { levelId }), id, day)
  expect(update.ok).toBe(true)
  return update.save
}

test('local v2 exposes four games and the existing fixed shop prices, with independent starter objects', () => {
  expect(GROWTH_GAMES.map(item => item.id)).toEqual(['kitchen', 'merge', 'adventure', 'explore'])
  expect(GROWTH_SHOP.map(item => [item.id, item.cost])).toEqual([
    ['plant', 20], ['lamp', 30], ['leafboard', 40], ['explorer-scarf', 30],
  ])
  const first = newGrowthSave()
  const second = newGrowthSave()
  expect(first.stars).toBe(0)
  expect(first.inventory).toEqual(['journey-card', 'cozy-scarf'])
  first.inventory.push('plant')
  first.pets[petA] = newPetJourney()
  expect(second.inventory).not.toContain('plant')
  expect(second.pets).toEqual({})
  expect(growthLevel(39)).toEqual({ level: 1, current: 39, next: 40 })
  expect(growthLevel(40)).toEqual({ level: 2, current: 0, next: 60 })
  expect(growthLevel(460)).toEqual({ level: 6, current: 0, next: 0 })
})

test('greetings add affinity only once per pet per day, never currency or experience', () => {
  const source = newGrowthSave()
  const first = touchGrowthPet(source, petA, today)
  expect(first.save.pets[petA]).toMatchObject({ affinity: 2, xp: 0 })
  expect(first.save.stars).toBe(0)
  const repeated = touchGrowthPet(first.save, petA, today)
  expect(repeated.save).toBe(first.save)
  const other = touchGrowthPet(repeated.save, petB, today)
  expect(other.save.pets[petB].affinity).toBe(2)
  expect(other.save.pets[petA].affinity).toBe(2)
  expect(source.pets).toEqual({})
})

test.each<GrowthGame>(['kitchen', 'merge', 'adventure', 'explore'])('%s normal failure earns its first valid participation reward without unlocking a level', game => {
  const source = newGrowthSave()
  const result = settleGrowthRound(source, petA, round(game, { completed: false, stars: 0 }), `failed-${game}`, today)
  expect(result.ok).toBe(true)
  expect(result.save.stars).toBe(6)
  expect(result.save.daily).toEqual({ day: today, games: [game], earned: 6 })
  expect(result.save.pets[petA]).toMatchObject({ xp: 10, affinity: 4 })
  expect(result.save.pets[petA].cleared[game]).toEqual([])
  expect(result.save.inventory).toContain(`${game}-keepsake`)
  expect(source).toEqual(newGrowthSave())
})

test('an insufficient-participation terminal result cannot award currency, XP, affinity or collection', () => {
  let save = newGrowthSave()
  for (const game of ['kitchen', 'merge', 'adventure', 'explore'] as GrowthGame[]) {
    save = settleGrowthRound(save, petA, round(game, { completed: false, stars: 0, detail: {} }), `empty-${game}`, today).save
  }
  expect(save.stars).toBe(0)
  expect(save.daily.earned).toBe(0)
  expect(save.pets[petA]).toMatchObject({ xp: 0, affinity: 0, landmarks: 0 })
  expect(save.inventory).toEqual(newGrowthSave().inventory)
})

test('the actual adventure timeout at the first automatic fork is not eligible participation', () => {
  const idle = advanceAdventureGame(applyAdventureAction(createAdventureGame(1, 102), { type: 'start' }), 90000)
  expect(idle.result).toMatchObject({ completed: false, distance: 25 })
  const result = idle.result!
  const update = settleGrowthRound(newGrowthSave(), petA, {
    game: 'adventure', levelId: result.levelId, score: result.score, completed: result.completed,
    stars: result.stars, collectibles: result.collectibleIds || [], detail: { distance: result.distance },
  }, 'idle-fork-timeout', today)
  expect(update.ok).toBe(true)
  expect(update.save.stars).toBe(0)
  expect(update.save.pets[petA]).toMatchObject({ xp: 0, affinity: 0, cleared: { adventure: [] } })
  expect(update.save.daily.games).not.toContain('adventure')
  const afterActualPlay = settleGrowthRound(update.save, petA, round('adventure', { completed: false, detail: { distance: 40 } }), 'participated-after-fork', today)
  expect(afterActualPlay.save.stars).toBe(6)
})

test('revisiting the same real water node after exit, reload or a later day never adds another landmark', () => {
  const observed = round('explore', { completed: false, stars: 0, score: 50, collectibles: [], landmarks: ['clue'], detail: { moves: 2, nodes: 1 } })
  const first = settleGrowthRound(newGrowthSave(), petA, observed, 'water-first-trip', today).save
  expect(first.pets[petA].seenLandmarks).toEqual(['explore:1:clue'])
  const reopened = normalizeGrowthSave(copy(first))
  const repeated = settleGrowthRound(reopened, petA, observed, 'water-reopened-trip', today).save
  expect(repeated.pets[petA].landmarks).toBe(1)
  expect(repeated.pets[petA].seenLandmarks).toEqual(['explore:1:clue'])
  expect(repeated.stars).toBe(6)
  const later = settleGrowthRound(normalizeGrowthSave(copy(repeated)), petA, observed, 'water-later-day', nextDay).save
  expect(later.pets[petA].landmarks).toBe(1)
  expect(later.stars).toBe(12)
  const newSource = settleGrowthRound(later, petA, round('explore', { completed: false, landmarks: ['clue', 'canal'], detail: { moves: 2, nodes: 1 } }), 'water-new-canal', nextDay).save
  expect(newSource.pets[petA].seenLandmarks).toEqual(['explore:1:clue', 'explore:1:canal'])
  expect(newSource.pets[petA].landmarks).toBe(2)
})

test('numeric node counts alone cannot invent a chapter landmark or restore unverifiable counts', () => {
  const numericOnly = settleGrowthRound(newGrowthSave(), petA, round('explore', { landmarks: undefined, detail: { moves: 2, nodes: 3 } }), 'no-landmark-sources', today).save
  expect(numericOnly.pets[petA].landmarks).toBe(0)
  expect(numericOnly.pets[petA].seenLandmarks).toEqual([])
  expect(chapterTasks(numericOnly, petA, 1)[0].done).toBe(false)
  const corrupted = copy(numericOnly)
  corrupted.pets[petA].landmarks = 99
  expect(normalizeGrowthSave(corrupted).pets[petA].landmarks).toBe(0)
})

test('identical raw water node IDs stay separate across levels and pets, while duplicate cumulative entries are collapsed', () => {
  const clue = { completed: false, landmarks: ['clue', 'clue'], detail: { moves: 2, nodes: 1 } }
  let save = settleGrowthRound(newGrowthSave(), petA, round('explore', clue), 'level-one-clue', today).save
  save = settleGrowthRound(save, petA, round('explore', { ...clue, levelId: 2 }), 'level-two-clue', today).save
  save = settleGrowthRound(save, petB, round('explore', clue), 'other-pet-clue', today).save
  expect(save.pets[petA].seenLandmarks).toEqual(['explore:1:clue', 'explore:2:clue'])
  expect(save.pets[petA].landmarks).toBe(2)
  expect(save.pets[petB].seenLandmarks).toEqual(['explore:1:clue'])
  expect(save.pets[petB].landmarks).toBe(1)
})

test('an already-settled round is idempotent even on another day or against another pet', () => {
  const first = finish(newGrowthSave(), 'explore', 'permanent-round')
  const repeated = settleGrowthRound(first, petB, round('explore', { score: 999 }), 'permanent-round', nextDay)
  expect(repeated.ok).toBe(true)
  expect(repeated.save).toBe(first)
  expect(first.rounds).toEqual(['permanent-round'])
  expect(first.pets[petA].landmarks).toBe(3)
  expect(first.pets[petB]).toBeUndefined()
})

test('every accepted round ID remains protected after normalization and a later-day replay', () => {
  const id = 'round with spaces'
  const first = settleGrowthRound(newGrowthSave(), petA, round('merge'), id, today)
  const restored = normalizeGrowthSave(copy(first.save))
  const replay = settleGrowthRound(restored, petA, round('merge'), id, nextDay)
  expect(replay.save.stars).toBe(first.save.stars)
  if (first.ok) {
    expect(restored.rounds).toContain(id)
    expect(replay.save.pets[petA].xp).toBe(first.save.pets[petA].xp)
  }
})

test('one account shares four first-game rewards across pets, with a daily total of 24 rather than report cloud limits', () => {
  let save = newGrowthSave()
  save = finish(save, 'kitchen', 'kitchen-a', petA)
  save = finish(save, 'kitchen', 'kitchen-b', petB)
  expect(save.stars).toBe(6)
  for (const game of ['merge', 'adventure', 'explore'] as GrowthGame[]) save = finish(save, game, `${game}-b`, petB)
  expect(save.stars).toBe(24)
  expect(save.daily.earned).toBe(24)
  expect(save.daily.games).toHaveLength(4)
  save = finish(save, 'explore', 'explore-new-level', petA, 2)
  expect(save.stars).toBe(24)
  expect(save.pets[petA].cleared.explore).toEqual([2])
  expect(save.inventory).toContain('explore-keepsake')
})

test('daily pet XP and affinity are capped independently of the 24 account currency cap', () => {
  let save = touchGrowthPet(newGrowthSave(), petA, today).save
  for (const game of ['kitchen', 'merge', 'adventure', 'explore'] as GrowthGame[]) save = finish(save, game, `daily-${game}`)
  expect(save.stars).toBe(24)
  expect(save.pets[petA]).toMatchObject({ xp: 20, affinity: 10 })
  expect(save.pets[petA].daily).toEqual({ day: today, xp: 20, affinity: 10, touch: true })
  const next = finish(save, 'merge', 'next-day-merge', petA, 1, nextDay)
  expect(next.stars).toBe(30)
  expect(next.daily).toEqual({ day: nextDay, games: ['merge'], earned: 6 })
  expect(next.pets[petA]).toMatchObject({ xp: 30, affinity: 14 })
})

test('date rollback and impossible calendar dates never reset the claimed day or consume a new round ID', () => {
  const source = finish(newGrowthSave(), 'kitchen', 'newer-day', petA, 1, nextDay)
  for (const day of [today, '2026-02-30', 'invalid']) {
    const rejected = settleGrowthRound(source, petB, round('merge'), `rollback-${day}`, day)
    expect(rejected.ok).toBe(false)
    expect(rejected.save).toBe(source)
    const greeting = touchGrowthPet(source, petA, day)
    expect(greeting.ok).toBe(false)
    expect(greeting.save).toBe(source)
  }
  expect(source.rounds).toEqual(['newer-day'])
  expect(source.daily).toEqual({ day: nextDay, games: ['kitchen'], earned: 6 })
})

test('invalid result scores, stars, level IDs and empty IDs cannot mutate the ledger', () => {
  const source = newGrowthSave()
  const invalid = [round('merge', { score: NaN }), round('merge', { score: -1 }), round('merge', { stars: 4 }), round('merge', { levelId: 7 })]
  for (const result of invalid) {
    const rejected = settleGrowthRound(source, petA, result, 'invalid-result', today)
    expect(rejected.ok).toBe(false)
    expect(rejected.save).toBe(source)
  }
  expect(settleGrowthRound(source, petA, round('merge'), '', today).ok).toBe(false)
  expect(settleGrowthRound(source, '', round('merge'), 'empty-pet', today).ok).toBe(false)
})

test('completed flags without actual participation cannot mark levels or open chapter tasks', () => {
  const source = newGrowthSave()
  const attempted = settleGrowthRound(source, petA, round('merge', { completed: true, detail: { steps: 0 } }), 'unplayed-clear', today)
  expect(attempted.save.pets[petA]?.cleared.merge || []).toEqual([])
  expect(chapterTasks(attempted.save, petA, 2)[1].done).toBe(false)
  expect(attempted.save.stars).toBe(0)
})

test('three chapters require their actual tasks and prior story, with one-time rewards and retained choices', () => {
  let save = newGrowthSave()
  expect(chapterTasks(save, petA, 1).every(task => task.done)).toBe(false)
  expect(chooseGrowthStory(save, petA, 1, GROWTH_CHAPTERS[0].choices[0]).ok).toBe(false)
  save = finish(save, 'explore', 'chapter-landmarks')
  save = finish(save, 'kitchen', 'chapter-meal')
  expect(chapterTasks(save, petA, 1).map(task => task.done)).toEqual([true, true, false])
  save = placeGrowthItem(save, petA, 'table', 'journey-card').save
  expect(chapterTasks(save, petA, 1).every(task => task.done)).toBe(true)
  expect(chapterTasks(save, petB, 1).every(task => task.done)).toBe(false)
  const beforeStory = save.pets[petA].xp
  save = chooseGrowthStory(save, petA, 1, GROWTH_CHAPTERS[0].choices[0]).save
  expect(save.pets[petA].xp).toBe(beforeStory + 30)
  const currency = save.stars
  save = finish(save, 'explore', 'chapter-two-explore', petA, 2)
  save = finish(save, 'merge', 'chapter-two-merge')
  expect(chapterTasks(save, petA, 2).every(task => task.done)).toBe(true)
  save = chooseGrowthStory(save, petA, 2, GROWTH_CHAPTERS[1].choices[1]).save
  save = finish(save, 'kitchen', 'chapter-three-kitchen', petA, 2)
  expect(chapterTasks(save, petA, 3).map(task => task.done)).toEqual([true, false, true])
  save = finish(save, 'adventure', 'chapter-three-adventure', petA, 2)
  save = chooseGrowthStory(save, petA, 3, GROWTH_CHAPTERS[2].choices[0]).save
  expect(save.pets[petA].chapters).toEqual([1, 2, 3])
  expect(save.stars).toBe(currency + 12)
  for (const chapter of GROWTH_CHAPTERS) expect(save.inventory.filter(id => id === chapter.reward)).toHaveLength(1)
  const beforeReplay = copy(save)
  save = chooseGrowthStory(save, petA, 1, GROWTH_CHAPTERS[0].choices[1]).save
  expect(save.pets[petA].xp).toBe(beforeReplay.pets[petA].xp)
  expect(save.stars).toBe(beforeReplay.stars)
  expect(save.inventory).toEqual(beforeReplay.inventory)
  expect(save.pets[petA].choices['1']).toBe(GROWTH_CHAPTERS[0].choices[1])
  expect(normalizeGrowthSave(copy(save)).pets[petA].choices).toEqual(save.pets[petA].choices)
  expect(chooseGrowthStory(save, petA, 1, 'a forged branch').ok).toBe(false)
})

test('one owned decor moves between slots, while clothing and board cannot enter furniture slots', () => {
  const source = newGrowthSave()
  const first = placeGrowthItem(source, petA, 'window', 'journey-card').save
  const moved = placeGrowthItem(first, petA, 'table', 'journey-card').save
  expect(moved.pets[petA].placements).toEqual({ window: null, table: 'journey-card', floor: null })
  expect(first.pets[petA].placements.window).toBe('journey-card')
  expect(placeGrowthItem(moved, petA, 'floor', 'cozy-scarf').ok).toBe(false)
  expect(placeGrowthItem(moved, petA, 'floor', 'unowned-item').ok).toBe(false)
  expect(placeGrowthItem(moved, petA, 'table', null).save.pets[petA].placements.table).toBeNull()
})

test('fixed purchases spend only currency once, never XP or affinity', () => {
  let save = newGrowthSave()
  save.stars = 60
  save.pets[petA] = { ...newPetJourney(), xp: 40, affinity: 8 }
  const plant = buyGrowthItem(save, 'plant')
  expect(plant.save.stars).toBe(40)
  expect(plant.save.inventory.filter(id => id === 'plant')).toHaveLength(1)
  expect(plant.save.pets[petA]).toMatchObject({ xp: 40, affinity: 8 })
  expect(save.stars).toBe(60)
  expect(buyGrowthItem(plant.save, 'plant').save).toBe(plant.save)
  const lamp = buyGrowthItem(plant.save, 'lamp').save
  expect(lamp.stars).toBe(10)
  expect(buyGrowthItem(lamp, 'leafboard').save).toBe(lamp)
  expect(buyGrowthItem(lamp, 'cloud-80-scarf').ok).toBe(false)
})

test('v1 migration preserves balance, XP, known items and placements, retains the original and imports each pet once', () => {
  const legacy = { ...createAdventureProgress(), starBalance: 45, xp: 85, clearedLevels: [1, 2], inventory: ['plant', 'lamp', 'explorer-scarf'], placements: { left: 'plant', center: 'lamp', right: null }, daily: { date: today, earnedStars: 60 } }
  store.set(legacyKey(account, petA), copy(legacy))
  const first = readGrowth(account, petA)
  expect(first.stars).toBe(45)
  expect(first.pets[petA]).toMatchObject({ xp: 85, cleared: { adventure: [1, 2] }, placements: { window: 'plant', table: 'lamp', floor: null } })
  expect(first.inventory).toEqual(expect.arrayContaining(['journey-card', 'cozy-scarf', 'plant', 'lamp', 'explorer-scarf']))
  expect(first.migratedPets).toEqual([petA])
  expect(store.get(legacyKey(account, petA))).toEqual(legacy)
  expect(readGrowth(account, petA)).toEqual(first)
  expect(Taro.setStorageSync).toHaveBeenCalledTimes(1)
  expect(Taro.removeStorageSync).not.toHaveBeenCalled()
  store.set(legacyKey(account, petB), { ...createAdventureProgress(), starBalance: 15, xp: 10 })
  const secondPet = readGrowth(account, petB)
  expect(secondPet.stars).toBe(60)
  expect(secondPet.pets[petA].xp).toBe(85)
  expect(secondPet.pets[petB].xp).toBe(10)
  expect(readGrowth(account, petA).stars).toBe(60)
  expect(secondPet.daily.earned).toBe(0)
})

test('an already-rewarded v1 round cannot be rewarded again after migration to v2', () => {
  const legacy = { ...createAdventureProgress(), starBalance: 50, xp: 30, settledRoundIds: ['legacy-settled-round'] }
  store.set(legacyKey(account, petA), copy(legacy))
  const migrated = readGrowth(account, petA)
  const replay = settleGrowthRound(migrated, petA, round('adventure'), 'legacy-settled-round', today)
  expect(replay.save.stars).toBe(50)
  expect(replay.save.pets[petA].xp).toBe(30)
  expect(store.get(legacyKey(account, petA))).toEqual(legacy)
})

test('migration retains adventure bests without lowering newer scores or granting old story rewards', () => {
  const existing = newGrowthSave()
  existing.pets[petA] = { ...newPetJourney(), bests: { 'adventure:1': { score: 1700, stars: 1 } } }
  store.set(growthStorageKey(account), copy(existing))
  const legacy = { ...createAdventureProgress(), clearedLevels: [1, 2], storyChapters: [1], bests: { '1': { score: 1299, stars: 3, completed: true }, '2': { score: 1520, stars: 2, completed: true } } }
  store.set(legacyKey(account, petA), copy(legacy))
  const restored = readGrowth(account, petA)
  expect(restored.pets[petA].bests).toEqual({ 'adventure:1': { score: 1700, stars: 3 }, 'adventure:2': { score: 1520, stars: 2 } })
  expect(restored.pets[petA].chapters).toEqual([])
  expect(restored.stars).toBe(0)
  expect(readGrowth(account, petA)).toEqual(restored)
  expect(store.get(legacyKey(account, petA))).toEqual(legacy)
})

test('migration write failure leaves both existing v2 and legacy recovery copies intact; retry imports once', () => {
  const existing = newGrowthSave()
  existing.stars = 12
  existing.pets[petB] = { ...newPetJourney(), affinity: 7 }
  existing.migratedPets = [petB]
  const legacy = { ...createAdventureProgress(), starBalance: 20, xp: 40, inventory: ['plant'] }
  store.set(growthStorageKey(account), copy(existing))
  store.set(legacyKey(account, petA), copy(legacy))
  ;(Taro.setStorageSync as jest.Mock).mockImplementationOnce(() => { throw new Error('quota exceeded') })
  expect(() => readGrowth(account, petA)).toThrow('旧进度已保留')
  expect(store.get(growthStorageKey(account))).toEqual(existing)
  expect(store.get(legacyKey(account, petA))).toEqual(legacy)
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  const retry = readGrowth(account, petA)
  expect(retry.stars).toBe(32)
  expect(retry.pets[petA].xp).toBe(40)
  expect(readGrowth(account, petA).stars).toBe(32)
})

test('a failed settled-result write keeps the persisted balance and allows the same original round to be retried once', () => {
  const stored = readGrowth(account, petA)
  const settled = finish(stored, 'merge', 'retry-same-round')
  const originalRevision = settled.revision
  ;(Taro.setStorageSync as jest.Mock).mockImplementationOnce(() => { throw new Error('storage failure') })
  ;(Taro.eventCenter.trigger as jest.Mock).mockClear()
  expect(writeGrowth(account, settled)).toBe(false)
  expect(settled.revision).toBe(originalRevision)
  expect(store.get(growthStorageKey(account))).toEqual(stored)
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  const retried = finish(readGrowth(account, petA), 'merge', 'retry-same-round')
  expect(writeGrowth(account, retried)).toBe(true)
  expect(retried.revision).toBe(originalRevision + 1)
  const reread = readGrowth(account, petA)
  expect(reread.stars).toBe(6)
  expect(reread.rounds).toEqual(['retry-same-round'])
  expect(settleGrowthRound(reread, petA, round('merge'), 'retry-same-round', nextDay).save.stars).toBe(6)
  expect(Taro.eventCenter.trigger).toHaveBeenCalledWith(GROWTH_CHANGED)
})

test('revisionless v2 saves remain compatible and advance revision only on a successful write', () => {
  const original = newGrowthSave()
  original.stars = 40
  original.migratedPets = [petA]
  original.pets[petA] = { ...newPetJourney(), xp: 85 }
  original.inventory.push('plant')
  original.rounds.push('before-revisions')
  const { revision: _revision, ...legacyV2 } = original
  store.set(growthStorageKey(account), copy(legacyV2))
  const loaded = readGrowth(account, petA)
  expect(loaded.revision).toBe(0)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(loaded).toMatchObject({ stars: 40, inventory: original.inventory, rounds: ['before-revisions'], pets: { [petA]: { xp: 85 } } })
  const updated = touchGrowthPet(loaded, petA, today).save
  expect(writeGrowth(account, updated)).toBe(true)
  expect(updated.revision).toBe(1)
  expect(readGrowth(account, petA)).toEqual(updated)
  expect(loaded.revision).toBe(0)
})

test('a stale page cannot overwrite a purchase, settled round or shared daily reward; rereading permits one safe retry', () => {
  const initial = newGrowthSave()
  initial.stars = 40
  initial.migratedPets = [petA]
  initial.pets[petA] = newPetJourney()
  initial.rounds = ['already-imported']
  store.set(growthStorageKey(account), copy(initial))
  const pageA = readGrowth(account, petA)
  const pageB = readGrowth(account, petA)
  const purchased = buyGrowthItem(pageB, 'leafboard')
  expect(purchased.ok).toBe(true)
  const committedB = finish(purchased.save, 'kitchen', 'page-b-kitchen')
  expect(writeGrowth(account, committedB)).toBe(true)
  expect(committedB.revision).toBe(1)
  const staleA = finish(pageA, 'merge', 'page-a-merge')
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  ;(Taro.eventCenter.trigger as jest.Mock).mockClear()
  expect(writeGrowth(account, staleA)).toBe(false)
  expect(staleA.revision).toBe(0)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  expect(readGrowth(account, petA)).toEqual(committedB)
  expect(readGrowth(account, petA)).toMatchObject({ stars: 6, inventory: expect.arrayContaining(['leafboard']), rounds: ['already-imported', 'page-b-kitchen'], daily: { games: ['kitchen'], earned: 6 } })
  const retriedA = finish(readGrowth(account, petA), 'merge', 'page-a-merge')
  expect(writeGrowth(account, retriedA)).toBe(true)
  expect(retriedA).toMatchObject({ revision: 2, stars: 12, inventory: expect.arrayContaining(['leafboard']), rounds: ['already-imported', 'page-b-kitchen', 'page-a-merge'], daily: { games: ['kitchen', 'merge'], earned: 12 } })
  const repeatedA = finish(readGrowth(account, petA), 'merge', 'page-a-merge')
  expect(repeatedA.stars).toBe(12)
  expect(repeatedA.rounds).toEqual(retriedA.rounds)
  expect(repeatedA.pets[petA]).toEqual(retriedA.pets[petA])
})

test('two stale shop snapshots cannot spend the same currency twice or discard the first purchased item', () => {
  const initial = newGrowthSave()
  initial.stars = 60
  initial.migratedPets = [petA]
  initial.pets[petA] = newPetJourney()
  store.set(growthStorageKey(account), copy(initial))
  const oldSnapshot = readGrowth(account, petA)
  const newer = buyGrowthItem(readGrowth(account, petA), 'plant').save
  expect(writeGrowth(account, newer)).toBe(true)
  const stalePurchase = buyGrowthItem(oldSnapshot, 'lamp').save
  expect(writeGrowth(account, stalePurchase)).toBe(false)
  expect(readGrowth(account, petA)).toMatchObject({ revision: 1, stars: 40, inventory: expect.arrayContaining(['plant']) })
  expect(readGrowth(account, petA).inventory).not.toContain('lamp')
  const currentPurchase = buyGrowthItem(readGrowth(account, petA), 'lamp').save
  expect(writeGrowth(account, currentPurchase)).toBe(true)
  expect(readGrowth(account, petA)).toMatchObject({ revision: 2, stars: 10, inventory: expect.arrayContaining(['plant', 'lamp']) })
})

test('switching accounts cannot read or overwrite the previous account and keeps same-ID pets isolated', () => {
  const savedA = finish(readGrowth(account, petA), 'merge', 'account-a-round')
  expect(writeGrowth(account, savedA)).toBe(true)
  store.set('user_id', 'account-b')
  ;(Taro.setStorageSync as jest.Mock).mockClear()
  ;(Taro.eventCenter.trigger as jest.Mock).mockClear()
  expect(() => readGrowth(account, petA)).toThrow('账号已经变化')
  expect(writeGrowth(account, savedA)).toBe(false)
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(Taro.eventCenter.trigger).not.toHaveBeenCalled()
  const savedB = readGrowth('account-b', petA)
  expect(savedB.stars).toBe(0)
  expect(savedB.pets[petA].xp).toBe(0)
  expect(store.get(growthStorageKey(account))).toEqual(savedA)
  expect(store.get(growthStorageKey('account-b'))).toEqual(savedB)
})

test('a refresh subscriber failure cannot turn an already-persisted result into a reported write failure', () => {
  const save = finish(newGrowthSave(), 'merge', 'notification-failure-round')
  ;(Taro.eventCenter.trigger as jest.Mock).mockImplementationOnce(() => { throw new Error('subscriber failed') })
  expect(writeGrowth(account, save)).toBe(true)
  expect(store.get(growthStorageKey(account))).toEqual(save)
  const restored = normalizeGrowthSave(copy(store.get(growthStorageKey(account))))
  expect(settleGrowthRound(restored, petA, round('merge'), 'notification-failure-round', nextDay).save.stars).toBe(6)
})

test('unreadable current or legacy saves are preserved and never replaced with an empty account', () => {
  const malformed = { version: 99, stars: 100 }
  store.set(growthStorageKey(account), malformed)
  expect(() => readGrowth(account, petA)).toThrow()
  expect(Taro.setStorageSync).not.toHaveBeenCalled()
  expect(store.get(growthStorageKey(account))).toEqual(malformed)
  store.delete(growthStorageKey(account))
  const brokenLegacy = { version: 9, starBalance: 300 }
  store.set(legacyKey(account, petA), brokenLegacy)
  expect(() => readGrowth(account, petA)).toThrow('旧成长存档无法读取')
  expect(store.get(legacyKey(account, petA))).toEqual(brokenLegacy)
  expect(store.has(growthStorageKey(account))).toBe(false)
})
