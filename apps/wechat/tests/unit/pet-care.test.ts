import { claimPetCare, claimPetCareMilestone, exerciseCareEvidence, savePetCareSession, cancelPetCareSession, consumePetCareItem, waterCareEvidence } from '../../src/utils/pet-care'
import { newGrowthSave, newPetJourney, normalizeGrowthSave, settleGrowthRound } from '../../src/utils/pet-growth'
import type { BodyMetricsSummary, ExerciseLogItem } from '../../src/utils/api'
import type { PetCareSession } from '../../src/utils/pet-care-schema'

const day = '2026-10-05'; const tomorrow = '2026-10-06'
const water = { date: day, recordId: 'water-1', amount: 250 }
const timer = (extra: Partial<PetCareSession> = {}): PetCareSession => ({ id: 'timer:one', petId: 'a', appearance: 'jianwen-01', kind: 'work', day, targetMs: 300000, elapsedMs: 0, status: 'running', ...extra })
const summary = (extra: Record<string, unknown>): BodyMetricsSummary => extra as unknown as BodyMetricsSummary

test('four daily activities share the existing wallet and each grant one reward across pet switches', () => {
  let save = claimPetCare(newGrowthSave(), 'a', 'water', day, water).save
  save = claimPetCare(save, 'a', 'exercise', day, { date: day, recordId: 'exercise-1' }).save
  for (const kind of ['work', 'rest'] as const) {
    const session = timer({ kind, id: `timer:${kind}`, targetMs: kind === 'work' ? 300000 : 60000 })
    save = savePetCareSession(save, session).save
    save = claimPetCare(save, 'a', kind, day, undefined, { ...session, elapsedMs: session.targetMs }).save
  }
  expect(save.stars).toBe(8); expect(save.pets.a).toMatchObject({ xp: 20, affinity: 4, care: { water: 1, exercise: 1, work: 1, rest: 1 } })
  expect(save.care?.activeDays).toEqual([day]); expect(save.daily.earned).toBe(0)
  const duplicate = claimPetCare(save, 'b', 'water', day, water)
  expect(duplicate.ok).toBe(true); expect(duplicate.save).toBe(save); expect(duplicate.save.pets.b).toBeUndefined()
  const next = claimPetCare(save, 'b', 'water', tomorrow, { ...water, date: tomorrow })
  expect(next.save.stars).toBe(10); expect(next.save.pets.b.care?.water).toBe(1)
})

test('saved reward receipts survive deleted and recreated records, and rejected evidence leaves source intact', () => {
  const source = newGrowthSave()
  for (const evidence of [undefined, { ...water, amount: 0 }, { ...water, amount: NaN }, { ...water, date: tomorrow }]) {
    const result = claimPetCare(source, 'a', 'water', day, evidence)
    expect(result.ok).toBe(false); expect(result.save).toBe(source)
  }
  const rewarded = claimPetCare(source, 'a', 'water', day, water).save
  expect(claimPetCare(rewarded, 'b', 'water', day, { ...water, recordId: 'recreated' }).save).toBe(rewarded)
  expect(claimPetCare(rewarded, 'b', 'water', '2026-02-30', water).ok).toBe(false)
})

test('evidence requires a positive dated saved water entry and a dated real exercise ID, including zero-calorie logs', () => {
  expect(waterCareEvidence(summary({ water_daily: [{ date: day, total: 250, logs: [250] }] }), day)).toMatchObject({ date: day, amount: 250 })
  expect(waterCareEvidence(summary({ today_water: { date: day, total: 350, logs: [], log_items: [{ id: 'w', date: day, amount_ml: 350 }] } }), day)?.recordId).toBe('w')
  expect(waterCareEvidence(summary({ water_daily: [{ date: tomorrow, total: 500, logs: [500] }] }), day)).toBeNull()
  expect(waterCareEvidence(summary({ today_water: { date: day, total: 250, logs: [] } }), day)).toBeNull()
  expect(exerciseCareEvidence([{ id: 'e', recorded_on: day, calories_burned: 0 } as ExerciseLogItem], day)?.recordId).toBe('e')
  expect(exerciseCareEvidence([{ id: 'pending' } as ExerciseLogItem], day)).toBeNull()
})

test('care XP and coins remain available after game caps, without altering historical 24-coin records', () => {
  const old = newGrowthSave(); old.daily = { day, games: ['kitchen', 'merge', 'adventure', 'explore'], earned: 24 }
  old.pets.a = newPetJourney(); old.pets.a.daily = { day, xp: 20, affinity: 10, touch: true }
  const result = claimPetCare(old, 'a', 'water', day, water)
  expect(result.save.pets.a.xp).toBe(5); expect(result.save.daily).toEqual(old.daily)
  expect(result.save.pets.a.daily).toEqual(old.pets.a.daily)
  const game = settleGrowthRound(result.save, 'a', { game: 'merge', levelId: 1, score: 420, completed: true, stars: 3, collectibles: [], detail: { served: 1, steps: 4 } }, 'game:late', day)
  expect(game.save.stars).toBe(2)
})

