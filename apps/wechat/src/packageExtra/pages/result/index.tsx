import { View, Text, Image, ScrollView, Slider, Swiper, SwiperItem, Input, Textarea } from '@tarojs/components'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  AnalyzeResponse,
  MealType,
  type Nutrients,
  type SaveFoodRecordRequest,
  saveFoodRecord,
  getAccessToken,
  createUserRecipe,
  updateAnalysisTaskResult,
  getHealthProfile,
  updateHealthProfile,
  createPackagedFood,
  submitAnalyzeTask,
  submitTextAnalyzeTask,
  continuePrecisionSession,
  submitAnalysisFeedback,
  ANALYSIS_FEEDBACK_SUBMISSION_ENABLED,
  type ExecutionMode,
  type AnalyzeRecognitionOutcome,
  type AllowedFoodCategory,
  type PrecisionReferenceDefaults,
  type PrecisionReferenceDimensions,
  type PrecisionReferenceObjectInput,
  type CreatePackagedFoodRequest,
  type PrecisionReferencePresetConfig,
  type PrecisionReferencePresetKey,
  type AnalysisFeedbackType,
  type AnalysisResolutionState,
  showUnifiedApiError,
} from '../../../utils/api'
import { normalizeRuntimeExecutionMode } from '../../../utils/execution-mode'
import { ANALYSIS_ENGINE_OPTIONS, normalizeAnalysisEngine } from '../../../utils/analysis-engine'
import { foodRecordFromSavePayload } from '../../../utils/dev-record-preview'
import { getRecommendedMealTypeWithFallback, inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import { getAiInsightCollapsed, setAiInsightCollapsed } from '../../../utils/ai-insight-collapsed'
import { withAuth } from '../../../utils/withAuth'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import {
  addWaterToBodyMetricsStorage,
  applyOptimisticFoodRecordToHomeDashboardSnapshot,
  calculateFoodRecordItemsWaterMl,
  refreshHomeDashboardLocalSnapshotFromCloud
} from '../../../utils/home-dashboard-local-cache'
import { formatDateKey } from '../../../pages/index/utils/helpers'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { applyEnergyEdit } from '../../../utils/nutrition-edit'
import { returnHomeAfterFoodRecord } from '../../../utils/food-record-flow'
import { getStoredRecordTargetDate, persistRecordTargetDate } from '../../../utils/record-date'
import { getFoodCorrectionCreditCost } from '../../../utils/membership'
import { buildFoodRecordItemPayloadFromResultItem } from '../../../utils/food-record-item-payload'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import {
  getMealTypeLabel,
  MealTypeSelectSheet,
  normalizeSelectableMealType,
  type SelectableMealType
} from '../../../components/MealTypeSelector'
import {
  buildCorrectionItemsPayload,
  buildCorrectionPreviousResultItems,
  formatCorrectionWeight,
  hasCorrectionWeightChanged,
  normalizeFoodNameForCorrection,
} from './correction-payload'
import {
  convertApiFoodItemsToNutritionItems,
  normalizeItemNutrients,
  type NutritionItem,
} from './result-item-converter'

import './index.scss'


const FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY = 'foodLibraryQuickUploadDraft'
const PACKAGED_FOOD_EDIT_DRAFT_KEY = 'packagedFoodEditDraft'
const PACKAGED_FOOD_EDIT_SAVED_KEY = 'packagedFoodEditSaved'
const ANALYSIS_ENGINE_STORAGE_KEY = 'analyzeAnalysisEngine'
const SUGGEST_RATIO_STORAGE_KEY = 'analyzeSuggestRatioEnabled'
const ANALYSIS_HEALTH_PROFILE_PROMPT_SHOWN_KEY = 'analysisHealthProfilePromptShown'
const CORRECTION_SUBMIT_DEBOUNCE_MS = 300
const MAX_ANALYZE_IMAGES = 5
const EATING_MOOD_OPTIONS = [
  { value: 'happy', emoji: '😊', label: '开心' },
  { value: 'calm', emoji: '😌', label: '平静' },
  { value: 'stressed', emoji: '😣', label: '压力大' },
  { value: 'tired', emoji: '😮‍💨', label: '疲惫' },
  { value: 'bored', emoji: '😶', label: '无聊' },
  { value: 'treat', emoji: '✨', label: '犒劳自己' },
] as const
type EatingMood = typeof EATING_MOOD_OPTIONS[number]['value']
/** 用户在分析结果页停留超过此时间且未调整摄入比例，则视为疑似不信任识别结果 */
const SUSPECT_DISTRUST_TIMEOUT_MS = 15000
/** 判断当前识别会话是否已保存为饮食记录。
 * 优先读取 analyze-history 列表传入的 analyzeTaskIsRecorded 标记；
 * 不再依赖本地 analyze_committed_session 缓存，状态由后端返回。 */
/** 按 analyzeSourceTaskId 记录已保存的 food record id，用于返回结果页时显示「查看结果」 */
const ANALYZE_COMMITTED_SESSION_KEY = 'analyze_committed_session'

function isAnalyzeSessionCommitted(): boolean {
  try {
    return Taro.getStorageSync('analyzeTaskIsRecorded') === '1'
  } catch {
    return false
  }
}

const readSuggestRatioPreference = (): boolean => {
  const saved = Taro.getStorageSync(SUGGEST_RATIO_STORAGE_KEY)
  if (saved === false || saved === '0' || saved === 'false') return false
  if (saved === true || saved === '1' || saved === 'true') return true
  return true
}

const normalizeExecutionMode = (value: unknown): ExecutionMode => {
  if (value === 'fast') return 'fast'
  if (value === 'fast_web_search') return 'fast_web_search'
  if (value === 'standard_web_search') return 'standard_web_search'
  if (value === 'standard_packaged_experiment') return 'standard_packaged_experiment'
  if (value === 'strict_separate') return 'strict_separate'
  if (value === 'strict_web_search') return 'strict_web_search'
  if (value === 'strict' || value === 'gemini35_flash' || value === 'gemini35_flash_grouped') return 'strict'
  return 'standard'
}

const getExecutionModeLabel = (value: ExecutionMode): string => {
  if (value === 'standard_packaged_experiment') return '零食库试验'
  if (value === 'strict_separate') return '精准分项'
  if (value === 'strict_web_search') return '精准联网'
  if (value === 'fast') return '快速'
  if (value === 'fast_web_search') return '快速联网'
  if (value === 'standard_web_search') return '普通联网'
  if (value === 'strict' || value === 'gemini35_flash' || value === 'gemini35_flash_grouped') return '精准'
  return '普通'
}

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

type PrecisionReferencePresetValue = PrecisionReferencePresetKey

const PRECISION_REFERENCE_PRESETS: Array<{
  value: PrecisionReferencePresetValue
  label: string
  dimensions: PrecisionReferenceDimensions
}> = [
  { value: 'campus_card', label: '标准卡片', dimensions: { length: 85.6, width: 53.98, height: 0.8 } },
  { value: 'large_card', label: '大卡片', dimensions: { length: 120, width: 76, height: 1 } },
  { value: 'custom', label: '自定义', dimensions: {} },
]

const DEFAULT_PRECISION_REFERENCE_PRESET: PrecisionReferencePresetValue = 'campus_card'

const normalizePositivePrecisionDimension = (value: unknown): number | undefined => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : undefined
}

const buildDefaultPrecisionReferenceDefaults = (): PrecisionReferenceDefaults => ({
  preferred_reference_key: DEFAULT_PRECISION_REFERENCE_PRESET,
  presets: PRECISION_REFERENCE_PRESETS.reduce<Partial<Record<PrecisionReferencePresetValue, PrecisionReferencePresetConfig>>>((acc, preset) => {
    if (preset.value === 'custom') return acc
    acc[preset.value] = {
      reference_name: preset.label,
      dimensions_mm: { ...preset.dimensions },
    }
    return acc
  }, {})
})

const normalizePrecisionReferencePresetConfig = (
  preset: PrecisionReferencePresetConfig | Record<string, unknown> | undefined,
  fallbackLabel: string,
): PrecisionReferencePresetConfig => {
  const raw = preset || {}
  const dimensionsSource = (raw as PrecisionReferencePresetConfig).dimensions_mm || {}
  const normalizedDimensions: PrecisionReferenceDimensions = {}
  const length = normalizePositivePrecisionDimension(dimensionsSource.length)
  const width = normalizePositivePrecisionDimension(dimensionsSource.width)
  const height = normalizePositivePrecisionDimension(dimensionsSource.height)
  if (length != null) normalizedDimensions.length = length
  if (width != null) normalizedDimensions.width = width
  if (height != null) normalizedDimensions.height = height
  return {
    reference_name: String((raw as PrecisionReferencePresetConfig).reference_name || fallbackLabel).trim() || fallbackLabel,
    dimensions_mm: Object.keys(normalizedDimensions).length > 0 ? normalizedDimensions : undefined,
  }
}

const normalizePrecisionReferenceDefaults = (value: unknown): PrecisionReferenceDefaults => {
  const base = buildDefaultPrecisionReferenceDefaults()
  if (!value || typeof value !== 'object') return base
  const raw = value as PrecisionReferenceDefaults
  const mergedPresets: Partial<Record<PrecisionReferencePresetValue, PrecisionReferencePresetConfig>> = { ...(base.presets || {}) }
  PRECISION_REFERENCE_PRESETS.forEach((preset) => {
    const savedPreset = raw.presets?.[preset.value]
    if (!savedPreset) {
      if (preset.value === 'custom' && !mergedPresets.custom) {
        mergedPresets.custom = {
          reference_name: preset.label,
          dimensions_mm: undefined,
        }
      }
      return
    }
    mergedPresets[preset.value] = normalizePrecisionReferencePresetConfig(savedPreset, preset.label)
  })
  const preferred = raw.preferred_reference_key
  const preferred_reference_key = PRECISION_REFERENCE_PRESETS.some(preset => preset.value === preferred)
    ? preferred
    : DEFAULT_PRECISION_REFERENCE_PRESET
  return {
    preferred_reference_key,
    presets: mergedPresets,
  }
}

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

const getSavedSelectableMealType = (fallbackMealType: SelectableMealType): SelectableMealType => {
  const savedMealType = Taro.getStorageSync('analyzeMealType')
  return normalizeSelectableMealType(savedMealType, fallbackMealType)
}

// 移除未使用的 CONTEXT_STATE_OPTIONS


interface SnackContributionDraft {
  itemId: number
  brand: string
  productName: string
  netWeightG: string
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  sugar: string
  sodiumMg: string
}

interface FoodEditDraft {
  itemId: number
  name: string
  weight: string
  calories: string
  protein: string
  carbs: string
  fat: string
  waterMl: string
}

type MacroField = 'protein' | 'carbs' | 'fat'

const EDIBLE_PORTION_HINT_KEYWORDS = [
  '虾', '小龙虾', '龙虾', '蟹', '螃蟹', '贝', '蛤', '蛏', '蚝', '扇贝',
  '鸡爪', '凤爪', '鸡翅', '鸡腿', '鸭脖', '鸭掌', '鸭翅', '鸭腿', '鹅胗', '鹅翅',
  '排骨', '骨', '猪蹄', '鱼',
  '荔枝', '龙眼', '龙贡果', '龙宫果', '山竹', '榴莲', '柚子', '橙', '橘', '香蕉', '芒果', '菠萝', '玉米'
]

const getEdiblePortionHint = (item: NutritionItem): string | null => {
  if (item.ediblePortionRatio > 0 && item.ediblePortionRatio < 99) {
    const reason = item.ediblePortionReason ? `：${item.ediblePortionReason}` : ''
    return `可食部 ${Math.round(item.ediblePortionRatio)}%，原始约 ${Math.round(item.grossWeight)}g，计入 ${Math.round(item.weight)}g${reason}`
  }
  const name = `${item.name || ''}${item.sourceName || ''}`
  if (!name) return null
  const shouldHint = EDIBLE_PORTION_HINT_KEYWORDS.some(keyword => name.includes(keyword))
  if (!shouldHint) return null
  return '重量按可食部估算：去壳、去骨、去皮或去核部分未计入营养。'
}
type IngredientMetricField = 'calories' | MacroField | 'waterMl'

const INGREDIENT_METRIC_FIELDS: Array<Exclude<IngredientMetricField, 'calories'>> = ['protein', 'carbs', 'fat', 'waterMl']

const INGREDIENT_METRIC_META: Record<IngredientMetricField, { label: string; className: string; unit: string }> = {
  calories: { label: '热量', className: 'cal', unit: 'kcal' },
  protein: { label: '蛋白质', className: 'protein', unit: 'g' },
  carbs: { label: '碳水', className: 'carbs', unit: 'g' },
  fat: { label: '脂肪', className: 'fat', unit: 'g' },
  waterMl: { label: '含水量', className: 'water', unit: 'ml' }
}

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const formatMacroDisplay = (value: number) => roundToSingleDecimal(value).toFixed(1)

const formatWaterDisplay = (value: number) => String(Math.max(0, Math.round(value)))

const formatIngredientMetricDisplay = (field: IngredientMetricField, value: number) => (
  field === 'waterMl' || field === 'calories' ? formatWaterDisplay(value) : formatMacroDisplay(value)
)

const formatWeightDisplay = (value: number) => `${Math.max(0, Math.round(value))}g`

