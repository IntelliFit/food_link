import { View, Text, Image, ScrollView, Input } from '@tarojs/components'
import { withAuth } from '../../../utils/withAuth'
import { useState, useCallback, useRef } from 'react'
import Taro, { useDidShow, useDidHide } from '@tarojs/taro'
import { listAnalyzeTasks, deleteAnalysisTask, createUserRecipe, getAccessToken, saveFoodRecord, retryAnalyzeTask, showUnifiedApiError, type AnalysisTask, type AnalyzeResponse, type ExecutionMode, type AnalyzeRecognitionOutcome, type DeleteTaskResult, type MealType } from '../../../utils/api'
import './index.scss'
import { extraPkgUrl, MAIN_TAB_ROUTES, normalizeRedirectUrlForSubpackage } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import CustomNavBar, { getNavBarHeight } from '../../../components/CustomNavBar'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import {
  applyOptimisticFoodRecordToHomeDashboardSnapshot,
  refreshHomeDashboardLocalSnapshotFromCloud
} from '../../../utils/home-dashboard-local-cache'
import { formatDateKey } from '../../../pages/index/utils/helpers'
import { buildFoodRecordItemPayloadFromAnalyzeItem } from '../../../utils/food-record-item-payload'
import {
  MealTypeSelectSheet,
  normalizeSelectableMealType,
  type SelectableMealType
} from '../../../components/MealTypeSelector'

const STATUS_MAP: Record<string, string> = {
  pending: '排队中',
  processing: '识别中',
  done: '已完成',
  failed: '识别失败',
  violated: '内容违规',
  timed_out: '已超时',
  cancelled: '已取消'
}

/** 根据后端返回的 status + is_recorded 决定列表中展示的状态文案和样式类名 */
const pickDisplayStatus = (task: AnalysisTask): { text: string; className: string } => {
  if (task.status === 'pending' || task.status === 'processing') {
    return { text: '正在识别', className: 'status-recognizing' }
  }
  if (task.status === 'done') {
    if (task.is_recorded === true) return { text: '已经记录', className: 'status-recorded' }
    if (task.is_recorded === false) return { text: '等待记录', className: 'status-waiting' }
    return { text: '已完成', className: 'status-done' } // 兼容旧数据
  }
  if (task.status === 'failed' || task.status === 'timed_out') {
    return { text: '点我重试', className: 'status-retry' }
  }
  return { text: STATUS_MAP[task.status] || task.status, className: `status-${task.status}` }
}

const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  lite: '普通模式',
  experimental: '普通模式',
  gemini35_flash: '精准模式',
  gemini35_flash_grouped: '精准模式',
  strict: '精准模式',
  strict_separate: '精准分项',
  strict_web_search: '精准联网',
  fast: '快速模式',
  fast_web_search: '快速联网',
  standard_web_search: '普通联网',
  standard_packaged_experiment: '零食库试验',
  standard: '普通模式'
}

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const normalizeMealType = (value: unknown): MealType | undefined => {
  if (value === 'snack') return 'afternoon_snack'
  return typeof value === 'string' && MEAL_TYPE_LABELS[value] ? (value as MealType) : undefined
}

