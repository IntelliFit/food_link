import { View, Text, Textarea, ScrollView } from '@tarojs/components'
import { useState, useEffect, useRef } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  getAccessToken,
  getHealthProfile,
  submitTextAnalyzeTask,
  getMyMembership,
  type CanonicalMealType,
  type MembershipStatus,
  type AnalysisEngine,
  type EatingMood,
  type ExecutionMode,
} from '../../../utils/api'
import {
  getRecommendedMealTypeWithFallback,
  inferDefaultMealTypeFromLocalTime,
} from '../../../utils/infer-default-meal-type'
import {
  getFoodAnalysisCreditBlockMessage,
  getMembershipCreditSummary,
  getFoodAnalysisCreditStatusForDate,
  isFoodAnalysisCreditExhausted,
} from '../../../utils/membership'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getTodayRecordDateKey, requireAllowedRecordDate } from '../../../utils/record-date'
import CreditShortageSheet from '../../../components/CreditShortageSheet'
import EatingMoodPicker from '../../../components/EatingMoodPicker'
import { SUBMIT_ANALYSIS_ENGINE } from '../../../utils/analysis-engine'
import { loadAnalyzeNutritionBudget } from '../../../utils/analyze-nutrition-budget'
import { captureAuthSession, isAuthSessionCurrent, type AuthSession } from '../../../utils/auth-session'
import { useRecordDate } from '../../../hooks/useRecordDate'
import RecordDateField from '../../../components/RecordDateField'
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

const SUGGEST_RATIO_STORAGE_KEY = 'analyzeSuggestRatioEnabled'

const readSuggestRatioPreference = (): boolean => {
  const saved = Taro.getStorageSync(SUGGEST_RATIO_STORAGE_KEY)
  if (saved === false || saved === '0' || saved === 'false') return false
  if (saved === true || saved === '1' || saved === 'true') return true
  return true
}

