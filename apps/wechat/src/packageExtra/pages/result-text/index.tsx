import { View, Text, ScrollView, Slider } from '@tarojs/components'
import { withAuth } from '../../../utils/withAuth'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro from '@tarojs/taro'
import {
  AnalyzeResponse, FoodItem, MealType, Nutrients, saveFoodRecord, showUnifiedApiError, getAccessToken, getHealthProfile,
  submitAnalysisFeedback, ANALYSIS_FEEDBACK_SUBMISSION_ENABLED,
  type AnalysisFeedbackType, type AnalysisResolutionState
} from '../../../utils/api'
import { normalizeItemNutrients } from '../result/result-item-converter'
import {
  inferDefaultMealTypeFromHealthProfile,
  inferDefaultMealTypeFromLocalTime,
} from '../../../utils/infer-default-meal-type'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { addWaterToBodyMetricsStorage, calculateFoodRecordItemsWaterMl, refreshHomeDashboardLocalSnapshotFromCloud } from '../../../utils/home-dashboard-local-cache'
import { formatDateKey } from '../../../pages/index/utils/helpers'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getStoredRecordTargetDate, persistRecordTargetDate } from '../../../utils/record-date'

import './index.scss'

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'morning_snack' as const, label: '早加餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'afternoon_snack' as const, label: '午加餐' },
  { value: 'dinner' as const, label: '晚餐' },
  { value: 'evening_snack' as const, label: '晚加餐' },
]
type SelectableMealType = (typeof MEAL_OPTIONS)[number]['value']

const toSelectableMealType = (value: unknown): SelectableMealType | undefined => {
  if (value === 'snack') return 'afternoon_snack'
  const hit = MEAL_OPTIONS.find((o) => o.value === value)
  return hit?.value
}

const getSavedSelectableMealType = (fallbackMealType: SelectableMealType): SelectableMealType => {
  const savedMealType = Taro.getStorageSync('analyzeMealType')
  return toSelectableMealType(savedMealType) || fallbackMealType
}

const MEAL_ICONS = {
  breakfast: 'icon-zaocan',
  morning_snack: 'icon-lingshi',
  lunch: 'icon-wucan',
  afternoon_snack: 'icon-lingshi',
  dinner: 'icon-wancan',
  evening_snack: 'icon-lingshi',
}

interface NutritionItem {
  id: number
  name: string
  weight: number
  calorie: number
  intake: number
  ratio: number
  protein: number
  carbs: number
  fat: number
  nutrients: Nutrients
}

type MacroField = 'protein' | 'carbs' | 'fat'

const MACRO_FIELDS: MacroField[] = ['protein', 'carbs', 'fat']

const MACRO_FIELD_META: Record<MacroField, { label: string; className: string }> = {
  protein: { label: '蛋白质', className: 'protein' },
  carbs: { label: '碳水', className: 'carbs' },
  fat: { label: '脂肪', className: 'fat' }
}

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const normalizeNutrientValue = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

const toSafeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

type ScoreTone = 'positive' | 'neutral' | 'warning' | 'danger'

const scoreToTone = (score: number): ScoreTone => {
  if (score >= 78) return 'positive'
  if (score >= 60) return 'neutral'
  if (score >= 42) return 'warning'
  return 'danger'
}

const scoreToLabel = (score: number): string => {
  if (score >= 78) return '偏保护'
  if (score >= 60) return '基本中性'
  if (score >= 42) return '需要关注'
  return '重点关注'
}

const formatMacroDisplay = (value: number) => roundToSingleDecimal(value).toFixed(1)

const calculateCaloriesFromMacros = (protein: number, carbs: number, fat: number) => (
  Math.max(0, roundToSingleDecimal(protein) * 4 + roundToSingleDecimal(carbs) * 4 + roundToSingleDecimal(fat) * 9)
)

const scaleNutrients = (nutrients: Nutrients, factor: number): Nutrients => {
  const scaled = { ...nutrients }
  ;(Object.keys(scaled) as Array<keyof Nutrients>).forEach((key) => {
    const current = scaled[key]
    if (typeof current === 'number') {
      scaled[key] = Math.max(0, Math.round(current * factor * 100) / 100) as never
    }
  })
  return scaled
}

