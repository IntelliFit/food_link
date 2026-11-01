// Person-level factors that stay fixed across the futures (engine spec section 2, P_k).
import type { EngineConstants, RiskFactors, Sex } from './types'

const SBP_RANGE = [94, 194.5] as const
const RHR_RANGE = [56, 112] as const
const PM25_RANGE = [4.2, 83.8] as const
const CKB_CONDITIONS = ['stroke', 'cancer', 'copd', 'diabetes'] as const
/** Only the larger effect of each group counts, to avoid double counting. */
const EXCLUSIVE_GROUPS = [['self_rated_health', 'depression'], ['marital', 'social']] as const

const clip = (value: number, [lo, hi]: readonly [number, number]): number => Math.min(Math.max(value, lo), hi)

export function createFactors(constants: EngineConstants, attenuation: (sex: Sex, age: number) => number) {
  const knots = constants.algorithm.factor_mean_knots
  const regOf = (sex: Sex) => constants.sex[sex].reg

  /** np.interp over the knots of ln E_f; values outside are held. */
  function logMean(sex: Sex, name: string, age: number): number {
    const table = constants.sex[sex].factor_means[name]
    if (age <= knots[0]) return Math.log(table[0])
    const last = knots.length - 1
    if (age >= knots[last]) return Math.log(table[last])
    let i = 0
    while (knots[i + 1] < age) i += 1
    const w = (age - knots[i]) / (knots[i + 1] - knots[i])
    return (1 - w) * Math.log(table[i]) + w * Math.log(table[i + 1])
  }

  function expectedSbp(sex: Sex, age: number, bmi: number): number {
    const reg = regOf(sex)
    const clinical = reg['pop.cnhs_clinical']
    const corr = reg['pop.ckb_correlations']
    const model = reg['pop.age_gradient_model']
    const sd = clinical.sbp[1]
    return clinical.sbp[0] + (corr.age_sbp * sd / corr.age_sd) * (age - clinical.age) + (corr.bmi_sbp * sd / model.bmi_sd) * (bmi - model.bmi_mean)
  }

  /** ln E_f at the age this factor is compared at, per unit of attenuation. */
  function peerLogRr(sex: Sex, age: number, name: string): number {
    const reference = name === 'marital' ? Math.max(age, regOf(sex)['person.marital_min_age']) : age
    return logMean(sex, name, reference) / attenuation(sex, reference)
  }

  function factorLogHrs(sex: Sex, age: number, bmi: number, risk: RiskFactors): Record<string, number> {
    const reg = regOf(sex)
    const out: Record<string, number> = {}
    if (risk.education != null) out.education = reg['person.education'][risk.education] ?? 0
    if (risk.marital != null) out.marital = reg['person.marital'][risk.marital] ?? 0
    if (risk.sbp_mmhg != null) out.sbp = reg['person.sbp_ln'] * Math.log(clip(risk.sbp_mmhg, SBP_RANGE) / expectedSbp(sex, age, bmi))
    if (risk.resting_hr != null) out.resting_hr = reg['person.resting_hr'] * (clip(risk.resting_hr, RHR_RANGE) - reg['pop.cnhs_clinical'].rhr[0])
    if (risk.self_rated_health != null) out.self_rated_health = reg['person.self_rated_health'][risk.self_rated_health] ?? 0
    if (risk.conditions != null) {
      const has = (name: string) => risk.conditions?.includes(name) ?? false
      CKB_CONDITIONS.forEach((name) => { out[`condition_${name}`] = has(name) ? reg['person.conditions_ckb'][name] : 0 })
      out.condition_chd = has('chd') ? reg['person.chd_erfc'] * reg['person.chd_scale'] : 0
    }
    if (risk.depression != null) out.depression = risk.depression ? reg['person.depression'] : 0
    if (risk.social != null) out.social = reg['person.social_shrink'] * (reg['person.social'][risk.social] ?? 0)
    const fuel = reg['person.solid_fuel']
    if (risk.cooking_fuel != null) out.cooking_fuel = risk.cooking_fuel === 'solid' ? fuel.cooking : 0
    if (risk.heating_fuel != null) out.heating_fuel = risk.heating_fuel === 'solid' ? fuel.heating : 0
    if (risk.pm25_ugm3 != null) out.pm25 = reg['person.pm25_per10'] * (clip(risk.pm25_ugm3, PM25_RANGE) - reg['pop.other_distributions'].pm25[0]) / 10
    return resolveExclusive(sex, age, out)
  }

  function resolveExclusive(sex: Sex, age: number, lhrs: Record<string, number>): Record<string, number> {
    const out = { ...lhrs }
    const minAge = regOf(sex)['person.marital_min_age']
    EXCLUSIVE_GROUPS.forEach(([first, second]) => {
      if (!(first in out) || !(second in out)) return
      if (first === 'marital' && age < minAge) {
        delete out.marital
      } else if (Math.abs(out[second] - peerLogRr(sex, age, second)) > Math.abs(out[first] - peerLogRr(sex, age, first))) {
        delete out[first]
      } else {
        delete out[second]
      }
    })
    return out
  }

  /** Added log hazard per interval midpoint, or null when no factor is known. */
  function personLogHazard(sex: Sex, age: number, bmi: number, risk: RiskFactors | null | undefined, mids: number[]): number[] | null {
    if (!risk) return null
    const entries = Object.entries(factorLogHrs(sex, age, bmi, risk))
    if (!entries.length) return null
    const minAge = regOf(sex)['person.marital_min_age']
    return mids.map((mid) => {
      const att = attenuation(sex, mid)
      return entries.reduce((total, [name, lhr]) => {
        if (name.startsWith('condition_') && lhr !== 0) return total + att * lhr - logMean(sex, name, mid)
        if (name === 'marital') return mid >= minAge ? total + att * (lhr - peerLogRr(sex, age, name)) : total
        return total + att * (lhr - peerLogRr(sex, age, name))
      }, 0)
    })
  }

  return { personLogHazard }
}
