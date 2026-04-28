import { View, Text, Input, Image, Canvas } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { Empty, Button } from '@taroify/core'
import {
  getHomeDashboard,
  getStatsSummary,
  getAccessToken,
  updateDashboardTargets,
  getBodyMetricsSummary,
  getExerciseLogs,
  getUnlimitedQRCode,
  getFriendInviteProfile,
  getSharedFoodRecord,
  saveBodyWeightRecord,
  addBodyWaterLog,
  resetBodyWaterLogs,
  mapCalendarDateToApi,
  resolveHomeMealPrimaryRecordId,
  deleteFoodRecord,
  type DashboardTargets,
  type HomeAchievement,
  type HomeIntakeData,
  type HomeMealItem,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay,
  type HomeFoodExpiryItem,
  type HomeFoodExpirySummary,
  type FoodRecord,
  getCachedMealFullRecord
} from '../../utils/api'
import {
  drawDailySummaryPoster,
  computeDailySummaryPosterHeight,
  DAILY_SUMMARY_POSTER_MAX_HEIGHT,
  POSTER_WIDTH,
  type DailySummaryPosterInput
} from '../../utils/poster'
import { resolveCanvasImageSrc } from '../../utils/weapp-canvas-image'

import { IconBreakfast, IconLunch, IconDinner, IconSnack, IconWaterDrop } from '../../components/iconfont'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../utils/food-expiry-events'
import {
  HOME_DASHBOARD_REFRESH_EVENT,
  HOME_INTAKE_DATA_CHANGED_EVENT,
  COMMUNITY_FEED_CHANGED_EVENT,
  HOME_DASHBOARD_CACHE_TTL_MS
} from '../../utils/home-events'
import {
  DEFAULT_EXPIRY_SUMMARY,
  getStoredHomeDashboardSnapshots,
  getStoredHomeDashboardSnapshotByDate,
  saveHomeDashboardSnapshot,
  type HomeDashboardLocalSnapshot
} from '../../utils/home-dashboard-local-cache'

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { extraPkgUrl } from '../../utils/subpackage-extra'

// 导入拆分出的模块
import { type WeightRecordEntry, type BodyMetricsStorage, type WaterRecord, type MacroKey, type WeekHeatmapState, type WeekHeatmapCell, type TargetFormState, type MacroTargets } from './types'
import {
  DEFAULT_INTAKE,
  WEIGHT_HISTORY_LIMIT,
  QUICK_WATER_AMOUNTS,
  WATER_GOAL_DEFAULT,
  SHORT_DAY_NAMES,
  HOME_WARNING_RED
} from './utils/constants'
import { formatDisplayNumber, formatNumberWithComma, formatDateKey, createTargetForm, createWeekHeatmapCells } from './utils/helpers'
import { useAnimatedNumber, useAnimatedProgress } from './hooks'
import { TargetEditor, GreetingSection, DateSelector, StatsEntry, RecordMenu, MealActionSheet, MealRecordsDialog, MealRecordEditModal, MealRecordPosterModal, type MealPosterSharePayload } from './components'

/** 与记录详情页海报一致：邀请码用于小程序码 scene */
function getInviteCodeFromUserId(userId: string): string {
  const raw = (userId || '').replace(/-/g, '').toLowerCase()
  return raw.length >= 8 ? raw.slice(0, 8) : ''
}

/** 海报顶栏：月日一行 */
function formatPosterDatePrimary(dateKey: string): string {
  const parts = dateKey.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return dateKey
  }
  const [_y, m, d] = parts
  return `${m}月${d}日`
}

/** 海报顶栏：星期一行 */
function formatPosterWeekdayLabel(dateKey: string): string {
  const parts = dateKey.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return ''
  }
  const [y, m, d] = parts
  const dt = new Date(y, m - 1, d)
  return `周${SHORT_DAY_NAMES[dt.getDay()] ?? '—'}`
}

// 与后端/统计周对齐：真实日历为 2026 时，仅在与「可能带错年」的接口字段比对时做归一
function normalizeTo2025(dateStr: string): string {
  return dateStr.replace(/^2026-/, '2025-')
}

/** 升级后把本机仍用 2025-xx-xx 存的「今天」喝水/体重键迁到真实年，避免与云端 2026 不一致 */
function migrateLegacy2025BodyMetricKeys(metrics: BodyMetricsStorage): BodyMetricsStorage {
  const today = formatDateKey(new Date())
  if (!today.startsWith('2026-')) return metrics
  const legacy = today.replace(/^2026-/, '2025-')
  if (legacy === today) return metrics
  const nextWater = { ...metrics.waterByDate }
  if (nextWater[legacy]) {
    nextWater[today] = nextWater[legacy]
    delete nextWater[legacy]
  }
  const nextWeight = metrics.weightEntries.map((e) =>
    e.date === legacy ? { ...e, date: today } : e
  )
  const next = { ...metrics, waterByDate: nextWater, weightEntries: nextWeight }
  if (JSON.stringify(next) !== JSON.stringify(metrics)) {
    saveBodyMetrics(next)
  }
  return next
}

function buildWeekHeatmapCellsFromStorage(): WeekHeatmapCell[] {
  const today = new Date()
  const cells: WeekHeatmapCell[] = []
  for (let offset = -3; offset <= 3; offset++) {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    const dateKey = formatDateKey(date)
    const snap = getStoredHomeDashboardSnapshotByDate(dateKey)
    const calories = snap ? snap.intakeData.current : 0
    const target = snap ? snap.intakeData.target : 2000
    const hasRecord = calories > 0
    cells.push({
      date: dateKey,
      dayName: SHORT_DAY_NAMES[date.getDay()],
      dayNum: String(date.getDate()),
      calories,
      target,
      intakeRatio: hasRecord ? calories / target : 0,
      state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
      isToday: offset === 0
    })
  }
  return cells
}

function parseCompleteNumber(value: string): number | null {
  const normalized = value.trim()
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatTargetInput(value: number): string {
  const rounded = Math.max(0, Number(value.toFixed(1)))
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function parseMacroTargets(form: TargetFormState): MacroTargets | null {
  const protein = parseCompleteNumber(form.proteinTarget)
  const carbs = parseCompleteNumber(form.carbsTarget)
  const fat = parseCompleteNumber(form.fatTarget)

  if (protein == null || carbs == null || fat == null) {
    return null
  }

  return { protein, carbs, fat }
}

function calcCaloriesFromMacros(macros: MacroTargets): number {
  return macros.protein * 4 + macros.carbs * 4 + macros.fat * 9
}

function scaleMacrosByCalorieTarget(nextCalorie: number, baseMacros: MacroTargets): MacroTargets {
  const baseCalories = calcCaloriesFromMacros(baseMacros)

  if (baseCalories <= 0) {
    const protein = (nextCalorie * 0.3) / 4
    const carbs = (nextCalorie * 0.4) / 4
    const fat = (nextCalorie * 0.3) / 9
    return { protein, carbs, fat }
  }

  const ratio = nextCalorie / baseCalories
  return {
    protein: baseMacros.protein * ratio,
    carbs: baseMacros.carbs * ratio,
    fat: baseMacros.fat * ratio
  }
}

function alignPayloadWithCalorieTarget(payload: DashboardTargets): { payload: DashboardTargets; adjusted: boolean } {
  const caloriesFromMacros = payload.protein_target * 4 + payload.carbs_target * 4 + payload.fat_target * 9
  if (Math.abs(caloriesFromMacros - payload.calorie_target) <= 1) {
    return { payload, adjusted: false }
  }

  const scaledMacros = scaleMacrosByCalorieTarget(payload.calorie_target, {
    protein: payload.protein_target,
    carbs: payload.carbs_target,
    fat: payload.fat_target
  })

  return {
    adjusted: true,
    payload: {
      calorie_target: payload.calorie_target,
      protein_target: Number(formatTargetInput(scaledMacros.protein)),
      carbs_target: Number(formatTargetInput(scaledMacros.carbs)),
      fat_target: Number(formatTargetInput(scaledMacros.fat))
    }
  }
}

function calculateProgressPercent(current: number, target: number): number {
  if (target <= 0) {
    return current > 0 ? 100 : 0
  }
  return Math.max(0, Number(((current / target) * 100).toFixed(1)))
}

function normalizeDisplayNumber(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function normalizeProgressPercent(value: unknown, current?: unknown, target?: unknown): number {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return Math.max(0, Number(numeric.toFixed(1)))
  }

  if (current != null && target != null) {
    return calculateProgressPercent(normalizeDisplayNumber(current), normalizeDisplayNumber(target))
  }

  return 0
}

function clampVisualProgress(progress: number): number {
  return Math.min(100, Math.max(0, progress))
}

function formatProgressText(progress: number): string {
  return `${Math.round(progress)}%`
}

/** dashboard 的 exerciseBurnedKcal：兼容 JSON 中数字被解析为字符串的情况 */
function parseExerciseBurnedKcal(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string') {
    const n = parseFloat(raw.trim())
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** 与记运动页同源：合并 dashboard 与 exercise-logs；取二者较大值，避免 logs 空列表返回 0 时盖住 dashboard 已有汇总（真机偶发） */
function mergeExerciseKcalFromDashboardAndLogs(dashboardRaw: unknown, logsTotal: unknown): number {
  const dash = parseExerciseBurnedKcal(dashboardRaw)
  const fromLogs =
    typeof logsTotal === 'number' && Number.isFinite(logsTotal)
      ? logsTotal
      : typeof logsTotal === 'string'
        ? parseFloat(logsTotal.trim())
        : NaN
  if (Number.isFinite(fromLogs)) {
    return Math.max(dash, fromLogs)
  }
  return dash
}

// 体重/喝水相关辅助函数
function deriveWeightSummary(entries: WeightRecordEntry[], date: string) {
  const sorted = sortWeightEntries(entries)
  const latestEntry = findLatestWeightEntryByDate(sorted, date)
  const todayEntry = sorted.find(e => e.date === date)
  const previousEntry = sorted.find(e => e.date < date)
  const weightChange = latestEntry && previousEntry ? latestEntry.value - previousEntry.value : null
  
  return {
    latestWeight: latestEntry,
    todayWeight: todayEntry,
    previousWeight: previousEntry,
    weightChange,
    hasRecord: sorted.length > 0
  }
}

function findLatestWeightEntryByDate(entries: WeightRecordEntry[], date: string): WeightRecordEntry | null {
  const sorted = entries.filter(e => e.date <= date).sort((a, b) => b.date.localeCompare(a.date))
  return sorted[0] || null
}

function sortWeightEntries(entries: WeightRecordEntry[]): WeightRecordEntry[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date))
}

/** 与 dashboard / 身体指标 API 一致：展示年 2026 时，云端/库内 2025-xx-xx 应对齐到 2026-xx-xx */
function bmDateKey(date: string): string {
  return mapCalendarDateToApi(date) ?? date
}

/**
 * 合并本机 waterByDate / 体重条目的日期键，避免同日 2025/2026 两套键导致查不到、按日切换永远不变
 */
function normalizeBodyMetricsStorageKeys(metrics: BodyMetricsStorage): BodyMetricsStorage {
  const nextWater: Record<string, BodyMetricWaterDay> = {}
  for (const [k, v] of Object.entries(metrics.waterByDate)) {
    const nk = bmDateKey(k)
    const merged = nextWater[nk]
    if (!merged) {
      nextWater[nk] = { ...v, date: nk }
    } else {
      const pick = merged.total >= v.total ? merged : { ...v, date: nk }
      nextWater[nk] = {
        date: nk,
        total: Math.max(merged.total, v.total),
        logs: pick.logs,
      }
    }
  }
  const byDate = new Map<string, WeightRecordEntry>()
  for (const e of metrics.weightEntries) {
    const nk = bmDateKey(e.date)
    const prev = byDate.get(nk)
    const nextE: WeightRecordEntry = { ...e, date: nk }
    if (!prev) {
      byDate.set(nk, nextE)
    } else {
      const nt = nextE.recorded_at || ''
      const pt = prev.recorded_at || ''
      byDate.set(nk, nt >= pt ? nextE : prev)
    }
  }
  const weightEntries = sortWeightEntries([...byDate.values()]).slice(-WEIGHT_HISTORY_LIMIT)
  return { ...metrics, waterByDate: nextWater, weightEntries }
}

function getStoredBodyMetrics(): BodyMetricsStorage {
  try {
    const stored = Taro.getStorageSync('body_metrics_storage')
    if (stored) {
      const migrated = migrateLegacy2025BodyMetricKeys(stored as BodyMetricsStorage)
      return normalizeBodyMetricsStorageKeys(migrated)
    }
  } catch {
    // ignore
  }
  return {
    weightEntries: [],
    waterByDate: {},
    waterGoalMl: WATER_GOAL_DEFAULT
  }
}

function saveBodyMetrics(metrics: BodyMetricsStorage) {
  try {
    Taro.setStorageSync('body_metrics_storage', metrics)
  } catch {
    // ignore
  }
}

function applyCloudBodyMetrics(storage: BodyMetricsStorage, cloud: {
  weight_entries?: BodyMetricWeightEntry[]
  water_daily?: BodyMetricWaterDay[]
  water_goal_ml?: number
}): BodyMetricsStorage {
  let next = normalizeBodyMetricsStorageKeys({
    ...storage,
    weightEntries: [...storage.weightEntries],
    waterByDate: { ...storage.waterByDate },
    waterGoalMl: cloud.water_goal_ml || storage.waterGoalMl || WATER_GOAL_DEFAULT
  })

  if (cloud.weight_entries?.length) {
    const byDate = new Map<string, WeightRecordEntry>()
    next.weightEntries.forEach((e) => {
      const d = bmDateKey(e.date)
      byDate.set(d, { ...e, date: d })
    })
    for (const entry of cloud.weight_entries) {
      const d = bmDateKey(entry.date)
      byDate.set(d, {
        date: d,
        value: entry.value,
        recorded_at: entry.recorded_at || undefined
      })
    }
    next.weightEntries = sortWeightEntries([...byDate.values()]).slice(-WEIGHT_HISTORY_LIMIT)
  }

  if (cloud.water_daily?.length) {
    for (const day of cloud.water_daily) {
      const d = bmDateKey(day.date)
      next.waterByDate[d] = {
        date: d,
        total: day.total,
        logs: day.logs || []
      }
    }
  }

  return next
}

function getTodayWater(metrics: BodyMetricsStorage, date: string): BodyMetricWaterDay {
  const d = bmDateKey(date)
  return metrics.waterByDate[d] || metrics.waterByDate[date] || { date, total: 0, logs: [] }
}

function addWaterToMetrics(metrics: BodyMetricsStorage, date: string, amount: number): BodyMetricsStorage {
  const key = bmDateKey(date)
  const current = getTodayWater(metrics, date)
  const updated: BodyMetricWaterDay = {
    date: key,
    total: current.total + amount,
    logs: [...current.logs, amount]
  }
  return {
    ...metrics,
    waterByDate: {
      ...metrics.waterByDate,
      [key]: updated
    }
  }
}

function clearWaterForDate(metrics: BodyMetricsStorage, date: string): BodyMetricsStorage {
  const next = { ...metrics, waterByDate: { ...metrics.waterByDate } }
  delete next.waterByDate[bmDateKey(date)]
  delete next.waterByDate[date]
  return next
}

/** 真机弱网时身体指标接口偶发失败，短延迟重试一次；仍失败则返回 null，由本机缓存 + 日期键规范化兜底 */
async function fetchBodyMetricsSummaryRetry(): Promise<
  Awaited<ReturnType<typeof getBodyMetricsSummary>> | null
> {
  try {
    return await getBodyMetricsSummary('week')
  } catch {
    await new Promise<void>((resolve) => setTimeout(resolve, 350))
    try {
      return await getBodyMetricsSummary('week')
    } catch {
      return null
    }
  }
}

function getExpiryUrgencyText(item: HomeFoodExpiryItem): string {
  if (item.urgency_level === 'overdue') return '已过期'
  if (item.urgency_level === 'today') return '今天截止'
  if (item.urgency_level === 'soon') {
    const days = Math.max(1, Number(item.days_left ?? 1))
    return `${days}天内到期`
  }
  return '待处理'
}

function formatExpiryMeta(item: HomeFoodExpiryItem): string {
  return [item.deadline_label, item.storage_location || '', item.quantity_text || '']
    .filter(Boolean)
    .join(' · ')
}

function getExpiryTagClass(urgency: HomeFoodExpiryItem['urgency_level']): string {
  if (urgency === 'overdue') return 'overdue'
  if (urgency === 'today') return 'today'
  if (urgency === 'soon') return 'soon'
  return 'normal'
}

// 餐次对应的 iconfont 图标及颜色（与分析页保持一致）
const MEAL_ICON_CONFIG = {
  breakfast: { Icon: IconBreakfast, color: '#00bc7d', bgColor: '#ecfdf5', label: '早餐', iconClass: 'icon-zaocan1' },
  morning_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  lunch: { Icon: IconLunch, color: '#00bc7d', bgColor: '#ecfdf5', label: '午餐', iconClass: 'icon-wucan' },
  afternoon_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  dinner: { Icon: IconDinner, color: '#00bc7d', bgColor: '#ecfdf5', label: '晚餐', iconClass: 'icon-wancan' },
  evening_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐', iconClass: 'icon-lingshi' },
  snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '零食', iconClass: 'icon-lingshi' }
} as const

