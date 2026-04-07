import { View, Text, Image } from '@tarojs/components'
import { withAuth } from '../../utils/withAuth'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAnalyzeTask,
  type AnalysisTask,
  type AnalyzeResponse,
  type ExecutionMode,
  type ExerciseTaskResultPayload
} from '../../utils/api'
import { IconExercise } from '../../components/iconfont'
import './index.scss'

/** 与记运动页一致，用于完成后清除「待同步」状态 */
const EXERCISE_PENDING_TASK_KEY = 'exercise_pending_task_id'

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

// 分析步骤配置
const ANALYSIS_STEPS = [
  {
    id: 'image',
    title: '图片已接收',
    desc: '已收到照片，准备分析'
  },
  {
    id: 'ingredients',
    title: '识别食材',
    desc: '正在识别食物成分'
  },
  {
    id: 'portions',
    title: '估算分量',
    desc: '估算各类食物重量'
  },
  {
    id: 'nutrition',
    title: '生成营养分析',
    desc: '汇总热量与营养素'
  }
]

/** 运动热量异步任务步骤（与食物分析页同一套 UI 结构） */
const EXERCISE_ANALYSIS_STEPS = [
  { id: 'ex1', title: '描述已接收', desc: '已收到你的运动描述' },
  { id: 'ex2', title: '理解运动类型', desc: '结合时长与强度' },
  { id: 'ex3', title: '估算消耗', desc: '大模型估算千卡' },
  { id: 'ex4', title: '写入记录', desc: '保存到今日运动' }
]

const normalizeExecutionMode = (value: unknown): ExecutionMode => (
  value === 'strict' ? 'strict' : 'standard'
)

