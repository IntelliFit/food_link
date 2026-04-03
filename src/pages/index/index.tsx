import { View, Text, Input, Image } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getHomeDashboard,
  getStatsSummary,
  getAccessToken,
  updateDashboardTargets,
  mergeHomeIntakeWithTargets,
  getStoredDashboardTargets,
  getBodyMetricsSummary,
  saveBodyWeightRecord,
  addBodyWaterLog,
  resetBodyWaterLogs,
  type DashboardTargets,
  type HomeIntakeData,
  type HomeMealItem,
  type BodyMetricWeightEntry,
  type BodyMetricWaterDay
} from '../../utils/api'
import { IconCamera, IconText, IconProtein, IconCarbs, IconFat, IconBreakfast, IconLunch, IconDinner, IconSnack, IconTrendingUp, IconChevronRight, IconWaterDrop } from '../../components/iconfont'
import { Empty, Button } from '@taroify/core'
// 删除 CustomNavBar 导入，使用页面原生导航栏

import './index.scss'
import { withAuth } from '../../utils/withAuth'

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

const WEIGHT_HISTORY_LIMIT = 60
const QUICK_WATER_AMOUNTS = [200, 350, 500]

const WATER_GOAL_DEFAULT = 2000

interface WeightRecordEntry {
  date: string
  value: number
  recorded_at?: string
}

interface BodyMetricsStorage {
  weightEntries: WeightRecordEntry[]
  waterByDate: Record<string, BodyMetricWaterDay>
  waterGoalMl: number
}

interface WaterRecord {
  date: string
  amount: number
}

type MacroKey = keyof HomeIntakeData['macros']
type WeekHeatmapState = 'none' | 'surplus' | 'deficit'

interface WeekHeatmapCell {
  date: string
  dayName: string
  dayNum: string
  calories: number
  target: number
  intakeRatio: number
  state: WeekHeatmapState
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

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const SHORT_DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

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

// 转换日期为2025年（系统时间可能是2026年，但数据是2025年的）
function normalizeTo2025(dateStr: string): string {
  return dateStr.replace(/^2026-/, '2025-')
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

// 数字滚动动画 Hook
function useAnimatedNumber(target: number, duration: number = 600, delay: number = 0): number {
  const [displayValue, setDisplayValue] = useState(target)
  const animationRef = useRef<{ startTime: number | null; startValue: number; rafId: number | null }>({
    startTime: null,
    startValue: 0,
    rafId: null
  })

  useEffect(() => {
    // 清除之前的动画
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId)
    }

    const startValue = displayValue
    const startTime = performance.now() + delay
    animationRef.current = { startTime, startValue, rafId: null }

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      
      if (elapsed < 0) {
        animationRef.current.rafId = requestAnimationFrame(animate)
        return
      }

      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)
      const currentValue = startValue + (target - startValue) * easedProgress

      setDisplayValue(currentValue)

      if (progress < 1) {
        animationRef.current.rafId = requestAnimationFrame(animate)
      }
    }

    animationRef.current.rafId = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current.rafId) {
        cancelAnimationFrame(animationRef.current.rafId)
      }
    }
  }, [target])

  return displayValue
}

// 圆环进度动画 Hook
function useAnimatedProgress(targetProgress: number, duration: number = 600, delay: number = 0): number {
  const [displayProgress, setDisplayProgress] = useState(targetProgress)
  const animationRef = useRef<{ startTime: number | null; startProgress: number; rafId: number | null }>({
    startTime: null,
    startProgress: 0,
    rafId: null
  })

  useEffect(() => {
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId)
    }

    const startProgress = displayProgress
    const startTime = performance.now() + delay
    animationRef.current = { startTime, startProgress, rafId: null }

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      
      if (elapsed < 0) {
        animationRef.current.rafId = requestAnimationFrame(animate)
        return
      }

      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)
      const currentProgress = startProgress + (targetProgress - startProgress) * easedProgress

      setDisplayProgress(currentProgress)

      if (progress < 1) {
        animationRef.current.rafId = requestAnimationFrame(animate)
      }
    }

    animationRef.current.rafId = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current.rafId) {
        cancelAnimationFrame(animationRef.current.rafId)
      }
    }
  }, [targetProgress])

  return displayProgress
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

