// TypeScript port of the deterministic path of lifespan-predictor: scenario_hazard (with
// the change plan), _branch_curves and one_life, point estimates only. It must stay in
// step with the reference engine: tests/unit/lifespan-engine.test.ts checks it against the
// shared golden vectors. Update constants.ts with scripts/sync-lifespan-engine.mjs.
import { ENGINE_CONSTANTS } from './constants'

export const SMOKING = ['never', 'former', 'current_lt20', 'current_ge20'] as const
export const ALCOHOL = ['less_than_daily', 'daily_1_29', 'daily_30_59', 'daily_ge60'] as const

export type Sex = 'male' | 'female'
export type Smoking = (typeof SMOKING)[number]
export type Alcohol = (typeof ALCOHOL)[number]

export interface Exposures {
  smoking: Smoking
  alcohol: Alcohol
  pa_met_h: number
  fruit_g: number
  fish_g: number
  sleep_h: number
  delta_intake_kcal: number
}

export interface Person {
  sex: Sex
  age: number
  height_cm: number
  weight_kg: number
  smoking: Smoking
  alcohol: Alcohol
  pa_met_h: number
  fruit_g: number
  fish_g: number
  sleep_h: number
  energy_balance_kcal: number
}

export type AdherenceSpec =
  | null
  | number
  | { type: 'constant'; level: number }
  | { type: 'decay'; start: number; end: number; half_life_years: number }

export interface ChangePlan {
  change_start_age?: number | null
  adherence?: AdherenceSpec
}

export interface LifeExpectancy {
  mean: number
  median: number
  p10: number
  p90: number
}

export interface Curves {
  hz: number[]
  S: number[]
  W: number[]
  B: number[]
  le: LifeExpectancy
  p85: number | null
}

export interface EvidenceWarning {
  field: string
  message: string
}

export interface StartAgeGain {
  change_start_age: number
  mean: number
  gain_years: number
  gain_p85_pct: number | null
}

interface Coefficients {
  smk_former: number
  smk_lt20: number
  smk_ge20: number
  alc_1_29: number
  alc_30_59: number
  alc_ge60: number
  pa_ln: number
  pa_center: number
  pa_floor: number
  fruit: number
  fish: number
  fruit_center: number
  fish_center: number
  fruit_cap: number
  fish_cap: number
  bmi_low: number
  bmi_185: number
  bmi_per5: number
  sleep_short: number
  sleep_long: number
  sleep_cut: number[]
  sleep_shrink: number
}

interface Registry {
  'age.effect_attenuation': { start_age: number; end_age: number; end_multiplier: number }
  'lag.effect_tau_years': number
  'hall.energy_expenditure': { lean: number; fat: number }
  'hall.rho_fat': number
  'hall.rho_lean': number
  'hall.forbes_c': number
  'hall.initial_body_fat': number[]
  'scenario.diet_right_targets': { fruit_g: number; fish_g: number; bmi_range: number[] }
  'scenario.diet_loose_targets': { fruit_g: number; fish_g: number }
  'scenario.optimized_targets': { pa_increment: number; pa_minimum: number; fruit_g: number; fish_g: number; sleep_h: number; bmi_range: number[] }
  'scenario.adverse_targets': { smoking: string; alcohol: string; pa_met_h: number; fruit_g: number; fish_g: number; sleep_h: number }
  'scenario.adverse_energy_surplus': number
  'pa.observed_range': number[]
  'pa.floor': number
  'diet.observed_range': { fruit: number[]; fish: number[] }
  'diet.effect_caps': { fruit: number; fish: number }
  'sleep.cutpoints': number[]
  'plan.adherence': {
    tiers: number[]
    fade: { type: 'decay'; start: number; end: number; half_life_years: number }
  }
}

export interface EngineConstants {
  engine_version: string
  registry_version: string
  sex: Record<Sex, { mx: number[]; mean_rr: number[]; coef: Coefficients; reg: Registry }>
}

const MAX_AGE = 110
const KCAL_TO_MJ = 4.184e-3
const DAYS_PER_YEAR = 365.25
const WEIGHT_CACHE_LIMIT = 256
const GAMMA_HI = 0x9e3779b9
const GAMMA_LO = 0x7f4a7c15

