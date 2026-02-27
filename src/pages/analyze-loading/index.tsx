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
  '少食多餐有助于稳定血糖，避免暴饮暴食。',
  '减脂期的重点是“制造热量缺口”，而非盲目节食，保证基础代谢很重要。',
  '全谷物（如燕麦、糙米）含有更多膳食纤维，能提供更持久的能量和饱腹感。',
  '规律的阻力训练不仅能增加肌肉量，还能提高静息代谢率，让你“躺着也消耗热量”。',
  '睡眠不足会导致体内皮质醇水平升高，增加食欲并更容易囤积脂肪。',
  '选择健康的油脂（如橄榄油、牛油果、坚果），对心血管健康和吸收脂溶性维生素至关重要。',
  '喝黑咖啡能在一定程度上提高代谢，并在运动前提供额外的充沛精力。',
  '想要更出色的腹肌，光靠卷腹不够，还需要配合减脂和全身核心训练。',
  '水果虽好，但含有果糖，减脂期建议适量食用，并选择低GI（升糖指数）的水果如苹果、草莓。',
  '快走和慢跑都是极佳的低强度有氧运动，有助于改善心肺功能和加速脂肪燃烧。',
  '力量训练后的拉伸可以缓解肌肉酸痛，增加柔韧性，同时预防运动损伤。',
  '适量补充维生素D对骨骼健康和免疫系统有益，尤其在缺乏日照的冬季。',
  '晚餐尽量清淡易消化，减少高盐高油食物的摄入，以免影响睡眠质量。',
  '久坐一族每隔一小时最好起身活动 3-5 分钟，有助于改善血液循环。',
  '用白开水或淡茶代替含糖饮料，是减少每日无形热量摄入的最简单方法。',
  '保持良好的体态（如不驼背）能让呼吸更顺畅，也有助于调动核心肌群。',
  '偶尔吃一顿“欺骗餐（Cheat meal）”可以帮助缓解心理压力，并可能利于打破减脂平台期。',
  '慢速进食不仅帮助大脑更好接收“吃饱了”的信号，还能让你更享受食物的美味。',
  '“少油少盐”不代表“无油无盐”，适量摄入盐分（钠）对维持身体水分平衡很重要。',
  '无氧运动和有氧运动结合，往往能达到最佳的减脂塑型效果。',
  '每周安排 1-2 天的休息日（Rest day），让身体有时间从运动疲劳中恢复。',
  '“局部减脂”是一个伪命题，脂肪的减少通常是全身性的。',
  '吃富含 Omega-3 的食物（如三文鱼、亚麻籽），有助于抗炎和改善认知功能。',
  '压力过大容易引发情绪性进食（Emotional eating），学会用运动或冥想来释放压力。',
  '重视每一顿饭的搭配：碳水提供能量，蛋白质修补身体，脂肪合成激素，缺一不可。',
  '运动时选择透气吸汗的装备，可以提升运动表现和带来更好的体验。',
  '对于初学者，掌握正确的动作发力比追求更大的重量重要得多。',
  '碳酸饮料即使是无糖的（代糖），也可能增加对甜食的渴望，建议适度饮用。',
  '更换小号的餐盘，可以在视觉上让你觉得吃得很多，帮助自然减少食量。',
  '酸奶是良好的益生菌来源，但购买时需警惕配料表中隐藏的添加糖。',
  '记录饮食习惯（如拍照或记笔记）能让你更直观地认识到自己的摄入情况，提高自控力。',
  '运动不仅改变身材，更分泌被称为“快乐荷尔蒙”的内啡肽，提升整体幸福感。',
  '冬季运动热身需要花更多时间，让关节和肌肉充分准备好以防拉伤。',
  '日常爬楼梯代替坐电梯，是增加日常活动消耗（NEAT）的好方法。',
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
    // 如果已经展示完毕全部提示，就清空历史，重新开始（保留当前的避免立刻重复）
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
const TIP_ROTATE_INTERVAL = 3000

export default function AnalyzeLoadingPage() {
  const [taskId, setTaskId] = useState<string>('')
  const [taskType, setTaskType] = useState<string>('food') // food 或 food_text
  const [status, setStatus] = useState<'loading' | 'done' | 'failed' | 'violated'>('loading')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [violationReason, setViolationReason] = useState<string>('')
  const [tipIndex, setTipIndex] = useState(() => getNextTipIndex())
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
      setTipIndex(i => getNextTipIndex(i))
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
          <Text className="ai-notice">本服务由人工智能提供分析，生成内容仅供参考</Text>
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
          <Text className="ai-notice">本服务由人工智能提供分析，生成内容仅供参考</Text>
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
        <Text className="ai-notice">本服务由人工智能提供分析，生成内容仅供参考</Text>
      </View>
    </View>
  )
}
