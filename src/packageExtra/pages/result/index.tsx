import { View, Text, Image, ScrollView, Slider, Swiper, SwiperItem, Input, Textarea } from '@tarojs/components'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  AnalyzeResponse,
  FoodItem,
  MealType,
  type SaveFoodRecordRequest,
  saveFoodRecord,
  getAccessToken,
  createUserRecipe,
  updateAnalysisTaskResult,
  submitAnalyzeTask,
  submitTextAnalyzeTask,
  continuePrecisionSession,
  type ExecutionMode,
  type AnalyzeRecognitionOutcome,
  type AllowedFoodCategory,
  type PrecisionReferenceObjectInput
} from '../../../utils/api'
import { normalizeAvailableExecutionMode } from '../../../utils/execution-mode'
import { foodRecordFromSavePayload } from '../../../utils/dev-record-preview'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import { withAuth } from '../../../utils/withAuth'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../../../utils/home-dashboard-local-cache'
import { formatDateKey } from '../../../pages/index/utils/helpers'
import { extraPkgUrl } from '../../../utils/subpackage-extra'

import './index.scss'


const FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY = 'foodLibraryQuickUploadDraft'
/** 按 analyzeSourceTaskId 记录已保存的 food record id，用于返回结果页时显示「查看结果」 */
const ANALYZE_COMMITTED_SESSION_KEY = 'analyze_committed_session'

function isAnalyzeSessionCommitted(): boolean {
  try {
    const tid = Taro.getStorageSync('analyzeSourceTaskId')
    if (!tid) return false
    const raw = Taro.getStorageSync(ANALYZE_COMMITTED_SESSION_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, { record_id?: string }>) : {}
    return Boolean(map[String(tid)]?.record_id)
  } catch {
    return false
  }
}

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'morning_snack' as const, label: '早加餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'afternoon_snack' as const, label: '午加餐' },
  { value: 'dinner' as const, label: '晚餐' },
  { value: 'evening_snack' as const, label: '晚加餐' },
]
type SelectableMealType = (typeof MEAL_OPTIONS)[number]['value']

const normalizeExecutionMode = (value: unknown): ExecutionMode => (
  value === 'strict' ? 'strict' : 'standard'
)

const normalizeTaskType = (value: unknown): 'food' | 'food_text' => (
  value === 'food_text' ? 'food_text' : 'food'
)

const normalizeRecognitionOutcome = (value: unknown): AnalyzeRecognitionOutcome => (
  value === 'soft_reject' || value === 'hard_reject' ? value : 'ok'
)

const normalizeAllowedFoodCategory = (value: unknown): AllowedFoodCategory => (
  value === 'carb' || value === 'lean_protein' ? value : 'unknown'
)

const FOOD_CATEGORY_LABEL: Record<AllowedFoodCategory, string> = {
  carb: '单个碳水',
  lean_protein: '单个瘦肉',
  unknown: '混合/其他'
}

const PRECISION_REFERENCE_PRESETS = [
  { value: 'chopsticks', label: '筷子', dimensions: { length: 240, width: 7, height: 7 } },
  { value: 'spoon', label: '勺子', dimensions: { length: 170, width: 40, height: 15 } },
  { value: 'bank_card', label: '银行卡', dimensions: { length: 85.6, width: 54, height: 0.8 } },
  { value: 'custom', label: '自定义', dimensions: {} },
]

const RECOGNITION_OUTCOME_META: Record<AnalyzeRecognitionOutcome, { title: string; desc: string }> = {
  ok: {
    title: '符合精准模式',
    desc: '当前主体不多且边界清楚，可作为本次分项执行的参考。'
  },
  soft_reject: {
    title: '建议重拍',
    desc: '主体大致可识别，但边界或参照物还不够理想，补拍后会更稳。'
  },
  hard_reject: {
    title: '建议拆开拍',
    desc: '这餐主体太多、遮挡太重或边界不清，不建议一次估完整餐。'
  }
}

const MEAL_ICONS = {
  breakfast: 'icon-zaocan',
  morning_snack: 'icon-lingshi',
  lunch: 'icon-wucan',
  afternoon_snack: 'icon-lingshi',
  dinner: 'icon-wancan',
  evening_snack: 'icon-lingshi',
}

const toSelectableMealType = (value: unknown): SelectableMealType | undefined => {
  if (value === 'snack') return 'afternoon_snack'
  const hit = MEAL_OPTIONS.find((o) => o.value === value)
  return hit?.value
}

const getSavedSelectableMealType = (): SelectableMealType | undefined => {
  const savedMealType = Taro.getStorageSync('analyzeMealType')
  return toSelectableMealType(savedMealType)
}

// 移除未使用的 CONTEXT_STATE_OPTIONS


interface NutritionItem {
  id: number
  sourceItemId?: number
  sourceName?: string
  name: string
  weight: number // 当前重量（用户可调节）
  originalWeight: number // AI 初始估算重量（用于标记样本时计算偏差）
  calorie: number // 基于 weight 的总热量
  intake: number // 实际摄入量 = weight × ratio
  ratio: number // 摄入比例（0-100%，独立调节）
  protein: number
  carbs: number
  fat: number
}

type MacroField = 'protein' | 'carbs' | 'fat'

const MACRO_FIELDS: MacroField[] = ['protein', 'carbs', 'fat']

const MACRO_FIELD_META: Record<MacroField, { label: string; className: string }> = {
  protein: { label: '蛋白质', className: 'protein' },
  carbs: { label: '碳水', className: 'carbs' },
  fat: { label: '脂肪', className: 'fat' }
}

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const formatMacroDisplay = (value: number) => roundToSingleDecimal(value).toFixed(1)

const calculateCaloriesFromMacros = (protein: number, carbs: number, fat: number) => (
  roundToSingleDecimal(protein) * 4 + roundToSingleDecimal(carbs) * 4 + roundToSingleDecimal(fat) * 9
)

const normalizeFoodNameForCorrection = (value: unknown) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]【】,，。./\\\-_:：;；·]/g, '')
)

/** 结果页头图：上滑时在区间内高度收缩；左右不留 margin（全宽铺满） */
const RESULT_HERO_MAX_RPX = 700
const RESULT_HERO_MIN_RPX = 200
/** 纵向滑动多少 px 内完成收缩（与 scrollTop 同单位） */
const RESULT_HERO_SHRINK_SCROLL_PX = 420
/** 初始圆角（rpx），随上滑收至 0 */
const RESULT_HERO_INNER_RADIUS_MAX_RPX = 24

const normalizePrecisionStringList = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
)


