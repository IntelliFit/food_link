import { Button, ScrollView, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, useShareAppMessage } from '@tarojs/taro'
import { useRef, useState } from 'react'
import { withAuth } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { showUnifiedApiError } from '../../../utils/api'
import {
  applyPromoter,
  getPromoterCommissions,
  getPromoterMe,
  type PromoterCommission,
  type PromoterMe,
} from '../../../utils/promoter-api'
import { commissionLine, formatCents, formatRate, ruleLines, sharePath, statusCopy } from './promoter-view'
import './index.scss'

const PAGE_SIZE = 20
const APPLY_NOTE_MAX = 200

function PromoterCenterPage() {
  const { scheme } = useAppColorScheme()
  const [me, setMe] = useState<PromoterMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [commissions, setCommissions] = useState<PromoterCommission[]>([])
  const [commissionTotal, setCommissionTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [applyNote, setApplyNote] = useState('')
  const [applying, setApplying] = useState(false)
  const pageRef = useRef(1)

  const loadCommissions = async (page: number) => {
    const result = await getPromoterCommissions(page, PAGE_SIZE)
    pageRef.current = page
    setCommissionTotal(result.total)
    setCommissions(previous => (page === 1 ? result.items : [...previous, ...result.items]))
  }

  const load = async () => {
    setLoading(true)
    try {
      const next = await getPromoterMe()
      setMe(next)
      if (next.summary) await loadCommissions(1)
    } catch (error) {
      await showUnifiedApiError(error, '读取推广信息失败')
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f7faf8', darkBackground: '#0d1512' })
    void load()
  })

  useShareAppMessage(() => {
    const code = me?.promo_code
    if (!code) return { title: '食探：拍一拍，就知道吃了多少', path: '/pages/index/index' }
    return { title: '我在用食探记录饮食，拍照就能算热量，推荐你也试试', path: sharePath(code) }
  })

  const loadMore = async () => {
    if (loadingMore || commissions.length >= commissionTotal) return
    setLoadingMore(true)
    try {
      await loadCommissions(pageRef.current + 1)
    } catch (error) {
      await showUnifiedApiError(error, '读取佣金明细失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const apply = async () => {
    if (!me || applying) return
    if (!agreed) {
      Taro.showToast({ title: '请先阅读并同意推广规则', icon: 'none' })
      return
    }
    setApplying(true)
    try {
      setMe(await applyPromoter(me.agreement_version, applyNote.trim()))
      Taro.showToast({ title: '申请已提交', icon: 'success' })
    } catch (error) {
      await showUnifiedApiError(error, '提交申请失败')
    } finally {
      setApplying(false)
    }
  }

  const copyCode = (code: string) => {
    Taro.setClipboardData({ data: code }).catch(() => undefined)
  }

  const renderRules = (current: PromoterMe) => (
    <View className='promo-card'>
      <Text className='promo-title'>推广规则</Text>
      {ruleLines(current).map((line, index) => (
        <Text key={line} className='promo-line'>{index + 1}. {line}</Text>
      ))}
    </View>
  )

  const renderApply = (current: PromoterMe) => (
    <>
      <View className='promo-card promo-hero'>
        <Text className='promo-hero-title'>推荐食探，赚推广佣金</Text>
        <Text className='promo-hero-body'>
          好友通过你的推广码开通会员，你可获得实付金额 {formatRate(current.rate_bps)} 的佣金。
        </Text>
      </View>
      {renderRules(current)}
      <View className='promo-card'>
        <Text className='promo-title'>申请成为推广员</Text>
        <Textarea
          className='promo-textarea'
          maxlength={APPLY_NOTE_MAX}
          placeholder='选填：你打算在哪里推广（如校园社团、健身群）'
          value={applyNote}
          onInput={event => setApplyNote(event.detail.value)}
        />
        <View className='promo-agree' onClick={() => setAgreed(value => !value)}>
          <View className={`promo-check ${agreed ? 'promo-check--on' : ''}`} />
          <Text className='promo-agree-text'>我已阅读并同意以上推广规则（{current.agreement_version}）</Text>
        </View>
        <View className={`promo-primary ${applying ? 'disabled' : ''}`} onClick={() => void apply()}>
          {applying ? <View className='promo-spinner promo-spinner--light' /> : <Text>提交申请</Text>}
        </View>
      </View>
    </>
  )

  const renderPromoter = (current: PromoterMe) => {
    const summary = current.summary
    const code = current.promo_code
    return (
      <>
        {code && (
          <View className='promo-card promo-hero'>
            <Text className='promo-label'>我的推广码</Text>
            <View className='promo-code-row'>
              <Text className='promo-code'>{code}</Text>
              <View className='promo-ghost' onClick={() => copyCode(code)}><Text>复制</Text></View>
            </View>
            <Text className='promo-meta'>佣金比例 {formatRate(current.rate_bps)} · 分享链接打开即自动记录</Text>
            <Button className='promo-primary promo-share' openType='share'>分享给好友</Button>
          </View>
        )}
        {summary && (
          <View className='promo-card'>
            <Text className='promo-label'>可提现佣金</Text>
            <Text className='promo-amount'>¥{formatCents(summary.available_cents)}</Text>
            <View className='promo-stats'>
              <View className='promo-stat'>
                <Text className='promo-stat-value'>¥{formatCents(summary.pending_cents)}</Text>
                <Text className='promo-stat-label'>待结算</Text>
              </View>
              <View className='promo-stat'>
                <Text className='promo-stat-value'>¥{formatCents(summary.total_earned_cents)}</Text>
                <Text className='promo-stat-label'>累计结算</Text>
              </View>
              <View className='promo-stat'>
                <Text className='promo-stat-value'>{summary.invitee_count}</Text>
                <Text className='promo-stat-label'>推广用户</Text>
              </View>
              <View className='promo-stat'>
                <Text className='promo-stat-value'>{summary.paid_order_count}</Text>
                <Text className='promo-stat-label'>付费订单</Text>
              </View>
            </View>
            <Text className='promo-meta'>提现功能即将开放，佣金会一直为你保留。</Text>
          </View>
        )}
        <View className='promo-card'>
          <Text className='promo-title'>佣金明细</Text>
          {commissions.length === 0 ? (
            <Text className='promo-line'>还没有佣金记录。好友通过你的推广码开通会员后，会显示在这里。</Text>
          ) : commissions.map(item => {
            const line = commissionLine(item)
            return (
              <View key={item.id} className={`promo-row ${line.muted ? 'promo-row--muted' : ''}`}>
                <View className='promo-row-main'>
                  <Text className='promo-row-title'>{line.title}</Text>
                  <Text className='promo-row-sub'>{line.sub}</Text>
                </View>
                <View className='promo-row-side'>
                  <Text className='promo-row-amount'>{line.amount}</Text>
                  <Text className='promo-row-sub'>{line.status}</Text>
                </View>
              </View>
            )
          })}
          {commissions.length < commissionTotal && (
            <View className='promo-more' onClick={() => void loadMore()}>
              {loadingMore ? <View className='promo-spinner' /> : <Text>查看更多</Text>}
            </View>
          )}
        </View>
        {renderRules(current)}
      </>
    )
  }

  const renderBody = () => {
    if (loading && !me) return <View className='promo-loading'><View className='promo-spinner' /></View>
    if (!me) return null
    if (!me.enabled && me.status === 'none') {
      return (
        <View className='promo-card'>
          <Text className='promo-title'>推广计划暂未开放</Text>
          <Text className='promo-line'>开放后会在这里第一时间通知你。</Text>
        </View>
      )
    }
    const copy = statusCopy(me.status, me.review_note)
    return (
      <>
        {copy && (
          <View className={`promo-card promo-notice promo-notice--${me.status}`}>
            <Text className='promo-title'>{copy.title}</Text>
            <Text className='promo-line'>{copy.body}</Text>
          </View>
        )}
        {me.status === 'none' || me.status === 'rejected'
          ? renderApply(me)
          : me.status === 'pending_review'
            ? renderRules(me)
            : renderPromoter(me)}
      </>
    )
  }

  return (
    <View className={`promo-page ${scheme === 'dark' ? 'promo-page--dark' : ''}`}>
      <ScrollView scrollY className='promo-scroll' enhanced showScrollbar={false} onScrollToLower={() => void loadMore()}>
        {renderBody()}
        <View className='promo-safe-area' />
      </ScrollView>
    </View>
  )
}

export default withAuth(PromoterCenterPage)
