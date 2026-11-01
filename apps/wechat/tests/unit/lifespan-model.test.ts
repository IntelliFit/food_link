import Taro from '@tarojs/taro'

import { engine, type Exposures } from '../../src/packageLifespan/engine/engine'
import { habitSlidersFor, lifeCardsFor } from '../../src/packageLifespan/model/habits'
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
  completenessOf,
  DEFAULT_PLAN,
  firstDiseaseOf,
  isSameExposures,
  lateStart,
  lifeCardValues,
  milestoneAge,
  missingInputs,
  parallelLives,
  planOf,
  planPhrase,
  playOutcome,
  signedPoints,
  signedYears,
  todayWarnings,
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
    expect(lives.overTuned).toBeGreaterThanOrEqual(lives.overToday)
    expect(lives.tallest).toBeGreaterThan(0)
  })

  it('stacks cards on what the sliders were left at, not on today', () => {
    const fromSliders = { ...model.base, fruit_g: 300 }
    expect(applyLifeCards(model, ['rice'], fromSliders)).toMatchObject({ fruit_g: 300, delta_intake_kcal: -60 })
  })

  it('moves the "chance of reaching" age for people already near 85', () => {
    expect(milestoneAge(ME)).toBe(85)
    expect(milestoneAge({ ...ME, age: 79 })).toBe(85)
    expect(milestoneAge({ ...ME, age: 85 })).toBe(95)
    expect(milestoneAge({ ...ME, age: 100 })).toBe(110)
    const old = buildModel({ ...ME, age: 85 })
    const lives = parallelLives(old.person, old.branches[0], old.branches[1])
    expect(lives.milestone).toBe(95)
    expect(lives.overToday).toBeLessThan(100)
  })

  it('warns about the person, not just about habits', () => {
    expect(todayWarnings(model)).toEqual([])
    expect(todayWarnings(buildModel({ ...ME, age: 25 })).map(warning => warning.field)).toEqual(['age'])
    expect(todayWarnings(buildModel({ ...ME, weight_kg: 140 })).map(warning => warning.field)).toEqual(['bmi'])
    const thin = buildModel({ ...ME, height_cm: 150, weight_kg: 48, energy_balance_kcal: 0 })
    const starving = playOutcome(thin, { ...thin.base, delta_intake_kcal: -600 }, null)
    expect(starving.warnings.find(warning => warning.field === 'bmi')?.message).toContain('BMI 最低降到')
  })

  it('never prints a doubled sign', () => {
    expect(signedPoints(1.26)).toBe('+1.3')
    expect(signedPoints(-0.4)).toBe('−0.4')
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

describe('engine 0.3 inputs and outputs', () => {
  const answered: Predictee = { ...ME, vegetables_g: 100, sodium_mg: 6000, risk: { conditions: [], sbp_mmhg: 130 } }

  it('ranks vegetables and salt only when the person gave them', () => {
    const factors = (person: Predictee) => topChanges(buildModel(person)).map(change => change.factor)
    expect(factors(ME)).not.toEqual(expect.arrayContaining(['vegetables_g']))
    expect(factors(ME)).not.toEqual(expect.arrayContaining(['sodium_mg']))
    expect(factors(answered)).toEqual(expect.arrayContaining(['vegetables_g', 'sodium_mg']))
    const gains = topChanges(buildModel(answered)).map(change => change.gain)
    expect(gains).toEqual([...gains].sort((a, b) => b - a))
  })

  it('offers the matching sliders and cards', () => {
    expect(habitSlidersFor(ME).map(slider => slider.key)).not.toContain('vegetables_g')
    expect(habitSlidersFor(answered).map(slider => slider.key)).toEqual(expect.arrayContaining(['vegetables_g', 'sodium_mg']))
    expect(lifeCardsFor(ME).map(card => card.id)).not.toContain('salt')
    expect(lifeCardsFor(answered).map(card => card.id)).toEqual(expect.arrayContaining(['veg', 'salt']))
  })

  it('moves the result when cutting salt', () => {
    const salty = buildModel(answered)
    const lower = applyLifeCards(salty, ['salt'])
    expect(lower.sodium_mg).toBe(4800)
    expect(playOutcome(salty, lower, null).delta).toBeGreaterThan(0)
  })

  it('compares vegetables and salt when deciding nothing changed', () => {
    const base = buildModel(answered).base
    expect(isSameExposures(base, { ...base })).toBe(true)
    expect(isSameExposures(base, { ...base, sodium_mg: 4000 })).toBe(false)
    expect(isSameExposures(base, { ...base, vegetables_g: 300 })).toBe(false)
  })

  it('says what is still missing and how complete the answers are', () => {
    expect(missingInputs(ME)).toEqual(['蔬菜', '咸淡', '血压', '病史'])
    expect(missingInputs(answered)).toEqual([])
    expect(completenessOf(answered)).toBeGreaterThan(completenessOf(ME))
  })

  it('keeps first disease before death or none at all', () => {
    const curves = buildModel(ME).branches[0]
    for (let life = 0; life < 50; life += 1) {
      const first = firstDiseaseOf(ME, curves, life)
      if (first) expect(first.age).toBeGreaterThanOrEqual(ME.age)
    }
    const ill = buildModel({ ...ME, age: 60, risk: { conditions: ['stroke'] } })
    expect(ill.branches[0].disease.alreadyIll).toBe(true)
    expect(firstDiseaseOf(ill.person, ill.branches[0], 0)).toBeNull()
  })

  it('does not count hypertension or diabetes as already ill', () => {
    const known = buildModel({ ...ME, risk: { conditions: ['hypertension', 'diabetes'] } })
    expect(known.branches[0].disease.alreadyIll).toBe(false)
    expect(known.branches[0].healthy.mean_years_free).toBeGreaterThan(0)
  })

  it('accepts people who would rather not say', () => {
    const quiet = buildModel({ ...ME, smoking: 'unknown', alcohol: 'unknown' })
    expect(quiet.branches[0].le.mean).toBeGreaterThan(ME.age)
    const pack = lifeCardsFor(quiet.person).find(card => card.id === 'pack')
    expect(pack?.apply(quiet.base).smoking).toBe('current_ge20')
    const baijiu = lifeCardsFor(quiet.person).find(card => card.id === 'baijiu')
    expect(baijiu?.apply(quiet.base).alcohol).toBe('daily_30_59')
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

  it('brings over diagnoses the engine knows and keeps "not answered" otherwise', () => {
    const profile = (medical_history: string[]) => draftWithHealthProfile(emptyDraft('我'), { health_condition: { medical_history } }, now)
    expect(profile(['hypertension', 'gout']).conditions).toEqual(['hypertension'])
    expect(profile(['gout']).conditions).toBeNull()
    expect(profile([]).conditions).toBeNull()
  })

  it('checks blood pressure only when it is filled in', () => {
    const good = { ...emptyDraft('爸爸'), sex: 'male' as const, age: '58', height: '170', weight: '80' }
    expect(validateDraft({ ...good, sbp: '' })).toBeNull()
    expect(validateDraft({ ...good, sbp: '135' })).toBeNull()
    expect(validateDraft({ ...good, sbp: '20' })).toContain('收缩压')
    expect(validateDraft({ ...good, sbp: '高' })).toContain('收缩压')
  })

  it('round-trips the optional answers', () => {
    const base = { ...emptyDraft('爸爸'), sex: 'male' as const, age: '58', height: '170', weight: '80' }
    expect(draftToPredictee(base, 'dad').risk).toBeNull()
    const person = draftToPredictee({ ...base, vegetables_g: 250, sodium_mg: 6000, sbp: '135', conditions: [] }, 'dad')
    expect(person).toMatchObject({ vegetables_g: 250, sodium_mg: 6000, risk: { conditions: [], sbp_mmhg: 135 } })
    expect(predicteeToDraft(person)).toMatchObject({ vegetables_g: 250, sodium_mg: 6000, sbp: '135', conditions: [] })
    expect(predicteeToDraft(draftToPredictee(base, 'dad'))).toMatchObject({ vegetables_g: null, sodium_mg: null, sbp: '', conditions: null })
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
    expect(validateDraft({ ...good, age: '18', height: '120', weight: '250' })).toContain('对不上')
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
    const quiet = { ...ME, id: 'q', smoking: 'unknown', alcohol: 'unknown', risk: { conditions: ['hypertension'] } }
    store.set('lifespan_people_v1', [quiet, { ...ME, id: 'bad', risk: 'oops' }, { ...ME, id: 'bad2', sodium_mg: 'lots' }])
    expect(loadPeople()).toEqual([quiet])
    clearPeople()
    expect(loadPeople()).toEqual([])
  })
})
