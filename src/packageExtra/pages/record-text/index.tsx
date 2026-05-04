import { View, Text, Textarea, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { getAccessToken, submitTextAnalyzeTask, getMyMembership, ANALYSIS_SUBSCRIBE_TEMPLATE_ID, type CanonicalMealType, type MembershipStatus } from '../../../utils/api'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import {
  getFoodAnalysisBlockedActionText,
  getFoodAnalysisCreditBlockMessage,
  getMembershipCreditSummary,
  isFoodAnalysisCreditExhausted,
} from '../../../utils/membership'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getStoredRecordTargetDate, persistRecordTargetDate } from '../../../utils/record-date'
import './index.scss'

const MEALS: Array<{ id: CanonicalMealType; name: string; icon: string }> = [
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
  const [selectedMeal, setSelectedMeal] = useState(() => inferDefaultMealTypeFromLocalTime())
  const [dietGoal, setDietGoal] = useState('none')
  const [activityTiming, setActivityTiming] = useState('none')
  const [loading, setLoading] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const { hasInfo: hasCreditsInfo, max: creditsMax, used: creditsUsed, remaining: creditsRemaining } =
    getMembershipCreditSummary(membershipStatus)

  const isQuotaExhausted = isFoodAnalysisCreditExhausted(membershipStatus)

  const refreshMembership = () => {
    if (getAccessToken()) {
      getMyMembership().then(setMembershipStatus).catch(() => {})
    }
  }

  useDidShow(() => {
    refreshMembership()
  })

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    persistRecordTargetDate(String(params?.date || ''))
    refreshMembership()
  }, [])

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

    if (isQuotaExhausted) {
      const content = getFoodAnalysisCreditBlockMessage(membershipStatus)
      const confirmText = getFoodAnalysisBlockedActionText(membershipStatus)
      const showUpgrade = content.includes('开通') || content.includes('升级') || membershipStatus?.is_pro
      Taro.showModal({
        title: '积分不足',
        content,
        showCancel: showUpgrade,
        confirmText: showUpgrade ? confirmText : '知道了',
        cancelText: '取消',
        success: (res) => {
          if (showUpgrade && res.confirm) {
            Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
          }
        }
      })
      return
    }

    // 配额兜底（与按钮禁用一致，防止并发）
    try {
      const membership = await getMyMembership()
      setMembershipStatus(membership)
      if (isFoodAnalysisCreditExhausted(membership)) {
        const content = getFoodAnalysisCreditBlockMessage(membership)
        const confirmText = getFoodAnalysisBlockedActionText(membership)
        const showUpgrade = content.includes('开通') || content.includes('升级') || membership.is_pro
        Taro.showModal({
          title: '积分不足',
          content,
          confirmText: showUpgrade ? confirmText : '知道了',
          cancelText: '取消',
          showCancel: showUpgrade,
          success: (res) => {
            if (showUpgrade && res.confirm) {
              Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
            }
          }
        })
        return
      }
    } catch {
      // 继续执行
    }

    let inputText = trimmed
    if (foodAmount.trim()) inputText += `\n数量：${foodAmount.trim()}`

    // 请求订阅消息授权
    let subscribeStatus: string | undefined
    if (ANALYSIS_SUBSCRIBE_TEMPLATE_ID) {
      try {
        const subscribeRes = await (Taro as any).requestSubscribeMessage({
          tmplIds: [ANALYSIS_SUBSCRIBE_TEMPLATE_ID],
        })
        subscribeStatus = String((subscribeRes as any)?.[ANALYSIS_SUBSCRIBE_TEMPLATE_ID] || '')
      } catch (_) {
        // 静默失败
      }
    }

    setLoading(true)
    Taro.showLoading({ title: '提交任务中...', mask: true })

    try {
      // 避免沿用上一次拍照分析残留在 storage 中的图，loading 与结果页需与「文字记录」一致
      Taro.removeStorageSync('analyzeImagePath')
      Taro.removeStorageSync('analyzeImagePaths')
      Taro.setStorageSync('analyzeTextInput', inputText)
      const { task_id } = await submitTextAnalyzeTask({
        text: inputText,
        date: getStoredRecordTargetDate(),
        meal_type: selectedMeal as any,
        diet_goal: dietGoal as any,
        activity_timing: activityTiming as any,
        subscribe_status: subscribeStatus,
      })
      Taro.hideLoading()
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${task_id}&task_type=food_text`
      })
    } catch (e: any) {
      Taro.hideLoading()
      const statusCode = (e as { statusCode?: number })?.statusCode
      const errMsg = e?.message || '提交任务失败'
      const isQuota =
        statusCode === 402 ||
        statusCode === 429 ||
        errMsg.includes('上限') ||
        errMsg.includes('已达上限') ||
        errMsg.includes('次数已达') ||
        errMsg.includes('明日再试') ||
        errMsg.includes('积分不足')
      if (isQuota) {
        const suggestPro = errMsg.includes('开通') || errMsg.includes('会员') || errMsg.includes('升级')
        Taro.showModal({
          title: '积分不足',
          content: errMsg,
          confirmText: suggestPro ? getFoodAnalysisBlockedActionText(membershipStatus) : '知道了',
          cancelText: '取消',
          showCancel: suggestPro,
          success: (res) => {
            if (suggestPro && res.confirm) Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
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
            if (!membershipStatus.is_pro) Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
          }}
        >
          <Text className='record-text-quota-bar-text'>
            {isQuotaExhausted
              ? getFoodAnalysisCreditBlockMessage(membershipStatus)
              : hasCreditsInfo
                ? `今日已用 ${creditsUsed}/${creditsMax} 积分 · 剩余 ${creditsRemaining}${!membershipStatus.is_pro ? '  →开通会员享更高额度' : ''}`
                : `今日积分信息加载中${!membershipStatus.is_pro ? '  →开通会员享更高额度' : ''}`}
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
          <Text>{loading ? '分析中...' : isQuotaExhausted ? '积分不足，暂不可分析' : '开始智能分析'}</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(RecordTextPage)
