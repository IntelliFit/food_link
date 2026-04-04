import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { ShieldOutlined } from '@taroify/icons'
import '@taroify/icons/style'
import { useCallback, useState } from 'react'
import {
  createMembershipPayment,
  getAccessToken,
  getMembershipPlans,
  getMyMembership,
  MembershipPlan,
  MembershipStatus,
  // TODO: [TEST] 正式上线前删除此导入
  toggleTestMembership,
} from '../../utils/api'

import './index.scss'
import { withAuth } from '../../utils/withAuth'

function formatExpiry(value?: string | null): string {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const FEATURES: Array<{ iconClass: string; free: string; pro: string }> = [
  { iconClass: 'icon-paizhao-xianxing', free: '每日3次拍照', pro: '每日20次拍照' },
  { iconClass: 'icon-jiesuo',           free: '标准识别模式', pro: '精准识别模式' },
  { iconClass: 'icon-shuben',           free: '—',           pro: '计划指导 + 强督促' },
  { iconClass: 'icon-shouxieqianming',  free: '基础分享海报', pro: '精美分享海报' },
]

function ProMembershipPage() {
  const [plan, setPlan] = useState<MembershipPlan | null>(null)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)

  const loadData = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }

    setPageLoading(true)
    try {
      const [plans, currentMembership] = await Promise.all([
        getMembershipPlans(),
        getMyMembership()
      ])
      const currentPlan = plans.find(item => item.code === 'pro_monthly') || plans[0] || null
      setPlan(currentPlan)
      setMembership(currentMembership)
    } catch (error: any) {
      Taro.showToast({ title: error.message || '加载失败', icon: 'none' })
    } finally {
      setPageLoading(false)
    }
  }, [])

  useDidShow(() => {
    loadData()
  })

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
    if (!plan || loading) return

    const modalRes = await Taro.showModal({
      title: '订阅确认',
      content: `订阅食探会员月度套餐，¥${plan.amount.toFixed(2)}/月，到期后需手动续费。`,
      confirmText: '确认支付',
      confirmColor: '#00bc7d'
    })
    if (!modalRes.confirm) return

    setLoading(true)
    try {
      const payOrder = await createMembershipPayment(plan.code)
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

  // ============================================================
  // TODO: [TEST] 以下测试逻辑在正式上线前必须删除
  const [testLoading, setTestLoading] = useState(false)

  const handleToggleTestMembership = async () => {
    setTestLoading(true)
    try {
      const result = await toggleTestMembership()
      const label = result.is_pro ? '✅ 已开启会员' : '⛔ 已关闭会员'
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
        <Text className='hero-subtitle'>解锁精准识别 · 每日更多次数 · 精美分享</Text>
      </View>

      {/* 特权对比 */}
      <View className='features-section'>
        <View className='features-header'>
          <View className='features-col-label features-col-free'>
            <Text className='col-label-text'>免费版</Text>
          </View>
          <View className='features-col-label features-col-pro'>
            <Text className='col-label-text'>食探会员</Text>
            <Text className='col-label-badge'>PRO</Text>
          </View>
        </View>
        {FEATURES.map((f, i) => (
          <View key={i} className='features-row'>
            <View className='features-row-icon'>
              <Text className={`iconfont ${f.iconClass} feature-icon-text`} />
            </View>
            <View className='features-col-free'>
              <Text className='feature-text feature-text--free'>{f.free}</Text>
            </View>
            <View className='features-col-pro'>
              <Text className='feature-text feature-text--pro'>{f.pro}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* 套餐卡片 */}
      <View className='plan-card'>
        <View className='plan-card-left'>
          <Text className='plan-name'>{plan?.name || '食探会员'}</Text>
          <Text className='plan-desc'>{plan?.description || '月度订阅，到期不自动续费'}</Text>
        </View>
        <View className='plan-card-right'>
          <Text className='plan-price'>
            <Text className='plan-price-symbol'>¥</Text>
            {pageLoading ? '--' : (plan?.amount?.toFixed(2) ?? '9.90')}
          </Text>
          <Text className='plan-period'>/月</Text>
        </View>
      </View>

      {/* 当前状态 */}
      {!pageLoading && membership && (
        <View className='status-card'>
          <View className='status-row'>
            <Text className='status-label'>当前状态</Text>
            <Text className={`status-value ${isPro ? 'status-value--active' : ''}`}>
              {isPro ? '会员有效' : '未开通'}
            </Text>
          </View>
          {isPro && (
            <>
              <View className='status-row'>
                <Text className='status-label'>到期时间</Text>
                <Text className='status-value'>{formatExpiry(membership.expires_at)}</Text>
              </View>
              <View className='status-row'>
                <Text className='status-label'>今日剩余次数</Text>
                <Text className='status-value status-value--active'>{membership.daily_remaining ?? 20} / {membership.daily_limit ?? 20} 次</Text>
              </View>
            </>
          )}
          {!isPro && (
            <View className='status-row'>
              <Text className='status-label'>今日免费次数</Text>
              <Text className='status-value'>{membership.daily_remaining ?? 3} / {membership.daily_limit ?? 3} 次</Text>
            </View>
          )}
        </View>
      )}

      {/* 订阅按钮 */}
      <View className='action-section'>
        {isPro ? (
          <View className='renew-tip'>
            <Text className='renew-tip-text'>会员生效中，到期后可在此续费</Text>
          </View>
        ) : null}
        <Button
          className={`subscribe-btn ${isPro ? 'subscribe-btn--renew' : ''}`}
          loading={loading}
          disabled={loading || !plan || pageLoading}
          onClick={handleSubscribe}
        >
          {pageLoading ? <View className='btn-spinner' /> : (isPro ? '续费一个月' : `¥${plan?.amount?.toFixed(2) ?? '9.90'} 立即开通`)}
        </Button>
        <Text className='subscribe-hint'>到期后不自动续费 · 支持微信支付</Text>
      </View>

      {/* ============================================================ */}
      {/* TODO: [TEST] 以下测试区块在正式上线前必须删除 */}
      <View className='test-section'>
        <Text className='test-section-label'>[DEV] 测试工具 · 当前账号状态：{isPro ? '会员' : '非会员'}</Text>
        <Button
          className='test-toggle-btn'
          loading={testLoading}
          disabled={testLoading || pageLoading}
          onClick={handleToggleTestMembership}
        >
          {isPro ? '切换为→ 非会员' : '切换为→ 会员'}
        </Button>
      </View>
      {/* TODO: [TEST] 测试区块结束 */}
      {/* ============================================================ */}
    </View>
  )
}

export default withAuth(ProMembershipPage)
