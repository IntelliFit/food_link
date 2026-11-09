// TypeScript port of the deterministic path of lifespan-predictor (docs/engine_spec.md there):
// all-cause hazard with the change plan, person factors, disease split and single lives,
// point estimates only. tests/unit/lifespan-engine.test.ts checks it against the shared golden
// vectors. Update constants.ts with scripts/sync-lifespan-engine.mjs.
import { ENGINE_CONSTANTS } from './constants'
import { createDisease } from './disease'
import { createFactors } from './factors'
import { lifeUniform } from './rng'
import {
  ALCOHOL, SMOKING, SODIUM_MG_PER_G_SALT,
  type AdherenceSpec, type Alcohol, type ChangePlan, type Curves, type EngineConstants, type EvidenceWarning, type Exposures,
  type FirstDisease, type NormalizedPlan, type Person, type Sex, type Smoking, type StartAgeGain,
} from './types'

export * from './types'

const MAX_AGE = 110
const KCAL_TO_MJ = 4.184e-3
const DAYS_PER_YEAR = 365.25
const WEIGHT_CACHE_LIMIT = 256
const SBP_CAP = 194.5
const BMI_SUPPORTED = [15, 45]

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
const more = (value: number | null | undefined, target: number): number | null => (value == null ? null : Math.max(value, target))
const less = (value: number | null | undefined, target: number): number | null => (value == null ? null : Math.min(value, target))

