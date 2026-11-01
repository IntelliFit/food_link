// Turns engine curves into what the predictor screens show.
import { engine, type AdherenceSpec, type ChangePlan, type Curves, type DiseaseEventType, type EvidenceWarning, type Exposures, type FirstDisease, type Person, type Sex } from '../engine/engine'
import { HABIT_CHOICES, habitSlidersFor, lifeCardsFor, saltGrams } from './habits'

export const LIFE_SEED = 182772
export const DISCLAIMER = '模拟估算，不用于诊断'

export type BranchKey = 'current' | 'diet_right' | 'diet_loose'

export interface Branch extends Curves {
  key: BranchKey
  name: string
  short: string
  scenario: Exposures
}

export interface PredictorModel {
  person: Person
  base: Exposures
  lag: number
  branches: [Branch, Branch, Branch]
}

const BRANCH_NAMES: Record<BranchKey, [name: string, short: string]> = {
  current: ['照现在这样吃', '现在'],
  diet_right: ['把饮食吃对', '吃对'],
  diet_loose: ['放飞自我', '放飞'],
}

/** A hypertension diagnosis counts through blood pressure, so without a reading the engine's assumed one is used. */
function withAssumedSbp(person: Person): Person {
  const sbp = engine.assumedSbp(person)
  return sbp === null ? person : { ...person, risk: { ...person.risk, sbp_mmhg: sbp } }
}

export function buildModel(answers: Person): PredictorModel {
  const person = withAssumedSbp(answers)
  const base = engine.current(person)
  const lag = engine.lagOf(person)
  const make = (key: BranchKey, scenario: Exposures): Branch => ({
    key,
    name: BRANCH_NAMES[key][0],
    short: BRANCH_NAMES[key][1],
    scenario,
    ...engine.curves(person, scenario, base, lag),
  })
  return {
    person,
    base,
    lag,
    branches: [make('current', base), make('diet_right', engine.dietRight(person)), make('diet_loose', engine.dietLoose(person))],
  }
}

export const axisEndAge = (person: Person): number => Math.min(110, Math.max(100, person.age + 20))

/** The "chance of reaching" age: 85, or a later round age for people already close to it. */
export const milestoneAge = (person: Person): number =>
  (person.age < 80 ? 85 : Math.min(110, Math.ceil((person.age + 10) / 5) * 5))

export function atAge(person: Person, curves: Curves, age: number): { alive: number; free: number; weight: number; bmi: number } {
  const index = Math.max(0, Math.min(Math.round(age - person.age), curves.S.length - 1))
  return { alive: curves.S[index], free: curves.disease.free[index], weight: curves.W[index], bmi: curves.B[index] }
}

export const percent = (value: number): string => `${Math.round(value * 100)}%`
export const years = (value: number): string => value.toFixed(1)
export const signedPoints = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`
export function signedYears(value: number): string {
  if (Math.abs(value) < 0.05) return '±0.0'
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`
}

// ---------- the most valuable changes ----------

export interface TopChange {
  factor: 'fruit_g' | 'vegetables_g' | 'fish_g' | 'sodium_mg' | 'delta_intake_kcal'
  name: string
  from: string
  to: string
  gain: number
  p85Points: number | null
  evidence: string[]
  extrapolated: boolean
  action: { label: string; target: 'next_meal' | 'nutrition_plans' }
}

const grams = (value: number): string => `${Math.round(value)} g/天`
const energyText = (value: number): string => {
  if (value === 0) return '体重稳定'
  return value > 0 ? `每天多吃约 ${Math.round(value)} kcal` : `每天少吃约 ${Math.round(-value)} kcal`
}

