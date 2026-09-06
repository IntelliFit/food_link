import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Svg, { Circle } from 'react-native-svg'
import type { HealthFocusItem } from '@food-link/api-client'
import {
  normalizeInsightText,
  type BodyMetricsSummary,
  type RiskCard,
  type StatsInsightResult,
  type StatsRange,
  type StatsSummary,
} from '@food-link/core'
import {
  BrainCircuit,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Flame,
  GlassWater,
  HeartPulse,
  LogIn,
  Scale,
  Sparkles,
  Target,
  TrendingUp,
  Utensils,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import { InsightMarkdownView } from '../components/InsightMarkdownView'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useAuth } from '../providers/AuthProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors, compactFont, radius } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type AnalysisPanel = 'health' | 'nutrition' | 'structure'

type MealKey = 'breakfast' | 'morning_snack' | 'lunch' | 'afternoon_snack' | 'dinner' | 'evening_snack'

type ExtendedRiskCard = RiskCard & {
  is_custom?: boolean
  needs_refresh?: boolean
  focus_label?: string
}

type RiskOption = {
  key: string
  title: string
  short: string
  is_custom?: boolean
}

type CustomFocusMeta = {
  max_focuses: number
  generate_cost: number
  daily_limit: number
  used_today: number
  remaining_today: number
}

type ExtendedHealthIndex = NonNullable<StatsSummary['health_index']> & {
  custom_risk_cards?: ExtendedRiskCard[]
  all_risk_options?: RiskOption[]
  custom_focus_meta?: CustomFocusMeta
}

type ExtendedStatsSummary = Omit<StatsSummary, 'health_index'> & {
  health_index?: ExtendedHealthIndex
}

const DEFAULT_RISK_KEYS = ['hypertension', 'diabetes', 'cardio', 'weight', 'micronutrient']
const RISK_PREF_STORAGE_KEY = 'stats_risk_focus_keys'

const analysisTabs: Array<{ key: AnalysisPanel; label: string }> = [
  { key: 'health', label: '健康指数' },
  { key: 'nutrition', label: 'AI分析' },
  { key: 'structure', label: '热量分布' },
]

const rangeOptions: Array<{ key: StatsRange; label: string; helper: string }> = [
  { key: 'week', label: '近一周', helper: '最近 7 天' },
  { key: 'month', label: '近一个月', helper: '最近 30 天' },
]

const mealOrder: MealKey[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']

const mealNames: Record<MealKey, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
}

const mealColors: Record<MealKey, string> = {
  breakfast: '#5cb896',
  morning_snack: '#5cb896',
  lunch: '#5c9ed4',
  afternoon_snack: '#5c9ed4',
  dinner: '#f0985c',
  evening_snack: '#f0985c',
}

type StatsPalette = {
  page: string
  topWash: string
  surface: string
  surfaceRaised: string
  surfaceMuted: string
  border: string
  text: string
  textSecondary: string
  textMuted: string
  brand: string
  brandText: string
  brandSoft: string
  blue: string
  blueSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  chartTrack: string
  scrim: string
  shadow: string
}

const statsLightPalette: StatsPalette = {
  page: colors.background,
  topWash: 'rgba(92,184,150,0.08)',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceMuted: '#f8fafc',
  border: 'rgba(148,163,184,0.18)',
  text: '#1e2939',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  brand: colors.brand,
  brandText: colors.brandDark,
  brandSoft: colors.brandSoft,
  blue: '#3d6b94',
  blueSoft: 'rgba(92,158,212,0.12)',
  warning: '#a6602c',
  warningSoft: 'rgba(245,196,154,0.35)',
  danger: '#b45353',
  dangerSoft: '#fef2f2',
  chartTrack: '#eef2f6',
  scrim: 'rgba(0,0,0,0.52)',
  shadow: '#0f172a',
}

const statsDarkPalette: StatsPalette = {
  page: '#0d1312',
  topWash: 'rgba(92,184,150,0.05)',
  surface: '#181f1d',
  surfaceRaised: '#1d2623',
  surfaceMuted: '#202a27',
  border: 'rgba(255,255,255,0.10)',
  text: '#f2f7f4',
  textSecondary: '#aab8b2',
  textMuted: '#84958e',
  brand: '#7dd3b0',
  brandText: '#9fe3c5',
  brandSoft: 'rgba(92,184,150,0.14)',
  blue: '#93c5fd',
  blueSoft: 'rgba(92,158,212,0.14)',
  warning: '#f6c177',
  warningSoft: 'rgba(240,152,92,0.14)',
  danger: '#fda4af',
  dangerSoft: 'rgba(239,68,68,0.12)',
  chartTrack: 'rgba(255,255,255,0.10)',
  scrim: 'rgba(0,0,0,0.64)',
  shadow: '#000000',
}

function insightContent(result: StatsInsightResult): string {
  return normalizeInsightText(String(result.analysis_summary || result.content || ''))
}