function RecordTextPage() {
  const [recordDate, setRecordDate] = useRecordDate(String(Taro.getCurrentInstance().router?.params?.date || getTodayRecordDateKey()))
  const mealTypeChosenRef = useRef(false)
  const dietGoalChosenRef = useRef(false)
  const visibleRef = useRef(true)
  const mountedRef = useRef(true)
  const [foodText, setFoodText] = useState(() => String(Taro.getCurrentInstance().router?.params?.text || ''))
  const [foodAmount, setFoodAmount] = useState('')
  const [selectedMeal, setSelectedMeal] = useState(() => inferDefaultMealTypeFromLocalTime())
  const [dietGoal, setDietGoal] = useState('none')
  const [activityTiming, setActivityTiming] = useState('none')
  const [eatingMood, setEatingMood] = useState<EatingMood | null>(null)
  const analysisEngine: AnalysisEngine = SUBMIT_ANALYSIS_ENGINE
  const executionMode: ExecutionMode = 'standard'
  const [showAdvanced, setShowAdvanced] = useState(false)
  const submitLock = useRef(false)
  const [loading, setLoading] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [membershipCreditDate, setMembershipCreditDate] = useState('')
  const [membershipCreditOwner, setMembershipCreditOwner] = useState<AuthSession | null>(null)
  const [targetDateStatus, setTargetDateStatus] = useState<{ date: string; status: MembershipStatus; owner: AuthSession } | null>(null)
  const [creditSheet, setCreditSheet] = useState<{ visible: boolean; message?: string; status?: MembershipStatus | null }>({
    visible: false,
    status: null,
  })
  const { hasInfo: hasCreditsInfo, max: creditsMax, used: creditsUsed, remaining: creditsRemaining } =
    getMembershipCreditSummary(membershipStatus)

  const recordTargetDate = recordDate
  const isBackfill = recordTargetDate !== getTodayRecordDateKey()
  const creditStatus = getFoodAnalysisCreditStatusForDate(
    membershipCreditDate === getTodayRecordDateKey() && membershipCreditOwner && isAuthSessionCurrent(membershipCreditOwner) ? membershipStatus : null,
    targetDateStatus?.date === recordTargetDate && isAuthSessionCurrent(targetDateStatus.owner) ? targetDateStatus.status : null, isBackfill,
  )
  const isQuotaExhausted = isFoodAnalysisCreditExhausted(creditStatus)

  const refreshMembership = () => {
    const owner = captureAuthSession()
    if (owner.token) {
      const requestedToday = getTodayRecordDateKey()
      getMyMembership().then(status => {
        if (mountedRef.current && isAuthSessionCurrent(owner)) {
          setMembershipStatus(status)
          setMembershipCreditDate(requestedToday)
          setMembershipCreditOwner(owner)
        }
      }).catch(() => {})
      const targetDate = recordDate
      if (targetDate !== getTodayRecordDateKey()) {
        getMyMembership(targetDate).then(status => {
          if (mountedRef.current && isAuthSessionCurrent(owner)) setTargetDateStatus({ date: targetDate, status, owner })
        }).catch(() => {})
      } else {
        setTargetDateStatus(null)
      }
    }
  }

  useDidShow(() => {
    visibleRef.current = true
    refreshMembership()
  })
  useDidHide(() => {
    visibleRef.current = false
    if (submitLock.current) Taro.hideLoading()
  })

  useEffect(() => {
    mountedRef.current = true
    const owner = captureAuthSession()
    // The page owns its target date; another page cannot change it through storage.
    refreshMembership()
    ;(async () => {
      try {
        const profile = getAccessToken() ? await getHealthProfile() : null
        const inferredMealType = await getRecommendedMealTypeWithFallback({ profile })
        if (!mountedRef.current || !isAuthSessionCurrent(owner)) return
        if (!mealTypeChosenRef.current) setSelectedMeal(inferredMealType)
      } catch {
        if (!mountedRef.current || !isAuthSessionCurrent(owner)) return
        if (!mealTypeChosenRef.current) setSelectedMeal(inferDefaultMealTypeFromLocalTime())
      }
    })()
    return () => { mountedRef.current = false }
  }, [])

  const commonFoods = ['米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包']

  const handleSubmit = async () => {
    if (submitLock.current || loading) return
    const trimmed = foodText.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入食物描述', icon: 'none' })
      return
    }

    if (!getAccessToken()) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/login/index') })
      return
    }

    const targetRecordDate = recordDate
    if (!requireAllowedRecordDate(targetRecordDate)) return
    const currentToday = getTodayRecordDateKey()
    const currentCreditStatus = getFoodAnalysisCreditStatusForDate(
      membershipCreditDate === currentToday && membershipCreditOwner && isAuthSessionCurrent(membershipCreditOwner) ? membershipStatus : null,
      targetDateStatus?.date === targetRecordDate && isAuthSessionCurrent(targetDateStatus.owner) ? targetDateStatus.status : null,
      targetRecordDate !== currentToday,
    )
    if (isFoodAnalysisCreditExhausted(currentCreditStatus)) {
      setCreditSheet({
        visible: true,
        status: currentCreditStatus,
        message: getFoodAnalysisCreditBlockMessage(currentCreditStatus),
      })
      return
    }

    let inputText = trimmed
    if (foodAmount.trim()) inputText += `\n数量：${foodAmount.trim()}`
    const suggestRatioEnabled = readSuggestRatioPreference()
    const goalWasChosen = dietGoalChosenRef.current
    const owner = captureAuthSession()
    const canPresent = () => mountedRef.current && visibleRef.current && isAuthSessionCurrent(owner)

    submitLock.current = true
    setLoading(true)
    Taro.showLoading({ title: '', mask: true })

    try {
      const budget = await loadAnalyzeNutritionBudget(targetRecordDate, { enabled: suggestRatioEnabled })
      if (!canPresent()) return
      const effectiveDietGoal = goalWasChosen ? dietGoal : budget.diet_goal || dietGoal
      // 避免沿用上一次拍照分析残留在 storage 中的图，loading 与结果页需与「文字记录」一致
      Taro.removeStorageSync('analyzeImagePath')
      Taro.removeStorageSync('analyzeImagePaths')
      Taro.setStorageSync('analyzeTextInput', inputText)
      Taro.setStorageSync('analyzeMealType', selectedMeal)
      Taro.setStorageSync('analyzeDietGoal', effectiveDietGoal)
      Taro.setStorageSync('analyzeActivityTiming', activityTiming)
      Taro.setStorageSync('analyzeExecutionMode', executionMode)
      const { task_id } = await submitTextAnalyzeTask({
        text: inputText,
        date: targetRecordDate,
        meal_type: selectedMeal as any,
        ...budget,
        diet_goal: effectiveDietGoal as any,
        user_goal: effectiveDietGoal === 'none' ? undefined : effectiveDietGoal as any,
        activity_timing: activityTiming as any,
        eating_mood: eatingMood || undefined,
        suggest_ratio_enabled: suggestRatioEnabled,
        analysis_engine: analysisEngine,
        precise_micronutrients: true,
        execution_mode: executionMode,
      })
      if (!canPresent()) return
      Taro.hideLoading()
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${task_id}&task_type=food_text&execution_mode=${executionMode}&analysis_engine=${analysisEngine}`
      })
    } catch (e: any) {
      if (!canPresent()) return
      Taro.hideLoading()
      console.error('[record-text] submitTextAnalyzeTask failed', e)
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
        setCreditSheet({ visible: true, status: membershipStatus, message: errMsg })
      } else {
        Taro.showToast({ title: errMsg, icon: 'none' })
      }
    } finally {
      if (canPresent()) Taro.hideLoading()
      submitLock.current = false
      if (mountedRef.current) setLoading(false)
    }
  }

  // 配额提示条文案计算
  const creditCost = 2 // 文字分析固定为 2 积分

  let quotaBarClass = 'record-text-quota-bar'
  let quotaBarText = ''
  let quotaBarLoading = false
  if (isBackfill) {
    const targetSummary = targetDateStatus?.date === recordTargetDate && isAuthSessionCurrent(targetDateStatus.owner) ? getMembershipCreditSummary(targetDateStatus.status) : null
    const targetHasInfo = targetSummary?.hasInfo ?? false
    const targetRemaining = targetSummary?.remaining ?? 0
    const monthDay = `${Number(recordTargetDate.slice(5, 7))}月${Number(recordTargetDate.slice(8, 10))}日`
    if (!targetHasInfo) {
      quotaBarLoading = true
    } else if (targetRemaining < creditCost) {
      quotaBarClass += ' record-text-quota-bar--warn'
      quotaBarText = `${monthDay}积分不足 · 将扣除今日积分 · 今日剩余 ${creditsRemaining}`
    } else {
      if (creditsRemaining <= 2) {
        quotaBarClass += ' record-text-quota-bar--warn'
      }
      quotaBarText = `${monthDay} · 已用 ${targetSummary?.used ?? 0}/${targetSummary?.max ?? 0} 积分 · 剩余 ${targetRemaining}${!membershipStatus?.is_pro ? '  →开通会员享更高额度' : ''}`
    }
  } else {
    if (isQuotaExhausted) {
      quotaBarClass += ' record-text-quota-bar--exhausted'
      quotaBarText = getFoodAnalysisCreditBlockMessage(membershipStatus)
    } else if (hasCreditsInfo) {
      if (creditsRemaining <= 2) {
        quotaBarClass += ' record-text-quota-bar--warn'
      }
      quotaBarText = `今日已用 ${creditsUsed}/${creditsMax} 积分 · 剩余 ${creditsRemaining}${!membershipStatus?.is_pro ? '  →开通会员享更高额度' : ''}`
    } else {
      quotaBarLoading = true
    }
  }

  return (
    <View className='record-text-page'>
      {membershipStatus && (
        <View
          className={quotaBarClass}
          onClick={() => {
            if (isQuotaExhausted) return
            if (!membershipStatus.is_pro) Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
          }}
        >
          {quotaBarLoading
            ? <View className='record-text-quota-spinner' />
            : <Text className='record-text-quota-bar-text'>{quotaBarText}</Text>}
        </View>
      )}
      <ScrollView className='content-scroll' scrollY>
        <RecordDateField date={recordDate} onChange={setRecordDate} disabled={loading} />
        {/* 输入区域 */}
        <View className='input-section'>
          <Text className='section-title'>吃了什么？</Text>
          <View className='input-card'>
            <Textarea
              className='food-textarea'
              placeholder='例如：200g五花肉、一碗米饭、两个鸡蛋'
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

        <View className='input-section'>
          <Text className='section-title'>此刻心情（可选）</Text>
          <EatingMoodPicker value={eatingMood} onChange={setEatingMood} />
        </View>

        <View className='text-advanced-toggle' onClick={() => setShowAdvanced(value => !value)}>
          <Text>{showAdvanced ? '收起更多选项' : '更多选项'}</Text>
          <Text>{showAdvanced ? '−' : '＋'}</Text>
        </View>
        {showAdvanced && <View>
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

        </View>}

        {/* 餐次选择 */}
        <View className='input-section'>
          <Text className='section-title'>选择餐次</Text>
          <View className='meal-selector'>
            {MEALS.map((meal) => (
              <View
                key={meal.id}
                className={`meal-item ${selectedMeal === meal.id ? 'active' : ''}`}
                onClick={() => { mealTypeChosenRef.current = true; setSelectedMeal(meal.id) }}
              >
                <Text className={`iconfont ${meal.icon} meal-icon`} />
                <Text className='meal-name'>{meal.name}</Text>
              </View>
            ))}
          </View>
        </View>

        {showAdvanced && <View>
        {/* 饮食目标 */}
        <View className='input-section'>
          <Text className='section-title'>饮食目标</Text>
          <View className='option-selector'>
            {DIET_GOALS.map((goal) => (
              <View
                key={goal.value}
                className={`option-item ${dietGoal === goal.value ? 'active' : ''}`}
                onClick={() => { dietGoalChosenRef.current = true; setDietGoal(goal.value) }}
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

        </View>}
        <View className='bottom-space' />
      </ScrollView>

      {/* 底部按钮 */}
      <View className='bottom-bar'>
        <View
          className={`submit-btn ${!foodText.trim() || loading || isQuotaExhausted ? 'disabled' : ''}`}
          onClick={handleSubmit}
        >
          {loading ? <View className='text-submit-spinner' /> : <Text>{isQuotaExhausted ? '积分不足，暂不可分析' : '开始分析 · 2 积分'}</Text>}
        </View>
      </View>
      <CreditShortageSheet
        visible={creditSheet.visible}
        membershipStatus={creditSheet.status ?? membershipStatus}
        requiredCredits={2}
        scenarioLabel='文字分析'
        message={creditSheet.message}
        onClose={() => setCreditSheet({ visible: false, status: null })}
      />
    </View>
  )
}

export default withAuth(RecordTextPage)