export function topChanges(model: PredictorModel): TopChange[] {
  const { person, base, lag, branches: [today, right] } = model
  const target = right.scenario
  const change = (
    factor: TopChange['factor'],
    fields: Pick<TopChange, 'name' | 'from' | 'to' | 'evidence' | 'action'>,
  ): TopChange | null => {
    if (target[factor] == null || target[factor] === base[factor]) return null
    const scenario = { ...base, [factor]: target[factor] }
    const result = engine.curves(person, scenario, base, lag)
    return {
      ...fields,
      factor,
      gain: result.le.mean - today.le.mean,
      p85Points: result.p85 === null || today.p85 === null ? null : (result.p85 - today.p85) * 100,
      extrapolated: engine.warnings(person, scenario, Math.max(...result.B)).some(warning => warning.field === factor),
    }
  }
  const finalBmi = right.B[right.B.length - 1]
  const items = [
    change('fruit_g', {
      name: '多吃水果', from: grams(base.fruit_g), to: grams(target.fruit_g), evidence: ['中国队列'],
      action: { label: '下一餐加一份水果', target: 'next_meal' },
    }),
    change('vegetables_g', {
      name: '多吃蔬菜', from: grams(base.vegetables_g ?? 0), to: grams(target.vegetables_g ?? 0), evidence: ['荟萃分析'],
      action: { label: '下一餐多一份蔬菜', target: 'next_meal' },
    }),
    change('fish_g', {
      name: '每周多吃几次鱼', from: grams(base.fish_g), to: grams(target.fish_g), evidence: ['中国队列'],
      action: { label: '下一餐换成鱼', target: 'next_meal' },
    }),
    change('sodium_mg', {
      name: '少盐', from: `约 ${saltGrams(base.sodium_mg ?? 0)} g 盐/天`, to: `约 ${saltGrams(target.sodium_mg ?? 0)} g/天`, evidence: ['队列研究', '模型推算'],
      action: { label: '让下一餐少盐一点', target: 'next_meal' },
    }),
    change('delta_intake_kcal', {
      name: finalBmi >= today.B[0] ? '把体重养回合理区间' : '把体重带回合理区间',
      from: `${energyText(base.delta_intake_kcal)}，BMI ${today.B[0].toFixed(1)}`,
      to: `${energyText(target.delta_intake_kcal)}，BMI 慢慢到 ${finalBmi.toFixed(1)}`,
      evidence: ['荟萃分析', '机制模型'],
      action: { label: '去设置饮食方案', target: 'nutrition_plans' },
    }),
  ]
  return items.filter((item): item is TopChange => item !== null).sort((a, b) => b.gain - a.gain)
}

// ---------- tuning your own life ----------

export interface PlanChoice {
  start: number | null
  adherence: number
}

export interface AdherenceOption {
  label: string
  spec: AdherenceSpec
}

const TIER_NAMES: Record<string, string> = { 0.9: '九成', 0.8: '八成', 0.7: '七成', 0.6: '六成', 0.5: '一半' }

export function adherenceOptions(sex: Sex): AdherenceOption[] {
  const { tiers, fade } = engine.adherenceOptions(sex)
  return [
    { label: '全部做到', spec: null },
    ...tiers.map(tier => ({ label: `做到${TIER_NAMES[tier] ?? `${Math.round(tier * 100)}%`}`, spec: tier })),
    { label: '前两年好、之后松懈', spec: fade },
  ]
}

export const DEFAULT_PLAN: PlanChoice = { start: null, adherence: 0 }

export function planOf(choice: PlanChoice, options: AdherenceOption[]): ChangePlan | null {
  if (choice.start === null && choice.adherence === 0) return null
  return { change_start_age: choice.start, adherence: options[choice.adherence].spec }
}

export function planPhrase(choice: PlanChoice, options: AdherenceOption[]): string {
  return `${choice.start === null ? '从现在开始' : `从 ${choice.start} 岁开始`} · ${options[choice.adherence].label}`
}

export interface PlayOutcome {
  curves: Curves
  delta: number
  warnings: EvidenceWarning[]
}

const BMI_FLOOR = 15

function warningsOf(person: Person, exposures: Exposures, curves: Curves): EvidenceWarning[] {
  const lowest = Math.min(...curves.B)
  const low = lowest < BMI_FLOOR ? [{ field: 'bmi', message: `BMI 最低降到 ${lowest.toFixed(1)}，超出 15–45 的研究范围` }] : []
  return [...engine.warnings(person, exposures, Math.max(...curves.B)), ...low]
}

