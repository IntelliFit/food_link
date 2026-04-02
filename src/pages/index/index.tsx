import { View, Text, Input, Image } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getHomeDashboard,
  getHealthProfile,
  getStatsSummary,
  getBodyMetricsSummary,
  getAccessToken,
  updateDashboardTargets,
  saveBodyWeightRecord,
  addBodyWaterLog,
  resetBodyWaterLogs,
  syncLocalBodyMetrics,
  mergeHomeIntakeWithTargets,
  getStoredDashboardTargets,
  type DashboardTargets,
  type BodyMetricsSummary,
  type HomeIntakeData,
  type HomeMealItem
} from '../../utils/api'
import { IconCamera, IconText, IconProtein, IconCarbs, IconFat, IconBreakfast, IconLunch, IconDinner, IconSnack, IconTrendingUp, IconChevronRight } from '../../components/iconfont'
import { Empty, Button } from '@taroify/core'
import CustomNavBar, { getStatusBarHeightSafe } from '../../components/CustomNavBar'

import './index.scss'

const DEFAULT_INTAKE: HomeIntakeData = {
  current: 0,
  target: 2000,
  progress: 0,
  macros: {
    protein: { current: 0, target: 120 },
    carbs: { current: 0, target: 250 },
    fat: { current: 0, target: 65 }
  }
}

type MacroKey = keyof HomeIntakeData['macros']
type WeekHeatmapState = 'none' | 'surplus' | 'deficit'

interface WeekHeatmapCell {
  date: string
  dayName: string
  dayNum: string
  calories: number
  state: WeekHeatmapState
  level: 0 | 1 | 2 | 3
  isToday: boolean
}

interface TargetFormState {
  calorieTarget: string
  proteinTarget: string
  carbsTarget: string
  fatTarget: string
}

interface MacroTargets {
  protein: number
  carbs: number
  fat: number
}

interface WeightRecordEntry {
  id?: string
  clientId?: string
  date: string
  value: number
  recordedAt?: string
}

interface WaterDayRecord {
  total: number
  logs: number[]
}

interface BodyMetricsStorage {
  weightEntries: WeightRecordEntry[]
  waterByDate: Record<string, WaterDayRecord>
  waterGoalMl: number
  latestWeight: WeightRecordEntry | null
  previousWeight: WeightRecordEntry | null
  weightChange: number | null
}

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const SHORT_DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']
const BODY_METRICS_STORAGE_KEY = 'food_link_home_body_metrics_v1'
const DEFAULT_WATER_GOAL_ML = 2000
const WEIGHT_HISTORY_LIMIT = 90
const QUICK_WATER_AMOUNTS = [250, 500]

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function formatDisplayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatNumberWithComma(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createWeightClientId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeWeightRecordedAt(date: string, value?: unknown, fallbackOffsetMinutes = 0): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString()
    }
  }
  const fallback = Date.parse(`${date}T00:00:00+08:00`)
  if (Number.isFinite(fallback)) {
    return new Date(fallback + fallbackOffsetMinutes * 60 * 1000).toISOString()
  }
  return new Date().toISOString()
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

