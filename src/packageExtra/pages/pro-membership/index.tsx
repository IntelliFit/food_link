import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { ShieldOutlined } from '@taroify/icons'
import '@taroify/icons/style'
import { useCallback, useMemo, useState } from 'react'
import {
  createMembershipPayment,
  getAccessToken,
  getMembershipPlans,
  getMyMembership,
  MembershipPeriod,
  MembershipPlan,
  MembershipStatus,
  MembershipTier,
  toggleTestMembership,
} from '../../../utils/api'
import {
  compareMembershipTier,
  getCurrentMembershipPeriod,
  getCurrentMembershipTier,
  getMembershipTierLabel,
  isPrecisionSupportedTier,
} from '../../../utils/membership'

import './index.scss'
import { withAuth } from '../../../utils/withAuth'

function formatExpiry(value?: string | null): string {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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

// 当前已上线、且真实存在的差异
const TIER_FEATURES: Array<{ label: string; values: Record<MembershipTier, string> }> = [
  { label: '每日积分',  values: { light: '8 积分',  standard: '20 积分', advanced: '40 积分' } },
  { label: '精准模式',  values: { light: '不支持', standard: '支持',   advanced: '支持' } },
  { label: '适合频率',  values: { light: '轻量记录', standard: '日常使用', advanced: '高频使用' } },
]

function ProMembershipPage() {
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [selectedTier, setSelectedTier] = useState<MembershipTier>('standard')
  const [selectedPeriod, setSelectedPeriod] = useState<MembershipPeriod>('yearly')

  const loadData = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }

    setPageLoading(true)
    try {
      const params = Taro.getCurrentInstance().router?.params
      const targetTier = normalizeTierParam(params?.target_tier)
      const targetPeriod = normalizePeriodParam(params?.target_period)
      const [planList, currentMembership] = await Promise.all([
        getMembershipPlans(),
        getMyMembership()
      ])
      setPlans(planList)
      setMembership(currentMembership)
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
      Taro.showToast({ title: error.message || '加载失败', icon: 'none' })
    } finally {
      setPageLoading(false)
    }
  }, [])

  useDidShow(() => {
    loadData()
  })

  const selectedPlan = useMemo<MembershipPlan | null>(() => {
    if (!plans.length) return null
    return plans.find(p => p.tier === selectedTier && p.period === selectedPeriod) || null
  }, [plans, selectedTier, selectedPeriod])

  const monthlyPlanForTier = useMemo<MembershipPlan | null>(() => {
    return plans.find(p => p.tier === selectedTier && p.period === 'monthly') || null
  }, [plans, selectedTier])

  const pollMembershipStatus = async () => {
    for (let i = 0; i < 8; i++) {
      await wait(1000)
      try {
        const latest = await getMyMembership()
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
    if (!token) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }
    if (!selectedPlan || loading) return

    const confirmContent = `订阅 ${selectedPlan.name}，¥${selectedPlan.amount.toFixed(2)}${PERIODS.find(p => p.key === selectedPeriod)?.unit || ''}，到期后需手动续费。`

    const modalRes = await Taro.showModal({
      title: '订阅确认',
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
      const confirmed = await pollMembershipStatus()
      if (!confirmed) {
        const latest = await getMyMembership()
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
        Taro.showToast({ title: error.message || '支付失败，请重试', icon: 'none' })
      }
    } finally {
      setLoading(false)
    }
  }

  const isPro = membership?.is_pro ?? false
  const isTrial = !isPro && !!membership?.trial_active
  const creditsMax = membership?.daily_credits_max ?? 0
  const creditsUsed = membership?.daily_credits_used ?? 0
  const creditsRemaining = membership?.daily_credits_remaining ?? 0
  const currentPlanCode = membership?.current_plan_code ?? null
  const currentPlanTier = getCurrentMembershipTier(membership)
  const currentPlanPeriod = getCurrentMembershipPeriod(membership)
  const selectedTierMeta = TIERS.find(t => t.key === selectedTier) || null
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

  const actionButtonText = useMemo(() => {
    if (!selectedPlan) return '加载中...'
    const price = `¥${selectedPlan.amount.toFixed(2)}`
    if (!isPro) return `立即开通 · ${price}`
    if (isCurrentSelectedPlan) return `续费当前套餐 · ${price}`
    const tierCompare = compareMembershipTier(selectedTier, currentPlanTier)
    if (tierCompare > 0) return `升级到${getMembershipTierLabel(selectedTier)} · ${price}`
    if (tierCompare < 0) return `切换到${selectedPlan.name} · ${price}`
    return `切换周期 · ${price}`
  }, [selectedPlan, isPro, isCurrentSelectedPlan, selectedTier, currentPlanTier])

  // ============================================================
  // TODO: [TEST] 以下测试逻辑在正式上线前必须删除
  const [testLoading, setTestLoading] = useState(false)

  const handleToggleTestMembership = async () => {
    if (!selectedPlan && !isPro) {
      Taro.showToast({ title: '套餐加载中，请稍后重试', icon: 'none' })
      return
    }
    setTestLoading(true)
    try {
      const result = await toggleTestMembership(selectedPlan?.code)
      const label = result.is_pro
        ? `✅ 已为当前账号开通 ${result.plan_name || selectedPlan?.name || '会员'}`
        : '⛔ 已关闭当前账号会员'
      Taro.showToast({ title: label, icon: 'none', duration: 2000 })
      await loadData()
    } catch (error: any) {
      Taro.showToast({ title: error.message || '切换失败', icon: 'none' })
    } finally {
      setTestLoading(false)
    }
  }
  // TODO: [TEST] 测试逻辑结束
  // ============================================================

  return (
    <View className='membership-page'>
      {/* 顶部 Hero */}
      <View className='hero-section'>
        <View className='hero-icon-wrap'>
          <ShieldOutlined className='hero-icon-svg' />
        </View>
        <Text className='hero-title'>食探会员</Text>
        <Text className='hero-subtitle'>按使用强度选套餐，轻度版不含精准模式</Text>

        {/* 积分胶囊 */}
        {!pageLoading && membership && (
          <View className='hero-credits'>
            {(isPro || isTrial) ? (
              <>
                <Text className='hero-credits-label'>{isTrial ? '🎁 试用期 · 今日已用积分' : '今日已用积分'}</Text>
                <Text className='hero-credits-value'>
                  {creditsUsed}
                  <Text className='hero-credits-total'> / {creditsMax}</Text>
                </Text>
                <Text className='hero-credits-tip'>剩余 {creditsRemaining} 积分 · 次日清零</Text>
              </>
            ) : (
              <>
                <Text className='hero-credits-label'>选择适合你的套餐</Text>
                <Text className='hero-credits-tip'>开通后每日按套餐发放积分，当天有效不累计</Text>
              </>
            )}
          </View>
        )}
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

      {/* 档位选择：3 列卡片 */}
      <View className='tier-section'>
        <View className='section-title'>
          <Text className='section-title-text'>选择档位</Text>
          <Text className='section-title-hint'>积分当天有效，次日清零</Text>
        </View>
        <View className='tier-grid'>
          {TIERS.map(t => {
            const active = t.key === selectedTier
            return (
              <View
                key={t.key}
                className={`tier-card ${active ? 'tier-card--active' : ''} tier-card--${t.key}`}
                onClick={() => setSelectedTier(t.key)}
              >
                {isPro && currentPlanTier === t.key ? (
                  <View className='tier-card-badge tier-card-badge--current'>当前</View>
                ) : t.key === 'advanced' ? (
                  <View className='tier-card-badge tier-card-badge--suggested'>高配</View>
                ) : null}
                <Text className='tier-card-name'>{t.name}</Text>
                <Text className='tier-card-credits'>{t.credits}</Text>
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
        </View>
        <View className='period-tabs'>
          {PERIODS.map(p => {
            const active = p.key === selectedPeriod
            const planForPeriod = plans.find(x => x.tier === selectedTier && x.period === p.key)
            // 立省：优先用 savings 字段
            let saveTxt: string | null = null
            if (planForPeriod?.savings && planForPeriod.savings > 0) {
              saveTxt = `立省¥${planForPeriod.savings.toFixed(0)}`
            } else if (p.key !== 'monthly') {
              const monthly = plans.find(x => x.tier === selectedTier && x.period === 'monthly')
              if (monthly && planForPeriod) {
                const diff = monthly.amount * planForPeriod.duration_months - planForPeriod.amount
                if (diff > 0) saveTxt = `立省¥${diff.toFixed(0)}`
              }
            }
            return (
              <View
                key={p.key}
                className={`period-tab ${active ? 'period-tab--active' : ''}`}
                onClick={() => setSelectedPeriod(p.key)}
              >
                <Text className='period-tab-label'>{p.label}</Text>
                {planForPeriod && (
                  <Text className='period-tab-price'>¥{planForPeriod.amount.toFixed(2)}</Text>
                )}
                {isPro && currentPlanPeriod === p.key && (
                  <Text className='period-tab-current'>当前周期</Text>
                )}
                {saveTxt && <Text className='period-tab-save'>{saveTxt}</Text>}
              </View>
            )
          })}
        </View>
      </View>

      {/* 已选套餐价格卡 */}
      <View className='plan-card'>
        <View className='plan-card-left'>
          <Text className='plan-name'>{selectedPlan?.name || '食探会员'}</Text>
          <Text className='plan-desc'>
            {selectedTierMeta?.summary || selectedPlan?.description || '每日积分发放，当天有效次日清零'}
          </Text>
          {perMonthDisplay && (
            <Text className='plan-permonth'>≈ ¥{perMonthDisplay} / 月</Text>
          )}
          {savingsAmount && (
            <View className='plan-save-tag'>
              <Text className='plan-save-tag-text'>立省 ¥{savingsAmount.toFixed(0)}</Text>
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
        </View>
      </View>

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
        {TIER_FEATURES.map((f, i) => (
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
        <Text className='credits-hint-item'>· 运动记录：1 积分 / 次</Text>
        <Text className='credits-hint-item'>· 基础记录 / 基础分析：2 积分 / 次</Text>
        <Text className='credits-hint-item credits-hint-item--muted'>积分每日发放，当天有效不累计</Text>
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
            <View className='status-row'>
              <Text className='status-label'>试用截止</Text>
              <Text className='status-value'>{formatExpiry(membership.trial_expires_at)}</Text>
            </View>
          )}
          <View className='status-row'>
            <Text className='status-label'>今日已用积分</Text>
            <Text className='status-value status-value--active'>
              {creditsMax > 0 ? `${creditsUsed} / ${creditsMax}` : '—'}
            </Text>
          </View>
          <View className='status-row'>
            <Text className='status-label'>今日剩余积分</Text>
            <Text className='status-value status-value--active'>
              {creditsMax > 0 ? `${creditsRemaining}` : '—'}
            </Text>
          </View>
        </View>
      )}

      {/* 订阅按钮 */}
      <View className='action-section'>
        {isPro ? (
          <View className='renew-tip'>
            <Text className='renew-tip-text'>会员生效中，可升档或续费</Text>
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
        <Text className='subscribe-hint'>到期后不自动续费 · 支持微信支付</Text>
      </View>

      {/* ============================================================ */}
      {/* TODO: [TEST] 以下测试区块在正式上线前必须删除 */}
      <View className='test-section'>
        <Text className='test-section-label'>
          [DEV] 测试工具 · 当前账号状态：{isPro ? '会员' : isTrial ? '试用' : '未开通'}
        </Text>
        <Text className='test-section-label'>
          [DEV] 当前模拟套餐：{selectedPlan?.name || '加载中'} · {selectedPlan?.daily_credits ?? 0} 积分 / 日
        </Text>
        <Button
          className='test-toggle-btn'
          loading={testLoading}
          disabled={testLoading || pageLoading}
          onClick={handleToggleTestMembership}
        >
          {isPro ? '切换为→ 非会员' : `切换为→ ${selectedPlan?.name || '会员'}`}
        </Button>
      </View>
      {/* TODO: [TEST] 测试区块结束 */}
      {/* ============================================================ */}
    </View>
  )
}

export default withAuth(ProMembershipPage)