const readTaskPayloadValue = (task: AnalysisTask, ...keys: string[]): unknown => {
  const payload = (task.payload || {}) as Record<string, unknown>
  for (const key of keys) {
    const value = payload[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

const getTaskMealType = (task: AnalysisTask): MealType | undefined => (
  normalizeMealType(readTaskPayloadValue(task, 'meal_type', 'mealType'))
)

const getTaskDietGoal = (task: AnalysisTask): string => (
  String(readTaskPayloadValue(task, 'diet_goal', 'dietGoal') || 'none')
)

const getTaskActivityTiming = (task: AnalysisTask): string => (
  String(readTaskPayloadValue(task, 'activity_timing', 'activityTiming') || 'none')
)

const getTaskRecordDate = (task: AnalysisTask): string | undefined => {
  const value = readTaskPayloadValue(task, 'date', 'recorded_on', 'recordedOn')
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const normalizeRecognitionOutcome = (value: unknown): AnalyzeRecognitionOutcome => (
  value === 'soft_reject' || value === 'hard_reject' ? value : 'ok'
)

const RECOGNITION_OUTCOME_LABEL: Record<AnalyzeRecognitionOutcome, string> = {
  ok: '精准通过',
  soft_reject: '建议重拍',
  hard_reject: '建议拆拍',
}

const pickRecognitionOutcome = (task: AnalysisTask): AnalyzeRecognitionOutcome => {
  const result = task.result as AnalyzeResponse | undefined
  return normalizeRecognitionOutcome(result?.recognitionOutcome)
}

const pickExecutionMode = (task: AnalysisTask): ExecutionMode => {
  const taskAny = task as AnalysisTask & { execution_mode?: unknown }
  if (taskAny.execution_mode === 'fast') return 'fast'
  if (taskAny.execution_mode === 'fast_web_search') return 'fast_web_search'
  if (taskAny.execution_mode === 'standard_web_search') return 'standard_web_search'
  if (taskAny.execution_mode === 'standard_packaged_experiment') return 'standard_packaged_experiment'
  if (taskAny.execution_mode === 'strict_separate') return 'strict_separate'
  if (taskAny.execution_mode === 'strict_web_search') return 'strict_web_search'
  if (taskAny.execution_mode === 'strict' || taskAny.execution_mode === 'gemini35_flash' || taskAny.execution_mode === 'gemini35_flash_grouped') {
    return 'strict'
  }
  if (taskAny.execution_mode === 'standard') {
    return 'standard'
  }
  const payloadMode = (task.payload as Record<string, unknown> | undefined)?.execution_mode
  if (payloadMode === 'fast') return 'fast'
  if (payloadMode === 'fast_web_search') return 'fast_web_search'
  if (payloadMode === 'standard_web_search') return 'standard_web_search'
  if (payloadMode === 'standard_packaged_experiment') return 'standard_packaged_experiment'
  if (payloadMode === 'strict_separate') return 'strict_separate'
  if (payloadMode === 'strict_web_search') return 'strict_web_search'
  if (payloadMode === 'strict' || payloadMode === 'gemini35_flash' || payloadMode === 'gemini35_flash_grouped') return 'strict'
  return 'standard'
}

const pickTextAvatar = (text: string | null | undefined): string => {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[，。；：、,.!?！？\n\r\t]/g, ' ')
    .trim()

  if (!normalized) return '记录'
  const compact = normalized.replace(/\s+/g, '')
  return compact.slice(0, Math.min(4, compact.length))
}

const pickTaskHeadline = (task: AnalysisTask): string => {
  if (task.status === 'violated' || task.is_violated) return '内容未通过审核'
  const sourceType = pickSourceTaskType(task)
  if (sourceType === 'food_text') {
    const text = String(task.text_input || '').trim()
    return text || '文字记录'
  }
  const result = task.result as AnalyzeResponse | undefined
  const firstItem = result?.items?.[0]?.name?.trim()
  if (firstItem) return firstItem
  return task.status === 'done' ? '饮食分析结果' : '图片记录'
}

const pickTaskMeta = (task: AnalysisTask): string => {
  const sourceType = pickSourceTaskType(task)
  const result = task.result as AnalyzeResponse | undefined
  if (task.status === 'violated' || task.is_violated) {
    return task.violation_reason || '该记录因内容问题不可查看'
  }
  if (task.status === 'failed' || task.status === 'timed_out') {
    return '识别没有成功 · 点击卡片可用原记录重新识别'
  }
  if (sourceType === 'food_text') {
    const count = result?.items?.length || 0
    return count > 0 ? `文字记录 · 识别出 ${count} 项食物` : '文字记录'
  }
  const count = result?.items?.length || 0
  return count > 0 ? `图片记录 · 识别出 ${count} 项食物` : '图片记录'
}

// 获取总热量
const getTotalCalories = (task: AnalysisTask): number => {
  if (!task.result) return 0
  const result = task.result as AnalyzeResponse
  return result.items?.reduce((sum, item) => sum + (item.nutrients?.calories || 0), 0) || 0
}

const normalizeNumber = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const buildDefaultRecipeName = (task: AnalysisTask): string => {
  const result = task.result as AnalyzeResponse | undefined
  const firstName = result?.items?.[0]?.name?.trim()
  if (firstName) return firstName
  const desc = result?.description?.trim()
  if (desc) return desc.slice(0, 20)
  return pickTaskHeadline(task)
}

const pickTaskImageUrls = (task: AnalysisTask): string[] => {
  const urls = task.image_paths && task.image_paths.length > 0
    ? task.image_paths
    : (task.image_url ? [task.image_url] : [])
  return urls.map((url) => String(url || '').trim()).filter(Boolean)
}

const buildTaskFoodItems = (result: AnalyzeResponse) => (
  (result.items || []).map(buildFoodRecordItemPayloadFromAnalyzeItem)
)

const buildTaskNutritionTotals = (items: ReturnType<typeof buildTaskFoodItems>) => (
  items.reduce(
    (acc, item) => {
      const ratio = item.ratio / 100
      acc.totalCalories += item.nutrients.calories * ratio
      acc.totalProtein += item.nutrients.protein * ratio
      acc.totalCarbs += item.nutrients.carbs * ratio
      acc.totalFat += item.nutrients.fat * ratio
      acc.totalWeight += item.intake > 0 ? item.intake : item.weight
      return acc
    },
    { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, totalWeight: 0 }
  )
)

const pickSourceTaskType = (task: AnalysisTask): 'food' | 'food_text' => {
  const tt = task.task_type || ''
  if (tt === 'food_text' || tt.startsWith('food_text')) return 'food_text'
  const payload = task.payload as Record<string, unknown> | undefined
  return payload?.source_type === 'text' ? 'food_text' : 'food'
}

/** 识别历史页展示的任务类型（与后端 analysis_tasks.task_type 一致，含 debug 队列后缀） */
function isAnalyzeHistoryTaskType(taskType: string | undefined): boolean {
  if (!taskType) return false
  if (taskType === 'exercise' || taskType.startsWith('exercise')) return false
  if (taskType === 'health_report') return false
  if (taskType === 'public_food_library_text') return false
  if (taskType === 'food' || taskType.startsWith('food_')) return true
  if (taskType === 'food_text' || taskType.startsWith('food_text')) return true
  if (taskType.startsWith('precision_')) return true
  return false
}

/** 避免真机上某次 request 长时间不返回导致 Promise.all 永不结束、loading 卡死 */
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(onTimeout())
      }
    )
  })
}