test('timer checkpoints keep identity, date and duration fixed, reject competing sessions and progress rollback', () => {
  const started = savePetCareSession(newGrowthSave(), timer()).save
  for (const extra of [{ id: 'timer:other' }, { appearance: 'other' }, { kind: 'rest' as const, targetMs: 60000 }, { day: tomorrow }, { targetMs: 900000 }]) expect(savePetCareSession(started, timer(extra)).ok).toBe(false)
  const paused = savePetCareSession(started, timer({ elapsedMs: 5000, status: 'paused' })).save
  expect(savePetCareSession(paused, timer({ elapsedMs: 4000 })).ok).toBe(false)
  expect(claimPetCare(paused, 'a', 'work', day, undefined, timer({ elapsedMs: 299999 })).ok).toBe(false)
  expect(claimPetCare(paused, 'a', 'work', day, undefined, timer({ elapsedMs: 300000, appearance: 'other' })).ok).toBe(false)
  const cancelled = cancelPetCareSession(paused, 'a', 'timer:one').save
  expect(savePetCareSession(cancelled, timer({ id: 'timer:new', kind: 'rest', targetMs: 60000 })).ok).toBe(true)
})

test('a completed prior-day timer can retry once without resetting today or losing today rewards', () => {
  let save = savePetCareSession(newGrowthSave(), timer({ elapsedMs: 300000, status: 'paused' })).save
  save = claimPetCare(save, 'b', 'water', tomorrow, { ...water, date: tomorrow }).save
  expect(savePetCareSession(save, timer({ elapsedMs: 300000, status: 'paused' })).ok).toBe(true)
  const recovered = claimPetCare(save, 'a', 'work', day, undefined, timer({ elapsedMs: 300000, status: 'paused' }))
  expect(recovered.ok).toBe(true); expect(recovered.save.care).toMatchObject({ day: tomorrow, claimed: { water: 'b' } })
  expect(recovered.save.stars).toBe(4)
  expect(claimPetCare(recovered.save, 'b', 'work', day, undefined, timer({ elapsedMs: 300000 })).save).toBe(recovered.save)
})

test('token consumption grants growth atomically, is idempotent and has a shared daily limit', () => {
  const source = newGrowthSave(); source.stars = 20
  const first = consumePetCareItem(source, 'a', 'snack', 'care-use:first', day)
  expect(source.stars).toBe(20); expect(first.save.stars).toBe(16); expect(first.save.pets.a).toMatchObject({ xp: 2, affinity: 2 })
  expect(consumePetCareItem(first.save, 'b', 'ball', 'care-use:first', day).save).toBe(first.save)
  let save = consumePetCareItem(first.save, 'b', 'ball', 'care-use:second', day).save
  save = consumePetCareItem(save, 'b', 'ball', 'care-use:third', day).save
  expect(save.stars).toBe(4); expect(consumePetCareItem(save, 'a', 'snack', 'care-use:fourth', day).ok).toBe(false)
  expect(consumePetCareItem(newGrowthSave(), 'a', 'ball', 'care-use:empty', day).ok).toBe(false)
  expect(consumePetCareItem(save, 'a', 'snack', 'care-use:next', tomorrow).save.stars).toBe(0)
})

test('level souvenirs are free, placeable inventory items and cannot be reclaimed for extra rewards', () => {
  const source = newGrowthSave(); source.pets.a = newPetJourney()
  expect(claimPetCareMilestone(source, 'a', 2).ok).toBe(false)
  source.pets.a.xp = 40
  const claimed = claimPetCareMilestone(source, 'a', 2)
  expect(claimed.save.inventory).toContain('care-sprout'); expect(claimed.save.stars).toBe(0); expect(claimed.save.pets.a.xp).toBe(40)
  expect(claimPetCareMilestone(claimed.save, 'a', 2).save).toBe(claimed.save)
})

test('legacy data remains intact and new care records survive normalization with sessions always paused', () => {
  const source = newGrowthSave(); source.stars = 79; source.pets.a = newPetJourney()
  source.inventory.push('kitchen-keepsake'); source.rounds.push('historic:round'); source.pets.a.cleared.explore = [1, 2]
  expect(normalizeGrowthSave(source)).toEqual(source)
  const withCare = savePetCareSession(claimPetCare(source, 'a', 'water', day, water).save, timer({ elapsedMs: 5250 })).save
  const normalized = normalizeGrowthSave(withCare)
  expect(normalized.care?.sessions.a).toMatchObject({ elapsedMs: 5250, status: 'paused' })
  expect(normalized.pets.a.care?.water).toBe(1); expect(normalized.inventory).toContain('kitchen-keepsake'); expect(normalized.pets.a.cleared.explore).toEqual([1, 2])
  expect(normalized.stars).toBe(81)
})
