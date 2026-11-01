import Taro from '@tarojs/taro'

import { engine, type Exposures } from '../../src/packageLifespan/engine/engine'
import { lifeCardsFor } from '../../src/packageLifespan/model/habits'
import {
  ageFromBirthday,
  clearPeople,
  draftToPredictee,
  draftWithHealthProfile,
  emptyDraft,
  loadPeople,
  predicteeToDraft,
  savePeople,
  validateDraft,
  type Predictee,
} from '../../src/packageLifespan/model/people'
import {
  adherenceOptions,
  applyLifeCards,
  buildModel,
  DEFAULT_PLAN,
  isSameExposures,
  lateStart,
  lifeCardValues,
  parallelLives,
  planOf,
  planPhrase,
  playOutcome,
  signedYears,
  topChanges,
} from '../../src/packageLifespan/model/predictor'

const ME: Predictee = {
  id: 'me', label: '我', sex: 'male', age: 32, height_cm: 175, weight_kg: 78, smoking: 'never', alcohol: 'less_than_daily',
  pa_met_h: 14, fruit_g: 60, fish_g: 15, sleep_h: 6.5, energy_balance_kcal: 60,
}
const model = buildModel(ME)
const options = adherenceOptions('male')

describe('predictor model', () => {
  it('builds the three futures from the same person', () => {
    const [today, right, loose] = model.branches
    expect(today.le.mean).toBeCloseTo(78.71, 1)
    expect(right.le.mean).toBeGreaterThan(today.le.mean)
    expect(loose.le.mean).toBeLessThan(today.le.mean)
    expect(today.W[0]).toBe(right.W[0])
  })

  it('ranks the most valuable changes and flags the extrapolated fruit target', () => {
    const changes = topChanges(model)
    expect(changes.map(change => change.factor)).toEqual(['fruit_g', 'fish_g', 'delta_intake_kcal'])
    expect(changes[0].extrapolated).toBe(true)
    expect(changes[1].extrapolated).toBe(false)
    expect(changes[0].gain).toBeGreaterThan(changes[1].gain)
    expect(changes[2].action.target).toBe('nutrition_plans')
  })

  it('skips changes the person has already made', () => {
    const fit = buildModel({ ...ME, fruit_g: 300, fish_g: 60, weight_kg: 68, energy_balance_kcal: 0 })
    expect(topChanges(fit)).toEqual([])
  })

  it('values life cards for this person and shows quitting only to smokers', () => {
    const values = lifeCardValues(model, null)
    const byId = Object.fromEntries(values.map(card => [card.id, card.gain]))
    expect(byId.apple).toBeGreaterThan(0)
    expect(byId.tea).toBeLessThan(0)
    expect(byId.quit).toBeUndefined()
    expect(lifeCardsFor({ ...ME, smoking: 'current_lt20' }).map(card => card.id)).toContain('quit')
    expect(lifeCardsFor({ ...ME, smoking: 'current_ge20' }).map(card => card.id)).not.toContain('pack')
  })

  it('stacks applied cards on top of today and restores today when none are applied', () => {
    expect(isSameExposures(applyLifeCards(model, []), model.base)).toBe(true)
    const stacked = applyLifeCards(model, ['apple', 'rice'])
    expect(stacked.fruit_g).toBe(260)
    expect(stacked.delta_intake_kcal).toBe(-60)
    expect(model.base.fruit_g).toBe(60)
  })

  it('applies the plan to the outcome and to the card values', () => {
    const apple = applyLifeCards(model, ['apple'])
    const now = playOutcome(model, apple, null)
    const halfAt50 = planOf({ start: 50, adherence: 3 }, options)
    const later = playOutcome(model, apple, halfAt50)
    expect(later.delta).toBeGreaterThan(0)
    expect(later.delta).toBeLessThan(now.delta)
    const laterCard = lifeCardValues(model, halfAt50).find(card => card.id === 'apple')
    expect(laterCard?.gain).toBeCloseTo(later.delta, 6)
    expect(now.warnings.map(warning => warning.field)).toContain('fruit_g')
  })

  it('offers the registry adherence tiers and describes the plan', () => {
    expect(options.map(option => option.label)).toEqual(['全部做到', '做到九成', '做到七成', '做到一半', '前两年好、之后松懈'])
    expect(planOf(DEFAULT_PLAN, options)).toBeNull()
    expect(planPhrase(DEFAULT_PLAN, options)).toBe('从现在开始 · 全部做到')
    expect(planPhrase({ start: 50, adherence: 3 }, options)).toBe('从 50 岁开始 · 做到一半')
  })

  it('answers whether starting late still helps', () => {
    const late = lateStart(model, model.base, DEFAULT_PLAN, options)
    expect(late.title).toContain('把饮食吃对')
    expect(late.rows[0]).toMatchObject({ age: 32, label: '现在就开始', selected: true, width: 100 })
    expect(late.rows.map(row => row.age)).toEqual([32, 40, 50, 60, 70, 80])
    expect(late.reading).toContain('晚开始也不是白做')

    const tuned = lateStart(model, applyLifeCards(model, ['tea']), { start: 40, adherence: 0 }, options)
    expect(tuned.title).toContain('按你调的方案')
    expect(tuned.rows.find(row => row.age === 40)?.selected).toBe(true)
    expect(tuned.rows[0].gain).toBeLessThan(0)
  })

  it('says so when the diet is already right and nothing was tuned', () => {
    const fit = buildModel({ ...ME, fruit_g: 300, fish_g: 60, weight_kg: 68, energy_balance_kcal: 0 })
    expect(lateStart(fit, fit.base, DEFAULT_PLAN, options).reading).toContain('接近“吃对”')
  })

  it('compares 100 parallel lives with the same dice', () => {
    const [today, right] = model.branches
    const lives = parallelLives(ME, today, right)
    const total = (bins: Map<number, number>) => Array.from(bins.values()).reduce((sum, count) => sum + count, 0)
    expect(total(lives.today)).toBe(100)
    expect(total(lives.tuned)).toBe(100)
    expect(lives.over85Tuned).toBeGreaterThanOrEqual(lives.over85Today)
    expect(lives.tallest).toBeGreaterThan(0)
  })

  it('formats signed years without a false sign around zero', () => {
    expect(signedYears(2.34)).toBe('+2.3')
    expect(signedYears(-1.26)).toBe('−1.3')
    expect(signedYears(0.01)).toBe('±0.0')
  })

  it('stays usable at the edges of the allowed age range', () => {
    const exposures: Exposures = engine.current({ ...ME, age: 100 })
    const oldest = buildModel({ ...ME, age: 100 })
    expect(oldest.branches[0].le.mean).toBeGreaterThan(100)
    expect(playOutcome(oldest, exposures, null).delta).toBeCloseTo(0, 6)
    expect(lateStart(oldest, oldest.base, DEFAULT_PLAN, options).rows.length).toBeGreaterThan(0)
  })
})

