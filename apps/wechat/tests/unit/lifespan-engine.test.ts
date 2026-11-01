import { readFileSync } from 'fs'
import { join } from 'path'

import { ENGINE_CONSTANTS } from '../../src/packageLifespan/engine/constants'
import {
  createEngine,
  engine,
  type AdherenceSpec,
  type EngineConstants,
  type Exposures,
  type Person,
} from '../../src/packageLifespan/engine/engine'

interface GoldenBranch {
  scenario: Exposures & { name: string }
  life_expectancy: { mean: number; median: number; p10: number; p90: number }
  p_alive: Record<string, number>
  weight_kg: { start: number; mid: number; end: number }
  one_life: number[]
}

interface GoldenCase {
  id: string
  profile: Person
  mode: 'diet' | 'lifestyle'
  custom_scenario: (Exposures & { name: string; label: string }) | null
  change_start_age: number | null
  adherence: AdherenceSpec
  lag_tau_years: number | null
  seed: number
  expected: Record<string, GoldenBranch>
}

const constants = ENGINE_CONSTANTS as unknown as EngineConstants

const golden = JSON.parse(readFileSync(join(__dirname, '../fixtures/lifespan-golden.json'), 'utf8')) as {
  engine_version: string
  registry_version: string
  tolerance: { age_years: number; p_alive: number }
  cases: GoldenCase[]
}

const MALE_32: Person = {
  sex: 'male', age: 32, height_cm: 175, weight_kg: 78, smoking: 'never', alcohol: 'less_than_daily',
  pa_met_h: 14, fruit_g: 60, fish_g: 15, sleep_h: 6.5, energy_balance_kcal: 60,
}

function scenariosOf(cs: GoldenCase): Record<string, Exposures> {
  const scenarios: Record<string, Exposures> = { ...engine.branches(cs.profile, cs.mode) }
  if (cs.custom_scenario) {
    const { name, label: _label, ...exposures } = cs.custom_scenario
    scenarios[name] = exposures
  }
  return scenarios
}

describe('lifespan engine golden vectors', () => {
  it('uses constants and fixtures from the same engine version', () => {
    expect(constants.engine_version).toBe(golden.engine_version)
    expect(constants.registry_version).toBe(golden.registry_version)
    expect(golden.cases.length).toBeGreaterThanOrEqual(240)
  })

  it.each(golden.cases.map(cs => [cs.id, cs] as const))('%s matches the reference engine', (_id, cs) => {
    const { age_years: tolAge, p_alive: tolP } = golden.tolerance
    const base = engine.current(cs.profile)
    const lag = cs.lag_tau_years ?? engine.lagOf(cs.profile)
    const plan = { change_start_age: cs.change_start_age, adherence: cs.adherence }
    const scenarios = scenariosOf(cs)
    const branchKeys = Object.keys(cs.expected)

    branchKeys.forEach((key, index) => {
      const want = cs.expected[key]
      const scn = scenarios[key]
      expect(scn.smoking).toBe(want.scenario.smoking)
      expect(scn.alcohol).toBe(want.scenario.alcohol)
      for (const field of ['pa_met_h', 'fruit_g', 'fish_g', 'sleep_h', 'delta_intake_kcal'] as const) {
        expect(Math.abs(scn[field] - want.scenario[field])).toBeLessThanOrEqual(1e-6)
      }

      const curves = engine.curves(cs.profile, scn, base, lag, index === 0 ? null : plan)
      for (const quantile of ['mean', 'median', 'p10', 'p90'] as const) {
        expect(Math.abs(curves.le[quantile] - want.life_expectancy[quantile])).toBeLessThanOrEqual(tolAge)
      }
      for (const [age, value] of Object.entries(want.p_alive)) {
        const alive = engine.pAliveAt(cs.profile.age, curves.hz, curves.S, Number(age))
        expect(Math.abs((alive as number) - value)).toBeLessThanOrEqual(tolP)
      }
      expect(Math.abs(curves.W[0] - want.weight_kg.start)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(curves.W[Math.floor(curves.W.length / 2)] - want.weight_kg.mid)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(curves.W[curves.W.length - 1] - want.weight_kg.end)).toBeLessThanOrEqual(0.05)
      want.one_life.forEach((death, life) => {
        const age = cs.profile.age + engine.deathTime(curves.hz, engine.lifeThreshold(cs.seed, life))
        expect(Math.abs(age - death)).toBeLessThanOrEqual(tolAge)
      })
    })
  })
})

describe('lifespan engine behaviour', () => {
  const base = engine.current(MALE_32)
  const lag = engine.lagOf(MALE_32)
  const right = engine.dietRight(MALE_32)

  it('gives the same result whether the weight path comes from the cache or not', () => {
    const fresh = createEngine(constants)
    const first = fresh.curves(MALE_32, right, base, lag)
    const second = fresh.curves(MALE_32, right, base, lag)
    expect(second.W).toEqual(first.W)
    expect(second.le).toEqual(first.le)
  })

  it('treats the default plan exactly like no plan', () => {
    const plain = engine.curves(MALE_32, right, base, lag)
    const explicit = engine.curves(MALE_32, right, base, lag, { change_start_age: 32, adherence: null })
    expect(explicit.le).toEqual(plain.le)
  })

  it('reports smaller gains the later the change starts', () => {
    const { rows } = engine.gainByStartAge(MALE_32, right, [32, 40, 50, 60, 70])
    expect(rows.map(row => row.change_start_age)).toEqual([32, 40, 50, 60, 70])
    rows.slice(1).forEach((row, index) => {
      expect(row.gain_years).toBeLessThan(rows[index].gain_years)
    })
    expect(rows[0].gain_years).toBeCloseTo(4.25, 1)
  })

  it('drops start ages before now or at the end of the table', () => {
    const { rows } = engine.gainByStartAge(MALE_32, right, [20, 32, 32, 110])
    expect(rows.map(row => row.change_start_age)).toEqual([32])
  })

  it('flags inputs outside the observed range', () => {
    const fields = engine.warnings({ ...MALE_32, age: 25 }, { ...base, fruit_g: 500, sleep_h: 3, pa_met_h: 70 }, 50)
      .map(warning => warning.field)
    expect(fields).toEqual(expect.arrayContaining(['age', 'fruit_g', 'sleep_h', 'pa_met_h', 'bmi']))
    expect(engine.warnings(MALE_32, base, 26)).toEqual([])
  })
})