function formatTime(iso: string): { text: string; isToday: boolean } {
  try {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
    const hour = d.getHours()
    const period = hour < 12 ? '上午' : '下午'
    
    if (isToday) {
      return { text: `今天 ${period}${timeStr}`, isToday: true }
    }
    
    // 昨天
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) {
      return { text: `昨天 ${period}${timeStr}`, isToday: false }
    }
    
    // 其他日期
    const dateStr = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    return { text: `${dateStr} ${period}${timeStr}`, isToday: false }
  } catch {
    return { text: '', isToday: false }
  }
}

interface TaskCardProps {
  task: AnalysisTask
  onTap: (task: AnalysisTask) => void
  onMore: (task: AnalysisTask) => void
}

function TaskCard({ task, onTap, onMore }: TaskCardProps) {
  const mode = pickExecutionMode(task)
  const recognitionOutcome = pickRecognitionOutcome(task)
  const canShare = task.status === 'done' && task.result // 只有完成的才能分享
  const totalCalories = getTotalCalories(task)
  const sourceType = pickSourceTaskType(task)
  const headline = pickTaskHeadline(task)
  const meta = pickTaskMeta(task)
  const textAvatar = pickTextAvatar(task.text_input)
  const timeInfo = formatTime(task.created_at)

  const handleMore = (e: any) => {
    e.stopPropagation()
    onMore(task)
  }

  return (
    <View className='task-card-wrapper'>
      <View
        className={`task-card ${task.status === 'violated' || task.is_violated ? 'task-card-violated' : ''}`}
        onClick={() => onTap(task)}
      >
        <View className='thumb'>
          {task.status === 'violated' || task.is_violated ? (
            <View className='thumb-violated'>
              <Text className='iconfont icon-jinggao' style={{ fontSize: '48rpx', color: '#e57373' }} />
            </View>
          ) : task.image_url ? (
            <Image src={task.image_url} mode='aspectFill' />
          ) : sourceType === 'food_text' ? (
            <View className='thumb-placeholder thumb-placeholder--text'>
              <Text className='text-avatar'>{textAvatar}</Text>
            </View>
          ) : (
            <View className='thumb-placeholder'>
              <Text className='iconfont icon-xingzhuang-wenzi' style={{ fontSize: '48rpx', color: '#15803d' }} />
            </View>
          )}
        </View>
        <View className='body'>
          <View className='main-row'>
            <View className='left-content'>
              <Text className='headline'>{headline}</Text>
              <Text className='calories'>{totalCalories > 0 ? `${Math.round(totalCalories)} kcal` : '--'}</Text>
              <Text className='meta'>{meta}</Text>
              <View className='time-row'>
                <Text className='time'>{timeInfo.text}</Text>
                {(() => {
                  const ds = pickDisplayStatus(task)
                  return (
                    <View className={`status-badge ${ds.className}`}>
                      <Text className='status-text'>{ds.text}</Text>
                    </View>
                  )
                })()}
              </View>
              <View className='tag-row-inline'>
                {mode === 'strict' && (
                  <View className='mode-tag strict'>
                    <Text className='mode-tag-text'>精准</Text>
                  </View>
                )}
              </View>
            </View>
            <View className='right-content'>
              <View className='more-btn' onClick={handleMore}>
                <Text className='more-dots'>⋮</Text>
              </View>
            </View>
          </View>
          {(task.status === 'violated' || task.is_violated) && task.violation_reason && (
            <Text className='violation-reason'>{task.violation_reason}</Text>
          )}
        </View>


      </View>
    </View>
  )
}

