import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Bookmark, Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Copy, Crown, Edit3, Flag, Heart, Image as ImageIcon, Leaf, Lightbulb, Maximize2, MessageCircle, MoreHorizontal, NotebookPen, Plus, Search, Send, Share2, SlidersHorizontal, Star, Store, Trash2, UserRound, UtensilsCrossed, X, type LucideIcon } from 'lucide-react-native'
import {
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type CampusRelatedFeedItem,
  type CommunityFeedContext,
  type CommunityFeedTargetType,
  type ConversationSummary,
  type FeedCommentItem,
  type FriendBlockStatus,
  type ManualFoodItem,
  type MealType,
  type MembershipPaymentOrder,
  type MembershipPlan,
  type MembershipStatus,
  type Nutrients,
  type PrivateMessageItem,
  type PublicFoodComment,
  type PublicFoodItem,
  type RecipeItem,
} from '@food-link/core'
import { apiClient, getStoredUserId } from '../api'
import { AppButton } from '../components/AppButton'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'
import { emitHomeIntakeDataChangedEvent } from '../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../utils/home-dashboard-local-cache'
import { userFacingErrorMessage } from '../utils/errors'

const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
const SYSTEM_MESSAGE_USER_ID = '00000000-0000-0000-0000-000000000000'
const privateConversationPageSize = 20
const privateMessagePageSize = 20
const privateMessagePollMs = 3000
const loginLogoUrl = 'https://cdn-food-images.coachlink.fit/wechat/source-login-logo.png'

type MembershipTierKey = 'light' | 'standard' | 'advanced'
type MembershipPeriodKey = 'monthly' | 'quarterly' | 'yearly'

const membershipTierKeys: MembershipTierKey[] = ['light', 'standard', 'advanced']
const membershipPeriodKeys: MembershipPeriodKey[] = ['monthly', 'quarterly', 'yearly']
const membershipBaseTierDailyCredits: Record<MembershipTierKey, number> = {
  light: 8,
  standard: 20,
  advanced: 40,
}
const membershipTierMeta: Record<MembershipTierKey, { icon: LucideIcon; name: string; short: string; summary: string; precision: boolean; scene: string }> = {
  light: { icon: Leaf, name: '轻度版', short: '轻度', summary: '适合轻量记录，不含精准模式', precision: false, scene: '轻量记录' },
  standard: { icon: Star, name: '标准版', short: '标准', summary: '含精准模式，适合日常使用', precision: true, scene: '日常使用' },
  advanced: { icon: Crown, name: '进阶版', short: '进阶', summary: '含精准模式，适合高频使用', precision: true, scene: '高频使用' },
}
const membershipPeriodMeta: Record<MembershipPeriodKey, { label: string; unit: string }> = {
  monthly: { label: '月卡', unit: '/月' },
  quarterly: { label: '季卡', unit: '/季' },
  yearly: { label: '年卡', unit: '/年' },
}
const membershipPeriodWatermarks: Record<MembershipPeriodKey, string> = {
  monthly: '30',
  quarterly: '90',
  yearly: '365',
}

type PublicFoodReplyTarget = {
  parentCommentId: string
  replyToUserId: string
  nickname: string
}