type U64 = readonly [number, number]

const add64 = ([ah, al]: U64, [bh, bl]: U64): U64 => {
  const lo = al + bl
  return [(ah + bh + Math.floor(lo / 0x100000000)) >>> 0, lo >>> 0]
}
const mul64 = ([ah, al]: U64, [bh, bl]: U64): U64 => {
  const a0 = al & 0xffff
  const a1 = al >>> 16
  const b0 = bl & 0xffff
  const b1 = bl >>> 16
  const low = a0 * b0
  const mid1 = a1 * b0 + (low >>> 16)
  const mid2 = a0 * b1 + (mid1 & 0xffff)
  const lo = ((mid2 & 0xffff) * 0x10000 + (low & 0xffff)) >>> 0
  const carry = a1 * b1 + Math.floor(mid1 / 0x10000) + Math.floor(mid2 / 0x10000)
  return [(carry + Math.imul(ah, bl) + Math.imul(al, bh)) >>> 0, lo]
}
const xorShr64 = ([h, l]: U64, n: number): U64 => {
  const shiftedLo = ((l >>> n) | (h << (32 - n))) >>> 0
  return [(h ^ (h >>> n)) >>> 0, (l ^ shiftedLo) >>> 0]
}
const toU64 = (value: number): U64 => [Math.floor(value / 0x100000000) >>> 0, value >>> 0]

// SplitMix64 without BigInt: older WeChat runtimes cannot parse BigInt literals.
function splitmix64(state: U64): U64 {
  let z = add64(state, [GAMMA_HI, GAMMA_LO])
  z = mul64(xorShr64(z, 30), [0xbf58476d, 0x1ce4e5b9])
  z = mul64(xorShr64(z, 27), [0x94d049bb, 0x133111eb])
  return xorShr64(z, 31)
}

interface NormalizedPlan {
  offset: number
  level: (years: number) => number
  isDefault: boolean
  key: string
}

function normalizePlan(person: Person, plan?: ChangePlan | null): NormalizedPlan {
  const spec = plan?.adherence ?? null
  let start = 1
  let end: number | null = null
  let half = 1
  if (typeof spec === 'number') {
    start = spec
  } else if (spec?.type === 'decay') {
    start = spec.start
    end = spec.end
    half = spec.half_life_years
  } else if (spec?.type === 'constant') {
    start = spec.level
  }
  const offset = plan?.change_start_age == null ? 0 : plan.change_start_age - person.age
  const stop = end
  return {
    offset,
    level: stop === null ? () => start : years => stop + (start - stop) * Math.pow(0.5, years / half),
    isDefault: offset === 0 && stop === null && start === 1,
    key: `${offset}|${start}|${stop}|${half}`,
  }
}

const mix = (current: number, target: number, a: number): number => current + a * (target - current)

