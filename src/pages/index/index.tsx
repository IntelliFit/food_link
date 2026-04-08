import { View, Text, Input, Image, Slider } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { Empty, Button } from '@taroify/core'
import {
  getHomeDashboard,
  getStatsSummary,
  getAccessToken,
  updateDashboardTargets,
  getStoredDashboardTargets,
  getBodyMetricsSummary,
  getExerciseLogs,
  saveBodyWeightRecord,
  addBodyWaterLog,
  resetBodyWaterLogs,
  mapCalendarDateToApi,
  type DashboardTargets,
  type HomeIntakeData,
  type HomeMealItem,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay,
  type HomeFoodExpiryItem,
  type HomeFoodExpirySummary
} from '../../utils/api'
import { IconCamera, IconText, IconProtein, IconCarbs, IconFat, IconBreakfast, IconLunch, IconDinner, IconSnack, IconTrendingUp, IconChevronRight, IconWaterDrop } from '../../components/iconfont'
import CustomNavBar, { getStatusBarHeightSafe } from '../../components/CustomNavBar'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../utils/food-expiry-events'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../utils/home-events'

import './index.scss'
import { withAuth } from '../../utils/withAuth'

// 导入拆分出的模块
import { type WeightRecordEntry, type BodyMetricsStorage, type WaterRecord, type MacroKey, type WeekHeatmapState, type WeekHeatmapCell, type TargetFormState, type MacroTargets } from './types'
import {
  DEFAULT_INTAKE,
  WEIGHT_HISTORY_LIMIT,
  QUICK_WATER_AMOUNTS,
  WATER_GOAL_DEFAULT,
  DAY_NAMES,
  SHORT_DAY_NAMES,
  HOME_WARNING_RED
} from './utils/constants'
import { getGreeting, formatDisplayNumber, formatNumberWithComma, formatDateKey, createTargetForm, createWeekHeatmapCells } from './utils/helpers'
import { useAnimatedNumber, useAnimatedProgress } from './hooks'
import { TargetEditor, GreetingSection, DateSelector, StatsEntry, RecordMenu } from './components'

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

const DEFAULT_EXPIRY_SUMMARY: HomeFoodExpirySummary = {
  pendingCount: 0,
  soonCount: 0,
  overdueCount: 0,
  items: []
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

function getExpiryTagClass(urgency: FoodExpiryItem['urgency_level']): string {
  if (urgency === 'overdue') return 'overdue'
  if (urgency === 'today') return 'today'
  if (urgency === 'soon') return 'soon'
  return 'normal'
}

// 餐次对应的 iconfont 图标及颜色
const MEAL_ICON_CONFIG = {
  breakfast: { Icon: IconBreakfast, color: '#00bc7d', bgColor: '#ecfdf5', label: '早餐' },
  morning_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐' },
  lunch: { Icon: IconLunch, color: '#00bc7d', bgColor: '#ecfdf5', label: '午餐' },
  afternoon_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐' },
  dinner: { Icon: IconDinner, color: '#00bc7d', bgColor: '#ecfdf5', label: '晚餐' },
  evening_snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '加餐' },
  snack: { Icon: IconSnack, color: '#8b5cf6', bgColor: '#f3e8ff', label: '零食' }
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
  Icon: typeof IconProtein
}> = [
  { key: 'protein', label: '蛋白质', subLabel: '剩余', color: '#3b82f6', unit: 'g', Icon: IconProtein },
  { key: 'carbs', label: '碳水', subLabel: '剩余', color: '#eab308', unit: 'g', Icon: IconCarbs },
  { key: 'fat', label: '脂肪', subLabel: '剩余', color: '#f97316', unit: 'g', Icon: IconFat }
]