export function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const { isDark, palette, styles } = useStatsTheme()
  const { isAuthenticated } = useAuth()
  const [range, setRange] = useState<StatsRange>('week')
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false)
  const [panel, setPanel] = useState<AnalysisPanel>('health')
  const [summary, setSummary] = useState<ExtendedStatsSummary | null>(null)
  const [loading, setLoading] = useState(isAuthenticated)
  const [loadError, setLoadError] = useState('')
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightError, setInsightError] = useState('')
  const [selectedRisk, setSelectedRisk] = useState<ExtendedRiskCard | null>(null)
  const [riskPickerOpen, setRiskPickerOpen] = useState(false)
  const [selectedRiskKeys, setSelectedRiskKeys] = useState<string[]>(DEFAULT_RISK_KEYS)
  const [riskPreferencesLoaded, setRiskPreferencesLoaded] = useState(false)
  const [customFocusInput, setCustomFocusInput] = useState('')
  const [customFocusAdding, setCustomFocusAdding] = useState(false)
  const [customFocusRefreshingKey, setCustomFocusRefreshingKey] = useState<string | null>(null)
  const [customFocusRemovingKey, setCustomFocusRemovingKey] = useState<string | null>(null)
  const [customFocusError, setCustomFocusError] = useState('')
  const [customFocusNotice, setCustomFocusNotice] = useState('')

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setSummary(null)
      setLoading(false)
      setLoadError('')
      setInsightError('')
      return
    }
    setLoading(true)
    setLoadError('')
    setInsightError('')
    try {
      setSummary(await apiClient.getStatsSummary(range))
    } catch (error) {
      setLoadError(userFacingErrorMessage(error, '饮食统计加载失败，请稍后重试。'))
    } finally {
      setLoading(false)
    }
  }, [dialog, isAuthenticated, range])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let active = true
    AsyncStorage.getItem(RISK_PREF_STORAGE_KEY)
      .then((raw) => {
        if (!active || !raw) return
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return
        const cleaned = parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        if (cleaned.length > 0) setSelectedRiskKeys(Array.from(new Set([...DEFAULT_RISK_KEYS, ...cleaned])))
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setRiskPreferencesLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!riskPreferencesLoaded) return
    void AsyncStorage.setItem(RISK_PREF_STORAGE_KEY, JSON.stringify(selectedRiskKeys)).catch(() => undefined)
  }, [riskPreferencesLoaded, selectedRiskKeys])

  const health = summary?.health_index
  const riskCards = useMemo(() => (health?.risk_cards || []) as ExtendedRiskCard[], [health?.risk_cards])
  const customRiskCards = useMemo(() => health?.custom_risk_cards || [], [health?.custom_risk_cards])
  const allDisplayRiskCards = useMemo(
    () => [...riskCards, ...customRiskCards],
    [customRiskCards, riskCards],
  )
  const allRiskOptions = useMemo(() => mergeRiskOptions(health, riskCards, customRiskCards), [customRiskCards, health, riskCards])
  const orderedRiskOptions = useMemo(() => {
    const selected = selectedRiskKeys
      .map((key) => allRiskOptions.find((option) => option.key === key))
      .filter((option): option is RiskOption => Boolean(option))
    return [...selected, ...allRiskOptions.filter((option) => !selectedRiskKeys.includes(option.key))]
  }, [allRiskOptions, selectedRiskKeys])
  const visibleRiskCards = useMemo(() => selectedRiskKeys
    .map((key) => {
      const card = allDisplayRiskCards.find((item) => item.key === key)
      if (card) return card
      const option = allRiskOptions.find((item) => item.key === key)
      return option?.is_custom ? pendingCustomRiskCardFromOption(option) : null
    })
    .filter((card): card is ExtendedRiskCard => Boolean(card)), [allDisplayRiskCards, allRiskOptions, selectedRiskKeys])
  const customFocusMeta = health?.custom_focus_meta
  const selectedRiskItems = useMemo(() => selectedRiskKeys
    .map((key) => allRiskOptions.find((option) => option.key === key))
    .filter((option): option is RiskOption => Boolean(option)), [allRiskOptions, selectedRiskKeys])
  const selectedRiskSummary = selectedRiskItems.map((item) => item.short).join('、')
  const insightText = useMemo(() => normalizeInsightText(summary?.analysis_summary || ''), [summary?.analysis_summary])
  const recordedDays = Math.max(0, Number(summary?.recorded_days ?? summary?.streak_days ?? 0))
  const hasEnoughHealthData = Boolean(health?.has_enough_data)
  const hasAnyDietData = recordedDays > 0 || Number(summary?.total_calories || 0) > 0 || (summary?.daily_calories || []).some((item) => Number(item.calories) > 0)
  const healthScore = Math.round(health?.overall_score ?? averageRiskScore(riskCards) ?? 0)
  const projectedScore = Math.round(health?.projected_score ?? Math.min(100, healthScore + averageRiskDelta(riskCards)))
  const hasVisibleCustomFocus = visibleRiskCards.some((card) => card.is_custom)
  const focusOverviewCopy = hasVisibleCustomFocus
    ? scoreToFocusOverview(healthScore, allDisplayRiskCards.length > 0, true)
    : (health?.overview_copy || scoreToFocusOverview(healthScore, riskCards.length > 0, false))
  const signalChips = [
    { label: '记录天数', value: `${recordedDays} 天` },
    { label: '日均摄入', value: `${Math.round(summary?.avg_calories_per_day || 0)} kcal` },
    { label: '摄入差额', value: signedKcal(summary?.cal_surplus_deficit || 0) },
    { label: '连续记录', value: `${summary?.streak_days || 0} 天` },
  ]
  const insightMeta = insightStatusText(summary)

  const generateInsight = useCallback(async () => {
    if (insightLoading) return
    if (recordedDays <= 0) {
      setInsightError('还没有饮食记录，先记录至少一餐后再生成 AI 风险解读。')
      return
    }

    setInsightLoading(true)
    setInsightError('')
    try {
      const result = await apiClient.generateStatsInsight(range)
      const content = insightContent(result)
      if (!content) throw new Error('本次没有生成有效解读，请稍后重试。')
      setSummary((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          analysis_summary: content,
          analysis_summary_generated_date: result.analysis_summary_generated_date || result.generated_date || prev.analysis_summary_generated_date,
          analysis_summary_needs_refresh: Boolean(result.analysis_summary_needs_refresh ?? result.needs_refresh),
          analysis_summary_daily_limit: result.analysis_summary_daily_limit ?? result.daily_limit ?? prev.analysis_summary_daily_limit,
          analysis_summary_used_today: result.analysis_summary_used_today ?? result.used_today ?? prev.analysis_summary_used_today,
        }
      })
      void dialog.alert('已更新', 'AI 风险解读已生成', 'success')
    } catch (error) {
      const message = userFacingErrorMessage(error, 'AI 风险解读生成失败')
      setInsightError(message)
      void dialog.alert('生成失败', message, 'danger')
    } finally {
      setInsightLoading(false)
    }
  }, [dialog, insightLoading, range, recordedDays])

  const mergeCustomFocusCard = useCallback((card: ExtendedRiskCard) => {
    setSummary((previous) => {
      if (!previous?.health_index) return previous
      const existingCards = previous.health_index.custom_risk_cards || []
      const existingOptions = previous.health_index.all_risk_options || []
      const nextOption = customRiskCardToOption(card)
      return {
        ...previous,
        health_index: {
          ...previous.health_index,
          custom_risk_cards: [card, ...existingCards.filter((item) => item.key !== card.key)],
          all_risk_options: existingOptions.some((item) => item.key === card.key)
            ? existingOptions.map((item) => item.key === card.key ? { ...item, ...nextOption } : item)
            : [...existingOptions, nextOption],
        },
      }
    })
  }, [])

  const mergeCustomFocusOptions = useCallback((focuses: HealthFocusItem[]) => {
    setSummary((previous) => {
      if (!previous?.health_index) return previous
      const nextOptions = [...(previous.health_index.all_risk_options || [])]
      focuses.forEach((focus) => {
        if (!focus.id || !focus.label) return
        const option = customFocusToOption(focus)
        const index = nextOptions.findIndex((item) => item.key === option.key)
        if (index >= 0) nextOptions[index] = { ...nextOptions[index], ...option }
        else nextOptions.push(option)
      })
      return {
        ...previous,
        health_index: {
          ...previous.health_index,
          all_risk_options: nextOptions,
        },
      }
    })
  }, [])

  const applyGeneratedFocusMeta = useCallback((result: {
    custom_focus_daily_limit?: number
    custom_focus_used_today?: number
    custom_focus_remaining_today?: number
  }) => {
    setSummary((previous) => {
      if (!previous?.health_index || !previous.health_index.custom_focus_meta) return previous
      const current = previous.health_index.custom_focus_meta
      return {
        ...previous,
        health_index: {
          ...previous.health_index,
          custom_focus_meta: {
            ...current,
            daily_limit: result.custom_focus_daily_limit ?? current.daily_limit,
            used_today: result.custom_focus_used_today ?? current.used_today,
            remaining_today: result.custom_focus_remaining_today ?? current.remaining_today,
          },
        },
      }
    })
  }, [])

  const toggleRiskPreference = useCallback((riskKey: string) => {
    setSelectedRiskKeys((previous) => {
      const exists = previous.includes(riskKey)
      const next = exists ? previous.filter((item) => item !== riskKey) : [...previous, riskKey]
      return next.length > 0 ? next : previous
    })
  }, [])

  const handleAddCustomFocus = useCallback(async () => {
    const label = customFocusInput.trim()
    if (!label || customFocusAdding) return
    if (!health?.has_enough_data) {
      setCustomFocusError('连续记录两天后才能添加 AI 关注。')
      return
    }
    setCustomFocusAdding(true)
    setCustomFocusError('')
    setCustomFocusNotice('')
    try {
      const added = await apiClient.addHealthFocus(label)
      mergeCustomFocusOptions(added.focuses)
      const focusId = added.focus_id || added.focuses.find((item) => item.label === label)?.id
      if (!focusId) throw new Error('服务端没有返回关注项标识')
      const generated = await apiClient.generateCustomFocusCard(range, focusId)
      const card = normalizeCustomRiskCard(generated.card, `custom:${focusId}`, label)
      mergeCustomFocusCard(card)
      applyGeneratedFocusMeta(generated)
      setSelectedRiskKeys((previous) => previous.includes(card.key) ? previous : [...previous, card.key])
      setCustomFocusInput('')
      setCustomFocusNotice(added.already_exists ? '已有关注的 AI 卡片已更新。' : 'AI 关注已添加。')
    } catch (error) {
      setCustomFocusError(userFacingErrorMessage(error, '添加 AI 关注失败'))
    } finally {
      setCustomFocusAdding(false)
    }
  }, [applyGeneratedFocusMeta, customFocusAdding, customFocusInput, health?.has_enough_data, mergeCustomFocusCard, mergeCustomFocusOptions, range])

  const handleRefreshCustomFocus = useCallback(async (card: ExtendedRiskCard) => {
    if (!card.is_custom || customFocusRefreshingKey) return
    const focusId = card.key.replace(/^custom:/, '')
    if (!focusId) return
    setCustomFocusRefreshingKey(card.key)
    setCustomFocusError('')
    setCustomFocusNotice('')
    try {
      const generated = await apiClient.generateCustomFocusCard(range, focusId)
      const nextCard = normalizeCustomRiskCard(generated.card, card.key, card.focus_label || card.title)
      mergeCustomFocusCard(nextCard)
      applyGeneratedFocusMeta(generated)
      setSelectedRisk(nextCard)
      setCustomFocusNotice('AI 卡片已更新。')
    } catch (error) {
      const message = userFacingErrorMessage(error, '刷新 AI 卡片失败')
      setCustomFocusError(message)
      void dialog.alert('更新失败', message, 'danger')
    } finally {
      setCustomFocusRefreshingKey(null)
    }
  }, [applyGeneratedFocusMeta, customFocusRefreshingKey, dialog, mergeCustomFocusCard, range])

  const handleRemoveCustomFocus = useCallback(async (option: RiskOption) => {
    if (!option.is_custom || customFocusRemovingKey) return
    const focusId = option.key.replace(/^custom:/, '')
    if (!focusId) return
    const confirmed = await dialog.confirm({
      title: '移除自定义关注',
      message: `确定移除「${option.title}」吗？`,
      kind: 'danger',
      confirmText: '移除',
    })
    if (!confirmed) return

    setCustomFocusRemovingKey(option.key)
    setCustomFocusError('')
    setCustomFocusNotice('')
    try {
      await apiClient.removeHealthFocus(focusId)
      setSelectedRiskKeys((previous) => {
        const next = previous.filter((key) => key !== option.key)
        return next.length > 0 ? next : DEFAULT_RISK_KEYS
      })
      setSummary((previous) => {
        if (!previous?.health_index) return previous
        return {
          ...previous,
          health_index: {
            ...previous.health_index,
            custom_risk_cards: (previous.health_index.custom_risk_cards || []).filter((card) => card.key !== option.key),
            all_risk_options: (previous.health_index.all_risk_options || []).filter((item) => item.key !== option.key),
          },
        }
      })
      if (selectedRisk?.key === option.key) setSelectedRisk(null)
      setCustomFocusNotice('自定义关注已移除。')
    } catch (error) {
      setCustomFocusError(userFacingErrorMessage(error, '移除自定义关注失败'))
    } finally {
      setCustomFocusRemovingKey(null)
    }
  }, [customFocusRemovingKey, dialog, selectedRisk?.key])

  if (!isAuthenticated) {
    return (
      <View style={styles.page}>
        <View style={styles.topWash} pointerEvents="none" />
        <View style={[styles.guestWrap, { paddingTop: Math.max(insets.top + 72, 96), paddingBottom: insets.bottom + 110 }]}>
          <View style={styles.guestCard} accessibilityRole="summary">
            <View style={styles.guestIcon}>
              <LogIn size={25} color={palette.brandText} strokeWidth={2.2} />
            </View>
            <Text style={styles.guestTitle}>登录后查看饮食分析</Text>
            <Text style={styles.guestDesc}>可先浏览首页热量与营养概览，需要账号同步时再登录</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="去登录查看饮食分析"
              style={({ pressed }) => [styles.guestButton, pressed && styles.pressed]}
              onPress={() => navigation.getParent()?.navigate('Login', { redirectTab: 'StatsTab' })}
            >
              <Text style={styles.guestButtonText}>去登录</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  if (loading && !summary) {
    return (
      <View style={styles.page}>
        <View style={styles.topWash} pointerEvents="none" />
        <View style={[styles.pageStateWrap, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 100 }]} accessibilityLabel="正在加载饮食统计">
          <ActivityIndicator size="small" color={palette.brand} />
        </View>
      </View>
    )
  }

  if (loadError && !summary) {
    return (
      <View style={styles.page}>
        <View style={styles.topWash} pointerEvents="none" />
        <View style={[styles.pageStateWrap, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 100 }]}>
          <View style={styles.pageErrorCard} accessibilityRole="alert">
            <View style={styles.pageErrorIcon}><CircleAlert size={28} color={palette.danger} strokeWidth={2} /></View>
            <Text style={styles.pageErrorText}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新加载饮食统计"
              style={({ pressed }) => [styles.pageRetryButton, pressed && styles.pressed]}
              onPress={() => void load()}
            >
              <Text style={styles.pageRetryText}>重试</Text>
            </Pressable>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.page}>
      <View style={styles.topWash} pointerEvents="none" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`统计周期，当前${range === 'week' ? '近一周' : '近一个月'}`}
        accessibilityState={{ disabled: loading, expanded: rangeSheetOpen }}
        disabled={loading}
        style={({ pressed }) => [styles.rangeDropdown, { top: Math.max(insets.top + 8, 18) }, loading && styles.rangeDropdownLoading, pressed && !loading && styles.pressed]}
        onPress={() => setRangeSheetOpen(true)}
      >
        <Text style={styles.rangeDropdownLabel}>{range === 'week' ? '近一周' : '近一个月'}</Text>
        <ChevronDown size={17} color={palette.textSecondary} strokeWidth={2.2} />
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 70, 96),
            paddingBottom: insets.bottom + 110,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={palette.brand} colors={[palette.brand]} progressBackgroundColor={palette.surface} />}
      >
        {loadError ? (
          <View style={styles.inlineErrorBanner} accessibilityRole="alert">
            <CircleAlert size={20} color={palette.danger} strokeWidth={2.1} />
            <Text style={styles.inlineErrorText}>{loadError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="重新加载饮食统计" style={({ pressed }) => [styles.inlineRetryButton, pressed && styles.pressed]} onPress={() => void load()}>
              <Text style={styles.inlineRetryText}>重试</Text>
            </Pressable>
          </View>
        ) : null}
        {hasEnoughHealthData ? (
          <>
            <View style={styles.riskOverviewCard}>
              <View style={styles.riskOverviewTop}>
                <View>
                  <Text style={styles.riskOverviewTitle}>关注综合分</Text>
                  <Text style={styles.riskOverviewSubtitle}>当前周期 · {range === 'week' ? '最近 7 天' : '最近 30 天'}</Text>
                </View>
                <View style={[styles.riskOverviewBadge, toneBadgeStyle(scoreToTone(healthScore), isDark)]}>
                  <Text style={styles.riskOverviewBadgeText}>{scoreToLabel(healthScore)}</Text>
                </View>
              </View>
              <View style={styles.riskOverviewScoreRow}>
                <Text style={styles.riskOverviewScore}>{healthScore || '--'}</Text>
                <Text style={styles.riskOverviewScoreUnit}>/ 100</Text>
              </View>
              <Text style={styles.riskOverviewHint}>
                如果完成修改，关注综合分约为 {healthScore || '--'} → {projectedScore || '--'}
              </Text>
              <Text style={styles.riskOverviewSummary}>{focusOverviewCopy}</Text>
              <View style={styles.riskOverviewChipRow}>
                {signalChips.map((chip) => (
                  <View key={chip.label} style={styles.riskOverviewChip}>
                    <Text style={styles.riskOverviewChipLabel}>{chip.label}</Text>
                    <Text style={styles.riskOverviewChipValue} numberOfLines={1} adjustsFontSizeToFit>{chip.value}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.disclaimerBanner}>
              <View style={styles.disclaimerDot} />
              <Text style={styles.disclaimerText}>结果仅供参考，不代替医学判断</Text>
              <Text style={styles.disclaimerAction}>已知悉</Text>
            </View>
          </>
        ) : (
          <DataGateCard
            icon={TrendingUp}
            title="连续记录两天后显示健康指数"
            desc={`当前已记录 ${recordedDays} 天。请连续记录两天以上，我们会基于更稳定的饮食趋势展示你的健康参考指数。`}
          />
        )}

        <View style={styles.analysisTabsContainer}>
          <View style={[styles.segmented, loading && styles.segmentedLoading]}>
            {loading ? (
              <View style={styles.tabsSpinner}>
                <ActivityIndicator size="small" color={colors.brand} />
              </View>
            ) : null}
            {analysisTabs.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: panel === item.key, disabled: loading }}
                disabled={loading}
                style={({ pressed }) => [styles.segmentItem, panel === item.key && styles.segmentItemActive, pressed && !loading && styles.pressed]}
                onPress={() => setPanel(item.key)}
              >
                <Text style={[styles.segmentText, panel === item.key && styles.segmentTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {panel === 'health' ? (
          hasEnoughHealthData ? (
            <HealthPanel
              riskCards={visibleRiskCards}
              health={health}
              onSelectRisk={setSelectedRisk}
              onOpenFocus={() => {
                setCustomFocusError('')
                setCustomFocusNotice('')
                setRiskPickerOpen(true)
              }}
            />
          ) : null
        ) : null}

        {panel === 'nutrition' ? (
          <AiPanel
            summary={summary}
            insightText={insightText}
            insightMeta={insightMeta}
            insightError={insightError}
            insightLoading={insightLoading}
            canUseStatsInsight={hasAnyDietData}
            onGenerate={generateInsight}
          />
        ) : null}

        {panel === 'structure' ? (
          <StructurePanel summary={summary} hasAnyDietData={hasAnyDietData} />
        ) : null}

        <View style={styles.moreCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleGroup}>
              <Sparkles size={19} color={palette.brandText} strokeWidth={2.4} />
              <View>
                <Text style={styles.cardTitle}>更多分析</Text>
                <Text style={styles.cardSubtitle}>代谢和身体趋势</Text>
              </View>
            </View>
          </View>
          <View style={styles.toolGrid}>
            <AnalysisTool icon={BrainCircuit} label="代谢分析" onPress={() => navigation.navigate('StatsMetabolic')} />
            <AnalysisTool icon={TrendingUp} label="身体趋势" onPress={() => navigation.navigate('BodyTrends')} />
          </View>
        </View>
      </ScrollView>

      <RangeSheet
        visible={rangeSheetOpen}
        current={range}
        onClose={() => setRangeSheetOpen(false)}
        onSelect={(nextRange) => {
          setRange(nextRange)
          setRangeSheetOpen(false)
        }}
      />
      <RiskFocusSheet
        visible={riskPickerOpen}
        options={orderedRiskOptions}
        selectedKeys={selectedRiskKeys}
        selectedSummary={selectedRiskSummary}
        customFocusMeta={customFocusMeta}
        customFocusInput={customFocusInput}
        customFocusAdding={customFocusAdding}
        customFocusRemovingKey={customFocusRemovingKey}
        error={customFocusError}
        notice={customFocusNotice}
        onInputChange={(value) => {
          setCustomFocusInput(value)
          if (customFocusError) setCustomFocusError('')
          if (customFocusNotice) setCustomFocusNotice('')
        }}
        onAdd={() => void handleAddCustomFocus()}
        onToggle={toggleRiskPreference}
        onRemove={(option) => void handleRemoveCustomFocus(option)}
        onClose={() => setRiskPickerOpen(false)}
      />
      <RiskDetailSheet
        card={selectedRisk}
        refreshing={Boolean(selectedRisk && customFocusRefreshingKey === selectedRisk.key)}
        onRefresh={(card) => void handleRefreshCustomFocus(card)}
        onClose={() => setSelectedRisk(null)}
      />
    </View>
  )
}

function HealthPanel({
  riskCards,
  health,
  onSelectRisk,
  onOpenFocus,
}: {
  riskCards: ExtendedRiskCard[]
  health: ExtendedHealthIndex | undefined
  onSelectRisk: (card: ExtendedRiskCard) => void
  onOpenFocus: () => void
}) {
  const { palette, styles } = useStatsTheme()
  return (
    <>
      <View style={styles.riskSectionHeader}>
        <Text style={styles.riskSectionTitle}>健康指标关注</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="编辑我的健康关注"
          style={({ pressed }) => [styles.riskFocusEditBtn, pressed && styles.pressed]}
          onPress={onOpenFocus}
        >
          <Target size={17} color={palette.brandText} strokeWidth={2.2} />
          <Text style={styles.riskFocusEditText}>我的关注</Text>
        </Pressable>
      </View>

      {riskCards.length > 0 ? (
        <View style={styles.riskCardGrid}>
          {riskCards.map((card) => (
            <RiskTile key={card.key} card={card} onPress={() => onSelectRisk(card)} />
          ))}
        </View>
      ) : (
        <View style={styles.statsCard}>
          <Text style={styles.emptyTitle}>继续记录后生成风险卡片</Text>
          <Text style={styles.emptyText}>这里会展示你最需要关注的健康方向、分数和可执行动作。</Text>
        </View>
      )}

      {(health?.action_list || []).length ? (
        <View style={styles.actionPlanPanel}>
          <Text style={styles.actionPlanTitle}>优先行动</Text>
          {(health?.action_list || []).slice(0, 3).map((item, index) => (
            <View key={`${item}-${index}`} style={styles.actionPlanItem}>
              <Text style={styles.actionPlanBullet}>{index + 1}</Text>
              <Text style={styles.actionPlanText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  )
}

function RiskTile({ card, onPress }: { card: ExtendedRiskCard; onPress: () => void }) {
  const { isDark, styles } = useStatsTheme()
  const RiskIcon = riskIconComponent(card.key)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}，${Math.round(card.score)}分，${card.brief || card.summary}`}
      style={({ pressed }) => [styles.riskTile, { backgroundColor: riskBgColor(card.key, isDark) }, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.riskTileTop}>
        <View style={[styles.riskIconCircle, { backgroundColor: riskIconBgColor(card.key, isDark) }]}>
          <RiskIcon size={20} color={riskIconColor(card.key, isDark)} strokeWidth={2.1} />
        </View>
        <View style={styles.riskScoreWrap}>
          <Text style={styles.riskScore}>{Math.round(card.score)}</Text>
          <Text style={styles.riskScoreUnit}>分</Text>
        </View>
      </View>
      <Text style={styles.riskTileTitle} numberOfLines={2}>{card.title}</Text>
      {card.is_custom ? (
        <View style={styles.riskTileAiRow}>
          <Text style={styles.riskTileAiBadge}>AI</Text>
          {card.needs_refresh ? <Text style={styles.riskTileRefreshHint}>待更新</Text> : null}
        </View>
      ) : null}
      <Text style={styles.riskTileSummary} numberOfLines={2}>{card.brief || card.summary}</Text>
    </Pressable>
  )
}

function AiPanel({
  summary,
  insightText,
  insightMeta,
  insightError,
  insightLoading,
  canUseStatsInsight,
  onGenerate,
}: {
  summary: StatsSummary | null
  insightText: string
  insightMeta: string
  insightError: string
  insightLoading: boolean
  canUseStatsInsight: boolean
  onGenerate: () => void
}) {
  const { palette, styles } = useStatsTheme()
  const canGenerate = canUseStatsInsight && !insightLoading
  return (
    <View style={styles.aiCard}>
      <View style={styles.aiCardTop}>
        <View style={styles.cardTitleGroup}>
          <BrainCircuit size={20} color={palette.blue} strokeWidth={2.1} />
          <View style={styles.cardTitleCopy}>
            <Text style={styles.aiTitle}>AI 风险解读</Text>
            <Text style={styles.cardSubtitle}>按当前周期生成深度洞察</Text>
          </View>
        </View>
        {insightMeta ? <Text style={styles.aiMetaPill}>{insightMeta}</Text> : null}
      </View>

      {summary?.analysis_summary_needs_refresh ? (
        <View style={styles.analysisStatusWarning}>
          <Text style={styles.analysisStatusText}>最近新增了饮食记录，可按需手动更新。</Text>
        </View>
      ) : null}
      {insightError ? (
        <View style={styles.analysisError}>
          <Text style={styles.analysisErrorText}>{insightError}</Text>
        </View>
      ) : null}

      {!canUseStatsInsight ? (
        <View style={styles.analysisEmptyGate}>
          <Text style={styles.analysisEmptyTitle}>先记录饮食后再生成 AI 风险解读</Text>
          <Text style={styles.analysisEmptyText}>当前统计周期还没有饮食记录。记录至少一餐后，这里会基于真实数据生成解读。</Text>
        </View>
      ) : insightLoading ? (
        <View style={styles.analysisSkeletonGroup}>
          <View style={[styles.skeletonLine, styles.skeletonLine92]} />
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, styles.skeletonLine86]} />
          <View style={[styles.skeletonLine, styles.skeletonLine96]} />
          <View style={[styles.skeletonLine, styles.skeletonLine70]} />
        </View>
      ) : insightText ? (
        <View style={styles.markdownBlock}>
          <InsightMarkdownView text={insightText} />
        </View>
      ) : (
        <View style={styles.analysisEmpty}>
          <Text style={styles.analysisEmptyText}>这里不会在每次打开页面时自动重新分析。你可以在需要时手动生成一次。</Text>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={insightText ? '更新本周期 AI 风险解读' : '生成本周期 AI 风险解读'}
        accessibilityState={{ disabled: !canGenerate, busy: insightLoading }}
        style={({ pressed }) => [styles.analysisAction, !canGenerate && styles.analysisActionDisabled, pressed && canGenerate && styles.pressed]}
        onPress={onGenerate}
        disabled={!canGenerate}
      >
        {insightLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.analysisActionText}>
            {insightText ? '更新本周期解读' : '生成本周期解读'}
          </Text>
        )}
      </Pressable>
    </View>
  )
}

function StructurePanel({ summary, hasAnyDietData }: { summary: StatsSummary | null; hasAnyDietData: boolean }) {
  const { palette, styles } = useStatsTheme()
  const [expandedSections, setExpandedSections] = useState({ calories: true, macro: true, meals: true, body: true })
  const [showCalories, setShowCalories] = useState(false)
  const chartDays = useMemo(() => {
    const days = summary?.range === 'month' ? 14 : 7
    return (summary?.daily_calories || []).slice(-days)
  }, [summary?.daily_calories, summary?.range])
  const maxDailyCalories = Math.max(1, summary?.tdee || 0, ...chartDays.map((item) => Number(item.calories || 0)))
  const macroPercent = buildMacroPercent(summary)
  const totalCalories = Math.max(0, Number(summary?.total_calories || 0))
  const byMeal = buildMealValues(summary)
  const toggleSection = (key: keyof typeof expandedSections) => {
    setExpandedSections((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  if (!hasAnyDietData) {
    return (
      <DataGateCard
        icon={Utensils}
        title="记录饮食后查看营养结构"
        desc="当前统计周期还没有饮食记录。先记录一餐后，这里会展示热量趋势、宏量营养占比和餐次分布。"
      />
    )
  }

  return (
    <>
      <View style={styles.statsCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="热量摄入趋势"
          accessibilityState={{ expanded: expandedSections.calories }}
          style={({ pressed }) => [styles.collapsibleHeader, !expandedSections.calories && styles.collapsibleHeaderCollapsed, pressed && styles.pressed]}
          onPress={() => toggleSection('calories')}
        >
          <View style={styles.cardTitleGroup}>
            <Flame size={20} color={palette.brandText} strokeWidth={2.1} />
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle}>热量摄入趋势</Text>
              <Text style={styles.cardSubtitle}>{summary?.range === 'month' ? '最近 14 天' : '最近 7 天'}摄入变化和超标情况</Text>
            </View>
          </View>
          {expandedSections.calories ? <ChevronUp size={21} color={palette.textMuted} /> : <ChevronDown size={21} color={palette.textMuted} />}
        </Pressable>
        {expandedSections.calories ? (
          <View style={styles.collapsibleBody}>
            <View style={styles.chartSwitchRow}>
              <Text style={styles.chartSwitchLabel}>显示数值</Text>
              <Switch
                accessibilityLabel="显示热量数值"
                value={showCalories}
                onValueChange={setShowCalories}
                trackColor={{ false: palette.chartTrack, true: palette.brandSoft }}
                thumbColor={showCalories ? palette.brand : palette.textMuted}
              />
            </View>
            <View style={styles.barChartContainer} accessibilityLabel={`热量趋势，共 ${chartDays.length} 天`}>
              {chartDays.length > 0 ? chartDays.map((item) => (
                <View key={item.date} style={styles.chartCol} accessibilityLabel={`${item.date}，${Math.round(item.calories)}千卡`}>
                  {showCalories ? <Text style={styles.barCalorieText} numberOfLines={1}>{Math.round(item.calories)}</Text> : null}
                  <View style={styles.barWrapper}>
                    <View
                      style={[
                        styles.barFill,
                        item.calories > (summary?.tdee || 0) && styles.barFillOver,
                        { height: `${Math.max((Number(item.calories || 0) / maxDailyCalories) * 100, 10)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.barLabel}>{item.date.slice(5)}</Text>
                </View>
              )) : (
                <Text style={styles.emptyText}>暂无数据</Text>
              )}
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.statsCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="宏量营养结构"
          accessibilityState={{ expanded: expandedSections.macro }}
          style={({ pressed }) => [styles.collapsibleHeader, !expandedSections.macro && styles.collapsibleHeaderCollapsed, pressed && styles.pressed]}
          onPress={() => toggleSection('macro')}
        >
          <View style={styles.cardTitleGroup}>
            <ChartColumn size={20} color={palette.brandText} strokeWidth={2.1} />
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle}>宏量营养结构</Text>
              <Text style={styles.cardSubtitle}>蛋白质、碳水和脂肪的摄入占比</Text>
            </View>
          </View>
          {expandedSections.macro ? <ChevronUp size={21} color={palette.textMuted} /> : <ChevronDown size={21} color={palette.textMuted} />}
        </Pressable>
        {expandedSections.macro ? (
          <View style={styles.collapsibleBody}>
            <MacroStat label="蛋白质" value={Math.round(summary?.total_protein || 0)} percent={macroPercent.protein} color="#5c9ed4" />
            <MacroStat label="碳水化合物" value={Math.round(summary?.total_carbs || 0)} percent={macroPercent.carbs} color="#d4ac52" />
            <MacroStat label="脂肪" value={Math.round(summary?.total_fat || 0)} percent={macroPercent.fat} color="#f0985c" />
          </View>
        ) : null}
      </View>

      <View style={styles.statsCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="餐次热量分布"
          accessibilityState={{ expanded: expandedSections.meals }}
          style={({ pressed }) => [styles.collapsibleHeader, !expandedSections.meals && styles.collapsibleHeaderCollapsed, pressed && styles.pressed]}
          onPress={() => toggleSection('meals')}
        >
          <View style={styles.cardTitleGroup}>
            <Utensils size={20} color={palette.brandText} strokeWidth={2.1} />
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle}>餐次热量分布</Text>
              <Text style={styles.cardSubtitle}>早餐、午餐、晚餐和加餐的热量占比</Text>
            </View>
          </View>
          {expandedSections.meals ? <ChevronUp size={21} color={palette.textMuted} /> : <ChevronDown size={21} color={palette.textMuted} />}
        </Pressable>
        {expandedSections.meals ? (
          <View style={[styles.collapsibleBody, styles.mealGaugeGrid]}>
            {mealOrder.map((key) => {
              const calories = byMeal[key]
              const percent = totalCalories > 0 ? (calories / totalCalories) * 100 : 0
              return (
                <MealGauge
                  key={key}
                  label={mealNames[key]}
                  calories={calories}
                  percent={percent}
                  color={mealColors[key]}
                />
              )
            })}
          </View>
        ) : null}
      </View>

      <BodyMetricsCard
        bodyMetrics={summary?.body_metrics || null}
        expanded={expandedSections.body}
        onToggle={() => toggleSection('body')}
      />
    </>
  )
}
function BodyMetricsCard({
  bodyMetrics,
  expanded,
  onToggle,
}: {
  bodyMetrics: BodyMetricsSummary | null
  expanded: boolean
  onToggle: () => void
}) {
  const { palette, styles } = useStatsTheme()
  const latestWeight = bodyMetrics?.latest_weight || null
  const previousWeight = bodyMetrics?.previous_weight || null
  const weightChange = typeof bodyMetrics?.weight_change === 'number' ? bodyMetrics.weight_change : null
  const waterTrend = (bodyMetrics?.water_daily || []).slice(-7)
  const maxWaterValue = Math.max(1, bodyMetrics?.water_goal_ml || 2000, ...waterTrend.map((item) => Number(item.total || 0)))

  return (
    <View style={styles.statsCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="长期健康指标"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.collapsibleHeader, !expanded && styles.collapsibleHeaderCollapsed, pressed && styles.pressed]}
        onPress={onToggle}
      >
        <View style={styles.cardTitleGroup}>
          <TrendingUp size={20} color={palette.brandText} strokeWidth={2.1} />
          <View style={styles.cardTitleCopy}>
            <Text style={styles.cardTitle}>长期健康指标</Text>
            <Text style={styles.cardSubtitle}>体重趋势和喝水趋势</Text>
          </View>
        </View>
        {expanded ? <ChevronUp size={21} color={palette.textMuted} /> : <ChevronDown size={21} color={palette.textMuted} />}
      </Pressable>

      {expanded ? (
        <View style={styles.collapsibleBody}>
          <View style={styles.bodyMetricPanel} accessibilityLabel={latestWeight ? `当前体重 ${Number(latestWeight.value).toFixed(1)} 千克` : '还没有云端体重记录'}>
            <View style={styles.bodyMetricPanelHeader}>
              <View style={styles.bodyMetricTitleRow}>
                <Scale size={19} color={palette.brandText} strokeWidth={2.1} />
                <Text style={styles.bodyMetricTitle}>体重趋势</Text>
              </View>
              {latestWeight ? (
                <Text style={styles.bodyMetricMain}>{Number(latestWeight.value).toFixed(1)} kg</Text>
              ) : (
                <Text style={styles.bodyMetricEmpty}>还没有云端体重记录</Text>
              )}
            </View>
            {latestWeight ? (
              <Text style={styles.bodyMetricSub}>
                {previousWeight && weightChange !== null
                  ? `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg，较上次`
                  : '已开始累计体重趋势'}
              </Text>
            ) : null}
          </View>

          <View style={[styles.bodyMetricPanel, styles.waterPanel]} accessibilityLabel={`日均饮水 ${Math.round(bodyMetrics?.avg_daily_water_ml || 0)} 毫升`}>
            <View style={styles.bodyMetricPanelHeader}>
              <View style={styles.bodyMetricTitleRow}>
                <GlassWater size={19} color={palette.blue} strokeWidth={2.1} />
                <Text style={styles.bodyMetricTitle}>喝水趋势</Text>
              </View>
              <Text style={styles.bodyMetricMain}>{Math.round(bodyMetrics?.avg_daily_water_ml || 0)} ml</Text>
            </View>
            <Text style={styles.bodyMetricSub}>
              日均 {Math.round(bodyMetrics?.avg_daily_water_ml || 0)} ml，目标 {bodyMetrics?.water_goal_ml || 2000} ml，累计 {Math.round(bodyMetrics?.total_water_ml || 0)} ml
            </Text>
            {waterTrend.length > 0 ? (
              <View style={styles.waterTrendChart}>
                {waterTrend.map((item) => (
                  <View key={item.date} style={styles.waterTrendCol} accessibilityLabel={`${item.date}，${Math.round(Number(item.total || 0))} 毫升`}>
                    <View style={styles.waterTrendBarWrap}>
                      <View style={[styles.waterTrendBar, { height: `${Math.max((Number(item.total || 0) / maxWaterValue) * 100, 8)}%` }]} />
                    </View>
                    <Text style={styles.waterTrendLabel}>{item.date.slice(5)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}
function MacroStat({ label, value, percent, color }: { label: string; value: number; percent: number; color: string }) {
  const { styles } = useStatsTheme()
  return (
    <View style={styles.macroRow}>
      <View style={styles.macroInfo}>
        <Text style={styles.macroName}>{label}</Text>
        <Text style={styles.macroDetail}>{value}g / {Math.round(percent)}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { backgroundColor: color, width: `${clampPercent(percent)}%` }]} />
      </View>
    </View>
  )
}

function MealGauge({ label, calories, percent, color }: { label: string; calories: number; percent: number; color: string }) {
  const { styles } = useStatsTheme()
  return (
    <View style={styles.mealGaugeItem}>
      <View style={styles.mealGaugeLeft}>
        <View style={[styles.mealGaugeIconWrap, { backgroundColor: `${color}18` }]}>
          <Utensils size={15} color={color} strokeWidth={2.1} />
        </View>
        <Text style={styles.mealGaugeLabel}>{label}</Text>
        <Text style={[styles.mealGaugePercent, { color }]}>{percent.toFixed(1)}%</Text>
      </View>
      <View style={styles.mealGaugeCircle}>
        <RingProgress progress={percent / 100} color={color} />
        <View style={styles.mealGaugeCenter}>
          <Text style={[styles.mealGaugeCal, { color }]}>{Math.round(calories)}</Text>
        </View>
      </View>
    </View>
  )
}

function RingProgress({ progress, color }: { progress: number; color: string }) {
  const { palette } = useStatsTheme()
  const size = 58
  const stroke = 7
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const safeProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={palette.chartTrack} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - safeProgress)}
        rotation="-90"
        origin={`${size / 2}, ${size / 2}`}
      />
    </Svg>
  )
}

function DataGateCard({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  const { palette, styles } = useStatsTheme()
  return (
    <View style={styles.dataGateCard} accessibilityRole="summary">
      <View style={styles.dataGateIcon}>
        <Icon size={25} color={palette.blue} strokeWidth={2} />
      </View>
      <View style={styles.dataGateCopy}>
        <Text style={styles.dataGateTitle}>{title}</Text>
        <Text style={styles.dataGateDesc}>{desc}</Text>
      </View>
    </View>
  )
}

function AnalysisTool({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { palette, styles } = useStatsTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.toolChip, pressed && styles.pressed]} onPress={onPress}>
      <Icon size={18} color={palette.brandText} strokeWidth={2.1} />
      <Text style={styles.toolChipText}>{label}</Text>
    </Pressable>
  )
}

function RangeSheet({
  visible,
  current,
  onClose,
  onSelect,
}: {
  visible: boolean
  current: StatsRange
  onClose: () => void
  onSelect: (range: StatsRange) => void
}) {
  const insets = useSafeAreaInsets()
  const { palette, styles } = useStatsTheme()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.rangeSheet, { paddingBottom: Math.max(insets.bottom + 18, 24) }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>统计周期</Text>
          <View style={styles.rangeSheetList}>
            {rangeOptions.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityLabel={`${item.label}，${item.helper}`}
                accessibilityState={{ checked: current === item.key }}
                style={({ pressed }) => [styles.rangeSheetRow, current === item.key && styles.rangeSheetRowActive, pressed && styles.pressed]}
                onPress={() => onSelect(item.key)}
              >
                <View>
                  <Text style={[styles.rangeSheetLabel, current === item.key && styles.rangeSheetLabelActive]}>{item.label}</Text>
                  <Text style={styles.rangeSheetHelper}>{item.helper}</Text>
                </View>
                {current === item.key ? <View style={styles.rangeSheetCheckWrap}><Check size={17} color={palette.brandText} strokeWidth={2.4} /><Text style={styles.rangeSheetCheck}>已选</Text></View> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function RiskFocusSheet({
  visible,
  options,
  selectedKeys,
  selectedSummary,
  customFocusMeta,
  customFocusInput,
  customFocusAdding,
  customFocusRemovingKey,
  error,
  notice,
  onInputChange,
  onAdd,
  onToggle,
  onRemove,
  onClose,
}: {
  visible: boolean
  options: RiskOption[]
  selectedKeys: string[]
  selectedSummary: string
  customFocusMeta?: CustomFocusMeta
  customFocusInput: string
  customFocusAdding: boolean
  customFocusRemovingKey: string | null
  error: string
  notice: string
  onInputChange: (value: string) => void
  onAdd: () => void
  onToggle: (key: string) => void
  onRemove: (option: RiskOption) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const { palette, styles } = useStatsTheme()
  const canSubmit = Boolean(customFocusInput.trim()) && !customFocusAdding

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.riskFocusPanel, { paddingBottom: Math.max(insets.bottom + 14, 22) }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.riskFocusHeader}>
            <View style={styles.riskFocusHeaderCopy}>
              <Text style={styles.riskFocusTitle}>我的关注</Text>
              <Text style={styles.riskFocusSubtitle}>选择你想优先看的健康方向</Text>
            </View>
            <Text style={styles.riskFocusCount}>已选 {options.filter((option) => selectedKeys.includes(option.key)).length}</Text>
          </View>
          <Text style={styles.riskFocusSummary} numberOfLines={2}>
            当前：{selectedSummary || '暂无可展示的关注项'}
          </Text>

          <View style={styles.customFocusComposer}>
            <TextInput
              accessibilityLabel="自定义健康关注方向"
              style={styles.customFocusInput}
              value={customFocusInput}
              maxLength={12}
              placeholder="添加你关心的方向，如控尿酸"
              placeholderTextColor={palette.textMuted}
              returnKeyType="done"
              editable={!customFocusAdding}
              onChangeText={onInputChange}
              onSubmitEditing={() => {
                if (canSubmit) onAdd()
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加自定义关注"
              style={({ pressed }) => [
                styles.customFocusAddButton,
                !canSubmit && styles.customFocusAddButtonDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
              disabled={!canSubmit}
              onPress={onAdd}
            >
              {customFocusAdding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.customFocusAddButtonText}>添加关注</Text>
              )}
            </Pressable>
          </View>

          {customFocusMeta ? (
            <Text style={styles.customFocusMeta}>
              AI 卡片每次消耗 {customFocusMeta.generate_cost} 积分，今日还可生成 {customFocusMeta.remaining_today} / {customFocusMeta.daily_limit} 次，最多 {customFocusMeta.max_focuses} 个自定义关注
            </Text>
          ) : null}
          {error ? <Text style={styles.customFocusError}>{error}</Text> : null}
          {notice ? <Text style={styles.customFocusNotice}>{notice}</Text> : null}

          <ScrollView
            style={styles.riskFocusScroll}
            contentContainerStyle={styles.riskFocusGrid}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {options.map((option) => {
              const active = selectedKeys.includes(option.key)
              const removing = customFocusRemovingKey === option.key
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: removing }}
                  accessibilityLabel={`${option.title}${option.is_custom ? '，AI 自定义关注' : ''}${active ? '，已显示' : '，未显示'}`}
                  style={({ pressed }) => [
                    styles.riskFocusChip,
                    active && styles.riskFocusChipActive,
                    option.is_custom && styles.riskFocusChipCustom,
                    pressed && !removing && styles.pressed,
                  ]}
                  disabled={removing}
                  delayLongPress={450}
                  onPress={() => onToggle(option.key)}
                  onLongPress={() => {
                    if (option.is_custom) onRemove(option)
                  }}
                >
                  <View style={styles.riskFocusChipTitleRow}>
                    <Text style={[styles.riskFocusChipTitle, active && styles.riskFocusChipTitleActive]} numberOfLines={2}>
                      {option.title}
                    </Text>
                    {option.is_custom ? <Text style={styles.riskFocusChipAi}>AI</Text> : null}
                    {removing ? <ActivityIndicator size="small" color={palette.brandText} /> : null}
                  </View>
                  <Text style={styles.riskFocusChipAction}>
                    {option.is_custom
                      ? (active ? '点按隐藏 · 长按移除' : '点按显示 · 长按移除')
                      : (active ? '显示中' : '点按添加')}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>

          <Pressable accessibilityRole="button" accessibilityLabel="完成健康关注选择" style={({ pressed }) => [styles.riskFocusDoneButton, pressed && styles.pressed]} onPress={onClose}>
            <Text style={styles.riskFocusDoneText}>完成</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function RiskDetailSheet({
  card,
  refreshing,
  onRefresh,
  onClose,
}: {
  card: ExtendedRiskCard | null
  refreshing: boolean
  onRefresh: (card: ExtendedRiskCard) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const { isDark, palette, styles } = useStatsTheme()
  return (
    <Modal visible={Boolean(card)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.riskDetailPanel, { paddingBottom: Math.max(insets.bottom + 16, 24) }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          {card ? (
            <>
              <View style={styles.riskDetailHeader}>
                <View style={styles.riskDetailTitleRow}>
                  <Text style={styles.riskDetailTitle}>{card.title}</Text>
                  {card.is_custom ? <Text style={styles.riskDetailAiBadge}>AI</Text> : null}
                </View>
                <View style={styles.riskDetailScoreRow}>
                  <Text style={styles.riskDetailScore}>{Math.round(card.score)}</Text>
                  <Text style={styles.riskDetailScoreUnit}>分</Text>
                  <View style={[styles.riskDetailBadge, toneBadgeStyle(card.tone, isDark)]}>
                    <Text style={styles.riskDetailBadgeText}>{scoreToLabel(card.score)}</Text>
                  </View>
                </View>
              </View>
              {card.is_custom ? (
                <Text style={styles.riskDetailAiDisclaimer}>基于饮食趋势的趋势性参考，不构成医学诊断或治疗建议。</Text>
              ) : null}
              <Text style={styles.riskDetailBodyText}>{card.summary || card.brief}</Text>
              <View style={styles.riskDetailDivider} />
              <Text style={styles.riskDetailLabel}>判断依据</Text>
              <Text style={styles.riskDetailBodyText}>{card.basis || '暂无明确依据，继续记录后会更准确。'}</Text>
              <View style={styles.riskDetailDivider} />
              <Text style={styles.riskDetailLabel}>最小改善动作</Text>
              <Text style={styles.riskDetailBodyText}>{card.action || '先从最容易坚持的一餐开始调整。'}</Text>
              <View style={styles.riskDetailDelta}>
                <Text style={styles.riskDetailDeltaText}>预计可提升 {Math.round(card.delta || 0)} 分</Text>
              </View>
              {card.is_custom && card.needs_refresh ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="手动更新 AI 关注卡片"
                  style={({ pressed }) => [
                    styles.riskDetailRefreshBtn,
                    refreshing && styles.riskDetailRefreshBtnDisabled,
                    pressed && !refreshing && styles.pressed,
                  ]}
                  disabled={refreshing}
                  onPress={() => onRefresh(card)}
                >
                  {refreshing ? (
                    <ActivityIndicator size="small" color={palette.brandText} />
                  ) : (
                    <Text style={styles.riskDetailRefreshText}>手动更新 AI 卡片</Text>
                  )}
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="关闭健康指标详情" style={({ pressed }) => [styles.riskDetailCloseBtn, pressed && styles.pressed]} onPress={onClose}>
                <Text style={styles.riskDetailCloseText}>知道了</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function mergeRiskOptions(
  health: ExtendedHealthIndex | undefined,
  systemCards: ExtendedRiskCard[],
  customCards: ExtendedRiskCard[],
): RiskOption[] {
  const merged: RiskOption[] = []
  const seen = new Set<string>()
  const append = (option: RiskOption) => {
    if (!option.key || seen.has(option.key)) return
    seen.add(option.key)
    merged.push(option)
  }
  const serverOptions = health?.all_risk_options || []
  serverOptions.forEach(append)
  systemCards.forEach((card) => append({
    key: card.key,
    title: card.title,
    short: card.title,
  }))
  customCards.forEach((card) => append(customRiskCardToOption(card)))
  return merged
}

function customRiskCardToOption(card: ExtendedRiskCard): RiskOption {
  const title = card.focus_label || card.title
  return {
    key: card.key,
    title,
    short: title,
    is_custom: true,
  }
}

function customFocusToOption(focus: HealthFocusItem): RiskOption {
  return {
    key: `custom:${focus.id}`,
    title: focus.label,
    short: focus.label,
    is_custom: true,
  }
}

function pendingCustomRiskCardFromOption(option: RiskOption): ExtendedRiskCard {
  return {
    key: option.key,
    title: option.title,
    score: 60,
    tone: 'neutral',
    brief: '点开生成 AI 卡片',
    summary: `已选择「${option.title}」作为自定义关注方向，当前周期还没有可展示的 AI 卡片。`,
    basis: '该关注方向已保存，但当前统计周期尚未生成或刷新对应卡片。',
    action: '点击下方手动更新 AI 卡片，基于近期饮食趋势生成参考。',
    delta: 5,
    is_custom: true,
    needs_refresh: true,
    focus_label: option.title,
  }
}

function normalizeCustomRiskCard(value: unknown, fallbackKey: string, fallbackTitle: string): ExtendedRiskCard {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const title = String(record.focus_label || record.title || fallbackTitle).trim() || fallbackTitle
  return {
    key: String(record.key || fallbackKey).trim() || fallbackKey,
    title,
    score: toSafeNumber(record.score, 60),
    tone: normalizeRiskTone(record.tone),
    brief: String(record.brief || 'AI 关注卡片已生成'),
    summary: String(record.summary || record.brief || `已生成「${title}」的趋势参考。`),
    basis: String(record.basis || '基于当前周期的饮食记录生成。'),
    action: String(record.action || '继续保持记录，并从最容易执行的一项开始调整。'),
    delta: toSafeNumber(record.delta, 0),
    is_custom: true,
    needs_refresh: Boolean(record.needs_refresh),
    focus_label: String(record.focus_label || title),
  }
}

function normalizeRiskTone(value: unknown): RiskCard['tone'] {
  return value === 'positive' || value === 'warning' || value === 'danger' || value === 'neutral'
    ? value
    : 'neutral'
}

function insightStatusText(summary: StatsSummary | null): string {
  if (!summary) return ''
  const used = summary.analysis_summary_used_today
  const limit = summary.analysis_summary_daily_limit
  if (typeof used === 'number' && typeof limit === 'number' && limit > 0) {
    return `${used}/${limit} 次`
  }
  if (summary.analysis_summary_generated_date) return summary.analysis_summary_generated_date
  return ''
}

function scoreToTone(score: number): RiskCard['tone'] {
  if (score >= 78) return 'positive'
  if (score >= 60) return 'neutral'
  if (score >= 42) return 'warning'
  return 'danger'
}

function scoreToLabel(score: number): string {
  if (score >= 78) return '偏保护'
  if (score >= 60) return '基本中性'
  if (score >= 42) return '需要关注'
  return '重点关注'
}

function scoreToFocusOverview(score: number, hasRiskCards: boolean, hasCustomFocus = false): string {
  if (!hasRiskCards) return '继续记录后会生成你当前最需要关注的健康方向。'
  if (score >= 78) {
    return hasCustomFocus
      ? '你当前关注的指标整体更偏向保护，自定义方向也会跟随卡片一起纳入参考。'
      : '你当前关注的核心指标整体更偏向保护，保持稳定记录即可。'
  }
  if (score >= 60) {
    return hasCustomFocus
      ? '你当前关注的指标总体还算稳，但自定义方向和核心指标里已经有一些可优化项。'
      : '你当前关注的指标总体还算稳定，但已经有一些可优化项。'
  }
  if (score >= 42) {
    return hasCustomFocus
      ? '你当前关注的指标已经出现明显拖累，建议优先处理分数最低的关注项。'
      : '你当前关注的指标出现明显拖累，建议优先处理分数最低的一项。'
  }
  return hasCustomFocus
    ? '你当前关注的指标处在较高压力区，先从最可执行的一项小步调整。'
    : '你当前关注的核心指标处在较高压力区，先从最可执行的一项小步调整。'
}

function averageRiskScore(cards: RiskCard[]): number | null {
  const scores = cards.map((card) => Number(card.score)).filter((score) => Number.isFinite(score))
  if (!scores.length) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

function averageRiskDelta(cards: RiskCard[]): number {
  const deltas = cards.map((card) => Number(card.delta || 0)).filter((delta) => Number.isFinite(delta))
  if (!deltas.length) return 0
  return deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length
}

function signedKcal(value: number): string {
  const rounded = Math.round(value || 0)
  return `${rounded >= 0 ? '+' : ''}${rounded} kcal`
}

function buildMacroPercent(summary: StatsSummary | null) {
  const protein = Number(summary?.macro_percent?.protein)
  const carbs = Number(summary?.macro_percent?.carbs)
  const fat = Number(summary?.macro_percent?.fat)
  if ([protein, carbs, fat].some((value) => Number.isFinite(value) && value > 0)) {
    return {
      protein: Number.isFinite(protein) ? protein : 0,
      carbs: Number.isFinite(carbs) ? carbs : 0,
      fat: Number.isFinite(fat) ? fat : 0,
    }
  }
  const proteinCalories = Number(summary?.total_protein || 0) * 4
  const carbsCalories = Number(summary?.total_carbs || 0) * 4
  const fatCalories = Number(summary?.total_fat || 0) * 9
  const total = Math.max(1, proteinCalories + carbsCalories + fatCalories)
  return {
    protein: (proteinCalories / total) * 100,
    carbs: (carbsCalories / total) * 100,
    fat: (fatCalories / total) * 100,
  }
}

function buildMealValues(summary: StatsSummary | null): Record<MealKey, number> {
  return {
    breakfast: toSafeNumber(summary?.by_meal?.breakfast),
    morning_snack: toSafeNumber(summary?.by_meal?.morning_snack),
    lunch: toSafeNumber(summary?.by_meal?.lunch),
    afternoon_snack: toSafeNumber(summary?.by_meal?.afternoon_snack ?? summary?.by_meal?.snack),
    dinner: toSafeNumber(summary?.by_meal?.dinner),
    evening_snack: toSafeNumber(summary?.by_meal?.evening_snack),
  }
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

function riskIconComponent(key: string): LucideIcon {
  if (key.includes('diabetes') || key.includes('sugar')) return ChartColumn
  if (key.includes('cardio') || key.includes('heart') || key.includes('hypertension')) return HeartPulse
  if (key.includes('weight')) return Scale
  if (key.includes('protein') || key.includes('calorie')) return Flame
  return Target
}

function riskBgColor(key: string, isDark: boolean): string {
  if (isDark) {
    if (key.includes('hypertension')) return 'rgba(196,92,92,0.13)'
    if (key.includes('diabetes')) return 'rgba(90,155,199,0.13)'
    if (key.includes('cardio')) return 'rgba(201,150,92,0.13)'
    if (key.includes('weight')) return 'rgba(90,168,110,0.13)'
    return 'rgba(92,184,150,0.12)'
  }
  if (key.includes('hypertension')) return '#fff7f7'
  if (key.includes('diabetes')) return '#f4f8fe'
  if (key.includes('cardio')) return '#fff8ef'
  if (key.includes('weight')) return '#f1fbf5'
  return '#f4fbf8'
}

function riskIconBgColor(key: string, isDark: boolean): string {
  if (isDark) {
    if (key.includes('hypertension')) return 'rgba(248,113,113,0.18)'
    if (key.includes('diabetes')) return 'rgba(96,165,250,0.18)'
    if (key.includes('cardio')) return 'rgba(251,191,36,0.17)'
    if (key.includes('weight')) return 'rgba(74,222,128,0.17)'
    return 'rgba(125,211,176,0.16)'
  }
  if (key.includes('hypertension')) return '#fbe4e4'
  if (key.includes('diabetes')) return '#e2effb'
  if (key.includes('cardio')) return '#ffecd8'
  if (key.includes('weight')) return '#dbf5e4'
  return '#dff4ed'
}

function riskIconColor(key: string, isDark: boolean): string {
  if (key.includes('hypertension')) return isDark ? '#fca5a5' : '#c45c5c'
  if (key.includes('diabetes')) return isDark ? '#93c5fd' : '#5a9bc7'
  if (key.includes('cardio')) return isDark ? '#f6c177' : '#c9965c'
  if (key.includes('weight')) return isDark ? '#86efac' : '#5aa86e'
  return isDark ? '#9fe3c5' : colors.brandDark
}

function toneBadgeStyle(tone: RiskCard['tone'], isDark: boolean) {
  if (tone === 'danger') return { backgroundColor: isDark ? 'rgba(248,113,113,0.18)' : 'rgba(248,113,113,0.18)' }
  if (tone === 'warning') return { backgroundColor: isDark ? 'rgba(251,191,36,0.20)' : 'rgba(251,191,36,0.20)' }
  if (tone === 'positive') return { backgroundColor: isDark ? 'rgba(74,222,128,0.18)' : 'rgba(134,239,172,0.18)' }
  return { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(148,163,184,0.12)' }
}
function createStatsStyles(palette: StatsPalette, isDark: boolean) {
  return StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: palette.page,
  },
  pageStateWrap: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageErrorCard: {
    width: '100%',
    maxWidth: 520,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 28,
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  pageErrorIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.dangerSoft,
  },
  pageErrorText: {
    marginTop: 14,
    color: palette.textSecondary,
    fontSize: compactFont(14, 13),
    lineHeight: 21,
    textAlign: 'center',
  },
  pageRetryButton: {
    minWidth: 132,
    minHeight: 48,
    marginTop: 20,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  pageRetryText: {
    color: '#fff',
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  guestWrap: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'flex-start',
  },
  guestCard: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 34,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.2)',
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  guestIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    backgroundColor: palette.brandSoft,
  },
  guestTitle: {
    color: palette.text,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  guestDesc: {
    marginTop: 9,
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  guestButton: {
    minWidth: 136,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  guestButtonText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  topWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
    backgroundColor: palette.topWash,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 0,
  },
  rangeDropdown: {
    position: 'absolute',
    left: 16,
    zIndex: 30,
    minWidth: 96,
    height: 48,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: palette.surfaceRaised,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: palette.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  rangeDropdownLoading: {
    opacity: 0.68,
  },
  rangeDropdownLabel: {
    fontSize: compactFont(14, 13),
    lineHeight: 18,
    fontWeight: '800',
    color: palette.text,
  },
  inlineErrorBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: palette.dangerSoft,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(253,164,175,0.24)' : 'rgba(245,212,212,0.90)',
  },
  inlineErrorText: {
    flex: 1,
    color: palette.danger,
    fontSize: compactFont(12, 11),
    lineHeight: 18,
  },
  inlineRetryButton: {
    minWidth: 64,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceRaised,
  },
  inlineRetryText: {
    color: palette.danger,
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  riskOverviewCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 18,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#163c34',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#123931',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  riskOverviewTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  riskOverviewTitle: {
    color: '#fff',
    fontSize: compactFont(20, 19),
    lineHeight: 26,
    fontWeight: '800',
  },
  riskOverviewSubtitle: {
    marginTop: 5,
    color: 'rgba(226,232,240,0.72)',
    fontSize: compactFont(12, 11),
    lineHeight: 16,
    fontWeight: '700',
  },
  riskOverviewBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  riskOverviewBadgeText: {
    color: '#fff',
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  riskOverviewScoreRow: {
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  riskOverviewScore: {
    color: '#fff',
    fontSize: 48,
    lineHeight: 54,
    fontWeight: '900',
  },
  riskOverviewScoreUnit: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: compactFont(15, 14),
    fontWeight: '800',
  },
  riskOverviewHint: {
    marginTop: 5,
    color: 'rgba(226,232,240,0.78)',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
    fontWeight: '700',
  },
  riskOverviewSummary: {
    marginTop: 9,
    color: '#f8fafc',
    fontSize: compactFont(14, 13),
    lineHeight: 20,
    fontWeight: '700',
  },
  riskOverviewChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 15,
  },
  riskOverviewChip: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
  },
  riskOverviewChipLabel: {
    color: 'rgba(226,232,240,0.70)',
    fontSize: 10,
    lineHeight: 14,
  },
  riskOverviewChipValue: {
    marginTop: 4,
    color: '#fff',
    fontSize: compactFont(13, 12),
    lineHeight: 17,
    fontWeight: '900',
  },
  disclaimerBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.brandSoft,
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.20)',
  },
  disclaimerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand,
  },
  disclaimerText: {
    flex: 1,
    color: palette.brandText,
    fontSize: compactFont(12, 11),
    lineHeight: 17,
    fontWeight: '800',
  },
  disclaimerAction: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: colors.brand,
    fontSize: 11,
    fontWeight: '900',
  },
  dataGateCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 17,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.16)',
  },
  dataGateIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.blueSoft,
  },
  dataGateCopy: {
    flex: 1,
    minWidth: 0,
  },
  dataGateTitle: {
    color: palette.text,
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 6,
  },
  dataGateDesc: {
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  analysisTabsContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  segmented: {
    position: 'relative',
    flexDirection: 'row',
    gap: 4,
    borderRadius: 14,
    padding: 4,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
  },
  segmentedLoading: {
    opacity: 0.88,
  },
  tabsSpinner: {
    position: 'absolute',
    right: 12,
    top: 9,
    zIndex: 2,
  },
  segmentItem: {
    flex: 1,
    minHeight: 48,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  segmentText: {
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    fontWeight: '800',
  },
  segmentTextActive: {
    color: palette.brandText,
  },
  riskSectionHeader: {
    marginHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  riskSectionTitle: {
    color: palette.text,
    fontSize: compactFont(17, 16),
    lineHeight: 22,
    fontWeight: '900',
  },
  riskFocusEditBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.surface,
    shadowColor: palette.shadow,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  riskFocusEditText: {
    color: palette.brandText,
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  riskCardGrid: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  riskTile: {
    width: '48.5%',
    minHeight: 142,
    borderRadius: 16,
    padding: 13,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: palette.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  riskTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  riskIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskScoreWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  riskScore: {
    color: palette.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
  },
  riskScoreUnit: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  riskTileTitle: {
    color: palette.text,
    fontSize: compactFont(14, 13),
    lineHeight: 18,
    fontWeight: '900',
  },
  riskTileAiRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  riskTileAiBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: colors.brand,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
  },
  riskTileRefreshHint: {
    color: palette.warning,
    fontSize: compactFont(10, 9),
    lineHeight: 14,
    fontWeight: '800',
  },
  riskTileSummary: {
    marginTop: 7,
    color: palette.textSecondary,
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  statsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    shadowColor: palette.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  emptyTitle: {
    color: palette.text,
    fontSize: compactFont(15, 14),
    fontWeight: '900',
    marginBottom: 5,
  },
  emptyText: {
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    lineHeight: 18,
  },
  actionPlanPanel: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.16)',
  },
  actionPlanTitle: {
    color: palette.text,
    fontSize: compactFont(15, 14),
    fontWeight: '900',
    marginBottom: 8,
  },
  actionPlanItem: {
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 6,
  },
  actionPlanBullet: {
    width: 21,
    height: 21,
    borderRadius: 11,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 21,
    color: palette.brandText,
    backgroundColor: palette.brandSoft,
    fontSize: 11,
    fontWeight: '900',
  },
  actionPlanText: {
    flex: 1,
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  aiCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: 'rgba(92,158,212,0.14)',
  },
  aiCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 13,
  },
  cardTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flex: 1,
    minWidth: 0,
  },
  cardTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  aiTitle: {
    color: palette.blue,
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '900',
  },
  cardTitle: {
    color: palette.text,
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '900',
  },
  cardSubtitle: {
    marginTop: 3,
    color: palette.textMuted,
    fontSize: compactFont(11, 10),
    lineHeight: 15,
    fontWeight: '700',
  },
  aiMetaPill: {
    flexShrink: 0,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: palette.blue,
    backgroundColor: palette.blueSoft,
    fontSize: 11,
    fontWeight: '900',
  },
  analysisStatusWarning: {
    marginBottom: 12,
    padding: 11,
    borderRadius: 12,
    backgroundColor: palette.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(240,152,92,0.22)',
  },
  analysisStatusText: {
    color: palette.textSecondary,
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  analysisError: {
    marginBottom: 12,
    padding: 11,
    borderRadius: 12,
    backgroundColor: palette.dangerSoft,
    borderWidth: 1,
    borderColor: 'rgba(245,212,212,0.90)',
  },
  analysisErrorText: {
    color: palette.danger,
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  analysisEmptyGate: {
    padding: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(92,158,212,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(92,158,212,0.14)',
  },
  analysisEmptyTitle: {
    color: palette.text,
    fontSize: compactFont(14, 13),
    lineHeight: 19,
    fontWeight: '900',
    marginBottom: 6,
  },
  analysisEmptyText: {
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  analysisEmpty: {
    paddingVertical: 4,
  },
  analysisSkeletonGroup: {
    gap: 10,
    paddingVertical: 6,
  },
  skeletonLine: {
    width: '100%',
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(92,158,212,0.16)',
  },
  skeletonLine96: {
    width: '96%',
  },
  skeletonLine92: {
    width: '92%',
  },
  skeletonLine86: {
    width: '86%',
  },
  skeletonLine70: {
    width: '70%',
  },
  markdownBlock: {
    gap: 8,
  },
  analysisAction: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  analysisActionDisabled: {
    opacity: 0.55,
  },
  analysisActionText: {
    color: '#fff',
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  collapsibleHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 15,
  },
  collapsibleHeaderCollapsed: {
    marginBottom: 0,
  },
  collapsibleBody: {
    gap: 2,
  },
  chartSwitchRow: {
    minHeight: 48,
    marginBottom: 10,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chartSwitchLabel: {
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    fontWeight: '800',
  },
  barChartContainer: {
    minHeight: 168,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 7,
  },
  chartCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  barCalorieText: {
    color: palette.textSecondary,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  barWrapper: {
    width: '100%',
    maxWidth: 24,
    height: 108,
    justifyContent: 'flex-end',
    padding: 3,
    borderRadius: 14,
    backgroundColor: palette.chartTrack,
  },
  barFill: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: colors.brand,
  },
  barFillOver: {
    backgroundColor: '#e57373',
  },
  barLabel: {
    color: palette.textMuted,
    fontSize: 10,
    lineHeight: 13,
  },
  macroRow: {
    marginBottom: 14,
  },
  macroInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  macroName: {
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    fontWeight: '800',
  },
  macroDetail: {
    color: palette.text,
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  progressTrack: {
    height: 9,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: palette.chartTrack,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  mealGaugeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  mealGaugeItem: {
    width: '48.5%',
    minHeight: 92,
    padding: 11,
    borderRadius: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mealGaugeLeft: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  mealGaugeIconWrap: {
    width: 25,
    height: 25,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealGaugeLabel: {
    color: palette.text,
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  mealGaugePercent: {
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  mealGaugeCircle: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealGaugeCenter: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealGaugeCal: {
    fontSize: 11,
    fontWeight: '900',
  },
  bodyMetricPanel: {
    padding: 13,
    borderRadius: 16,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: 10,
  },
  waterPanel: {
    backgroundColor: isDark ? '#18252a' : '#f6fbfd',
    marginBottom: 0,
  },
  bodyMetricPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  bodyMetricTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  bodyMetricTitle: {
    color: palette.text,
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  bodyMetricMain: {
    color: palette.text,
    fontSize: compactFont(18, 17),
    fontWeight: '900',
  },
  bodyMetricEmpty: {
    color: palette.textMuted,
    fontSize: compactFont(12, 11),
    lineHeight: 17,
    fontWeight: '700',
  },
  bodyMetricSub: {
    marginTop: 7,
    color: palette.textSecondary,
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  waterTrendChart: {
    marginTop: 13,
    height: 96,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 5,
  },
  waterTrendCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  waterTrendBarWrap: {
    width: '100%',
    maxWidth: 26,
    height: 74,
    padding: 4,
    borderRadius: 13,
    backgroundColor: palette.chartTrack,
    justifyContent: 'flex-end',
  },
  waterTrendBar: {
    width: '100%',
    borderRadius: 13,
    backgroundColor: '#5c9ed4',
  },
  waterTrendLabel: {
    color: palette.textMuted,
    fontSize: 9,
    lineHeight: 12,
  },
  moreCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.14)',
  },
  cardHeader: {
    marginBottom: 13,
  },
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toolChip: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    backgroundColor: palette.brandSoft,
  },
  toolChipText: {
    color: palette.brandText,
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: palette.scrim,
    justifyContent: 'flex-end',
  },
  rangeSheet: {
    margin: 12,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    backgroundColor: palette.surface,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: isDark ? 'rgba(255,255,255,0.18)' : '#d1d5db',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: palette.text,
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 12,
  },
  riskFocusPanel: {
    margin: 12,
    maxHeight: '84%',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingTop: 14,
    backgroundColor: palette.surface,
  },
  riskFocusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  riskFocusHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  riskFocusTitle: {
    color: palette.text,
    fontSize: compactFont(18, 17),
    lineHeight: 24,
    fontWeight: '900',
  },
  riskFocusSubtitle: {
    marginTop: 3,
    color: palette.textSecondary,
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  riskFocusCount: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: palette.brandText,
    backgroundColor: palette.brandSoft,
    fontSize: compactFont(11, 10),
    fontWeight: '900',
  },
  riskFocusSummary: {
    marginTop: 10,
    color: palette.textSecondary,
    fontSize: compactFont(12, 11),
    lineHeight: 18,
  },
  customFocusComposer: {
    marginTop: 13,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  customFocusInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: palette.text,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
    fontSize: compactFont(13, 12),
  },
  customFocusAddButton: {
    minWidth: 94,
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  customFocusAddButtonDisabled: {
    opacity: 0.5,
  },
  customFocusAddButtonText: {
    color: '#fff',
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  customFocusMeta: {
    marginTop: 9,
    color: palette.textSecondary,
    fontSize: compactFont(11, 10),
    lineHeight: 16,
  },
  customFocusError: {
    marginTop: 9,
    padding: 9,
    borderRadius: 10,
    overflow: 'hidden',
    color: palette.danger,
    backgroundColor: palette.dangerSoft,
    fontSize: compactFont(11, 10),
    lineHeight: 16,
  },
  customFocusNotice: {
    marginTop: 9,
    padding: 9,
    borderRadius: 10,
    overflow: 'hidden',
    color: palette.brandText,
    backgroundColor: palette.brandSoft,
    fontSize: compactFont(11, 10),
    lineHeight: 16,
  },
  riskFocusScroll: {
    marginTop: 12,
    flexGrow: 0,
    flexShrink: 1,
  },
  riskFocusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 4,
  },
  riskFocusChip: {
    width: '48.5%',
    minHeight: 66,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 13,
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: palette.border,
  },
  riskFocusChipActive: {
    backgroundColor: palette.brandSoft,
    borderColor: 'rgba(92,184,150,0.45)',
  },
  riskFocusChipCustom: {
    borderStyle: 'dashed',
  },
  riskFocusChipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  riskFocusChipTitle: {
    flex: 1,
    minWidth: 0,
    color: palette.text,
    fontSize: compactFont(13, 12),
    lineHeight: 18,
    fontWeight: '900',
  },
  riskFocusChipTitleActive: {
    color: palette.brandText,
  },
  riskFocusChipAi: {
    flexShrink: 0,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: colors.brand,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '900',
  },
  riskFocusChipAction: {
    marginTop: 6,
    color: palette.textSecondary,
    fontSize: compactFont(10, 9),
    lineHeight: 14,
  },
  riskFocusDoneButton: {
    marginTop: 13,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  riskFocusDoneText: {
    color: '#fff',
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  rangeSheetList: {
    gap: 8,
  },
  rangeSheetRow: {
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rangeSheetRowActive: {
    backgroundColor: palette.brandSoft,
    borderColor: 'rgba(92,184,150,0.28)',
  },
  rangeSheetLabel: {
    color: palette.text,
    fontSize: compactFont(15, 14),
    fontWeight: '900',
  },
  rangeSheetLabelActive: {
    color: palette.brandText,
  },
  rangeSheetHelper: {
    color: palette.textSecondary,
    fontSize: compactFont(11, 10),
    marginTop: 3,
  },
  rangeSheetCheckWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rangeSheetCheck: {
    color: palette.brandText,
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  riskDetailPanel: {
    margin: 12,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingTop: 14,
    backgroundColor: palette.surface,
  },
  riskDetailHeader: {
    gap: 8,
    marginBottom: 12,
  },
  riskDetailTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  riskDetailTitle: {
    flexShrink: 1,
    color: palette.text,
    fontSize: compactFont(18, 17),
    lineHeight: 23,
    fontWeight: '900',
  },
  riskDetailAiBadge: {
    flexShrink: 0,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: colors.brand,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
  },
  riskDetailScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  riskDetailScore: {
    color: palette.text,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '900',
  },
  riskDetailScoreUnit: {
    color: palette.textSecondary,
    fontSize: compactFont(12, 11),
    fontWeight: '800',
  },
  riskDetailBadge: {
    marginLeft: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  riskDetailBadgeText: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '900',
  },
  riskDetailLabel: {
    color: palette.text,
    fontSize: compactFont(13, 12),
    fontWeight: '900',
    marginBottom: 5,
  },
  riskDetailBodyText: {
    color: palette.textSecondary,
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  riskDetailAiDisclaimer: {
    marginBottom: 11,
    padding: 10,
    borderRadius: 11,
    overflow: 'hidden',
    color: palette.textSecondary,
    backgroundColor: palette.surfaceMuted,
    fontSize: compactFont(11, 10),
    lineHeight: 16,
  },
  riskDetailDivider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: 11,
  },
  riskDetailDelta: {
    marginTop: 12,
    padding: 11,
    borderRadius: 13,
    backgroundColor: palette.brandSoft,
  },
  riskDetailDeltaText: {
    color: palette.brandText,
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  riskDetailRefreshBtn: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandSoft,
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.28)',
  },
  riskDetailRefreshBtnDisabled: {
    opacity: 0.62,
  },
  riskDetailRefreshText: {
    color: palette.brandText,
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  riskDetailCloseBtn: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  riskDetailCloseText: {
    color: '#fff',
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  tonePositive: {
    backgroundColor: 'rgba(134,239,172,0.18)',
  },
  toneNeutral: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toneWarning: {
    backgroundColor: 'rgba(251,191,36,0.20)',
  },
  toneDanger: {
    backgroundColor: 'rgba(248,113,113,0.18)',
  },
  pressed: {
    opacity: 0.72,
  },
  })
}

const lightStatsStyles = createStatsStyles(statsLightPalette, false)
const darkStatsStyles = createStatsStyles(statsDarkPalette, true)

function useStatsTheme() {
  const { isDark } = useColorScheme()
  return {
    isDark,
    palette: isDark ? statsDarkPalette : statsLightPalette,
    styles: isDark ? darkStatsStyles : lightStatsStyles,
  }
}
