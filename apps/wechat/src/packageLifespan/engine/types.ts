// Inputs, outputs and constants of the lifespan engine (lifespan-predictor docs/engine_spec.md).

export const SMOKING = ['never', 'former', 'current_lt20', 'current_ge20'] as const
export const ALCOHOL = ['less_than_daily', 'daily_1_29', 'daily_30_59', 'daily_ge60'] as const
export const UNKNOWN = 'unknown'
export const SODIUM_MG_PER_G_SALT = 393

export type Sex = 'male' | 'female'
/** `unknown` means not answered: the population's average risk is used. */
export type Smoking = (typeof SMOKING)[number] | typeof UNKNOWN
export type Alcohol = (typeof ALCOHOL)[number] | typeof UNKNOWN

export const CONDITIONS = ['stroke', 'cancer', 'copd', 'diabetes', 'chd', 'hypertension', 'hyperlipidemia'] as const
export type Condition = (typeof CONDITIONS)[number]

/** Facts shared by every future of a person. Anything left out is unknown and not modelled. */
export interface RiskFactors {
  education?: string | null
  marital?: string | null
  sbp_mmhg?: number | null
  resting_hr?: number | null
  self_rated_health?: string | null
  /** null = unknown, [] = known to have none of them. */
  conditions?: string[] | null
  depression?: boolean | null
  social?: string | null
  cooking_fuel?: string | null
  heating_fuel?: string | null
  pm25_ugm3?: number | null
}

export interface Exposures {
  smoking: Smoking
  alcohol: Alcohol
  pa_met_h: number
  fruit_g: number
  fish_g: number
  sleep_h: number
  delta_intake_kcal: number
  vegetables_g?: number | null
  sodium_mg?: number | null
  sbp_log_change?: number
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
  vegetables_g?: number | null
  sodium_mg?: number | null
  risk?: RiskFactors | null
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

export interface NormalizedPlan {
  offset: number
  level: (years: number) => number
  isDefault: boolean
  key: string
}

export interface LifeExpectancy {
  mean: number
  median: number
  p10: number
  p90: number
}

export interface DiseaseCurves {
  free: number[]
  incidence: number[]
  deathFree: number[]
  alreadyIll: boolean
}

export interface HealthyYears {
  mean_years_free: number
  mean_years_with_disease: number
  share_free: number
  median_age_until_major_disease: number | null
}

export interface Curves {
  hz: number[]
  S: number[]
  W: number[]
  B: number[]
  le: LifeExpectancy
  p85: number | null
  disease: DiseaseCurves
  healthy: HealthyYears
}

export type DiseaseEventType = 'cvd' | 'cancer' | 'chronic_respiratory'

export interface FirstDisease {
  age: number
  type: DiseaseEventType
}

export interface EvidenceWarning {
  field: string
  message: string
}

export interface StartAgeGain {
  change_start_age: number
  mean: number
  gain_years: number
  gain_years_free: number
  gain_p85_pct: number | null
}

export interface Coefficients {
  smk_former: number
  smk_lt20: number
  smk_ge20: number
  smk_shares: number[]
  alc_1_29: number
  alc_30_59: number
  alc_ge60: number
  alc_shares: number[]
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
  veg: number
  veg_shrink: number
  veg_center: number
  veg_sd: number
  veg_cap: number
  sodium: number
  sodium_mean: number
  sodium_sd: number
  sodium_lo: number
  sodium_hi: number
  sbp_beta: number
}

interface DietTargets {
  fruit_g: number
  fish_g: number
  vegetables_g: number
  sodium_mg: number
}

export interface Registry {
  'age.effect_attenuation': { start_age: number; end_age: number; end_multiplier: number }
  'alcohol.daily_1_29': number
  'lag.effect_tau_years': number
  'hall.energy_expenditure': { lean: number; fat: number }
  'hall.rho_fat': number
  'hall.rho_lean': number
  'hall.forbes_c': number
  'hall.initial_body_fat': number[]
  'scenario.diet_right_targets': DietTargets & { bmi_range: number[] }
  'scenario.diet_loose_targets': DietTargets
  'scenario.optimized_targets': DietTargets & { pa_increment: number; pa_minimum: number; sleep_h: number; bmi_range: number[] }
  'scenario.adverse_targets': DietTargets & { smoking: Smoking; alcohol: Alcohol; pa_met_h: number; sleep_h: number }
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
  'input.completeness_weights': Record<string, number>
  'input.clinical_mapping': { assumed_sbp: number; hba1c_diabetes: number }
  'person.education': Record<string, number>
  'person.marital': Record<string, number>
  'person.marital_min_age': number
  'person.self_rated_health': Record<string, number>
  'person.conditions_ckb': Record<string, number>
  'person.chd_erfc': number
  'person.chd_scale': number
  'person.sbp_ln': number
  'person.sbp_control_target': number
  'person.resting_hr': number
  'person.depression': number
  'person.social': Record<string, number>
  'person.social_shrink': number
  'person.solid_fuel': { cooking: number; heating: number }
  'person.pm25_per10': number
  'pop.cnhs_clinical': { age: number; sbp: number[]; rhr: number[] }
  'pop.ckb_correlations': { age_sd: number; age_sbp: number; bmi_sbp: number }
  'pop.age_gradient_model': { bmi_mean: number; bmi_sd: number }
  'pop.other_distributions': { pm25: number[] }
  'pop.cnhs_smoking': number[]
  'pop.cnhs_alcohol': number[]
  'pop.cnhs_pa_mean_by_age': number[]
  'pop.cnhs_overall_sd': { pa: number[] }
  'disease.calibration': { alpha: number; beta: number; hr_ill: number }
  'disease.first_event_counts': { cvd: number; cancer: number; crd: number }
  'disease.other_factor_hr': number
  'disease.body_fat_hr': number
}

export interface SexConstants {
  mx: number[]
  mean_rr: number[]
  coef: Coefficients
  factor_means: Record<string, number[]>
  disease_mean_log_rr: number[]
  reg: Registry
}

export interface EngineConstants {
  engine_version: string
  registry_version: string
  algorithm: {
    factor_mean_knots: number[]
    low_risk_rules: { diet_fruit_min_g: number; diet_fish_min_g: number; body_bmi_range: number[] }
  }
  sex: Record<Sex, SexConstants>
}
