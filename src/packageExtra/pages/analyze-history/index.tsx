import { View, Text, Image, ScrollView } from '@tarojs/components'
import { withAuth } from '../../../utils/withAuth'
import { useState, useRef, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { listAnalyzeTasks, deleteAnalysisTask, type AnalysisTask, type AnalyzeResponse, type ExecutionMode, type AnalyzeRecognitionOutcome, type DeleteTaskResult } from '../../../utils/api'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

const STATUS_MAP: Record<string, string> = {
  pending: '排队中',
  processing: '识别中',
  done: '已完成',
  failed: '识别失败',
  violated: '内容违规',
  timed_out: '已超时',
  cancelled: '已取消'
}

const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  strict: '精准模式',
  standard: '标准模式'
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
  if (taskAny.execution_mode === 'strict' || taskAny.execution_mode === 'standard') {
    return taskAny.execution_mode
  }
  const payloadMode = (task.payload as Record<string, unknown> | undefined)?.execution_mode
  return payloadMode === 'strict' ? 'strict' : 'standard'
}

// 获取总热量
const getTotalCalories = (task: AnalysisTask): number => {
  if (!task.result) return 0
  const result = task.result as AnalyzeResponse
  return result.items?.reduce((sum, item) => sum + (item.nutrients?.calories || 0), 0) || 0
}

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

// 左滑操作按钮宽度
const ACTION_BUTTON_WIDTH = 140 // rpx

interface SwipeableTaskCardProps {
  task: AnalysisTask
  onTap: (task: AnalysisTask) => void
  onDelete: (taskId: string) => void
  onShare: (task: AnalysisTask) => void
}

