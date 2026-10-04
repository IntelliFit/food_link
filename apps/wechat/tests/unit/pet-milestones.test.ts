import { choosePetWish, newGrowthSave, newPetJourney, normalizeGrowthSave, placeGrowthItem, settleGrowthRound, type GrowthRound } from '../../src/utils/pet-growth'

const round = (extra: Partial<GrowthRound> = {}): GrowthRound => ({ game: 'merge', levelId: 1, score: 420, stars: 3, completed: true, collectibles: [], detail: { steps: 4, highestRank: 3 }, ...extra })
const day = '2026-10-02'
it('awards named permanent skill badges once and allows room placement', () => {
  const result = settleGrowthRound(newGrowthSave(), 'a', round(), 'round:1', day)
  expect(result.save.pets.a.badges).toEqual(['merge-first', 'merge-rank'])
  expect(result.message).toContain('食材炼金师')
  expect(placeGrowthItem(result.save, 'a', 'table', 'badge:merge-rank').save.pets.a.placements.table).toBe('badge:merge-rank')
  expect(settleGrowthRound(result.save, 'a', round(), 'round:1', day).save).toBe(result.save)
})
it('unique level route does not advance from repeated clears; capped coins do not block collection', () => {
  let save = newGrowthSave()
  for (let n = 0; n < 3; n++) save = settleGrowthRound(save, 'a', round(), `repeat:${n}`, day).save
  expect(save.pets.a.badges).not.toContain('merge-route')
  for (const levelId of [2, 3]) save = settleGrowthRound(save, 'a', round({ levelId }), `level:${levelId}`, day).save
  expect(save.pets.a.badges).toContain('merge-route')
  expect(save.stars).toBe(6)
})
it('normalizes legacy saves, keeps wishes and mastery isolated per pet', () => {
  const save = newGrowthSave(); save.pets.a = newPetJourney()
  const raw = JSON.parse(JSON.stringify(save)); delete raw.pets.a.badges; delete raw.pets.a.wish; delete raw.pets.a.milestoneProgress
  const restored = normalizeGrowthSave(raw)
  expect(restored.pets.a.badges).toEqual([])
  const chosen = choosePetWish(restored, 'a', 'merge-rank').save
  const next = settleGrowthRound(chosen, 'b', round(), 'other:1', day).save
  expect(next.pets.a.wish).toBe('merge-rank')
  expect(next.pets.a.badges).toEqual([])
  expect(next.pets.b.wish).toBeNull()
  expect(choosePetWish(next, 'a', null).save.pets.b.badges).toEqual(['merge-first', 'merge-rank'])
  expect(choosePetWish(next, 'a', 'unknown').ok).toBe(false)
})
it('does not award mastery for empty participation or failed completion', () => {
  const empty = settleGrowthRound(newGrowthSave(), 'a', round({ detail: { steps: 0, highestRank: 3 } }), 'empty:1', day).save
  expect(empty.pets.a.badges).toEqual([])
  const failed = settleGrowthRound(empty, 'a', round({ game: 'adventure', completed: false, detail: { distance: 50 } }), 'failed:1', day).save
  expect(failed.pets.a.badges).toEqual([])
})
it('retains old mastery but prevents new retired wishes and badges', () => {
  const source = newGrowthSave(); source.pets.a = newPetJourney()
  source.pets.a.badges = ['kitchen-first']; source.pets.a.wish = 'kitchen-combo'
  source.pets.a.milestoneProgress['kitchen-combo'] = 2
  const restored = normalizeGrowthSave(source)
  expect(restored.pets.a).toEqual(source.pets.a)
  expect(choosePetWish(restored, 'a', 'kitchen-combo').ok).toBe(false)
  expect(choosePetWish(restored, 'a', 'explore-route').ok).toBe(false)
  const rejected = settleGrowthRound(restored, 'a', round({ game: 'kitchen', detail: { served: 4, bestCombo: 4 } }), 'retired:1', day)
  expect(rejected.ok).toBe(false); expect(rejected.save).toBe(restored)
  const replaced = choosePetWish(restored, 'a', 'adventure-first').save
  expect(replaced.pets.a.wish).toBe('adventure-first')
  expect(replaced.pets.a.badges).toEqual(['kitchen-first'])
})
