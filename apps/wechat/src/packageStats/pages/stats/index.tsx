import { View, Text, ScrollView, Switch, Image } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { readStatsPageCache, writeStatsPageCache } from '../../../utils/stats-page-cache'
import { showDietDecisionEvidence } from '../../../utils/diet-decision-evidence'
import {
  getStatsSummary,
  getBodyMetricsSummary,
  generateCustomFocusCard,
  getAnalyzeTask,
  getNutritionState,
  saveHealthFocusKeys,
  showUnifiedApiError,
  type StatsSummary,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay,
  type DailyNutritionState,
  type RiskCard,
  type RiskOption,
} from '../../../utils/api'
import {
  applyEngineFocus,
  coverageLines,
  evidenceGapViews,
  evidenceRoute,
  normalizeNutritionState,
  overallDelta,
  scoreToTone,
  splitWeekDeltas,
  weekCountText,
  weekDayLabels,
  weekHabitRows,
  type EvidenceGapView,
} from '../../../utils/nutrition-state-view'
import {
  localFocusKeys,
  MAX_HEALTH_FOCUS,
  resolveFocusKeys,
  sameKeys,
  splitFocusCards,
} from './focus-selection'
import {
  EvidenceGapsCard,
  FocusSpotlightCard,
  WeekHabitsCard,
  type FocusSpotlightItem,
} from '../../../components/StatsNutritionState'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { FocusSheet } from '../../../components/FocusSheet'
import { builtinFocusLabel } from '../../../components/FocusSheet/focus-options'
import { experiments } from '../../../utils/experiments'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  customFocusCardFromTask,
  readPendingCustomFocusTasks,
  removePendingCustomFocusTask,
  savePendingCustomFocusTask,
  type PendingCustomFocusTask,
} from '../../../utils/custom-focus-task'
import { IconExpand, IconCollapse } from '../../../components/iconfont'
import healthScoreForest from '../../../assets/stats/health-score-forest.webp'
import './index.scss'
import { withAuth, redirectToLogin } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '上午加餐',
  lunch: '午餐',
  afternoon_snack: '下午加餐',
  dinner: '晚餐',
  evening_snack: '晚间加餐',
  snack: '下午加餐'
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

// 「饮食解读」（AI 风险解读）已去掉，由宠物每天那句话和宠物聊天替代。
// 分析页只管回头看：今天还差什么、宠物那句话都在底栏「伙伴」页，这里不再重复。
type AnalysisPanelKey = 'health' | 'structure'

function analysisPanelTabs(range: 'week' | 'month'): Array<{ key: AnalysisPanelKey; label: string }> {
  return [
    { key: 'health', label: range === 'week' ? '本周' : '本月' },
    { key: 'structure', label: '趋势' },
  ]
}

/** 关注以服务器为准；这两个本地键只做离线兜底和“还没传上去”的标记 */
const RISK_PREF_STORAGE_KEY = 'stats_risk_focus_keys'
const RISK_PREF_PENDING_KEY = 'stats_risk_focus_pending'

function readStoredFocus(): unknown {
  try {
    return Taro.getStorageSync(RISK_PREF_STORAGE_KEY)
  } catch {
    return undefined
  }
}

function writeStoredFocus(keys: string[]): void {
  try {
    Taro.setStorageSync(RISK_PREF_STORAGE_KEY, keys)
  } catch {
    // ignore
  }
}

function readFocusPending(): boolean {
  try {
    return Taro.getStorageSync(RISK_PREF_PENDING_KEY) === '1'
  } catch {
    return false
  }
}

function writeFocusPending(pending: boolean): void {
  try {
    if (pending) Taro.setStorageSync(RISK_PREF_PENDING_KEY, '1')
    else Taro.removeStorageSync(RISK_PREF_PENDING_KEY)
  } catch {
    // ignore
  }
}