export function MembershipCenterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { isDark } = useColorScheme()
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [plans, setPlans] = useState<MembershipPlan[]>([])
  const [lastOrder, setLastOrder] = useState<MembershipPaymentOrder | null>(null)
  const [selectedPlanCode, setSelectedPlanCode] = useState('')
  const [loading, setLoading] = useState(false)

  const sortedPlans = useMemo(() => plans.slice().sort((a, b) => {
    const orderDiff = (a.sort_order || 0) - (b.sort_order || 0)
    return orderDiff || (a.amount || 0) - (b.amount || 0)
  }), [plans])

  const selectedPlan = useMemo(
    () => sortedPlans.find((plan) => plan.code === selectedPlanCode) || sortedPlans[0],
    [selectedPlanCode, sortedPlans],
  )

  const currentPlan = useMemo(
    () => sortedPlans.find((plan) => plan.code === membership?.current_plan_code),
    [membership?.current_plan_code, sortedPlans],
  )

  const creditsMax = numericValue(membership?.daily_credits_max ?? membership?.daily_limit)
  const creditsUsed = numericValue(membership?.daily_credits_used ?? membership?.daily_used)
  const totalAvailable = numericValue(membership?.total_credits_available ?? membership?.daily_credits_remaining ?? membership?.daily_remaining)
  const founderMultiplier = numericValue(membership?.early_user_paid_bonus_multiplier)
  const founderEligible = Boolean(membership?.early_user_paid_bonus_eligible && founderMultiplier > 1)
  const isPro = Boolean(membership?.is_pro)
  const isTrial = Boolean(membership?.trial_active)
  const trialDaysTotal = numericValue(membership?.trial_days_total)
  const trialPolicy = String(membership?.trial_policy || '')
  const isTop500Trial = isTrial && trialPolicy === 'founding_top_500_bonus_month'
  const isEarlyTrial = isTrial && (trialPolicy === 'founding_top_500_bonus_month' || trialPolicy === 'early_first_1000' || trialDaysTotal >= 30)
  const earlyUserRank = membership?.early_user_rank ?? null
  const earlyUserLimit = numericValue(membership?.early_user_limit) || 1000
  const earlyPaidUserLimit = numericValue(membership?.early_paid_user_limit) || 100
  const systemCreditsRemaining = numericValue(membership?.system_credits_remaining ?? Math.max(creditsMax - creditsUsed, 0))
  const earnedCreditsBalance = numericValue(membership?.earned_credits_balance)
  const creditsBase = numericValue(membership?.daily_credits_base)
  const bonusCredits = numericValue(membership?.daily_bonus_credits)
  const inviteBonusCredits = numericValue(membership?.invite_bonus_credits)
  const shareBonusCredits = numericValue(membership?.share_bonus_credits)
  const paidBonusActive = Boolean(membership?.early_user_paid_bonus_active)
  const selectedTier = membershipPlanTierKey(selectedPlan)
  const selectedPeriod = membershipPlanPeriodKey(selectedPlan)
  const availableTierKeys = useMemo(() => {
    const tiers = membershipTierKeys.filter((tier) => sortedPlans.some((plan) => membershipPlanTierKey(plan) === tier))
    return tiers.length ? tiers : membershipTierKeys
  }, [sortedPlans])
  const availablePeriodKeys = useMemo(() => {
    const periods = membershipPeriodKeys.filter((period) => (
      sortedPlans.some((plan) => membershipPlanTierKey(plan) === selectedTier && membershipPlanPeriodKey(plan) === period)
    ))
    return periods.length ? periods : membershipPeriodKeys
  }, [selectedTier, sortedPlans])
  const monthlyPlanForTier = useMemo(
    () => findMembershipPlan(sortedPlans, selectedTier, 'monthly') || null,
    [selectedTier, sortedPlans],
  )

  const selectTier = (tier: MembershipTierKey) => {
    const next = findMembershipPlan(sortedPlans, tier, selectedPeriod) || sortedPlans.find((plan) => membershipPlanTierKey(plan) === tier)
    if (next) setSelectedPlanCode(next.code)
  }

  const selectPeriod = (period: MembershipPeriodKey) => {
    const next = findMembershipPlan(sortedPlans, selectedTier, period) || sortedPlans.find((plan) => membershipPlanPeriodKey(plan) === period)
    if (next) setSelectedPlanCode(next.code)
  }

  const tierCreditsDisplay = useMemo<Record<MembershipTierKey, number>>(() => {
    const multiplier = founderEligible ? Math.max(founderMultiplier, 1) : 1
    return membershipTierKeys.reduce((acc, tier) => {
      const planForTier = findMembershipPlan(sortedPlans, tier, selectedPeriod) || sortedPlans.find((plan) => membershipPlanTierKey(plan) === tier)
      const baseCredits = numericValue(planForTier?.daily_credits) || membershipBaseTierDailyCredits[tier]
      acc[tier] = Math.round(baseCredits * multiplier)
      return acc
    }, {} as Record<MembershipTierKey, number>)
  }, [founderEligible, founderMultiplier, selectedPeriod, sortedPlans])

  const tierFeatureRows = useMemo(() => ([
    {
      label: '每日积分',
      values: {
        light: `${tierCreditsDisplay.light} 积分`,
        standard: `${tierCreditsDisplay.standard} 积分`,
        advanced: `${tierCreditsDisplay.advanced} 积分`,
      },
    },
    {
      label: '精准模式',
      values: {
        light: membershipTierMeta.light.precision ? '支持' : '不支持',
        standard: membershipTierMeta.standard.precision ? '支持' : '不支持',
        advanced: membershipTierMeta.advanced.precision ? '支持' : '不支持',
      },
    },
    {
      label: '适合频率',
      values: {
        light: membershipTierMeta.light.scene,
        standard: membershipTierMeta.standard.scene,
        advanced: membershipTierMeta.advanced.scene,
      },
    },
  ]), [tierCreditsDisplay])

  const actionButtonText = useMemo(() => {
    if (!selectedPlan) return '暂无可购买套餐'
    const price = `¥${money(selectedPlan.amount)}`
    if (!membership?.is_pro) return `微信小程序开通 · ${price}`
    if (membership.current_plan_code === selectedPlan.code) return `微信小程序续费 · ${price}`
    const nextTierLabel = membershipTierMeta[selectedTier]?.name || '会员'
    return `微信小程序升级${nextTierLabel} · ${price}`
  }, [membership?.current_plan_code, membership?.is_pro, selectedPlan, selectedTier])

  const savingsAmount = useMemo(() => {
    if (!selectedPlan) return null
    if (selectedPlan.savings != null && numericValue(selectedPlan.savings) > 0) return numericValue(selectedPlan.savings)
    if (selectedPeriod !== 'monthly' && monthlyPlanForTier) {
      const original = numericValue(monthlyPlanForTier.amount) * numericValue(selectedPlan.duration_months)
      const diff = original - numericValue(selectedPlan.amount)
      return diff > 0 ? Number(diff.toFixed(2)) : null
    }
    return null
  }, [monthlyPlanForTier, selectedPeriod, selectedPlan])

  const perMonthDisplay = useMemo(() => {
    if (!selectedPlan || numericValue(selectedPlan.duration_months) <= 1) return null
    return (numericValue(selectedPlan.amount) / numericValue(selectedPlan.duration_months)).toFixed(1)
  }, [selectedPlan])

  const originalAmountDisplay = useMemo(() => {
    if (!selectedPlan?.original_amount || numericValue(selectedPlan.original_amount) <= numericValue(selectedPlan.amount)) return null
    return money(selectedPlan.original_amount)
  }, [selectedPlan])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [membershipData, planData] = await Promise.all([
        apiClient.getMyMembership().catch(() => null),
        apiClient.listMembershipPlans().catch(() => ({ list: [] as MembershipPlan[] })),
      ])
      const nextPlans = (planData.list || []).slice().sort((a, b) => {
        const orderDiff = (a.sort_order || 0) - (b.sort_order || 0)
        return orderDiff || (a.amount || 0) - (b.amount || 0)
      })
      setMembership(membershipData)
      setPlans(nextPlans)
      setSelectedPlanCode((current) => {
        if (current && nextPlans.some((plan) => plan.code === current)) return current
        if (membershipData?.current_plan_code && nextPlans.some((plan) => plan.code === membershipData.current_plan_code)) {
          return membershipData.current_plan_code
        }
        return findMembershipPlan(nextPlans, 'standard', 'yearly')?.code || nextPlans[0]?.code || ''
      })
    } catch (error) {
      showError('获取会员中心失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const previewPayment = () => {
    if (!selectedPlan) {
      Alert.alert('请选择套餐', '当前暂无可购买套餐，请刷新后重试。')
      return
    }
    Alert.alert(
      '请在微信小程序完成支付',
      [
        `套餐：${selectedPlan.name}`,
        `权益：${planPeriodText(selectedPlan)} · 每日 ${selectedPlan.daily_credits || 0} 系统积分`,
        `金额：¥${money(selectedPlan.amount)}`,
        paymentModePreview(membership, selectedPlan),
        '',
        '当前 App 不会创建订单或发起扣款。请打开 Food Link 微信小程序，在“我的 → 食探会员”完成开通、续费或升级。',
      ].filter(Boolean).join('\n'),
      [
        { text: '知道了' },
      ],
    )
  }

  const syncOrder = async () => {
    if (!lastOrder?.order_no) return
    setLoading(true)
    try {
      await apiClient.syncMembershipPayment(lastOrder.order_no)
      await load()
      Alert.alert('已同步', '订单状态已刷新')
    } catch (error) {
      showError('同步订单失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={[styles.membershipPage, isDark ? styles.membershipPageDark : null]}>
      <ScrollView
        style={styles.membershipScroll}
        contentContainerStyle={[styles.membershipPageContent, { paddingBottom: Math.max(insets.bottom, 16) + 40 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={isDark ? '#7dd3b0' : '#00bc7d'} colors={[isDark ? '#7dd3b0' : '#00bc7d']} />}
      >
      <View style={styles.membershipHero}>
        <View style={styles.membershipHeroEmblemRow} accessible={false} importantForAccessibility="no-hide-descendants">
          <Leaf size={27} color="rgba(218,230,220,0.34)" style={styles.membershipHeroLaurelLeft} />
          <View style={styles.membershipHeroIconShell}>
            <View style={styles.membershipHeroIconHalo} />
            <View style={styles.membershipHeroIconWrap}>
              <Star size={30} color="#f7fff8" strokeWidth={2.6} />
            </View>
          </View>
          <Leaf size={27} color="rgba(218,230,220,0.34)" style={styles.membershipHeroLaurelRight} />
        </View>
        <Text style={styles.membershipHeroTitle}>食探会员</Text>
        <Text style={styles.membershipHeroSubtitle}>
          {founderEligible ? `创始用户礼遇，开通后每日积分 x${founderMultiplier}` : '按使用强度选套餐，轻度版不含精准模式'}
        </Text>
        {founderEligible ? (
          <View style={styles.membershipFounderBadge}>
            <Text style={styles.membershipFounderBadgeText}>创始用户礼遇：会员积分 x{founderMultiplier}</Text>
          </View>
        ) : null}
        <View style={styles.membershipCreditsPanel}>
          {membership ? (
            isPro || isTrial ? (
              <>
                <Text style={styles.membershipCreditsLabel}>
                  {isTrial ? '试用权益 · 今日已用积分' : paidBonusActive ? `创始会员积分 x${founderMultiplier} · 今日已用积分` : '今日已用积分'}
                </Text>
                <View style={styles.membershipCreditsValueRow}>
                  <Text style={styles.membershipCreditsValue}>{creditsUsed}</Text>
                  <Text style={styles.membershipCreditsTotal}>/ {creditsMax}</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.membershipCreditsLabel}>选择适合你的套餐</Text>
                <View style={styles.membershipCreditsPill}>
                  <Text style={styles.membershipCreditsTip}>
                    {founderEligible ? `你属于创始用户礼遇，开通后每日按套餐积分 x${founderMultiplier} 发放` : '开通后每日发放系统积分，次日刷新；奖励积分可累计'}
                  </Text>
                </View>
              </>
            )
          ) : (
            <ActivityIndicator color="#cbffd0" />
          )}
        </View>
      </View>

      <View style={styles.membershipSectionHead}>
        <Text style={[styles.membershipSectionTitle, isDark ? styles.membershipSectionTitleDark : null]}>选择档位</Text>
        <Text style={[styles.membershipSectionHint, isDark ? styles.membershipSectionHintDark : null]}>系统积分次日刷新，奖励积分可累计</Text>
      </View>
      <View style={styles.membershipTierGrid}>
        {availableTierKeys.map((tier) => {
          const active = selectedTier === tier
          const planForTier = findMembershipPlan(sortedPlans, tier, selectedPeriod) || sortedPlans.find((plan) => membershipPlanTierKey(plan) === tier)
          const isCurrent = Boolean(membership?.is_pro && planForTier?.code === membership.current_plan_code)
          const meta = membershipTierMeta[tier]
          const TierIcon = meta.icon
          return (
            <Pressable
              key={tier}
              style={({ pressed }) => [
                styles.membershipTierCard,
                active ? styles.membershipTierCardActive : null,
                isDark ? styles.membershipTierCardDark : null,
                active && isDark ? styles.membershipTierCardActiveDark : null,
                pressed ? styles.membershipPressed : null,
              ]}
              onPress={() => selectTier(tier)}
              disabled={!planForTier}
              accessibilityRole="radio"
              accessibilityLabel={meta.name + '，每日 ' + tierCreditsDisplay[tier] + ' 积分，' + meta.summary}
              accessibilityState={{ checked: active, disabled: !planForTier }}
            >
              {isCurrent ? <Text style={styles.membershipTierBadge}>当前</Text> : tier === 'advanced' ? <Text style={styles.membershipTierBadge}>高配</Text> : null}
              <View style={styles.membershipTierHead}>
                <TierIcon size={16} color={isDark ? '#7dd3b0' : '#00bc7d'} strokeWidth={2.4} />
                <Text style={[styles.membershipTierName, isDark ? styles.membershipTierNameDark : null]}>{meta.name}</Text>
              </View>
              <Text style={[styles.membershipTierCredits, isDark ? styles.membershipTierCreditsDark : null]}>{tierCreditsDisplay[tier]}</Text>
              <Text style={[styles.membershipTierUnit, isDark ? styles.membershipTierUnitDark : null]}>积分 / 日</Text>
              <Text style={[styles.membershipTierSummary, isDark ? styles.membershipTierSummaryDark : null]}>{meta.summary || planForTier?.description}</Text>
            </Pressable>
          )
        })}
      </View>

      <View style={styles.membershipSectionHead}>
        <Text style={[styles.membershipSectionTitle, isDark ? styles.membershipSectionTitleDark : null]}>选择周期</Text>
        <Text style={[styles.membershipSectionHint, isDark ? styles.membershipSectionHintDark : null]}>{membership?.is_pro ? '随时可升级档位' : '长期订阅更划算'}</Text>
      </View>
      <View style={styles.membershipPeriodTabs}>
        {availablePeriodKeys.map((period) => {
          const active = selectedPeriod === period
          const planForPeriod = findMembershipPlan(sortedPlans, selectedTier, period)
          const periodSavings = planForPeriod?.savings != null
            ? numericValue(planForPeriod.savings)
            : period !== 'monthly' && monthlyPlanForTier && planForPeriod
              ? Math.max(0, numericValue(monthlyPlanForTier.amount) * numericValue(planForPeriod.duration_months) - numericValue(planForPeriod.amount))
              : 0
          const saveText = periodSavings > 0 ? `立省¥${money(periodSavings)}` : ''
          return (
            <Pressable
              key={period}
              style={({ pressed }) => [
                styles.membershipPeriodTab,
                active ? styles.membershipPeriodTabActive : null,
                isDark ? styles.membershipPeriodTabDark : null,
                active && isDark ? styles.membershipPeriodTabActiveDark : null,
                pressed ? styles.membershipPressed : null,
              ]}
              onPress={() => selectPeriod(period)}
              disabled={!planForPeriod}
              accessibilityRole="radio"
              accessibilityLabel={membershipPeriodMeta[period].label + '，' + (planForPeriod ? '¥' + money(planForPeriod.amount) + membershipPeriodMeta[period].unit : '暂无套餐')}
              accessibilityState={{ checked: active, disabled: !planForPeriod }}
            >
              {period === 'yearly' && planForPeriod?.savings ? <Text style={styles.membershipPeriodRecommend}>推荐</Text> : null}
              <Text style={[styles.membershipPeriodLabel, isDark ? styles.membershipPeriodLabelDark : null]}>{membershipPeriodMeta[period].label}</Text>
              <Text style={[styles.membershipPeriodPrice, isDark ? styles.membershipPeriodPriceDark : null]}>
                ¥{planForPeriod ? money(planForPeriod.amount) : '--'}
                <Text style={[styles.membershipPeriodUnit, isDark ? styles.membershipPeriodUnitDark : null]}>{membershipPeriodMeta[period].unit}</Text>
              </Text>
              {membership?.is_pro && planForPeriod?.code === membership.current_plan_code ? (
                <Text style={[styles.membershipPeriodCurrent, isDark ? styles.membershipPeriodCurrentDark : null]}>当前周期</Text>
              ) : saveText ? (
                <Text style={[styles.membershipPeriodSave, isDark ? styles.membershipPeriodSaveDark : null]}>{saveText}</Text>
              ) : null}
              <Text style={[styles.membershipPeriodWatermark, isDark ? styles.membershipPeriodWatermarkDark : null]}>{membershipPeriodWatermarks[period]}</Text>
            </Pressable>
          )
        })}
      </View>

      {selectedPlan ? (
        <View style={[styles.membershipPlanSummary, isDark ? styles.membershipPlanSummaryDark : null]}>
          <View style={styles.flex}>
            <Text style={[styles.membershipPlanName, isDark ? styles.membershipPlanNameDark : null]}>{selectedPlan.name}</Text>
            <Text style={[styles.membershipPlanDesc, isDark ? styles.membershipPlanDescDark : null]}>
              {founderEligible
                ? `创始用户开通后每日 ${tierCreditsDisplay[selectedTier]} 系统积分 · ${membershipTierMeta[selectedTier]?.summary || selectedPlan.description || '系统积分次日刷新，奖励积分另计累计'}`
                : membershipTierMeta[selectedTier]?.summary || selectedPlan.description || `${planTierText(selectedPlan.tier)} · 每日 ${selectedPlan.daily_credits || 0} 系统积分`}
            </Text>
            {perMonthDisplay ? <Text style={[styles.membershipPlanMeta, isDark ? styles.membershipPlanMetaDark : null]}>≈ ¥{perMonthDisplay} / 月</Text> : null}
            {savingsAmount ? (
              <View style={styles.membershipPlanSaveTag}>
                <Text style={styles.membershipPlanSaveTagText}>立省 ¥{money(savingsAmount)}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.membershipPlanPriceBlock}>
            <Text style={[styles.membershipPlanPrice, isDark ? styles.membershipPlanPriceDark : null]}>¥{money(selectedPlan.amount)}</Text>
            <Text style={[styles.membershipPlanPeriod, isDark ? styles.membershipPlanPeriodDark : null]}>{membershipPeriodMeta[selectedPeriod].unit}</Text>
            {originalAmountDisplay ? (
              <Text style={[styles.membershipPlanOriginalPrice, isDark ? styles.membershipPlanOriginalPriceDark : null]}>原价 ¥{originalAmountDisplay}{membershipPeriodMeta[selectedPeriod].unit}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={[styles.membershipFeaturesCard, isDark ? styles.membershipFeaturesCardDark : null]}>
        <View style={[styles.membershipFeaturesHeader, isDark ? styles.membershipFeaturesHeaderDark : null]}>
          {membershipTierKeys.map((tier) => (
            <View
              key={tier}
              style={[styles.membershipFeaturesHeadCell, selectedTier === tier ? styles.membershipFeaturesHeadCellActive : null, selectedTier === tier && isDark ? styles.membershipFeaturesHeadCellActiveDark : null]}
            >
              <Text style={[styles.membershipFeaturesHeadText, isDark ? styles.membershipFeaturesHeadTextDark : null]}>{membershipTierMeta[tier].short}</Text>
            </View>
          ))}
        </View>
        {tierFeatureRows.map((row) => (
          <View key={row.label} style={[styles.membershipFeaturesRow, isDark ? styles.membershipFeaturesRowDark : null]}>
            <View style={[styles.membershipFeaturesLabelCell, isDark ? styles.membershipFeaturesLabelCellDark : null]}>
              <Text style={[styles.membershipFeaturesLabelText, isDark ? styles.membershipFeaturesLabelTextDark : null]}>{row.label}</Text>
            </View>
            {membershipTierKeys.map((tier) => (
              <View
                key={tier}
                style={[styles.membershipFeaturesValueCell, selectedTier === tier ? styles.membershipFeaturesValueCellActive : null, selectedTier === tier && isDark ? styles.membershipFeaturesValueCellActiveDark : null]}
              >
                <Text style={[styles.membershipFeaturesValueText, isDark ? styles.membershipFeaturesValueTextDark : null]}>{row.values[tier]}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      <Text style={[styles.membershipFeaturesFootnote, isDark ? styles.membershipFeaturesFootnoteDark : null]}>当前对比表只展示已真实上线的差异；后续新能力上线后再补充说明。</Text>

      <View style={[styles.membershipCreditsHintCard, isDark ? styles.membershipCreditsHintCardDark : null]}>
        <View style={styles.membershipCreditsHintHeading}>
          <Lightbulb size={16} color={isDark ? '#fde68a' : '#92400e'} strokeWidth={2.3} />
          <Text style={[styles.membershipCreditsHintTitle, isDark ? styles.membershipCreditsHintTitleDark : null]}>积分消耗</Text>
        </View>
        <Text style={[styles.membershipCreditsHintItem, isDark ? styles.membershipCreditsHintItemDark : null]}>· 创始用户礼遇：前 1000 名注册用户或前 100 名付费用户，开通会员后每日套餐积分翻倍</Text>
        <Text style={[styles.membershipCreditsHintItem, isDark ? styles.membershipCreditsHintItemDark : null]}>· 运动记录：1 积分 / 次</Text>
        <Text style={[styles.membershipCreditsHintItem, isDark ? styles.membershipCreditsHintItemDark : null]}>· 基础记录 / 基础分析：2 积分 / 次</Text>
        <Text style={[styles.membershipCreditsHintItem, isDark ? styles.membershipCreditsHintItemDark : null]}>· 精准模式：4 积分 / 次</Text>
        <Text style={[styles.membershipCreditsHintItem, styles.membershipCreditsHintItemMuted, isDark ? styles.membershipCreditsHintItemMutedDark : null]}>· 系统积分每日发放，次日 00:00 刷新；邀请、分享等奖励积分累计不清零</Text>
        <Text style={[styles.membershipCreditsHintItem, isDark ? styles.membershipCreditsHintItemDark : null]}>· 邀请好友：新朋友在 7 天内完成 2 个自然日有效使用后，邀请人得 7 天轻度版、新朋友得 3 天轻度版；奖励需手动启用</Text>
        <Text style={[styles.membershipCreditsHintItem, isDark ? styles.membershipCreditsHintItemDark : null]}>· 分享海报成功：每日奖励 1 积分，转入累计余额</Text>
      </View>

      {membership ? (
        <View style={[styles.membershipStatusCard, isDark ? styles.membershipStatusCardDark : null]}>
          <MembershipStatusRow label="当前状态" value={membershipStatusText(membership)} active={isPro || isTrial} />
          {founderEligible ? (
            <>
              <MembershipStatusRow label="创始用户编号" value={earlyUserRank ? `注册第 ${earlyUserRank} / ${earlyUserLimit} 位` : `前 ${earlyUserLimit} 注册用户 / 前 ${earlyPaidUserLimit} 付费用户`} />
              <MembershipStatusRow
                label="创始礼遇"
                value={`付费会员积分 x${founderMultiplier}${paidBonusActive ? '（已生效）' : '（开通后生效）'}`}
                active
              />
            </>
          ) : null}
          {isPro ? (
            <>
              <MembershipStatusRow label="当前套餐" value={currentPlan?.name || membership.current_plan_code || '--'} />
              <MembershipStatusRow label="到期时间" value={dateText(membership.expires_at)} />
              <MembershipStatusRow label="精准模式" value={membershipTierMeta[membershipPlanTierKey(currentPlan)].precision ? '已解锁' : '当前套餐不含，升级标准版/进阶版可解锁'} />
            </>
          ) : null}
          {isTrial ? (
            <>
              <MembershipStatusRow label="试用权益" value={isTop500Trial ? '前 500 用户免费 2 个月' : isEarlyTrial ? '前 1000 用户免费 1 个月' : '新用户免费 3 天'} />
              <MembershipStatusRow label="试用截止" value={dateText(membership.trial_expires_at)} />
            </>
          ) : null}
          <MembershipStatusRow label="今日已用积分" value={creditsMax > 0 ? `${creditsUsed} / ${creditsMax}` : '--'} active />
          <MembershipStatusRow label="系统积分 / 今日入账" value={creditsMax > 0 ? `${creditsBase} / ${bonusCredits}` : '--'} />
          {bonusCredits > 0 ? (
            <MembershipStatusRow label="奖励明细" value={`邀请 +${inviteBonusCredits} · 海报 +${shareBonusCredits}`} />
          ) : null}
          <MembershipStatusRow label="系统剩余积分" value={creditsMax > 0 ? `${systemCreditsRemaining}` : '--'} active />
          <MembershipStatusRow label="累计奖励余额" value={`${earnedCreditsBalance}`} />
          <MembershipStatusRow label="当前总可用积分" value={`${totalAvailable}`} active />
        </View>
      ) : null}

      {selectedPlan ? (
        <View style={styles.membershipSubscribeSection}>
          {isPro ? (
            <Text style={[styles.membershipRenewTip, isDark ? styles.membershipRenewTipDark : null]}>
              {paidBonusActive ? `创始用户权益已生效，当前会员积分 x${founderMultiplier}` : '会员生效中，可升档或续费'}
            </Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.membershipSubscribeButton,
              isPro ? styles.membershipSubscribeButtonRenew : null,
              loading ? styles.membershipSubscribeButtonDisabled : null,
              pressed ? styles.membershipPressed : null,
            ]}
            disabled={loading}
            onPress={previewPayment}
            accessibilityRole="button"
            accessibilityLabel={actionButtonText}
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.membershipSubscribeButtonText}>{actionButtonText}</Text>
            )}
          </Pressable>
          <Text style={[styles.membershipSubscribeHint, isDark ? styles.membershipSubscribeHintDark : null]}>
            {paymentModePreview(membership, selectedPlan)} · 到期后不自动续费
          </Text>
        </View>
      ) : null}

      <View style={styles.membershipActionRow}>
        <MembershipLinkButton label="自动续费审核" onPress={() => navigation.navigate('AutoRenewAudit')} />
        <MembershipLinkButton label="会员协议" onPress={() => navigation.navigate('MembershipAgreement')} />
      </View>

      {lastOrder ? (
        <View style={[styles.membershipStatusCard, isDark ? styles.membershipStatusCardDark : null]}>
          <Text style={[styles.membershipInfoCardTitle, isDark ? styles.membershipInfoCardTitleDark : null]}>最近订单</Text>
          <MembershipStatusRow label="订单号" value={lastOrder.order_no} />
          <MembershipStatusRow label="订单状态" value={paymentStatusText(lastOrder.status)} />
          <MembershipStatusRow label="订单类型" value={orderModeText(lastOrder.order_mode)} />
          <MembershipStatusRow label="套餐" value={planName(lastOrder.plan_code, sortedPlans)} />
          <MembershipStatusRow label="应付金额" value={`¥${money(lastOrder.amount)}`} active />
          {lastOrder.original_amount != null && Number(lastOrder.original_amount) !== Number(lastOrder.amount) ? (
            <MembershipStatusRow label="套餐原价" value={`¥${money(lastOrder.original_amount)}`} />
          ) : null}
          <MembershipStatusRow label="支付参数" value={lastOrder.pay_params ? '已生成' : '未生成'} />
          <UpgradeTermsBlock order={lastOrder} />
          <View style={styles.buttonRow}>
            <MembershipLinkButton label="同步状态" onPress={syncOrder} />
          </View>
        </View>
      ) : null}
      </ScrollView>
    </View>
  )
}

export function RecipesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [recipes, setRecipes] = useState<RecipeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [mealSheetRecipe, setMealSheetRecipe] = useState<RecipeItem | null>(null)
  const [mealSheetValue, setMealSheetValue] = useState<MealType>(inferDefaultMealTypeFromLocalTime())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.listRecipes({ isFavorite: true })
      setRecipes(data.recipes || [])
    } catch (error) {
      showError('获取食谱失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const useRecipe = async (recipe: RecipeItem, selectedMealType: MealType) => {
    setLoading(true)
    try {
      const result = await apiClient.useRecipe(recipe.id, selectedMealType)
      const date = todayKey()
      await refreshHomeDashboardLocalSnapshotFromCloud(date)
      emitHomeIntakeDataChangedEvent({ date, force: true })
      setMealSheetRecipe(null)
      if (!result.record_id) {
        Alert.alert('已记录', '食谱已写入今日饮食记录', [
          { text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) },
        ])
        return
      }
      Alert.alert('已记录', '食谱已写入今日饮食记录', [
        { text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) },
        { text: '查看记录', onPress: () => navigation.navigate('RecordDetail', { recordId: result.record_id }) },
      ])
    } catch (error) {
      showError('使用食谱失败', error)
    } finally {
      setLoading(false)
    }
  }

  const openUseRecipe = (recipe: RecipeItem) => {
    setMealSheetValue(normalizeMealType(recipe.meal_type) || inferDefaultMealTypeFromLocalTime())
    setMealSheetRecipe(recipe)
  }

  const closeMealSheet = () => {
    if (!loading) setMealSheetRecipe(null)
  }

  const confirmMealSheet = () => {
    if (mealSheetRecipe) void useRecipe(mealSheetRecipe, mealSheetValue)
  }

  const removeRecipe = (recipe: RecipeItem) => {
    Alert.alert('删除食谱', `确定要删除食谱"${recipe.recipe_name || '未命名食谱'}"吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setLoading(true)
          try {
            await apiClient.deleteRecipe(recipe.id)
            await load()
          } catch (error) {
            showError('删除食谱失败', error)
          } finally {
            setLoading(false)
          }
        },
      },
    ])
  }

  return (
    <View style={styles.recipesPage}>
      <View style={styles.recipesPageHeader}>
        <View style={styles.recipesHeaderCopy}>
          <Text style={styles.recipesPageTitle}>我的收藏</Text>
          <Text style={styles.recipesPageSubtitle}>这里会显示你收藏过的餐食，方便之后快速记录。</Text>
        </View>
      </View>

      <ScrollView
        style={styles.recipesList}
        contentContainerStyle={[styles.recipesListContent, { paddingBottom: Math.max(insets.bottom, 16) + 30 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} colors={[colors.brand]} tintColor={colors.brand} />}
      >
        {loading && recipes.length === 0 ? (
          <View style={styles.recipesEmptyState}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : recipes.length > 0 ? (
          <View style={styles.recipesGrid}>
            {recipes.map((recipe) => (
                <View key={recipe.id} style={styles.recipeCard}>
                  <View style={styles.recipeImageWrapper}>
                    {recipe.image_path ? (
                      <Image source={{ uri: recipe.image_path }} style={styles.recipeCardImage} resizeMode="cover" />
                    ) : (
                      <View style={styles.recipeCardImagePlaceholder}>
                        <ImageIcon size={34} color="#cbd5e1" strokeWidth={1.7} />
                      </View>
                    )}
                    {recipe.is_favorite ? (
                      <View style={styles.recipeFavoriteBadge}>
                        <Star size={16} color="#f59e0b" fill="#fbbf24" strokeWidth={2.2} />
                      </View>
                    ) : null}
                    {recipe.meal_type ? (
                      <View style={styles.recipeMealBadge}>
                        <Text style={styles.recipeMealBadgeText}>{getMealTypeLabel(recipe.meal_type)}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.recipeCardContent}>
                    <Pressable onPress={() => navigation.navigate('RecipeDetail', { recipeId: recipe.id })}>
                      <Text style={styles.recipeCardName} numberOfLines={2}>{formatRecipeDisplayText(recipe.recipe_name) || '未命名食谱'}</Text>
                    </Pressable>
                    {recipe.description ? <Text style={styles.recipeCardDesc} numberOfLines={2}>{formatRecipeDisplayText(recipe.description)}</Text> : null}

                    <View style={styles.recipeNutritionSummary}>
                      <View style={[styles.recipeNutritionItem, styles.recipeNutritionHighlight]}>
                        <View style={styles.recipeCalorieLine}>
                          <Text style={styles.recipeCalorieValue}>{formatRecipeNumber(recipe.total_calories)}</Text>
                          <Text style={styles.recipeCalorieUnit}>kcal</Text>
                        </View>
                      </View>
                      <View style={styles.recipeNutritionDivider} />
                      <View style={styles.recipeNutritionItem}>
                        <Text style={styles.recipeNutritionLabel}>蛋白质</Text>
                        <Text style={styles.recipeNutritionValue}>{formatRecipeNumber(recipe.total_protein)}g</Text>
                      </View>
                      <View style={styles.recipeNutritionItem}>
                        <Text style={styles.recipeNutritionLabel}>碳水</Text>
                        <Text style={styles.recipeNutritionValue}>{formatRecipeNumber(recipe.total_carbs)}g</Text>
                      </View>
                      <View style={styles.recipeNutritionItem}>
                        <Text style={styles.recipeNutritionLabel}>脂肪</Text>
                        <Text style={styles.recipeNutritionValue}>{formatRecipeNumber(recipe.total_fat)}g</Text>
                      </View>
                    </View>

                    {recipe.tags?.length ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recipeTagsScroll}>
                        <View style={styles.recipeTags}>
                          {recipe.tags.map((tag) => {
                            const label = formatRecipeTag(tag)
                            return label ? <Text key={tag} style={styles.recipeTag}>{label}</Text> : null
                          })}
                        </View>
                      </ScrollView>
                    ) : null}

                    <RecipeMicroSummary recipe={recipe} />

                    <View style={styles.recipeCardFooter}>
                      <View style={styles.recipeStatsRow}>
                        <Clock size={12} color="#94a3b8" strokeWidth={2.2} />
                        <Text style={styles.recipeStatsText}>{formatRecipeLastUsed(recipe.last_used_at)}</Text>
                        <Text style={styles.recipeStatsDot}>·</Text>
                        <Text style={styles.recipeStatsText}>用过 {recipe.use_count || 0} 次</Text>
                      </View>
                      <View style={styles.recipeActionRow}>
                        <Pressable style={[styles.recipeIconButton, styles.recipeDeleteButton]} onPress={() => removeRecipe(recipe)}>
                          <Trash2 size={15} color="#ef4444" strokeWidth={2.2} />
                        </Pressable>
                        <Pressable style={styles.recipeIconButton} onPress={() => navigation.navigate('RecipeEdit', { recipeId: recipe.id })}>
                          <Edit3 size={15} color="#475569" strokeWidth={2.2} />
                        </Pressable>
                        <Pressable style={styles.recipeUseButton} onPress={() => openUseRecipe(recipe)}>
                          <NotebookPen size={15} color="#fff" strokeWidth={2.2} />
                          <Text style={styles.recipeUseButtonText}>记录</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
          </View>
        ) : (
          <View style={styles.recipesEmptyState}>
            <View style={styles.recipesEmptyIcon}>
              <Star size={42} color="#cbd5e1" strokeWidth={1.7} />
            </View>
            <Text style={styles.recipesEmptyText}>还没有收藏餐食</Text>
            <Text style={styles.recipesEmptyHint}>分析结果页点击“收藏餐食”后，会显示在这里</Text>
          </View>
        )}
      </ScrollView>
      <Modal transparent visible={mealSheetRecipe != null} animationType="fade" onRequestClose={closeMealSheet}>
        <Pressable style={styles.recipeMealSheetOverlay} onPress={closeMealSheet}>
          <Pressable style={[styles.recipeMealSheet, { paddingBottom: Math.max(insets.bottom, 14) + 14 }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.recipeMealSheetHandle} />
            <Text style={styles.recipeMealSheetTitle}>选择餐次</Text>
            <Text style={styles.recipeMealSheetSubtitle} numberOfLines={1}>
              {mealSheetRecipe?.recipe_name || '收藏食谱'}
            </Text>
            <View style={styles.recipeMealSheetGrid}>
              {mealOptions.map((meal) => (
                <Pressable
                  key={meal}
                  style={[styles.recipeMealOption, mealSheetValue === meal && styles.recipeMealOptionActive]}
                  onPress={() => setMealSheetValue(meal)}
                >
                  <Text style={[styles.recipeMealOptionText, mealSheetValue === meal && styles.recipeMealOptionTextActive]}>
                    {getMealTypeLabel(meal)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.recipeMealSheetActions}>
              <Pressable style={styles.recipeMealSheetCancelButton} onPress={closeMealSheet} disabled={loading}>
                <Text style={styles.recipeMealSheetCancelText}>取消</Text>
              </Pressable>
              <Pressable style={[styles.recipeMealSheetConfirmButton, loading && styles.recipeMealSheetConfirmButtonDisabled]} onPress={confirmMealSheet} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.recipeMealSheetConfirmText}>确认记录</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

type PublicFoodMode = 'all' | 'campus' | 'mine' | 'collections'
type PublicFoodSort = 'latest' | 'hot' | 'rating'
type PublicFoodBusyKind = 'like' | 'collect' | 'delete'
type PublicFoodItemsByMode = Record<PublicFoodMode, PublicFoodItem[]>
type PublicFoodLoadingByMode = Record<PublicFoodMode, boolean>

const publicFoodTabOptions: Array<{ value: PublicFoodMode; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'campus', label: '校园食堂' },
  { value: 'collections', label: '收藏夹' },
  { value: 'mine', label: '我上传的' },
]

const publicFoodSortOptions: Array<{ value: PublicFoodSort; label: string }> = [
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '最热' },
  { value: 'rating', label: '评分' },
]

function createPublicFoodItemsByMode(): PublicFoodItemsByMode {
  return { all: [], campus: [], collections: [], mine: [] }
}

function createPublicFoodLoadingByMode(): PublicFoodLoadingByMode {
  return { all: false, campus: false, collections: false, mine: false }
}

function isCampusPublicFoodItem(item: PublicFoodItem | null | undefined): boolean {
  return Boolean(item && (item.is_campus_food || String(item.type || '').trim().toLowerCase() === 'campus'))
}

export function PublicFoodScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicFood'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { width: screenWidth, fontScale } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const initialMode: PublicFoodMode = route.params?.mode || 'all'
  const [mode, setMode] = useState<PublicFoodMode>(initialMode)
  const [itemsByMode, setItemsByMode] = useState<PublicFoodItemsByMode>(createPublicFoodItemsByMode)
  const [loadingByMode, setLoadingByMode] = useState<PublicFoodLoadingByMode>(createPublicFoodLoadingByMode)
  const [sortBy, setSortBy] = useState<PublicFoodSort>('latest')
  const [filterFatLoss, setFilterFatLoss] = useState<boolean | undefined>(undefined)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [appliedMerchant, setAppliedMerchant] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [busyAction, setBusyAction] = useState<{ itemId: string; kind: PublicFoodBusyKind } | null>(null)
  const activeModeRef = useRef(mode)
  const actionBusyRef = useRef(false)
  const requestSequenceRef = useRef<Record<PublicFoodMode, number>>({ all: 0, campus: 0, collections: 0, mine: 0 })

  const items = itemsByMode[mode]
  const loading = loadingByMode[mode]
  const browseMode = mode === 'all' || mode === 'campus'
  const showBrowseFilters = mode === 'all'
  const compactLayout = screenWidth < 380 || fontScale > 1.15

  useEffect(() => {
    activeModeRef.current = mode
  }, [mode])

  useEffect(() => {
    let mounted = true
    void getStoredUserId().then((id) => {
      if (mounted) setCurrentUserId(String(id || '').trim())
    })
    return () => {
      mounted = false
    }
  }, [])

  const load = useCallback(async (targetMode: PublicFoodMode) => {
    const sequence = requestSequenceRef.current[targetMode] + 1
    requestSequenceRef.current[targetMode] = sequence
    setLoadingByMode((current) => ({ ...current, [targetMode]: true }))
    try {
      let nextItems: PublicFoodItem[]
      if (targetMode === 'mine') {
        const data = await apiClient.listMyPublicFoods()
        nextItems = data.list || []
      } else if (targetMode === 'collections') {
        const data = await apiClient.listCollectedPublicFoods()
        nextItems = data.list || []
      } else {
        const data = await apiClient.listPublicFoods({
          limit: 50,
          sortBy,
          merchantName: targetMode === 'all' ? appliedMerchant || undefined : undefined,
          suitableForFatLoss: targetMode === 'all' ? filterFatLoss : undefined,
          type: targetMode === 'campus' ? 'campus' : undefined,
        })
        nextItems = data.list || []
      }
      if (requestSequenceRef.current[targetMode] !== sequence) return
      setItemsByMode((current) => ({ ...current, [targetMode]: nextItems }))
    } catch (error) {
      if (requestSequenceRef.current[targetMode] === sequence && activeModeRef.current === targetMode) {
        showError('获取公共食物失败', error)
      }
    } finally {
      if (requestSequenceRef.current[targetMode] === sequence) {
        setLoadingByMode((current) => ({ ...current, [targetMode]: false }))
      }
    }
  }, [appliedMerchant, filterFatLoss, sortBy])

  useFocusEffect(useCallback(() => {
    void load(mode)
  }, [load, mode]))

  const switchMode = (nextMode: PublicFoodMode) => {
    setMode(nextMode)
    setFilterOpen(false)
    Keyboard.dismiss()
  }

  const applySearch = () => {
    const nextKeyword = searchKeyword.trim()
    Keyboard.dismiss()
    setFilterOpen(false)
    if (nextKeyword === appliedMerchant) {
      void load('all')
      return
    }
    setAppliedMerchant(nextKeyword)
  }

  const selectSort = (nextSort: PublicFoodSort) => {
    setFilterOpen(false)
    if (nextSort === sortBy) {
      void load('all')
      return
    }
    setSortBy(nextSort)
  }

  const selectFatLossFilter = (nextValue: boolean | undefined) => {
    setFilterOpen(false)
    if (nextValue === filterFatLoss) {
      void load('all')
      return
    }
    setFilterFatLoss(nextValue)
  }

  const clearFilters = () => {
    setSearchKeyword('')
    setAppliedMerchant('')
    setFilterFatLoss(undefined)
    setFilterOpen(false)
    Keyboard.dismiss()
  }

  const updateItemAcrossModes = (itemId: string, update: (item: PublicFoodItem) => PublicFoodItem, removeFromCollections = false) => {
    setItemsByMode((current) => {
      const next = { ...current }
      ;(Object.keys(next) as PublicFoodMode[]).forEach((key) => {
        next[key] = key === 'collections' && removeFromCollections
          ? current[key].filter((entry) => entry.id !== itemId)
          : current[key].map((entry) => entry.id === itemId ? update(entry) : entry)
      })
      return next
    })
  }

  const toggleLike = async (item: PublicFoodItem) => {
    if (actionBusyRef.current) return
    actionBusyRef.current = true
    const previous = itemsByMode
    setBusyAction({ itemId: item.id, kind: 'like' })
    updateItemAcrossModes(item.id, (entry) => ({
      ...entry,
      liked: !item.liked,
      like_count: Math.max(0, (entry.like_count || 0) + (item.liked ? -1 : 1)),
    }))
    try {
      await apiClient.publicFoodLike(item.id, Boolean(item.liked))
    } catch (error) {
      setItemsByMode(previous)
      showError('点赞失败', error)
    } finally {
      actionBusyRef.current = false
      setBusyAction(null)
    }
  }

  const toggleCollect = async (item: PublicFoodItem) => {
    if (actionBusyRef.current) return
    actionBusyRef.current = true
    const previous = itemsByMode
    setBusyAction({ itemId: item.id, kind: 'collect' })
    updateItemAcrossModes(item.id, (entry) => ({
      ...entry,
      collected: !item.collected,
      collection_count: Math.max(0, (entry.collection_count || 0) + (item.collected ? -1 : 1)),
    }), Boolean(item.collected))
    try {
      await apiClient.publicFoodCollect(item.id, Boolean(item.collected))
    } catch (error) {
      setItemsByMode(previous)
      showError('收藏失败', error)
    } finally {
      actionBusyRef.current = false
      setBusyAction(null)
    }
  }

  const deleteItem = async (item: PublicFoodItem) => {
    if (actionBusyRef.current) return
    actionBusyRef.current = true
    setBusyAction({ itemId: item.id, kind: 'delete' })
    try {
      await apiClient.deletePublicFood(item.id)
      setItemsByMode((current) => {
        const next = { ...current }
        ;(Object.keys(next) as PublicFoodMode[]).forEach((key) => {
          next[key] = current[key].filter((entry) => entry.id !== item.id)
        })
        return next
      })
    } catch (error) {
      showError('删除失败', error)
    } finally {
      actionBusyRef.current = false
      setBusyAction(null)
    }
  }

  const confirmDelete = (item: PublicFoodItem) => {
    Alert.alert('删除上传', '删除后这条食物会从公共库下架，其他用户将无法继续查看。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void deleteItem(item) },
    ])
  }

  const openDetail = (item: PublicFoodItem) => {
    navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: isCampusPublicFoodItem(item) })
  }

  const listEmpty = loading ? (
    mode === 'all'
      ? <PublicFoodSkeletonList isDark={isDark} compact={compactLayout} />
      : <View style={styles.publicFoodLoadingState}><ActivityIndicator size="small" color={isDark ? '#6ee7b7' : colors.brand} /></View>
  ) : (
    <PublicFoodEmpty
      mode={mode}
      text={publicFoodEmptyText(mode, appliedMerchant, filterFatLoss)}
      isDark={isDark}
      onExplore={() => switchMode('all')}
      onCampus={() => navigation.navigate('CampusCanteen')}
      onShare={() => navigation.navigate('PublicFoodShare', { mode: mode === 'campus' ? 'campus' : 'public' })}
    />
  )

  return (
    <View style={[styles.publicFoodScreen, isDark ? styles.publicFoodScreenDark : null]}>
      <View style={[styles.publicFoodTabs, isDark ? styles.publicFoodSurfaceDark : null, isDark ? styles.publicFoodBorderDark : null]} accessibilityRole="tablist">
        {publicFoodTabOptions.map((option) => {
          const selected = mode === option.value
          return (
            <Pressable
              key={option.value}
              style={({ pressed }) => [styles.publicFoodTab, selected ? styles.publicFoodTabActive : null, pressed ? styles.publicFoodControlPressed : null]}
              onPress={() => switchMode(option.value)}
              accessibilityRole="tab"
              accessibilityLabel={`${option.label}食物列表`}
              accessibilityState={{ selected }}
            >
              <Text numberOfLines={2} style={[styles.publicFoodTabText, isDark ? styles.publicFoodTextSecondaryDark : null, selected ? styles.publicFoodTabTextActive : null, selected && isDark ? styles.publicFoodAccentTextDark : null]}>
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      {showBrowseFilters ? (
        <>
          <View style={[styles.publicFoodSearchSection, isDark ? styles.publicFoodSurfaceDark : null, isDark ? styles.publicFoodBorderDark : null]}>
            <View style={styles.publicFoodSearchRow}>
              <View style={[styles.publicFoodSearchInputWrap, isDark ? styles.publicFoodFieldDark : null]}>
                <Search size={20} color={isDark ? '#91a39b' : colors.textMuted} strokeWidth={2.1} />
                <TextInput
                  value={searchKeyword}
                  onChangeText={setSearchKeyword}
                  onSubmitEditing={applySearch}
                  placeholder="搜索商家名称或食物"
                  placeholderTextColor={isDark ? '#7f8c87' : colors.textMuted}
                  returnKeyType="search"
                  autoCorrect={false}
                  style={[styles.publicFoodSearchInput, isDark ? styles.publicFoodTextPrimaryDark : null]}
                  accessibilityLabel="搜索商家名称或食物"
                />
                {searchKeyword ? (
                  <Pressable
                    hitSlop={6}
                    style={({ pressed }) => [styles.publicFoodSearchClear, pressed ? styles.publicFoodControlPressed : null]}
                    onPress={() => setSearchKeyword('')}
                    accessibilityRole="button"
                    accessibilityLabel="清空搜索输入"
                  >
                    <X size={18} color={isDark ? '#91a39b' : colors.textMuted} strokeWidth={2.2} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable style={({ pressed }) => [styles.publicFoodSearchButton, pressed ? styles.publicFoodPrimaryPressed : null]} onPress={applySearch} accessibilityRole="button" accessibilityLabel="执行食物搜索">
                <Text style={styles.publicFoodSearchButtonText}>搜索</Text>
              </Pressable>
            </View>
          </View>

          <View style={[styles.publicFoodSortSection, compactLayout ? styles.publicFoodSortSectionCompact : null, filterOpen ? styles.publicFoodSortSectionFilterOpen : null, compactLayout && filterOpen ? styles.publicFoodSortSectionCompactFilterOpen : null, isDark ? styles.publicFoodScreenDark : null, isDark ? styles.publicFoodBorderDark : null]}>
            <View style={[styles.publicFoodSortLeft, compactLayout ? styles.publicFoodSortLeftCompact : null]} accessibilityRole="radiogroup">
              {publicFoodSortOptions.map((option) => {
                const selected = sortBy === option.value
                return (
                  <Pressable
                    key={option.value}
                    style={({ pressed }) => [styles.publicFoodSortItem, pressed ? styles.publicFoodControlPressed : null]}
                    onPress={() => selectSort(option.value)}
                    accessibilityRole="radio"
                    accessibilityLabel={`按${option.label}排序`}
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={[styles.publicFoodSortText, isDark ? styles.publicFoodTextSecondaryDark : null, selected ? styles.publicFoodSortTextActive : null, selected && isDark ? styles.publicFoodAccentTextDark : null]}>{option.label}</Text>
                    {selected ? <View style={[styles.publicFoodSortUnderline, isDark ? styles.publicFoodAccentBackgroundDark : null]} /> : null}
                  </Pressable>
                )
              })}
            </View>
            <Pressable
              style={({ pressed }) => [styles.publicFoodFilterButton, compactLayout ? styles.publicFoodFilterButtonCompact : null, isDark ? styles.publicFoodFieldDark : null, filterOpen ? styles.publicFoodFilterButtonActive : null, isDark && filterOpen ? styles.publicFoodFilterButtonActiveDark : null, pressed ? styles.publicFoodControlPressed : null]}
              onPress={() => setFilterOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel="筛选食物类型"
              accessibilityState={{ expanded: filterOpen, selected: filterFatLoss === true }}
            >
              <SlidersHorizontal size={18} color={filterOpen || filterFatLoss ? (isDark ? '#6ee7b7' : colors.brand) : (isDark ? '#b7c5bf' : colors.textSecondary)} strokeWidth={2.1} />
              <Text style={[styles.publicFoodFilterText, isDark ? styles.publicFoodTextSecondaryDark : null, (filterOpen || filterFatLoss) ? styles.publicFoodFilterTextActive : null, (filterOpen || filterFatLoss) && isDark ? styles.publicFoodAccentTextDark : null]}>筛选</Text>
            </Pressable>
            {filterOpen ? (
              <View style={[styles.publicFoodFilterPanel, compactLayout ? styles.publicFoodFilterPanelCompact : null, isDark ? styles.publicFoodFilterPanelDark : null]} accessibilityLabel="食物类型筛选面板">
                <Text style={[styles.publicFoodFilterLabel, isDark ? styles.publicFoodTextSecondaryDark : null]}>类型</Text>
                <View style={styles.publicFoodFilterOptions} accessibilityRole="radiogroup">
                  <Pressable
                    style={({ pressed }) => [styles.publicFoodFilterOption, isDark ? styles.publicFoodFilterOptionDark : null, filterFatLoss == null ? styles.publicFoodFilterOptionActive : null, filterFatLoss == null && isDark ? styles.publicFoodFilterOptionActiveDark : null, pressed ? styles.publicFoodControlPressed : null]}
                    onPress={() => selectFatLossFilter(undefined)}
                    accessibilityRole="radio"
                    accessibilityLabel="全部类型"
                    accessibilityState={{ checked: filterFatLoss == null }}
                  >
                    <Text style={[styles.publicFoodFilterOptionText, isDark ? styles.publicFoodTextSecondaryDark : null, filterFatLoss == null ? styles.publicFoodFilterOptionTextActive : null, filterFatLoss == null && isDark ? styles.publicFoodAccentTextDark : null]}>全部</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.publicFoodFilterOption, isDark ? styles.publicFoodFilterOptionDark : null, filterFatLoss === true ? styles.publicFoodFilterOptionActive : null, filterFatLoss === true && isDark ? styles.publicFoodFilterOptionActiveDark : null, pressed ? styles.publicFoodControlPressed : null]}
                    onPress={() => selectFatLossFilter(true)}
                    accessibilityRole="radio"
                    accessibilityLabel="只看适合减脂"
                    accessibilityState={{ checked: filterFatLoss === true }}
                  >
                    <Text style={[styles.publicFoodFilterOptionText, isDark ? styles.publicFoodTextSecondaryDark : null, filterFatLoss === true ? styles.publicFoodFilterOptionTextActive : null, filterFatLoss === true && isDark ? styles.publicFoodAccentTextDark : null]}>适合减脂</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>

          {appliedMerchant || filterFatLoss ? (
            <View style={[styles.publicFoodAppliedFilters, isDark ? styles.publicFoodScreenDark : null, isDark ? styles.publicFoodBorderDark : null]} accessibilityLabel="已应用筛选条件">
              {appliedMerchant ? <View style={[styles.publicFoodAppliedChip, isDark ? styles.publicFoodAppliedChipDark : null]}><Text style={[styles.publicFoodAppliedChipText, isDark ? styles.publicFoodAccentTextDark : null]}>搜索：{appliedMerchant}</Text></View> : null}
              {filterFatLoss ? <View style={[styles.publicFoodAppliedChip, isDark ? styles.publicFoodAppliedChipDark : null]}><Text style={[styles.publicFoodAppliedChipText, isDark ? styles.publicFoodAccentTextDark : null]}>适合减脂</Text></View> : null}
              <Pressable style={({ pressed }) => [styles.publicFoodClearFilterButton, pressed ? styles.publicFoodControlPressed : null]} onPress={clearFilters} accessibilityRole="button" accessibilityLabel="清除全部筛选条件">
                <Text style={[styles.publicFoodClearFilter, isDark ? styles.publicFoodTextSecondaryDark : null]}>清除</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}

      <FlatList<PublicFoodItem>
        data={items}
        keyExtractor={(item) => item.id}
        style={styles.publicFoodListScroll}
        contentContainerStyle={[styles.publicFoodListScrollerContent, items.length === 0 && !loading ? styles.publicFoodListScrollerEmpty : null, { paddingBottom: insets.bottom + 100 }]}
        renderItem={({ item, index }) => (
          <PublicFoodCard
            item={item}
            latest={sortBy === 'latest' && index === 0 && browseMode}
            isDark={isDark}
            compact={compactLayout}
            isOwner={Boolean(currentUserId && publicFoodOwnerId(item) === currentUserId)}
            busyKind={busyAction?.itemId === item.id ? busyAction.kind : null}
            actionsDisabled={Boolean(busyAction)}
            onPress={() => openDetail(item)}
            onAuthorPress={item.author?.id ? () => navigation.navigate('ProfileSettings', { userId: String(item.author?.id) }) : undefined}
            onLike={() => void toggleLike(item)}
            onCollect={() => void toggleCollect(item)}
            onComment={() => openDetail(item)}
            onDelete={() => confirmDelete(item)}
          />
        )}
        ListEmptyComponent={listEmpty}
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={() => void load(mode)} colors={[isDark ? '#6ee7b7' : colors.brand]} tintColor={isDark ? '#6ee7b7' : colors.brand} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      <Pressable
        style={({ pressed }) => [styles.publicFoodFab, { bottom: insets.bottom + 18 }, pressed ? styles.publicFoodFabPressed : null]}
        onPress={() => navigation.navigate('PublicFoodShare', { mode: mode === 'campus' ? 'campus' : 'public' })}
        accessibilityRole="button"
        accessibilityLabel={mode === 'campus' ? '补充校园餐' : '分享公共食物'}
      >
        <Plus size={26} color="#fff" strokeWidth={2.4} />
      </Pressable>
    </View>
  )
}

export function PublicFoodDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicFoodDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { width: screenWidth, height: screenHeight, fontScale } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const [item, setItem] = useState<PublicFoodItem | null>(null)
  const [comments, setComments] = useState<PublicFoodComment[]>([])
  const [comment, setComment] = useState('')
  const [commentRating, setCommentRating] = useState(0)
  const [replyTarget, setReplyTarget] = useState<PublicFoodReplyTarget | null>(null)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [previewImageIndex, setPreviewImageIndex] = useState(0)
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false)
  const [showMicronutrients, setShowMicronutrients] = useState(false)
  const [commentModalVisible, setCommentModalVisible] = useState(false)
  const [actionSheetVisible, setActionSheetVisible] = useState(false)
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [contributingImages, setContributingImages] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionBusy, setActionBusy] = useState<'like' | 'collect' | ''>('')
  const [currentUserId, setCurrentUserId] = useState('')
  const commentInputRef = useRef<TextInput | null>(null)
  const previewScrollRef = useRef<ScrollView | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      let detailData: { item: PublicFoodItem }
      if (route.params.isCampus) {
        detailData = await apiClient.getCampusFoodDetail(route.params.itemId)
      } else {
        const publicItem = await apiClient.getPublicFood(route.params.itemId)
        detailData = isCampusPublicFoodItem(publicItem)
          ? await apiClient.getCampusFoodDetail(route.params.itemId)
          : { item: publicItem }
      }
      const commentData = await apiClient.listPublicFoodComments(route.params.itemId).catch(() => ({ list: [] as PublicFoodComment[] }))
      setItem(detailData.item)
      setComments(commentData.list || [])
    } catch (error) {
      if (!silent) showError('获取食物详情失败', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [route.params.itemId, route.params.isCampus])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setCurrentImageIndex(0)
    setPreviewImageIndex(0)
    setImagePreviewVisible(false)
    setShowMicronutrients(false)
    setCommentModalVisible(false)
    setActionSheetVisible(false)
    setFeedbackModalVisible(false)
  }, [route.params.itemId])

  useEffect(() => {
    if (!item || !isPublicFoodAnalyzing(item)) return undefined
    const timer = setInterval(() => {
      void load(true)
    }, 8000)
    return () => clearInterval(timer)
  }, [item, load])

  useEffect(() => {
    let mounted = true
    void getStoredUserId().then((id) => {
      if (mounted) setCurrentUserId((id || '').trim())
    })
    return () => {
      mounted = false
    }
  }, [])

  const toggleLike = async () => {
    if (!item || actionBusy) return
    const previous = item
    setActionBusy('like')
    setItem({ ...item, liked: !item.liked, like_count: Math.max(0, (item.like_count || 0) + (item.liked ? -1 : 1)) })
    try {
      await apiClient.publicFoodLike(item.id, Boolean(item.liked))
    } catch (error) {
      setItem(previous)
      showError('点赞失败', error)
    } finally {
      setActionBusy('')
    }
  }

  const toggleCollect = async () => {
    if (!item || actionBusy) return
    const previous = item
    setActionBusy('collect')
    setItem({ ...item, collected: !item.collected, collection_count: Math.max(0, (item.collection_count || 0) + (item.collected ? -1 : 1)) })
    try {
      await apiClient.publicFoodCollect(item.id, Boolean(item.collected))
    } catch (error) {
      setItem(previous)
      showError('收藏失败', error)
    } finally {
      setActionBusy('')
    }
  }

  const openCommentComposer = (target?: PublicFoodReplyTarget) => {
    setReplyTarget(target || null)
    if (target) setCommentRating(0)
    setCommentModalVisible(true)
    setTimeout(() => commentInputRef.current?.focus(), 120)
  }

  const closeCommentComposer = () => {
    if (submittingComment) return
    setCommentModalVisible(false)
    setReplyTarget(null)
    Keyboard.dismiss()
  }

  const addComment = async () => {
    if (!item || submittingComment) return
    const content = comment.trim()
    if (!content) {
      Alert.alert('还不能发布', '请输入评论内容。')
      return
    }
    setSubmittingComment(true)
    try {
      const response = await apiClient.addPublicFoodComment(
        item.id,
        content,
        replyTarget ? undefined : (commentRating || undefined),
        replyTarget ? {
          parentCommentId: replyTarget.parentCommentId,
          replyToUserId: replyTarget.replyToUserId,
        } : undefined,
      )
      const nextComment = response.comment
      if (replyTarget) {
        setComments((current) => current.map((entry) => (
          entry.id === replyTarget.parentCommentId
            ? { ...entry, replies: [...(entry.replies || []), nextComment] }
            : entry
        )))
      } else {
        setComments((current) => [{ ...nextComment, replies: nextComment.replies || [] }, ...current])
      }
      setItem((current) => current ? { ...current, comment_count: (current.comment_count || 0) + 1 } : current)
      setComment('')
      setCommentRating(0)
      setReplyTarget(null)
      setCommentModalVisible(false)
    } catch (error) {
      showError(replyTarget ? '回复失败' : '评论失败', error)
    } finally {
      setSubmittingComment(false)
    }
  }

  const startReply = (parent: PublicFoodComment, target: PublicFoodComment = parent) => {
    openCommentComposer({
      parentCommentId: parent.parent_comment_id || parent.id,
      replyToUserId: target.user_id,
      nickname: target.nickname || '用户',
    })
  }

  const removeComment = async (entry: PublicFoodComment) => {
    if (!item) return
    try {
      await apiClient.deletePublicFoodComment(item.id, entry.id)
      const removedCount = 1 + (entry.replies?.length || 0)
      if (entry.parent_comment_id) {
        setComments((current) => current.map((commentEntry) => ({
          ...commentEntry,
          replies: (commentEntry.replies || []).filter((reply) => reply.id !== entry.id),
        })))
      } else {
        setComments((current) => current.filter((commentEntry) => commentEntry.id !== entry.id))
      }
      setItem((current) => current ? { ...current, comment_count: Math.max(0, (current.comment_count || 0) - removedCount) } : current)
    } catch (error) {
      showError('删除评论失败', error)
    }
  }

  const confirmRemoveComment = (entry: PublicFoodComment) => {
    Alert.alert('删除评论', '确定删除这条评论吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void removeComment(entry) },
    ])
  }

  const submitFeedback = async () => {
    if (!item || submittingFeedback) return
    const content = feedback.trim()
    if (!content) {
      Alert.alert('请补充说明', '请描述食物名称、热量或其他有误的地方。')
      return
    }
    setSubmittingFeedback(true)
    try {
      await apiClient.submitPublicFoodFeedback(item.id, content)
      setFeedback('')
      setFeedbackModalVisible(false)
      Alert.alert('修正已提交', '感谢反馈，我们会尽快核对。')
    } catch (error) {
      showError('提交失败', error)
    } finally {
      setSubmittingFeedback(false)
    }
  }

  const remove = async () => {
    if (!item || deleting) return
    setDeleting(true)
    try {
      await apiClient.deletePublicFood(item.id)
      setActionSheetVisible(false)
      Alert.alert('已删除', '公共食物已删除', [{ text: '确定', onPress: () => navigation.goBack() }])
    } catch (error) {
      showError('删除失败', error)
    } finally {
      setDeleting(false)
    }
  }

  const confirmRemove = () => {
    setActionSheetVisible(false)
    Alert.alert('删除上传', '删除后这条食物会从公共库下架，其他用户将无法继续查看。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void remove() },
    ])
  }

  const shareItem = async () => {
    if (!item) return
    setActionSheetVisible(false)
    const title = publicFoodTitle(item)
    const message = [
      title,
      publicFoodSubtitle(item),
      isCampusPublicFoodItem(item) ? publicFoodLocationText(item) : '',
      item.total_calories > 0 ? `${Math.round(item.total_calories)} kcal` : '',
      '来自食探公共食物库',
    ].filter(Boolean).join('\n')
    try {
      await Share.share({ title, message })
    } catch (error) {
      showError('分享失败', error)
    }
  }

  const quickRecord = () => {
    if (!item) return
    if (isPublicFoodAnalyzing(item)) {
      Alert.alert('营养信息还在分析', '等热量和营养信息补齐后，再记录到今天这一餐。')
      return
    }
    if (isPublicFoodAnalysisFailed(item)) {
      Alert.alert('暂不能记录', '这份食物的营养分析失败了，可以先提交纠错反馈。')
      return
    }
    if (needsPublicFoodNutritionUpdate(item)) {
      Alert.alert('营养信息待补充', '这份食物还没有可记录的营养数据，可以先提交纠错反馈。')
      return
    }
    navigation.navigate('ManualRecord', {
      quickItem: manualFoodItemFromPublicFood(item),
      sourceChannel: isCampusPublicFoodItem(item) ? 'campus' : 'recommended',
    })
  }

  const uploadContributionAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (!item || !assets.length || contributingImages) return
    setContributingImages(true)
    try {
      const uploaded: string[] = []
      for (const asset of assets.slice(0, 5)) {
        const result = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || 'campus-food.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        })
        uploaded.push(result.imageUrl)
      }
      const result = await apiClient.contributeCampusFoodImages(item.id, uploaded)
      if (result.image_paths.length) {
        setItem((current) => current ? {
          ...current,
          image_path: result.image_paths[0],
          image_paths: result.image_paths,
        } : current)
        setCurrentImageIndex(0)
      }
      Alert.alert(result.accepted ? '感谢共建' : '已有用户补图', result.accepted ? '照片已补充到这道校园餐。' : '这道菜已经有可用照片了。')
    } catch (error) {
      showError('补充照片失败', error)
    } finally {
      setContributingImages(false)
    }
  }

  const pickContributionImages = async (source: 'camera' | 'library') => {
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.86, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5, quality: 0.86, allowsEditing: false })
    if (!result.canceled) await uploadContributionAssets(result.assets)
  }

  const openContributionSource = () => {
    if (contributingImages) return
    Alert.alert('补充真实照片', '选择照片来源，最多补充 5 张。', [
      { text: '拍照', onPress: () => void pickContributionImages('camera') },
      { text: '从相册选择', onPress: () => void pickContributionImages('library') },
      { text: '取消', style: 'cancel' },
    ])
  }

  const openImagePreview = (index: number) => {
    setPreviewImageIndex(index)
    setImagePreviewVisible(true)
    setTimeout(() => previewScrollRef.current?.scrollTo({ x: Math.max(screenWidth, 1) * index, animated: false }), 80)
  }

  const isOwner = Boolean(item && currentUserId && publicFoodOwnerId(item) === currentUserId)
  const isCampusDetail = Boolean(isCampusPublicFoodItem(item) || route.params.isCampus)
  const commentTotal = countPublicFoodComments(comments)

  const renderComment = (entry: PublicFoodComment, parent?: PublicFoodComment) => {
    const isReply = Boolean(parent)
    const canDelete = Boolean(currentUserId && entry.user_id === currentUserId)
    const replyPrefix = parent && entry.reply_to_nickname && entry.reply_to_nickname !== parent.nickname
      ? `回复 ${entry.reply_to_nickname} · `
      : ''
    return (
      <View key={entry.id} style={[styles.publicFoodDetailCommentRow, isDark ? styles.publicFoodDetailCommentRowDark : null, isReply ? styles.publicFoodDetailReplyRow : null, isReply && isDark ? styles.publicFoodDetailReplyRowDark : null]}>
        <View style={styles.publicFoodDetailCommentHead}>
          {entry.avatar ? (
            <Image source={{ uri: entry.avatar }} style={isReply ? styles.publicFoodDetailReplyAvatar : styles.publicFoodDetailCommentAvatar} accessibilityLabel={`${entry.nickname || '用户'}的头像`} />
          ) : (
            <View style={[isReply ? styles.publicFoodDetailReplyAvatarFallback : styles.publicFoodDetailCommentAvatarFallback, isDark ? styles.publicFoodDetailAvatarFallbackDark : null]}>
              <UserRound size={isReply ? 14 : 18} color={isDark ? '#7dd3b0' : colors.brandDark} strokeWidth={2.1} />
            </View>
          )}
          <View style={styles.flex}>
            <View style={styles.publicFoodDetailCommentMeta}>
              <Text style={[styles.publicFoodDetailCommentName, isDark ? styles.publicFoodDetailCommentNameDark : null]}>{entry.nickname || '用户'}</Text>
              {entry.rating ? (
                <View style={styles.publicFoodDetailRatingStars} accessibilityLabel={`评分 ${entry.rating} 星`}>
                  {[1, 2, 3, 4, 5].map((value) => <Star key={value} size={12} color="#f59e0b" fill={value <= Number(entry.rating) ? '#f59e0b' : 'transparent'} strokeWidth={2} />)}
                </View>
              ) : null}
            </View>
            <Text style={[styles.publicFoodDetailCommentTime, isDark ? styles.publicFoodDetailMutedTextDark : null]}>{formatDateTime(entry.created_at)}</Text>
          </View>
        </View>
        <Text style={[styles.publicFoodDetailCommentContent, isDark ? styles.publicFoodDetailCommentContentDark : null]}>{replyPrefix}{entry.content}</Text>
        <View style={styles.publicFoodDetailCommentActions}>
          <Pressable style={({ pressed }) => [styles.publicFoodDetailTextAction, pressed ? styles.pressed : null]} onPress={() => startReply(parent || entry, entry)} accessibilityRole="button" accessibilityLabel={`回复 ${entry.nickname || '用户'}`}>
            <Text style={[styles.publicFoodDetailTextActionText, isDark ? styles.publicFoodDetailTextActionTextDark : null]}>回复</Text>
          </Pressable>
          {canDelete ? (
            <Pressable style={({ pressed }) => [styles.publicFoodDetailTextAction, pressed ? styles.pressed : null]} onPress={() => confirmRemoveComment(entry)} accessibilityRole="button" accessibilityLabel="删除评论">
              <Text style={[styles.publicFoodDetailTextActionText, styles.publicFoodDetailDangerText]}>删除</Text>
            </Pressable>
          ) : null}
        </View>
        {!isReply && entry.replies?.length ? <View style={styles.publicFoodDetailReplies}>{entry.replies.map((reply) => renderComment(reply, entry))}</View> : null}
      </View>
    )
  }

  if (!item && loading) {
    return (
      <View style={[styles.publicFoodDetailScreen, isDark ? styles.publicFoodDetailScreenDark : null]}>
        <ScrollView
          style={[styles.publicFoodDetailScroll, isDark ? styles.publicFoodDetailScrollDark : null]}
          contentContainerStyle={[styles.publicFoodDetailContent, { paddingBottom: insets.bottom + 112 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} colors={[isDark ? '#7dd3b0' : colors.brand]} tintColor={isDark ? '#7dd3b0' : colors.brand} />}
        >
          <PublicFoodDetailSkeleton />
        </ScrollView>
      </View>
    )
  }

  if (!item) {
    return (
      <View style={[styles.publicFoodDetailScreen, isDark ? styles.publicFoodDetailScreenDark : null]}>
        <ScrollView
          style={[styles.publicFoodDetailScroll, isDark ? styles.publicFoodDetailScrollDark : null]}
          contentContainerStyle={[styles.publicFoodDetailContent, { paddingBottom: insets.bottom + 112 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} colors={[isDark ? '#7dd3b0' : colors.brand]} tintColor={isDark ? '#7dd3b0' : colors.brand} />}
        >
          <PublicFoodDetailEmpty onBack={() => navigation.goBack()} />
        </ScrollView>
      </View>
    )
  }

  const imageList = publicFoodImageList(item)
  const detailTitle = publicFoodTitle(item)
  const detailSubtitle = publicFoodSubtitle(item)
  const nutritionPending = needsPublicFoodNutritionUpdate(item)
  const analyzing = isPublicFoodAnalyzing(item)
  const analysisFailed = isPublicFoodAnalysisFailed(item)
  const priceText = publicFoodPriceText(item)
  const authorName = publicFoodAuthorName(item)
  const canQuickRecord = !analyzing && !analysisFailed && !nutritionPending
  const heroWidth = Math.max(screenWidth, 1)
  const micronutrientRows = publicFoodMicronutrientRows(item)
  const hasPreciseMicronutrients = micronutrientRows.some((row) => row.value > 0)
  const micronutrientColumns = screenWidth >= 390 && fontScale <= 1.15 ? 3 : 2
  const micronutrientCellWidth = `${100 / micronutrientColumns - 2}%` as `${number}%`
  const onHeroScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setCurrentImageIndex(Math.round(event.nativeEvent.contentOffset.x / heroWidth))
  }
  const onPreviewScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPreviewImageIndex(Math.round(event.nativeEvent.contentOffset.x / heroWidth))
  }

  return (
    <View style={[styles.publicFoodDetailScreen, isDark ? styles.publicFoodDetailScreenDark : null]}>
      <ScrollView
        style={[styles.publicFoodDetailScroll, isDark ? styles.publicFoodDetailScrollDark : null]}
        contentContainerStyle={[styles.publicFoodDetailContent, { paddingBottom: insets.bottom + 148 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} colors={[isDark ? '#7dd3b0' : colors.brand]} tintColor={isDark ? '#7dd3b0' : colors.brand} />}
      >
        <View style={[styles.publicFoodDetailImageSection, isDark ? styles.publicFoodDetailImageSectionDark : null]}>
          {imageList.length ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onHeroScrollEnd}
              style={styles.publicFoodDetailImageScroller}
            >
              {imageList.map((src, index) => (
                <Pressable
                  key={`${src}-${index}`}
                  style={({ pressed }) => [styles.publicFoodDetailImageSlide, isDark ? styles.publicFoodDetailImageSlideDark : null, { width: heroWidth }, pressed ? styles.publicFoodDetailImagePressed : null]}
                  onPress={() => openImagePreview(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`预览食物图片 ${index + 1}，共 ${imageList.length} 张`}
                >
                  <Image source={{ uri: src }} style={styles.publicFoodDetailImage} resizeMode="cover" accessibilityIgnoresInvertColors />
                  <View style={styles.publicFoodDetailImageExpandBadge}><Maximize2 size={16} color="#fff" strokeWidth={2.2} /></View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.publicFoodDetailImagePlaceholder, isDark ? styles.publicFoodDetailImagePlaceholderDark : null]}>
              <View style={[styles.publicFoodDetailContributionIcon, isDark ? styles.publicFoodDetailContributionIconDark : null]}>
                <Camera size={27} color={isDark ? '#7dd3b0' : colors.brand} strokeWidth={2.1} />
              </View>
              <Text style={[styles.publicFoodDetailContributionTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>这道菜还没有照片</Text>
              <Text style={[styles.publicFoodDetailContributionHint, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>拍一张真实菜品照片，和同学们一起完善校园食堂</Text>
              {isCampusDetail ? (
                <Pressable
                  disabled={contributingImages}
                  style={({ pressed }) => [styles.publicFoodDetailContributionButton, contributingImages ? styles.publicFoodDetailActionDisabled : null, pressed ? styles.pressed : null]}
                  onPress={openContributionSource}
                  accessibilityRole="button"
                  accessibilityLabel="补充校园餐照片"
                  accessibilityState={{ disabled: contributingImages, busy: contributingImages }}
                >
                  {contributingImages ? <ActivityIndicator size="small" color="#fff" /> : <Camera size={17} color="#fff" strokeWidth={2.2} />}
                  {!contributingImages ? <Text style={styles.publicFoodDetailContributionButtonText}>补充照片</Text> : null}
                </Pressable>
              ) : null}
            </View>
          )}
          {imageList.length > 1 ? <View style={styles.publicFoodDetailImageCounter}><Text style={styles.publicFoodDetailImageCounterText}>{currentImageIndex + 1}/{imageList.length}</Text></View> : null}
          {item.suitable_for_fat_loss ? <View style={styles.publicFoodDetailFatLossBadge}><Text style={styles.publicFoodDetailFatLossText}>适合减脂</Text></View> : null}
        </View>

        <View style={[styles.publicFoodDetailInfoCard, isDark ? styles.publicFoodDetailInfoCardDark : null]}>
          <View style={styles.publicFoodDetailInfoHeader}>
            <Text style={[styles.publicFoodDetailTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>{detailTitle}</Text>
            <View style={[styles.publicFoodDetailCaloriesBadge, isDark ? styles.publicFoodDetailCaloriesBadgeDark : null]}>
              <Text style={[styles.publicFoodDetailCaloriesText, isDark ? styles.publicFoodDetailCaloriesTextDark : null]}>{nutritionPending ? '营养待更新' : `${Math.round(item.total_calories || 0)} kcal`}</Text>
            </View>
          </View>
          {detailSubtitle ? <Text style={[styles.publicFoodDetailDesc, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>{detailSubtitle}</Text> : null}
          {item.insight ? <Text style={[styles.publicFoodDetailInsight, isDark ? styles.publicFoodDetailInsightDark : null]}>{item.insight}</Text> : null}

          {isCampusDetail ? (
            <View style={[styles.publicFoodDetailCampusSummary, isDark ? styles.publicFoodDetailCampusSummaryDark : null]}>
              <View style={styles.publicFoodDetailCampusLocationRow}>
                <Text style={[styles.publicFoodDetailLocation, isDark ? styles.publicFoodDetailTextPrimaryDark : null]}>{publicFoodLocationText(item)}</Text>
              </View>
              <View style={styles.publicFoodDetailPriceRow}>
                <Text style={[styles.publicFoodDetailPrice, isDark ? styles.publicFoodDetailPriceDark : null]}>{priceText || '价格待补充'}</Text>
                <Text style={[styles.publicFoodDetailCampusPortion, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>{item.portion_description || '约 1 份'}</Text>
              </View>
              <Text style={[styles.publicFoodDetailMuted, isDark ? styles.publicFoodDetailMutedTextDark : null]}>价格更新于 {dateText(item.price_collected_at)}</Text>
              {analyzing ? <Text style={[styles.publicFoodDetailAnalysisTip, isDark ? styles.publicFoodDetailAnalysisTipDark : null]}>营养信息正在精确分析，完成后自动更新。</Text> : null}
              {nutritionPending ? <Text style={[styles.publicFoodDetailAnalysisTip, isDark ? styles.publicFoodDetailAnalysisTipDark : null]}>营养信息待更新，暂不建议一键记录。</Text> : null}
              {analysisFailed ? <Text style={[styles.publicFoodDetailAnalysisTip, styles.publicFoodDetailAnalysisTipError, isDark ? styles.publicFoodDetailAnalysisTipErrorDark : null]}>营养分析失败，可通过纠错入口反馈。</Text> : null}
            </View>
          ) : null}

          <View style={[styles.publicFoodDetailNutrients, isDark ? styles.publicFoodDetailNutrientsDark : null]}>
            <PublicFoodNutrientCell value={nutritionPending ? '--' : Math.round(item.total_calories || 0).toString()} label="热量 kcal" />
            <PublicFoodNutrientCell value={nutritionPending ? '--' : `${round1(item.total_protein)}g`} label="蛋白质" />
            <PublicFoodNutrientCell value={nutritionPending ? '--' : `${round1(item.total_carbs)}g`} label="碳水" />
            <PublicFoodNutrientCell value={nutritionPending ? '--' : `${round1(item.total_fat)}g`} label="脂肪" last />
          </View>

          {isCampusDetail ? (
            <View style={[styles.publicFoodDetailMicronutrients, isDark ? styles.publicFoodDetailMicronutrientsDark : null]}>
              <Pressable
                disabled={!hasPreciseMicronutrients}
                style={({ pressed }) => [styles.publicFoodDetailMicronutrientsHeader, pressed && hasPreciseMicronutrients ? styles.pressed : null]}
                onPress={() => setShowMicronutrients((value) => !value)}
                accessibilityRole="button"
                accessibilityLabel={hasPreciseMicronutrients ? `${showMicronutrients ? '收起' : '查看'} 21 项精确微量营养` : '精确微量营养待分析'}
                accessibilityState={{ expanded: showMicronutrients, disabled: !hasPreciseMicronutrients }}
              >
                <View style={styles.flex}>
                  <Text style={[styles.publicFoodDetailMicronutrientsTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>AI 精确微量营养</Text>
                  <Text style={[styles.publicFoodDetailMicronutrientsStatus, hasPreciseMicronutrients ? styles.publicFoodDetailMicronutrientsStatusReady : null, isDark ? styles.publicFoodDetailMutedTextDark : null]}>{hasPreciseMicronutrients ? '已完成 21 项' : '待精确分析'}</Text>
                </View>
                {hasPreciseMicronutrients ? (
                  <View style={styles.publicFoodDetailMicronutrientsToggle}>
                    <Text style={[styles.publicFoodDetailMicronutrientsToggleText, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>{showMicronutrients ? '收起' : '查看全部'}</Text>
                    {showMicronutrients ? <ChevronUp size={17} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} /> : <ChevronDown size={17} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} />}
                  </View>
                ) : null}
              </Pressable>
              {showMicronutrients && hasPreciseMicronutrients ? (
                <View style={styles.publicFoodDetailMicronutrientsGrid}>
                  {micronutrientRows.map((row) => (
                    <View key={row.key} style={[styles.publicFoodDetailMicronutrientCell, isDark ? styles.publicFoodDetailMicronutrientCellDark : null, { width: micronutrientCellWidth }]}>
                      <Text style={[styles.publicFoodDetailMicronutrientLabel, isDark ? styles.publicFoodDetailMutedTextDark : null]}>{row.label}</Text>
                      <Text style={[styles.publicFoodDetailMicronutrientValue, isDark ? styles.publicFoodDetailTitleDark : null]}>{formatPublicFoodMicronutrientValue(row.value)} {row.unit}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {!isCampusDetail ? (
            <View style={styles.publicFoodDetailAuthorRow}>
              {item.author?.avatar ? <Image source={{ uri: item.author.avatar }} style={styles.publicFoodDetailAuthorAvatar} accessibilityLabel={`${authorName}的头像`} /> : <View style={[styles.publicFoodDetailAuthorFallback, isDark ? styles.publicFoodDetailAvatarFallbackDark : null]}><UserRound size={19} color={isDark ? '#7dd3b0' : colors.brandDark} strokeWidth={2.1} /></View>}
              <View style={styles.flex}>
                <Text style={[styles.publicFoodDetailAuthorName, isDark ? styles.publicFoodDetailTitleDark : null]}>{authorName}</Text>
                <Text style={[styles.publicFoodDetailPublished, isDark ? styles.publicFoodDetailMutedTextDark : null]}>{publicFoodPublishedText(item)}</Text>
              </View>
            </View>
          ) : null}
        </View>

        {!isCampusDetail && (item.merchant_name || item.merchant_address || item.city || item.taste_rating != null) ? (
          <View style={[styles.publicFoodDetailCard, isDark ? styles.publicFoodDetailCardDark : null]}>
            <PublicFoodDetailCardTitle title="商家信息" />
            {item.merchant_name ? <PublicFoodDetailInfoRow label="商家" value={item.merchant_name} /> : null}
            {item.merchant_address ? <PublicFoodDetailInfoRow label="地址" value={item.merchant_address} /> : null}
            {item.city ? <PublicFoodDetailInfoRow label="城市" value={`${item.city}${item.district ? ` ${item.district}` : ''}`} /> : null}
            {item.taste_rating != null ? <PublicFoodDetailInfoRow label="口味评分" value={`${item.taste_rating}/5`} /> : null}
          </View>
        ) : null}

        {item.user_tags?.length ? (
          <View style={[styles.publicFoodDetailCard, isDark ? styles.publicFoodDetailCardDark : null]}>
            <PublicFoodDetailCardTitle title="标签" />
            <View style={styles.publicFoodDetailTags}>
              {item.user_tags.map((tag) => <Text key={tag} style={[styles.publicFoodDetailTag, isDark ? styles.publicFoodDetailTagDark : null]}>{tag}</Text>)}
            </View>
          </View>
        ) : null}

        {item.user_notes ? (
          <View style={[styles.publicFoodDetailCard, isDark ? styles.publicFoodDetailCardDark : null]}>
            <PublicFoodDetailCardTitle title="用户评价" />
            <Text style={[styles.publicFoodDetailNotes, isDark ? styles.publicFoodDetailCommentContentDark : null]}>{item.user_notes}</Text>
          </View>
        ) : null}

        <View style={[styles.publicFoodDetailCard, isDark ? styles.publicFoodDetailCardDark : null]}>
          <View style={styles.publicFoodDetailCommentsHead}>
            <PublicFoodDetailCardTitle title="评论" />
            <Text style={[styles.publicFoodDetailCommentCount, isDark ? styles.publicFoodDetailCommentCountDark : null]}>{commentTotal} 条</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.publicFoodDetailQuickComment, isDark ? styles.publicFoodDetailQuickCommentDark : null, pressed ? styles.pressed : null]}
            onPress={() => openCommentComposer()}
            accessibilityRole="button"
            accessibilityLabel="发表评论"
          >
            <View style={[styles.publicFoodDetailQuickAvatar, isDark ? styles.publicFoodDetailAvatarFallbackDark : null]}><UserRound size={16} color={isDark ? '#7dd3b0' : colors.brandDark} strokeWidth={2.1} /></View>
            <Text style={[styles.publicFoodDetailQuickPlaceholder, isDark ? styles.publicFoodDetailMutedTextDark : null]}>理性发言</Text>
          </Pressable>
          {comments.length === 0 ? <Text style={[styles.publicFoodDetailEmptyComments, isDark ? styles.publicFoodDetailEmptyCommentsDark : null]}>暂无评论，快来抢沙发</Text> : comments.map((entry) => renderComment(entry))}
        </View>
      </ScrollView>

      <View style={[styles.publicFoodDetailBottomBar, isDark ? styles.publicFoodDetailBottomBarDark : null, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.publicFoodDetailBottomTop}>
          {isCampusDetail ? (
            <Pressable
              disabled={!canQuickRecord}
              style={({ pressed }) => [styles.publicFoodDetailQuickRecord, !canQuickRecord ? styles.publicFoodDetailQuickRecordDisabled : null, pressed && canQuickRecord ? styles.pressed : null]}
              onPress={quickRecord}
              accessibilityRole="button"
              accessibilityLabel={analyzing ? '营养分析中，暂不能记录' : analysisFailed ? '营养分析失败，暂不能记录' : nutritionPending ? '营养信息待更新，暂不能记录' : '一键记录到今天'}
              accessibilityState={{ disabled: !canQuickRecord }}
            >
              <Text style={styles.publicFoodDetailQuickRecordText}>{analyzing ? '分析中' : analysisFailed || nutritionPending ? '暂不可记' : '一键记录'}</Text>
            </Pressable>
          ) : null}
          <View style={styles.publicFoodDetailBottomActions}>
            <Pressable
              disabled={Boolean(actionBusy)}
              style={({ pressed }) => [styles.publicFoodDetailIconAction, item.liked ? styles.publicFoodDetailIconActionLiked : null, isDark && item.liked ? styles.publicFoodDetailIconActionLikedDark : null, pressed ? styles.pressed : null]}
              onPress={toggleLike}
              accessibilityRole="button"
              accessibilityLabel={`${item.liked ? '取消点赞' : '点赞'}，当前 ${item.like_count || 0} 个赞`}
              accessibilityState={{ selected: Boolean(item.liked), busy: actionBusy === 'like', disabled: Boolean(actionBusy) }}
            >
              {actionBusy === 'like' ? <ActivityIndicator size="small" color={isDark ? '#fb7185' : '#e11d48'} /> : <Heart size={21} color={item.liked ? '#e11d48' : isDark ? '#b3bdb8' : '#64748b'} fill={item.liked ? '#e11d48' : 'transparent'} strokeWidth={2.2} />}
              {item.like_count ? <Text style={[styles.publicFoodDetailActionBadge, isDark ? styles.publicFoodDetailActionBadgeDark : null]}>{item.like_count}</Text> : null}
            </Pressable>
            <Pressable
              disabled={Boolean(actionBusy)}
              style={({ pressed }) => [styles.publicFoodDetailIconAction, item.collected ? styles.publicFoodDetailIconActionCollected : null, isDark && item.collected ? styles.publicFoodDetailIconActionCollectedDark : null, pressed ? styles.pressed : null]}
              onPress={toggleCollect}
              accessibilityRole="button"
              accessibilityLabel={`${item.collected ? '取消收藏' : '收藏'}，当前 ${item.collection_count || 0} 个收藏`}
              accessibilityState={{ selected: Boolean(item.collected), busy: actionBusy === 'collect', disabled: Boolean(actionBusy) }}
            >
              {actionBusy === 'collect' ? <ActivityIndicator size="small" color="#f59e0b" /> : <Bookmark size={21} color={item.collected ? '#d97706' : isDark ? '#b3bdb8' : '#64748b'} fill={item.collected ? '#fbbf24' : 'transparent'} strokeWidth={2.2} />}
              {item.collection_count ? <Text style={[styles.publicFoodDetailActionBadge, isDark ? styles.publicFoodDetailActionBadgeDark : null]}>{item.collection_count}</Text> : null}
            </Pressable>
            <Pressable style={({ pressed }) => [styles.publicFoodDetailIconAction, pressed ? styles.pressed : null]} onPress={() => openCommentComposer()} accessibilityRole="button" accessibilityLabel={`发表评论，当前 ${commentTotal} 条评论`}>
              <MessageCircle size={21} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} />
              {commentTotal ? <Text style={[styles.publicFoodDetailActionBadge, isDark ? styles.publicFoodDetailActionBadgeDark : null]}>{commentTotal}</Text> : null}
            </Pressable>
            <Pressable style={({ pressed }) => [styles.publicFoodDetailIconAction, pressed ? styles.pressed : null]} onPress={() => setActionSheetVisible(true)} accessibilityRole="button" accessibilityLabel="更多食物操作" accessibilityState={{ expanded: actionSheetVisible }}>
              <MoreHorizontal size={22} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.3} />
            </Pressable>
          </View>
        </View>
        <View style={styles.publicFoodDetailCorrectionBar}>
          <Text style={[styles.publicFoodDetailCorrectionHint, isDark ? styles.publicFoodDetailMutedTextDark : null]}>信息有误？</Text>
          <Pressable style={({ pressed }) => [styles.publicFoodDetailCorrectionButton, pressed ? styles.pressed : null]} onPress={() => setFeedbackModalVisible(true)} accessibilityRole="button" accessibilityLabel="修正食物信息">
            <Text style={[styles.publicFoodDetailCorrectionLink, isDark ? styles.publicFoodDetailCaloriesTextDark : null]}>点击修正</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={imagePreviewVisible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setImagePreviewVisible(false)}>
        <View style={styles.publicFoodDetailPreviewModal}>
          <View style={[styles.publicFoodDetailPreviewHeader, { paddingTop: insets.top + 8 }]}>
            <Text style={styles.publicFoodDetailPreviewTitle}>食物图片预览</Text>
            <Text style={styles.publicFoodDetailPreviewCounter}>{imageList.length ? `${previewImageIndex + 1}/${imageList.length}` : ''}</Text>
            <Pressable style={({ pressed }) => [styles.publicFoodDetailPreviewClose, pressed ? styles.publicFoodDetailPreviewPressed : null]} onPress={() => setImagePreviewVisible(false)} accessibilityRole="button" accessibilityLabel="关闭图片预览">
              <X size={24} color="#fff" strokeWidth={2.2} />
            </Pressable>
          </View>
          <ScrollView ref={previewScrollRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onPreviewScrollEnd} style={styles.publicFoodDetailPreviewScroller}>
            {imageList.map((src, index) => <View key={`${src}-preview-${index}`} style={[styles.publicFoodDetailPreviewSlide, { width: heroWidth, height: screenHeight }]}><Image source={{ uri: src }} style={styles.publicFoodDetailPreviewImage} resizeMode="contain" accessibilityLabel={`${detailTitle} 图片 ${index + 1}`} accessibilityIgnoresInvertColors /></View>)}
          </ScrollView>
          {imageList.length > 1 ? (
            <View style={[styles.publicFoodDetailPreviewControls, { paddingBottom: insets.bottom + 16 }]}>
              <Pressable disabled={previewImageIndex === 0} style={({ pressed }) => [styles.publicFoodDetailPreviewControl, previewImageIndex === 0 ? styles.publicFoodDetailPreviewControlDisabled : null, pressed ? styles.publicFoodDetailPreviewPressed : null]} onPress={() => { const next = Math.max(0, previewImageIndex - 1); setPreviewImageIndex(next); previewScrollRef.current?.scrollTo({ x: next * heroWidth, animated: true }) }} accessibilityRole="button" accessibilityLabel="上一张图片" accessibilityState={{ disabled: previewImageIndex === 0 }}><ChevronLeft size={24} color="#fff" strokeWidth={2.4} /></Pressable>
              <Pressable disabled={previewImageIndex >= imageList.length - 1} style={({ pressed }) => [styles.publicFoodDetailPreviewControl, previewImageIndex >= imageList.length - 1 ? styles.publicFoodDetailPreviewControlDisabled : null, pressed ? styles.publicFoodDetailPreviewPressed : null]} onPress={() => { const next = Math.min(imageList.length - 1, previewImageIndex + 1); setPreviewImageIndex(next); previewScrollRef.current?.scrollTo({ x: next * heroWidth, animated: true }) }} accessibilityRole="button" accessibilityLabel="下一张图片" accessibilityState={{ disabled: previewImageIndex >= imageList.length - 1 }}><ChevronRight size={24} color="#fff" strokeWidth={2.4} /></Pressable>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal visible={commentModalVisible} transparent animationType="slide" statusBarTranslucent onRequestClose={closeCommentComposer}>
        <KeyboardAvoidingView style={styles.publicFoodDetailModalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.publicFoodDetailModalBackdrop} onPress={closeCommentComposer} accessibilityRole="button" accessibilityLabel="关闭评论弹层">
            <Pressable style={[styles.publicFoodDetailComposerSheet, isDark ? styles.publicFoodDetailComposerSheetDark : null, { paddingBottom: Math.max(insets.bottom, 18) }]} onPress={(event) => event.stopPropagation()}>
              <View style={[styles.publicFoodDetailSheetHandle, isDark ? styles.publicFoodDetailSheetHandleDark : null]} />
              <View style={styles.publicFoodDetailComposerHeader}>
                <Text style={[styles.publicFoodDetailComposerTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>{replyTarget ? `回复 @${replyTarget.nickname}` : '发表评论'}</Text>
                <Pressable style={({ pressed }) => [styles.publicFoodDetailSheetClose, pressed ? styles.pressed : null]} onPress={closeCommentComposer} accessibilityRole="button" accessibilityLabel="关闭评论弹层"><X size={21} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} /></Pressable>
              </View>
              {!replyTarget ? (
                <View style={styles.publicFoodDetailRatingRow}>
                  <Text style={[styles.publicFoodDetailRatingLabel, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>评分（可选）</Text>
                  <View style={styles.publicFoodDetailRatingButtons} accessibilityRole="radiogroup">
                    {[1, 2, 3, 4, 5].map((value) => {
                      const selected = value <= commentRating
                      return <Pressable key={value} style={({ pressed }) => [styles.publicFoodDetailRatingButton, isDark ? styles.publicFoodDetailRatingButtonDark : null, pressed ? styles.pressed : null]} onPress={() => setCommentRating(value === commentRating ? 0 : value)} accessibilityRole="radio" accessibilityLabel={`${value} 星`} accessibilityState={{ checked: commentRating === value }}><Star size={23} color="#f59e0b" fill={selected ? '#f59e0b' : 'transparent'} strokeWidth={2} /></Pressable>
                    })}
                  </View>
                </View>
              ) : null}
              <TextInput
                ref={commentInputRef}
                value={comment}
                onChangeText={setComment}
                placeholder={replyTarget ? `回复 @${replyTarget.nickname}...` : '分享你的想法...'}
                placeholderTextColor={isDark ? '#7f8c87' : colors.textMuted}
                multiline
                maxLength={500}
                textAlignVertical="top"
                style={[styles.publicFoodDetailComposerInput, isDark ? styles.publicFoodDetailComposerInputDark : null]}
                accessibilityLabel={replyTarget ? `回复 ${replyTarget.nickname}` : '评论内容'}
              />
              <Pressable disabled={!comment.trim() || submittingComment} style={({ pressed }) => [styles.publicFoodDetailComposerSubmit, (!comment.trim() || submittingComment) ? styles.publicFoodDetailActionDisabled : null, pressed && comment.trim() && !submittingComment ? styles.pressed : null]} onPress={() => void addComment()} accessibilityRole="button" accessibilityLabel={replyTarget ? '发布回复' : '发表评论'} accessibilityState={{ disabled: !comment.trim() || submittingComment, busy: submittingComment }}>
                {submittingComment ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.publicFoodDetailComposerSubmitText}>{replyTarget ? '发布回复' : '发表评论'}</Text>}
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={feedbackModalVisible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => !submittingFeedback && setFeedbackModalVisible(false)}>
        <KeyboardAvoidingView style={styles.publicFoodDetailModalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.publicFoodDetailModalBackdrop} onPress={() => !submittingFeedback && setFeedbackModalVisible(false)} accessibilityRole="button" accessibilityLabel="关闭修正弹层">
            <Pressable style={[styles.publicFoodDetailComposerSheet, isDark ? styles.publicFoodDetailComposerSheetDark : null, { paddingBottom: Math.max(insets.bottom, 18) }]} onPress={(event) => event.stopPropagation()}>
              <View style={[styles.publicFoodDetailSheetHandle, isDark ? styles.publicFoodDetailSheetHandleDark : null]} />
              <View style={styles.publicFoodDetailComposerHeader}>
                <View style={styles.flex}>
                  <Text style={[styles.publicFoodDetailComposerTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>修正食物信息</Text>
                  <Text style={[styles.publicFoodDetailComposerHint, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>请说明食物名称、热量或其他有误的地方</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.publicFoodDetailSheetClose, pressed ? styles.pressed : null]} onPress={() => setFeedbackModalVisible(false)} accessibilityRole="button" accessibilityLabel="关闭修正弹层"><X size={21} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} /></Pressable>
              </View>
              <TextInput value={feedback} onChangeText={setFeedback} placeholder="请输入修正说明..." placeholderTextColor={isDark ? '#7f8c87' : colors.textMuted} multiline maxLength={500} textAlignVertical="top" style={[styles.publicFoodDetailComposerInput, isDark ? styles.publicFoodDetailComposerInputDark : null]} accessibilityLabel="修正说明" />
              <Pressable disabled={!feedback.trim() || submittingFeedback} style={({ pressed }) => [styles.publicFoodDetailComposerSubmit, (!feedback.trim() || submittingFeedback) ? styles.publicFoodDetailActionDisabled : null, pressed && feedback.trim() && !submittingFeedback ? styles.pressed : null]} onPress={() => void submitFeedback()} accessibilityRole="button" accessibilityLabel="提交修正" accessibilityState={{ disabled: !feedback.trim() || submittingFeedback, busy: submittingFeedback }}>
                {submittingFeedback ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.publicFoodDetailComposerSubmitText}>提交修正</Text>}
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={actionSheetVisible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setActionSheetVisible(false)}>
        <Pressable style={styles.publicFoodDetailModalBackdrop} onPress={() => setActionSheetVisible(false)} accessibilityRole="button" accessibilityLabel="关闭更多操作">
          <Pressable style={[styles.publicFoodDetailActionSheet, isDark ? styles.publicFoodDetailActionSheetDark : null, { paddingBottom: Math.max(insets.bottom, 18) }]} onPress={(event) => event.stopPropagation()}>
            <View style={[styles.publicFoodDetailSheetHandle, isDark ? styles.publicFoodDetailSheetHandleDark : null]} />
            <Text style={[styles.publicFoodDetailSheetTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>食物操作</Text>
            <Pressable style={({ pressed }) => [styles.publicFoodDetailSheetAction, isDark ? styles.publicFoodDetailSheetActionDark : null, pressed ? styles.pressed : null]} onPress={() => void shareItem()} accessibilityRole="button" accessibilityLabel="转发给朋友"><Share2 size={21} color={isDark ? '#7dd3b0' : colors.brand} strokeWidth={2.2} /><Text style={[styles.publicFoodDetailSheetActionText, isDark ? styles.publicFoodDetailSheetActionTextDark : null]}>转发给朋友</Text></Pressable>
            {isOwner ? <Pressable style={({ pressed }) => [styles.publicFoodDetailSheetAction, isDark ? styles.publicFoodDetailSheetActionDark : null, pressed ? styles.pressed : null]} onPress={() => { setActionSheetVisible(false); navigation.navigate('PublicFoodShare', { editId: item.id, mode: isCampusPublicFoodItem(item) ? 'campus' : 'public' }) }} accessibilityRole="button" accessibilityLabel="编辑食物"><Edit3 size={21} color={isDark ? '#7dd3b0' : colors.brand} strokeWidth={2.2} /><Text style={[styles.publicFoodDetailSheetActionText, isDark ? styles.publicFoodDetailSheetActionTextDark : null]}>编辑</Text></Pressable> : null}
            {isOwner ? <Pressable disabled={deleting} style={({ pressed }) => [styles.publicFoodDetailSheetAction, styles.publicFoodDetailSheetActionDanger, isDark ? styles.publicFoodDetailSheetActionDark : null, pressed ? styles.pressed : null]} onPress={confirmRemove} accessibilityRole="button" accessibilityLabel="删除食物" accessibilityState={{ disabled: deleting, busy: deleting }}>{deleting ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 size={21} color={colors.danger} strokeWidth={2.2} />}<Text style={[styles.publicFoodDetailSheetActionText, styles.publicFoodDetailDangerText]}>删除</Text></Pressable> : null}
            <Pressable style={({ pressed }) => [styles.publicFoodDetailSheetCancel, isDark ? styles.publicFoodDetailSheetCancelDark : null, pressed ? styles.pressed : null]} onPress={() => setActionSheetVisible(false)} accessibilityRole="button" accessibilityLabel="取消"><Text style={[styles.publicFoodDetailSheetCancelText, isDark ? styles.publicFoodDetailSheetActionTextDark : null]}>取消</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

export function CommunityFeedDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'CommunityFeedDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const { isDark } = useColorScheme()
  const { width: screenWidth, height: screenHeight, fontScale } = useWindowDimensions()
  const commentInputRef = useRef<TextInput | null>(null)
  const imagePreviewRef = useRef<ScrollView | null>(null)
  const [context, setContext] = useState<CommunityFeedContext | null>(null)
  const [comment, setComment] = useState('')
  const [reportText, setReportText] = useState('')
  const [loading, setLoading] = useState(false)
  const [liking, setLiking] = useState(false)
  const [submittingComment, setSubmittingComment] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [replyTarget, setReplyTarget] = useState<FeedCommentItem | null>(null)
  const [actionSheetVisible, setActionSheetVisible] = useState(false)
  const [reportSheetVisible, setReportSheetVisible] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [commentInputFocused, setCommentInputFocused] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [deletingCommentId, setDeletingCommentId] = useState('')
  const [manualFoodsExpanded, setManualFoodsExpanded] = useState(false)
  const [microsExpanded, setMicrosExpanded] = useState(false)
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.communityGetContext(route.params.targetId, route.params.targetType)
      setContext(data.item)
    } catch (error) {
      showError('获取动态详情失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params.targetId, route.params.targetType])

  useEffect(() => {
    setManualFoodsExpanded(false)
    setMicrosExpanded(false)
    setPreviewImageIndex(null)
    void load()
  }, [load])

  useEffect(() => {
    void getStoredUserId().then((userId) => setCurrentUserId(String(userId || '').trim()))
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height)
      setCommentInputFocused(true)
    })
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0)
      setCommentInputFocused(false)
    })
    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [])

  const record = context?.record
  const author = context?.author
  const isCirclePost = route.params.targetType === 'circle_post'
  const isExercise = route.params.targetType === 'exercise_log'
  const isMine = Boolean(isCirclePost && context?.is_mine)
  const recordTitle = communityDetailTitle(record, route.params.targetType)
  const recordBody = communityDetailBody(record, route.params.targetType)
  const images = communityDetailImages(record)
  const displayImages = images.slice(0, 9)
  const comments = context?.comments || []
  const hasNutrition = communityDetailHasNutrition(record)
  const manualFoodItems = useMemo(
    () => communityDetailShouldRenderManualFoodCards(record) && !isExercise && !isCirclePost
      ? communityDetailManualFoodItems(record?.items)
      : [],
    [isCirclePost, isExercise, record],
  )
  const visibleManualFoodItems = manualFoodsExpanded ? manualFoodItems : manualFoodItems.slice(0, 3)
  const microRows = useMemo(
    () => isExercise ? [] : communityDetailMicroRows(record, isCirclePost),
    [isCirclePost, isExercise, record],
  )
  const useThreeMicroColumns = screenWidth >= 390 && fontScale <= 1.15
  const bottomBarKeyboardOffset = Platform.OS === 'android'
    ? keyboardHeight || (commentInputFocused ? 360 : 0)
    : 0

  const openImagePreview = (index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), Math.max(displayImages.length - 1, 0))
    setPreviewImageIndex(nextIndex)
    setTimeout(() => imagePreviewRef.current?.scrollTo({ x: nextIndex * screenWidth, animated: false }), 0)
  }

  const scrollImagePreviewTo = (index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), Math.max(displayImages.length - 1, 0))
    setPreviewImageIndex(nextIndex)
    imagePreviewRef.current?.scrollTo({ x: nextIndex * screenWidth, animated: true })
  }

  const handleImagePreviewScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.min(
      Math.max(Math.round(event.nativeEvent.contentOffset.x / Math.max(screenWidth, 1)), 0),
      Math.max(displayImages.length - 1, 0),
    )
    setPreviewImageIndex(nextIndex)
  }

  const addComment = async () => {
    const content = comment.trim()
    if (!content) return
    setSubmittingComment(true)
    try {
      await apiClient.communityAddComment({
        targetId: route.params.targetId,
        targetType: route.params.targetType,
        content,
        parentCommentId: replyTarget?.parent_comment_id || replyTarget?.id,
        replyToUserId: replyTarget?.user_id,
      })
      setComment('')
      setReplyTarget(null)
      await load()
    } catch (error) {
      showError('评论失败', error)
    } finally {
      setSubmittingComment(false)
    }
  }

  const editPost = () => {
    setActionSheetVisible(false)
    navigation.navigate('CirclePostEdit', { postId: route.params.targetId })
  }

  const deletePost = () => {
    setActionSheetVisible(false)
    Alert.alert('删除动态', '删除后这条动态和相关互动将不再显示。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true)
          try {
            await apiClient.deleteCirclePost(route.params.targetId)
            Alert.alert('已删除', '动态已删除')
            navigation.goBack()
          } catch (error) {
            showError('删除失败', error)
          } finally {
            setDeleting(false)
          }
        },
      },
    ])
  }

  const report = async () => {
    setReporting(true)
    try {
      await apiClient.communityReport({
        targetId: route.params.targetId,
        targetType: route.params.targetType,
        reason: 'other',
        extraContent: reportText,
      })
      setReportText('')
      setReportSheetVisible(false)
      Alert.alert('已举报', '举报已提交给管理员。')
    } catch (error) {
      showError('举报失败', error)
    } finally {
      setReporting(false)
    }
  }

  const toggleLike = async () => {
    if (!record || liking) return
    const previousLiked = Boolean(context?.liked)
    const previousCount = Number(context?.like_count || 0)
    setLiking(true)
    setContext((current) => current ? {
      ...current,
      liked: !previousLiked,
      like_count: Math.max(0, previousCount + (previousLiked ? -1 : 1)),
    } : current)
    try {
      if (previousLiked) await apiClient.communityUnlike(route.params.targetId, route.params.targetType)
      else await apiClient.communityLike(route.params.targetId, route.params.targetType)
    } catch (error) {
      setContext((current) => current ? { ...current, liked: previousLiked, like_count: previousCount } : current)
      showError('操作失败', error)
    } finally {
      setLiking(false)
    }
  }

  const focusCommentInput = (target?: FeedCommentItem | null) => {
    setReplyTarget(target || null)
    setTimeout(() => commentInputRef.current?.focus(), 60)
  }

  const deleteComment = (entry: FeedCommentItem) => {
    const canDelete = Boolean(currentUserId && entry.user_id === currentUserId) || Boolean(context?.is_mine)
    if (!canDelete || deletingCommentId) return
    Alert.alert('删除评论', '删除后无法恢复，相关回复也会一并删除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeletingCommentId(entry.id)
          try {
            await apiClient.communityDeleteComment({
              targetId: route.params.targetId,
              targetType: route.params.targetType,
              commentId: entry.id,
            })
            const subtreeIds = buildCommunityCommentSubtreeIds(comments, entry.id)
            setContext((current) => {
              if (!current) return current
              const nextComments = (current.comments || []).filter((commentItem) => !subtreeIds.has(commentItem.id))
              const removedCount = (current.comments || []).length - nextComments.length
              return {
                ...current,
                comments: nextComments,
                comment_count: Math.max(0, Number(current.comment_count || 0) - removedCount),
              }
            })
            if (replyTarget && subtreeIds.has(replyTarget.id)) setReplyTarget(null)
          } catch (error) {
            showError('删除评论失败', error)
          } finally {
            setDeletingCommentId('')
          }
        },
      },
    ])
  }

  const openReportSheet = () => {
    setActionSheetVisible(false)
    setReportSheetVisible(true)
  }

  return (
    <View style={[styles.communityDetailPage, isDark ? styles.communityDetailPageDark : null]}>
      <ScrollView
        style={styles.communityDetailScroll}
        contentContainerStyle={[
          styles.communityDetailContent,
          { paddingBottom: record ? insets.bottom + 92 + bottomBarKeyboardOffset : insets.bottom + 28 },
        ]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
        keyboardShouldPersistTaps="handled"
      >
        {loading && !record ? (
          <CommunityDetailSkeleton />
        ) : !record ? (
          <View style={styles.communityDetailEmpty}>
            <Text style={[styles.communityDetailEmptyText, isDark ? styles.communityDetailEmptyTextDark : null]}>未找到对应动态</Text>
          </View>
        ) : (
          <View style={styles.communityDetailFeedList}>
            <View style={[
              styles.communityDetailFeedCard,
              isExercise ? styles.communityDetailFeedCardExercise : null,
              isCirclePost ? styles.communityDetailFeedCardCirclePost : null,
              isDark ? styles.communityDetailFeedCardDark : null,
              isExercise && isDark ? styles.communityDetailFeedCardExerciseDark : null,
            ]}>
              <View style={styles.communityDetailMomentsRow}>
                <Pressable
                  style={({ pressed }) => [styles.communityDetailAvatarCol, pressed ? styles.pressed : null]}
                  onPress={() => author?.id ? navigation.navigate('ProfileSettings', { userId: author.id }) : undefined}
                  disabled={!author?.id}
                  accessibilityRole="button"
                  accessibilityLabel={`查看${context?.is_mine ? '我' : author?.nickname || '食友'}的主页`}
                  accessibilityState={{ disabled: !author?.id }}
                >
                  {author?.avatar ? (
                    <Image
                      source={{ uri: author.avatar }}
                      style={[styles.communityDetailAvatar, isDark ? styles.communityDetailAvatarDark : null]}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <View style={[styles.communityDetailAvatarFallback, isDark ? styles.communityDetailAvatarFallbackDark : null]}>
                      <UserRound size={18} color={isDark ? '#7dd3b0' : colors.brand} strokeWidth={2.1} />
                    </View>
                  )}
                </Pressable>

                <View style={styles.communityDetailMainCol}>
                  <Pressable
                    style={({ pressed }) => [styles.communityDetailNameBlock, pressed ? styles.pressed : null]}
                    onPress={() => author?.id ? navigation.navigate('ProfileSettings', { userId: author.id }) : undefined}
                    disabled={!author?.id}
                    accessibilityRole="button"
                    accessibilityLabel={`查看${context?.is_mine ? '我' : author?.nickname || '食友'}的主页`}
                    accessibilityState={{ disabled: !author?.id }}
                  >
                    <Text style={[styles.communityDetailUserName, isDark ? styles.communityDetailUserNameDark : null]}>{context?.is_mine ? '我' : author?.nickname || '食友'}</Text>
                    <Text style={[styles.communityDetailPostTime, isDark ? styles.communityDetailPostTimeDark : null]}>{communityDetailMeta(record, route.params.targetType)}</Text>
                  </Pressable>

                  {communityDetailTag(record, route.params.targetType) ? (
                    <View style={styles.communityDetailTags}>
                      <Text style={[
                        styles.communityDetailTag,
                        isExercise ? styles.communityDetailTagExercise : null,
                        isDark ? styles.communityDetailTagDark : null,
                        isExercise && isDark ? styles.communityDetailTagExerciseDark : null,
                      ]}>
                        {communityDetailTag(record, route.params.targetType)}
                      </Text>
                    </View>
                  ) : null}

                  {recordTitle ? <Text style={[styles.communityDetailTitle, isDark ? styles.communityDetailTitleDark : null]}>{recordTitle}</Text> : null}
                  {recordBody ? <Text style={[styles.communityDetailBody, isDark ? styles.communityDetailBodyDark : null]}>{recordBody}</Text> : null}

                  {displayImages.length > 0 ? (
                    <View style={[styles.communityDetailImageGrid, displayImages.length === 1 && styles.communityDetailImageGridSingle]}>
                      {displayImages.map((url, index) => (
                        <Pressable
                          key={`${url}-${index}`}
                          style={({ pressed }) => [
                            displayImages.length === 1 ? styles.communityDetailImageSingle : styles.communityDetailImageTile,
                            isDark ? styles.communityDetailImageDark : null,
                            pressed ? styles.communityDetailImagePressed : null,
                          ]}
                          onPress={() => openImagePreview(index)}
                          accessibilityRole="button"
                          accessibilityLabel={`预览动态图片 ${index + 1}，共 ${displayImages.length} 张`}
                        >
                          <Image
                            source={{ uri: url }}
                            style={styles.communityDetailImageFill}
                            resizeMode="cover"
                            accessibilityIgnoresInvertColors
                          />
                          <View style={styles.communityDetailImagePreviewBadge} pointerEvents="none">
                            <Maximize2 size={14} color="#fff" strokeWidth={2.3} />
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  {manualFoodItems.length > 0 ? (
                    <View style={styles.communityDetailManualFoods}>
                      {visibleManualFoodItems.map((item, index) => {
                        const canOpenDetail = Boolean(item.sourceId)
                        return (
                          <Pressable
                            key={`${item.sourceId || item.displayName}-${index}`}
                            style={({ pressed }) => [
                              styles.communityDetailManualFoodCard,
                              isDark ? styles.communityDetailManualFoodCardDark : null,
                              pressed && canOpenDetail ? styles.communityDetailManualFoodCardPressed : null,
                            ]}
                            disabled={!canOpenDetail}
                            onPress={() => {
                              if (item.sourceId) navigation.navigate('FoodLibraryDetail', { item: item.detailItem })
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`${item.displayName}${item.sourceLabel ? `，${item.sourceLabel}` : ''}${item.calories > 0 ? `，${Math.round(item.calories)} 千卡` : ''}`}
                            accessibilityHint={canOpenDetail ? '查看食物库详情' : undefined}
                            accessibilityState={{ disabled: !canOpenDetail }}
                          >
                            {item.imageUrl ? (
                              <Image source={{ uri: item.imageUrl }} style={styles.communityDetailManualFoodImage} resizeMode="cover" accessibilityIgnoresInvertColors />
                            ) : (
                              <View style={[styles.communityDetailManualFoodImageFallback, isDark ? styles.communityDetailManualFoodImageFallbackDark : null]}>
                                <ImageIcon size={18} color={isDark ? '#9ca3a8' : '#94a3b8'} strokeWidth={2} />
                              </View>
                            )}
                            <View style={styles.communityDetailManualFoodInfo}>
                              <Text style={[styles.communityDetailManualFoodTitle, isDark ? styles.communityDetailManualFoodTitleDark : null]} numberOfLines={2}>{item.displayName}</Text>
                              <View style={styles.communityDetailManualFoodMeta}>
                                {item.sourceLabel ? <Text style={[styles.communityDetailManualFoodBadge, isDark ? styles.communityDetailManualFoodBadgeDark : null]}>{item.sourceLabel}</Text> : null}
                                {item.calories > 0 ? <Text style={[styles.communityDetailManualFoodCalories, isDark ? styles.communityDetailManualFoodCaloriesDark : null]}>{Math.round(item.calories)} kcal</Text> : null}
                              </View>
                            </View>
                            {canOpenDetail ? <ChevronRight size={18} color={isDark ? '#9ca3a8' : '#94a3b8'} strokeWidth={2.2} /> : null}
                          </Pressable>
                        )
                      })}
                      {manualFoodItems.length > 3 ? (
                        <Pressable
                          style={({ pressed }) => [styles.communityDetailManualFoodExpand, isDark ? styles.communityDetailManualFoodExpandDark : null, pressed ? styles.pressed : null]}
                          onPress={() => setManualFoodsExpanded((previous) => !previous)}
                          accessibilityRole="button"
                          accessibilityLabel={manualFoodsExpanded ? '收起手工食物' : `展开其余 ${manualFoodItems.length - 3} 项手工食物`}
                          accessibilityState={{ expanded: manualFoodsExpanded }}
                        >
                          <Text style={[styles.communityDetailManualFoodExpandText, isDark ? styles.communityDetailManualFoodExpandTextDark : null]}>
                            {manualFoodsExpanded ? '收起' : `展开更多（${manualFoodItems.length - 3}）`}
                          </Text>
                          {manualFoodsExpanded
                            ? <ChevronUp size={17} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} />
                            : <ChevronDown size={17} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} />}
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  {hasNutrition ? (
                    <View style={[
                      styles.communityDetailMetaCard,
                      isExercise ? styles.communityDetailMetaCardExercise : null,
                      isDark ? styles.communityDetailMetaCardDark : null,
                      isExercise && isDark ? styles.communityDetailMetaCardExerciseDark : null,
                    ]}>
                      <View style={[styles.communityDetailCalorie, isExercise && styles.communityDetailCalorieExercise]}>
                        <Text style={[styles.communityDetailCalorieNum, isDark ? styles.communityDetailCalorieNumDark : null]}>{communityDetailKcal(record, route.params.targetType)}</Text>
                        <Text style={[styles.communityDetailCalorieUnit, isDark ? styles.communityDetailCalorieUnitDark : null]}>kcal{isExercise ? ' 消耗' : ''}</Text>
                      </View>
                      <View style={styles.communityDetailMacros}>
                        <Text style={[
                          styles.communityDetailMacrosText,
                          isExercise ? styles.communityDetailMacrosTextExercise : null,
                          isDark ? styles.communityDetailMacrosTextDark : null,
                          isExercise && isDark ? styles.communityDetailMacrosTextExerciseDark : null,
                        ]}>
                          {communityDetailMacroText(record, route.params.targetType)}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  {microRows.length > 0 ? (
                    <View style={[styles.communityDetailMicros, isDark ? styles.communityDetailMicrosDark : null]}>
                      <Pressable
                        style={({ pressed }) => [styles.communityDetailMicrosHead, pressed ? styles.pressed : null]}
                        onPress={() => setMicrosExpanded((previous) => !previous)}
                        accessibilityRole="button"
                        accessibilityLabel={microsExpanded ? '收起微量元素' : `展开 ${microRows.length} 项微量元素`}
                        accessibilityState={{ expanded: microsExpanded }}
                      >
                        <Text style={[styles.communityDetailMicrosTitle, isDark ? styles.communityDetailMicrosTitleDark : null]}>微量元素</Text>
                        <View style={styles.communityDetailMicrosToggle}>
                          <Text style={[styles.communityDetailMicrosToggleText, isDark ? styles.communityDetailMicrosToggleTextDark : null]}>{microsExpanded ? '收起' : '展开'}</Text>
                          {microsExpanded
                            ? <ChevronUp size={17} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} />
                            : <ChevronDown size={17} color={isDark ? '#b3bdb8' : '#64748b'} strokeWidth={2.2} />}
                        </View>
                      </Pressable>
                      {!microsExpanded ? (
                        <Text style={[styles.communityDetailMicrosSummary, isDark ? styles.communityDetailMicrosSummaryDark : null]}>
                          {microRows.slice(0, 3).map((row) => `${row.meta.label} ${communityDetailFormatMicroValue(row.value)}${row.meta.unit}`).join(' · ')}
                          {microRows.length > 3 ? ` 等 ${microRows.length} 项` : ''}
                        </Text>
                      ) : (
                        <View style={styles.communityDetailMicrosGrid}>
                          {microRows.map((row) => (
                            <View
                              key={row.meta.key}
                              style={[
                                styles.communityDetailMicroCell,
                                { width: useThreeMicroColumns ? '31.5%' : '48.5%', backgroundColor: `${row.color}14`, borderColor: `${row.color}33` },
                                isDark ? styles.communityDetailMicroCellDark : null,
                              ]}
                              accessible
                              accessibilityLabel={`${row.meta.label} ${communityDetailFormatMicroValue(row.value)} ${row.meta.unit}`}
                            >
                              <Text style={[styles.communityDetailMicroLabel, { color: `${row.color}cc` }]}>{row.meta.label}</Text>
                              <View style={styles.communityDetailMicroValueRow}>
                                <Text style={[styles.communityDetailMicroValue, { color: row.color }]}>{communityDetailFormatMicroValue(row.value)}</Text>
                                <Text style={[styles.communityDetailMicroUnit, { color: `${row.color}cc` }]}>{row.meta.unit}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.communityDetailActions}>
                    <View style={styles.communityDetailActionsLeft}>
                      <Pressable
                        style={({ pressed }) => [styles.communityDetailActionItem, pressed ? styles.pressed : null]}
                        onPress={toggleLike}
                        disabled={liking}
                        accessibilityRole="button"
                        accessibilityLabel={context?.liked ? `取消点赞，当前 ${context?.like_count || 0} 个赞` : `点赞，当前 ${context?.like_count || 0} 个赞`}
                        accessibilityState={{ selected: Boolean(context?.liked), disabled: liking, busy: liking }}
                      >
                        {liking ? (
                          <ActivityIndicator size="small" color={colors.danger} />
                        ) : (
                          <Heart size={19} color={context?.liked ? colors.danger : isDark ? '#9ca3a8' : '#64748b'} fill={context?.liked ? colors.danger : 'transparent'} strokeWidth={2.2} />
                        )}
                        <Text style={[styles.communityDetailActionCount, isDark ? styles.communityDetailActionCountDark : null, context?.liked ? styles.communityDetailActionCountActive : null]}>{context?.like_count || 0}</Text>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.communityDetailActionItem, pressed ? styles.pressed : null]}
                        onPress={() => focusCommentInput(null)}
                        accessibilityRole="button"
                        accessibilityLabel={`发表评论，当前 ${context?.comment_count || comments.length || 0} 条评论`}
                      >
                        <MessageCircle size={19} color={isDark ? '#9ca3a8' : '#64748b'} strokeWidth={2.2} />
                        <Text style={[styles.communityDetailActionCount, isDark ? styles.communityDetailActionCountDark : null]}>评论 {context?.comment_count || comments.length || 0}</Text>
                      </Pressable>
                    </View>
                    <Pressable
                      style={({ pressed }) => [styles.communityDetailManageBox, isDark ? styles.communityDetailManageBoxDark : null, pressed ? styles.pressed : null]}
                      onPress={() => setActionSheetVisible(true)}
                      accessibilityRole="button"
                      accessibilityLabel="更多动态操作"
                    >
                      <MoreHorizontal size={19} color={isDark ? '#9ca3a8' : '#64748b'} strokeWidth={2.3} />
                    </Pressable>
                  </View>

                  {comments.length > 0 ? (
                    <View style={[styles.communityDetailComments, isDark ? styles.communityDetailCommentsDark : null]}>
                      {comments.map((entry) => {
                        const canDeleteComment = Boolean(currentUserId && entry.user_id === currentUserId) || Boolean(context?.is_mine)
                        return (
                        <Pressable
                          key={entry.id}
                          style={({ pressed }) => [
                            styles.communityDetailCommentItem,
                            entry.reply_to_user_id ? styles.communityDetailCommentReply : null,
                            entry.reply_to_user_id && isDark ? styles.communityDetailCommentReplyDark : null,
                            deletingCommentId === entry.id ? styles.communityDetailCommentDeleting : null,
                            pressed ? styles.pressed : null,
                          ]}
                          onPress={() => focusCommentInput(entry)}
                          onLongPress={canDeleteComment ? () => deleteComment(entry) : undefined}
                          delayLongPress={420}
                          accessibilityRole="button"
                          accessibilityLabel={`${entry.nickname || '用户'}评论：${entry.content}`}
                          accessibilityHint={canDeleteComment ? '轻点回复，长按删除' : '轻点回复'}
                          accessibilityState={{ disabled: deletingCommentId === entry.id }}
                        >
                          <View style={[styles.communityDetailCommentAvatar, isDark ? styles.communityDetailCommentAvatarDark : null]}>
                            {entry.avatar ? <Image source={{ uri: entry.avatar }} style={styles.communityDetailCommentAvatarImage} /> : null}
                          </View>
                          <View style={styles.communityDetailCommentBody}>
                            <View style={styles.communityDetailCommentMetaLine}>
                              <Text style={[styles.communityDetailCommentAuthor, isDark ? styles.communityDetailCommentAuthorDark : null]}>{entry.nickname || '用户'}</Text>
                              {entry.reply_to_user_id ? <Text style={[styles.communityDetailCommentReplyTo, isDark ? styles.communityDetailCommentReplyToDark : null]}>回复 {entry.reply_to_nickname || '用户'}</Text> : null}
                            </View>
                            <Text style={[styles.communityDetailCommentText, isDark ? styles.communityDetailCommentTextDark : null]}>{entry.content}</Text>
                          </View>
                          {canDeleteComment ? (
                            <Pressable
                              style={({ pressed }) => [styles.communityDetailCommentDelete, pressed ? styles.pressed : null]}
                              disabled={Boolean(deletingCommentId)}
                              accessibilityRole="button"
                              accessibilityLabel={`删除${entry.nickname || '用户'}的评论`}
                              accessibilityState={{ disabled: Boolean(deletingCommentId), busy: deletingCommentId === entry.id }}
                              onPress={(event) => {
                                event.stopPropagation()
                                deleteComment(entry)
                              }}
                            >
                              {deletingCommentId === entry.id ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 size={15} color={colors.danger} strokeWidth={2} />}
                            </Pressable>
                          ) : null}
                        </Pressable>
                        )
                      })}
                    </View>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.communityDetailCommentEmpty, isDark ? styles.communityDetailCommentEmptyDark : null, pressed ? styles.pressed : null]}
                      onPress={() => focusCommentInput(null)}
                      accessibilityRole="button"
                      accessibilityLabel="还没有评论，发表评论"
                    >
                      <Text style={[styles.communityDetailCommentEmptyText, isDark ? styles.communityDetailCommentEmptyTextDark : null]}>还没有评论，来抢沙发</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {record ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.communityDetailBottomBar, isDark ? styles.communityDetailBottomBarDark : null, { bottom: bottomBarKeyboardOffset, paddingBottom: Math.max(insets.bottom, 10) }]}
        >
          {replyTarget ? (
            <View style={[styles.communityDetailReplyBar, isDark ? styles.communityDetailReplyBarDark : null]}>
              <Text style={[styles.communityDetailReplyText, isDark ? styles.communityDetailReplyTextDark : null]}>回复 {replyTarget.nickname || '用户'}</Text>
              <Pressable
                style={({ pressed }) => [styles.communityDetailReplyClose, pressed ? styles.pressed : null]}
                onPress={() => setReplyTarget(null)}
                accessibilityRole="button"
                accessibilityLabel="取消回复"
              >
                <X size={16} color={isDark ? '#9ca3a8' : '#64748b'} strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.communityDetailCommentComposer}>
            <TextInput
              ref={commentInputRef}
              value={comment}
              onChangeText={setComment}
              placeholder={replyTarget ? `回复 ${replyTarget.nickname || '用户'}...` : '说点什么...'}
              placeholderTextColor={isDark ? '#7f8c87' : '#94a3b8'}
              style={[styles.communityDetailCommentInput, isDark ? styles.communityDetailCommentInputDark : null]}
              accessibilityLabel={replyTarget ? `回复 ${replyTarget.nickname || '用户'}` : '发表评论'}
              onFocus={() => setCommentInputFocused(true)}
              onBlur={() => setCommentInputFocused(false)}
              returnKeyType="send"
              onSubmitEditing={() => void addComment()}
              maxLength={500}
            />
            <Pressable
              style={({ pressed }) => [
                styles.communityDetailSendButton,
                isDark ? styles.communityDetailSendButtonDark : null,
                !comment.trim() || submittingComment ? styles.communityDetailSendButtonDisabled : null,
                (!comment.trim() || submittingComment) && isDark ? styles.communityDetailSendButtonDisabledDark : null,
                comment.trim() && !submittingComment ? styles.communityDetailSendButtonReady : null,
                pressed ? styles.pressed : null,
              ]}
              onPress={() => void addComment()}
              disabled={!comment.trim() || submittingComment}
              accessibilityRole="button"
              accessibilityLabel="发送评论"
              accessibilityState={{ disabled: !comment.trim() || submittingComment, busy: submittingComment }}
            >
              {submittingComment ? <ActivityIndicator size="small" color="#fff" /> : <Send size={18} color={comment.trim() ? '#fff' : isDark ? '#7f8c87' : '#94a3b8'} strokeWidth={2.4} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      <Modal
        visible={previewImageIndex !== null && displayImages.length > 0}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => setPreviewImageIndex(null)}
      >
        <View style={styles.communityDetailImagePreview} accessibilityViewIsModal>
          <ScrollView
            ref={imagePreviewRef}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleImagePreviewScrollEnd}
            scrollEventThrottle={16}
            accessibilityLabel="动态图片预览"
          >
            {displayImages.map((url, index) => (
              <View key={`preview-${url}-${index}`} style={[styles.communityDetailImagePreviewSlide, { width: screenWidth, height: screenHeight }]}>
                <Image source={{ uri: url }} style={styles.communityDetailImagePreviewImage} resizeMode="contain" accessibilityIgnoresInvertColors />
              </View>
            ))}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [styles.communityDetailImagePreviewClose, { top: Math.max(insets.top, 12) + 6 }, pressed ? styles.communityDetailImagePreviewControlPressed : null]}
            onPress={() => setPreviewImageIndex(null)}
            accessibilityRole="button"
            accessibilityLabel="关闭图片预览"
          >
            <X size={23} color="#fff" strokeWidth={2.3} />
          </Pressable>
          {displayImages.length > 1 && previewImageIndex !== null ? (
            <>
              {previewImageIndex > 0 ? (
                <Pressable
                  style={({ pressed }) => [styles.communityDetailImagePreviewPrevious, pressed ? styles.communityDetailImagePreviewControlPressed : null]}
                  onPress={() => scrollImagePreviewTo(previewImageIndex - 1)}
                  accessibilityRole="button"
                  accessibilityLabel="上一张图片"
                >
                  <ChevronLeft size={26} color="#fff" strokeWidth={2.3} />
                </Pressable>
              ) : null}
              {previewImageIndex < displayImages.length - 1 ? (
                <Pressable
                  style={({ pressed }) => [styles.communityDetailImagePreviewNext, pressed ? styles.communityDetailImagePreviewControlPressed : null]}
                  onPress={() => scrollImagePreviewTo(previewImageIndex + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="下一张图片"
                >
                  <ChevronRight size={26} color="#fff" strokeWidth={2.3} />
                </Pressable>
              ) : null}
              <View style={[styles.communityDetailImagePreviewCounter, { bottom: Math.max(insets.bottom, 18) + 12 }]} accessible accessibilityLabel={`第 ${previewImageIndex + 1} 张，共 ${displayImages.length} 张`}>
                <Text style={styles.communityDetailImagePreviewCounterText}>{previewImageIndex + 1} / {displayImages.length}</Text>
              </View>
            </>
          ) : null}
        </View>
      </Modal>

      <Modal visible={actionSheetVisible} transparent animationType="fade" onRequestClose={() => setActionSheetVisible(false)}>
        <Pressable style={styles.communityDetailSheetMask} onPress={() => setActionSheetVisible(false)}>
          <Pressable style={[styles.communityDetailActionSheet, isDark ? styles.communityDetailActionSheetDark : null, { paddingBottom: Math.max(insets.bottom, 18) }]} onPress={(event) => event.stopPropagation()}>
            <View style={[styles.communityDetailSheetHandle, isDark ? styles.communityDetailSheetHandleDark : null]} />
            <Text style={[styles.communityDetailSheetTitle, isDark ? styles.communityDetailSheetTitleDark : null]}>动态操作</Text>
            {isMine ? (
              <>
                <CommunityDetailSheetAction icon={<Edit3 size={18} color={colors.brand} strokeWidth={2.2} />} label="编辑动态" onPress={editPost} />
                <CommunityDetailSheetAction icon={deleting ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 size={18} color={colors.danger} strokeWidth={2.2} />} label="删除动态" danger onPress={deletePost} />
              </>
            ) : (
              <CommunityDetailSheetAction icon={<Flag size={18} color={colors.danger} strokeWidth={2.2} />} label="举报动态" danger onPress={openReportSheet} />
            )}
            <CommunityDetailSheetAction label="取消" muted onPress={() => setActionSheetVisible(false)} />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={reportSheetVisible} transparent animationType="slide" onRequestClose={() => setReportSheetVisible(false)}>
        <Pressable style={styles.communityDetailSheetMask} onPress={() => setReportSheetVisible(false)}>
          <Pressable style={[styles.communityDetailReportSheet, isDark ? styles.communityDetailReportSheetDark : null, { paddingBottom: Math.max(insets.bottom, 18) }]} onPress={(event) => event.stopPropagation()}>
            <View style={[styles.communityDetailSheetHandle, isDark ? styles.communityDetailSheetHandleDark : null]} />
            <Text style={[styles.communityDetailSheetTitle, isDark ? styles.communityDetailSheetTitleDark : null]}>举报动态</Text>
            <Text style={[styles.communityDetailReportHint, isDark ? styles.communityDetailReportHintDark : null]}>请补充违规、广告或不适内容说明。</Text>
            <TextInput
              value={reportText}
              onChangeText={setReportText}
              placeholder="说明原因"
              placeholderTextColor={isDark ? '#7f8c87' : '#94a3b8'}
              multiline
              textAlignVertical="top"
              style={[styles.communityDetailReportInput, isDark ? styles.communityDetailReportInputDark : null]}
              maxLength={300}
              accessibilityLabel="举报原因说明"
            />
            <Pressable
              style={({ pressed }) => [styles.communityDetailReportButton, reporting ? styles.communityDetailReportButtonDisabled : null, pressed ? styles.pressed : null]}
              onPress={() => void report()}
              disabled={reporting}
              accessibilityRole="button"
              accessibilityLabel="提交举报"
              accessibilityState={{ disabled: reporting, busy: reporting }}
            >
              {reporting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.communityDetailReportButtonText}>提交举报</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

type CommunityDetailRecord = NonNullable<CommunityFeedContext['record']>
type CommunityDetailRuntimeItem = CommunityDetailRecord['items'][number] & { source_label?: string | null }
type CommunityDetailRuntimeRecord = CommunityDetailRecord & { entry_type?: string | null; recipe_id?: string | null }
type CommunityDetailManualFoodItem = {
  displayName: string
  sourceLabel: string
  sourceId: string
  imageUrl: string
  calories: number
  detailItem: ManualFoodItem
}

type CommunityDetailMicroKey =
  | 'fiber' | 'sugar' | 'saturatedFat' | 'cholesterolMg' | 'sodiumMg' | 'potassiumMg'
  | 'calciumMg' | 'ironMg' | 'magnesiumMg' | 'zincMg' | 'vitaminARaeMcg' | 'vitaminCMg'
  | 'vitaminDMcg' | 'vitaminEMg' | 'vitaminKMcg' | 'thiaminMg' | 'riboflavinMg'
  | 'niacinMg' | 'vitaminB6Mg' | 'folateMcg' | 'vitaminB12Mcg'

type CommunityDetailMicroMeta = { key: CommunityDetailMicroKey; label: string; unit: string }
type CommunityDetailMicroRow = { meta: CommunityDetailMicroMeta; value: number; color: string }

const communityDetailMicroMeta: CommunityDetailMicroMeta[] = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { key: 'sodiumMg', label: '钠', unit: 'mg' },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' },
]

const communityDetailMicroColors: Record<CommunityDetailMicroKey, string> = {
  fiber: '#5dbb8a',
  sugar: '#e88cb8',
  saturatedFat: '#d4a373',
  cholesterolMg: '#bc8f8f',
  sodiumMg: '#ef8b73',
  potassiumMg: '#57a99a',
  calciumMg: '#6aa7d8',
  ironMg: '#d88d5a',
  magnesiumMg: '#7eb8da',
  zincMg: '#a8a4ce',
  vitaminARaeMcg: '#e0a14a',
  vitaminCMg: '#71c16f',
  vitaminDMcg: '#8a7be0',
  vitaminEMg: '#c0a46e',
  vitaminKMcg: '#8fbc8f',
  thiaminMg: '#d4a5a5',
  riboflavinMg: '#9fb4cc',
  niacinMg: '#b8a9c9',
  vitaminB6Mg: '#a3c4a3',
  folateMcg: '#d8b4a0',
  vitaminB12Mcg: '#9ecae1',
}

function communityDetailResolveManualSource(item: CommunityDetailRuntimeItem): { source: string; sourceId: string; sourceTitle: string } {
  const explicitSource = String(item.manual_source || '').trim()
  if (explicitSource) {
    return {
      source: explicitSource,
      sourceId: String(item.manual_source_id || '').trim(),
      sourceTitle: String(item.manual_source_title || item.name || '').trim(),
    }
  }
  const packagedFoodId = String(item.packaged_food_id || '').trim()
  const matchedFoodId = String(item.matched_food_id || '').trim()
  const nutritionSource = String(item.nutrition_source || '').trim().toLowerCase()
  const nutritionSourceCategory = String(item.nutrition_source_category || '').trim().toLowerCase()
  if (packagedFoodId || nutritionSource.includes('packaged')) {
    return { source: 'packaged_food', sourceId: packagedFoodId, sourceTitle: String(item.name || '').trim() }
  }
  if (matchedFoodId || (nutritionSourceCategory === 'database' && nutritionSource.includes('library'))) {
    return { source: 'nutrition_library', sourceId: matchedFoodId, sourceTitle: String(item.name || '').trim() }
  }
  return { source: '', sourceId: '', sourceTitle: '' }
}

function communityDetailManualSourceLabel(source: string, fallbackLabel: string): string {
  if (fallbackLabel) return fallbackLabel
  switch (source) {
    case 'public_library':
      return '真实餐食'
    case 'packaged_food':
      return '包装食品'
    case 'nutrition_library':
      return '常用食物'
    default:
      return ''
  }
}

function communityDetailManualFoodItems(items: CommunityDetailRecord['items'] | null | undefined): CommunityDetailManualFoodItem[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((baseItem) => {
    const item = baseItem as CommunityDetailRuntimeItem
    const resolved = communityDetailResolveManualSource(item)
    if (!resolved.source) return []
    const imageUrls = Array.from(new Set([
      ...(Array.isArray(item.image_paths) ? item.image_paths : []),
      item.image_path || '',
    ].map((url) => String(url || '').trim()).filter(Boolean)))
    const consumedWeight = [Number(item.intake), Number(item.weight)].find((value) => Number.isFinite(value) && value > 0) || 100
    const portionMatch = String(item.manual_portion_label || '').match(/([\d.]+)\s*(?:g|克|ml|毫升)/i)
    const portionWeight = Number(portionMatch?.[1] || 0)
    const defaultWeight = Number.isFinite(portionWeight) && portionWeight > 0 ? portionWeight : consumedWeight
    const defaultScale = consumedWeight > 0 ? defaultWeight / consumedWeight : 1
    const per100Scale = consumedWeight > 0 ? 100 / consumedWeight : 1
    const sourceLabel = communityDetailManualSourceLabel(resolved.source, String(item.source_label || '').trim())
    const displayName = resolved.sourceTitle || String(item.name || '').trim() || '食物'
    const per100Nutrients = Object.fromEntries(
      Object.entries(item.nutrients || {}).flatMap(([key, rawValue]) => {
        const value = Number(rawValue)
        return Number.isFinite(value) ? [[key, value * per100Scale]] : []
      }),
    ) as Record<string, number>
    const detailItem: ManualFoodItem = {
      id: resolved.sourceId || undefined,
      source_id: resolved.sourceId || undefined,
      source: resolved.source,
      source_label: sourceLabel,
      title: displayName,
      name: displayName,
      default_weight_grams: defaultWeight,
      total_calories: Number(item.nutrients?.calories || 0) * defaultScale,
      total_protein: Number(item.nutrients?.protein || 0) * defaultScale,
      total_carbs: Number(item.nutrients?.carbs || 0) * defaultScale,
      total_fat: Number(item.nutrients?.fat || 0) * defaultScale,
      portion_label: String(item.manual_portion_label || '').trim() || `${Math.round(defaultWeight)}g`,
      recommend_reason: '来自动态中的食物库记录',
      image_path: imageUrls[0] || null,
      image_paths: imageUrls,
      nutrients_per_100g: per100Nutrients,
      extra_nutrients: per100Nutrients,
    }
    return [{
      displayName,
      sourceLabel,
      sourceId: resolved.sourceId,
      imageUrl: imageUrls[0] || '',
      calories: Number(item.nutrients?.calories || 0),
      detailItem,
    }]
  })
}

function communityDetailShouldRenderManualFoodCards(record: CommunityDetailRecord | null | undefined): boolean {
  if (!record) return false
  const runtimeRecord = record as CommunityDetailRuntimeRecord
  const entryType = String(runtimeRecord.entry_type || '').trim()
  const hasItems = communityDetailManualFoodItems(runtimeRecord.items).length > 0
  if (entryType) {
    return (entryType === 'food_library' || entryType === 'public_food_library') && hasItems
  }
  if (String(runtimeRecord.source_task_id || '').trim() || String(runtimeRecord.recipe_id || '').trim()) return false
  const description = String(runtimeRecord.description || '').trim()
  return (description.startsWith('手动记录：') || description.startsWith('手动记录:')) && hasItems
}

function communityDetailResolveItemRatio(item: CommunityDetailRecord['items'][number]): number {
  const ratio = Number(item.ratio)
  if (Number.isFinite(ratio) && ratio > 0) return Math.min(100, ratio)
  const intake = Number(item.intake)
  const weight = Number(item.weight)
  if (Number.isFinite(intake) && Number.isFinite(weight) && intake >= 0 && weight > 0) {
    return Math.min(100, Math.round((intake / weight) * 1000) / 10)
  }
  return 100
}

function communityDetailReadNutrient(nutrients: Nutrients | null | undefined, key: CommunityDetailMicroKey): number {
  if (!nutrients) return 0
  const directValue = nutrients[key]
  if (directValue !== undefined && directValue !== null) return Number(directValue)
  if (key === 'sodiumMg') return Number(nutrients.sodium_mg || 0)
  return 0
}

function communityDetailFormatMicroValue(value: number): string {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

function communityDetailMicroRows(
  record: CommunityDetailRecord | null | undefined,
  isCirclePost: boolean,
): CommunityDetailMicroRow[] {
  if (!record) return []
  if (isCirclePost) {
    return communityDetailMicroMeta.map((meta) => {
      let value = 0
      if (meta.key === 'fiber') value = Number(record.fiber || 0)
      else if (meta.key === 'sugar') value = Number(record.sugar || 0)
      else if (meta.key === 'sodiumMg') value = Number(record.sodium_mg || 0)
      return { meta, value, color: communityDetailMicroColors[meta.key] }
    }).filter(({ value }) => value > 0)
  }
  return communityDetailMicroMeta.map((meta) => {
    const value = (record.items || []).reduce((sum, item) => (
      sum + communityDetailReadNutrient(item.nutrients, meta.key) * (communityDetailResolveItemRatio(item) / 100)
    ), 0)
    return { meta, value, color: communityDetailMicroColors[meta.key] }
  }).filter(({ value }) => value > 0)
}

function CommunityDetailSkeleton() {
  const { isDark } = useColorScheme()
  return (
    <View style={[styles.communityDetailSkeleton, isDark ? styles.communityDetailSkeletonDark : null]}>
      <View style={[styles.communityDetailSkeletonAvatar, isDark ? styles.communityDetailSkeletonPlaceholderDark : null]} />
      <View style={styles.communityDetailSkeletonMain}>
        <View style={[styles.communityDetailSkeletonLine, styles.communityDetailSkeletonName, isDark ? styles.communityDetailSkeletonPlaceholderDark : null]} />
        <View style={[styles.communityDetailSkeletonLine, styles.communityDetailSkeletonTime, isDark ? styles.communityDetailSkeletonPlaceholderDark : null]} />
        <View style={[styles.communityDetailSkeletonLine, styles.communityDetailSkeletonText, isDark ? styles.communityDetailSkeletonPlaceholderDark : null]} />
        <View style={[styles.communityDetailSkeletonLine, styles.communityDetailSkeletonTextShort, isDark ? styles.communityDetailSkeletonPlaceholderDark : null]} />
        <View style={[styles.communityDetailSkeletonImage, isDark ? styles.communityDetailSkeletonImageDark : null]}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </View>
    </View>
  )
}

function CommunityDetailSheetAction({
  icon,
  label,
  danger,
  muted,
  onPress,
}: {
  icon?: ReactNode
  label: string
  danger?: boolean
  muted?: boolean
  onPress: () => void
}) {
  const { isDark } = useColorScheme()
  return (
    <Pressable
      style={({ pressed }) => [styles.communityDetailSheetAction, isDark ? styles.communityDetailSheetActionDark : null, pressed ? styles.pressed : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <View style={styles.communityDetailSheetActionIcon}>{icon}</View> : null}
      <Text style={[
        styles.communityDetailSheetActionText,
        isDark ? styles.communityDetailSheetActionTextDark : null,
        danger ? styles.communityDetailSheetActionDanger : null,
        muted ? styles.communityDetailSheetActionMuted : null,
        muted && isDark ? styles.communityDetailSheetActionMutedDark : null,
      ]}>
        {label}
      </Text>
    </Pressable>
  )
}

function compactRepeatedText(value: string): string {
  const parts = value
    .split(/[，,。；;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return value
  const compacted = parts.filter((part, index) => parts.findIndex((item) => item === part) === index)
  return compacted.join('，')
}

function communityDetailTitle(record: CommunityDetailRecord | null | undefined, targetType: CommunityFeedTargetType): string {
  if (!record) return ''
  if (targetType === 'exercise_log') return compactRepeatedText(String(record.exercise_desc || record.description || record.exercise_type || '运动打卡')).trim()
  if (targetType === 'circle_post') return String(record.title || record.body || '分享了一条动态').trim()
  return String(record.title || record.description || record.items?.[0]?.name || '分享了一条饮食动态').trim()
}

function communityDetailBody(record: CommunityDetailRecord | null | undefined, targetType: CommunityFeedTargetType): string {
  if (!record) return ''
  const title = communityDetailTitle(record, targetType)
  const value = targetType === 'circle_post'
    ? String(record.body || '').trim()
    : targetType === 'exercise_log'
      ? String(record.ai_reasoning || '').trim()
      : String(record.insight || '').trim()
  return value && value !== title ? value : ''
}

function communityDetailImages(record: CommunityDetailRecord | null | undefined): string[] {
  if (!record) return []
  const images = Array.isArray(record.image_paths) ? record.image_paths : []
  return Array.from(new Set([...images, record.image_path || ''].map((url) => String(url || '').trim()).filter(Boolean)))
}

function communityDetailMeta(record: CommunityDetailRecord | null | undefined, targetType: CommunityFeedTargetType): string {
  const typeText = targetType === 'circle_post'
    ? '自定义动态'
    : targetType === 'exercise_log'
      ? '运动打卡'
      : targetType === 'campus_food'
        ? '校园食堂'
        : mealText(record?.meal_type)
  const timeText = formatDateTime(record?.record_time || record?.created_at)
  return [typeText, timeText].filter(Boolean).join(' · ')
}

function communityDetailTag(record: CommunityDetailRecord | null | undefined, targetType: CommunityFeedTargetType): string {
  if (!record) return ''
  if (targetType === 'exercise_log') return String(record.exercise_type || '运动').trim()
  if (targetType === 'campus_food') return [record.school, record.canteen].map((part) => String(part || '').trim()).filter(Boolean).join(' · ') || '校园食堂'
  if (record.diet_goal && record.diet_goal !== 'none') return dietGoalText(record.diet_goal)
  return ''
}

function communityDetailHasNutrition(record: CommunityDetailRecord | null | undefined): boolean {
  if (!record) return false
  return [record.total_calories, record.calories_burned, record.total_protein, record.total_carbs, record.total_fat, record.fiber, record.sugar, record.sodium_mg, record.total_weight_grams]
    .some((value) => Number(value) > 0)
}

function communityDetailKcal(record: CommunityDetailRecord | null | undefined, targetType: CommunityFeedTargetType): string {
  const value = targetType === 'exercise_log' ? record?.calories_burned || record?.total_calories : record?.total_calories
  return String(Math.round(Number(value || 0)))
}

function communityDetailMacroText(record: CommunityDetailRecord | null | undefined, targetType: CommunityFeedTargetType): string {
  if (!record) return ''
  if (targetType === 'exercise_log') {
    const parts = [
      record.duration_min ? `${Math.round(Number(record.duration_min))} 分钟` : '',
      record.ai_reasoning || 'AI 已根据运动内容估算消耗',
    ].filter(Boolean)
    return parts.join(' · ')
  }
  const parts = [
    `蛋白质 ${Math.round(Number(record.total_protein || 0))}g`,
    `碳水 ${Math.round(Number(record.total_carbs || 0))}g`,
    `脂肪 ${Math.round(Number(record.total_fat || 0))}g`,
    Number(record.fiber) > 0 ? `膳食纤维 ${round1(record.fiber)}g` : '',
    Number(record.sugar) > 0 ? `糖分 ${round1(record.sugar)}g` : '',
    Number(record.sodium_mg) > 0 ? `钠 ${Math.round(Number(record.sodium_mg))}mg` : '',
    Number(record.total_weight_grams) > 0 ? `重量 ${Math.round(Number(record.total_weight_grams))}g` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function mealText(value: unknown): string {
  switch (value) {
    case 'breakfast':
      return '早餐'
    case 'morning_snack':
      return '早加餐'
    case 'lunch':
      return '午餐'
    case 'afternoon_snack':
      return '午加餐'
    case 'dinner':
      return '晚餐'
    case 'evening_snack':
      return '晚加餐'
    case 'snack':
      return '加餐'
    default:
      return '饮食记录'
  }
}

function dietGoalText(value: unknown): string {
  switch (value) {
    case 'fat_loss':
      return '减脂'
    case 'muscle_gain':
      return '增肌'
    case 'maintain':
      return '维持'
    default:
      return String(value || '')
  }
}

export function PublicProfileScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PublicProfile'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  useEffect(() => {
    navigation.replace('ProfileSettings', { userId: route.params.userId })
  }, [navigation, route.params.userId])

  return (
    <View style={styles.publicProfileCompatPage}>
      <ActivityIndicator size="small" color={colors.brand} />
    </View>
  )
}

export function ConversationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const loadLatest = useCallback(async () => {
    setLoading(true)
    try {
      const conversationData = await apiClient.listConversations({ limit: privateConversationPageSize, offset: 0 })
      const next = conversationData.list || []
      setConversations(next)
      setOffset(next.length)
      setHasMore(Boolean(conversationData.has_more))
    } catch (error) {
      showError('获取私信失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void getStoredUserId().then((id) => setCurrentUserId(id || ''))
  }, [])

  useFocusEffect(
    useCallback(() => {
      void loadLatest()
    }, [loadLatest]),
  )

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const data = await apiClient.listConversations({ limit: privateConversationPageSize, offset })
      const next = data.list || []
      setConversations((prev) => mergeConversations(prev, next))
      setOffset((prev) => prev + next.length)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      showError('加载更多私信失败', error)
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, offset])

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 96) {
      void loadMore()
    }
  }, [loadMore])

  return (
    <View style={styles.privateConversationsPage}>
      {loading && conversations.length === 0 ? (
        <View style={styles.privateConversationsState}>
          <ActivityIndicator color="#00bc7d" />
        </View>
      ) : conversations.length === 0 ? (
        <View style={styles.privateConversationsState}>
          <Text style={styles.privateConversationsEmptyIcon}>信</Text>
          <Text style={styles.privateConversationsEmptyTitle}>暂无私信</Text>
          <Text style={styles.privateConversationsEmptySubtitle}>有人给你发消息时会出现在这里</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.privateConversationsList}
          contentContainerStyle={[styles.privateConversationsContent, { paddingBottom: 18 + insets.bottom }]}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadLatest} tintColor="#00bc7d" colors={['#00bc7d']} />}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handleScroll}
        >
          {conversations.map((conversation, index) => (
            <ConversationRow
              key={conversationUserId(conversation) || index}
              conversation={conversation}
              currentUserId={currentUserId}
              onPress={() => {
                const userId = conversationUserId(conversation)
                if (!userId) return
                navigation.navigate('PrivateChat', {
                  userId,
                  nickname: conversationNickname(conversation),
                })
              }}
            />
          ))}
          {loadingMore ? (
            <View style={styles.privateConversationsLoadMore}>
              <ActivityIndicator color="#00bc7d" />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}

export function PrivateChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PrivateChat'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const chatScrollRef = useRef<ScrollView>(null)
  const [messages, setMessages] = useState<PrivateMessageItem[]>([])
  const [content, setContent] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentUserAvatar, setCurrentUserAvatar] = useState('')
  const [counterpartName, setCounterpartName] = useState(route.params.nickname || '用户')
  const [counterpartAvatar, setCounterpartAvatar] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sendingText, setSendingText] = useState(false)
  const [sendingImage, setSendingImage] = useState(false)
  const [actionTarget, setActionTarget] = useState<PrivateMessageItem | null>(null)
  const [blockStatus, setBlockStatus] = useState<FriendBlockStatus | null>(null)
  const pollingRef = useRef(false)
  const isSystemChat = route.params.userId === SYSTEM_MESSAGE_USER_ID
  const chatBlocked = Boolean(blockStatus?.blocked_either)

  const scrollToBottom = useCallback((animated = true) => {
    setTimeout(() => {
      chatScrollRef.current?.scrollToEnd({ animated })
    }, 80)
  }, [])

  const refreshBlockStatus = useCallback(async () => {
    if (isSystemChat) {
      setBlockStatus(null)
      return
    }
    try {
      const status = await apiClient.getFriendBlockStatus(route.params.userId)
      setBlockStatus(status)
    } catch {
      setBlockStatus(null)
    }
  }, [isSystemChat, route.params.userId])

  const loadLatest = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const data = await apiClient.getConversation(route.params.userId, 0, privateMessagePageSize)
      if (typeof data.blocked === 'boolean') {
        setBlockStatus((prev) => data.blocked ? ({
          is_blocked_by_me: prev?.is_blocked_by_me || false,
          has_blocked_me: prev?.has_blocked_me || false,
          blocked_either: true,
        }) : {
          is_blocked_by_me: false,
          has_blocked_me: false,
          blocked_either: false,
        })
      }
      const next = normalizePrivateMessages(data.list || [])
      setMessages((prev) => quiet ? mergePrivateMessages(prev, next) : next)
      if (!quiet) {
        setOffset((data.list || []).length)
        setHasMore(Boolean(data.has_more))
        scrollToBottom(false)
      }
      await apiClient.markConversationRead(route.params.userId).catch(() => null)
    } catch (error) {
      if (!quiet) showError('获取会话失败', error)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [route.params.userId, scrollToBottom])

  useEffect(() => {
    void getStoredUserId().then((id) => setCurrentUserId(id || ''))
    void apiClient.getUserProfile()
      .then((profile) => setCurrentUserAvatar(profile.avatar || ''))
      .catch(() => null)
  }, [])

  useEffect(() => {
    setCounterpartName(route.params.nickname || (isSystemChat ? '系统消息' : '用户'))
    setCounterpartAvatar('')
    navigation.setOptions({ title: route.params.nickname || (isSystemChat ? '系统消息' : '用户') })
    if (isSystemChat) return
    void refreshBlockStatus()
    void apiClient.getPublicProfile(route.params.userId)
      .then((profile) => {
        setCounterpartName(profile.nickname || route.params.nickname || '用户')
        setCounterpartAvatar(profile.avatar || '')
        navigation.setOptions({ title: profile.nickname || route.params.nickname || '用户' })
      })
      .catch(() => null)
  }, [isSystemChat, navigation, refreshBlockStatus, route.params.nickname, route.params.userId])

  useFocusEffect(
    useCallback(() => {
      void loadLatest(false)
      const timer = setInterval(() => {
        if (pollingRef.current) return
        pollingRef.current = true
        void loadLatest(true).finally(() => {
          pollingRef.current = false
        })
      }, privateMessagePollMs)
      return () => clearInterval(timer)
    }, [loadLatest]),
  )

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const data = await apiClient.getConversation(route.params.userId, offset, privateMessagePageSize)
      const older = normalizePrivateMessages(data.list || [])
      setMessages((prev) => mergePrivateMessages(older, prev))
      setOffset((prev) => prev + (data.list || []).length)
      setHasMore(Boolean(data.has_more))
    } catch (error) {
      showError('加载历史消息失败', error)
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, offset, route.params.userId])

  const send = async () => {
    if (chatBlocked) {
      Alert.alert('已无法继续发送消息')
      return
    }
    const text = content.trim()
    if (!text) {
      Alert.alert('请输入消息内容')
      return
    }
    setSendingText(true)
    try {
      const sent = await apiClient.sendPrivateMessage(route.params.userId, text)
      setContent('')
      setMessages((prev) => mergePrivateMessages(prev, [sent]))
      scrollToBottom()
      await loadLatest(true)
    } catch (error) {
      showError('发送失败', error)
    } finally {
      setSendingText(false)
    }
  }

  const sendImage = async () => {
    if (chatBlocked) {
      Alert.alert('已无法继续发送消息')
      return
    }
    setSendingImage(true)
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      })
      if (picked.canceled || !picked.assets[0]) return
      const asset = picked.assets[0]
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'private-message.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      await apiClient.sendPrivateMessage(route.params.userId, {
        contentType: 'image',
        imageUrl: uploaded.imageUrl,
      })
      await loadLatest(true)
      scrollToBottom()
    } catch (error) {
      showError('发送图片失败', error)
    } finally {
      setSendingImage(false)
    }
  }

  const handleBlockUser = useCallback(() => {
    if (isSystemChat) return
    Alert.alert('拉黑用户', `拉黑后，你和「${counterpartName || '用户'}」将无法继续互发私信，也不能重新添加好友。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '拉黑',
        style: 'destructive',
        onPress: () => {
          void apiClient.blockUser(route.params.userId)
            .then(() => {
              setContent('')
              setBlockStatus({ is_blocked_by_me: true, has_blocked_me: false, blocked_either: true })
              return loadLatest(true)
            })
            .then(() => Alert.alert('已加入黑名单'))
            .catch((error) => showError('无法操作', error))
        },
      },
    ])
  }, [counterpartName, isSystemChat, loadLatest, route.params.userId])

  const handleUnblockUser = useCallback(() => {
    if (isSystemChat) return
    Alert.alert('解除拉黑', '解除后，你们可以重新搜索、申请好友或发送私信。', [
      { text: '取消', style: 'cancel' },
      {
        text: '解除',
        onPress: () => {
          void apiClient.unblockUser(route.params.userId)
            .then(() => refreshBlockStatus())
            .then(() => Alert.alert('已解除拉黑'))
            .catch((error) => showError('无法操作', error))
        },
      },
    ])
  }, [isSystemChat, refreshBlockStatus, route.params.userId])

  const closeMessageActions = useCallback(() => {
    setActionTarget(null)
  }, [])

  const copyMessage = useCallback(async (message: PrivateMessageItem) => {
    const type = messageType(message)
    const value = type === 'image' ? messageImageUrl(message) : messageContent(message)
    if (!value.trim()) {
      Alert.alert('无法复制', type === 'image' ? '这张图片没有可复制的链接。' : '这条消息没有可复制的内容。')
      return
    }
    await Clipboard.setStringAsync(value)
    closeMessageActions()
    Alert.alert(type === 'image' ? '图片链接已复制' : '消息已复制')
  }, [closeMessageActions])

  const recallMessage = useCallback((message: PrivateMessageItem) => {
    const id = messageRecordId(message)
    if (!id) {
      Alert.alert('暂不能撤回', '这条消息缺少可撤回的 ID，请刷新后重试。')
      return
    }
    closeMessageActions()
    if (!isWithinPrivateMessageRecallWindow(messageCreatedAt(message))) {
      Alert.alert('无法撤回', '消息已超过 15 分钟，无法撤回。')
      return
    }
    void apiClient.deletePrivateMessage(id)
      .then(() => {
        setMessages((prev) => prev.filter((item) => messageRecordId(item) !== id))
        return loadLatest(true)
      })
      .then(() => Alert.alert('已撤回'))
      .catch((error) => showError('撤回消息失败', error))
  }, [closeMessageActions, loadLatest])

  const reportMessage = useCallback((message: PrivateMessageItem) => {
    const id = messageRecordId(message)
    if (!id) {
      Alert.alert('暂不能举报', '这条消息缺少可举报的 ID，请刷新后重试。')
      return
    }
    closeMessageActions()
    Alert.alert('举报消息', '举报会提交给管理员处理。', [
      { text: '取消', style: 'cancel' },
      {
        text: '举报',
        style: 'destructive',
        onPress: () => {
          void apiClient.reportPrivateMessage(id, {
            reason: 'other',
            extraContent: '来自私信长按举报',
          })
            .then(() => Alert.alert('举报已提交'))
            .catch((error) => showError('举报失败', error))
        },
      },
    ])
  }, [closeMessageActions])

  const actionTargetIsSelf = actionTarget ? isSelfPrivateMessage(actionTarget, currentUserId) : false

  const handleChatScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (event.nativeEvent.contentOffset.y <= 24) {
      void loadOlder()
    }
  }, [loadOlder])

  return (
    <KeyboardAvoidingView
      style={styles.privateChatPage}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {!isSystemChat ? (
        <View style={styles.privateChatBlockBar}>
          {blockStatus?.is_blocked_by_me ? (
            <Pressable style={({ pressed }) => [styles.privateChatBlockButton, styles.privateChatUnblockButton, pressed && styles.privateChatBlockButtonPressed]} onPress={handleUnblockUser}>
              <Text style={[styles.privateChatBlockButtonText, styles.privateChatUnblockButtonText]}>解除拉黑</Text>
            </Pressable>
          ) : chatBlocked ? (
            <Text style={styles.privateChatBlockedHint}>已无法继续发送消息</Text>
          ) : (
            <Pressable style={({ pressed }) => [styles.privateChatBlockButton, pressed && styles.privateChatBlockButtonPressed]} onPress={handleBlockUser}>
              <Text style={styles.privateChatBlockButtonText}>拉黑</Text>
            </Pressable>
          )}
        </View>
      ) : null}
      <ScrollView
        ref={chatScrollRef}
        style={styles.privateChatList}
        contentContainerStyle={styles.privateChatContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => loadLatest(false)} tintColor="#00bc7d" colors={['#00bc7d']} />}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleChatScroll}
      >
        {loading && messages.length === 0 ? (
          <View style={styles.privateChatState}>
            <ActivityIndicator color="#00bc7d" />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.privateChatEmpty}>
            <Text style={styles.privateChatEmptyText}>{isSystemChat ? '暂无系统消息' : '开始聊天吧'}</Text>
          </View>
        ) : (
          <>
            {loadingMore ? (
              <View style={styles.privateChatLoadMore}>
                <ActivityIndicator color="#00bc7d" />
              </View>
            ) : null}
            {messages.map((msg, index) => {
              const previous = index > 0 ? messages[index - 1] : null
              const isSelf = isSelfPrivateMessage(msg, currentUserId)
              return (
                <MessageBubble
                  key={messageId(msg, index)}
                  message={msg}
                  currentUserId={currentUserId}
                  currentUserAvatar={currentUserAvatar}
                  counterpartName={counterpartName || '用户'}
                  counterpartAvatar={counterpartAvatar}
                  showTime={shouldShowMessageTime(previous, msg)}
                  onAction={(message) => setActionTarget(message)}
                  onAvatarPress={() => {
                    if (isSystemChat) return
                    if (isSelf) navigation.navigate('ProfileSettings')
                    else navigation.navigate('ProfileSettings', { userId: route.params.userId })
                  }}
                />
              )
            })}
          </>
        )}
      </ScrollView>
      {isSystemChat ? null : chatBlocked ? (
        <View style={[styles.privateChatDisabledBar, { paddingBottom: Math.max(insets.bottom, 8) + 8 }]}>
          <Text style={styles.privateChatDisabledText}>已无法继续发送消息</Text>
        </View>
      ) : (
        <View style={[styles.privateChatInputBar, { paddingBottom: Math.max(insets.bottom, 8) + 8 }]}>
          <Pressable
            disabled={sendingImage || sendingText}
            style={({ pressed }) => [styles.privateChatImageButton, pressed && styles.privateChatImageButtonPressed]}
            onPress={sendImage}
          >
            {sendingImage ? (
              <ActivityIndicator color="#6b7280" size="small" />
            ) : (
              <ImageIcon size={21} color="#6b7280" strokeWidth={2.2} />
            )}
          </Pressable>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="说点什么..."
            placeholderTextColor="#9ca3af"
            style={styles.privateChatInput}
            editable={!sendingImage && !sendingText}
            returnKeyType="send"
            onSubmitEditing={send}
          />
          <Pressable
            disabled={sendingImage || sendingText || !content.trim()}
            style={[
              styles.privateChatSendButton,
              content.trim() && !sendingImage && !sendingText ? styles.privateChatSendButtonActive : null,
            ]}
            onPress={send}
          >
            {sendingText ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.privateChatSendText}>发送</Text>}
          </Pressable>
        </View>
      )}
      <PrivateMessageActionSheet
        visible={Boolean(actionTarget)}
        message={actionTarget}
        isSelf={actionTargetIsSelf}
        onCopy={copyMessage}
        onDelete={recallMessage}
        onReport={reportMessage}
        onClose={closeMessageActions}
      />
    </KeyboardAvoidingView>
  )
}
export function BodyTrendsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'BodyTrends'>>()
  const tab = route.params?.tab
  const kind = tab === 'water' || tab === 'exercise' ? tab : 'weight'

  useEffect(() => {
    navigation.replace('TrendDetail', { kind })
  }, [kind, navigation])

  return (
    <View style={styles.bodyTrendsCompatPage}>
      <ActivityIndicator size="small" color={colors.brand} />
    </View>
  )
}