function IndexPage() {
  const [intakeData, setIntakeData] = useState<HomeIntakeData>(DEFAULT_INTAKE)
  const [meals, setMeals] = useState<HomeMealItem[]>([])
  const [expirySummary, setExpirySummary] = useState<HomeFoodExpirySummary>(DEFAULT_EXPIRY_SUMMARY)
  const [weekHeatmapCells, setWeekHeatmapCells] = useState<WeekHeatmapCell[]>(createWeekHeatmapCells())
  const [loading, setLoading] = useState(true)
  const [isSwitchingDate, setIsSwitchingDate] = useState(false)
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetFormState>(createTargetForm(DEFAULT_INTAKE))
  
  const [selectedDate, setSelectedDate] = useState(formatDateKey(new Date()))

  // 体重/喝水状态
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsStorage>(getStoredBodyMetrics())
  /** 首页「运动」卡片：当日消耗千卡（与 dashboard 同步） */
  const [exerciseBurnedKcal, setExerciseBurnedKcal] = useState(0)
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

  // 记录菜单弹窗状态
  const [showRecordMenu, setShowRecordMenu] = useState(false)

  // 加载指定日期的首页数据
  const loadDashboard = useCallback(async (targetDate?: string) => {
    const seq = ++loadDashboardSeqRef.current
    /** 无参调用（如保质期事件、保存目标后刷新）必须与日历选中日期一致，否则会拉到「后端默认今天」覆盖当前选中日期的数据 */
    const resolvedDate =
      targetDate !== undefined && targetDate !== ''
        ? targetDate
        : (selectedDateRef.current || formatDateKey(new Date()))

    console.log('[DEBUG] loadDashboard 被调用, targetDate:', targetDate, 'resolvedDate:', resolvedDate, 'seq:', seq)
    console.log('[DEBUG] getAccessToken:', getAccessToken() ? '有token' : '无token')
    if (!getAccessToken()) {
      console.log('[DEBUG] 无token，返回默认值')
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(0)
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
      setWeekHeatmapCells(createWeekHeatmapCells())
      setLoading(false)
      setIsSwitchingDate(false)
      return
    }

    setLoading(true)
    try {
      console.log('[DEBUG] 请求 API, date:', resolvedDate)
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
      console.log('[DEBUG] API 返回:', res)
      console.log('[DEBUG] intakeData.current:', res.intakeData?.current)
      console.log('[DEBUG] intakeData.macros:', res.intakeData?.macros)
      const intake = res.intakeData
      console.log('[DEBUG] 处理后的 intake:', intake)
      
      console.log('[DEBUG] 设置 intakeData:', intake)
      setIntakeData(intake)
      console.log('[DEBUG] 设置 meals:', res.meals)
      setMeals(res.meals || [])
      
      // 构建7天热力图数据 - 始终以今天为中心（不随点击滚动）
      const today = new Date()
      console.log('[DEBUG] 构建热力图, 中心日期(今天):', formatDateKey(today))
      const nextWeekHeatmapCells: WeekHeatmapCell[] = []
      for (let offset = -3; offset <= 3; offset++) {
        const date = new Date(today)
        date.setDate(today.getDate() + offset)
        const dateKey = formatDateKey(date)
        const dayData = stats.daily_calories.find(d => normalizeTo2025(d.date) === normalizeTo2025(dateKey))
        const hasRecord = dayData && dayData.calories > 0
        const calories = dayData?.calories || 0
        const target = stats.tdee || 2000
        const intakeRatio = hasRecord ? calories / target : 0
        
        nextWeekHeatmapCells.push({
          date: dateKey,
          dayName: SHORT_DAY_NAMES[date.getDay()],
          dayNum: String(date.getDate()),
          calories,
          target,
          intakeRatio,
          state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
          isToday: offset === 0
        })
      }
      setExpirySummary(res.expirySummary || DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(
        mergeExerciseKcalFromDashboardAndLogs(res.exerciseBurnedKcal, exerciseLogsRes?.total_calories)
      )
      setWeekHeatmapCells(nextWeekHeatmapCells)
      setTargetForm(createTargetForm(intake))

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

      console.log('[DEBUG] 所有数据设置完成')
    } catch (error) {
      if (seq !== loadDashboardSeqRef.current) {
        return
      }
      console.error('[DEBUG] API 调用失败:', error)
      Taro.showToast({ title: '加载失败: ' + (error as Error).message, icon: 'none', duration: 3000 })
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setExpirySummary(DEFAULT_EXPIRY_SUMMARY)
      setExerciseBurnedKcal(0)
      setWeekHeatmapCells(createWeekHeatmapCells())
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
    } finally {
      if (seq === loadDashboardSeqRef.current) {
        setLoading(false)
        setIsSwitchingDate(false)
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
    console.log('[DEBUG] useDidShow, selectedDate:', currentSelected, 'today:', today, 'skip:', skipNextRefreshRef.current)

    // 检查是否需要显示记录菜单（从底部导航栏中间按钮点击）
    const shouldShowRecordMenu = Taro.getStorageSync('showRecordMenuModal')
    if (shouldShowRecordMenu) {
      Taro.removeStorageSync('showRecordMenuModal')
      setShowRecordMenu(true)
    }

    if (skipNextRefreshRef.current) {
      console.log('[DEBUG] 跳过本次刷新')
      skipNextRefreshRef.current = false
      return
    }

    if (currentSelected === today || !currentSelected) {
      console.log('[DEBUG] 刷新今天数据')
      loadDashboard(today)
    } else {
      console.log('[DEBUG] 当前显示非今天，不自动刷新')
    }
  })

  /**
   * 挂载后补拉一次 dashboard（含运动消耗）。
   * 部分环境下仅依赖 useDidShow 会晚于首屏或时序异常，导致运动千卡一直为 0。
   */
  useEffect(() => {
    const today = formatDateKey(new Date())
    if (!getAccessToken()) {
      return
    }
    if (skipNextRefreshRef.current) {
      skipNextRefreshRef.current = false
      return
    }
    const cur = selectedDateRef.current
    if (cur === today || !cur) {
      void loadDashboard(today)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏补拉，避免与 loadDashboard 依赖链重复触发
  }, [])

  useShareAppMessage(() => ({
    title: '食探 - AI 智能饮食记录',
    path: '/pages/index/index'
  }))

  useShareTimeline(() => ({
    title: '食探 - AI 智能饮食记录'
  }))

  useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
  }, [])

  useEffect(() => () => {
    if (waterBlurTimerRef.current) {
      clearTimeout(waterBlurTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const refreshHome = () => {
      loadDashboard()
    }
    Taro.eventCenter.on(FOOD_EXPIRY_CHANGED_EVENT, refreshHome)
    return () => {
      Taro.eventCenter.off(FOOD_EXPIRY_CHANGED_EVENT, refreshHome)
    }
  }, [loadDashboard])

  /** 记运动落库后通知：仅在看「今天」时重拉 dashboard，与 exerciseBurnedKcal 对齐 */
  useEffect(() => {
    const onExerciseRefresh = (): void => {
      const today = formatDateKey(new Date())
      const currentSelected = selectedDateRef.current
      if (currentSelected === today || !currentSelected) {
        loadDashboard(today)
      }
    }
    Taro.eventCenter.on(HOME_DASHBOARD_REFRESH_EVENT, onExerciseRefresh)
    return () => {
      Taro.eventCenter.off(HOME_DASHBOARD_REFRESH_EVENT, onExerciseRefresh)
    }
  }, [loadDashboard])

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
      Taro.showToast({ title: '登录后可编辑目标', icon: 'none' })
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
    let payload: DashboardTargets
    
    // 根据当前模式计算payload
    if (targetMode === 'simple') {
      // 普通模式：从档位计算实际克数
      const protein = getGramsFromLevel('protein', simpleTarget.proteinLevel)
      const carbs = getGramsFromLevel('carbs', simpleTarget.carbsLevel)
      const fat = getGramsFromLevel('fat', simpleTarget.fatLevel)
      const calories = calculateCaloriesFromLevels(simpleTarget)
      
      payload = {
        calorie_target: calories,
        protein_target: protein,
        carbs_target: carbs,
        fat_target: fat
      }
    } else {
      // 精确模式：使用表单输入值
      payload = {
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
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.setStorageSync('recordPageTab', type)
    Taro.switchTab({ url: '/pages/record/index' })
  }

  const handleViewAllMeals = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    const raw = selectedDateRef.current || formatDateKey(new Date())
    const d = mapCalendarDateToApi(raw) || raw
    Taro.navigateTo({ url: `/pages/day-record/index?date=${encodeURIComponent(d)}` })
  }

  /** 「查看饮食统计」入口：进入当日记录列表 */
  const openDayRecordForSelectedDate = useCallback(() => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    const d = mapCalendarDateToApi(selectedDate) || selectedDate
    Taro.navigateTo({ url: `/pages/day-record/index?date=${encodeURIComponent(d)}` })
  }, [selectedDate])

  /** 今日餐食单条 → 该餐最新一条识别记录详情（生成分享海报）；缩略图点击仍为预览图片 */
  const openMealRecordDetail = useCallback((meal: HomeMealItem) => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    const rid = meal.primary_record_id
    if (!rid || String(rid).trim() === '') {
      Taro.showToast({ title: '暂无关联记录，请稍后重试', icon: 'none' })
      return
    }
    Taro.navigateTo({
      url: `/pages/record-detail/index?id=${encodeURIComponent(String(rid))}&ui=home`
    })
  }, [])

  const openFoodExpiryList = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.navigateTo({ url: '/pages/expiry/index' })
  }

  const openFoodExpiryEdit = (id: string) => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.navigateTo({ url: `/pages/expiry-edit/index?id=${encodeURIComponent(id)}` })
  }

  const openExerciseRecord = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.navigateTo({ url: '/pages/exercise-record/index' })
  }

  const handleDateSelect = (date: string) => {
    console.log('[DEBUG] 点击日期:', date, '当前日期:', selectedDate)
    skipNextRefreshRef.current = true
    setSelectedDate(date)
    // 立即进入日期切换状态，显示加载中并归零数字
    setIsSwitchingDate(true)
    // 先清空当前数据，让数字归零
    setIntakeData((prev) => ({
      ...prev,
      current: 0,
      progress: 0,
      macros: {
        protein: { ...prev.macros.protein, current: 0 },
        carbs: { ...prev.macros.carbs, current: 0 },
        fat: { ...prev.macros.fat, current: 0 },
      },
    }))
    loadDashboard(date)
  }

  // 体重/喝水相关回调函数
  const openWeightEditor = () => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '登录后可记录体重', icon: 'none' })
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
      Taro.showToast({ title: '登录后可记录喝水', icon: 'none' })
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
      Taro.showToast({ title: '登录后可记录喝水', icon: 'none' })
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
      Taro.showToast({ title: '登录后可操作', icon: 'none' })
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

  return (
    <View className='home-page'>
      {/* 页面内容 */}
      <View className='page-content'>
        {/* 问候区 */}
        <GreetingSection />

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
            {MACRO_CONFIGS.map(({ key, label, color, unit, Icon }) => {
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
                    {macroExcessG != null && macroExcessG > 0 && (
                      <Text className='macro-over-hint'>+{formatDisplayNumber(macroExcessG)}g</Text>
                    )}
                    <View className='macro-title-row'>
                      <Text className='macro-label-horizontal'>{label}</Text>
                    </View>
                    <View className='macro-value-row'>
                      <Text className='macro-target-value'>
                        {formatDisplayNumber(targetValue)}
                      </Text>
                      <Text className='macro-target-unit'>g</Text>
                    </View>
                  </View>

                  {/* 右侧：仪表盘 */}
                  <View className='macro-gauge-box-horizontal'>
                    <View className='macro-gauge-horizontal'>
                      <View
                        className='macro-ring-bg-horizontal'
                        style={{
                          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                            `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><circle cx='60' cy='60' r='48' fill='none' stroke='#f0f0f0' stroke-width='14'/><circle cx='60' cy='60' r='48' fill='none' stroke='${ringStrokeColor}' stroke-width='14' stroke-linecap='round' stroke-dasharray='${2 * Math.PI * 48}' stroke-dashoffset='${2 * Math.PI * 48 * (1 - ringAnimPct / 100)}'/></svg>`
                          )}")`,
                          backgroundSize: '100% 100%'
                        }}
                      />
                      <View className='macro-gauge-center-horizontal'>
                        {dashboardBusy ? (
                          <View className='loading-dots-inline'>
                            <View className='loading-dot' />
                            <View className='loading-dot' />
                            <View className='loading-dot' />
                          </View>
                        ) : (
                          <View className='macro-gauge-text-wrap'>
                            <Text className='macro-intake-value' style={{ color: intakeTextColor }}>
                              {formatDisplayNumber(intakeAnimNum)}
                            </Text>
                          </View>
                        )}
                      </View>
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
            <View className='body-status-progress-wrap'>
              <View className='body-status-progress-bg'>
                <View 
                  className='body-status-progress-fill water'
                  style={{ width: `${dashboardBusy ? 0 : clampVisualProgress(animatedWaterProgress)}%` }}
                />
              </View>
              <Text className='body-status-progress-text'>
                {dashboardBusy ? '-- 加载中' : `${Math.round(animatedWaterProgress)}% / ${bodyMetrics.waterGoalMl}ml`}
              </Text>
            </View>
          </View>

          {/* 运动卡片 */}
          <View className='body-status-card exercise-card' onClick={openExerciseRecord}>
            <View className='body-status-header'>
              <View className='body-status-title-wrap'>
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
            <Text className='meals-title'>今日餐食</Text>
            <View className='view-all-btn' onClick={handleViewAllMeals}>
              <Text className='view-all-text'>查看全部</Text>
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
                const { Icon, color, bgColor, label } = config
                const isSnackMeal = SNACK_MEAL_TYPES.has(meal.type)
                const mealCalorie = normalizeDisplayNumber(meal.calorie)
                const mealTarget = normalizeDisplayNumber(meal.target)
                const mealProgress = normalizeProgressPercent(meal.progress, mealCalorie, mealTarget)
                const mealImageUrls = Array.isArray(meal.image_paths) && meal.image_paths.length > 0
                  ? meal.image_paths.filter(Boolean)
                  : (meal.image_path ? [meal.image_path] : [])
                const previewImage = mealImageUrls[0] || ''
                const hasRealImage = mealImageUrls.length > 0
                const targetText = isSnackMeal
                  ? `参考 ${formatDisplayNumber(mealTarget)} kcal`
                  : `目标 ${formatDisplayNumber(mealTarget)} kcal`
                
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
                          <Text className='meal-thumb-badge-text'>{mealImageUrls.length}张</Text>
                        </View>
                      )}
                    </View>
                    <View className='meal-content'>
                      <View className='meal-main'>
                        <View className='meal-header-block'>
                          <View className='meal-title-left'>
                            <Text className='meal-name'>{meal.name || label}</Text>
                            {isSnackMeal && (
                              <Text className='meal-snack-hint'>参考</Text>
                            )}
                          </View>
                          <View className='meal-header-right'>
                            <Text className='meal-calorie'>
                              {formatDisplayNumber(mealCalorie)}
                              <Text className='meal-calorie-unit'> kcal</Text>
                            </Text>
                            {meal.time ? (
                              <Text className='meal-time-inline'>{meal.time}</Text>
                            ) : null}
                          </View>
                        </View>
                      </View>
                      <View className='meal-progress-wrap'>
                        <View className='meal-progress-bar-bg'>
                          <View
                            className={`meal-progress-bar-fill ${mealProgress > 100 ? 'is-warning' : ''}`}
                            style={{
                              width: `${clampVisualProgress(mealProgress)}%`,
                              backgroundColor: mealProgress > 100 ? MEAL_PROGRESS_COLOR_WARNING : MEAL_PROGRESS_COLOR_NORMAL
                            }}
                          />
                        </View>
                      </View>
                      <View className='meal-progress-foot'>
                        <Text className='meal-progress-text'>{targetText}</Text>
                        <Text className={`meal-progress-percent ${mealProgress > 100 ? 'is-over' : ''}`}>{formatProgressText(mealProgress)}</Text>
                      </View>
                      {meal.tags?.length > 0 && (
                        <View className='meal-tags'>
                          {meal.tags.map((tag) => (
                            <Text key={tag} className='meal-tag'>{tag}</Text>
                          ))}
                        </View>
                      )}
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
              <Text className='expiry-title'>食物保质期</Text>
              <View className='view-all-btn' onClick={openFoodExpiryList}>
                <Text className='view-all-text'>查看全部</Text>
              </View>
            </View>

            <View className='expiry-card'>
              {loading ? (
                <View className='expiry-skeleton'>
                  {[1, 2, 3].map((i) => (
                    <View key={i} className='expiry-skeleton-item'>
                      <View className='expiry-skeleton-row'>
                        <View className='home-line-wide' />
                        <View className='home-line-tag' />
                      </View>
                      <View className='home-line-narrow' />
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
                    {expirySummary.items.map((item) => (
                      <View
                        key={item.id}
                        className='expiry-item'
                        onClick={() => openFoodExpiryEdit(item.id)}
                      >
                        <View className='expiry-item-main'>
                          <Text className='expiry-item-name'>{item.food_name}</Text>
                          <Text className={`expiry-item-tag ${getExpiryTagClass(item.urgency_level)}`}>
                            {getExpiryUrgencyText(item)}
                          </Text>
                        </View>
                        <Text className='expiry-item-meta'>
                          {formatExpiryMeta(item) || '点击编辑'}
                        </Text>
                      </View>
                    ))}
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
                  <IconWaterDrop size={16} color='#3b82f6' />
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
    </View>
  )
}

export default withAuth(IndexPage)