type NutrientDetailKey = keyof Pick<Nutrients,
  'fiber' | 'sugar' | 'saturatedFat' | 'cholesterolMg' | 'sodiumMg' | 'potassiumMg' |
  'calciumMg' | 'ironMg' | 'magnesiumMg' | 'zincMg' | 'vitaminARaeMcg' | 'vitaminCMg' |
  'vitaminDMcg' | 'vitaminEMg' | 'vitaminKMcg' | 'thiaminMg' | 'riboflavinMg' |
  'niacinMg' | 'vitaminB6Mg' | 'folateMcg' | 'vitaminB12Mcg'
>

const NUTRIENT_DETAIL_META: Array<{ key: NutrientDetailKey; label: string; unit: string }> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { key: 'sodiumMg', label: '钠', unit: 'mg' },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' }
]

const normalizeNutrientValue = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

const SNACK_KEYWORDS = [
  '零食', '饼干', '薯片', '巧克力', '糖果', '蛋白棒', '能量棒', '肉干', '牛肉干',
  '鸭脖', '鹅胗', '坚果', '果干', '阿胶糕', '糕点', '辣条', '海苔', '话梅',
  '果冻', '威化', '沙琪玛', '麻薯', '小包', '包装', '袋装'
]

const snackContributionEnabled = false

const isSnackLikeItem = (item: NutritionItem) => {
  if (!snackContributionEnabled) return false
  const source = String(item.nutritionSource || '').toLowerCase()
  if (source === 'packaged_food_library') return false
  const marker = `${item.itemType || ''} ${item.category || ''} ${item.name || ''}`.toLowerCase()
  return (
    marker.includes('snack') ||
    marker.includes('packaged') ||
    marker.includes('package') ||
    SNACK_KEYWORDS.some(keyword => marker.includes(keyword.toLowerCase()))
  )
}

const isPackagedChoicePending = (item: NutritionItem) => {
  const status = String(item.packageMatchStatus || '').trim().toLowerCase()
  return Boolean(item.packagedPending) || (
    Array.isArray(item.packagedCandidates) &&
    item.packagedCandidates.length > 0 &&
    item.packageWeightApplied !== true &&
    (status === 'packaged_needs_confirmation' || status === 'multiple_candidates')
  )
}

