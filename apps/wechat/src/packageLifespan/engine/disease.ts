// Major chronic disease: disease-free survival and when a life falls ill (engine spec sections 5 and 6).
// All-cause survival always comes from the main hazard; this only splits it into disease-free and ill.
import type { DiseaseCurves, DiseaseEventType, EngineConstants, Exposures, HealthyYears, NormalizedPlan, Person, Sex } from './types'

const MAJOR_DISEASE_CONDITIONS = ['stroke', 'cancer', 'copd', 'chd']
const BEHAVIOUR_FACTORS = ['smoking', 'alcohol', 'activity', 'diet'] as const
const GROUP_START = 30
const BUCKET_START = 30
const BUCKET_LAST = 11

type Scores = Record<(typeof BEHAVIOUR_FACTORS)[number], number>

const round = (value: number, digits: number): number => {
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

export function createDisease(constants: EngineConstants, attenuation: (sex: Sex, age: number) => number) {
  const regOf = (sex: Sex) => constants.sex[sex].reg
  const rules = constants.algorithm.low_risk_rules

  function behaviourScores(sex: Sex, baselineAge: number, x: Exposures): Scores {
    const reg = regOf(sex)
    const smk = reg['pop.cnhs_smoking']
    const alc = reg['pop.cnhs_alcohol']
    const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)
    let smoking = x.smoking === 'never' || x.smoking === 'former' ? 1 : 0
    if (x.smoking === 'unknown') smoking = (smk[0] + smk[1]) / total(smk)
    let alcohol = 0
    if (x.alcohol === 'unknown') alcohol = (alc[0] + alc[1]) / total(alc)
    else if (x.alcohol === 'less_than_daily') alcohol = 1
    else if (x.alcohol === 'daily_1_29') alcohol = sex === 'male' ? 1 : 0.5
    const byAge = reg['pop.cnhs_pa_mean_by_age']
    const group = Math.min(Math.max(Math.floor((baselineAge - GROUP_START) / 10), 0), byAge.length - 1)
    const [paMean, paSd] = reg['pop.cnhs_overall_sd'].pa
    const medianPa = byAge[group] / Math.sqrt(1 + Math.pow(paSd / paMean, 2))
    return {
      smoking,
      alcohol,
      activity: x.pa_met_h >= medianPa ? 1 : 0,
      diet: x.fruit_g >= rules.diet_fruit_min_g && x.fish_g >= rules.diet_fish_min_g ? 1 : 0,
    }
  }

  const isAlreadyIll = (person: Person): boolean =>
    (person.risk?.conditions ?? []).some(condition => MAJOR_DISEASE_CONDITIONS.includes(condition))

  /** Splits survival interval by interval on the disease-free share, capped at 1, so it stays valid at any hazard. */
  function split(hazard: number[], S: number[], incidence: number[], hrIll: number, alreadyIll: boolean): DiseaseCurves {
    const n = hazard.length
    const free = new Array<number>(n + 1)
    const deathFree = new Array<number>(n)
    free[0] = alreadyIll ? 0 : 1
    let logShare = 0
    for (let k = 0; k < n; k += 1) {
      const share = alreadyIll ? 0 : Math.exp(logShare)
      const mFree = hazard[k] / (share + hrIll * (1 - share))
      deathFree[k] = mFree
      logShare = Math.min(logShare + hazard[k] - incidence[k] - mFree, 0)
      free[k + 1] = alreadyIll ? 0 : S[k + 1] * Math.exp(logShare)
    }
    return { free, incidence, deathFree, alreadyIll }
  }

  function curves(person: Person, scn: Exposures, base: Exposures, hazard: number[], S: number[], bmi: number[], lag: number, plan: NormalizedPlan): DiseaseCurves {
    const { sex, age } = person
    const reg = regOf(sex)
    const { alpha, beta, hr_ill: hrIll } = reg['disease.calibration']
    const logOther = Math.log(reg['disease.other_factor_hr'])
    const logBody = Math.log(reg['disease.body_fat_hr'])
    const old = behaviourScores(sex, age, base)
    const next = behaviourScores(sex, age, scn)
    const meanLog = constants.sex[sex].disease_mean_log_rr
    const [bmiLow, bmiHigh] = rules.body_bmi_range
    const incidence = hazard.map((_, k) => {
      const mid = age + k + 0.5
      const since = k + 0.5 - plan.offset
      const a = since >= 0 ? plan.level(since) : 0
      const ramp = since < 0 ? 0 : lag > 0 ? 1 - Math.exp(-since / lag) : 1
      const score = BEHAVIOUR_FACTORS.reduce((sum, factor) => sum + old[factor] + (next[factor] - old[factor]) * a * ramp, 0)
      const midBmi = (bmi[k] + bmi[k + 1]) / 2
      const lhr = logOther * score + (midBmi >= bmiLow && midBmi < bmiHigh ? logBody : 0)
      const bucket = Math.min(Math.max(Math.floor((Math.floor(mid) - BUCKET_START) / 5), 0), BUCKET_LAST)
      return Math.exp(alpha + beta * (mid - 40)) * Math.exp(attenuation(sex, mid) * (lhr - meanLog[bucket]))
    })
    return split(hazard, S, incidence, hrIll, isAlreadyIll(person))
  }

  function healthySummary(age: number, disease: DiseaseCurves, hazard: number[], S: number[]): HealthyYears {
    const { free, incidence, deathFree } = disease
    const rate = incidence.map((value, k) => value + deathFree[k])
    const yearsFree = rate.reduce((sum, r, k) => sum + free[k] * (1 - Math.exp(-r)) / r, 0)
    const yearsAlive = hazard.reduce((sum, h, k) => sum + S[k] * (1 - Math.exp(-h)) / h, 0)
    let median: number | null = null
    if (free[0] > 0.5) {
      let k = 0
      while (k + 1 < free.length && free[k + 1] >= 0.5) k += 1
      if (k < rate.length) median = round(age + k + Math.log(free[k] / 0.5) / rate[k], 2)
    }
    return {
      median_age_until_major_disease: median,
      mean_years_free: round(yearsFree, 2),
      mean_years_with_disease: round(Math.max(yearsAlive - yearsFree, 0), 2),
      share_free: round(yearsFree / yearsAlive, 4),
    }
  }

  function freeAt(age: number, disease: DiseaseCurves, at: number): number | null {
    const offset = at - age
    const n = disease.incidence.length
    if (offset <= 0 || offset > n) return null
    const k = Math.min(Math.floor(offset), n - 1)
    return disease.free[k] * Math.exp(-(disease.incidence[k] + disease.deathFree[k]) * (offset - k))
  }

  /** New cases per interval and the half-interval survival of the ill, so deaths match the curves exactly. */
  function illFlows(disease: DiseaseCurves, S: number[]): { newCases: number[]; half: number[] } {
    const { free, incidence, deathFree } = disease
    const newCases = incidence.map((value, k) => {
      const r = value + deathFree[k]
      return free[k] * (1 - Math.exp(-r)) * value / r
    })
    const half = newCases.map((cases, k) => {
      const ill = S[k] - free[k]
      const next = Math.max(S[k + 1] - free[k + 1], 0)
      let y = 1
      if (ill > 1e-300) y = (-cases + Math.sqrt(cases * cases + 4 * ill * next)) / (2 * ill)
      else if (cases > 0) y = next / cases
      return Math.min(Math.max(y, 0), 1)
    })
    return { newCases, half }
  }

  /** Time of first major disease in a life that ends at deathT, or null; u is one uniform number. */
  function sampleOnset(disease: DiseaseCurves, S: number[], deathT: number, u: number): number | null {
    if (disease.alreadyIll) return null
    const n = disease.incidence.length
    const last = Math.min(Math.floor(deathT), n - 1)
    const { newCases, half } = illFlows(disease, S)
    const rate = disease.incidence[last] + disease.deathFree[last]
    const stayFree = disease.free[last] * (1 - Math.exp(-rate)) * disease.deathFree[last] / rate
    const weights = new Array<number>(last + 1).fill(0)
    weights[last] = newCases[last] * (1 - half[last])
    let carry = 1 - half[last] * half[last]
    for (let j = last - 1; j >= 0; j -= 1) {
      weights[j] = newCases[j] * half[j] * carry
      carry *= half[j] * half[j]
    }
    const total = stayFree + weights.reduce((sum, weight) => sum + weight, 0)
    if (total <= 0 || u < stayFree / total) return null
    const position = (u - stayFree / total) * total
    let cumulative = 0
    for (let j = 0; j <= last; j += 1) {
      if (weights[j] > 0 && cumulative + weights[j] >= position) return Math.min(j + (position - cumulative) / weights[j], deathT)
      cumulative += weights[j]
    }
    return Math.min(last, deathT)
  }

  function eventType(sex: Sex, u: number): DiseaseEventType {
    const counts = regOf(sex)['disease.first_event_counts']
    const total = counts.cvd + counts.cancer + counts.crd
    if (u < counts.cvd / total) return 'cvd'
    return u < (counts.cvd + counts.cancer) / total ? 'cancer' : 'chronic_respiratory'
  }

  return { curves, eventType, freeAt, healthySummary, sampleOnset }
}
