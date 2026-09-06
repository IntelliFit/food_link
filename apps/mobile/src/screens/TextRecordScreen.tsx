import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  type ActivityTiming,
  type AnalysisEngine,
  type DietGoal,
  type MealType,
  type MembershipStatus,
  inferDefaultMealTypeFromLocalTime,
} from '@food-link/core'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Coffee,
  Coins,
  Cookie,
  Crown,
  Database,
  Dumbbell,
  Moon,
  RotateCcw,
  Sparkles,
  Soup,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import {
  ANALYSIS_ENGINE_STORAGE_KEY,
  readSuggestRatioPreference,
} from '../utils/analysisPreferences'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'
import AsyncStorage from '@react-native-async-storage/async-storage'

const ANALYSIS_COST = 2
const COMMON_FOODS = ['米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包']

const ENGINE_OPTIONS: Array<{ value: AnalysisEngine; label: string; description: string; icon: LucideIcon }> = [
  { value: 'ai_direct', label: 'AI估算', description: '速度最快，完整理解描述', icon: Sparkles },
  { value: 'ai_then_db_exact', label: '标准库校准', description: '命中标准食物时更稳定', icon: Database },
  { value: 'db_candidates_ai', label: '数据库候选', description: 'AI复核候选，微量更细', icon: RotateCcw },
]

const MEAL_OPTIONS: Array<{ value: MealType; label: string; icon: LucideIcon }> = [
  { value: 'breakfast', label: '早餐', icon: Coffee },
  { value: 'morning_snack', label: '早加餐', icon: Cookie },
  { value: 'lunch', label: '午餐', icon: Soup },
  { value: 'afternoon_snack', label: '午加餐', icon: Utensils },
  { value: 'dinner', label: '晚餐', icon: Moon },
  { value: 'evening_snack', label: '晚加餐', icon: Cookie },
]

const DIET_GOAL_OPTIONS: Array<{ value: DietGoal; label: string }> = [
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无' },
]

const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string }> = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' },
]

type CreditSummary = {
  hasInfo: boolean
  max: number
  used: number
  remaining: number
}