const candidateNumber = (candidate: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = Number(candidate[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

const candidateText = (candidate: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = String(candidate[key] || '').trim()
    if (value && value !== '<nil>') return value
  }
  return ''
}

const isDisplayableImageURL = (value: string) => (
  /^https?:\/\//i.test(value) ||
  /^wxfile:\/\//i.test(value) ||
  /^cloud:\/\//i.test(value)
)

const candidateSourceImage = (candidate: Record<string, unknown>) => {
  const direct = candidateText(candidate, 'image_url', 'imageUrl')
  if (direct && isDisplayableImageURL(direct)) return direct
  const urls = candidate.source_image_urls || candidate.sourceImageUrls
  if (Array.isArray(urls)) {
    return urls
      .map(value => String(value || '').trim())
      .find(value => value && isDisplayableImageURL(value)) || ''
  }
  return ''
}

const candidateNetContentLabel = (candidate: Record<string, unknown>) => {
  const label = candidateText(candidate, 'net_content_label', 'netContentLabel')
  if (label) return label
  const value = candidateNumber(candidate, 'net_content_value', 'netContentValue', 'net_weight_g', 'netWeightG')
  if (value <= 0) return ''
  const unit = candidateText(candidate, 'net_content_unit', 'netContentUnit') || 'g'
  return `${formatNumberCompact(value)}${unit}`
}

const candidateNutritionBasisLabel = (candidate: Record<string, unknown>) => {
  const basis = candidateText(candidate, 'nutrition_basis_unit', 'nutritionBasisUnit')
  if (basis) return basis
  const unit = candidateText(candidate, 'net_content_unit', 'netContentUnit').toLowerCase()
  return unit === 'ml' ? '100ml' : '100g'
}

const candidateNutritionUnit = (candidate: Record<string, unknown>): Nutrients => {
  const unit = candidate.unit_nutrition_per_100g || candidate.unitNutritionPer100g
  if (unit && typeof unit === 'object') {
    return normalizeItemNutrients(unit as Nutrients, 0)
  }
  return normalizeItemNutrients({
    calories: candidateNumber(candidate, 'kcal_per_100g', 'calories_per_100g', 'caloriesPer100g'),
    protein: candidateNumber(candidate, 'protein_per_100g', 'proteinPer100g'),
    carbs: candidateNumber(candidate, 'carbs_per_100g', 'carbsPer100g'),
    fat: candidateNumber(candidate, 'fat_per_100g', 'fatPer100g')
  } as Nutrients, 0)
}

const candidateHasDisplayNutrition = (unit: Nutrients) => (
  (unit.calories || 0) > 0 ||
  (unit.protein || 0) > 0 ||
  (unit.carbs || 0) > 0 ||
  (unit.fat || 0) > 0
)

const candidateWeightForNutrition = (candidate: Record<string, unknown>) => (
  candidateNumber(candidate, 'net_weight_g', 'netWeightG', 'net_content_value', 'netContentValue')
)

const formatNumberCompact = (value: number) => {
  if (Math.abs(value - Math.round(value)) < 0.005) return String(Math.round(value))
  return String(Math.round(value * 100) / 100)
}

const nutrientPer100FromItem = (item: NutritionItem): Nutrients => {
  if (item.unitNutritionPer100g) return normalizeItemNutrients(item.unitNutritionPer100g, 0)
  const baseWeight = item.weight > 0 ? item.weight : item.originalWeight
  const factor = baseWeight > 0 ? 100 / baseWeight : 1
  return normalizeItemNutrients(scaleNutrients(buildFoodItemNutrients(item), factor), 0)
}

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

const clampWaterMlForItem = (waterMl: number, weight: number) => {
  const safeWater = Number.isFinite(waterMl) ? Math.max(0, waterMl) : 0
  const safeWeight = Number.isFinite(weight) ? Math.max(0, weight) : 0
  return safeWeight > 0 ? Math.min(safeWater, safeWeight) : safeWater
}

const buildFoodItemNutrients = (item: NutritionItem): Nutrients => ({
  ...item.nutrients,
  calories: item.calorie,
  protein: item.protein,
  carbs: item.carbs,
  fat: item.fat,
  waterMl: clampWaterMlForItem(item.waterMl, item.weight),
  water_ml: clampWaterMlForItem(item.waterMl, item.weight),
  sodium_mg: item.nutrients.sodiumMg || item.nutrients.sodium_mg || 0,
  fiber: item.nutrients.fiber || 0,
  sugar: item.nutrients.sugar || 0
})

const getNutrientDetailRows = (item: NutritionItem) => {
  const ratio = item.ratio / 100
  return NUTRIENT_DETAIL_META
    .map((meta) => ({
      ...meta,
      value: normalizeNutrientValue(item.nutrients[meta.key]) * ratio
    }))
}

const formatNutrientDetailValue = (value: number) => {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

const calculateCaloriesFromMacros = (protein: number, carbs: number, fat: number) => (
  roundToSingleDecimal(protein) * 4 + roundToSingleDecimal(carbs) * 4 + roundToSingleDecimal(fat) * 9
)

/** 结果页头图：上滑时在区间内高度收缩；左右不留 margin（全宽铺满） */
const RESULT_HERO_MAX_RPX = 700
const RESULT_HERO_MIN_RPX = 240
/** 纵向滑动多少 px 内完成收缩（与 scrollTop 同单位） */
const RESULT_HERO_SHRINK_SCROLL_PX = 350
/** 初始圆角（rpx），随上滑收至 0 */
const RESULT_HERO_INNER_RADIUS_MAX_RPX = 24

const normalizePrecisionStringList = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []
)

function toSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function ResultPage() {
  const { scheme } = useAppColorScheme()
  const [taskType, setTaskType] = useState<'food' | 'food_text'>('food')
  const [textRecordInput, setTextRecordInput] = useState('')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imagePath, setImagePath] = useState<string>('') // Keep for compatibility/fallback logic
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
  const [expandedNutritionDetailIds, setExpandedNutritionDetailIds] = useState<Record<number, boolean>>({})
  const [nutritionStats, setNutritionStats] = useState({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  })
  const [healthAdvice, setHealthAdvice] = useState('')
  const [description, setDescription] = useState('')
  const [eatingMood, setEatingMood] = useState<EatingMood | null>(null)
  const [pfcRatioComment, setPfcRatioComment] = useState<string | null>(null)
  const [eatingOrderAdvice, setEatingOrderAdvice] = useState<string | null>(null)
  const [absorptionNotes, setAbsorptionNotes] = useState<string | null>(null)
  const [contextAdvice, setContextAdvice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
	const [savingRecipe, setSavingRecipe] = useState(false)
	const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null)
	const recipeSaveInFlightRef = useRef(false)
  /** 当前识别会话是否已保存为饮食记录（可跳转详情，不再重复写入/发动态） */
  const [committedRecordId, setCommittedRecordId] = useState<string | null>(null)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [analysisEngine, setAnalysisEngine] = useState(() => normalizeAnalysisEngine(
    Taro.getStorageSync(ANALYSIS_ENGINE_STORAGE_KEY),
    'standard',
  ))
  const correctionCreditCost = getFoodCorrectionCreditCost(executionMode)
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
  const [savedPrecisionReferenceDefaults, setSavedPrecisionReferenceDefaults] = useState<PrecisionReferenceDefaults>(
    () => buildDefaultPrecisionReferenceDefaults()
  )
  const [precisionReferencePreset, setPrecisionReferencePreset] = useState<PrecisionReferencePresetValue>(DEFAULT_PRECISION_REFERENCE_PRESET)
  const [precisionReferenceName, setPrecisionReferenceName] = useState('标准卡片')
  const [precisionReferenceLength, setPrecisionReferenceLength] = useState('85.6')
  const [precisionReferenceWidth, setPrecisionReferenceWidth] = useState('53.98')
  const [precisionReferenceHeight, setPrecisionReferenceHeight] = useState('0.8')
  const [precisionReferencePlacement, setPrecisionReferencePlacement] = useState('')
  const [defaultMealType, setDefaultMealType] = useState<SelectableMealType>(() => inferDefaultMealTypeFromLocalTime())
  const [insightCollapsed, setInsightCollapsed] = useState(false)

  useEffect(() => {
    if (imagePaths.length <= 1) {
      setCurrentImageIndex(0)
      return
    }
    setCurrentImageIndex(prev => (prev >= imagePaths.length ? 0 : prev))
  }, [imagePaths])

  // 餐次选择弹窗状态
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>(
    () => getSavedSelectableMealType(inferDefaultMealTypeFromLocalTime())
  )

  // 二次纠错抽屉状态
  const [showCorrectionDrawer, setShowCorrectionDrawer] = useState(false)
  const [quickRatioSheetVisible, setQuickRatioSheetVisible] = useState(false)
  const [correctionItems, setCorrectionItems] = useState<NutritionItem[]>([])
  const [additionalContext, setAdditionalContext] = useState('')
  const [isResubmitting, setIsResubmitting] = useState(false)
  const [snackDraft, setSnackDraft] = useState<SnackContributionDraft | null>(null)
  const [savingSnackDraft, setSavingSnackDraft] = useState(false)
  const [foodEditDraft, setFoodEditDraft] = useState<FoodEditDraft | null>(null)

  /** 驱动头图收缩：与 ScrollView 的 scrollTop 同步 */
  const [resultScrollTop, setResultScrollTop] = useState(0)
  const resultScrollRafRef = useRef<number | null>(null)
  const pendingResultScrollTopRef = useRef(0)
  const precisionDefaultsLoadedRef = useRef(false)
  const correctionSubmitDebounceRef = useRef(0)

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
    const loadMealTypeProfile = async () => {
      try {
        const token = getAccessToken()
        if (!token) return
        const profile = await getHealthProfile()
        const mealType = await getRecommendedMealTypeWithFallback({ profile })
        setDefaultMealType(mealType)
      } catch {
        setDefaultMealType(inferDefaultMealTypeFromLocalTime())
      }
    }
    void loadMealTypeProfile()
  }, [])

  useEffect(() => {
    setSelectedMealType(getSavedSelectableMealType(defaultMealType))
  }, [defaultMealType])

  useEffect(() => {
    return () => {
      if (resultScrollRafRef.current != null) {
        cancelAnimationFrame(resultScrollRafRef.current)
      }
      clearSuspectDistrustTimer()
      // 页面卸载时清除识别记录导航标记，避免影响其他入口
      try {
        Taro.removeStorageSync('analyzeTaskIsRecorded')
        Taro.removeStorageSync('analyzeCommittedRecordId')
      } catch {}
    }
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
  })

  useDidShow(() => {
    try {
      const saved = Taro.getStorageSync(PACKAGED_FOOD_EDIT_SAVED_KEY)
      const itemId = Number(saved?.itemId)
      if (!Number.isFinite(itemId) || itemId <= 0) return
      Taro.removeStorageSync(PACKAGED_FOOD_EDIT_SAVED_KEY)
      setNutritionItems(items => {
        const next = items.map(item => {
          if (item.id !== itemId) return item
          const unit = normalizeItemNutrients(saved?.unitNutritionPer100g, 0)
          const hasConfirmedNutrition = unit.calories > 0 || unit.protein > 0 || unit.carbs > 0 || unit.fat > 0
          if (!hasConfirmedNutrition) {
            return { ...item, nutritionSource: 'packaged_food_library', nutritionSourceCategory: 'database', isUnresolved: false }
          }
          const scaled = normalizeItemNutrients(scaleNutrients(unit, Math.max(item.weight, 0) / 100), 0)
          const calories = scaled.calories > 0
            ? scaled.calories
            : calculateCaloriesFromMacros(scaled.protein, scaled.carbs, scaled.fat)
          return {
            ...item,
            name: String(saved?.productName || item.name),
            calorie: calories,
            protein: scaled.protein,
            carbs: scaled.carbs,
            fat: scaled.fat,
            nutrients: { ...scaled, calories },
            unitNutritionPer100g: unit,
            packagedFoodId: saved?.packagedFoodId || item.packagedFoodId,
            nutritionSource: 'packaged_food_library',
            nutritionSourceCategory: 'database',
            isUnresolved: false,
          }
        })
        calculateNutritionStats(next)
        return next
      })
    } catch {}
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
  }, [scheme])

  useEffect(() => {
    setInsightCollapsed(getAiInsightCollapsed())
  }, [])

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    persistRecordTargetDate(String(params?.date || ''))
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
        water_ml: item.waterMl,
        nutrients: buildFoodItemNutrients(item)
      }))
    }

    Taro.setStorageSync(FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY, draft)
    Taro.navigateTo({
      url: `${extraPkgUrl('/pages/food-library-share/index')}?quick_upload=1`
    })
  }

  // 计算总营养统计
  const calculateNutritionStats = (items: NutritionItem[]) => {
    const confirmedItems = items.filter(item => !isPackagedChoicePending(item))
    const stats = confirmedItems.reduce(
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
    const total = confirmedItems.reduce((sum, item) => sum + item.intake, 0)
    setTotalWeight(Math.round(total))
  }

  const applyAnalyzeResultToPage = (
    result: AnalyzeResponse,
    nextTaskId?: string,
    fallbackPrecisionSessionId = precisionSessionId,
    resetCommittedState = Boolean(nextTaskId),
  ) => {
    setDescription(result.description || '')
    setHealthAdvice(result.insight || '保持健康饮食！')
    setPfcRatioComment(result.pfc_ratio_comment ?? null)
    setEatingOrderAdvice(result.eating_order_advice ?? null)
    setAbsorptionNotes(result.absorption_notes ?? null)
    setContextAdvice(result.context_advice ?? null)
    setRecognitionOutcome(normalizeRecognitionOutcome(result.recognitionOutcome))
    setRejectionReason(result.rejectionReason?.trim() || null)
    setRetakeGuidance(Array.isArray(result.retakeGuidance) ? result.retakeGuidance.filter(Boolean) : [])
    setAllowedFoodCategory(normalizeAllowedFoodCategory(result.allowedFoodCategory))
    setFollowupQuestions(Array.isArray(result.followupQuestions) ? result.followupQuestions.filter(Boolean) : [])
    setPrecisionSessionId(result.precisionSessionId || fallbackPrecisionSessionId)
    setPrecisionStatus(result.precisionStatus || '')
    setPendingRequirements(normalizePrecisionStringList(result.pendingRequirements))
    setRetakeInstructions(normalizePrecisionStringList(result.retakeInstructions))
    setReferenceObjectNeeded(Boolean(result.referenceObjectNeeded))
    setReferenceObjectSuggestions(normalizePrecisionStringList(result.referenceObjectSuggestions))
    setDetectedItemsSummary(normalizePrecisionStringList(result.detectedItemsSummary))
    setSplitStrategy(String(result.splitStrategy || ''))
    setUncertaintyNotes(normalizePrecisionStringList(result.uncertaintyNotes))

    const items = convertApiFoodItemsToNutritionItems(result.items || [])
    setNutritionItems(items)
    setCorrectionItems(items)
    originalItemsRef.current = JSON.parse(JSON.stringify(items))
    calculateNutritionStats(items)

    // 启动“疑似不信任”停留检测：15 秒内未调整摄入比例则上报
    startSuspectDistrustTimer()

    Taro.setStorageSync('analyzeResult', JSON.stringify(result))
    if (nextTaskId) {
      Taro.setStorageSync('analyzeSourceTaskId', nextTaskId)
    }
    if (resetCommittedState) {
      Taro.removeStorageSync('analyzeTaskIsRecorded')
      Taro.removeStorageSync('analyzeCommittedRecordId')
      setCommittedRecordId(null)
		setSavedRecipeId(null)
    }
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
      // 埋点失败不阻塞主流程
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

  const hydrateCommittedRecord = useCallback(() => {
    // 状态由 analyze-history 列表传入的 analyzeTaskIsRecorded 标记决定，
    // 不再查询后端或维护本地 analyze_committed_session 缓存。
    try {
      if (Taro.getStorageSync('analyzeTaskIsRecorded') === '1') {
        setCommittedRecordId('history')
      } else {
        setCommittedRecordId(null)
      }
    } catch {
      setCommittedRecordId(null)
    }
  }, [])

  useDidShow(() => {
    void hydrateCommittedRecord()
  })

  useEffect(() => {
    // 获取传递的图片路径和分析结果
    try {
      const storedPaths = Taro.getStorageSync('analyzeImagePaths')
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      const storedMode = Taro.getStorageSync('analyzeExecutionMode')
      const storedTaskType = normalizeTaskType(Taro.getStorageSync('analyzeTaskType'))
      const storedTextInput = String(Taro.getStorageSync('analyzeTextInput') || '').trim()
      const storedPrecisionSessionId = String(Taro.getStorageSync('analyzePrecisionSessionId') || '').trim()
      setTaskType(storedTaskType)
      setTextRecordInput(storedTextInput)
      const normalizedStoredMode = normalizeExecutionMode(storedMode)
      setExecutionMode(normalizedStoredMode)
      setAnalysisEngine(normalizeAnalysisEngine(Taro.getStorageSync(ANALYSIS_ENGINE_STORAGE_KEY), normalizedStoredMode))
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
        applyAnalyzeResultToPage(result, undefined, storedPrecisionSessionId)
        void hydrateCommittedRecord()
        if (getAccessToken() && !Taro.getStorageSync(ANALYSIS_HEALTH_PROFILE_PROMPT_SHOWN_KEY)) {
          void getHealthProfile()
            .then((profile) => {
              const status = profile.onboarding_status || (profile.onboarding_completed === true ? 'completed' : 'pending')
              if (status === 'completed') return

              Taro.setStorageSync(ANALYSIS_HEALTH_PROFILE_PROMPT_SHOWN_KEY, true)
              Taro.showModal({
                title: '让分析建议更贴合你',
                content: '完善健康档案后，食物分析会结合你的过敏/忌口、饮食偏好和每日消耗，给出更安全、更适合你的建议。',
                confirmText: '去完善',
                cancelText: '暂不填写',
                confirmColor: '#238c6d',
                success: ({ confirm }) => {
                  if (confirm) {
                    Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })
                  }
                },
              })
            })
            .catch(() => {
              // 档案提示读取失败不影响分析结果展示。
            })
        }
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
      void showUnifiedApiError(error, '数据加载失败')
    }
  }, [hydrateCommittedRecord])

  const handleDefaultModeEdit = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile-view/index') })
  }

  const isStrictMode = executionMode === 'strict' || executionMode === 'strict_separate' || executionMode === 'strict_web_search'
  const shouldShowRecognitionCard = false
  const shouldShowFollowupCard = taskType === 'food_text' && followupQuestions.length > 0 && !isStrictMode
  const hasUploadableImage = taskType === 'food' && (imagePaths.length > 0 || !!imagePath)
  const shouldShowPrecisionContinueCard = Boolean(precisionSessionId)
    && (precisionStatus === 'needs_user_input' || precisionStatus === 'needs_retake')

  const getPrecisionReferencePresetConfig = useCallback((
    value: PrecisionReferencePresetValue,
    defaults: PrecisionReferenceDefaults = savedPrecisionReferenceDefaults,
  ): PrecisionReferencePresetConfig => {
    const presetMeta = PRECISION_REFERENCE_PRESETS.find(item => item.value === value)
    const fallbackLabel = presetMeta?.label || '参考物'
    const savedPreset = defaults.presets?.[value]
    if (savedPreset) {
      return normalizePrecisionReferencePresetConfig(savedPreset, fallbackLabel)
    }
    return {
      reference_name: fallbackLabel,
      dimensions_mm: presetMeta?.dimensions && Object.keys(presetMeta.dimensions).length > 0
        ? { ...presetMeta.dimensions }
        : undefined,
    }
  }, [savedPrecisionReferenceDefaults])

  const applyPrecisionReferencePreset = useCallback((
    value: PrecisionReferencePresetValue,
    defaults: PrecisionReferenceDefaults = savedPrecisionReferenceDefaults,
  ) => {
    setPrecisionReferencePreset(value)
    const target = getPrecisionReferencePresetConfig(value, defaults)
    setPrecisionReferenceName(target.reference_name)
    setPrecisionReferenceLength(target.dimensions_mm?.length != null ? String(target.dimensions_mm.length) : '')
    setPrecisionReferenceWidth(target.dimensions_mm?.width != null ? String(target.dimensions_mm.width) : '')
    setPrecisionReferenceHeight(target.dimensions_mm?.height != null ? String(target.dimensions_mm.height) : '')
  }, [getPrecisionReferencePresetConfig, savedPrecisionReferenceDefaults])

  const handlePrecisionReferencePresetSelect = (value: PrecisionReferencePresetValue) => {
    applyPrecisionReferencePreset(value)
  }

  const buildNextPrecisionReferenceDefaults = useCallback((): PrecisionReferenceDefaults => {
    const currentPresetConfig = normalizePrecisionReferencePresetConfig({
      reference_name: precisionReferenceName.trim() || getPrecisionReferencePresetConfig(precisionReferencePreset).reference_name,
      dimensions_mm: {
        length: normalizePositivePrecisionDimension(precisionReferenceLength),
        width: normalizePositivePrecisionDimension(precisionReferenceWidth),
        height: normalizePositivePrecisionDimension(precisionReferenceHeight),
      },
    }, getPrecisionReferencePresetConfig(precisionReferencePreset).reference_name)

    return {
      preferred_reference_key: precisionReferencePreset,
      presets: {
        ...(savedPrecisionReferenceDefaults.presets || {}),
        [precisionReferencePreset]: currentPresetConfig,
      },
    }
  }, [
    getPrecisionReferencePresetConfig,
    precisionReferenceHeight,
    precisionReferenceLength,
    precisionReferenceName,
    precisionReferencePreset,
    precisionReferenceWidth,
    savedPrecisionReferenceDefaults,
  ])

  useEffect(() => {
    if (precisionDefaultsLoadedRef.current) return
    precisionDefaultsLoadedRef.current = true
    let active = true
    ;(async () => {
      try {
        const profile = await getHealthProfile()
        if (!active) return
        precisionDefaultsLoadedRef.current = true
        const defaults = normalizePrecisionReferenceDefaults(profile.health_condition?.precision_reference_defaults)
        setSavedPrecisionReferenceDefaults(defaults)
        applyPrecisionReferencePreset(defaults.preferred_reference_key || DEFAULT_PRECISION_REFERENCE_PRESET, defaults)
      } catch (error) {
        console.warn('[result] 加载默认参考物失败', error)
      }
    })()

    return () => {
      active = false
    }
  }, [applyPrecisionReferencePreset])

  const buildPrecisionReferenceObjects = (): PrecisionReferenceObjectInput[] => {
    const name = precisionReferenceName.trim()
    if (!name) return []
    const length = normalizePositivePrecisionDimension(precisionReferenceLength)
    const width = normalizePositivePrecisionDimension(precisionReferenceWidth)
    const height = normalizePositivePrecisionDimension(precisionReferenceHeight)
    return [{
      reference_type: precisionReferencePreset === 'custom' ? 'custom' : 'preset',
      reference_name: name,
      dimensions_mm: {
        ...(length != null ? { length } : {}),
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
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
      const nextReferenceDefaults = buildNextPrecisionReferenceDefaults()
      setSavedPrecisionReferenceDefaults(nextReferenceDefaults)
      updateHealthProfile({
        precision_reference_defaults: nextReferenceDefaults,
      }).catch((error) => {
        console.warn('[result] 保存默认参考物失败', error)
      })
      const payload = {
        source_type: taskType === 'food_text' ? 'text' as const : 'image' as const,
        text: taskType === 'food_text' ? String(Taro.getStorageSync('analyzeTextInput') || '').trim() || description : undefined,
        additionalContext: precisionFollowupText.trim() || undefined,
        meal_type: savedMealType,
        diet_goal: savedDietGoal,
        activity_timing: savedActivityTiming,
        suggest_ratio_enabled: readSuggestRatioPreference(),
        reference_objects: buildPrecisionReferenceObjects(),
      }
      const { task_id } = await continuePrecisionSession(precisionSessionId, payload)
      Taro.hideLoading()
      Taro.redirectTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${task_id}&task_type=${taskType}&execution_mode=strict`
      })
    } catch (e: any) {
      Taro.hideLoading()
      await showUnifiedApiError(e, '继续分析失败')
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

  const showInsightContext = Boolean(contextAdvice?.trim()) && !isDebugInsightText(contextAdvice)

  const ratioAdviceItems = useMemo(() => {
    return nutritionItems
      .filter(item => item.suggestedRatioSource === 'ai' && typeof item.suggestedRatio === 'number' && item.suggestedRatio < 100)
      .slice(0, 3)
      .map(item => `${item.name}建议 ${item.suggestedRatio}%${item.suggestedRatioReason ? `，${item.suggestedRatioReason}` : ''}`)
  }, [nutritionItems])

  const ratioAdviceText = ratioAdviceItems.length > 0
    ? `${ratioAdviceItems.join('；')}。`
    : '本餐暂无需要特别下调的食物，默认按实际食用量记录即可。'

  const mealSuggestionContext = useMemo(() => {
    const matchNames = (pattern: RegExp) => nutritionItems
      .map(item => item.name.trim())
      .filter(name => name && pattern.test(name))

    const unique = (names: string[]) => Array.from(new Set(names))
    const soupDrinkNames = unique(matchNames(/汤|羹|粥|豆浆|牛奶|酸奶|奶茶|茶饮|咖啡|饮料|果汁|可乐|汽水|酒|矿泉水|苏打水/))
    const soupLikeStapleNames = unique(
      nutritionItems
        .filter(item => item.waterMl >= 120 && /面|粉|米线|馄饨|云吞|麻辣烫|火锅/.test(item.name))
        .map(item => item.name.trim())
        .filter(Boolean)
    )
    const vegFruitNames = unique(matchNames(/青菜|蔬菜|白菜|菠菜|生菜|油麦菜|油菜|西兰花|菜花|番茄|西红柿|黄瓜|冬瓜|南瓜|丝瓜|苦瓜|蘑菇|香菇|金针菇|豆芽|胡萝卜|萝卜|土豆|茄子|莲藕|海带|木耳|笋|玉米|苹果|香蕉|橙|柑|莓|蓝莓|草莓|荔枝|桃|梨|葡萄|水果/))
    const proteinNames = unique(matchNames(/牛肉|猪肉|羊肉|鸡肉|鸡|鸭|鱼|虾|蟹|贝|蛋|豆腐|瘦肉|排骨|牛腩|肉/))
    const stapleNames = unique(matchNames(/米饭|炒饭|饭|面|粉|米线|馒头|包子|饺|饼|粥|粉丝|面条|主食/))
    const sweetFoodNames = unique(matchNames(/蛋糕|面包|糕|甜|糖|蛋筒|冰淇淋|雪糕|巧克力|饼干|甜点|甜品/))
    const sweetDrinkNames = unique(matchNames(/奶茶|甜饮|可乐|汽水|果汁|含糖饮料/))

    return {
      soupDrinkNames,
      soupLikeStapleNames,
      vegFruitNames,
      proteinNames,
      stapleNames,
      sweetFoodNames,
      sweetDrinkNames,
      hasSoupOrDrink: soupDrinkNames.length > 0 || soupLikeStapleNames.length > 0,
      hasVegFruit: vegFruitNames.length > 0,
      hasProtein: proteinNames.length > 0,
      hasStaple: stapleNames.length > 0,
      hasSweetFood: sweetFoodNames.length > 0,
      hasSweetDrink: sweetDrinkNames.length > 0,
    }
  }, [nutritionItems])

  const eatingOrderText = useMemo(() => {
    const steps: string[] = []
    if (mealSuggestionContext.soupDrinkNames.length > 0) {
      steps.push(`少量喝${mealSuggestionContext.soupDrinkNames.slice(0, 2).join('、')}润口`)
    } else if (mealSuggestionContext.soupLikeStapleNames.length > 0) {
      steps.push('如有汤汁，可先少量喝汤汁润口')
    }
    if (mealSuggestionContext.hasVegFruit) steps.push(`吃${mealSuggestionContext.vegFruitNames.slice(0, 2).join('、')}`)
    if (mealSuggestionContext.hasProtein) steps.push('吃本餐的蛋白质部分')
    if (mealSuggestionContext.hasStaple || mealSuggestionContext.hasSweetFood || mealSuggestionContext.hasSweetDrink) {
      const tailParts: string[] = []
      if (mealSuggestionContext.hasStaple) tailParts.push('主食')
      if (mealSuggestionContext.hasSweetFood) tailParts.push('甜点')
      if (mealSuggestionContext.hasSweetDrink) tailParts.push('甜饮')
      steps.push(`吃${tailParts.join('、')}`)
    }
    if (steps.length === 0 && nutritionItems.length > 0) return '按当前识别到的食物少量多次、放慢速度进食即可。'

    return `${steps.map((step, index) => {
      if (index === 0) return step.startsWith('如有汤汁') ? step : `先${step}`
      if (index === steps.length - 1) return step.startsWith('吃') ? `最后${step}` : `最后${step}`
      return step.startsWith('吃') ? `接着${step}` : `接着${step}`
    }).join('，')}。`
  }, [mealSuggestionContext, nutritionItems.length])

  const fallbackPfcRatioText = useMemo(() => {
    const total = nutritionStats.protein + nutritionStats.carbs + nutritionStats.fat
    if (total <= 0) return '本餐营养比例暂无法判断，建议结合实际食用量记录后再观察。'
    const proteinPercent = Math.round((nutritionStats.protein / total) * 100)
    const carbsPercent = Math.round((nutritionStats.carbs / total) * 100)
    const fatPercent = Math.round((nutritionStats.fat / total) * 100)
    const notes: string[] = []
    if (carbsPercent >= 55) {
      const carbTargets = mealSuggestionContext.hasSweetDrink ? '主食或甜饮' : '主食部分'
      notes.push(`碳水占比较高，可适当控制${carbTargets}`)
    }
    if (fatPercent >= 35) notes.push('脂肪占比较高，油脂/高脂菜建议减量')
    if (proteinPercent < 18) notes.push('蛋白质偏少，可补充蛋类、奶类、豆制品或瘦肉')
    if (notes.length === 0) notes.push('整体比例较均衡')
    return `蛋白质约${proteinPercent}%，碳水约${carbsPercent}%，脂肪约${fatPercent}%；${notes.join('，')}。`
  }, [mealSuggestionContext.hasSweetDrink, nutritionStats.protein, nutritionStats.carbs, nutritionStats.fat])

  const fallbackAbsorptionText = useMemo(() => {
    const hasHighFat = nutritionItems.some(item => /油|炸|烧烤|肥|酥|奶油|蛋筒|冰淇淋/.test(item.name)) || nutritionStats.fat >= 18
    const notes: string[] = []
    if (mealSuggestionContext.hasVegFruit && mealSuggestionContext.hasProtein) {
      notes.push(`${mealSuggestionContext.vegFruitNames.slice(0, 2).join('、')}可与本餐蛋白质部分搭配`)
    }
    if (!mealSuggestionContext.hasVegFruit && mealSuggestionContext.hasProtein && mealSuggestionContext.hasStaple) {
      notes.push('先吃蛋白质部分、主食后置，有助于让餐后能量释放更平稳')
    }
    if (hasHighFat) notes.push('高油脂食物消化较慢，建议放慢进食速度')
    if (notes.length === 0) notes.push('本餐按当前识别到的食物少量多次、放慢速度进食即可')
    return `${notes.join('；')}。`
  }, [mealSuggestionContext, nutritionItems, nutritionStats.fat])

  const isUnsupportedInsightText = useCallback((text: string | null | undefined): boolean => {
    if (!text?.trim()) return false
    const t = text.trim()
    if (/奶茶|茶饮/.test(t) && !mealSuggestionContext.sweetDrinkNames.some(name => /奶茶|茶饮/.test(name))) return true
    if (/蔬果|蔬菜|水果|维生素C|酸味食物/.test(t) && !mealSuggestionContext.hasVegFruit) return true
    if (/甜饮|可乐|汽水|果汁|含糖饮料/.test(t) && !mealSuggestionContext.hasSweetDrink) return true
    if (/甜点|甜品|冰淇淋|雪糕|蛋糕/.test(t) && !mealSuggestionContext.hasSweetFood) return true
    if (/汤水|汤汁|喝汤/.test(t) && !mealSuggestionContext.hasSoupOrDrink) return true
    return false
  }, [mealSuggestionContext])

  const pfcRatioDisplayText = !isDebugInsightText(pfcRatioComment) && !isUnsupportedInsightText(pfcRatioComment) && pfcRatioComment?.trim()
    ? pfcRatioComment.trim()
    : fallbackPfcRatioText
  const eatingOrderDisplayText = !isDebugInsightText(eatingOrderAdvice) && !isUnsupportedInsightText(eatingOrderAdvice) && eatingOrderAdvice?.trim()
    ? eatingOrderAdvice.trim()
    : eatingOrderText
  const absorptionDisplayText = !isDebugInsightText(absorptionNotes) && !isUnsupportedInsightText(absorptionNotes) && absorptionNotes?.trim()
    ? absorptionNotes.trim()
    : fallbackAbsorptionText

  // 调节食物估算重量（+- 按钮）
  const handleWeightAdjust = (id: number, delta: number) => {
    weightAdjustedRef.current = true
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id === id) {
          // 调节的是 weight（AI 估算的食物总重量）
          const newWeight = Math.max(10, item.weight + delta) // 最小 10g
          const weightScale = item.weight > 0 ? newWeight / item.weight : 1
          const nextProtein = item.protein * weightScale
          const nextCarbs = item.carbs * weightScale
          const nextFat = item.fat * weightScale
          const nextWaterMl = item.waterMl * weightScale
          const nextNutrients = scaleNutrients(item.nutrients, weightScale)
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
            fat: nextFat,
            waterMl: nextWaterMl,
            nutrients: {
              ...nextNutrients,
              calories: calculateCaloriesFromMacros(nextProtein, nextCarbs, nextFat),
              protein: nextProtein,
              carbs: nextCarbs,
              fat: nextFat,
              waterMl: nextWaterMl,
              water_ml: nextWaterMl
            }
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

  const updateIngredientMetricField = (
    id: number,
    field: IngredientMetricField,
    nextValue: number | ((currentValue: number) => number)
  ) => {
    nutritionAdjustedRef.current = true
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id !== id) return item
        const currentValue = field === 'calories' ? item.calorie : item[field]
        const resolvedValue = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
        const normalizedValue = field === 'waterMl'
          ? clampWaterMlForItem(Math.round(resolvedValue), item.weight)
          : Math.max(0, roundToSingleDecimal(resolvedValue))
        if (field === 'calories') {
          const nextNutrients = applyEnergyEdit(item.nutrients, 'calories', normalizedValue)
          return {
            ...item,
            nutritionEdited: true,
            calorie: nextNutrients.calories,
            protein: nextNutrients.protein,
            carbs: nextNutrients.carbs,
            fat: nextNutrients.fat,
            nutritionSource: 'user_correction_context',
            nutritionSourceCategory: 'user_correction_context',
            nutrients: nextNutrients,
          }
        }
        if (field === 'waterMl') {
          return {
            ...item,
            nutritionEdited: true,
            waterMl: normalizedValue,
            nutrients: {
              ...item.nutrients,
              waterMl: normalizedValue,
              water_ml: normalizedValue,
            },
          }
        }
        const nextNutrients = applyEnergyEdit(item.nutrients, field, normalizedValue)
        const nextItem = {
          ...item,
          nutritionEdited: true,
          [field]: normalizedValue,
          nutritionSource: 'user_correction_context',
          nutritionSourceCategory: 'user_correction_context',
          nutrients: nextNutrients,
        } as NutritionItem
        nextItem.protein = nextNutrients.protein
        nextItem.carbs = nextNutrients.carbs
        nextItem.fat = nextNutrients.fat
        const nextCalories = nextNutrients.calories
        return {
          ...nextItem,
          calorie: nextCalories,
          nutrients: {
            ...nextItem.nutrients,
            calories: nextCalories,
            protein: nextItem.protein,
            carbs: nextItem.carbs,
            fat: nextItem.fat
          }
        }
      })

      calculateNutritionStats(updatedItems)
      return updatedItems
    })
  }

  const toggleNutritionDetails = (id: number) => {
    setExpandedNutritionDetailIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  const handleIngredientMetricEdit = (id: number, field: IngredientMetricField, currentValue: number) => {
    const meta = INGREDIENT_METRIC_META[field]
    Taro.showModal({
      title: `修改${meta.label}(${meta.unit})`,
      content: formatIngredientMetricDisplay(field, currentValue),
      // @ts-ignore
      editable: true,
      placeholderText: `请输入${meta.unit}`,
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

        updateIngredientMetricField(id, field, parsed)
      }
    })
  }

  // 调节摄入比例（滑块或其他控件）
  const handleRatioAdjust = (id: number, newRatio: number) => {
    ratioAdjustedRef.current = true
    clearSuspectDistrustTimer()
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

  // 快捷比例：按聚餐人数统一设置所有食物的摄入比例
  const handleQuickRatio = (people: number) => {
    ratioAdjustedRef.current = true
    clearSuspectDistrustTimer()
    const ratio = Math.max(1, Math.min(100, Math.round(100 / people)))
    setNutritionItems(items => {
      const updatedItems = items.map(item => ({
        ...item,
        ratio,
        intake: Math.round(item.weight * (ratio / 100)),
      }))
      calculateNutritionStats(updatedItems)
      return updatedItems
    })
    setQuickRatioSheetVisible(false)
  }

  // 自定义聚餐人数：关闭快捷比例弹窗后弹出输入框
  const handleOpenCustomPeopleRatio = () => {
    setQuickRatioSheetVisible(false)
    setTimeout(() => {
      Taro.showModal({
        title: '自定义聚餐人数',
        content: '',
        // @ts-ignore
        editable: true,
        // @ts-ignore
        placeholderText: '请输入人数（1-99）',
        confirmText: '确定',
        cancelText: '取消',
        success: (res) => {
          if (!res.confirm) return
          const content = String((res as any).content ?? '').trim()
          if (!content) {
            Taro.showToast({ title: '请输入人数', icon: 'none' })
            return
          }
          const parsed = parseInt(content, 10)
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 99) {
            Taro.showToast({ title: '请输入 1-99 的整数', icon: 'none' })
            return
          }
          handleQuickRatio(parsed)
        }
      })
    }, 200)
  }

  const applySuggestedRatio = (id: number) => {
    const target = nutritionItems.find(item => item.id === id)
    if (!target || typeof target.suggestedRatio !== 'number') return
    handleRatioAdjust(id, target.suggestedRatio)
  }

  const applyPackagedCandidate = (id: number, candidate: Record<string, unknown>) => {
    const weight = candidateWeightForNutrition(candidate)
    if (weight <= 0) {
      Taro.showToast({ title: '该规格缺少净含量', icon: 'none' })
      return
    }
    const unit = candidateNutritionUnit(candidate)
    const nutrients = normalizeItemNutrients(scaleNutrients(unit, weight / 100), 0)
    const calories = nutrients.calories > 0
      ? nutrients.calories
      : calculateCaloriesFromMacros(nutrients.protein, nutrients.carbs, nutrients.fat)
    const candidateId = candidateText(candidate, 'packaged_food_id', 'id')
    const nextName = candidateText(candidate, 'display_name', 'displayName', 'name') || '包装食品'
    const netLabel = candidateNetContentLabel(candidate)

    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id !== id) return item
        const ratio = item.ratio > 0 ? item.ratio : 100
        return {
          ...item,
          name: nextName,
          weight,
          originalWeight: weight,
          grossWeight: weight,
          ediblePortionRatio: 100,
          ediblePortionReason: undefined,
          ediblePortionSource: 'packaged_food_library',
          calorie: calories,
          intake: Math.round(weight * (ratio / 100)),
          ratio,
          protein: nutrients.protein,
          carbs: nutrients.carbs,
          fat: nutrients.fat,
          waterMl: nutrients.waterMl || nutrients.water_ml || item.waterMl || 0,
          nutrients: {
            ...nutrients,
            calories,
            protein: nutrients.protein,
            carbs: nutrients.carbs,
            fat: nutrients.fat,
            waterMl: nutrients.waterMl || nutrients.water_ml || 0,
            water_ml: nutrients.waterMl || nutrients.water_ml || 0
          },
          unitNutritionPer100g: unit,
          matchedFoodId: candidateId || item.matchedFoodId,
          packagedFoodId: candidateId || item.packagedFoodId,
          packageMatchStatus: 'matched',
          packageMatchConfidence: 1,
          packageWeightSource: 'packaged_food_library',
          packageWeightApplied: true,
          packageWeightReason: netLabel ? `已选择包装规格 ${netLabel}` : '已选择包装库候选规格',
          nutritionSource: 'packaged_food_library',
          nutritionSourceCategory: 'database',
          isUnresolved: false,
          packagedPending: false
        } as NutritionItem
      })
      calculateNutritionStats(updatedItems)
      return updatedItems
    })
  }

  const buildAnalyzeResultFromItems = (items: NutritionItem[]): AnalyzeResponse => ({
    description,
    insight: healthAdvice,
    items: items.map(item => ({
      name: item.name,
      estimatedWeightGrams: item.weight,
      originalWeightGrams: item.originalWeight,
      grossWeightGrams: item.grossWeight,
      ediblePortionRatio: item.ediblePortionRatio,
      ediblePortionReason: item.ediblePortionReason,
      ediblePortionSource: item.ediblePortionSource,
      suggestedRatio: item.suggestedRatio,
      suggestedRatioReason: item.suggestedRatioReason,
      suggestedRatioSource: item.suggestedRatioSource,
      package_weight_source: item.packageWeightSource,
      package_weight_applied: item.packageWeightApplied,
      package_weight_reason: item.packageWeightReason,
      matched_food_id: item.matchedFoodId,
      packaged_food_id: item.packagedFoodId,
      package_match_status: item.packageMatchStatus,
      package_match_confidence: item.packageMatchConfidence,
      packaged_candidates: item.packagedCandidates,
      nutrition_source: item.nutritionSource,
      nutrition_source_category: item.nutritionSourceCategory,
      is_unresolved: item.isUnresolved,
      unit_nutrition_per_100g: item.unitNutritionPer100g,
      waterMl: item.waterMl,
      nutrients: buildFoodItemNutrients(item)
    })),
    pfc_ratio_comment: pfcRatioComment || undefined,
    eating_order_advice: eatingOrderAdvice || undefined,
    absorption_notes: absorptionNotes || undefined,
    context_advice: contextAdvice || undefined,
    recognitionOutcome,
    rejectionReason: rejectionReason || undefined,
    retakeGuidance: retakeGuidance.length > 0 ? retakeGuidance : undefined,
    allowedFoodCategory,
    followupQuestions: followupQuestions.length > 0 ? followupQuestions : undefined,
  })

  const syncEditedAnalyzeResult = async (items: NutritionItem[]) => {
    const nextResult = buildAnalyzeResultFromItems(items)
    Taro.setStorageSync('analyzeResult', JSON.stringify(nextResult))
    const sourceTaskId = Taro.getStorageSync('analyzeSourceTaskId')
    if (!sourceTaskId) return
    try {
      await updateAnalysisTaskResult(sourceTaskId, nextResult)
    } catch (error) {
      console.error('同步更新 analysis_tasks 失败:', error)
    }
  }

  const openFoodEditDrawer = (item: NutritionItem) => {
    setFoodEditDraft({
      itemId: item.id,
      name: item.name,
      weight: String(roundToSingleDecimal(item.weight || 0)),
      calories: String(Math.round(item.calorie || 0)),
      protein: formatMacroDisplay(item.protein || 0),
      carbs: formatMacroDisplay(item.carbs || 0),
      fat: formatMacroDisplay(item.fat || 0),
      waterMl: String(Math.round(item.waterMl || 0))
    })
  }

  const updateFoodEditDraftField = (field: keyof FoodEditDraft, value: string) => {
    setFoodEditDraft(current => {
      if (!current) return current
      if (field !== 'calories' && field !== 'protein' && field !== 'carbs' && field !== 'fat') {
        return { ...current, [field]: value }
      }
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed < 0) return { ...current, [field]: value }
      const nutrients = applyEnergyEdit({
        calories: Number(current.calories) || 0,
        protein: Number(current.protein) || 0,
        carbs: Number(current.carbs) || 0,
        fat: Number(current.fat) || 0,
        fiber: 0,
        sugar: 0,
      }, field, parsed)
      return {
        ...current,
        calories: field === 'calories' ? value : String(nutrients.calories),
        protein: field === 'protein' ? value : formatMacroDisplay(nutrients.protein),
        carbs: field === 'carbs' ? value : formatMacroDisplay(nutrients.carbs),
        fat: field === 'fat' ? value : formatMacroDisplay(nutrients.fat),
      }
    })
  }

  const parseFoodEditNumber = (value: string) => {
    const parsed = Number(String(value || '').trim())
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  const handleSaveFoodEditDraft = () => {
    if (!foodEditDraft) return
    nutritionAdjustedRef.current = true
    const name = foodEditDraft.name.trim()
    const weight = parseFoodEditNumber(foodEditDraft.weight)
    const calories = parseFoodEditNumber(foodEditDraft.calories)
    const protein = parseFoodEditNumber(foodEditDraft.protein)
    const carbs = parseFoodEditNumber(foodEditDraft.carbs)
    const fat = parseFoodEditNumber(foodEditDraft.fat)
    const waterMl = parseFoodEditNumber(foodEditDraft.waterMl)

    if (!name) {
      Taro.showToast({ title: '名称不能为空', icon: 'none' })
      return
    }
    if (weight == null || weight <= 0) {
      Taro.showToast({ title: '请输入大于0的重量', icon: 'none' })
      return
    }
    if (calories == null || protein == null || carbs == null || fat == null || waterMl == null) {
      Taro.showToast({ title: '营养值需为不小于0的数字', icon: 'none' })
      return
    }

    const nextItems = nutritionItems.map(item => {
        if (item.id !== foodEditDraft.itemId) return item

        const weightChanged = Math.abs(weight - item.weight) > 0.001
        const isPendingPackagedChoice = isPackagedChoicePending(item)
        const nutritionChanged =
          Math.abs(calories - item.calorie) > 0.001 ||
          Math.abs(protein - item.protein) > 0.001 ||
          Math.abs(carbs - item.carbs) > 0.001 ||
          Math.abs(fat - item.fat) > 0.001 ||
          Math.abs(waterMl - item.waterMl) > 0.001
        const weightScale = item.weight > 0 ? weight / item.weight : 1
        const nextProtein = nutritionChanged ? roundToSingleDecimal(protein) : roundToSingleDecimal(item.protein * weightScale)
        const nextCarbs = nutritionChanged ? roundToSingleDecimal(carbs) : roundToSingleDecimal(item.carbs * weightScale)
        const nextFat = nutritionChanged ? roundToSingleDecimal(fat) : roundToSingleDecimal(item.fat * weightScale)
        const nextWaterMl = clampWaterMlForItem(
          nutritionChanged ? Math.round(waterMl) : Math.round(item.waterMl * weightScale),
          weight,
        )
        const nextCalories = nutritionChanged ? Math.round(calories) : Math.round(item.calorie * weightScale)
        const ratio = item.ratio > 0 ? item.ratio : 100
        return {
          ...item,
          name,
          weight: roundToSingleDecimal(weight),
          intake: Math.round(weight * (ratio / 100)),
          calorie: nextCalories,
          protein: nextProtein,
          carbs: nextCarbs,
          fat: nextFat,
          waterMl: nextWaterMl,
          nutrients: {
            ...item.nutrients,
            calories: nextCalories,
            protein: nextProtein,
            carbs: nextCarbs,
            fat: nextFat,
            waterMl: nextWaterMl,
            water_ml: nextWaterMl
          },
          nutritionEdited: nutritionChanged || item.nutritionEdited,
          nutritionSource: nutritionChanged ? 'user_correction_context' : item.nutritionSource,
          nutritionSourceCategory: nutritionChanged ? 'user_correction_context' : item.nutritionSourceCategory,
          packageMatchStatus: isPendingPackagedChoice ? 'user_confirmed' : item.packageMatchStatus,
          packageWeightSource: weightChanged || isPendingPackagedChoice ? 'user_context' : item.packageWeightSource,
          packageWeightApplied: weightChanged || isPendingPackagedChoice ? true : item.packageWeightApplied,
          packageWeightReason: weightChanged || isPendingPackagedChoice ? '用户在结果页手动修改重量' : item.packageWeightReason,
          packagedPending: false
        } as NutritionItem
      })
    calculateNutritionStats(nextItems)
    setNutritionItems(nextItems)
    setFoodEditDraft(null)
    Taro.showToast({ title: '已修改', icon: 'success' })
    void syncEditedAnalyzeResult(nextItems)
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

  /** 保存记录：saveOnly=true 仅保存，false 保存后跳详情页 */
  const openSnackContribution = (item: NutritionItem) => {
    const unit = nutrientPer100FromItem(item)
    const sourceTaskId = String(Taro.getStorageSync('analyzeSourceTaskId') || '').trim()
    Taro.setStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY, {
      itemId: item.id,
      sourceTaskId: sourceTaskId || undefined,
      recognizedNameHint: item.name,
      brand: '',
      productName: item.name,
      flavorText: '',
      packageCategory: item.category || item.itemType || '',
      specText: '',
      barcode: '',
      ingredientsText: '',
      netWeightG: String(Math.max(1, Math.round(item.weight || item.intake || item.originalWeight || 1))),
      servingWeightG: '',
      calories: String(Math.round(unit.calories || 0)),
      protein: formatMacroDisplay(unit.protein || 0),
      carbs: formatMacroDisplay(unit.carbs || 0),
      fat: formatMacroDisplay(unit.fat || 0),
      fiber: formatMacroDisplay(unit.fiber || 0),
      sugar: formatMacroDisplay(unit.sugar || 0),
      sodiumMg: String(Math.round(unit.sodiumMg || unit.sodium_mg || 0)),
      saturatedFat: '',
      cholesterolMg: '',
      potassiumMg: '',
      calciumMg: '',
      ironMg: '',
      magnesiumMg: '',
      zincMg: '',
      vitaminARaeMcg: '',
      vitaminCMg: '',
      vitaminDMcg: '',
      vitaminEMg: '',
      vitaminKMcg: '',
      thiaminMg: '',
      riboflavinMg: '',
      niacinMg: '',
      vitaminB6Mg: '',
      folateMcg: '',
      vitaminB12Mcg: '',
    })
    Taro.navigateTo({ url: extraPkgUrl('/pages/packaged-food-edit/index') })
  }

  const numberFromDraft = (value: string) => {
    const n = Number(String(value || '').trim())
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  const updateSnackDraftField = (field: keyof SnackContributionDraft, value: string) => {
    setSnackDraft(current => current ? { ...current, [field]: value } : current)
  }

  const handleSubmitSnackContribution = async () => {
    if (!snackDraft || savingSnackDraft) return
    const productName = snackDraft.productName.trim()
    const netWeightG = numberFromDraft(snackDraft.netWeightG)
    if (!productName) {
      Taro.showToast({ title: '请填写包装食品名称', icon: 'none' })
      return
    }
    if (netWeightG <= 0) {
      Taro.showToast({ title: '请填写重量', icon: 'none' })
      return
    }
    const payload: CreatePackagedFoodRequest = {
      brand: snackDraft.brand.trim() || undefined,
      product_name: productName,
      net_weight_g: netWeightG,
      serving_weight_g: netWeightG,
      kcal_per_100g: numberFromDraft(snackDraft.calories),
      protein_per_100g: numberFromDraft(snackDraft.protein),
      carbs_per_100g: numberFromDraft(snackDraft.carbs),
      fat_per_100g: numberFromDraft(snackDraft.fat),
      fiber_per_100g: numberFromDraft(snackDraft.fiber),
      sugar_per_100g: numberFromDraft(snackDraft.sugar),
      sodium_mg_per_100g: numberFromDraft(snackDraft.sodiumMg),
    }
    setSavingSnackDraft(true)
    Taro.showLoading({ title: '', mask: true })
    try {
      await createPackagedFood(payload)
      setNutritionItems(items => items.map(item => (
        item.id === snackDraft.itemId
          ? { ...item, nutritionSource: 'packaged_food_library', nutritionSourceCategory: 'database', isUnresolved: false }
          : item
      )))
      setSnackDraft(null)
      Taro.hideLoading()
      Taro.showToast({ title: '已保存到包装食品库', icon: 'success' })
    } catch (error) {
      Taro.hideLoading()
      await showUnifiedApiError(error, '保存包装食品数据失败')
    } finally {
      setSavingSnackDraft(false)
    }
  }

  const saveRecord = async (saveOnly: boolean, confirmedMealType?: SelectableMealType) => {
    // 避免用户快速连续点击导致重复保存
    if (saving) return
    if (nutritionItems.some(isPackagedChoicePending)) {
      Taro.showToast({ title: '请先选择包装食品规格', icon: 'none' })
      return
    }
    // 从缓存获取分析时选择的状态
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
    const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')

    // 确定餐次：优先使用确认过的餐次，否则尝试从缓存读取，最后按当前时间推断
    const mealType = confirmedMealType || normalizeSelectableMealType(savedMealType, defaultMealType)
    const mealLabel = getMealTypeLabel(mealType)

    // 饮食目标和时机，未找到默认无
    const dietGoal = savedDietGoal || 'none'
    const activityTiming = savedActivityTiming || 'none'

    const doSave = async () => {
      if (isAnalyzeSessionCommitted()) {
        Taro.showToast({ title: '该餐已记录', icon: 'none' })
        return
      }
      // 保存前根据用户编辑行为提交对应的反馈样本
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
        // 清除相关缓存
        Taro.removeStorageSync('analyzeMealType')
        Taro.removeStorageSync('analyzeDietGoal')
        Taro.removeStorageSync('analyzeActivityTiming')

        const sourceTaskId = Taro.getStorageSync('analyzeSourceTaskId') || undefined
        const payload: SaveFoodRecordRequest = {
          date: getStoredRecordTargetDate(),
          meal_type: mealType as MealType,
          image_path: hasUploadableImage ? (imagePath || undefined) : undefined,
          image_paths: hasUploadableImage && imagePaths.length > 0 ? imagePaths : undefined,
          description: description || undefined,
          insight: healthAdvice || undefined,
          items: nutritionItems.map((item) => buildFoodRecordItemPayloadFromResultItem(
            item,
            buildFoodItemNutrients(item),
          )),
          total_calories: nutritionStats.calories,
          total_protein: nutritionStats.protein,
          total_carbs: nutritionStats.carbs,
          total_fat: nutritionStats.fat,
          total_weight_grams: totalWeight,
          diet_goal: dietGoal,
          activity_timing: activityTiming,
          eating_mood: eatingMood || undefined,
          pfc_ratio_comment: pfcRatioComment ?? undefined,
          absorption_notes: absorptionNotes ?? undefined,
          context_advice: contextAdvice ?? undefined,
          source_task_id: sourceTaskId,
          entry_type: taskType === 'food_text' ? 'food_text' : 'food_image',
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
        const targetDateKey = payload.date || getStoredRecordTargetDate() || formatDateKey(new Date())
        if (!saveResult.already_saved) {
          applyOptimisticFoodRecordToHomeDashboardSnapshot(targetDateKey, payload, saveResult.id)
          addWaterToBodyMetricsStorage(targetDateKey, calculateFoodRecordItemsWaterMl(payload.items || []))
        }
        try {
          Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDateKey })
        } catch {
          /* ignore */
        }
        try {
          await refreshHomeDashboardLocalSnapshotFromCloud(targetDateKey)
        } catch {
          /* ignore */
        }
        try {
          Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDateKey, force: true })
        } catch {
          /* ignore */
        }
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
          returnHomeAfterFoodRecord(800)
          return
        }

        Taro.showToast({
          title: saveResult.already_saved ? '该餐已记录，未重复发布' : '记录成功',
          icon: saveResult.already_saved ? 'none' : 'success',
        })
        returnHomeAfterFoodRecord()
      } catch (e: any) {
        await showUnifiedApiError(e, '保存失败')
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
      // 优先使用 analyze-history 列表传入的 record_id，其次使用当前会话保存后设置的 id
      const rid = Taro.getStorageSync('analyzeCommittedRecordId') || committedRecordId
      if (!rid || rid === 'history') {
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

  /** 点击保存按钮：分析入口已选过餐次，直接按既有餐次保存 */
  const handleConfirmAndShare = () => {
    if (isAnalyzeSessionCommitted() || committedRecordId) {
      handleViewCommittedResult()
      return
    }
    saveRecord(false, getSavedSelectableMealType(defaultMealType))
  }

  const handleOpenLibraryUpload = () => {
    if (!hasUploadableImage) {
      Taro.showToast({ title: '当前结果没有可上传的实物图片', icon: 'none' })
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
	if (savedRecipeId) {
		Taro.showToast({ title: '该餐食已收藏', icon: 'none' })
		return
	}
	if (recipeSaveInFlightRef.current) return
    // 检查登录
    const token = getAccessToken()
    if (!token) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (nutritionItems.some(isPackagedChoicePending)) {
      Taro.showToast({ title: '请先选择包装食品规格', icon: 'none' })
      return
    }

    // 获取餐次信息
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const mealType = normalizeSelectableMealType(savedMealType, defaultMealType)
    // 与“记录”后展示在圈子中的标题保持一致：优先使用识别描述。
    // 当识别描述缺失时，再用本次识别到的食物名称兜底，确保弹窗始终预填一个可编辑名称。
    const defaultRecipeName = description.trim()
      || nutritionItems
        .map((item) => item.name.trim())
        .filter(Boolean)
        .join('、')
      || `${getMealTypeLabel(mealType)}餐食`

    // 弹窗输入收藏名称
    Taro.showModal({
      title: '收藏食物',
      // 在微信小程序的 editable modal 中，content 就是输入框的初始值；
      // 原先把提示语放在这里，导致它被当作可编辑的黑色正文保存。
      content: defaultRecipeName,
      // @ts-ignore
      editable: true,
      // @ts-ignore
      placeholderText: '请输入收藏名称',
      success: async (res) => {
        if (res.confirm && (res as any).content) {
          const recipeName = (res as any).content.trim()
        if (!recipeName) {
            Taro.showToast({ title: '请输入食谱名称', icon: 'none' })
          return
        }
		if (recipeSaveInFlightRef.current) return
		recipeSaveInFlightRef.current = true
		setSavingRecipe(true)

          Taro.showLoading({ title: '保存中...', mask: true })

          try {
            // 构建食谱数据
            const recipeItems = nutritionItems.map((nutritionItem) => buildFoodRecordItemPayloadFromResultItem(
              nutritionItem,
              buildFoodItemNutrients(nutritionItem),
            ))

			const createdRecipe = await createUserRecipe({
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
              tags: ['自定义'],
			  is_favorite: true,
			  source_task_id: String(Taro.getStorageSync('analyzeSourceTaskId') || '').trim() || undefined,
            })
			setSavedRecipeId(createdRecipe.id)

            Taro.hideLoading()
            Taro.showModal({
              title: '收藏成功',
              content: '已收藏，可在“我的收藏”中快速复用记录',
              showCancel: false
            })
          } catch (error: any) {
            Taro.hideLoading()
            Taro.showToast({
              title: error.message || '保存失败',
              icon: 'none'
            })
		  } finally {
			recipeSaveInFlightRef.current = false
			setSavingRecipe(false)
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
        grossWeight: 100,
        ediblePortionRatio: 1,
        calorie: 0,
        intake: 100,
        ratio: 100,
        protein: 0,
        carbs: 0,
        fat: 0,
        waterMl: 0,
        nutrients: normalizeItemNutrients(undefined, 0)
      }
    ])
  }

  // 提交二次纠正重新分析
  const handleSubmitCorrection = async () => {
    if (isResubmitting) return
    const now = Date.now()
    if (now - correctionSubmitDebounceRef.current < CORRECTION_SUBMIT_DEBOUNCE_MS) return
    correctionSubmitDebounceRef.current = now

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

    // 图片数量限制校验
    const draftImageCount = imagePaths.length > 0 ? imagePaths.length : (imagePath ? 1 : 0)
    if (draftImageCount > MAX_ANALYZE_IMAGES) {
      Taro.showToast({ title: `最多支持 ${MAX_ANALYZE_IMAGES} 张图片`, icon: 'none' })
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
          Taro.showLoading({ title: '提交纠错中...', mask: true })
          const resolvedCorrectionItems = correctionItems.map((item) => ({ ...item }))
          setCorrectionItems(resolvedCorrectionItems)

          // 2. 获取原请求的基础配置
          const savedMealType = Taro.getStorageSync('analyzeMealType') as MealType | undefined
          const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
          const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')
          const savedExecutionMode = normalizeRuntimeExecutionMode(Taro.getStorageSync('analyzeExecutionMode') || executionMode)
          const savedAnalysisEngine = normalizeAnalysisEngine(Taro.getStorageSync(ANALYSIS_ENGINE_STORAGE_KEY), savedExecutionMode)
          const correctionSourceTaskId = String(Taro.getStorageSync('analyzeSourceTaskId') || '').trim()
          const previousResult: AnalyzeResponse = {
            description,
            insight: healthAdvice,
            items: buildCorrectionPreviousResultItems(nutritionItems, buildFoodItemNutrients),
            pfc_ratio_comment: pfcRatioComment || undefined,
            eating_order_advice: eatingOrderAdvice || undefined,
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
              const weightChanged = hasCorrectionWeightChanged(item.weight, baseline.weight)
              if (nameChanged && weightChanged) {
                editDescriptions.push(`将"${baseline.name}"改为"${item.name.trim()}"，重量改为${formatCorrectionWeight(item.weight)}g`)
              } else if (nameChanged) {
                editDescriptions.push(`将"${baseline.name}"改为"${item.name.trim()}"`)
              } else if (weightChanged) {
                editDescriptions.push(`将"${item.name.trim()}"的重量改为${formatCorrectionWeight(item.weight)}g`)
              }
            } else {
              editDescriptions.push(`新增食物"${item.name.trim()}" ${formatCorrectionWeight(item.weight)}g`)
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
          const correctionPayload = buildCorrectionItemsPayload(
            resolvedCorrectionItems,
            nutritionItems,
            buildFoodItemNutrients,
          )

          let taskId = ''

          const shouldResubmitWithImage = taskType === 'food' && (imagePaths.length > 0 || !!imagePath)

          if (shouldResubmitWithImage) {
            const res = await submitAnalyzeTask({
              image_url: imagePaths[0] || imagePath,
              image_urls: imagePaths.length > 0 ? imagePaths : undefined,
              date: getStoredRecordTargetDate(),
              additionalContext: finalCorrectionContext,
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming,
              execution_mode: savedExecutionMode,
              analysis_engine: savedAnalysisEngine,
              suggest_ratio_enabled: readSuggestRatioPreference(),
              previousResult,
              correction_source_task_id: correctionSourceTaskId || undefined,
              correctionItems: correctionPayload,
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
              date: getStoredRecordTargetDate(),
              additionalContext: textContextParts.join('\n'),
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming,
              execution_mode: savedExecutionMode,
              suggest_ratio_enabled: readSuggestRatioPreference(),
              previousResult,
              correction_source_task_id: correctionSourceTaskId || undefined,
              correctionItems: correctionPayload,
            })
            taskId = res.task_id
          }
          Taro.removeStorageSync('analyzePendingCorrectionTaskId')
          Taro.removeStorageSync('analyzePendingCorrectionItems')

          const nextTaskType = shouldResubmitWithImage ? 'food' : 'food_text'
          Taro.setStorageSync('analyzeTaskType', nextTaskType)
          if (!shouldResubmitWithImage) {
            Taro.removeStorageSync('analyzeImagePath')
            Taro.removeStorageSync('analyzeImagePaths')
          }

          Taro.hideLoading()
          setShowCorrectionDrawer(false)
          setAdditionalContext('')
          Taro.navigateTo({
            url: `${extraPkgUrl('/pages/analyze-loading/index')}?task_id=${taskId}&task_type=${nextTaskType}&execution_mode=${savedExecutionMode}&correction=1`
          })

        } catch (e: any) {
          Taro.hideLoading()
          await showUnifiedApiError(e, '重新分析失败')
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

  const pendingPackagedChoiceCount = nutritionItems.filter(isPackagedChoicePending).length

  return (
    <View className={`result-page ${scheme === 'dark' ? 'result-page--dark' : ''}`}>
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
              <Text className='placeholder-text'>{textRecordInput || '文字记录，未提供实物照片'}</Text>
            </View>
          )}
          <View className='scanner-hero-gradient' />
          {imagePaths.length > 1 && (
            <View className='image-counter'>
              <Text className='counter-text'>{currentImageIndex + 1}/{imagePaths.length}</Text>
            </View>
          )}
          {imagePaths.length > 1 && (
            <View className='image-batch-badge result-batch-badge'>
              <Text className='image-batch-badge-text'>共 {imagePaths.length} 张</Text>
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
                  {getExecutionModeLabel(executionMode)}
                </Text>
              </View>
              <View className='analysis-engine-result-tag'>
                <Text className='analysis-engine-result-tag-text'>
                  {ANALYSIS_ENGINE_OPTIONS.find(option => option.value === analysisEngine)?.label || '营养估算'}
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
                  <Text className='recognition-status-label'>识别判定</Text>
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
                  <Text className='followup-question-title'>补充后再分析会更接近真实份量</Text>
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
                  <Text className='followup-question-label'>下一步</Text>
                  <Text className='followup-question-title'>
                    {precisionStatus === 'needs_retake' ? '这轮可以先重拍再继续' : '这轮也可以继续补充更多信息'}
                  </Text>
                </View>
              </View>
              <Text className='followup-question-desc'>
                不补充也可以直接记录当前结果，下面这些只是可选增强。
              </Text>
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
                <Text className='followup-question-desc'>
                  默认会记住你当前选中的参考物和尺寸，下次可直接复用。
                </Text>
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

          {pendingPackagedChoiceCount > 0 && (
            <View className='packaged-pending-banner'>
              <Text className='packaged-pending-banner-text'>
                {pendingPackagedChoiceCount} 个包装食品规格待确认，暂未计入总热量
              </Text>
            </View>
          )}

          {/* AI 饮食分析（隐藏调试文案，仅展示最终可读结论） */}
          {nutritionItems.length > 0 && (
            <View className='insight-card'>
              <View
                className='card-header insight-card-header-toggle'
                onClick={() => {
                  const next = !insightCollapsed
                  setInsightCollapsed(next)
                  setAiInsightCollapsed(next)
                }}
              >
                <Text className='card-title'>
                  <Text className='iconfont icon-a-144-lvye'></Text>
                  AI 饮食分析
                </Text>
                <View className='insight-toggle-affordance'>
                  <Text className={`insight-toggle-icon ${insightCollapsed ? 'collapsed' : ''}`}>▼</Text>
                  <Text className='insight-toggle-text'>{insightCollapsed ? '展开' : '收起'}</Text>
                </View>
              </View>

              {!insightCollapsed && (
                <>
                  <View className='insight-item ratio-advice'>
                <View className='insight-icon-wrapper orange'>
                  <Text className='insight-icon iconfont icon-tubiao-zhuzhuangtu'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>饮食比例建议</Text>
                  <Text className='insight-content'>{ratioAdviceText}</Text>
                </View>
              </View>

              <View className='insight-item ratio'>
                <View className='insight-icon-wrapper orange'>
                  <Text className='insight-icon iconfont icon-tubiao-zhuzhuangtu'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>营养比例</Text>
                  <Text className='insight-content'>{pfcRatioDisplayText}</Text>
                </View>
              </View>

              <View className='insight-item eating-order'>
                <View className='insight-icon-wrapper teal'>
                  <Text className='insight-icon iconfont icon-shizhong'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>进食顺序</Text>
                  <Text className='insight-content'>{eatingOrderDisplayText}</Text>
                </View>
              </View>

              <View className='insight-item absorption'>
                <View className='insight-icon-wrapper purple'>
                  <Text className='insight-icon iconfont icon-huore'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>吸收与利用</Text>
                  <Text className='insight-content'>{absorptionDisplayText}</Text>
                </View>
              </View>

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
                </>
              )}
            </View>
          )}

          {/* 包含成分 */}
          <View className='ingredients-section'>
            <View className='section-title-row'>
              <View className='section-title-group'>
                <Text className='section-title'>食物明细</Text>
                <Text className='section-count'>({nutritionItems.length}种)</Text>
              </View>
              <Text className='quick-ratio-btn' onClick={() => setQuickRatioSheetVisible(true)}>快捷比例</Text>
            </View>

            <Text className='section-ratio-hint'>每种食物可单独调整实际食用比例</Text>

            <View className='ingredients-list'>
              {nutritionItems.map((item) => {
                const detailRows = getNutrientDetailRows(item)
                const per100 = item.unitNutritionPer100g || nutrientPer100FromItem(item)
                const detailsExpanded = !!expandedNutritionDetailIds[item.id]
                const ediblePortionHint = getEdiblePortionHint(item)
                const packageChoicePending = isPackagedChoicePending(item)
                const packagedCandidates = item.packagedCandidates || []
                return (
                <View key={item.id} className='ingredient-card'>
                  <View className='ingredient-main'>
                    <View className='ingredient-header ingredient-header--title-row'>
                      <Text className='ingredient-name'>{item.name}</Text>
                      <View className='ingredient-header-actions'>
                        <View className='edit-icon-wrapper edit-icon-wrapper--with-label' onClick={() => openFoodEditDrawer(item)}>
                          <Text className='iconfont icon-shouxieqianming'></Text>
                          <Text className='edit-icon-label'>编辑</Text>
                        </View>
                        <View className='delete-icon-wrapper' onClick={() => handleDeleteItem(item.id, item.name)}>
                          <Text className='delete-icon'>×</Text>
                        </View>
                      </View>
                    </View>
                    <Text className='ingredient-basis-label'>当前整份营养（约 {Math.round(item.weight)}g）</Text>
                    <Text className='ingredient-per100-label'>每100g参考：{Math.round(per100.calories || 0)} kcal · 蛋白 {formatMacroDisplay(per100.protein || 0)}g · 碳水 {formatMacroDisplay(per100.carbs || 0)}g · 脂肪 {formatMacroDisplay(per100.fat || 0)}g</Text>
                    {ediblePortionHint && (
                      <View className='ingredient-edible-portion-hint'>
                        <Text className='ingredient-edible-portion-hint-text'>{ediblePortionHint}</Text>
                      </View>
                    )}
                  </View>

                  {isSnackLikeItem(item) && (
                    <View className='snack-contribution-card'>
                      <View className='snack-contribution-copy'>
                        <Text className='snack-contribution-title'>识别为包装食品</Text>
                        <Text className='snack-contribution-desc'>
                          当前营养值会先按普通食物流程估算。你可以补充包装上的重量和营养成分，帮助完善包装食品数据库。
                        </Text>
                      </View>
                      <View className='snack-contribution-action' onClick={() => openSnackContribution(item)}>
                        <Text className='snack-contribution-action-text'>添加包装食品</Text>
                      </View>
                    </View>
                  )}

                  {packageChoicePending && (
                    <View className='packaged-choice-card'>
                      <View className='packaged-choice-header'>
                        <Text className='packaged-choice-title'>请选择包装规格</Text>
                        <Text className='packaged-choice-subtitle'>图片未读到净含量，先不自动套重量</Text>
                      </View>
                      <View className='packaged-choice-list'>
                        {packagedCandidates.map((candidate, candidateIndex) => {
                          const candidateName = candidateText(candidate, 'display_name', 'displayName', 'name') || item.name
                          const netLabel = candidateNetContentLabel(candidate)
                          const imageUrl = candidateSourceImage(candidate)
                          const unit = candidateNutritionUnit(candidate)
                          const basisLabel = candidateNutritionBasisLabel(candidate)
                          const hasNutrition = candidateHasDisplayNutrition(unit)
                          const kcal = Math.round(unit.calories || 0)
                          const protein = formatMacroDisplay(unit.protein || 0)
                          const carbs = formatMacroDisplay(unit.carbs || 0)
                          const fat = formatMacroDisplay(unit.fat || 0)
                          return (
                            <View
                              key={`${item.id}-packaged-candidate-${candidateText(candidate, 'id', 'packaged_food_id') || candidateIndex}`}
                              className='packaged-choice-option'
                              onClick={() => applyPackagedCandidate(item.id, candidate)}
                            >
                              {imageUrl ? (
                                <Image className='packaged-choice-image' src={imageUrl} mode='aspectFill' />
                              ) : (
                                <View className='packaged-choice-image packaged-choice-image--empty'>
                                  <Text className='iconfont icon-tupian' />
                                </View>
                              )}
                              <View className='packaged-choice-body'>
                                <Text className='packaged-choice-name'>{candidateName}</Text>
                                <Text className='packaged-choice-meta'>
                                  {hasNutrition
                                    ? `${netLabel || '规格待确认'} · ${kcal} kcal/${basisLabel} · 蛋白 ${protein}g · 碳水 ${carbs}g · 脂肪 ${fat}g`
                                    : `${netLabel || '规格待确认'} · 营养信息待确认`}
                                </Text>
                              </View>
                              <View className='packaged-choice-pick'>
                                <Text className='packaged-choice-pick-text'>选择</Text>
                              </View>
                            </View>
                          )
                        })}
                      </View>
                    </View>
                  )}

                  {!packageChoicePending && (
                    <>
                  <View className='ingredient-nutrition-strip'>
                    <View
                      className='ingredient-summary-cell ingredient-summary-cell--cal'
                      onClick={() => handleIngredientMetricEdit(item.id, 'calories', item.calorie)}
                    >
                      <Text className='ingredient-summary-label'>热量</Text>
                      <View className='ingredient-cal-kcal-line'>
                        <Text className='ingredient-cal-kcal-num'>
                          {Math.round(item.calorie * (item.ratio / 100))}
                        </Text>
                        <Text className='ingredient-cal-kcal-unit'>kcal</Text>
                      </View>
                    </View>
                    {INGREDIENT_METRIC_FIELDS.map((field) => {
                      const meta = INGREDIENT_METRIC_META[field]
                      const intakeValue = item[field] * (item.ratio / 100)
                      return (
                        <View
                          key={`${item.id}-${field}`}
                          className={`ingredient-summary-cell ingredient-summary-cell--${meta.className}`}
                          onClick={() => handleIngredientMetricEdit(item.id, field, item[field])}
                        >
                          <Text className='ingredient-summary-label'>{meta.label}</Text>
                          <View className='ingredient-macro-value-line'>
                            <Text className={`ingredient-macro-num ingredient-macro-num--${meta.className}`}>
                              {formatIngredientMetricDisplay(field, intakeValue)}
                            </Text>
                            <Text className='ingredient-macro-g'>{meta.unit}</Text>
                          </View>
                        </View>
                      )
                    })}
                  </View>

                  {detailRows.length > 0 && (
                    <View className='ingredient-more-section'>
                      <View className='ingredient-more-toggle' onClick={() => toggleNutritionDetails(item.id)}>
                        <Text className='ingredient-more-toggle-text'>
                          {detailsExpanded ? '收起更多营养' : '展开更多营养'}
                        </Text>
                        <Text className={`iconfont icon-right ingredient-more-toggle-icon ${detailsExpanded ? 'expanded' : ''}`} />
                      </View>
                      {detailsExpanded && (
                        <View className='ingredient-detail-grid'>
                          {detailRows.map((row) => (
                            <View key={`${item.id}-${row.key}`} className='ingredient-detail-cell'>
                              <Text className='ingredient-detail-label'>{row.label}</Text>
                              <Text className='ingredient-detail-value'>
                                {formatNutrientDetailValue(row.value)}
                                <Text className='ingredient-detail-unit'>{row.unit}</Text>
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  <View className='ingredient-controls'>
                    <View className='weight-control'>
                      <Text className='control-label'>估算重量</Text>
                      {item.ediblePortionRatio > 0 && item.ediblePortionRatio < 99 && (
                        <Text className='control-sub-label'>原始约 {Math.round(item.grossWeight)}g · 可食 {Math.round(item.ediblePortionRatio)}%</Text>
                      )}
                      <View className='weight-adjuster'>
                        <View
                          className='adjust-btn minus'
                          onClick={() => handleWeightAdjust(item.id, -10)}
                        >–</View>
                        <Text className='weight-display'>{formatWeightDisplay(item.weight)}</Text>
                        <View
                          className='adjust-btn plus'
                          onClick={() => handleWeightAdjust(item.id, 10)}
                        >+</View>
                      </View>
                    </View>

                    <View className='ratio-control'>
                      <View className='ratio-control-main'>
                        <View className='ratio-label-wrap'>
                          <Text className='control-label'>实际摄入</Text>
                          <Text className='control-sub-label'>约 {formatWeightDisplay(item.intake)}</Text>
                        </View>
                        <View className='ratio-control-right'>
                          <View className='ratio-slider-shell'>
                            <View className='ratio-slider-hitbox'>
                              <Slider
                                className='ratio-slider-modern'
                                value={item.ratio}
                                min={0}
                                max={100}
                                step={1}
                                activeColor='#00bc7d'
                                backgroundColor={scheme === 'dark' ? '#2d3935' : '#dbe4dd'}
                                blockSize={24}
                                blockColor='#ffffff'
                                showValue={false}
                                onChanging={(e) => handleRatioAdjust(item.id, e.detail.value)}
                                onChange={(e) => handleRatioAdjust(item.id, e.detail.value)}
                              />
                            </View>
                          </View>
                          <Text className='ratio-display'>{item.ratio}%</Text>
                        </View>
                      </View>
                      {item.suggestedRatioSource === 'ai' && typeof item.suggestedRatio === 'number' && item.suggestedRatio !== item.ratio && (
                        <View className='ratio-suggestion-row' onClick={() => applySuggestedRatio(item.id)}>
                          <Text className='ratio-suggestion-text'>AI识别比例 {item.suggestedRatio}%</Text>
                          <Text className='ratio-suggestion-apply'>一键应用</Text>
                        </View>
                      )}
                    </View>
                  </View>
                    </>
                  )}
                </View>
                )
              })}
            </View>
          </View>
        </View>
        </View>
      </ScrollView>

      {/* 底部固定栏：必须放在 scroll-view 外，避免 iOS 上 fixed 相对滚动容器失效 */}
      <View className='footer-actions'>
        {(taskType === 'food' || taskType === 'food_text') && !isAnalyzeSessionCommitted() && !committedRecordId && (
          <View className='eating-mood-bar'>
            <View className='eating-mood-heading'>
              <Text className='eating-mood-title'>此刻心情</Text>
              <Text className='eating-mood-hint'>可选</Text>
            </View>
            <ScrollView className='eating-mood-options' scrollX showScrollbar={false}>
              <View className='eating-mood-options-inner'>
                {EATING_MOOD_OPTIONS.map((option) => (
                  <View
                    key={option.value}
                    className={`eating-mood-option ${eatingMood === option.value ? 'active' : ''}`}
                    onClick={() => setEatingMood(current => current === option.value ? null : option.value)}
                  >
                    <Text className='eating-mood-emoji'>{option.emoji}</Text>
                    <Text className='eating-mood-label'>{option.label}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
        <View className='pba-safe-area'>
          <View className='action-grid'>
            <View
              className={`secondary-btn ${savingRecipe ? 'loading' : ''} ${savedRecipeId ? 'is-favorited' : ''}`}
              onClick={handleSaveAsRecipe}
            >
			  {savingRecipe ? <View className='btn-spinner' /> : <Text className='btn-text'>{savedRecipeId ? '已收藏' : '收藏餐食'}</Text>}
            </View>
            <View
              className={`primary-btn ${saving ? 'loading' : ''} ${pendingPackagedChoiceCount > 0 ? 'needs-spec' : ''} ${isAnalyzeSessionCommitted() || committedRecordId ? 'is-committed' : ''}`}
              onClick={handleConfirmAndShare}
            >
              {saving ? (
                <View className='btn-spinner' />
              ) : (
                <Text className='btn-text'>
                  {isAnalyzeSessionCommitted() || committedRecordId
                    ? '查看结果'
                    : pendingPackagedChoiceCount > 0
                      ? '选规格'
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

      <MealTypeSelectSheet
        visible={showMealSelector}
        value={selectedMealType}
        title='选择餐次'
        confirmText='保存记录'
        onChange={setSelectedMealType}
        onCancel={() => setShowMealSelector(false)}
        onConfirm={handleConfirmMealType}
      />

      <View
        className={`food-edit-drawer-overlay ${foodEditDraft ? 'visible' : ''}`}
        onClick={() => setFoodEditDraft(null)}
      >
        <View
          className={`food-edit-drawer-content ${foodEditDraft ? 'slide-up' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <View className='drawer-header'>
            <Text className='drawer-title'>修改食物</Text>
            <View className='drawer-close' onClick={() => setFoodEditDraft(null)}>
              <Text className='close-icon'>×</Text>
            </View>
          </View>
          {foodEditDraft && (
            <ScrollView className='drawer-scroll food-edit-drawer-scroll' scrollY>
              <View className='food-edit-section'>
                <Text className='food-edit-section-title'>基础信息</Text>
                <View className='food-edit-field'>
                  <Text className='food-edit-label'>名称</Text>
                  <Input
                    className='food-edit-input'
                    value={foodEditDraft.name}
                    placeholder='食物名称'
                    onInput={(e: any) => updateFoodEditDraftField('name', e.detail.value)}
                  />
                </View>
                <View className='food-edit-field food-edit-field--with-unit'>
                  <Text className='food-edit-label'>估算重量</Text>
                  <Input
                    className='food-edit-input'
                    type='digit'
                    value={foodEditDraft.weight}
                    placeholder='重量'
                    onInput={(e: any) => updateFoodEditDraftField('weight', e.detail.value)}
                  />
                  <Text className='food-edit-unit'>g</Text>
                </View>
              </View>
              <View className='food-edit-section'>
                <Text className='food-edit-section-title'>整份营养</Text>
                <View className='food-edit-grid'>
                  <View className='food-edit-field food-edit-field--with-unit'>
                    <Text className='food-edit-label'>热量</Text>
                    <Input className='food-edit-input' type='digit' value={foodEditDraft.calories} placeholder='热量' onInput={(e: any) => updateFoodEditDraftField('calories', e.detail.value)} />
                    <Text className='food-edit-unit'>kcal</Text>
                  </View>
                  <View className='food-edit-field food-edit-field--with-unit'>
                    <Text className='food-edit-label'>蛋白质</Text>
                    <Input className='food-edit-input' type='digit' value={foodEditDraft.protein} placeholder='蛋白质' onInput={(e: any) => updateFoodEditDraftField('protein', e.detail.value)} />
                    <Text className='food-edit-unit'>g</Text>
                  </View>
                  <View className='food-edit-field food-edit-field--with-unit'>
                    <Text className='food-edit-label'>碳水</Text>
                    <Input className='food-edit-input' type='digit' value={foodEditDraft.carbs} placeholder='碳水' onInput={(e: any) => updateFoodEditDraftField('carbs', e.detail.value)} />
                    <Text className='food-edit-unit'>g</Text>
                  </View>
                  <View className='food-edit-field food-edit-field--with-unit'>
                    <Text className='food-edit-label'>脂肪</Text>
                    <Input className='food-edit-input' type='digit' value={foodEditDraft.fat} placeholder='脂肪' onInput={(e: any) => updateFoodEditDraftField('fat', e.detail.value)} />
                    <Text className='food-edit-unit'>g</Text>
                  </View>
                  <View className='food-edit-field food-edit-field--with-unit food-edit-field--wide'>
                    <Text className='food-edit-label'>含水量</Text>
                    <Input className='food-edit-input' type='digit' value={foodEditDraft.waterMl} placeholder='含水量' onInput={(e: any) => updateFoodEditDraftField('waterMl', e.detail.value)} />
                    <Text className='food-edit-unit'>ml</Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
          <View className='food-edit-footer'>
            <View className='food-edit-cancel' onClick={() => setFoodEditDraft(null)}>
              <Text className='food-edit-cancel-text'>取消</Text>
            </View>
            <View className='food-edit-save' onClick={handleSaveFoodEditDraft}>
              <Text className='food-edit-save-text'>保存修改</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 二次纠错抽屉弹窗 */}
      <View
        className={`snack-drawer-overlay ${snackDraft ? 'visible' : ''}`}
        onClick={() => setSnackDraft(null)}
      >
        <View
          className={`snack-drawer-content ${snackDraft ? 'slide-up' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <View className='drawer-header'>
            <Text className='drawer-title'>添加包装食品数据</Text>
            <View className='drawer-close' onClick={() => setSnackDraft(null)}>
              <Text className='close-icon'>×</Text>
            </View>
          </View>
          {snackDraft && (
            <ScrollView className='drawer-scroll snack-drawer-scroll' scrollY>
              <View className='snack-form-section'>
                <Text className='snack-form-label'>基础信息</Text>
                <Input
                  className='snack-form-input'
                  value={snackDraft.productName}
                  placeholder='包装食品名称'
                  onInput={(e: any) => updateSnackDraftField('productName', e.detail.value)}
                />
                <Input
                  className='snack-form-input'
                  value={snackDraft.brand}
                  placeholder='品牌（可选）'
                  onInput={(e: any) => updateSnackDraftField('brand', e.detail.value)}
                />
                <View className='snack-form-input-with-unit'>
                  <Input
                    className='snack-form-input'
                    type='digit'
                    value={snackDraft.netWeightG}
                    placeholder='重量'
                    onInput={(e: any) => updateSnackDraftField('netWeightG', e.detail.value)}
                  />
                  <Text className='snack-form-unit'>g</Text>
                </View>
              </View>
              <View className='snack-form-section'>
                <Text className='snack-form-label'>每100g营养成分</Text>
                <View className='snack-nutrition-grid'>
                  <View className='snack-form-input-with-unit'>
                    <Input className='snack-form-input' type='digit' value={snackDraft.calories} placeholder='热量' onInput={(e: any) => updateSnackDraftField('calories', e.detail.value)} />
                    <Text className='snack-form-unit'>kcal</Text>
                  </View>
                  <View className='snack-form-input-with-unit'>
                    <Input className='snack-form-input' type='digit' value={snackDraft.protein} placeholder='蛋白质' onInput={(e: any) => updateSnackDraftField('protein', e.detail.value)} />
                    <Text className='snack-form-unit'>g</Text>
                  </View>
                  <View className='snack-form-input-with-unit'>
                    <Input className='snack-form-input' type='digit' value={snackDraft.carbs} placeholder='碳水' onInput={(e: any) => updateSnackDraftField('carbs', e.detail.value)} />
                    <Text className='snack-form-unit'>g</Text>
                  </View>
                  <View className='snack-form-input-with-unit'>
                    <Input className='snack-form-input' type='digit' value={snackDraft.fat} placeholder='脂肪' onInput={(e: any) => updateSnackDraftField('fat', e.detail.value)} />
                    <Text className='snack-form-unit'>g</Text>
                  </View>
                  <View className='snack-form-input-with-unit'>
                    <Input className='snack-form-input' type='digit' value={snackDraft.fiber} placeholder='膳食纤维' onInput={(e: any) => updateSnackDraftField('fiber', e.detail.value)} />
                    <Text className='snack-form-unit'>g</Text>
                  </View>
                  <View className='snack-form-input-with-unit'>
                    <Input className='snack-form-input' type='digit' value={snackDraft.sugar} placeholder='糖' onInput={(e: any) => updateSnackDraftField('sugar', e.detail.value)} />
                    <Text className='snack-form-unit'>g</Text>
                  </View>
                  <View className='snack-form-input-with-unit snack-nutrition-wide'>
                    <Input className='snack-form-input' type='digit' value={snackDraft.sodiumMg} placeholder='钠' onInput={(e: any) => updateSnackDraftField('sodiumMg', e.detail.value)} />
                    <Text className='snack-form-unit'>mg</Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
          <View className='drawer-footer'>
            <View
              className={`drawer-submit-btn ${savingSnackDraft ? 'loading' : ''}`}
              onClick={handleSubmitSnackContribution}
            >
              {savingSnackDraft
                ? <View className='btn-spinner' />
                : <Text className='drawer-submit-text'>保存到包装食品库</Text>}
            </View>
          </View>
        </View>
      </View>

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
              <Text className='context-tip'>
                改重量建议直接修改上方列表；如果写在补充说明里，系统也会优先按说明处理。
              </Text>
              <Textarea
                className='context-textarea'
                placeholder='例如：八喜冰淇淋60克，532千焦；不是橘子，是橙子；鸡腿是整只未去骨'
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
              <Text>{isResubmitting ? '' : <>重新分析 · {correctionCreditCost} 积分</>}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 快捷比例底部弹窗 */}
      {quickRatioSheetVisible && (
        <View className='action-sheet-overlay' onClick={() => setQuickRatioSheetVisible(false)}>
          <View className='action-sheet-mask' />
          <View className='action-sheet-content'>
            <View className='action-sheet-handle-bar' />
            <View className='action-sheet-actions'>
              <View className='action-sheet-item' onClick={() => handleQuickRatio(2)}>
                <Text className='action-sheet-label'>两人聚餐</Text>
                <Text className='action-sheet-hint'>每人 50%</Text>
              </View>
              <View className='action-sheet-item' onClick={() => handleQuickRatio(3)}>
                <Text className='action-sheet-label'>三人聚餐</Text>
                <Text className='action-sheet-hint'>每人 33%</Text>
              </View>
              <View className='action-sheet-item' onClick={() => handleQuickRatio(4)}>
                <Text className='action-sheet-label'>四人聚餐</Text>
                <Text className='action-sheet-hint'>每人 25%</Text>
              </View>
              <View className='action-sheet-item action-sheet-item--custom' onClick={handleOpenCustomPeopleRatio}>
                <Text className='action-sheet-label'>自定义人数</Text>
                <Text className='action-sheet-hint'>输入人数自动均分</Text>
              </View>
            </View>
            <View className='action-sheet-actions action-sheet-actions--cancel'>
              <View className='action-sheet-item action-sheet-item--cancel' onClick={() => setQuickRatioSheetVisible(false)}>
                <Text className='action-sheet-label'>取消</Text>
              </View>
            </View>
          </View>
        </View>
      )}

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
            background: scheme === 'dark' ? 'rgba(30,41,37,0.95)' : 'rgba(255,255,255,0.95)',
            borderRadius: devFeedbackPanelOpen ? '16rpx 0 0 16rpx' : '999rpx',
            boxShadow: '0 4rpx 24rpx rgba(0,0,0,0.15)',
            border: `1rpx solid ${scheme === 'dark' ? '#2d3935' : '#e5e7eb'}`,
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
                <Text style={{ fontSize: '24rpx', fontWeight: 600, color: scheme === 'dark' ? '#e8f3ef' : '#111827' }}>
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
                      background: scheme === 'dark' ? '#25302c' : '#f3f4f6',
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

export default withAuth(ResultPage)