function createTargetForm(intake: HomeIntakeData): TargetFormState {
  return {
    calorieTarget: formatDisplayNumber(intake.target),
    proteinTarget: formatDisplayNumber(intake.macros.protein.target),
    carbsTarget: formatDisplayNumber(intake.macros.carbs.target),
    fatTarget: formatDisplayNumber(intake.macros.fat.target)
  }
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

// 营养素配置：基于人们对营养素的直观印象
// 蛋白质-蓝色(牛奶/蛋白粉)、碳水-黄色(谷物/能量)、脂肪-橘黄色(油脂)
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

function createWeekHeatmapCells(): WeekHeatmapCell[] {
  const today = new Date()
  const cells: WeekHeatmapCell[] = []
  for (let offset = -3; offset <= 3; offset++) {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    const dateKey = formatDateKey(date)
    cells.push({
      date: dateKey,
      dayName: SHORT_DAY_NAMES[date.getDay()],
      dayNum: String(date.getDate()),
      calories: 0,
      state: 'none',
      level: 0,
      isToday: offset === 0
    })
  }
  return cells
}

function createEmptyBodyMetricsStorage(): BodyMetricsStorage {
  return {
    weightEntries: [],
    waterByDate: {},
    waterGoalMl: DEFAULT_WATER_GOAL_ML,
    latestWeight: null,
    previousWeight: null,
    weightChange: null
  }
}

function getWeightEntrySortValue(entry: Pick<WeightRecordEntry, 'date' | 'recordedAt'>): number {
  if (entry.recordedAt) {
    const parsed = Date.parse(entry.recordedAt)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  const fallback = Date.parse(`${entry.date}T00:00:00+08:00`)
  return Number.isFinite(fallback) ? fallback : 0
}

function sortWeightEntries(entries: WeightRecordEntry[]): WeightRecordEntry[] {
  return [...entries].sort((a, b) => {
    const diff = getWeightEntrySortValue(a) - getWeightEntrySortValue(b)
    if (diff !== 0) return diff
    const dateDiff = a.date.localeCompare(b.date)
    if (dateDiff !== 0) return dateDiff
    return (a.clientId || '').localeCompare(b.clientId || '')
  })
}

function sanitizeWeightEntry(entry: any, fallbackIndex = 0): WeightRecordEntry | null {
  if (!entry || typeof entry !== 'object' || typeof entry.date !== 'string' || !Number.isFinite(Number(entry.value))) {
    return null
  }
  const normalizedValue = Number(Number(entry.value).toFixed(1))
  const clientIdRaw = typeof entry.clientId === 'string'
    ? entry.clientId
    : (typeof entry.client_id === 'string' ? entry.client_id : '')
  const recordedAtRaw = typeof entry.recordedAt === 'string'
    ? entry.recordedAt
    : (typeof entry.recorded_at === 'string' ? entry.recorded_at : '')
  return {
    id: typeof entry.id === 'string' ? entry.id : undefined,
    date: entry.date,
    value: normalizedValue,
    clientId: clientIdRaw.trim() || `legacy-${entry.date}-${normalizedValue.toFixed(1)}-${fallbackIndex}`,
    recordedAt: normalizeWeightRecordedAt(entry.date, recordedAtRaw, fallbackIndex)
  }
}

function deriveWeightSummary(weightEntries: WeightRecordEntry[]) {
  const sorted = sortWeightEntries(weightEntries).slice(-WEIGHT_HISTORY_LIMIT)
  const latestWeight = sorted.length > 0 ? sorted[sorted.length - 1] : null
  const previousWeight = sorted.length > 1 ? sorted[sorted.length - 2] : null
  const weightChange = latestWeight && previousWeight
    ? Number((latestWeight.value - previousWeight.value).toFixed(1))
    : null
  return {
    weightEntries: sorted,
    latestWeight,
    previousWeight,
    weightChange
  }
}

function findLatestWeightEntryByDate(weightEntries: WeightRecordEntry[], dateKey: string): WeightRecordEntry | null {
  const matched = weightEntries.filter((entry) => entry.date === dateKey)
  if (matched.length === 0) return null
  const sorted = sortWeightEntries(matched)
  return sorted[sorted.length - 1] || null
}

function getStoredBodyMetrics(): BodyMetricsStorage {
  try {
    const raw = Taro.getStorageSync(BODY_METRICS_STORAGE_KEY)
    if (!raw || typeof raw !== 'object') {
      return createEmptyBodyMetricsStorage()
    }

    const source = raw as Partial<BodyMetricsStorage>
    const weightEntries = Array.isArray(source.weightEntries)
      ? source.weightEntries
        .map((entry, index) => sanitizeWeightEntry(entry, index))
        .filter((entry): entry is WeightRecordEntry => !!entry)
      : []
    const derivedWeight = deriveWeightSummary(weightEntries)
    const latestWeight = sanitizeWeightEntry(source.latestWeight, weightEntries.length + 1) || derivedWeight.latestWeight
    const previousWeight = sanitizeWeightEntry(source.previousWeight, weightEntries.length + 2) || derivedWeight.previousWeight

    const waterByDateSource = source.waterByDate && typeof source.waterByDate === 'object'
      ? source.waterByDate
      : {}
    const waterByDate = Object.entries(waterByDateSource).reduce<Record<string, WaterDayRecord>>((acc, [date, value]) => {
      if (!value || typeof value !== 'object') return acc
      const total = Number((value as WaterDayRecord).total)
      const logs = Array.isArray((value as WaterDayRecord).logs)
        ? (value as WaterDayRecord).logs.filter((log) => Number.isFinite(Number(log))).map((log) => Number(log))
        : []
      acc[date] = {
        total: Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0,
        logs
      }
      return acc
    }, {})

    const waterGoalMl = Number(source.waterGoalMl)

    return {
      weightEntries: derivedWeight.weightEntries,
      waterByDate,
      waterGoalMl: Number.isFinite(waterGoalMl) && waterGoalMl > 0
        ? Math.round(waterGoalMl)
        : DEFAULT_WATER_GOAL_ML,
      latestWeight,
      previousWeight,
      weightChange: latestWeight && previousWeight
        ? Number((latestWeight.value - previousWeight.value).toFixed(1))
        : derivedWeight.weightChange
    }
  } catch (error) {
    console.error('读取身体状态记录失败:', error)
    return createEmptyBodyMetricsStorage()
  }
}

function saveBodyMetrics(next: BodyMetricsStorage) {
  try {
    Taro.setStorageSync(BODY_METRICS_STORAGE_KEY, next)
  } catch (error) {
    console.error('保存身体状态记录失败:', error)
  }
}

function convertSummaryToBodyMetrics(summary: BodyMetricsSummary): BodyMetricsStorage {
  const weightEntries = Array.isArray(summary.weight_entries)
    ? summary.weight_entries
      .map((entry, index) => sanitizeWeightEntry(entry, index))
      .filter((entry): entry is WeightRecordEntry => !!entry)
    : []
  const latestWeight = sanitizeWeightEntry(summary.latest_weight, weightEntries.length + 1)
  const previousWeight = sanitizeWeightEntry(summary.previous_weight, weightEntries.length + 2)

  const waterByDate = Array.isArray(summary.water_daily)
    ? summary.water_daily.reduce<Record<string, WaterDayRecord>>((acc, item) => {
      if (!item || typeof item.date !== 'string') return acc
      acc[item.date] = {
        total: Math.max(0, Math.round(Number(item.total) || 0)),
        logs: Array.isArray(item.logs) ? item.logs.map((log) => Math.max(0, Math.round(Number(log) || 0))) : []
      }
      return acc
    }, {})
    : {}

  return {
    weightEntries: deriveWeightSummary(weightEntries).weightEntries,
    waterByDate,
    waterGoalMl: Number.isFinite(Number(summary.water_goal_ml)) && Number(summary.water_goal_ml) > 0
      ? Math.round(Number(summary.water_goal_ml))
      : DEFAULT_WATER_GOAL_ML,
    latestWeight,
    previousWeight,
    weightChange: Number.isFinite(Number(summary.weight_change))
      ? Number(Number(summary.weight_change).toFixed(1))
      : (latestWeight && previousWeight ? Number((latestWeight.value - previousWeight.value).toFixed(1)) : null)
  }
}

function formatShortDateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateKey
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export default function IndexPage() {
  const [intakeData, setIntakeData] = useState<HomeIntakeData>(DEFAULT_INTAKE)
  const [meals, setMeals] = useState<HomeMealItem[]>([])
  const [weekHeatmapCells, setWeekHeatmapCells] = useState<WeekHeatmapCell[]>(createWeekHeatmapCells())
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsStorage>(getStoredBodyMetrics)
  const [profileWeight, setProfileWeight] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [showWeightEditor, setShowWeightEditor] = useState(false)
  const [showWaterEditor, setShowWaterEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetFormState>(createTargetForm(DEFAULT_INTAKE))
  const [weightInput, setWeightInput] = useState('')
  const [customWaterInput, setCustomWaterInput] = useState('')
  const [selectedDate, setSelectedDate] = useState(formatDateKey(new Date()))

  const applyCloudBodyMetrics = useCallback((summary: BodyMetricsSummary) => {
    const next = convertSummaryToBodyMetrics(summary)
    setBodyMetrics(next)
    saveBodyMetrics(next)
  }, [])

  const loadDashboard = useCallback(async () => {
    const storedBodyMetrics = getStoredBodyMetrics()
    setBodyMetrics(storedBodyMetrics)

    if (!getAccessToken()) {
      setProfileWeight(null)
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
      setWeekHeatmapCells(createWeekHeatmapCells())
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      await syncLocalBodyMetrics({
        weight_entries: storedBodyMetrics.weightEntries.map((entry) => ({
          date: entry.date,
          value: entry.value,
          client_id: entry.clientId,
          recorded_at: entry.recordedAt
        })),
        water_by_date: storedBodyMetrics.waterByDate,
        water_goal_ml: storedBodyMetrics.waterGoalMl
      }).catch(() => null)

      const [res, stats, profile, cloudBodyMetrics] = await Promise.all([
        getHomeDashboard(),
        getStatsSummary('week'),
        getHealthProfile().catch(() => null),
        getBodyMetricsSummary('month').catch(() => null)
      ])
      const storedTargets = getStoredDashboardTargets()
      const intake =
        storedTargets != null ? mergeHomeIntakeWithTargets(res.intakeData, storedTargets) : res.intakeData
      
      // 构建7天热力图数据（今天前后各3天）
      const today = new Date()
      const nextWeekHeatmapCells: WeekHeatmapCell[] = []
      for (let offset = -3; offset <= 3; offset++) {
        const date = new Date(today)
        date.setDate(today.getDate() + offset)
        const dateKey = formatDateKey(date)
        const dayData = stats.daily_calories.find(d => d.date === dateKey)
        const hasRecord = dayData && dayData.calories > 0
        const delta = hasRecord ? dayData.calories - stats.tdee : 0
        const deltaRatio = hasRecord ? Math.abs(delta) / Math.max(stats.tdee, 1) : 0
        let level: WeekHeatmapCell['level'] = 0
        if (deltaRatio > 0.3) level = 3
        else if (deltaRatio > 0.15) level = 2
        else if (deltaRatio > 0) level = 1
        
        nextWeekHeatmapCells.push({
          date: dateKey,
          dayName: SHORT_DAY_NAMES[date.getDay()],
          dayNum: String(date.getDate()),
          calories: dayData?.calories || 0,
          state: !hasRecord ? 'none' : delta > 0 ? 'surplus' : 'deficit',
          level,
          isToday: offset === 0
        })
      }
      
      setIntakeData(intake)
      setMeals(res.meals || [])
      setWeekHeatmapCells(nextWeekHeatmapCells)
      setTargetForm(createTargetForm(intake))
      setProfileWeight(profile?.weight != null ? Number(profile.weight) : null)
      if (cloudBodyMetrics) {
        applyCloudBodyMetrics(cloudBodyMetrics)
      }
    } catch {
      setProfileWeight(null)
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setWeekHeatmapCells(createWeekHeatmapCells())
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
    } finally {
      setLoading(false)
    }
  }, [applyCloudBodyMetrics])

  // 每次显示页面时刷新数据
  Taro.useDidShow(() => {
    loadDashboard()
  })

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
      // @ts-ignore
      menus: ['shareAppMessage', 'shareTimeline']
    })
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

    if (payload.protein_target < 0 || payload.protein_target > 500) {
      Taro.showToast({ title: '按热量换算后，蛋白质超出范围，请调整目标', icon: 'none' })
      return
    }

    if (payload.carbs_target < 0 || payload.carbs_target > 1000) {
      Taro.showToast({ title: '按热量换算后，碳水超出范围，请调整目标', icon: 'none' })
      return
    }

    if (payload.fat_target < 0 || payload.fat_target > 300) {
      Taro.showToast({ title: '按热量换算后，脂肪超出范围，请调整目标', icon: 'none' })
      return
    }

    setSavingTargets(true)
    try {
      const { saveScope } = await updateDashboardTargets(payload)
      setShowTargetEditor(false)
      await loadDashboard()
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
    // 拍照识别需先登录
    if (type === 'photo' && !getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    // 记录页面是 tabBar 页面，需要使用 switchTab
    // switchTab 不支持传参，通过 storage 传递
    Taro.setStorageSync('recordPageTab', type)
    Taro.switchTab({ url: '/pages/record/index' })
  }

  const handleViewAllMeals = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    const today = formatDateKey(new Date())
    Taro.navigateTo({ url: `/pages/day-record/index?date=${encodeURIComponent(today)}` })
  }

  const openRecordSummary = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.navigateTo({ url: '/pages/stats/index' })
  }

  const previewHomeMealImages = (meal: HomeMealItem) => {
    const imageUrls = Array.isArray(meal.image_paths) && meal.image_paths.length > 0
      ? meal.image_paths.filter(Boolean)
      : (meal.image_path ? [meal.image_path] : [])

    if (imageUrls.length === 0) return

    Taro.previewImage({
      current: imageUrls[0],
      urls: imageUrls,
    })
  }

  const handleDateSelect = (date: string) => {
    setSelectedDate(date)
    const cell = weekHeatmapCells.find(c => c.date === date)
    if (cell && cell.calories > 0) {
      Taro.navigateTo({ url: `/pages/day-record/index?date=${encodeURIComponent(date)}` })
    }
  }

  const updateBodyMetrics = (updater: (current: BodyMetricsStorage) => BodyMetricsStorage) => {
    setBodyMetrics((current) => {
      const next = updater(current)
      saveBodyMetrics(next)
      return next
    })
  }

  const refreshBodyMetricsFromCloud = useCallback(async () => {
    const summary = await getBodyMetricsSummary('month')
    applyCloudBodyMetrics(summary)
    return summary
  }, [applyCloudBodyMetrics])

  const openWeightEditor = () => {
    const today = formatDateKey(new Date())
    const todayEntry = findLatestWeightEntryByDate(bodyMetrics.weightEntries, today)
    const latestEntry = bodyMetrics.latestWeight || deriveWeightSummary(bodyMetrics.weightEntries).latestWeight
    const initialWeight = todayEntry?.value ?? latestEntry?.value ?? profileWeight
    setWeightInput(initialWeight != null ? formatDisplayNumber(initialWeight) : '')
    setShowWeightEditor(true)
  }

  const handleSaveWeight = async () => {
    const parsed = parseCompleteNumber(weightInput)
    if (parsed == null) {
      Taro.showToast({ title: '请输入正确体重', icon: 'none' })
      return
    }
    if (parsed < 20 || parsed > 300) {
      Taro.showToast({ title: '体重需在 20-300 kg', icon: 'none' })
      return
    }

    const today = formatDateKey(new Date())
    const nextClientId = createWeightClientId()
    setShowWeightEditor(false)
    if (getAccessToken()) {
      try {
        await saveBodyWeightRecord(parsed, today, nextClientId)
        await refreshBodyMetricsFromCloud()
        Taro.showToast({ title: '体重已同步', icon: 'success' })
        return
      } catch (error) {
        console.error('保存云端体重失败，回退本地:', error)
      }
    }

    updateBodyMetrics((current) => {
      const nextEntries = [
        ...current.weightEntries,
        {
          date: today,
          value: Number(parsed.toFixed(1)),
          clientId: nextClientId,
          recordedAt: new Date().toISOString()
        }
      ]
      const nextWeight = deriveWeightSummary(nextEntries)
      return {
        ...current,
        weightEntries: nextWeight.weightEntries,
        latestWeight: nextWeight.latestWeight,
        previousWeight: nextWeight.previousWeight,
        weightChange: nextWeight.weightChange
      }
    })
    Taro.showToast({ title: '体重已暂存本机', icon: 'none' })
  }

  const addWaterAmount = async (amount: number, options?: { closeAfter?: boolean }) => {
    if (!Number.isFinite(amount) || amount <= 0) return
    const today = formatDateKey(new Date())
    const closeAfter = Boolean(options?.closeAfter)
    if (getAccessToken()) {
      try {
        await addBodyWaterLog(Math.round(amount), today)
        await refreshBodyMetricsFromCloud()
        if (closeAfter) {
          setCustomWaterInput('')
          setShowWaterEditor(false)
        }
        Taro.showToast({ title: `已同步 ${Math.round(amount)}ml`, icon: 'success' })
        return
      } catch (error) {
        console.error('保存云端喝水失败，回退本地:', error)
      }
    }

    updateBodyMetrics((current) => {
      const todayRecord = current.waterByDate[today] || { total: 0, logs: [] }
      return {
        ...current,
        waterByDate: {
          ...current.waterByDate,
          [today]: {
            total: todayRecord.total + Math.round(amount),
            logs: [...todayRecord.logs, Math.round(amount)].slice(-20)
          }
        }
      }
    })
    if (closeAfter) {
      setCustomWaterInput('')
      setShowWaterEditor(false)
    }
    Taro.showToast({ title: `已记录 ${Math.round(amount)}ml`, icon: 'none' })
  }

  /** 快捷量累加到输入框，需再点「确认记录」才写入今日饮水 */
  const applyWaterPresetAmount = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return
    setCustomWaterInput((prev) => {
      const n = parseCompleteNumber(prev)
      const base = n != null && n > 0 ? n : 0
      return String(base + Math.round(amount))
    })
  }

  const handleConfirmWaterRecord = async () => {
    const parsed = parseCompleteNumber(customWaterInput)
    if (parsed == null) {
      Taro.showToast({ title: '请输入饮水量', icon: 'none' })
      return
    }
    if (parsed < 50 || parsed > 3000) {
      Taro.showToast({ title: '单次饮水建议 50-3000 ml', icon: 'none' })
      return
    }
    await addWaterAmount(parsed, { closeAfter: true })
  }

  const handleResetTodayWater = async () => {
    const today = formatDateKey(new Date())
    setShowWaterEditor(false)
    setCustomWaterInput('')
    if (getAccessToken()) {
      try {
        await resetBodyWaterLogs(today)
        await refreshBodyMetricsFromCloud()
        Taro.showToast({ title: '已清空今日喝水', icon: 'success' })
        return
      } catch (error) {
        console.error('清空云端喝水失败，回退本地:', error)
      }
    }

    updateBodyMetrics((current) => {
      const nextWaterByDate = { ...current.waterByDate }
      delete nextWaterByDate[today]
      return {
        ...current,
        waterByDate: nextWaterByDate
      }
    })
    Taro.showToast({ title: '已清空今日喝水', icon: 'none' })
  }

  const totalCurrent = normalizeDisplayNumber(intakeData.current)
  const totalTarget = normalizeDisplayNumber(intakeData.target)
  const remainingCalories = Math.max(0, Number((totalTarget - totalCurrent).toFixed(1)))
  const calorieProgress = normalizeProgressPercent(intakeData.progress, totalCurrent, totalTarget)
  
  const calorieInputValue = parseCompleteNumber(targetForm.calorieTarget)
  const macroInputValues = parseMacroTargets(targetForm)
  const caloriesFromMacroInputs = macroInputValues ? calcCaloriesFromMacros(macroInputValues) : null
  const calorieGap =
    calorieInputValue != null && caloriesFromMacroInputs != null
      ? Number((calorieInputValue - caloriesFromMacroInputs).toFixed(1))
      : null
  const isRelationAligned = calorieGap != null && Math.abs(calorieGap) <= 1

  // 计算三大营养素剩余量
  const getMacroRemaining = (key: MacroKey) => {
    const macro = intakeData.macros[key]
    return Math.max(0, Number((macro.target - macro.current).toFixed(1)))
  }

  const todayDateKey = formatDateKey(new Date())
  const derivedWeight = deriveWeightSummary(bodyMetrics.weightEntries)
  const todayWeightEntry = findLatestWeightEntryByDate(bodyMetrics.weightEntries, todayDateKey)
  const latestWeightEntry = bodyMetrics.latestWeight || derivedWeight.latestWeight
  const previousWeightEntry = bodyMetrics.previousWeight || derivedWeight.previousWeight
  const displayWeightEntry = latestWeightEntry
  const weightDelta = Number.isFinite(Number(bodyMetrics.weightChange))
    ? Number(Number(bodyMetrics.weightChange).toFixed(1))
    : (latestWeightEntry && previousWeightEntry
      ? Number((latestWeightEntry.value - previousWeightEntry.value).toFixed(1))
      : null)
  const todayWaterRecord = bodyMetrics.waterByDate[todayDateKey] || { total: 0, logs: [] }
  const waterGoalMl = bodyMetrics.waterGoalMl || DEFAULT_WATER_GOAL_ML
  const waterProgress = calculateProgressPercent(todayWaterRecord.total, waterGoalMl)
  const waterRemainingMl = Math.max(0, waterGoalMl - todayWaterRecord.total)
  const weightSummaryText = displayWeightEntry
    ? `${formatDisplayNumber(displayWeightEntry.value)} kg`
    : '未记录'
  const weightMetaText = displayWeightEntry
    ? (previousWeightEntry && weightDelta != null
      ? `较上次 ${weightDelta > 0 ? '+' : ''}${formatDisplayNumber(weightDelta)} kg`
      : todayWeightEntry
        ? '今天已记录，可继续补记'
        : `上次 ${formatShortDateLabel(displayWeightEntry.date)}`)
    : profileWeight != null
      ? `档案 ${formatDisplayNumber(profileWeight)} kg`
      : '可随时补记'
  const waterSummaryText = `${todayWaterRecord.total}/${waterGoalMl} ml`
  const waterMetaText = waterRemainingMl > 0 ? `还差 ${waterRemainingMl} ml` : '今日已达标'

  return (
    <View className='home-page'>
      {/* 自定义渐变导航栏 */}
      <CustomNavBar
        title=''
        background='transparent'
      />
      
      {/* 背景渐变层 */}
      <View className='gradient-bg' />
      
      {/* 页面内容 - 只保留状态栏高度，因为导航栏是透明的 */}
      <View className='page-content' style={{ paddingTop: `${getStatusBarHeightSafe()}px` }}>
        {/* 问候区 */}
        <View className='greeting-section'>
          <View className='greeting-text'>
            <Text className='greeting-title'>{getGreeting()}</Text>
            <Text className='greeting-subtitle'>今天也要健康饮食哦</Text>
          </View>
          <View className='greeting-icon'>
            <IconTrendingUp size={24} color='#00bc7d' />
          </View>
        </View>

        {/* 日期选择器 - 新设计：滑动卡片式 */}
        <View className='date-selector-section'>
          <View className='date-list'>
            {weekHeatmapCells.map((cell) => {
              // 计算摄入进度百分比（用于背景进度条）
              const progressPercent = cell.target > 0 
                ? Math.min(100, Math.round((cell.calories / cell.target) * 100))
                : 0
              
              return (
                <View
                  key={cell.date}
                  className={`date-item ${cell.isToday ? 'is-today' : ''} ${selectedDate === cell.date ? 'is-selected' : ''}`}
                  onClick={() => handleDateSelect(cell.date)}
                >
                  {/* 背景进度条 */}
                  <View 
                    className='date-progress-bg'
                    style={{ height: `${progressPercent}%` }}
                  />
                  {/* 星期几 */}
                  <Text className='date-day-name'>{cell.dayName}</Text>
                  {/* 日期数字 - 圆形 */}
                  <View className='date-day-circle'>
                    <Text className='date-num-text'>{cell.dayNum}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {/* 热量总览卡片 */}
        <View className='main-card'>
          <View className='main-card-header'>
            <View className='main-card-title'>
              <Text className='card-label'>剩余可摄入</Text>
              <Text className='card-value'>{formatNumberWithComma(remainingCalories)}</Text>
              <Text className='card-unit'>kcal</Text>
            </View>
            <View className='target-section'>
              <Text className='target-text'>目标: {formatDisplayNumber(intakeData.target)}</Text>
              <View className='target-edit-btn' onClick={openTargetEditor}>
                <Text className='target-edit-text'>编辑目标</Text>
              </View>
            </View>
          </View>
          
          {/* 进度条 - 加厚样式 */}
          <View className='progress-section'>
            <View className='progress-bar-bg thick'>
              <View
                className='progress-bar-fill thick'
                style={{ width: `${clampVisualProgress(calorieProgress)}%` }}
              />
            </View>
          </View>
        </View>

        {/* 三大营养素卡片 */}
        <View className='macros-section'>
          {MACRO_CONFIGS.map(({ key, label, color, unit, Icon }) => {
            const macro = intakeData.macros[key]
            const currentValue = normalizeDisplayNumber(macro.current)
            const targetValue = normalizeDisplayNumber(macro.target)
            const progress = calculateProgressPercent(currentValue, targetValue)
            const visualProgress = clampVisualProgress(progress)
            
            return (
              <View key={key} className='macro-card'>
                {/* 顶部标签栏 - 灰色系 */}
                <View className='macro-card-header'>
                  <View className='macro-title-wrap'>
                    <View className='macro-icon'>
                      <Icon size={16} color='#9ca3af' />
                    </View>
                    <Text className='macro-label'>{label}</Text>
                  </View>
                </View>
                
                {/* 主体内容 */}
                <View className='macro-content'>
                  {/* 第一行：仅大数字，避免与百分比徽标同一行挤压重叠 */}
                  <View className='macro-row-first'>
                    <View className='macro-value-wrap'>
                      <Text className='macro-big-number' style={{ color }}>
                        {loading ? '--' : formatDisplayNumber(currentValue)}
                      </Text>
                      <Text className='macro-unit-inline'>{unit}</Text>
                    </View>
                  </View>

                  {/* 第二行：当前/目标 + 百分比徽标（拆行后互不遮挡） */}
                  <View className='macro-row-second'>
                    <Text className='macro-detail-text'>
                      {formatDisplayNumber(currentValue)} / {formatDisplayNumber(targetValue)}{unit}
                    </Text>
                    <View
                      className={`macro-progress-badge${progress >= 100 ? ' is-over' : ''}`}
                      style={{ color, borderColor: `${color}22`, backgroundColor: `${color}14` }}
                    >
                      <Text className='macro-progress-badge-text'>{formatProgressText(progress)}</Text>
                    </View>
                  </View>

                  <View className='macro-progress-bar-bg'>
                    <View
                      className='macro-progress-bar-fill'
                      style={{ width: `${visualProgress}%`, backgroundColor: color }}
                    />
                  </View>
                </View>
              </View>
            )
          })}
        </View>

        {/* 体重 / 喝水：放在营养素下方，与热量总览形成「摄入」区块后再接身体习惯记录 */}
        <View className='body-status-section'>
          <View className='body-status-grid'>
            <View className='body-status-card'>
              <View className='body-status-content' onClick={openWeightEditor}>
                <View className='body-status-header'>
                  <Text className='body-status-label'>体重</Text>
                  <Text className='body-status-value'>{weightSummaryText}</Text>
                </View>
                <Text className='body-status-meta'>{weightMetaText}</Text>
              </View>
              <View className='body-status-action'>
                <View className='body-status-btn weight' onClick={openWeightEditor}>
                  <Text className='body-status-btn-text weight'>{todayWeightEntry ? '再记' : '去记'}</Text>
                </View>
              </View>
            </View>

            <View className='body-status-card'>
              <View className='body-status-content' onClick={() => setShowWaterEditor(true)}>
                <View className='body-status-header'>
                  <Text className='body-status-label'>喝水</Text>
                  <Text className='body-status-value'>{waterSummaryText}</Text>
                </View>
                <Text className='body-status-meta'>{waterMetaText}</Text>
              </View>
              <View className='body-status-action'>
                <View className='body-status-btn water' onClick={() => addWaterAmount(QUICK_WATER_AMOUNTS[0])}>
                  <Text className='body-status-btn-text water'>+{QUICK_WATER_AMOUNTS[0]}ml</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* 今日餐食区域 */}
        <View className='meals-section'>
          <View className='section-header'>
            <Text className='section-title'>今日餐食</Text>
            <View className='view-all-btn' onClick={handleViewAllMeals}>
              <Text className='view-all-text'>查看全部</Text>
              <IconChevronRight size={16} color='#00bc7d' />
            </View>
          </View>
          
          <View className='meals-list'>
            {loading ? (
              <View className='meals-loading'>
                <Text className='loading-text'>加载中...</Text>
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
                  <View key={`${meal.type}-${index}`} className='meal-item'>
                    <View
                      className={`meal-media-wrap ${hasRealImage ? 'is-photo' : 'is-icon'}`}
                      onClick={() => previewHomeMealImages(meal)}
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
                        <Text className='meal-name'>{meal.name || label}</Text>
                        <Text className='meal-calorie'>{formatDisplayNumber(mealCalorie)} kcal</Text>
                      </View>
                      <View className='meal-progress-wrap'>
                        <View className='meal-progress-bar-bg'>
                          <View
                            className='meal-progress-bar-fill'
                            style={{ width: `${clampVisualProgress(mealProgress)}%`, backgroundColor: color }}
                          />
                        </View>
                        <View className='meal-progress-meta'>
                          <Text className='meal-progress-percent' style={{ color }}>{formatProgressText(mealProgress)}</Text>
                          <Text className='meal-progress-text'>{targetText}</Text>
                        </View>
                      </View>
                      {meal.time && <Text className='meal-time'>{meal.time}</Text>}
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

        {/* 查看统计入口 */}
        <View className='stats-entry-section' onClick={openRecordSummary}>
          <View className='stats-entry-card'>
            <View className='stats-entry-icon'>
              <IconTrendingUp size={24} color='#ffffff' />
            </View>
            <View className='stats-entry-text'>
              <Text className='stats-entry-title'>查看饮食统计</Text>
              <Text className='stats-entry-desc'>了解您的饮食趋势和营养分析</Text>
            </View>
            <IconChevronRight size={20} color='#ffffff' />
          </View>
        </View>

        {/* 底部留白 */}
        <View className='bottom-spacer' />
      </View>

      {/* 目标编辑弹窗 */}
      {showTargetEditor && (
        <View className='target-modal' catchMove>
          <View className='target-modal-mask' onClick={() => !savingTargets && setShowTargetEditor(false)} />
          <View className='target-modal-content'>
            <View className='target-modal-header'>
              <Text className='target-modal-title'>编辑今日目标</Text>
              <Text className='target-modal-desc'>保存后会同步到账号，下次登录仍会保留。</Text>
            </View>

            <View className='target-form-list'>
              <View className='target-form-item'>
                <Text className='target-form-label'>今日摄入目标</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='digit'
                    value={targetForm.calorieTarget}
                    onInput={(e) => handleTargetInput('calorieTarget', e.detail.value)}
                  />
                  <Text className='target-input-unit'>kcal</Text>
                </View>
              </View>

              <View className='target-form-item'>
                <Text className='target-form-label'>蛋白质目标</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='digit'
                    value={targetForm.proteinTarget}
                    onInput={(e) => handleTargetInput('proteinTarget', e.detail.value)}
                  />
                  <Text className='target-input-unit'>g</Text>
                </View>
              </View>

              <View className='target-form-item'>
                <Text className='target-form-label'>碳水目标</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='digit'
                    value={targetForm.carbsTarget}
                    onInput={(e) => handleTargetInput('carbsTarget', e.detail.value)}
                  />
                  <Text className='target-input-unit'>g</Text>
                </View>
              </View>

              <View className='target-form-item'>
                <Text className='target-form-label'>脂肪目标</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='digit'
                    value={targetForm.fatTarget}
                    onInput={(e) => handleTargetInput('fatTarget', e.detail.value)}
                  />
                  <Text className='target-input-unit'>g</Text>
                </View>
              </View>
            </View>

            <View className='target-relation-hint'>
              <Text className='target-relation-hint-title'>保存规则：以热量目标为准自动换算三大营养素</Text>
              {calorieInputValue != null && caloriesFromMacroInputs != null ? (
                <Text className={`target-relation-hint-value ${isRelationAligned ? 'aligned' : 'adjusting'}`}>
                  当前三大营养素换算热量 {formatDisplayNumber(caloriesFromMacroInputs)} kcal
                  {isRelationAligned ? '，已满足关系' : '，保存时会自动校准'}
                </Text>
              ) : (
                <Text className='target-relation-hint-value pending'>请填写完整的数字目标</Text>
              )}
            </View>

            <View className='target-modal-actions'>
              <View className='target-modal-btn secondary' onClick={() => !savingTargets && setShowTargetEditor(false)}>
                <Text className='target-modal-btn-text secondary'>取消</Text>
              </View>
              <View className='target-modal-btn primary' onClick={handleSaveTargets}>
                <Text className='target-modal-btn-text primary'>{savingTargets ? '保存中...' : '保存'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {showWeightEditor && (
        <View className='target-modal' catchMove>
          <View className='target-modal-mask' onClick={() => setShowWeightEditor(false)} />
          <View className='target-modal-content body-modal-content body-modal-sheet'>
            <View className='target-modal-scroll body-modal-scroll'>
              <View className='target-modal-header'>
                <Text className='target-modal-title'>记录体重</Text>
                <Text className='target-modal-desc'>可随时补记，统计趋势默认取当天最后一次。</Text>
              </View>

              <View className='target-form-item body-form-item'>
                <Text className='target-form-label'>体重</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='digit'
                    value={weightInput}
                    placeholder={profileWeight != null ? formatDisplayNumber(profileWeight) : '例如 56.8'}
                    onInput={(e) => setWeightInput(e.detail.value)}
                  />
                  <Text className='target-input-unit'>kg</Text>
                </View>
                <Text className='body-form-hint'>
                  {todayWeightEntry
                    ? '今天可以继续记录，首页会展示最近一次与上一次的变化'
                    : '记录后首页会展示最近一次体重变化'}
                </Text>
              </View>
            </View>

            <View className='target-modal-actions modal-actions-fixed'>
              <View className='target-modal-btn secondary' onClick={() => setShowWeightEditor(false)}>
                <Text className='target-modal-btn-text secondary'>取消</Text>
              </View>
              <View className='target-modal-btn primary' onClick={handleSaveWeight}>
                <Text className='target-modal-btn-text primary'>保存</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {showWaterEditor && (
        <View className='target-modal' catchMove>
          <View className='target-modal-mask' onClick={() => setShowWaterEditor(false)} />
          <View className='target-modal-content body-modal-content body-modal-sheet'>
            <View className='target-modal-scroll body-modal-scroll'>
              <View className='target-modal-header'>
                <Text className='target-modal-title'>记录喝水</Text>
                <Text className='target-modal-desc'>快捷量会累加到下方输入框，与手输一致，点「确认记录」后才会计入今日饮水。</Text>
              </View>

              <View className='water-modal-quick-grid'>
                {[100, 250, 500, 750].map((amount) => (
                  <View key={amount} className='water-modal-quick-item' onClick={() => applyWaterPresetAmount(amount)}>
                    <Text className='water-modal-quick-value'>+{amount}</Text>
                    <Text className='water-modal-quick-unit'>ml</Text>
                  </View>
                ))}
              </View>

              <View className='target-form-item body-form-item'>
                <Text className='target-form-label'>自定义饮水量</Text>
                <View className='target-input-wrap'>
                  <Input
                    className='target-input'
                    type='number'
                    value={customWaterInput}
                    placeholder='例如 300'
                    onInput={(e) => setCustomWaterInput(e.detail.value)}
                  />
                  <Text className='target-input-unit'>ml</Text>
                </View>
                <Text className='body-form-hint'>今天已记录 {todayWaterRecord.total} ml，可继续累加。</Text>
              </View>
            </View>

            <View className='modal-footer-stack'>
              <View className='water-modal-footer'>
                <View className='water-reset-btn' onClick={handleResetTodayWater}>
                  <Text className='water-reset-btn-text'>清空今天</Text>
                </View>
              </View>

              <View className='target-modal-actions modal-actions-fixed'>
              <View className='target-modal-btn secondary' onClick={() => setShowWaterEditor(false)}>
                <Text className='target-modal-btn-text secondary'>取消</Text>
              </View>
              <View className='target-modal-btn primary' onClick={handleConfirmWaterRecord}>
                <Text className='target-modal-btn-text primary'>确认记录</Text>
              </View>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
