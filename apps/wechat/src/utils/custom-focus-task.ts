import Taro from '@tarojs/taro'
import type { AnalysisTask, RiskCard } from './api'

const CUSTOM_FOCUS_PENDING_TASKS_KEY = 'stats_custom_focus_pending_tasks_v1'
const CUSTOM_FOCUS_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface PendingCustomFocusTask {
  taskId: string
  range: 'week' | 'month'
  focusId: string
  focusKey: string
  createdAt: number
}

function isPendingCustomFocusTask(value: unknown): value is PendingCustomFocusTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<PendingCustomFocusTask>
  return Boolean(
    task.taskId
    && task.focusId
    && task.focusKey
    && (task.range === 'week' || task.range === 'month')
    && typeof task.createdAt === 'number'
    && Number.isFinite(task.createdAt),
  )
}

export function readPendingCustomFocusTasks(now = Date.now()): PendingCustomFocusTask[] {
  try {
    const raw = Taro.getStorageSync(CUSTOM_FOCUS_PENDING_TASKS_KEY)
    const values = Array.isArray(raw) ? raw : []
    return values
      .filter(isPendingCustomFocusTask)
      .filter(task => now - task.createdAt <= CUSTOM_FOCUS_TASK_MAX_AGE_MS)
  } catch {
    return []
  }
}

export function savePendingCustomFocusTask(task: PendingCustomFocusTask): void {
  const existing = readPendingCustomFocusTasks().filter(item => item.taskId !== task.taskId && item.focusKey !== task.focusKey)
  Taro.setStorageSync(CUSTOM_FOCUS_PENDING_TASKS_KEY, [task, ...existing])
}

export function removePendingCustomFocusTask(taskId: string): void {
  try {
    const next = readPendingCustomFocusTasks().filter(item => item.taskId !== taskId)
    Taro.setStorageSync(CUSTOM_FOCUS_PENDING_TASKS_KEY, next)
  } catch {
    // ignore local cache failures; the server-side task remains authoritative
  }
}

export function customFocusCardFromTask(task: AnalysisTask): RiskCard | null {
  if (task.task_type !== 'custom_focus' || task.status !== 'done') return null
  const result = task.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : null
  const card = result?.card
  if (!card || typeof card !== 'object') return null
  const candidate = card as Partial<RiskCard>
  if (!candidate.key || !candidate.title || !Number.isFinite(Number(candidate.score))) return null
  return candidate as RiskCard
}