function getStoredBodyMetrics(): BodyMetricsStorage {
  try {
    const stored = Taro.getStorageSync('body_metrics_storage')
    if (stored) {
      return stored as BodyMetricsStorage
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
  const next: BodyMetricsStorage = {
    weightEntries: [...storage.weightEntries],
    waterByDate: { ...storage.waterByDate },
    waterGoalMl: cloud.water_goal_ml || storage.waterGoalMl || WATER_GOAL_DEFAULT
  }

  if (cloud.weight_entries) {
    const existingDates = new Set(next.weightEntries.map(e => e.date))
    cloud.weight_entries.forEach(entry => {
      if (!existingDates.has(entry.date)) {
        next.weightEntries.push({
          date: entry.date,
          value: entry.value,
          recorded_at: entry.recorded_at || undefined
        })
      }
    })
    next.weightEntries = sortWeightEntries(next.weightEntries).slice(-WEIGHT_HISTORY_LIMIT)
  }

  if (cloud.water_daily) {
    cloud.water_daily.forEach(day => {
      next.waterByDate[day.date] = {
        date: day.date,
        total: day.total,
        logs: day.logs || []
      }
    })
  }

  return next
}

function getTodayWater(metrics: BodyMetricsStorage, date: string): BodyMetricWaterDay {
  return metrics.waterByDate[date] || { date, total: 0, logs: [] }
}

function addWaterToMetrics(metrics: BodyMetricsStorage, date: string, amount: number): BodyMetricsStorage {
  const current = getTodayWater(metrics, date)
  const updated: BodyMetricWaterDay = {
    date,
    total: current.total + amount,
    logs: [...current.logs, amount]
  }
  return {
    ...metrics,
    waterByDate: {
      ...metrics.waterByDate,
      [date]: updated
    }
  }
}

function clearWaterForDate(metrics: BodyMetricsStorage, date: string): BodyMetricsStorage {
  const next = { ...metrics, waterByDate: { ...metrics.waterByDate } }
  delete next.waterByDate[date]
  return next
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

function createWeekHeatmapCells(): WeekHeatmapCell[] {
  const today = new Date()
  const cells: WeekHeatmapCell[] = []
  for (let offset = -3; offset <= 3; offset++) {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    const dateKey = normalizeTo2025(formatDateKey(date))
    cells.push({
      date: dateKey,
      dayName: SHORT_DAY_NAMES[date.getDay()],
      dayNum: String(date.getDate()),
      calories: 0,
      target: 2000,
      intakeRatio: 0,
      state: 'none',
      isToday: offset === 0
    })
  }
  return cells
}

function IndexPage() {
  const [intakeData, setIntakeData] = useState<HomeIntakeData>(DEFAULT_INTAKE)
  const [meals, setMeals] = useState<HomeMealItem[]>([])
  const [weekHeatmapCells, setWeekHeatmapCells] = useState<WeekHeatmapCell[]>(createWeekHeatmapCells())
  const [loading, setLoading] = useState(true)
  const [isSwitchingDate, setIsSwitchingDate] = useState(false)
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetFormState>(createTargetForm(DEFAULT_INTAKE))
  const [selectedDate, setSelectedDate] = useState(normalizeTo2025(formatDateKey(new Date())))

  // 体重/喝水状态
  const [bodyMetrics, setBodyMetrics] = useState<BodyMetricsStorage>(getStoredBodyMetrics())
  const [showWeightEditor, setShowWeightEditor] = useState(false)
  const [weightInput, setWeightInput] = useState('')
  const [savingWeight, setSavingWeight] = useState(false)
  const [showWaterEditor, setShowWaterEditor] = useState(false)
  const [waterInput, setWaterInput] = useState('')
  const [savingWater, setSavingWater] = useState(false)

  // 加载指定日期的首页数据
  const loadDashboard = useCallback(async (targetDate?: string) => {
    console.log('[DEBUG] loadDashboard 被调用, targetDate:', targetDate)
    console.log('[DEBUG] getAccessToken:', getAccessToken() ? '有token' : '无token')
    if (!getAccessToken()) {
      console.log('[DEBUG] 无token，返回默认值')
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
      setWeekHeatmapCells(createWeekHeatmapCells())
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      console.log('[DEBUG] 请求 API, date:', targetDate)
      const [res, stats, bodyMetricsRes] = await Promise.all([
        getHomeDashboard(targetDate),
        getStatsSummary('week'),
        getBodyMetricsSummary('week').catch(() => null)
      ])
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
        // 将日期转换为2025年格式用于前端显示
        const displayDateKey = normalizeTo2025(dateKey)
        // 匹配时需要与后端返回的格式匹配
        const dayData = stats.daily_calories.find(d => normalizeTo2025(d.date) === displayDateKey)
        const hasRecord = dayData && dayData.calories > 0
        const calories = dayData?.calories || 0
        const target = stats.tdee || 2000
        const intakeRatio = hasRecord ? calories / target : 0
        
        nextWeekHeatmapCells.push({
          date: displayDateKey,
          dayName: SHORT_DAY_NAMES[date.getDay()],
          dayNum: String(date.getDate()),
          calories,
          target,
          intakeRatio,
          state: !hasRecord ? 'none' : calories > target ? 'surplus' : 'deficit',
          isToday: offset === 0
        })
      }
      
      setWeekHeatmapCells(nextWeekHeatmapCells)
      setTargetForm(createTargetForm(intake))

      // 应用云端身体指标数据
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
      }

      console.log('[DEBUG] 所有数据设置完成')
    } catch (error) {
      console.error('[DEBUG] API 调用失败:', error)
      Taro.showToast({ title: '加载失败: ' + (error as Error).message, icon: 'none', duration: 3000 })
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setWeekHeatmapCells(createWeekHeatmapCells())
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
    } finally {
      setLoading(false)
      setIsSwitchingDate(false)
    }
  }, [setIntakeData, setMeals, setWeekHeatmapCells, setTargetForm, setLoading, setIsSwitchingDate])

  // 每次显示页面时刷新数据
  const selectedDateRef = useRef(selectedDate)
  selectedDateRef.current = selectedDate
  const skipNextRefreshRef = useRef(false)
  
  Taro.useDidShow(() => {
    const today = normalizeTo2025(formatDateKey(new Date()))
    const currentSelected = selectedDateRef.current
    console.log('[DEBUG] useDidShow, selectedDate:', currentSelected, 'today:', today, 'skip:', skipNextRefreshRef.current)
    
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
    const today = normalizeTo2025(formatDateKey(new Date()))
    Taro.navigateTo({ url: `/pages/day-record/index?date=${encodeURIComponent(today)}` })
  }

  const openRecordSummary = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.navigateTo({ url: '/pages/stats/index' })
  }

  const handleDateSelect = (date: string) => {
    console.log('[DEBUG] 点击日期:', date, '当前日期:', selectedDate)
    skipNextRefreshRef.current = true
    // date 已经是2025格式，直接使用
    setSelectedDate(date)
    // 立即进入日期切换状态，显示加载中并归零数字
    setIsSwitchingDate(true)
    // 先清空当前数据，让数字归零
    setIntakeData({
      target: 0,
      current: 0,
      remaining: 0,
      progress: 0,
      macros: {
        protein: { current: 0, target: 0, remaining: 0, progress: 0 },
        carbs: { current: 0, target: 0, remaining: 0, progress: 0 },
        fat: { current: 0, target: 0, remaining: 0, progress: 0 }
      }
    })
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
    setWaterInput('')
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

  const animatedRemainingCalories = useAnimatedNumber(remainingCalories, 800, 0)
  const animatedTotalCurrent = useAnimatedNumber(totalCurrent, 800, 0)
  
  const calorieInputValue = parseCompleteNumber(targetForm.calorieTarget)
  const macroInputValues = parseMacroTargets(targetForm)
  const caloriesFromMacroInputs = macroInputValues ? calcCaloriesFromMacros(macroInputValues) : null
  const calorieGap =
    calorieInputValue != null && caloriesFromMacroInputs != null
      ? Number((calorieInputValue - caloriesFromMacroInputs).toFixed(1))
      : null
  const isRelationAligned = calorieGap != null && Math.abs(calorieGap) <= 1

  const getMacroRemaining = (key: MacroKey) => {
    const macro = intakeData.macros[key]
    return Math.max(0, Number((macro.target - macro.current).toFixed(1)))
  }

  const macroAnimations = useMemo(() => {
    return MACRO_CONFIGS.map(({ key }) => {
      const macro = intakeData.macros[key]
      const currentValue = normalizeDisplayNumber(macro.current)
      const targetValue = normalizeDisplayNumber(macro.target)
      const targetProgress = calculateProgressPercent(currentValue, targetValue)
      return {
        key,
        animatedValue: currentValue,
        animatedProgress: targetProgress,
        delay: 0
      }
    })
  }, [intakeData.macros])

  const proteinAnimation = useAnimatedNumber(
    macroAnimations.find(m => m.key === 'protein')?.animatedValue || 0,
    800,
    0
  )
  const carbsAnimation = useAnimatedNumber(
    macroAnimations.find(m => m.key === 'carbs')?.animatedValue || 0,
    800,
    0
  )
  const fatAnimation = useAnimatedNumber(
    macroAnimations.find(m => m.key === 'fat')?.animatedValue || 0,
    800,
    0
  )

  const proteinProgressAnimation = useAnimatedProgress(
    macroAnimations.find(m => m.key === 'protein')?.animatedProgress || 0,
    800,
    0
  )
  const carbsProgressAnimation = useAnimatedProgress(
    macroAnimations.find(m => m.key === 'carbs')?.animatedProgress || 0,
    800,
    0
  )
  const fatProgressAnimation = useAnimatedProgress(
    macroAnimations.find(m => m.key === 'fat')?.animatedProgress || 0,
    800,
    0
  )

  const animatedMacroValues: Record<MacroKey, number> = {
    protein: proteinAnimation,
    carbs: carbsAnimation,
    fat: fatAnimation
  }

  const animatedMacroProgress: Record<MacroKey, number> = {
    protein: proteinProgressAnimation,
    carbs: carbsProgressAnimation,
    fat: fatProgressAnimation
  }

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
  
  // 喝水动画
  const animatedWaterTotal = useAnimatedNumber(todayWater.total, 600, 0)
  const animatedWaterProgress = useAnimatedProgress(waterProgress, 600, 0)

  return (
    <View className='home-page'>
      {/* 页面内容 */}
      <View className='page-content'>
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

        {/* 日期选择器 */}
        <View className='date-selector-section'>
          <View className='date-list'>
            {weekHeatmapCells.map((cell) => {
              // 计算圆圈颜色状态
              // 无记录: 白色, 有记录未超目标: 绿色, 超过目标: 红色
              let circleClass = 'is-empty'  // 默认无记录白色
              if (cell.calories > 0) {
                if (cell.calories > cell.target) {
                  circleClass = 'is-over'  // 超过目标红色
                } else {
                  circleClass = 'is-recorded'  // 有记录未超过绿色
                }
              }
              
              return (
                <View
                  key={cell.date}
                  className={`date-item ${selectedDate === cell.date ? 'is-selected' : ''}`}
                  onClick={() => handleDateSelect(cell.date)}
                >
                  <Text className='date-day-name'>{cell.dayName}</Text>
                  <View className={`date-day-circle ${circleClass}`}>
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
              {isSwitchingDate ? (
                <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', marginTop: '8rpx' }}>
                  <Text className='card-value' style={{ fontSize: '36rpx', color: '#9ca3af' }}>--</Text>
                  <View className='loading-spinner' style={{ width: '24rpx', height: '24rpx', borderWidth: '3rpx' }} />
                </View>
              ) : (
                <Text className='card-value'>{formatNumberWithComma(Math.round(animatedRemainingCalories))}</Text>
              )}
              {!isSwitchingDate && <Text className='card-unit'>kcal</Text>}
            </View>
            <View className='target-section'>
              <Text className='target-text'>目标: {formatDisplayNumber(intakeData.target)}</Text>
              <View className='target-edit-btn' onClick={openTargetEditor}>
                <Text className='target-edit-text'>编辑目标</Text>
              </View>
            </View>
          </View>
          
          <View className='progress-section'>
            <View className='progress-bar-bg thick'>
              <View
                className='progress-bar-fill thick'
                style={{ width: `${clampVisualProgress(calorieProgress)}%` }}
              />
            </View>
          </View>
        </View>

        {/* 三大营养素卡片 - 带动画效果 */}
        <View className='macros-section'>
          {MACRO_CONFIGS.map(({ key, label, color, unit, Icon }) => {
            const macro = intakeData.macros[key]
            const animatedValue = animatedMacroValues[key]
            const animatedProgress = animatedMacroProgress[key]
            
            return (
              <View key={key} className='macro-card'>
                <View className='macro-card-header'>
                  <View className='macro-title-wrap'>
                    <View className='macro-icon'>
                      <Icon size={16} color='#9ca3af' />
                    </View>
                    <Text className='macro-label'>{label}</Text>
                  </View>
                </View>
                
                <View className='macro-gauge-wrap'>
                  <View className='macro-gauge-box'>
                    <View className='macro-gauge'>
                      <View
                        className='macro-ring-bg'
                        style={{
                          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                            `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='none' stroke='#f0f0f0' stroke-width='14'/><circle cx='50' cy='50' r='40' fill='none' stroke='${color}' stroke-width='14' stroke-linecap='round' stroke-dasharray='${2 * Math.PI * 40}' stroke-dashoffset='${2 * Math.PI * 40 * (1 - animatedProgress / 100)}'/></svg>`
                          )}")`,
                          backgroundSize: '100% 100%'
                        }}
                      />
                      <View className='macro-gauge-center'>
                        {isSwitchingDate ? (
                          <View className='loading-dots'>
                            <View className='loading-dot' />
                            <View className='loading-dot' />
                            <View className='loading-dot' />
                          </View>
                        ) : (
                          <>
                            <Text className='macro-gauge-value' style={{ color }}>
                              {formatDisplayNumber(animatedValue)}
                            </Text>
                            <Text className='macro-gauge-unit'>克</Text>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            )
          })}
        </View>

        {/* 体重/喝水状态卡片 */}
        <View className='body-status-section'>
          {/* 体重卡片 */}
          <View className='body-status-card weight-card' onClick={openWeightEditor}>
            <View className='body-status-header'>
              <View className='body-status-title-wrap'>
                <View className='body-status-icon weight-icon'>
                  <IconTrendingUp size={16} color='#8b5cf6' />
                </View>
                <Text className='body-status-title'>体重</Text>
              </View>
              <IconChevronRight size={16} color='#9ca3af' />
            </View>
            <View className='body-status-content'>
              {weightSummary.latestWeight ? (
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
                <View className='body-status-icon water-icon'>
                  <IconWaterDrop size={16} color='#3b82f6' />
                </View>
                <Text className='body-status-title'>喝水</Text>
              </View>
              <IconChevronRight size={16} color='#9ca3af' />
            </View>
            <View className='body-status-content'>
              <Text className='body-status-value'>{Math.round(animatedWaterTotal)}</Text>
              <Text className='body-status-unit'>ml</Text>
            </View>
            <View className='body-status-progress-wrap'>
              <View className='body-status-progress-bg'>
                <View 
                  className='body-status-progress-fill water'
                  style={{ width: `${clampVisualProgress(animatedWaterProgress)}%` }}
                />
              </View>
              <Text className='body-status-progress-text'>
                {Math.round(animatedWaterProgress)}% / 目标 {bodyMetrics.waterGoalMl}ml
              </Text>
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
                const targetText = isSnackMeal
                  ? `参考 ${formatDisplayNumber(mealTarget)} kcal`
                  : `目标 ${formatDisplayNumber(mealTarget)} kcal`
                const hasImages = meal.images && meal.images.length > 0
                
                return (
                  <View key={`${meal.type}-${index}`} className='meal-item'>
                    <View className='meal-icon-wrap' style={{ backgroundColor: bgColor }}>
                      <Icon size={24} color={color} />
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
                      {/* 餐食图片预览 */}
                      {hasImages && (
                        <View className='meal-images'>
                          {meal.images!.slice(0, 3).map((img, imgIndex) => (
                            <View 
                              key={imgIndex} 
                              className='meal-image-thumb'
                              onClick={(e) => {
                                e.stopPropagation()
                                previewHomeMealImages(meal, imgIndex)
                              }}
                            >
                              <Image 
                                src={img} 
                                mode='aspectFill' 
                                className='meal-image-img'
                                lazyLoad
                              />
                            </View>
                          ))}
                          {meal.images!.length > 3 && (
                            <View className='meal-image-more'>
                              <Text className='meal-image-more-text'>+{meal.images!.length - 3}</Text>
                            </View>
                          )}
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
                <Text className='target-modal-btn-text primary'>{savingWeight ? '保存中...' : '保存'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* 喝水编辑弹窗 */}
      {showWaterEditor && (
        <View className='target-modal' catchMove>
          <View className='target-modal-mask' onClick={() => !savingWater && setShowWaterEditor(false)} />
          <View className='target-modal-content'>
            <View className='target-modal-header'>
              <Text className='target-modal-title'>记录喝水</Text>
              <Text className='target-modal-desc'>今日已喝 {todayWater.total} ml</Text>
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
                    placeholder='输入水量'
                  />
                  <Text className='target-input-unit'>ml</Text>
                </View>
              </View>
            </View>

            <View className='target-relation-hint'>
              <Text className='target-relation-hint-title'>
                今日进度: {Math.round(waterProgress)}% / 目标 {bodyMetrics.waterGoalMl}ml
              </Text>
              {todayWater.logs.length > 0 && (
                <Text className='target-relation-hint-value'>
                  已记录 {todayWater.logs.length} 次，共 {todayWater.total}ml
                </Text>
              )}
            </View>

            <View className='target-modal-actions'>
              <View className='target-modal-btn secondary' onClick={() => !savingWater && setShowWaterEditor(false)}>
                <Text className='target-modal-btn-text secondary'>取消</Text>
              </View>
              {todayWater.total > 0 && (
                <View className='target-modal-btn danger' onClick={clearTodayWater}>
                  <Text className='target-modal-btn-text danger'>清空</Text>
                </View>
              )}
              <View className='target-modal-btn primary' onClick={handleSaveWater}>
                <Text className='target-modal-btn-text primary'>{savingWater ? '保存中...' : '添加'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(IndexPage)