const normalizeTaskType = (value: unknown): 'food' | 'food_text' | 'exercise' => {
  if (value === 'food_text') return 'food_text'
  if (value === 'exercise') return 'exercise'
  return 'food'
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
  const [taskType, setTaskType] = useState<string>('food')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [status, setStatus] = useState<'loading' | 'done' | 'failed' | 'violated'>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [violationReason, setViolationReason] = useState<string>('')
  const [tipIndex, setTipIndex] = useState(() => getNextTipIndex())
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [imagePath, setImagePath] = useState<string>('')
  const [currentStep, setCurrentStep] = useState(1) // 当前进行的步骤索引
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollFnRef = useRef<(() => Promise<void>) | null>(null)
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(Date.now())

  const syncImagePathFromStorage = useCallback(() => {
    try {
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      const storedPaths = Taro.getStorageSync('analyzeImagePaths')
      if (storedPaths && Array.isArray(storedPaths) && storedPaths.length > 0) {
        setImagePath(String(storedPaths[0] || ''))
      } else if (storedPath) {
        setImagePath(String(storedPath))
      }
    } catch (e) {
      console.error('获取图片路径失败:', e)
    }
  }, [])

  useEffect(() => {
    syncImagePathFromStorage()
  }, [syncImagePathFromStorage])

  useDidShow(() => {
    syncImagePathFromStorage()
    // 切后台再回前台：补一次任务拉取（与 setInterval 互补）
    void pollFnRef.current?.()
  })

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const id = params?.task_id
    const type = normalizeTaskType(params?.task_type)
    const modeFromStorage = Taro.getStorageSync('analyzeExecutionMode')
    const mode = normalizeExecutionMode(params?.execution_mode || modeFromStorage)

    const isDebug = id?.startsWith('debug-') || false
    setIsDebugMode(isDebug)

    if (!id) {
      Taro.showToast({ title: '缺少任务 ID', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 1500)
      return
    }
    setTaskId(id)
    setTaskType(type)
    setExecutionMode(mode)
    Taro.setStorageSync('analyzeExecutionMode', mode)
    Taro.setStorageSync('analyzeTaskType', type)
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

  // 步骤动画 - 循环展示分析进度
  useEffect(() => {
    if (status !== 'loading') return

    // 步骤循环：每2.5秒推进一个步骤，完成后再回到第1步循环
    stepTimerRef.current = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= 3) {
          // 完成一轮后重置
          return 1
        }
        return prev + 1
      })
    }, 2500)

    return () => {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current)
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
        const taskMode = pickExecutionModeFromTask(task)
        if (taskMode) {
          setExecutionMode(taskMode)
          Taro.setStorageSync('analyzeExecutionMode', taskMode)
        }
        if (task.status === 'done' && task.result) {
          const exResult = task.result as ExerciseTaskResultPayload | undefined
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
            if (tipTimerRef.current) {
              clearInterval(tipTimerRef.current)
              tipTimerRef.current = null
            }
            Taro.removeStorageSync(EXERCISE_PENDING_TASK_KEY)
            const kcal = exResult.estimated_calories ?? exResult.exercise_log.calories_burned
            Taro.showToast({ title: `已记录 ${kcal} kcal`, icon: 'success' })
            Taro.redirectTo({ url: '/pages/exercise-record/index' })
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
          Taro.removeStorageSync('analyzePendingCorrectionTaskId')
          Taro.removeStorageSync('analyzePendingCorrectionItems')
          const result = task.result as AnalyzeResponse
          const payload = task.payload || {}
          const settledMode = taskMode || executionMode
          Taro.setStorageSync('analyzeExecutionMode', settledMode)

          if (taskType === 'food_text') {
            Taro.removeStorageSync('analyzeImagePath')
            Taro.removeStorageSync('analyzeImagePaths')
            Taro.setStorageSync('analyzeTextInput', task.text_input || '')
            Taro.setStorageSync('analyzeTextAdditionalContext', (payload.additionalContext as string) || '')
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            Taro.setStorageSync('analyzeMealType', payload.meal_type || 'breakfast')
            Taro.setStorageSync('analyzeDietGoal', payload.diet_goal || 'none')
            Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing || 'none')
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.setStorageSync('analyzeTaskType', 'food_text')
            Taro.redirectTo({ url: '/pages/result/index' })
          } else {
            Taro.removeStorageSync('analyzeTextInput')
            Taro.removeStorageSync('analyzeTextAdditionalContext')
            Taro.setStorageSync('analyzeImagePath', task.image_url)
            Taro.setStorageSync('analyzeImagePaths', task.image_paths || (task.image_url ? [task.image_url] : []))
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            Taro.setStorageSync('analyzeMealType', payload.meal_type || 'breakfast')
            Taro.setStorageSync('analyzeDietGoal', payload.diet_goal || 'none')
            Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing || 'none')
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.setStorageSync('analyzeTaskType', 'food')
            Taro.redirectTo({ url: '/pages/result/index' })
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
            Taro.redirectTo({ url: '/pages/exercise-record/index' })
          }
        }
      })
      return
    }
    Taro.showModal({
      title: '稍后查看',
      content: '分析将在后台继续，完成后可在「分析历史」中查看结果。',
      showCancel: true,
      confirmText: '去历史',
      success: res => {
        if (res.confirm) {
          Taro.redirectTo({ url: '/pages/analyze-history/index' })
        }
      }
    })
  }

  const handleGoHistory = () => {
    Taro.redirectTo({ url: '/pages/analyze-history/index' })
  }

  // 判断步骤状态: 0=已完成, 1=进行中, 2=待进行
  const getStepStatus = (stepIndex: number): 'done' | 'active' | 'pending' => {
    if (stepIndex < currentStep) return 'done'
    if (stepIndex === currentStep) return 'active'
    return 'pending'
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
          <Text className='btn-history' onClick={handleGoHistory}>返回分析历史</Text>
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
                ? Taro.redirectTo({ url: '/pages/exercise-record/index' })
                : handleGoHistory()
            }
          >
            {taskType === 'exercise' ? '返回记运动' : '去分析历史'}
          </Text>
          <Text className='ai-notice'> 食探 - 您的智能健康管理助手</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='analyze-loading-page-v3'>
      {/* 全屏背景：与刚拍摄/选中的图为同一张 */}
      {imagePath ? (
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
          {(taskType === 'exercise' ? EXERCISE_ANALYSIS_STEPS : ANALYSIS_STEPS).map((step, index) => {
            const stepStatus = getStepStatus(index)
            return (
              <View key={step.id} className={`analysis-step ${stepStatus}`}>
                <View className='step-left'>
                  <View className='step-status-icon'>
                    {stepStatus === 'done' ? (
                      <Text className='status-check'>✓</Text>
                    ) : stepStatus === 'active' ? (
                      <View className='status-spinner' />
                    ) : (
                      <Text className='status-pending'>○</Text>
                    )}
                  </View>
                  <View className='step-text-wrap'>
                    <Text className='step-title-v3'>{step.title}</Text>
                    <Text className='step-desc-v3'>{step.desc}</Text>
                  </View>
                </View>
              </View>
            )
          })}
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