function PublicFoodCard({
  item,
  latest,
  isDark,
  compact,
  isOwner,
  busyKind,
  actionsDisabled,
  onPress,
  onAuthorPress,
  onLike,
  onCollect,
  onComment,
  onDelete,
}: {
  item: PublicFoodItem
  latest?: boolean
  isDark: boolean
  compact: boolean
  isOwner: boolean
  busyKind: PublicFoodBusyKind | null
  actionsDisabled: boolean
  onPress: () => void
  onAuthorPress?: () => void
  onLike: () => void
  onCollect: () => void
  onComment: () => void
  onDelete: () => void
}) {
  const image = primaryImage(item)
  const title = publicFoodTitle(item)
  const subtitle = publicFoodSubtitle(item)
  const authorName = publicFoodAuthorName(item)
  const campusFood = isCampusPublicFoodItem(item)
  const officialAuthor = !publicFoodOwnerId(item) && authorName === '食探官方'
  const statsColor = isDark ? '#aab8b2' : '#64748b'
  const actionDisabled = actionsDisabled && !busyKind
  return (
    <View style={[styles.publicFoodCard, isDark ? styles.publicFoodCardDark : null]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed ? styles.publicFoodCardPressed : null]}
        accessibilityRole="button"
        accessibilityLabel={`${title}，${Math.round(item.total_calories || 0)} 千卡${campusFood ? `，${publicFoodLocationText(item)}` : ''}`}
        accessibilityHint="打开食物详情"
      >
        <View style={[styles.publicFoodCardMain, compact ? styles.publicFoodCardMainCompact : null]}>
        <View style={[styles.publicFoodImageWrap, compact ? styles.publicFoodImageWrapCompact : null, isDark ? styles.publicFoodImageWrapDark : null]}>
          {image ? (
            <Image source={{ uri: image }} style={styles.publicFoodImage} resizeMode="cover" accessibilityLabel={`${title}食物图片`} accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.publicFoodImageFallback, isDark ? styles.publicFoodImageFallbackDark : null]}>
              <UtensilsCrossed size={25} color={isDark ? '#6ee7b7' : colors.brandDark} strokeWidth={1.9} />
              <Text style={[styles.publicFoodImageFallbackText, isDark ? styles.publicFoodTextSecondaryDark : null]}>暂无图片</Text>
            </View>
          )}
          {latest ? <View style={styles.publicFoodLatestBadge}><Text style={styles.publicFoodBadgeText}>最新</Text></View> : null}
          {item.suitable_for_fat_loss ? <View style={styles.publicFoodFatLossBadge}><Text style={styles.publicFoodBadgeText}>适合减脂</Text></View> : null}
          {campusFood ? <View style={styles.publicFoodCampusBadge}><Text style={styles.publicFoodBadgeText}>校园食堂</Text></View> : null}
        </View>
        <View style={styles.publicFoodInfo}>
          <Text style={[styles.publicFoodTitle, isDark ? styles.publicFoodTextPrimaryDark : null]} numberOfLines={compact ? 2 : 1}>{title}</Text>
          {!campusFood && subtitle ? <Text style={[styles.publicFoodDesc, isDark ? styles.publicFoodTextSecondaryDark : null]} numberOfLines={compact ? 2 : 1}>{subtitle}</Text> : null}
          {!campusFood && item.merchant_name ? (
            <View style={[styles.publicFoodMerchant, isDark ? styles.publicFoodMerchantDark : null]}>
              <Store size={13} color={isDark ? '#6ee7b7' : colors.brandDark} strokeWidth={2} />
              <Text style={[styles.publicFoodMerchantText, isDark ? styles.publicFoodAccentTextDark : null]} numberOfLines={1}>{item.merchant_name}</Text>
            </View>
          ) : null}
          {campusFood ? (
            <View style={styles.publicFoodCampusMeta}>
              <Text style={[styles.publicFoodCampusLocation, isDark ? styles.publicFoodTextSecondaryDark : null]} numberOfLines={2}>{publicFoodLocationText(item) || '校园食堂'}</Text>
              <View style={styles.publicFoodCampusSummary}>
                <Text style={[styles.publicFoodCampusChip, isDark ? styles.publicFoodCampusChipDark : null]}>蛋白 {Math.round(item.total_protein || 0)}g</Text>
                <Text style={[styles.publicFoodCampusCalories, isDark ? styles.publicFoodAccentTextDark : null]}>{Math.round(item.total_calories || 0)} kcal</Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.publicFoodCalories, isDark ? styles.publicFoodAccentTextDark : null]}>{Math.round(item.total_calories || 0)} kcal</Text>
          )}
        </View>
        </View>
      </Pressable>
      <View style={[styles.publicFoodFooter, compact ? styles.publicFoodFooterCompact : null, isDark ? styles.publicFoodBorderDark : null]}>
        <Pressable
          disabled={!onAuthorPress}
          style={({ pressed }) => [styles.publicFoodAuthor, compact ? styles.publicFoodAuthorCompact : null, pressed && onAuthorPress ? styles.publicFoodControlPressed : null]}
          onPress={(event) => {
            event.stopPropagation()
            onAuthorPress?.()
          }}
          accessibilityRole={onAuthorPress ? 'button' : undefined}
          accessibilityLabel={onAuthorPress ? `查看${authorName}的个人主页` : authorName}
        >
          {!officialAuthor && item.author?.avatar ? (
            <Image source={{ uri: item.author.avatar }} style={styles.publicFoodAuthorAvatar} accessibilityLabel={`${authorName}的头像`} />
          ) : !officialAuthor ? (
            <View style={[styles.publicFoodAuthorAvatarFallback, isDark ? styles.publicFoodAuthorAvatarFallbackDark : null]}>
              <UserRound size={14} color={isDark ? '#6ee7b7' : colors.brandDark} strokeWidth={2} />
            </View>
          ) : null}
          <Text style={[styles.publicFoodAuthorName, isDark ? styles.publicFoodTextSecondaryDark : null, officialAuthor ? styles.publicFoodAuthorNameOfficial : null]} numberOfLines={1}>{authorName}</Text>
        </Pressable>
        <View style={[styles.publicFoodStats, compact ? styles.publicFoodStatsCompact : null]}>
          <Pressable
            disabled={actionsDisabled}
            style={({ pressed }) => [styles.publicFoodStatAction, item.liked ? styles.publicFoodStatActionLiked : null, item.liked && isDark ? styles.publicFoodStatActionLikedDark : null, actionDisabled ? styles.publicFoodActionDisabled : null, pressed && !actionsDisabled ? styles.publicFoodControlPressed : null]}
            onPress={(event) => { event.stopPropagation(); onLike() }}
            accessibilityRole="button"
            accessibilityLabel={`${item.liked ? '取消点赞' : '点赞'}，当前 ${item.like_count || 0} 个赞`}
            accessibilityState={{ selected: Boolean(item.liked), disabled: actionsDisabled, busy: busyKind === 'like' }}
          >
            {busyKind === 'like' ? <ActivityIndicator size="small" color="#e11d48" /> : <Heart size={17} color={item.liked ? '#e11d48' : statsColor} fill={item.liked ? '#e11d48' : 'transparent'} strokeWidth={2.1} />}
            <Text style={[styles.publicFoodStatCount, isDark ? styles.publicFoodTextSecondaryDark : null, item.liked ? styles.publicFoodStatCountLiked : null]}>{item.like_count || 0}</Text>
          </Pressable>
          <Pressable
            disabled={actionsDisabled}
            style={({ pressed }) => [styles.publicFoodStatAction, item.collected ? styles.publicFoodStatActionCollected : null, item.collected && isDark ? styles.publicFoodStatActionCollectedDark : null, actionDisabled ? styles.publicFoodActionDisabled : null, pressed && !actionsDisabled ? styles.publicFoodControlPressed : null]}
            onPress={(event) => { event.stopPropagation(); onCollect() }}
            accessibilityRole="button"
            accessibilityLabel={`${item.collected ? '取消收藏' : '收藏'}，当前 ${item.collection_count || 0} 个收藏`}
            accessibilityState={{ selected: Boolean(item.collected), disabled: actionsDisabled, busy: busyKind === 'collect' }}
          >
            {busyKind === 'collect' ? <ActivityIndicator size="small" color="#d97706" /> : <Bookmark size={17} color={item.collected ? '#d97706' : statsColor} fill={item.collected ? '#fbbf24' : 'transparent'} strokeWidth={2.1} />}
            <Text style={[styles.publicFoodStatCount, isDark ? styles.publicFoodTextSecondaryDark : null]}>{item.collection_count || 0}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.publicFoodStatAction, pressed ? styles.publicFoodControlPressed : null]}
            onPress={(event) => { event.stopPropagation(); onComment() }}
            accessibilityRole="button"
            accessibilityLabel={`查看评论，当前 ${item.comment_count || 0} 条`}
          >
            <MessageCircle size={17} color={statsColor} strokeWidth={2.1} />
            {item.comment_count ? <Text style={[styles.publicFoodStatCount, isDark ? styles.publicFoodTextSecondaryDark : null]}>{item.comment_count}</Text> : null}
          </Pressable>
          {item.avg_rating && item.avg_rating > 0 ? (
            <View style={styles.publicFoodStatDisplay} accessibilityLabel={`平均评分 ${round1(item.avg_rating)} 星`}>
              <Star size={16} color="#f59e0b" fill="#f59e0b" strokeWidth={2} />
              <Text style={styles.publicFoodRatingCount}>{round1(item.avg_rating)}</Text>
            </View>
          ) : null}
          {isOwner ? (
            <Pressable
              disabled={actionsDisabled}
              style={({ pressed }) => [styles.publicFoodStatAction, actionDisabled ? styles.publicFoodActionDisabled : null, pressed && !actionsDisabled ? styles.publicFoodControlPressed : null]}
              onPress={(event) => { event.stopPropagation(); onDelete() }}
              accessibilityRole="button"
              accessibilityLabel="删除这条公共食物"
              accessibilityState={{ disabled: actionsDisabled, busy: busyKind === 'delete' }}
            >
              {busyKind === 'delete' ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 size={17} color={colors.danger} strokeWidth={2.1} />}
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}

function PublicFoodSkeletonList({ isDark, compact }: { isDark: boolean; compact: boolean }) {
  return (
    <View style={styles.publicFoodListContent} accessible={false} importantForAccessibility="no-hide-descendants">
      {[1, 2, 3].map((item) => (
        <View key={item} style={[styles.publicFoodSkeletonCard, isDark ? styles.publicFoodSkeletonCardDark : null]}>
          <View style={[styles.publicFoodSkeletonMain, compact ? styles.publicFoodCardMainCompact : null]}>
            <View style={[styles.publicFoodSkeletonImage, compact ? styles.publicFoodImageWrapCompact : null, isDark ? styles.publicFoodSkeletonPlaceholderDark : null]} />
            <View style={styles.flex}>
              <View style={[styles.publicFoodSkeletonLine, isDark ? styles.publicFoodSkeletonPlaceholderDark : null, { width: '70%', height: 16 }]} />
              <View style={[styles.publicFoodSkeletonLine, isDark ? styles.publicFoodSkeletonPlaceholderDark : null, { width: '92%', height: 12 }]} />
              <View style={[styles.publicFoodSkeletonLine, isDark ? styles.publicFoodSkeletonPlaceholderDark : null, { width: '45%', height: 14, marginTop: 'auto' }]} />
            </View>
          </View>
          <View style={[styles.publicFoodSkeletonFooter, isDark ? styles.publicFoodBorderDark : null]}>
            <View style={[styles.publicFoodSkeletonLine, isDark ? styles.publicFoodSkeletonPlaceholderDark : null, { width: 76, height: 12 }]} />
            <View style={[styles.publicFoodSkeletonLine, isDark ? styles.publicFoodSkeletonPlaceholderDark : null, { width: 116, height: 12 }]} />
          </View>
        </View>
      ))}
    </View>
  )
}

function PublicFoodEmpty({
  mode,
  text,
  isDark,
  onExplore,
  onCampus,
  onShare,
}: {
  mode: PublicFoodMode
  text: string
  isDark: boolean
  onExplore: () => void
  onCampus: () => void
  onShare: () => void
}) {
  const action = mode === 'collections'
    ? { label: '去逛逛', onPress: onExplore }
    : mode === 'campus'
      ? { label: '去校园专区', onPress: onCampus }
      : { label: '去分享', onPress: onShare }
  const EmptyIcon = mode === 'collections' ? Bookmark : mode === 'campus' ? UtensilsCrossed : Leaf
  return (
    <View style={styles.publicFoodEmpty}>
      <View style={[styles.publicFoodEmptyIconWrap, isDark ? styles.publicFoodEmptyIconWrapDark : null]}><EmptyIcon size={29} color={isDark ? '#6ee7b7' : colors.brandDark} strokeWidth={2} /></View>
      <Text style={[styles.publicFoodEmptyText, isDark ? styles.publicFoodTextSecondaryDark : null]}>{text}</Text>
      <Pressable style={({ pressed }) => [styles.publicFoodEmptyButton, pressed ? styles.publicFoodPrimaryPressed : null]} onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label}>
        <Text style={styles.publicFoodEmptyButtonText}>{action.label}</Text>
      </Pressable>
    </View>
  )
}

