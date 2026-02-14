import { View, Text } from '@tarojs/components'
import { useState, useEffect, useRef } from 'react'
import Taro from '@tarojs/taro'
import { getAnalyzeTask, type AnalysisTask, type AnalyzeResponse } from '../../utils/api'
import './index.scss'
// 建议
const HEALTH_TIPS = [
  '吃饭顺序有讲究：先吃蔬菜，再吃蛋白质，最后吃碳水，可以有效平稳血糖。',
  '每一口食物咀嚼 20-30 次，不仅助消化，还能提升饱腹感，减少过量进食。',
  '餐前 30 分钟喝一杯水，可以激活新陈代谢，并自然减少正餐摄入量。',
  '早餐摄入 30g 蛋白质（如鸡蛋、牛奶），可以防止午餐前的饥饿感和对甜食的渴望。',
  '深色蔬菜（如菠菜、紫甘蓝）通常比浅色蔬菜含有更多的抗氧化剂和微量元素。',
  '尽量在睡前 3 小时停止进食，让肠胃有充分的时间休息和修复。',
  '运动后 30 分钟内补充蛋白质+碳水，有助于肌肉恢复与合成。',
  '少食多餐有助于稳定血糖，避免暴饮暴食。'
]

const POLL_INTERVAL = 2000
const TIP_ROTATE_INTERVAL = 3000

export default function AnalyzeLoadingPage() {
  const [taskId, setTaskId] = useState<string>('')
  const [taskType, setTaskType] = useState<string>('food') // food 或 food_text
  const [status, setStatus] = useState<'loading' | 'done' | 'failed' | 'violated'>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [violationReason, setViolationReason] = useState<string>('')
  const [tipIndex, setTipIndex] = useState(0)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const id = params?.task_id
    const type = params?.task_type || 'food'
    if (!id) {
      Taro.showToast({ title: '缺少任务 ID', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 1500)
      return
    }
    setTaskId(id)
    setTaskType(type)
  }, [])

  useEffect(() => {
    if (!taskId || status !== 'loading') return
    const poll = async () => {
      try {
        const task: AnalysisTask = await getAnalyzeTask(taskId)
        if (task.status === 'done' && task.result) {
          setStatus('done')
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
          const result = task.result as AnalyzeResponse
          const payload = task.payload || {}

          // 根据任务类型跳转到不同的结果页面
          if (taskType === 'food_text') {
            // 文字分析：跳转到统一的结果页（复用图片分析页）
            Taro.removeStorageSync('analyzeImagePath') // 确保清除上一张图片
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            Taro.setStorageSync('analyzeMealType', payload.meal_type || 'breakfast')
            Taro.setStorageSync('analyzeDietGoal', payload.diet_goal || 'none')
            Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing || 'none')
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.redirectTo({ url: '/pages/result/index' })
          } else {
            // 图片分析：跳转到图片分析结果页
            Taro.setStorageSync('analyzeImagePath', task.image_url)
            Taro.setStorageSync('analyzeImagePaths', task.image_paths || (task.image_url ? [task.image_url] : []))
            Taro.setStorageSync('analyzeResult', JSON.stringify(result))
            Taro.setStorageSync('analyzeCompareMode', false)
            Taro.setStorageSync('analyzeMealType', payload.meal_type || 'breakfast')
            Taro.setStorageSync('analyzeDietGoal', payload.diet_goal || 'none')
            Taro.setStorageSync('analyzeActivityTiming', payload.activity_timing || 'none')
            Taro.setStorageSync('analyzeSourceTaskId', taskId)
            Taro.redirectTo({ url: '/pages/result/index' })
          }
          return
        }
        if (task.status === 'failed') {
          setStatus('failed')
          setErrorMessage(task.error_message || '识别失败')
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
        }
        // 检测违规状态
        if (task.status === 'violated' || task.is_violated) {
          setStatus('violated')
          setViolationReason(task.violation_reason || '内容违规')
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
        }
      } catch (e: any) {
        console.error('轮询任务失败:', e)
      }
    }
    poll()
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL)
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [taskId, taskType, status])

  useEffect(() => {
    if (status !== 'loading') return
    tipTimerRef.current = setInterval(() => {
      setTipIndex(i => (i + 1) % HEALTH_TIPS.length)
    }, TIP_ROTATE_INTERVAL)
    return () => {
      if (tipTimerRef.current) clearInterval(tipTimerRef.current)
    }
  }, [status])

  const handleLeave = () => {
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

  if (status === 'violated') {
    return (
      <View className="analyze-loading-page">
        <View className="violated-wrap">
          <View className="violated-icon-wrap">
            <Text className="iconfont icon-jinggao" style={{ fontSize: '80rpx', color: '#dc2626' }} />
          </View>
          <Text className="violated-title">内容审核未通过</Text>
          <Text className="violated-reason">{violationReason}</Text>
          <Text className="violated-hint">您提交的内容不符合平台使用规范，请确保上传与食物相关的图片或文字描述。</Text>
          <Text className="btn-history" onClick={handleGoHistory}>返回分析历史</Text>
        </View>
      </View>
    )
  }

  if (status === 'failed') {
    return (
      <View className="analyze-loading-page">
        <View className="error-wrap">
          <Text className="error-msg">识别失败：{errorMessage}</Text>
          <Text className="btn-history" onClick={handleGoHistory}>去分析历史</Text>
        </View>
      </View>
    )
  }

  return (
    <View className="analyze-loading-page">
      <View className="spinner-wrap">
        <View className="ring" />
        <View className="spin" />
        <Text className="icon-center iconfont icon-shiwu" />
      </View>
      <Text className="title">
        {taskType === 'food_text' ? 'AI 文字分析中...' : 'AI 视觉识别中...'}
      </Text>
      <Text className="subtitle">正在智能分析您的餐食</Text>
      <View className="tip-card">
        <View className="tip-header">
          <Text className="tip-icon iconfont icon-dengpao" />
          <Text className="tip-label">健身小知识</Text>
        </View>
        <Text className="tip-text">{HEALTH_TIPS[tipIndex]}</Text>
      </View>
      <View className="actions-wrap">
        <Text className="leave-hint">无需一直等待，您可以先离开。分析完成后在「分析历史」中查看结果即可。</Text>
        <View className="btn-leave" onClick={handleLeave}>
          <Text className="iconfont icon-shizhong" style={{ marginRight: 6, fontSize: 16 }} />
          <Text>先离开，稍后查看</Text>
        </View>
      </View>
    </View>
  )
}
