import type { AnalysisEngine, ExecutionMode } from './api'

/**
 * New analyses always use the smart engine: the backend matches each food
 * against the library that fits it (packaged, standard food, or a dish split
 * into ingredients) and keeps the AI estimate when nothing matches reliably.
 * Older backends treat the unknown value as their per-mode default.
 */
export const SUBMIT_ANALYSIS_ENGINE: AnalysisEngine = 'smart'

const ANALYSIS_ENGINE_LABELS: Record<string, string> = {
  smart: '智能匹配',
  ai_direct: 'AI估算',
  legacy_direct: 'AI估算',
  ai_then_db_exact: '标准库校准',
  db_candidates_ai: '数据库候选',
  db_first: '数据库候选',
}

/** Label for the engine a (possibly historical) result was computed with. */
export const analysisEngineLabel = (value: unknown): string => (
  ANALYSIS_ENGINE_LABELS[String(value || '')] || '营养估算'
)

export const defaultAnalysisEngineForMode = (_mode?: ExecutionMode): AnalysisEngine => SUBMIT_ANALYSIS_ENGINE

/** Keeps the engine a stored result reports; anything unknown becomes smart. */
export const normalizeAnalysisEngine = (value: unknown, _mode: ExecutionMode = 'standard'): AnalysisEngine => {
  if (value === 'smart' || value === 'ai_direct' || value === 'ai_then_db_exact' || value === 'db_candidates_ai') return value
  if (value === 'legacy_direct') return 'ai_direct'
  if (value === 'db_first') return 'db_candidates_ai'
  return SUBMIT_ANALYSIS_ENGINE
}
