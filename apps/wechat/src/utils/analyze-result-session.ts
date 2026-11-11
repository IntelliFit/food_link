import Taro from '@tarojs/taro'
import { getAnalyzeTask, type AnalysisEngine, type AnalysisTask, type AnalyzeResponse, type EatingMood, type ExecutionMode } from './api'
import { normalizeAnalysisEngine } from './analysis-engine'
import { normalizeRuntimeExecutionMode } from './execution-mode'
import { EATING_MOOD_OPTIONS } from './eating-mood'

// Reuse the existing task-keyed map; old unscoped flags cannot identify a meal.
const COMMITTED_SESSIONS_KEY = 'analyze_committed_session'
type StoredRecordState = { recorded?: boolean; record_id?: string; at?: number }

export interface AnalyzeTaskRecordState {
  recorded: boolean
  recordId: string | null
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

function readRecordStates(): Record<string, StoredRecordState> {
  try {
    const raw = Taro.getStorageSync(COMMITTED_SESSIONS_KEY)
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function readAnalyzeTaskRecordState(taskId: string): AnalyzeTaskRecordState {
  const id = text(taskId)
  const state = id ? readRecordStates()[id] : undefined
  if (!state || state.recorded === false) return { recorded: false, recordId: null }
  const recordId = text(state.record_id) || null
  return { recorded: state.recorded === true || Boolean(recordId), recordId }
}

export function getAnalyzeTaskCommittedRecordId(taskId: string): string | null {
  return readAnalyzeTaskRecordState(taskId).recordId
}

export function writeAnalyzeTaskRecordState(taskId: string, isRecorded: boolean, recordId?: string | null): AnalyzeTaskRecordState {
  const id = text(taskId)
  const state = { recorded: Boolean(isRecorded), recordId: isRecorded ? text(recordId) || null : null }
  if (!id) return { recorded: false, recordId: null }
  const states = readRecordStates()
  states[id] = { recorded: state.recorded, ...(state.recordId ? { record_id: state.recordId } : {}), at: Date.now() }
  try {
    Taro.setStorageSync(COMMITTED_SESSIONS_KEY, JSON.stringify(states))
  } catch {
    // Local storage failure must not stop a successful save or task navigation.
  }
  return state
}

export interface AnalyzeResultSnapshot {
  taskId: string
  result: AnalyzeResponse
  imagePaths: string[]
  taskType: 'food' | 'food_text'
  executionMode: ExecutionMode
  analysisEngine: AnalysisEngine
  precisionSessionId: string
  textInput: string
  mealType?: string
  dietGoal?: string
  activityTiming?: string
  eatingMood?: EatingMood | null
}

const snapshots = new Map<string, AnalyzeResultSnapshot>()
const snapshotKey = (taskId: string): string => `${text(Taro.getStorageSync('user_id'))}:${taskId}`

export function clearAnalyzeResultSessionCache(): void {
  snapshots.clear()
}

/** Keep confirmed edits with the authenticated task's existing photo/context snapshot. */
export function updateAnalyzeResultSnapshot(taskId: string, result: AnalyzeResponse): void {
  const id = text(taskId)
  if (!id) return
  const key = snapshotKey(id)
  const snapshot = snapshots.get(key)
  if (snapshot) rememberSnapshot(key, { ...snapshot, result })
}

function rememberSnapshot(key: string, snapshot: AnalyzeResultSnapshot): AnalyzeResultSnapshot {
  snapshots.delete(key)
  snapshots.set(key, snapshot)
  if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value as string)
  return snapshot
}

function resultObject(raw: unknown): AnalyzeResponse | null {
  try {
    const result = typeof raw === 'string' ? JSON.parse(raw) : raw
    return result && typeof result === 'object' && !Array.isArray(result) ? result as AnalyzeResponse : null
  } catch {
    return null
  }
}

function imagePaths(raw: unknown, fallback: unknown): string[] {
  const paths = Array.isArray(raw) ? raw.map(text).filter(Boolean) : []
  return paths.length ? paths : text(fallback) ? [text(fallback)] : []
}

function payloadText(task: AnalysisTask, ...keys: string[]): string {
  for (const key of keys) {
    const value = text(task.payload?.[key])
    if (value) return value
  }
  return ''
}

/** Global result transfer keys do not identify their owner. Use an authenticated
 * task response once, then keep its snapshot scoped to the current user and task. */
export async function loadAnalyzeResultSnapshot(taskId: string): Promise<AnalyzeResultSnapshot> {
  const id = text(taskId)
  if (!id) throw new Error('缺少识别任务，请从识别记录重新打开')
  const key = snapshotKey(id)
  const cached = snapshots.get(key)
  if (cached) return cached
  const task = await getAnalyzeTask(id)
  if (text(task.id) !== id) throw new Error('识别任务不匹配，请重新打开')
  const result = resultObject(task.result)
  if (!result) throw new Error('未找到本次识别结果，请稍后重试')
  const taskType = task.task_type === 'food_text' || task.task_type.startsWith('food_text') ? 'food_text' : 'food'
  const executionMode = normalizeRuntimeExecutionMode(payloadText(task, 'execution_mode', 'executionMode'))
  const mood = task.payload?.eating_mood
  const snapshot: AnalyzeResultSnapshot = {
    taskId: id, result, taskType, executionMode,
    imagePaths: taskType === 'food_text' ? [] : imagePaths(task.image_paths, task.image_url),
    analysisEngine: normalizeAnalysisEngine(result.analysis_engine || payloadText(task, 'analysis_engine'), executionMode),
    precisionSessionId: text(result.precisionSessionId),
    textInput: taskType === 'food_text' ? text(task.text_input) : '',
    mealType: payloadText(task, 'auto_record_meal_type', 'meal_type', 'mealType'),
    dietGoal: payloadText(task, 'diet_goal', 'dietGoal'),
    activityTiming: payloadText(task, 'activity_timing', 'activityTiming'),
    eatingMood: EATING_MOOD_OPTIONS.some(option => option.value === mood) ? mood as EatingMood : null,
  }
  if (snapshotKey(id) === key) {
    writeAnalyzeTaskRecordState(id, Boolean(task.is_recorded), task.record_id)
    return rememberSnapshot(key, snapshot)
  }
  throw new Error('登录状态已变化，请重新打开识别结果')
}
