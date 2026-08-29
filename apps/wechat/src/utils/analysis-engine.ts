import type { AnalysisEngine, ExecutionMode } from './api'

export const ANALYSIS_ENGINE_OPTIONS: Array<{
  value: AnalysisEngine
  label: string
  description: string
}> = [
  { value: 'ai_direct', label: 'AI估算', description: '速度最快，完整理解描述，不套标准食物库' },
  { value: 'ai_then_db_exact', label: '标准库校准', description: '速度较慢；精确命中时营养和微量元素更稳定' },
  { value: 'db_candidates_ai', label: '数据库候选', description: '速度较慢；AI复核候选，微量元素通常更准确' },
]

export const defaultAnalysisEngineForMode = (mode: ExecutionMode): AnalysisEngine => {
  if (mode === 'fast' || mode === 'fast_web_search' || mode === 'lite') return 'ai_direct'
  if (mode === 'strict' || mode === 'strict_separate' || mode === 'strict_web_search' || mode === 'gemini35_flash' || mode === 'gemini35_flash_grouped') {
    return 'db_candidates_ai'
  }
  return 'ai_direct'
}
export const normalizeAnalysisEngine = (value: unknown, mode: ExecutionMode = 'standard'): AnalysisEngine => {
  if (value === 'ai_direct' || value === 'ai_then_db_exact' || value === 'db_candidates_ai') return value
  if (value === 'legacy_direct') return 'ai_direct'
  if (value === 'db_first') return defaultAnalysisEngineForMode(mode)
  return defaultAnalysisEngineForMode(mode)
}
