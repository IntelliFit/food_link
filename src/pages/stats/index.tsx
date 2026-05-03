import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { readStatsPageCache, writeStatsPageCache } from '../../utils/stats-page-cache'
import { Switch } from '@taroify/core'
import {
  getStatsSummary,
  generateStatsInsight,
  saveStatsInsight,
  getBodyMetricsSummary,
  showUnifiedApiError,
  type StatsSummary,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay,
} from '../../utils/api'
import { IconBreakfast, IconLunch, IconDinner, IconSnack, IconExpand, IconCollapse } from '../../components/iconfont'
import '../../assets/iconfont/iconfont.css'
import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const MEAL_ICONS = {
  breakfast: IconBreakfast,
  morning_snack: IconSnack,
  lunch: IconLunch,
  afternoon_snack: IconSnack,
  dinner: IconDinner,
  evening_snack: IconSnack,
  snack: IconSnack
} as const

/** 餐次结构配色：仅分早餐 / 午餐 / 晚餐三色；各时段加餐与对应主餐同色（与首页主色、蓝、橙一致） */
const MEAL_STRUCTURE_COLORS = {
  breakfast: '#5cb896',
  lunch: '#5c9ed4',
  dinner: '#f0985c',
} as const

function mealStructureAccent(mealKey: string): string {
  if (mealKey === 'breakfast' || mealKey === 'morning_snack') {
    return MEAL_STRUCTURE_COLORS.breakfast
  }
  if (mealKey === 'lunch' || mealKey === 'afternoon_snack' || mealKey === 'snack') {
    return MEAL_STRUCTURE_COLORS.lunch
  }
  if (mealKey === 'dinner' || mealKey === 'evening_snack') {
    return MEAL_STRUCTURE_COLORS.dinner
  }
  return MEAL_STRUCTURE_COLORS.breakfast
}

function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

type HeatmapCell = {
  date: string
  calories: number
  delta: number
  level: 1 | 2
  state: 'none' | 'surplus' | 'deficit'
}

type RiskTone = 'positive' | 'neutral' | 'warning' | 'danger'

type RiskCardModel = {
  key: string
  title: string
  score: number
  tone: RiskTone
  brief: string
  summary: string
  basis: string
  action: string
  delta: number
}

type RiskPreferenceItem = {
  key: string
  title: string
  short: string
}