function isCustomRiskKey(key: string): boolean {
  return String(key || '').startsWith('custom:')
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function scoreToLabel(score: number): string {
  if (score >= 78) return '偏保护'
  if (score >= 60) return '基本中性'
  if (score >= 42) return '需要关注'
  return '重点关注'
}

function customFocusConfidenceLabel(confidence?: string): string {
  switch (confidence) {
    case 'high': return '高置信度'
    case 'medium': return '中置信度'
    case 'low': return '低置信度'
    default: return '证据待补充'
  }
}

function customFocusScoreChangeLabel(change?: number): string {
  if (typeof change !== 'number' || !Number.isFinite(change)) return ''
  if (change > 0) return `较上次 +${change}`
  if (change < 0) return `较上次 ${change}`
  return '与上次持平'
}

function scoreToFocusOverview(score: number, hasCustomFocus: boolean): string {
  if (score >= 78) {
    return hasCustomFocus
      ? '你当前关注的指标整体更偏向保护，自定义方向也会跟随卡片一起纳入参考。'
      : '你当前关注的核心指标整体更偏向保护。'
  }
  if (score >= 60) {
    return hasCustomFocus
      ? '你当前关注的指标总体还算稳，但自定义方向和核心指标里已经有一些可优化项。'
      : '你当前关注的核心指标总体还算稳，但已经出现一些可优化项。'
  }
  if (score >= 42) {
    return hasCustomFocus
      ? '你当前关注的指标已经出现明显拖累，建议优先处理分数最低的关注项。'
      : '你当前关注的核心指标已经出现明显拖累，建议优先处理分数最低的一项。'
  }
  return hasCustomFocus
    ? '你当前关注的指标处在较高压力区，先从最可执行的一项小步调整。'
    : '你当前关注的核心指标处在较高压力区，先从最可执行的一项小步调整。'
}

function riskCardIcon(key: string): string {
  switch (key) {
    case 'hypertension': return 'tianpingzuo'
    case 'diabetes': return 'tanshui-dabiao'
    case 'cardio': return 'dumbbell'
    case 'weight': return 'weight-scale'
    case 'colorectal': return 'a-144-lvye'
    case 'longevity': return 'shangzhang'
    case 'micronutrient': return 'yiliaohangyedeICON-'
    default: return 'target'
  }
}



function customRiskCardToOption(card: RiskCard): RiskOption {
  return {
    key: card.key,
    title: card.focus_label || card.title,
    short: card.focus_label || card.title,
    is_custom: true,
  }
}

function pendingCustomRiskCardFromOption(option: RiskOption): RiskCard {
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

/** 开发版专用：接口上线前在 DevTools 里写这个 storage（对象或 JSON 字符串）就用它代替接口 */
const DEV_NUTRITION_STATE_MOCK_KEY = 'dev_stats_nutrition_state_mock'

/** 开发版 mock 生效时关注也不写服务器，免得在模拟器里改到线上账号 */
function devNutritionMock(): unknown {
  if (!__ENABLE_DEV_DEBUG_UI__) return null
  try {
    const mock = Taro.getStorageSync(DEV_NUTRITION_STATE_MOCK_KEY)
    if (!mock) return null
    return typeof mock === 'string' ? JSON.parse(mock) : mock
  } catch {
    // 坏的 mock 当没有
    return null
  }
}

async function loadNutritionState(): Promise<DailyNutritionState | null> {
  const mock = devNutritionMock()
  if (mock) return normalizeNutritionState(mock)
  return normalizeNutritionState(await getNutritionState())
}

function StatsPage() {
  const { scheme } = useAppColorScheme()
  const [range, setRange] = useState<'week' | 'month'>('week')
  const [analysisPanel, setAnalysisPanel] = useState<AnalysisPanelKey>('health')
  const rangeRef = useRef(range)
  rangeRef.current = range
  const [riskDetailModal, setRiskDetailModal] = useState<{ visible: boolean; card: RiskCard | null }>({ visible: false, card: null })
  const [riskPickerVisible, setRiskPickerVisible] = useState(false)
  const [overviewExpanded, setOverviewExpanded] = useState(false)
  const [actionsExpanded, setActionsExpanded] = useState(false)
  const [issuesExpanded, setIssuesExpanded] = useState(false)
  const [othersExpanded, setOthersExpanded] = useState(false)
  const [mealValuesInCalories, setMealValuesInCalories] = useState(false)

  // 二级页用原生导航栏（带返回），颜色跟着深浅色
  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8f6e9', darkBackground: '#161f1b' })
  }, [scheme])
  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8f6e9', darkBackground: '#161f1b' })
  })

  // 自定义 tabBar 显隐同步：弹窗打开时隐藏底栏
  useEffect(() => {
    try {
      if (riskDetailModal.visible || riskPickerVisible) {
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
  }, [riskDetailModal.visible, riskPickerVisible])
  // 服务器的关注到之前先用本机存的（最多 3 项）；没存过就是还没选
  const [selectedRiskKeys, setSelectedRiskKeys] = useState<string[]>(() => localFocusKeys(readStoredFocus()) ?? [])
  const selectedRiskKeysRef = useRef(selectedRiskKeys)
  selectedRiskKeysRef.current = selectedRiskKeys
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    heatmap: true,
    calories: true,
    macro: true,
    meals: true,
    streak: false,
    body: false,
    ai: false,
  })

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
  const [showCalories, setShowCalories] = useState(false)
  const [customFocusRefreshingKey, setCustomFocusRefreshingKey] = useState<string | null>(null)

  const fetchIdRef = useRef(0)
  const refreshPendingRef = useRef<Partial<Record<'week' | 'month', number>>>({})
  const statsFirstShowRef = useRef(true)
  const statsPageVisibleRef = useRef(true)
  const customFocusPollingTaskIdsRef = useRef<Set<string>>(new Set())
  const [nutritionState, setNutritionState] = useState<DailyNutritionState | null>(null)
  const nutritionSeqRef = useRef(0)
  const nutritionShownOnceRef = useRef(false)
  const [statsShowCount, setStatsShowCount] = useState(0)

  const focusSaveRef = useRef<{ saving: boolean; queued: string[] | null }>({ saving: false, queued: null })
  const focusEditSeqRef = useRef(0)

  useDidShow(() => {
    statsPageVisibleRef.current = true
    setStatsShowCount(count => count + 1)
  })

  /** 把关注整体写到服务器；正在写时只记下最新的一份，写完再补一次。失败就留在本机，下次打开补传 */
  const pushFocusToServer = useCallback(async (keys: string[]) => {
    const box = focusSaveRef.current
    if (box.saving) {
      box.queued = keys
      return
    }
    box.saving = true
    let next: string[] | null = keys
    while (next) {
      const sending: string[] = next
      box.queued = null
      try {
        await saveHealthFocusKeys(sending)
        writeFocusPending(false)
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode
        console.warn('[stats] save focus failed:', e)
        if (status === 400) {
          // 服务器明确拒绝（不认识的 key、别人的自定义关注…）：不再补传，下次打开以服务器为准
          writeFocusPending(false)
          if (!box.queued) Taro.showToast({ title: (e as Error).message || '保存关注失败', icon: 'none' })
        } else {
          // 网络错误、旧后端 404、5xx：留在本机，下次打开补传，不打扰
          writeFocusPending(true)
        }
      }
      next = box.queued
    }
    box.saving = false
  }, [])

  /** 引擎的每日营养状态；和统计接口互不影响，失败（含旧后端 404）时新模块整块不显示 */
  const refreshNutritionState = useCallback(async () => {
    if (!hasAuthToken()) {
      setNutritionState(null)
      return
    }
    const seq = ++nutritionSeqRef.current
    const editSeqAtStart = focusEditSeqRef.current
    const state = await loadNutritionState().catch((e: unknown) => {
      console.warn('[stats] nutrition state unavailable:', e)
      return null
    })
    if (seq !== nutritionSeqRef.current) return
    setNutritionState(state)
    // 拉取期间用户改过关注，以用户刚改的为准
    if (focusEditSeqRef.current !== editSeqAtStart) return
    const resolution = resolveFocusKeys({
      serverFocus: state?.focus,
      localStored: readStoredFocus(),
      pendingLocal: readFocusPending(),
    })
    if (!sameKeys(resolution.keys, selectedRiskKeysRef.current)) {
      selectedRiskKeysRef.current = resolution.keys
      setSelectedRiskKeys(resolution.keys)
    }
    if (state?.focus) writeStoredFocus(resolution.keys)
    if (resolution.pushToServer && !devNutritionMock()) void pushFocusToServer(resolution.keys)
  }, [pushFocusToServer])

  useEffect(() => {
    void refreshNutritionState()
  }, [refreshNutritionState])

  useDidShow(() => {
    // 第一次显示由上面的挂载加载负责；之后回到本页（比如刚记完一餐）再刷新
    if (nutritionShownOnceRef.current) void refreshNutritionState()
    nutritionShownOnceRef.current = true
  })

  useEffect(() => {
    if (statsShowCount === 0 || guestBrowse) return
    experiments.track('stats_view', { tab: analysisPanel })
  }, [analysisPanel, guestBrowse, statsShowCount])
  useDidHide(() => {
    statsPageVisibleRef.current = false
  })
  useEffect(() => () => {
    statsPageVisibleRef.current = false
  }, [])

  /**
   * 拉取分析页聚合数据；silent=true 时不顶掉界面（已有缓存时后台刷新并写盘）
   */
  const refreshFromNetwork = useCallback(async (r: 'week' | 'month', silent: boolean) => {
    if (refreshPendingRef.current[r] !== undefined) return

    const token = Taro.getStorageSync('access_token')
    if (!token) {
      setGuestBrowse(true)
      setData(null)
      setLoading(false)
      return
    }

    setGuestBrowse(false)
    const reqId = ++fetchIdRef.current
    refreshPendingRef.current[r] = reqId

    if (!silent) {
      setLoading(true)
      setError(null)
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
            ...entry,
            date: entry.date,
            total: toSafeNumber(entry.total),
            logs: Array.isArray(entry.logs)
              ? entry.logs.map(log => toSafeNumber(log, NaN)).filter(log => Number.isFinite(log))
              : [],
            log_items: Array.isArray(entry.log_items)
              ? entry.log_items.map(item => ({
                  ...item,
                  amount_ml: toSafeNumber(item.amount_ml),
                }))
              : undefined,
          }))
        : []

      const hasCloudWeight = cloudWeightEntries.length > 0
      const hasCloudWater = Boolean(bodyMetricsRes && Array.isArray(bodyMetricsRes.water_daily))

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

      if (bodyMetricsRes || weightEntries.length > 0 || waterDaily.length > 0) {
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
      if (refreshPendingRef.current[r] === reqId) {
        delete refreshPendingRef.current[r]
      }
      if (reqId !== fetchIdRef.current) return
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  /** 「我在意的」弹窗已经写好服务器：这里只同步页面和本机，再拉一次新的分数和自定义关注 */
  const handleFocusSheetSaved = useCallback((next: string[]) => {
    setRiskPickerVisible(false)
    focusEditSeqRef.current += 1
    selectedRiskKeysRef.current = next
    setSelectedRiskKeys(next)
    writeStoredFocus(next)
    writeFocusPending(false)
    void refreshFromNetwork(rangeRef.current, true)
    void refreshNutritionState()
  }, [refreshFromNetwork, refreshNutritionState])

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

  const mergeCustomFocusCard = useCallback((card: RiskCard) => {
    setData(prev => {
      if (!prev?.health_index) return prev
      const existing = prev.health_index.custom_risk_cards ?? []
      const nextCustom = [
        card,
        ...existing.filter(item => item.key !== card.key),
      ]
      const existingOptions = prev.health_index.all_risk_options ?? []
      const nextCustomOption = customRiskCardToOption(card)
      const nextOptions = existingOptions.some(item => item.key === card.key)
        ? existingOptions.map(item => item.key === card.key ? { ...item, ...nextCustomOption } : item)
        : [...existingOptions, nextCustomOption]
      const next: StatsSummary = {
        ...prev,
        health_index: {
          ...prev.health_index,
          custom_risk_cards: nextCustom,
          all_risk_options: nextOptions,
        },
      }
      writeStatsPageCache(range, next)
      return next
    })
  }, [range])

  const pollCustomFocusTask = useCallback(async (pending: PendingCustomFocusTask) => {
    if (customFocusPollingTaskIdsRef.current.has(pending.taskId)) return
    customFocusPollingTaskIdsRef.current.add(pending.taskId)
    if (statsPageVisibleRef.current) setCustomFocusRefreshingKey(pending.focusKey)
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (!statsPageVisibleRef.current) return
        const task = await getAnalyzeTask(pending.taskId)
        if (!readPendingCustomFocusTasks().some(item => item.taskId === pending.taskId)) return
        if (task.status === 'done') {
          const card = customFocusCardFromTask(task)
          removePendingCustomFocusTask(pending.taskId)
          if (!card) throw new Error('后台任务已完成，但没有返回关注卡片')
          if (pending.range === rangeRef.current && statsPageVisibleRef.current) {
            mergeCustomFocusCard(card)
            setRiskDetailModal(prev => prev.card?.key === card.key ? { ...prev, card } : prev)
            Taro.showToast({ title: '卡片已更新', icon: 'success' })
          }
          void refreshFromNetwork(pending.range, true)
          return
        }
        if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
          removePendingCustomFocusTask(pending.taskId)
          throw new Error('后台更新失败，请稍后重试')
        }
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      if (statsPageVisibleRef.current) {
        Taro.showToast({ title: '仍在后台更新，可稍后回来查看', icon: 'none' })
      }
    } catch (e: unknown) {
      if (statsPageVisibleRef.current) {
        await showUnifiedApiError(e, '刷新 AI 卡片失败')
      }
    } finally {
      customFocusPollingTaskIdsRef.current.delete(pending.taskId)
      setCustomFocusRefreshingKey(prev => prev === pending.focusKey ? null : prev)
    }
  }, [mergeCustomFocusCard, refreshFromNetwork])

  useDidShow(() => {
    readPendingCustomFocusTasks().forEach(task => {
      void pollCustomFocusTask(task)
    })
  })

  const handleRefreshCustomFocus = useCallback(async (card: RiskCard) => {
    if (!card.is_custom || customFocusRefreshingKey) return
    const focusId = card.key.replace(/^custom:/, '')
    if (!focusId) return
    setCustomFocusRefreshingKey(card.key)
    try {
      const genRes = await generateCustomFocusCard(range, focusId)
      if (genRes.status === 'done' && genRes.card) {
        mergeCustomFocusCard(genRes.card)
        setRiskDetailModal({ visible: true, card: genRes.card })
        setCustomFocusRefreshingKey(null)
        Taro.showToast({ title: '卡片已更新', icon: 'success' })
        return
      }
      if (!genRes.task_id) throw new Error('服务器未返回后台任务编号')
      const pendingTask: PendingCustomFocusTask = {
        taskId: genRes.task_id,
        range,
        focusId,
        focusKey: card.key,
        createdAt: Date.now(),
      }
      savePendingCustomFocusTask(pendingTask)
      Taro.showToast({ title: '已在后台更新，可离开此页', icon: 'none' })
      void pollCustomFocusTask(pendingTask)
    } catch (e: unknown) {
      setCustomFocusRefreshingKey(null)
      await showUnifiedApiError(e, '刷新 AI 卡片失败')
    }
  }, [customFocusRefreshingKey, mergeCustomFocusCard, pollCustomFocusTask, range])

  // 周期切换只重置展示状态，不改变个人关注、缓存或生成规则。
  useEffect(() => {
    setOverviewExpanded(false)
    setActionsExpanded(false)
    setIssuesExpanded(false)
    setMealValuesInCalories(false)
    setRiskPickerVisible(false)
    setRiskDetailModal({ visible: false, card: null })
  }, [range])

  if (guestBrowse) {
    return (
      <View className={`stats-page stats-page--guest ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
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
      <View className={`stats-page ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
        <View className='loading-wrap'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  if (error && !data) {
    return (
      <View className={`stats-page ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
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
  const recordedDays = Math.max(0, toSafeNumber(d.recorded_days, 0))
  const hasAnyDietData = recordedDays > 0
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
  const maxDailyCalories = Math.max(tdee, ...chartDays.map(i => Math.max(toSafeNumber(i.calories), toSafeNumber(i.target?.snapshot.targets.calorie_target))), 1) * 1.12
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
  const weightChartEntries = weightTrend.slice(-(range === 'week' ? 7 : 10))
  const weightChartValues = weightChartEntries.map(item => toSafeNumber(item.value))
  const weightChartMin = weightChartValues.length > 0 ? Math.min(...weightChartValues) : 0
  const weightChartMax = weightChartValues.length > 0 ? Math.max(...weightChartValues) : 0
  const weightChartRange = Math.max(weightChartMax - weightChartMin, 1)
  const weightChartPoints = weightChartEntries.map((item, index) => {
    const x = weightChartEntries.length <= 1
      ? 300
      : 32 + (index / (weightChartEntries.length - 1)) * 536
    const y = 154 - ((toSafeNumber(item.value) - weightChartMin) / weightChartRange) * 112
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const weightChartGridColor = scheme === 'dark' ? '#2f3d39' : '#e2e8f0'
  const weightChartSvg = weightChartEntries.length > 1
    ? `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 180'><line x1='32' y1='42' x2='568' y2='42' stroke='${weightChartGridColor}' stroke-width='2'/><line x1='32' y1='98' x2='568' y2='98' stroke='${weightChartGridColor}' stroke-width='2'/><line x1='32' y1='154' x2='568' y2='154' stroke='${weightChartGridColor}' stroke-width='2'/><polyline points='${weightChartPoints}' fill='none' stroke='#5cb896' stroke-width='8' stroke-linecap='round' stroke-linejoin='round'/></svg>`
    )}")`
    : ''
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
  const healthIndex = d.health_index
  const hasEnoughHealthIndexData = healthIndex?.has_enough_data ?? false
  const ns = nutritionState
  // 引擎的分数按本周算，只在「近一周」替换综合分和关注分；「近一个月」仍用 health_index
  const engineWeek = ns && range === 'week' ? ns : null
  const engineOverallScore = engineWeek?.scores.overall ?? null
  const engineOverallDelta = engineWeek && engineOverallScore !== null ? overallDelta(engineWeek.scores) : null
  const engineCoverageLines = engineWeek ? coverageLines(engineWeek.coverage) : []
  const overallRiskScore = engineOverallScore ?? healthIndex?.overall_score ?? 0
  const projectedOverallScore = healthIndex?.projected_score ?? 0
  const signalChips = healthIndex?.signal_chips ?? []
  const engineFocus = engineWeek?.scores.focus ?? []
  const riskCards = applyEngineFocus(healthIndex?.risk_cards ?? [], engineFocus)
  const weekRows = ns ? weekHabitRows(ns.week) : []
  const weekCounts = ns ? ns.week.counts.map(weekCountText) : []
  const weekDeltas = ns ? splitWeekDeltas(ns.week.vs_last_week) : { headline: null, rest: [] }
  const showWeekCard = weekRows.length > 0 || weekCounts.length > 0 || weekDeltas.headline !== null
  const evidenceGaps = ns ? evidenceGapViews(ns.evidence_gaps) : []

  const openEvidenceGap = (gap: EvidenceGapView) => {
    experiments.track('stats_evidence_click', { action: gap.action })
    const route = evidenceRoute(gap.action, ns?.date || formatLocalDate())
    if (!route) return
    if (route.kind === 'tab') void Taro.switchTab({ url: route.url })
    else void Taro.navigateTo({ url: extraPkgUrl(route.url) })
  }
  const openRiskDetail = (card: RiskCard) => {
    experiments.track('stats_focus_open', { key: card.is_custom ? 'custom' : card.key })
    setRiskDetailModal({ visible: true, card })
  }
  const customRiskCards = healthIndex?.custom_risk_cards ?? []
  const allDisplayRiskCards = [...riskCards, ...customRiskCards]
  const customFocusMeta = healthIndex?.custom_focus_meta
  const customFocusCost = customFocusMeta?.generate_cost ?? 1
  const allRiskOptions = (() => {
    const base = healthIndex?.all_risk_options ?? []
    const seen = new Set<string>()
    const merged: RiskOption[] = []
    base.forEach(item => {
      if (!item.key || seen.has(item.key)) return
      seen.add(item.key)
      merged.push(item)
    })
    customRiskCards.forEach(card => {
      if (!card.key || seen.has(card.key)) return
      seen.add(card.key)
      merged.push(customRiskCardToOption(card))
    })
    return merged
  })()
  // 选了但还没生成卡片的自定义关注，先放一张待生成的卡
  const pendingFocusCards = selectedRiskKeys
    .filter(key => isCustomRiskKey(key) && !allDisplayRiskCards.some(card => card.key === key))
    .map(key => allRiskOptions.find(item => item.key === key))
    .filter((option): option is RiskOption => Boolean(option?.is_custom))
    .map(pendingCustomRiskCardFromOption)
  const { focusCards, otherCards } = splitFocusCards([...allDisplayRiskCards, ...pendingFocusCards], selectedRiskKeys)
  const isPendingRiskCard = (card: RiskCard) => Boolean(card.is_custom && !customRiskCards.some(item => item.key === card.key))
  const hasRiskScore = (card: RiskCard) => !isPendingRiskCard(card) && card.score_available !== false
  const hasVisibleCustomFocus = focusCards.some(card => card.is_custom)
  const focusItems: FocusSpotlightItem[] = focusCards.map(card => ({
    key: card.key,
    title: builtinFocusLabel(card.key) || card.title,
    iconClass: `icon-${riskCardIcon(card.key)}`,
    scoreText: hasRiskScore(card) ? String(card.score) : '—',
    tone: hasRiskScore(card) ? scoreToTone(card.score) : 'pending',
    reason: card.brief,
    evidence: card.evidence ?? [],
    badge: card.is_custom ? (card.score_available === false ? '支持建议' : '支持参考') : '',
    refreshing: customFocusRefreshingKey === card.key,
  }))
  const focusOverallScore = overallRiskScore
  const focusProjectedScore = projectedOverallScore
  const focusOverviewCopy = scoreToFocusOverview(focusOverallScore, hasVisibleCustomFocus)
  const focusScoreHint = hasVisibleCustomFocus
    ? '仅纳入可评分的支持参考；旧专项分已停用，不代表身体变化'
    : '基于已记录数据的应用参考，不代表身体健康评分'
  const topIssues = healthIndex?.top_issues ?? []
  const actionList = Array.from(new Set([
    ...(d.diet_decision_basis?.food_group_priorities?.length ? d.diet_decision_basis.actions : []),
    ...(healthIndex?.action_list ?? []),
  ]))
  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const openRangeSelector = () => {
    if (loading) return
    Taro.showActionSheet({
      itemList: ['近一周', '近一个月'],
    }).then(res => {
      const nextRange = res.tapIndex === 1 ? 'month' : 'week'
      if (nextRange !== rangeRef.current) {
        setRange(nextRange)
      }
    }).catch(() => {
      // 用户取消选择
    })
  }

  const openFocusItem = (key: string) => {
    const card = focusCards.find(item => item.key === key)
    if (card) openRiskDetail(card)
  }

  return (
    <View className={`stats-page stats-page--editorial ${scheme === 'dark' ? 'stats-page--dark' : ''}`}>
      {/* 标题在原生导航栏里；周期选择和分页签放同一行 */}
      <View className='analysis-tabs-container'>
        <View
          className={`stats-range-dropdown ${loading ? 'is-loading' : ''}`}
          onClick={openRangeSelector}
        >
          <Text className='stats-range-dropdown__label'>{range === 'week' ? '近一周' : '近一个月'}</Text>
          <Text className='iconfont icon-right-arrow stats-range-dropdown__arrow' />
        </View>
        <View className={`segmented-control analysis-panel-control ${loading ? 'is-loading' : ''}`}>
          {analysisPanelTabs(range).map(item => (
            <View
              key={item.key}
              className={`segment-item ${analysisPanel === item.key ? 'active' : ''}`}
              aria-role='button'
              aria-label={`${item.label}${analysisPanel === item.key ? '，已选中' : ''}`}
              onClick={() => { if (!loading) setAnalysisPanel(item.key) }}
            >
              <Text>{item.label}</Text>
            </View>
          ))}
          {loading ? <View className='tabs-loading'><View className='loading-spinner-md' /></View> : null}
        </View>
      </View>
      <ScrollView className='scroll-wrap' scrollY={!riskPickerVisible && !riskDetailModal.visible} enhanced showScrollbar={false}>
        {error && data ? <View className='analysis-error'><Text>{error}</Text></View> : null}
        {analysisPanel === 'health' && hasEnoughHealthIndexData ? (
          <FocusSpotlightCard
            items={focusItems}
            maxCount={MAX_HEALTH_FOCUS}
            footnote={engineFocus.length > 0 ? '分数按钠、糖、纤维等营养素和你的目标算，点开能看到全部依据。' : ''}
            onOpen={openFocusItem}
            onManage={() => setRiskPickerVisible(true)}
          />
        ) : null}
        {analysisPanel === 'health' && !hasEnoughHealthIndexData ? (
          <View className='stats-card health-index-gate-card'>
            <View className='health-index-gate-icon'>
              <Text className='iconfont icon-shangzhang health-index-gate-icon-text' />
            </View>
            <View className='health-index-gate-copy'>
              <Text className='health-index-gate-title'>记录至少 2 天后显示饮食参考分</Text>
              <Text className='health-index-gate-desc'>
                当前已记录 {recordedDays} 天。继续记录后，这里会展示饮食趋势和关注方向。
              </Text>
            </View>
          </View>
        ) : analysisPanel === 'health' ? (
          <>
            <View className='stats-card risk-overview-card'>
              <Image className='risk-overview-background' src={healthScoreForest} mode='aspectFill' aria-hidden />
              <View className='risk-overview-top'>
                <View className='risk-overview-copy'>
                  <View className='risk-overview-title-line'>
                    <Text className='risk-overview-title'>饮食综合分</Text>
                    <View className='stats-info-button' aria-role='button' aria-label='查看综合分依据' onClick={() => setOverviewExpanded(value => !value)}>
                      <Text className='iconfont icon-target' />
                    </View>
                  </View>
                </View>
                <View className='risk-overview-actions'>
                  <View className={`risk-overview-badge tone-${scoreToTone(focusOverallScore)}`}>
                    <Text className='risk-overview-badge-label'>{scoreToLabel(focusOverallScore)}</Text>
                  </View>
                </View>
              </View>

              <View className='risk-overview-compact-row'>
                <View className='risk-overview-score-column'>
                  <View className='risk-overview-score-row'>
                    <Text className='risk-overview-score'>{focusOverallScore}</Text>
                    <Text className='risk-overview-score-unit'>/ 100</Text>
                  </View>
                  <View className='risk-overview-scale' aria-hidden>
                    <View className='risk-overview-scale-track'>
                      <View className='risk-overview-scale-fill' style={{ width: `${clampPercent(focusOverallScore)}%` }} />
                    </View>
                    <View className='risk-overview-scale-labels'><Text>0</Text><Text>100</Text></View>
                  </View>
                </View>
                <View className='risk-overview-records'>
                  {engineOverallDelta ? <Text className={`risk-overview-delta is-${engineOverallDelta.direction}`}>{engineOverallDelta.text}</Text> : null}
                  {engineCoverageLines.length > 0 ? engineCoverageLines.map(line => (
                    <Text key={line} className='risk-overview-record-caption'>{line}</Text>
                  )) : <>
                    <Text className='risk-overview-record-days'>已记录 {recordedDays} 天</Text>
                    <Text className='risk-overview-record-caption'>基于可评分的记录</Text>
                  </>}
                </View>
              </View>
              {overviewExpanded ? <View className='risk-overview-expanded'>
                <Text className='risk-overview-score-hint'>{focusScoreHint}</Text>
                <Text className='risk-overview-summary'>{focusOverviewCopy}</Text>
                <View className='risk-overview-chip-row'>
                {signalChips.map((chip) => (
                  <View key={chip.label} className='risk-overview-chip'>
                    <Text className='risk-overview-chip-label'>{chip.label}</Text>
                    <Text className='risk-overview-chip-value'>{chip.value}</Text>
                  </View>
                ))}
                </View>
                {/* 预估分是 health_index 按它自己的分数算的，换成引擎分数后不再对得上 */}
                {engineOverallScore === null ? <Text className='risk-overview-estimate'>改善后的综合分估计：{focusOverallScore} → {focusProjectedScore}，不代表实际健康变化。</Text> : null}
              </View> : null}
            </View>
          </>
        ) : null}

        {analysisPanel === 'health' && ns && showWeekCard ? (
        <WeekHabitsCard
          dayLabels={weekDayLabels(ns.week.days, ns.date)}
          rows={weekRows}
          countTexts={weekCounts}
          headlineDelta={weekDeltas.headline}
          otherDeltas={weekDeltas.rest}
        />
        ) : null}
        {analysisPanel === 'health' && hasEnoughHealthIndexData ? (
          <>
        <View className='stats-card stats-actions-card'>
          <Text className='card-title'>优先调整</Text>
          {actionList.length > 0 ? (actionsExpanded ? actionList : actionList.slice(0, 2)).map((action, index) => {
            const separatorIndex = action.search(/[，。；,;]/)
            const emphasisEnd = separatorIndex > 0 ? separatorIndex + 1 : action.length
            return (
              <View className='stats-priority-item' key={`${index}-${action}`}>
                <Text className='stats-priority-number'>{index + 1}</Text>
                <View className='stats-priority-text'>
                  <Text className='stats-priority-headline'>{action.slice(0, emphasisEnd)}</Text>
                  {emphasisEnd < action.length ? <Text className='stats-priority-followup'>{action.slice(emphasisEnd)}</Text> : null}
                </View>
              </View>
            )
          }) : <Text className='stats-empty-copy'>暂无额外调整建议，继续记录即可。</Text>}
          {actionList.length > 2 ? <View className='stats-text-action' onClick={() => setActionsExpanded(value => !value)}><Text>{actionsExpanded ? '收起' : `展开全部 ${actionList.length} 项`}</Text><Text className='iconfont icon-right-arrow' /></View> : null}
          {d.diet_decision_basis ? <View className='stats-decision-actions'>
            <View className='stats-text-action' onClick={() => void showDietDecisionEvidence(d.diet_decision_basis!).catch(() => {})}><Text>查看依据</Text></View>
            <View className='stats-text-action' onClick={() => void Taro.switchTab({ url: '/pages/index/index' })}><Text>看看下一餐</Text><Text className='iconfont icon-right-arrow' /></View>
          </View> : null}
        </View>
            {otherCards.length > 0 ? (
              <View
                className='stats-ns-others-toggle'
                aria-role='button'
                aria-label={othersExpanded ? '收起其他方面' : '展开其他方面'}
                onClick={() => setOthersExpanded(value => !value)}
              >
                <Text>其他方面</Text>
                <View className='stats-ns-others-toggle__meta'>
                  <Text>{otherCards.length} 项</Text>
                  {othersExpanded ? <IconCollapse size={20} color='#718078' /> : <IconExpand size={20} color='#718078' />}
                </View>
              </View>
            ) : null}
            {othersExpanded && otherCards.length > 0 ? (
              <View className='risk-card-grid'>
                {otherCards.map((card) => (
                  <View
                    key={card.key}
                    className='stats-card risk-card'
                    aria-role='button'
                    aria-label={`查看${card.title}的饮食参考依据`}
                    onClick={() => openRiskDetail(card)}
                  >
                    <View className='risk-card-icon-circle'><Text className={`iconfont icon-${riskCardIcon(card.key)} risk-card-icon`} /></View>
                    <View className='risk-card-copy'>
                    <Text className='risk-card-title'>{card.title}</Text>
                    {card.is_custom ? (
                      <View className='risk-card-ai-badge-row'>
                        <Text className='risk-card-ai-badge'>{card.score_available === false ? '支持建议' : '支持参考'}</Text>
                        <Text className='risk-card-ai-confidence'>{customFocusConfidenceLabel(card.confidence)}</Text>
                        {customFocusRefreshingKey === card.key ? (
                          <Text className='iconfont icon-jiazaixiao risk-card-ai-refresh-spinner' />
                        ) : card.needs_refresh ? (
                          <Text className='risk-card-ai-refresh-hint'>待更新</Text>
                        ) : null}
                      </View>
                    ) : null}
                    <Text className='risk-card-summary'>{card.brief}</Text>
                    </View>
                    <View className={`risk-card-score-wrap tone-${hasRiskScore(card) ? scoreToTone(card.score) : 'pending'}`}>
                      <Text className='risk-card-score'>{hasRiskScore(card) ? card.score : '—'}</Text>
                      {hasRiskScore(card) ? <Text className='risk-card-score-unit'>分</Text> : null}
                    </View>
                    <Text className='iconfont icon-right-arrow risk-card-chevron' />
                  </View>
                ))}
              </View>
            ) : null}
        {topIssues.length > 0 ? <View className='stats-card stats-issues-card'>
          <View className='card-header card-header--collapsible' onClick={() => setIssuesExpanded(value => !value)}><Text className='card-title'>记录中值得留意的地方</Text>{issuesExpanded ? <IconCollapse size={20} color='#718078' /> : <IconExpand size={20} color='#718078' />}</View>
          {issuesExpanded ? topIssues.map((issue, index) => <View key={`${index}-${issue.title}`} className='stats-issue-item'><Text className='stats-issue-title'>{issue.title}</Text><Text className='stats-issue-detail'>{issue.detail}</Text></View>) : null}
        </View> : null}

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
                <View className='risk-detail-title-row'>
                  <Text className='risk-detail-title'>{riskDetailModal.card.title}</Text>
                  {riskDetailModal.card.is_custom ? (
                    <Text className='risk-detail-ai-badge'>{riskDetailModal.card.score_available === false ? '支持建议' : '支持参考'}</Text>
                  ) : null}
                </View>
                <View className='risk-detail-score-row'>
                  <Text className='risk-detail-score'>{hasRiskScore(riskDetailModal.card) ? riskDetailModal.card.score : '—'}</Text>
                  {hasRiskScore(riskDetailModal.card) ? <>
                  <Text className='risk-detail-score-unit'>分</Text>
                  <View className={`risk-detail-badge tone-${riskDetailModal.card.tone}`}>
                    <Text className='risk-detail-badge-text'>{scoreToLabel(riskDetailModal.card.score)}</Text>
                  </View>
                  </> : null}
                </View>
              </View>
              <ScrollView className='risk-detail-body' scrollY showScrollbar={false}>
                {riskDetailModal.card.action ? <View className='risk-detail-priority'><Text className='risk-detail-section-label'>可以先这样调整</Text><Text className='risk-detail-section-text'>{riskDetailModal.card.action}</Text></View> : null}
                {riskDetailModal.card.is_custom ? (
                  <>
                    <Text className='risk-detail-ai-disclaimer'>
                      基于饮食与记录证据的支持度，不代表真实力量、皮肤状态或医学诊断。
                    </Text>
                    <View className='risk-detail-meta-row'>
                      <Text className={`risk-detail-confidence is-${riskDetailModal.card.confidence || 'unknown'}`}>
                        {customFocusConfidenceLabel(riskDetailModal.card.confidence)}
                      </Text>
                      {customFocusScoreChangeLabel(riskDetailModal.card.score_change) ? (
                        <Text className='risk-detail-score-change'>{customFocusScoreChangeLabel(riskDetailModal.card.score_change)}</Text>
                      ) : null}
                    </View>
                  </>
                ) : null}
                {riskDetailModal.card.summary ? <Text className='risk-detail-section-text'>{riskDetailModal.card.summary}</Text> : null}
                {riskDetailModal.card.is_custom && riskDetailModal.card.score_reason ? (
                  <>
                    <View className='risk-detail-divider' />
                    <Text className='risk-detail-section-label'>评分方法</Text>
                    <Text className='risk-detail-section-text'>{riskDetailModal.card.score_reason}</Text>
                  </>
                ) : null}
                {riskDetailModal.card.is_custom && riskDetailModal.card.change_reason ? (
                  <>
                    <View className='risk-detail-divider' />
                    <Text className='risk-detail-section-label'>与上次相比</Text>
                    <Text className='risk-detail-section-text'>{riskDetailModal.card.change_reason}</Text>
                  </>
                ) : null}
                {riskDetailModal.card.basis ? <>
                <View className='risk-detail-divider' />
                <Text className='risk-detail-section-label'>判断依据</Text>
                <Text className='risk-detail-section-text'>{riskDetailModal.card.basis}</Text>
                </> : null}
                {!riskDetailModal.card.is_custom && (riskDetailModal.card.evidence?.length || 0) > 0 ? (
                  <>
                    <View className='risk-detail-divider' />
                    <Text className='risk-detail-section-label'>每一项依据</Text>
                  </>
                ) : null}
                {(riskDetailModal.card.evidence?.length || 0) > 0 ? (
                  <View className='risk-detail-evidence-list'>
                    {riskDetailModal.card.evidence!.map(item => (
                      <View key={item} className='risk-detail-evidence-item'>
                        <Text className='risk-detail-evidence-bullet'>•</Text>
                        <Text className='risk-detail-evidence-text'>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {riskDetailModal.card.is_custom && (riskDetailModal.card.missing_evidence?.length || 0) > 0 ? (
                  <>
                    <View className='risk-detail-divider' />
                    <Text className='risk-detail-section-label'>还缺哪些证据</Text>
                    <Text className='risk-detail-section-text'>{riskDetailModal.card.missing_evidence!.join('、')}</Text>
                  </>
                ) : null}
                {hasRiskScore(riskDetailModal.card) && !riskDetailModal.card.is_custom ? <View className='risk-detail-delta'>
                  <Text className='risk-detail-delta-text'>饮食参考分预计可提升 {riskDetailModal.card.delta} 分，并非实际健康结果。</Text>
                </View> : null}
                {riskDetailModal.card.is_custom && riskDetailModal.card.needs_refresh ? (
                  <View
                    className={`risk-detail-refresh-btn${customFocusRefreshingKey === riskDetailModal.card.key ? ' is-loading' : ''}`}
                    onClick={() => {
                      if (customFocusRefreshingKey !== riskDetailModal.card?.key) {
                        void handleRefreshCustomFocus(riskDetailModal.card!)
                      }
                    }}
                  >
                    <Text className='risk-detail-refresh-text'>
                      {customFocusRefreshingKey === riskDetailModal.card.key ? (
                        <Text className='iconfont icon-jiazaixiao risk-detail-refresh-spinner' />
                      ) : `更新 · ${customFocusCost} 积分`}
                    </Text>
                  </View>
                ) : null}
              </ScrollView>
              <View
                className='risk-detail-close-btn'
                onClick={() => setRiskDetailModal({ visible: false, card: null })}
              >
                <Text className='risk-detail-close-text'>关闭</Text>
              </View>
            </View>
          </View>
        )}
          </>
        ) : null}

        {analysisPanel === 'health' && evidenceGaps.length > 0 ? (
          <EvidenceGapsCard gaps={evidenceGaps} onAction={openEvidenceGap} />
        ) : null}

        <FocusSheet
          visible={riskPickerVisible}
          current={selectedRiskKeys}
          dark={scheme === 'dark'}
          source='stats'
          onClose={() => setRiskPickerVisible(false)}
          onSaved={handleFocusSheetSaved}
        />

        {analysisPanel === 'structure' ? (
          hasAnyDietData ? (
            <>
        <View className='stats-card chart-card evidence-card'>
          <View className='card-header chart-card-header card-header--collapsible' onClick={() => toggleSection('calories')}>
            <View className='chart-title-group'>
              <Text className='iconfont icon-shangzhang chart-title-icon' />
              <View className='card-header-copy'>
                <Text className='card-title'>热量摄入 <Text className='stats-unit'>(kcal)</Text></Text>
                <Text className='card-subtitle'>{range === 'week' ? '最近 7 天' : '近一个月统计 · 图示最近 14 天'}</Text>
              </View>
            </View>
            <View className='card-header-actions'>
              {expandedSections.calories ? <View className='chart-switch-wrap' onClick={(e) => e.stopPropagation()}>
                <Text className='chart-switch-label'>数值</Text>
                <Switch
                  className='chart-switch'
                  checked={showCalories}
                  color='#5cb896'
                  onChange={(event) => setShowCalories(event.detail.value)}
                />
              </View> : null}
              <View className='card-header-arrow'>{expandedSections.calories ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
            </View>
          </View>
          {expandedSections.calories ? (
            <View className='card-collapsible-content'>
              {chartDays.length > 0 ? (
                <View className='bar-chart-container'>
                  {tdee > 0 ? <View className='calorie-reference-line' style={{ bottom: `${44 + clampPercent(tdee / maxDailyCalories * 100) * 2.6}rpx` }}><Text>参考消耗 {Math.round(tdee)}</Text></View> : null}
                  {chartDays.map((item) => {
                    const heightPct = clampPercent(toSafeNumber(item.calories) / maxDailyCalories * 100)
                    return (
                      <View key={item.date} className='chart-col'>
                        {showCalories ? (
                          <Text className='bar-calorie-text'>{item.calories > 0 ? Math.round(item.calories) : '—'}</Text>
                        ) : null}
                        <View className='bar-wrapper'>
                          {item.target && <View className='nutrition-plan-chart-target' style={{ bottom: `${clampPercent(toSafeNumber(item.target.snapshot.targets.calorie_target) / maxDailyCalories * 100)}%` }} />}
                          <View
                            className={`bar-fill ${item.calories > tdee ? 'over' : ''}`}
                            style={{ height: `${heightPct}%` }}
                          />
                          {item.calories <= 0 ? <Text className='stats-chart-no-data'>—</Text> : null}
                        </View>
                        <Text className='bar-label'>{range === 'week' ? item.date.slice(5) : item.date.slice(8)}</Text>
                      </View>
                    )
                  })}
                </View>
              ) : (
                <View className='chart-empty-state'>
                  <Text className='empty-text'>暂无数据</Text>
                </View>
              )}
              <Text className='stats-chart-note'>{chartDays[0]?.date.slice(5)} — {chartDays[chartDays.length - 1]?.date.slice(5)} · 横线表示无摄入数据；参考消耗为估算值。</Text>
              {d.recorded_target_totals && <Text className='stats-chart-note'>绿短线为每日饮食目标；仅有记录的 {d.recorded_days} 天：摄入 {Math.round(d.total_calories)} / 计划 {Math.round(d.recorded_target_totals.calorie_target || 0)} kcal。{chartDays.some(item => item.target?.historical_reference) ? '部分旧日期使用参考目标。' : ''}</Text>}
            </View>
          ) : null}
        </View>

        <View className='stats-card macro-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('macro')}>
            <Text className='iconfont icon-tianpingzuo chart-title-icon' />
            <View className='card-header-copy stats-inline-heading'>
              <Text className='card-title'>营养构成</Text>
              <Text className='card-subtitle'>本{range === 'week' ? '周' : '月'}累计 · 能量占比</Text>
            </View>
            <View className='card-header-arrow'>{expandedSections.macro ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.macro ? (
            <View className='card-collapsible-content'>
              <View className='macro-list'>
                <View className='macro-row stats-macro-row'>
                  <Text className='macro-name'>蛋白质</Text>
                  <View className='progress-track'>
                    <View className='progress-fill protein' style={{ width: `${clampPercent(macroPercent.protein)}%` }}></View>
                  </View>
                  <Text className='stats-macro-grams'>{totalProtein.toFixed(0)}g</Text>
                  <Text className='stats-macro-percent'>{macroPercent.protein}%</Text>
                </View>

                <View className='macro-row stats-macro-row'>
                  <Text className='macro-name'>碳水</Text>
                  <View className='progress-track'>
                    <View className='progress-fill carbs' style={{ width: `${clampPercent(macroPercent.carbs)}%` }}></View>
                  </View>
                  <Text className='stats-macro-grams'>{totalCarbs.toFixed(0)}g</Text>
                  <Text className='stats-macro-percent'>{macroPercent.carbs}%</Text>
                </View>

                <View className='macro-row stats-macro-row'>
                  <Text className='macro-name'>脂肪</Text>
                  <View className='progress-track'>
                    <View className='progress-fill fat' style={{ width: `${clampPercent(macroPercent.fat)}%` }}></View>
                  </View>
                  <Text className='stats-macro-grams'>{totalFat.toFixed(0)}g</Text>
                  <Text className='stats-macro-percent'>{macroPercent.fat}%</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card meal-structure-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('meals')}>
            <Text className='iconfont icon-canciguanli chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>餐次分布</Text>
              <Text className='card-subtitle'>本周期热量占比</Text>
            </View>
            {expandedSections.meals ? <View
              className='stats-meal-value-toggle'
              aria-role='button'
              aria-label={mealValuesInCalories ? '切换显示餐次热量占比' : '切换显示餐次摄入热量'}
              onClick={(event) => { event.stopPropagation(); setMealValuesInCalories(value => !value) }}
            ><Text>{mealValuesInCalories ? '看占比' : '看热量'}</Text></View> : null}
            <View className='card-header-arrow'>{expandedSections.meals ? <IconCollapse size={24} color='#94a3b8' /> : <IconExpand size={24} color='#94a3b8' />}</View>
          </View>
          {expandedSections.meals ? (
            <View className='card-collapsible-content'>
              <View className='stats-meal-list'>
                {(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'] as const).map((key) => {
                  const cal = byMeal[key]
                  const pct = totalCalories > 0 ? (cal / totalCalories) * 100 : 0
                  return (
                    <View key={key} className={`stats-meal-row ${mealValuesInCalories ? 'shows-calories' : ''}`}>
                      <Text className='stats-meal-name'>{MEAL_NAMES[key]}</Text>
                      <View className='progress-track'><View className='progress-fill' style={{ width: `${clampPercent(pct)}%` }} /></View>
                      <Text className='stats-meal-percent'>{mealValuesInCalories ? `${Math.round(cal)} kcal` : totalCalories > 0 ? `${pct.toFixed(1)}%` : '—'}</Text>
                    </View>
                  )
                })}
              </View>
            </View>
          ) : null}
        </View>

        <View className='stats-card body-metrics-card evidence-card'>
          <View className='card-header card-header--collapsible' onClick={() => toggleSection('body')}>
            <Text className='iconfont icon-shangzhang chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>体重与喝水</Text>
              <Text className='card-subtitle'>体重最近 {range === 'week' ? '7' : '10'} 次 · 饮水最近 {range === 'week' ? '7' : '14'} 天</Text>
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
                  {weightChartEntries.length > 0 ? (
                    <View className='weight-line-chart-wrap'>
                      <View
                        className={`weight-line-chart ${weightChartEntries.length <= 1 ? 'single-point' : ''}`}
                        style={weightChartSvg ? { backgroundImage: weightChartSvg } : undefined}
                      >
                        {weightChartEntries.length === 1 ? (
                          <View className='weight-line-single-dot' />
                        ) : null}
                        <View className='weight-line-point-layer'>
                          {weightChartEntries.map((item, index) => {
                            const left = weightChartEntries.length <= 1
                              ? 50
                              : 5.3 + (index / (weightChartEntries.length - 1)) * 89.4
                            const top = weightChartEntries.length <= 1
                              ? 50
                              : 23.3 + (1 - ((toSafeNumber(item.value) - weightChartMin) / weightChartRange)) * 62.2
                            return (
                              <View
                                key={item.date}
                                className='weight-line-point'
                                style={{ left: `${left}%`, top: `${top}%` }}
                              >
                                <Text className='weight-line-point-value'>{item.value.toFixed(1)}</Text>
                              </View>
                            )
                          })}
                        </View>
                      </View>
                      <View className='weight-line-label-row'>
                        {weightChartEntries.map((item) => (
                          <Text key={item.date} className='weight-line-label'>{item.date.slice(5)}</Text>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>

                <View className='body-metric-panel water-panel'>
                  <View className='body-metric-panel-header'>
                    <Text className='body-metric-title'>喝水趋势</Text>
                    {waterRecordedDays > 0 ? (
                    <Text className='body-metric-main'>
                      {avgDailyWaterMl.toFixed(0)} ml
                    </Text>
                    ) : <Text className='body-metric-empty'>暂无喝水记录</Text>}
                  </View>
                  <Text className='body-metric-sub'>
                    {waterRecordedDays > 0 ? `日均 ${avgDailyWaterMl.toFixed(0)} ml，目标 ${waterGoalMl} ml，累计 ${totalWaterMl.toFixed(0)} ml` : `饮水目标 ${waterGoalMl} ml`}
                  </Text>
                  {waterRecordedDays > 0 && waterTrend.length > 0 ? (
                    <View className='water-trend-chart'>
                      {waterTrend.map((item) => {
                        const pct = maxWaterValue > 0 ? clampPercent(toSafeNumber(item.total) / maxWaterValue * 100) : 0
                        return (
                          <View key={item.date} className='water-trend-col'>
                            <View className='water-trend-bar-wrap'>
                              <View className='water-trend-bar' style={{ height: `${pct}%` }} />
                              {toSafeNumber(item.total) <= 0 ? <Text className='stats-chart-no-data'>—</Text> : null}
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
            </>
          ) : (
            <View className='stats-card stats-data-gate-card'>
              <View className='health-index-gate-icon'>
                <Text className='iconfont icon-canciguanli health-index-gate-icon-text' />
              </View>
              <View className='health-index-gate-copy'>
                <Text className='health-index-gate-title'>记录饮食后查看营养结构</Text>
                <Text className='health-index-gate-desc'>
                  当前统计周期还没有饮食记录。先记录一餐后，这里会展示热量趋势、宏量营养占比和餐次分布。
                </Text>
              </View>
            </View>
          )
        ) : null}

        <View className='stats-page-disclaimer'>
          <Text className='stats-page-disclaimer__text'>结果仅供参考，不代替医学判断</Text>
        </View>
      </ScrollView>
    </View>
  )
}

export default withAuth(StatsPage, { public: true })