const SNACK_MEAL_TYPES = new Set(['morning_snack', 'afternoon_snack', 'evening_snack', 'snack'])

// 餐次进度条颜色：正常为绿色，超过100%为柔和红警示
const MEAL_PROGRESS_COLOR_NORMAL = '#00bc7d'
const MEAL_PROGRESS_COLOR_WARNING = HOME_WARNING_RED

// 营养素配置
const MACRO_CONFIGS: Array<{
  key: MacroKey
  label: string
  subLabel: string
  color: string
  unit: string
  iconClass: string
}> = [
  { key: 'protein', label: '蛋白质', subLabel: '剩余', color: '#5c9ed4', unit: 'g', iconClass: 'icon-danbaizhi' },
  { key: 'carbs', label: '碳水', subLabel: '剩余', color: '#d4ac52', unit: 'g', iconClass: 'icon-tanshui-dabiao' },
  { key: 'fat', label: '脂肪', subLabel: '剩余', color: '#f0985c', unit: 'g', iconClass: 'icon-zhifangyouheruhuazhifangzhipin' }
]

function IndexPage() {
  const initialSelectedDate = formatDateKey(new Date())
  const initialLocalSnapshot = getStoredHomeDashboardSnapshotByDate(initialSelectedDate)
  const [intakeData, setIntakeData] = useState<HomeIntakeData>(initialLocalSnapshot?.intakeData || DEFAULT_INTAKE)
  const [meals, setMeals] = useState<HomeMealItem[]>(initialLocalSnapshot?.meals || [])
  const [expirySummary, setExpirySummary] = useState<HomeFoodExpirySummary>(initialLocalSnapshot?.expirySummary || DEFAULT_EXPIRY_SUMMARY)
  const [weekHeatmapCells, setWeekHeatmapCells] = useState<WeekHeatmapCell[]>(() => buildWeekHeatmapCellsFromStorage())
  const [loading, setLoading] = useState(!initialLocalSnapshot)
  const [isSwitchingDate, setIsSwitchingDate] = useState(false)
  /** 后台静默同步中：左上角微型 spinner，不占文档流 */
  const [dataSyncing, setDataSyncing] = useState(false)
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetFormState>(createTargetForm(DEFAULT_INTAKE))
  
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate)

  // 体重/喝水状态
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsStorage>(getStoredBodyMetrics())
  /** 首页「运动」卡片：当日消耗千卡（与 dashboard 同步） */
  const [exerciseBurnedKcal, setExerciseBurnedKcal] = useState(initialLocalSnapshot?.exerciseBurnedKcal || 0)
  const [showWeightEditor, setShowWeightEditor] = useState(false)
  const [weightInput, setWeightInput] = useState('')
  const [savingWeight, setSavingWeight] = useState(false)
  const [showWaterEditor, setShowWaterEditor] = useState(false)
  const [waterInput, setWaterInput] = useState('')
  /** 自定义水量输入框聚焦（与草稿数字共同决定是否显示「添加」） */
  const [waterInputFocused, setWaterInputFocused] = useState(false)
  const [savingWater, setSavingWater] = useState(false)
  const waterBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 快速切换日期时忽略非最新一次 dashboard 的响应（微信小程序无 AbortController，无法掐断请求） */
  const loadDashboardSeqRef = useRef(0)
  /** 切日同步专用的 seq ref，避免与 loadDashboard 共用导致竞态丢弃 */
  const syncDashboardSeqRef = useRef(0)
  /** 防止并发重复请求：同日期 dashboard 正在加载中时跳过新调用 */
  const loadDashboardPendingRef = useRef<{ date: string; seq: number } | null>(null)
  /** 防止并发重复请求：切日同步专用的 pending ref */
  const syncDashboardPendingRef = useRef<{ date: string; seq: number } | null>(null)
  /** 最近一次成功拉取 dashboard 的日期与时间戳（用于回到首页时跳过重复请求） */
  const homeLastLoadRef = useRef<{ date: string; ts: number } | null>(null)
  /** 为 true 时下次「今日」展示必须重拉（饮食/运动/保质期等变更） */
  const homeDataStaleRef = useRef(true)

  // 记录菜单弹窗状态
  const [showRecordMenu, setShowRecordMenu] = useState(false)

  /** 首页仪表盘返回的成就（连续记录 / 全绿天数） */
  const [homeAchievement, setHomeAchievement] = useState<HomeAchievement>(initialLocalSnapshot?.achievement || { streak_days: 0, green_days: 0 })
  const [dailyPosterGenerating, setDailyPosterGenerating] = useState(false)
  const [dailyPosterImageUrl, setDailyPosterImageUrl] = useState<string | null>(null)
  const [showDailyPosterModal, setShowDailyPosterModal] = useState(false)

  // 餐食卡片操作状态
  const [mealActionSheetVisible, setMealActionSheetVisible] = useState(false)
  const [mealActionRecordId, setMealActionRecordId] = useState<string | null>(null)
  const [mealActionRecord, setMealActionRecord] = useState<FoodRecord | null>(null)
  const [showRecordEditModal, setShowRecordEditModal] = useState(false)
  const [showRecordPosterModal, setShowRecordPosterModal] = useState(false)
  /** 同一餐次多条记录时的选择面板 */
  const [mealRecordsDialogVisible, setMealRecordsDialogVisible] = useState(false)
  const [mealRecordsDialogMeal, setMealRecordsDialogMeal] = useState<HomeMealItem | null>(null)

  const showRecordPosterModalRef = useRef(false)
  const showDailyPosterModalRef = useRef(false)
  const mealPosterShareForAppMessageRef = useRef<MealPosterSharePayload | null>(null)
  const dailyPosterShareForAppMessageRef = useRef<{ imageUrl: string } | null>(null)

  useEffect(() => {
    showRecordPosterModalRef.current = showRecordPosterModal
  }, [showRecordPosterModal])

  useEffect(() => {
    showDailyPosterModalRef.current = showDailyPosterModal
  }, [showDailyPosterModal])

  const handleMealPosterShareContext = useCallback((ctx: MealPosterSharePayload | null) => {
    mealPosterShareForAppMessageRef.current = ctx
  }, [])

  useEffect(() => {
    if (showDailyPosterModal && dailyPosterImageUrl) {
      dailyPosterShareForAppMessageRef.current = { imageUrl: dailyPosterImageUrl }
    } else {
      dailyPosterShareForAppMessageRef.current = null
    }
  }, [showDailyPosterModal, dailyPosterImageUrl])

  // 加载指定日期的首页数据
  const loadDashboard = useCallback(async (targetDate?: string, silent = false) => {
    const resolvedDate =
      targetDate !== undefined && targetDate !== ''
        ? targetDate
        : (selectedDateRef.current || formatDateKey(new Date()))

    // 若同日期请求已在进行中，跳过本次调用（解决 useDidShow 多次触发导致的大量重复请求）
    if (
      loadDashboardPendingRef.current &&
      loadDashboardPendingRef.current.date === resolvedDate
    ) {
      return
    }
    const seq = ++loadDashboardSeqRef.current
    loadDashboardPendingRef.current = { date: resolvedDate, seq }
    /** 无参调用（如保质期事件、保存目标后刷新）必须与日历选中日期一致，否则会拉到「后端默认今天」覆盖当前选中日期的数据 */
    // resolvedDate 已在上方计算

    if (!getAccessToken()) {
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(0)
      setHomeAchievement({ streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
      setWeekHeatmapCells(createWeekHeatmapCells())
      setLoading(false)
      setIsSwitchingDate(false)
      return
    }

    if (!silent) {
      setLoading(true)
    } else {
      setDataSyncing(true)
    }
    try {
      const exerciseLogParams = { date: resolvedDate }
      const [res, stats, bodyMetricsRes, exerciseLogsRes] = await Promise.all([
        getHomeDashboard(resolvedDate),
        getStatsSummary('week'),
        fetchBodyMetricsSummaryRetry(),
        getExerciseLogs(exerciseLogParams).catch(() => null)
      ])
      if (seq !== loadDashboardSeqRef.current) {
        return
      }
      const intake = res.intakeData
      setIntakeData(intake)
      setMeals(res.meals || [])
      setExpirySummary(res.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      const nextExerciseKcal = mergeExerciseKcalFromDashboardAndLogs(res.exerciseBurnedKcal, exerciseLogsRes?.total_calories)
      setExerciseBurnedKcal(nextExerciseKcal)
      const nextAchievement = res.achievement ?? { streak_days: 0, green_days: 0 }
      setHomeAchievement(nextAchievement)
      setTargetForm(createTargetForm(intake))

      // 1. 先保存到本地 storage
      const normalizedDate = mapCalendarDateToApi(resolvedDate) || resolvedDate
      const nextSnapshot: HomeDashboardLocalSnapshot = {
        date: normalizedDate,
        updatedAt: Date.now(),
        intakeData: intake,
        meals: res.meals || [],
        expirySummary: res.expirySummary || DEFAULT_EXPIRY_SUMMARY,
        exerciseBurnedKcal: nextExerciseKcal,
        achievement: nextAchievement
      }
      const currentSnapshot = getStoredHomeDashboardSnapshotByDate(normalizedDate)
      if (!currentSnapshot || JSON.stringify({
        intakeData: currentSnapshot.intakeData,
        meals: currentSnapshot.meals,
        expirySummary: currentSnapshot.expirySummary,
        exerciseBurnedKcal: currentSnapshot.exerciseBurnedKcal,
        achievement: currentSnapshot.achievement
      }) !== JSON.stringify({
        intakeData: nextSnapshot.intakeData,
        meals: nextSnapshot.meals,
        expirySummary: nextSnapshot.expirySummary,
        exerciseBurnedKcal: nextSnapshot.exerciseBurnedKcal,
        achievement: nextSnapshot.achievement
      })) {
        saveHomeDashboardSnapshot(nextSnapshot)
      } else {
        saveHomeDashboardSnapshot({ ...currentSnapshot, updatedAt: Date.now() })
      }

      // 2. 再从 storage 优先、stats 回退构建7天热力图并更新 UI
      const today = new Date()
      const nextWeekHeatmapCells: WeekHeatmapCell[] = []
      for (let offset = -3; offset <= 3; offset++) {
        const date = new Date(today)
        date.setDate(today.getDate() + offset)
        const dateKey = formatDateKey(date)
        const snap = getStoredHomeDashboardSnapshotByDate(dateKey)
        const dayData = stats.daily_calories.find(d => normalizeTo2025(d.date) === normalizeTo2025(dateKey))
        const calories = snap ? snap.intakeData.current : (dayData?.calories || 0)
        const target = snap ? snap.intakeData.target : (stats.tdee || 2000)
        const hasRecord = calories > 0
        nextWeekHeatmapCells.push({
          date: dateKey,
          dayName: SHORT_DAY_NAMES[date.getDay()],
          dayNum: String(date.getDate()),
          calories,
          target,
          intakeRatio: hasRecord ? calories / target : 0,
          state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
          isToday: offset === 0
        })
      }
      setWeekHeatmapCells(nextWeekHeatmapCells)

      homeLastLoadRef.current = { date: resolvedDate, ts: Date.now() }
      homeDataStaleRef.current = false

      // 若本地缓存不足 7 天，后台异步补齐近 7 天数据
      void (async () => {
        try {
          const snapshots = getStoredHomeDashboardSnapshots()
          if (snapshots.length >= 7) return
          const today = new Date()
          const missingDates: string[] = []
          // 用 Array.from + forEach 替代 for 循环，规避 Terser 对带闭包 for 循环的已知优化 bug
          Array.from({ length: 7 }).forEach((_, idx) => {
            const offset = idx - 6
            const d = new Date(today)
            d.setDate(today.getDate() + offset)
            const dateKey = formatDateKey(d)
            if (!getStoredHomeDashboardSnapshotByDate(dateKey)) {
              missingDates.push(dateKey)
            }
          })
          if (missingDates.length === 0) return
          console.log('[dashboard-backfill] missing dates:', missingDates)
          const results = await Promise.all(
            missingDates.map(async (date) => {
              try {
                const dayRes = await getHomeDashboard(date)
                const normDate = mapCalendarDateToApi(date) || date
                return {
                  date: normDate,
                  updatedAt: Date.now(),
                  intakeData: dayRes.intakeData,
                  meals: dayRes.meals || [],
                  expirySummary: dayRes.expirySummary || DEFAULT_EXPIRY_SUMMARY,
                  exerciseBurnedKcal: dayRes.exerciseBurnedKcal || 0,
                  achievement: dayRes.achievement || { streak_days: 0, green_days: 0 }
                } as HomeDashboardLocalSnapshot
              } catch (err) {
                console.error('[dashboard-backfill] fetch failed for', date, err)
                return null
              }
            })
          )
          results.forEach((snapshot) => {
            if (snapshot) saveHomeDashboardSnapshot(snapshot)
          })
          // 完成后从缓存刷新热图 UI
          setWeekHeatmapCells(buildWeekHeatmapCellsFromStorage())
          // 若当前选中日期已补齐，同步刷新首页数据
          const currentDate = selectedDateRef.current || formatDateKey(new Date())
          const refreshed = getStoredHomeDashboardSnapshotByDate(currentDate)
          if (refreshed) {
            setIntakeData(refreshed.intakeData)
            setMeals(refreshed.meals || [])
            setExpirySummary(refreshed.expirySummary || DEFAULT_EXPIRY_SUMMARY)
            setExerciseBurnedKcal(refreshed.exerciseBurnedKcal || 0)
            setHomeAchievement(refreshed.achievement || { streak_days: 0, green_days: 0 })
            setTargetForm(createTargetForm(refreshed.intakeData || DEFAULT_INTAKE))
          }
          console.log('[dashboard-backfill] done')
        } catch (err) {
          console.error('[dashboard-backfill] unhandled error', err)
        }
      })()

      // 应用云端身体指标数据（失败时仍规范化本机日期键，避免 2025/2026 混用导致按日切换永远不变）
      if (bodyMetricsRes) {
        setBodyMetrics(prev => {
          const next = applyCloudBodyMetrics(prev, {
            weight_entries: bodyMetricsRes.weight_entries,
            water_daily: bodyMetricsRes.water_daily,
            water_goal_ml: bodyMetricsRes.water_goal_ml
          })
          saveBodyMetrics(next)
          return next
        })
      } else {
        setBodyMetrics(prev => {
          const next = normalizeBodyMetricsStorageKeys(prev)
          saveBodyMetrics(next)
          return next
        })
      }

    } catch (error) {
      if (seq !== loadDashboardSeqRef.current) {
        return
      }
      console.error('首页 dashboard 加载失败:', error)
      Taro.showToast({ title: '加载失败: ' + (error as Error).message, icon: 'none', duration: 3000 })
      const localFallback = getStoredHomeDashboardSnapshotByDate(resolvedDate)
      if (localFallback) {
        setIntakeData(localFallback.intakeData)
        setMeals(localFallback.meals || [])
        setExpirySummary(localFallback.expirySummary || DEFAULT_EXPIRY_SUMMARY)
        setExerciseBurnedKcal(localFallback.exerciseBurnedKcal || 0)
        setHomeAchievement(localFallback.achievement || { streak_days: 0, green_days: 0 })
        setTargetForm(createTargetForm(localFallback.intakeData || DEFAULT_INTAKE))
        setWeekHeatmapCells(buildWeekHeatmapCellsFromStorage())
      } else {
        setIntakeData(DEFAULT_INTAKE)
        setMeals([])
        setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
        setExerciseBurnedKcal(0)
        setHomeAchievement({ streak_days: 0, green_days: 0 })
        setWeekHeatmapCells(createWeekHeatmapCells())
        setTargetForm(createTargetForm(DEFAULT_INTAKE))
      }
    } finally {
      if (loadDashboardPendingRef.current?.seq === seq) {
        loadDashboardPendingRef.current = null
      }
      if (seq === loadDashboardSeqRef.current) {
        setLoading(false)
        setIsSwitchingDate(false)
        setDataSyncing(false)
      }
    }
  }, [setIntakeData, setMeals, setWeekHeatmapCells, setTargetForm, setLoading, setIsSwitchingDate])

  // 每次显示页面时刷新数据
  const selectedDateRef = useRef(selectedDate)
  selectedDateRef.current = selectedDate
  const skipNextRefreshRef = useRef(false)
  
  Taro.useDidShow(() => {
    const today = formatDateKey(new Date())
    const currentSelected = selectedDateRef.current

    // 检查是否需要显示记录菜单（从底部导航栏中间按钮点击）
    const shouldShowRecordMenu = Taro.getStorageSync('showRecordMenuModal')
    if (shouldShowRecordMenu) {
      Taro.removeStorageSync('showRecordMenuModal')
      setShowRecordMenu(true)
    }

    if (skipNextRefreshRef.current) {
      skipNextRefreshRef.current = false
      return
    }

    // 数据变脏（饮食/运动/保质期变更）时，无论当前选中哪天都应刷新
    const shouldRefresh = (currentSelected === today || !currentSelected) || homeDataStaleRef.current
    if (!shouldRefresh) {
      return
    }

    if (!getAccessToken()) {
      return
    }
    const targetDate = currentSelected || today

    // 若本地缓存的 meals 缺少蛋白质/脂肪/碳水，视为脏数据，强制走云端刷新
    const localSnapshot = getStoredHomeDashboardSnapshotByDate(targetDate)
    if (localSnapshot && (localSnapshot.meals || []).some(
      (meal) => typeof meal.protein !== 'number' || typeof meal.carbs !== 'number' || typeof meal.fat !== 'number'
    )) {
      homeDataStaleRef.current = true
    }

    const last = homeLastLoadRef.current
    const canCache =
      !homeDataStaleRef.current &&
      last !== null &&
      last.date === targetDate &&
      Date.now() - last.ts < HOME_DASHBOARD_CACHE_TTL_MS
    if (canCache) {
      return
    }
    if (localSnapshot) {
      setIntakeData(localSnapshot.intakeData)
      setMeals(localSnapshot.meals || [])
      setExpirySummary(localSnapshot.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(localSnapshot.exerciseBurnedKcal || 0)
      setHomeAchievement(localSnapshot.achievement || { streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(localSnapshot.intakeData || DEFAULT_INTAKE))
      setLoading(false)
    }
    void loadDashboard(targetDate, Boolean(localSnapshot))
  })

  useShareAppMessage(() => {
    if (showRecordPosterModalRef.current && mealPosterShareForAppMessageRef.current?.imageUrl) {
      const m = mealPosterShareForAppMessageRef.current
      const img = m.imageUrl
      // 若 imageUrl 是 canvasToTempFilePath 生成的本地临时路径，部分基础库/真机分享时无法识别
      // fallback 到记录原图（网络地址），确保分享卡片能正常显示自定义封面
      const isLocalTmp = /^wxfile:\/\/tmp\//i.test(img) || /^https?:\/\/tmp\//i.test(img)
      const shareImageUrl = isLocalTmp && mealActionRecord?.image_path ? mealActionRecord.image_path : img
      return { title: m.title, path: m.path, imageUrl: shareImageUrl }
    }
    if (showDailyPosterModalRef.current && dailyPosterShareForAppMessageRef.current?.imageUrl) {
      const d = dailyPosterShareForAppMessageRef.current
      const img = d.imageUrl
      const isLocalTmp = /^wxfile:\/\/tmp\//i.test(img) || /^https?:\/\/tmp\//i.test(img)
      // 每日小结海报无对应记录原图，本地路径在支持的基础库下可用；不支持的会自动用小程序默认封面
      const shareImageUrl = isLocalTmp ? undefined : img
      return {
        title: '今日饮食小结',
        path: '/pages/index/index',
        imageUrl: shareImageUrl
      }
    }
    return { title: '食探 - AI 智能饮食记录', path: '/pages/index/index' }
  })

  useShareTimeline(() => ({
    title: '食探 - AI 智能饮食记录'
  }))

  useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    } as any)
    // 清理旧版本缓存，避免脏数据干扰
    try {
      Taro.removeStorageSync('home_dashboard_local_cache_v1')
      Taro.removeStorageSync('home_dashboard_local_cache_v2')
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => () => {
    if (waterBlurTimerRef.current) {
      clearTimeout(waterBlurTimerRef.current)
    }
  }, [])

  /** 「今日小结」预览：自定义 tabBar 通过 storage 隐藏底栏（见 custom-tab-bar/updateHidden） */
  useEffect(() => {
    if (showDailyPosterModal) {
      try {
        Taro.setStorageSync('home_poster_modal_visible', '1')
      } catch {
        /* ignore */
      }
    } else {
      try {
        Taro.removeStorageSync('home_poster_modal_visible')
      } catch {
        /* ignore */
      }
    }
    return () => {
      try {
        Taro.removeStorageSync('home_poster_modal_visible')
      } catch {
        /* ignore */
      }
    }
  }, [showDailyPosterModal])

  /** 饮食/运动/保质期等变更：仅标记脏数据，回到首页或由 useDidShow 再拉，避免重复请求 */
  useEffect(() => {
    const markHomeStale = (): void => {
      homeDataStaleRef.current = true
      const today = formatDateKey(new Date())
      const currentSelected = selectedDateRef.current || today
      if (currentSelected !== today) {
        return
      }
      const localSnapshot = getStoredHomeDashboardSnapshotByDate(today)
      if (!localSnapshot) {
        return
      }
      setIntakeData(localSnapshot.intakeData)
      setMeals(localSnapshot.meals || [])
      setExpirySummary(localSnapshot.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(localSnapshot.exerciseBurnedKcal || 0)
      setHomeAchievement(localSnapshot.achievement || { streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(localSnapshot.intakeData || DEFAULT_INTAKE))
      setWeekHeatmapCells(buildWeekHeatmapCellsFromStorage())
    }
    Taro.eventCenter.on(FOOD_EXPIRY_CHANGED_EVENT, markHomeStale)
    Taro.eventCenter.on(HOME_DASHBOARD_REFRESH_EVENT, markHomeStale)
    Taro.eventCenter.on(HOME_INTAKE_DATA_CHANGED_EVENT, markHomeStale)
    return () => {
      Taro.eventCenter.off(FOOD_EXPIRY_CHANGED_EVENT, markHomeStale)
      Taro.eventCenter.off(HOME_DASHBOARD_REFRESH_EVENT, markHomeStale)
      Taro.eventCenter.off(HOME_INTAKE_DATA_CHANGED_EVENT, markHomeStale)
    }
  }, [])

  // 监听记录菜单标记变化（解决首页直接点击绿色按钮无响应问题）
  useEffect(() => {
    const checkRecordMenuFlag = () => {
      const shouldShow = Taro.getStorageSync('showRecordMenuModal')
      if (shouldShow) {
        Taro.removeStorageSync('showRecordMenuModal')
        setShowRecordMenu(true)
      }
    }

    // 立即检查一次
    checkRecordMenuFlag()

    // 设置轮询检查（每50ms检查一次，最多检查60秒）
    // 使用更短的间隔和更长的持续时间，确保捕获标记
    let checkCount = 0
    const maxChecks = 1200
    const timer = setInterval(() => {
      checkRecordMenuFlag()
      checkCount++
      if (checkCount >= maxChecks) {
        clearInterval(timer)
      }
    }, 50)

    return () => clearInterval(timer)
  }, [])

  // 额外：监听全局事件（备用方案，确保可靠性）
  useEffect(() => {
    const showRecordMenuHandler = () => {
      console.log('[DEBUG] 通过全局事件触发显示记录菜单')
      setShowRecordMenu(true)
    }
    Taro.eventCenter.on('showRecordMenu', showRecordMenuHandler)
    return () => {
      Taro.eventCenter.off('showRecordMenu', showRecordMenuHandler)
    }
  }, [])

  // 额外方案：监听 app 实例上的事件中心（供原生组件如 custom-tab-bar 使用）
  useEffect(() => {
    const showRecordMenuHandler = () => {
      console.log('[DEBUG] 通过 app eventCenter 触发显示记录菜单')
      setShowRecordMenu(true)
    }
    
    // 注册到 app 实例的事件中心，供 custom-tab-bar 调用
    try {
      const app = Taro.getApp()
      if (app) {
        if (!app.eventCenter) {
          app.eventCenter = { callbacks: {} }
        }
        if (!app.eventCenter.callbacks) {
          app.eventCenter.callbacks = {}
        }
        app.eventCenter.callbacks['showRecordMenu'] = showRecordMenuHandler
      }
    } catch (err) {
      console.error('[DEBUG] 注册 app eventCenter 失败:', err)
    }
    
    return () => {
      try {
        const app = Taro.getApp()
        if (app && app.eventCenter && app.eventCenter.callbacks) {
          delete app.eventCenter.callbacks['showRecordMenu']
        }
      } catch (err) {
        console.error('[DEBUG] 清理 app eventCenter 失败:', err)
      }
    }
  }, [])

  const openTargetEditor = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    setTargetForm(createTargetForm(intakeData))
    setShowTargetEditor(true)
  }

  const handleTargetInput = (key: keyof TargetFormState, value: string) => {
    setTargetForm((prev) => {
      const nextForm: TargetFormState = { ...prev, [key]: value }

      if (key === 'calorieTarget') {
        const nextCalorie = parseCompleteNumber(value)
        const baseMacros = parseMacroTargets(prev)
        if (nextCalorie == null || baseMacros == null) {
          return nextForm
        }

        const scaledMacros = scaleMacrosByCalorieTarget(nextCalorie, baseMacros)
        return {
          calorieTarget: formatTargetInput(nextCalorie),
          proteinTarget: formatTargetInput(scaledMacros.protein),
          carbsTarget: formatTargetInput(scaledMacros.carbs),
          fatTarget: formatTargetInput(scaledMacros.fat)
        }
      }

      if (key === 'proteinTarget' || key === 'carbsTarget' || key === 'fatTarget') {
        const macros = parseMacroTargets(nextForm)
        if (macros == null) {
          return nextForm
        }

        return {
          ...nextForm,
          calorieTarget: formatTargetInput(calcCaloriesFromMacros(macros))
        }
      }

      return nextForm
    })
  }

  const handleSaveTargets = async () => {
    // 「编辑今日目标」弹层仅支持数字表单（与 TargetEditor 一致）
    let payload: DashboardTargets = {
      calorie_target: Number(targetForm.calorieTarget),
      protein_target: Number(targetForm.proteinTarget),
      carbs_target: Number(targetForm.carbsTarget),
      fat_target: Number(targetForm.fatTarget)
    }

    if (Object.values(payload).some((value) => !Number.isFinite(value))) {
      Taro.showToast({ title: '请填写完整的数字目标', icon: 'none' })
      return
    }

    if (payload.calorie_target < 500 || payload.calorie_target > 6000) {
      Taro.showToast({ title: '热量目标需在 500-6000 kcal', icon: 'none' })
      return
    }

    if (payload.protein_target < 0 || payload.protein_target > 500) {
      Taro.showToast({ title: '蛋白质目标需在 0-500 g', icon: 'none' })
      return
    }

    if (payload.carbs_target < 0 || payload.carbs_target > 1000) {
      Taro.showToast({ title: '碳水目标需在 0-1000 g', icon: 'none' })
      return
    }

    if (payload.fat_target < 0 || payload.fat_target > 300) {
      Taro.showToast({ title: '脂肪目标需在 0-300 g', icon: 'none' })
      return
    }

    const normalized = alignPayloadWithCalorieTarget(payload)
    payload = normalized.payload

    setSavingTargets(true)
    try {
      const { saveScope } = await updateDashboardTargets(payload)
      setShowTargetEditor(false)
      await loadDashboard(selectedDateRef.current || formatDateKey(new Date()))
      if (saveScope === 'local') {
        Taro.showToast({
          title: normalized.adjusted
            ? '已按热量自动校准后暂存本机；后端升级后将自动同步云端'
            : '已暂存本机；部署最新后端后将自动同步云端',
          icon: 'none',
          duration: 3200,
        })
      } else {
        Taro.showToast({
          title: normalized.adjusted ? '已按热量自动校准并保存' : '目标已更新',
          icon: 'success'
        })
      }
    } catch (error) {
      Taro.showToast({ title: (error as Error).message || '保存失败', icon: 'none' })
    } finally {
      setSavingTargets(false)
    }
  }

  const handleQuickRecord = (type: 'photo' | 'text') => {
    if (type === 'photo' && !getAccessToken()) {
      redirectToLogin()
      return
    }
    Taro.setStorageSync('recordPageTab', type)
    Taro.switchTab({ url: '/pages/record/index' })
  }

  const handleViewAllMeals = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const raw = selectedDateRef.current || formatDateKey(new Date())
    const d = mapCalendarDateToApi(raw) || raw
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${encodeURIComponent(d)}` })
  }

  /** 「查看饮食统计」入口：进入当日记录列表 */
  const openDayRecordForSelectedDate = useCallback(() => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const d = mapCalendarDateToApi(selectedDate) || selectedDate
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${encodeURIComponent(d)}` })
  }, [selectedDate])

  /** 今日餐食单条 → 弹出记录操作菜单（多条同餐时先选记录） */
  const openMealRecordDetail = useCallback((meal: HomeMealItem) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    const openActionSheet = (recordId: string) => {
      setMealActionRecordId(recordId)
      setMealActionSheetVisible(true)
    }

    const entries = Array.isArray(meal.meal_record_entries) ? meal.meal_record_entries.filter((e) => e && String(e.id || '').trim()) : []
    if (entries.length === 0) {
      const rid = resolveHomeMealPrimaryRecordId(meal)
      if (!rid) {
        const raw = selectedDateRef.current || formatDateKey(new Date())
        const d = mapCalendarDateToApi(raw) || raw
        Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${encodeURIComponent(d)}` })
        return
      }
      openActionSheet(rid)
      return
    }
    if (entries.length === 1) {
      openActionSheet(entries[0].id)
      return
    }
    // 多条记录 → 弹出自定义面板
    setMealRecordsDialogMeal(meal)
    setMealRecordsDialogVisible(true)
  }, [])

  /** 从多记录面板中选择一条 → 关闭面板 → 打开操作菜单 */
  const handleSelectMealRecord = useCallback((recordId: string) => {
    setMealRecordsDialogVisible(false)
    setMealActionRecordId(recordId)
    setMealActionSheetVisible(true)
  }, [])

  const handleMealEdit = async () => {
    if (!mealActionRecordId) return
    const cachedRecord = getCachedMealFullRecord(mealActionRecordId)
    if (cachedRecord) {
      setMealActionRecord(cachedRecord)
      setShowRecordEditModal(true)
      return
    }
    Taro.showLoading({ title: '加载中...', mask: true })
    try {
      const res = await getSharedFoodRecord(mealActionRecordId)
      setMealActionRecord(res.record)
      setShowRecordEditModal(true)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  const handleMealPoster = async () => {
    if (!mealActionRecordId) return
    const cachedRecord = getCachedMealFullRecord(mealActionRecordId)
    if (cachedRecord) {
      setMealActionRecord(cachedRecord)
      setShowRecordPosterModal(true)
      return
    }
    Taro.showLoading({ title: '加载中...', mask: true })
    try {
      const res = await getSharedFoodRecord(mealActionRecordId)
      setMealActionRecord(res.record)
      setShowRecordPosterModal(true)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  const handleMealDelete = async () => {
    if (!mealActionRecordId) return
    const { confirm } = await Taro.showModal({
      title: '确认删除',
      content: '确定要删除这条饮食记录吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#e53e3e',
    })
    if (!confirm) return

    Taro.showLoading({ title: '删除中...', mask: true })
    try {
      await deleteFoodRecord(mealActionRecordId)

      // 先从当前 meals 中移除被删记录，做乐观更新
      let found = false
      const updatedMeals = meals.map((meal) => {
        const entries = meal.meal_record_entries || []
        const idx = entries.findIndex((e) => e.id === mealActionRecordId)
        if (idx === -1) return meal
        found = true
        const newEntries = entries.filter((_, i) => i !== idx)
        if (newEntries.length === 0) return null
        return { ...meal, meal_record_entries: newEntries }
      }).filter(Boolean) as HomeMealItem[]

      if (found) {
        setMeals(updatedMeals)
      }

      // 重新从后端拉取当日 dashboard，确保能量、宏量等数据准确
      const currentDate = selectedDateRef.current || formatDateKey(new Date())
      await syncDashboardForDate(currentDate)

      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
        Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
      } catch {
        /* ignore */
      }

      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (e: any) {
      Taro.showToast({ title: e.message || '删除失败', icon: 'none' })
    } finally {
      Taro.hideLoading()
    }
  }

  const handleRecordEditSuccess = () => {
    setShowRecordEditModal(false)
    const raw = selectedDateRef.current || formatDateKey(new Date())
    syncDashboardForDate(raw)
  }

  const openFoodExpiryList = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    Taro.navigateTo({ url: extraPkgUrl('/pages/expiry/index') })
  }

  const openFoodExpiryEdit = (id: string) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/expiry-edit/index')}?id=${encodeURIComponent(id)}` })
  }

  const openExerciseRecord = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const date = selectedDateRef.current || formatDateKey(new Date())
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(date)}` })
  }

  // 切日专用轻量同步：仅拉取该日 dashboard + 运动，不重复请求周统计/身体指标
  const syncDashboardForDate = useCallback(async (date: string) => {
    // 若同日期请求已在进行中，跳过本次调用
    if (
      syncDashboardPendingRef.current &&
      syncDashboardPendingRef.current.date === date
    ) {
      return
    }
    const seq = ++syncDashboardSeqRef.current
    syncDashboardPendingRef.current = { date, seq }
    if (!getAccessToken()) {
      syncDashboardPendingRef.current = null
      return
    }
    setDataSyncing(true)
    try {
      const [res, exerciseLogsRes] = await Promise.all([
        getHomeDashboard(date),
        getExerciseLogs({ date }).catch(() => null)
      ])
      if (seq !== syncDashboardSeqRef.current) return
      const intake = res.intakeData
      const nextExerciseKcal = mergeExerciseKcalFromDashboardAndLogs(res.exerciseBurnedKcal, exerciseLogsRes?.total_calories)
      const nextAchievement = res.achievement ?? { streak_days: 0, green_days: 0 }
      setIntakeData(intake)
      setMeals(res.meals || [])
      setExpirySummary(res.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(nextExerciseKcal)
      setHomeAchievement(nextAchievement)
      setTargetForm(createTargetForm(intake))
      const normalizedDate = mapCalendarDateToApi(date) || date
      saveHomeDashboardSnapshot({
        date: normalizedDate,
        updatedAt: Date.now(),
        intakeData: intake,
        meals: res.meals || [],
        expirySummary: res.expirySummary || DEFAULT_EXPIRY_SUMMARY,
        exerciseBurnedKcal: nextExerciseKcal,
        achievement: nextAchievement
      })
      // 同步更新该日期在周热图中的颜色
      setWeekHeatmapCells(prev => prev.map(cell => {
        if (cell.date !== date) return cell
        const calories = intake.current
        const target = intake.target
        const hasRecord = calories > 0
        return {
          ...cell,
          calories,
          target,
          intakeRatio: hasRecord ? calories / target : 0,
          state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit'
        }
      }))
      homeLastLoadRef.current = { date, ts: Date.now() }
      homeDataStaleRef.current = false
    } catch (err) {
      // 静默失败，不打扰用户；本地缓存已保证基本可用性
    } finally {
      if (syncDashboardPendingRef.current?.seq === seq) {
        syncDashboardPendingRef.current = null
      }
      setDataSyncing(false)
    }
  }, [setIntakeData, setMeals, setExpirySummary, setExerciseBurnedKcal, setHomeAchievement, setTargetForm])

  const handleDateSelect = (date: string) => {
    console.log('[DEBUG] 点击日期:', date, '当前日期:', selectedDate)
    skipNextRefreshRef.current = true
    setSelectedDate(date)
    // 1. 无条件从本地缓存读取并立刻渲染
    const localSnapshot = getStoredHomeDashboardSnapshotByDate(date)
    if (localSnapshot) {
      console.log('[DEBUG] 命中本地缓存:', date)
      setIntakeData(localSnapshot.intakeData)
      setMeals(localSnapshot.meals || [])
      setExpirySummary(localSnapshot.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(localSnapshot.exerciseBurnedKcal || 0)
      setHomeAchievement(localSnapshot.achievement || { streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(localSnapshot.intakeData || DEFAULT_INTAKE))
    } else {
      console.log('[DEBUG] 未命中本地缓存, 清空为默认态:', date)
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(0)
      setHomeAchievement({ streak_days: 0, green_days: 0 })
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
    }
    // 2. 结束 loading，确保用户立刻看到内容（或默认空态）
    setLoading(false)
    setIsSwitchingDate(false)
    // 3. 后台异步同步该日数据
    void syncDashboardForDate(date)
  }

  // 体重/喝水相关回调函数
  const openWeightEditor = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    const summary = deriveWeightSummary(bodyMetrics.weightEntries, selectedDate)
    setWeightInput(summary.latestWeight ? String(summary.latestWeight.value) : '')
    setShowWeightEditor(true)
  }

  const handleSaveWeight = async () => {
    const value = parseCompleteNumber(weightInput)
    if (value == null || value < 20 || value > 300) {
      Taro.showToast({ title: '请输入有效的体重值 (20-300 kg)', icon: 'none' })
      return
    }

    setSavingWeight(true)
    try {
      const res = await saveBodyWeightRecord(value, selectedDate)
      
      setBodyMetrics(prev => {
        const existingIndex = prev.weightEntries.findIndex(e => e.date === selectedDate)
        let nextEntries: WeightRecordEntry[]
        
        if (existingIndex >= 0) {
          nextEntries = [...prev.weightEntries]
          nextEntries[existingIndex] = {
            date: selectedDate,
            value: res.item.value,
            recorded_at: res.item.recorded_at || new Date().toISOString()
          }
        } else {
          nextEntries = [
            ...prev.weightEntries,
            {
              date: selectedDate,
              value: res.item.value,
              recorded_at: res.item.recorded_at || new Date().toISOString()
            }
          ]
        }
        
        nextEntries = sortWeightEntries(nextEntries).slice(-WEIGHT_HISTORY_LIMIT)
        const next = { ...prev, weightEntries: nextEntries }
        saveBodyMetrics(next)
        return next
      })

      setShowWeightEditor(false)
      Taro.showToast({ title: '体重已记录', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: (error as Error).message || '保存失败', icon: 'none' })
    } finally {
      setSavingWeight(false)
    }
  }

  const openWaterEditor = () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    if (waterBlurTimerRef.current) {
      clearTimeout(waterBlurTimerRef.current)
      waterBlurTimerRef.current = null
    }
    setWaterInput('')
    setWaterInputFocused(false)
    setShowWaterEditor(true)
  }

  const addWaterAmount = async (amount: number) => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    setSavingWater(true)
    try {
      await addBodyWaterLog(amount, selectedDate)
      
      setBodyMetrics(prev => {
        const next = addWaterToMetrics(prev, selectedDate, amount)
        saveBodyMetrics(next)
        return next
      })
      
      Taro.showToast({ title: `已添加 ${amount}ml`, icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: (error as Error).message || '记录失败', icon: 'none' })
    } finally {
      setSavingWater(false)
    }
  }

  const handleSaveWater = async () => {
    const amount = parseCompleteNumber(waterInput)
    if (amount == null || amount < 1 || amount > 5000) {
      Taro.showToast({ title: '请输入有效的喝水量 (1-5000 ml)', icon: 'none' })
      return
    }

    await addWaterAmount(amount)
    setShowWaterEditor(false)
    setWaterInput('')
    setWaterInputFocused(false)
  }

  const clearTodayWater = async () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    try {
      await resetBodyWaterLogs(selectedDate)
      
      setBodyMetrics(prev => {
        const next = clearWaterForDate(prev, selectedDate)
        saveBodyMetrics(next)
        return next
      })
      
      setShowWaterEditor(false)
      setWaterInputFocused(false)
      Taro.showToast({ title: '已清空今日喝水记录', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: (error as Error).message || '清空失败', icon: 'none' })
    }
  }

  // 餐食图片预览
  const previewHomeMealImages = (meal: HomeMealItem, startIndex = 0) => {
    const images = meal.images || []
    if (images.length === 0) return
    
    Taro.previewImage({
      current: images[startIndex],
      urls: images
    })
  }

  // 刷新身体指标数据
  const refreshBodyMetrics = useCallback(async () => {
    if (!getAccessToken()) return
    try {
      const res = await getBodyMetricsSummary('week')
      setBodyMetrics(prev => {
        const next = applyCloudBodyMetrics(prev, {
          weight_entries: res.weight_entries,
          water_daily: res.water_daily,
          water_goal_ml: res.water_goal_ml
        })
        saveBodyMetrics(next)
        return next
      })
    } catch (error) {
      console.error('刷新身体指标失败:', error)
    }
  }, [])

  const totalCurrent = normalizeDisplayNumber(intakeData.current)
  const totalTarget = normalizeDisplayNumber(intakeData.target)
  const remainingCalories = Math.max(0, Number((totalTarget - totalCurrent).toFixed(1)))
  const calorieProgress = normalizeProgressPercent(intakeData.progress, totalCurrent, totalTarget)
  /** 摄入超过目标时，下方进度条用警示红（与营养素超标一致） */
  const isCalorieOver = totalCurrent > totalTarget
  /** 左侧主数字：未超标为剩余可摄入；超标为超出目标的量（正数） */
  const calorieHeadlineBase = isCalorieOver
    ? Number((totalCurrent - totalTarget).toFixed(1))
    : remainingCalories

  /** 与 selectedDate 组合：切日后先 busy 再 idle；仅传日期时 resetDep 不变，遮罩结束时看不到缓动 */
  const dashboardBusy = loading || isSwitchingDate
  const dashboardAnimResetKey = `${selectedDate}|${dashboardBusy ? 'busy' : 'idle'}`

  /** 与主热量条、三大营养素圆环同为 600ms + easeOutCubic，避免数字与条不同步 */
  const animatedHeadlineCalories = useAnimatedNumber(calorieHeadlineBase, 600, 0, dashboardAnimResetKey)

  const calorieInputValue = parseCompleteNumber(targetForm.calorieTarget)
  const macroInputValues = parseMacroTargets(targetForm)
  const caloriesFromMacroInputs = macroInputValues ? calcCaloriesFromMacros(macroInputValues) : null
  const calorieGap =
    calorieInputValue != null && caloriesFromMacroInputs != null
      ? Number((calorieInputValue - caloriesFromMacroInputs).toFixed(1))
      : null
  const isRelationAligned = calorieGap != null && Math.abs(calorieGap) <= 1
  /** 登录用户展示食物保质期区块（无数据时显示引导） */
  const showFoodExpiryBlock = Boolean(getAccessToken())

  // 体重/喝水计算
  const weightSummary = useMemo(() => 
    deriveWeightSummary(bodyMetrics.weightEntries, selectedDate),
    [bodyMetrics.weightEntries, selectedDate]
  )
  
  const todayWater = useMemo(() => 
    getTodayWater(bodyMetrics, selectedDate),
    [bodyMetrics, selectedDate]
  )
  
  const waterProgress = calculateProgressPercent(todayWater.total, bodyMetrics.waterGoalMl)

  /** 三大营养素：用于圆环与中心克数缓动（与主热量条、喝水条一致，从 0/上一段插值到当前） */
  const proteinCur = normalizeDisplayNumber(intakeData.macros.protein.current)
  const proteinTargetRaw = normalizeDisplayNumber(intakeData.macros.protein.target)
  const proteinRingPct = Math.min(100, calculateProgressPercent(proteinCur, proteinTargetRaw))

  const carbsCur = normalizeDisplayNumber(intakeData.macros.carbs.current)
  const carbsTargetRaw = normalizeDisplayNumber(intakeData.macros.carbs.target)
  const carbsRingPct = Math.min(100, calculateProgressPercent(carbsCur, carbsTargetRaw))

  const fatCur = normalizeDisplayNumber(intakeData.macros.fat.current)
  const fatTargetRaw = normalizeDisplayNumber(intakeData.macros.fat.target)
  const fatRingPct = Math.min(100, calculateProgressPercent(fatCur, fatTargetRaw))

  const waterDraftMl = parseCompleteNumber(waterInput)
  const showWaterAddFooter =
    waterInputFocused || (waterDraftMl != null && waterDraftMl > 0)

  // 喝水动画（resetKey 含 busy/idle，与主卡一致）
  const animatedWaterTotal = useAnimatedNumber(todayWater.total, 600, 0, dashboardAnimResetKey)
  const animatedWaterProgress = useAnimatedProgress(waterProgress, 600, 0, dashboardAnimResetKey)

  /** 主热量进度条宽度（0～100），与上方 headline 数字同源缓动 */
  const animatedMainCalorieBarPct = useAnimatedProgress(
    dashboardBusy ? 0 : clampVisualProgress(calorieProgress),
    600,
    0,
    dashboardAnimResetKey
  )

  const animatedMacroProteinNum = useAnimatedNumber(dashboardBusy ? 0 : proteinCur, 600, 0, dashboardAnimResetKey)
  const animatedMacroCarbsNum = useAnimatedNumber(dashboardBusy ? 0 : carbsCur, 600, 0, dashboardAnimResetKey)
  const animatedMacroFatNum = useAnimatedNumber(dashboardBusy ? 0 : fatCur, 600, 0, dashboardAnimResetKey)

  const animatedMacroProteinRing = useAnimatedProgress(dashboardBusy ? 0 : proteinRingPct, 600, 0, dashboardAnimResetKey)
  const animatedMacroCarbsRing = useAnimatedProgress(dashboardBusy ? 0 : carbsRingPct, 600, 0, dashboardAnimResetKey)
  const animatedMacroFatRing = useAnimatedProgress(dashboardBusy ? 0 : fatRingPct, 600, 0, dashboardAnimResetKey)

  /** 运动消耗：默认 0，数据就绪后从 0 缓动到接口值（与喝水一致） */
  const exerciseAnimTarget = dashboardBusy ? 0 : exerciseBurnedKcal
  const animatedExerciseBurnedKcal = useAnimatedNumber(exerciseAnimTarget, 600, 0, dashboardAnimResetKey)

  const handleShareDailyPosterImage = useCallback(() => {
    if (!dailyPosterImageUrl) return
    // @ts-ignore
    Taro.showShareImageMenu({
      path: dailyPosterImageUrl,
      fail: (err: { errMsg?: string }) => {
        console.error('showShareImageMenu fail', err)
        Taro.showToast({ title: '分享失败，请保存图片后手动发送', icon: 'none' })
      }
    })
  }, [dailyPosterImageUrl])

  const handleSaveDailyPoster = useCallback(() => {
    if (!dailyPosterImageUrl) return
    Taro.saveImageToPhotosAlbum({
      filePath: dailyPosterImageUrl,
      success: () => {
        Taro.showToast({ title: '已保存到相册', icon: 'success' })
        setShowDailyPosterModal(false)
      },
      fail: (err) => {
        if (err.errMsg?.includes('auth deny') || err.errMsg?.includes('authorize')) {
          Taro.showModal({
            title: '提示',
            content: '需要您授权保存图片到相册',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) Taro.openSetting()
            }
          })
        } else {
          Taro.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  }, [dailyPosterImageUrl])

  const handleShareDailySummary = useCallback(() => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }
    if (loading || isSwitchingDate) {
      Taro.showToast({ title: '数据加载中，请稍候', icon: 'none' })
      return
    }
    if (dailyPosterGenerating) return

    setDailyPosterGenerating(true)
    Taro.showLoading({ title: '生成分享图...' })

    const query = Taro.createSelectorQuery()
    query
      .select('#homeDailyPosterCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res?.[0]?.node) {
          Taro.hideLoading()
          setDailyPosterGenerating(false)
          Taro.showToast({ title: '画布未就绪，请重试', icon: 'none' })
          return
        }
        const canvas = res[0].node as HTMLCanvasElement & {
          createImage?: () => {
            src: string
            onload: () => void
            onerror: (err?: unknown) => void
            width: number
            height: number
          }
        }
        const dpr = 2

        const loadImage = async (src: string): Promise<{ width: number; height: number } | null> => {
          if (!src || !canvas.createImage) return null

          let localSrc: string
          try {
            localSrc = await resolveCanvasImageSrc(src)
          } catch (e) {
            console.error('resolveCanvasImageSrc fail', src, e)
            return null
          }

          return new Promise<{ width: number; height: number } | null>((resolve) => {
            const img = canvas.createImage!()
            img.onload = () => resolve(img)
            img.onerror = (e) => {
              console.error('Load image fail', localSrc, e)
              resolve(null)
            }
            img.src = localSrc
          })
        }

        const loadQRImage = async (inviteCode: string) => {
          const scene = inviteCode ? `fi=${inviteCode}` : 'share=1'
          const isDevelopmentEnv =
            typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development'
          const envCandidates: Array<'develop' | 'trial' | 'release'> = isDevelopmentEnv
            ? ['develop', 'trial', 'release']
            : ['release', 'trial', 'develop']

          for (const envVersion of envCandidates) {
            try {
              const { base64 } = await getUnlimitedQRCode(scene, 'pages/index/index', envVersion)
              const img = await loadImage(base64)
              if (img) return img
            } catch (e) {
              console.warn(`QR code load failed for env=${envVersion}`, e)
            }
          }
          return null
        }

        const run = async (): Promise<void> => {
          let inviteCode = ''
          let sharerNickname = ''
          let avatarUrl = ''
          try {
            const uid = Taro.getStorageSync('user_id') as string
            if (uid) {
              const profile = await getFriendInviteProfile(uid)
              sharerNickname = profile.nickname || ''
              avatarUrl = profile.avatar || ''
              inviteCode = profile.invite_code || getInviteCodeFromUserId(uid)
            }
          } catch {
            /* 无头像昵称仍可出图 */
          }

          const [qrImg, avatarImg] = await Promise.all([loadQRImage(inviteCode), loadImage(avatarUrl || '')])

          const ctx = canvas.getContext('2d')
          if (!ctx) {
            Taro.hideLoading()
            setDailyPosterGenerating(false)
            Taro.showToast({ title: '画布不可用', icon: 'none' })
            return
          }

          const totalCurrent = normalizeDisplayNumber(intakeData.current)
          const totalTarget = normalizeDisplayNumber(intakeData.target)
          const waterProg = clampVisualProgress(
            calculateProgressPercent(todayWater.total, bodyMetrics.waterGoalMl)
          )

          const posterData: DailySummaryPosterInput = {
            dateLabelPrimary: formatPosterDatePrimary(selectedDate),
            dateLabelSecondary: formatPosterWeekdayLabel(selectedDate),
            posterDateKey: selectedDate,
            intakeCurrent: totalCurrent,
            intakeTarget: totalTarget,
            streakDays: Math.max(0, Math.floor(homeAchievement.streak_days)),
            greenDays: Math.max(0, Math.floor(homeAchievement.green_days)),
            macros: {
              protein: {
                current: normalizeDisplayNumber(intakeData.macros.protein.current),
                target: normalizeDisplayNumber(intakeData.macros.protein.target)
              },
              carbs: {
                current: normalizeDisplayNumber(intakeData.macros.carbs.current),
                target: normalizeDisplayNumber(intakeData.macros.carbs.target)
              },
              fat: {
                current: normalizeDisplayNumber(intakeData.macros.fat.current),
                target: normalizeDisplayNumber(intakeData.macros.fat.target)
              }
            },
            waterProgressPct: waterProg,
            waterCurrentMl: todayWater.total,
            waterGoalMl: bodyMetrics.waterGoalMl,
            exerciseKcal: Math.round(exerciseBurnedKcal)
          }

          const heightPx = computeDailySummaryPosterHeight(posterData)

          canvas.width = POSTER_WIDTH * dpr
          canvas.height = heightPx * dpr

          // 预加载 iconfont，供 Canvas 绘制底部统计图标使用
          try {
            const fontLoader = (canvas as any).loadFontFace
              ? (canvas as any).loadFontFace({
                  family: 'iconfont',
                  source: 'url("/assets/iconfont/iconfont.ttf")',
                })
              : Taro.loadFontFace({
                  family: 'iconfont',
                  source: 'url("/assets/iconfont/iconfont.ttf")',
                  global: true,
                })
            await fontLoader
            await new Promise((r) => setTimeout(r, 300))
          } catch {
            // ignore font load errors
          }

          // 字体加载后重新获取 context，确保 canvas 能使用新字体
          const posterCtx = canvas.getContext('2d')
          if (posterCtx) {
            posterCtx.scale(dpr, dpr)
          }

          drawDailySummaryPoster(posterCtx || ctx, {
            width: POSTER_WIDTH,
            height: heightPx,
            data: posterData,
            qrCodeImage: qrImg,
            sharerNickname,
            sharerAvatarImage: avatarImg
          })

          // JPG：真机存相册对 PNG/透明导出偶发失败；今日小结海报为实底
          Taro.canvasToTempFilePath({
            canvas: canvas as any,
            destWidth: POSTER_WIDTH * 2,
            destHeight: heightPx * 2,
            fileType: 'jpg',
            quality: 0.95,
            success: (resp) => {
              Taro.hideLoading()
              setDailyPosterGenerating(false)
              setDailyPosterImageUrl(resp.tempFilePath)
              setShowDailyPosterModal(true)
            },
            fail: (err) => {
              Taro.hideLoading()
              setDailyPosterGenerating(false)
              Taro.showToast({ title: '生成失败', icon: 'none' })
              console.error('canvasToTempFilePath fail', err)
            }
          })
        }

        void run().catch((e) => {
          Taro.hideLoading()
          setDailyPosterGenerating(false)
          Taro.showToast({ title: '生成失败', icon: 'none' })
          console.error('daily summary poster', e)
        })
      })
  }, [
    loading,
    isSwitchingDate,
    dailyPosterGenerating,
    intakeData,
    selectedDate,
    todayWater,
    bodyMetrics.waterGoalMl,
    exerciseBurnedKcal,
    homeAchievement
  ])

  return (
    <View className='home-page'>
      {/* 后台静默同步中：左上角微型 spinner */}
      {dataSyncing ? (
        <View className='home-page__data-sync'>
          <View className='home-page__data-sync-spinner' />
        </View>
      ) : null}
      {/* 页面内容 */}
      <View className='page-content'>
        {/* 问候区 */}
        <GreetingSection onSharePress={handleShareDailySummary} />

        {!getAccessToken() && (
          <View
            className='home-login-banner'
            onClick={() => redirectToLogin()}
          >
            <Text className='home-login-banner-text'>
              登录后可同步饮食记录、身体数据与云端目标
            </Text>
            <View className='home-login-banner-btn'>
              <Text className='home-login-banner-btn-text'>去登录</Text>
            </View>
          </View>
        )}

        {/* 日期选择器 */}
        <DateSelector 
          cells={weekHeatmapCells} 
          selectedDate={selectedDate} 
          onSelect={handleDateSelect} 
        />

        {/* 热量总览卡片 + 三大营养素合并（仅展示与编辑目标，不整卡跳转） */}
        <View className='main-card combined-card'>
          <View className='main-card-header'>
            <View className='main-card-title'>
              <Text className='card-label'>
                {dashboardBusy ? '剩余可摄入' : isCalorieOver ? '已超出' : '剩余可摄入'}
              </Text>
              {dashboardBusy ? (
                <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', marginTop: '8rpx' }}>
                  <Text className='card-value' style={{ fontSize: '36rpx', color: '#9ca3af' }}>--</Text>
                  <View className='loading-spinner' style={{ width: '24rpx', height: '24rpx', borderWidth: '3rpx' }} />
                </View>
              ) : (
                <Text className={`card-value${isCalorieOver ? ' is-over' : ''}`}>
                  {isCalorieOver
                    ? formatDisplayNumber(Math.round(animatedHeadlineCalories))
                    : formatNumberWithComma(Math.round(animatedHeadlineCalories))}
                </Text>
              )}
              {!dashboardBusy && <Text className='card-unit'>kcal</Text>}
            </View>
            <View className='target-section'>
              {dashboardBusy ? (
                <View className='target-energy-nums-only'>
                  <Text className='target-energy-num-muted'>--</Text>
                  <Text className='target-energy-slash-only'>/</Text>
                  <Text className='target-energy-num-muted'>--</Text>
                </View>
              ) : (
                <View className='target-energy-nums-only'>
                  <Text className={`target-energy-intake-num${isCalorieOver ? ' is-over' : ''}`}>
                    {formatDisplayNumber(Math.round(intakeData.current))}
                  </Text>
                  <Text className='target-energy-slash-only'>/</Text>
                  <Text className='target-energy-target-num'>
                    {formatDisplayNumber(Math.round(intakeData.target))}
                  </Text>
                </View>
              )}
              <View className='target-edit-btn' onClick={openTargetEditor}>
                <Text className='iconfont icon-target target-edit-icon' />
                <Text className='target-edit-text'>编辑目标</Text>
              </View>
            </View>
          </View>

          <View className='progress-section'>
            <View className={`progress-bar-bg thick${dashboardBusy ? ' loading-pulse' : ''}`}>
              <View
                className={`progress-bar-fill thick${isCalorieOver ? ' is-over' : ''}`}
                style={{ width: `${animatedMainCalorieBarPct}%` }}
              />
            </View>
          </View>

          {/* 三大营养素 - 合并到热量卡片内，左右布局 */}
          <View className='macros-section-horizontal'>
            {MACRO_CONFIGS.map(({ key, label, color, unit, iconClass }) => {
              const macro = intakeData.macros[key]
              const targetValue = macro?.target || 0
              const currentRaw = normalizeDisplayNumber(macro?.current)
              const targetRaw = normalizeDisplayNumber(macro?.target)
              const macroPct = calculateProgressPercent(currentRaw, targetRaw)
              const isMacroOver = macroPct > 100
              const macroExcessG = isMacroOver
                ? Number((Math.max(0, currentRaw - targetRaw)).toFixed(1))
                : null
              const ringStrokeColor = isMacroOver ? HOME_WARNING_RED : color
              const intakeTextColor = isMacroOver ? HOME_WARNING_RED : color

              const ringAnimPct =
                key === 'protein'
                  ? animatedMacroProteinRing
                  : key === 'carbs'
                    ? animatedMacroCarbsRing
                    : animatedMacroFatRing
              const intakeAnimNum =
                key === 'protein'
                  ? animatedMacroProteinNum
                  : key === 'carbs'
                    ? animatedMacroCarbsNum
                    : animatedMacroFatNum

              return (
                <View key={key} className={`macro-card-horizontal ${isMacroOver ? 'is-warning' : ''}`}>
                  {/* 左侧：超标时顶部极简超出量；名称 + 目标总量 */}
                  <View className='macro-left-content'>
                    <View className='macro-excess-slot'>
                      {macroExcessG != null && macroExcessG > 0 && (
                        <Text className='macro-over-hint'>+{formatDisplayNumber(macroExcessG)}g</Text>
                      )}
                    </View>
                    <View className='macro-title-row'>
                      <Text className={`iconfont ${iconClass}`} style={{ color, marginRight: '6rpx', fontSize: '26rpx' }} />
                      <Text className='macro-label-horizontal'>{label}</Text>
                    </View>
                    <View className='macro-value-row'>
                      <Text className='macro-current-value-inline' style={{ color: intakeTextColor }}>
                        {formatDisplayNumber(intakeAnimNum)}
                      </Text>
                      <Text className='macro-target-total'>
                        / {formatDisplayNumber(targetValue)}g
                      </Text>
                    </View>
                    {/* 进度条 */}
                    <View className='macro-progress-bar-bg'>
                      <View
                        className='macro-progress-bar-fill'
                        style={{
                          width: `${dashboardBusy ? 0 : Math.min(100, ringAnimPct)}%`,
                          backgroundColor: ringStrokeColor
                        }}
                      />
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {/* 体重/喝水状态卡片 */}
        <View className='body-status-section'>
          {/* 体重卡片 */}
          <View className='body-status-card weight-card' onClick={openWeightEditor}>
            <View className='body-status-header'>
              <View className='body-status-title-wrap'>
                <Text className='iconfont icon-weight-scale' style={{ marginRight: '6rpx', fontSize: '26rpx', color: '#6b7280' }} />
                <Text className='body-status-title'>体重</Text>
              </View>
            </View>
            <View className='body-status-content'>
              {dashboardBusy ? (
                <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', minHeight: '52rpx' }}>
                  <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
                  <View className='loading-spinner' style={{ width: '22rpx', height: '22rpx', borderWidth: '3rpx' }} />
                </View>
              ) : weightSummary.latestWeight ? (
                <>
                  <Text className='body-status-value'>{weightSummary.latestWeight.value.toFixed(1)}</Text>
                  <Text className='body-status-unit'>kg</Text>
                  {weightSummary.weightChange !== null && (
                    <Text className={`body-status-change ${weightSummary.weightChange > 0 ? 'up' : 'down'}`}>
                      {weightSummary.weightChange > 0 ? '+' : ''}{weightSummary.weightChange.toFixed(1)}
                    </Text>
                  )}
                </>
              ) : (
                <Text className='body-status-empty'>点击记录</Text>
              )}
            </View>
            <Text className='body-status-hint'>
              {weightSummary.latestWeight 
                ? `上次记录: ${weightSummary.latestWeight.date.slice(5)}`
                : '记录体重，追踪变化'}
            </Text>
          </View>

          {/* 喝水卡片 */}
          <View className='body-status-card water-card' onClick={openWaterEditor}>
            <View className='body-status-header'>
              <View className='body-status-title-wrap'>
                <Text className='iconfont icon-drink' style={{ marginRight: '6rpx', fontSize: '26rpx', color: '#5c9ed4' }} />
                <Text className='body-status-title'>喝水</Text>
              </View>
            </View>
            <View className='body-status-content'>
              {dashboardBusy ? (
                <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', minHeight: '52rpx' }}>
                  <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
                  <View className='loading-spinner' style={{ width: '22rpx', height: '22rpx', borderWidth: '3rpx' }} />
                </View>
              ) : (
                <>
                  <Text className='body-status-value'>{Math.round(animatedWaterTotal)}</Text>
                  <Text className='body-status-unit'>ml</Text>
                </>
              )}
            </View>
            <Text className='body-status-hint'>
              {dashboardBusy ? '记录喝水，保持水分' : `${Math.round(animatedWaterProgress)}% / 目标 ${bodyMetrics.waterGoalMl}ml`}
            </Text>
          </View>

          {/* 运动卡片 */}
          <View className='body-status-card exercise-card' onClick={openExerciseRecord}>
            <View className='body-status-header'>
              <View className='body-status-title-wrap'>
                <Text className='iconfont icon-dumbbell' style={{ marginRight: '6rpx', fontSize: '26rpx', color: '#f0985c' }} />
                <Text className='body-status-title'>运动</Text>
              </View>
            </View>
            <View className='body-status-content'>
              {dashboardBusy ? (
                <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', minHeight: '52rpx' }}>
                  <Text className='body-status-value' style={{ color: '#9ca3af' }}>--</Text>
                  <View className='loading-spinner' style={{ width: '22rpx', height: '22rpx', borderWidth: '3rpx' }} />
                </View>
              ) : (
                <>
                  <Text className='body-status-value'>
                    {Math.round(animatedExerciseBurnedKcal)}
                  </Text>
                  <Text className='body-status-unit'>kcal</Text>
                </>
              )}
            </View>
            <Text className='body-status-hint'>
              点击记录今日运动
            </Text>
          </View>
        </View>

        {/* 今日餐食区域 */}
        <View className='meals-section'>
          <View className='section-header'>
            <View className='meals-title-wrap'>
              <Text className='iconfont icon-canciguanli meals-title-icon' />
              <Text className='meals-title'>今日餐食</Text>
            </View>
            <View className='view-all-btn' onClick={handleViewAllMeals}>
              <Text className='iconfont icon-right-arrow view-all-arrow' />
            </View>
          </View>
          
          <View className='meals-list'>
            {loading ? (
              <View className='meals-skeleton'>
                {[1, 2, 3].map((i) => (
                  <View key={i} className='meal-skeleton-item'>
                    <View className='meal-skeleton-thumb' />
                    <View className='meal-skeleton-body'>
                      <View className='meal-skeleton-top'>
                        <View className='home-line-title' />
                        <View className='home-line-cal' />
                      </View>
                      <View className='home-skeleton-bar' />
                      <View className='meal-skeleton-foot'>
                        <View className='home-line-foot-l' />
                        <View className='home-line-foot-r' />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : meals.length === 0 ? (
              <View className='meals-empty'>
                <Empty>
                  <Empty.Image />
                  <Empty.Description>暂无今日餐食</Empty.Description>
                  <Button
                    shape='round'
                    color='primary'
                    className='empty-record-btn'
                    onClick={() => handleQuickRecord('photo')}
                  >
                    去记录一餐
                  </Button>
                </Empty>
              </View>
            ) : (
              meals.map((meal, index) => {
                const config = MEAL_ICON_CONFIG[meal.type as keyof typeof MEAL_ICON_CONFIG] ?? MEAL_ICON_CONFIG.snack
                const { Icon, color, bgColor, label, iconClass } = config
                const isSnackMeal = SNACK_MEAL_TYPES.has(meal.type)
                const mealCalorie = normalizeDisplayNumber(meal.calorie)
                const mealTarget = normalizeDisplayNumber(meal.target)
                const mealProgress = normalizeProgressPercent(meal.progress, mealCalorie, mealTarget)
                const mealImageUrls = Array.isArray(meal.image_paths) && meal.image_paths.length > 0
                  ? meal.image_paths.filter(Boolean)
                  : (meal.image_path ? [meal.image_path] : [])
                const previewImage = mealImageUrls[0] || ''
                const hasRealImage = mealImageUrls.length > 0


                return (
                  <View
                    key={`${meal.type}-${index}`}
                    className={`meal-item meal-item--tappable ${mealProgress > 100 ? 'is-warning' : ''}`}
                    onClick={() => openMealRecordDetail(meal)}
                  >
                    <View
                      className={`meal-media-wrap ${hasRealImage ? 'is-photo' : 'is-icon'}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        previewHomeMealImages(meal)
                      }}
                    >
                      {hasRealImage ? (
                        <Image
                          className='meal-thumb-image'
                          src={previewImage}
                          mode='aspectFill'
                        />
                      ) : (
                        <View className='meal-icon-wrap' style={{ backgroundColor: bgColor }}>
                          <Icon size={24} color={color} />
                        </View>
                      )}
                      {hasRealImage && mealImageUrls.length > 1 && (
                        <View className='meal-thumb-badge'>
                          <Text className='meal-thumb-badge-text'>共 {mealImageUrls.length} 张</Text>
                        </View>
                      )}
                    </View>
                    <View className='meal-content'>
                      {/* 第一行：描述 + 时间胶囊 */}
                      <View className='meal-header-block'>
                        <Text className='meal-desc' numberOfLines={1}>
                          {meal.description || meal.meal_record_entries?.map((e) => e.title).filter(Boolean).join('、') || meal.name || label}
                        </Text>
                        {(() => {
                          const entryCount = Array.isArray(meal.meal_record_entries) ? meal.meal_record_entries.filter((e) => e && String(e.id || '').trim()).length : 0
                          if (entryCount > 1) {
                            return (
                              <View className='meal-count-badge'>
                                <Text className='meal-count-badge-text'>{entryCount}次</Text>
                              </View>
                            )
                          }
                          return null
                        })()}
                        {meal.time ? (
                          <View className='meal-time-pill'>
                            <Text className='meal-time-pill-text'>{meal.time}</Text>
                          </View>
                        ) : null}
                      </View>
                      {/* 第二行：🔥 卡路里 + 餐次目标 */}
                      <View className='meal-calorie-row'>
                        <View className='meal-calorie-wrap'>
                          <Text className='iconfont icon-huore' style={{ color: '#f0985c', fontSize: '24rpx', marginRight: '4rpx' }} />
                          <Text className='meal-calorie'>
                            {formatDisplayNumber(mealCalorie)}
                            <Text className='meal-calorie-unit'> kcal</Text>
                          </Text>
                        </View>
                        <View className='meal-calorie-extra'>
                          <Text
                            className={`iconfont ${iconClass} meal-type-icon-inline`}
                            style={{ color }}
                          />
                          <Text className='meal-type-target'>
                            {label} {formatDisplayNumber(mealTarget)} kcal
                          </Text>
                        </View>
                      </View>
                      {/* 第三行：三大营养素 */}
                      <View className='meal-macros-row'>
                        {typeof meal.protein === 'number' && (
                          <View className='meal-macro-pill'>
                            <Text className='iconfont icon-danbaizhi' style={{ color: '#5c9ed4', fontSize: '22rpx', marginRight: '4rpx' }} />
                            <Text className='meal-macro-text'>{formatDisplayNumber(meal.protein)}g</Text>
                          </View>
                        )}
                        {typeof meal.carbs === 'number' && (
                          <View className='meal-macro-pill'>
                            <Text className='iconfont icon-tanshui-dabiao' style={{ color: '#dcac52', fontSize: '22rpx', marginRight: '4rpx' }} />
                            <Text className='meal-macro-text'>{formatDisplayNumber(meal.carbs)}g</Text>
                          </View>
                        )}
                        {typeof meal.fat === 'number' && (
                          <View className='meal-macro-pill'>
                            <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin' style={{ color: '#f0985c', fontSize: '22rpx', marginRight: '4rpx' }} />
                            <Text className='meal-macro-text'>{formatDisplayNumber(meal.fat)}g</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                )
              })
            )}
          </View>
        </View>

        {/* 食物保质期：快到期提醒（数据来自首页 dashboard） */}
        {showFoodExpiryBlock && (
          <View className='expiry-section'>
            <View className='section-header'>
              <View className='meals-title-wrap'>
                <Text className='iconfont icon-kefulan meals-title-icon' />
                <Text className='meals-title expiry-title'>食物保质期</Text>
              </View>
              <View className='view-all-btn' onClick={openFoodExpiryList}>
                <Text className='iconfont icon-right-arrow view-all-arrow' />
              </View>
            </View>

            <View className='expiry-card'>
              {loading ? (
                <View className='expiry-skeleton'>
                  {[1, 2, 3].map((i) => (
                    <View key={i} className='expiry-skeleton-item'>
                      <View className='expiry-skeleton-thumb' />
                      <View className='expiry-skeleton-body'>
                        <View className='expiry-skeleton-top'>
                          <View className='home-line-title' />
                          <View className='home-line-tag' />
                        </View>
                        <View className='expiry-skeleton-mid'>
                          <View className='home-line-foot-l' />
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : expirySummary.pendingCount === 0 ? (
                <View className='expiry-empty' onClick={openFoodExpiryList}>
                  <Text className='expiry-empty-title'>暂无待吃完记录</Text>
                  <Text className='expiry-empty-desc'>
                    添加家中食物与预计吃完时间，我们会在首页展示最紧急的几项并提醒即将过期。
                  </Text>
                </View>
              ) : (
                <>
                  <View className='expiry-list'>
                    {expirySummary.items.map((item) => {
                      const isUrgent = item.urgency_level === 'overdue' || item.urgency_level === 'today'
                      const iconClass = isUrgent ? 'icon-guoqi1' : 'icon-kefulan'
                      const iconColor =
                        item.urgency_level === 'overdue' ? '#dc2626'
                        : item.urgency_level === 'today' ? '#ea580c'
                        : item.urgency_level === 'soon' ? '#d97706'
                        : '#6b7280'
                      const bgColor =
                        item.urgency_level === 'overdue' ? '#fee2e2'
                        : item.urgency_level === 'today' ? '#ffedd5'
                        : item.urgency_level === 'soon' ? '#fef3c7'
                        : '#f3f4f6'

                      return (
                        <View
                          key={item.id}
                          className='expiry-item'
                          onClick={() => openFoodExpiryEdit(item.id)}
                        >
                          <View className='expiry-media-wrap'>
                            <View className='expiry-icon-wrap' style={{ backgroundColor: bgColor }}>
                              <Text className={`iconfont ${iconClass}`} style={{ color: iconColor, fontSize: '52rpx' }} />
                            </View>
                          </View>
                          <View className='expiry-content'>
                            <View className='expiry-header-block'>
                              <Text className='expiry-name' numberOfLines={1}>{item.food_name}</Text>
                              <View className='expiry-time-pill'>
                                <Text className='expiry-time-pill-text'>{getExpiryUrgencyText(item)}</Text>
                              </View>
                            </View>
                            <View className='expiry-meta-row'>
                              <Text className='expiry-meta-text'>{formatExpiryMeta(item) || '点击编辑'}</Text>
                            </View>
                          </View>
                        </View>
                      )
                    })}
                  </View>
                </>
              )}
            </View>
          </View>
        )}

        {/* 查看统计入口 */}
        <StatsEntry onClick={openDayRecordForSelectedDate} />

        {/* 底部留白 */}
        <View className='bottom-spacer' />
      </View>

      {/* 目标编辑弹窗 */}
      <TargetEditor
        visible={showTargetEditor}
        targetForm={targetForm}
        saving={savingTargets}
        onTargetFormChange={(newForm) => {
          // 同步处理targetForm变更
          const key = Object.keys(newForm).find(k => newForm[k as keyof typeof newForm] !== targetForm[k as keyof typeof targetForm])
          if (key) {
            handleTargetInput(key as keyof typeof targetForm, newForm[key as keyof typeof newForm])
          }
        }}
        onSave={handleSaveTargets}
        onClose={() => setShowTargetEditor(false)}
      />

      {/* 体重编辑弹窗 */}
      {showWeightEditor && (
        <View className='target-modal' catchMove>
          <View className='target-modal-mask' onClick={() => !savingWeight && setShowWeightEditor(false)} />
          <View className='target-modal-content'>
            <View className='target-modal-header'>
              <Text className='target-modal-title'>记录体重</Text>
              <Text className='target-modal-desc'>{selectedDate} 的体重记录</Text>
            </View>

            <View className='target-form-list'>
              <View className='target-form-item'>
                <Text className='target-form-label'>体重 (kg)</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='digit'
                    value={weightInput}
                    onInput={(e) => setWeightInput(e.detail.value)}
                    placeholder='请输入体重'
                  />
                  <Text className='target-input-unit'>kg</Text>
                </View>
              </View>
            </View>

            {weightSummary.latestWeight && weightSummary.latestWeight.date !== selectedDate && (
              <View className='target-relation-hint'>
                <Text className='target-relation-hint-title'>
                  最新记录: {weightSummary.latestWeight.value.toFixed(1)} kg ({weightSummary.latestWeight.date})
                </Text>
              </View>
            )}

            <View className='target-modal-actions'>
              <View className='target-modal-btn secondary' onClick={() => !savingWeight && setShowWeightEditor(false)}>
                <Text className='target-modal-btn-text secondary'>取消</Text>
              </View>
              <View className='target-modal-btn primary' onClick={handleSaveWeight}>
                {savingWeight ? <View className='btn-spinner' /> : <Text className='target-modal-btn-text primary'>保存</Text>}
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 喝水编辑弹窗 */}
      {showWaterEditor && (
        <View className='target-modal' catchMove>
          <View
            className='target-modal-mask'
            onClick={() => {
              if (!savingWater) {
                if (waterBlurTimerRef.current) {
                  clearTimeout(waterBlurTimerRef.current)
                  waterBlurTimerRef.current = null
                }
                setWaterInputFocused(false)
                setShowWaterEditor(false)
              }
            }}
          />
          <View className='target-modal-content water-modal-content'>
            <View className='target-modal-header'>
              <Text className='target-modal-title'>记录喝水</Text>
              <Text className='target-modal-desc'>今日已喝 {todayWater.total} ml</Text>
              {todayWater.total > 0 ? (
                <Text
                  className='water-modal-clear-link'
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!savingWater) void clearTodayWater()
                  }}
                >
                  清空今日记录
                </Text>
              ) : null}
            </View>

            {/* 快捷水量按钮 */}
            <View className='water-quick-actions'>
              {QUICK_WATER_AMOUNTS.map(amount => (
                <View 
                  key={amount} 
                  className='water-quick-btn'
                  onClick={() => addWaterAmount(amount)}
                >
                  <IconWaterDrop size={16} color='#5c9ed4' />
                  <Text className='water-quick-btn-text'>+{amount}ml</Text>
                </View>
              ))}
            </View>

            <View className='target-form-list'>
              <View className='target-form-item'>
                <Text className='target-form-label'>自定义水量 (ml)</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='number'
                    value={waterInput}
                    onInput={(e) => setWaterInput(e.detail.value)}
                    onFocus={() => {
                      if (waterBlurTimerRef.current) {
                        clearTimeout(waterBlurTimerRef.current)
                        waterBlurTimerRef.current = null
                      }
                      setWaterInputFocused(true)
                    }}
                    onBlur={() => {
                      waterBlurTimerRef.current = setTimeout(() => {
                        setWaterInputFocused(false)
                        waterBlurTimerRef.current = null
                      }, 200)
                    }}
                    placeholder='输入水量'
                  />
                  <Text className='target-input-unit'>ml</Text>
                </View>
              </View>
            </View>

            {todayWater.logs.length > 0 ? (
              <Text className='water-modal-records-hint'>
                已记录 {todayWater.logs.length} 次，共 {todayWater.total} ml
              </Text>
            ) : null}

            {showWaterAddFooter ? (
              <View className='target-modal-actions water-modal-actions-single'>
                <View className='target-modal-btn primary' onClick={handleSaveWater}>
                  {savingWater ? <View className='btn-spinner' /> : <Text className='target-modal-btn-text primary'>添加</Text>}
                </View>
              </View>
            ) : null}
          </View>
        </View>
      )}

      {/* 记录菜单弹窗 */}
      <RecordMenu visible={showRecordMenu} onClose={() => setShowRecordMenu(false)} />

      <View className='poster-canvas-wrap'>
        <Canvas
          type='2d'
          id='homeDailyPosterCanvas'
          className='poster-canvas'
          style={{ width: `${POSTER_WIDTH}px`, height: `${DAILY_SUMMARY_POSTER_MAX_HEIGHT}px` }}
        />
      </View>

      {showDailyPosterModal && dailyPosterImageUrl && (
        <View className='poster-modal poster-modal--sheet' catchMove>
          <View className='poster-modal-shell' catchMove>
            <View className='poster-modal-topbar poster-modal-topbar--light poster-modal-topbar--title-only'>
              <Text className='poster-modal-title poster-modal-title--light'>分享今日卡片</Text>
            </View>
            <View className='poster-modal-dark-body'>
              <View
                className='poster-modal-inline-back'
                onClick={() => setShowDailyPosterModal(false)}
              >
                {/* 与记录详情海报弹层相同的 × 关闭（poster-modal-close-x） */}
                <View className='poster-modal-close poster-modal-inline-close-hit'>
                  <Text className='poster-modal-close-x'>×</Text>
                </View>
              </View>
              <View className='poster-scroll-area'>
                <View className='poster-modal-scroll-inner'>
                  <View className='poster-modal-card-wrap'>
                    <Image src={dailyPosterImageUrl} mode='widthFix' className='poster-modal-image' />
                  </View>
                </View>
              </View>
            </View>
            <View className='poster-modal-bottom-bar'>
              <View className='poster-share-channel' onClick={handleShareDailyPosterImage}>
                <View className='poster-share-channel-icon poster-share-channel-icon-wechat'>
                  <Text className='iconfont icon-wechat poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>微信</Text>
              </View>
              <View className='poster-share-channel' onClick={handleSaveDailyPoster}>
                <View className='poster-share-channel-icon poster-share-channel-icon-save'>
                  <Text className='iconfont icon-download poster-share-channel-glyph' />
                </View>
                <Text className='poster-share-channel-label'>保存图片</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 同一餐次多条记录选择面板 */}
      <MealRecordsDialog
        visible={mealRecordsDialogVisible}
        meal={mealRecordsDialogMeal}
        onClose={() => setMealRecordsDialogVisible(false)}
        onSelectRecord={handleSelectMealRecord}
      />

      {/* 餐食卡片操作菜单 */}
      <MealActionSheet
        visible={mealActionSheetVisible}
        onClose={() => setMealActionSheetVisible(false)}
        onEdit={handleMealEdit}
        onPoster={handleMealPoster}
        onDelete={handleMealDelete}
      />

      {/* 餐食记录编辑弹窗 */}
      <MealRecordEditModal
        visible={showRecordEditModal}
        record={mealActionRecord}
        onClose={() => setShowRecordEditModal(false)}
        onSuccess={handleRecordEditSuccess}
      />

      {/* 餐食记录海报弹窗 */}
      <MealRecordPosterModal
        visible={showRecordPosterModal}
        record={mealActionRecord}
        onClose={() => setShowRecordPosterModal(false)}
        onShareContextChange={handleMealPosterShareContext}
      />
    </View>
  )
}

export default withAuth(IndexPage, { public: true })
