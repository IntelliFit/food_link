import {
  addFocusKeyIfRoom,
  localFocusKeys,
  MAX_HEALTH_FOCUS,
  resolveFocusKeys,
  sameKeys,
  splitFocusCards,
  toggleFocusKey,
} from '../../src/packageStats/pages/stats/focus-selection'
import { normalizeNutritionState } from '../../src/utils/nutrition-state-view'
import type { RiskCard } from '../../src/utils/api'

function card(key: string, overrides: Partial<RiskCard> = {}): RiskCard {
  return { key, title: key, score: 60, tone: 'neutral', brief: '', summary: '', basis: '', action: '', delta: 0, ...overrides }
}

const server = (...keys: string[]) => keys.map(key => ({ key, title: key, custom: key.startsWith('custom:') }))

describe('local focus fallback', () => {
  it('tells a never-saved preference apart from a saved empty one', () => {
    expect(localFocusKeys(undefined)).toBeNull()
    expect(localFocusKeys('')).toBeNull()
    expect(localFocusKeys([])).toEqual([])
  })

  it('caps the old five-card preference at three and drops blanks and repeats', () => {
    expect(MAX_HEALTH_FOCUS).toBe(3)
    expect(localFocusKeys(['hypertension', '', 'diabetes', 'hypertension', 'cardio', 'weight'])).toEqual(['hypertension', 'diabetes', 'cardio'])
  })

  it('maps engine keys onto card keys', () => {
    expect(localFocusKeys(['blood_pressure', 'gut'])).toEqual(['hypertension', 'colorectal'])
  })
})

describe('resolveFocusKeys', () => {
  it('uses the server choice when there is one', () => {
    expect(resolveFocusKeys({ serverFocus: server('diabetes', 'custom:abc'), localStored: ['weight'], pendingLocal: false }))
      .toEqual({ keys: ['diabetes', 'custom:abc'], pushToServer: false })
  })

  it('uploads the local choice the first time the server is empty', () => {
    expect(resolveFocusKeys({ serverFocus: [], localStored: ['weight', 'cardio'], pendingLocal: false }))
      .toEqual({ keys: ['weight', 'cardio'], pushToServer: true })
  })

  it('stays empty when neither side has a choice', () => {
    expect(resolveFocusKeys({ serverFocus: [], localStored: undefined, pendingLocal: false })).toEqual({ keys: [], pushToServer: false })
    expect(resolveFocusKeys({ serverFocus: [], localStored: [], pendingLocal: false })).toEqual({ keys: [], pushToServer: false })
  })

  it('falls back to this device when the server sent nothing', () => {
    expect(resolveFocusKeys({ serverFocus: undefined, localStored: ['weight'], pendingLocal: false })).toEqual({ keys: ['weight'], pushToServer: false })
    expect(resolveFocusKeys({ serverFocus: undefined, localStored: undefined, pendingLocal: false })).toEqual({ keys: [], pushToServer: false })
  })

  it('re-sends an edit that did not reach the server instead of taking the old server copy', () => {
    expect(resolveFocusKeys({ serverFocus: server('diabetes'), localStored: ['weight'], pendingLocal: true }))
      .toEqual({ keys: ['weight'], pushToServer: true })
    // 取消到一项不剩也要补传
    expect(resolveFocusKeys({ serverFocus: server('diabetes'), localStored: [], pendingLocal: true }))
      .toEqual({ keys: [], pushToServer: true })
  })
})

describe('editing focus', () => {
  it('toggles and refuses a fourth', () => {
    expect(toggleFocusKey(['a', 'b'], 'c')).toEqual({ keys: ['a', 'b', 'c'], rejected: false })
    expect(toggleFocusKey(['a', 'b', 'c'], 'b')).toEqual({ keys: ['a', 'c'], rejected: false })
    expect(toggleFocusKey(['a', 'b', 'c'], 'd')).toEqual({ keys: ['a', 'b', 'c'], rejected: true })
  })

  it('adds a new custom focus only when there is room', () => {
    expect(addFocusKeyIfRoom(['a'], 'custom:1')).toEqual({ keys: ['a', 'custom:1'], rejected: false })
    expect(addFocusKeyIfRoom(['a', 'custom:1'], 'custom:1')).toEqual({ keys: ['a', 'custom:1'], rejected: false })
    expect(addFocusKeyIfRoom(['a', 'b', 'c'], 'custom:1')).toEqual({ keys: ['a', 'b', 'c'], rejected: true })
  })

  it('compares choices in order', () => {
    expect(sameKeys(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameKeys(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})

describe('splitFocusCards', () => {
  it('puts focus cards on top in the chosen order and folds the rest', () => {
    const cards = [card('hypertension'), card('diabetes'), card('cardio'), card('custom:1', { is_custom: true })]
    const { focusCards, otherCards } = splitFocusCards(cards, ['custom:1', 'hypertension', 'missing'])
    expect(focusCards.map(item => item.key)).toEqual(['custom:1', 'hypertension'])
    expect(otherCards.map(item => item.key)).toEqual(['diabetes', 'cardio'])
  })
})

describe('nutrition-state focus field', () => {
  it('keeps a missing field undefined so an older backend falls back to this device', () => {
    expect(normalizeNutritionState({ date: '2026-11-05' })!.focus).toBeUndefined()
    expect(normalizeNutritionState({ date: '2026-11-05', focus: [] })!.focus).toEqual([])
    expect(normalizeNutritionState({ date: '2026-11-05', focus: [{ key: 'custom:9', title: '控尿酸', custom: true }, { title: 'no key' }] })!.focus)
      .toEqual([{ key: 'custom:9', title: '控尿酸', custom: true }])
  })
})
