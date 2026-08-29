import Taro from '@tarojs/taro'
import { getAnalyzeTask, markAnalyzeHistorySeen, type AnalysisTask, type AnalyzeResponse, type ExecutionMode, type MealType } from './api'
import { normalizeAnalysisEngine } from './analysis-engine'
import { needsPrecisionUserAction } from './precision-mode'
import { extraPkgUrl } from './subpackage-extra'

const ANALYSIS_ENGINE_STORAGE_KEY = 'analyzeAnalysisEngine'

const normalizeMealType = (value: unknown): MealType => {
  const normalized = String(value || '').trim()
  if (normalized === 'snack') return 'afternoon_snack'
  if (['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'].includes(normalized)) {
    return normalized as MealType
  }
  const hour = new Date().getHours()
  if (hour < 10) return 'breakfast'
  if (hour < 11) return 'morning_snack'
  if (hour < 14) return 'lunch'
  if (hour < 17) return 'afternoon_snack'
  if (hour < 21) return 'dinner'
  return 'evening_snack'
}

const normalizeExecutionMode = (value: unknown): ExecutionMode => {
  const normalized = String(value || '').trim() as ExecutionMode
  if (['fast', 'fast_web_search', 'standard', 'standard_web_search', 'standard_packaged_experiment', 'strict', 'strict_separate', 'strict_web_search'].includes(normalized)) {
    return normalized
  }
  if (normalized === 'gemini35_flash' || normalized === 'gemini35_flash_grouped') return 'strict'
  return 'standard'
}

const taskPayloadString = (task: AnalysisTask, ...keys: string[]) => {
  for (const key of keys) {
    const value = task.payload?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

const taskSourceType = (task: AnalysisTask): 'food' | 'food_text' => (
  task.task_type === 'food_text' || task.task_type.startsWith('food_text') ? 'food_text' : 'food'
)

const persistTaskResultContext = (task: AnalysisTask, result: AnalyzeResponse) => {
  const sourceType = taskSourceType(task)
  if (sourceType === 'food') {
    const paths = Array.isArray(task.image_paths) && task.image_paths.length > 0
      ? task.image_paths
      : task.image_url ? [task.image_url] : []
    if (paths.length > 0) {
      Taro.setStorageSync('analyzeImagePaths', paths)
      Taro.setStorageSync('analyzeImagePath', paths[0])
    }
    Taro.removeStorageSync('analyzeTextInput')
    Taro.removeStorageSync('analyzeTextAdditionalContext')
  } else {
    Taro.removeStorageSync('analyzeImagePaths')
    Taro.removeStorageSync('analyzeImagePath')
    Taro.setStorageSync('analyzeTextInput', task.text_input || '')
    Taro.setStorageSync('analyzeTextAdditionalContext', taskPayloadString(task, 'additionalContext', 'additional_context'))
  }
  const mode = normalizeExecutionMode(taskPayloadString(task, 'execution_mode', 'executionMode'))
  Taro.setStorageSync('analyzeResult', JSON.stringify(result))
  Taro.setStorageSync('analyzeCompareMode', false)
  Taro.setStorageSync('analyzeMealType', normalizeMealType(taskPayloadString(task, 'auto_record_meal_type', 'meal_type', 'mealType')))
  Taro.setStorageSync('analyzeDietGoal', taskPayloadString(task, 'diet_goal', 'dietGoal') || 'none')
  Taro.setStorageSync('analyzeActivityTiming', taskPayloadString(task, 'activity_timing', 'activityTiming') || 'none')
  Taro.setStorageSync('analyzeExecutionMode', mode)
  Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, normalizeAnalysisEngine(result.analysis_engine || taskPayloadString(task, 'analysis_engine'), mode))
  Taro.setStorageSync('analyzeSourceTaskId', task.id)
  Taro.setStorageSync('analyzeTaskType', sourceType)
  if (result.precisionSessionId) {
    Taro.setStorageSync('analyzePrecisionSessionId', result.precisionSessionId)
  } else {
    Taro.removeStorageSync('analyzePrecisionSessionId')
  }
  if (task.is_recorded) {
    Taro.setStorageSync('analyzeTaskIsRecorded', '1')
    if (task.record_id) Taro.setStorageSync('analyzeCommittedRecordId', task.record_id)
  } else {
    Taro.removeStorageSync('analyzeTaskIsRecorded')
    Taro.removeStorageSync('analyzeCommittedRecordId')
  }
}

export async function openAnalyzeTaskFromReminder(taskId: string): Promise<void> {
  const normalizedTaskId = String(taskId || '').trim()
  if (!normalizedTaskId) return
  Taro.showLoading({ title: '', mask: true })
  try {
    const task = await getAnalyzeTask(normalizedTaskId)
    Taro.hideLoading()
    if ((task.status === 'pending' || task.status === 'processing')) {
      const mode = normalizeExecutionMode(taskPayloadString(task, 'execution_mode', 'executionMode'))
      const sourceType = taskSourceType(task)
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${encodeURIComponent(task.id)}&task_type=${encodeURIComponent(sourceType)}&execution_mode=${encodeURIComponent(mode)}`,
      })
      return
    }
    if (task.status !== 'done' || !task.result) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/analyze-history/index') })
      return
    }
    const result = task.result as AnalyzeResponse
    if (needsPrecisionUserAction(result)) {
      Taro.navigateTo({ url: `${extraPkgUrl('/pages/precision-confirm/index')}?task_id=${encodeURIComponent(task.id)}` })
      return
    }
    persistTaskResultContext(task, result)
    void markAnalyzeHistorySeen().catch(() => undefined)
    Taro.navigateTo({ url: extraPkgUrl('/pages/result/index') })
  } catch (error) {
    Taro.hideLoading()
    console.error('打开识别提醒失败:', error)
    Taro.showToast({ title: '暂时无法打开识别结果', icon: 'none' })
  }
}