function SwipeableTaskCard({ task, onTap, onDelete, onShare }: SwipeableTaskCardProps) {
  const [offset, setOffset] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const startXRef = useRef(0)
  const currentXRef = useRef(0)
  const maxOffset = ACTION_BUTTON_WIDTH * 2 // 两个按钮的总宽度

  const mode = pickExecutionMode(task)
  const recognitionOutcome = pickRecognitionOutcome(task)
  const canSwipe = task.status !== 'pending' // 排队中不能滑动，其他都可以
  const canShare = task.status === 'done' && task.result // 只有完成的才能分享
  const totalCalories = getTotalCalories(task)

  const handleTouchStart = (e: any) => {
    if (!canSwipe) return
    startXRef.current = e.touches[0].clientX
    currentXRef.current = offset
  }

  const handleTouchMove = (e: any) => {
    if (!canSwipe) return
    const diff = e.touches[0].clientX - startXRef.current
    let newOffset = currentXRef.current + diff
    // 限制滑动范围
    newOffset = Math.max(-maxOffset, Math.min(0, newOffset))
    setOffset(newOffset)
  }

  const handleTouchEnd = () => {
    if (!canSwipe) return
    // 根据滑动距离判断是否展开或收起
    if (offset < -maxOffset / 2) {
      setOffset(-maxOffset)
      setIsOpen(true)
    } else {
      setOffset(0)
      setIsOpen(false)
    }
  }

  const handleDelete = () => {
    Taro.showModal({
      title: '确认删除',
      content: '删除后无法恢复，是否确认删除？',
      confirmText: '删除',
      confirmColor: '#e57373',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          onDelete(task.id)
          setOffset(0)
          setIsOpen(false)
        }
      }
    })
  }

  const handleShare = () => {
    if (!canShare) {
      Taro.showToast({ title: '识别完成后才能分享', icon: 'none' })
      return
    }
    onShare(task)
    setOffset(0)
    setIsOpen(false)
  }

  const handleTap = () => {
    if (isOpen) {
      setOffset(0)
      setIsOpen(false)
    } else {
      onTap(task)
    }
  }

  return (
    <View className='swipeable-card-wrapper'>
      {/* 背景操作按钮 */}
      <View className='action-buttons' style={{ width: `${maxOffset}rpx` }}>
        <View 
          className={`action-btn share ${!canShare ? 'disabled' : ''}`} 
          onClick={handleShare}
        >
          <Text className='iconfont icon-fenxiang' />
          <Text className='action-text'>分享</Text>
        </View>
        <View className='action-btn delete' onClick={handleDelete}>
          <Text className='iconfont icon-shanchu' />
          <Text className='action-text'>删除</Text>
        </View>
      </View>

      {/* 卡片内容 */}
      <View
        className={`task-card ${task.status === 'violated' || task.is_violated ? 'task-card-violated' : ''}`}
        style={{ transform: `translateX(${offset}rpx)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleTap}
      >
        <View className='thumb'>
          {task.status === 'violated' || task.is_violated ? (
            <View className='thumb-violated'>
              <Text className='iconfont icon-jinggao' style={{ fontSize: '48rpx', color: '#e57373' }} />
            </View>
          ) : task.image_url ? (
            <Image src={task.image_url} mode='aspectFill' />
          ) : (
            <View className='thumb-placeholder'>
              <Text className='iconfont icon-xingzhuang-wenzi' style={{ fontSize: '48rpx', color: '#15803d' }} />
            </View>
          )}
        </View>
        <View className='body'>
          <View className='main-row'>
            <View className='left-content'>
              <Text className='calories'>{totalCalories > 0 ? `${Math.round(totalCalories)} kcal` : '--'}</Text>
              <Text className='time'>{(() => {
                const timeInfo = formatTime(task.created_at)
                return timeInfo.text
              })()}</Text>
            </View>
            <View className='right-content'>
              {/* 状态标签和模式标签放在同一行 */}
              <View className='tag-row-vertical'>
                <View className={`status-badge status-${task.status}`}>
                  <Text className='status-text'>{STATUS_MAP[task.status] || task.status}</Text>
                </View>
                {/* 只在精准模式下显示标签 */}
                {mode === 'strict' && (
                  <View className='mode-tag strict'>
                    <Text className='mode-tag-text'>精准</Text>
                  </View>
                )}
                {/* 精准模式下显示识别结果 */}
                {mode === 'strict' && task.status === 'done' && (
                  <View className={`recognition-tag recognition-${recognitionOutcome}`}>
                    <Text className='recognition-tag-text'>{RECOGNITION_OUTCOME_LABEL[recognitionOutcome]}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          {(task.status === 'violated' || task.is_violated) && task.violation_reason && (
            <Text className='violation-reason'>{task.violation_reason}</Text>
          )}
        </View>
        {(task.status === 'done' || task.status === 'failed' || task.status === 'processing') && !task.is_violated && (
          <Text className='arrow'>›</Text>
        )}
      </View>
    </View>
  )
}

function AnalyzeHistoryPage() {
  const [tasks, setTasks] = useState<AnalysisTask[]>([])
  const [loading, setLoading] = useState(true)
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    setLoading(true)
    try {
      // 单次拉取再前端筛选：避免 Promise.all 四路并行时一路挂起导致整页永远 loading（真机偶发）
      const res = await withTimeout(
        listAnalyzeTasks({ limit: 120 }).catch(() => ({ tasks: [] as AnalysisTask[] })),
        22000,
        () => ({ tasks: [] as AnalysisTask[] })
      )
      const allTasks = (res.tasks || []).filter((t) => isAnalyzeHistoryTaskType(t.task_type))
      allTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      if (seq !== loadSeqRef.current) return
      setTasks(allTasks)
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return
      console.error('[analyze-history] load failed', e)
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [])

  useDidShow(() => {
    void load()
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
      Taro.showToast({ title: e.message || '删除失败', icon: 'none' })
    }
  }

  const handleShare = (task: AnalysisTask) => {
    // 分享功能：跳转到分享页面
    if (task.status === 'done' && task.result) {
      const result = task.result as AnalyzeResponse
      // 准备分享数据
      const shareData = {
        imageUrl: task.image_url || '',
        description: result.description || '',
        totalCalories: result.items?.reduce((sum, item) => sum + (item.nutrients?.calories || 0), 0) || 0
      }
      Taro.setStorageSync('analyzeShareData', shareData)
      Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-share/index')}?from_analyze=1` })
    } else {
      Taro.showToast({ title: '只能分享已完成的任务', icon: 'none' })
    }
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
      Taro.setStorageSync('analyzeMealType', payload.meal_type || 'breakfast')
      Taro.setStorageSync('analyzeDietGoal', payload.diet_goal || 'none')
      Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing || 'none')
      Taro.setStorageSync('analyzeExecutionMode', pickExecutionMode(task))
      if (result.precisionSessionId) {
        Taro.setStorageSync('analyzePrecisionSessionId', result.precisionSessionId)
      } else {
        Taro.removeStorageSync('analyzePrecisionSessionId')
      }
      Taro.setStorageSync('analyzeSourceTaskId', task.id)
      Taro.setStorageSync('analyzeTaskType', sourceTaskType)
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
      Taro.showToast({ title: task.error_message || '识别失败', icon: 'none' })
    }
  }

  return (
    <View className='analyze-history-page'>
      <ScrollView className='list' scrollY>
        {loading ? (
          <View className='loading-wrap'><View className='loading-spinner-md' /></View>
        ) : tasks.length === 0 ? (
          <View className='empty'>
            <View className='empty-icon'>
              <Text className='iconfont icon-paizhao-xianxing' style={{ fontSize: '80rpx', color: '#9ca3af' }} />
            </View>
            <Text className='empty-text'>暂时没有记录，快去拍一张吧~</Text>
          </View>
        ) : (
          tasks.map(t => (
            <SwipeableTaskCard
              key={t.id}
              task={t}
              onTap={onTaskTap}
              onDelete={handleDelete}
              onShare={handleShare}
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}

export default withAuth(AnalyzeHistoryPage)
