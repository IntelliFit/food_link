import { View, Text, Image } from '@tarojs/components'
import { withAuth } from '../../../utils/withAuth'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAnalyzeTask,
  type AnalysisTask,
  type AnalysisEngine,
  type AnalyzeResponse,
  type ExecutionMode,
  type ExerciseTaskResultPayload
} from '../../../utils/api'
import { showUnifiedApiError } from '../../../utils/error-modal'
import { IconExercise } from '../../../components/iconfont'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getStoredRecordTargetDate, persistRecordTargetDate } from '../../../utils/record-date'
import './index.scss'

/** 与记运动页一致，用于完成后清除「待同步」状态 */
const EXERCISE_PENDING_TASK_KEY = 'exercise_pending_task_id'
const ANALYSIS_ENGINE_STORAGE_KEY = 'analyzeAnalysisEngine'

const normalizeAnalysisEngine = (value: unknown): AnalysisEngine => (
  value === 'legacy_direct' ? 'legacy_direct' : 'db_first'
)

// 健康小知识
const HEALTH_TIPS = [
  '吃饭顺序有讲究：先吃蔬菜，再吃蛋白质，最后吃碳水，可以有效平稳血糖。',
  '每一口食物咀嚼 20-30 次，不仅助消化，还能提升饱腹感，减少过量进食。',
  '餐前 30 分钟喝一杯水，可以激活新陈代谢，并自然减少正餐摄入量。',
  '早餐摄入约 30 克蛋白质（如鸡蛋、牛奶），可以防止午餐前的饥饿感和对甜食的渴望。',
  '深色蔬菜（如菠菜、紫甘蓝）通常比浅色蔬菜含有更多的抗氧化剂和微量元素。',
  '尽量在睡前 3 小时停止进食，让肠胃有充分的时间休息和修复。',
  '运动后 30 分钟内补充蛋白质+碳水，有助于肌肉恢复与合成。',
  '少食多餐有助于稳定血糖，避免暴饮暴食。',
  '减脂期的重点是"制造热量缺口"，而非盲目节食，保证基础代谢很重要。',
  '全谷物（如燕麦、糙米）含有更多膳食纤维，能提供更持久的能量和饱腹感。',
  '规律的阻力训练不仅能增加肌肉量，还能提高静息代谢率，让你"躺着也消耗热量"。',
  '睡眠不足会导致体内皮质醇水平升高，增加食欲并更容易囤积脂肪。',
  '选择健康的油脂（如橄榄油、牛油果、坚果），对心血管健康和吸收脂溶性维生素至关重要。',
  '喝黑咖啡能在一定程度上提高代谢，并在运动前提供额外的充沛精力。',
  '想要更出色的腹肌，光靠卷腹不够，还需要配合减脂和全身核心训练。',
  '水果虽好，但含有果糖，减脂期建议适量食用，并选择低升糖指数的水果如苹果、草莓。',
  '快走和慢跑都是极佳的低强度有氧运动，有助于改善心肺功能和加速脂肪燃烧。',
  '力量训练后的拉伸可以缓解肌肉酸痛，增加柔韧性，同时预防运动损伤。',
  '适量补充钙质及相关维生素，对骨骼健康和免疫系统有益，尤其在缺乏日照的冬季。',
  '晚餐尽量清淡易消化，减少高盐高油食物的摄入，以免影响睡眠质量。',
  '久坐一族每隔一小时最好起身活动 3-5 分钟，有助于改善血液循环。',
  '用白开水或淡茶代替含糖饮料，是减少每日无形热量摄入的最简单方法。',
  '保持良好的体态（如不驼背）能让呼吸更顺畅，也有助于调动核心肌群。',
  '偶尔吃一顿「放纵餐」可以帮助缓解心理压力，并可能利于打破减脂平台期。',
  '慢速进食不仅帮助大脑更好接收"吃饱了"的信号，还能让你更享受食物的美味。',
  '"少油少盐"不代表"无油无盐"，适量摄入盐分（钠）对维持身体水分平衡很重要。',
  '无氧运动和有氧运动结合，往往能达到最佳的减脂塑型效果。',
  '每周安排一两天的休息日，让身体有时间从运动疲劳中恢复。',
  '"局部减脂"是一个伪命题，脂肪的减少通常是全身性的。',
  '吃富含欧米伽三不饱和脂肪酸的食物（如三文鱼、亚麻籽），有助于抗炎和改善认知功能。',
  '压力过大容易引发情绪性进食，学会用运动或冥想来释放压力。',
  '重视每一顿饭的搭配：碳水提供能量，蛋白质修补身体，脂肪合成激素，缺一不可。',
  '运动时选择透气吸汗的装备，可以提升运动表现和带来更好的体验。',
  '对于初学者，掌握正确的动作发力比追求更大的重量重要得多。',
  '碳酸饮料即使是无糖的（代糖），也可能增加对甜食的渴望，建议适度饮用。',
  '更换小号的餐盘，可以在视觉上让你觉得吃得很多，帮助自然减少食量。',
  '酸奶是良好的益生菌来源，但购买时需警惕配料表中隐藏的添加糖。',
  '记录饮食习惯（如拍照或记笔记）能让你更直观地认识到自己的摄入情况，提高自控力。',
  '运动不仅改变身材，更分泌被称为"快乐荷尔蒙"的内啡肽，提升整体幸福感。',
  '冬季运动热身需要花更多时间，让关节和肌肉充分准备好以防拉伤。',
  '日常爬楼梯代替坐电梯，是增加日常非运动活动消耗的好方法。',
  '吃火锅时，先涮蔬菜和海鲜，最后吃肉类，可以减少整体油脂的摄入。',
  '正确的深蹲姿势应保持背部挺直，发力由臀部和腿部主导，避免膝盖受压过大。',
  '对于久盯屏幕的人，多做颈部和肩部的拉伸放松可以极大缓解疲劳。',
  '绿茶中含有的儿茶素能适度促进脂肪氧化，是减脂期优秀的饮品选择。',
  '饮食不能走极端，极低碳水或极低脂肪的饮食法都不利于长期的健康维持。',
  '饿的时候不要去逛超市，这会让你更容易买下高热量的零食。',
  '保持居家环境的光线充足和通风，有助于改善心情，让你更有动力去运动。',
  '测量腰围和体脂率比单看体重秤上的数字，更能真实反映你的减脂效果。',
  '最好的健身计划就是那份你能长期坚持下去的计划。'
]