function PublicFoodDetailSkeleton() {
  const { isDark } = useColorScheme()
  return (
    <View accessibilityLabel="正在加载食物详情">
      <View style={[styles.publicFoodDetailSkeletonImage, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null]} />
      <View style={[styles.publicFoodDetailInfoCard, styles.publicFoodDetailSkeletonCard, isDark ? styles.publicFoodDetailInfoCardDark : null]}>
        <View style={styles.publicFoodDetailSkeletonHead}>
          <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '58%', height: 24 }]} />
          <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: 96, height: 30, borderRadius: 15 }]} />
        </View>
        <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '100%', height: 16 }]} />
        <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '72%', height: 16 }]} />
        <View style={styles.publicFoodDetailSkeletonNutrients}>
          {[1, 2, 3, 4].map((entry) => <View key={entry} style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { flex: 1, height: 46 }]} />)}
        </View>
        <View style={styles.publicFoodDetailSkeletonAuthor}>
          <View style={[styles.publicFoodDetailSkeletonAvatar, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null]} />
          <View style={styles.flex}>
            <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '42%', height: 14 }]} />
            <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '30%', height: 12 }]} />
          </View>
        </View>
      </View>
      <View style={[styles.publicFoodDetailCard, isDark ? styles.publicFoodDetailCardDark : null]}>
        <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '34%', height: 18 }]} />
        <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '100%', height: 44 }]} />
        <View style={[styles.publicFoodDetailSkeletonLine, isDark ? styles.publicFoodDetailSkeletonPlaceholderDark : null, { width: '86%', height: 44 }]} />
      </View>
    </View>
  )
}

