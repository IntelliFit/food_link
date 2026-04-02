import { View, Text, Input } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getHomeDashboard,
  getStatsSummary,
  getAccessToken,
  updateDashboardTargets,
  mergeHomeIntakeWithTargets,
  getStoredDashboardTargets,
  type DashboardTargets,
  type HomeIntakeData,
  type HomeMealItem
} from '../../utils/api'
import { IconCamera, IconText, IconProtein, IconCarbs, IconFat, IconBreakfast, IconLunch, IconDinner, IconSnack, IconTrendingUp, IconChevronRight } from '../../components/iconfont'
import { Empty, Button } from '@taroify/core'
import CustomNavBar, { getStatusBarHeightSafe } from '../../components/CustomNavBar'

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

type MacroKey = keyof HomeIntakeData['macros']
type WeekHeatmapState = 'none' | 'surplus' | 'deficit'

interface WeekHeatmapCell {
  date: string
  dayName: string
  dayNum: string
  calories: number
  target: number
  intakeRatio: number  // 摄入比例: calories / target
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
function useAnimatedNumber(target: number, duration: number = 800, delay: number = 0): number {
  const [displayValue, setDisplayValue] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const startValueRef = useRef(0)
  const targetRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  // easeOutCubic 缓动函数
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3)
  }

  useEffect(() => {
    targetRef.current = target
    startValueRef.current = displayValue
    startTimeRef.current = null

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp + delay
      }

      const elapsed = timestamp - startTimeRef.current

      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }

      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)
      const currentValue = startValueRef.current + (targetRef.current - startValueRef.current) * easedProgress

      setDisplayValue(currentValue)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [target, duration, delay])

  return displayValue
}