const SHOWN_TIPS_KEY = 'analyze_shown_health_tips'

type WaitingInteractionCard =
  | {
      type: 'quiz'
      eyebrow: string
      title: string
      options: [string, string]
      answerIndex: 0 | 1
      reveal: string
    }
  | {
      type: 'fact'
      eyebrow: string
      title: string
      reveal: string
      actionText: string
    }

const WAITING_INTERACTION_CARDS: WaitingInteractionCard[] = [
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '同样 100g，哪个通常热量更高？',
    options: ['米饭', '油条'],
    answerIndex: 1,
    reveal: '油条更高。油炸会让食物吸入不少油脂，热量密度会明显上去。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '想让饭后血糖更平稳，哪种顺序更友好？',
    options: ['先菜肉后主食', '先主食后菜肉'],
    answerIndex: 0,
    reveal: '先菜肉后主食通常更友好。蔬菜纤维和蛋白质能帮主食吸收节奏慢一点。'
  },
  {
    type: 'quiz',
    eyebrow: '快问快答',
    title: '减脂期更应该盯住哪个长期指标？',
    options: ['单餐完美', '周平均趋势'],
    answerIndex: 1,
    reveal: '周平均趋势更重要。偶尔一餐波动正常，长期能量平衡才决定方向。'
  },
  {
    type: 'fact',
    eyebrow: '等一下顺手看',
    title: '这次结果出来后，优先看什么？',
    reveal: '先看总热量是否离目标太远，再看蛋白质够不够。三大营养素比单个数字更有参考价值。',
    actionText: '换一张'
  },
  {
    type: 'fact',
    eyebrow: '少踩一个坑',
    title: '饮料和酱料常是隐藏热量',
    reveal: '奶茶、果汁、沙拉酱、拌面酱这类东西体积不大，但很容易把一餐热量往上推。',
    actionText: '再看一条'
  }
]

