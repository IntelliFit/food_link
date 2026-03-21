import { View, Text, Input } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
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
import { IconCamera, IconText, IconProtein, IconCarbs, IconFat, IconBreakfast, IconLunch, IconDinner, IconSnack } from '../../components/iconfont'
import { Empty, Button } from '@taroify/core'
import CustomNavBar from '../../components/CustomNavBar'

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
  calories: number
  state: WeekHeatmapState
  level: 0 | 1 | 2 | 3
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

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function formatDisplayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
    // 当前无有效宏量目标时，回退为常见配比（30/40/30）并保证热量关系成立。
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

function clampProgress(current: number, target: number): number {
  if (target <= 0) {
    return current > 0 ? 100 : 0
  }
  return Math.min(100, Math.max(0, Number(((current / target) * 100).toFixed(1))))
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
  breakfast: { Icon: IconBreakfast, color: '#ff6900' },
  lunch: { Icon: IconLunch, color: '#00c950' },
  dinner: { Icon: IconDinner, color: '#2b7fff' },
  snack: { Icon: IconSnack, color: '#ad46ff' }
} as const

const MACRO_CONFIGS: Array<{
  key: MacroKey
  label: string
  color: string
  unit: string
  Icon: typeof IconProtein
}> = [
  { key: 'protein', label: '蛋白质', color: '#3b82f6', unit: 'g', Icon: IconProtein },
  { key: 'carbs', label: '碳水', color: '#00bc7d', unit: 'g', Icon: IconCarbs },
  { key: 'fat', label: '脂肪', color: '#f59e0b', unit: 'g', Icon: IconFat }
]

const RECORD_HISTORY_DATE_KEY = 'recordHistoryDate'

function createEmptyWeekHeatmapCells(): WeekHeatmapCell[] {
  const today = new Date()
  const cells: WeekHeatmapCell[] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    cells.push({
      date: formatDateKey(date),
      calories: 0,
      state: 'none',
      level: 0
    })
  }
  return cells
}