const DEFAULT_RISK_KEYS = ['hypertension', 'diabetes', 'cardio', 'weight']
const RISK_PREF_STORAGE_KEY = 'stats_risk_focus_keys'

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function scoreToTone(score: number): RiskTone {
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

function scoreToTrendCopy(score: number): string {
  if (score >= 78) return '这段时间的饮食模式整体更偏向保护。'
  if (score >= 60) return '总体还算稳，但已经出现一些可逆转的拖累项。'
  if (score >= 42) return '最近的吃法已经在把你推向更高风险区。'
  return '如果继续这样吃，长期风险趋势会比较不友好。'
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

const WATER_GOAL_DEFAULT = 2000

type StoredBodyMetrics = {
  weightEntries: Array<{ date: string; value: number; recorded_at?: string }>
  waterByDate: Record<string, { date: string; total: number; logs: number[] }>
  waterGoalMl: number
}

function normalizeStoredBodyMetrics(raw: unknown): StoredBodyMetrics {
  const fallback: StoredBodyMetrics = {
    weightEntries: [],
    waterByDate: {},
    waterGoalMl: WATER_GOAL_DEFAULT,
  }

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const source = raw as Record<string, unknown>

  const weightEntries = Array.isArray(source.weightEntries)
    ? source.weightEntries
      .map(item => {
        if (!item || typeof item !== 'object') return null
        const obj = item as Record<string, unknown>
        const date = typeof obj.date === 'string' ? obj.date : ''
        const value = toSafeNumber(obj.value, NaN)
        const recordedAt = typeof obj.recorded_at === 'string' ? obj.recorded_at : undefined
        if (!date || !Number.isFinite(value)) return null
        return { date, value, recorded_at: recordedAt }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : []

  const waterByDate: StoredBodyMetrics['waterByDate'] = {}
  if (source.waterByDate && typeof source.waterByDate === 'object' && !Array.isArray(source.waterByDate)) {
    Object.entries(source.waterByDate as Record<string, unknown>).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return
      const obj = value as Record<string, unknown>
      const date = typeof obj.date === 'string' && obj.date ? obj.date : key
      const total = toSafeNumber(obj.total)
      const logs = Array.isArray(obj.logs)
        ? obj.logs
          .map(log => toSafeNumber(log, NaN))
          .filter(log => Number.isFinite(log))
        : []
      if (!date) return
      waterByDate[date] = { date, total, logs }
    })
  }

  const waterGoalMl = toSafeNumber(source.waterGoalMl, WATER_GOAL_DEFAULT)

  return {
    weightEntries,
    waterByDate,
    waterGoalMl,
  }
}

function getStoredBodyMetrics(): StoredBodyMetrics {
  try {
    return normalizeStoredBodyMetrics(Taro.getStorageSync('body_metrics_storage'))
  } catch {
    // ignore
  }
  return normalizeStoredBodyMetrics(null)
}

function hasAuthToken(): boolean {
  try {
    return Boolean(Taro.getStorageSync('access_token'))
  } catch {
    return false
  }
}

function StatsPage() {
  const { scheme } = useAppColorScheme()
  const [range, setRange] = useState<'week' | 'month'>('week')
  const rangeRef = useRef(range)
  rangeRef.current = range
  const [riskDetailModal, setRiskDetailModal] = useState<{ visible: boolean; card: RiskCardModel | null }>({ visible: false, card: null })

  // 自定义 tabBar 显隐同步：弹窗打开时隐藏底栏
  useEffect(() => {
    try {
      if (riskDetailModal.visible) {
        Taro.setStorageSync('stats_risk_detail_visible', '1')
      } else {
        Taro.removeStorageSync('stats_risk_detail_visible')
      }
    } catch {
      // ignore
    }
    return () => {
      try {
        Taro.removeStorageSync('stats_risk_detail_visible')
      } catch {
        // ignore
      }
    }
  }, [riskDetailModal.visible])
  const [selectedRiskKeys, setSelectedRiskKeys] = useState<string[]>(() => {
    try {
      const stored = Taro.getStorageSync(RISK_PREF_STORAGE_KEY)
      if (Array.isArray(stored)) {
        const cleaned = stored.map(item => String(item || '').trim()).filter(Boolean)
        return cleaned.length > 0 ? cleaned : DEFAULT_RISK_KEYS
      }
    } catch {
      // ignore
    }
    return DEFAULT_RISK_KEYS
  })
  const [riskPickerVisible, setRiskPickerVisible] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    heatmap: true,
    calories: false,
    macro: false,
    meals: false,
    streak: false,
    body: false,
    ai: false,
  })

  /** 静默联网刷新中（已有缓存展示时）：左上角微型 spinner，不占文档流 */
  const [dataSyncing, setDataSyncing] = useState(false)
  const [loading, setLoading] = useState(() => {
    if (!hasAuthToken()) return false
    return readStatsPageCache('week') === null
  })
  const [data, setData] = useState<StatsSummary | null>(() => {
    if (!hasAuthToken()) return null
    return readStatsPageCache('week')
  })
  const [error, setError] = useState<string | null>(null)
  /** 未登录：可进入分析 Tab 浏览引导，不拉取需登录接口 */
  const [guestBrowse, setGuestBrowse] = useState(() => !hasAuthToken())
  const [aiDisplayText, setAiDisplayText] = useState('')
  const typingTimerRef = useRef<any>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [insightActionLoading, setInsightActionLoading] = useState(false)
  const [insightError, setInsightError] = useState<string | null>(null)
  const [showCalories, setShowCalories] = useState(false)

  const fetchIdRef = useRef(0)
  const statsFirstShowRef = useRef(true)

  /**
   * 拉取分析页聚合数据；silent=true 时不顶掉界面（已有缓存时后台刷新并写盘）
   */
  const refreshFromNetwork = useCallback(async (r: 'week' | 'month', silent: boolean) => {
    const token = Taro.getStorageSync('access_token')
    if (!token) {
      setGuestBrowse(true)
      setData(null)
      setLoading(false)
      return
    }

    setGuestBrowse(false)
    const reqId = ++fetchIdRef.current

    if (!silent) {
      setLoading(true)
      setError(null)
    } else {
      setDataSyncing(true)
    }

    try {
      const [statsRes, bodyMetricsRes] = await Promise.all([
        getStatsSummary(r),
        getBodyMetricsSummary(r).catch(() => null),
      ])

      if (reqId !== fetchIdRef.current) return

      const cloudWeightEntries = Array.isArray(bodyMetricsRes?.weight_entries)
        ? bodyMetricsRes.weight_entries.filter(
          (entry): entry is BodyMetricWeightEntry => Boolean(entry && typeof entry.date === 'string'),
        )
        : []
      const cloudWaterDaily = Array.isArray(bodyMetricsRes?.water_daily)
        ? bodyMetricsRes.water_daily
          .filter((entry): entry is BodyMetricWaterDay => Boolean(entry && typeof entry.date === 'string'))
          .map(entry => ({
            date: entry.date,
            total: toSafeNumber(entry.total),
            logs: Array.isArray(entry.logs)
              ? entry.logs.map(log => toSafeNumber(log, NaN)).filter(log => Number.isFinite(log))
              : [],
          }))
        : []

      const hasCloudWeight = cloudWeightEntries.length > 0
      const hasCloudWater = cloudWaterDaily.some(d => toSafeNumber(d.total) > 0)

      const storedMetrics =
        !hasCloudWeight || !hasCloudWater ? getStoredBodyMetrics() : null

      const storedWeightEntries = (storedMetrics?.weightEntries || []).map(e => ({
        date: e.date,
        value: e.value,
        recorded_at: e.recorded_at,
      }))
      const storedWaterDaily = Object.values(storedMetrics?.waterByDate || {}).map(w => ({
        date: w.date,
        total: toSafeNumber(w.total),
        logs: Array.isArray(w.logs)
          ? w.logs.map(log => toSafeNumber(log, NaN)).filter(log => Number.isFinite(log))
          : [],
      }))

      const weightEntries = hasCloudWeight ? cloudWeightEntries : storedWeightEntries
      const waterDaily = hasCloudWater ? cloudWaterDaily : storedWaterDaily

      const totalWaterMl = waterDaily.reduce((sum: number, d) => sum + toSafeNumber(d.total), 0)
      const recordedDays = waterDaily.filter(d => toSafeNumber(d.total) > 0).length
      const avgDailyWaterMl = recordedDays > 0 ? Math.round(totalWaterMl / recordedDays) : 0

      const sortedWeight = [...weightEntries].sort((a, b) => `${b.date || ''}`.localeCompare(`${a.date || ''}`))
      const latestWeight = sortedWeight[0] || null
      const previousWeight = sortedWeight[1] || null
      const weightChange =
        latestWeight && previousWeight
          ? Math.round((latestWeight.value - previousWeight.value) * 10) / 10
          : null

      if (weightEntries.length > 0 || waterDaily.length > 0) {
        statsRes.body_metrics = {
          range: r,
          start_date: bodyMetricsRes?.start_date ?? '',
          end_date: bodyMetricsRes?.end_date ?? '',
          weight_trend_daily: bodyMetricsRes?.weight_trend_daily,
          weight_entries: weightEntries,
          latest_weight: latestWeight,
          previous_weight: previousWeight,
          weight_change: weightChange,
          water_daily: waterDaily,
          today_water: bodyMetricsRes?.today_water ?? {
            date: formatLocalDate(),
            total: 0,
            logs: [],
          },
          water_goal_ml: toSafeNumber(
            bodyMetricsRes?.water_goal_ml,
            storedMetrics?.waterGoalMl || WATER_GOAL_DEFAULT,
          ),
          total_water_ml: hasCloudWater ? (bodyMetricsRes?.total_water_ml || 0) : totalWaterMl,
          avg_daily_water_ml: hasCloudWater ? (bodyMetricsRes?.avg_daily_water_ml || 0) : avgDailyWaterMl,
          water_recorded_days: hasCloudWater ? (bodyMetricsRes?.water_recorded_days || 0) : recordedDays,
        }
      }

      setData(statsRes)
      writeStatsPageCache(r, statsRes)
      setError(null)
    } catch (e: unknown) {
      if (reqId !== fetchIdRef.current) return
      console.error('[stats] refreshFromNetwork failed:', e)
      const cached = readStatsPageCache(r)
      if (cached) {
        setData(cached)
        setError(null)
      } else if (!silent) {
        setError('获取统计失败，请稍后重试')
        await showUnifiedApiError(e, '获取统计失败')
      }
    } finally {
      if (reqId !== fetchIdRef.current) return
      if (!silent) {
        setLoading(false)
      } else {
        setDataSyncing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasAuthToken()) {
      setGuestBrowse(true)
      setLoading(false)
      return
    }
    setGuestBrowse(false)
    const cached = readStatsPageCache(range)
    if (cached) {
      setData(cached)
      setError(null)
      setLoading(false)
    } else {
      setLoading(true)
      setData(null)
    }
    void refreshFromNetwork(range, Boolean(cached))
  }, [range, refreshFromNetwork])

  useDidShow(() => {
    if (statsFirstShowRef.current) {
      statsFirstShowRef.current = false
      return
    }
    if (!hasAuthToken()) return
    void refreshFromNetwork(rangeRef.current, true)
  })

  const handleGenerateInsight = useCallback(async () => {
    if (!data || insightActionLoading) return

    setInsightActionLoading(true)
    setInsightError(null)
    try {
      const res = await generateStatsInsight(range)
      const full = (res.analysis_summary || '').trim()
      if (!full) throw new Error('AI 洞察生成失败')

      setData(prev => {
        if (!prev) return prev
        const next: StatsSummary = {
          ...prev,
          analysis_summary: full,
          analysis_summary_generated_date: formatLocalDate(),
          analysis_summary_needs_refresh: false,
        }
        writeStatsPageCache(range, next)
        return next
      })

      try {
        await saveStatsInsight(range, full)
      } catch (saveError) {
        console.error('保存 AI 洞察失败:', saveError)
      }

      Taro.showToast({
        title: '洞察已更新',
        icon: 'success'
      })
    } catch (e: unknown) {
      const message = (e as Error).message || 'AI 洞察生成失败，请稍后重试'
      setInsightError(message)
      await showUnifiedApiError(e, 'AI 洞察生成失败')
    } finally {
      setInsightActionLoading(false)
    }
  }, [data, insightActionLoading, range])

  // AI 洞察打字机效果：当 analysis_summary 从空变为非空时，按字符逐步显示
  useEffect(() => {
    const full = data?.analysis_summary || ''

    // 如果还没有洞察，清空显示并停止打字
    if (!full) {
      setAiDisplayText('')
      setIsTyping(false)
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
      return
    }

    // 已经完全展示，无需重新打字
    if (aiDisplayText === full && !isTyping) {
      return
    }

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current)
      typingTimerRef.current = null
    }

    let index = 0
    const step = 2 // 每次输出的字符数
    setAiDisplayText('')
    setIsTyping(true)

    const timer = setInterval(() => {
      index += step
      if (index >= full.length) {
        setAiDisplayText(full)
        setIsTyping(false)
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current)
          typingTimerRef.current = null
        }
      } else {
        setAiDisplayText(full.slice(0, index))
      }
    }, 40)

    typingTimerRef.current = timer

    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
    // 只在后端完整洞察文本变化时重新触发打字
  }, [data?.analysis_summary])

  if (guestBrowse) {
    return (
      <View className='stats-page stats-page--guest'>
        <View className='stats-guest-card'>
          <Text className='stats-guest-title'>登录后查看饮食分析</Text>
          <Text className='stats-guest-desc'>可先浏览首页热量与营养概览，需要账号同步时再登录</Text>
          <View className='stats-guest-btn' onClick={() => redirectToLogin()}>
            <Text className='stats-guest-btn-text'>去登录</Text>
          </View>
        </View>
      </View>
    )
  }

  if (loading && !data) {
    return (
      <View className='stats-page'>
        <View className='loading-wrap'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  if (error && !data) {
    return (
      <View className='stats-page'>
        <View className='error-wrap'>
          <Text className='iconfont icon-jiesuo error-icon' />
          <Text className='error-text'>{error}</Text>
          <View className='btn-primary' onClick={() => void refreshFromNetwork(range, false)}>
            <Text className='btn-text'>重试</Text>
          </View>
        </View>
      </View>
    )
  }

  const d = data!
  const totalCalories = toSafeNumber(d.total_calories)
  const tdee = toSafeNumber(d.tdee)
  const avgCaloriesPerDay = toSafeNumber(d.avg_calories_per_day)
  const totalProtein = toSafeNumber(d.total_protein)
  const totalCarbs = toSafeNumber(d.total_carbs)
  const totalFat = toSafeNumber(d.total_fat)
  const hasInsight = Boolean(d.analysis_summary?.trim())
  const insightGeneratedDate = d.analysis_summary_generated_date || ''
  const insightNeedsRefresh = Boolean(d.analysis_summary_needs_refresh)
  const displayInsightText = aiDisplayText || (hasInsight && !isTyping ? d.analysis_summary : '')
  const bodyMetrics = d.body_metrics
  const macroPercent = {
    protein: toSafeNumber(d.macro_percent?.protein),
    carbs: toSafeNumber(d.macro_percent?.carbs),
    fat: toSafeNumber(d.macro_percent?.fat)
  }
  const byMeal = {
    breakfast: toSafeNumber(d.by_meal?.breakfast),
    morning_snack: toSafeNumber(d.by_meal?.morning_snack),
    lunch: toSafeNumber(d.by_meal?.lunch),
    afternoon_snack: toSafeNumber(d.by_meal?.afternoon_snack ?? d.by_meal?.snack),
    dinner: toSafeNumber(d.by_meal?.dinner),
    evening_snack: toSafeNumber(d.by_meal?.evening_snack)
  } as const
  const chartDays = range === 'week' ? d.daily_calories.slice(-7) : d.daily_calories.slice(-14)

  // Calculate max calories for the chart scaling
  const maxDailyCalories = d.daily_calories.length > 0
    ? Math.max(...d.daily_calories.map(i => i.calories))
    : 2000
  const weightTrend = bodyMetrics?.weight_entries || []
  const latestWeight = bodyMetrics?.latest_weight || null
  const previousWeight = bodyMetrics?.previous_weight || null
  const weightChange = bodyMetrics?.weight_change
  const waterDaily = bodyMetrics?.water_daily || []
  const waterGoalMl = toSafeNumber(bodyMetrics?.water_goal_ml, 2000)
  const avgDailyWaterMl = toSafeNumber(bodyMetrics?.avg_daily_water_ml)
  const totalWaterMl = toSafeNumber(bodyMetrics?.total_water_ml)
  const waterRecordedDays = toSafeNumber(bodyMetrics?.water_recorded_days)
  const waterTrend = range === 'week' ? waterDaily.slice(-7) : waterDaily.slice(-14)
  const maxWaterValue = waterTrend.length > 0
    ? Math.max(waterGoalMl, ...waterTrend.map(item => toSafeNumber(item.total)))
    : waterGoalMl
  const heatmapCells: HeatmapCell[] = d.daily_calories.map((item) => {
    const hasRecord = item.calories > 0
    const delta = hasRecord ? item.calories - tdee : 0
    const deltaRatio = hasRecord ? Math.abs(delta) / Math.max(tdee, 1) : 0
    const level: HeatmapCell['level'] = deltaRatio > 0.15 ? 2 : 1

    return {
      date: item.date,
      calories: item.calories,
      delta,
      level,
      state: !hasRecord ? 'none' : delta > 0 ? 'surplus' : 'deficit'
    }
  })
  const recordedDays = d.daily_calories.filter(item => toSafeNumber(item.calories) > 0).length
  const surplusDays = heatmapCells.filter(item => item.calories > 0 && item.delta > 0).length
  const surplusRate = recordedDays > 0 ? surplusDays / recordedDays : 0
  const breakfastCombined = byMeal.breakfast + byMeal.morning_snack
  const dinnerCombined = byMeal.dinner + byMeal.evening_snack
  const snackCombined = byMeal.morning_snack + byMeal.afternoon_snack + byMeal.evening_snack
  const breakfastPct = totalCalories > 0 ? (breakfastCombined / totalCalories) * 100 : 0
  const dinnerPct = totalCalories > 0 ? (dinnerCombined / totalCalories) * 100 : 0
  const snackPct = totalCalories > 0 ? (snackCombined / totalCalories) * 100 : 0
  const energyOverRatio = tdee > 0 ? Math.max(0, avgCaloriesPerDay - tdee) / tdee : 0
  const carbGap = Math.max(0, macroPercent.carbs - 50)
  const fatGap = Math.max(0, macroPercent.fat - 32)
  const proteinGap = Math.max(0, 20 - macroPercent.protein)
  const dinnerPenalty = Math.max(0, dinnerPct - 38)
  const snackPenalty = Math.max(0, snackPct - 18)

  const hypertensionScore = clampScore(
    82
    - surplusRate * 18
    - dinnerPenalty * 0.8
    - snackPenalty * 0.45
    - energyOverRatio * 26
    + (breakfastPct >= 18 ? 3 : 0)
  )
  const diabetesScore = clampScore(
    80
    - carbGap * 1.25
    - proteinGap * 1.4
    - surplusRate * 16
    - snackPenalty * 0.65
    + (macroPercent.protein >= 20 && macroPercent.protein <= 30 ? 4 : 0)
  )
  const cardioScore = clampScore(
    79
    - fatGap * 1.15
    - surplusRate * 14
    - dinnerPenalty * 0.7
    - energyOverRatio * 20
    + (macroPercent.protein >= 18 && macroPercent.protein <= 28 ? 3 : 0)
  )
  const weightScore = clampScore(
    78
    - energyOverRatio * 38
    - surplusRate * 22
    - snackPenalty * 0.45
    - Math.max(0, dinnerPct - 40) * 0.55
    + (recordedDays >= (range === 'week' ? 5 : 18) ? 4 : 0)
  )
  const overallRiskScore = clampScore((hypertensionScore + diabetesScore + cardioScore + weightScore) / 4)
  const projectedOverallScore = clampScore(
    overallRiskScore
    + (surplusRate > 0.45 ? 8 : 0)
    + (dinnerPct > 40 ? 7 : 0)
    + (macroPercent.protein < 20 ? 6 : 0)
    + (macroPercent.carbs > 50 ? 5 : 0)
  )
  const overallTrendLabel = scoreToLabel(overallRiskScore)
  const overviewCopy = scoreToTrendCopy(overallRiskScore)
  const signalChips = [
    { label: '已记录', value: `${recordedDays} 天` },
    { label: '超出消耗', value: `${surplusDays} 天` },
    { label: '晚餐热量占比', value: formatPercent(dinnerPct) },
    { label: '连续记录', value: `${d.streak_days} 天` },
  ]
  const riskCards: RiskCardModel[] = [
    {
      key: 'hypertension',
      title: '血压管理友好度',
      score: hypertensionScore,
      tone: scoreToTone(hypertensionScore),
      brief: dinnerPct > 40 ? '晚间负担偏重。' : '分布基本可控。',
      summary: dinnerPct > 40
        ? '晚餐与夜间热量偏集中，长期更容易把饮食结构推向不友好区。'
        : '热量分布还算可控，但仍需避免把超标集中压在晚餐。',
      basis: `最近 ${recordedDays} 天里有 ${surplusDays} 天摄入高于消耗，晚餐/夜间占比 ${formatPercent(dinnerPct)}。`,
      action: dinnerPct > 40 ? '把晚餐主食或高油部分前移一部分到早餐/午餐。' : '继续维持白天优先，避免晚间补偿性进食。',
      delta: clampScore((dinnerPct > 40 ? 12 : 7) + (surplusRate > 0.45 ? 6 : 0)),
    },
    {
      key: 'diabetes',
      title: '血糖稳定友好度',
      score: diabetesScore,
      tone: scoreToTone(diabetesScore),
      brief: macroPercent.carbs > 50 ? '主食偏重，支撑偏弱。' : '代谢压力暂时可控。',
      summary: macroPercent.carbs > 50
        ? '当前主要拖累是碳水占比偏高，同时蛋白质支撑不足。'
        : '代谢结构不算差，但还可以把蛋白质和饱腹感做得更稳。',
      basis: `碳水 ${formatPercent(macroPercent.carbs)}，蛋白质 ${formatPercent(macroPercent.protein)}，加餐热量占比 ${formatPercent(snackPct)}。`,
      action: macroPercent.carbs > 50
        ? '把一部分主食换成蛋白质或蔬菜，先从最常超标的一餐改起。'
        : '保留当前主食量的同时，每餐补一个更稳定的蛋白来源。',
      delta: clampScore((macroPercent.carbs > 50 ? 12 : 8) + (macroPercent.protein < 20 ? 6 : 0)),
    },
    {
      key: 'cardio',
      title: '心血管友好度',
      score: cardioScore,
      tone: scoreToTone(cardioScore),
      brief: macroPercent.fat > 32 ? '高油频率偏多。' : '整体还在中性区。',
      summary: macroPercent.fat > 32
        ? '脂肪占比和连续超标频率一起拖累了心血管保护趋势。'
        : '总体还在可接受区，但连续超标天数已经开始拉低长期保护感。',
      basis: `脂肪 ${formatPercent(macroPercent.fat)}，超出消耗天数 ${surplusDays}/${recordedDays}，晚餐占比 ${formatPercent(dinnerPct)}。`,
      action: macroPercent.fat > 32
        ? '优先减少最常出现的高油菜和夜间加餐，不必一次性大幅节食。'
        : '先把每周最容易超标的 2-3 餐压下来，保护分会更明显回升。',
      delta: clampScore((macroPercent.fat > 32 ? 10 : 7) + (surplusRate > 0.45 ? 5 : 0)),
    },
    {
      key: 'weight',
      title: '体重管理友好度',
      score: weightScore,
      tone: scoreToTone(weightScore),
      brief: energyOverRatio > 0.08 ? '重复超标在累积。' : '总量接近目标。',
      summary: energyOverRatio > 0.08
        ? '平均摄入已经高于当前消耗，体重管理压力主要来自重复性超标。'
        : '热量总体接近目标，但餐次集中和加餐结构仍有优化空间。',
      basis: `日均摄入 ${avgCaloriesPerDay.toFixed(0)} kcal，对比 TDEE ${tdee.toFixed(0)} kcal；连续记录 ${d.streak_days} 天。`,
      action: energyOverRatio > 0.08
        ? '先把最常超标的一餐减少约 1/4 主食或高油部分，再观察 1 周。'
        : '保持总量不大改，优先优化晚餐和加餐的时段分布。',
      delta: clampScore((energyOverRatio > 0.08 ? 13 : 8) + (dinnerPct > 40 ? 5 : 0)),
    },
    {
      key: 'colorectal',
      title: '肠道状态友好度',
      score: clampScore(
        76
        - fatGap * 0.9
        - carbGap * 0.45
        - snackPenalty * 0.6
        - surplusRate * 10
        + (macroPercent.protein >= 18 && macroPercent.protein <= 28 ? 4 : 0)
      ),
      tone: scoreToTone(clampScore(
        76
        - fatGap * 0.9
        - carbGap * 0.45
        - snackPenalty * 0.6
        - surplusRate * 10
        + (macroPercent.protein >= 18 && macroPercent.protein <= 28 ? 4 : 0)
      )),
      brief: snackPct > 18 ? '结构偏散，重复性偏高。' : '整体还算整齐。',
      summary: snackPct > 18
        ? '加餐偏多、结构偏散时，长期饮食质量通常会被一点点拖低。'
        : '这段时间的饮食结构还算整齐，但仍要警惕高油高精制主食的重复出现。',
      basis: `加餐占比 ${formatPercent(snackPct)}，脂肪 ${formatPercent(macroPercent.fat)}，连续超标 ${surplusDays}/${recordedDays} 天。`,
      action: '优先减少最容易重复出现的重油重加工那一类餐食，让整体结构更干净。',
      delta: clampScore((snackPct > 18 ? 9 : 6) + (fatGap > 0 ? 4 : 0)),
    },
    {
      key: 'longevity',
      title: '长期状态趋势',
      score: clampScore(
        78
        - energyOverRatio * 24
        - surplusRate * 15
        - dinnerPenalty * 0.55
        - fatGap * 0.75
        - carbGap * 0.55
        + (recordedDays >= (range === 'week' ? 5 : 18) ? 5 : 0)
      ),
      tone: scoreToTone(clampScore(
        78
        - energyOverRatio * 24
        - surplusRate * 15
        - dinnerPenalty * 0.55
        - fatGap * 0.75
        - carbGap * 0.55
        + (recordedDays >= (range === 'week' ? 5 : 18) ? 5 : 0)
      )),
      brief: surplusRate > 0.45 ? '重复性问题在拖分。' : '长期趋势还能再修。',
      summary: surplusRate > 0.45
        ? '拖累长期趋势的，不是某一顿，而是反复出现的超标和晚间集中。'
        : '只要继续把主要问题控制住，这段时间的长期趋势还有往上修的空间。',
      basis: `已记录 ${recordedDays} 天，超出消耗 ${surplusDays} 天，晚餐/夜间占比 ${formatPercent(dinnerPct)}。`,
      action: '先把重复出现的问题降频，比偶尔一次“吃得特别完美”更有用。',
      delta: clampScore((surplusRate > 0.45 ? 10 : 7) + (recordedDays >= (range === 'week' ? 5 : 18) ? 3 : 0)),
    },
  ]
  const allRiskOptions: RiskPreferenceItem[] = [
    { key: 'hypertension', title: '血压管理友好度', short: '血压' },
    { key: 'diabetes', title: '血糖稳定友好度', short: '血糖' },
    { key: 'cardio', title: '心血管友好度', short: '心血管' },
    { key: 'weight', title: '体重管理友好度', short: '体重' },
    { key: 'colorectal', title: '肠道状态友好度', short: '肠道' },
    { key: 'longevity', title: '长期状态趋势', short: '长期' },
  ]
  const selectedRiskItems = selectedRiskKeys
    .map(key => allRiskOptions.find(item => item.key === key))
    .filter((item): item is RiskPreferenceItem => Boolean(item))
  const orderedRiskOptions = [
    ...selectedRiskItems,
    ...allRiskOptions.filter(item => !selectedRiskKeys.includes(item.key)),
  ]
  const visibleRiskCards = selectedRiskKeys
    .map(key => riskCards.find(card => card.key === key))
    .filter((card): card is RiskCardModel => Boolean(card))
  const selectedRiskSummary = selectedRiskItems.map(item => item.short).join('、')
  const topIssues = [
    ...(surplusRate > 0.45 ? [{ title: '连续超出消耗', detail: `${surplusDays}/${recordedDays} 天摄入高于 TDEE` }] : []),
    ...(dinnerPct > 40 ? [{ title: '晚餐过于集中', detail: `晚餐与夜间占全天 ${formatPercent(dinnerPct)}` }] : []),
    ...(macroPercent.carbs > 50 ? [{ title: '碳水占比偏高', detail: `当前碳水占比 ${formatPercent(macroPercent.carbs)}` }] : []),
    ...(macroPercent.protein < 20 ? [{ title: '蛋白质支撑偏弱', detail: `当前蛋白质占比 ${formatPercent(macroPercent.protein)}` }] : []),
    ...(snackPct > 18 ? [{ title: '加餐热量偏多', detail: `加餐已占全天 ${formatPercent(snackPct)}` }] : []),
  ].slice(0, 3)
  const minimalActions = [
    ...(surplusRate > 0.45 ? ['先把每周最容易超标的 2-3 餐压下来，不求每餐都完美。'] : []),
    ...(dinnerPct > 40 ? ['把晚餐的一部分主食或高油菜前移到早餐/午餐。'] : []),
    ...(macroPercent.carbs > 50 ? ['主食先减 1/4，补一份更稳定的蛋白质或蔬菜。'] : []),
    ...(macroPercent.protein < 20 ? ['每餐固定补一个蛋白来源，先从早餐或午餐开始。'] : []),
  ]
  const actionList = minimalActions.length > 0
    ? minimalActions.slice(0, 3)
    : ['先保持记录连续 1 周，再根据超标天数和晚餐占比做微调。']

  const openDayRecordPage = (date: string) => {
    if (!date) return
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${encodeURIComponent(date)}` })
  }

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const toggleRiskPreference = (riskKey: string) => {
    setSelectedRiskKeys(prev => {
      const exists = prev.includes(riskKey)
      const next = exists ? prev.filter(item => item !== riskKey) : [...prev, riskKey]
      const normalized = next.length > 0 ? next : [riskKey]
      try {
        Taro.setStorageSync(RISK_PREF_STORAGE_KEY, normalized)
      } catch {
        // ignore
      }
      if (riskDetailModal.card?.key === riskKey && exists) {
        setRiskDetailModal(prev => ({ ...prev, card: null }))
      }
      return normalized
    })
  }

  return (
    <View className='stats-page'>
      {dataSyncing ? (
        <View className='stats-page__data-sync'>
          <View className='stats-page__data-sync-spinner' />
        </View>
      ) : null}
      <ScrollView className='scroll-wrap' scrollY enhanced showScrollbar={false}>
        <View className='tabs-container'>
          <View className={`segmented-control ${loading ? 'is-loading' : ''}`}>
            {loading && (
              <View className='tabs-loading'>
                <View className='loading-spinner-md' />
              </View>
            )}
            <View
              className={`segment-item ${range === 'week' ? 'active' : ''}`}
              onClick={() => !loading && setRange('week')}
            >
              <Text>近一周</Text>
            </View>
            <View
              className={`segment-item ${range === 'month' ? 'active' : ''}`}
              onClick={() => !loading && setRange('month')}
            >
              <Text>近一月</Text>
            </View>
          </View>
        </View>

        <View className='stats-card risk-overview-card'>
          <View className='risk-overview-top'>
            <View className='risk-overview-copy'>
              <Text className='risk-overview-title'>{range === 'week' ? '最近 7 天' : '最近 30 天'}饮食健康参考指数</Text>
              <Text className='risk-overview-subtitle'>
                用更直观的方式看清这段时间的吃法，正在保护你，还是在慢慢消耗你。
              </Text>
            </View>
            <View className={`risk-overview-badge tone-${scoreToTone(overallRiskScore)}`}>
              <Text className='risk-overview-badge-label'>{overallTrendLabel}</Text>
            </View>
          </View>

          <View className='risk-overview-score-row'>
            <Text className='risk-overview-score'>{overallRiskScore}</Text>
            <Text className='risk-overview-score-unit'>/ 100</Text>
          </View>

          <Text className='risk-overview-summary'>{overviewCopy}</Text>

          <View className='risk-overview-chip-row'>
            {signalChips.map((chip) => (
              <View key={chip.label} className='risk-overview-chip'>
                <Text className='risk-overview-chip-label'>{chip.label}</Text>
                <Text className='risk-overview-chip-value'>{chip.value}</Text>
              </View>
            ))}
          </View>

          <View className='risk-overview-footer'>
            <Text className='risk-overview-footer-text'>
              如果先改掉当前最明显的 1-2 个拖累项，预计总分可从 {overallRiskScore} 提升到 {projectedOverallScore}。
            </Text>
            <Text className='risk-overview-footer-note'>结果仅供参考，用于观察饮食趋势，不代替医学判断。</Text>
          </View>
        </View>

        <View className='stats-card risk-manage-card'>
          <View className='card-header card-header--collapsible' onClick={() => setRiskPickerVisible(prev => !prev)}>
            <View className='card-header-copy'>
              <Text className='card-title'>我的关注</Text>
              <Text className='card-subtitle'>只显示你现在更想留意的健康方向</Text>
            </View>
            <View className='card-header-arrow'>{riskPickerVisible ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {riskPickerVisible ? (
            <View className='card-collapsible-content'>
              <View className='risk-picker-summary'>
                <Text className='risk-picker-summary__count'>已关注 {selectedRiskItems.length} 项</Text>
                <Text className='risk-picker-summary__text'>点一下就能添加或移除，默认至少保留 1 项。</Text>
              </View>
              <View className='risk-picker-grid'>
                {orderedRiskOptions.map((item) => {
                  const active = selectedRiskKeys.includes(item.key)
                  return (
                    <View
                      key={item.key}
                      className={`risk-picker-chip ${active ? 'active' : ''}`}
                      onClick={() => toggleRiskPreference(item.key)}
                    >
                      <Text className='risk-picker-chip__title'>{item.title}</Text>
                      <Text className='risk-picker-chip__action'>{active ? '显示中' : '点按添加'}</Text>
                    </View>
                  )
                })}
              </View>
            </View>
          ) : (
            <View className='card-collapsed-preview'>
              <Text className='card-collapsed-preview__text'>
                已关注 {selectedRiskItems.length} 项：{selectedRiskSummary}
              </Text>
            </View>
          )}
        </View>

        <View className='risk-card-grid'>
          {visibleRiskCards.map((card) => (
            <View
              key={card.key}
              className={`stats-card risk-card tone-${card.tone}`}
              onClick={() => setRiskDetailModal({ visible: true, card })}
            >
              <View className='risk-card-top'>
                <View className='risk-card-title-wrap'>
                  <Text className='risk-card-title'>{card.title}</Text>
                  <Text className='risk-card-summary'>{card.brief}</Text>
                </View>
                <View className='risk-card-score-wrap'>
                  <Text className='risk-card-score'>{card.score}</Text>
                  <Text className='risk-card-score-unit'>分</Text>
                </View>
              </View>
              <View className='risk-card-more-btn'>
                <Text className='risk-card-more-text'>查看更多</Text>
              </View>
            </View>
          ))}
        </View>

        {/* 友好度详情底部弹窗 */}
        {riskDetailModal.visible && riskDetailModal.card && (
          <View
            className='risk-detail-modal'
            onClick={() => setRiskDetailModal({ visible: false, card: null })}
          >
            <View className='risk-detail-backdrop' />
            <View
              className='risk-detail-panel'
              onClick={(e) => e.stopPropagation()}
            >
              <View className='risk-detail-handle' />
              <View className='risk-detail-header'>
                <Text className='risk-detail-title'>{riskDetailModal.card.title}</Text>
                <View className='risk-detail-score-row'>
                  <Text className='risk-detail-score'>{riskDetailModal.card.score}</Text>
                  <Text className='risk-detail-score-unit'>分</Text>
                  <View className={`risk-detail-badge tone-${riskDetailModal.card.tone}`}>
                    <Text className='risk-detail-badge-text'>{scoreToLabel(riskDetailModal.card.score)}</Text>
                  </View>
                </View>
              </View>
              <View className='risk-detail-body'>
                <Text className='risk-detail-section-text'>{riskDetailModal.card.summary}</Text>
                <View className='risk-detail-divider' />
                <Text className='risk-detail-section-label'>判断依据</Text>
                <Text className='risk-detail-section-text'>{riskDetailModal.card.basis}</Text>
                <View className='risk-detail-divider' />
                <Text className='risk-detail-section-label'>最小改善动作</Text>
                <Text className='risk-detail-section-text'>{riskDetailModal.card.action}</Text>
                <View className='risk-detail-delta'>
                  <Text className='risk-detail-delta-text'>预计可提升 {riskDetailModal.card.delta} 分</Text>
                </View>
              </View>
              <View
                className='risk-detail-close-btn'
                onClick={() => setRiskDetailModal({ visible: false, card: null })}
              >
                <Text className='risk-detail-close-text'>知道了</Text>
              </View>
            </View>
          </View>
        )}

        <View className='stats-card action-plan-card'>
          <View className='card-header action-plan-card__header'>
            <View className='card-header-copy'>
              <Text className='card-title'>这段时间最值得先改的地方</Text>
              <Text className='card-subtitle'>别同时改十件事，先动最拖分的 1-2 个动作</Text>
            </View>
            <View className='action-plan-card__score'>
              <Text className='action-plan-card__score-before'>{overallRiskScore}</Text>
              <Text className='action-plan-card__arrow'>→</Text>
              <Text className='action-plan-card__score-after'>{projectedOverallScore}</Text>
            </View>
          </View>

          <View className='action-plan-grid'>
            <View className='action-plan-panel'>
              <Text className='action-plan-panel__title'>当前主要拖累项</Text>
              {topIssues.length > 0 ? (
                topIssues.map((issue) => (
                  <View key={issue.title} className='action-plan-item'>
                    <Text className='action-plan-item__bullet'>•</Text>
                    <View className='action-plan-item__copy'>
                      <Text className='action-plan-item__title'>{issue.title}</Text>
                      <Text className='action-plan-item__detail'>{issue.detail}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text className='action-plan-panel__empty'>当前没有特别突出的单一问题，重点保持稳定记录和小幅优化。</Text>
              )}
            </View>

            <View className='action-plan-panel action-plan-panel--green'>
              <Text className='action-plan-panel__title'>建议你先这样改</Text>
              {actionList.map((action) => (
                <View key={action} className='action-plan-item'>
                  <Text className='action-plan-item__bullet'>•</Text>
                  <View className='action-plan-item__copy'>
                    <Text className='action-plan-item__title'>{action}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View className='stats-card analysis-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('ai')}>
            <View className='card-header-copy'>
              <Text className='card-title'>AI 风险解读</Text>
              <Text className='card-subtitle'>用于把统计结果翻译成更容易理解的长期趋势结论</Text>
            </View>
            <View className='card-header-actions'>
              <View className='card-header-arrow'>{expandedSections.ai ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
            </View>
          </View>
          {expandedSections.ai ? (
            <View className='card-collapsible-content'>
              <View className='ai-disclaimer'>
                <Text className='ai-disclaimer-text'>本页表达的是饮食相关风险趋势，不构成医学诊断或治疗建议。</Text>
              </View>
              {insightGeneratedDate ? (
                <View className={`analysis-status${insightNeedsRefresh ? ' warning' : ''}`}>
                  <Text className='analysis-status-text'>
                    {insightNeedsRefresh
                      ? `当前展示的是 ${insightGeneratedDate} 生成的缓存，你最近新增了饮食记录，可按需手动更新。`
                      : `当前展示的是 ${insightGeneratedDate} 生成的缓存。`}
                  </Text>
                </View>
              ) : null}
              {insightError ? (
                <View className='analysis-error'>
                  <Text className='analysis-error-text'>{insightError}</Text>
                </View>
              ) : null}
              {displayInsightText ? (
                <Text className='analysis-content'>{displayInsightText}</Text>
              ) : insightActionLoading || isTyping ? (
                <View className='analysis-loading'>
                  <Text className='iconfont icon-jiazaixiao analysis-loading-icon' />
                  <Text className='analysis-loading-text'>
                    {insightActionLoading ? 'AI 正在生成当前统计周期的营养洞察，请稍候...' : '正在展示已生成的洞察...'}
                  </Text>
                </View>
              ) : (
                <View className='analysis-empty'>
                  <Text className='analysis-empty-text'>这里不会在每次打开页面时自动重新分析。你可以在需要时手动生成一次。</Text>
                  <View className='analysis-empty-action' onClick={handleGenerateInsight}>
                    <Text className='analysis-empty-action-text'>生成本{range === 'week' ? '周' : '月'}洞察</Text>
                  </View>
                </View>
              )}
            </View>
          ) : (
            <View className='card-collapsed-preview'>
              <Text className='card-collapsed-preview__text'>
                {displayInsightText
                  ? `${displayInsightText.slice(0, 46)}${displayInsightText.length > 46 ? '...' : ''}`
                  : `点开查看本${range === 'week' ? '周' : '月'}的风险解读`}
              </Text>
            </View>
          )}
        </View>

        <View className='stats-section-head'>
          <Text className='stats-section-head__title'>支撑证据</Text>
          <Text className='stats-section-head__subtitle'>需要时再点开，不把所有数据一次堆给你</Text>
        </View>

        {range === 'week' ? (
          <View className='stats-card evidence-card'>
            <View className='card-header card-header--collapsible' onClick={() => toggleSection('heatmap')}>
              <View className='card-header-copy'>
                <Text className='card-title'>每日记录分布</Text>
                <Text className='card-subtitle'>点击有记录的日期，可继续查看当天吃了什么</Text>
              </View>
              <View className='card-header-arrow'>{expandedSections.heatmap ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
            </View>
            {expandedSections.heatmap ? (
              <View className='card-collapsible-content'>
                <View className='date-selector-section date-selector-section--embedded'>
                  <View className='date-list'>
                    {heatmapCells.slice(-7).map((item) => {
                      let circleClass = 'is-empty'
                      if (item.calories > 0) {
                        circleClass = item.state === 'surplus' ? 'is-over' : 'is-recorded'
                      }

                      const date = new Date(`${item.date}T12:00:00`)
                      const dayNames = ['日', '一', '二', '三', '四', '五', '六']
                      const dayName = dayNames[date.getDay()]
                      const dayNum = item.date.slice(-2).replace(/^0/, '')

                      return (
                        <View
                          key={item.date}
                          className={`date-item ${item.calories > 0 ? 'is-clickable' : ''}`}
                          onClick={() => item.calories > 0 && openDayRecordPage(item.date)}
                        >
                          <Text className='date-day-name'>{dayName}</Text>
                          <View className={`date-day-circle ${circleClass}`}>
                            <Text className='date-num-text'>{dayNum}</Text>
                          </View>
                        </View>
                      )
                    })}
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View className='stats-card heatmap-card evidence-card'>
            <View className='card-header card-header--collapsible' onClick={() => toggleSection('heatmap')}>
              <View className='card-header-copy'>
                <Text className='card-title'>本月记录分布</Text>
                <Text className='card-subtitle'>点击任意有记录的日期，可继续查看当天吃了什么</Text>
              </View>
              <View className='card-header-arrow'>{expandedSections.heatmap ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
            </View>
            {expandedSections.heatmap ? (
              <View className='card-collapsible-content'>
                <View className='heatmap-grid month-view'>
                  {heatmapCells.slice(-30).map((item) => {
                    let circleClass = 'is-empty'
                    if (item.calories > 0) {
                      circleClass = item.state === 'surplus' ? 'is-over' : 'is-recorded'
                    }

                    return (
                      <View key={item.date} className='chart-col'>
                        <View
                          className={`heatmap-cell ${circleClass} ${item.calories > 0 ? 'is-clickable' : ''}`}
                          onClick={() => item.calories > 0 && openDayRecordPage(item.date)}
                        >
                          <Text className='heatmap-cell-label'>{item.date.slice(-2)}</Text>
                          <View className='heatmap-cell-dot' />
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            ) : null}
          </View>
        )}

        <View className='stats-card chart-card evidence-card'>
          <View className='card-header chart-card-header card-header--collapsible' onClick={() => toggleSection('calories')}>
            <View className='chart-title-group'>
              <Text className='iconfont icon-shangzhang chart-title-icon' />
              <View className='card-header-copy'>
                <Text className='card-title'>热量证据</Text>
                <Text className='card-subtitle'>{range === 'week' ? '最近 7 天' : '最近 14 天'}摄入趋势，用于识别反复超标</Text>
              </View>
            </View>
            <View className='card-header-actions'>
              <View className='card-header-arrow'>{expandedSections.calories ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
            </View>
          </View>
          {expandedSections.calories ? (
            <View className='card-collapsible-content'>
              <View style={{ marginBottom: '20rpx' }}>
                <View className='chart-switch-wrap' onClick={(e) => e.stopPropagation()}>
                  <Text className='chart-switch-label'>显示数值</Text>
                  <Switch
                    className='chart-switch'
                    checked={showCalories}
                    onChange={(v: any) => setShowCalories(Boolean(typeof v === 'object' ? v?.detail?.value : v))}
                    style={{ '--switch-checked-background-color': '#5cb896' } as CSSProperties}
                  />
                </View>
              </View>
              {chartDays.length > 0 ? (
                <View className='bar-chart-container'>
                  {chartDays.map((item) => {
                    const heightPct = Math.max((item.calories / maxDailyCalories) * 100, 10)
                    return (
                      <View key={item.date} className='chart-col'>
                        {showCalories ? (
                          <Text className='bar-calorie-text'>{Math.round(item.calories)}</Text>
                        ) : null}
                        <View className='bar-wrapper'>
                          <View
                            className={`bar-fill ${item.calories > tdee ? 'over' : ''}`}
                            style={{ height: `${heightPct}%` }}
                          />
                        </View>
                        <Text className='bar-label'>{item.date.slice(5)}</Text>
                      </View>
                    )
                  })}
                </View>
              ) : (
                <View className='chart-empty-state'>
                  <Text className='empty-text'>暂无数据</Text>
                </View>
              )}
            </View>
          ) : null}
        </View>

        <View className='stats-card macro-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('macro')}>
            <Text className='iconfont icon-tianpingzuo chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>宏量结构证据</Text>
              <Text className='card-subtitle'>当前草案主要用它来解释代谢稳定和心血管保护倾向</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.macro ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.macro ? (
            <View className='card-collapsible-content'>
              <View className='macro-list'>
                <View className='macro-row'>
                  <View className='macro-info'>
                    <View className='macro-label-wrap'>
                      <Text className='iconfont icon-danbaizhi macro-icon protein' />
                      <Text className='macro-name'>蛋白质</Text>
                    </View>
                    <Text className='macro-detail'>{totalProtein.toFixed(0)}g / {macroPercent.protein}%</Text>
                  </View>
                  <View className='progress-track'>
                    <View className='progress-fill protein' style={{ width: `${clampPercent(macroPercent.protein)}%` }}></View>
                  </View>
                </View>

                <View className='macro-row'>
                  <View className='macro-info'>
                    <View className='macro-label-wrap'>
                      <Text className='iconfont icon-tanshui-dabiao macro-icon carbs' />
                      <Text className='macro-name'>碳水化合物</Text>
                    </View>
                    <Text className='macro-detail'>{totalCarbs.toFixed(0)}g / {macroPercent.carbs}%</Text>
                  </View>
                  <View className='progress-track'>
                    <View className='progress-fill carbs' style={{ width: `${clampPercent(macroPercent.carbs)}%` }}></View>
                  </View>
                </View>

                <View className='macro-row'>
                  <View className='macro-info'>
                    <View className='macro-label-wrap'>
                      <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin macro-icon fat' />
                      <Text className='macro-name'>脂肪</Text>
                    </View>
                    <Text className='macro-detail'>{totalFat.toFixed(0)}g / {macroPercent.fat}%</Text>
                  </View>
                  <View className='progress-track'>
                    <View className='progress-fill fat' style={{ width: `${clampPercent(macroPercent.fat)}%` }}></View>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card meal-structure-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('meals')}>
            <Text className='iconfont icon-canciguanli chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>餐次分布证据</Text>
              <Text className='card-subtitle'>当前草案重点关注有没有把热量过度堆在晚餐和夜间</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.meals ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.meals ? (
            <View className='card-collapsible-content'>
              <View className='meal-gauges-grid'>
                {(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'] as const).map((key) => {
                  const cal = byMeal[key]
                  const pct = totalCalories > 0 ? (cal / totalCalories) * 100 : 0
                  const MealIcon = MEAL_ICONS[key]
                  const color = mealStructureAccent(key)
                  const trackColor = scheme === 'dark' ? '#2f353a' : '#f0f0f0'
                  const radius = 43
                  const circumference = 2 * Math.PI * radius
                  const progress = Math.min(pct / 100, 1)

                  return (
                    <View key={key} className='meal-gauge-item'>
                      <View className='meal-gauge-left'>
                        <View className='meal-gauge-icon-wrap' style={{ backgroundColor: `${color}14` }}>
                          <MealIcon size={20} color={color} />
                        </View>
                        <Text className='meal-gauge-label'>{MEAL_NAMES[key]}</Text>
                        <Text className='meal-gauge-percent' style={{ color }}>{pct.toFixed(1)}%</Text>
                      </View>

                      <View className='meal-gauge-right'>
                        <View className='meal-gauge-circle'>
                          <View
                            className='meal-gauge-ring'
                            style={{
                              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                                `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='${radius}' fill='none' stroke='${trackColor}' stroke-width='12'/><circle cx='50' cy='50' r='${radius}' fill='none' stroke='${color}' stroke-width='12' stroke-linecap='round' stroke-dasharray='${circumference}' stroke-dashoffset='${circumference * (1 - progress)}'/></svg>`
                              )}")`,
                              backgroundSize: '100% 100%'
                            }}
                          />
                          <View className='meal-gauge-center'>
                            <Text className='meal-gauge-cal' style={{ color }}>{Math.round(cal)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card streak-card evidence-card'>
          <View className='card-header card-header--collapsible streak-card__header' onClick={() => toggleSection('streak')}>
            <View className='streak-card__header-left'>
              <View className='streak-icon'>
                <Text className='iconfont icon-huore streak-icon-font' />
              </View>
              <View className='streak-content'>
                <Text className='streak-title'>连续记录</Text>
                <View className='streak-number-row'>
                  <Text className='streak-num'>{d.streak_days}</Text>
                  <Text className='streak-suffix'>天</Text>
                </View>
              </View>
            </View>
            <View className='card-header-arrow'>{expandedSections.streak ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.streak ? (
            <View className='card-collapsible-content'>
              <View className='streak-card__expanded'>
                <View className='streak-badge'>
                  行为稳定性证据
                </View>
                <Text className='streak-card__expanded-text'>连续记录本身不代表吃得更健康，但它会让你更容易发现哪些问题在重复发生。</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card body-metrics-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('body')}>
            <Text className='iconfont icon-shangzhang chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>长期健康指标</Text>
              <Text className='card-subtitle'>这部分不直接决定饮食风险分，但可以帮助观察长期结果</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.body ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.body ? (
            <View className='card-collapsible-content'>
              <View className='body-metrics-grid'>
                <View className='body-metric-panel'>
                  <View className='body-metric-panel-header'>
                    <Text className='body-metric-title'>体重趋势</Text>
                    {latestWeight ? (
                      <Text className='body-metric-main'>
                        {latestWeight.value.toFixed(1)} kg
                      </Text>
                    ) : (
                      <Text className='body-metric-empty'>还没有云端体重记录</Text>
                    )}
                  </View>
                  {latestWeight ? (
                    <Text className='body-metric-sub'>
                      {previousWeight
                        ? `${weightChange && weightChange > 0 ? '+' : ''}${toSafeNumber(weightChange).toFixed(1)} kg，较上次`
                        : '已开始累计体重趋势'}
                    </Text>
                  ) : null}
                  {weightTrend.length > 0 ? (
                    <View className='weight-chip-row'>
                      {weightTrend.slice(-(range === 'week' ? 7 : 10)).map((item) => (
                        <View key={item.date} className='weight-chip'>
                          <Text className='weight-chip-date'>{item.date.slice(5)}</Text>
                          <Text className='weight-chip-value'>{item.value.toFixed(1)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>

                <View className='body-metric-panel water-panel'>
                  <View className='body-metric-panel-header'>
                    <Text className='body-metric-title'>喝水趋势</Text>
                    <Text className='body-metric-main'>
                      {avgDailyWaterMl.toFixed(0)} ml
                    </Text>
                  </View>
                  <Text className='body-metric-sub'>
                    日均 {avgDailyWaterMl.toFixed(0)} ml，目标 {waterGoalMl} ml，累计 {totalWaterMl.toFixed(0)} ml
                  </Text>
                  {waterTrend.length > 0 ? (
                    <View className='water-trend-chart'>
                      {waterTrend.map((item) => {
                        const pct = maxWaterValue > 0 ? Math.max((toSafeNumber(item.total) / maxWaterValue) * 100, 8) : 8
                        return (
                          <View key={item.date} className='water-trend-col'>
                            <View className='water-trend-bar-wrap'>
                              <View className='water-trend-bar' style={{ height: `${pct}%` }} />
                            </View>
                            <Text className='water-trend-label'>{item.date.slice(5)}</Text>
                          </View>
                        )
                      })}
                    </View>
                  ) : null}
                  <View className='water-metric-footer'>
                    <Text className='water-metric-note'>
                      {waterRecordedDays > 0 ? `已有 ${waterRecordedDays} 天饮水记录` : '还没有云端喝水记录'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View className='footer-placeholder' />
      </ScrollView>
    </View>
  )
}

export default withAuth(StatsPage, { public: true })