const getNextTipIndex = (current?: number) => {
  try {
    let shown: number[] = Taro.getStorageSync(SHOWN_TIPS_KEY) || []
    if (shown.length >= HEALTH_TIPS.length) {
      shown = current !== undefined ? [current] : []
    }
    let available = HEALTH_TIPS.map((_, i) => i).filter(i => !shown.includes(i))
    if (available.length === 0) available = HEALTH_TIPS.map((_, i) => i)

    const nextIdx = available[Math.floor(Math.random() * available.length)]
    shown.push(nextIdx)
    Taro.setStorageSync(SHOWN_TIPS_KEY, shown)
    return nextIdx
  } catch (e) {
    return Math.floor(Math.random() * HEALTH_TIPS.length)
  }
}

const POLL_INTERVAL = 2000
const TIP_ROTATE_INTERVAL = 6000
const ANALYZE_TIMEOUT = 5 * 60 * 1000

const EXECUTION_MODE_META: Record<ExecutionMode, { title: string; desc: string }> = {
  strict: {
    title: '精准模式',
    desc: '会优先判断这餐能否分项精估；菜太多或遮挡重时会提醒你拆拍。'
  },
  standard: {
    title: '标准模式',
    desc: '优先保证记录效率，适合日常快速记录。'
  }
}

const FOOD_STANDARD_STAGE_LABELS = ['识别食物/份量', '匹配营养库', '整理结果']
const FOOD_STRICT_STAGE_LABELS = ['拆分食物', '精估份量', '匹配营养库']
const FOOD_TEXT_STAGE_LABELS = ['解析文字', '匹配营养库', '整理结果']
const EXERCISE_STAGE_LABELS = ['理解运动', '估算消耗', '写入记录']

const normalizeExecutionMode = (value: unknown): ExecutionMode => (
  value === 'strict' ? 'strict' : 'standard'
)

const normalizeTaskType = (value: unknown): 'food' | 'food_text' | 'exercise' => {
  if (value === 'food_text') return 'food_text'
  if (value === 'exercise') return 'exercise'
  return 'food'
}

const pickSourceTaskTypeFromTask = (task: AnalysisTask): 'food' | 'food_text' => {
  if (task.task_type === 'food_text') return 'food_text'
  const payload = task.payload as Record<string, unknown> | undefined
  return payload?.source_type === 'text' ? 'food_text' : 'food'
}

const persistResultImageFromTask = (task: AnalysisTask) => {
  const taskImagePaths = Array.isArray(task.image_paths)
    ? task.image_paths.filter((path) => typeof path === 'string' && path.trim())
    : []
  const taskImageUrl = typeof task.image_url === 'string' && task.image_url.trim()
    ? task.image_url.trim()
    : ''

  if (taskImagePaths.length > 0) {
    Taro.setStorageSync('analyzeImagePath', taskImagePaths[0])
    Taro.setStorageSync('analyzeImagePaths', taskImagePaths)
    return
  }

  if (taskImageUrl) {
    Taro.setStorageSync('analyzeImagePath', taskImageUrl)
    Taro.setStorageSync('analyzeImagePaths', [taskImageUrl])
  }
}

const persistAnalyzeContextFromPayload = (payload: Record<string, unknown>) => {
  if (typeof payload.meal_type === 'string' && payload.meal_type.trim()) {
    Taro.setStorageSync('analyzeMealType', payload.meal_type)
  }
  if (typeof payload.diet_goal === 'string' && payload.diet_goal.trim()) {
    Taro.setStorageSync('analyzeDietGoal', payload.diet_goal)
  }
  if (typeof payload.activity_timing === 'string' && payload.activity_timing.trim()) {
    Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing)
  }
}

const pickExecutionModeFromTask = (task: AnalysisTask): ExecutionMode | null => {
  const taskAny = task as AnalysisTask & { execution_mode?: unknown }
  if (taskAny.execution_mode === 'strict' || taskAny.execution_mode === 'standard') {
    return taskAny.execution_mode
  }
  const payloadMode = (task.payload as Record<string, unknown> | undefined)?.execution_mode
  if (payloadMode === 'strict' || payloadMode === 'standard') {
    return payloadMode
  }
  return null
}

