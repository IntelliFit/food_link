import { getAnalyzeTask } from './api'
import { getTaskRecordTargetDate, getTodayRecordDateKey, requireAllowedRecordDate } from './record-date'

/** Continuing an existing task must not silently move an expired record to today. */
export function requireAnalysisRetryDate(rawDate?: string | null): string | null {
  const date = String(rawDate || '').trim() || getTodayRecordDateKey()
  return requireAllowedRecordDate(date) ? date : null
}

/** Legacy result URLs may omit date; resolve it from this task, never global storage. */
export async function loadAnalysisRetryDate(selectedDate: string, taskId: string): Promise<string | null> {
  let date = selectedDate.trim()
  if (!date && taskId) {
    const task = await getAnalyzeTask(taskId)
    if (task.id !== taskId) throw new Error('识别任务不匹配，请重新打开当前结果')
    date = getTaskRecordTargetDate(task)
  }
  return requireAnalysisRetryDate(date)
}