export function createEngine(constants: EngineConstants) {
  const weightCache = new Map<string, number[]>()
  const sexOf = (sex: Sex) => constants.sex[sex]
  const regOf = (sex: Sex) => sexOf(sex).reg

  function ageAttenuation(sex: Sex, age: number): number {
    const rule = regOf(sex)['age.effect_attenuation']
    const frac = Math.min(1, Math.max(0, (age - rule.start_age) / (rule.end_age - rule.start_age)))
    return 1 - frac * (1 - rule.end_multiplier)
  }

  const factors = createFactors(constants, ageAttenuation)
  const disease = createDisease(constants, ageAttenuation)

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

  /** An unanswered habit carries the population's average risk: ln of the share-weighted mean RR. */
  function levelLhr(levels: number[], shares: number[], index: number): number {
    if (index >= 0) return levels[index]
    const total = shares.reduce((sum, share) => sum + share, 0)
    return Math.log(levels.reduce((sum, level, i) => sum + shares[i] * Math.exp(level), 0) / total)
  }

  function categoricalLhr(sex: Sex, x: Exposures): number {
    const c = sexOf(sex).coef
    return levelLhr([0, c.smk_former, c.smk_lt20, c.smk_ge20], c.smk_shares, SMOKING.indexOf(x.smoking as never))
      + levelLhr([0, c.alc_1_29, c.alc_30_59, c.alc_ge60], c.alc_shares, ALCOHOL.indexOf(x.alcohol as never))
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

  function vegetableLhr(sex: Sex, grams: number): number {
    const c = sexOf(sex).coef
    return c.veg * c.veg_shrink * (Math.min(grams, c.veg_cap) - c.veg_center)
  }

  function sodiumLhr(sex: Sex, mg: number): number {
    const c = sexOf(sex).coef
    return c.sodium * (Math.min(Math.max(mg, c.sodium_lo), c.sodium_hi) - c.sodium_mean) / 1000
  }

  function behaviourLhr(sex: Sex, x: Exposures): number {
    return categoricalLhr(sex, x) + continuousLhr(sex, x.pa_met_h, x.fruit_g, x.fish_g, x.sleep_h)
      + (x.vegetables_g == null ? 0 : vegetableLhr(sex, x.vegetables_g))
      + (x.sodium_mg == null ? 0 : sodiumLhr(sex, x.sodium_mg))
      + sexOf(sex).coef.sbp_beta * (x.sbp_log_change ?? 0)
  }

  function plannedBehaviour(sex: Sex, scn: Exposures, base: Exposures, plan: NormalizedPlan, k: number, lag: number): number {
    const old = behaviourLhr(sex, base)
    const since = k - plan.offset
    if (since < 0) return old
    const a = plan.level(since)
    const catOld = categoricalLhr(sex, base)
    let target = catOld + a * (categoricalLhr(sex, scn) - catOld) + continuousLhr(
      sex,
      mix(base.pa_met_h, scn.pa_met_h, a),
      mix(base.fruit_g, scn.fruit_g, a),
      mix(base.fish_g, scn.fish_g, a),
      mix(base.sleep_h, scn.sleep_h, a),
    )
    if (base.vegetables_g != null && scn.vegetables_g != null) target += vegetableLhr(sex, mix(base.vegetables_g, scn.vegetables_g, a))
    if (base.sodium_mg != null && scn.sodium_mg != null) target += sodiumLhr(sex, mix(base.sodium_mg, scn.sodium_mg, a))
    target += sexOf(sex).coef.sbp_beta * mix(base.sbp_log_change ?? 0, scn.sbp_log_change ?? 0, a)
    const ramp = lag > 0 ? 1 - Math.exp(-since / lag) : 1
    return old + (target - old) * ramp
  }

  function bmiLhr(sex: Sex, bmi: number): number {
    const c = sexOf(sex).coef
    const low = bmi < 18.5 ? c.bmi_low : bmi < 20 ? c.bmi_185 : 0
    return low + c.bmi_per5 * Math.max(bmi - 25, 0) / 5
  }

  function interpolateLog(values: number[], age: number): number {
    const pos = Math.min(MAX_AGE, Math.max(0, age - 0.5))
    const lo = Math.min(Math.floor(pos), MAX_AGE - 1)
    const w = pos - lo
    return Math.exp((1 - w) * Math.log(values[lo]) + w * Math.log(values[lo + 1]))
  }

  /** Population mean log RR of the extra diet factors known for this person (X_k in the spec). */
  function extraDietLogMean(sex: Sex, att: number, base: Exposures): number {
    const c = sexOf(sex).coef
    const veg = base.vegetables_g == null ? 0 : 0.5 * Math.pow(att * c.veg * c.veg_shrink * c.veg_sd, 2)
    const sodium = base.sodium_mg == null ? 0 : 0.5 * Math.pow(att * c.sodium * c.sodium_sd / 1000, 2)
    return veg + sodium
  }

  function curves(person: Person, future: Exposures, base: Exposures, lag: number, plan?: ChangePlan | null): Curves {
    // A future that does not mention vegetables or salt keeps today's value.
    const scn: Exposures = {
      ...future,
      vegetables_g: future.vegetables_g ?? base.vegetables_g,
      sodium_mg: future.sodium_mg ?? base.sodium_mg,
    }
    const { sex, age } = person
    const n = Math.trunc(MAX_AGE - age)
    const normalized = normalizePlan(person, plan)
    const W = weightPath(person, scn, base, normalized, n)
    const heightM2 = Math.pow(person.height_cm / 100, 2)
    const B = W.map(w => w / heightM2)
    const oldLhr = behaviourLhr(sex, base)
    const newLhr = behaviourLhr(sex, scn)
    const tables = sexOf(sex)
    const mids = Array.from({ length: n }, (_, i) => age + i + 0.5)
    const personal = factors.personLogHazard(sex, age, person.weight_kg / heightM2, person.risk, mids)
    const hz = mids.map((mid, i) => {
      const k = i + 0.5
      const att = ageAttenuation(sex, mid)
      const behaviour = normalized.isDefault
        ? newLhr + (oldLhr - newLhr) * (lag > 0 ? Math.exp(-k / lag) : 0)
        : plannedBehaviour(sex, scn, base, normalized, k, lag)
      const logHr = (behaviour + bmiLhr(sex, (B[i] + B[i + 1]) / 2)) * att
      return interpolateLog(tables.mx, mid) * Math.exp(logHr - extraDietLogMean(sex, att, base) + (personal ? personal[i] : 0)) / interpolateLog(tables.mean_rr, mid)
    })
    const S = survival(hz)
    const illness = disease.curves(person, scn, base, hz, S, B, lag, normalized)
    return {
      hz,
      S,
      W,
      B,
      le: {
        mean: age + expectedRemaining(hz, S),
        median: ageAtSurvival(age, hz, S, 0.5),
        p10: ageAtSurvival(age, hz, S, 0.9),
        p90: ageAtSurvival(age, hz, S, 0.1),
      },
      p85: pAliveAt(age, hz, S, 85),
      disease: illness,
      healthy: disease.healthySummary(age, illness, hz, S),
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
    vegetables_g: person.vegetables_g ?? null,
    sodium_mg: person.sodium_mg ?? null,
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

  /** Long-run overeating; for someone underweight that would lower their modelled risk, so none. */
  function surplus(person: Person): number {
    const reg = regOf(person.sex)
    const bmi = person.weight_kg / Math.pow(person.height_cm / 100, 2)
    if (bmi < reg['scenario.diet_right_targets'].bmi_range[0]) return person.energy_balance_kcal
    return Math.max(person.energy_balance_kcal, reg['scenario.adverse_energy_surplus'])
  }

  function dietRight(person: Person): Exposures {
    const t = regOf(person.sex)['scenario.diet_right_targets']
    return {
      ...current(person),
      fruit_g: Math.max(person.fruit_g, t.fruit_g),
      fish_g: Math.max(person.fish_g, t.fish_g),
      delta_intake_kcal: deltaToBmiRange(person, t.bmi_range),
      vegetables_g: more(person.vegetables_g, t.vegetables_g),
      sodium_mg: less(person.sodium_mg, t.sodium_mg),
    }
  }

  function dietLoose(person: Person): Exposures {
    const t = regOf(person.sex)['scenario.diet_loose_targets']
    return {
      ...current(person),
      fruit_g: Math.min(person.fruit_g, t.fruit_g),
      fish_g: Math.min(person.fish_g, t.fish_g),
      delta_intake_kcal: surplus(person),
      vegetables_g: less(person.vegetables_g, t.vegetables_g),
      sodium_mg: more(person.sodium_mg, t.sodium_mg),
    }
  }

  function optimizedAlcohol(person: Person): Alcohol {
    if (person.alcohol === 'unknown') return 'unknown'
    if (person.alcohol === 'daily_1_29' && regOf(person.sex)['alcohol.daily_1_29'] < 0) return person.alcohol
    return 'less_than_daily'
  }

  function sbpChange(person: Person): number {
    const sbp = person.risk?.sbp_mmhg
    if (sbp == null) return 0
    const target = regOf(person.sex)['person.sbp_control_target']
    const clipped = Math.min(sbp, SBP_CAP)
    return clipped > target ? Math.log(target / clipped) : 0
  }

  function optimized(person: Person): Exposures {
    const t = regOf(person.sex)['scenario.optimized_targets']
    return {
      smoking: person.smoking === 'never' || person.smoking === 'unknown' ? person.smoking : 'former',
      alcohol: optimizedAlcohol(person),
      pa_met_h: Math.max(person.pa_met_h + t.pa_increment, t.pa_minimum),
      fruit_g: Math.max(person.fruit_g, t.fruit_g),
      fish_g: Math.max(person.fish_g, t.fish_g),
      sleep_h: t.sleep_h,
      delta_intake_kcal: deltaToBmiRange(person, t.bmi_range),
      vegetables_g: more(person.vegetables_g, t.vegetables_g),
      sodium_mg: less(person.sodium_mg, t.sodium_mg),
      sbp_log_change: sbpChange(person),
    }
  }

  function adverse(person: Person): Exposures {
    const reg = regOf(person.sex)
    const t = reg['scenario.adverse_targets']
    const worse = <T extends string>(levels: readonly T[], value: T | 'unknown', target: T): T =>
      (value === 'unknown' ? target : levels[Math.max(levels.indexOf(value as T), levels.indexOf(target))])
    return {
      smoking: worse(SMOKING, person.smoking, t.smoking as (typeof SMOKING)[number]) as Smoking,
      alcohol: worse(ALCOHOL, person.alcohol, t.alcohol as (typeof ALCOHOL)[number]) as Alcohol,
      pa_met_h: Math.min(person.pa_met_h, t.pa_met_h),
      fruit_g: Math.min(person.fruit_g, t.fruit_g),
      fish_g: Math.min(person.fish_g, t.fish_g),
      // Short sleep, unless the person sleeps so long that their modelled risk is already higher.
      sleep_h: person.sleep_h >= reg['sleep.cutpoints'][3] ? person.sleep_h : Math.min(person.sleep_h, t.sleep_h),
      delta_intake_kcal: surplus(person),
      vegetables_g: less(person.vegetables_g, t.vegetables_g),
      sodium_mg: more(person.sodium_mg, t.sodium_mg),
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
          gain_years_free: result.healthy.mean_years_free - reference.healthy.mean_years_free,
          gain_p85_pct: result.p85 === null || reference.p85 === null ? null : (result.p85 - reference.p85) * 100,
        }
      }),
    }
  }

  /** Exp(1) threshold of one life; every branch of a life shares it (common random numbers). */
  const lifeThreshold = (seed: number, lifeIndex: number): number => -Math.log(1 - lifeUniform(seed, lifeIndex))

  function deathTime(hz: number[], threshold: number): number {
    let cumulative = 0
    for (let i = 0; i < hz.length; i += 1) {
      if (cumulative + hz[i] > threshold) return i + (threshold - cumulative) / hz[i]
      cumulative += hz[i]
    }
    return hz.length
  }

  /** First major disease of a life, or null; the death age is unaffected by it. */
  function firstDisease(person: Person, result: Curves, deathT: number, seed: number, lifeIndex: number): FirstDisease | null {
    const onset = disease.sampleOnset(result.disease, result.S, deathT, lifeUniform(seed, lifeIndex, 1))
    if (onset === null) return null
    return { age: person.age + onset, type: disease.eventType(person.sex, lifeUniform(seed, lifeIndex, 2)) }
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
    if (bmiMax < BMI_SUPPORTED[0] || bmiMax > BMI_SUPPORTED[1]) out.push({ field: 'bmi', message: `BMI ${bmiMax.toFixed(1)} 超出 15–45 的研究范围` })
    const c = sexOf(person.sex).coef
    if (x.vegetables_g != null && x.vegetables_g > c.veg_cap) out.push({ field: 'vegetables_g', message: `蔬菜超过 ${c.veg_cap} g/天的部分不再计入` })
    if (x.sodium_mg != null && (x.sodium_mg < c.sodium_lo || x.sodium_mg > c.sodium_hi)) {
      const [lo, hi] = [c.sodium_lo, c.sodium_hi].map(mg => Math.round(mg / SODIUM_MG_PER_G_SALT))
      out.push({ field: 'sodium_mg', message: `盐在约 ${lo}–${hi} g/天以外的部分不再计入` })
    }
    return out
  }

  /** Input rule for a hypertension diagnosis without a reading: never below what age and BMI predict. */
  function assumedSbp(person: Person): number | null {
    const { risk } = person
    if (risk?.sbp_mmhg != null || !risk?.conditions?.includes('hypertension')) return null
    const bmi = person.weight_kg / Math.pow(person.height_cm / 100, 2)
    return Math.max(regOf(person.sex)['input.clinical_mapping'].assumed_sbp, factors.expectedSbp(person.sex, person.age, bmi))
  }

  /** How much of the result rests on real answers, 0–100 (registry input.completeness_weights). */
  function completeness(person: Person): number {
    const weights = regOf(person.sex)['input.completeness_weights']
    const known: Record<string, boolean> = {
      smoking: person.smoking !== 'unknown',
      alcohol: person.alcohol !== 'unknown',
      activity: true,
      sleep: true,
      fruit: true,
      fish: true,
      vegetables: person.vegetables_g != null,
      sodium: person.sodium_mg != null,
      weight_trend: true,
      conditions: person.risk?.conditions != null,
      sbp: person.risk?.sbp_mmhg != null,
    }
    return Object.entries(weights).reduce((sum, [key, weight]) => (known[key] ? sum + weight : sum), 0)
  }

  const adherenceOptions = (sex: Sex) => regOf(sex)['plan.adherence']

  return {
    adherenceOptions,
    assumedSbp,
    branches,
    completeness,
    curves,
    current,
    deathTime,
    dietLoose,
    dietRight,
    firstDisease,
    freeAt: disease.freeAt,
    gainByStartAge,
    lagOf,
    lifeThreshold,
    pAliveAt,
    warnings,
    version: { engine: constants.engine_version, registry: constants.registry_version },
  }
}

export const engine = createEngine(ENGINE_CONSTANTS as unknown as EngineConstants)