export function playOutcome(model: PredictorModel, play: Exposures, plan: ChangePlan | null): PlayOutcome {
  const curves = engine.curves(model.person, play, model.base, model.lag, plan)
  return {
    curves,
    delta: curves.le.mean - model.branches[0].le.mean,
    warnings: warningsOf(model.person, play, curves),
  }
}

/** Warnings about the person rather than one habit, shown near the headline. */
export const personWarnings = (warnings: EvidenceWarning[]): EvidenceWarning[] =>
  warnings.filter(warning => warning.field === 'age' || warning.field === 'bmi')

export const todayWarnings = (model: PredictorModel): EvidenceWarning[] =>
  personWarnings(warningsOf(model.person, model.base, model.branches[0]))

export interface LifeCardValue {
  id: string
  name: string
  detail: string
  gain: number
}

export function lifeCardValues(model: PredictorModel, plan: ChangePlan | null): LifeCardValue[] {
  return lifeCardsFor(model.person).map(card => ({
    id: card.id,
    name: card.name,
    detail: card.detail,
    gain: engine.curves(model.person, card.apply(model.base), model.base, model.lag, plan).le.mean - model.branches[0].le.mean,
  }))
}

/** Cards stack on `from` (what the sliders were left at), in display order. */
export function applyLifeCards(model: PredictorModel, applied: string[], from: Exposures = model.base): Exposures {
  return lifeCardsFor(model.person)
    .filter(card => applied.includes(card.id))
    .reduce((exposures, card) => card.apply(exposures), from)
}

const SAME_EPSILON = 1e-9

export function isSameExposures(a: Exposures, b: Exposures): boolean {
  return a.smoking === b.smoking && a.alcohol === b.alcohol
    && (['fruit_g', 'fish_g', 'delta_intake_kcal', 'pa_met_h', 'sleep_h'] as const).every(key => Math.abs(a[key] - b[key]) < SAME_EPSILON)
    && (a.vegetables_g ?? null) === (b.vegetables_g ?? null)
    && (a.sodium_mg ?? null) === (b.sodium_mg ?? null)
}

/** What was changed, for the share card. Cards are named only when they alone explain the difference. */
export function tuningSummary(model: PredictorModel, play: Exposures, applied: string[], cardsFrom: Exposures): string {
  const { person, base } = model
  if (applied.length && isSameExposures(cardsFrom, base)) {
    return lifeCardsFor(person).filter(card => applied.includes(card.id)).map(card => card.name).join('、')
  }
  const sliders = habitSlidersFor(person)
    .filter(slider => Math.abs((play[slider.key] ?? 0) - (base[slider.key] ?? 0)) > SAME_EPSILON)
    .map(slider => `${slider.label}调到 ${slider.format(play[slider.key] ?? 0)}`)
  const choices = HABIT_CHOICES.filter(choice => play[choice.key] !== base[choice.key])
    .map(choice => `${choice.label}改成${choice.names[play[choice.key] as never]}`)
  return [...sliders, ...choices].join('、') || '什么都没改'
}

export interface LateStart {
  title: string
  rows: Array<{ age: number; label: string; gain: number; selected: boolean; width: number }>
  reading: string
}