function ResultPage() {
  const [taskType, setTaskType] = useState<'food' | 'food_text'>('food')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imagePath, setImagePath] = useState<string>('') // Keep for compatibility/fallback logic
  const [totalWeight, setTotalWeight] = useState(0)
  const [nutritionItems, setNutritionItems] = useState<NutritionItem[]>([])
  const [nutritionStats, setNutritionStats] = useState({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  })
  const [healthAdvice, setHealthAdvice] = useState('')
  const [description, setDescription] = useState('')
  const [pfcRatioComment, setPfcRatioComment] = useState<string | null>(null)
  const [absorptionNotes, setAbsorptionNotes] = useState<string | null>(null)
  const [contextAdvice, setContextAdvice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** 当前识别会话是否已保存为饮食记录（可跳转详情，不再重复写入/发动态） */
  const [committedRecordId, setCommittedRecordId] = useState<string | null>(null)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [recognitionOutcome, setRecognitionOutcome] = useState<AnalyzeRecognitionOutcome>('ok')
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [retakeGuidance, setRetakeGuidance] = useState<string[]>([])
  const [allowedFoodCategory, setAllowedFoodCategory] = useState<AllowedFoodCategory>('unknown')
  const [followupQuestions, setFollowupQuestions] = useState<string[]>([])
  const [precisionSessionId, setPrecisionSessionId] = useState('')
  const [precisionStatus, setPrecisionStatus] = useState<string>('')
  const [pendingRequirements, setPendingRequirements] = useState<string[]>([])
  const [retakeInstructions, setRetakeInstructions] = useState<string[]>([])
  const [referenceObjectNeeded, setReferenceObjectNeeded] = useState(false)
  const [referenceObjectSuggestions, setReferenceObjectSuggestions] = useState<string[]>([])
  const [detectedItemsSummary, setDetectedItemsSummary] = useState<string[]>([])
  const [splitStrategy, setSplitStrategy] = useState('')
  const [uncertaintyNotes, setUncertaintyNotes] = useState<string[]>([])
  const [precisionFollowupText, setPrecisionFollowupText] = useState('')
  const [continuingPrecision, setContinuingPrecision] = useState(false)
  const [precisionReferencePreset, setPrecisionReferencePreset] = useState('chopsticks')
  const [precisionReferenceName, setPrecisionReferenceName] = useState('筷子')
  const [precisionReferenceLength, setPrecisionReferenceLength] = useState('240')
  const [precisionReferenceWidth, setPrecisionReferenceWidth] = useState('7')
  const [precisionReferenceHeight, setPrecisionReferenceHeight] = useState('7')
  const [precisionReferencePlacement, setPrecisionReferencePlacement] = useState('')

  // 餐次选择弹窗状态
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>(
    () => getSavedSelectableMealType() ?? inferDefaultMealTypeFromLocalTime()
  )

  // 二次纠错抽屉状态
  const [showCorrectionDrawer, setShowCorrectionDrawer] = useState(false)
  const [correctionItems, setCorrectionItems] = useState<NutritionItem[]>([])
  const [additionalContext, setAdditionalContext] = useState('')
  const [isResubmitting, setIsResubmitting] = useState(false)

  /** 驱动头图收缩：与 ScrollView 的 scrollTop 同步 */
  const [resultScrollTop, setResultScrollTop] = useState(0)
  const resultScrollRafRef = useRef<number | null>(null)
  const pendingResultScrollTopRef = useRef(0)

  const handleResultScroll = useCallback((e: { detail?: { scrollTop?: number } }) => {
    const st = typeof e.detail?.scrollTop === 'number' ? Math.max(0, e.detail.scrollTop) : 0
    pendingResultScrollTopRef.current = st
    if (resultScrollRafRef.current != null) return
    resultScrollRafRef.current = requestAnimationFrame(() => {
      resultScrollRafRef.current = null
      setResultScrollTop(pendingResultScrollTopRef.current)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (resultScrollRafRef.current != null) {
        cancelAnimationFrame(resultScrollRafRef.current)
      }
    }
  }, [])

  /** 上滑进度 0~1：驱动头图高度与内层圆角 */
  const resultHeroShrinkT = useMemo(
    () => Math.min(1, resultScrollTop / RESULT_HERO_SHRINK_SCROLL_PX),
    [resultScrollTop]
  )

  const resultHeroRpx = useMemo(
    () => RESULT_HERO_MAX_RPX - (RESULT_HERO_MAX_RPX - RESULT_HERO_MIN_RPX) * resultHeroShrinkT,
    [resultHeroShrinkT]
  )

  const resultHeroInnerRadiusRpx = useMemo(
    () => RESULT_HERO_INNER_RADIUS_MAX_RPX * (1 - resultHeroShrinkT),
    [resultHeroShrinkT]
  )

  /** 内容区起点 = 头图底 − 40rpx */
  const resultScrollPaddingTopRpx = resultHeroRpx - 40

  const openQuickUpload = () => {
    const draftImageUrls = (imagePaths.length > 0 ? imagePaths : (imagePath ? [imagePath] : []))
      .map((path) => `${path || ''}`.trim())
      .filter(Boolean)

    const draft = {
      imageUrls: draftImageUrls,
      description: description || '',
      insight: healthAdvice || '',
      totalCalories: nutritionStats.calories,
      totalProtein: nutritionStats.protein,
      totalCarbs: nutritionStats.carbs,
      totalFat: nutritionStats.fat,
      items: nutritionItems.map((item) => ({
        name: item.name,
        weight: item.weight,
        nutrients: {
          calories: item.calorie,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: 0,
          sugar: 0
        }
      }))
    }

    Taro.setStorageSync(FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY, draft)
    Taro.navigateTo({
      url: `${extraPkgUrl('/pages/food-library-share/index')}?quick_upload=1`
    })
  }

  // 将API返回的数据转换为页面需要的格式（保留 originalWeight 用于标记样本时计算偏差）
  const convertApiDataToItems = (items: FoodItem[]): NutritionItem[] => {
    return items.map((item, index) => {
      const aiWeight = item.originalWeightGrams ?? item.estimatedWeightGrams
      const itemId = item.itemId ?? (index + 1)
      return {
        id: itemId,
        sourceItemId: itemId,
        sourceName: item.name,
        name: item.name,
        weight: item.estimatedWeightGrams,
        originalWeight: aiWeight,
        calorie: item.nutrients.calories,
        intake: item.estimatedWeightGrams,
        ratio: 100,
        protein: item.nutrients.protein,
        carbs: item.nutrients.carbs,
        fat: item.nutrients.fat
      }
    })
  }

  // 计算总营养统计
  const calculateNutritionStats = (items: NutritionItem[]) => {
    const stats = items.reduce(
      (acc, item) => {
        // 使用 ratio 来计算实际摄入的营养
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

    // 计算总摄入重量
    const total = items.reduce((sum, item) => sum + item.intake, 0)
    setTotalWeight(Math.round(total))
  }

  const hydrateCommittedRecord = useCallback(() => {
    try {
      const tid = Taro.getStorageSync('analyzeSourceTaskId')
      if (!tid) {
        setCommittedRecordId(null)
        return
      }
      const raw = Taro.getStorageSync(ANALYZE_COMMITTED_SESSION_KEY)
      const map = raw ? (JSON.parse(raw) as Record<string, { record_id?: string }>) : {}
      const rec = map[String(tid)]
      if (rec?.record_id) {
        setCommittedRecordId(String(rec.record_id))
      } else {
        setCommittedRecordId(null)
      }
    } catch {
      setCommittedRecordId(null)
    }
  }, [])

  useDidShow(() => {
    hydrateCommittedRecord()
  })

  useEffect(() => {
    // 获取传递的图片路径和分析结果
    try {
      const storedPaths = Taro.getStorageSync('analyzeImagePaths')
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      const storedMode = Taro.getStorageSync('analyzeExecutionMode')
      const storedTaskType = normalizeTaskType(Taro.getStorageSync('analyzeTaskType'))
      const storedPrecisionSessionId = String(Taro.getStorageSync('analyzePrecisionSessionId') || '').trim()
      setTaskType(storedTaskType)
      setExecutionMode(normalizeExecutionMode(storedMode))
      setPrecisionSessionId(storedPrecisionSessionId)

      if (storedTaskType === 'food_text') {
        setImagePaths([])
        setImagePath('')
        Taro.removeStorageSync('analyzeImagePaths')
        Taro.removeStorageSync('analyzeImagePath')
      } else if (storedPaths && Array.isArray(storedPaths) && storedPaths.length > 0) {
        setImagePaths(storedPaths)
        setImagePath(storedPaths[0]) // Primary for compatibility
      } else if (storedPath) {
        setImagePath(storedPath)
        setImagePaths([storedPath])
      }

      const storedResult = Taro.getStorageSync('analyzeResult')
      if (storedResult) {
        const result: AnalyzeResponse = JSON.parse(storedResult)
        setDescription(result.description || '')
        setHealthAdvice(result.insight || '保持健康饮食！')
        setPfcRatioComment(result.pfc_ratio_comment ?? null)
        setAbsorptionNotes(result.absorption_notes ?? null)
        setContextAdvice(result.context_advice ?? null)
        setRecognitionOutcome(normalizeRecognitionOutcome(result.recognitionOutcome))
        setRejectionReason(result.rejectionReason?.trim() || null)
        setRetakeGuidance(Array.isArray(result.retakeGuidance) ? result.retakeGuidance.filter(Boolean) : [])
        setAllowedFoodCategory(normalizeAllowedFoodCategory(result.allowedFoodCategory))
        setFollowupQuestions(Array.isArray(result.followupQuestions) ? result.followupQuestions.filter(Boolean) : [])
        setPrecisionSessionId(result.precisionSessionId || storedPrecisionSessionId)
        setPrecisionStatus(result.precisionStatus || '')
        setPendingRequirements(normalizePrecisionStringList(result.pendingRequirements))
        setRetakeInstructions(normalizePrecisionStringList(result.retakeInstructions))
        setReferenceObjectNeeded(Boolean(result.referenceObjectNeeded))
        setReferenceObjectSuggestions(normalizePrecisionStringList(result.referenceObjectSuggestions))
        setDetectedItemsSummary(normalizePrecisionStringList(result.detectedItemsSummary))
        setSplitStrategy(String(result.splitStrategy || ''))
        setUncertaintyNotes(normalizePrecisionStringList(result.uncertaintyNotes))
        const items = convertApiDataToItems(result.items)
        setNutritionItems(items)
        calculateNutritionStats(items)
        hydrateCommittedRecord()
      } else {
        Taro.showModal({
          title: '提示',
          content: '未找到分析结果，请重新分析',
          showCancel: false,
          confirmText: '确定',
          success: () => {
            Taro.navigateBack()
          }
        })
      }
    } catch (error) {
      console.error('获取数据失败:', error)
      Taro.showToast({
        title: '数据加载失败',
        icon: 'none'
      })
    }
  }, [hydrateCommittedRecord])

  const handleDefaultModeEdit = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile-edit/index') })
  }

  const isStrictMode = executionMode === 'strict'
  const isStrictHardReject = isStrictMode && recognitionOutcome === 'hard_reject'
  const isStrictSoftReject = isStrictMode && recognitionOutcome === 'soft_reject'
  const shouldShowRecognitionCard = isStrictMode
  const shouldShowFollowupCard = taskType === 'food_text' && followupQuestions.length > 0
  const hasUploadableImage = taskType === 'food' && (imagePaths.length > 0 || !!imagePath)
  const shouldShowPrecisionContinueCard = Boolean(
    precisionSessionId && precisionStatus && precisionStatus !== 'done'
  )

  const handlePrecisionReferencePresetSelect = (value: string) => {
    setPrecisionReferencePreset(value)
    const target = PRECISION_REFERENCE_PRESETS.find(item => item.value === value)
    if (!target) return
    setPrecisionReferenceName(target.label)
    setPrecisionReferenceLength(target.dimensions.length != null ? String(target.dimensions.length) : '')
    setPrecisionReferenceWidth(target.dimensions.width != null ? String(target.dimensions.width) : '')
    setPrecisionReferenceHeight(target.dimensions.height != null ? String(target.dimensions.height) : '')
  }

  const buildPrecisionReferenceObjects = (): PrecisionReferenceObjectInput[] => {
    const name = precisionReferenceName.trim()
    if (!name) return []
    const length = Number(precisionReferenceLength)
    const width = Number(precisionReferenceWidth)
    const height = Number(precisionReferenceHeight)
    return [{
      reference_type: precisionReferencePreset === 'custom' ? 'custom' : 'preset',
      reference_name: name,
      dimensions_mm: {
        ...(Number.isFinite(length) && length > 0 ? { length } : {}),
        ...(Number.isFinite(width) && width > 0 ? { width } : {}),
        ...(Number.isFinite(height) && height > 0 ? { height } : {}),
      },
      placement_note: precisionReferencePlacement.trim() || undefined,
    }]
  }

  const handleContinuePrecision = async () => {
    if (!precisionSessionId) return
    setContinuingPrecision(true)
    Taro.showLoading({ title: '继续精准估计...', mask: true })
    try {
      const savedMealType = Taro.getStorageSync('analyzeMealType') as MealType | undefined
      const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
      const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')
      const payload = {
        source_type: taskType === 'food_text' ? 'text' as const : 'image' as const,
        text: taskType === 'food_text' ? String(Taro.getStorageSync('analyzeTextInput') || '').trim() || description : undefined,
        additionalContext: precisionFollowupText.trim() || undefined,
        meal_type: savedMealType,
        diet_goal: savedDietGoal,
        activity_timing: savedActivityTiming,
        reference_objects: buildPrecisionReferenceObjects(),
      }
      const { task_id } = await continuePrecisionSession(precisionSessionId, payload)
      Taro.hideLoading()
      Taro.redirectTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${task_id}&task_type=${taskType}&execution_mode=strict`
      })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e?.message || '继续精准模式失败', icon: 'none' })
    } finally {
      setContinuingPrecision(false)
    }
  }

  const handleRetakePrecision = () => {
    if (!precisionSessionId) return
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/analyze/index')}?precision_session_id=${precisionSessionId}` })
  }

  /** 概览区三色柱高度：按该成分供能在「蛋白+碳水+脂肪」总供能中的占比（4/4/9 kcal·g⁻¹） */
  const macroEnergyBarPercents = useMemo(() => {
    const proteinKcal = nutritionStats.protein * 4
    const carbsKcal = nutritionStats.carbs * 4
    const fatKcal = nutritionStats.fat * 9
    const total = proteinKcal + carbsKcal + fatKcal
    if (total <= 0) {
      return { protein: 0, carbs: 0, fat: 0 }
    }
    return {
      protein: (proteinKcal / total) * 100,
      carbs: (carbsKcal / total) * 100,
      fat: (fatKcal / total) * 100,
    }
  }, [nutritionStats.protein, nutritionStats.carbs, nutritionStats.fat])

  /** 与 analyze 页「模拟进入结果页」等调试文案区分，仅展示面向用户的最终分析 */
  const isDebugInsightText = (s: string | null | undefined): boolean => {
    if (s == null || !String(s).trim()) return false
    const t = String(s).trim()
    return /【调试】|调试预览|调试随机|随机样本/.test(t)
  }

  /** 与加载逻辑一致：接口空串时用默认句，避免首屏 healthAdvice 为空导致整块 AI 分析被隐藏 */
  const resolvedHealthInsight = (healthAdvice?.trim() || '保持健康饮食！')

  const showInsightDescription = Boolean(description?.trim()) && !isDebugInsightText(description)
  const showInsightHealth =
    !isDebugInsightText(healthAdvice) && !isDebugInsightText(resolvedHealthInsight)
  const showInsightPfc = Boolean(pfcRatioComment?.trim()) && !isDebugInsightText(pfcRatioComment)
  const showInsightAbsorption = Boolean(absorptionNotes?.trim()) && !isDebugInsightText(absorptionNotes)
  const showInsightContext = Boolean(contextAdvice?.trim()) && !isDebugInsightText(contextAdvice)
  const showInsightCard =
    showInsightDescription ||
    showInsightHealth ||
    showInsightPfc ||
    showInsightAbsorption ||
    showInsightContext

  // 调节食物估算重量（+- 按钮）
  const handleWeightAdjust = (id: number, delta: number) => {
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id === id) {
          // 调节的是 weight（AI 估算的食物总重量）
          const newWeight = Math.max(10, item.weight + delta) // 最小 10g
          const weightScale = item.weight > 0 ? newWeight / item.weight : 1
          const nextProtein = item.protein * weightScale
          const nextCarbs = item.carbs * weightScale
          const nextFat = item.fat * weightScale
          // ratio 保持不变，重新计算 intake
          const newIntake = Math.round(newWeight * (item.ratio / 100))
          return {
            ...item,
            weight: newWeight,
            intake: newIntake,
            // 重量变化时，同步更新该食物对应的营养值
            calorie: calculateCaloriesFromMacros(nextProtein, nextCarbs, nextFat),
            protein: nextProtein,
            carbs: nextCarbs,
            fat: nextFat
            // ratio 不变
          }
        }
        return item
      })

      // 重新计算营养统计
      calculateNutritionStats(updatedItems)

      return updatedItems
    })
  }

  const updateMacroField = (
    id: number,
    field: MacroField,
    nextValue: number | ((currentValue: number) => number)
  ) => {
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id !== id) return item
        const resolvedValue = typeof nextValue === 'function' ? nextValue(item[field]) : nextValue
        const normalizedValue = Math.max(0, roundToSingleDecimal(resolvedValue))
        const nextItem = {
          ...item,
          [field]: normalizedValue
        } as NutritionItem
        return {
          ...nextItem,
          calorie: calculateCaloriesFromMacros(nextItem.protein, nextItem.carbs, nextItem.fat)
        }
      })

      calculateNutritionStats(updatedItems)
      return updatedItems
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
          Taro.showToast({
            title: '请输入不小于0的数字',
            icon: 'none'
          })
          return
        }

        updateMacroField(id, field, parsed)
      }
    })
  }

  // 调节摄入比例（滑块或其他控件）
  const handleRatioAdjust = (id: number, newRatio: number) => {
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id === id) {
          // 调节的是 ratio（摄入比例）
          const clampedRatio = Math.max(0, Math.min(100, newRatio)) // 0-100%
          // weight 保持不变，重新计算 intake
          const newIntake = Math.round(item.weight * (clampedRatio / 100))
          return {
            ...item,
            ratio: clampedRatio,
            intake: newIntake
            // weight 不变
          }
        }
        return item
      })

      // 重新计算营养统计
      calculateNutritionStats(updatedItems)

      return updatedItems
    })
  }

  // 删除食物项
  const handleDeleteItem = (id: number, name: string) => {
    Taro.showModal({
      title: '删除食物',
      content: `确定要删除「${name}」吗？`,
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        setNutritionItems(items => {
          const updated = items.filter(item => item.id !== id)
          calculateNutritionStats(updated)
          return updated
        })
      }
    })
  }

  // 修改食物名称
  const handleEditName = (id: number, currentName: string) => {
    // @ts-ignore
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
            Taro.showToast({
              title: '名称不能为空',
              icon: 'none'
            })
            return
          }

          // 确认保存修改
          Taro.showModal({
            title: '确认保存',
            content: `确定将食物名称修改为"${newName}"吗？`,
            success: async (confirmRes) => {
              if (confirmRes.confirm) {
                // 1. 更新本地状态
                const updatedItems = nutritionItems.map(item =>
                  item.id === id ? { ...item, name: newName } : item
                )
                setNutritionItems(updatedItems)

                // 2. 尝试同步更新后端 analysis_tasks 记录（如果有 taskId）
                const sourceTaskId = Taro.getStorageSync('analyzeSourceTaskId')
                if (sourceTaskId) {
                  try {
                    Taro.showLoading({ title: '同步中...' })

                    // 构建新的 result 对象（基于当前页面状态）
                    // 注意：后端 updateAnalysisTaskResult 接收整个 result 对象
                    // 我们尽量还原 AnalyzeResponse 的结构
                    const newResult: AnalyzeResponse = {
                      description,
                      insight: healthAdvice,
                      items: updatedItems.map(item => ({
                        name: item.name,
                        estimatedWeightGrams: item.weight,
                        originalWeightGrams: item.originalWeight,
                        nutrients: {
                          calories: item.calorie,
                          protein: item.protein,
                          carbs: item.carbs,
                          fat: item.fat,
                          fiber: 0,
                          sugar: 0
                        }
                      })),
                      pfc_ratio_comment: pfcRatioComment || undefined,
                      absorption_notes: absorptionNotes || undefined,
                      context_advice: contextAdvice || undefined,
                      recognitionOutcome,
                      rejectionReason: rejectionReason || undefined,
                      retakeGuidance: retakeGuidance.length > 0 ? retakeGuidance : undefined,
                      allowedFoodCategory,
                      followupQuestions: followupQuestions.length > 0 ? followupQuestions : undefined,
                    }

                    await updateAnalysisTaskResult(sourceTaskId, newResult)

                    // 同时更新本地缓存的 analyzeResult，以免用户刷新后丢失修改
                    Taro.setStorageSync('analyzeResult', JSON.stringify(newResult))

                    Taro.hideLoading()
                    Taro.showToast({ title: '已更新并同步', icon: 'success' })
                  } catch (error) {
                    console.error('同步更新 analysis_tasks 失败:', error)
                    Taro.hideLoading()
                    // 即使后端同步失败，本地已经修改了，也提示成功但告知同步失败
                    Taro.showToast({ title: '本地已更新(同步失败)', icon: 'none' })
                  }
                } else {
                  // 没有 taskId，仅本地更新
                  Taro.showToast({ title: '已更新', icon: 'success' })
                }
              }
            }
          })
        }
      }
    })
  }

  /** 保存记录：saveOnly=true 仅保存，false 保存后跳详情页 */
  const saveRecord = async (saveOnly: boolean, confirmedMealType?: SelectableMealType) => {
    // 避免用户快速连续点击导致重复保存
    if (saving) return
    // 从缓存获取分析时选择的状态
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
    const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')

    // 确定餐次：优先使用确认过的餐次，否则尝试从缓存读取，最后按当前时间推断
    let mealType = confirmedMealType
    if (!mealType) {
      mealType = toSelectableMealType(savedMealType) || inferDefaultMealTypeFromLocalTime()
    }
    const mealLabel = MEAL_OPTIONS.find((o) => o.value === mealType)?.label || '早餐'

    // 饮食目标和时机，未找到默认无
    const dietGoal = savedDietGoal || 'none'
    const activityTiming = savedActivityTiming || 'none'

    const doSave = async () => {
      if (isAnalyzeSessionCommitted()) {
        Taro.showToast({ title: '该餐已记录', icon: 'none' })
        return
      }
      setSaving(true)
      try {
        // 清除相关缓存
        Taro.removeStorageSync('analyzeMealType')
        Taro.removeStorageSync('analyzeDietGoal')
        Taro.removeStorageSync('analyzeActivityTiming')

        const sourceTaskId = Taro.getStorageSync('analyzeSourceTaskId') || undefined
        const payload: SaveFoodRecordRequest = {
          meal_type: mealType as MealType,
          image_path: hasUploadableImage ? (imagePath || undefined) : undefined,
          image_paths: hasUploadableImage && imagePaths.length > 0 ? imagePaths : undefined,
          description: description || undefined,
          insight: healthAdvice || undefined,
          items: nutritionItems.map((item) => ({
            name: item.name,
            weight: item.weight,
            ratio: item.ratio,
            intake: item.intake,
            nutrients: {
              calories: item.calorie,
              protein: item.protein,
              carbs: item.carbs,
              fat: item.fat,
              fiber: 0,
              sugar: 0
            }
          })),
          total_calories: nutritionStats.calories,
          total_protein: nutritionStats.protein,
          total_carbs: nutritionStats.carbs,
          total_fat: nutritionStats.fat,
          total_weight_grams: totalWeight,
          diet_goal: dietGoal,
          activity_timing: activityTiming,
          pfc_ratio_comment: pfcRatioComment ?? undefined,
          absorption_notes: absorptionNotes ?? undefined,
          context_advice: contextAdvice ?? undefined,
          source_task_id: sourceTaskId
        }

        /** 从记录菜单「模拟分析结果」进入时带 analyzeDebugPreview：不写库，仅预览记录详情（仅 development 构建） */
        const devModeOn =
          __ENABLE_DEV_DEBUG_UI__ && Taro.getStorageSync('analyzeDebugPreview') === '1'
        if (devModeOn) {
          const uid = String(Taro.getStorageSync('user_id') || 'debug-local')
          const record = foodRecordFromSavePayload(payload, uid)
          Taro.setStorageSync('recordDetail', record)
          Taro.removeStorageSync('analyzeDebugPreview')

          if (saveOnly) {
            Taro.showToast({ title: '调试：已跳过接口保存', icon: 'none' })
            setTimeout(() => {
              Taro.navigateBack({ delta: 2 })
            }, 800)
            return
          }

          Taro.showToast({ title: '调试：进入记录详情预览', icon: 'success' })
          setTimeout(() => {
            Taro.navigateTo({ url: extraPkgUrl('/pages/record-detail/index') })
          }, 400)
          return
        }

        const saveResult = await saveFoodRecord(payload)
        try {
          Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
        } catch {
          /* ignore */
        }
        void refreshHomeDashboardLocalSnapshotFromCloud(formatDateKey(new Date()))
        const tidForCommit = sourceTaskId || String(Taro.getStorageSync('analyzeSourceTaskId') || '')
        if (tidForCommit) {
          try {
            const raw = Taro.getStorageSync(ANALYZE_COMMITTED_SESSION_KEY)
            const map = raw ? (JSON.parse(raw) as Record<string, { record_id?: string; at?: number }>) : {}
            map[String(tidForCommit)] = { record_id: saveResult.id, at: Date.now() }
            Taro.setStorageSync(ANALYZE_COMMITTED_SESSION_KEY, JSON.stringify(map))
          } catch (e) {
            console.error('写入已记录会话失败:', e)
          }
        }
        setCommittedRecordId(saveResult.id)

        if (saveOnly) {
          Taro.showToast({
            title: saveResult.already_saved ? '该餐已记录，未重复发布' : '记录成功',
            icon: saveResult.already_saved ? 'none' : 'success',
          })
          setTimeout(() => {
            Taro.navigateBack({ delta: 2 })
          }, 1200)
          return
        }

        Taro.showToast({
          title: saveResult.already_saved ? '该餐已记录，未重复发布' : '记录成功',
          icon: saveResult.already_saved ? 'none' : 'success',
        })
        setTimeout(() => {
          Taro.navigateTo({
            url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(saveResult.id)}`
          })
        }, 500)
      } catch (e: any) {
        Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
      } finally {
        setSaving(false)
      }
    }

    // 如果已经传了 confirmedMealType，说明是经过弹窗确认的，直接保存
    if (confirmedMealType) {
      await doSave()
    } else {
      // 否则走旧的确认流程（防止直接调用时没有确认）
      Taro.showModal({
        title: '确认记录',
        content: `餐次：${mealLabel}\n确定保存当前饮食记录吗？`,
        success: async (res) => {
          if (!res.confirm) return
          await doSave()
        }
      })
    }
  }

  /** 已保存后跳转记录详情（不重复写入、不重复发动态） */
  const handleViewCommittedResult = useCallback(() => {
    try {
      const tid = Taro.getStorageSync('analyzeSourceTaskId')
      const raw = Taro.getStorageSync(ANALYZE_COMMITTED_SESSION_KEY)
      const map = raw ? (JSON.parse(raw) as Record<string, { record_id?: string }>) : {}
      const rid = (tid && map[String(tid)]?.record_id) || committedRecordId
      if (!rid) {
        Taro.showToast({ title: '未找到已保存记录', icon: 'none' })
        return
      }
      Taro.navigateTo({
        url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(String(rid))}`
      })
    } catch {
      Taro.showToast({ title: '无法打开记录', icon: 'none' })
    }
  }, [committedRecordId])

  /** 点击保存按钮：打开餐次选择弹窗 */
  const handleConfirmAndShare = () => {
    if (isAnalyzeSessionCommitted() || committedRecordId) {
      handleViewCommittedResult()
      return
    }
    if (shouldShowPrecisionContinueCard) {
      Taro.showToast({ title: '请先完成精准模式的补充或重拍', icon: 'none' })
      return
    }
    if (isStrictHardReject) {
      Taro.showModal({
        title: '当前结果不建议直接用于精准执行',
        content: `${rejectionReason || '这餐更适合拆开拍后再估。'}\n如果你只是想先记一笔，也可以继续保存。`,
        confirmText: '仍要记录',
        cancelText: '先去拆拍',
        success: (res) => {
          if (!res.confirm) return
          const savedMealType = getSavedSelectableMealType()
          if (savedMealType) {
            saveRecord(false, savedMealType)
            return
          }
          setSelectedMealType(inferDefaultMealTypeFromLocalTime())
          setShowMealSelector(true)
        }
      })
      return
    }
    if (isStrictSoftReject) {
      Taro.showModal({
        title: '本次结果不建议直接用于精准执行',
        content: `${rejectionReason || '当前边界或参照物不够理想，建议补拍后再确认。'}\n如果你只是想先记一笔，也可以继续保存。`,
        confirmText: '仍要记录',
        cancelText: '先去重拍',
        success: (res) => {
          if (!res.confirm) return
          const savedMealType = getSavedSelectableMealType()
          if (savedMealType) {
            saveRecord(false, savedMealType)
            return
          }
          setSelectedMealType(inferDefaultMealTypeFromLocalTime())
          setShowMealSelector(true)
        }
      })
      return
    }
    const savedMealType = getSavedSelectableMealType()
    if (savedMealType) {
      saveRecord(false, savedMealType)
      return
    }
    setSelectedMealType(inferDefaultMealTypeFromLocalTime())
    setShowMealSelector(true)
  }

  const handleOpenLibraryUpload = () => {
    if (shouldShowPrecisionContinueCard) {
      Taro.showToast({ title: '请先完成精准模式的补充或重拍', icon: 'none' })
      return
    }
    if (!hasUploadableImage) {
      Taro.showToast({ title: '当前结果没有可上传的实物图片', icon: 'none' })
      return
    }
    if (isStrictHardReject) {
      Taro.showModal({
        title: '当前结果不建议上传',
        content: rejectionReason || '这餐更适合拆开拍后再上传。',
        showCancel: false,
        confirmText: '我知道了',
      })
      return
    }

    if (isStrictSoftReject) {
      Taro.showModal({
        title: '当前图片条件一般',
        content: `${rejectionReason || '建议补拍后再确认。'}\n如果你确认这次样本也要上传到公共库，可以继续。`,
        confirmText: '继续上传',
        cancelText: '先去重拍',
        success: (res) => {
          if (!res.confirm) return
          openQuickUpload()
        }
      })
      return
    }

    openQuickUpload()
  }

  /** 弹窗确认保存 */
  const handleConfirmMealType = () => {
    setShowMealSelector(false)
    saveRecord(false, selectedMealType)
  }

  // 收藏食物（保存为可复用模板）
  const handleSaveAsRecipe = () => {
    if (shouldShowPrecisionContinueCard) {
      Taro.showToast({ title: '请先完成精准模式的补充或重拍', icon: 'none' })
      return
    }
    if (isStrictHardReject) {
      Taro.showToast({ title: '请先重拍后再收藏', icon: 'none' })
      return
    }
    // 检查登录
    const token = getAccessToken()
    if (!token) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    // 获取餐次信息
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const mealType = toSelectableMealType(savedMealType)

    // 弹窗输入收藏名称
    Taro.showModal({
      title: '收藏食物',
      content: '请输入收藏名称',
      // @ts-ignore
      editable: true,
      // @ts-ignore
      placeholderText: '例如：我的标配减脂早餐',
      success: async (res) => {
        if (res.confirm && (res as any).content) {
          const recipeName = (res as any).content.trim()
          if (!recipeName) {
            Taro.showToast({ title: '请输入食谱名称', icon: 'none' })
            return
          }

          Taro.showLoading({ title: '保存中...', mask: true })

          try {
            // 构建食谱数据
            const recipeItems = nutritionItems.map(nutritionItem => ({
              name: nutritionItem.name,
              weight: nutritionItem.weight,
              ratio: nutritionItem.ratio,
              intake: nutritionItem.intake,
              nutrients: {
                calories: nutritionItem.calorie,
                protein: nutritionItem.protein,
                carbs: nutritionItem.carbs,
                fat: nutritionItem.fat,
                fiber: 0,
                sugar: 0
              }
            }))

            await createUserRecipe({
              recipe_name: recipeName,
              description: description || '',
              image_path: imagePath || undefined,
              items: recipeItems,
              total_calories: nutritionStats.calories,
              total_protein: nutritionStats.protein,
              total_carbs: nutritionStats.carbs,
              total_fat: nutritionStats.fat,
              total_weight_grams: totalWeight,
              meal_type: mealType,
              tags: ['自定义']
            })

            Taro.hideLoading()
            Taro.showModal({
              title: '收藏成功',
              content: '已收藏，可在“我的食谱”中快速复用记录',
              showCancel: false
            })
          } catch (error: any) {
            Taro.hideLoading()
            Taro.showToast({
              title: error.message || '保存失败',
              icon: 'none'
            })
          }
        }
      }
    })
  }

  // --- 二次纠错功能相关方法 ---

  // 打开纠错抽屉
  const openCorrectionDrawer = () => {
    // 拷贝当前营养项到纠错列表
    setCorrectionItems(JSON.parse(JSON.stringify(nutritionItems)))
    setAdditionalContext('')
    setShowCorrectionDrawer(true)
  }

  // 修改纠错项的名称
  const handleCorrectionNameChange = (id: number, val: string) => {
    setCorrectionItems(prev => prev.map(item => item.id === id ? { ...item, name: val } : item))
  }

  // 修改纠错项的重量
  const handleCorrectionWeightChange = (id: number, val: string) => {
    const num = parseInt(val, 10) || 0
    setCorrectionItems(prev => prev.map(item => item.id === id ? { ...item, weight: num } : item))
  }

  // 删除纠错项
  const handleRemoveCorrectionItem = (id: number) => {
    setCorrectionItems(prev => prev.filter(item => item.id !== id))
  }

  // 添加新的空白食物项
  const handleAddCorrectionItem = () => {
    setCorrectionItems(prev => [
      ...prev,
      {
        id: Date.now(), // 临时 ID
        sourceName: '',
        name: '',
        weight: 100, // 默认 100g
        originalWeight: 100,
        calorie: 0,
        intake: 100,
        ratio: 100,
        protein: 0,
        carbs: 0,
        fat: 0
      }
    ])
  }

  // 提交二次纠正重新分析
  const handleSubmitCorrection = async () => {
    const isTextTask = taskType === 'food_text'

    if (!isTextTask && correctionItems.length === 0) {
      Taro.showToast({ title: '食物列表不能为空', icon: 'none' })
      return
    }

    // 检查是否有空名称
    if (!isTextTask && correctionItems.some(item => !item.name.trim())) {
      Taro.showToast({ title: '请填写所有食物名称', icon: 'none' })
      return
    }

    Taro.showModal({
      title: '重新智能分析',
      content: '确定要根据当前的纠正内容重新进行饮食分析吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: async (modalRes) => {
        if (!modalRes.confirm) return

        try {
          setIsResubmitting(true)
          Taro.showLoading({ title: '提交分析中...', mask: true })
          const resolvedCorrectionItems = correctionItems.map((item) => ({ ...item }))
          setCorrectionItems(resolvedCorrectionItems)

          // 2. 获取原请求的基础配置
          const savedMealType = Taro.getStorageSync('analyzeMealType') as MealType | undefined
          const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
          const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')
          const savedExecutionMode = normalizeAvailableExecutionMode(Taro.getStorageSync('analyzeExecutionMode') || executionMode)
          const previousResult: AnalyzeResponse = {
            description,
            insight: healthAdvice,
            items: nutritionItems.map((item) => ({
              itemId: item.sourceItemId ?? item.id,
              name: item.name,
              estimatedWeightGrams: item.weight,
              originalWeightGrams: item.originalWeight,
              nutrients: {
                calories: item.calorie,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
                fiber: 0,
                sugar: 0
              }
            })),
            pfc_ratio_comment: pfcRatioComment || undefined,
            absorption_notes: absorptionNotes || undefined,
            context_advice: contextAdvice || undefined,
            recognitionOutcome,
            rejectionReason: rejectionReason || undefined,
            retakeGuidance: retakeGuidance.length > 0 ? retakeGuidance : undefined,
            allowedFoodCategory,
            followupQuestions: followupQuestions.length > 0 ? followupQuestions : undefined,
          }
          // 构建纠错上下文：用户自由文本 + 用户在列表中的手动修改
          const editDescriptions: string[] = []
          const baselineMap = new Map(nutritionItems.map(ni => [ni.id, ni]))
          for (const item of resolvedCorrectionItems) {
            const baseline = baselineMap.get(item.id)
            if (baseline) {
              const nameChanged = normalizeFoodNameForCorrection(item.name.trim()) !== normalizeFoodNameForCorrection(baseline.name.trim())
              const weightChanged = Math.round(item.weight || 0) !== Math.round(baseline.weight || 0)
              if (nameChanged && weightChanged) {
                editDescriptions.push(`将"${baseline.name}"改为"${item.name.trim()}"，重量改为${Math.round(item.weight)}g`)
              } else if (nameChanged) {
                editDescriptions.push(`将"${baseline.name}"改为"${item.name.trim()}"`)
              } else if (weightChanged) {
                editDescriptions.push(`将"${item.name.trim()}"的重量改为${Math.round(item.weight)}g`)
              }
            } else {
              editDescriptions.push(`新增食物"${item.name.trim()}" ${Math.round(item.weight)}g`)
            }
          }
          for (const baseline of nutritionItems) {
            if (!resolvedCorrectionItems.some(ci => ci.id === baseline.id)) {
              editDescriptions.push(`删除了"${baseline.name}"`)
            }
          }

          const correctionParts: string[] = []
          if (additionalContext.trim()) {
            correctionParts.push(additionalContext.trim())
          }
          if (editDescriptions.length > 0) {
            correctionParts.push(`用户在列表中做了以下修改：${editDescriptions.join('；')}`)
          }
          const finalCorrectionContext = correctionParts.length > 0
            ? correctionParts.join('\n')
            : '用户发起了二次纠错，请结合原始内容重新分析。'

          let taskId = ''

          const shouldResubmitWithImage = taskType === 'food' && (imagePaths.length > 0 || !!imagePath)

          if (shouldResubmitWithImage) {
            const res = await submitAnalyzeTask({
              image_url: imagePaths[0] || imagePath,
              image_urls: imagePaths.length > 0 ? imagePaths : undefined,
              additionalContext: finalCorrectionContext,
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming,
              execution_mode: savedExecutionMode,
              previousResult,
            })
            taskId = res.task_id
          } else {
            const originalText = String(Taro.getStorageSync('analyzeTextInput') || '').trim()
            const previousCorrectionContext = String(Taro.getStorageSync('analyzeTextAdditionalContext') || '').trim()
            const textContextParts = [
              previousCorrectionContext ? `上一轮纠错上下文：${previousCorrectionContext}` : '',
              finalCorrectionContext,
              originalText ? `原始文字记录：${originalText}` : '',
            ].filter(Boolean)
            const currentResultSummary = nutritionItems
              .map((item, idx) => `${idx + 1}. ${item.name} ${item.weight}g`)
              .join('; ')
            const textPayload = originalText || currentResultSummary
            const res = await submitTextAnalyzeTask({
              text: textPayload,
              additionalContext: textContextParts.join('\n'),
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming,
              execution_mode: savedExecutionMode,
              previousResult,
            })
            taskId = res.task_id
          }
          Taro.removeStorageSync('analyzePendingCorrectionTaskId')
          Taro.removeStorageSync('analyzePendingCorrectionItems')

          Taro.hideLoading()
          setShowCorrectionDrawer(false)

          // 4. 跳转到 loading 页面重新走解析流程
          const nextTaskType = shouldResubmitWithImage ? 'food_image' : 'food_text'
          if (!shouldResubmitWithImage) {
            Taro.removeStorageSync('analyzeImagePath')
            Taro.removeStorageSync('analyzeImagePaths')
          }
          Taro.navigateTo({
            url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${taskId}&task_type=${nextTaskType}&execution_mode=${savedExecutionMode}`
          })

        } catch (e: any) {
          Taro.hideLoading()
          Taro.showToast({ title: e.message || '重新分析失败', icon: 'none' })
        } finally {
          setIsResubmitting(false)
        }
      }
    })
  }

  // 预览大图
  const handlePreviewImage = (current: string) => {
    if (imagePaths.length > 0) {
      Taro.previewImage({
        current,
        urls: imagePaths
      })
    }
  }

  return (
    <View className='result-page'>
      {/* 固定头图：不随列表平移；上滑时高度缩小，内层始终全宽无左右 margin */}
      <View className='scanner-hero-section' style={{ height: `${resultHeroRpx}rpx` }}>
        <View
          className='scanner-hero-inner'
          style={{
            borderRadius: `${resultHeroInnerRadiusRpx}rpx`
          }}
        >
          {imagePaths.length > 0 ? (
            <Swiper
              className='scanner-hero-swiper'
              circular
              indicatorDots={false}
              onChange={(e) => setCurrentImageIndex(e.detail.current)}
              current={currentImageIndex}
            >
              {imagePaths.map((path, index) => (
                <SwiperItem key={index} className='scanner-hero-swiper-item'>
                  <Image
                    src={path}
                    mode='aspectFill'
                    className='scanner-hero-image'
                    onClick={() => handlePreviewImage(path)}
                  />
                </SwiperItem>
              ))}
            </Swiper>
          ) : (
            <View className='scanner-hero-placeholder'>
              <View className='placeholder-icon-wrap'>
                <Text className='iconfont icon-shiwu' style={{ fontSize: '72rpx', color: '#00bc7d' }} />
              </View>
              <Text className='placeholder-text'>文字记录，未提供实物照片</Text>
            </View>
          )}
          <View className='scanner-hero-gradient' />
          {imagePaths.length > 1 && (
            <View className='image-counter'>
              <Text className='counter-text'>{currentImageIndex + 1}/{imagePaths.length}</Text>
            </View>
          )}
        </View>
      </View>

      {/*
        iOS 微信小程序：scroll-view 上直接设 padding、或在 scroll-view 内嵌套 position:fixed，
        容易导致内容区高度计算异常出现大面积空白。顶部留白改为内层 View；底栏移出 scroll-view。
      */}
      <ScrollView
        className='result-scroll'
        scrollY
        scrollWithAnimation={false}
        enhanced={false}
        showScrollbar={false}
        onScroll={handleResultScroll}
      >
        <View
          className='result-scroll-inner'
          style={{ paddingTop: `${resultScrollPaddingTopRpx}rpx` }}
        >
        <View className='content-container'>
          <View className='execution-mode-row'>
            <View className='execution-mode-left'>
              <View className={`execution-mode-tag ${executionMode}`}>
                <Text className='execution-mode-tag-text'>
                  {executionMode === 'strict' ? '精准' : '标准'}
                </Text>
              </View>
              <Text className='execution-mode-default-link' onClick={handleDefaultModeEdit}>
                设为默认
              </Text>
            </View>
            {hasUploadableImage ? (
              <View
                className={`library-upload-entry library-upload-entry--mode-row ${saving ? 'disabled' : ''}`}
                onClick={saving ? undefined : handleOpenLibraryUpload}
              >
                <Text className='library-upload-text'>上传公共库</Text>
                <Text className='library-upload-arrow'>›</Text>
              </View>
            ) : null}
          </View>

          {shouldShowRecognitionCard && (
            <View className={`recognition-status-card outcome-${recognitionOutcome}`}>
              <View className='recognition-status-header'>
                <View className='recognition-status-title-wrap'>
                  <Text className='recognition-status-label'>精准模式判定</Text>
                  <Text className='recognition-status-title'>{RECOGNITION_OUTCOME_META[recognitionOutcome].title}</Text>
                </View>
                <View className={`recognition-chip chip-${recognitionOutcome}`}>
                  <Text className='recognition-chip-text'>{FOOD_CATEGORY_LABEL[allowedFoodCategory]}</Text>
                </View>
              </View>
              <Text className='recognition-status-desc'>{RECOGNITION_OUTCOME_META[recognitionOutcome].desc}</Text>
              {rejectionReason && (
                <Text className='recognition-reason'>{rejectionReason}</Text>
              )}
              {retakeGuidance.length > 0 && (
                <View className='recognition-guidance-list'>
                  {retakeGuidance.map((tip, idx) => (
                    <View key={`${tip}-${idx}`} className='recognition-guidance-item'>
                      <Text className='recognition-guidance-dot'>•</Text>
                      <Text className='recognition-guidance-text'>{tip}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {shouldShowFollowupCard && (
            <View className='followup-question-card'>
              <View className='followup-question-header'>
                <View className='followup-question-title-wrap'>
                  <Text className='followup-question-label'>还需要你补充的信息</Text>
                  <Text className='followup-question-title'>补充后再分析会更接近精准模式</Text>
                </View>
                <Text className='followup-question-action' onClick={openCorrectionDrawer}>去补充</Text>
              </View>
              <Text className='followup-question-desc'>
                当前结果先给你一个初步估算；如果你愿意继续补充下面这些信息，再点“重新智能分析”会更准确。
              </Text>
              <View className='followup-question-list'>
                {followupQuestions.map((question, idx) => (
                  <View key={`${question}-${idx}`} className='followup-question-item'>
                    <Text className='followup-question-dot'>{idx + 1}.</Text>
                    <Text className='followup-question-text'>{question}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {shouldShowPrecisionContinueCard && (
            <View className='precision-continue-card'>
              <View className='followup-question-header'>
                <View className='followup-question-title-wrap'>
                  <Text className='followup-question-label'>精准模式下一步</Text>
                  <Text className='followup-question-title'>
                    {precisionStatus === 'needs_retake' ? '这轮建议先重拍再继续' : '这轮还需要你补充更多信息'}
                  </Text>
                </View>
              </View>
              {detectedItemsSummary.length > 0 && (
                <Text className='followup-question-desc'>
                  当前识别到的主体：{detectedItemsSummary.join('、')}
                </Text>
              )}
              {pendingRequirements.length > 0 && (
                <Text className='followup-question-desc'>
                  待补充：{pendingRequirements.join('、')}
                </Text>
              )}
              {referenceObjectNeeded && (
                <Text className='followup-question-desc'>
                  当前建议补一个参考物，帮助后续按比例尺继续估重。
                </Text>
              )}
              {referenceObjectSuggestions.length > 0 && (
                <Text className='followup-question-desc'>
                  可选参考物：{referenceObjectSuggestions.join('、')}
                </Text>
              )}
              {retakeInstructions.length > 0 && (
                <View className='followup-question-list'>
                  {retakeInstructions.map((tip, idx) => (
                    <View key={`${tip}-${idx}`} className='followup-question-item'>
                      <Text className='followup-question-dot'>{idx + 1}.</Text>
                      <Text className='followup-question-text'>{tip}</Text>
                    </View>
                  ))}
                </View>
              )}
              {followupQuestions.length > 0 && (
                <View className='followup-question-list'>
                  {followupQuestions.map((question, idx) => (
                    <View key={`${question}-${idx}`} className='followup-question-item'>
                      <Text className='followup-question-dot'>{idx + 1}.</Text>
                      <Text className='followup-question-text'>{question}</Text>
                    </View>
                  ))}
                </View>
              )}
              {uncertaintyNotes.length > 0 && (
                <View className='followup-question-list'>
                  {uncertaintyNotes.map((note, idx) => (
                    <View key={`${note}-${idx}`} className='followup-question-item'>
                      <Text className='followup-question-dot'>•</Text>
                      <Text className='followup-question-text'>{note}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View className='additional-context-wrapper'>
                <View className='context-label'>
                  <Text className='iconfont icon-jishiben'></Text>
                  <Text>补充说明</Text>
                </View>
                <Textarea
                  className='context-textarea'
                  placeholder='例如：米饭大约 2 两；鸡腿已去骨；参考物和食物在同一平面'
                  value={precisionFollowupText}
                  onInput={(e: any) => setPrecisionFollowupText(e.detail.value)}
                  maxlength={200}
                  autoHeight
                />
              </View>

              <View className='precision-reference-block'>
                <Text className='insight-label'>参考物</Text>
                <View className='state-options'>
                  {PRECISION_REFERENCE_PRESETS.map((preset) => (
                    <View
                      key={preset.value}
                      className={`state-option ${precisionReferencePreset === preset.value ? 'active' : ''}`}
                      onClick={() => handlePrecisionReferencePresetSelect(preset.value)}
                    >
                      <Text className='state-label'>{preset.label}</Text>
                    </View>
                  ))}
                </View>
                <View className='correction-row'>
                  <View className='correction-inputs'>
                    <Input
                      className='correction-input name-input'
                      value={precisionReferenceName}
                      placeholder='参考物名称'
                      onInput={(e: any) => setPrecisionReferenceName(e.detail.value)}
                    />
                    <View className='weight-input-wrapper'>
                      <Input
                        className='correction-input weight-input'
                        type='digit'
                        value={precisionReferenceLength}
                        placeholder='长'
                        onInput={(e: any) => setPrecisionReferenceLength(e.detail.value)}
                      />
                      <Text className='weight-unit'>mm</Text>
                    </View>
                    <View className='weight-input-wrapper'>
                      <Input
                        className='correction-input weight-input'
                        type='digit'
                        value={precisionReferenceWidth}
                        placeholder='宽'
                        onInput={(e: any) => setPrecisionReferenceWidth(e.detail.value)}
                      />
                      <Text className='weight-unit'>mm</Text>
                    </View>
                    <View className='weight-input-wrapper'>
                      <Input
                        className='correction-input weight-input'
                        type='digit'
                        value={precisionReferenceHeight}
                        placeholder='高'
                        onInput={(e: any) => setPrecisionReferenceHeight(e.detail.value)}
                      />
                      <Text className='weight-unit'>mm</Text>
                    </View>
                  </View>
                </View>
                <Textarea
                  className='context-textarea'
                  placeholder='摆放说明，例如：和米饭在同一平面，放在盘子右边'
                  value={precisionReferencePlacement}
                  onInput={(e: any) => setPrecisionReferencePlacement(e.detail.value)}
                  maxlength={100}
                  autoHeight
                />
              </View>

              <View className='precision-continue-actions'>
                <View
                  className={`secondary-btn ${continuingPrecision ? 'disabled' : ''}`}
                  onClick={continuingPrecision ? undefined : handleContinuePrecision}
                >
                  <Text className='btn-text'>{continuingPrecision ? '提交中...' : '提交补充信息'}</Text>
                </View>
                {taskType === 'food' ? (
                  <View className='primary-btn soft-warning' onClick={handleRetakePrecision}>
                    <Text className='btn-text'>重新拍照继续</Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}

          {/* 核心营养概览 */}
          <View className='nutrition-overview-card'>
            <View className='nutrition-header'>
              <View className='calories-main'>
                <Text className='calories-value'>{Math.round(nutritionStats.calories)}</Text>
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
                  <View className='macro-progress' style={{ height: `${macroEnergyBarPercents.protein}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.protein * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>蛋白质</Text>
              </View>
              <View className='macro-item carbs'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${macroEnergyBarPercents.carbs}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.carbs * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>碳水</Text>
              </View>
              <View className='macro-item fat'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${macroEnergyBarPercents.fat}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.fat * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>脂肪</Text>
              </View>
            </View>
          </View>

          {/* AI 饮食分析（隐藏调试文案，仅展示最终可读结论） */}
          {showInsightCard && (
            <View className='insight-card'>
              <View className='card-header'>
                <Text className='card-title'>
                  <Text className='iconfont icon-a-144-lvye'></Text>
                  AI 饮食分析
                </Text>
              </View>

              {showInsightDescription && (
                <View className='insight-item intro'>
                  <View className='insight-icon-wrapper blue'>
                    <Text className='insight-icon iconfont icon-jishiben'></Text>
                  </View>
                  <Text className='insight-content'>{description}</Text>
                </View>
              )}

              {showInsightHealth && (
                <View className='insight-item highlight'>
                  <View className='insight-icon-wrapper green'>
                    <Text className='insight-icon iconfont icon-good'></Text>
                  </View>
                  <Text className='insight-content'>{resolvedHealthInsight}</Text>
                </View>
              )}

              {showInsightPfc && (
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

              {showInsightAbsorption && (
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

              {showInsightContext && (
                <View className='insight-item context'>
                  <View className='insight-icon-wrapper teal'>
                    <Text className='insight-icon iconfont icon-shizhong'></Text>
                  </View>
                  <View className='insight-body'>
                    <Text className='insight-label'>情境建议</Text>
                    <Text className='insight-content'>{contextAdvice}</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* 包含成分 */}
          <View className='ingredients-section'>
            <View className='section-title-row'>
              <Text className='section-title'>包含成分</Text>
              <Text className='section-count'>{nutritionItems.length}种</Text>
            </View>

            <View className='ingredients-list'>
              {nutritionItems.map((item) => (
                <View key={item.id} className='ingredient-card'>
                  <View className='ingredient-main'>
                    <View className='ingredient-header ingredient-header--title-row'>
                      <Text className='ingredient-name'>{item.name}</Text>
                      <View className='ingredient-header-actions'>
                        <View className='edit-icon-wrapper' onClick={() => handleEditName(item.id, item.name)}>
                          <Text className='iconfont icon-shouxieqianming'></Text>
                        </View>
                        <View className='delete-icon-wrapper' onClick={() => handleDeleteItem(item.id, item.name)}>
                          <Text className='delete-icon'>×</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View className='ingredient-nutrition-strip'>
                    <View className='ingredient-summary-cell ingredient-summary-cell--cal'>
                      <View className='ingredient-cal-kcal-line'>
                        <Text className='ingredient-cal-kcal-num'>
                          {Math.round(item.calorie * (item.ratio / 100))}
                        </Text>
                        <Text className='ingredient-cal-kcal-unit'>kcal</Text>
                      </View>
                    </View>
                    {MACRO_FIELDS.map((field) => {
                      const meta = MACRO_FIELD_META[field]
                      const intakeMacro = item[field] * (item.ratio / 100)
                      return (
                        <View
                          key={`${item.id}-${field}`}
                          className={`ingredient-summary-cell ingredient-summary-cell--${meta.className}`}
                          onClick={() => handleMacroEdit(item.id, field, item[field])}
                        >
                          <Text className='ingredient-macro-name'>{meta.label}</Text>
                          <View className='ingredient-macro-value-line'>
                            <Text className={`ingredient-macro-num ingredient-macro-num--${meta.className}`}>
                              {formatMacroDisplay(intakeMacro)}
                            </Text>
                            <Text className='ingredient-macro-g'>g</Text>
                          </View>
                        </View>
                      )
                    })}
                  </View>

                  <View className='ingredient-controls'>
                    <View className='weight-control'>
                      <Text className='control-label'>估算重量</Text>
                      <View className='weight-adjuster'>
                        <View
                          className='adjust-btn minus'
                          onClick={() => handleWeightAdjust(item.id, -10)}
                        >–</View>
                        <Text className='weight-display'>{item.weight}g</Text>
                        <View
                          className='adjust-btn plus'
                          onClick={() => handleWeightAdjust(item.id, 10)}
                        >+</View>
                      </View>
                    </View>

                    <View className='ratio-control'>
                      <Text className='control-label'>实际摄入</Text>
                      <View className='ratio-control-right'>
                        <Slider
                          className='ratio-slider-modern'
                          value={item.ratio}
                          min={0}
                          max={100}
                          step={5}
                          activeColor='#00bc7d'
                          backgroundColor='#e5e7eb'
                          blockSize={16}
                          blockColor='#ffffff'
                          showValue={false}
                          onChange={(e) => handleRatioAdjust(item.id, e.detail.value)}
                        />
                        <Text className='ratio-display'>{item.ratio}%</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
        </View>
      </ScrollView>

      {/* 底部固定栏：必须放在 scroll-view 外，避免 iOS 上 fixed 相对滚动容器失效 */}
      <View className='footer-actions'>
        <View className='pba-safe-area'>
          <View className='action-grid'>
            <View
              className={`secondary-btn ${isStrictHardReject ? 'disabled' : ''}`}
              onClick={isStrictHardReject ? undefined : handleSaveAsRecipe}
            >
              <Text className='btn-text'>收藏餐食</Text>
            </View>
            <View
              className={`primary-btn ${saving ? 'loading' : ''} ${!isAnalyzeSessionCommitted() && !committedRecordId && (isStrictSoftReject || isStrictHardReject) ? 'soft-warning' : ''} ${isAnalyzeSessionCommitted() || committedRecordId ? 'is-committed' : ''}`}
              onClick={handleConfirmAndShare}
            >
              {saving ? (
                <View className='btn-spinner' />
              ) : (
                <Text className='btn-text'>
                  {isAnalyzeSessionCommitted() || committedRecordId
                    ? '查看结果'
                    : (isStrictSoftReject || isStrictHardReject)
                      ? '仍要记录'
                      : '记录'}
                </Text>
              )}
            </View>
          </View>

          <View className='footer-correction-link' onClick={openCorrectionDrawer}>
            <Text className='footer-correction-link-text'>
              {shouldShowFollowupCard ? '补充这些信息，再重新分析' : '识别有误？点击纠错'}
            </Text>
          </View>
        </View>
      </View>

      {/* 餐次选择弹窗 */}
      <View
        className={`meal-selector-overlay ${showMealSelector ? 'visible' : ''}`}
        onClick={() => setShowMealSelector(false)}
      >
        <View
          className='meal-selector-card'
          onClick={(e) => e.stopPropagation()}
        >
          <View className='selector-title'>选择餐次</View>
          <View className='meal-options-grid'>
            {MEAL_OPTIONS.map((meal) => (
              <View
                key={meal.value}
                className={`meal-option-item ${selectedMealType === meal.value ? 'active' : ''}`}
                onClick={() => setSelectedMealType(meal.value)}
              >
                <Text className={`iconfont ${MEAL_ICONS[meal.value]} option-icon`}></Text>
                <Text className='option-label'>{meal.label}</Text>
              </View>
            ))}
          </View>
          <View className='selector-actions'>
            <View className='cancel-btn' onClick={() => setShowMealSelector(false)}>取消</View>
            <View className='confirm-btn' onClick={handleConfirmMealType}>保存</View>
          </View>
        </View>
      </View>

      {/* 二次纠错抽屉弹窗 */}
      <View
        className={`correction-drawer-overlay ${showCorrectionDrawer ? 'visible' : ''}`}
        onClick={() => setShowCorrectionDrawer(false)}
      >
        <View
          className={`correction-drawer-content ${showCorrectionDrawer ? 'slide-up' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <View className='drawer-header'>
            <Text className='drawer-title'>二次分析纠正</Text>
            <View className='drawer-close' onClick={() => setShowCorrectionDrawer(false)}>
              <Text className='close-icon'>✕</Text>
            </View>
          </View>

          <ScrollView className='drawer-scroll' scrollY>
            {taskType === 'food_text' && (
              <View className='additional-context-wrapper'>
                <View className='context-label'>
                  <Text className='iconfont icon-jinggao'></Text>
                  <Text>文字纠错说明</Text>
                </View>
                <Text className='placeholder-text'>
                  名称和重量请先直接在结果页修改；这里主要补充“上一轮为什么不对、这次应该怎么理解”。如果上面列了待补充问题，也可以直接把答案写在这里。
                </Text>
              </View>
            )}
            <View className='correction-list'>
              {correctionItems.map((item, index) => (
                <View key={item.id} className='correction-row'>
                  <View className='correction-index'>{index + 1}.</View>
                  <View className='correction-inputs'>
                    <Input
                      className='correction-input name-input'
                      value={item.name}
                      placeholder='食物名称'
                      disabled={taskType === 'food_text'}
                      onInput={(e: any) => handleCorrectionNameChange(item.id, e.detail.value)}
                    />
                    <View className='weight-input-wrapper'>
                      <Input
                        className='correction-input weight-input'
                        type='number'
                        value={item.weight.toString()}
                        disabled={taskType === 'food_text'}
                        onInput={(e: any) => handleCorrectionWeightChange(item.id, e.detail.value)}
                      />
                      <Text className='weight-unit'>g</Text>
                    </View>
                  </View>
                  {taskType !== 'food_text' && (
                    <View className='correction-remove' onClick={() => handleRemoveCorrectionItem(item.id)}>
                      <Text className='correction-remove-icon'>×</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>

            {taskType !== 'food_text' && (
              <View className='add-correction-btn' onClick={handleAddCorrectionItem}>
                <Text className='iconfont icon-plus'></Text>
                <Text>添加食物</Text>
              </View>
            )}

            <View className='additional-context-wrapper'>
              <View className='context-label'>
                <Text className='iconfont icon-jishiben'></Text>
                <Text>补充说明（可选）</Text>
              </View>
              <Textarea
                className='context-textarea'
                placeholder='例如：不是橘子，是橙子；这碗饭大概 300g；鸡腿是整只未去骨，我只吃了蛋白'
                value={additionalContext}
                onInput={(e: any) => setAdditionalContext(e.detail.value)}
                maxlength={200}
                autoHeight
              />
            </View>
          </ScrollView>

          <View className='drawer-footer'>
            <View
              className={`drawer-submit-btn ${isResubmitting ? 'loading' : ''}`}
              onClick={handleSubmitCorrection}
            >
              {isResubmitting ? <View className='btn-spinner' /> : <Text className='iconfont icon-loading'></Text>}
              <Text>{isResubmitting ? '' : '重新智能分析'}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

export default withAuth(ResultPage)