export function createEngine(constants: EngineConstants) {
  const weightCache = new Map<string, number[]>()
  const sexOf = (sex: Sex) => constants.sex[sex]
  const regOf = (sex: Sex) => sexOf(sex).reg

  function initialFat(person: Person): number {
    const [a, b, c, d] = regOf(person.sex)['hall.initial_body_fat']
    const bmi = person.weight_kg / Math.pow(person.height_cm / 100, 2)
    const pct = Math.min(60, Math.max(5, a * bmi + b * person.age + c * (person.sex === 'male' ? 1 : 0) + d))
    return person.weight_kg * pct / 100
  }

  // Dynamic energy-balance weight model (RK2, weekly steps); schedule(t) is read once per step.
  function integrateWeight(person: Person, deltaKcal: number, years: number, schedule: ((t: number) => number) | null): number[] {
    const reg = regOf(person.sex)
    const rhoFat = reg['hall.rho_fat']
    const rhoLean = reg['hall.rho_lean']
    const c = reg['hall.forbes_c'] * rhoLean / rhoFat
    const { lean: eeLean, fat: eeFat } = reg['hall.energy_expenditure']
    const fat0 = initialFat(person)
    const lean0 = person.weight_kg - fat0
    const steps = Math.max(1, Math.round(DAYS_PER_YEAR / 7))
    const h = DAYS_PER_YEAR / steps
    let energy = deltaKcal * KCAL_TO_MJ
    let fat = fat0
    let lean = lean0
    let step = 0
    const path = [fat + lean]
    for (let year = 0; year < years; year += 1) {
      for (let s = 0; s < steps; s += 1) {
        if (schedule) energy = schedule((step + 0.5) * h / DAYS_PER_YEAR) * KCAL_TO_MJ
        step += 1
        const imbalance1 = energy - eeLean * (lean - lean0) - eeFat * (fat - fat0)
        const p1 = c / (c + fat)
        const midFat = fat + 0.5 * h * (1 - p1) * imbalance1 / rhoFat
        const midLean = lean + 0.5 * h * p1 * imbalance1 / rhoLean
        const imbalance2 = energy - eeLean * (midLean - lean0) - eeFat * (midFat - fat0)
        const p2 = c / (c + midFat)
        fat = Math.max(fat + h * (1 - p2) * imbalance2 / rhoFat, 0.5)
        lean += h * p2 * imbalance2 / rhoLean
      }
      path.push(fat + lean)
    }
    return path
  }

  // Sliders and life cards recompute many scenarios that share one weight path.
  function weightPath(person: Person, scn: Exposures, base: Exposures, plan: NormalizedPlan, years: number): number[] {
    const deltaBase = base.delta_intake_kcal
    const deltaTarget = scn.delta_intake_kcal
    const key = `${person.sex}|${person.age}|${person.height_cm}|${person.weight_kg}|${deltaTarget}|${plan.isDefault ? 'default' : `${deltaBase}|${plan.key}`}`
    const cached = weightCache.get(key)
    if (cached) return cached
    const schedule = plan.isDefault
      ? null
      : (t: number) => (t < plan.offset ? deltaBase : deltaBase + plan.level(t - plan.offset) * (deltaTarget - deltaBase))
    const path = integrateWeight(person, deltaTarget, years, schedule)
    if (weightCache.size >= WEIGHT_CACHE_LIMIT) weightCache.clear()
    weightCache.set(key, path)
    return path
  }

  function categoricalLhr(sex: Sex, x: Exposures): number {
    const c = sexOf(sex).coef
    return [0, c.smk_former, c.smk_lt20, c.smk_ge20][SMOKING.indexOf(x.smoking)]
      + [0, c.alc_1_29, c.alc_30_59, c.alc_ge60][ALCOHOL.indexOf(x.alcohol)]
  }

  function continuousLhr(sex: Sex, pa: number, fruit: number, fish: number, sleep: number): number {
    const c = sexOf(sex).coef
    const activity = c.pa_ln * Math.log(Math.max(pa, c.pa_floor) / c.pa_center)
    const diet = c.fruit * (Math.min(fruit, c.fruit_cap) - c.fruit_center) + c.fish * (Math.min(fish, c.fish_cap) - c.fish_center)
    const [, shortFull, shortHalf, longHalf, longFull] = c.sleep_cut
    const short = sleep < shortFull ? 1 : sleep < shortHalf ? 0.5 : 0
    const long = sleep >= longFull ? 1 : sleep >= longHalf ? 0.5 : 0
    return activity + diet + c.sleep_shrink * (short * c.sleep_short + long * c.sleep_long)
  }

  const behaviourLhr = (sex: Sex, x: Exposures): number =>
    categoricalLhr(sex, x) + continuousLhr(sex, x.pa_met_h, x.fruit_g, x.fish_g, x.sleep_h)

  function bmiLhr(sex: Sex, bmi: number): number {
    const c = sexOf(sex).coef
    const low = bmi < 18.5 ? c.bmi_low : bmi < 20 ? c.bmi_185 : 0
    return low + c.bmi_per5 * Math.max(bmi - 25, 0) / 5
  }

  function ageAttenuation(sex: Sex, age: number): number {
    const rule = regOf(sex)['age.effect_attenuation']
    const frac = Math.min(1, Math.max(0, (age - rule.start_age) / (rule.end_age - rule.start_age)))
    return 1 - frac * (1 - rule.end_multiplier)
  }

  function interpolateLog(values: number[], age: number): number {
    const pos = Math.min(MAX_AGE, Math.max(0, age - 0.5))
    const lo = Math.min(Math.floor(pos), MAX_AGE - 1)
    const w = pos - lo
    return Math.exp((1 - w) * Math.log(values[lo]) + w * Math.log(values[lo + 1]))
  }

  function plannedBehaviour(person: Person, scn: Exposures, base: Exposures, plan: NormalizedPlan, k: number, lag: number): number {
    const old = behaviourLhr(person.sex, base)
    const since = k - plan.offset
    if (since < 0) return old
    const a = plan.level(since)
    const catOld = categoricalLhr(person.sex, base)
    const target = catOld + a * (categoricalLhr(person.sex, scn) - catOld) + continuousLhr(
      person.sex,
      mix(base.pa_met_h, scn.pa_met_h, a),
      mix(base.fruit_g, scn.fruit_g, a),
      mix(base.fish_g, scn.fish_g, a),
      mix(base.sleep_h, scn.sleep_h, a),
    )
    const ramp = lag > 0 ? 1 - Math.exp(-since / lag) : 1
    return old + (target - old) * ramp
  }

  function curves(person: Person, scn: Exposures, base: Exposures, lag: number, plan?: ChangePlan | null): Curves {
    const n = Math.trunc(MAX_AGE - person.age)
    const normalized = normalizePlan(person, plan)
    const W = weightPath(person, scn, base, normalized, n)
    const heightM2 = Math.pow(person.height_cm / 100, 2)
    const B = W.map(w => w / heightM2)
    const oldLhr = behaviourLhr(person.sex, base)
    const newLhr = behaviourLhr(person.sex, scn)
    const tables = sexOf(person.sex)
    const hz = new Array<number>(n)
    for (let i = 0; i < n; i += 1) {
      const k = i + 0.5
      const mid = person.age + k
      const behaviour = normalized.isDefault
        ? newLhr + (oldLhr - newLhr) * (lag > 0 ? Math.exp(-k / lag) : 0)
        : plannedBehaviour(person, scn, base, normalized, k, lag)
      const logHr = (behaviour + bmiLhr(person.sex, (B[i] + B[i + 1]) / 2)) * ageAttenuation(person.sex, mid)
      hz[i] = interpolateLog(tables.mx, mid) * Math.exp(logHr) / interpolateLog(tables.mean_rr, mid)
    }
    const S = survival(hz)
    return {
      hz,
      S,
      W,
      B,
      le: {
        mean: person.age + expectedRemaining(hz, S),
        median: ageAtSurvival(person.age, hz, S, 0.5),
        p10: ageAtSurvival(person.age, hz, S, 0.9),
        p90: ageAtSurvival(person.age, hz, S, 0.1),
      },
      p85: pAliveAt(person.age, hz, S, 85),
    }
  }

  function survival(hz: number[]): number[] {
    const out = [1]
    let cumulative = 0
    for (const h of hz) {
      cumulative += h
      out.push(Math.exp(-cumulative))
    }
    return out
  }

  function expectedRemaining(hz: number[], S: number[]): number {
    return hz.reduce((total, h, i) => total + S[i] * (1 - Math.exp(-h)) / h, 0)
  }

  function ageAtSurvival(age: number, hz: number[], S: number[], q: number): number {
    let k = 0
    while (k + 1 < S.length && S[k + 1] >= q) k += 1
    if (k >= hz.length) return age + hz.length
    return age + k + Math.log(S[k] / q) / hz[k]
  }

  function pAliveAt(age: number, hz: number[], S: number[], at: number): number | null {
    const offset = at - age
    if (offset <= 0 || offset > hz.length) return null
    const k = Math.floor(offset)
    return S[k] * Math.exp(-hz[Math.min(k, hz.length - 1)] * (offset - k))
  }

  const current = (person: Person): Exposures => ({
    smoking: person.smoking,
    alcohol: person.alcohol,
    pa_met_h: person.pa_met_h,
    fruit_g: person.fruit_g,
    fish_g: person.fish_g,
    sleep_h: person.sleep_h,
    delta_intake_kcal: person.energy_balance_kcal,
  })

  function intakeDeltaForTargetWeight(person: Person, target: number): number {
    const reg = regOf(person.sex)
    const forbes = reg['hall.forbes_c']
    const fat0 = initialFat(person)
    const lean0 = person.weight_kg - fat0
    const mass = (fat: number) => fat + lean0 + forbes * Math.log(fat / fat0)
    let lo = 0.5
    let hi = 400
    for (let i = 0; i < 100; i += 1) {
      const mid = (lo + hi) / 2
      if (mass(mid) < target) lo = mid
      else hi = mid
    }
    const fat = (lo + hi) / 2
    const lean = lean0 + forbes * Math.log(fat / fat0)
    const { lean: eeLean, fat: eeFat } = reg['hall.energy_expenditure']
    return (eeLean * (lean - lean0) + eeFat * (fat - fat0)) / KCAL_TO_MJ
  }

  function deltaToBmiRange(person: Person, [lo, hi]: number[]): number {
    const heightM2 = Math.pow(person.height_cm / 100, 2)
    const bmi = person.weight_kg / heightM2
    const target = Math.min(Math.max(bmi, lo), hi)
    return target === bmi ? 0 : intakeDeltaForTargetWeight(person, target * heightM2)
  }

  function dietRight(person: Person): Exposures {
    const t = regOf(person.sex)['scenario.diet_right_targets']
    return {
      ...current(person),
      fruit_g: Math.max(person.fruit_g, t.fruit_g),
      fish_g: Math.max(person.fish_g, t.fish_g),
      delta_intake_kcal: deltaToBmiRange(person, t.bmi_range),
    }
  }

  function dietLoose(person: Person): Exposures {
    const reg = regOf(person.sex)
    const t = reg['scenario.diet_loose_targets']
    return {
      ...current(person),
      fruit_g: Math.min(person.fruit_g, t.fruit_g),
      fish_g: Math.min(person.fish_g, t.fish_g),
      delta_intake_kcal: Math.max(person.energy_balance_kcal, reg['scenario.adverse_energy_surplus']),
    }
  }

  function optimized(person: Person): Exposures {
    const t = regOf(person.sex)['scenario.optimized_targets']
    return {
      smoking: person.smoking === 'never' ? 'never' : 'former',
      alcohol: 'less_than_daily',
      pa_met_h: Math.max(person.pa_met_h + t.pa_increment, t.pa_minimum),
      fruit_g: Math.max(person.fruit_g, t.fruit_g),
      fish_g: Math.max(person.fish_g, t.fish_g),
      sleep_h: t.sleep_h,
      delta_intake_kcal: deltaToBmiRange(person, t.bmi_range),
    }
  }

  function adverse(person: Person): Exposures {
    const reg = regOf(person.sex)
    const t = reg['scenario.adverse_targets']
    return {
      smoking: SMOKING[Math.max(SMOKING.indexOf(person.smoking), SMOKING.indexOf(t.smoking as Smoking))],
      alcohol: ALCOHOL[Math.max(ALCOHOL.indexOf(person.alcohol), ALCOHOL.indexOf(t.alcohol as Alcohol))],
      pa_met_h: Math.min(person.pa_met_h, t.pa_met_h),
      fruit_g: Math.min(person.fruit_g, t.fruit_g),
      fish_g: Math.min(person.fish_g, t.fish_g),
      sleep_h: Math.min(person.sleep_h, t.sleep_h),
      delta_intake_kcal: Math.max(person.energy_balance_kcal, reg['scenario.adverse_energy_surplus']),
    }
  }

  function branches(person: Person, mode: 'diet' | 'lifestyle'): Record<string, Exposures> {
    return mode === 'diet'
      ? { current: current(person), diet_right: dietRight(person), diet_loose: dietLoose(person) }
      : { current: current(person), optimized: optimized(person), adverse: adverse(person) }
  }

  const lagOf = (person: Person): number => regOf(person.sex)['lag.effect_tau_years']

  /** Mean lifespan gain over "today's habits" when the change starts at each age. */
  function gainByStartAge(person: Person, scn: Exposures, ages: number[], adherence?: AdherenceSpec): { reference_mean: number; rows: StartAgeGain[] } {
    const base = current(person)
    const lag = lagOf(person)
    const reference = curves(person, base, base, lag)
    const starts = Array.from(new Set(ages.filter(age => person.age <= age && age < MAX_AGE))).sort((a, b) => a - b)
    return {
      reference_mean: reference.le.mean,
      rows: starts.map((age) => {
        const result = curves(person, scn, base, lag, { change_start_age: age, adherence })
        return {
          change_start_age: age,
          mean: result.le.mean,
          gain_years: result.le.mean - reference.le.mean,
          gain_p85_pct: result.p85 === null || reference.p85 === null ? null : (result.p85 - reference.p85) * 100,
        }
      }),
    }
  }

  /** Exp(1) threshold of one life; every branch of a life shares it (common random numbers). */
  function lifeThreshold(seed: number, lifeIndex: number): number {
    const state = add64(mul64(toU64(seed), [GAMMA_HI, GAMMA_LO]), toU64(lifeIndex))
    const [hi, lo] = splitmix64(state)
    const uniform = ((hi * 0x200000 + (lo >>> 11)) + 0.5) * Math.pow(2, -53)
    return -Math.log(1 - uniform)
  }

  function deathTime(hz: number[], threshold: number): number {
    let cumulative = 0
    for (let i = 0; i < hz.length; i += 1) {
      if (cumulative + hz[i] > threshold) return i + (threshold - cumulative) / hz[i]
      cumulative += hz[i]
    }
    return hz.length
  }

  /** Inputs outside what the source studies observed; shown as "外推" next to the control. */
  function warnings(person: Person, x: Exposures, bmiMax: number): EvidenceWarning[] {
    const reg = regOf(person.sex)
    const out: EvidenceWarning[] = []
    if (person.age < 30 || person.age > 79) out.push({ field: 'age', message: `年龄 ${person.age} 岁不在主要队列的 30–79 岁内` })
    const paHigh = reg['pa.observed_range'][1]
    if (x.pa_met_h > paHigh) out.push({ field: 'pa_met_h', message: `活动量超过原研究最大值 ${paHigh} MET-h/天` })
    if (x.pa_met_h < reg['pa.floor']) out.push({ field: 'pa_met_h', message: '活动量低于模型下限，按下限计算' })
    const observed = reg['diet.observed_range']
    const caps = reg['diet.effect_caps']
    const diet: Array<['fruit' | 'fish', string, number]> = [['fruit', '水果', x.fruit_g], ['fish', '鱼', x.fish_g]]
    diet.forEach(([key, label, value]) => {
      const [lo, hi] = observed[key]
      if (value >= lo && value <= hi) return
      const capped = value > caps[key] ? `，超过 ${caps[key]} g 的部分不再计入` : ''
      out.push({ field: `${key}_g`, message: `${label} ${Math.round(value)} g/天 超出中国队列观察范围 ${lo}–${hi} g${capped}` })
    })
    const cut = reg['sleep.cutpoints']
    if (x.sleep_h < cut[0] || x.sleep_h > cut[cut.length - 1]) out.push({ field: 'sleep_h', message: `睡眠 ${x.sleep_h} 小时超出主要研究覆盖范围` })
    if (bmiMax > 45) out.push({ field: 'bmi', message: `BMI 最高到 ${bmiMax.toFixed(1)}，超出 15–45 的研究范围` })
    return out
  }

  const adherenceOptions = (sex: Sex) => regOf(sex)['plan.adherence']

  return {
    adherenceOptions,
    branches,
    curves,
    current,
    deathTime,
    dietLoose,
    dietRight,
    gainByStartAge,
    lagOf,
    lifeThreshold,
    pAliveAt,
    warnings,
    version: { engine: constants.engine_version, registry: constants.registry_version },
  }
}

export const engine = createEngine(ENGINE_CONSTANTS as unknown as EngineConstants)
