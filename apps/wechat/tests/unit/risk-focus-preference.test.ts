import { restoreRiskFocusKeys } from '../../src/pages/stats/risk-focus-preference'

const defaults = ['hypertension', 'diabetes', 'cardio']

describe('stats risk focus preferences', () => {
  it('uses defaults only when no preference has been saved', () => {
    expect(restoreRiskFocusKeys(undefined, defaults)).toEqual(defaults)
    expect(restoreRiskFocusKeys(null, defaults)).toEqual(defaults)
  })

  it('keeps hidden default cards hidden after the page is reopened', () => {
    expect(restoreRiskFocusKeys(['diabetes', 'longevity'], defaults)).toEqual(['diabetes', 'longevity'])
    expect(restoreRiskFocusKeys([], defaults)).toEqual([])
  })
})