function AnalyzeLoadingPage() {
  const [taskId, setTaskId] = useState<string>('')
  const [taskType, setTaskType] = useState<string>(() =>
    normalizeTaskType(Taro.getCurrentInstance().router?.params?.task_type)
  )
  const [textRecordInput, setTextRecordInput] = useState<string>(() =>
    String(Taro.getStorageSync('analyzeTextInput') || '').trim()
  )
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [status, setStatus] = useState<'loading' | 'done' | 'failed' | 'violated'>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [violationReason, setViolationReason] = useState<string>('')
  const [tipIndex, setTipIndex] = useState(() => getNextTipIndex())
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastTaskStatusText, setLastTaskStatusText] = useState('已提交')
  const [interactionIndex, setInteractionIndex] = useState(0)
  const [selectedQuizOption, setSelectedQuizOption] = useState<number | null>(null)
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [imagePath, setImagePath] = useState<string>('')
  const [currentStep, setCurrentStep] = useState(1) // 当前进行的步骤索引
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollFnRef = useRef<(() => Promise<void>) | null>(null)
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(Date.now())
  const routeSignatureRef = useRef<string>('')

  const syncImagePathFromStorage = useCallback(() => {
    try {
      // 仅以 URL task_type 为准：food_text = 文字链（占位图）；food / food_image 等 = 拍照或相册（用 storage 里的本地/远端预览）
      const type = normalizeTaskType(Taro.getCurrentInstance().router?.params?.task_type)
      if (type === 'food_text') {
        Taro.removeStorageSync('analyzeImagePath')
        Taro.removeStorageSync('analyzeImagePaths')
        setImagePath('')
        return
      }
      if (type === 'exercise') {
        setImagePath('')
        return
      }
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      const storedPaths = Taro.getStorageSync('analyzeImagePaths')
      if (storedPaths && Array.isArray(storedPaths) && storedPaths.length > 0) {
        setImagePath(String(storedPaths[0] || ''))
      } else if (storedPath) {
        setImagePath(String(storedPath))
      } else {
        setImagePath('')
      }
    } catch (e) {
      console.error('获取图片路径失败:', e)
    }
  }, [])

  const syncTextRecordInputFromStorage = useCallback(() => {
    try {
      setTextRecordInput(String(Taro.getStorageSync('analyzeTextInput') || '').trim())
    } catch {
      setTextRecordInput('')
    }
  }, [])

  useEffect(() => {
    syncImagePathFromStorage()
    syncTextRecordInputFromStorage()
  }, [syncImagePathFromStorage, syncTextRecordInputFromStorage])

  const syncRouteTaskFromParams = useCallback(() => {
    const params = Taro.getCurrentInstance().router?.params
    const id = params?.task_id
    const type = normalizeTaskType(params?.task_type)
    const modeFromStorage = Taro.getStorageSync('analyzeExecutionMode')
    const mode = normalizeExecutionMode(params?.execution_mode || modeFromStorage)
    const requestedAnalysisEngine = String(params?.analysis_engine || '').trim()
    const nextSignature = `${String(id || '')}|${type}|${mode}|${requestedAnalysisEngine}`

    const isDebug = id?.startsWith('debug-') || false
    setIsDebugMode(isDebug)

    if (!id) {
      void showUnifiedApiError(new Error('缺少任务 ID'), '缺少任务 ID')
      setTimeout(() => Taro.navigateBack(), 1500)
      return
    }
    if (routeSignatureRef.current !== nextSignature) {
      routeSignatureRef.current = nextSignature
      console.info('[analyze-loading] sync route task', {
        task_id: id,
        task_type: type,
        execution_mode: mode,
        analysis_engine: requestedAnalysisEngine || '(from storage)',
      })
      setStatus('loading')
      setErrorMessage('')
      setViolationReason('')
      setCurrentStep(1)
      setElapsedSeconds(0)
      setLastTaskStatusText('已提交')
      setInteractionIndex((prev) => (prev + 1) % WAITING_INTERACTION_CARDS.length)
      setSelectedQuizOption(null)
      setTipIndex(getNextTipIndex())
      startTimeRef.current = Date.now()
    }
    setTaskId(id)
    setTaskType(type)
    setExecutionMode(mode)
    Taro.setStorageSync('analyzeExecutionMode', mode)
    Taro.setStorageSync('analyzeTaskType', type)
    if (requestedAnalysisEngine) {
      Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, normalizeAnalysisEngine(requestedAnalysisEngine))
    }
    if (type === 'exercise') {
      Taro.setNavigationBarTitle({ title: '分析中' })
    }

    if (isDebug) {
      Taro.showToast({
        title: '调试模式：停留在分析中',
        icon: 'none',
        duration: 2000
      })
    }
  }, [])

  useDidShow(() => {
    syncRouteTaskFromParams()
    syncImagePathFromStorage()
    syncTextRecordInputFromStorage()
    // 切后台再回前台：补一次任务拉取（与 setInterval 互补）
    void pollFnRef.current?.()
  })

  useEffect(() => {
    syncRouteTaskFromParams()
  }, [syncRouteTaskFromParams])

  // 阶段提示：后端目前只暴露 pending/processing，因此前端做单向推进，不倒退、不假装百分比。
  useEffect(() => {
    if (status !== 'loading') return

    stepTimerRef.current = setInterval(() => {
      setCurrentStep(prev => Math.min(prev + 1, 3))
    }, 7000)

    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current)
    }
  }, [status])

  useEffect(() => {
    if (status !== 'loading') return

    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000)))
    }, 1000)

    return () => {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
    }
  }, [status])

  useEffect(() => {
    if (!taskId || status !== 'loading' || isDebugMode) return

    startTimeRef.current = Date.now()

    timeoutTimerRef.current = setTimeout(() => {
      setStatus('failed')
      setErrorMessage('分析超时，请重试')
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      if (tipTimerRef.current) {
        clearInterval(tipTimerRef.current)
        tipTimerRef.current = null
      }
      if (stepTimerRef.current) {
        clearInterval(stepTimerRef.current)
        stepTimerRef.current = null
      }
    }, ANALYZE_TIMEOUT)

    return () => {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current)
        timeoutTimerRef.current = null
      }
    }
  }, [taskId, status, isDebugMode])

  useEffect(() => {
    if (!taskId || status !== 'loading') return

    if (isDebugMode) {
      console.log('[Debug Mode] 跳过真实轮询，保持分析中状态')
      return
    }

    const poll = async () => {
      try {
        const task: AnalysisTask = await getAnalyzeTask(taskId)
        setLastTaskStatusText(task.status === 'processing' ? '处理中' : task.status === 'pending' ? '排队中' : '收尾中')
        if (task.status === 'processing') {
          setCurrentStep(prev => Math.max(prev, 1))
        }
        const taskMode = pickExecutionModeFromTask(task)
        const effectiveTaskType = pickSourceTaskTypeFromTask(task)
        if (taskMode) {
          setExecutionMode(taskMode)
          Taro.setStorageSync('analyzeExecutionMode', taskMode)
        }
        if (effectiveTaskType !== taskType) {
          setTaskType(effectiveTaskType)
          Taro.setStorageSync('analyzeTaskType', effectiveTaskType)
        }
        if (task.status === 'done' && task.result) {
          const exResult = task.result as unknown as ExerciseTaskResultPayload | undefined
          if (exResult?.exercise_log) {
            setStatus('done')
            if (timeoutTimerRef.current) {
              clearTimeout(timeoutTimerRef.current)
              timeoutTimerRef.current = null
            }
            if (pollTimerRef.current) {
              clearInterval(pollTimerRef.current)
              pollTimerRef.current = null
            }
            if (stepTimerRef.current) {
              clearInterval(stepTimerRef.current)
              stepTimerRef.current = null
            }
            if (elapsedTimerRef.current) {
              clearInterval(elapsedTimerRef.current)
              elapsedTimerRef.current = null
            }
            if (tipTimerRef.current) {
              clearInterval(tipTimerRef.current)
              tipTimerRef.current = null
            }
            Taro.removeStorageSync(EXERCISE_PENDING_TASK_KEY)
            const kcal = exResult.estimated_calories ?? exResult.exercise_log.calories_burned
            Taro.showToast({ title: `已记录 ${kcal} kcal`, icon: 'success' })
            const exerciseDate = persistRecordTargetDate(String(((task.payload as Record<string, unknown>)?.recorded_on as string) || ''))
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(exerciseDate)}` })
            return
          }

          const result = task.result as AnalyzeResponse
          if (result.redirectTaskId && result.redirectTaskId !== taskId) {
            setTaskId(result.redirectTaskId)
            return
          }
          setStatus('done')
          if (timeoutTimerRef.current) {
            clearTimeout(timeoutTimerRef.current)
            timeoutTimerRef.current = null
          }
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
          if (stepTimerRef.current) {
            clearInterval(stepTimerRef.current)
            stepTimerRef.current = null
          }
          if (elapsedTimerRef.current) {
            clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = null
          }
          Taro.removeStorageSync('analyzePendingCorrectionTaskId')
          Taro.removeStorageSync('analyzePendingCorrectionItems')
          const payload = task.payload || {}
          const targetDate = persistRecordTargetDate(String((payload.recorded_on as string) || getStoredRecordTargetDate()))
          const settledMode = taskMode || executionMode
          const settledAnalysisEngine = normalizeAnalysisEngine(
            result.analysis_engine || (payload as Record<string, unknown>).analysis_engine
          )
          Taro.setStorageSync('analyzeExecutionMode', settledMode)
          Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, settledAnalysisEngine)
          if (result.precisionSessionId) {
            Taro.setStorageSync('analyzePrecisionSessionId', result.precisionSessionId)
          } else {
            Taro.removeStorageSync('analyzePrecisionSessionId')
          }

          // 根据任务类型跳转到不同的结果页面
          if (effectiveTaskType === 'food_text') {
            // 文字分析：跳转到统一的结果页（复用图片分析页）
            // 必须同时清空单图和多图缓存，避免上一次拍照识别残留的图片混入本次纯文字结果。
            Taro.removeStorageSync('analyzeImagePath')
            Taro.removeStorageSync('analyzeImagePaths')
            Taro.setStorageSync('analyzeTextInput', task.text_input || '')
            setTextRecordInput(String(task.text_input || '').trim())
            Taro.setStorageSync('analyzeTextAdditionalContext', (payload.additionalContext as string) || '')
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            persistAnalyzeContextFromPayload(payload)
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.setStorageSync('analyzeTaskType', 'food_text')
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/result/index')}?date=${encodeURIComponent(targetDate)}` })
          } else {
            Taro.removeStorageSync('analyzeTextInput')
            Taro.removeStorageSync('analyzeTextAdditionalContext')
            persistResultImageFromTask(task)
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            persistAnalyzeContextFromPayload(payload)
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.setStorageSync('analyzeTaskType', 'food')
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/result/index')}?date=${encodeURIComponent(targetDate)}` })
          }
          return
        }
        if (task.status === 'failed' || task.status === 'timed_out') {
          setStatus('failed')
          setErrorMessage(task.error_message || (task.status === 'timed_out' ? '分析超时，请重试' : '识别失败'))
          if (timeoutTimerRef.current) {
            clearTimeout(timeoutTimerRef.current)
            timeoutTimerRef.current = null
          }
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
          if (stepTimerRef.current) {
            clearInterval(stepTimerRef.current)
            stepTimerRef.current = null
          }
          if (elapsedTimerRef.current) {
            clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = null
          }
        }
        if (task.status === 'violated' || task.is_violated) {
          setStatus('violated')
          setViolationReason(task.violation_reason || '内容违规')
          if (timeoutTimerRef.current) {
            clearTimeout(timeoutTimerRef.current)
            timeoutTimerRef.current = null
          }
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
          if (stepTimerRef.current) {
            clearInterval(stepTimerRef.current)
            stepTimerRef.current = null
          }
          if (elapsedTimerRef.current) {
            clearInterval(elapsedTimerRef.current)
            elapsedTimerRef.current = null
          }
        }
      } catch (e: any) {
        console.error('轮询任务失败:', e)
      }
    }
    pollFnRef.current = poll
    poll()
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL)
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      pollFnRef.current = null
    }
  }, [taskId, taskType, status, executionMode, isDebugMode])

  useEffect(() => {
    if (status !== 'loading') return
    tipTimerRef.current = setInterval(() => {
      setTipIndex(i => getNextTipIndex(i))
    }, TIP_ROTATE_INTERVAL)
    return () => {
      if (tipTimerRef.current) clearInterval(tipTimerRef.current)
    }
  }, [status])

  const handleLeave = () => {
    if (taskType === 'exercise') {
      Taro.showModal({
        title: '稍后查看',
        content: '分析将在后台继续，完成后可回到「记运动」页面查看结果。',
        showCancel: true,
        confirmText: '去记运动',
        cancelText: '留在此页',
        success: res => {
          if (res.confirm) {
            Taro.redirectTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(getStoredRecordTargetDate())}` })
          }
        }
      })
      return
    }
    Taro.showModal({
      title: '稍后查看',
      content: '分析将在后台继续，完成后可在「识别记录」中查看结果。',
      showCancel: true,
      confirmText: '去历史',
      success: res => {
        if (res.confirm) {
          Taro.redirectTo({ url: extraPkgUrl('/pages/analyze-history/index') })
        }
      }
    })
  }

  const handleGoHistory = () => {
    Taro.redirectTo({ url: extraPkgUrl('/pages/analyze-history/index') })
  }

  const handleNextInteraction = () => {
    setInteractionIndex(prev => (prev + 1) % WAITING_INTERACTION_CARDS.length)
    setSelectedQuizOption(null)
  }

  const formatElapsed = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return `${minutes}m ${rest}s`
  }

  if (status === 'violated') {
    return (
      <View className='analyze-loading-page'>
        <View className='violated-wrap'>
          <View className='violated-icon-wrap'>
            <Text className='iconfont icon-nothing' style={{ fontSize: '80rpx', color: '#dc2626' }} />
          </View>
          <Text className='violated-title'>内容审核未通过</Text>
          <Text className='violated-reason'>{violationReason}</Text>
          <Text className='violated-hint'>您提交的内容不符合平台使用规范，请确保上传与食物相关的图片或文字描述。</Text>
          <Text className='btn-history' onClick={handleGoHistory}>返回识别记录</Text>
          <Text className='ai-notice'> 食探 - 您的智能健康管理助手</Text>
        </View>
      </View>
    )
  }

  if (status === 'failed') {
    return (
      <View className='analyze-loading-page'>
        <View className='error-wrap'>
          <Text className='error-msg'>
            {taskType === 'exercise' ? '分析失败：' : '识别失败：'}
            {errorMessage}
          </Text>
          <Text
            className='btn-history'
            onClick={() =>
              taskType === 'exercise'
                ? Taro.redirectTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(getStoredRecordTargetDate())}` })
                : handleGoHistory()
            }
          >
            {taskType === 'exercise' ? '返回记运动' : '去识别记录'}
          </Text>
          <Text className='ai-notice'> 食探 - 您的智能健康管理助手</Text>
        </View>
      </View>
    )
  }

  const isTextFoodTask = taskType === 'food_text'
  const textRecordPreview = textRecordInput || '文字记录，未提供实物照片'
  const interactionCard = WAITING_INTERACTION_CARDS[interactionIndex]
  const compactStageLabels = taskType === 'exercise'
    ? EXERCISE_STAGE_LABELS
    : taskType === 'food_text'
      ? FOOD_TEXT_STAGE_LABELS
      : executionMode === 'strict'
        ? FOOD_STRICT_STAGE_LABELS
        : FOOD_STANDARD_STAGE_LABELS
  const currentCompactStage = compactStageLabels[Math.min(currentStep, compactStageLabels.length - 1)]

  return (
    <View className='analyze-loading-page-v3'>
      {/* 全屏背景：拍照分析与结果头图一致；文字分析与结果页「无图占位」同一视觉 */}
      {isTextFoodTask ? (
        <View className='fullscreen-bg-text-record'>
          <View className='fullscreen-text-placeholder'>
            <View className='text-record-icon-wrap'>
              <Text className='iconfont icon-shiwu' style={{ fontSize: '120rpx', color: '#00bc7d' }} />
            </View>
            <Text className='text-record-placeholder-label'>{textRecordPreview}</Text>
          </View>
        </View>
      ) : imagePath ? (
        <Image className='fullscreen-bg-image' src={imagePath} mode='aspectFill' />
      ) : (
        <View className='fullscreen-bg-fallback' />
      )}

      {/* 底部渐变：仅衬托文字，不遮挡整图 */}
      <View className='loading-bottom-readability' />

      {/* 内容层 */}
      <View className='content-layer'>
        <View className='scanner-frame-container'>
          <View className='scanner-frame-v3'>
            {taskType === 'exercise' ? (
              <View className='frame-placeholder-v3'>
                <IconExercise size={64} color='#f97316' />
              </View>
            ) : isTextFoodTask ? (
              <View className='frame-placeholder-v3 frame-placeholder-text-record'>
                <View className='frame-text-record-icon-wrap'>
                  <Text className='iconfont icon-shiwu' style={{ fontSize: '64rpx', color: '#00bc7d' }} />
                </View>
                <Text className='frame-text-record-label'>{textRecordPreview}</Text>
              </View>
            ) : imagePath ? (
              <Image className='frame-image-v3' src={imagePath} mode='aspectFill' />
            ) : (
              <View className='frame-placeholder-v3'>
                <Text className='iconfont icon-shiwu' style={{ fontSize: '64rpx', color: '#00bc7d' }} />
              </View>
            )}
            <View className='scan-line-v3' />
            <View className='corner corner-tl' />
            <View className='corner corner-tr' />
            <View className='corner corner-bl' />
            <View className='corner corner-br' />
          </View>
        </View>

        <View className='game-tip-container'>
          <View className='game-tip-box'>
            <Text className='game-tip-label'>小贴士</Text>
            <Text className='game-tip-text'>{HEALTH_TIPS[tipIndex]}</Text>
          </View>
        </View>

        <View className='steps-panel'>
          <View className='stage-summary'>
            <Text className='stage-summary-title'>
              {currentCompactStage}
            </Text>
            <Text className='stage-summary-time'>已等待 {formatElapsed(elapsedSeconds)}</Text>
          </View>
          <View className='compact-stage-row'>
            <Text className='compact-stage-status'>任务{lastTaskStatusText}</Text>
            <Text className='compact-stage-flow'>{compactStageLabels.join(' → ')}</Text>
          </View>
        </View>

        <View className='waiting-interaction-card'>
          <View className='waiting-interaction-head'>
            <Text className='waiting-interaction-eyebrow'>{interactionCard.eyebrow}</Text>
            <Text className='waiting-interaction-skip' onClick={handleNextInteraction}>
              换一个
            </Text>
          </View>
          <Text className='waiting-interaction-title'>{interactionCard.title}</Text>
          {interactionCard.type === 'quiz' ? (
            <View className='waiting-quiz-options'>
              {interactionCard.options.map((option, index) => {
                const chosen = selectedQuizOption === index
                const correct = interactionCard.answerIndex === index
                const revealed = selectedQuizOption !== null
                return (
                  <View
                    key={option}
                    className={`waiting-quiz-option${chosen ? ' chosen' : ''}${revealed && correct ? ' correct' : ''}`}
                    onClick={() => setSelectedQuizOption(index)}
                  >
                    <Text className='waiting-quiz-option-text'>{option}</Text>
                  </View>
                )
              })}
              {selectedQuizOption !== null && (
                <Text className='waiting-interaction-reveal'>{interactionCard.reveal}</Text>
              )}
            </View>
          ) : (
            <View className='waiting-fact-body'>
              <Text className='waiting-interaction-reveal'>{interactionCard.reveal}</Text>
              <View className='waiting-fact-next' onClick={handleNextInteraction}>
                <Text className='waiting-fact-next-text'>{interactionCard.actionText}</Text>
              </View>
            </View>
          )}
        </View>

        {taskType !== 'exercise' && (
          <View className={`mode-badge ${executionMode}`}>
            <Text className='mode-badge-text'>{EXECUTION_MODE_META[executionMode].title}</Text>
          </View>
        )}

        <View className='bottom-actions'>
          <View className='btn-leave-v3' onClick={handleLeave}>
            <Text className='btn-leave-text-v3'>先离开，稍后查看</Text>
          </View>
          {isDebugMode && (
            <View className='btn-exit-debug-v3' onClick={() => Taro.navigateBack()}>
              <Text className='btn-exit-debug-text'>退出调试</Text>
            </View>
          )}
        </View>

        <Text className='brand-footer'>食探 · 智能饮食记录</Text>
      </View>
    </View>
  )
}

export default withAuth(AnalyzeLoadingPage)