/** 用户在分析结果页停留超过此时间且未调整摄入比例，则视为疑似不信任识别结果 */
const SUSPECT_DISTRUST_TIMEOUT_MS = 15000

function ResultTextPage() {
  const [totalWeight, setTotalWeight] = useState(0)
  const [nutritionItems, setNutritionItems] = useState<NutritionItem[]>([])
  const originalItemsRef = useRef<NutritionItem[]>([])
  const weightAdjustedRef = useRef(false)
  const nutritionAdjustedRef = useRef(false)
  const ratioAdjustedRef = useRef(false)
  const suspectDistrustTimerRef = useRef<NodeJS.Timeout | null>(null)
  const submittedFeedbackRef = useRef<Set<string>>(new Set())
  const devFeedbackLogsRef = useRef<Array<{ type: AnalysisFeedbackType; state: AnalysisResolutionState; at: number; ok: boolean; disabled?: boolean; err?: string; sourceTaskId?: string; sourceRecordId?: string }>>([])
  const [devFeedbackPanelOpen, setDevFeedbackPanelOpen] = useState(false)
  const [nutritionStats, setNutritionStats] = useState({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  })
  const [scoreEnabled, setScoreEnabled] = useState(false)
  const [finalScore, setFinalScore] = useState(0)
  const [micronutrientScore, setMicronutrientScore] = useState(0)
  const [macroBalanceScore, setMacroBalanceScore] = useState(0)
  const [calorieScore, setCalorieScore] = useState(0)
  const [healthAdvice, setHealthAdvice] = useState('')
  const [description, setDescription] = useState('')
  const [pfcRatioComment, setPfcRatioComment] = useState<string | null>(null)
  const [absorptionNotes, setAbsorptionNotes] = useState<string | null>(null)
  const [contextAdvice, setContextAdvice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [noData, setNoData] = useState(false)
  const [defaultMealType, setDefaultMealType] = useState<SelectableMealType>(() => inferDefaultMealTypeFromLocalTime())

  // 餐次选择弹窗状态
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>(
    () => getSavedSelectableMealType(inferDefaultMealTypeFromLocalTime())
  )

  const convertApiDataToItems = (items: FoodItem[]): NutritionItem[] => {
    return items.map((item, index) => {
      const weight = normalizeNutrientValue(item.estimatedWeightGrams)
      const waterMl = normalizeNutrientValue(item.waterMl ?? item.water_ml ?? item.nutrients?.waterMl ?? item.nutrients?.water_ml)
      const nutrients = normalizeItemNutrients(item.nutrients, waterMl)
      return {
        id: index + 1,
        name: item.name,
        weight,
        calorie: nutrients.calories > 0 ? nutrients.calories : calculateCaloriesFromMacros(nutrients.protein, nutrients.carbs, nutrients.fat),
        intake: weight,
        ratio: 100,
        protein: nutrients.protein,
        carbs: nutrients.carbs,
        fat: nutrients.fat,
        nutrients
      }
    })
  }

  const calculateNutritionStats = (items: NutritionItem[]) => {
    const stats = items.reduce(
      (acc, item) => {
        const ratio = item.ratio / 100
        return {
          calories: acc.calories + item.calorie * ratio,
          protein: acc.protein + item.protein * ratio,
          carbs: acc.carbs + item.carbs * ratio,
          fat: acc.fat + item.fat * ratio
        }
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    )
    setNutritionStats(stats)
    const total = items.reduce((sum, item) => sum + item.intake, 0)
    setTotalWeight(Math.round(total))
  }

  const clearSuspectDistrustTimer = useCallback(() => {
    if (suspectDistrustTimerRef.current) {
      clearTimeout(suspectDistrustTimerRef.current)
      suspectDistrustTimerRef.current = null
    }
  }, [])

  const submitFeedbackDeduped = useCallback(async (
    feedbackType: AnalysisFeedbackType,
    resolutionState: AnalysisResolutionState,
    extra?: { sourceTaskId?: string; sourceRecordId?: string; beforeResult?: Record<string, unknown>; afterResult?: Record<string, unknown> }
  ) => {
    const sourceTaskId = extra?.sourceTaskId || String(Taro.getStorageSync('analyzeSourceTaskId') || '')
    const sourceRecordId = extra?.sourceRecordId || ''
    if (!sourceTaskId && !sourceRecordId) return
    const key = `${sourceTaskId}:${sourceRecordId}:${feedbackType}`
    if (submittedFeedbackRef.current.has(key)) return
    submittedFeedbackRef.current.add(key)
    try {
      const res = await submitAnalysisFeedback({
        feedback_type: feedbackType,
        resolution_state: resolutionState,
        source_task_id: sourceTaskId || undefined,
        source_record_id: sourceRecordId || undefined,
        before_result: extra?.beforeResult,
        after_result: extra?.afterResult,
      })
      if (__ENABLE_DEV_DEBUG_UI__) {
        const disabled = res.message === 'feedback submission disabled'
        devFeedbackLogsRef.current.unshift({
          type: feedbackType,
          state: resolutionState,
          at: Date.now(),
          ok: true,
          disabled,
          sourceTaskId,
          sourceRecordId: extra?.sourceRecordId,
        })
        Taro.showToast({ title: disabled ? `[dev] feedback 已禁用: ${feedbackType}` : `[dev] feedback: ${feedbackType}`, icon: 'none' })
      }
    } catch (e) {
      console.error('[Feedback]', e)
      if (__ENABLE_DEV_DEBUG_UI__) {
        devFeedbackLogsRef.current.unshift({
          type: feedbackType,
          state: resolutionState,
          at: Date.now(),
          ok: false,
          err: e instanceof Error ? e.message : String(e),
          sourceTaskId,
          sourceRecordId: extra?.sourceRecordId,
        })
        Taro.showToast({ title: `[dev] feedback 失败: ${feedbackType}`, icon: 'none' })
      }
    }
  }, [])

  const startSuspectDistrustTimer = useCallback(() => {
    clearSuspectDistrustTimer()
    suspectDistrustTimerRef.current = setTimeout(() => {
      if (!ratioAdjustedRef.current) {
        void submitFeedbackDeduped('suspect_distrust', 'still_distrust')
      }
    }, SUSPECT_DISTRUST_TIMEOUT_MS)
  }, [clearSuspectDistrustTimer, submitFeedbackDeduped])

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    persistRecordTargetDate(String(params?.date || ''))
    try {
      const stored = Taro.getStorageSync('analyzeTextResult')
      if (!stored) {
        setNoData(true)
        return
      }
      const result: AnalyzeResponse = JSON.parse(stored)
      setDescription(result.description || '')
      setHealthAdvice(result.insight || '保持健康饮食！')
      setPfcRatioComment(result.pfc_ratio_comment ?? null)
      setAbsorptionNotes(result.absorption_notes ?? null)
      setContextAdvice(result.context_advice ?? null)
      setScoreEnabled(Boolean(result.score_enabled))
      setFinalScore(toSafeNumber(result.final_score, 0))
      setMicronutrientScore(toSafeNumber(result.micronutrient_score, 0))
      setMacroBalanceScore(toSafeNumber(result.macro_balance_score, 0))
      setCalorieScore(toSafeNumber(result.calorie_score, 0))
      const items = convertApiDataToItems(result.items)
      setNutritionItems(items)
      originalItemsRef.current = JSON.parse(JSON.stringify(items))
      calculateNutritionStats(items)
      startSuspectDistrustTimer()
    } catch {
      setNoData(true)
    }
    return () => {
      clearSuspectDistrustTimer()
    }
  }, [])

  useEffect(() => {
    const loadMealTypeProfile = async () => {
      try {
        const token = getAccessToken()
        if (!token) return
        const profile = await getHealthProfile()
        setDefaultMealType(inferDefaultMealTypeFromHealthProfile(profile, new Date()))
      } catch {
        setDefaultMealType(inferDefaultMealTypeFromLocalTime())
      }
    }
    void loadMealTypeProfile()
  }, [])

  useEffect(() => {
    setSelectedMealType(getSavedSelectableMealType(defaultMealType))
  }, [defaultMealType])

  const handleWeightAdjust = (id: number, delta: number) => {
    weightAdjustedRef.current = true
    setNutritionItems((items) => {
      const updated = items.map((item) => {
        if (item.id !== id) return item
        const newWeight = Math.max(10, item.weight + delta)
        const weightScale = item.weight > 0 ? newWeight / item.weight : 1
        const scaledNutrients = scaleNutrients(item.nutrients, weightScale)
        const newIntake = Math.round(newWeight * (item.ratio / 100))
        return {
          ...item,
          weight: newWeight,
          intake: newIntake,
          calorie: scaledNutrients.calories > 0 ? scaledNutrients.calories : calculateCaloriesFromMacros(scaledNutrients.protein, scaledNutrients.carbs, scaledNutrients.fat),
          protein: scaledNutrients.protein,
          carbs: scaledNutrients.carbs,
          fat: scaledNutrients.fat,
          nutrients: scaledNutrients
        }
      })
      calculateNutritionStats(updated)
      return updated
    })
  }

  const handleRatioAdjust = (id: number, newRatio: number) => {
    ratioAdjustedRef.current = true
    clearSuspectDistrustTimer()
    const clamped = Math.max(0, Math.min(100, newRatio))
    setNutritionItems((items) => {
      const updated = items.map((item) => {
        if (item.id !== id) return item
        const newIntake = Math.round(item.weight * (clamped / 100))
        return { ...item, ratio: clamped, intake: newIntake }
      })
      calculateNutritionStats(updated)
      return updated
    })
  }

  const updateMacroField = (
    id: number,
    field: MacroField,
    nextValue: number | ((currentValue: number) => number)
  ) => {
    nutritionAdjustedRef.current = true
    setNutritionItems((items) => {
      const updated = items.map((item) => {
        if (item.id !== id) return item
        const resolvedValue = typeof nextValue === 'function' ? nextValue(item[field]) : nextValue
        const normalizedValue = Math.max(0, roundToSingleDecimal(resolvedValue))
        const nextItem: NutritionItem = {
          ...item,
          [field]: normalizedValue,
          nutrients: { ...item.nutrients, [field]: normalizedValue }
        }
        const calorie = calculateCaloriesFromMacros(nextItem.protein, nextItem.carbs, nextItem.fat)
        return {
          ...nextItem,
          calorie,
          nutrients: { ...nextItem.nutrients, calories: calorie }
        }
      })
      calculateNutritionStats(updated)
      return updated
    })
  }

  const handleMacroEdit = (id: number, field: MacroField, currentValue: number) => {
    const meta = MACRO_FIELD_META[field]
    Taro.showModal({
      title: `修改${meta.label}(g)`,
      content: formatMacroDisplay(currentValue),
      // @ts-ignore
      editable: true,
      placeholderText: '请输入克数',
      success: (res) => {
        if (!res.confirm) return
        const nextText = String((res as any).content ?? '').trim()
        const parsed = Number(nextText)
        if (!nextText || !Number.isFinite(parsed) || parsed < 0) {
          Taro.showToast({ title: '请输入不小于0的数字', icon: 'none' })
          return
        }
        updateMacroField(id, field, parsed)
      }
    })
  }

  // 修改食物名称
  const handleEditName = (id: number, currentName: string) => {
    nutritionAdjustedRef.current = true
    Taro.showModal({
      title: '修改食物名称',
      content: currentName,
      // @ts-ignore
      editable: true,
      placeholderText: '请输入新的食物名称',
      success: (res) => {
        if (res.confirm) {
          const newName = (res as any).content.trim()
          if (!newName) {
            Taro.showToast({ title: '名称不能为空', icon: 'none' }); return
          }
          setNutritionItems(items => items.map(item =>
            item.id === id ? { ...item, name: newName } : item
          ))
        }
      }
    })
  }

  /** 保存记录：saveOnly=true 仅保存，false 保存后跳详情页 */
  const saveRecord = async (saveOnly: boolean, confirmedMealType?: SelectableMealType) => {
    // 确定餐次
    let mealType = confirmedMealType || getSavedSelectableMealType(defaultMealType)

    clearSuspectDistrustTimer()
    const hasWeightChangeOnly = weightAdjustedRef.current && !nutritionAdjustedRef.current && !ratioAdjustedRef.current
    const hasNutritionChange = nutritionAdjustedRef.current
    if (hasWeightChangeOnly) {
      void submitFeedbackDeduped('weight_mismatch', 'still_distrust')
    } else if (hasNutritionChange) {
      void submitFeedbackDeduped('nutrition_mismatch', 'still_distrust')
    }

    setSaving(true)
    try {
      const payload = {
        date: getStoredRecordTargetDate(),
        meal_type: mealType as MealType,
        description: description || undefined,
        insight: healthAdvice || undefined,
        items: nutritionItems.map((item) => ({
          name: item.name,
          weight: item.weight,
          ratio: item.ratio,
          intake: item.intake,
          nutrients: item.nutrients
        })),
        total_calories: nutritionStats.calories,
        total_protein: nutritionStats.protein,
        total_carbs: nutritionStats.carbs,
        total_fat: nutritionStats.fat,
        total_weight_grams: totalWeight,
        pfc_ratio_comment: pfcRatioComment ?? undefined,
        absorption_notes: absorptionNotes ?? undefined,
        context_advice: contextAdvice ?? undefined,
        entry_type: 'food_text' as const,
      }
      const saveResult = await saveFoodRecord(payload)
      const targetDate = payload.date || getStoredRecordTargetDate() || formatDateKey(new Date())
      if (!saveResult.already_saved) {
        addWaterToBodyMetricsStorage(targetDate, calculateFoodRecordItemsWaterMl(payload.items || []))
      }
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDate })
      } catch {
        /* ignore */
      }
      try {
        await refreshHomeDashboardLocalSnapshotFromCloud(targetDate)
      } catch {
        /* ignore */
      }
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDate, force: true })
      } catch {
        /* ignore */
      }

      if (saveOnly) {
        Taro.showToast({ title: '记录成功', icon: 'success' })
        setTimeout(() => {
          Taro.navigateBack({ delta: 1 })
        }, 1200)
        return
      }

      Taro.showToast({ title: '已保存，去分享', icon: 'success' })
      setTimeout(() => {
        Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(saveResult.id)}` })
      }, 500)
    } catch (e: any) {
      await showUnifiedApiError(e, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  /** 点击保存按钮：打开餐次选择弹窗 */
  const handleConfirmAndShare = () => {
    setSelectedMealType(getSavedSelectableMealType(defaultMealType))
    setShowMealSelector(true)
  }

  /** 弹窗确认保存 */
  const handleConfirmMealType = () => {
    setShowMealSelector(false)
    saveRecord(false, selectedMealType)
  }

  if (noData) {
    return (
      <View className='result-text-page'>
        <View className='empty-state'>
          <Text className='empty-icon iconfont icon-nothing'></Text>
          <Text className='empty-text'>未找到分析结果</Text>
          <Text className='empty-hint'>请从记录页使用「文字记录」并点击「开始计算」</Text>
        </View>
      </View>
    )
  }

  if (nutritionItems.length === 0) {
    return (
      <View className='result-text-page'>
        <View className='empty-state'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  return (
    <View className='result-text-page'>
      <ScrollView className='result-scroll' scrollY enhanced showScrollbar={false}>
        {/* 顶部 Hero 区域 (Text Version) */}
        <View className='hero-section'>
          <View className='hero-icon-wrapper'>
            <Text className='iconfont icon-jishiben'></Text>
          </View>
          <Text className='hero-title'>文字记录分析</Text>
          <View className='hero-overlay'></View>
        </View>

        <View className='content-container'>
          {/* 核心营养概览 */}
          <View className='nutrition-overview-card'>
            <View className='nutrition-header'>
              <View className='calories-main'>
                <Text className='calories-value'>{Math.max(0, Math.round(nutritionStats.calories))}</Text>
                <View className='calories-unit-row'>
                  <Text className='calories-unit'>kcal</Text>
                  <Text className='calories-label'>总热量</Text>
                </View>
              </View>
              <View className='total-weight-badge'>
                <Text className='weight-icon iconfont icon-tianpingzuo'></Text>
                <Text className='weight-text'>约 {totalWeight}g</Text>
              </View>
            </View>

            <View className='macro-grid'>
              <View className='macro-item protein'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${Math.min((nutritionStats.protein / 50) * 100, 100)}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.protein * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>蛋白质</Text>
              </View>
              <View className='macro-item carbs'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${Math.min((nutritionStats.carbs / 100) * 100, 100)}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.carbs * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>碳水</Text>
              </View>
              <View className='macro-item fat'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${Math.min((nutritionStats.fat / 40) * 100, 100)}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.fat * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>脂肪</Text>
              </View>
            </View>
          </View>

          {scoreEnabled && (
            <View className='score-overview-card'>
              <View className='score-overview-main'>
                <View className='score-overview-left'>
                  <Text className='score-overview-title'>本餐评分</Text>
                  <View className='score-overview-score-row'>
                    <Text className='score-overview-score'>{finalScore}</Text>
                    <Text className='score-overview-unit'>/ 100</Text>
                  </View>
                </View>
                <View className={`score-overview-badge tone-${scoreToTone(finalScore)}`}>
                  <Text className='score-overview-badge-label'>{scoreToLabel(finalScore)}</Text>
                </View>
              </View>
              <View className='score-breakdown'>
                <View className='score-breakdown-item'>
                  <Text className='score-breakdown-label'>微量元素</Text>
                  <View className='score-breakdown-track'>
                    <View className='score-breakdown-fill micro' style={{ width: `${Math.min(100, Math.max(0, micronutrientScore))}%` }} />
                  </View>
                  <Text className='score-breakdown-value'>{micronutrientScore}</Text>
                </View>
                <View className='score-breakdown-item'>
                  <Text className='score-breakdown-label'>宏量平衡</Text>
                  <View className='score-breakdown-track'>
                    <View className='score-breakdown-fill macro' style={{ width: `${Math.min(100, Math.max(0, macroBalanceScore))}%` }} />
                  </View>
                  <Text className='score-breakdown-value'>{macroBalanceScore}</Text>
                </View>
                <View className='score-breakdown-item'>
                  <Text className='score-breakdown-label'>热量适配</Text>
                  <View className='score-breakdown-track'>
                    <View className='score-breakdown-fill calorie' style={{ width: `${Math.min(100, Math.max(0, calorieScore))}%` }} />
                  </View>
                  <Text className='score-breakdown-value'>{calorieScore}</Text>
                </View>
              </View>
            </View>
          )}

          {/* AI 健康透视 */}
          <View className='insight-card'>
            <View className='card-header'>
              <Text className='card-title'>
                <Text className='iconfont icon-a-144-lvye'></Text>
                AI 饮食透视
              </Text>
            </View>

            {description && (
              <View className='insight-item intro'>
                <View className='insight-icon-wrapper blue'>
                  <Text className='insight-icon iconfont icon-jishiben'></Text>
                </View>
                <Text className='insight-content'>{description}</Text>
              </View>
            )}

            <View className='insight-item highlight'>
              <View className='insight-icon-wrapper green'>
                <Text className='insight-icon iconfont icon-good'></Text>
              </View>
              <Text className='insight-content'>{healthAdvice}</Text>
            </View>

            {pfcRatioComment && (
              <View className='insight-item ratio'>
                <View className='insight-icon-wrapper orange'>
                  <Text className='insight-icon iconfont icon-tubiao-zhuzhuangtu'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>营养比例</Text>
                  <Text className='insight-content'>{pfcRatioComment}</Text>
                </View>
              </View>
            )}

            {absorptionNotes && (
              <View className='insight-item absorption'>
                <View className='insight-icon-wrapper purple'>
                  <Text className='insight-icon iconfont icon-huore'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>吸收与利用</Text>
                  <Text className='insight-content'>{absorptionNotes}</Text>
                </View>
              </View>
            )}

            {contextAdvice && (
              <View className='insight-item intro'>
                <View className='insight-icon-wrapper blue'>
                  <Text className='insight-icon iconfont icon-shizhong'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>情境建议</Text>
                  <Text className='insight-content'>{contextAdvice}</Text>
                </View>
              </View>
            )}
          </View>

          {/* 包含成分 */}
          <View className='ingredients-section'>
            <View className='section-title-row'>
              <Text className='section-title'>包含成分</Text>
              <Text className='section-count'>共 {nutritionItems.length} 项</Text>
            </View>

            <View className='ingredients-list'>
              {nutritionItems.map((item) => (
                <View key={item.id} className='ingredient-card'>
                  <View className='ingredient-main'>
                    <View className='ingredient-header'>
                      <View className='edit-icon-wrapper' onClick={() => handleEditName(item.id, item.name)}>
                        <Text className='iconfont icon-bianji'></Text>
                      </View>
                      <Text className='ingredient-name'>{item.name}</Text>
                    </View>
                    <View className='ingredient-calories'>
                      <Text className='cal-val'>{Math.max(0, Math.round(item.calorie * (item.ratio / 100)))}</Text>
                      <Text className='cal-unit'>kcal</Text>
                    </View>
                  </View>

                  <View className='ingredient-controls'>
                    {/* 重量调节 */}
                    <View className='weight-control'>
                      <Text className='control-label'>估算重量</Text>
                      <View className='weight-adjuster'>
                        <View className='adjust-btn minus' onClick={() => handleWeightAdjust(item.id, -10)}>
                          -
                        </View>
                        <Text className='weight-display'>{item.weight}g</Text>
                        <View className='adjust-btn plus' onClick={() => handleWeightAdjust(item.id, 10)}>
                          +
                        </View>
                      </View>
                    </View>

                    {/* 比例调节 */}
                    <View className='ratio-control'>
                      <View className='ratio-header'>
                        <Text className='control-label'>实际摄入比例</Text>
                        <Text className='ratio-display'>{item.ratio}%</Text>
                      </View>
                      <Slider
                        className='ratio-slider-modern'
                        value={item.ratio}
                        min={0}
                        max={100}
                        step={5}
                        activeColor='#00bc7d'
                        backgroundColor='#e2e8f0'
                        blockSize={24}
                        blockColor='#ffffff'
                        showValue={false}
                        onChange={(e) => handleRatioAdjust(item.id, e.detail.value)}
                      />
                    </View>

                    <View className='macro-editor'>
                      <View className='macro-editor-grid'>
                        {MACRO_FIELDS.map((field) => {
                          const meta = MACRO_FIELD_META[field]
                          const intakeMacro = item[field] * (item.ratio / 100)
                          return (
                            <View key={`${item.id}-${field}`} className={`macro-editor-item ${meta.className}`}>
                              <View
                                className='macro-editor-chip'
                                onClick={() => handleMacroEdit(item.id, field, item[field])}
                              >
                                <Text className='macro-editor-item-label'>{meta.label}</Text>
                                <Text className='macro-editor-value'>{formatMacroDisplay(intakeMacro)}g</Text>
                              </View>
                            </View>
                          )
                        })}
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* 底部占位 */}
          <View style={{ height: '40rpx' }}></View>
        </View>
      </ScrollView>

      {/* 底部固定操作栏 */}
      <View className='footer-actions'>
        <View className='pba-safe-area'>
          <View className='action-grid'>
            <View className={`primary-btn ${saving ? 'loading' : ''}`} onClick={saving ? undefined : handleConfirmAndShare}>
              {saving ? <View className='btn-spinner' /> : <Text className='btn-text'>确认记录</Text>}
            </View>
          </View>
        </View>
      </View>

      {/* 餐次选择弹窗 */}
      <View className={`meal-selector-overlay ${showMealSelector ? 'visible' : ''}`} onClick={() => setShowMealSelector(false)}>
        <View className='meal-selector-card' onClick={(e) => e.stopPropagation()}>
          <Text className='selector-title'>选择餐次</Text>

          <View className='meal-options-grid'>
            {MEAL_OPTIONS.map((option) => (
              <View
                key={option.value}
                className={`meal-option-item ${selectedMealType === option.value ? 'active' : ''}`}
                onClick={() => setSelectedMealType(option.value)}
              >
                <Text className={`option-icon iconfont ${MEAL_ICONS[option.value]}`}></Text>
                <Text className='option-label'>{option.label}</Text>
              </View>
            ))}
          </View>

          <View className='selector-actions'>
            <View className='cancel-btn' onClick={() => setShowMealSelector(false)}>
              取消
            </View>
            <View className='confirm-btn' onClick={handleConfirmMealType}>
              确认保存
            </View>
          </View>
        </View>
      </View>

      {/* 开发者模式：反馈打点调试面板，仅在真正发请求时展示 */}
      {__ENABLE_DEV_DEBUG_UI__ && ANALYSIS_FEEDBACK_SUBMISSION_ENABLED && (
        <View
          className='feedback-dev-panel'
          style={{
            position: 'fixed',
            right: devFeedbackPanelOpen ? '0' : '24rpx',
            bottom: '180rpx',
            zIndex: 9999,
            maxWidth: devFeedbackPanelOpen ? '560rpx' : 'auto',
            background: 'rgba(255,255,255,0.95)',
            borderRadius: devFeedbackPanelOpen ? '16rpx 0 0 16rpx' : '999rpx',
            boxShadow: '0 4rpx 24rpx rgba(0,0,0,0.15)',
            border: '1rpx solid #e5e7eb',
            padding: devFeedbackPanelOpen ? '16rpx' : '12rpx 20rpx',
          }}
          onClick={() => {
            if (!devFeedbackPanelOpen) setDevFeedbackPanelOpen(true)
          }}
        >
          {!devFeedbackPanelOpen ? (
            <Text style={{ fontSize: '22rpx', color: '#00bc7d', fontWeight: 600 }}>
              反馈 {devFeedbackLogsRef.current.length}
            </Text>
          ) : (
            <View style={{ width: '100%' }}>
              <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12rpx' }}>
                <Text style={{ fontSize: '24rpx', fontWeight: 600, color: '#111827' }}>
                  Feedback 调试日志
                </Text>
                <Text
                  style={{ fontSize: '22rpx', color: '#6b7280', padding: '4rpx 12rpx' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDevFeedbackPanelOpen(false)
                  }}
                >
                  收起
                </Text>
              </View>
              {devFeedbackLogsRef.current.length === 0 ? (
                <Text style={{ fontSize: '22rpx', color: '#6b7280' }}>暂无反馈记录</Text>
              ) : (
                devFeedbackLogsRef.current.map((log, idx) => (
                  <View
                    key={idx}
                    style={{
                      marginBottom: '10rpx',
                      padding: '10rpx',
                      borderRadius: '8rpx',
                      background: '#f3f4f6',
                    }}
                  >
                    <View style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: '22rpx', color: log.disabled ? '#f59e0b' : log.ok ? '#00bc7d' : '#ef4444', fontWeight: 600 }}>
                        {log.type}{log.disabled ? ' [已禁用]' : ''}
                      </Text>
                      <Text style={{ fontSize: '20rpx', color: '#6b7280' }}>
                        {new Date(log.at).toLocaleTimeString()}
                      </Text>
                    </View>
                    <Text style={{ fontSize: '20rpx', color: '#6b7280', marginTop: '4rpx' }}>
                      state={log.state} · task={log.sourceTaskId?.slice(0, 8) || '-'} · record={log.sourceRecordId?.slice(0, 8) || '-'}
                    </Text>
                    {!log.ok && log.err && (
                      <Text style={{ fontSize: '20rpx', color: '#ef4444', marginTop: '4rpx' }}>{log.err}</Text>
                    )}
                  </View>
                ))
              )}
            </View>
          )}
        </View>
      )}
    </View>
  )
}

export default withAuth(ResultTextPage)