export default function IndexPage() {
  const [intakeData, setIntakeData] = useState<HomeIntakeData>(DEFAULT_INTAKE)
  const [meals, setMeals] = useState<HomeMealItem[]>([])
  const [weekHeatmapCells, setWeekHeatmapCells] = useState<WeekHeatmapCell[]>([])
  const [loading, setLoading] = useState(true)
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetFormState>(createTargetForm(DEFAULT_INTAKE))

  const loadDashboard = useCallback(async () => {
    if (!getAccessToken()) {
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [res, stats] = await Promise.all([
        getHomeDashboard(),
        getStatsSummary('week')
      ])
      const storedTargets = getStoredDashboardTargets()
      const intake =
        storedTargets != null ? mergeHomeIntakeWithTargets(res.intakeData, storedTargets) : res.intakeData
      const nextWeekHeatmapCells: WeekHeatmapCell[] = stats.daily_calories.slice(-7).map((item) => {
        const hasRecord = item.calories > 0
        const delta = hasRecord ? item.calories - stats.tdee : 0
        const deltaRatio = hasRecord ? Math.abs(delta) / Math.max(stats.tdee, 1) : 0
        let level: WeekHeatmapCell['level'] = 0
        if (deltaRatio > 0.3) level = 3
        else if (deltaRatio > 0.15) level = 2
        else if (deltaRatio > 0) level = 1
        return {
          date: item.date,
          calories: item.calories,
          state: !hasRecord ? 'none' : delta > 0 ? 'surplus' : 'deficit',
          level
        }
      })
      setIntakeData(intake)
      setMeals(res.meals || [])
      setWeekHeatmapCells(nextWeekHeatmapCells)
      setTargetForm(createTargetForm(intake))
    } catch {
      setIntakeData(DEFAULT_INTAKE)
      setMeals([])
      setWeekHeatmapCells([])
      setTargetForm(createTargetForm(DEFAULT_INTAKE))
    } finally {
      setLoading(false)
    }
  }, [])

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
    Taro.setStorageSync('recordPageTab', 'history')
    Taro.switchTab({ url: '/pages/record/index' })
  }

  const remainingCalories = Math.max(0, Number((intakeData.target - intakeData.current).toFixed(1)))
  const displayWeekHeatmapCells = weekHeatmapCells.length > 0 ? weekHeatmapCells : createEmptyWeekHeatmapCells()
  const recordedDaysThisWeek = displayWeekHeatmapCells.filter((item) => item.calories > 0).length
  const openRecordDate = (date: string) => {
    Taro.setStorageSync('recordPageTab', 'history')
    Taro.setStorageSync(RECORD_HISTORY_DATE_KEY, date)
    Taro.switchTab({ url: '/pages/record/index' })
  }
  const openRecordSummary = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.navigateTo({ url: '/pages/stats/index' })
  }
  const calorieInputValue = parseCompleteNumber(targetForm.calorieTarget)
  const macroInputValues = parseMacroTargets(targetForm)
  const caloriesFromMacroInputs = macroInputValues ? calcCaloriesFromMacros(macroInputValues) : null
  const calorieGap =
    calorieInputValue != null && caloriesFromMacroInputs != null
      ? Number((calorieInputValue - caloriesFromMacroInputs).toFixed(1))
      : null
  const isRelationAligned = calorieGap != null && Math.abs(calorieGap) <= 1

  return (
    <View className='home-page'>
      {/* 自定义渐变导航栏 */}
      <CustomNavBar
        title='首页'
        background='linear-gradient(to right, #00bc7d 0%, #00bba7 100%)'
      />
      {/* 顶部渐变区域 */}
      <View className='header-section'>
        <View className='header-content'>
          <View className='greeting-section'>
            <Text className='greeting-title'>{getGreeting()}</Text>
            <Text className='greeting-subtitle'>今天也要健康饮食哦</Text>
          </View>
          <View className='trend-icon'>
            <Text className='iconfont icon-shangzhang trend-icon-symbol' />
          </View>
        </View>

        {/* 今日摄入卡片 */}
        <View className='intake-card'>
          <View className='intake-header'>
            <Text className='intake-label'>今日摄入</Text>
            <View className='target-actions'>
              <Text className='target-label'>目标 {formatDisplayNumber(intakeData.target)} kcal</Text>
              <View className='target-edit-btn' onClick={openTargetEditor}>
                <Text className='target-edit-btn-text'>编辑目标</Text>
              </View>
            </View>
          </View>
          <View className='calorie-section'>
            <Text className='calorie-value'>
              {loading ? '--' : formatDisplayNumber(intakeData.current)}
            </Text>
            <Text className='calorie-target'>/{formatDisplayNumber(intakeData.target)} kcal</Text>
          </View>
          <View className='progress-bar'>
            <View
              className='progress-fill'
              style={{ width: `${intakeData.progress}%` }}
            />
          </View>
          <View className='intake-summary-row'>
            <Text className='intake-summary-text'>已完成 {intakeData.progress.toFixed(0)}%</Text>
            <Text className='intake-summary-text'>剩余 {formatDisplayNumber(remainingCalories)} kcal</Text>
          </View>

          <View className='macro-donuts-row'>
            {MACRO_CONFIGS.map(({ key, label, unit, color, Icon }) => {
              const macro = intakeData.macros[key]
              const progress = clampProgress(macro.current, macro.target)
              const ringBg = `conic-gradient(${color} 0% ${progress}%, rgba(255,255,255,0.2) ${progress}% 100%)`

              return (
                <View key={key} className='macro-donut-col'>
                  <View className='macro-donut-wrap'>
                    <View className='macro-donut-ring' style={{ background: ringBg }} />
                    <View className='macro-donut-inner'>
                      <Icon size={20} color={color} />
                    </View>
                  </View>
                  <Text className='macro-donut-name'>{label}</Text>
                  <Text className='macro-donut-value'>
                    {formatDisplayNumber(macro.current)}/{formatDisplayNumber(macro.target)}
                    {unit}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>

        <View className='home-week-card'>
          <View className='home-week-header'>
            <View>
              <Text className='home-week-title'>本周饮食记录</Text>
              <Text className='home-week-subtitle'>灰色未记录，红色吃多了，蓝色吃少了</Text>
            </View>
            <View className='home-week-link' onClick={openRecordSummary}>
              <Text className='home-week-link-text'>饮食记录</Text>
              <Text className='home-week-link-arrow'>→</Text>
            </View>
          </View>
          <View className='home-week-grid'>
            {displayWeekHeatmapCells.map((item) => (
              <View
                key={item.date}
                className={`home-week-cell ${item.state} level-${item.level} ${item.calories > 0 ? 'is-clickable' : ''}`}
                onClick={() => item.calories > 0 && openRecordDate(item.date)}
              >
                <Text className='home-week-cell-date'>{item.date.slice(-2)}</Text>
                <View className='home-week-cell-dot' />
              </View>
            ))}
          </View>
          <Text className='home-week-summary'>
            本周已记录 {recordedDaysThisWeek}/7 天
          </Text>
        </View>
      </View>

      {/* 快捷记录 */}
      <View className='quick-record-section'>
        <Text className='section-title'>快捷记录</Text>
        <View className='quick-buttons'>
          <View
            className='quick-button photo-btn'
            onClick={() => handleQuickRecord('photo')}
          >
            <View className='button-icon photo-icon'>
              <IconCamera size={44} color="#ffffff" />
            </View>
            <Text className='button-text'>拍照识别</Text>
          </View>
          <View
            className='quick-button text-btn'
            onClick={() => handleQuickRecord('text')}
          >
            <View className='button-icon text-icon'>
              <IconText size={44} color="#ffffff" />
            </View>
            <Text className='button-text'>文字记录</Text>
          </View>
        </View>
      </View>

      {/* 今日餐食 */}
      <View className='meals-section'>
        <View className='section-header'>
          <Text className='section-title'>今日餐食</Text>
          <View className='view-all-btn' onClick={handleViewAllMeals}>
            <Text className='view-all-text'>今日餐食记录</Text>
            <Text className='arrow'>→</Text>
          </View>
        </View>
        <View className='meals-list'>
          {loading ? null : meals.length === 0 ? (
            <Empty>
              <Empty.Image />
              <Empty.Description>暂无今日餐食</Empty.Description>
              <Button
                shape="round"
                color="primary"
                className="empty-record-btn"
                onClick={() => handleQuickRecord('photo')}
              >
                去记录一餐
              </Button>
            </Empty>
          ) : (
            meals.map((meal, index) => (
              <View key={`${meal.type}-${index}`} className='meal-card'>
                <View className='meal-header'>
                  <View className='meal-info'>
                    <View className={`meal-icon ${meal.type}-icon`}>
                      {(() => {
                        const { Icon, color } = MEAL_ICON_CONFIG[meal.type as keyof typeof MEAL_ICON_CONFIG] ?? MEAL_ICON_CONFIG.snack
                        return <Icon size={40} color={color} />
                      })()}
                    </View>
                    <View className='meal-details'>
                      <Text className='meal-name'>{meal.name}</Text>
                      <Text className='meal-time'>{meal.time}</Text>
                    </View>
                  </View>
                  <View className='meal-calorie'>
                    <Text className='calorie-text'>{meal.calorie} kcal</Text>
                    <Text className='calorie-label'>目标 {meal.target} kcal</Text>
                  </View>
                </View>
                <View className='meal-progress'>
                  <View className='meal-progress-bar'>
                    <View
                      className={`meal-progress-fill ${meal.type}-progress`}
                      style={{ width: `${meal.progress}%` }}
                    />
                  </View>
                  <Text className='progress-percent'>{Number(meal.progress).toFixed(0)}%</Text>
                </View>
                {meal.tags && meal.tags.length > 0 && (
                  <View className='meal-tags'>
                    {meal.tags.map((tag, tagIndex) => (
                      <View
                        key={tagIndex}
                        className={`meal-tag ${meal.type}-tag`}
                      >
                        <Text className='tag-text'>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )))}
        </View>
      </View>

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