export function lateStart(model: PredictorModel, play: Exposures, choice: PlanChoice, options: AdherenceOption[]): LateStart {
  const { person, base, branches: [, right] } = model
  const changed = !isSameExposures(play, base)
  const target = changed ? play : right.scenario
  const selected = choice.start ?? person.age
  const ages = [person.age, 40, 50, 60, 70, 80, selected].filter(age => age < axisEndAge(person) - 4)
  const { rows } = engine.gainByStartAge(person, target, ages, options[choice.adherence].spec)
  const biggest = Math.max(0.1, ...rows.map(row => Math.abs(row.gain_years)))
  const first = rows[0]
  const later = rows.find(row => row !== first && row.change_start_age >= 60)
  let reading = '开始得越晚，能受益的年数越少。'
  if (!changed && first && Math.abs(first.gain_years) < 0.05) {
    reading = '按引擎能算的饮食项，这个人已经接近“吃对”，先在上面调一个习惯再看。'
  } else if (first && first.gain_years < -0.05) {
    reading = '这样改平均是少活的。开始得越晚，受影响的年数越少。'
  } else if (first && later && first.gain_years > 0.05) {
    reading = `现在开始平均多活 ${years(first.gain_years)} 年；拖到 ${later.change_start_age} 岁才开始，还有 ${years(later.gain_years)} 年。越早越好，但晚开始也不是白做。`
  }
  return {
    title: changed ? '晚开始还有没有用？（按你调的方案）' : '晚开始还有没有用？（以“把饮食吃对”为例）',
    rows: rows.map(row => ({
      age: row.change_start_age,
      label: row.change_start_age === person.age ? '现在就开始' : `${row.change_start_age} 岁才开始`,
      gain: row.gain_years,
      selected: row.change_start_age === selected,
      width: Math.abs(row.gain_years) / biggest * 100,
    })),
    reading,
  }
}

// ---------- random lives ----------

export function deathAge(person: Person, curves: Curves, lifeIndex: number): number {
  return person.age + engine.deathTime(curves.hz, engine.lifeThreshold(LIFE_SEED, lifeIndex))
}

export const DISEASE_NAMES: Record<DiseaseEventType, string> = {
  cvd: '心血管病',
  cancer: '癌症',
  chronic_respiratory: '慢性呼吸病',
}

export function firstDiseaseOf(person: Person, curves: Curves, lifeIndex: number): FirstDisease | null {
  return engine.firstDisease(person, curves, deathAge(person, curves, lifeIndex) - person.age, LIFE_SEED, lifeIndex)
}

/** What is still left out of this person's result, for the "not counted yet" note. */
export function missingInputs(person: Person): string[] {
  const missing: string[] = []
  if (person.vegetables_g == null) missing.push('蔬菜')
  if (person.sodium_mg == null) missing.push('咸淡')
  if (person.risk?.sbp_mmhg == null && engine.assumedSbp(person) === null) missing.push('血压')
  if (person.risk?.conditions == null) missing.push('病史')
  return missing
}

/** How a diagnosis was counted, when that is not obvious from the answers. */
export function diagnosisNotes(person: Person): string[] {
  const assumed = engine.assumedSbp(person)
  return [
    ...(assumed === null ? [] : [`高血压通过血压计入。没填血压，先按 ${Math.round(assumed)} mmHg 算，填上实际血压会更准。`]),
    ...(person.risk?.conditions?.includes('hyperlipidemia') ? ['高血脂目前没有可用的全因死亡估计，已记录但不计入寿命。'] : []),
  ]
}

export const completenessOf = (person: Person): number => engine.completeness(person)

export interface ParallelLives {
  /** Number of lives per 2-year bin, today's habits and the tuned plan. */
  today: Map<number, number>
  tuned: Map<number, number>
  milestone: number
  overToday: number
  overTuned: number
  binYears: number
  tallest: number
}

export function parallelLives(person: Person, today: Curves, tuned: Curves, count = 100): ParallelLives {
  const binYears = 2
  const add = (bins: Map<number, number>, age: number): Map<number, number> => {
    const bin = Math.floor((age - person.age) / binYears)
    return new Map(bins).set(bin, (bins.get(bin) ?? 0) + 1)
  }
  let binsToday = new Map<number, number>()
  let binsTuned = new Map<number, number>()
  const milestone = milestoneAge(person)
  let overToday = 0
  let overTuned = 0
  for (let life = 0; life < count; life += 1) {
    const ageToday = deathAge(person, today, life)
    const ageTuned = deathAge(person, tuned, life)
    binsToday = add(binsToday, ageToday)
    binsTuned = add(binsTuned, ageTuned)
    if (ageToday >= milestone) overToday += 1
    if (ageTuned >= milestone) overTuned += 1
  }
  return {
    today: binsToday,
    tuned: binsTuned,
    milestone,
    overToday,
    overTuned,
    binYears,
    tallest: Math.max(...binsToday.values(), ...binsTuned.values()),
  }
}
