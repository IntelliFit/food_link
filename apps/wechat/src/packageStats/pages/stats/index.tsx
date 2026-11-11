import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { readStatsPageCache, writeStatsPageCache } from '../../../utils/stats-page-cache'
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
  focusCardKey,
  normalizeNutritionState,
  overallDelta,
  splitWeekDeltas,
  weekDayLabels,
  weekHabitRows,
} from '../../../utils/nutrition-state-view'
import {
  localFocusKeys,
  MAX_HEALTH_FOCUS,
  resolveFocusKeys,
  sameKeys,
  splitFocusCards,
} from './focus-selection'
import {
  calorieChartView,
  focusPillTone,
  gateHeadline,
  macroSplit,
  rangeLabel,
  recordedDayDots,
  SCORE_MIN_DAYS,
  sodiumGapNote,
  splitAction,
  summaryNote,
  weightTrendView,
  type StatsRange,
} from './analysis-view'
import { FixFirstCard, FocusScoresCard, GateSummaryCard, RangeSegment, SummaryCard, type FocusRowView } from './AnalysisCards'
import { AnalysisSkeleton, CaloriesCard, WeightCard } from './AnalysisCharts'
import { WeekHabitsCard } from '../../../components/StatsNutritionState'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { builtinFocusLabel } from '../../../components/FocusSheet/focus-options'
import { experiments } from '../../../utils/experiments'
import { openPetFocusSheet } from '../../../utils/pet-navigation'
import {
  customFocusCardFromTask,
  readPendingCustomFocusTasks,
  removePendingCustomFocusTask,
  savePendingCustomFocusTask,
  type PendingCustomFocusTask,
} from '../../../utils/custom-focus-task'
import './index.scss'
import { withAuth, redirectToLogin } from '../../../utils/withAuth'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'

/** 二级页原生导航栏的颜色，和页面底色一致 */
const NAV_BAR_COLORS = { lightBackground: '#f5f2e8', darkBackground: '#161f1b' }