function numeric(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function creditSummary(status: MembershipStatus | null): CreditSummary {
  if (!status) return { hasInfo: false, max: 0, used: 0, remaining: 0 }
  const rawMax = status.daily_credits_max ?? status.daily_limit
  const rawRemaining = status.total_credits_available ?? status.daily_credits_remaining ?? status.daily_remaining
  const max = numeric(rawMax)
  const remaining = numeric(rawRemaining)
  const explicitUsed = numeric(status.daily_credits_used)
  return {
    hasInfo: max !== null || remaining !== null || explicitUsed !== null,
    max: Math.max(0, max ?? 0),
    remaining: Math.max(0, remaining ?? 0),
    used: Math.max(0, explicitUsed ?? (max !== null && remaining !== null ? max - remaining : 0)),
  }
}

function normalizeEngine(value: unknown): AnalysisEngine {
  if (value === 'ai_direct' || value === 'ai_then_db_exact' || value === 'db_candidates_ai') return value
  if (value === 'legacy_direct') return 'ai_direct'
  if (value === 'db_first') return 'db_candidates_ai'
  return 'ai_direct'
}

function normalizeDate(value?: string): string {
  const candidate = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return todayKey()
  const [year, month, day] = candidate.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return todayKey()
  return candidate
}

function formatTargetDate(date: string): string {
  if (date === todayKey()) return '今天'
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function isQuotaError(error: unknown): boolean {
  const status = Number((error as { status?: unknown; statusCode?: unknown })?.status ?? (error as { statusCode?: unknown })?.statusCode)
  const message = userFacingErrorMessage(error, '')
  return status === 402 || status === 429 || ['上限', '次数已达', '明日再试', '积分不足'].some((keyword) => message.includes(keyword))
}

export function TextRecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'TextRecord'>>()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const { width, fontScale } = useWindowDimensions()
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const compact = width < 390 || fontScale >= 1.2
  const date = useMemo(() => normalizeDate(route.params?.date), [route.params?.date])
  const isBackfill = date !== todayKey()
  const foodInputRef = useRef<TextInput>(null)
  const allowLeaveRef = useRef(false)
  const [foodText, setFoodText] = useState('')
  const [foodAmount, setFoodAmount] = useState('')
  const [foodTouched, setFoodTouched] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const [dietGoal, setDietGoal] = useState<DietGoal>('none')
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [analysisEngine, setAnalysisEngine] = useState<AnalysisEngine>('ai_direct')
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const [targetMembership, setTargetMembership] = useState<MembershipStatus | null>(null)
  const [membershipLoading, setMembershipLoading] = useState(true)
  const [membershipError, setMembershipError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    navigation.setOptions({
      title: '文字记录',
      headerStyle: { backgroundColor: palette.surface },
      headerTintColor: palette.text,
      headerShadowVisible: false,
    })
  }, [navigation, palette.surface, palette.text])

  useEffect(() => {
    let active = true
    Promise.all([
      AsyncStorage.getItem(ANALYSIS_ENGINE_STORAGE_KEY),
      route.params?.mealType ? Promise.resolve(null) : apiClient.getRecommendedMealType(date).catch(() => null),
    ]).then(([storedEngine, recommended]) => {
      if (!active) return
      setAnalysisEngine(normalizeEngine(storedEngine))
      if (recommended?.meal_type) setMealType(recommended.meal_type)
    }).catch(() => undefined)
    return () => { active = false }
  }, [date, route.params?.mealType])

  const loadMembership = useCallback(async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true)
    else setMembershipLoading(true)
    setMembershipError('')
    const [todayResult, targetResult] = await Promise.allSettled([
      apiClient.getMyMembership(),
      isBackfill ? apiClient.getMyMembership(date) : Promise.resolve(null),
    ])
    if (todayResult.status === 'fulfilled') setMembership(todayResult.value)
    if (targetResult.status === 'fulfilled') setTargetMembership(targetResult.value)
    if (todayResult.status === 'rejected' || targetResult.status === 'rejected') {
      const reason = todayResult.status === 'rejected' ? todayResult.reason : targetResult.status === 'rejected' ? targetResult.reason : null
      setMembershipError(userFacingErrorMessage(reason, '积分状态暂时无法读取'))
    }
    setMembershipLoading(false)
    setRefreshing(false)
  }, [date, isBackfill])

  useFocusEffect(useCallback(() => {
    void loadMembership(false)
  }, [loadMembership]))

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowLeaveRef.current) return
    if (submitting) {
      event.preventDefault()
      return
    }
    if (!dirty) return
    event.preventDefault()
    void dialog.confirm({
      title: '放弃这次文字记录？',
      message: '已填写的食物、份量和选项不会保留。',
      kind: 'warning',
      confirmText: '放弃记录',
      cancelText: '继续填写',
    }).then((confirmed) => {
      if (!confirmed) return
      allowLeaveRef.current = true
      navigation.dispatch(event.data.action)
    })
  }), [dialog, dirty, navigation, submitting])

  const currentCredits = useMemo(() => creditSummary(membership), [membership])
  const targetCredits = useMemo(() => creditSummary(targetMembership), [targetMembership])
  const backfillUsesToday = isBackfill && targetCredits.hasInfo && targetCredits.remaining < ANALYSIS_COST
  const effectiveCredits = isBackfill && targetCredits.hasInfo && targetCredits.remaining >= ANALYSIS_COST ? targetCredits : currentCredits
  const quotaExhausted = effectiveCredits.hasInfo && effectiveCredits.remaining < ANALYSIS_COST
  const quotaWarn = effectiveCredits.hasInfo && !quotaExhausted && effectiveCredits.remaining <= ANALYSIS_COST

  const quotaText = useMemo(() => {
    if (membershipError) return '积分状态读取失败，点此重试'
    if (isBackfill && targetCredits.hasInfo) {
      if (targetCredits.remaining >= ANALYSIS_COST) {
        return `${formatTargetDate(date)} · 已用 ${targetCredits.used}/${targetCredits.max} 积分 · 剩余 ${targetCredits.remaining}${!membership?.is_pro ? '  →开通会员享更高额度' : ''}`
      }
      if (currentCredits.hasInfo && currentCredits.remaining >= ANALYSIS_COST) {
        return `${formatTargetDate(date)}积分不足 · 将扣除今日积分 · 今日剩余 ${currentCredits.remaining}`
      }
      return `积分不足，文字分析需 ${ANALYSIS_COST} 积分 · 当前可用 ${effectiveCredits.remaining}`
    }
    if (currentCredits.hasInfo) {
      if (quotaExhausted) return `积分不足，文字分析需 ${ANALYSIS_COST} 积分 · 当前可用 ${currentCredits.remaining}`
      if (currentCredits.max > 0) return `今日已用 ${currentCredits.used}/${currentCredits.max} 积分 · 剩余 ${currentCredits.remaining}${!membership?.is_pro ? '  →开通会员享更高额度' : ''}`
      return `当前可用 ${currentCredits.remaining} 积分 · 文字分析消耗 ${ANALYSIS_COST} 积分${!membership?.is_pro ? '  →开通会员享更高额度' : ''}`
    }
    return `文字分析消耗 ${ANALYSIS_COST} 积分`
  }, [currentCredits, date, effectiveCredits.remaining, isBackfill, membership?.is_pro, membershipError, quotaExhausted, targetCredits])

  const showCreditShortage = useCallback(async (message = quotaText) => {
    const openMembership = await dialog.confirm({
      title: '积分不足',
      message,
      kind: 'warning',
      confirmText: '查看会员',
      cancelText: '稍后再说',
    })
    if (openMembership) navigation.navigate('MembershipCenter')
  }, [dialog, navigation, quotaText])

  const selectEngine = useCallback((value: AnalysisEngine) => {
    setAnalysisEngine(value)
    setDirty(true)
    void AsyncStorage.setItem(ANALYSIS_ENGINE_STORAGE_KEY, value)
  }, [])

  const submit = useCallback(async () => {
    const trimmed = foodText.trim()
    setFoodTouched(true)
    if (!trimmed) {
      foodInputRef.current?.focus()
      AccessibilityInfo.announceForAccessibility('请输入食物描述')
      return
    }
    if (quotaExhausted) {
      await showCreditShortage()
      return
    }
    setSubmitting(true)
    try {
      try {
        const targetStatus = await apiClient.getMyMembership(date)
        if (isBackfill) setTargetMembership(targetStatus)
        else setMembership(targetStatus)
        const targetSummary = creditSummary(targetStatus)
        let canSubmit = !targetSummary.hasInfo || targetSummary.remaining >= ANALYSIS_COST
        let blockStatus = targetStatus
        if (!canSubmit && isBackfill) {
          const todayStatus = await apiClient.getMyMembership()
          setMembership(todayStatus)
          const todaySummary = creditSummary(todayStatus)
          canSubmit = !todaySummary.hasInfo || todaySummary.remaining >= ANALYSIS_COST
          blockStatus = todayStatus
        }
        if (!canSubmit) {
          const blockedCredits = creditSummary(blockStatus)
          await showCreditShortage(`积分不足，文字分析需 ${ANALYSIS_COST} 积分 · 当前可用 ${blockedCredits.remaining}`)
          return
        }
      } catch {
        // 与小程序一致：额度复查失败时仍由提交接口做最终门禁。
      }

      const inputText = foodAmount.trim() ? `${trimmed}\n数量：${foodAmount.trim()}` : trimmed
      const suggestRatioEnabled = await readSuggestRatioPreference().catch(() => true)
      const result = await apiClient.submitTextTask({
        text: inputText,
        mealType,
        date,
        dietGoal,
        activityTiming,
        analysisEngine,
        suggestRatioEnabled,
        preciseMicronutrients: true,
      })
      allowLeaveRef.current = true
      navigation.navigate('AnalyzeLoading', { taskId: result.task_id, mealType, date, taskType: 'food_text' })
    } catch (error) {
      if (isQuotaError(error)) await showCreditShortage(userFacingErrorMessage(error))
      else await dialog.alert('提交失败', userFacingErrorMessage(error, '请稍后重试'), 'danger')
    } finally {
      setSubmitting(false)
    }
  }, [activityTiming, analysisEngine, date, dialog, dietGoal, foodAmount, foodText, isBackfill, mealType, navigation, quotaExhausted, showCreditShortage])

  const foodError = foodTouched && !foodText.trim() ? '请输入这一餐吃了什么' : ''

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={membershipLoading ? '正在读取积分状态' : quotaText}
        accessibilityHint={membershipError ? '双击重新读取' : !membership?.is_pro && !quotaExhausted ? '双击查看会员权益' : undefined}
        disabled={membershipLoading || (!membershipError && (Boolean(membership?.is_pro) || quotaExhausted))}
        style={({ pressed }) => [
          styles.quotaBar,
          quotaWarn && styles.quotaBarWarning,
          quotaExhausted && styles.quotaBarDanger,
          membershipError && styles.quotaBarError,
          pressed && styles.pressed,
        ]}
        onPress={() => {
          if (membershipError) void loadMembership(false)
          else if (!membership?.is_pro && !quotaExhausted) navigation.navigate('MembershipCenter')
        }}
      >
        {membershipLoading ? (
          <ActivityIndicator size="small" color={palette.brandStrong} />
        ) : (
          <>
            {membershipError ? <AlertTriangle size={18} color={palette.warning} /> : quotaExhausted ? <AlertTriangle size={18} color={palette.danger} /> : <Coins size={18} color={palette.brandStrong} />}
            <Text style={[styles.quotaText, quotaExhausted && styles.quotaTextDanger]}>{quotaText}</Text>
            {!membershipError && !membership?.is_pro && !quotaExhausted ? <Crown size={17} color={palette.brandStrong} /> : null}
          </>
        )}
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 116 + Math.max(insets.bottom, 10) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadMembership(true)} tintColor={palette.brand} colors={[palette.brand]} />}
      >
        {isBackfill ? (
          <View style={styles.dateNotice} accessibilityLabel={`正在补记${formatTargetDate(date)}的饮食`}>
            <CalendarDays size={19} color={palette.brandStrong} />
            <View style={styles.dateNoticeCopy}>
              <Text style={styles.dateNoticeTitle}>补记 {formatTargetDate(date)} 的饮食</Text>
              <Text style={styles.dateNoticeText}>{backfillUsesToday ? '目标日期积分不足时会按规则使用今日积分。' : '分析结果会保存到所选日期。'}</Text>
            </View>
          </View>
        ) : null}

        <Section title="描述您的饮食" styles={styles}>
          <View style={[styles.inputCard, foodError && styles.inputCardError]}>
            <TextInput
              ref={foodInputRef}
              value={foodText}
              onChangeText={(value) => { setFoodText(value); setDirty(true); if (value.trim()) setFoodTouched(false) }}
              onBlur={() => setFoodTouched(true)}
              multiline
              maxLength={500}
              textAlignVertical="top"
              style={styles.foodInput}
              placeholder={'今天吃了什么？例如：\n· 一碗红烧牛肉面\n· 一个苹果'}
              placeholderTextColor={palette.placeholder}
              accessibilityLabel="食物描述"
              accessibilityHint="最多五百个字符"
            />
            <Text style={styles.charCount}>{foodText.length}/500</Text>
          </View>
          {foodError ? <Text style={styles.fieldError} accessibilityRole="alert">{foodError}</Text> : null}
          <View style={styles.quickArea}>
            <Text style={styles.quickLabel}>常用</Text>
            <View style={styles.quickWrap}>
              {COMMON_FOODS.map((food) => (
                <Pressable
                  key={food}
                  accessibilityRole="button"
                  accessibilityLabel={`添加${food}`}
                  style={({ pressed }) => [styles.quickTag, pressed && styles.pressed]}
                  onPress={() => { setFoodText((current) => current.trim() ? `${current.trim()}、${food}` : food); setFoodTouched(false); setDirty(true) }}
                >
                  <Text style={styles.quickTagText}>{food}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Section>

        <Section title="补充份量（可选）" styles={styles}>
          <View style={styles.inputCard}>
            <TextInput
              value={foodAmount}
              onChangeText={(value) => { setFoodAmount(value); setDirty(true) }}
              multiline
              maxLength={200}
              textAlignVertical="top"
              style={styles.amountInput}
              placeholder="例如：200g；或一碗、半份"
              placeholderTextColor={palette.placeholder}
              accessibilityLabel="补充份量"
              accessibilityHint="可选，最多二百个字符"
            />
            <Text style={styles.charCount}>{foodAmount.length}/200</Text>
          </View>
        </Section>

        <Section title="营养计算方式" styles={styles}>
          <View style={[styles.engineGroup, compact && styles.engineGroupCompact]} accessibilityRole="radiogroup">
            {ENGINE_OPTIONS.map((option) => {
              const active = option.value === analysisEngine
              const Icon = option.icon
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={`${option.label}，${option.description}`}
                  style={({ pressed }) => [styles.engineOption, compact && styles.engineOptionCompact, active && styles.engineOptionActive, pressed && styles.pressed]}
                  onPress={() => selectEngine(option.value)}
                >
                  <View style={[styles.engineIcon, active && styles.engineIconActive]}><Icon size={18} color={active ? palette.brandStrong : palette.textMuted} /></View>
                  <Text style={[styles.engineLabel, active && styles.selectedText]}>{option.label}</Text>
                  <Text style={styles.engineDescription}>{option.description}</Text>
                  {active ? <View style={styles.radioCheck}><Check size={12} color={palette.onBrand} strokeWidth={3} /></View> : null}
                </Pressable>
              )
            })}
          </View>
          <Text style={styles.helperText}>默认使用速度最快的 AI 估算；另外两种数据库方式会慢一些，但命中兼容数据时结果更稳定，微量元素通常也更准确。</Text>
        </Section>

        <Section title="选择餐次" styles={styles}>
          <View style={styles.mealGrid} accessibilityRole="radiogroup">
            {MEAL_OPTIONS.map((option) => {
              const active = option.value === mealType
              const Icon = option.icon
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={option.label}
                  style={({ pressed }) => [styles.mealOption, active && styles.mealOptionActive, pressed && styles.pressed]}
                  onPress={() => { setMealType(option.value); setDirty(true) }}
                >
                  <Icon size={21} color={active ? palette.brandStrong : palette.textMuted} strokeWidth={2.2} />
                  <Text style={[styles.mealLabel, active && styles.selectedText]}>{option.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </Section>

        <ChoiceSection
          title="饮食目标"
          options={DIET_GOAL_OPTIONS}
          value={dietGoal}
          onChange={(value) => { setDietGoal(value); setDirty(true) }}
          styles={styles}
          palette={palette}
        />
        <ChoiceSection
          title="运动时机"
          options={ACTIVITY_TIMING_OPTIONS}
          value={activityTiming}
          onChange={(value) => { setActivityTiming(value); setDirty(true) }}
          styles={styles}
          palette={palette}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 10) + 10 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={quotaExhausted ? '积分不足，暂不可分析' : `开始分析，消耗${ANALYSIS_COST}积分`}
          accessibilityState={{ disabled: submitting || !foodText.trim() || quotaExhausted, busy: submitting }}
          disabled={submitting || !foodText.trim() || quotaExhausted}
          style={({ pressed }) => [styles.submitButton, (!foodText.trim() || quotaExhausted) && styles.submitButtonDisabled, pressed && !submitting && styles.pressed]}
          onPress={() => void submit()}
        >
          {submitting ? <ActivityIndicator color={palette.onBrand} accessibilityLabel="正在提交文字分析" /> : (
            <Text style={[styles.submitText, (!foodText.trim() || quotaExhausted) && styles.submitTextDisabled]}>
              {quotaExhausted ? '积分不足，暂不可分析' : `开始分析 · ${ANALYSIS_COST} 积分`}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

function Section({ title, children, styles }: { title: string; children: ReactNode; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function ChoiceSection<T extends string>({
  title,
  options,
  value,
  onChange,
  styles,
  palette,
}: {
  title: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  styles: ReturnType<typeof createStyles>
  palette: Palette
}) {
  return (
    <Section title={title} styles={styles}>
      <View style={styles.choiceWrap} accessibilityRole="radiogroup">
        {options.map((option) => {
          const active = option.value === value
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${title}：${option.label}`}
              style={({ pressed }) => [styles.choiceOption, active && styles.choiceOptionActive, pressed && styles.pressed]}
              onPress={() => onChange(option.value)}
            >
              <View style={[styles.choiceRadio, active && styles.choiceRadioActive]}>
                {active ? <View style={[styles.choiceRadioDot, { backgroundColor: palette.brandStrong }]} /> : null}
              </View>
              <Text style={[styles.choiceText, active && styles.selectedText]}>{option.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </Section>
  )
}

type Palette = typeof lightPalette

const lightPalette = {
  page: '#f7faf8',
  surface: '#ffffff',
  surfaceMuted: '#f2f7f4',
  border: '#dce7e1',
  borderStrong: '#b9d5c8',
  text: '#15231d',
  textSecondary: '#53655d',
  textMuted: '#7f9088',
  placeholder: '#96a49e',
  brand: '#00ad73',
  brandStrong: '#087653',
  brandSoft: '#e7f8f1',
  onBrand: '#ffffff',
  warning: '#b45309',
  warningSoft: '#fff7e8',
  danger: '#dc2626',
  dangerSoft: '#fff1f2',
  footer: '#ffffff',
  shadow: '#10241c',
}

const darkPalette: Palette = {
  page: '#111716',
  surface: '#1e2624',
  surfaceMuted: '#27322f',
  border: 'rgba(214,226,220,0.15)',
  borderStrong: '#456558',
  text: '#f2f7f4',
  textSecondary: 'rgba(226,235,230,0.75)',
  textMuted: 'rgba(214,226,220,0.55)',
  placeholder: 'rgba(214,226,220,0.40)',
  brand: '#4a9d7d',
  brandStrong: '#6ee7b7',
  brandSoft: '#18332a',
  onBrand: '#f4fbf8',
  warning: '#fdba74',
  warningSoft: 'rgba(154,52,18,0.22)',
  danger: '#f87171',
  dangerSoft: 'rgba(127,29,29,0.28)',
  footer: '#18201e',
  shadow: '#000000',
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 16, gap: 18 },
    quotaBar: {
      minHeight: 48,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      backgroundColor: palette.brandSoft,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
    },
    quotaBarWarning: { backgroundColor: palette.warningSoft },
    quotaBarDanger: { backgroundColor: palette.dangerSoft },
    quotaBarError: { backgroundColor: palette.warningSoft },
    quotaText: { flexShrink: 1, color: palette.brandStrong, fontSize: 13, lineHeight: 19, fontWeight: '700', textAlign: 'center' },
    quotaTextDanger: { color: palette.danger },
    dateNotice: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: palette.borderStrong, backgroundColor: palette.brandSoft },
    dateNoticeCopy: { flex: 1, gap: 2 },
    dateNoticeTitle: { color: palette.brandStrong, fontSize: 15, lineHeight: 21, fontWeight: '800' },
    dateNoticeText: { color: palette.textSecondary, fontSize: 12, lineHeight: 18 },
    section: { gap: 10 },
    sectionTitle: { color: palette.text, fontSize: 17, lineHeight: 24, fontWeight: '800', letterSpacing: 0.1 },
    inputCard: { borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, overflow: 'hidden' },
    inputCardError: { borderColor: palette.danger, borderWidth: 1.5 },
    foodInput: { minHeight: 138, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 34, color: palette.text, fontSize: 16, lineHeight: 24 },
    amountInput: { minHeight: 88, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 30, color: palette.text, fontSize: 15, lineHeight: 22 },
    charCount: { position: 'absolute', right: 14, bottom: 10, color: palette.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
    fieldError: { color: palette.danger, fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: -3 },
    quickArea: { gap: 8 },
    quickLabel: { color: palette.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    quickTag: { minHeight: 48, minWidth: 64, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
    quickTagText: { color: palette.textSecondary, fontSize: 14, fontWeight: '700' },
    engineGroup: { flexDirection: 'row', gap: 8 },
    engineGroupCompact: { flexDirection: 'column' },
    engineOption: { flex: 1, minHeight: 128, paddingHorizontal: 11, paddingVertical: 13, alignItems: 'center', borderRadius: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, gap: 5 },
    engineOptionCompact: { flex: 0, width: '100%', minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
    engineOptionActive: { borderColor: palette.brand, backgroundColor: palette.brandSoft, borderWidth: 1.5 },
    engineIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceMuted },
    engineIconActive: { backgroundColor: palette.surface },
    engineLabel: { color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
    engineDescription: { flexShrink: 1, color: palette.textSecondary, fontSize: 11, lineHeight: 16, textAlign: 'center' },
    radioCheck: { position: 'absolute', right: 8, top: 8, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    helperText: { color: palette.textMuted, fontSize: 12, lineHeight: 19 },
    mealGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    mealOption: { width: '31.7%', minHeight: 72, borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 5, paddingVertical: 10 },
    mealOptionActive: { borderColor: palette.brand, backgroundColor: palette.brandSoft, borderWidth: 1.5 },
    mealLabel: { color: palette.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
    choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    choiceOption: { width: '48.8%', minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
    choiceOptionActive: { borderColor: palette.brand, backgroundColor: palette.brandSoft, borderWidth: 1.5 },
    choiceRadio: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: palette.textMuted },
    choiceRadioActive: { borderColor: palette.brandStrong },
    choiceRadioDot: { width: 9, height: 9, borderRadius: 5 },
    choiceText: { flexShrink: 1, color: palette.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700' },
    selectedText: { color: palette.brandStrong },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: palette.footer, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: -3 }, elevation: 10 },
    submitButton: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: palette.brand },
    submitButtonDisabled: { backgroundColor: palette.surfaceMuted, borderWidth: 1, borderColor: palette.border },
    submitText: { color: palette.onBrand, fontSize: 16, lineHeight: 22, fontWeight: '800' },
    submitTextDisabled: { color: palette.textMuted },
    pressed: { opacity: 0.72 },
  })
}