describe('people on this phone', () => {
  const now = new Date(2026, 10, 1)

  it('computes age from a birthday', () => {
    expect(ageFromBirthday('1994-10-31', now)).toBe(32)
    expect(ageFromBirthday('1994-11-02', now)).toBe(31)
    expect(ageFromBirthday('not a date', now)).toBeNull()
  })

  it('fills the form from the health profile and leaves gaps blank', () => {
    const filled = draftWithHealthProfile(emptyDraft('我'), {
      gender: 'female', birthday: '1990-01-01', height: 165, weight: 55, health_condition: { daily_life_activity_level: 'moderate' },
    }, now)
    expect(filled).toMatchObject({ sex: 'female', age: '36', height: '165', weight: '55', pa_met_h: 22 })
    const partial = draftWithHealthProfile(emptyDraft('我'), { gender: 'other', height: null }, now)
    expect(partial).toMatchObject({ sex: null, age: '', height: '', pa_met_h: 14 })
  })

  it('validates what the engine can take', () => {
    const good = { ...emptyDraft('爸爸'), sex: 'male' as const, age: '58', height: '170', weight: '80' }
    expect(validateDraft(good)).toBeNull()
    expect(validateDraft({ ...good, sex: null })).toContain('性别')
    expect(validateDraft({ ...good, age: '16' })).toContain('18 岁及以上')
    expect(validateDraft({ ...good, age: '' })).toContain('年龄')
    expect(validateDraft({ ...good, age: '130' })).toContain('年龄')
    expect(validateDraft({ ...good, height: '90' })).toContain('身高')
    expect(validateDraft({ ...good, weight: 'abc' })).toContain('体重')
  })

  it('round-trips between the form and a person', () => {
    const person = draftToPredictee({ ...emptyDraft('爸爸'), sex: 'male', age: '58', height: '170.5', weight: '80' }, 'dad')
    expect(person).toMatchObject({ id: 'dad', label: '爸爸', age: 58, height_cm: 170.5, weight_kg: 80 })
    expect(predicteeToDraft(person)).toMatchObject({ label: '爸爸', age: '58', height: '170.5', weight: '80', sex: 'male' })
  })

  it('keeps people in local storage and drops damaged entries', () => {
    const store = new Map<string, unknown>()
    ;(Taro as any).getStorageSync = jest.fn((key: string) => store.get(key))
    ;(Taro as any).setStorageSync = jest.fn((key: string, value: unknown) => { store.set(key, value) })
    ;(Taro as any).removeStorageSync = jest.fn((key: string) => { store.delete(key) })

    expect(loadPeople()).toEqual([])
    savePeople([ME])
    expect(loadPeople()).toEqual([ME])
    store.set('lifespan_people_v1', [ME, { id: 'x', label: 'x', sex: 'male', age: 10 }, null])
    expect(loadPeople()).toEqual([ME])
    clearPeople()
    expect(loadPeople()).toEqual([])
  })
})
