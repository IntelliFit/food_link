import { useEffect, useState } from 'react'
import { getAnalyzeTask } from '../utils/api'
import { getTaskRecordTargetDate } from '../utils/record-date'

/** A page owns its date. Shared storage is never read at save time. */
export function useRecordDate(initialDate: string, taskId = '') {
  const [date, setDate] = useState(() => initialDate.trim())
  useEffect(() => {
    if (initialDate || !taskId) return
    let active = true
    void getAnalyzeTask(taskId).then(task => {
      if (active) setDate(current => current || getTaskRecordTargetDate(task))
    }).catch(() => {
      // The date picker remains available for legacy tasks or an unavailable task.
    })
    return () => { active = false }
  }, [initialDate, taskId])
  return [date, setDate] as const
}
