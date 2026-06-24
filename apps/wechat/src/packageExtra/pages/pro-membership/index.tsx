import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useEffect, useMemo, useState } from 'react'
import CustomNavBar from '../../../components/CustomNavBar'
import {
  createMembershipPayment,
  getAccessToken,
  getMembershipPlans,
  getMyMembership,
  getHealthProfile,
  syncMembershipPayment,
  showUnifiedApiError,
  MembershipPeriod,
  MembershipPlan,
  MembershipStatus,
  MembershipTier,
  HealthProfile,
} from '../../../utils/api'
import {
  compareMembershipTier,
  getFounderPaidBonusRankLabel,
  getFounderPaidBonusSourceLabel,
  getCurrentMembershipPeriod,
  getCurrentMembershipTier,
  getMembershipTierLabel,
  isPrecisionSupportedTier,
} from '../../../utils/membership'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { extraPkgUrl, MAIN_TAB_ROUTES, normalizeRedirectUrlForSubpackage } from '../../../utils/subpackage-extra'

import './index.scss'
import { withAuth } from '../../../utils/withAuth'

function formatExpiry(value?: string | null): string {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function formatCurrencyCompact(amount: number): string {
  if (!Number.isFinite(amount)) return '0'
  const rounded = Math.round(amount * 100) / 100
  return Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function addMonthsDate(date: Date, months: number): Date {
  const next = new Date(date.getTime())
  const day = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + Math.max(months, 1))
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

function parseDateValue(value?: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateShort(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

const TIERS: Array<{
  key: MembershipTier
  name: string
  short: string
  credits: number
  summary: string
  precision: boolean
  scene: string
}> = [
  { key: 'light',    name: '轻度版',   short: '轻度', credits: 8,  summary: '适合轻量记录，不含精准模式', precision: false, scene: '轻量记录' },
  { key: 'standard', name: '标准版',   short: '标准', credits: 20, summary: '含精准模式，适合日常使用', precision: true, scene: '日常使用' },
  { key: 'advanced', name: '进阶版',   short: '进阶', credits: 40, summary: '含精准模式，适合高频使用', precision: true, scene: '高频使用' },
]

const PERIODS: Array<{ key: MembershipPeriod; label: string; unit: string }> = [
  { key: 'monthly',   label: '月卡', unit: '/月' },
  { key: 'quarterly', label: '季卡', unit: '/季' },
  { key: 'yearly',    label: '年卡', unit: '/年' },
]

const TIER_ICONS: Record<MembershipTier, string> = {
  light: '✦',
  standard: '★',
  advanced: '♛',
}

const PERIOD_WATERMARKS: Record<MembershipPeriod, string> = {
  monthly: '30',
  quarterly: '90',
  yearly: '365',
}

const normalizeTierParam = (value: unknown): MembershipTier | null => {
  return value === 'light' || value === 'standard' || value === 'advanced'
    ? value
    : null
}

const normalizePeriodParam = (value: unknown): MembershipPeriod | null => {
  return value === 'monthly' || value === 'quarterly' || value === 'yearly'
    ? value
    : null
}

const BASE_TIER_DAILY_CREDITS: Record<MembershipTier, number> = {
  light: 8,
  standard: 20,
  advanced: 40,
}

const AUDIT_PREVIEW_PLANS: MembershipPlan[] = [
  { code: 'light_monthly', name: '轻度版月卡', amount: 9.9, duration_months: 1, tier: 'light', period: 'monthly', daily_credits: 8, sort_order: 1 },
  { code: 'light_quarterly', name: '轻度版季卡', amount: 27.9, duration_months: 3, tier: 'light', period: 'quarterly', daily_credits: 8, savings: 1.8, sort_order: 2 },
  { code: 'light_yearly', name: '轻度版年卡', amount: 99, duration_months: 12, tier: 'light', period: 'yearly', daily_credits: 8, savings: 19.8, sort_order: 3 },
  { code: 'standard_monthly', name: '标准版月卡', amount: 19.9, duration_months: 1, tier: 'standard', period: 'monthly', daily_credits: 20, sort_order: 4 },
  { code: 'standard_quarterly', name: '标准版季卡', amount: 56.9, duration_months: 3, tier: 'standard', period: 'quarterly', daily_credits: 20, savings: 2.8, sort_order: 5 },
  { code: 'standard_yearly', name: '标准版年卡', amount: 199, duration_months: 12, tier: 'standard', period: 'yearly', daily_credits: 20, savings: 39.8, sort_order: 6 },
  { code: 'advanced_monthly', name: '进阶版月卡', amount: 29.9, duration_months: 1, tier: 'advanced', period: 'monthly', daily_credits: 40, sort_order: 7 },
  { code: 'advanced_quarterly', name: '进阶版季卡', amount: 84.9, duration_months: 3, tier: 'advanced', period: 'quarterly', daily_credits: 40, savings: 4.8, sort_order: 8 },
  { code: 'advanced_yearly', name: '进阶版年卡', amount: 299, duration_months: 12, tier: 'advanced', period: 'yearly', daily_credits: 40, savings: 59.8, sort_order: 9 },
]

const AUDIT_PREVIEW_MEMBERSHIP: MembershipStatus = {
  is_pro: false,
  status: 'inactive',
  current_plan_code: null,
  daily_limit: null,
  daily_used: null,
  daily_remaining: null,
  daily_credits_max: 0,
  daily_credits_used: 0,
  daily_credits_remaining: 0,
  daily_credits_base: 0,
  daily_bonus_credits: 0,
  invite_bonus_credits: 0,
  share_bonus_credits: 0,
  system_credits_remaining: 0,
  earned_credits_balance: 12,
  total_credits_available: 12,
  trial_active: false,
  early_user_rank: 128,
  early_user_limit: 1000,
  early_paid_user_limit: 100,
  early_user_paid_bonus_multiplier: 2,
  early_user_paid_bonus_eligible: true,
  early_user_paid_bonus_source: 'registration_top_1000',
  early_user_paid_bonus_active: false,
}

const AUTO_RENEW_AUDIT_PREVIEW_STORAGE_KEY = 'auto_renew_audit_preview'
const PAYMENT_TEST_PLAN_CODE = 'test_one_cent_monthly'

function isPaymentTestPlan(plan?: MembershipPlan | null): boolean {
  return Boolean(plan && (plan.is_test_plan || plan.code === PAYMENT_TEST_PLAN_CODE))
}

function isAutoRenewAuditRoute(): boolean {
  const routerParams = Taro.getCurrentInstance().router?.params || {}
  if (String(routerParams.audit_auto_renew || '') === '1') return true
  const pages = Taro.getCurrentPages()
  const current = pages[pages.length - 1]
  if (String(current?.options?.audit_auto_renew || '') === '1') return true
  try {
    return String(Taro.getStorageSync(AUTO_RENEW_AUDIT_PREVIEW_STORAGE_KEY) || '') === '1'
  } catch {
    return false
  }
}

function ProMembershipPage() {
  const { scheme } = useAppColorScheme()
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [selectedTier, setSelectedTier] = useState<MembershipTier>('standard')
  const [selectedPeriod, setSelectedPeriod] = useState<MembershipPeriod>('yearly')
  const [selectedPlanCode, setSelectedPlanCode] = useState<string | null>(null)
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(null)
  const [ageWarningDismissed, setAgeWarningDismissed] = useState(false)
  const [autoRenewRuleAccepted, setAutoRenewRuleAccepted] = useState(false)

  const autoRenewAuditMode = isAutoRenewAuditRoute()

  const handleBack = useCallback(() => {
    const pages = Taro.getCurrentPages()
    if (pages.length > 1) {
      const previous = pages[pages.length - 2]
      const previousRoute = `/${previous.route || ''}`
      const previousOptions = previous.options || {}
      const query = Object.keys(previousOptions)
        .map(key => `${key}=${encodeURIComponent(previousOptions[key])}`)
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
        fail: () => Taro.switchTab({ url: '/pages/profile/index' })
      })
      return
    }
    Taro.switchTab({ url: '/pages/profile/index' })
  }, [])

  function calculateAge(birthday?: string | null): number | null {
    if (!birthday) return null
    try {
      const birth = new Date(birthday)
      if (Number.isNaN(birth.getTime())) return null
      const today = new Date()
      let age = today.getFullYear() - birth.getFullYear()
      const m = today.getMonth() - birth.getMonth()
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age -= 1
      }
      return age
    } catch {
      return null
    }
  }

  type AgeCompliance = { ok: true } | { ok: false; severity: 'forbidden' | 'warning'; message: string }

  function checkAgeCompliance(age: number | null, amount: number): AgeCompliance {
    if (age == null) return { ok: true }
    if (age < 8) {
      return {
        ok: false,
        severity: 'forbidden',
        message: '根据相关法律规定，未满 8 周岁用户暂不支持付费订阅。请前往健康档案核对年龄信息。',
      }
    }
    if (age < 16 && amount > 50) {
      return {
        ok: false,
        severity: 'warning',
        message: `你当前健康档案年龄为 ${age} 岁，根据相关规定，该年龄段单次消费金额不得超过 50 元。建议切换至轻度版月卡/季卡，或修改年龄信息。`,
      }
    }
    if (age < 18 && amount > 100) {
      return {
        ok: false,
        severity: 'warning',
        message: `你当前健康档案年龄为 ${age} 岁，根据相关规定，该年龄段单次消费金额不得超过 100 元。建议选择合适的套餐，或修改年龄信息。`,
      }
    }
    return { ok: true }
  }

  const paymentTestPlan = useMemo<MembershipPlan | null>(() => {
    return plans.find(p => isPaymentTestPlan(p)) || null
  }, [plans])

  const selectedPlan = useMemo<MembershipPlan | null>(() => {
    if (!plans.length) return null
    if (selectedPlanCode) {
      const explicit = plans.find(p => p.code === selectedPlanCode)
      if (explicit) return explicit
    }
    return plans.find(p => !p.is_test_plan && p.code !== PAYMENT_TEST_PLAN_CODE && p.tier === selectedTier && p.period === selectedPeriod) || null
  }, [plans, selectedPlanCode, selectedTier, selectedPeriod])

  const monthlyPlanForTier = useMemo<MembershipPlan | null>(() => {
    return plans.find(p => !p.is_test_plan && p.code !== PAYMENT_TEST_PLAN_CODE && p.tier === selectedTier && p.period === 'monthly') || null
  }, [plans, selectedTier])

  const paymentEstimate = useMemo(() => {
    if (!selectedPlan) {
      return { mode: 'loading', amount: 0, disabled: false, hint: '' }
    }
    if (isPaymentTestPlan(selectedPlan)) {
      return {
        mode: 'payment_test',
        amount: selectedPlan.amount,
        disabled: false,
        hint: '测试支付会走完整会员开通链路，仅对测试名单用户可见',
      }
    }
    const currentCode = membership?.current_plan_code || null
    const currentPlan = plans.find(p => p.code === currentCode) || null
    const now = new Date()
    const currentStart = parseDateValue(membership?.current_period_start) || parseDateValue(membership?.first_activated_at)
    const currentExpires = parseDateValue(membership?.expires_at)
    if (!membership?.is_pro || !currentPlan || !currentStart || !currentExpires || currentExpires <= now || currentCode === selectedPlan.code) {
      return { mode: currentCode === selectedPlan.code ? 'renewal' : 'new_purchase', amount: selectedPlan.amount, disabled: false, hint: '' }
    }
    const currentDurationEnd = addMonthsDate(currentStart, currentPlan.duration_months || 1)
    const targetExpires = addMonthsDate(currentStart, selectedPlan.duration_months || 1)
    if (targetExpires <= now) {
      return {
        mode: 'blocked',
        amount: selectedPlan.amount,
        disabled: true,
        hint: '所选套餐周期已短于当前已使用时长，请选择更长周期',
      }
    }
    if (targetExpires < currentExpires) {
      return {
        mode: 'blocked',
        amount: selectedPlan.amount,
        disabled: true,
        hint: '所选套餐会缩短当前有效期，请到期后再购买或选择更长周期',
      }
    }
    const currentDuration = Math.max(currentDurationEnd.getTime() - currentStart.getTime(), 1)
    const targetDuration = Math.max(targetExpires.getTime() - currentStart.getTime(), 1)
    const currentRemaining = Math.max(currentExpires.getTime() - now.getTime(), 0)
    const targetRemaining = Math.max(targetExpires.getTime() - now.getTime(), 0)
    const currentRemainingValue = currentPlan.amount * currentRemaining / currentDuration
    const targetRemainingValue = selectedPlan.amount * targetRemaining / targetDuration
    const charge = Math.round((targetRemainingValue - currentRemainingValue) * 100) / 100
    if (charge <= 0) {
      return {
        mode: 'blocked',
        amount: selectedPlan.amount,
        disabled: true,
        hint: '当前套餐剩余价值已覆盖所选套餐，请选择更高档位或更长周期',
      }
    }
    return {
      mode: 'prorated_current_period_upgrade',
      amount: charge,
      disabled: false,
      hint: `已折抵当前套餐剩余价值约 ¥${formatCurrencyCompact(currentRemainingValue)}，升级后有效期至 ${formatDateShort(targetExpires)}`,
      targetExpires,
      currentCredit: currentRemainingValue,
    }
  }, [selectedPlan, membership, plans])

  const ageCompliance = useMemo<AgeCompliance>(() => {
    const age = calculateAge(healthProfile?.birthday)
    return checkAgeCompliance(age, paymentEstimate.amount || selectedPlan?.amount || 0)
  }, [healthProfile, selectedPlan, paymentEstimate])

  const loadData = useCallback(async () => {
    const token = getAccessToken()
    if (!token && !autoRenewAuditMode) {
      Taro.redirectTo({ url: extraPkgUrl('/pages/login/index') })
      return
    }

    setPageLoading(true)
    try {
      const params = Taro.getCurrentInstance().router?.params
      const targetTier = normalizeTierParam(params?.target_tier)
      const targetPeriod = normalizePeriodParam(params?.target_period)
      const [planList, currentMembership, profile] = autoRenewAuditMode
        ? [AUDIT_PREVIEW_PLANS, AUDIT_PREVIEW_MEMBERSHIP, null]
        : await Promise.all([
          getMembershipPlans(),
          getMyMembership(),
          getHealthProfile().catch(() => null),
        ])
      setPlans(planList)
      setMembership(currentMembership)
      if (profile) setHealthProfile(profile)
      const testPlan = planList.find(p => isPaymentTestPlan(p))
      if (testPlan && !targetTier && !targetPeriod) {
        setSelectedPlanCode(testPlan.code)
        if (testPlan.tier) setSelectedTier(testPlan.tier)
        if (testPlan.period) setSelectedPeriod(testPlan.period)
      } else {
        setSelectedPlanCode(null)
      }
      if (targetTier) {
        setSelectedTier(targetTier)
      }
      if (targetPeriod) {
        setSelectedPeriod(targetPeriod)
      }
      if (!targetTier || !targetPeriod) {
        // 若当前已经付费，默认定位到用户的 tier / period
        const currentCode = currentMembership.current_plan_code
        if (currentCode && currentMembership.is_pro) {
          const plan = planList.find(p => p.code === currentCode)
          if (!targetTier && plan?.tier) setSelectedTier(plan.tier)
          if (!targetPeriod && plan?.period) setSelectedPeriod(plan.period)
        }
      }
    } catch (error: any) {
      await showUnifiedApiError(error, '加载失败')
    } finally {
      setPageLoading(false)
    }
  }, [autoRenewAuditMode])

  useDidShow(() => {
    loadData()
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4', darkBackground: '#101716' })
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4', darkBackground: '#101716' })
  }, [scheme])

  const pollMembershipStatus = async () => {
    for (let i = 0; i < 8; i++) {
      await wait(1000)
      try {
        const latest = await getMyMembership(undefined, { forceRefresh: true })
        setMembership(latest)
        if (latest.is_pro || latest.status === 'active') return true
      } catch (err) {
        console.error('轮询会员状态失败:', err)
      }
    }
    return false
  }

  const handleSubscribe = async () => {
    const token = getAccessToken()
    if (!token && !autoRenewAuditMode) {
      Taro.redirectTo({ url: extraPkgUrl('/pages/login/index') })
      return
    }
    if (!selectedPlan || loading) return

    if (autoRenewAuditMode) {
      if (!autoRenewRuleAccepted) {
        await Taro.showModal({
          title: '请先确认规则',
          content: '请先勾选已阅读并同意会员服务协议及自动续费规则。该页面仅用于微信支付自动续费能力审核预览，不会发起真实代扣。',
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#00bc7d',
        })
        return
      }
      const payAmount = paymentEstimate.amount || selectedPlan.amount
      const periodLabel = PERIODS.find(p => p.key === selectedPeriod)?.label || '所选周期'
      const periodUnit = PERIODS.find(p => p.key === selectedPeriod)?.unit || ''
      await Taro.showModal({
        title: '自动续费签约预览',
        content: `拟开通：${selectedPlan.name}\n扣费周期：${periodLabel}\n每期金额：¥${payAmount.toFixed(2)}${periodUnit}\n说明：当前仅为审核预览，不会创建订单、不会调用微信委托代扣接口、不会真实扣款。`,
        showCancel: false,
        confirmText: '我知道了',
        confirmColor: '#00bc7d',
      })
      return
    }

    const selectedPlanIsPaymentTest = isPaymentTestPlan(selectedPlan)

    if (!selectedPlanIsPaymentTest && paymentEstimate.disabled) {
      await Taro.showModal({
        title: '暂不可切换',
        content: paymentEstimate.hint || '当前套餐暂不支持这样切换，请选择更高档位或更长周期。',
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#00bc7d',
      })
      return
    }

    // 年龄合规校验
    if (!selectedPlanIsPaymentTest && !ageCompliance.ok) {
      if (ageCompliance.severity === 'forbidden') {
        await Taro.showModal({
          title: '年龄限制',
          content: ageCompliance.message,
          confirmText: '去修改年龄',
          cancelText: '我知道了',
          confirmColor: '#00bc7d',
        }).then((res) => {
          if (res.confirm) {
            Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })
          }
        })
        return
      }
      // warning：弹窗提示，用户确认后才继续
      const modalRes = await Taro.showModal({
        title: '年龄提示',
        content: ageCompliance.message,
        confirmText: '仍要支付',
        cancelText: '取消',
        confirmColor: '#00bc7d',
      })
      if (!modalRes.confirm) return
    }

    const payAmount = paymentEstimate.amount || selectedPlan.amount
    const confirmContent = selectedPlanIsPaymentTest
      ? `支付测试套餐，¥${payAmount.toFixed(2)}。\n该订单用于验证真实微信支付与会员开通链路，支付成功后会开通测试会员。`
      : paymentEstimate.mode === 'prorated_current_period_upgrade'
      ? `升级 ${selectedPlan.name}，本次补差 ¥${payAmount.toFixed(2)}。${paymentEstimate.hint || '已按当前会员剩余价值折抵'}。到期后需手动续费。`
      : `订阅 ${selectedPlan.name}，¥${payAmount.toFixed(2)}${PERIODS.find(p => p.key === selectedPeriod)?.unit || ''}，到期后需手动续费。`

    const modalRes = await Taro.showModal({
      title: selectedPlanIsPaymentTest ? '测试支付确认' : '订阅确认',
      content: confirmContent,
      confirmText: '确认支付',
      confirmColor: '#00bc7d'
    })
    if (!modalRes.confirm) return

    setLoading(true)
    try {
      const payOrder = await createMembershipPayment(selectedPlan.code)
      await Taro.requestPayment({
        timeStamp: payOrder.pay_params.timeStamp,
        nonceStr: payOrder.pay_params.nonceStr,
        package: payOrder.pay_params.package,
        signType: payOrder.pay_params.signType,
        paySign: payOrder.pay_params.paySign
      })
      Taro.showToast({ title: '支付已提交，正在确认', icon: 'none', duration: 1800 })
      try {
        const syncResult = await syncMembershipPayment(payOrder.order_no)
        if (syncResult.membership) {
          setMembership(syncResult.membership)
        }
      } catch (syncError) {
        console.error('主动同步会员支付状态失败:', syncError)
      }
      if (selectedPlanIsPaymentTest) {
        Taro.showToast({ title: '测试会员已开通', icon: 'success' })
        return
      }
      const confirmed = await pollMembershipStatus()
      if (!confirmed) {
        const latest = await getMyMembership(undefined, { forceRefresh: true })
        setMembership(latest)
      }
      if (membership?.is_pro || confirmed) {
        Taro.showToast({ title: '开通成功！', icon: 'success' })
      }
    } catch (error: any) {
      const message = error?.errMsg || error?.message || ''
      if (String(message).includes('cancel')) {
        Taro.showToast({ title: '已取消支付', icon: 'none' })
      } else {
        await showUnifiedApiError(error, '支付失败，请重试')
      }
    } finally {
      setLoading(false)
    }
  }

  const isPro = membership?.is_pro ?? false
  const isTrial = !isPro && !!membership?.trial_active
  const trialDaysTotal = membership?.trial_days_total ?? 0
  const trialPolicy = membership?.trial_policy ?? null
  const isTop500Trial = isTrial && trialPolicy === 'founding_top_500_bonus_month'
  const isEarlyTrial = isTrial && (trialPolicy === 'founding_top_500_bonus_month' || trialPolicy === 'early_first_1000' || trialDaysTotal >= 30)
  const earlyUserRank = membership?.early_user_rank ?? null
  const earlyUserLimit = membership?.early_user_limit ?? 1000
  const earlyPaidUserLimit = membership?.early_paid_user_limit ?? 100
  const earlyUserEligible = !!membership?.early_user_paid_bonus_eligible
  const paidBonusMultiplier = membership?.early_user_paid_bonus_multiplier ?? 1
  const founderBonusSourceLabel = getFounderPaidBonusSourceLabel(membership)
  const founderBonusRankLabel = getFounderPaidBonusRankLabel(membership)
  const paidBonusActive = !!membership?.early_user_paid_bonus_active
  const creditsMax = membership?.daily_credits_max ?? 0
  const creditsUsed = membership?.daily_credits_used ?? 0
  const creditsRemaining = membership?.daily_credits_remaining ?? 0
  const systemCreditsRemaining = membership?.system_credits_remaining ?? Math.max(creditsMax - creditsUsed, 0)
  const earnedCreditsBalance = membership?.earned_credits_balance ?? 0
  const totalCreditsAvailable = membership?.total_credits_available ?? creditsRemaining
  const creditsBase = membership?.daily_credits_base ?? 0
  const bonusCredits = membership?.daily_bonus_credits ?? 0
  const inviteBonusCredits = membership?.invite_bonus_credits ?? 0
  const shareBonusCredits = membership?.share_bonus_credits ?? 0
  const currentPlanCode = membership?.current_plan_code ?? null
  const currentPlanTier = getCurrentMembershipTier(membership)
  const currentPlanPeriod = getCurrentMembershipPeriod(membership)
  const selectedTierMeta = TIERS.find(t => t.key === selectedTier) || null
  const tierCreditsDisplay = useMemo<Record<MembershipTier, number>>(() => {
    const multiplier = earlyUserEligible ? Math.max(paidBonusMultiplier, 1) : 1
    return {
      light: BASE_TIER_DAILY_CREDITS.light * multiplier,
      standard: BASE_TIER_DAILY_CREDITS.standard * multiplier,
      advanced: BASE_TIER_DAILY_CREDITS.advanced * multiplier,
    }
  }, [earlyUserEligible, paidBonusMultiplier])
  const tierFeatures = useMemo<Array<{ label: string; values: Record<MembershipTier, string> }>>(() => ([
    {
      label: '每日积分',
      values: {
        light: `${tierCreditsDisplay.light} 积分`,
        standard: `${tierCreditsDisplay.standard} 积分`,
        advanced: `${tierCreditsDisplay.advanced} 积分`,
      },
    },
    { label: '精准模式', values: { light: '不支持', standard: '支持', advanced: '支持' } },
    { label: '适合频率', values: { light: '轻量记录', standard: '日常使用', advanced: '高频使用' } },
  ]), [tierCreditsDisplay])
  const selectedTierCredits = selectedTierMeta ? tierCreditsDisplay[selectedTierMeta.key] : 0
  const isCurrentSelectedPlan = Boolean(isPro && selectedPlan && currentPlanCode === selectedPlan.code)
  const showPrecisionUpgradeNotice = Boolean(isPro && currentPlanTier === 'light')
  const routeSource = String(Taro.getCurrentInstance().router?.params?.source || '').trim()
  const showRouteUpgradeNotice = routeSource === 'precision_upgrade' && showPrecisionUpgradeNotice
  const upgradeNoticeText = showPrecisionUpgradeNotice
    ? showRouteUpgradeNotice
      ? '你当前是轻度版，精准模式需要升级到标准版或进阶版。已帮你定位到可升级套餐。'
      : '你当前是轻度版，当前不含精准模式。若想使用精准模式，可升级到标准版或进阶版。'
    : ''

  // 立省金额：取所选 plan 的 savings（后端已计算）；若无 savings 则按月卡 × duration 对比
  const savingsAmount = useMemo<number | null>(() => {
    if (!selectedPlan) return null
    if (selectedPlan.savings != null && selectedPlan.savings > 0) {
      return selectedPlan.savings
    }
    if (selectedPeriod !== 'monthly' && monthlyPlanForTier) {
      const original = monthlyPlanForTier.amount * selectedPlan.duration_months
      const diff = original - selectedPlan.amount
      return diff > 0 ? Number(diff.toFixed(2)) : null
    }
    return null
  }, [selectedPlan, selectedPeriod, monthlyPlanForTier])

  const perMonthDisplay = useMemo<string | null>(() => {
    if (!selectedPlan || selectedPlan.duration_months <= 1) return null
    return (selectedPlan.amount / selectedPlan.duration_months).toFixed(1)
  }, [selectedPlan])

  const originalAmountDisplay = useMemo<string | null>(() => {
    if (!selectedPlan?.original_amount || selectedPlan.original_amount <= selectedPlan.amount) return null
    return selectedPlan.original_amount.toFixed(2)
  }, [selectedPlan])

  const actionButtonText = useMemo(() => {
    if (!selectedPlan) return '加载中...'
    if (autoRenewAuditMode) return '确认开通自动续费（审核预览）'
    if (isPaymentTestPlan(selectedPlan)) return `支付测试套餐 · ¥${selectedPlan.amount.toFixed(2)}`
    if (paymentEstimate.disabled) return '当前套餐不可即时切换'
    const price = `¥${(paymentEstimate.amount || selectedPlan.amount).toFixed(2)}`
    if (!isPro) return `立即开通 · ${price}`
    if (isCurrentSelectedPlan) return `续费当前套餐 · ${price}`
    const tierCompare = compareMembershipTier(selectedTier, currentPlanTier)
    if (paymentEstimate.mode === 'prorated_current_period_upgrade') return `补差升级 · ${price}`
    if (tierCompare > 0) return `升级到${getMembershipTierLabel(selectedTier)} · ${price}`
    if (tierCompare < 0) return `切换到${selectedPlan.name} · ${price}`
    return `切换周期 · ${price}`
  }, [selectedPlan, autoRenewAuditMode, paymentEstimate, isPro, isCurrentSelectedPlan, selectedTier, currentPlanTier])

  const autoRenewPreview = useMemo(() => {
    const plan = selectedPlan
    const periodMeta = PERIODS.find(p => p.key === selectedPeriod)
    const payAmount = paymentEstimate.amount || plan?.amount || 0
    const baseDate = isPro && isCurrentSelectedPlan
      ? parseDateValue(membership?.expires_at) || new Date()
      : new Date()
    const renewDate = addMonthsDate(baseDate, plan?.duration_months || 1)
    return {
      planName: plan?.name || '食探会员',
      periodLabel: periodMeta?.label || '所选周期',
      periodUnit: periodMeta?.unit || '',
      amountText: `¥${payAmount.toFixed(2)}${periodMeta?.unit || ''}`,
      renewDateText: formatDateShort(renewDate),
    }
  }, [selectedPlan, selectedPeriod, paymentEstimate, isPro, isCurrentSelectedPlan, membership])

  const showAutoRenewCancelPreview = async () => {
    await Taro.showModal({
      title: '关闭自动续费路径',
      content: '产品内路径：我的 → 食探会员 → 自动续费管理 → 关闭自动续费。\n也可在微信支付 → 扣费服务中关闭。当前为审核预览，不会执行真实解约。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#00bc7d',
    })
  }

  return (
    <View className={`membership-page ${scheme === 'dark' ? 'membership-page--dark' : ''}`}>
      <CustomNavBar
        title='积分充值'
        showBack
        onBack={handleBack}
        color={scheme === 'dark' ? '#f3f7f4' : '#0f172a'}
        background={scheme === 'dark' ? '#101716' : '#f0fdf4'}
        className='membership-page__nav'
      />
      {autoRenewAuditMode && (
        <View className='audit-preview-banner'>
          <Text className='audit-preview-title'>自动续费申请交互预览</Text>
          <Text className='audit-preview-text'>仅用于微信支付能力审核，当前不会发起真实代扣。</Text>
        </View>
      )}
      {/* 顶部 Hero */}
      <View className='hero-section'>
        <View className='hero-inner'>
          <View className='hero-emblem-row'>
            <Text className='hero-laurel hero-laurel--left'>❦</Text>
            <View className='hero-icon-shell'>
              <View className='hero-icon-halo' />
              <View className='hero-icon-wrap'>
              <Text className='iconfont icon-jiesuo hero-icon-svg' />
              </View>
            </View>
            <Text className='hero-laurel hero-laurel--right'>❦</Text>
          </View>
        <View className='hero-copy'>
          <Text className='hero-title'>食探会员</Text>
            <Text className='hero-subtitle'>
            {earlyUserEligible
              ? `你属于${founderBonusSourceLabel || `前 ${earlyUserLimit} 注册用户 / 前 ${earlyPaidUserLimit} 付费用户`}礼遇，开通会员后每日积分翻倍`
              : '按使用强度选套餐，轻度版不含精准模式'}
          </Text>
        </View>
        {earlyUserEligible && (
          <View className='hero-founder-badge'>
            <Text className='hero-founder-badge-text'>
              创始用户礼遇：会员积分 x{paidBonusMultiplier}
            </Text>
          </View>
        )}

          {!pageLoading && membership && (
            <View className={`hero-credits ${(isPro || isTrial) ? 'hero-credits--active' : 'hero-credits--idle'}`}>
              {(isPro || isTrial) ? (
                <>
                  <Text className='hero-credits-label'>
                    {isTrial
                      ? `🎁 ${isTop500Trial ? '前 500 用户免费 2 个月' : isEarlyTrial ? '前 1000 用户免费 1 个月' : '新用户免费试用'} · 今日已用积分`
                      : paidBonusActive
                        ? `🎁 创始会员积分 x${paidBonusMultiplier} · 今日已用积分`
                        : '今日已用积分'}
                  </Text>
                  <View className='hero-credits-value-row'>
                    <Text className='hero-credits-value'>{creditsUsed}</Text>
                    <Text className='hero-credits-total'>/ {creditsMax}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text className='hero-credits-label'>选择适合你的套餐</Text>
                  <View className='hero-credits-pill'>
                    <Text className='hero-credits-tip'>
                      {earlyUserEligible
                        ? `${founderBonusRankLabel || '你属于创始用户礼遇'}，开通后每日按套餐积分 x${paidBonusMultiplier} 发放`
                        : '开通后每日发放系统积分，次日刷新；分享奖励积分可累计，邀请奖励送会员'}
                    </Text>
                  </View>
                </>
              )}
            </View>
          )}
        </View>
      </View>

      {showPrecisionUpgradeNotice && (
        <View className='upgrade-notice'>
          <View className='upgrade-notice-main'>
            <Text className='upgrade-notice-text'>{upgradeNoticeText}</Text>
            <Text
              className='upgrade-notice-action'
              onClick={() => setSelectedTier('standard')}
            >
              去看标准版
            </Text>
          </View>
        </View>
      )}

      {paymentTestPlan && (
        <View
          className={`payment-test-card ${selectedPlan?.code === paymentTestPlan.code ? 'payment-test-card--active' : ''}`}
          onClick={() => {
            setSelectedPlanCode(paymentTestPlan.code)
            if (paymentTestPlan.tier) setSelectedTier(paymentTestPlan.tier)
            if (paymentTestPlan.period) setSelectedPeriod(paymentTestPlan.period)
          }}
        >
          <View className='payment-test-card-main'>
            <Text className='payment-test-card-title'>支付测试套餐</Text>
            <Text className='payment-test-card-desc'>仅测试名单账号可见，用于真实支付链路验证</Text>
          </View>
          <View className='payment-test-card-price'>
            <Text className='payment-test-card-symbol'>¥</Text>
            <Text className='payment-test-card-amount'>{paymentTestPlan.amount.toFixed(2)}</Text>
          </View>
        </View>
      )}

      {/* 档位选择：3 列卡片 */}
      <View className='tier-section'>
        <View className='section-title'>
          <Text className='section-title-text'>选择档位</Text>
          <Text className='section-title-hint'>系统积分次日刷新，奖励积分可累计</Text>
        </View>
        <View className='tier-grid'>
          {TIERS.map(t => {
            const active = t.key === selectedTier
            return (
              <View
                key={t.key}
                className={`tier-card ${active ? 'tier-card--active' : ''} tier-card--${t.key}`}
                onClick={() => {
                  setSelectedPlanCode(null)
                  setSelectedTier(t.key)
                }}
              >
                {isPro && currentPlanTier === t.key ? (
                  <View className='tier-card-badge tier-card-badge--current'>当前</View>
                ) : t.key === 'advanced' ? (
                  <View className='tier-card-badge tier-card-badge--suggested'>高配</View>
                ) : null}
                <View className='tier-card-head'>
                  <Text className={`tier-card-icon tier-card-icon--${t.key}`}>{TIER_ICONS[t.key]}</Text>
                  <Text className='tier-card-name'>{t.name}</Text>
                </View>
                <Text className='tier-card-credits'>{tierCreditsDisplay[t.key]}</Text>
                <Text className='tier-card-credits-unit'>积分 / 日</Text>
                <Text className='tier-card-summary'>{t.summary}</Text>
              </View>
            )
          })}
        </View>
      </View>

      {/* 周期选择：3 tabs */}
      <View className='period-section'>
        <View className='section-title'>
          <Text className='section-title-text'>选择周期</Text>
          <Text className='section-title-hint'>{isPro ? '随时可升级档位' : '长期订阅更划算'}</Text>
        </View>
        <View className='period-tabs'>
          {PERIODS.map(p => {
            const active = p.key === selectedPeriod
            const planForPeriod = plans.find(x => !x.is_test_plan && x.code !== PAYMENT_TEST_PLAN_CODE && x.tier === selectedTier && x.period === p.key)
            // 立省：优先用 savings 字段
            let saveTxt: string | null = null
            if (planForPeriod?.savings && planForPeriod.savings > 0) {
              saveTxt = `立省¥${formatCurrencyCompact(planForPeriod.savings)}`
            } else if (p.key !== 'monthly') {
              const monthly = plans.find(x => !x.is_test_plan && x.code !== PAYMENT_TEST_PLAN_CODE && x.tier === selectedTier && x.period === 'monthly')
              if (monthly && planForPeriod) {
                const diff = monthly.amount * planForPeriod.duration_months - planForPeriod.amount
                if (diff > 0) saveTxt = `立省¥${formatCurrencyCompact(diff)}`
              }
            }
            return (
              <View
                key={p.key}
                className={`period-tab ${active ? 'period-tab--active' : ''}`}
                onClick={() => {
                  setSelectedPlanCode(null)
                  setSelectedPeriod(p.key)
                }}
              >
                {p.key === 'yearly' && saveTxt && (
                  <Text className='period-tab-recommend'>推荐</Text>
                )}
                <Text className='period-tab-label'>{p.label}</Text>
                {planForPeriod && (
                  <View className='period-tab-price-row'>
                    <Text className='period-tab-price-symbol'>¥</Text>
                    <Text className='period-tab-price'>{planForPeriod.amount.toFixed(2)}</Text>
                    <Text className='period-tab-price-unit'>{p.unit}</Text>
                  </View>
                )}
                {isPro && currentPlanPeriod === p.key && (
                  <Text className='period-tab-current'>当前周期</Text>
                )}
                {saveTxt && <Text className='period-tab-save'>{saveTxt}</Text>}
                <Text className='period-tab-watermark'>{PERIOD_WATERMARKS[p.key]}</Text>
              </View>
            )
          })}
        </View>
      </View>

      <View className='plan-card'>
        <View className='plan-card-left'>
          <Text className='plan-name'>{selectedPlan?.name || '食探会员'}</Text>
          <Text className='plan-desc'>
            {earlyUserEligible
              ? `创始用户开通后每日 ${selectedTierCredits} 系统积分 · ${selectedTierMeta?.summary || selectedPlan?.description || '系统积分次日刷新，奖励积分另计累计'}`
              : (selectedTierMeta?.summary || selectedPlan?.description || '每日发放系统积分，次日刷新；奖励积分另计累计')}
          </Text>
          {perMonthDisplay && (
            <Text className='plan-permonth'>≈ ¥{perMonthDisplay} / 月</Text>
          )}
          {savingsAmount && (
            <View className='plan-save-tag'>
              <Text className='plan-save-tag-text'>立省 ¥{formatCurrencyCompact(savingsAmount)}</Text>
            </View>
          )}
        </View>
        <View className='plan-card-right'>
          <Text className='plan-price'>
            <Text className='plan-price-symbol'>¥</Text>
            {pageLoading ? '--' : (selectedPlan?.amount?.toFixed(2) ?? '--')}
          </Text>
          <Text className='plan-period'>
            {PERIODS.find(p => p.key === selectedPeriod)?.unit || ''}
          </Text>
          {originalAmountDisplay && (
            <Text className='plan-original-price'>原价 ¥{originalAmountDisplay}{PERIODS.find(p => p.key === selectedPeriod)?.unit || ''}</Text>
          )}
        </View>
      </View>

      {autoRenewAuditMode && (
        <View className='auto-renew-card'>
          <View className='auto-renew-card-head'>
            <Text className='auto-renew-card-title'>自动续费说明</Text>
            <Text className='auto-renew-card-badge'>审核预览</Text>
          </View>
          <View className='auto-renew-row'>
            <Text className='auto-renew-label'>服务名称</Text>
            <Text className='auto-renew-value'>{autoRenewPreview.planName}</Text>
          </View>
          <View className='auto-renew-row'>
            <Text className='auto-renew-label'>扣费周期</Text>
            <Text className='auto-renew-value'>{autoRenewPreview.periodLabel}</Text>
          </View>
          <View className='auto-renew-row'>
            <Text className='auto-renew-label'>每期金额</Text>
            <Text className='auto-renew-value auto-renew-value--price'>{autoRenewPreview.amountText}</Text>
          </View>
          <View className='auto-renew-row'>
            <Text className='auto-renew-label'>预计续费</Text>
            <Text className='auto-renew-value'>{autoRenewPreview.renewDateText}</Text>
          </View>
          <Text className='auto-renew-desc'>开通后，会员到期前将按所选周期自动续费；扣费前会按微信支付规则发送通知。用户可随时关闭自动续费，关闭后不影响已付费周期内的会员权益。</Text>
          <View className='auto-renew-path'>
            <Text className='auto-renew-path-title'>取消路径</Text>
            <Text className='auto-renew-path-text'>我的 → 食探会员 → 自动续费管理 → 关闭自动续费</Text>
            <Text className='auto-renew-path-text'>也可在微信支付 → 扣费服务中关闭</Text>
          </View>
          <View
            className={`auto-renew-check ${autoRenewRuleAccepted ? 'auto-renew-check--checked' : ''}`}
            onClick={() => setAutoRenewRuleAccepted(v => !v)}
          >
            <View className='auto-renew-checkbox'>
              {autoRenewRuleAccepted && <Text className='auto-renew-checkbox-mark'>✓</Text>}
            </View>
            <Text className='auto-renew-check-text'>我已阅读并同意会员服务协议及自动续费规则</Text>
          </View>
          <Text
            className='auto-renew-link'
            onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/membership-agreement/index') })}
          >
            查看《会员服务协议》
          </Text>
        </View>
      )}

      {/* 三档对比表 */}
      <View className='features-section'>
        <View className='features-header'>
          {TIERS.map(t => (
            <View
              key={t.key}
              className={`features-col-head ${t.key === selectedTier ? 'features-col-head--active' : ''}`}
            >
              <Text className='features-col-head-name'>{t.short}</Text>
            </View>
          ))}
        </View>
        {tierFeatures.map((f, i) => (
          <View key={i} className='features-row'>
            <View className='features-row-label'>
              <Text className='features-row-label-text'>{f.label}</Text>
            </View>
            {TIERS.map(t => (
              <View
                key={t.key}
                className={`features-col-cell ${t.key === selectedTier ? 'features-col-cell--active' : ''}`}
              >
                <Text className='features-cell-text'>{f.values[t.key]}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      <Text className='features-footnote'>
        当前对比表只展示已真实上线的差异；后续新能力上线后再补充说明。
      </Text>

      {/* 积分说明 */}
      <View className='credits-hint-card'>
        <Text className='credits-hint-title'>💡 积分消耗</Text>
        <Text className='credits-hint-item'>· 创始用户礼遇：前 1000 名注册用户或前 100 名付费用户，开通会员后每日套餐积分翻倍</Text>
        <Text className='credits-hint-item'>· 运动记录：1 积分 / 次</Text>
        <Text className='credits-hint-item'>· 基础记录 / 基础分析：2 积分 / 次</Text>
        <Text className='credits-hint-item'>· 精准模式：4 积分 / 次</Text>
        <Text className='credits-hint-item credits-hint-item--muted'>· 系统积分每日发放，次日 00:00 刷新；分享等奖励积分累计不清零</Text>
        <Text className='credits-hint-item'>· 邀请好友：好友在 7 天内完成 2 个自然日有效使用后，双方各得一周轻度版会员</Text>
        <Text className='credits-hint-item'>· 分享海报成功：每日奖励 1 积分，转入累计余额</Text>
      </View>

      {/* 当前状态 */}
      {!pageLoading && membership && (
        <View className='status-card'>
          <View className='status-row'>
            <Text className='status-label'>当前状态</Text>
            <Text className={`status-value ${isPro ? 'status-value--active' : ''}`}>
              {isPro ? '会员有效' : isTrial ? '试用中' : '未开通'}
            </Text>
          </View>
          {earlyUserEligible && (
            <>
              <View className='status-row'>
                <Text className='status-label'>创始用户编号</Text>
                <Text className='status-value'>{founderBonusRankLabel || `注册第 ${earlyUserRank || '--'} / ${earlyUserLimit} 位`}</Text>
              </View>
              <View className='status-row'>
                <Text className='status-label'>创始礼遇</Text>
                <Text className='status-value status-value--active'>
                  {founderBonusSourceLabel || '创始用户'} · 付费会员积分 x{paidBonusMultiplier}{paidBonusActive ? '（已生效）' : '（开通后生效）'}
                </Text>
              </View>
            </>
          )}
          {isPro && (
            <>
              <View className='status-row'>
                <Text className='status-label'>当前套餐</Text>
                <Text className='status-value'>
                  {plans.find(p => p.code === membership.current_plan_code)?.name || membership.current_plan_code || '--'}
                </Text>
              </View>
              <View className='status-row'>
                <Text className='status-label'>到期时间</Text>
                <Text className='status-value'>{formatExpiry(membership.expires_at)}</Text>
              </View>
              <View className='status-row'>
                <Text className='status-label'>精准模式</Text>
                <Text className='status-value'>
                  {isPrecisionSupportedTier(currentPlanTier) ? '已解锁' : '当前套餐不含，升级标准版/进阶版可解锁'}
                </Text>
              </View>
            </>
          )}
          {isTrial && (
            <>
              <View className='status-row'>
                <Text className='status-label'>试用权益</Text>
                <Text className='status-value'>
                  {isTop500Trial ? '前 500 用户免费 2 个月' : isEarlyTrial ? '前 1000 用户免费 1 个月' : '新用户免费 3 天'}
                </Text>
              </View>
              <View className='status-row'>
                <Text className='status-label'>试用截止</Text>
                <Text className='status-value'>{formatExpiry(membership.trial_expires_at)}</Text>
              </View>
            </>
          )}
          <View className='status-row'>
            <Text className='status-label'>今日已用积分</Text>
            <Text className='status-value status-value--active'>
              {creditsMax > 0 ? `${creditsUsed} / ${creditsMax}` : '—'}
            </Text>
          </View>
          <View className='status-row'>
            <Text className='status-label'>系统积分 / 今日入账</Text>
            <Text className='status-value'>
              {creditsMax > 0 ? `${creditsBase} / ${bonusCredits}` : '—'}
            </Text>
          </View>
          {bonusCredits > 0 && (
            <View className='status-row'>
              <Text className='status-label'>奖励明细</Text>
              <Text className='status-value'>
                邀请 +{inviteBonusCredits} · 海报 +{shareBonusCredits}
              </Text>
            </View>
          )}
          <View className='status-row'>
            <Text className='status-label'>系统剩余积分</Text>
            <Text className='status-value status-value--active'>
              {creditsMax > 0 ? `${systemCreditsRemaining}` : '—'}
            </Text>
          </View>
          <View className='status-row'>
            <Text className='status-label'>累计奖励余额</Text>
            <Text className='status-value'>
              {`${earnedCreditsBalance}`}
            </Text>
          </View>
          <View className='status-row'>
            <Text className='status-label'>当前总可用积分</Text>
            <Text className='status-value status-value--active'>
              {`${totalCreditsAvailable}`}
            </Text>
          </View>
        </View>
      )}

      {autoRenewAuditMode && !pageLoading && membership && (
        <View className='auto-renew-manage-card'>
          <View className='auto-renew-card-head'>
            <Text className='auto-renew-card-title'>自动续费管理</Text>
            <Text className='auto-renew-card-badge'>产品内路径</Text>
          </View>
          <Text className='auto-renew-manage-text'>用户开通后，可在本页面查看自动续费状态，并通过下方入口关闭自动续费。</Text>
          <Text className='auto-renew-path-text'>我的 → 食探会员 → 自动续费管理 → 关闭自动续费</Text>
          <Button className='auto-renew-cancel-btn' onClick={showAutoRenewCancelPreview}>
            关闭自动续费（审核预览）
          </Button>
        </View>
      )}

      {/* 年龄合规提示 */}
      {!ageCompliance.ok && !ageWarningDismissed && (
        <View className={`age-compliance-banner age-compliance-banner--${ageCompliance.severity}`}>
          <Text className='age-compliance-icon'>{ageCompliance.severity === 'forbidden' ? '⚠️' : '💡'}</Text>
          <Text className='age-compliance-text'>{ageCompliance.message}</Text>
          <View className='age-compliance-actions'>
            <Text
              className='age-compliance-action'
              onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })}
            >
              去修改年龄
            </Text>
            <Text
              className='age-compliance-action age-compliance-action--dismiss'
              onClick={() => setAgeWarningDismissed(true)}
            >
              我知道了
            </Text>
          </View>
        </View>
      )}

      {/* 订阅按钮 */}
      <View className='action-section'>
        {isPro ? (
          <View className='renew-tip'>
            <Text className='renew-tip-text'>
              {paidBonusActive ? `创始用户权益已生效，当前会员积分 x${paidBonusMultiplier}` : '会员生效中，可升档或续费'}
            </Text>
          </View>
        ) : null}
        <Button
          className={`subscribe-btn ${isPro ? 'subscribe-btn--renew' : ''}`}
          loading={loading}
          disabled={loading || !selectedPlan || pageLoading}
          onClick={handleSubscribe}
        >
          {pageLoading
            ? <View className='btn-spinner' />
            : actionButtonText
          }
        </Button>
        <Text className='subscribe-hint'>
          {autoRenewAuditMode ? '自动续费审核预览 · 不发起真实代扣' : (paymentEstimate.hint || '到期后不自动续费 · 支持微信支付')}
        </Text>
        {autoRenewAuditMode && (
          <Text className='subscribe-hint subscribe-hint--audit'>当前页面仅为自动续费申请审核预览，不会真实扣款。</Text>
        )}
      </View>

    </View>
  )
}

export default withAuth(ProMembershipPage, { public: true })