function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 完整分析页只回答「这一周吃得怎么样，先改哪一点」：只回头看，不放记录入口；
// 今天还差什么、伙伴那句话都在底栏「伙伴」页，「我在意的」也只在伙伴页改。

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
  const [range, setRange] = useState<StatsRange>('week')
  const rangeRef = useRef(range)
  rangeRef.current = range
  const [riskDetailModal, setRiskDetailModal] = useState<{ visible: boolean; card: RiskCard | null }>({ visible: false, card: null })

  // 二级页用原生导航栏（带返回），颜色跟着深浅色
  useEffect(() => {
    applyThemeNavigationBar(scheme, NAV_BAR_COLORS)
  }, [scheme])
  useDidShow(() => {
    applyThemeNavigationBar(scheme, NAV_BAR_COLORS)
  })

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
  // 服务器的关注到之前先用本机存的（最多 3 项）；没存过就是还没选
  const [selectedRiskKeys, setSelectedRiskKeys] = useState<string[]>(() => localFocusKeys(readStoredFocus()) ?? [])
  const selectedRiskKeysRef = useRef(selectedRiskKeys)
  selectedRiskKeysRef.current = selectedRiskKeys

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
    const state = await loadNutritionState().catch((e: unknown) => {
      console.warn('[stats] nutrition state unavailable:', e)
      return null
    })
    if (seq !== nutritionSeqRef.current) return
    setNutritionState(state)
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
    experiments.track('stats_view', { range })
  }, [range, guestBrowse, statsShowCount])
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

  // 周期切换只关掉详情弹窗，不改变个人关注、缓存或生成规则。
  useEffect(() => {
    setRiskDetailModal({ visible: false, card: null })
  }, [range])

  const pageClass = `sa-page ${scheme === 'dark' ? 'sa-page--dark' : ''}`
  const selectRange = (next: StatsRange) => {
    if (loading || next === rangeRef.current) return
    setRange(next)
  }

  if (guestBrowse) {
    return (
      <View className={`${pageClass} sa-page--static`}>
        <View className='sa-app'>
          <View className='sa-brief'>
            <Text className='sa-brief__day'>饮食分析</Text>
            <Text className='sa-brief__line'>登录后查看饮食分析</Text>
            <Text className='sa-brief__note'>可先浏览首页热量与营养概览，需要账号同步时再登录</Text>
            <View className='sa-btn sa-btn--gold' aria-role='button' onClick={() => redirectToLogin()}>
              <Text>去登录</Text>
            </View>
          </View>
        </View>
      </View>
    )
  }

  /** 一页滚动：最上面是周期切换，弹窗放在滚动区外面 */
  const renderShell = (content: ReactNode, overlay: ReactNode = null) => (
    <View className={pageClass}>
      <ScrollView className='sa-scroll' scrollY={!riskDetailModal.visible} enhanced showScrollbar={false}>
        <View className='sa-app'>
          <RangeSegment range={range} disabled={loading} onChange={selectRange} />
          {content}
        </View>
      </ScrollView>
      {overlay}
    </View>
  )

  if (loading && !data) {
    return renderShell(<AnalysisSkeleton />)
  }

  if (error && !data) {
    return renderShell(
      <View className='sa-card sa-card--center'>
        <Text className='sa-card__empty'>{error}</Text>
        <View className='sa-btn' aria-role='button' onClick={() => void refreshFromNetwork(range, false)}>
          <Text>重试</Text>
        </View>
      </View>,
    )
  }

  const d = data!
  const today = formatLocalDate()
  const tdee = toSafeNumber(d.tdee)
  const avgCaloriesPerDay = toSafeNumber(d.avg_calories_per_day)
  const recordedDays = Math.max(0, toSafeNumber(d.recorded_days, 0))
  const hasAnyDietData = recordedDays > 0
  const dailyCalories = Array.isArray(d.daily_calories) ? d.daily_calories : []
  const healthIndex = d.health_index
  const hasEnoughHealthIndexData = healthIndex?.has_enough_data ?? false
  const ns = nutritionState
  // 引擎的分数按本周算，只在「近一周」替换综合分和关注分；「近一个月」仍用 health_index
  const engineWeek = ns && range === 'week' ? ns : null
  const engineOverallScore = engineWeek?.scores.overall ?? null
  const engineOverallDelta = engineWeek && engineOverallScore !== null ? overallDelta(engineWeek.scores) : null
  const overallRiskScore = Math.round(engineOverallScore ?? healthIndex?.overall_score ?? 0)
  const engineFocus = engineWeek?.scores.focus ?? []
  const riskCards = applyEngineFocus(healthIndex?.risk_cards ?? [], engineFocus)
  const weekRows = ns ? weekHabitRows(ns.week) : []
  const weekDeltas = ns ? splitWeekDeltas(ns.week.vs_last_week) : { headline: null, rest: [] }

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
  const { focusCards } = splitFocusCards([...allDisplayRiskCards, ...pendingFocusCards], selectedRiskKeys)
  const isPendingRiskCard = (card: RiskCard) => Boolean(card.is_custom && !customRiskCards.some(item => item.key === card.key))
  const hasRiskScore = (card: RiskCard) => !isPendingRiskCard(card) && card.score_available !== false
  const hasVisibleCustomFocus = focusCards.some(card => card.is_custom)
  const customBadge = (card: RiskCard) => (card.is_custom ? (card.score_available === false ? '支持建议' : '支持参考') : '')
  const scoredFocusRows: FocusRowView[] = focusCards.map(card => ({
    key: card.key,
    title: builtinFocusLabel(card.key) || card.title,
    reason: card.brief,
    scoreText: hasRiskScore(card) ? String(card.score) : '—',
    tone: focusPillTone(hasRiskScore(card) ? card.score : null),
    badge: customBadge(card),
    refreshing: customFocusRefreshingKey === card.key,
  }))
  // 记录不到 2 天时可能还没有关注卡，按选了哪几项列出来，分数先空着
  const focusTitle = (key: string): string => builtinFocusLabel(key)
    || focusCards.find(card => card.key === key)?.title
    || allRiskOptions.find(item => item.key === key)?.title
    || ns?.focus?.find(item => focusCardKey(item.key) === key)?.title
    || ''
  const gateFocusRows: FocusRowView[] = selectedRiskKeys
    .map(key => ({
      key,
      title: focusTitle(key),
      reason: `记满 ${SCORE_MIN_DAYS} 天后出分`,
      scoreText: '—',
      tone: focusPillTone(null),
      badge: '',
      refreshing: false,
    }))
    .filter(row => row.title)
  const focusRows = hasEnoughHealthIndexData ? scoredFocusRows : gateFocusRows
  const openFocusItem = (key: string) => {
    if (!hasEnoughHealthIndexData) return
    const card = focusCards.find(item => item.key === key)
    if (card) openRiskDetail(card)
  }

  const actionList = Array.from(new Set([
    ...(d.diet_decision_basis?.food_group_priorities?.length ? d.diet_decision_basis.actions : []),
    ...(healthIndex?.action_list ?? []),
  ]))
  const fixFirst = actionList.slice(0, 2).map(splitAction).filter(action => action.lead)
  const periodLabel = rangeLabel(range, d.start_date, d.end_date)
  const engineMeals = engineWeek ? engineWeek.coverage.meals : null
  const summaryReason = engineWeek?.headline
    || healthIndex?.overview_copy
    || scoreToFocusOverview(overallRiskScore, hasVisibleCustomFocus)
  const calorieChart = hasAnyDietData
    ? calorieChartView({ daily: dailyCalories, tdee, avgCalories: avgCaloriesPerDay, range, today })
    : null
  const macro = macroSplit({
    protein: toSafeNumber(d.macro_percent?.protein),
    carbs: toSafeNumber(d.macro_percent?.carbs),
    fat: toSafeNumber(d.macro_percent?.fat),
  })
  const weightTrend = weightTrendView(d.body_metrics?.weight_entries ?? [], d.start_date, d.end_date)

  // 关注详情底部弹窗（含自定义关注卡的生成/更新）
  const riskDetailNode = (
    <>
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
  )

  return renderShell(
    <>
      {error ? <View className='sa-error'><Text>{error}</Text></View> : null}
      {hasEnoughHealthIndexData ? (
        <SummaryCard
          label={periodLabel}
          score={overallRiskScore}
          delta={engineOverallDelta?.text ?? ''}
          reason={summaryReason}
          note={summaryNote(recordedDays, engineMeals, engineWeek ? sodiumGapNote(engineWeek.evidence_gaps) : '')}
        />
      ) : (
        <GateSummaryCard
          label={periodLabel}
          headline={gateHeadline(range, recordedDays)}
          dots={recordedDayDots(dailyCalories)}
          note={summaryNote(recordedDays, engineMeals)}
        />
      )}
      <FocusScoresCard
        rows={focusRows}
        emptyText={`还没选在意的，在伙伴页选 1–${MAX_HEALTH_FOCUS} 项`}
        onOpen={openFocusItem}
        onEdit={openPetFocusSheet}
      />
      {hasEnoughHealthIndexData && ns && weekRows.length > 0 ? (
        <WeekHabitsCard dayLabels={weekDayLabels(ns.week.days, ns.date)} rows={weekRows} headlineDelta={weekDeltas.headline} />
      ) : null}
      {hasEnoughHealthIndexData && fixFirst.length > 0 ? <FixFirstCard actions={fixFirst} /> : null}
      {hasEnoughHealthIndexData && calorieChart ? <CaloriesCard chart={calorieChart} macro={macro} /> : null}
      {weightTrend ? <WeightCard trend={weightTrend} /> : null}
      <Text className='sa-disclaimer'>结果仅供参考，不代替医学判断</Text>
    </>,
    riskDetailNode,
  )
}

export default withAuth(StatsPage, { public: true })