// 圆环进度动画 Hook
function useAnimatedProgress(targetProgress: number, duration: number = 800, delay: number = 0): number {
  const [displayProgress, setDisplayProgress] = useState(0)
  const startTimeRef = useRef<number | null>(null)
  const startProgressRef = useRef(0)
  const targetRef = useRef(targetProgress)
  const rafRef = useRef<number | null>(null)

  // easeOutCubic 缓动函数
  const easeOutCubic = (t: number): number => {
    return 1 - Math.pow(1 - t, 3)
  }

  useEffect(() => {
    targetRef.current = targetProgress
    startProgressRef.current = displayProgress
    startTimeRef.current = null

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp + delay
      }

      const elapsed = timestamp - startTimeRef.current

      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }

      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)
      const currentProgress = startProgressRef.current + (targetRef.current - startProgressRef.current) * easedProgress

      setDisplayProgress(currentProgress)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [targetProgress, duration, delay])

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
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetFormState>(createTargetForm(DEFAULT_INTAKE))
  const [selectedDate, setSelectedDate] = useState(formatDateKey(new Date()))

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
      const [res, stats] = await Promise.all([
        getHomeDashboard(targetDate),
        getStatsSummary('week')
      ])
      console.log('[DEBUG] API 返回:', res)
      console.log('[DEBUG] intakeData.current:', res.intakeData?.current)
      console.log('[DEBUG] intakeData.macros:', res.intakeData?.macros)
      // 优先使用 API 返回的数据，不使用本地缓存覆盖
      const intake = res.intakeData
      console.log('[DEBUG] 处理后的 intake:', intake)
      
      // 先设置 intakeData，再构建热力图
      console.log('[DEBUG] 设置 intakeData:', intake)
      setIntakeData(intake)
      console.log('[DEBUG] 设置 meals:', res.meals)
      setMeals(res.meals || [])
      
      // 构建7天热力图数据（今天前后各3天）
      const today = new Date()
      const nextWeekHeatmapCells: WeekHeatmapCell[] = []
      for (let offset = -3; offset <= 3; offset++) {
        const date = new Date(today)
        date.setDate(today.getDate() + offset)
        const dateKey = formatDateKey(date)
        const dayData = stats.daily_calories.find(d => d.date === dateKey)
        const hasRecord = dayData && dayData.calories > 0
        const calories = dayData?.calories || 0
        // 使用 TDEE 作为目标热量计算摄入比例
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
      
      setWeekHeatmapCells(nextWeekHeatmapCells)
      setTargetForm(createTargetForm(intake))
      console.log('[DEBUG] 所有数据设置完成')
      // 注意：selectedDate 的更新移到 handleDateSelect 中，避免重复更新
    } catch (error) {
      console.error('[DEBUG] API 调用失败:', error)
      Taro.showToast({ title: '加载失败: ' + (error as Error).message, icon: 'none', duration: 3000 })
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setWeekHeatmapCells(createWeekHeatmapCells())
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
    } finally {
      setLoading(false)
    }
  }, [setIntakeData, setMeals, setWeekHeatmapCells, setTargetForm, setLoading])

  // 每次显示页面时刷新数据（仅当显示的是今天时才刷新）
  // 使用 ref 获取最新的 selectedDate，避免闭包问题
  const selectedDateRef = useRef(selectedDate)
  selectedDateRef.current = selectedDate
  // 标志位：是否跳过下一次 useDidShow 刷新（用于点击日期后避免覆盖）
  const skipNextRefreshRef = useRef(false)
  
  Taro.useDidShow(() => {
    const today = formatDateKey(new Date())
    const currentSelected = selectedDateRef.current
    console.log('[DEBUG] useDidShow, selectedDate:', currentSelected, 'today:', today, 'skip:', skipNextRefreshRef.current)
    
    // 如果设置了跳过标志，则跳过本次刷新
    if (skipNextRefreshRef.current) {
      console.log('[DEBUG] 跳过本次刷新')
      skipNextRefreshRef.current = false
      return
    }
    
    // 只有当前显示的是今天，或者没有选择日期时，才刷新今天的数据
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

  const handleDateSelect = (date: string) => {
    console.log('[DEBUG] 点击日期:', date)
    // 设置跳过标志，避免 useDidShow 覆盖本次加载的数据
    skipNextRefreshRef.current = true
    // 直接切换到该日期的数据
    console.log('[DEBUG] 调用 loadDashboard:', date)
    setSelectedDate(date)
    loadDashboard(date)
  }

  const totalCurrent = normalizeDisplayNumber(intakeData.current)
  const totalTarget = normalizeDisplayNumber(intakeData.target)
  const remainingCalories = Math.max(0, Number((totalTarget - totalCurrent).toFixed(1)))
  const calorieProgress = normalizeProgressPercent(intakeData.progress, totalCurrent, totalTarget)

  // 使用动画数字（剩余可摄入、总摄入与三大营养素同时开始）
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

  // 计算三大营养素剩余量
  const getMacroRemaining = (key: MacroKey) => {
    const macro = intakeData.macros[key]
    return Math.max(0, Number((macro.target - macro.current).toFixed(1)))
  }

  // 营养素动画数值和进度
  const macroAnimations = useMemo(() => {
    return MACRO_CONFIGS.map(({ key }, index) => {
      const macro = intakeData.macros[key]
      const currentValue = normalizeDisplayNumber(macro.current)
      const targetValue = normalizeDisplayNumber(macro.target)
      const targetProgress = calculateProgressPercent(currentValue, targetValue)
      return {
        key,
        animatedValue: currentValue,
        animatedProgress: targetProgress,
        delay: 0 // 与顶部热量指标同时开始动画
      }
    })
  }, [intakeData.macros])

  // 为每个营养素使用动画 hook（与顶部热量指标同时开始）
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

  // 圆环进度动画（与顶部热量指标同时开始）
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

  return (
    <View className='home-page'>
      {/* 自定义渐变导航栏 */}
      <CustomNavBar
        title=''
        background='transparent'
      />
      
      {/* 背景渐变层 */}
      <View className='gradient-bg' />
      
      {/* 页面内容 - 减少顶部留白 */}
      <View className='page-content' style={{ paddingTop: '10rpx' }}>
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
              <Text className='card-value'>{formatNumberWithComma(Math.round(animatedRemainingCalories))}</Text>
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
            
            // 使用动画进度和数值
            const animatedProgress = clampVisualProgress(animatedMacroProgress[key] ?? 0)
            const animatedValue = animatedMacroValues[key] ?? 0
            
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
                
                {/* 大仪表盘 - 使用 CSS 环形进度条 */}
                <View className='macro-gauge-wrap'>
                  <View className='macro-gauge-box'>
                    <View className='macro-gauge'>
                      {/* SVG 圆环进度条（微信小程序用 data URI 背景图渲染） */}
                      <View
                        className='macro-ring-bg'
                        style={{
                          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                            `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='none' stroke='#f0f0f0' stroke-width='14'/><circle cx='50' cy='50' r='40' fill='none' stroke='${color}' stroke-width='14' stroke-linecap='round' stroke-dasharray='${2 * Math.PI * 40}' stroke-dashoffset='${2 * Math.PI * 40 * (1 - animatedProgress / 100)}'/></svg>`
                          )}")`,
                          backgroundSize: '100% 100%'
                        }}
                      />
                      {/* 中心数值 - 使用动画数值 */}
                      <View className='macro-gauge-center'>
                        <Text className='macro-gauge-value' style={{ color }}>
                          {loading ? '--' : formatDisplayNumber(animatedValue)}
                        </Text>
                        <Text className='macro-gauge-unit'>克</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            )
          })}
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
    </View>
  )
}

export default withAuth(IndexPage)
