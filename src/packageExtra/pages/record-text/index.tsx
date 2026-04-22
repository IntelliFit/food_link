import { View, Text, Textarea, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { getAccessToken, submitTextAnalyzeTask, getMyMembership, type MembershipStatus } from '../../../utils/api'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
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
  const { scheme } = useAppColorScheme()
  const [foodText, setFoodText] = useState('')
  const [foodAmount, setFoodAmount] = useState('')
  const [selectedMeal, setSelectedMeal] = useState(() => inferDefaultMealTypeFromLocalTime())
  const [dietGoal, setDietGoal] = useState('none')
  const [activityTiming, setActivityTiming] = useState('none')
  const [loading, setLoading] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)

  const pointsMode = Boolean(membershipStatus && typeof membershipStatus.points_balance === 'number')
  const isQuotaExhausted = Boolean(
    membershipStatus &&
      (pointsMode
        ? (membershipStatus.points_balance as number) < 1
        : membershipStatus.daily_limit != null &&
          membershipStatus.daily_remaining !== null &&
          membershipStatus.daily_remaining <= 0)
  )

  const refreshMembership = () => {
    if (getAccessToken()) {
      getMyMembership().then(setMembershipStatus).catch(() => {})
    }
  }

  useDidShow(() => {
    refreshMembership()
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  })

  useEffect(() => {
    refreshMembership()
  }, [])

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  }, [scheme])

  const commonFoods = ['米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包']

  const handleSubmit = async () => {
    const trimmed = foodText.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入食物描述', icon: 'none' })
      return
    }

    if (!getAccessToken()) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/login/index') })
      return
    }

    if (isQuotaExhausted) {
      if (pointsMode) {
        Taro.showModal({
          title: '积分不足',
          content: '标准分析需至少 1 积分，请先充值。',
          confirmText: '去充值',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
          }
        })
      } else {
        Taro.showModal({
          title: '今日次数已用完',
          content: '今日拍照/文字分析次数已达上限，请明日再试。',
          showCancel: false,
          confirmText: '知道了'
        })
      }
      return
    }

    // 配额兜底（与按钮禁用一致，防止并发）
    try {
      const membership = await getMyMembership()
      if (typeof membership.points_balance === 'number') {
        if (membership.points_balance < 1) {
          Taro.showModal({
            title: '积分不足',
            content: '标准分析需至少 1 积分，请先充值。',
            confirmText: '去充值',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
            }
          })
          return
        }
      } else if (membership.daily_remaining !== null && membership.daily_remaining <= 0) {
        const isPro = membership.is_pro
        const limit = membership.daily_limit ?? 30
        Taro.showModal({
          title: '今日次数已用完',
          content: isPro
            ? `今日 ${limit} 次分析已用完，请明日再试。`
            : `免费版每日限 ${limit} 次，开通食探会员可享更高额度与精准模式等功能。`,
          confirmText: isPro ? '知道了' : '去开通',
          cancelText: '取消',
          showCancel: !isPro,
          success: (res) => {
            if (!isPro && res.confirm) {
              Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
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
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${task_id}&task_type=food_text`
      })
    } catch (e: any) {
      Taro.hideLoading()
      const statusCode = (e as { statusCode?: number })?.statusCode
      const errMsg = e?.message || '提交任务失败'
      const isPointsShort = statusCode === 400 && errMsg.includes('积分')
      const isQuota =
        isPointsShort ||
        statusCode === 429 ||
        errMsg.includes('上限') ||
        errMsg.includes('已达上限') ||
        errMsg.includes('次数已达') ||
        errMsg.includes('明日再试')
      if (isQuota) {
        const suggestRecharge = isPointsShort || errMsg.includes('积分')
        const suggestPro = !suggestRecharge && (errMsg.includes('开通') || errMsg.includes('会员'))
        Taro.showModal({
          title: suggestRecharge ? '积分不足' : '今日次数已用完',
          content: errMsg,
          confirmText: suggestRecharge ? '去充值' : suggestPro ? '去开通会员' : '知道了',
          cancelText: '取消',
          showCancel: suggestRecharge || suggestPro,
          success: (res) => {
            if (res.confirm) {
              if (suggestRecharge || suggestPro) {
                Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
              }
            }
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
      {membershipStatus && (
        <View
          className={`record-text-quota-bar ${isQuotaExhausted ? 'record-text-quota-bar--exhausted' : ''}`}
          onClick={() => {
            if (isQuotaExhausted) return
            Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
          }}
        >
          <Text className='record-text-quota-bar-text'>
            {pointsMode
              ? isQuotaExhausted
                ? '积分不足，无法发起分析（标准需 1 分），请先充值'
                : `积分余额 ${(membershipStatus.points_balance as number).toFixed(1)} · 标准 1 / 精准 2 / 运动 0.5${
                    (membershipStatus.points_balance as number) < 2 ? '  →充值后可用精准' : ''
                  }`
              : isQuotaExhausted
                ? '今日拍照/文字分析次数已用尽，请明日再试'
                : `今日剩余 ${membershipStatus.daily_remaining ?? '--'}/${membershipStatus.daily_limit ?? '--'} 次${
                    !membershipStatus.is_pro ? '  →开通会员享更高额度' : ''
                  }`}
          </Text>
        </View>
      )}
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
          className={`submit-btn ${!foodText.trim() || loading || isQuotaExhausted ? 'disabled' : ''}`}
          onClick={handleSubmit}
        >
          <Text>{loading ? '分析中...' : isQuotaExhausted ? '今日次数已用完' : '开始智能分析'}</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(RecordTextPage)