function PublicFoodDetailEmpty({ onBack }: { onBack: () => void }) {
  const { isDark } = useColorScheme()
  return (
    <View style={styles.publicFoodDetailEmptyState}>
      <View style={[styles.publicFoodDetailEmptyIconWrap, isDark ? styles.publicFoodDetailAvatarFallbackDark : null]}><Leaf size={24} color={isDark ? '#7dd3b0' : colors.brandDark} strokeWidth={2.2} /></View>
      <Text style={[styles.publicFoodDetailEmptyTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>内容不存在</Text>
      <Text style={[styles.publicFoodDetailEmptyText, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>这份公共食物可能已经删除或下架。</Text>
      <Pressable style={({ pressed }) => [styles.publicFoodEmptyButton, pressed ? styles.pressed : null]} onPress={onBack} accessibilityRole="button" accessibilityLabel="返回公共食物库">
        <Text style={styles.publicFoodEmptyButtonText}>返回</Text>
      </Pressable>
    </View>
  )
}

function PublicFoodNutrientCell({ value, label, last }: { value: string; label: string; last?: boolean }) {
  const { isDark } = useColorScheme()
  return (
    <View style={[styles.publicFoodDetailNutrientItem, !last ? styles.publicFoodDetailNutrientDivider : null, !last && isDark ? styles.publicFoodDetailNutrientDividerDark : null]}>
      <Text style={[styles.publicFoodDetailNutrientValue, isDark ? styles.publicFoodDetailTitleDark : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{value}</Text>
      <Text style={[styles.publicFoodDetailNutrientLabel, isDark ? styles.publicFoodDetailTextSecondaryDark : null]}>{label}</Text>
    </View>
  )
}

function PublicFoodInfoCell({ label, value }: { label: string; value: string }) {
  const { isDark } = useColorScheme()
  return (
    <View style={[styles.publicFoodDetailInfoCell, isDark ? styles.publicFoodDetailInfoCellDark : null]}>
      <Text style={[styles.publicFoodDetailInfoLabel, isDark ? styles.publicFoodDetailMutedTextDark : null]}>{label}</Text>
      <Text style={[styles.publicFoodDetailInfoValue, isDark ? styles.publicFoodDetailTitleDark : null]}>{value}</Text>
    </View>
  )
}

function PublicFoodDetailInfoRow({ label, value }: { label: string; value: string }) {
  const { isDark } = useColorScheme()
  return (
    <View style={[styles.publicFoodDetailInfoRow, isDark ? styles.publicFoodDetailInfoRowDark : null]}>
      <Text style={[styles.publicFoodDetailInfoRowLabel, isDark ? styles.publicFoodDetailMutedTextDark : null]}>{label}</Text>
      <Text style={[styles.publicFoodDetailInfoRowValue, isDark ? styles.publicFoodDetailTextPrimaryDark : null]}>{value}</Text>
    </View>
  )
}

function PublicFoodDetailCardTitle({ title }: { title: string }) {
  const { isDark } = useColorScheme()
  return (
    <View style={styles.publicFoodDetailCardTitleRow}>
      <View style={styles.publicFoodDetailCardTitleBar} />
      <Text style={[styles.publicFoodDetailCardTitle, isDark ? styles.publicFoodDetailTitleDark : null]}>{title}</Text>
    </View>
  )
}
function ConversationRow({
  conversation,
  currentUserId,
  onPress,
}: {
  conversation: ConversationSummary
  currentUserId: string
  onPress: () => void
}) {
  const userId = conversationUserId(conversation)
  const nickname = conversationNickname(conversation)
  const avatar = conversationAvatar(conversation)
  const unreadCount = conversationUnreadCount(conversation)
  const last = conversationLastMessage(conversation)
  const isSystem = userId === SYSTEM_MESSAGE_USER_ID
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.conversationCard,
        unreadCount > 0 && styles.conversationCardUnread,
        pressed && styles.conversationCardPressed,
      ]}
    >
      <ConversationAvatar nickname={isSystem ? '系' : nickname} avatar={avatar} system={isSystem} />
      <View style={styles.conversationMain}>
        <View style={styles.conversationTop}>
          <Text style={styles.conversationName} numberOfLines={1}>{isSystem ? '系统消息' : nickname}</Text>
        </View>
        <Text style={[styles.conversationPreview, unreadCount > 0 && styles.conversationPreviewUnread]} numberOfLines={1}>
          {conversationPreview(conversation, currentUserId) || '打开会话'}
        </Text>
      </View>
      <View style={styles.conversationRight}>
        <Text style={styles.conversationTime}>{formatConversationTimeLabel(messageCreatedAt(last))}</Text>
        {unreadCount > 0 ? (
          <View style={styles.conversationBadge}>
            <Text style={styles.conversationBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

function ConversationAvatar({
  nickname,
  avatar,
  system,
  compact,
}: {
  nickname: string
  avatar?: string
  system?: boolean
  compact?: boolean
}) {
  if (system) {
    return <Image source={{ uri: loginLogoUrl }} style={[styles.conversationAvatarImage, compact && styles.messageAvatarImage]} />
  }
  if (avatar) return <Image source={{ uri: avatar }} style={[styles.conversationAvatarImage, compact && styles.messageAvatarImage]} />
  const initial = system ? '系' : nickname.trim().slice(0, 1) || '友'
  return (
    <View style={[styles.conversationAvatarFallback, compact && styles.messageAvatarFallback, system && styles.conversationAvatarSystem]}>
      <Text style={[styles.conversationAvatarText, compact && styles.messageAvatarText]}>{initial}</Text>
    </View>
  )
}

function publicFoodEmptyText(mode: PublicFoodMode, merchantName: string, fatLoss?: boolean): string {
  if (mode === 'mine') return '还没有上传过公共食物'
  if (mode === 'collections') return '还没有收藏公共食物'
  if (merchantName || fatLoss) return mode === 'campus' ? '没有找到匹配的校园餐' : '没有找到匹配的公共食物'
  return mode === 'campus' ? '暂无校园餐' : '暂无公共食物'
}

function CommentLine({ entry }: { entry: FeedCommentItem }) {
  return (
    <View style={styles.commentRow}>
      <Text style={styles.itemName}>{entry.nickname || '用户'}</Text>
      <Text style={styles.subtitle}>{entry.content}</Text>
    </View>
  )
}

function MessageBubble({
  message,
  currentUserId,
  currentUserAvatar,
  counterpartName,
  counterpartAvatar,
  showTime,
  onAction,
  onAvatarPress,
}: {
  message: PrivateMessageItem
  currentUserId: string
  currentUserAvatar?: string
  counterpartName: string
  counterpartAvatar?: string
  showTime?: boolean
  onAction?: (message: PrivateMessageItem) => void
  onAvatarPress?: () => void
}) {
  const type = messageType(message)
  const isSystem = type === 'system' || messageSenderId(message) === SYSTEM_MESSAGE_USER_ID
  const isSelf = isSelfPrivateMessage(message, currentUserId)
  const imageUrl = messageImageUrl(message)
  const content = messageContent(message)

  if (isSystem) {
    return (
      <View style={styles.systemMessageWrap}>
        {showTime ? <MessageTimeDivider value={messageCreatedAt(message)} /> : null}
        <View style={styles.systemMessageBubble}>
          <Text style={styles.systemMessageText}>{content || '系统通知'}</Text>
        </View>
      </View>
    )
  }

  return (
    <>
      {showTime ? <MessageTimeDivider value={messageCreatedAt(message)} /> : null}
      <View style={[styles.messageRow, isSelf && styles.messageRowSelf]}>
        <Pressable onPress={onAvatarPress} disabled={!onAvatarPress} style={styles.messageAvatarPressable}>
          <ConversationAvatar
            nickname={isSelf ? '我' : counterpartName}
            avatar={isSelf ? currentUserAvatar : counterpartAvatar}
            compact
          />
        </Pressable>
        <Pressable
          delayLongPress={260}
          onPress={() => onAction?.(message)}
          onLongPress={() => onAction?.(message)}
          style={({ pressed }) => [
            styles.messageBubble,
            isSelf && styles.messageBubbleSelf,
            type === 'image' && styles.messageBubbleImage,
            pressed && styles.messageBubblePressed,
          ]}
        >
          {type === 'image' && imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.messageImage} resizeMode='cover' />
          ) : (
            <Text style={[styles.messageText, isSelf && styles.messageTextSelf]}>{content || '消息'}</Text>
          )}
        </Pressable>
      </View>
    </>
  )
}

function PrivateMessageActionSheet({
  visible,
  message,
  isSelf,
  onCopy,
  onDelete,
  onReport,
  onClose,
}: {
  visible: boolean
  message: PrivateMessageItem | null
  isSelf: boolean
  onCopy: (message: PrivateMessageItem) => void
  onDelete: (message: PrivateMessageItem) => void
  onReport: (message: PrivateMessageItem) => void
  onClose: () => void
}) {
  if (!message) return null
  return (
    <Modal visible={visible} transparent animationType='fade' onRequestClose={onClose}>
      <Pressable style={styles.messageActionBackdrop} onPress={onClose}>
        <Pressable style={styles.messageActionSheet} onPress={() => undefined}>
          <View style={styles.messageActionGroup}>
            {isSelf ? (
              <PrivateMessageAction icon="delete" label='撤回' danger onPress={() => onDelete(message)} />
            ) : (
              <PrivateMessageAction icon="report" label='举报' danger onPress={() => onReport(message)} />
            )}
            <View style={styles.messageActionDivider} />
            <PrivateMessageAction icon="copy" label='复制' onPress={() => onCopy(message)} />
          </View>
          <Pressable style={({ pressed }) => [styles.messageActionCancel, pressed && styles.messageActionPressed]} onPress={onClose}>
            <X size={18} color="#6b7280" strokeWidth={2.2} />
            <Text style={styles.messageActionCancelText}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function PrivateMessageAction({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: 'copy' | 'delete' | 'report'
  label: string
  danger?: boolean
  onPress: () => void
}) {
  const Icon = icon === 'copy' ? Copy : icon === 'delete' ? Trash2 : Flag
  const iconColor = danger ? '#ef4444' : '#3b82f6'
  return (
    <Pressable style={({ pressed }) => [styles.messageActionItem, pressed && styles.messageActionPressed]} onPress={onPress}>
      <Icon size={18} color={iconColor} strokeWidth={2.2} />
      <Text style={[styles.messageActionText, danger && styles.messageActionDangerText]}>{label}</Text>
    </Pressable>
  )
}

function MessageTimeDivider({ value }: { value?: string }) {
  const label = formatPrivateMessageTime(value)
  if (!label) return null
  return (
    <View style={styles.messageTimeDivider}>
      <Text style={styles.messageTimeDividerText}>{label}</Text>
    </View>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  )
}

function SmallButton({ label, danger, disabled, onPress }: { label: string; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.smallButton, danger && styles.smallButtonDanger, disabled && styles.smallButtonDisabled]}>
      <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText, disabled && styles.smallButtonDisabledText]}>{label}</Text>
    </Pressable>
  )
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  )
}

function RecipeItemPreview({ items }: { items?: Array<Record<string, unknown>> }) {
  const normalized = (items || []).slice(0, 4).map((item, index) => {
    const nutrients = asRecord(item.nutrients)
    return {
      key: String(item.id || item.name || item.food_name || index),
      name: String(item.name || item.food_name || `食物 ${index + 1}`),
      weight: firstNumber(item.weight, item.estimatedWeightGrams, item.estimated_weight_grams, item.intake),
      calories: firstNumber(nutrients?.calories, item.calories, item.total_calories),
      protein: firstNumber(nutrients?.protein, item.protein, item.total_protein),
      carbs: firstNumber(nutrients?.carbs, item.carbs, item.total_carbs),
      fat: firstNumber(nutrients?.fat, item.fat, item.total_fat),
    }
  })
  if (!normalized.length) return null
  return (
    <View style={styles.recipeItems}>
      {normalized.map((item) => (
        <View key={item.key} style={styles.recipeItemRow}>
          <View style={styles.flex}>
            <Text style={styles.recipeItemName}>{item.name}</Text>
            <Text style={styles.subtitle}>
              {item.weight ? `${Math.round(item.weight)}g · ` : ''}{Math.round(item.calories || 0)} kcal
            </Text>
          </View>
          <Text style={styles.recipeItemMacro}>P {round1(item.protein)} · C {round1(item.carbs)} · F {round1(item.fat)}</Text>
        </View>
      ))}
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function MembershipStatusRow({ label, value, active }: { label: string; value: string; active?: boolean }) {
  const { isDark } = useColorScheme()
  return (
    <View style={[styles.membershipStatusRow, isDark ? styles.membershipStatusRowDark : null]}>
      <Text style={[styles.membershipStatusLabel, isDark ? styles.membershipStatusLabelDark : null]}>{label}</Text>
      <Text style={[styles.membershipStatusValue, isDark ? styles.membershipStatusValueDark : null, active ? styles.membershipStatusValueActive : null, active && isDark ? styles.membershipStatusValueActiveDark : null]}>
        {value}
      </Text>
    </View>
  )
}

function MembershipLinkButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { isDark } = useColorScheme()
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.membershipLinkButton,
        isDark ? styles.membershipLinkButtonDark : null,
        disabled ? styles.membershipLinkButtonDisabled : null,
        pressed ? styles.membershipPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
    >
      <Text style={[styles.membershipLinkButtonText, isDark ? styles.membershipLinkButtonTextDark : null]}>{label}</Text>
    </Pressable>
  )
}

function UpgradeTermsBlock({ order }: { order: MembershipPaymentOrder }) {
  const terms = asRecord(order.upgrade_terms)
  if (!terms) return null
  const rows = [
    { label: '当前套餐抵扣', value: terms.unused_current_credit_applied != null ? `¥${money(terms.unused_current_credit_applied)}` : '' },
    { label: '目标周期开始', value: dateText(terms.target_period_start, true) },
    { label: '目标周期结束', value: dateText(terms.target_expires_at) },
  ].filter((row) => row.value)
  if (!rows.length) return null
  return (
    <View style={styles.metaBlock}>
      {rows.map((row) => <MembershipStatusRow key={row.label} label={row.label} value={row.value} />)}
    </View>
  )
}

function RuleRow({ text }: { text: string }) {
  return (
    <View style={styles.ruleRow}>
      <View style={styles.ruleDot} />
      <Text style={styles.subtitle}>{text}</Text>
    </View>
  )
}

function primaryImage(item: { image_paths?: string[] | null; image_path?: string | null } | null): string | undefined {
  return item?.image_paths?.[0] || item?.image_path || undefined
}

type PublicFoodMicronutrientRow = CommunityDetailMicroMeta & { value: number }

function publicFoodMicronutrientRows(item: PublicFoodItem): PublicFoodMicronutrientRow[] {
  const totals = new Map<CommunityDetailMicroKey, number>()
  ;(item.items || []).forEach((row) => {
    const nutrients = asRecord(row.nutrients)
    if (!nutrients) return
    communityDetailMicroMeta.forEach(({ key }) => {
      const rawValue = key === 'sodiumMg' ? (nutrients[key] ?? nutrients.sodium_mg) : nutrients[key]
      const value = Number(rawValue || 0)
      if (Number.isFinite(value)) totals.set(key, (totals.get(key) || 0) + value)
    })
  })
  return communityDetailMicroMeta.map((definition) => ({ ...definition, value: totals.get(definition.key) || 0 }))
}

function formatPublicFoodMicronutrientValue(value: number): string {
  if (value <= 0) return '0'
  if (value < 0.01) return '<0.01'
  if (value < 10) return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return value.toFixed(1).replace(/\.0$/, '')
}
function publicFoodImageList(item: { image_paths?: string[] | null; image_path?: string | null } | null): string[] {
  if (!item) return []
  const images = Array.isArray(item.image_paths) ? item.image_paths.filter(Boolean) : []
  if (images.length) return images
  return item.image_path ? [item.image_path] : []
}

function publicFoodTitle(item: PublicFoodItem): string {
  return String(item.food_name || item.description || (isCampusPublicFoodItem(item) ? '校园菜品' : '健康餐食')).trim()
}

function publicFoodSubtitle(item: PublicFoodItem): string {
  if (item.description && item.food_name) return String(item.description).trim()
  if (isCampusPublicFoodItem(item)) return publicFoodLocationText(item)
  return String(item.merchant_address || item.detail_address || item.city || item.recommend_reason || '').trim()
}

function publicFoodAuthorName(item: PublicFoodItem): string {
  return String(item.author?.nickname || '用户').trim() || '用户'
}

function publicFoodAuthorInitial(name: string): string {
  return name.trim().slice(0, 1) || '食'
}

function publicFoodPublishedText(item: PublicFoodItem): string {
  const value = item.published_at || item.created_at || item.updated_at
  if (!value) return '发布时间待补充'
  return dateText(value, true)
}

function publicFoodPriceText(item: PublicFoodItem): string {
  const unit = String(item.price_unit || '').trim()
  const suffix = unit ? `/${unit}` : ''
  const price = Number(item.price)
  if (Number.isFinite(price) && price > 0) return `¥${money(price)}${suffix}`
  const min = Number(item.price_min)
  const max = Number(item.price_max)
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > min) return `¥${money(min)}-${money(max)}${suffix}`
  if (Number.isFinite(min) && min > 0) return `¥${money(min)}${suffix}`
  if (Number.isFinite(max) && max > 0) return `¥${money(max)}${suffix}`
  return ''
}

function countPublicFoodComments(comments: PublicFoodComment[]): number {
  return comments.reduce((total, entry) => total + 1 + (entry.replies?.length || 0), 0)
}

function publicFoodOwnerId(item: PublicFoodItem | null): string {
  return String(item?.user_id || item?.author?.id || '').trim()
}

function publicFoodLocationText(item: PublicFoodItem | null): string {
  if (!item) return '--'
  const rawParts = item.campus_location_text
    ? item.campus_location_text.split(/\s*·\s*/)
    : [item.school_name, item.campus_name, item.canteen_name, item.floor, item.window_name]
  const seen = new Set<string>()
  const campusParts = rawParts
    .map((part) => String(part || '').trim())
    .filter((part) => {
      if (!part) return false
      const key = part.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  if (campusParts.length) return campusParts.join(' · ')
  return item.merchant_address || item.detail_address || item.merchant_name || item.city || '--'
}

function campusRelatedFeedLocationText(item: CampusRelatedFeedItem): string {
  return item.campus_location || [item.school_name, item.canteen_name].map((part) => String(part || '').trim()).filter(Boolean).join(' · ') || '--'
}

function publicFoodAnalysisStatus(item: PublicFoodItem | null): string {
  return String(item?.analysis_status || '').trim().toLowerCase()
}

function isPublicFoodAnalyzing(item: PublicFoodItem | null): boolean {
  const status = publicFoodAnalysisStatus(item)
  return status === 'pending' || status === 'processing'
}

function isPublicFoodAnalysisFailed(item: PublicFoodItem | null): boolean {
  const status = publicFoodAnalysisStatus(item)
  return status === 'failed' || status === 'timed_out'
}

function hasPublicFoodNutrition(item: PublicFoodItem | null): boolean {
  if (!item) return false
  if (hasPositiveNumber(item.total_calories, item.total_protein, item.total_carbs, item.total_fat)) return true
  return (item.items || []).some((row) => {
    const nutrients = asRecord(row.nutrients)
    return hasPositiveNumber(nutrients?.calories, nutrients?.protein, row.calories, row.total_calories)
  })
}

function needsPublicFoodNutritionUpdate(item: PublicFoodItem | null): boolean {
  return Boolean(item && !isPublicFoodAnalyzing(item) && !isPublicFoodAnalysisFailed(item) && !hasPublicFoodNutrition(item))
}

function manualFoodItemFromPublicFood(item: PublicFoodItem): ManualFoodItem {
  const firstItem = asRecord(item.items?.[0])
  const defaultWeight = firstNumber(firstItem?.intake, firstItem?.weight, item.total_calories > 0 ? 1 : 100) || 100
  const title = String(item.food_name || item.description || (isCampusPublicFoodItem(item) ? '校园菜品' : '公共食物')).trim()
  const portionLabel = String(firstItem?.manual_portion_label || item.portion_description || '1份').trim()
  return {
    id: item.id,
    title,
    name: title,
    source: 'public_library',
    source_id: item.id,
    source_label: isCampusPublicFoodItem(item) ? '校园食堂' : '真实餐食',
    default_weight_grams: defaultWeight,
    total_calories: Number(item.total_calories || 0),
    total_protein: Number(item.total_protein || 0),
    total_carbs: Number(item.total_carbs || 0),
    total_fat: Number(item.total_fat || 0),
    portion_label: portionLabel || '1份',
    recommend_reason: isCampusPublicFoodItem(item) ? '校园真实菜品，热量价格一目了然' : '整份复用更快，适合商家餐和外卖',
    image_path: item.image_path,
    image_paths: item.image_paths,
    is_campus_food: isCampusPublicFoodItem(item),
    type: item.type,
    campus_location_text: item.campus_location_text,
    school_name: item.school_name,
    campus_name: item.campus_name,
    canteen_name: item.canteen_name,
    floor: item.floor,
    window_name: item.window_name,
  }
}

function normalizeMealType(value?: string | null): MealType | undefined {
  if (mealOptions.includes(value as MealType)) return value as MealType
  if (value === 'snack') return 'afternoon_snack'
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function hasPositiveNumber(...values: unknown[]): boolean {
  return values.some((value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0
  })
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function round1(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '0'
}

function numericValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function money(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, '') : '0'
}

function membershipStatusText(status: MembershipStatus): string {
  if (status.is_pro) return '会员有效'
  if (status.trial_active) return '试用中'
  switch (String(status.status || '').toLowerCase()) {
    case 'active':
      return '会员有效'
    case 'expired':
      return '已到期'
    case 'cancelled':
      return '已取消'
    case 'trialing':
      return '试用中'
    default:
      return '基础账号'
  }
}

function paymentStatusText(status?: string): string {
  switch (String(status || 'pending').toLowerCase()) {
    case 'paid':
    case 'success':
      return '已支付'
    case 'closed':
    case 'cancelled':
    case 'canceled':
      return '已关闭'
    case 'expired':
      return '已过期'
    case 'failed':
      return '支付失败'
    default:
      return '待支付'
  }
}

function orderModeText(mode?: string): string {
  switch (String(mode || '').toLowerCase()) {
    case 'renewal':
      return '续费'
    case 'prorated_current_period_upgrade':
      return '补差升级'
    case 'new_purchase':
    default:
      return '开通会员'
  }
}

function membershipPlanTierKey(plan?: MembershipPlan): MembershipTierKey {
  const raw = `${plan?.tier || ''} ${plan?.code || ''} ${plan?.name || ''}`.toLowerCase()
  if (raw.includes('advanced') || raw.includes('进阶')) return 'advanced'
  if (raw.includes('light') || raw.includes('轻度')) return 'light'
  return 'standard'
}

function membershipPlanPeriodKey(plan?: MembershipPlan): MembershipPeriodKey {
  const raw = `${plan?.period || ''} ${plan?.code || ''} ${plan?.name || ''}`.toLowerCase()
  const months = Number(plan?.duration_months || 0)
  if (raw.includes('year') || raw.includes('年') || months >= 12) return 'yearly'
  if (raw.includes('quarter') || raw.includes('季') || months >= 3) return 'quarterly'
  return 'monthly'
}

function findMembershipPlan(plans: MembershipPlan[], tier: MembershipTierKey, period: MembershipPeriodKey): MembershipPlan | undefined {
  return plans.find((plan) => membershipPlanTierKey(plan) === tier && membershipPlanPeriodKey(plan) === period)
}

function planPeriodText(plan: MembershipPlan): string {
  const period = String(plan.period || '').toLowerCase()
  if (period.includes('year')) return '年卡'
  if (period.includes('quarter')) return '季卡'
  if (period.includes('month')) return '月卡'
  const months = Number(plan.duration_months || 0)
  if (months >= 12) return '年卡'
  if (months >= 3) return `${months} 个月`
  if (months >= 1) return months === 1 ? '月卡' : `${months} 个月`
  return '会员周期'
}

function planTierText(tier?: string | null): string {
  switch (String(tier || '').toLowerCase()) {
    case 'light':
      return '轻度版'
    case 'standard':
      return '标准版'
    case 'advanced':
      return '进阶版'
    default:
      return '会员'
  }
}

function planName(code: string, plans: MembershipPlan[]): string {
  return plans.find((plan) => plan.code === code)?.name || code || '--'
}

function paymentModePreview(membership: MembershipStatus | null, plan: MembershipPlan): string {
  if (!membership?.is_pro) return '支付成功后即时生效'
  if (membership.current_plan_code === plan.code) return '当前套餐续费，到期后顺延'
  return '按当前会员剩余价值折抵后补差'
}

function dateText(value: unknown, withTime = false): string {
  const raw = String(value || '').trim()
  if (!raw || raw === 'null' || raw === '<nil>') return '--'
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return raw
  const date = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`
  if (!withTime) return date
  return `${date} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function messageId(message: PrivateMessageItem, fallback: number): string {
  return privateMessageKey(message) || String(fallback)
}

function messageRecordId(message?: PrivateMessageItem): string {
  return String(message?.ID || message?.id || '').trim()
}

function messageContent(message?: PrivateMessageItem): string {
  if (messageType(message) === 'image' && messageImageUrl(message)) return '图片'
  return String(message?.Content || message?.content || '')
}

function messageImageUrl(message?: PrivateMessageItem): string {
  return String(message?.ImageURL || message?.image_url || '')
}

function messageType(message?: PrivateMessageItem): string {
  return String(message?.ContentType || message?.content_type || 'text')
}

function messageSenderId(message?: PrivateMessageItem): string {
  return String(message?.SenderID || message?.sender_id || '')
}

function isSelfPrivateMessage(message: PrivateMessageItem, currentUserId: string): boolean {
  const type = messageType(message)
  return type !== 'system' && messageSenderId(message) !== SYSTEM_MESSAGE_USER_ID && Boolean(currentUserId) && messageSenderId(message) === currentUserId
}

function messageCreatedAt(message?: PrivateMessageItem): string | undefined {
  return message?.CreatedAt || message?.created_at
}

function isWithinPrivateMessageRecallWindow(value?: string): boolean {
  const time = value ? new Date(value).getTime() : NaN
  return Number.isFinite(time) && Date.now() - time <= 15 * 60 * 1000
}

function privateMessageKey(message?: PrivateMessageItem): string {
  const id = messageRecordId(message)
  if (id) return id
  return [
    messageSenderId(message),
    message?.ReceiverID || message?.receiver_id || '',
    messageCreatedAt(message) || '',
    messageType(message),
    messageImageUrl(message) || messageContent(message),
  ].join('|')
}

function normalizePrivateMessages(list: PrivateMessageItem[]): PrivateMessageItem[] {
  return list.slice().reverse()
}

function mergePrivateMessages(...groups: PrivateMessageItem[][]): PrivateMessageItem[] {
  const map = new Map<string, PrivateMessageItem>()
  groups.flat().forEach((message, index) => {
    const key = privateMessageKey(message) || String(index)
    map.set(key, message)
  })
  return Array.from(map.values()).sort((a, b) => {
    const aTime = new Date(messageCreatedAt(a) || '').getTime()
    const bTime = new Date(messageCreatedAt(b) || '').getTime()
    if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0
    return aTime - bTime
  })
}

function shouldShowMessageTime(previous: PrivateMessageItem | null, current: PrivateMessageItem): boolean {
  if (!previous) return true
  const prevTime = new Date(messageCreatedAt(previous) || '').getTime()
  const currTime = new Date(messageCreatedAt(current) || '').getTime()
  if (Number.isNaN(prevTime) || Number.isNaN(currTime)) return false
  return Math.abs(currTime - prevTime) > 10 * 60 * 1000
}

function formatPrivateMessageTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const sameYesterday = date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  if (sameDay) return time
  if (sameYesterday) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

function formatRecipeNumber(value?: number | null): string {
  const numeric = Number(value) || 0
  if (Math.abs(numeric) >= 100) return String(Math.round(numeric))
  return String(Math.round(numeric * 10) / 10)
}

type RecipeMicroNutrientKey =
  | 'fiber'
  | 'sugar'
  | 'sodium_mg'
  | 'potassiumMg'
  | 'calciumMg'
  | 'ironMg'
  | 'magnesiumMg'
  | 'zincMg'
  | 'vitaminARaeMcg'
  | 'vitaminCMg'
  | 'vitaminDMcg'
  | 'vitaminEMg'
  | 'vitaminKMcg'
  | 'thiaminMg'
  | 'riboflavinMg'
  | 'niacinMg'
  | 'vitaminB6Mg'
  | 'folateMcg'
  | 'vitaminB12Mcg'

const recipeMicroNutrientMeta: Array<{
  key: RecipeMicroNutrientKey
  label: string
  unit: string
  aliases?: string[]
}> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'sodium_mg', label: '钠', unit: 'mg', aliases: ['sodiumMg'] },
  { key: 'potassiumMg', label: '钾', unit: 'mg', aliases: ['potassium_mg'] },
  { key: 'calciumMg', label: '钙', unit: 'mg', aliases: ['calcium_mg'] },
  { key: 'ironMg', label: '铁', unit: 'mg', aliases: ['iron_mg'] },
  { key: 'magnesiumMg', label: '镁', unit: 'mg', aliases: ['magnesium_mg'] },
  { key: 'zincMg', label: '锌', unit: 'mg', aliases: ['zinc_mg'] },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' },
]

function formatRecipeDisplayText(value?: string | null): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/([*_~`])([^]*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatRecipeTag(value: string): string {
  return formatRecipeDisplayText(value).replace(/^#+\s*/, '').trim()
}

function recipeMicroValue(nutrients: Record<string, unknown>, key: RecipeMicroNutrientKey, aliases: string[] = []): number {
  for (const candidate of [key, ...aliases]) {
    const value = Number(nutrients[candidate])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

function getRecipeMicroRows(recipe: RecipeItem) {
  const totals = (recipe.items || []).reduce<Partial<Record<RecipeMicroNutrientKey, number>>>((result, rawItem) => {
    const item = rawItem as Record<string, unknown>
    const rawRatio = Number(item.ratio)
    const ratio = Number.isFinite(rawRatio) ? Math.max(0, rawRatio) / 100 : 1
    const nutrients = item.nutrients && typeof item.nutrients === 'object'
      ? item.nutrients as Record<string, unknown>
      : {}

    recipeMicroNutrientMeta.forEach((meta) => {
      const value = recipeMicroValue(nutrients, meta.key, meta.aliases) * ratio
      if (value > 0) result[meta.key] = Math.round(((result[meta.key] || 0) + value) * 10) / 10
    })
    return result
  }, {})

  return recipeMicroNutrientMeta
    .map((meta) => ({ ...meta, value: totals[meta.key] || 0 }))
    .filter((row) => row.value > 0)
    .slice(0, 4)
}

function formatRecipeMicroValue(value: number): string {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

function RecipeMicroSummary({ recipe }: { recipe: RecipeItem }) {
  const rows = getRecipeMicroRows(recipe)
  if (!rows.length) return null

  return (
    <View style={styles.recipeMicroSummary}>
      {rows.map((row) => (
        <View key={row.key} style={styles.recipeMicroSummaryItem}>
          <Text style={styles.recipeMicroSummaryLabel}>{row.label}</Text>
          <Text style={styles.recipeMicroSummaryValue}>{formatRecipeMicroValue(row.value)}{row.unit}</Text>
        </View>
      ))}
    </View>
  )
}

function formatRecipeLastUsed(value?: string | null): string {
  if (!value) return '未使用'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未使用'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatConversationTimeLabel(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 1000)))}分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 60 * 1000)))}小时前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function conversationUserId(conversation: ConversationSummary): string {
  return String(conversation.UserID || conversation.user_id || '').trim()
}

function conversationNickname(conversation: ConversationSummary): string {
  return String(conversation.Nickname || conversation.nickname || '用户').trim() || '用户'
}

function conversationAvatar(conversation: ConversationSummary): string {
  return String(conversation.Avatar || conversation.avatar || '').trim()
}

function conversationLastMessage(conversation: ConversationSummary): PrivateMessageItem | undefined {
  return conversation.LastMessage || conversation.last_message
}

function conversationUnreadCount(conversation: ConversationSummary): number {
  const value = conversation.UnreadCount ?? conversation.unread_count ?? 0
  return Math.max(0, Math.floor(Number(value) || 0))
}

function conversationPreview(conversation: ConversationSummary, currentUserId: string): string {
  const last = conversationLastMessage(conversation)
  if (!last) return ''
  const userId = conversationUserId(conversation)
  const content = messageContent(last)
  if (userId === SYSTEM_MESSAGE_USER_ID) return content
  const senderId = messageSenderId(last)
  const sentByMe = Boolean(senderId) && (senderId === currentUserId || senderId !== userId)
  return sentByMe ? `我：${content}` : content
}

function mergeConversations(prev: ConversationSummary[], next: ConversationSummary[]): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>()
  prev.forEach((item, index) => map.set(conversationUserId(item) || `prev-${index}`, item))
  next.forEach((item, index) => map.set(conversationUserId(item) || `next-${index}`, item))
  return Array.from(map.values())
}

function showError(title: string, error: unknown) {
  Alert.alert(title, userFacingErrorMessage(error))
}

function buildCommunityCommentSubtreeIds(comments: FeedCommentItem[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const comment of comments) {
      if (!ids.has(comment.id) && comment.parent_comment_id && ids.has(comment.parent_comment_id)) {
        ids.add(comment.id)
        changed = true
      }
    }
  }
  return ids
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  nutritionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  metaBlock: {
    marginTop: 14,
  },
  pressed: {
    opacity: 0.74,
  },
  bodyTrendsCompatPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7faf9',
  },
  publicProfileCompatPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7faf9',
  },
  communityDetailPage: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  communityDetailScroll: {
    flex: 1,
  },
  communityDetailContent: {
    paddingHorizontal: 0,
  },
  communityDetailFeedList: {
    paddingTop: 0,
  },
  communityDetailFeedCard: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#edf2f7',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  communityDetailFeedCardExercise: {
    borderColor: '#e0f2fe',
    backgroundColor: '#f8fcff',
  },
  communityDetailFeedCardCirclePost: {
    borderColor: '#e8f5ee',
  },
  communityDetailMomentsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  communityDetailAvatarCol: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
  },
  communityDetailAvatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  communityDetailAvatarFallback: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#ecfdf5',
  },
  communityDetailMainCol: {
    flex: 1,
    minWidth: 0,
  },
  communityDetailNameBlock: {
    minHeight: 44,
    justifyContent: 'center',
  },
  communityDetailUserName: {
    color: '#1f2937',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  communityDetailPostTime: {
    marginTop: 3,
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  communityDetailTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  communityDetailTag: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#ecfdf5',
    color: '#059669',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  communityDetailTagExercise: {
    backgroundColor: '#e0f2fe',
    color: '#0284c7',
  },
  communityDetailTitle: {
    marginTop: 8,
    color: '#111827',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  communityDetailBody: {
    marginTop: 6,
    color: '#334155',
    fontSize: 14,
    lineHeight: 22,
  },
  communityDetailImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 10,
  },
  communityDetailImageGridSingle: {
    flexDirection: 'row',
  },
  communityDetailImageSingle: {
    overflow: 'hidden',
    width: '100%',
    height: 214,
    borderRadius: 9,
    backgroundColor: '#e2e8f0',
  },
  communityDetailImageTile: {
    overflow: 'hidden',
    width: '31.8%',
    aspectRatio: 1,
    borderRadius: 7,
    backgroundColor: '#e2e8f0',
  },
  communityDetailImagePressed: {
    opacity: 0.78,
  },
  communityDetailImageFill: {
    width: '100%',
    height: '100%',
  },
  communityDetailImagePreviewBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.72)',
  },
  communityDetailManualFoods: {
    gap: 7,
    marginTop: 8,
  },
  communityDetailManualFoodCard: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#edf2f7',
    borderRadius: 10,
    padding: 7,
    backgroundColor: '#fff',
  },
  communityDetailManualFoodCardPressed: {
    opacity: 0.76,
  },
  communityDetailManualFoodImage: {
    width: 42,
    height: 42,
    flexShrink: 0,
    borderRadius: 7,
    backgroundColor: '#e2e8f0',
  },
  communityDetailManualFoodImageFallback: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: '#f1f5f9',
  },
  communityDetailManualFoodInfo: {
    flex: 1,
    minWidth: 0,
  },
  communityDetailManualFoodTitle: {
    color: '#1f2937',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  communityDetailManualFoodMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  communityDetailManualFoodBadge: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    backgroundColor: '#ecfdf5',
    color: '#059669',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  communityDetailManualFoodCalories: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  communityDetailManualFoodExpand: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#f1f5f9',
  },
  communityDetailManualFoodExpandText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  communityDetailMetaCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f0fdf4',
  },
  communityDetailMetaCardExercise: {
    backgroundColor: '#eff6ff',
  },
  communityDetailCalorie: {
    minWidth: 72,
  },
  communityDetailCalorieExercise: {
    minWidth: 84,
  },
  communityDetailCalorieNum: {
    color: colors.brand,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
  },
  communityDetailCalorieUnit: {
    marginTop: 1,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  communityDetailMacros: {
    flex: 1,
    minWidth: 0,
  },
  communityDetailMacrosText: {
    color: '#166534',
    fontSize: 12,
    lineHeight: 18,
  },
  communityDetailMacrosTextExercise: {
    color: '#075985',
  },
  communityDetailMicros: {
    marginTop: 8,
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#f8fafc',
  },
  communityDetailMicrosHead: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  communityDetailMicrosTitle: {
    flex: 1,
    color: '#334155',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  communityDetailMicrosToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  communityDetailMicrosToggleText: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  communityDetailMicrosSummary: {
    marginBottom: 4,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 17,
  },
  communityDetailMicrosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  communityDetailMicroCell: {
    minHeight: 64,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  communityDetailMicroLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  communityDetailMicroValueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 3,
    marginTop: 4,
  },
  communityDetailMicroValue: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
  },
  communityDetailMicroUnit: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  communityDetailActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  communityDetailActionsLeft: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  communityDetailActionItem: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  communityDetailActionCount: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  communityDetailActionCountActive: {
    color: colors.danger,
  },
  communityDetailManageBox: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#f1f5f9',
  },
  communityDetailComments: {
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#f8fafc',
  },
  communityDetailCommentItem: {
    minHeight: 48,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
  },
  communityDetailCommentReply: {
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#dbeafe',
  },
  communityDetailCommentDeleting: {
    opacity: 0.55,
  },
  communityDetailCommentAvatar: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  communityDetailCommentAvatarImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  communityDetailCommentBody: {
    flex: 1,
    minWidth: 0,
  },
  communityDetailCommentMetaLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  communityDetailCommentAuthor: {
    maxWidth: 200,
    flexShrink: 1,
    color: '#475569',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  communityDetailCommentReplyTo: {
    flexShrink: 1,
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  communityDetailCommentText: {
    marginTop: 2,
    color: '#334155',
    fontSize: 13,
    lineHeight: 19,
  },
  communityDetailCommentDelete: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityDetailCommentEmpty: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  communityDetailCommentEmptyText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
  },
  communityDetailBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingTop: 9,
    backgroundColor: '#fff',
  },
  communityDetailReplyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#f1f5f9',
  },
  communityDetailReplyText: {
    flex: 1,
    flexWrap: 'wrap',
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  communityDetailCommentComposer: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  communityDetailCommentInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 96,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#f1f5f9',
    color: '#111827',
    fontSize: 14,
    lineHeight: 18,
  },
  communityDetailSendButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#e2e8f0',
  },
  communityDetailSendButtonDisabled: {
    backgroundColor: '#e2e8f0',
  },
  communityDetailSendButtonReady: {
    backgroundColor: colors.brand,
  },
  communityDetailImagePreview: {
    flex: 1,
    backgroundColor: '#000',
  },
  communityDetailImagePreviewSlide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityDetailImagePreviewImage: {
    width: '100%',
    height: '100%',
  },
  communityDetailImagePreviewClose: {
    position: 'absolute',
    right: 14,
    zIndex: 3,
    elevation: 3,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: 'rgba(30,41,59,0.72)',
  },
  communityDetailImagePreviewPrevious: {
    position: 'absolute',
    left: 12,
    top: '50%',
    zIndex: 3,
    elevation: 3,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -24,
    borderRadius: 24,
    backgroundColor: 'rgba(30,41,59,0.66)',
  },
  communityDetailImagePreviewNext: {
    position: 'absolute',
    right: 12,
    top: '50%',
    zIndex: 3,
    elevation: 3,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -24,
    borderRadius: 24,
    backgroundColor: 'rgba(30,41,59,0.66)',
  },
  communityDetailImagePreviewControlPressed: {
    opacity: 0.58,
  },
  communityDetailImagePreviewCounter: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 3,
    elevation: 3,
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(30,41,59,0.78)',
  },
  communityDetailImagePreviewCounterText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  communityDetailSheetMask: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.52)',
  },
  communityDetailActionSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
  },
  communityDetailReportSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
  },
  communityDetailSheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
  },
  communityDetailSheetTitle: {
    marginTop: 14,
    marginBottom: 8,
    color: '#111827',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    textAlign: 'center',
  },
  communityDetailSheetAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  communityDetailSheetActionIcon: {
    width: 22,
    alignItems: 'center',
  },
  communityDetailSheetActionText: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  communityDetailSheetActionDanger: {
    color: colors.danger,
  },
  communityDetailSheetActionMuted: {
    color: '#64748b',
  },
  communityDetailReportHint: {
    marginBottom: 10,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  communityDetailReportInput: {
    minHeight: 104,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#f8fafc',
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
  },
  communityDetailReportButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderRadius: 24,
    backgroundColor: colors.brand,
  },
  communityDetailReportButtonDisabled: {
    opacity: 0.5,
  },
  communityDetailReportButtonText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  communityDetailEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 320,
    paddingHorizontal: 24,
  },
  communityDetailEmptyText: {
    color: '#64748b',
    fontSize: 14,
    lineHeight: 21,
  },
  communityDetailSkeleton: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  communityDetailSkeletonAvatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  communityDetailSkeletonMain: {
    flex: 1,
    gap: 8,
  },
  communityDetailSkeletonLine: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  communityDetailSkeletonName: {
    width: '42%',
    height: 14,
  },
  communityDetailSkeletonTime: {
    width: '58%',
  },
  communityDetailSkeletonText: {
    width: '92%',
  },
  communityDetailSkeletonTextShort: {
    width: '68%',
  },
  communityDetailSkeletonImage: {
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    borderRadius: 9,
    backgroundColor: '#f1f5f9',
  },
  communityDetailPageDark: {
    backgroundColor: '#141c1a',
  },
  communityDetailFeedCardDark: {
    borderColor: '#3d5d51',
    backgroundColor: '#1a2220',
  },
  communityDetailFeedCardExerciseDark: {
    borderColor: '#5d4a35',
    backgroundColor: '#211d18',
  },
  communityDetailAvatarDark: {
    backgroundColor: '#27322f',
  },
  communityDetailAvatarFallbackDark: {
    backgroundColor: '#27322f',
  },
  communityDetailUserNameDark: {
    color: '#9bb8e8',
  },
  communityDetailPostTimeDark: {
    color: '#9ca3a8',
  },
  communityDetailTagDark: {
    backgroundColor: '#22332d',
    color: '#7dd3b0',
  },
  communityDetailTagExerciseDark: {
    backgroundColor: '#342d22',
    color: '#f4c17a',
  },
  communityDetailTitleDark: {
    color: '#e8ece9',
  },
  communityDetailBodyDark: {
    color: '#d2d8d4',
  },
  communityDetailImageDark: {
    backgroundColor: '#27322f',
  },
  communityDetailManualFoodCardDark: {
    borderColor: '#3d5d51',
    backgroundColor: '#1d2724',
  },
  communityDetailManualFoodImageFallbackDark: {
    backgroundColor: '#27322f',
  },
  communityDetailManualFoodTitleDark: {
    color: '#e8ece9',
  },
  communityDetailManualFoodBadgeDark: {
    backgroundColor: '#22332d',
    color: '#7dd3b0',
  },
  communityDetailManualFoodCaloriesDark: {
    color: '#9ca3a8',
  },
  communityDetailManualFoodExpandDark: {
    backgroundColor: '#27322f',
  },
  communityDetailManualFoodExpandTextDark: {
    color: '#b3bdb8',
  },
  communityDetailMicrosDark: {
    backgroundColor: '#18211f',
  },
  communityDetailMicrosTitleDark: {
    color: '#e8ece9',
  },
  communityDetailMicrosToggleTextDark: {
    color: '#b3bdb8',
  },
  communityDetailMicrosSummaryDark: {
    color: '#b3bdb8',
  },
  communityDetailMicroCellDark: {
    borderColor: '#3d5d51',
    backgroundColor: '#1d2724',
  },
  communityDetailMetaCardDark: {
    borderWidth: 1,
    borderColor: '#3d5d51',
    backgroundColor: '#18211f',
  },
  communityDetailMetaCardExerciseDark: {
    borderColor: '#5d4a35',
    backgroundColor: '#29231b',
  },
  communityDetailCalorieNumDark: {
    color: '#7dd3b0',
  },
  communityDetailCalorieUnitDark: {
    color: '#9ca3a8',
  },
  communityDetailMacrosTextDark: {
    color: '#a7e2c9',
  },
  communityDetailMacrosTextExerciseDark: {
    color: '#f0c98c',
  },
  communityDetailActionCountDark: {
    color: '#9ca3a8',
  },
  communityDetailManageBoxDark: {
    backgroundColor: '#27322f',
  },
  communityDetailCommentsDark: {
    backgroundColor: '#141c1a',
  },
  communityDetailCommentReplyDark: {
    borderLeftColor: '#3d5d51',
  },
  communityDetailCommentAvatarDark: {
    backgroundColor: '#27322f',
  },
  communityDetailCommentAuthorDark: {
    color: '#8ab4e8',
  },
  communityDetailCommentReplyToDark: {
    color: '#9ca3a8',
  },
  communityDetailCommentTextDark: {
    color: '#e8ece9',
  },
  communityDetailCommentEmptyDark: {
    backgroundColor: '#141c1a',
  },
  communityDetailCommentEmptyTextDark: {
    color: '#9ca3a8',
  },
  communityDetailBottomBarDark: {
    borderTopColor: '#3d5d51',
    backgroundColor: '#1d2724',
  },
  communityDetailReplyBarDark: {
    backgroundColor: '#27322f',
  },
  communityDetailReplyTextDark: {
    color: '#b3bdb8',
  },
  communityDetailReplyClose: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -8,
    marginRight: -8,
  },
  communityDetailCommentInputDark: {
    backgroundColor: '#222c29',
    color: '#e8ece9',
  },
  communityDetailSendButtonDark: {
    backgroundColor: '#27322f',
  },
  communityDetailSendButtonDisabledDark: {
    backgroundColor: '#27322f',
  },
  communityDetailActionSheetDark: {
    backgroundColor: '#1d2724',
  },
  communityDetailReportSheetDark: {
    backgroundColor: '#1d2724',
  },
  communityDetailSheetHandleDark: {
    backgroundColor: '#3d5d51',
  },
  communityDetailSheetTitleDark: {
    color: '#e8ece9',
  },
  communityDetailSheetActionDark: {
    borderTopColor: '#3d5d51',
  },
  communityDetailSheetActionTextDark: {
    color: '#e8ece9',
  },
  communityDetailSheetActionMutedDark: {
    color: '#9ca3a8',
  },
  communityDetailReportHintDark: {
    color: '#9ca3a8',
  },
  communityDetailReportInputDark: {
    borderColor: '#3d5d51',
    backgroundColor: '#222c29',
    color: '#e8ece9',
  },
  communityDetailEmptyTextDark: {
    color: '#9ca3a8',
  },
  communityDetailSkeletonDark: {
    backgroundColor: '#1a2220',
  },
  communityDetailSkeletonPlaceholderDark: {
    backgroundColor: '#27322f',
  },
  communityDetailSkeletonImageDark: {
    backgroundColor: '#222c29',
  },
  membershipPage: {
    flex: 1,
    backgroundColor: '#f0fdf4',
  },
  membershipScroll: {
    flex: 1,
  },
  membershipPageContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  membershipHero: {
    alignItems: 'center',
    overflow: 'hidden',
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 42,
    backgroundColor: '#203b32',
    shadowColor: '#10211b',
    shadowOpacity: 0.24,
    shadowRadius: 19,
    shadowOffset: { width: 0, height: 9 },
    elevation: 2,
  },
  membershipHeroEmblemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 9,
  },
  membershipHeroLaurel: {
    color: 'rgba(218,230,220,0.34)',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700',
  },
  membershipHeroLaurelLeft: {
    transform: [{ translateY: 3 }, { rotate: '-24deg' }],
  },
  membershipHeroLaurelRight: {
    transform: [{ translateY: 3 }, { scaleX: -1 }, { rotate: '-24deg' }],
  },
  membershipHeroIconShell: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  membershipHeroIconHalo: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(232,238,229,0.08)',
  },
  membershipHeroIconWrap: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  membershipHeroTitle: {
    color: '#f4f7f5',
    fontSize: 36,
    lineHeight: 43,
    fontWeight: '800',
    letterSpacing: 2,
  },
  membershipHeroSubtitle: {
    maxWidth: 300,
    marginTop: 8,
    color: 'rgba(236,243,239,0.72)',
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
  },
  membershipFounderBadge: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(253,230,138,0.28)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(251,191,36,0.16)',
  },
  membershipFounderBadgeText: {
    color: '#fef3c7',
    fontSize: 12,
    fontWeight: '700',
  },
  membershipCreditsPanel: {
    width: '100%',
    minHeight: 143,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 17,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  membershipCreditsLabel: {
    color: 'rgba(236,243,239,0.78)',
    fontSize: 12,
  },
  membershipCreditsValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  membershipCreditsValue: {
    color: '#cbffd0',
    fontSize: 50,
    lineHeight: 58,
    fontWeight: '800',
  },
  membershipCreditsTotal: {
    color: 'rgba(236,243,239,0.76)',
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '700',
  },
  membershipCreditsTip: {
    color: 'rgba(236,243,239,0.86)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  membershipCreditsPill: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  membershipSectionHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  membershipSectionTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  membershipSectionHint: {
    flexShrink: 1,
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'right',
  },
  membershipTierGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  membershipTierCard: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 96,
    minHeight: 138,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 13,
    paddingHorizontal: 9,
    paddingTop: 18,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
  },
  membershipTierCardActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#ecfdf5',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  membershipTierBadge: {
    position: 'absolute',
    right: 7,
    top: 4,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#fde68a',
    color: '#78350f',
    fontSize: 10,
    fontWeight: '800',
  },
  membershipTierHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  membershipTierIcon: {
    color: '#00bc7d',
    fontSize: 15,
    fontWeight: '800',
  },
  membershipTierName: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '800',
  },
  membershipTierCredits: {
    marginTop: 8,
    color: '#00bc7d',
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
  },
  membershipTierUnit: {
    color: '#6b7280',
    fontSize: 11,
  },
  membershipTierSummary: {
    marginTop: 7,
    color: '#6b7280',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  membershipPeriodTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  membershipPeriodTab: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 96,
    minHeight: 98,
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  membershipPeriodTabActive: {
    borderColor: '#00bc7d',
    backgroundColor: '#ecfdf5',
  },
  membershipPeriodRecommend: {
    position: 'absolute',
    top: 0,
    right: 8,
    overflow: 'hidden',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#fde68a',
    color: '#7c5600',
    fontSize: 10,
    fontWeight: '800',
  },
  membershipPeriodLabel: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  membershipPeriodPrice: {
    marginTop: 6,
    color: '#374151',
    fontSize: 16,
    fontWeight: '900',
  },
  membershipPeriodUnit: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
  },
  membershipPeriodSave: {
    overflow: 'hidden',
    marginTop: 5,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    fontSize: 10,
    fontWeight: '700',
  },
  membershipPeriodCurrent: {
    overflow: 'hidden',
    marginTop: 5,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: '#d1fae5',
    color: '#047857',
    fontSize: 10,
    fontWeight: '700',
  },
  membershipPeriodWatermark: {
    position: 'absolute',
    right: 8,
    bottom: 5,
    color: 'rgba(17,24,39,0.08)',
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '900',
    transform: [{ rotate: '-14deg' }],
  },
  membershipPlanSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#00bc7d',
    borderWidth: 1,
    borderColor: '#d1fae5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#00643c',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  membershipPlanName: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  membershipPlanDesc: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
  },
  membershipPlanMetaRow: {
    gap: 2,
    marginTop: 7,
  },
  membershipPlanMeta: {
    marginTop: 3,
    color: '#047857',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  membershipPlanSaveTag: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    marginTop: 6,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#fde68a',
  },
  membershipPlanSaveTagText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '800',
  },
  membershipPlanPriceBlock: {
    alignItems: 'flex-end',
    minWidth: 82,
    marginLeft: 'auto',
  },
  membershipPlanPrice: {
    color: '#00bc7d',
    fontSize: 24,
    fontWeight: '900',
  },
  membershipPlanPeriod: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  membershipPlanOriginalPrice: {
    marginTop: 4,
    color: '#9ca3af',
    fontSize: 10,
    textDecorationLine: 'line-through',
  },
  membershipActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 2,
  },
  membershipFeaturesCard: {
    overflow: 'hidden',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#00643c',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  membershipFeaturesHeader: {
    flexDirection: 'row',
    paddingLeft: 76,
    borderBottomWidth: 1,
    borderBottomColor: '#d1fae5',
    backgroundColor: '#f6fdf9',
  },
  membershipFeaturesHeadCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  membershipFeaturesHeadCellActive: {
    backgroundColor: 'rgba(0,188,125,0.1)',
  },
  membershipFeaturesHeadText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '800',
  },
  membershipFeaturesRow: {
    minHeight: 42,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f5f2',
  },
  membershipFeaturesLabelCell: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafcfb',
    paddingHorizontal: 4,
  },
  membershipFeaturesLabelText: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  membershipFeaturesValueCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  membershipFeaturesValueCellActive: {
    backgroundColor: 'rgba(0,188,125,0.06)',
  },
  membershipFeaturesValueText: {
    color: '#064e3b',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  membershipFeaturesFootnote: {
    marginHorizontal: 16,
    marginTop: 8,
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 18,
  },
  membershipCreditsHintCard: {
    gap: 3,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#fde68a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: '#fffdf5',
  },
  membershipCreditsHintHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 2,
  },
  membershipCreditsHintTitle: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '800',
  },
  membershipCreditsHintItem: {
    color: '#78350f',
    fontSize: 11,
    lineHeight: 18,
  },
  membershipCreditsHintItemMuted: {
    color: '#a16207',
    fontSize: 10,
  },
  membershipStatusCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#00643c',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  membershipStatusRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f5f2',
    paddingVertical: 6,
  },
  membershipStatusLabel: {
    color: '#6b7280',
    fontSize: 13,
  },
  membershipStatusValue: {
    flex: 1,
    color: '#111827',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'right',
  },
  membershipStatusValueActive: {
    color: '#00bc7d',
  },
  membershipInfoCardTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  membershipSubscribeSection: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  membershipRenewTip: {
    marginBottom: 8,
    color: '#9ca3af',
    fontSize: 11,
    textAlign: 'center',
  },
  membershipSubscribeButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  membershipSubscribeButtonRenew: {
    backgroundColor: '#047857',
    shadowColor: '#047857',
  },
  membershipSubscribeButtonDisabled: {
    opacity: 0.65,
  },
  membershipSubscribeButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  membershipSubscribeHint: {
    marginTop: 10,
    color: '#9ca3af',
    fontSize: 11,
    textAlign: 'center',
  },
  membershipPressed: {
    opacity: 0.78,
  },
  membershipLinkButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  membershipLinkButtonDark: {
    borderColor: 'rgba(125,211,176,0.28)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  membershipLinkButtonDisabled: {
    opacity: 0.52,
  },
  membershipLinkButtonText: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '800',
  },
  membershipLinkButtonTextDark: {
    color: '#7dd3b0',
  },
  membershipPageDark: {
    backgroundColor: '#0f1413',
  },
  membershipSectionTitleDark: {
    color: '#eef4f1',
  },
  membershipSectionHintDark: {
    color: '#93a39b',
  },
  membershipTierCardDark: {
    borderColor: 'rgba(125,211,176,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    shadowColor: '#000000',
    shadowOpacity: 0.26,
  },
  membershipTierCardActiveDark: {
    borderColor: 'rgba(125,211,176,0.58)',
    backgroundColor: 'rgba(125,211,176,0.14)',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
  },
  membershipTierNameDark: {
    color: '#edf6f0',
  },
  membershipTierCreditsDark: {
    color: '#7dd3b0',
  },
  membershipTierUnitDark: {
    color: '#afbbb4',
  },
  membershipTierSummaryDark: {
    color: '#afbbb4',
  },
  membershipPeriodTabDark: {
    borderColor: 'rgba(125,211,176,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  membershipPeriodTabActiveDark: {
    borderColor: 'rgba(125,211,176,0.58)',
    backgroundColor: 'rgba(125,211,176,0.14)',
  },
  membershipPeriodLabelDark: {
    color: '#edf6f0',
  },
  membershipPeriodPriceDark: {
    color: '#edf6f0',
  },
  membershipPeriodUnitDark: {
    color: '#b6c2bc',
  },
  membershipPeriodWatermarkDark: {
    color: 'rgba(255,255,255,0.08)',
  },
  membershipPeriodSaveDark: {
    color: '#fecaca',
    backgroundColor: 'rgba(127,29,29,0.22)',
  },
  membershipPeriodCurrentDark: {
    color: '#a7f3d0',
    backgroundColor: 'rgba(6,95,70,0.22)',
  },
  membershipPlanSummaryDark: {
    borderLeftColor: '#6ee7b7',
    borderColor: 'rgba(125,211,176,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    shadowColor: '#000000',
    shadowOpacity: 0.26,
  },
  membershipPlanNameDark: {
    color: '#edf6f0',
  },
  membershipPlanPriceDark: {
    color: '#7dd3b0',
  },
  membershipPlanDescDark: {
    color: '#afbbb4',
  },
  membershipPlanMetaDark: {
    color: '#7dd3b0',
  },
  membershipPlanPeriodDark: {
    color: '#93a39b',
  },
  membershipPlanOriginalPriceDark: {
    color: '#7f8a85',
  },
  membershipFeaturesCardDark: {
    borderWidth: 1,
    borderColor: 'rgba(125,211,176,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    shadowColor: '#000000',
    shadowOpacity: 0.26,
  },
  membershipFeaturesHeaderDark: {
    borderBottomColor: 'rgba(125,211,176,0.14)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  membershipFeaturesHeadCellActiveDark: {
    backgroundColor: 'rgba(125,211,176,0.1)',
  },
  membershipFeaturesHeadTextDark: {
    color: '#edf6f0',
  },
  membershipFeaturesRowDark: {
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  membershipFeaturesLabelCellDark: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  membershipFeaturesLabelTextDark: {
    color: '#edf6f0',
  },
  membershipFeaturesValueCellActiveDark: {
    backgroundColor: 'rgba(125,211,176,0.1)',
  },
  membershipFeaturesValueTextDark: {
    color: '#7dd3b0',
  },
  membershipFeaturesFootnoteDark: {
    color: '#93a39b',
  },
  membershipCreditsHintCardDark: {
    borderColor: 'rgba(251,191,36,0.22)',
    backgroundColor: 'rgba(146,64,14,0.14)',
  },
  membershipCreditsHintTitleDark: {
    color: '#fde68a',
  },
  membershipCreditsHintItemDark: {
    color: '#f3ead2',
  },
  membershipCreditsHintItemMutedDark: {
    color: '#cbbd96',
  },
  membershipStatusCardDark: {
    borderWidth: 1,
    borderColor: 'rgba(125,211,176,0.16)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    shadowColor: '#000000',
    shadowOpacity: 0.26,
  },
  membershipStatusRowDark: {
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  membershipStatusLabelDark: {
    color: '#93a39b',
  },
  membershipStatusValueDark: {
    color: '#edf6f0',
  },
  membershipStatusValueActiveDark: {
    color: '#7dd3b0',
  },
  membershipInfoCardTitleDark: {
    color: '#edf6f0',
  },
  membershipRenewTipDark: {
    color: '#93a39b',
  },
  membershipSubscribeHintDark: {
    color: '#93a39b',
  },
  payGuideText: {
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: 12,
    marginBottom: 14,
  },
  ruleRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  ruleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand,
    marginTop: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  groupTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
    marginTop: 4,
  },
  bigTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 8,
  },
  bigNumber: {
    color: colors.brandDark,
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  notes: {
    marginTop: 12,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  recipesPage: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  recipesPageHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  recipesHeaderCopy: {
    minWidth: 0,
  },
  recipesPageTitle: {
    color: '#0f172a',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  recipesPageSubtitle: {
    marginTop: 5,
    color: '#5b6b7f',
    fontSize: 11,
    lineHeight: 18,
  },
  recipesList: {
    flex: 1,
  },
  recipesListContent: {
    paddingTop: 12,
  },
  recipesGrid: {
    gap: 12,
    paddingHorizontal: 16,
  },
  recipesEmptyState: {
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  recipesEmptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  recipesEmptyText: {
    color: '#64748b',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  recipesEmptyHint: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  recipeCard: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  recipeImageWrapper: {
    width: '100%',
    height: 160,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
  },
  recipeCardImage: {
    width: '100%',
    height: '100%',
  },
  recipeCardImagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  recipeFavoriteBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  recipeMealBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  recipeMealBadgeText: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  recipeCardContent: {
    padding: 12,
    gap: 8,
  },
  recipeCardName: {
    color: '#1e293b',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '800',
  },
  recipeCardDesc: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
  },
  recipeNutritionSummary: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
    backgroundColor: '#f8fafc',
  },
  recipeNutritionItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  recipeNutritionHighlight: {
    flex: 1.2,
    alignItems: 'flex-start',
    paddingLeft: 6,
  },
  recipeCalorieLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  recipeCalorieValue: {
    color: '#00bc7d',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
  },
  recipeCalorieUnit: {
    color: '#00bc7d',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    marginLeft: 3,
  },
  recipeNutritionDivider: {
    width: 1,
    height: 20,
    marginHorizontal: 8,
    backgroundColor: '#e2e8f0',
  },
  recipeNutritionLabel: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
  recipeNutritionValue: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  recipeTagsScroll: {
    width: '100%',
  },
  recipeTags: {
    flexDirection: 'row',
    gap: 6,
  },
  recipeTag: {
    overflow: 'hidden',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
    backgroundColor: '#f1f5f9',
  },
  recipeMicroSummary: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dce8e2',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: '#f7fcf9',
  },
  recipeMicroSummaryItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
  },
  recipeMicroSummaryLabel: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
  recipeMicroSummaryValue: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  recipeMealSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.28)',
  },
  recipeMealSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  recipeMealSheetHandle: {
    alignSelf: 'center',
    width: 34,
    height: 4,
    borderRadius: 999,
    marginBottom: 12,
    backgroundColor: '#d8dee8',
  },
  recipeMealSheetTitle: {
    color: '#0f172a',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
    textAlign: 'center',
  },
  recipeMealSheetSubtitle: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  recipeMealSheetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  recipeMealOption: {
    flexBasis: '31.5%',
    minHeight: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  recipeMealOptionActive: {
    backgroundColor: '#00bc7d',
  },
  recipeMealOptionText: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  recipeMealOptionTextActive: {
    color: '#fff',
  },
  recipeMealSheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  recipeMealSheetCancelButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2f7',
  },
  recipeMealSheetCancelText: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  recipeMealSheetConfirmButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00bc7d',
  },
  recipeMealSheetConfirmButtonDisabled: {
    opacity: 0.72,
  },
  recipeMealSheetConfirmText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  recipeCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  recipeStatsRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recipeStatsText: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  recipeStatsDot: {
    color: '#cbd5e1',
    fontSize: 11,
  },
  recipeActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recipeIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  recipeDeleteButton: {
    backgroundColor: '#fef2f2',
  },
  recipeUseButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  recipeUseButtonText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  recipeHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  recipeImage: {
    width: 74,
    height: 74,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  recipeImageFallback: {
    width: 74,
    height: 74,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  recipeImageFallbackText: {
    color: colors.brandDark,
    fontSize: 22,
    fontWeight: '900',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tagText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  inlinePicker: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  recipeItems: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recipeItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 10,
  },
  recipeItemName: {
    color: colors.text,
    fontWeight: '800',
  },
  recipeItemMacro: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  publicFoodScreen: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  publicFoodScreenDark: {
    backgroundColor: '#101715',
  },
  publicFoodSurfaceDark: {
    backgroundColor: '#18211f',
  },
  publicFoodBorderDark: {
    borderColor: 'rgba(255,255,255,0.08)',
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  publicFoodFieldDark: {
    borderColor: '#303b37',
    backgroundColor: '#222c29',
  },
  publicFoodTextPrimaryDark: {
    color: '#f2f7f4',
  },
  publicFoodTextSecondaryDark: {
    color: '#aab8b2',
  },
  publicFoodAccentTextDark: {
    color: '#6ee7b7',
  },
  publicFoodAccentBackgroundDark: {
    backgroundColor: '#6ee7b7',
  },
  publicFoodControlPressed: {
    opacity: 0.68,
  },
  publicFoodPrimaryPressed: {
    opacity: 0.82,
  },
  publicFoodActionDisabled: {
    opacity: 0.45,
  },
  publicFoodTabs: {
    paddingHorizontal: 12,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  publicFoodTab: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    paddingHorizontal: 4,
  },
  publicFoodTabActive: {
    borderBottomColor: colors.brand,
  },
  publicFoodTabText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  publicFoodTabTextActive: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  publicFoodSearchSection: {
    zIndex: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  publicFoodSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  publicFoodSearchInputWrap: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#edf1ef',
    borderRadius: 12,
    paddingLeft: 12,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8faf9',
  },
  publicFoodSearchInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 0,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  publicFoodSearchClear: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicFoodSearchButton: {
    minWidth: 76,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  publicFoodSearchButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  publicFoodSortSection: {
    zIndex: 20,
    minHeight: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  publicFoodSortSectionCompact: {
    minHeight: 104,
    flexWrap: 'wrap',
    alignContent: 'center',
    paddingVertical: 4,
  },
  publicFoodSortSectionFilterOpen: {
    minHeight: 172,
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  publicFoodSortSectionCompactFilterOpen: {
    minHeight: 220,
    alignContent: 'flex-start',
  },
  publicFoodSortLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  publicFoodSortLeftCompact: {
    width: '100%',
    flexBasis: '100%',
    justifyContent: 'space-between',
    gap: 8,
  },
  publicFoodSortItem: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  publicFoodSortText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  publicFoodSortTextActive: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  publicFoodSortUnderline: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
  publicFoodFilterButton: {
    minWidth: 86,
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#edf1ef',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#f8faf9',
  },
  publicFoodFilterButtonCompact: {
    marginLeft: 'auto',
  },
  publicFoodFilterButtonActive: {
    borderColor: 'rgba(92,184,150,0.32)',
    backgroundColor: '#eef8f4',
  },
  publicFoodFilterButtonActiveDark: {
    borderColor: 'rgba(110,231,183,0.30)',
    backgroundColor: '#20352d',
  },
  publicFoodFilterText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  publicFoodFilterTextActive: {
    color: colors.brandDark,
  },
  publicFoodFilterPanel: {
    position: 'absolute',
    right: 16,
    top: 58,
    minWidth: 212,
    borderWidth: 1,
    borderColor: '#edf1ef',
    borderRadius: 16,
    padding: 12,
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  publicFoodFilterPanelCompact: {
    top: 106,
  },
  publicFoodFilterPanelDark: {
    borderColor: '#303b37',
    backgroundColor: '#18211f',
    shadowOpacity: 0.36,
  },
  publicFoodFilterLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
    marginBottom: 10,
  },
  publicFoodFilterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  publicFoodFilterOption: {
    minHeight: 48,
    borderRadius: 22,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodFilterOptionDark: {
    backgroundColor: '#222c29',
  },
  publicFoodFilterOptionActive: {
    backgroundColor: colors.brandSoft,
  },
  publicFoodFilterOptionActiveDark: {
    backgroundColor: '#20352d',
  },
  publicFoodFilterOptionText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  publicFoodFilterOptionTextActive: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  publicFoodAppliedFilters: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  publicFoodAppliedChip: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  publicFoodAppliedChipDark: {
    backgroundColor: '#20352d',
  },
  publicFoodAppliedChipText: {
    color: colors.brandDark,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  publicFoodClearFilterButton: {
    minWidth: 52,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicFoodClearFilter: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  publicFoodListScroll: {
    flex: 1,
  },
  publicFoodListScrollerContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  publicFoodListScrollerEmpty: {
    justifyContent: 'center',
  },
  publicFoodListContent: {
    width: '100%',
  },
  publicFoodLoadingState: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicFoodCard: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#edf1ef',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  publicFoodCardDark: {
    borderColor: '#28332f',
    backgroundColor: '#18211f',
    shadowOpacity: 0.24,
  },
  publicFoodCardPressed: {
    opacity: 0.84,
  },
  publicFoodCardMain: {
    minHeight: 134,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  publicFoodCardMainCompact: {
    minHeight: 120,
    gap: 10,
    padding: 10,
  },
  publicFoodImageWrap: {
    width: 110,
    height: 110,
    borderRadius: 10,
    overflow: 'hidden',
    flexShrink: 0,
    position: 'relative',
    backgroundColor: colors.brandSoft,
  },
  publicFoodImageWrapCompact: {
    width: 96,
    height: 96,
  },
  publicFoodImageWrapDark: {
    backgroundColor: '#1f3b33',
  },
  publicFoodImage: {
    width: '100%',
    height: '100%',
  },
  publicFoodImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.brandSoft,
  },
  publicFoodImageFallbackDark: {
    backgroundColor: '#1f3b33',
  },
  publicFoodImageFallbackText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  publicFoodLatestBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: colors.brand,
  },
  publicFoodFatLossBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: colors.brand,
  },
  publicFoodCampusBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(20,184,166,0.92)',
  },
  publicFoodBadgeText: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
  },
  publicFoodInfo: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    paddingBottom: 24,
  },
  publicFoodTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  publicFoodDesc: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  publicFoodMerchant: {
    alignSelf: 'flex-start',
    minHeight: 28,
    marginTop: 'auto',
    borderRadius: 7,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.brandSoft,
  },
  publicFoodMerchantDark: {
    backgroundColor: '#20352d',
  },
  publicFoodMerchantText: {
    maxWidth: 150,
    color: colors.brandDark,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  publicFoodCampusMeta: {
    flex: 1,
    marginTop: 5,
  },
  publicFoodCampusLocation: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  publicFoodCampusSummary: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  publicFoodCampusChip: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    color: '#047857',
    backgroundColor: '#ecfdf5',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
  },
  publicFoodCampusChipDark: {
    color: '#6ee7b7',
    backgroundColor: '#20352d',
  },
  publicFoodCampusCalories: {
    marginLeft: 'auto',
    color: colors.brandDark,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  publicFoodCalories: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    color: colors.brandDark,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  publicFoodFooter: {
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  publicFoodFooterCompact: {
    flexWrap: 'wrap',
    alignItems: 'stretch',
  },
  publicFoodAuthor: {
    flex: 1,
    minWidth: 42,
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  publicFoodAuthorCompact: {
    flexBasis: '100%',
    minWidth: '100%',
  },
  publicFoodAuthorAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodAuthorAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  publicFoodAuthorAvatarFallbackDark: {
    backgroundColor: '#20352d',
  },
  publicFoodAuthorName: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  publicFoodAuthorNameOfficial: {
    fontWeight: '900',
  },
  publicFoodStats: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  publicFoodStatsCompact: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  publicFoodStatAction: {
    minWidth: 48,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  publicFoodStatDisplay: {
    minWidth: 48,
    height: 48,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  publicFoodStatActionLiked: {
    backgroundColor: '#fff1f2',
  },
  publicFoodStatActionLikedDark: {
    backgroundColor: '#3d2028',
  },
  publicFoodStatActionCollected: {
    backgroundColor: '#fffbeb',
  },
  publicFoodStatActionCollectedDark: {
    backgroundColor: '#3a2e17',
  },
  publicFoodStatCount: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  publicFoodStatCountLiked: {
    color: '#e11d48',
  },
  publicFoodRatingCount: {
    color: '#b45309',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
  },
  publicFoodEmpty: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  publicFoodEmptyIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  publicFoodEmptyIconWrapDark: {
    backgroundColor: '#20352d',
  },
  publicFoodEmptyText: {
    maxWidth: 280,
    marginTop: 14,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  publicFoodEmptyButton: {
    marginTop: 16,
    minWidth: 112,
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  publicFoodEmptyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  publicFoodSkeletonCard: {
    marginBottom: 12,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  publicFoodSkeletonCardDark: {
    backgroundColor: '#18211f',
  },
  publicFoodSkeletonMain: {
    minHeight: 134,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  publicFoodSkeletonImage: {
    width: 110,
    height: 110,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodSkeletonLine: {
    marginBottom: 10,
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodSkeletonPlaceholderDark: {
    backgroundColor: '#27322e',
  },
  publicFoodSkeletonFooter: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  publicFoodFab: {
    position: 'absolute',
    right: 18,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  publicFoodFabPressed: {
    opacity: 0.78,
  },
  publicFoodDetailScreenDark: {
    backgroundColor: '#0f1412',
  },
  publicFoodDetailScrollDark: {
    backgroundColor: '#0f1412',
  },
  publicFoodDetailImageSectionDark: {
    backgroundColor: '#171d1a',
  },
  publicFoodDetailImageSlideDark: {
    backgroundColor: '#171d1a',
  },
  publicFoodDetailImagePressed: {
    opacity: 0.86,
  },
  publicFoodDetailImageExpandBadge: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
  publicFoodDetailImagePlaceholderDark: {
    backgroundColor: '#171d1a',
  },
  publicFoodDetailContributionIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    backgroundColor: '#e8f8f2',
  },
  publicFoodDetailContributionIconDark: {
    backgroundColor: '#20352d',
  },
  publicFoodDetailContributionTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  publicFoodDetailContributionHint: {
    marginTop: 4,
    marginBottom: 14,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  publicFoodDetailContributionButton: {
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.brand,
  },
  publicFoodDetailContributionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  publicFoodDetailActionDisabled: {
    opacity: 0.48,
  },
  publicFoodDetailInfoCardDark: {
    backgroundColor: '#171d1a',
    shadowOpacity: 0.22,
  },
  publicFoodDetailTitleDark: {
    color: '#f1f5f3',
  },
  publicFoodDetailCaloriesBadgeDark: {
    backgroundColor: '#20352d',
  },
  publicFoodDetailCaloriesTextDark: {
    color: '#7dd3b0',
  },
  publicFoodDetailTextSecondaryDark: {
    color: '#b3bdb8',
  },
  publicFoodDetailTextPrimaryDark: {
    color: '#f1f5f3',
  },
  publicFoodDetailInsightDark: {
    color: '#c6cfcb',
  },
  publicFoodDetailCampusSummary: {
    marginTop: 4,
    marginBottom: 14,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    backgroundColor: '#f8faf9',
  },
  publicFoodDetailCampusSummaryDark: {
    backgroundColor: '#1d2521',
  },
  publicFoodDetailCampusLocationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  publicFoodDetailPriceDark: {
    color: '#7dd3b0',
  },
  publicFoodDetailAnalysisTipDark: {
    color: '#fdba74',
    backgroundColor: '#3a2418',
  },
  publicFoodDetailAnalysisTipErrorDark: {
    color: '#fca5a5',
    backgroundColor: '#3b1d20',
  },
  publicFoodDetailNutrientsDark: {
    borderColor: '#2a342f',
  },
  publicFoodDetailNutrientDividerDark: {
    borderRightColor: '#2a342f',
  },
  publicFoodDetailMicronutrients: {
    marginBottom: 16,
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#f8faf9',
  },
  publicFoodDetailMicronutrientsDark: {
    backgroundColor: '#1d2521',
  },
  publicFoodDetailMicronutrientsHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  publicFoodDetailMicronutrientsTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  publicFoodDetailMicronutrientsStatus: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodDetailMicronutrientsStatusReady: {
    color: '#047857',
  },
  publicFoodDetailMicronutrientsToggle: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  publicFoodDetailMicronutrientsToggleText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '900',
  },
  publicFoodDetailMicronutrientsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  publicFoodDetailMicronutrientCell: {
    minHeight: 58,
    borderTopWidth: 1,
    borderColor: '#e5e7eb',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  publicFoodDetailMicronutrientCellDark: {
    borderColor: '#2a342f',
  },
  publicFoodDetailMicronutrientLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  publicFoodDetailMicronutrientValue: {
    marginTop: 3,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  publicFoodDetailAvatarFallbackDark: {
    backgroundColor: '#20352d',
  },
  publicFoodDetailCardDark: {
    backgroundColor: '#171d1a',
    shadowOpacity: 0.18,
  },
  publicFoodDetailTagDark: {
    color: '#7dd3b0',
    backgroundColor: '#20352d',
  },
  publicFoodDetailCommentCountDark: {
    color: '#b3bdb8',
    backgroundColor: '#252d29',
  },
  publicFoodDetailQuickCommentDark: {
    borderColor: '#2a342f',
    backgroundColor: '#1d2521',
  },
  publicFoodDetailQuickPlaceholder: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  publicFoodDetailEmptyCommentsDark: {
    color: '#7f8c87',
    backgroundColor: '#1d2521',
  },
  publicFoodDetailCommentRowDark: {
    borderBottomColor: '#2a342f',
  },
  publicFoodDetailReplyRowDark: {
    borderLeftColor: '#315c4b',
    backgroundColor: '#1d2521',
  },
  publicFoodDetailCommentNameDark: {
    color: '#f1f5f3',
  },
  publicFoodDetailRatingStars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  publicFoodDetailMutedTextDark: {
    color: '#7f8c87',
  },
  publicFoodDetailCommentContentDark: {
    color: '#d7dfdb',
  },
  publicFoodDetailTextActionTextDark: {
    color: '#b3bdb8',
  },
  publicFoodDetailBottomBarDark: {
    borderColor: '#2a342f',
    backgroundColor: 'rgba(23,29,26,0.97)',
  },
  publicFoodDetailIconActionLikedDark: {
    backgroundColor: '#3d2028',
  },
  publicFoodDetailIconActionCollectedDark: {
    backgroundColor: '#3a2e17',
  },
  publicFoodDetailActionBadgeDark: {
    color: '#b3bdb8',
  },
  publicFoodDetailCorrectionButton: {
    minHeight: 44,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicFoodDetailPreviewModal: {
    flex: 1,
    backgroundColor: '#000',
  },
  publicFoodDetailPreviewHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    minHeight: 72,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  publicFoodDetailPreviewTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  publicFoodDetailPreviewCounter: {
    marginHorizontal: 12,
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '800',
  },
  publicFoodDetailPreviewClose: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  publicFoodDetailPreviewPressed: {
    opacity: 0.62,
  },
  publicFoodDetailPreviewScroller: {
    flex: 1,
  },
  publicFoodDetailPreviewSlide: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  publicFoodDetailPreviewImage: {
    width: '100%',
    height: '100%',
  },
  publicFoodDetailPreviewControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  publicFoodDetailPreviewControl: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  publicFoodDetailPreviewControlDisabled: {
    opacity: 0.28,
  },
  publicFoodDetailModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  publicFoodDetailModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  publicFoodDetailComposerSheet: {
    maxHeight: '84%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: '#fff',
  },
  publicFoodDetailComposerSheetDark: {
    backgroundColor: '#171d1a',
  },
  publicFoodDetailSheetHandle: {
    width: 42,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 12,
    backgroundColor: '#d1d5db',
  },
  publicFoodDetailSheetHandleDark: {
    backgroundColor: '#47534d',
  },
  publicFoodDetailComposerHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  publicFoodDetailComposerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '900',
  },
  publicFoodDetailSheetClose: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publicFoodDetailRatingRow: {
    marginTop: 10,
    marginBottom: 12,
  },
  publicFoodDetailRatingLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  publicFoodDetailRatingButtons: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  publicFoodDetailRatingButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8faf9',
  },
  publicFoodDetailRatingButtonDark: {
    backgroundColor: '#1d2521',
  },
  publicFoodDetailComposerInput: {
    minHeight: 132,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: '#dce3df',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: '#f8faf9',
    fontSize: 15,
    lineHeight: 22,
  },
  publicFoodDetailComposerInputDark: {
    borderColor: '#2a342f',
    color: '#f1f5f3',
    backgroundColor: '#1d2521',
  },
  publicFoodDetailComposerSubmit: {
    minHeight: 52,
    borderRadius: 14,
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  publicFoodDetailComposerSubmitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  publicFoodDetailComposerHint: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  publicFoodDetailActionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#f3f4f6',
  },
  publicFoodDetailActionSheetDark: {
    backgroundColor: '#111714',
  },
  publicFoodDetailSheetTitle: {
    minHeight: 48,
    color: colors.text,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '900',
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  publicFoodDetailSheetAction: {
    minHeight: 54,
    borderRadius: 14,
    marginBottom: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
  },
  publicFoodDetailSheetActionDark: {
    backgroundColor: '#1d2521',
  },
  publicFoodDetailSheetActionDanger: {
    marginTop: 2,
  },
  publicFoodDetailSheetActionText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  publicFoodDetailSheetActionTextDark: {
    color: '#f1f5f3',
  },
  publicFoodDetailSheetCancel: {
    minHeight: 54,
    borderRadius: 14,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  publicFoodDetailSheetCancelDark: {
    backgroundColor: '#1d2521',
  },
  publicFoodDetailSheetCancelText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  publicFoodDetailSkeletonPlaceholderDark: {
    backgroundColor: '#252d29',
  },
  publicFoodDetailEmptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f8f2',
  },
  publicFoodDetailInfoCellDark: {
    borderColor: '#2a342f',
    backgroundColor: '#1d2521',
  },
  publicFoodDetailInfoRow: {
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f0',
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  publicFoodDetailInfoRowDark: {
    borderBottomColor: '#2a342f',
  },
  publicFoodDetailInfoRowLabel: {
    width: 88,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  publicFoodDetailInfoRowValue: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'right',
  },
  publicFoodDetailScreen: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  publicFoodDetailScroll: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  publicFoodDetailContent: {
    paddingTop: 0,
  },
  publicFoodDetailImageSection: {
    height: 280,
    position: 'relative',
    backgroundColor: '#e5e7eb',
  },
  publicFoodDetailImageScroller: {
    flex: 1,
  },
  publicFoodDetailImageSlide: {
    height: 280,
    backgroundColor: '#e5e7eb',
  },
  publicFoodDetailImage: {
    width: '100%',
    height: '100%',
  },
  publicFoodDetailImagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  publicFoodDetailImagePlaceholderText: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
  },
  publicFoodDetailImageCounter: {
    position: 'absolute',
    top: 16,
    left: 16,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  publicFoodDetailImageCounterText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodDetailFatLossBadge: {
    position: 'absolute',
    top: 18,
    right: 18,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0, 188, 125, 0.9)',
  },
  publicFoodDetailFatLossText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodDetailInfoCard: {
    marginTop: -30,
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 16,
    padding: 20,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  publicFoodDetailInfoHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  publicFoodDetailTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '800',
  },
  publicFoodDetailCaloriesBadge: {
    minHeight: 31,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4faf8',
  },
  publicFoodDetailCaloriesText: {
    color: '#059669',
    fontSize: 14,
    fontWeight: '900',
  },
  publicFoodDetailDesc: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 8,
  },
  publicFoodDetailInsight: {
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 23,
    marginBottom: 12,
  },
  publicFoodDetailNutrients: {
    marginTop: 8,
    marginBottom: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#f3f4f6',
    flexDirection: 'row',
  },
  publicFoodDetailNutrientItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'relative',
  },
  publicFoodDetailNutrientDivider: {
    borderRightWidth: 1,
    borderRightColor: '#e5e7eb',
  },
  publicFoodDetailNutrientValue: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },
  publicFoodDetailNutrientLabel: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  publicFoodDetailAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  publicFoodDetailAuthorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodDetailAuthorFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  publicFoodDetailAuthorInitial: {
    color: colors.brandDark,
    fontSize: 15,
    fontWeight: '900',
  },
  publicFoodDetailAuthorName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  publicFoodDetailPublished: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  publicFoodDetailCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 16,
    padding: 18,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  publicFoodDetailCampusHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  publicFoodDetailCampusBadge: {
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    color: '#047857',
    backgroundColor: '#f4faf8',
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodDetailCampusFatLoss: {
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    color: '#94a3b8',
    backgroundColor: '#f3f4f6',
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodDetailCampusFatLossActive: {
    color: '#047857',
    backgroundColor: '#dcfce7',
  },
  publicFoodDetailCampusPortion: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  publicFoodDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  publicFoodDetailInfoCell: {
    width: '48%',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#eef2f7',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#f9fafb',
  },
  publicFoodDetailInfoLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 5,
  },
  publicFoodDetailInfoValue: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  publicFoodDetailLocation: {
    marginTop: 4,
    color: '#374151',
    fontSize: 14,
    lineHeight: 22,
  },
  publicFoodDetailPriceRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
  },
  publicFoodDetailPrice: {
    color: '#047857',
    fontSize: 22,
    fontWeight: '900',
  },
  publicFoodDetailMetric: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    color: '#64748b',
    backgroundColor: '#f9fafb',
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodDetailMuted: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  publicFoodDetailAnalysisTip: {
    marginTop: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#c2410c',
    backgroundColor: '#fff7ed',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  publicFoodDetailAnalysisTipError: {
    color: '#b91c1c',
    backgroundColor: '#fef2f2',
  },
  publicFoodDetailCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  publicFoodDetailCardTitleBar: {
    width: 4,
    height: 16,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
  publicFoodDetailCardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  publicFoodDetailTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  publicFoodDetailTag: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    color: '#047857',
    backgroundColor: '#f4faf8',
    fontSize: 14,
    fontWeight: '800',
  },
  publicFoodDetailNotes: {
    color: '#374151',
    fontSize: 14,
    lineHeight: 24,
  },
  publicFoodDetailSectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  publicFoodDetailSectionHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  publicFoodDetailCommentsHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  publicFoodDetailCommentCount: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    color: colors.textSecondary,
    backgroundColor: '#f3f4f6',
    fontSize: 13,
    fontWeight: '800',
  },
  publicFoodDetailQuickComment: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f9fafb',
  },
  publicFoodDetailQuickAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  publicFoodDetailQuickInput: {
    flex: 1,
    minHeight: 34,
    maxHeight: 86,
    paddingVertical: 0,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  publicFoodDetailEmptyComments: {
    marginTop: 12,
    borderRadius: 8,
    paddingVertical: 24,
    textAlign: 'center',
    color: colors.textMuted,
    backgroundColor: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  publicFoodDetailCommentRow: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  publicFoodDetailReplyRow: {
    marginTop: 10,
    paddingLeft: 12,
    paddingVertical: 10,
    borderLeftWidth: 2,
    borderLeftColor: colors.brandSoft,
    borderBottomWidth: 0,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
  },
  publicFoodDetailCommentHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  publicFoodDetailCommentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodDetailCommentAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  publicFoodDetailReplyAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodDetailReplyAvatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  publicFoodDetailCommentAvatarText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  publicFoodDetailCommentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  publicFoodDetailCommentName: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  publicFoodDetailRating: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '900',
  },
  publicFoodDetailCommentTime: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  publicFoodDetailCommentContent: {
    marginLeft: 48,
    color: '#374151',
    fontSize: 14,
    lineHeight: 22,
  },
  publicFoodDetailCommentActions: {
    marginLeft: 48,
    marginTop: 8,
    flexDirection: 'row',
    gap: 16,
  },
  publicFoodDetailTextAction: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  publicFoodDetailTextActionText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  publicFoodDetailDangerText: {
    color: colors.danger,
  },
  publicFoodDetailReplies: {
    marginLeft: 48,
    marginTop: 10,
  },
  publicFoodDetailBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
  publicFoodDetailBottomTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  publicFoodDetailQuickRecord: {
    minWidth: 96,
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: colors.brand,
  },
  publicFoodDetailQuickRecordDisabled: {
    backgroundColor: '#d1d5db',
  },
  publicFoodDetailQuickRecordText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  publicFoodDetailBottomActions: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  publicFoodDetailIconAction: {
    minWidth: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  publicFoodDetailIconActionLiked: {
    borderRadius: 24,
    backgroundColor: '#fff1f2',
  },
  publicFoodDetailIconActionCollected: {
    borderRadius: 24,
    backgroundColor: '#fffbeb',
  },
  publicFoodDetailIconText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '900',
  },
  publicFoodDetailIconTextLiked: {
    color: '#e11d48',
  },
  publicFoodDetailIconTextCollected: {
    color: '#b45309',
  },
  publicFoodDetailActionBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    minWidth: 16,
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
  },
  publicFoodDetailCorrectionBar: {
    minHeight: 44,
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  publicFoodDetailCorrectionHint: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  publicFoodDetailCorrectionLink: {
    color: colors.brand,
    fontSize: 11,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  publicFoodDetailSkeletonImage: {
    height: 280,
    backgroundColor: '#e5e7eb',
  },
  publicFoodDetailSkeletonCard: {
    overflow: 'hidden',
  },
  publicFoodDetailSkeletonHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  publicFoodDetailSkeletonLine: {
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 10,
  },
  publicFoodDetailSkeletonNutrients: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
  },
  publicFoodDetailSkeletonAuthor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  publicFoodDetailSkeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
  },
  publicFoodDetailEmptyState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  publicFoodDetailEmptyTitle: {
    marginTop: 14,
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  publicFoodDetailEmptyText: {
    marginTop: 6,
    marginBottom: 12,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  price: {
    color: colors.brandDark,
    fontSize: 20,
    fontWeight: '900',
  },
  heroImage: {
    width: '100%',
    height: 190,
    borderRadius: 16,
    marginBottom: 12,
    backgroundColor: colors.surfaceMuted,
  },
  relatedFoodScroll: {
    gap: 12,
    paddingTop: 12,
    paddingRight: 4,
  },
  relatedFoodItem: {
    width: 210,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.surface,
  },
  relatedFoodImage: {
    width: '100%',
    height: 108,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: colors.surfaceMuted,
  },
  relatedFoodImageFallback: {
    width: '100%',
    height: 108,
    borderRadius: 12,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  relatedFoodImageText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  relatedFeedList: {
    marginTop: 12,
  },
  relatedFeedRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  relatedFeedTitle: {
    flex: 1,
  },
  relatedFeedImage: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  relatedFeedImageFallback: {
    width: 72,
    height: 72,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandSoft,
  },
  commentRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  commentReplyRow: {
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.brandSoft,
  },
  commentReplies: {
    marginTop: 8,
  },
  commentActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  replyTargetBar: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  textarea: {
    minHeight: 88,
    paddingTop: 12,
    paddingBottom: 12,
  },
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  segmentItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
  },
  segmentItemCompact: {
    flexBasis: '22%',
  },
  segmentItemActive: {
    backgroundColor: colors.brand,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 13,
    textAlign: 'center',
  },
  segmentTextActive: {
    color: '#fff',
  },
  smallButton: {
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  smallButtonDanger: {
    backgroundColor: '#fee2e2',
  },
  smallButtonDisabled: {
    opacity: 0.52,
  },
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  smallButtonDangerText: {
    color: colors.danger,
  },
  smallButtonDisabledText: {
    color: colors.textMuted,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.brandSoft,
  },
  pillText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 12,
  },
  infoLabel: {
    color: colors.textSecondary,
  },
  infoValue: {
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: 'right',
  },
  messageCard: {
    marginBottom: 10,
  },
  privateConversationsPage: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  privateConversationsList: {
    flex: 1,
  },
  privateConversationsContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  privateConversationsState: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  privateConversationsEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e2e8f0',
    color: '#94a3b8',
    fontSize: 22,
    lineHeight: 48,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  privateConversationsEmptyTitle: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '700',
  },
  privateConversationsEmptySubtitle: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 12,
  },
  privateConversationsLoadMore: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  conversationCardUnread: {
    borderWidth: 1,
    borderColor: 'rgba(0,188,125,0.16)',
  },
  conversationCardPressed: {
    backgroundColor: '#f8fafc',
  },
  conversationAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e5e7eb',
  },
  messageAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  conversationAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  messageAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  conversationAvatarSystem: {
    backgroundColor: '#f0fdf4',
  },
  conversationAvatarText: {
    color: '#15803d',
    fontSize: 15,
    fontWeight: '900',
  },
  messageAvatarText: {
    fontSize: 13,
  },
  conversationMain: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  conversationTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  conversationName: {
    flex: 1,
    color: '#1e293b',
    fontSize: 15,
    fontWeight: '700',
  },
  conversationTime: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  conversationPreview: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
  },
  conversationPreviewUnread: {
    color: '#334155',
    fontWeight: '700',
  },
  conversationRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 5,
    flexShrink: 0,
  },
  conversationBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
  },
  conversationBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  privateChatPage: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  privateChatList: {
    flex: 1,
  },
  privateChatContent: {
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  privateChatBlockBar: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#ffffff',
  },
  privateChatBlockButton: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fff7f7',
  },
  privateChatBlockButtonPressed: {
    opacity: 0.74,
  },
  privateChatBlockButtonText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
  },
  privateChatUnblockButton: {
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
  },
  privateChatUnblockButtonText: {
    color: '#059669',
  },
  privateChatBlockedHint: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  privateChatState: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateChatEmpty: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateChatEmptyText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  privateChatLoadMore: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  privateChatInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: '#ffffff',
  },
  privateChatDisabledBar: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: '#ffffff',
  },
  privateChatDisabledText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '800',
  },
  privateChatImageButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateChatImageButtonPressed: {
    backgroundColor: '#f3f4f6',
  },
  privateChatInput: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 12,
    color: '#111827',
    fontSize: 15,
    backgroundColor: '#f3f4f6',
  },
  privateChatSendButton: {
    minWidth: 50,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    backgroundColor: '#d1d5db',
  },
  privateChatSendButtonActive: {
    backgroundColor: '#00bc7d',
  },
  privateChatSendText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  messageRowSelf: {
    flexDirection: 'row-reverse',
  },
  messageAvatarPressable: {
    flexShrink: 0,
  },
  messageBubble: {
    maxWidth: '70%',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
  },
  messageBubbleSelf: {
    backgroundColor: '#00bc7d',
  },
  messageBubbleImage: {
    overflow: 'hidden',
    padding: 0,
    backgroundColor: 'transparent',
  },
  messageBubblePressed: {
    opacity: 0.76,
  },
  messageText: {
    color: '#111827',
    fontSize: 15,
    lineHeight: 21,
  },
  messageTextSelf: {
    color: '#fff',
  },
  messageImage: {
    width: 200,
    height: 200,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  messageTimeDivider: {
    alignSelf: 'center',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  messageTimeDividerText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
  },
  systemMessageWrap: {
    alignItems: 'center',
    marginBottom: 10,
  },
  systemMessageBubble: {
    maxWidth: '86%',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  systemMessageText: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  messageActionBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  messageActionSheet: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 16,
  },
  messageActionGroup: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  messageActionItem: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  messageActionPressed: {
    backgroundColor: '#f3f4f6',
  },
  messageActionText: {
    color: '#1f2937',
    fontSize: 15,
    fontWeight: '700',
  },
  messageActionDangerText: {
    color: '#ef4444',
  },
  messageActionDivider: {
    height: 1,
    marginHorizontal: 12,
    backgroundColor: '#e5e7eb',
  },
  messageActionCancel: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  messageActionCancelText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '700',
  },
})
