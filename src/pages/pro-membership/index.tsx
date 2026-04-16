import { View, Text, Button, Input } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { Arrow, QuestionOutlined } from '@taroify/icons'
import '@taroify/icons/style'
import { useCallback, useMemo, useState } from 'react'
import {
  createPointsRechargePayment,
  getAccessToken,
  getMyMembership,
  MembershipStatus,
} from '../../utils/api'

import './index.scss'
import { withAuth } from '../../utils/withAuth'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** 仅保留数字，且不允许小数点；去掉前导零（保留单个 0） */
function sanitizeIntegerYuanInput(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  const n = parseInt(digits, 10)
  if (!Number.isFinite(n)) return ''
  return String(n)
}

function ProMembershipPage() {
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [rechargeYuan, setRechargeYuan] = useState('5')
  const [showRulesModal, setShowRulesModal] = useState(false)

  const pointsPerYuan = membership?.points_per_yuan ?? 20

  const rechargePreview = useMemo(() => {
    const y = parseInt(rechargeYuan || '0', 10)
    if (!Number.isFinite(y) || y <= 0) return { yuan: 0, points: 0 }
    return { yuan: y, points: Math.round(y * Number(pointsPerYuan)) }
  }, [rechargeYuan, pointsPerYuan])

  const loadData = useCallback(async () => {
    const token = getAccessToken()
    if (!token) {
      Taro.redirectTo({ url: '/pages/login/index' })
      return
    }

    setPageLoading(true)
    try {
      const currentMembership = await getMyMembership()
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

  const pollPointsIncreased = async (before: number) => {
    for (let i = 0; i < 10; i++) {
      await wait(1000)
      try {
        const latest = await getMyMembership()
        setMembership(latest)
        if (typeof latest.points_balance === 'number' && latest.points_balance > before) {
          return true
        }
      } catch (err) {
        console.error('轮询积分失败:', err)
      }
    }
    return false
  }

  const handlePointsRecharge = async () => {
    if (!membership || typeof membership.points_balance !== 'number' || loading) return
    const y = rechargePreview.yuan
    if (y < 1) {
      Taro.showToast({ title: '请输入至少 1 元的整数金额', icon: 'none' })
      return
    }
    const before = membership.points_balance
    const modalRes = await Taro.showModal({
      title: '确认充值',
      content: `支付 ¥${y} 元，预计到账 ${rechargePreview.points} 积分（以支付成功为准）。`,
      confirmText: '去支付',
      confirmColor: '#5cb896'
    })
    if (!modalRes.confirm) return

    setLoading(true)
    try {
      const payOrder = await createPointsRechargePayment(y)
      await Taro.requestPayment({
        timeStamp: payOrder.pay_params.timeStamp,
        nonceStr: payOrder.pay_params.nonceStr,
        package: payOrder.pay_params.package,
        signType: payOrder.pay_params.signType,
        paySign: payOrder.pay_params.paySign
      })
      Taro.showToast({ title: '支付已提交，正在确认到账', icon: 'none', duration: 2000 })
      const ok = await pollPointsIncreased(before)
      const latest = await getMyMembership().catch(() => null)
      if (latest) setMembership(latest)
      if (ok) {
        Taro.showToast({ title: '充值成功', icon: 'success' })
      } else {
        Taro.showModal({
          title: '到账可能有延迟',
          content: '若积分未更新，请稍后下拉刷新「我的」页或重新进入本页。',
          showCancel: false
        })
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

  const copyInviteCode = () => {
    const code = membership?.invite_code
    if (!code) {
      Taro.showToast({ title: '暂无邀请码', icon: 'none' })
      return
    }
    Taro.setClipboardData({
      data: code,
      success: () => Taro.showToast({ title: '已复制邀请码', icon: 'none' })
    })
  }

  const balanceKnown = membership && typeof membership.points_balance === 'number'
  const balanceText =
    pageLoading && !balanceKnown ? '…' : balanceKnown ? membership!.points_balance!.toFixed(1) : '—'

  return (
    <View className='membership-page membership-page--points'>
      <View className='hero-section'>
        <Text className='hero-title'>积分账户</Text>
        <Text className='hero-subtitle'>按次计费，充值后立即增加可用积分</Text>
      </View>

      <View className='points-balance-card'>
        <View className='points-balance-label-row'>
          <Text className='points-balance-label'>当前余额</Text>
          <View className='points-balance-help' onClick={() => setShowRulesModal(true)}>
            <QuestionOutlined className='points-balance-help-icon' />
            <Text className='points-balance-help-text'>积分计费规则</Text>
          </View>
        </View>
        <Text className='points-balance-value'>{balanceText}</Text>
      </View>

      <View className='recharge-card'>
        <Text className='recharge-title'>充值金额（元，整数）</Text>
        <View className='recharge-presets'>
          {['1', '5', '10', '20'].map(amt => (
            <View
              key={amt}
              className={`recharge-preset ${rechargeYuan === amt ? 'recharge-preset--active' : ''}`}
              onClick={() => setRechargeYuan(amt)}
            >
              <Text className='recharge-preset-text'>¥{amt}</Text>
            </View>
          ))}
        </View>
        <View className='recharge-input-row'>
          <Text className='recharge-input-prefix'>¥</Text>
          <Input
            className='recharge-input'
            type='digit'
            placeholder='输入整数元'
            value={rechargeYuan}
            onInput={e => setRechargeYuan(sanitizeIntegerYuanInput(e.detail.value))}
          />
        </View>
        <Text className='recharge-preview'>
          预计获得约 {rechargePreview.points} 积分
        </Text>
        <Button
          className='subscribe-btn'
          loading={loading}
          disabled={loading || pageLoading || !balanceKnown}
          onClick={handlePointsRecharge}
        >
          微信支付充值
        </Button>
        <Text className='subscribe-hint'>到账可能有数秒延迟，以微信支付结果为准</Text>
      </View>

      <View className='invite-card'>
        <View className='invite-row'>
          <View className='invite-text-wrap'>
            <Text className='invite-label'>我的邀请码</Text>
            <Text className='invite-code'>{membership?.invite_code || '—'}</Text>
            <Text className='invite-label-hint'>分享邀请码，好友注册双方各 +20 积分</Text>
          </View>
          <Button className='invite-copy-btn' size='mini' onClick={copyInviteCode}>
            复制
          </Button>
        </View>
      </View>

      {showRulesModal && (
        <View className='rules-modal' catchMove>
          <View className='rules-modal-mask' onClick={() => setShowRulesModal(false)} />
          <View className='rules-modal-content'>
            <View className='rules-modal-handle-bar' />
            <View className='rules-modal-header'>
              <Text className='rules-modal-title'>积分计费规则</Text>
            </View>
            <View className='rules-modal-body'>
              <Text className='rules-modal-line'>1分/次 · 标准分析</Text>
              <Text className='rules-modal-line'>2分/次 · 精准模式</Text>
              <Text className='rules-modal-line'>0.5分/次 · 运动估算</Text>
              <View className='rules-modal-divider' />
              <Text className='rules-modal-line'>新用户注册赠送 100 积分</Text>
              <Text className='rules-modal-line'>充值 1 元 = {pointsPerYuan} 积分（按整数元充值，按该比例兑换）</Text>
            </View>
            <View className='rules-modal-footer'>
              <View className='rules-modal-close-btn' onClick={() => setShowRulesModal(false)}>
                <Text className='rules-modal-close-text'>知道了</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(ProMembershipPage)
