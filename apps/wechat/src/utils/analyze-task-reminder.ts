import Taro from '@tarojs/taro'
import { getAccessToken, getAnalyzeTaskStatusCount, markAnalyzeHistorySeen } from './api'

export const ANALYZE_TASK_REMINDER_STORAGE_KEY = 'analyze_task_reminder_state_v1'
export const ANALYZE_TASK_REMINDER_CHANGED_EVENT = 'analyze_task_reminder_changed'
export const ANALYZE_TASK_REMINDER_OPEN_KEY = 'analyze_task_reminder_open_task_v1'
export const ANALYZE_TASK_REMINDER_OPEN_EVENT = 'openAnalyzeTaskReminder'
export const ANALYZE_TASK_REMINDER_OPEN_HISTORY_KEY = 'analyze_task_reminder_open_history_v1'
export const AUTO_RECORD_PREFERENCE_KEY = 'analyze_auto_record_preference_v1'

export type AnalyzeReminderKind = 'idle' | 'recognizing' | 'waiting_record' | 'auto_recorded'

export interface AnalyzeTaskReminderState {
  userId: string
  kind: AnalyzeReminderKind
  recognizing: number
  waitingRecord: number
  taskId: string
  recordId?: string
  hasUnseen: boolean
  updatedAt: number
}

export interface AnalyzeAutoRecordPreference {
  enabled: boolean
}

const emptyReminderState = (userId = ''): AnalyzeTaskReminderState => ({
  userId,
  kind: 'idle',
  recognizing: 0,
  waitingRecord: 0,
  taskId: '',
  hasUnseen: false,
  updatedAt: Date.now(),
})

const currentUserId = () => String(Taro.getStorageSync('user_id') || '').trim()

export function readAnalyzeTaskReminderState(): AnalyzeTaskReminderState {
  try {
    const raw = Taro.getStorageSync(ANALYZE_TASK_REMINDER_STORAGE_KEY)
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const userId = currentUserId()
    if (!parsed || parsed.userId !== userId) return emptyReminderState(userId)
    return {
      ...emptyReminderState(userId),
      ...parsed,
      recognizing: Math.max(0, Number(parsed.recognizing) || 0),
      waitingRecord: Math.max(0, Number(parsed.waitingRecord) || 0),
      taskId: String(parsed.taskId || '').trim(),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    }
  } catch {
    return emptyReminderState(currentUserId())
  }
}

export function persistAnalyzeTaskReminderState(state: AnalyzeTaskReminderState): AnalyzeTaskReminderState {
  Taro.setStorageSync(ANALYZE_TASK_REMINDER_STORAGE_KEY, JSON.stringify(state))
  try {
    Taro.eventCenter.trigger(ANALYZE_TASK_REMINDER_CHANGED_EVENT, state)
  } catch {
    // ignore event bridge failures
  }
  return state
}

export function markAnalyzeTaskRecognizing(taskId: string): AnalyzeTaskReminderState {
  const previous = readAnalyzeTaskReminderState()
  return persistAnalyzeTaskReminderState({
    ...previous,
    userId: currentUserId(),
    kind: 'recognizing',
    recognizing: Math.max(1, previous.recognizing),
    taskId: String(taskId || previous.taskId || '').trim(),
    hasUnseen: false,
    updatedAt: Date.now(),
  })
}

export async function syncAnalyzeTaskReminderState(): Promise<AnalyzeTaskReminderState> {
  const userId = currentUserId()
  if (!getAccessToken() || !userId) {
    return persistAnalyzeTaskReminderState(emptyReminderState(userId))
  }
  const counts = await getAnalyzeTaskStatusCount()
  const waitingTaskId = String(counts.latest_waiting_record_task_id || '').trim()
  const autoRecordedTaskId = String(counts.latest_auto_recorded_task_id || '').trim()
  const recognizingTaskId = String(counts.latest_recognizing_task_id || '').trim()
  let kind: AnalyzeReminderKind = 'idle'
  let taskId = ''
  let recordId = ''
  let hasUnseen = false
  if (counts.has_unseen_waiting_record && counts.waiting_record > 0 && waitingTaskId) {
    kind = 'waiting_record'
    taskId = waitingTaskId
    hasUnseen = counts.has_unseen_waiting_record === true
  } else if (counts.has_unseen_auto_recorded && autoRecordedTaskId) {
    kind = 'auto_recorded'
    taskId = autoRecordedTaskId
    recordId = String(counts.latest_auto_recorded_record_id || '').trim()
    hasUnseen = true
  } else if (counts.recognizing > 0 && recognizingTaskId) {
    kind = 'recognizing'
    taskId = recognizingTaskId
  }
  return persistAnalyzeTaskReminderState({
    userId,
    kind,
    recognizing: Math.max(0, Number(counts.recognizing) || 0),
    waitingRecord: Math.max(0, Number(counts.waiting_record) || 0),
    taskId,
    recordId: recordId || undefined,
    hasUnseen,
    updatedAt: Date.now(),
  })
}

export function clearAnalyzeTaskReminderLocally(): AnalyzeTaskReminderState {
  return persistAnalyzeTaskReminderState(emptyReminderState(currentUserId()))
}

export async function acknowledgeAnalyzeTaskReminders(): Promise<AnalyzeTaskReminderState> {
  clearAnalyzeTaskReminderLocally()
  if (!getAccessToken()) return readAnalyzeTaskReminderState()
  await markAnalyzeHistorySeen()
  return syncAnalyzeTaskReminderState()
}

export function readAutoRecordPreference(): AnalyzeAutoRecordPreference {
  try {
    const raw = Taro.getStorageSync(AUTO_RECORD_PREFERENCE_KEY)
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { enabled: parsed?.enabled === true }
  } catch {
    return { enabled: false }
  }
}

export function saveAutoRecordPreference(enabled: boolean): AnalyzeAutoRecordPreference {
  const value = { enabled }
  Taro.setStorageSync(AUTO_RECORD_PREFERENCE_KEY, JSON.stringify(value))
  return value
}
