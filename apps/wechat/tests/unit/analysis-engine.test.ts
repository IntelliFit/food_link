import {
  SUBMIT_ANALYSIS_ENGINE,
  analysisEngineLabel,
  defaultAnalysisEngineForMode,
  normalizeAnalysisEngine,
} from '../../src/utils/analysis-engine'

describe('analysis engine routing', () => {
  it('submits every new analysis with the smart engine, whatever the mode', () => {
    expect(SUBMIT_ANALYSIS_ENGINE).toBe('smart')
    expect(defaultAnalysisEngineForMode('fast')).toBe('smart')
    expect(defaultAnalysisEngineForMode('standard')).toBe('smart')
    expect(defaultAnalysisEngineForMode('strict')).toBe('smart')
  })

  it('keeps the engine a stored result was computed with so its label stays true', () => {
    expect(normalizeAnalysisEngine('ai_direct')).toBe('ai_direct')
    expect(normalizeAnalysisEngine('legacy_direct')).toBe('ai_direct')
    expect(normalizeAnalysisEngine('db_first', 'strict')).toBe('db_candidates_ai')
    expect(normalizeAnalysisEngine(undefined)).toBe('smart')
    expect(analysisEngineLabel('smart')).toBe('智能匹配')
    expect(analysisEngineLabel('ai_then_db_exact')).toBe('标准库校准')
    expect(analysisEngineLabel('unknown')).toBe('营养估算')
  })
})
