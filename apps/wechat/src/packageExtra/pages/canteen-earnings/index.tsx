import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useRef, useState } from 'react'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { showUnifiedApiError } from '../../../utils/api'
import {
  getCaptureEarnings,
  newCaptureKey,
  redeemCaptureMembership,
  requestCaptureWithdrawal,
  type CaptureEarnings,
  type CaptureMembershipOption,
  type CaptureSession,
} from '../../../utils/canteen-capture-api'
import { formatYuan } from '../canteen-capture/capture-view'
import { ledgerLine, parseWithdrawCents, rulesText, sessionLine } from './earnings-view'
import './index.scss'

function CanteenEarningsPage() {
  const { scheme } = useAppColorScheme()
  const [earnings, setEarnings] = useState<CaptureEarnings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [withdrawInput, setWithdrawInput] = useState('')
  // A request key survives a failed attempt so a retry can never spend twice.
  const redeemKey = useRef(newCaptureKey('redeem'))
  const withdrawKey = useRef(newCaptureKey('withdraw'))

  const load = async () => {
    setLoading(true)
    try {
      setEarnings(await getCaptureEarnings())
    } catch (error) {
      await showUnifiedApiError(error, '读取奖励失败')
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f7faf8', darkBackground: '#0d1512' })
    void load()
  })

  const redeem = async (option: CaptureMembershipOption) => {
    if (busy) return
    const { confirm } = await Taro.showModal({
      title: `兑换${option.title || `${option.days}天会员`}`,
      content: `将使用 ¥${formatYuan(option.cost_cents)} 奖励，兑换后立即生效。`,
      confirmText: '兑换',
    })
    if (!confirm) return
    setBusy(option.code)
    try {
      setEarnings(await redeemCaptureMembership(option.code, redeemKey.current))
      redeemKey.current = newCaptureKey('redeem')
      Taro.showToast({ title: '兑换成功', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '兑换失败')
    } finally {
      setBusy('')
    }
  }

  const withdraw = async () => {
    if (!earnings || busy) return
    const cents = parseWithdrawCents(withdrawInput || formatYuan(earnings.totals.available_cents), earnings.totals.available_cents)
    if (cents < earnings.withdraw_min_cents) {
      Taro.showToast({ title: `至少 ¥${formatYuan(earnings.withdraw_min_cents)}，且不超过可用奖励`, icon: 'none' })
      return
    }
    const { confirm } = await Taro.showModal({
      title: `申请提现 ¥${formatYuan(cents)}`,
      content: '平台核对采集记录后打款到你的微信，处理期间这部分奖励会被冻结。',
      confirmText: '申请',
    })
    if (!confirm) return
    setBusy('withdraw')
    try {
      setEarnings(await requestCaptureWithdrawal(cents, withdrawKey.current))
      withdrawKey.current = newCaptureKey('withdraw')
      setWithdrawInput('')
      Taro.showToast({ title: '已提交申请', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '提现申请失败')
    } finally {
      setBusy('')
    }
  }

  const resume = (session: CaptureSession) => {
    if (session.status === 'submitted') return
    Taro.setStorageSync('canteen_capture_active_session', session.id)
    Taro.navigateTo({ url: extraPkgUrl('/pages/canteen-capture/index') })
  }

  const totals = earnings?.totals
  return (
    <View className={`earn-page ${scheme === 'dark' ? 'earn-page--dark' : ''}`}>
      <ScrollView scrollY className='earn-scroll' enhanced showScrollbar={false}>
        {loading && !earnings ? (
          <View className='earn-loading'><View className='earn-spinner' /></View>
        ) : earnings && totals ? (
          <>
            <View className='earn-card earn-balance'>
              <Text className='earn-label'>可用奖励</Text>
              <Text className='earn-amount'>¥{formatYuan(totals.available_cents)}</Text>
              <Text className='earn-meta'>
                已获奖励窗口 {totals.reward_windows} 个{totals.rate_pending_windows > 0 ? `（${totals.rate_pending_windows} 个待公布金额）` : ''}
              </Text>
              {(totals.spent_cents > 0 || totals.withdrawing_cents > 0 || totals.withdrawn_cents > 0) && (
                <Text className='earn-meta'>
                  已兑换 ¥{formatYuan(totals.spent_cents)} · 提现中 ¥{formatYuan(totals.withdrawing_cents)} · 已提现 ¥{formatYuan(totals.withdrawn_cents)}
                </Text>
              )}
              <View className='earn-primary' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/canteen-capture/index') })}>
                <Text>去采集窗口</Text>
              </View>
            </View>

            <View className='earn-card'>
              <Text className='earn-title'>奖励规则</Text>
              {rulesText(earnings).map(line => <Text key={line} className='earn-line'>{line}</Text>)}
            </View>

            <View className='earn-card'>
              <Text className='earn-title'>兑换会员</Text>
              {earnings.membership_options.length === 0 ? <Text className='earn-line'>会员兑换即将开放。</Text> : earnings.membership_options.map(option => (
                <View key={option.code} className='earn-row'>
                  <Text className='earn-row-title'>{option.title || `${option.days}天会员`} · ¥{formatYuan(option.cost_cents)}</Text>
                  <View className={`earn-action ${busy || totals.available_cents < option.cost_cents ? 'disabled' : ''}`} onClick={() => void redeem(option)}>
                    {busy === option.code ? <View className='earn-spinner earn-spinner--light' /> : <Text>兑换</Text>}
                  </View>
                </View>
              ))}
            </View>

            <View className='earn-card'>
              <Text className='earn-title'>提现</Text>
              {earnings.withdraw_min_cents <= 0 ? <Text className='earn-line'>提现即将开放。</Text> : <>
                <Text className='earn-line'>满 ¥{formatYuan(earnings.withdraw_min_cents)} 可申请，平台核对后打款到微信。</Text>
                <View className='earn-row'>
                  <Input className='earn-input' type='digit' placeholder={`最多 ${formatYuan(totals.available_cents)}`} value={withdrawInput}
                    onInput={event => setWithdrawInput(event.detail.value)}
                  />
                  <View className={`earn-action ${busy || totals.available_cents < earnings.withdraw_min_cents ? 'disabled' : ''}`} onClick={() => void withdraw()}>
                    {busy === 'withdraw' ? <View className='earn-spinner earn-spinner--light' /> : <Text>申请提现</Text>}
                  </View>
                </View>
              </>}
            </View>

            {earnings.entries.length > 0 && (
              <View className='earn-card'>
                <Text className='earn-title'>明细</Text>
                {earnings.entries.map(entry => {
                  const line = ledgerLine(entry)
                  return (
                    <View key={entry.id} className='earn-row'>
                      <View className='earn-row-main'>
                        <Text className='earn-row-title'>{line.title}</Text>
                        {line.status && <Text className='earn-row-sub'>{line.status}</Text>}
                      </View>
                      <Text className='earn-row-amount'>{line.amount}</Text>
                    </View>
                  )
                })}
              </View>
            )}

            {earnings.sessions.length > 0 && (
              <View className='earn-card'>
                <Text className='earn-title'>我采过的窗口 · {earnings.session_total}</Text>
                {earnings.sessions.map(session => (
                  <View key={session.id} className='earn-row' onClick={() => resume(session)}>
                    <View className='earn-row-main'>
                      <Text className='earn-row-title'>{session.window_name}</Text>
                      <Text className='earn-row-sub'>{[session.canteen_name, session.floor].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <Text className='earn-row-sub'>{sessionLine(session)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        ) : null}
        <View className='earn-safe-area' />
      </ScrollView>
    </View>
  )
}

export default withAuth(CanteenEarningsPage)
