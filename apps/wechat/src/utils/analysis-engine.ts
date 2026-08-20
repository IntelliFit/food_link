import type { AnalysisEngine, ExecutionMode } from './api'

export const ANALYSIS_ENGINE_OPTIONS: Array<{
  value: AnalysisEngine
  label: string
  description: string
}> = [
  { value: 'ai_direct', label: 'AI估算', description: '完整理解当前描述，不套标准食物库' },
  { value: 'ai_then_db_exact', label: '标准库校准', description: 'AI先分析，仅用状态口径一致的精确项校准' },
  { value: 'db_candidates_ai', label: '精准候选', description: '把候选和完整上下文交给AI，可拒绝所有候选' },
]

export const defaultAnalysisEngineForMode = (mode: ExecutionMode): AnalysisEngine => {
  if (mode === 'fast' || mode === 'fast_web_search' || mode === 'lite') return 'ai_direct'
  if (mode === 'strict' || mode === 'strict_separate' || mode === 'strict_web_search' || mode === 'gemini35_flash' || mode === 'gemini35_flash_grouped') {
    return 'db_candidates_ai'
  }
  return 'ai_then_db_exact'
}
export const normalizeAnalysisEngine = (value: unknown, mode: ExecutionMode = 'standard'): AnalysisEngine => {
  if (value === 'ai_direct' || value === 'ai_then_db_exact' || value === 'db_candidates_ai') return value
  if (value === 'legacy_direct') return 'ai_direct'
  if (value === 'db_first') return defaultAnalysisEngineForMode(mode)
  return defaultAnalysisEngineForMode(mode)
}
