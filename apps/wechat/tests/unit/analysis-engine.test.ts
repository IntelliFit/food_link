import {
  defaultAnalysisEngineForMode,
  normalizeAnalysisEngine,
} from '../../src/utils/analysis-engine'

describe('analysis engine routing', () => {
  it('defaults fast and standard to direct AI, and precision to candidate-guided AI', () => {
    expect(defaultAnalysisEngineForMode('fast')).toBe('ai_direct')
    expect(defaultAnalysisEngineForMode('standard')).toBe('ai_direct')
    expect(defaultAnalysisEngineForMode('strict')).toBe('db_candidates_ai')
  })

  it('upgrades legacy stored choices without reintroducing the old forced DB route', () => {
    expect(normalizeAnalysisEngine('legacy_direct', 'standard')).toBe('ai_direct')
    expect(normalizeAnalysisEngine('db_first', 'standard')).toBe('ai_direct')
    expect(normalizeAnalysisEngine('db_first', 'strict')).toBe('db_candidates_ai')
  })
})
