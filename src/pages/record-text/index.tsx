import { View, Text, Textarea, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import { getAccessToken, submitTextAnalyzeTask, getMyMembership } from '../../utils/api'
import { withAuth } from '../../utils/withAuth'
import './index.scss'

const MEALS = [
  { id: 'breakfast', name: '早餐', icon: 'icon-zaocan' },
  { id: 'morning_snack', name: '早加餐', icon: 'icon-lingshi' },
  { id: 'lunch', name: '午餐', icon: 'icon-wucan' },
  { id: 'afternoon_snack', name: '午加餐', icon: 'icon-lingshi' },
  { id: 'dinner', name: '晚餐', icon: 'icon-wancan' },
  { id: 'evening_snack', name: '晚加餐', icon: 'icon-lingshi' },
]

const DIET_GOALS = [
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无' },
]

const ACTIVITY_TIMINGS = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' },
]

function RecordTextPage() {
  const [foodText, setFoodText] = useState('')
  const [foodAmount, setFoodAmount] = useState('')
  const [selectedMeal, setSelectedMeal] = useState('breakfast')
  const [dietGoal, setDietGoal] = useState('none')
  const [activityTiming, setActivityTiming] = useState('none')
  const [loading, setLoading] = useState(false)

  const commonFoods = ['米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包']

  const handleSubmit = async () => {
    const trimmed = foodText.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入食物描述', icon: 'none' })
      return
    }

    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }

    // 配额检查
    try {
      const membership = await getMyMembership()
      if (membership.daily_remaining !== null && membership.daily_remaining <= 0) {
        const isPro = membership.is_pro
        Taro.showModal({
          title: '今日次数已用完',
          content: isPro
            ? `今日 ${membership.daily_limit ?? 10} 次分析已用完，请明日再试。`
            : '免费版每日限10次，开通食探会员可解锁精准模式等功能。',
          confirmText: isPro ? '知道了' : '去开通',
          cancelText: '取消',
          showCancel: !isPro,
          success: (res) => {
            if (!isPro && res.confirm) {
              Taro.navigateTo({ url: '/pages/pro-membership/index' })
            }
          }
        })
        return
      }
    } catch {
      // 继续执行
    }

    const { confirm } = await Taro.showModal({
      title: '确认分析',
      content: '确定根据当前描述开始计算营养分析吗？'
    })
    if (!confirm) return

    let inputText = trimmed
    if (foodAmount.trim()) inputText += `\n数量：${foodAmount.trim()}`

    setLoading(true)
    Taro.showLoading({ title: '提交任务中...', mask: true })

    try {
      // 避免沿用上一次拍照分析残留在 storage 中的图，loading 与结果页需与「文字记录」一致
      Taro.removeStorageSync('analyzeImagePath')
      Taro.removeStorageSync('analyzeImagePaths')
      Taro.setStorageSync('analyzeTextInput', inputText)
      const { task_id } = await submitTextAnalyzeTask({
        text: inputText,
        meal_type: selectedMeal as any,
        diet_goal: dietGoal as any,
        activity_timing: activityTiming as any
      })
      Taro.hideLoading()
      Taro.navigateTo({
        url: `/pages/analyze-loading/index?task_id=${task_id}&task_type=food_text`
      })
    } catch (e: any) {
      Taro.hideLoading()
      const errMsg = e?.message || '提交任务失败'
      if (e?.statusCode === 429 || errMsg.includes('上限')) {
        Taro.showModal({
          title: '今日次数已用完',
          content: errMsg,
          confirmText: '去开通会员',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) Taro.navigateTo({ url: '/pages/pro-membership/index' })
          }
        })
      } else {
        Taro.showToast({ title: errMsg, icon: 'none' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='record-text-page'>
      <ScrollView className='content-scroll' scrollY>
        {/* 输入区域 */}
        <View className='input-section'>
          <Text className='section-title'>描述您的饮食</Text>
          <View className='input-card'>
            <Textarea
              className='food-textarea'
              placeholder='今天吃了什么？例如：&#10;• 一碗红烧牛肉面&#10;• 一个苹果'
              placeholderClass='textarea-placeholder'
              value={foodText}
              onInput={(e) => setFoodText(e.detail.value)}
              maxlength={500}
              autoHeight
            />
            <Text className='char-count'>{foodText.length}/500</Text>
          </View>
          
          {/* 快捷标签 */}
          <View className='quick-tags'>
            <Text className='tags-label'>常用：</Text>
            <View className='tags-row'>
              {commonFoods.map((food) => (
                <View
                  key={food}
                  className='tag-item'
                  onClick={() => setFoodText(prev => prev ? `${prev}、${food}` : food)}
                >
                  <Text>{food}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* 份量补充 */}
        <View className='input-section'>
          <Text className='section-title'>补充份量（可选）</Text>
          <View className='input-card'>
            <Textarea
              className='amount-textarea'
              placeholder='例如：200g；或一碗、半份'
              placeholderClass='textarea-placeholder'
              value={foodAmount}
              onInput={(e) => setFoodAmount(e.detail.value)}
              maxlength={200}
              autoHeight
            />
          </View>
        </View>

        {/* 餐次选择 */}
        <View className='input-section'>
          <Text className='section-title'>选择餐次</Text>
          <View className='meal-selector'>
            {MEALS.map((meal) => (
              <View
                key={meal.id}
                className={`meal-item ${selectedMeal === meal.id ? 'active' : ''}`}
                onClick={() => setSelectedMeal(meal.id)}
              >
                <Text className={`iconfont ${meal.icon} meal-icon`} />
                <Text className='meal-name'>{meal.name}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 饮食目标 */}
        <View className='input-section'>
          <Text className='section-title'>饮食目标</Text>
          <View className='option-selector'>
            {DIET_GOALS.map((goal) => (
              <View
                key={goal.value}
                className={`option-item ${dietGoal === goal.value ? 'active' : ''}`}
                onClick={() => setDietGoal(goal.value)}
              >
                <Text>{goal.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 运动时机 */}
        <View className='input-section'>
          <Text className='section-title'>运动时机</Text>
          <View className='option-selector'>
            {ACTIVITY_TIMINGS.map((timing) => (
              <View
                key={timing.value}
                className={`option-item ${activityTiming === timing.value ? 'active' : ''}`}
                onClick={() => setActivityTiming(timing.value)}
              >
                <Text>{timing.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='bottom-space' />
      </ScrollView>

      {/* 底部按钮 */}
      <View className='bottom-bar'>
        <View
          className={`submit-btn ${!foodText.trim() || loading ? 'disabled' : ''}`}
          onClick={handleSubmit}
        >
          <Text>{loading ? '分析中...' : '开始智能分析'}</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(RecordTextPage)
