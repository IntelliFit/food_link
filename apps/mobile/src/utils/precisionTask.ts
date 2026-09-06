import type { AnalysisTask } from '@food-link/core'

export function needsPrecisionUserAction(task: Pick<AnalysisTask, 'result'> | null | undefined): boolean {
  const result = task?.result as Record<string, unknown> | null | undefined
  if (!result) return false
  const status = String(result.precisionStatus ?? result.precision_status ?? '').trim()
  return result.userActionRequired === true || result.user_action_required === true || status === 'needs_user_input' || status === 'needs_retake'
}
