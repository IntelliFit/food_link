import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useCallback, useState } from 'react'
import {
  createMembershipPayment,
  getAccessToken,
  getMembershipPlans,
  getMyMembership,
  MembershipPlan,
  MembershipStatus
} from '../../utils/api'

import './index.scss'

const PRO_MEMBERSHIP_TEST_OPENID = 'oe4xm19XWerfUsnkIsd_7XWu_Q4A'

function formatDateTime(value?: string | null): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function getStatusText(status?: MembershipStatus['status']): string {
  switch (status) {
    case 'active':
      return '已开通'
    case 'expired':
      return '已过期'
    case 'cancelled':
      return '已取消'
    case 'inactive':
    default:
      return '未开通'
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default function ProMembershipPage() {
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
      const currentOpenid = String(Taro.getStorageSync('openid') || '')
      if (currentOpenid !== PRO_MEMBERSHIP_TEST_OPENID) {
        Taro.showToast({ title: '无权访问测试支付页', icon: 'none' })
        setTimeout(() => {
          Taro.navigateBack({ delta: 1 })
        }, 800)
        return
      }
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
    for (let index = 0; index < 8; index += 1) {
      await wait(1000)
      try {
        const latest = await getMyMembership()
        setMembership(latest)
        if (latest.is_pro || latest.status === 'active') {
          return true
        }
      } catch (error) {
        console.error('轮询会员状态失败:', error)
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
      content: `是否订阅一个月 Pro 会员，当前价格 ${plan.amount.toFixed(2)} 元？`,
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
    } catch (error: any) {
      const message = error?.errMsg || error?.message || ''
      if (String(message).includes('cancel')) {
        Taro.showToast({ title: '已取消支付', icon: 'none' })
      } else {
        Taro.showToast({ title: error.message || '支付失败', icon: 'none' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className='pro-membership-page'>
      <View className='membership-card'>
        <Text className='membership-title'>{plan?.name || 'Pro 月度会员'}</Text>
        <Text className='membership-price'>¥ {plan ? plan.amount.toFixed(2) : '0.01'} / 月</Text>
        <Text className='membership-desc'>
          {plan?.description || '默认测试价格 0.01 元/月'}
        </Text>
      </View>

      <View className='status-section'>
        <Text className='section-title'>当前订阅状态</Text>
        <View className='status-row'>
          <Text className='status-label'>会员状态</Text>
          <Text className='status-value'>{pageLoading ? '加载中...' : getStatusText(membership?.status)}</Text>
        </View>
        <View className='status-row'>
          <Text className='status-label'>会员注册时间</Text>
          <Text className='status-value'>{formatDateTime(membership?.first_activated_at)}</Text>
        </View>
        <View className='status-row'>
          <Text className='status-label'>当前到期时间</Text>
          <Text className='status-value'>{formatDateTime(membership?.expires_at)}</Text>
        </View>
      </View>

      <View className='action-section'>
        <Text className='section-title'>测试支付</Text>
        <Text className='action-tip'>
          点击下方按钮后会先弹出确认框，确认后拉起微信支付。支付完成后本页会自动刷新会员日期。
        </Text>
        <Button className='subscribe-btn' loading={loading} disabled={loading || !plan} onClick={handleSubscribe}>
          订阅 Pro 会员
        </Button>
      </View>
    </View>
  )
}