function AnalyzeHistoryPage() {
  const { scheme } = useAppColorScheme()
  const [tasks, setTasks] = useState<AnalysisTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [activeTask, setActiveTask] = useState<AnalysisTask | null>(null)
  const [quickRecordTask, setQuickRecordTask] = useState<AnalysisTask | null>(null)
  const [quickRecordMealType, setQuickRecordMealType] = useState<SelectableMealType>('afternoon_snack')
  const [searchKeyword, setSearchKeyword] = useState('')
  const searchDebounceRef = useRef(0)
  const loadSeqRef = useRef(0)
  const navBarHeight = getNavBarHeight()

  const handleBack = useCallback(() => {
    const pages = Taro.getCurrentPages()
    if (pages.length > 1) {
      const previous = pages[pages.length - 2]
      const previousRoute = `/${previous.route || ''}`
      const previousOptions = previous.options || {}
      const query = Object.keys(previousOptions)
        .map((key) => `${key}=${encodeURIComponent(previousOptions[key])}`)
        .join('&')
      if (MAIN_TAB_ROUTES.has(previousRoute)) {
        Taro.switchTab({ url: previousRoute })
        return
      }
      const targetUrl = normalizeRedirectUrlForSubpackage(
        `${previousRoute}${query ? `?${query}` : ''}`
      )
      Taro.redirectTo({
        url: targetUrl,
        fail: () => Taro.switchTab({ url: '/pages/index/index' })
      })
      return
    }
    Taro.switchTab({ url: '/pages/index/index' })
  }, [])

  const load = useCallback(async (keyword?: string) => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    try {
      const search = keyword?.trim()
      // 单次拉取再前端筛选：避免 Promise.all 四路并行时一路挂起导致整页永远 loading（真机偶发）
      const res = await withTimeout(
        listAnalyzeTasks({ limit: 120, search }).catch(() => ({ tasks: [] as AnalysisTask[] })),
        22000,
        () => ({ tasks: [] as AnalysisTask[] })
      )
      const allTasks = (res.tasks || []).filter((t) => {
        const payload = (t.payload || {}) as Record<string, unknown>
        if (payload.expiry_recognition) return false
        if (payload.exercise) return false // 排除运动回退任务（payload.exercise=true）
        return isAnalyzeHistoryTaskType(t.task_type)
      })
      allTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      if (seq !== loadSeqRef.current) return
      setTasks(allTasks)
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return
      console.error('[analyze-history] load failed', e)
      await showUnifiedApiError(e, '加载失败')
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  const handleSearchInput = (value: string) => {
    setSearchKeyword(value)
    window.clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = window.setTimeout(() => {
      void load(value)
    }, 300)
  }

  const clearSearch = () => {
    setSearchKeyword('')
    void load('')
  }

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    void load()
  })

  useDidHide(() => {
    // 页面隐藏时：食物保质期已读继续沿用原逻辑
    const today = new Date().toISOString().slice(0, 10)
    Taro.setStorageSync('food_expiry_last_seen_date', today)
    const friendBadge = Number(Taro.getStorageSync('profile_tab_badge_friend_count') || 0)
    Taro.setStorageSync('profile_tab_badge_count', friendBadge)
  })

  const handleDelete = async (taskId: string) => {
    try {
      const result: DeleteTaskResult = await deleteAnalysisTask(taskId)
      // 根据删除结果显示不同的提示
      if (result.cancelled) {
        Taro.showToast({ title: '已取消并删除任务', icon: 'success' })
      } else {
        Taro.showToast({ title: '删除成功', icon: 'success' })
      }
      // 从列表中移除
      setTasks(prev => prev.filter(t => t.id !== taskId))
    } catch (e: any) {
      await showUnifiedApiError(e, '删除失败')
    }
  }

  const handleDiscardUnrecorded = () => {
    const discardableTasks = tasks.filter(
      t => t.status === 'pending' || t.status === 'processing' || t.status === 'failed' || (t.status === 'done' && t.is_recorded === false)
    )
    if (discardableTasks.length === 0) {
      Taro.showToast({ title: '没有可丢弃的未记录', icon: 'none' })
      return
    }
    Taro.showModal({
      title: '确认丢弃',
      content: `确定丢弃 ${discardableTasks.length} 条未记录的任务吗？丢弃后不可恢复。`,
      confirmText: '丢弃',
      confirmColor: '#e57373',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          void (async () => {
            Taro.showLoading({ title: '丢弃中...', mask: true })
            const results = await Promise.allSettled(
              discardableTasks.map(t => deleteAnalysisTask(t.id))
            )
            const deletedIds: string[] = []
            results.forEach((r, idx) => {
              if (r.status === 'fulfilled') {
                deletedIds.push(discardableTasks[idx].id)
              }
            })
            const successCount = deletedIds.length
            const failCount = results.length - successCount
            Taro.hideLoading()
            if (failCount > 0) {
              Taro.showToast({ title: `已丢弃 ${successCount} 条，${failCount} 条失败`, icon: 'none' })
            } else {
              Taro.showToast({ title: `已丢弃 ${successCount} 条记录`, icon: 'success' })
            }
            setTasks(prev => prev.filter(t => !deletedIds.includes(t.id)))
            try {
              const cached = Taro.getStorageSync('profile_stats_analyze_count')
              if (cached !== undefined && cached !== '') {
                const next = Math.max(0, Number(cached) - successCount)
                Taro.setStorageSync('profile_stats_analyze_count', String(next))
              }
            } catch (_) { /* ignore */ }
          })()
        }
      }
    })
  }

  const handleShare = (task: AnalysisTask) => {
    // 分享功能：跳转到分享页面
    if (task.status === 'done' && task.result) {
      const result = task.result as AnalyzeResponse
      // 准备分享数据：自动填充到公共食物库分享页
      const imageUrls = pickTaskImageUrls(task)
      const items = (result.items || []).map(it => ({
        name: it.name || '',
        weight: it.estimatedWeightGrams ?? it.originalWeightGrams ?? 0,
        nutrients: it.nutrients
      }))
      const shareData = {
        imageUrl: task.image_url || '',
        imageUrls,
        description: result.description || '',
        insight: result.insight || '',
        items,
        totalCalories: items.reduce((sum, it) => sum + (it.nutrients?.calories || 0), 0),
        totalProtein: items.reduce((sum, it) => sum + (it.nutrients?.protein || 0), 0),
        totalCarbs: items.reduce((sum, it) => sum + (it.nutrients?.carbs || 0), 0),
        totalFat: items.reduce((sum, it) => sum + (it.nutrients?.fat || 0), 0)
      }
      Taro.setStorageSync('analyzeShareData', shareData)
      Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-share/index')}?from_analyze=1` })
    } else {
      Taro.showToast({ title: '只能分享已完成的任务', icon: 'none' })
    }
  }

  const handleMore = (task: AnalysisTask) => {
    setActiveTask(task)
    setShowActionSheet(true)
  }

  const closeActionSheet = () => {
    setShowActionSheet(false)
    setActiveTask(null)
  }

  const actionSheetShare = () => {
    if (!activeTask) return
    if (activeTask.status === 'done' && activeTask.result) {
      handleShare(activeTask)
    } else {
      Taro.showToast({ title: '只能分享已完成的任务', icon: 'none' })
    }
    closeActionSheet()
  }

  const actionSheetRetry = () => {
    if (!activeTask) return
    const task = activeTask
    closeActionSheet()
    confirmRetryTask(task)
  }

  const submitRetryTask = useCallback(async (task: AnalysisTask) => {
    if (task.status !== 'failed' && task.status !== 'timed_out') {
      Taro.showToast({ title: '当前任务不能重新识别', icon: 'none' })
      return
    }
    try {
      Taro.showLoading({ title: '', mask: true })
      const result = await retryAnalyzeTask(task.id)
      Taro.hideLoading()
      Taro.showToast({ title: '已重新识别', icon: 'success' })
      void load()
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${encodeURIComponent(result.task_id)}&task_type=${encodeURIComponent(task.task_type || 'food')}&execution_mode=${pickExecutionMode(task)}`
      })
    } catch (e: any) {
      Taro.hideLoading()
      await showUnifiedApiError(e, '重新识别失败')
    }
  }, [load])

  const confirmRetryTask = useCallback((task: AnalysisTask) => {
    Taro.showModal({
      title: '重新识别',
      content: pickSourceTaskType(task) === 'food_text'
        ? '将使用这条记录的原文字内容重新识别。'
        : '将使用这条记录已上传的图片重新识别，不需要重新上传照片。',
      confirmText: '重新识别',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          void submitRetryTask(task)
        }
      }
    })
  }, [submitRetryTask])

  const actionSheetSaveRecipe = () => {
    if (!activeTask) return
    const task = activeTask
    closeActionSheet()

    if (task.status !== 'done' || !task.result) {
      Taro.showToast({ title: '只能收藏已完成的任务', icon: 'none' })
      return
    }
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const result = task.result as AnalyzeResponse
    const payload = (task.payload || {}) as Record<string, unknown>
    const defaultName = buildDefaultRecipeName(task)

    Taro.showModal({
      title: '收藏餐食',
      content: '给这份餐食起个名字，之后可在“我的收藏”里快速记录。',
      // @ts-ignore
      editable: true,
      // @ts-ignore
      placeholderText: defaultName || '例如：我的标配早餐',
      success: async (res) => {
        if (!res.confirm) return
        const recipeName = String((res as any).content || defaultName || '').trim()
        if (!recipeName) {
          Taro.showToast({ title: '请输入收藏名称', icon: 'none' })
          return
        }

        const items = buildTaskFoodItems(result)

        if (items.length === 0) {
          Taro.showToast({ title: '没有可收藏的食物', icon: 'none' })
          return
        }

        const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
        const totalCalories = items.reduce((sum, item) => sum + item.nutrients.calories, 0)
        const totalProtein = items.reduce((sum, item) => sum + item.nutrients.protein, 0)
        const totalCarbs = items.reduce((sum, item) => sum + item.nutrients.carbs, 0)
        const totalFat = items.reduce((sum, item) => sum + item.nutrients.fat, 0)

        try {
          Taro.showLoading({ title: '', mask: true })
          await createUserRecipe({
            recipe_name: recipeName,
            description: result.description || '',
            image_path: task.image_url || (task.image_paths && task.image_paths[0]) || undefined,
            items,
            total_calories: totalCalories,
            total_protein: totalProtein,
            total_carbs: totalCarbs,
            total_fat: totalFat,
            total_weight_grams: totalWeight,
            meal_type: typeof payload.meal_type === 'string' ? payload.meal_type : undefined,
            tags: ['识别记录'],
            is_favorite: true
          })
          Taro.hideLoading()
          Taro.showModal({
            title: '收藏成功',
            content: '已收藏到“我的收藏”，之后可以直接复用到餐食记录。',
            showCancel: false
          })
        } catch (e: any) {
          Taro.hideLoading()
          await showUnifiedApiError(e, '收藏失败')
        }
      }
    })
  }

  const actionSheetQuickRecord = () => {
    if (!activeTask) return
    const task = activeTask
    closeActionSheet()

    if (task.status !== 'done' || !task.result) {
      Taro.showToast({ title: '只能记录已完成的任务', icon: 'none' })
      return
    }
    if (task.is_recorded) {
      Taro.showToast({ title: '该餐已记录', icon: 'none' })
      return
    }
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    const result = task.result as AnalyzeResponse
    const items = buildTaskFoodItems(result)
    if (items.length === 0) {
      Taro.showToast({ title: '没有可记录的食物', icon: 'none' })
      return
    }
    setQuickRecordTask(task)
    setQuickRecordMealType(normalizeSelectableMealType(getTaskMealType(task), 'afternoon_snack'))
  }

  const closeQuickRecordMealSelector = () => {
    setQuickRecordTask(null)
  }

  const confirmQuickRecordMealType = () => {
    const task = quickRecordTask
    if (!task || task.status !== 'done' || !task.result || task.is_recorded) {
      closeQuickRecordMealSelector()
      return
    }
    const mealType = quickRecordMealType
    closeQuickRecordMealSelector()

    const result = task.result as AnalyzeResponse
    const items = buildTaskFoodItems(result)
    if (items.length === 0) {
      Taro.showToast({ title: '没有可记录的食物', icon: 'none' })
      return
    }
    const imageUrls = pickTaskImageUrls(task)
    const totals = buildTaskNutritionTotals(items)

    void (async () => {
      try {
        Taro.showLoading({ title: '', mask: true })
        const payload = {
          meal_type: mealType,
          image_path: imageUrls[0] || undefined,
          image_paths: imageUrls.length > 0 ? imageUrls : undefined,
          description: result.description || undefined,
          insight: result.insight || undefined,
          items,
          total_calories: totals.totalCalories,
          total_protein: totals.totalProtein,
          total_carbs: totals.totalCarbs,
          total_fat: totals.totalFat,
          total_weight_grams: Math.round(totals.totalWeight),
          diet_goal: getTaskDietGoal(task) as any,
          activity_timing: getTaskActivityTiming(task) as any,
          pfc_ratio_comment: result.pfc_ratio_comment || undefined,
          absorption_notes: result.absorption_notes || undefined,
          context_advice: result.context_advice || undefined,
          source_task_id: task.id,
          date: getTaskRecordDate(task),
          entry_type: 'analyze_history' as const,
        }
        const saveResult = await saveFoodRecord(payload)
        Taro.hideLoading()
        const targetDateKey = payload.date || formatDateKey(new Date())
        if (!saveResult.already_saved) {
          applyOptimisticFoodRecordToHomeDashboardSnapshot(targetDateKey, payload, saveResult.id)
        }
        setTasks(prev => prev.map(item => (
          item.id === task.id
            ? { ...item, is_recorded: true, record_id: saveResult.id }
            : item
        )))
        try {
          Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDateKey })
        } catch {
          /* ignore */
        }
        await refreshHomeDashboardLocalSnapshotFromCloud(targetDateKey)
        try {
          Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDateKey, force: true })
        } catch {
          /* ignore */
        }
        Taro.showToast({
          title: saveResult.already_saved ? '该餐已记录' : '记录成功',
          icon: saveResult.already_saved ? 'none' : 'success'
        })
      } catch (e: any) {
        Taro.hideLoading()
        await showUnifiedApiError(e, '记录失败')
      }
    })()
  }

  const actionSheetDelete = () => {
    if (!activeTask) return
    closeActionSheet()
    Taro.showModal({
      title: '确认删除',
      content: '删除后无法恢复，是否确认删除？',
      confirmText: '删除',
      confirmColor: '#e57373',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          void handleDelete(activeTask.id)
        }
      }
    })
  }

  const onTaskTap = (task: AnalysisTask) => {
    // 违规任务不允许查看详情
    if (task.status === 'violated' || task.is_violated) {
      Taro.showModal({
        title: '内容违规',
        content: task.violation_reason || '该任务因内容违规被拦截，无法查看详情',
        showCancel: false,
        confirmText: '我知道了'
      })
      return
    }
    if (task.status === 'done' && task.result) {
      const result = task.result as AnalyzeResponse
      const payload = task.payload || {}
      const sourceTaskType = pickSourceTaskType(task)
      // 图片分析任务有 image_url / image_paths，文字分析任务有 text_input
      if (sourceTaskType === 'food' && task.image_paths && task.image_paths.length > 0) {
        Taro.setStorageSync('analyzeImagePaths', task.image_paths)
        Taro.setStorageSync('analyzeImagePath', task.image_paths[0])
        Taro.removeStorageSync('analyzeTextInput')
        Taro.removeStorageSync('analyzeTextAdditionalContext')
      } else if (sourceTaskType === 'food' && task.image_url) {
        Taro.setStorageSync('analyzeImagePaths', [task.image_url])
        Taro.setStorageSync('analyzeImagePath', task.image_url)
        Taro.removeStorageSync('analyzeTextInput')
        Taro.removeStorageSync('analyzeTextAdditionalContext')
      } else {
        // 文字分析任务，清空图片路径
        Taro.removeStorageSync('analyzeImagePaths')
        Taro.removeStorageSync('analyzeImagePath')
        Taro.setStorageSync('analyzeTextInput', task.text_input || '')
        Taro.setStorageSync('analyzeTextAdditionalContext', ((payload as Record<string, unknown>).additionalContext as string) || '')
      }
      Taro.setStorageSync('analyzeResult', JSON.stringify(result))
      Taro.setStorageSync('analyzeCompareMode', false)
      Taro.setStorageSync('analyzeMealType', getTaskMealType(task) || 'breakfast')
      Taro.setStorageSync('analyzeDietGoal', getTaskDietGoal(task))
      Taro.setStorageSync('analyzeActivityTiming', getTaskActivityTiming(task))
      Taro.setStorageSync('analyzeExecutionMode', pickExecutionMode(task))
      if (result.precisionSessionId) {
        Taro.setStorageSync('analyzePrecisionSessionId', result.precisionSessionId)
      } else {
        Taro.removeStorageSync('analyzePrecisionSessionId')
      }
      Taro.setStorageSync('analyzeSourceTaskId', task.id)
      Taro.setStorageSync('analyzeTaskType', sourceTaskType)
      if (task.is_recorded) {
        Taro.setStorageSync('analyzeTaskIsRecorded', '1')
        if (task.record_id) {
          Taro.setStorageSync('analyzeCommittedRecordId', task.record_id)
        }
      } else {
        Taro.removeStorageSync('analyzeTaskIsRecorded')
        Taro.removeStorageSync('analyzeCommittedRecordId')
      }
      Taro.navigateTo({ url: extraPkgUrl('/pages/result/index') })
      return
    }
    if (task.status === 'pending' || task.status === 'processing') {
      const mode = pickExecutionMode(task)
      const tt = task.task_type || ''
      const isTextTask = tt === 'food_text' || tt.startsWith('food_text')
      const isExercise = tt === 'exercise' || tt.startsWith('exercise')
      // 与 analyze-loading 一致：图片任务回填预览图；文字任务清图避免沿用旧照片
      if (!isTextTask && !isExercise) {
        if (task.image_paths && task.image_paths.length > 0) {
          Taro.setStorageSync('analyzeImagePaths', task.image_paths)
          Taro.setStorageSync('analyzeImagePath', task.image_paths[0])
        } else if (task.image_url) {
          Taro.setStorageSync('analyzeImagePaths', [task.image_url])
          Taro.setStorageSync('analyzeImagePath', task.image_url)
        }
      } else if (isTextTask) {
        Taro.removeStorageSync('analyzeImagePath')
        Taro.removeStorageSync('analyzeImagePaths')
      }
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${task.id}&task_type=${encodeURIComponent(task.task_type)}&execution_mode=${mode}`
      })
      return
    }
    if (task.status === 'failed' || task.status === 'timed_out') {
      confirmRetryTask(task)
    }
  }

  return (
    <View className={`analyze-history-page ${scheme === 'dark' ? 'analyze-history-page--dark' : ''}`}>
      <CustomNavBar
        title='识别记录'
        showBack
        onBack={handleBack}
        color={scheme === 'dark' ? '#f3f7f4' : '#0f172a'}
        background={scheme === 'dark' ? '#101716' : '#f6faf8'}
      />
      <View className='search-bar'>
        <View className='search-input-wrap'>
          <Text className='iconfont icon-sousuo search-icon' />
          <Input
            className='search-input'
            type='text'
            placeholder='搜索食物名称'
            value={searchKeyword}
            onInput={(e) => handleSearchInput(e.detail.value)}
          />
          {searchKeyword.length > 0 && (
            <View className='search-clear' onClick={clearSearch}>
              <Text className='iconfont icon-guanbi search-clear-icon' />
            </View>
          )}
        </View>
      </View>
      <ScrollView className='list' scrollY style={{ height: `calc(100vh - ${navBarHeight}px - 96rpx)` }}>
        {loading ? (
          <View className='loading-wrap'><View className='loading-spinner-md' /></View>
        ) : tasks.length === 0 ? (
          <View className='empty'>
            <View className='empty-icon'>
              <Text className='iconfont icon-paizhao-xianxing' style={{ fontSize: '80rpx', color: '#9ca3af' }} />
            </View>
            <Text className='empty-text'>{searchKeyword ? '没有找到匹配的记录' : '暂时没有记录，快去拍一张吧~'}</Text>
          </View>
        ) : (
          <>
            <View className='list-header'>
              <View className='list-header-spacer' />
              <View className='bulk-delete-btn' onClick={handleDiscardUnrecorded}>
                <Text className='iconfont icon-shanchu bulk-delete-icon' />
                <Text className='bulk-delete-text'>一键删除未记录</Text>
              </View>
            </View>
            {tasks.map(t => (
              <TaskCard
                key={t.id}
                task={t}
                onTap={onTaskTap}
                onMore={handleMore}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* 底部操作弹窗 */}
      {showActionSheet && activeTask && (
        <View className='action-sheet-overlay' catchMove>
          <View className='action-sheet-mask' onClick={closeActionSheet} />
          <View className='action-sheet-content'>
            <View className='action-sheet-actions'>
              <View
                className={`action-sheet-item ${activeTask.status === 'done' && activeTask.result && !activeTask.is_recorded ? '' : 'action-sheet-item--disabled'}`}
                onClick={actionSheetQuickRecord}
              >
                <Text className='iconfont icon-canciguanli action-sheet-icon action-sheet-icon--record' />
                <Text className='action-sheet-label'>
                  {getTaskMealType(activeTask)
                    ? `快速记录到${MEAL_TYPE_LABELS[getTaskMealType(activeTask) || ''] || '餐食'}`
                    : '快速记录'}
                </Text>
              </View>
              <View className='action-sheet-divider' />
              <View
                className={`action-sheet-item ${activeTask.status === 'failed' || activeTask.status === 'timed_out' ? '' : 'action-sheet-item--disabled'}`}
                onClick={actionSheetRetry}
              >
                <Text className='iconfont icon-paizhao-xianxing action-sheet-icon action-sheet-icon--retry' />
                <Text className='action-sheet-label'>{pickSourceTaskType(activeTask) === 'food_text' ? '用原文字重新识别' : '用原图重新识别'}</Text>
              </View>
              <View className='action-sheet-divider' />
              <View
                className={`action-sheet-item ${activeTask.status === 'done' && activeTask.result ? '' : 'action-sheet-item--disabled'}`}
                onClick={actionSheetSaveRecipe}
              >
                <Text className='iconfont icon-shoucang-yishoucang action-sheet-icon action-sheet-icon--favorite' />
                <Text className='action-sheet-label'>收藏到我的餐食</Text>
              </View>
              <View className='action-sheet-divider' />
              <View
                className={`action-sheet-item ${activeTask.status === 'done' && activeTask.result ? '' : 'action-sheet-item--disabled'}`}
                onClick={actionSheetShare}
              >
                <Text className='iconfont icon-shiwu action-sheet-icon action-sheet-icon--library' />
                <Text className='action-sheet-label'>分享到公共食物库</Text>
              </View>
              <View className='action-sheet-divider' />
              <View className='action-sheet-item action-sheet-item--danger' onClick={actionSheetDelete}>
                <Text className='iconfont icon-shanchu action-sheet-icon' />
                <Text className='action-sheet-label'>删除</Text>
              </View>
            </View>
            <View className='action-sheet-cancel' onClick={closeActionSheet}>
              <Text className='action-sheet-cancel-text'>取消</Text>
            </View>
          </View>
        </View>
      )}
      <MealTypeSelectSheet
        visible={Boolean(quickRecordTask)}
        value={quickRecordMealType}
        title='记录到哪个餐次'
        confirmText='记录'
        onChange={setQuickRecordMealType}
        onCancel={closeQuickRecordMealSelector}
        onConfirm={confirmQuickRecordMealType}
      />
    </View>
  )
}

export default withAuth(AnalyzeHistoryPage)
