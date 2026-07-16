import Taro from '@tarojs/taro'

import { getRecentConsoleLogs } from './console-log-buffer'
import { resolveApiBaseUrl } from './api-base-url'
import {
  collectFoodDisplayImageUrls,
  type FoodImageSource,
} from './food-display-image'
import { extraPkgUrl } from './subpackage-extra'

declare const __RECENT_REQUEST_TRACE_LIMIT__: string

function readInjectedString(
  getter: () => string,
  fallback = ''
): string {
  try {
    const value = getter()
    return typeof value === 'string' ? value : fallback
  } catch (error) {
    return fallback
  }
}

// 运行时按微信 envVersion 选择 API；各环境 URL 由 .env 构建注入，见 docs/api-url-configuration.md
export const API_BASE_URL = resolveApiBaseUrl()
export const EXPIRY_SUBSCRIBE_TEMPLATE_ID = readInjectedString(
  () => __EXPIRY_SUBSCRIBE_TEMPLATE_ID__,
  ''
)
const DEFAULT_RECENT_REQUEST_TRACE_LIMIT = 50
const MAX_RECENT_REQUEST_TRACE_LIMIT = 50

function readInjectedNumber(getter: () => string | number, fallback: number): number {
  const raw = readInjectedString(() => String(getter()), String(fallback))
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const RECENT_REQUEST_TRACE_LIMIT = Math.min(
  MAX_RECENT_REQUEST_TRACE_LIMIT,
  Math.max(0, readInjectedNumber(() => __RECENT_REQUEST_TRACE_LIMIT__, DEFAULT_RECENT_REQUEST_TRACE_LIMIT))
)

// 仅开发构建打印，避免真机/生产包无意义日志（且减少控制台副作用）
if (process.env.NODE_ENV !== 'production') {
  console.log('[API] 运行时 API_BASE_URL:', API_BASE_URL)
  console.log('[API] 最近请求诊断条数:', RECENT_REQUEST_TRACE_LIMIT)
}

function isNgrokFreeDomain(url: string): boolean {
  return /^https:\/\/[^/]+\.ngrok-free\.dev(?:\/|$)/i.test(url)
}

function withNgrokBypassHeaders(
  header?: Record<string, any>
): Record<string, any> {
  const merged = { ...(header || {}) }
  if (isNgrokFreeDomain(API_BASE_URL)) {
    merged['ngrok-skip-browser-warning'] = '1'
  }
  return merged
}

// 基础类型定义

/** 后端标准响应信封 */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export type CanonicalMealType =
  | 'breakfast'
  | 'morning_snack'
  | 'lunch'
  | 'afternoon_snack'
  | 'dinner'
  | 'evening_snack'

/** MealType 保留 snack 以兼容历史数据与旧客户端 */
export type MealType = CanonicalMealType | 'snack'
export type DietGoal = 'fat_loss' | 'muscle_gain' | 'maintain' | 'none'
export type ActivityTiming = 'post_workout' | 'daily' | 'before_sleep' | 'none'
export type UserGoal = 'muscle_gain' | 'fat_loss' | 'maintain'
export type ExecutionMode =
  | 'lite'
  | 'standard'
  | 'standard_web_search'
  | 'fast'
  | 'fast_web_search'
  | 'standard_packaged_experiment'
  | 'strict'
  | 'strict_separate'
  | 'strict_web_search'
  | 'experimental'
  | 'gemini35_flash'
  | 'gemini35_flash_grouped'
export type AnalysisEngine = 'legacy_direct' | 'db_first'
export type AnalyzeRecognitionOutcome = 'ok' | 'soft_reject' | 'hard_reject'
export type AllowedFoodCategory = 'carb' | 'lean_protein' | 'unknown'
export type PrecisionSourceType = 'image' | 'text'
export type PrecisionStatus = 'needs_user_input' | 'needs_retake' | 'estimating' | 'done'
export type PrecisionSplitStrategy =
  | 'single_item'
  | 'multi_item_parallel'
  | 'single_shot'
  | 'grouped_parallel'
  | 'retake_required'
  | 'user_annotation_required'

export interface PrecisionReferenceDimensions {
  length?: number
  width?: number
  height?: number
}

export type PrecisionReferencePresetKey =
  | 'hand'
  | 'campus_card'
  | 'large_card'
  | 'chopsticks'
  | 'spoon'
  | 'bank_card'
  | 'custom'

export interface PrecisionReferenceObjectInput {
  reference_type: 'preset' | 'custom'
  reference_name: string
  dimensions_mm?: PrecisionReferenceDimensions
  placement_note?: string
  applies_to_items?: string[]
}

export interface PrecisionReferencePresetConfig {
  reference_name: string
  dimensions_mm?: PrecisionReferenceDimensions
}

export interface PrecisionReferenceDefaults {
  preferred_reference_key?: PrecisionReferencePresetKey
  presets?: Partial<Record<PrecisionReferencePresetKey, PrecisionReferencePresetConfig>>
}

export interface AnalyzeGeoContext {
  province?: string
  city?: string
  district?: string
}

type CachedAnalyzeGeoContext = AnalyzeGeoContext & {
  expiresAt: number
}

// 分析请求接口（base64Image 与 image_url 二选一，推荐先上传拿 image_url）
export interface AnalyzeRequest {
  base64Image?: string
  /** Supabase 等公网图片 URL，分析时用此 URL 获取图片；标记样本/保存记录时也存此 URL */
  image_url?: string
  /** 多图 URL 列表 */
  image_urls?: string[]
  additionalContext?: string
  modelName?: string
  modelNames?: string[]
  user_goal?: UserGoal
  diet_goal?: DietGoal
  activity_timing?: ActivityTiming
  remaining_calories?: number
  meal_type?: MealType
  timezone_offset_minutes?: number
  province?: string
  city?: string
  district?: string
  is_multi_view?: boolean
  execution_mode?: ExecutionMode
}

// 营养成分接口
export interface Nutrients {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  sugar: number
  waterMl?: number
  water_ml?: number
  saturatedFat?: number
  cholesterolMg?: number
  sodiumMg?: number
  sodium_mg?: number
  potassiumMg?: number
  calciumMg?: number
  ironMg?: number
  magnesiumMg?: number
  zincMg?: number
  vitaminARaeMcg?: number
  vitaminCMg?: number
  vitaminDMcg?: number
  vitaminEMg?: number
  vitaminKMcg?: number
  thiaminMg?: number
  riboflavinMg?: number
  niacinMg?: number
  vitaminB6Mg?: number
  folateMcg?: number
  vitaminB12Mcg?: number
}

export interface UnitNutritionPer100g extends Nutrients {}

// 食物项接口
export interface FoodItem {
  itemId?: number
  name: string
  type?: string
  food_type?: string
  category?: string
  estimatedWeightGrams: number
  originalWeightGrams: number
  grossWeightGrams?: number
  gross_weight_grams?: number
  ediblePortionRatio?: number
  edible_portion_ratio?: number
  ediblePortionReason?: string
  edible_portion_reason?: string
  ediblePortionSource?: string
  edible_portion_source?: string
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
  suggested_ratio?: number
  suggested_ratio_reason?: string
  suggested_ratio_source?: string
  waterMl?: number
  water_ml?: number
  nutrients: Nutrients
  unit_nutrition_per_100g?: UnitNutritionPer100g
  matched_food_id?: string | null
  matchedFoodId?: string | null
  matched_food_name?: string | null
  is_unresolved?: boolean
  resolve_status?: string | null
  resolve_score?: number
  nutrition_source?: string | null
  nutritionSource?: string | null
  nutrition_source_category?: string | null
  nutritionSourceCategory?: string | null
  packaged_food_id?: string
  packagedFoodId?: string
  package_match_status?: string
  packageMatchStatus?: string
  package_match_confidence?: number
  packageMatchConfidence?: number
  package_weight_source?: string
  packageWeightSource?: string
  package_weight_applied?: boolean
  packageWeightApplied?: boolean
  package_weight_reason?: string
  packageWeightReason?: string
  packaged_candidates?: Array<Record<string, unknown>>
  packagedCandidates?: Array<Record<string, unknown>>
}

// 分析响应接口（含专业营养分析）
export interface AnalyzeResponse {
  description: string
  insight: string
  items: FoodItem[]
  suggest_ratio_enabled?: boolean
  suggest_ratio_status?: string
  suggest_ratio_applied_count?: number
  pfc_ratio_comment?: string
  eating_order_advice?: string
  absorption_notes?: string
  context_advice?: string
  analysis_engine?: AnalysisEngine
  analysis_duration_ms?: number
  resolved_count?: number
  unresolved_count?: number
  recognitionOutcome?: AnalyzeRecognitionOutcome
  rejectionReason?: string
  retakeGuidance?: string[]
  allowedFoodCategory?: AllowedFoodCategory
  followupQuestions?: string[]
  precisionSessionId?: string
  precisionStatus?: PrecisionStatus
  precisionRoundIndex?: number
  pendingRequirements?: string[]
  retakeInstructions?: string[]
  referenceObjectNeeded?: boolean
  referenceObjectSuggestions?: string[]
  detectedItemsSummary?: string[]
  splitStrategy?: PrecisionSplitStrategy
  uncertaintyNotes?: string[]
  redirectTaskId?: string
  packaged_experiment?: {
    enabled?: boolean
    triggered_count?: number
    matched_count?: number
    weight_applied_count?: number
    fallback_count?: number
  }
}

const ANALYZE_LOCATION_CACHE_KEY = 'analyze_location_context_v1'
const ANALYZE_LOCATION_CACHE_TTL_MS = 30 * 60 * 1000
const MUNICIPALITY_NAMES = ['北京', '上海', '天津', '重庆']

function normalizeAreaText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readCachedAnalyzeGeoContext(): AnalyzeGeoContext | undefined {
  try {
    const raw = Taro.getStorageSync(ANALYZE_LOCATION_CACHE_KEY)
    if (!raw || typeof raw !== 'object') return undefined
    const cached = raw as Partial<CachedAnalyzeGeoContext>
    if (!Number.isFinite(cached.expiresAt) || Number(cached.expiresAt) <= Date.now()) {
      Taro.removeStorageSync(ANALYZE_LOCATION_CACHE_KEY)
      return undefined
    }
    const province = normalizeAreaText(cached.province)
    const city = normalizeAreaText(cached.city)
    const district = normalizeAreaText(cached.district)
    if (!province && !city && !district) return undefined
    return { province, city, district }
  } catch {
    return undefined
  }
}

function cacheAnalyzeGeoContext(context?: AnalyzeGeoContext): void {
  if (!context) return
  const province = normalizeAreaText(context.province)
  const city = normalizeAreaText(context.city)
  const district = normalizeAreaText(context.district)
  if (!province && !city && !district) return
  try {
    const payload: CachedAnalyzeGeoContext = {
      province,
      city,
      district,
      expiresAt: Date.now() + ANALYZE_LOCATION_CACHE_TTL_MS,
    }
    Taro.setStorageSync(ANALYZE_LOCATION_CACHE_KEY, payload)
  } catch {
    // ignore cache failure
  }
}

function parseAnalyzeGeoContext(address: string, promptCity = ''): AnalyzeGeoContext | undefined {
  const addr = normalizeAreaText(address)
  const cityPrompt = normalizeAreaText(promptCity)
  if (!addr && !cityPrompt) return undefined

  const provinceMatch = addr.match(/^(.+?[省市])/)
  const cityMatch = addr.match(/^.+?[省](.+?市)/)
  const districtMatch = addr.match(/[市省](.+?[区县市])/)
  const province = normalizeAreaText(provinceMatch ? provinceMatch[1] : cityPrompt)
  const isMunicipality = MUNICIPALITY_NAMES.some((name) => province.includes(name))
  const city = isMunicipality ? '' : normalizeAreaText(cityMatch ? cityMatch[1] : '')
  const district = normalizeAreaText(
    districtMatch
      ? districtMatch[1]
      : (addr.match(/^(.+?[区县市])/) || [])[1]
  )

  if (!province && !city && !district) return undefined
  return { province, city, district }
}

export async function resolveCurrentGeoContext(options?: { requestAuthorization?: boolean }): Promise<AnalyzeGeoContext | undefined> {
  const cached = readCachedAnalyzeGeoContext()
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) {
    return cached
  }

  try {
    if (!options?.requestAuthorization) {
      const setting = await Taro.getSetting()
      if (!setting.authSetting?.['scope.userLocation']) {
        return cached
      }
    }

    const location = await Taro.getLocation({ type: 'wgs84' })
    const reverse = await Taro.request({
      url: `${API_BASE_URL}/api/location/reverse`,
      method: 'POST',
      header: withNgrokBypassHeaders({ 'Content-Type': 'application/json' }),
      data: { lat: location.latitude, lon: location.longitude },
      timeout: 8000,
    })
    if (reverse.statusCode !== 200 || !reverse.data) {
      return cached
    }

    const data = unwrapResponse<Record<string, unknown>>(reverse)
    const raw = data.address ?? data.formatted_address ?? data.result
    let address = ''
    if (typeof raw === 'string') {
      address = raw
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const record = raw as Record<string, unknown>
      if (typeof record.formatted_address === 'string') address = record.formatted_address
      else if (typeof record.address === 'string') address = record.address
    }

    const context = parseAnalyzeGeoContext(address)
    if (context) {
      cacheAnalyzeGeoContext(context)
      return context
    }
  } catch {
    return cached
  }

  return cached
}

const resolveAnalyzeGeoContext = resolveCurrentGeoContext

async function enrichAnalyzePayloadWithGeoContext<T extends AnalyzeGeoContext & { timezone_offset_minutes?: number }>(
  body: T
): Promise<T> {
  const payload = { ...body }
  if (!Number.isFinite(payload.timezone_offset_minutes)) {
    payload.timezone_offset_minutes = new Date().getTimezoneOffset()
  }
  if (payload.province || payload.city || payload.district) {
    return payload
  }
  const geo = await resolveAnalyzeGeoContext()
  if (!geo) return payload
  return {
    ...payload,
    province: geo.province,
    city: geo.city,
    district: geo.district,
  }
}

// ---------- 双模型对比分析接口 ----------

/** 单个模型的分析结果 */
export interface ModelAnalyzeResult {
  model_name: string
  success: boolean
  error?: string
  analysis_engine?: AnalysisEngine
  duration_ms?: number
  resolved_count?: number
  unresolved_count?: number
  description?: string
  insight?: string
  items: FoodItem[]
  pfc_ratio_comment?: string
  eating_order_advice?: string
  absorption_notes?: string
  context_advice?: string
  recognitionOutcome?: AnalyzeRecognitionOutcome
  rejectionReason?: string
  retakeGuidance?: string[]
  allowedFoodCategory?: AllowedFoodCategory
  followupQuestions?: string[]
}

/** 双模型对比分析响应 */
export interface CompareAnalyzeResponse {
  doubao_result: ModelAnalyzeResult
  gemini_result: ModelAnalyzeResult
}

/** 确认记录时提交的单条食物项（含调节后的 weight/ratio/intake） */
export interface FoodRecordItemPayload {
  name: string
  weight: number
  ratio: number
  intake: number
  image_path?: string
  image_paths?: string[]
  gross_weight_grams?: number
  edible_portion_ratio?: number
  edible_portion_reason?: string
  edible_portion_source?: string
  suggested_ratio?: number
  suggested_ratio_reason?: string
  suggested_ratio_source?: string
  water_ml?: number
  nutrition_source?: string | null
  nutrition_source_category?: string | null
  matched_food_id?: string | null
  packaged_food_id?: string
  package_match_status?: string
  package_match_confidence?: number
  package_weight_source?: string
  package_weight_applied?: boolean
  package_weight_reason?: string
  packaged_candidates?: Array<Record<string, unknown>>
  nutrients: Nutrients
  manual_source?: 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom'
  manual_source_id?: string
  manual_source_title?: string
  manual_portion_label?: string
}

/** 饮食记录入口来源类型 */
export type FoodRecordEntryType =
  | 'food_image'
  | 'food_text'
  | 'food_library'
  | 'favorite_recipe'
  | 'analyze_history'
  | 'campus_canteen'
  | 'public_food_library'
  | 'unknown'

/** 确认记录请求：餐次 + 识别结果与营养汇总 + 用户状态与专业分析 */
export interface SaveFoodRecordRequest {
  meal_type: MealType
  image_path?: string
  image_paths?: string[]
  description?: string
  insight?: string
  items: FoodRecordItemPayload[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  diet_goal?: 'fat_loss' | 'muscle_gain' | 'maintain' | 'none'
  activity_timing?: 'post_workout' | 'daily' | 'before_sleep' | 'none'
  pfc_ratio_comment?: string
  absorption_notes?: string
  context_advice?: string
  /** 来源识别任务 ID（从识别记录保存而来时传入） */
  source_task_id?: string
  /** 用户创建该条记录的入口来源 */
  entry_type?: FoodRecordEntryType
  /** 食谱/收藏 ID（从收藏一键记录时传入） */
  recipe_id?: string
  /** 记录日期 YYYY-MM-DD，仅支持近 3 天内补录 */
  date?: string
}

/** 单条偏差样本（标记样本接口请求项） */
export interface CriticalSamplePayload {
  image_path?: string
  food_name: string
  ai_weight: number
  user_weight: number
  deviation_percent: number
}

/** 饮食记录 items 单条（含手动记录来源与展示图） */
export interface FoodRecordItemRow {
  name: string
  weight: number
  gross_weight_grams?: number
  grossWeightGrams?: number
  edible_portion_ratio?: number
  ediblePortionRatio?: number
  edible_portion_reason?: string
  ediblePortionReason?: string
  edible_portion_source?: string
  ediblePortionSource?: string
  ratio: number
  intake: number
  waterMl?: number
  water_ml?: number
  nutrients: Nutrients
  manual_source?: 'public_library' | 'nutrition_library' | 'packaged_food'
  manual_source_id?: string
  manual_source_title?: string
  manual_portion_label?: string
  source_label?: string
  image_path?: string | null
  image_paths?: string[] | null
  suggested_ratio?: number
  suggestedRatio?: number
  suggested_ratio_reason?: string
  suggestedRatioReason?: string
  suggested_ratio_source?: string
  suggestedRatioSource?: string
  nutrition_source?: string | null
  nutritionSource?: string | null
  nutrition_source_category?: string | null
  nutritionSourceCategory?: string | null
  matched_food_id?: string | null
  matchedFoodId?: string | null
  packaged_food_id?: string
  packagedFoodId?: string
  package_match_status?: string
  packageMatchStatus?: string
  package_match_confidence?: number
  packageMatchConfidence?: number
  package_weight_source?: string
  packageWeightSource?: string
  package_weight_applied?: boolean
  packageWeightApplied?: boolean
  package_weight_reason?: string
  packageWeightReason?: string
  packaged_candidates?: Array<Record<string, unknown>>
  packagedCandidates?: Array<Record<string, unknown>>
}

/** 长文本运动解析后的单个运动项目 */
export interface ExerciseActivityItem {
  name?: string | null
  duration_min?: number | null
  sets?: number | null
  reps?: number | null
  intensity?: string | null
  met?: number | null
  calories_kcal?: number | null
  source?: string | null
  match_status?: string | null
  library_id?: string | null
  reasoning?: string | null
}

/** 单条饮食记录（列表接口返回） */
export interface FoodRecord {
  id: string
  user_id: string
  meal_type: MealType
  image_path?: string | null
  image_paths?: string[] | null
  description?: string | null
  insight?: string | null
  // context_state?: string | null (已移除)
  pfc_ratio_comment?: string | null
  absorption_notes?: string | null
  context_advice?: string | null
  items: FoodRecordItemRow[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  record_time: string
  created_at: string
  // 新增字段
  diet_goal?: string | null
  activity_timing?: string | null
  source_task_id?: string | null
  entry_type?: FoodRecordEntryType | null
  recipe_id?: string | null
}

/** 首页微量元素单项（带每日参考摄入量与进度） */
export interface HomeMicronutrientItem {
  current: number
  target: number
  progress: number
}

/** 首页今日摄入与宏量 */
export interface HomeIntakeData {
  current: number
  target: number
  progress: number
  macros: {
    protein: { current: number; target: number }
    carbs: { current: number; target: number }
    fat: { current: number; target: number }
  }
  micros?: Record<string, HomeMicronutrientItem | number>
}

export interface HomeNutritionTarget {
  source?: 'manual' | 'system_initial' | 'dynamic' | 'profile' | 'default' | string
  diet_goal?: string
  base_calorie_target?: number
  suggested_calorie_target?: number
  today_exercise_kcal?: number
  exercise_added_kcal?: number
  exercise_surplus_kcal?: number
  exercise_threshold_kcal?: number
  recent_exercise_avg_kcal?: number
  recent_exercise_days?: number
  activity_multiplier?: number
  explanation?: string
  macro_explanation?: string
  calibration_suggestion?: HomeTargetCalibrationSuggestion | null
}

export interface HomeTargetCalibrationSuggestion {
  available?: boolean
  suggested_kcal: number
  current_kcal: number
  delta_kcal: number
  reason?: string
  food_record_days?: number
  weight_records?: number
  source?: string
}

/** 首页同一餐次下的单条饮食记录摘要（用于多选跳转） */
export interface HomeMealRecordEntry {
  id: string
  record_time?: string
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  water_ml?: number
  waterMl?: number
  /** 当前记录内所有食物按实际摄入 / 估算重量汇总后的摄入比例 */
  intake_ratio?: number
  intakeRatio?: number
  /** 分析结果餐食标题（描述首行或首条食物名），同餐多选面板与时间与名称同显时会截断 */
  title?: string
  /** 记录图片（单图），供弹层面板直接展示 */
  image_path?: string | null
  /** 记录图片列表 */
  image_paths?: string[] | null
  /** 完整记录数据，用于首页直接编辑而无需二次请求 */
  full_record?: FoodRecord
}

/** 首页今日餐食单条 */
export interface HomeMealItem {
  type: string
  name: string
  time: string
  calorie: number
  target: number
  progress: number
  tags: string[]
  image_path?: string | null
  image_paths?: string[] | null
  images?: string[] | null
  /** 该餐次内最新一条饮食记录 id，用于跳转记录详情/生成分享海报 */
  primary_record_id?: string | null
  /** 部分网关/序列化可能为 camelCase，与 primary_record_id 等价 */
  primaryRecordId?: string | null
  /** 该餐次下全部记录（新→旧，与 primary 一致）；多条时首页需供用户选择 */
  meal_record_entries?: HomeMealRecordEntry[] | null
  /** 该餐次宏量营养素聚合（g） */
  protein?: number
  carbs?: number
  fat?: number
  /** 该餐次食物含水量聚合（ml） */
  water_ml?: number
  waterMl?: number
  /** 该餐次所有食物按实际摄入 / 估算重量汇总后的摄入比例 */
  intake_ratio?: number
  intakeRatio?: number
  /** 该餐次食物描述（由多条记录标题拼接） */
  description?: string
}

/** 解析首页餐食卡片对应的记录 id（兼容 snake_case / camelCase） */
export function resolveHomeMealPrimaryRecordId(meal: HomeMealItem | Record<string, unknown>): string | null {
  const m = meal as unknown as Record<string, unknown>
  const candidates = [m.primary_record_id, m.primaryRecordId]
  for (const v of candidates) {
    if (v != null && String(v).trim() !== '') {
      return String(v)
    }
  }
  return null
}

export function normalizeManualFoodSearchResult(item: ManualFoodSearchResult): ManualFoodSearchResult {
  const urls = collectFoodDisplayImageUrls(item)
  return {
    ...item,
    image_path: urls[0] || null,
    image_paths: urls.length > 0 ? urls : null,
  }
}

/** 规范化饮食记录图片字段（含后端从标准食物库回查的 image_path/image_paths）。 */
export function normalizeFoodRecord(record: FoodRecord): FoodRecord {
  const urls = collectFoodDisplayImageUrls(record)
  const items = Array.isArray(record.items)
    ? record.items.map((item) => {
        const itemUrls = collectFoodDisplayImageUrls(item)
        return {
          ...item,
          image_path: itemUrls[0] || item.image_path || null,
          image_paths: itemUrls.length > 0 ? itemUrls : item.image_paths,
        }
      })
    : record.items
  return {
    ...record,
    image_path: urls[0] || null,
    image_paths: urls.length > 0 ? urls : null,
    items,
  }
}

function normalizeHomeMealItem(raw: unknown): HomeMealItem {
  const row = raw as HomeMealItem
  const entries = Array.isArray(row.meal_record_entries)
    ? row.meal_record_entries
      .filter((e) => e && String(e.id || '').trim() !== '')
      .map(normalizeHomeMealRecordEntry)
    : []
  const fallbackMealRatio = computeMealIntakeRatioFromEntries(entries)
  const images = collectFoodDisplayImageUrls(row)
  return {
    ...row,
    images: images.length > 0 ? images : null,
    image_paths: images.length > 0 ? images : null,
    image_path: images[0] || null,
    meal_record_entries: entries.length > 0 ? entries : row.meal_record_entries,
    primary_record_id: resolveHomeMealPrimaryRecordId(row as unknown as Record<string, unknown>),
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    water_ml: typeof row.water_ml === 'number' ? row.water_ml : row.waterMl,
    waterMl: typeof row.waterMl === 'number' ? row.waterMl : row.water_ml,
    intake_ratio: typeof row.intake_ratio === 'number' ? row.intake_ratio : (typeof row.intakeRatio === 'number' ? row.intakeRatio : fallbackMealRatio),
    intakeRatio: typeof row.intakeRatio === 'number' ? row.intakeRatio : (typeof row.intake_ratio === 'number' ? row.intake_ratio : fallbackMealRatio),
  }
}

function normalizeHomeMealRecordEntry(entry: HomeMealRecordEntry): HomeMealRecordEntry {
  const ratio = typeof entry.intake_ratio === 'number'
    ? entry.intake_ratio
    : (typeof entry.intakeRatio === 'number' ? entry.intakeRatio : computeFoodRecordIntakeRatio(entry.full_record))
  const entryImages = collectFoodDisplayImageUrls({
    image_path: entry.image_path ?? entry.full_record?.image_path,
    image_paths: [
      ...(Array.isArray(entry.image_paths) ? entry.image_paths : []),
      ...(Array.isArray(entry.full_record?.image_paths) ? entry.full_record.image_paths : []),
    ],
  } as FoodImageSource)
  return {
    ...entry,
    image_path: entryImages[0] || null,
    image_paths: entryImages.length > 0 ? entryImages : null,
    total_protein: entry.total_protein ?? entry.full_record?.total_protein,
    total_carbs: entry.total_carbs ?? entry.full_record?.total_carbs,
    total_fat: entry.total_fat ?? entry.full_record?.total_fat,
    water_ml: typeof entry.water_ml === 'number' ? entry.water_ml : entry.waterMl,
    waterMl: typeof entry.waterMl === 'number' ? entry.waterMl : entry.water_ml,
    intake_ratio: ratio,
    intakeRatio: ratio,
  }
}

function computeMealIntakeRatioFromEntries(entries: HomeMealRecordEntry[]): number | undefined {
  let totalWeight = 0
  let totalIntake = 0
  entries.forEach((entry) => {
    const totals = computeFoodRecordWeightAndIntake(entry.full_record)
    totalWeight += totals.weight
    totalIntake += totals.intake
  })
  return totalWeight > 0 ? Math.round((totalIntake / totalWeight) * 1000) / 10 : undefined
}

function computeFoodRecordIntakeRatio(record?: FoodRecord): number | undefined {
  const totals = computeFoodRecordWeightAndIntake(record)
  return totals.weight > 0 ? Math.round((totals.intake / totals.weight) * 1000) / 10 : undefined
}

function computeFoodRecordWeightAndIntake(record?: FoodRecord): { weight: number; intake: number } {
  let weightTotal = 0
  let intakeTotal = 0
  ;(record?.items || []).forEach((item) => {
    const weight = Number(item.weight)
    if (!Number.isFinite(weight) || weight <= 0) return
    const intake = Number((item as any).intake)
    const ratio = Number((item as any).ratio)
    weightTotal += weight
    if (Number.isFinite(intake) && intake >= 0) {
      intakeTotal += intake
    } else if (Number.isFinite(ratio) && ratio >= 0) {
      intakeTotal += weight * ratio / 100
    } else {
      intakeTotal += weight
    }
  })
  return { weight: weightTotal, intake: intakeTotal }
}

export interface HomeFoodExpiryItem {
  id: string
  user_id: string
  food_name: string
  quantity_text?: string | null
  storage_location?: string | null
  note?: string | null
  deadline_at: string
  deadline_precision: 'date' | 'datetime'
  completed_at?: string | null
  created_at: string
  updated_at: string
  is_overdue: boolean
  is_due_today: boolean
  days_left?: number | null
  deadline_label?: string | null
  urgency_level: 'overdue' | 'today' | 'soon' | 'normal'
}

export interface HomeFoodExpirySummary {
  pendingCount: number
  soonCount: number
  overdueCount: number
  items: HomeFoodExpiryItem[]
}

/** 首页成就：连续打卡与历史「全绿」达标天数（与仪表盘目标一致） */
export interface HomeAchievement {
  streak_days: number
  green_days: number
}

/** 首页仪表盘接口返回 */
export interface HomeDashboard {
  intakeData: HomeIntakeData
  meals: HomeMealItem[]
  expirySummary?: HomeFoodExpirySummary
  /** 当日运动消耗汇总（千卡），来自 user_exercise_logs */
  exerciseBurnedKcal?: number
  achievement?: HomeAchievement
  nutritionTarget?: HomeNutritionTarget
}

export interface PetProfile {
  id: string
  pet_seed: string
  name: string
  color: string
  shape: string
  pattern: string
  accessory: string
  personality: string
  level: number
  experience: number
  level_exp: number
  next_level_exp: number
  level_progress: number
  total_events: number
  archetype?: string
  match_reasons?: string[]
  needs_selection?: boolean
  selection_candidates?: PetAppearanceCandidate[]
  free_profile_rematch_available?: boolean
  growth_unlocks?: string[]
}

export interface PetAppearanceCandidate {
  id: string
  pet_seed: string
  name: string
  color: string
  shape: string
  pattern: string
  accessory: string
  personality: string
  archetype?: string
  style?: string
  score?: number
  match_reasons?: string[]
}

export interface PetDailyScore {
  date: string
  habit_score: number
  exp_gained: number
  details: Record<string, any>
}

export interface PetStatus {
  mood: 'happy' | 'calm' | 'sleepy' | 'surprised' | string
  state?: 'active' | 'steady' | 'warming' | 'sleepy' | 'dozing' | 'low_power' | 'hibernating' | 'deep_sleep' | 'surprised' | string
  message: string
  task_text: string
  inactivity_days?: number
  can_revive?: boolean
}

export interface PetOfflineEvent {
  id: string
  event_date: string
  event_type: string
  title: string
  message: string
  task_text: string
  habit_score: number
  exp_reward: number
  credit_reward: number
  can_claim: boolean
  is_read: boolean
  is_claimed: boolean
  details?: Record<string, any>
}

export interface PetSummary {
  pet: PetProfile
  today: PetDailyScore
  status: PetStatus
  event?: PetOfflineEvent | null
  rewards: {
    daily_credit_cap: number
  }
}

export interface PetClaimResult {
  pet: PetProfile
  event: PetOfflineEvent
  credits_awarded: number
  exp_awarded: number
  earned_credits_balance?: number
}

export interface PetAppearanceRerollResult {
  pet: PetProfile
  credits_cost: number
  earned_credits_balance?: number
}

export interface PetAppearanceSelectResult {
  pet: PetProfile
}

/** 首页仪表盘可编辑目标值 */
export interface DashboardTargets {
  calorie_target: number
  protein_target: number
  carbs_target: number
  fat_target: number
  fiber_target?: number
  sugar_target?: number
  saturated_fat_target?: number
  cholesterol_mg_target?: number
  sodium_mg_target?: number
  potassium_mg_target?: number
  calcium_mg_target?: number
  iron_mg_target?: number
  magnesium_mg_target?: number
  zinc_mg_target?: number
  vitamin_a_rae_mcg_target?: number
  vitamin_c_mg_target?: number
  vitamin_d_mcg_target?: number
  vitamin_e_mg_target?: number
  vitamin_k_mcg_target?: number
  thiamin_mg_target?: number
  riboflavin_mg_target?: number
  niacin_mg_target?: number
  vitamin_b6_mg_target?: number
  folate_mcg_target?: number
  vitamin_b12_mcg_target?: number
}

export interface DashboardTargetsUpdateInput extends DashboardTargets {
  target_date?: string
  micro_targets?: Record<string, number>
}

/** 更新首页目标的结果：服务端成功或仅写入本机（线上未升级接口时） */
export interface DashboardTargetsUpdateResult {
  targets: DashboardTargets
  /** server：已写入数据库；local：仅本机 storage（需部署后端或检查网络） */
  saveScope: 'server' | 'local'
}

export type DietRecommendationScene = 'eat_out' | 'cook_home'

export interface DietRecommendationMacroContext {
  calories?: number
  protein: number
  carbs: number
  fat: number
}

export interface DietRecommendationMealContext {
  type: string
  name: string
  description?: string
  calories: number
  protein?: number
  carbs?: number
  fat?: number
}

export interface DietRecommendationRequest {
  scene: DietRecommendationScene
  date?: string
  calorie_remaining: number
  macro_gaps: DietRecommendationMacroContext
  targets: DietRecommendationMacroContext
  current: DietRecommendationMacroContext
  meals?: DietRecommendationMealContext[]
  user_goal?: string
  preference_context?: string
}

export interface DietRecommendationFoodItem {
  name: string
  amount: string
  source?: string
  source_id?: string
}

export interface DietRecommendationOption {
  title: string
  reason: string
  source?: string
  source_id?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  items: DietRecommendationFoodItem[]
  tips?: string[]
  alternatives?: string[]
}

export interface DietRecommendationResult {
  scene: DietRecommendationScene
  title: string
  summary: string
  calorie_remaining: number
  macro_gaps: DietRecommendationMacroContext
  recommendations: DietRecommendationOption[]
  generated_by?: string
}

const DASHBOARD_TARGETS_STORAGE_KEY = 'food_link_dashboard_targets_v1'

/** 将服务端返回的摄入数据与本机暂存的目标合并（用于线上尚未返回自定义目标时） */
export function mergeHomeIntakeWithTargets(intake: HomeIntakeData, t: DashboardTargets): HomeIntakeData {
  const calorie_target = t.calorie_target
  const progress =
    calorie_target > 0
      ? Math.min(100.0, Math.round((intake.current / calorie_target) * 1000) / 10)
      : 0
  return {
    ...intake,
    target: calorie_target,
    progress,
    macros: {
      protein: { ...intake.macros.protein, target: t.protein_target },
      carbs: { ...intake.macros.carbs, target: t.carbs_target },
      fat: { ...intake.macros.fat, target: t.fat_target },
    },
  }
}

function parseDashboardTargetsFromUnknown(raw: unknown): DashboardTargets | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const calorie_target = Number(o.calorie_target)
  const protein_target = Number(o.protein_target)
  const carbs_target = Number(o.carbs_target)
  const fat_target = Number(o.fat_target)
  if (![calorie_target, protein_target, carbs_target, fat_target].every(Number.isFinite)) {
    return null
  }
  return { calorie_target, protein_target, carbs_target, fat_target }
}

/** 本机暂存的摄入目标（无后端或接口 404 时使用） */
export function getStoredDashboardTargets(): DashboardTargets | null {
  try {
    const raw = Taro.getStorageSync(DASHBOARD_TARGETS_STORAGE_KEY)
    return parseDashboardTargetsFromUnknown(raw)
  } catch {
    return null
  }
}

function clearStoredDashboardTargets(): void {
  try {
    Taro.removeStorageSync(DASHBOARD_TARGETS_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function persistDashboardTargetsLocal(data: DashboardTargets): void {
  try {
    Taro.setStorageSync(DASHBOARD_TARGETS_STORAGE_KEY, data)
  } catch (e) {
    console.error('写入本机摄入目标失败:', e)
  }
}

/** 数据统计接口返回（周/月） */
export interface StatsSummary {
  range: 'week' | 'month'
  start_date: string
  end_date: string
  tdee: number
  streak_days: number
  recorded_days?: number
  total_calories: number
  avg_calories_per_day: number
  cal_surplus_deficit: number
  total_protein: number
  total_carbs: number
  total_fat: number
  by_meal: {
    breakfast: number
    morning_snack: number
    lunch: number
    afternoon_snack: number
    dinner: number
    evening_snack: number
    /** 兼容旧字段，后端会镜像 afternoon_snack */
    snack?: number
  }
  daily_calories: Array<{ date: string; calories: number }>
  macro_percent: { protein: number; carbs: number; fat: number }
  analysis_summary: string
  analysis_summary_generated_date?: string | null
  analysis_summary_needs_refresh?: boolean
  analysis_summary_daily_limit?: number
  analysis_summary_used_today?: number
  body_metrics?: BodyMetricsSummary
  health_index?: HealthIndex
}

export interface AIUsagePricingResult {
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_input_tokens?: number
  cache_miss_input_tokens?: number
  input_usd_per_million_tokens: number
  output_usd_per_million_tokens: number
  cached_input_usd_per_million_tokens?: number
  provider_cost_cny: number
  charged_cny: number
  credits_charged: number
  uncapped_credits_charged?: number
  credits_per_cny: number
  usd_to_cny: number
  cost_multiplier: number
  gross_margin_rate: number
  minimum_credits: number
  maximum_credits_per_request?: number
  capped?: boolean
  pricing_source: string
}

export interface PetChatEstimateResponse {
  question: string
  range: 'week' | 'month'
  range_label: string
  recorded_days: number
  estimated_usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  pricing: AIUsagePricingResult
}

export interface PetChatResponse {
  question: string
  session_id: string
  user_message_id?: string
  assistant_message_id?: string
  range: 'week' | 'month'
  range_label: string
  answer: string
  recorded_days: number
  credits_charged: number
  billing_status: string
  ai_usage_pricing?: AIUsagePricingResult
  estimated_pricing: AIUsagePricingResult
}

export interface PetChatHistoryMessage {
  id: string
  role: 'user' | 'assistant' | 'pet'
  content: string
  message_type?: string
  range?: 'week' | 'month'
  credits_charged?: number
  meta?: Record<string, any>
  created_at?: string
}

export interface PetChatStreamMeta {
  session_id: string
  user_message_id?: string
  assistant_message_id?: string
  range: 'week' | 'month'
  range_label: string
  recorded_days: number
  credits_charged: number
  billing_status: string
  ai_usage_pricing?: AIUsagePricingResult
  estimated_pricing: AIUsagePricingResult
}

export interface PetChatHistoryResponse {
  session?: {
    ID?: string
    id?: string
    Title?: string
    title?: string
    RangeType?: 'week' | 'month'
    range_type?: 'week' | 'month'
  }
  messages: PetChatHistoryMessage[]
}

export interface PetChatSessionSummary {
  id: string
  title?: string
  range_type?: 'week' | 'month'
  recorded_days?: number
  last_question?: string
  last_answer?: string
  last_message_at?: string
  created_at?: string
  updated_at?: string
}

export interface PetChatSessionsResponse {
  sessions: PetChatSessionSummary[]
}

export interface SignalChip {
  label: string
  value: string
}

export type RiskTone = 'positive' | 'neutral' | 'warning' | 'danger'

export interface RiskCard {
  key: string
  title: string
  score: number
  tone: RiskTone
  brief: string
  summary: string
  basis: string
  action: string
  delta: number
  is_custom?: boolean
  needs_refresh?: boolean
  focus_label?: string
}

export interface RiskOption {
  key: string
  title: string
  short: string
  is_custom?: boolean
}

export interface CustomFocusMeta {
  max_focuses: number
  generate_cost: number
  daily_limit: number
  used_today: number
  remaining_today: number
}

export interface CustomHealthFocus {
  id: string
  label: string
  created_at: string
}

export interface TopIssue {
  title: string
  detail: string
}

export interface HealthIndex {
  has_enough_data: boolean
  overall_score: number
  projected_score: number
  overall_trend_label: string
  overview_copy: string
  signal_chips: SignalChip[]
  risk_cards: RiskCard[]
  custom_risk_cards?: RiskCard[]
  all_risk_options: RiskOption[]
  custom_focus_meta?: CustomFocusMeta
  top_issues: TopIssue[]
  action_list: string[]
}

export interface BodyMetricWeightEntry {
  id?: string
  date: string
  value: number
  client_id?: string | null
  recorded_at?: string | null
}

export interface BodyMetricWaterLogItem {
  id?: string
  date: string
  amount_ml: number
  recorded_at?: string | null
}

export interface BodyMetricWaterDay {
  date: string
  total: number
  logs: number[]
  log_items?: BodyMetricWaterLogItem[]
}

export interface BodyMetricsSummary {
  range: 'week' | 'month'
  start_date: string
  end_date: string
  weight_entries: BodyMetricWeightEntry[]
  /** 统计区间内每日体重（LOCF：无新记录时沿用上次体重，供趋势展示） */
  weight_trend_daily?: Array<{ date: string; value: number }>
  latest_weight?: BodyMetricWeightEntry | null
  previous_weight?: BodyMetricWeightEntry | null
  weight_change?: number | null
  water_goal_ml: number
  today_water: BodyMetricWaterDay
  water_daily: BodyMetricWaterDay[]
  total_water_ml: number
  avg_daily_water_ml: number
  water_recorded_days: number
}

export interface BodyMetricsLocalSnapshot {
  weight_entries: BodyMetricWeightEntry[]
  water_by_date: Record<string, { total: number; logs: number[] }>
  water_goal_ml?: number
}

// 登录请求接口
export interface LoginRequest {
  code: string
}

// 登录请求接口
export interface LoginRequestParams {
  code: string
  phoneCode?: string
  /** 注册时填写邀请人码，达标后双方获得邀请权益（后端校验） */
  inviteCode?: string
  /** 开发环境测试用：模拟新用户的 openid */
  testOpenid?: string
}

export interface PasswordRegisterRequest {
  username?: string
  phone: string
  password: string
  nickname: string
  /** 注册时填写邀请人码，达标后双方获得邀请权益 */
  inviteCode?: string
}

export interface PublicConfigResponse {
  allow_debug_register: boolean
}

// 登录响应接口
export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user_id: string
  openid: string
  unionid?: string
  phoneNumber?: string
  purePhoneNumber?: string
  countryCode?: string
  diet_goal?: string
}

// 用户信息接口
export interface UserInfo {
  id: string
  openid: string
  unionid?: string
  nickname: string
  avatar: string
  cover_image?: string
  motto?: string
  telephone?: string
  create_time?: string
  update_time?: string
  /** 健康档案相关（扩展字段） */
  height?: number | null
  weight?: number | null
  birthday?: string | null
  gender?: string | null
  activity_level?: string | null
  health_condition?: HealthCondition | null
  bmr?: number | null
  tdee?: number | null
  onboarding_completed?: boolean
  /** 健康档案引导状态；旧后端未返回时由 onboarding_completed 兼容推断。 */
  onboarding_status?: OnboardingStatus
  execution_mode?: ExecutionMode | null
  mode_set_by?: string | null
  mode_set_at?: string | null
  mode_reason?: string | null
  mode_commitment_days?: number | null
  mode_switch_count_30d?: number | null
  searchable?: boolean
  public_records?: boolean
	public_favorite_recipes?: boolean
}

export type MembershipTier = 'light' | 'standard' | 'advanced'
export type MembershipPeriod = 'monthly' | 'quarterly' | 'yearly'

export interface MembershipPlan {
  code: string
  name: string
  amount: number
  duration_months: number
  description?: string | null
  /** 档位，null 表示旧套餐（如 pro_monthly），不参与新矩阵 */
  tier?: MembershipTier | null
  /** 周期，null 表示旧套餐 */
  period?: MembershipPeriod | null
  /** 套餐每日可用积分 */
  daily_credits?: number
  /** 对照价（原价），用于"立省 xx 元"。null 表示无对照 */
  original_amount?: number | null
  /** 立省金额 = original_amount - amount，后端算好，null 表示不展示 */
  savings?: number | null
  /** 排序权重 */
  sort_order?: number
  is_test_plan?: boolean
}

export interface MembershipStatus {
  is_pro: boolean
  status: 'inactive' | 'active' | 'expired' | 'cancelled'
  current_plan_code?: string | null
  first_activated_at?: string | null
  current_period_start?: string | null
  expires_at?: string | null
  last_paid_at?: string | null
  auto_renew?: boolean
  auto_renew_contract?: MembershipAutoRenewContract | null
  /** 旧拍照日限，当前关闭，可能为 null */
  daily_limit: number | null
  daily_used: number | null
  daily_remaining: number | null
  /** 新积分体系（2026-04-21 起） */
  daily_credits_max?: number
  daily_credits_used?: number
  daily_credits_remaining?: number
  /** 基础积分（套餐/试用） */
  daily_credits_base?: number
  /** 今日额外奖励积分 */
  daily_bonus_credits?: number
  /** 今日旧版邀请奖励积分 */
  invite_bonus_credits?: number
  /** 今日海报奖励积分 */
  share_bonus_credits?: number
  /** 今日剩余系统积分，次日清零 */
  system_credits_remaining?: number
  /** 用户累计奖励积分余额，不次日清零 */
  earned_credits_balance?: number
  /** 今日从累计奖励积分中消耗的额度 */
  earned_credits_consumed_today?: number
  /** 当前总可用积分 = 系统剩余 + 累计奖励余额 */
  total_credits_available?: number
  /** 次日 00:00+08:00 的 ISO 字符串，用于倒计时 */
  credits_reset_at?: string | null
  /** 是否在免费试用期内 */
  trial_active?: boolean
  /** 试用期截止时间（UTC ISO） */
  trial_expires_at?: string | null
  /** 当前试用总天数：前 500 名为 60，501-1000 名为 30，其余新用户为 3 */
  trial_days_total?: number
  /** 试用策略标识：founding_top_500_bonus_month / early_first_1000 / regular_new_user */
  trial_policy?: 'founding_top_500_bonus_month' | 'early_first_1000' | 'regular_new_user' | null
  /** 若属于首批用户，返回其注册序号（1-based） */
  early_user_rank?: number | null
  /** 前 1000 注册用户活动总名额 */
  early_user_limit?: number
  /** 若属于前 100 付费用户，返回其付费序号（1-based） */
  early_paid_user_rank?: number | null
  /** 前 100 付费用户活动总名额 */
  early_paid_user_limit?: number
  /** 创始会员积分倍数 */
  early_user_paid_bonus_multiplier?: number
  /** 是否属于创始用户翻倍活动（前 1000 注册或前 100 付费） */
  early_user_paid_bonus_eligible?: boolean
  /** 创始翻倍来源：前 1000 注册 / 前 100 付费 / 同时满足 */
  early_user_paid_bonus_source?: 'registration_top_1000' | 'paid_top_100' | 'both' | null
  /** 当前付费状态是否已按创始翻倍生效 */
  early_user_paid_bonus_active?: boolean
  points_balance?: number | null
}

export interface MembershipAutoRenewContract {
  status: 'pending' | 'active' | 'termination_requested'
  plan_code: string
  template_id: string
  renewal_state: string
  next_action_at?: string | null
  renewal_due_at?: string | null
}

export interface CreateMembershipAutoRenewSigningResponse {
  target_app_id: string
  path: string
  extra_data: Record<string, any>
  plan_code: string
  plan_name: string
}

export interface ClaimSharePosterRewardResponse {
  claimed: boolean
  already_claimed: boolean
  /** 今日是否已达海报分享领奖次数上限（与 share_poster_claims_today 配合） */
  daily_cap_reached?: boolean
  /** 今日已成功领取海报分享奖励的次数（含本次） */
  share_poster_claims_today?: number
  credits: number
  daily_credits_max?: number
  daily_credits_remaining?: number
  earned_credits_balance?: number | null
  total_credits_available?: number | null
  message: string
  points_balance?: number | null
}

export type SharePosterRewardScope = 'daily_food' | 'daily_summary'

export interface ClaimSharePosterRewardInput {
  record_id?: string
  share_scope?: SharePosterRewardScope
  share_date?: string
}

export interface RewardCenterTask {
  action_type: string
  name: string
  reward_amount: number
  today_count: number
  daily_limit: number | null
  status: string
  action_path: string
}

export interface RewardCenterResponse {
  earned_credits_balance: number
  today_earned_credits: number
  today_task_overview: {
    completed_count: number
    total_count: number
  }
  tasks: RewardCenterTask[]
  invite_reward?: InviteRewardCenterSummary | null
}

export interface VoucherItem {
  id: string
  user_id: string
  voucher_type: 'registration_trial' | 'invite_light_week' | 'admin_points'
  status: 'pending' | 'used' | 'expired' | 'cancelled'
  title: string
  description?: string | null
  reward_payload?: Record<string, any>
  source_type: string
  source_key: string
  valid_start_at?: string | null
  valid_end_at?: string | null
  used_at?: string | null
  created_at?: string
}

export interface VoucherListResponse {
  items: VoucherItem[]
  total: number
}

export interface InviteRewardStatusItem {
  referral_id: string
  status: string
  records_needed: number
  reward_credits: number
  reward_type?: string | null
  reward_label?: string | null
  reward_days?: number | null
  reward_plan_code?: string | null
}

export interface InviteRewardStatusAsInvitee extends InviteRewardStatusItem {
  inviter_nickname: string
}

export interface InviteRewardStatusAsInviter extends InviteRewardStatusItem {
  invitee_nickname: string
}

export type InviteRewardRole = 'invitee' | 'inviter'

export type InviteRewardStatus =
  | 'pending_qualified'
  | 'reward_completed'
  | 'reward_blocked'
  | 'reward_active'
  | 'cancelled'
  | string

export interface InviteRewardRecord {
  referral_id: string
  role: InviteRewardRole
  status: InviteRewardStatus
  status_label?: string | null
  invite_code?: string | null
  other_user_id?: string | null
  other_nickname?: string | null
  records_needed?: number | null
  reward_credits?: number | null
  reward_type?: string | null
  reward_label?: string | null
  reward_days?: number | null
  reward_plan_code?: string | null
  membership_grant_start_at?: string | null
  membership_grant_expires_at?: string | null
  requirement_text?: string | null
  next_action_text?: string | null
  first_effective_action_at?: string | null
  first_effective_action_type?: string | null
  reward_start_date?: string | null
  reward_end_date?: string | null
  blocked_reason?: string | null
  blocked_reason_label?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface InviteRewardInviterSummary {
  invited_count: number
  completed_count: number
  pending_count: number
  estimated_credits: number
  earned_credits: number
  reward_credits: number
  reward_type?: string | null
  reward_label?: string | null
  reward_days?: number | null
  reward_plan_code?: string | null
  estimated_membership_grants?: number | null
  earned_membership_grants?: number | null
  records?: InviteRewardRecord[]
}

export interface InviteRewardInviteeSummary {
  completed_days: number
  required_days: number
  remaining_days: number
  reward_credits: number
  reward_type?: string | null
  reward_label?: string | null
  reward_days?: number | null
  reward_plan_code?: string | null
  deadline_text?: string | null
  next_action_text?: string | null
  record?: InviteRewardRecord | null
}

export interface InviteRewardCenterSummary {
  as_inviter_summary?: InviteRewardInviterSummary | null
  as_invitee_summary?: InviteRewardInviteeSummary | null
  records?: InviteRewardRecord[]
}

export interface InviteRewardStatusResponse {
  as_invitee: InviteRewardStatusAsInvitee | null
  as_inviter: InviteRewardStatusAsInviter[]
  records?: InviteRewardRecord[]
}

export interface MembershipPlansResponse {
  list: MembershipPlan[]
}

export type FoodExpiryStorageType = 'room_temp' | 'refrigerated' | 'frozen'
export type FoodExpiryStatus = 'active' | 'consumed' | 'discarded'
export type FoodExpirySourceType = 'manual' | 'ocr' | 'ai'
export type FoodExpiryUrgency = 'expired' | 'today' | 'soon' | 'fresh'

export interface FoodExpiryItem {
  id: string
  user_id: string
  food_name: string
  category?: string | null
  storage_type: FoodExpiryStorageType
  storage_type_label?: string
  quantity_note?: string | null
  expire_date: string
  opened_date?: string | null
  note?: string | null
  source_type: FoodExpirySourceType
  status: FoodExpiryStatus
  status_label?: string
  urgency?: FoodExpiryUrgency
  urgency_label?: string
  days_until_expire?: number | null
  created_at: string
  updated_at: string
}

export interface FoodExpiryDashboard {
  active_count: number
  expired_count: number
  today_count: number
  soon_count: number
  processed_count: number
  preview_items: FoodExpiryItem[]
}

export interface UpsertFoodExpiryItemRequest {
  food_name: string
  category?: string
  storage_type?: FoodExpiryStorageType
  quantity_note?: string
  expire_date: string
  opened_date?: string
  note?: string
  source_type?: FoodExpirySourceType
  status?: FoodExpiryStatus
}

export interface FoodExpiryRecognitionItem {
  food_name: string
  category?: string | null
  storage_type?: FoodExpiryStorageType
  quantity_note?: string | null
  expire_date: string
  opened_date?: string | null
  note?: string | null
  source_type?: FoodExpirySourceType
  suggested_days?: number | null
  expire_date_is_estimated?: boolean
  confidence?: number | null
  recognition_basis?: string | null
  missing_fields?: string[]
}

export interface FoodExpiryRecognitionResponse {
  task_id: string
  credits_cost: number
  items: FoodExpiryRecognitionItem[]
  message: string
}

export interface FoodExpirySubscribeRequest {
  subscribe_status: string
  err_msg?: string
}

export interface FoodExpirySubscribeResponse {
  subscribed: boolean
  schedule_created: boolean
  status?: string
  scheduled_at?: string | null
  message: string
}

export interface CreateMembershipPaymentResponse {
  order_no: string
  plan_code: string
  amount: number
  original_amount?: number
  order_mode?: 'new_purchase' | 'renewal' | 'prorated_current_period_upgrade' | string
  upgrade_terms?: Record<string, any>
  pay_params: {
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  }
}

export interface SyncMembershipPaymentResponse {
  synced: boolean
  status: string
  trade_state?: string
  membership?: MembershipStatus
}

/** 积分充值下单（微信支付 JSAPI），回调到账后增加积分 */
export interface CreatePointsRechargeResponse {
  order_no: string
  amount_yuan: number
  points_to_add: number
  pay_params: {
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  }
}

export interface ReportExtractIndicator {
  name: string
  value: string
  unit: string
  flag: string
}

export interface ReportExtract {
  indicators?: ReportExtractIndicator[]
  conclusions?: string[]
  suggestions?: string[]
  medical_notes?: string
  _image_urls?: string[]
  _status?: 'processing' | 'done' | 'failed' | string
  _error?: string
}

/** 健康档案中的病史/饮食/过敏等 JSON */
export interface HealthCondition {
  medical_history?: string[]
  diet_preference?: string[]
  allergies?: string[]
  health_notes?: string
  routine_type?: string
  routine_sleep_hour?: number
  routine_wake_hour?: number
  daily_life_activity_level?: string
  report_extract?: ReportExtract | null
  precision_reference_defaults?: PrecisionReferenceDefaults
  [key: string]: unknown
}

/** 健康档案（GET 返回） */
export type OnboardingStatus = 'pending' | 'skipped' | 'completed'

export interface HealthProfile {
  height?: number | null
  weight?: number | null
  birthday?: string | null
  gender?: string | null
  activity_level?: string | null
  health_condition?: HealthCondition | null
  bmr?: number | null
  tdee?: number | null
  onboarding_completed?: boolean
  onboarding_status?: OnboardingStatus
  diet_goal?: string | null
  execution_mode?: ExecutionMode | null
  mode_set_by?: string | null
  mode_set_at?: string | null
  mode_reason?: string | null
  mode_commitment_days?: number | null
  mode_switch_count_30d?: number | null
}

/** 提交健康档案问卷请求 */
export interface HealthProfileUpdateRequest {
  /** 仅“稍后填写”使用；完整问卷保存由后端自动标记为 completed。 */
  onboarding_status?: 'skipped'
  gender?: string
  birthday?: string
  height?: number
  weight?: number
  activity_level?: string
  daily_life_activity_level?: string
  medical_history?: string[]
  diet_preference?: string[]
  allergies?: string[]
  health_notes?: string
  routine_type?: string
  routine_sleep_hour?: number
  routine_wake_hour?: number
  /** 体检报告 OCR 识别结果，保存时与问卷一并写入 user_health_documents */
  report_extract?: ReportExtract | null
  /** 体检报告图片在 Supabase Storage 的 URL，保存时写入 user_health_documents.image_url */
  report_image_url?: string
  diet_goal?: string
  execution_mode?: ExecutionMode
  mode_set_by?: 'system' | 'user_manual' | 'coach_manual'
  mode_reason?: string
  /** 首页摄入目标，写入 health_condition.dashboard_targets（兼容未部署独立接口的生产环境） */
  dashboard_targets?: DashboardTargets
  /** 精准模式默认参考物配置，写入 health_condition.precision_reference_defaults */
  precision_reference_defaults?: PrecisionReferenceDefaults
}

// 更新用户信息请求接口
export interface UpdateUserInfoRequest {
  nickname?: string
  avatar?: string
  cover_image?: string
  motto?: string
  telephone?: string
  searchable?: boolean
  public_records?: boolean
	public_favorite_recipes?: boolean
}

/**
 * 将本地或网络可访问的图片转为 base64（供上传接口使用）
 * 说明：新版微信开发者工具在「webview 渲染」下，chooseMedia 等 API 可能返回
 * `http://tmp/...` 形式的临时地址，FileSystemManager.readFile 无法直接读取；
 * 需先 downloadFile 或 getImageInfo 得到可读本地路径。
 */
export async function imageToBase64(imagePath: string): Promise<string> {
  const raw = (imagePath || '').trim()
  if (!raw) {
    throw new Error('图片路径为空')
  }

  const inferMimeType = (path: string): string => {
    const ext = ((path.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)?.[1]) || '').toLowerCase()
    if (ext === 'png') return 'image/png'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    if (ext === 'heic' || ext === 'heif') return 'image/heic'
    return 'image/jpeg'
  }

  const requestBase64FromHttp = async (url: string): Promise<string | null> => {
    try {
      const res = await Taro.request<ArrayBuffer>({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: 15000,
      })
      if (res.statusCode < 200 || res.statusCode >= 300 || !res.data) {
        throw new Error(`http status ${res.statusCode}`)
      }
      const toBase64 = (Taro as any).arrayBufferToBase64 || (globalThis as any)?.wx?.arrayBufferToBase64
      if (typeof toBase64 !== 'function') {
        throw new Error('arrayBufferToBase64 不可用')
      }
      const b64 = String(toBase64(res.data) || '')
      if (!b64) {
        throw new Error('arrayBuffer 转 base64 结果为空')
      }
      return `data:${inferMimeType(url)};base64,${b64}`
    } catch (err) {
      console.warn('HTTP 转 base64 失败:', url, err)
      return null
    }
  }

  const readBase64FromPath = (path: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      Taro.getFileSystemManager().readFile({
        filePath: path,
        encoding: 'base64',
        success: (res) => resolve(String(res.data || '')),
        fail: (err) => reject(err)
      })
    })
  }

  const normalizeTmpPath = (path: string) => {
    // 开发者工具 webview 渲染下常见临时路径：http://tmp/xxx
    if (/^https?:\/\/tmp\//i.test(path)) {
      return path.replace(/^https?:\/\/tmp\//i, 'wxfile://tmp/')
    }
    return path
  }

  const candidatePaths: string[] = []
  const pushCandidate = (path?: string) => {
    const next = (path || '').trim()
    if (!next) return
    if (!candidatePaths.includes(next)) {
      candidatePaths.push(next)
    }
  }

  pushCandidate(raw)
  const normalizedRaw = normalizeTmpPath(raw)
  pushCandidate(normalizedRaw)

  if (/^https?:\/\//i.test(raw) && !/^https?:\/\/tmp\//i.test(raw)) {
    try {
      const dl = await Taro.downloadFile({ url: raw })
      if (dl.statusCode !== 200 || !dl.tempFilePath) {
        throw new Error(`download status ${dl.statusCode ?? 'unknown'}`)
      }
      pushCandidate(dl.tempFilePath)

      // downloadFile 成功后再尝试 getImageInfo，部分环境可得到更稳定的本地路径
      try {
        const info = await Taro.getImageInfo({ src: dl.tempFilePath })
        pushCandidate(info.path)
      } catch (infoErr) {
        console.warn('download 后 getImageInfo 失败:', infoErr)
      }
    } catch (firstErr) {
      console.warn('downloadFile 失败，尝试 getImageInfo:', firstErr)
    }
  }

  // 无论原始路径是否 http，都尝试通过 getImageInfo 拿可读路径（对 devtools 临时路径失效更稳）
  for (const src of [raw, normalizedRaw]) {
    if (!src) continue
    try {
      const info = await Taro.getImageInfo({ src })
      pushCandidate(info.path)
    } catch (e) {
      console.warn('getImageInfo 失败:', src, e)
    }
  }

  let lastErr: unknown = null
  for (const path of candidatePaths) {
    if (/^https?:\/\//i.test(path)) {
      continue
    }
    try {
      const base64 = await readBase64FromPath(path)
      if (base64) {
        return `data:image/jpeg;base64,${base64}`
      }
    } catch (err) {
      lastErr = err
      console.warn('读取图片失败，尝试下一个路径:', path, err)
    }
  }

  // 针对 devtools 的 http://tmp 场景，绕过文件系统直接按 HTTP 取字节转 base64
  if (/^https?:\/\//i.test(raw)) {
    const viaHttp = await requestBase64FromHttp(raw)
    if (viaHttp) return viaHttp
  }
  if (/^https?:\/\//i.test(normalizedRaw) && normalizedRaw !== raw) {
    const viaHttp = await requestBase64FromHttp(normalizedRaw)
    if (viaHttp) return viaHttp
  }

  console.error('图片转base64失败:', { raw, candidatePaths, lastErr })
  throw new Error('图片读取失败，请重新拍照/选择后再试')
}

async function getLocalFileSize(localPath: string): Promise<number | null> {
  const raw = (localPath || '').trim()
  if (!raw || /^https?:\/\//i.test(raw)) return null

  const fs = typeof Taro.getFileSystemManager === 'function' ? Taro.getFileSystemManager() : null
  if (!fs) return null

  try {
    const res = await new Promise<any>((resolve, reject) => {
      fs.getFileInfo({
        filePath: raw,
        success: resolve,
        fail: reject,
      })
    })
    const size = Number(res?.size)
    return Number.isFinite(size) && size >= 0 ? size : null
  } catch {
    return null
  }
}

/**
 * 上传前压缩本地图片，尽量把请求体控制在安全范围。
 * 小程序端优先走文件直传；若后端仍是旧版，再回退 base64 上传。
 */
export async function compressImagePathForUpload(localPath: string): Promise<string> {
  const raw = (localPath || '').trim()
  if (!raw) return raw
  if (typeof Taro.getEnv === 'function' && Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) {
    return raw
  }

  const targetBytes = 2.5 * 1024 * 1024
  const originalSize = await getLocalFileSize(raw)
  if (originalSize !== null && originalSize <= targetBytes) {
    return raw
  }

  const qualities = [88, 78, 68, 58]
  let bestPath = raw
  let bestSize = originalSize

  for (const quality of qualities) {
    try {
      const res = await Taro.compressImage({
        src: bestPath || raw,
        quality,
      })
      const next = (res as { tempFilePath?: string })?.tempFilePath?.trim()
      if (!next) continue

      const nextSize = await getLocalFileSize(next)
      if (nextSize !== null && (bestSize === null || nextSize < bestSize)) {
        bestPath = next
        bestSize = nextSize
      } else if (!bestPath) {
        bestPath = next
      }

      if (nextSize !== null && nextSize <= targetBytes) {
        return next
      }
    } catch (e) {
      console.warn(`compressImagePathForUpload 质量 ${quality} 压缩失败，尝试下一档:`, e)
    }
  }

  return bestPath || raw
}

function formatUploadAnalyzeHttpError(statusCode: number, data: unknown): string {
  const parsed = parseFastApiDetail(data)
  if (parsed) return parsed
  if (statusCode === 413) {
    return '图片体积过大，请重新拍照或选择较小的图片后再试'
  }
  if (statusCode === 401 || statusCode === 403) {
    return '登录已失效，请重新登录后再试'
  }
  return `上传图片失败（HTTP ${statusCode}）`
}

/** 微信端 `Taro.request` 的 `data` 有时为已解析对象，有时为 JSON 字符串 */
function normalizeTaroResponseJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return null
    try {
      const parsed = JSON.parse(text) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

/**
 * 解包后端标准响应 (ApiResponse<T>) {code, message, data}
 * 当后端返回 {code: 0, data: ...} 时提取 data
 * 当 code !== 0 时抛出包含 message 的错误
 * 当响应没有 code 字段时（兼容旧后端/透传接口）原样返回
 */
export function unwrapResponse<T>(res: Taro.request.SuccessCallbackResult<any>): T {
  const parsed = normalizeTaroResponseJson(res.data)
  if (!parsed) return res.data as T
  if (typeof parsed.code !== 'number') return res.data as T
  if (parsed.code !== 0) {
    const msg = typeof parsed.message === 'string' ? parsed.message : '请求失败'
    throw new Error(msg)
  }
  return parsed.data as T
}

/** 解析 FastAPI `detail`（字符串或校验错误数组） */
function parseFastApiDetail(data: unknown): string | undefined {
  const obj = normalizeTaroResponseJson(data)
  if (!obj) return undefined
  const d = obj.detail
  if (typeof d === 'string' && d.trim()) {
    const text = d.trim()
    // 某些后端会把上游 JSON 错误整体塞进 detail 字符串，这里优先提取可读 message
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (parsed && typeof parsed === 'object') {
        const topMessage = typeof parsed.message === 'string' ? parsed.message.trim() : ''
        if (topMessage) return topMessage
        const nestedDetails = typeof parsed.details === 'string' ? parsed.details : ''
        if (nestedDetails) {
          try {
            const nestedParsed = JSON.parse(nestedDetails) as Record<string, unknown>
            const nestedMessage = typeof nestedParsed?.message === 'string' ? nestedParsed.message.trim() : ''
            if (nestedMessage) return nestedMessage
          } catch {
            // ignore nested parse error
          }
        }
      }
    } catch {
      // ignore JSON parse error
    }
    // 兼容 Python/日志风格单引号 pseudo-json：{'message': '...'}
    const pseudoMessage = text.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/i)?.[1]
    if (pseudoMessage && pseudoMessage.trim()) return pseudoMessage.trim()
    const nestedPseudo = text.match(/['"]details['"]\s*:\s*['"]([^'"]+)['"]/i)?.[1]
    if (nestedPseudo && nestedPseudo.trim()) {
      const nestedMsg = nestedPseudo.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/i)?.[1]
      if (nestedMsg && nestedMsg.trim()) return nestedMsg.trim()
    }
    return text
  }
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0] as { msg?: string }
    if (typeof first?.msg === 'string' && first.msg.trim()) return first.msg.trim()
  }
  const m = obj.message
  if (typeof m === 'string' && m.trim()) return m.trim()
  return undefined
}

type ErrorLike = Error & {
  statusCode?: number
  traceId?: string
  requestId?: string
  hostName?: string
}

function getHeaderValueIgnoreCase(headers: Record<string, any> | undefined, key: string): string | undefined {
  if (!headers) return undefined
  const target = key.toLowerCase()
  const matchedKey = Object.keys(headers).find((k) => k.toLowerCase() === target)
  if (!matchedKey) return undefined
  const value = headers[matchedKey]
  if (value == null) return undefined
  const text = String(value).trim()
  return text || undefined
}

function isPlaceholderTraceId(value: string | undefined): boolean {
  const text = String(value || '').trim().toLowerCase()
  return text === 'no-trace-id' || text === 'none' || text === 'null' || text === 'undefined'
}

function normalizeTraceId(value: string | undefined): string | undefined {
  const text = String(value || '').trim()
  if (!text || isPlaceholderTraceId(text)) return undefined
  return text
}

function extractTraceIdFromHeaders(headers: Record<string, any> | undefined): string | undefined {
  return normalizeTraceId(getHeaderValueIgnoreCase(headers, 'x-trace-id'))
}

function extractRequestIdFromHeaders(headers: Record<string, any> | undefined): string | undefined {
  return getHeaderValueIgnoreCase(headers, 'x-request-id')
}

function extractHostNameFromHeaders(headers: Record<string, any> | undefined): string | undefined {
  return getHeaderValueIgnoreCase(headers, 'x-host-name')
}

const RECENT_REQUEST_TRACE_STORAGE_KEY = 'recent_request_traces_v1'

export interface RecentRequestTrace {
  method: string
  path: string
  statusCode: number
  durationMs: number
  startedAt: string
  traceId?: string
  requestId?: string
  hostName?: string
  errorMessage?: string
}

function normalizeRequestPath(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return '/'
  if (raw.startsWith(API_BASE_URL)) {
    return raw.slice(API_BASE_URL.length) || '/'
  }
  try {
    const parsed = new URL(raw)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`
  }
}

function trimRecentRequestTraces(items: RecentRequestTrace[]): RecentRequestTrace[] {
  if (RECENT_REQUEST_TRACE_LIMIT <= 0) return []
  return items.slice(-RECENT_REQUEST_TRACE_LIMIT)
}

let recentRequestTraces: RecentRequestTrace[] | null = null

function loadRecentRequestTraces(): RecentRequestTrace[] {
  if (recentRequestTraces) return recentRequestTraces
  try {
    const cached = Taro.getStorageSync(RECENT_REQUEST_TRACE_STORAGE_KEY)
    recentRequestTraces = Array.isArray(cached) ? trimRecentRequestTraces(cached as RecentRequestTrace[]) : []
  } catch {
    recentRequestTraces = []
  }
  return recentRequestTraces
}

function persistRecentRequestTraces(items: RecentRequestTrace[]): void {
  try {
    Taro.setStorageSync(RECENT_REQUEST_TRACE_STORAGE_KEY, items)
  } catch (error) {
    console.warn('[API TRACE] 保存最近请求诊断失败', error)
  }
}

function recordRecentRequestTrace(entry: RecentRequestTrace): void {
  if (RECENT_REQUEST_TRACE_LIMIT <= 0) return
  const next = trimRecentRequestTraces([...loadRecentRequestTraces(), entry])
  recentRequestTraces = next
  persistRecentRequestTraces(next)
}

export function getRecentRequestTraces(limit = RECENT_REQUEST_TRACE_LIMIT): RecentRequestTrace[] {
  const normalizedLimit = Math.min(RECENT_REQUEST_TRACE_LIMIT, Math.max(0, Math.floor(limit)))
  if (normalizedLimit <= 0) return []
  return loadRecentRequestTraces().slice(-normalizedLimit)
}

function extractRequestErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message.slice(0, 160)
  }
  if (error && typeof error === 'object') {
    const record = error as { errMsg?: string; message?: string }
    const message = record.errMsg || record.message
    if (typeof message === 'string' && message.trim()) {
      return message.trim().slice(0, 160)
    }
  }
  return undefined
}

function recordResponseTrace(params: {
  url: string
  method?: string
  startedAt: number
  response?: Taro.request.SuccessCallbackResult<any>
  error?: unknown
}): void {
  const { url, method, startedAt, response, error } = params
  const headers = response?.header as Record<string, any> | undefined
  const statusCode = response?.statusCode ?? 0
  const errorMessage = extractRequestErrorMessage(error)
  recordRecentRequestTrace({
    method: String(method || 'GET').toUpperCase(),
    path: normalizeRequestPath(url),
    statusCode,
    durationMs: Math.max(0, Date.now() - startedAt),
    startedAt: new Date(startedAt).toISOString(),
    traceId: extractTraceIdFromHeaders(headers),
    requestId: extractRequestIdFromHeaders(headers),
    hostName: extractHostNameFromHeaders(headers),
    errorMessage: errorMessage || (statusCode === 0 ? '未收到 HTTP 响应（可能网络失败或请求被中断）' : undefined),
  })
}

function getCurrentPagePath(): string {
  try {
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1] as { route?: string; options?: Record<string, string> } | undefined
    if (!current?.route) return ''
    const query = current.options ? new URLSearchParams(current.options).toString() : ''
    return query ? `/${current.route}?${query}` : `/${current.route}`
  } catch {
    return ''
  }
}

function formatUserErrorWithTrace(message: string, traceId?: string): string {
  const msg = (message || '').trim() || '网络错误，请稍后重试'
  const normalizedTraceId = normalizeTraceId(traceId)
  if (!normalizedTraceId) return msg
  return `${msg}（traceId: ${normalizedTraceId}）`
}

export function sanitizeUserFacingErrorMessage(message: unknown, fallback: string = '请求失败，请稍后重试'): string {
  const raw = String(message || '').trim()
  if (!raw) return fallback
  const lower = raw.toLowerCase()
  if (
    lower.includes('<html') ||
    lower.includes('<!doctype html') ||
    lower.includes('<head') ||
    lower.includes('<body')
  ) {
    return 'AI 服务返回异常网页，请联系管理员检查模型配置'
  }
  if (
    lower.includes('context deadline exceeded') ||
    lower.includes('client.timeout') ||
    lower.includes('timeout exceeded while awaiting headers') ||
    lower.includes('net/http: timeout') ||
    lower.includes('i/o timeout') ||
    lower.includes('tls handshake timeout')
  ) {
    return 'AI 识别服务响应超时，请稍后重试'
  }
  if (
    lower === 'eof' ||
    lower.endsWith(': eof') ||
    lower.includes('unexpected eof') ||
    lower.includes('connection reset') ||
    lower.includes('connection refused') ||
    lower.includes('server closed idle connection') ||
    lower.includes('use of closed network connection') ||
    lower.includes('socket hang up')
  ) {
    return 'AI 识别服务连接中断，请稍后重试'
  }
  if (
    lower.includes('resource exhausted') ||
    lower.includes('api error 429') ||
    lower.includes('too many requests')
  ) {
    return 'AI 识别服务当前繁忙，请稍后重试'
  }
  if (
    lower.includes('incorrect api key') ||
    lower.includes('api key format is incorrect') ||
    lower.includes('authenticationerror') ||
    lower.includes('apikey-error') ||
    lower.includes('api error 401')
  ) {
    return 'AI 识别服务配置异常，请联系管理员处理'
  }
  if (
    lower.includes('internalserviceerror') ||
    lower.includes('api error 500') ||
    lower.includes('api error 502') ||
    lower.includes('api error 503') ||
    lower.includes('api error 504')
  ) {
    return 'AI 识别服务暂时不可用，请稍后重试'
  }
  if (
    lower.includes('http://') ||
    lower.includes('https://') ||
    lower.includes('/chat/completions') ||
    lower.includes('/responses') ||
    lower.includes('yunwu.ai') ||
    lower.includes('api.ofox.ai') ||
    lower.includes('ark.cn-beijing.volces.com')
  ) {
    return fallback
  }
  return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
}

/** 从文案里去掉已拼接的 traceId 后缀，避免弹窗里重复展示 */
function stripTraceSuffixFromUserMessage(message: string): string {
  let s = (message || '').trim()
  s = s.replace(/\s*[\(（]\s*traceId\s*[:：]\s*[\w-]+\s*[\)）]\s*$/gi, '')
  s = s.replace(/\s*traceId\s*[:：]\s*[\w-]+\s*$/gi, '')
  return s.trim()
}

export function getTraceIdFromError(error: unknown): string | undefined {
  const err = error as ErrorLike | undefined
  const trace = normalizeTraceId(err?.traceId)
  if (trace) return trace
  const message = String(err?.message || '')
  const m = message.match(/traceId\s*[:：]\s*([\w-]+)/i)
  return normalizeTraceId(m?.[1])
}

/** 微信 toast 文案过长时体验较差，统一截断 */
function truncateToastTitle(text: string, max = 26): string {
  const t = (text || '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

export async function showUnifiedApiError(error: unknown, fallback: string = '网络错误，请稍后重试'): Promise<void> {
  const err = error as ErrorLike | undefined
  const traceId = getTraceIdFromError(err)
  const raw = (err?.message || '').trim()
  const userMsg = sanitizeUserFacingErrorMessage(stripTraceSuffixFromUserMessage(raw), fallback)
  if (isPlaceholderTraceId(raw) || isPlaceholderTraceId(userMsg)) {
    console.warn('[showUnifiedApiError] ignored placeholder trace id error', { message: raw || userMsg })
    return
  }
  console.warn('[showUnifiedApiError]', {
    message: raw || userMsg,
    traceId,
    requestId: err?.requestId,
    hostName: err?.hostName,
  })
  try {
    await Taro.showToast({
      title: truncateToastTitle(userMsg || '请求失败，请稍后重试'),
      icon: 'none',
      duration: 2200,
    })
  } catch (toastError) {
    console.warn('[showUnifiedApiError] showToast failed', toastError)
  }
}

/** 抛出带 HTTP 状态码的错误，便于页面区分 429 等场景 */
function throwHttpErrorWithStatus(
  statusCode: number,
  data: unknown,
  fallback: string,
  headers?: Record<string, any>,
  url?: string
): never {
  const msg = parseFastApiDetail(data) || fallback
  const traceId = extractTraceIdFromHeaders(headers)
  const requestId = extractRequestIdFromHeaders(headers)
  const hostName = extractHostNameFromHeaders(headers)
  console.error('[API DIAGNOSTIC]', {
    url,
    statusCode,
    message: msg,
    traceId,
    requestId,
    hostName,
    responseData: data,
  })
  const err = new Error(formatUserErrorWithTrace(msg, traceId)) as ErrorLike
  err.statusCode = statusCode
  if (traceId) err.traceId = traceId
  if (requestId) err.requestId = requestId
  if (hostName) err.hostName = hostName
  throw err
}

function parseUploadAnalyzeResponseData(rawData: unknown): Record<string, any> | null {
  if (rawData && typeof rawData === 'object') {
    return rawData as Record<string, any>
  }
  if (typeof rawData !== 'string') return null

  const text = rawData.trim()
  if (!text) return null

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null
  } catch {
    return null
  }
}

function unwrapUploadAnalyzePayload(parsedData: Record<string, any> | null): Record<string, any> | null {
  if (!parsedData) return null
  if (typeof parsedData.code === 'number') {
    if (parsedData.code !== 0) return parsedData
    const data = parsedData.data
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, any>)
      : parsedData
  }
  return parsedData
}

export async function uploadAnalyzeImageFile(localPath: string): Promise<{ imageUrl: string }> {
  const filePath = (localPath || '').trim()
  if (!filePath) {
    throw new Error('图片路径为空')
  }

  const token = getAccessToken()
  const response = await new Promise<any>((resolve, reject) => {
    Taro.uploadFile({
      url: `${API_BASE_URL}/api/upload-analyze-image-file`,
      filePath,
      name: 'file',
      header: withNgrokBypassHeaders({
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }),
      success: resolve,
      fail: reject,
    })
  })

  const parsedData = parseUploadAnalyzeResponseData(response?.data)
  const payload = unwrapUploadAnalyzePayload(parsedData)
  if (response?.statusCode !== 200) {
    throwHttpErrorWithStatus(
      Number(response?.statusCode || 0),
      parsedData,
      formatUploadAnalyzeHttpError(Number(response?.statusCode || 0), parsedData),
      response?.header as Record<string, any> | undefined
    )
  }

  const imageUrl = String(payload?.imageUrl || payload?.image_url || payload?.url || '').trim()
  if (!imageUrl) {
    throw new Error('上传图片失败：服务端未返回图片地址')
  }
  return { imageUrl }
}

/**
 * 食物分析前上传图片到 Supabase，返回公网 URL。
 * 已登录时附带 Bearer，与异步分析任务一致；未登录的页面（如仅调试用）仍可上传。
 */
export async function uploadAnalyzeImage(base64Image: string): Promise<{ imageUrl: string }> {
  const token = getAccessToken()
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/upload-analyze-image`,
    method: 'POST',
    header: withNgrokBypassHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    data: { base64Image },
    timeout: 60000,
  })
  if (response.statusCode !== 200) {
    throwHttpErrorWithStatus(
      response.statusCode,
      response.data,
      formatUploadAnalyzeHttpError(response.statusCode, response.data),
      response.header as Record<string, any> | undefined
    )
  }
  return unwrapResponse<{ imageUrl: string }>(response)
}

export async function analyzeFoodImage(
  request: AnalyzeRequest
): Promise<AnalyzeResponse> {
  if (!request.base64Image && !request.image_url) {
    throw new Error('请提供 base64Image 或 image_url')
  }
  try {
    const timezoneOffsetMinutes = Number.isFinite(request.timezone_offset_minutes)
      ? request.timezone_offset_minutes
      : new Date().getTimezoneOffset()
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/analyze`,
      method: 'POST',
      header: withNgrokBypassHeaders({
        'Content-Type': 'application/json'
      }),
      data: {
        ...(request.base64Image != null && { base64Image: request.base64Image }),
        ...(request.image_url != null && request.image_url !== '' && { image_url: request.image_url }),
        ...(request.image_urls != null && { image_urls: request.image_urls }),
        additionalContext: request.additionalContext || '',
        ...(request.modelName != null && request.modelName !== '' && { modelName: request.modelName }),
        ...(request.user_goal != null && { user_goal: request.user_goal }),
        ...(request.remaining_calories != null && { remaining_calories: request.remaining_calories }),
        ...(request.meal_type != null && { meal_type: request.meal_type }),
        timezone_offset_minutes: timezoneOffsetMinutes
      },
      timeout: 60000 // 60秒超时
    })

    if (response.statusCode !== 200) {
      throwHttpErrorWithStatus(
        response.statusCode,
        response.data,
        '分析失败，请重试',
        response.header as Record<string, any> | undefined
      )
    }

    return unwrapResponse<AnalyzeResponse>(response)
  } catch (error: any) {
    console.error('API调用失败:', error)
    throw new Error(error.message || '连接服务器失败，请检查网络')
  }
}

/**
 * 双模型对比分析：同时调用千问和 Gemini 模型，返回两个结果供对比
 * @param request 分析请求参数
 * @returns Promise<CompareAnalyzeResponse> 包含两个模型的分析结果
 */
export async function analyzeFoodImageCompare(
  request: AnalyzeRequest
): Promise<CompareAnalyzeResponse> {
  if (!request.base64Image && !request.image_url) {
    throw new Error('请提供 base64Image 或 image_url')
  }
  try {
    const timezoneOffsetMinutes = Number.isFinite(request.timezone_offset_minutes)
      ? request.timezone_offset_minutes
      : new Date().getTimezoneOffset()
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/analyze-compare`,
      method: 'POST',
      header: withNgrokBypassHeaders({
        'Content-Type': 'application/json'
      }),
      data: {
        ...(request.base64Image != null && { base64Image: request.base64Image }),
        ...(request.image_url != null && request.image_url !== '' && { image_url: request.image_url }),
        ...(request.image_urls != null && { image_urls: request.image_urls }),
        additionalContext: request.additionalContext || '',
        ...(request.modelName != null && request.modelName !== '' && { modelName: request.modelName }),
        ...(request.user_goal != null && { user_goal: request.user_goal }),
        ...(request.diet_goal != null && { diet_goal: request.diet_goal }),
        ...(request.activity_timing != null && { activity_timing: request.activity_timing }),
        ...(request.remaining_calories != null && { remaining_calories: request.remaining_calories }),
        ...(request.meal_type != null && { meal_type: request.meal_type }),
        timezone_offset_minutes: timezoneOffsetMinutes
      },
      timeout: 120000 // 120秒超时（双模型调用需要更长时间）
    })

    if (response.statusCode !== 200) {
      throwHttpErrorWithStatus(
        response.statusCode,
        response.data,
        '对比分析失败，请重试',
        response.header as Record<string, any> | undefined
      )
    }

    return unwrapResponse<CompareAnalyzeResponse>(response)
  } catch (error: any) {
    console.error('双模型对比分析失败:', error)
    throw new Error(error.message || '连接服务器失败，请检查网络')
  }
}

/** 文字分析请求参数 */
export interface AnalyzeTextParams {
  text: string
  user_goal?: 'muscle_gain' | 'fat_loss' | 'maintain'
  context_state?: string
  diet_goal?: 'fat_loss' | 'muscle_gain' | 'maintain' | 'none'
  activity_timing?: 'post_workout' | 'daily' | 'before_sleep' | 'none'
  remaining_calories?: number
  suggest_ratio_enabled?: boolean
  analysis_engine?: AnalysisEngine
}

/**
 * 根据文字描述分析食物营养成分（与图片分析返回结构一致）
 * @param params 文本内容及可选的 user_goal、diet_goal、activity_timing、remaining_calories
 * @returns Promise<AnalyzeResponse>
 */
export async function analyzeFoodText(params: AnalyzeTextParams | string): Promise<AnalyzeResponse> {
  const payload = typeof params === 'string' ? { text: params.trim() } : {
    text: params.text.trim(),
    ...(params.user_goal != null && { user_goal: params.user_goal }),
    ...(params.diet_goal != null && { diet_goal: params.diet_goal }),
    ...(params.activity_timing != null && { activity_timing: params.activity_timing }),
    ...(params.remaining_calories != null && { remaining_calories: params.remaining_calories }),
    ...(params.suggest_ratio_enabled != null && { suggest_ratio_enabled: params.suggest_ratio_enabled }),
    ...(params.analysis_engine != null && { analysis_engine: params.analysis_engine })
  }
  try {
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/analyze-text`,
      method: 'POST',
      header: withNgrokBypassHeaders({ 'Content-Type': 'application/json' }),
      data: payload,
      timeout: 60000
    })
    if (response.statusCode !== 200) {
      throwHttpErrorWithStatus(
        response.statusCode,
        response.data,
        '分析失败，请重试',
        response.header as Record<string, any> | undefined
      )
    }
    return unwrapResponse<AnalyzeResponse>(response)
  } catch (error: any) {
    console.error('analyzeFoodText 失败:', error)
    throw new Error(error.message || '连接服务器失败，请检查网络')
  }
}

/**
 * 拍照识别完成后确认记录：选择餐次后保存到服务器
 * @param payload 餐次 + 识别结果与营养汇总
 */
export async function saveFoodRecord(payload: SaveFoodRecordRequest): Promise<{
  id: string
  message: string
  /** 与 source_task_id 对应的记录已存在，未重复写入（好友动态不重复） */
  already_saved?: boolean
}> {
  const res = await authenticatedRequest('/api/food-record/save', {
    method: 'POST',
    data: payload,
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '保存记录失败'
    throw new Error(msg)
  }
  return res.data as {
    id: string
    message: string
    already_saved?: boolean
  }
}

// ---------- 异步分析任务（提交后 Worker 执行，可稍后在识别记录查看） ----------

export interface AnalyzeTaskSubmitParams {
  image_url: string
  image_urls?: string[]
  meal_type?: MealType
  date?: string
  timezone_offset_minutes?: number
  province?: string
  city?: string
  district?: string
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  suggest_ratio_enabled?: boolean
  additionalContext?: string
  modelName?: string
  is_multi_view?: boolean
  execution_mode?: ExecutionMode
  analysis_engine?: AnalysisEngine
  previousResult?: AnalyzeResponse
  correction_source_task_id?: string
  correction_root_task_id?: string
  precision_session_id?: string
  reference_objects?: PrecisionReferenceObjectInput[]
  correctionItems?: Array<{
    name: string
    weight: number
    originalWeight?: number
    calorie?: number
    protein?: number
    carbs?: number
    fat?: number
    waterMl?: number
    nutrients?: Nutrients
    sourceName?: string
    sourceItemId?: number
    nameEdited?: boolean
    weightEdited?: boolean
    nutritionEdited?: boolean
  }>
}

export interface AnalysisTask {
  id: string
  user_id: string
  task_type: string
  image_url?: string | null  // 图片分析时有值，文字分析时为空
  image_paths?: string[] | null // 多图分析时有值
  text_input?: string | null  // 文字分析时有值，图片分析时为空
  status: 'pending' | 'processing' | 'done' | 'failed' | 'violated' | 'timed_out' | 'cancelled'
  payload?: Record<string, unknown>
  result?: any
  error_message?: string
  trace_id?: string | null
  traceId?: string | null
  request_id?: string | null
  requestId?: string | null
  is_violated?: boolean          // AI 审核是否违规
  violation_reason?: string | null // 违规原因
  is_recorded?: boolean          // 是否已保存为饮食记录（后端通过 user_food_records 关联查询）
  record_id?: string              // 已保存时对应的饮食记录 ID，供跳转详情页
  created_at: string
  updated_at: string
}

export interface GooseDuckChickenClassifyResult {
  species: 'goose' | 'duck' | 'chicken' | 'unknown'
  label: string
  confidence: number
  reason: string
  evidence?: string[]
}

export async function classifyGooseDuckChicken(body: {
  image_url: string
  additional_context?: string
}): Promise<GooseDuckChickenClassifyResult> {
  const res = await authenticatedRequest('/api/analyze/goose-duck-chicken', {
    method: 'POST',
    data: body,
    timeout: 125000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '鹅鸭鸡识别失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<GooseDuckChickenClassifyResult>(res)
}

export interface AnalyzeTaskStatusCount {
  recognizing: number
  waiting_record: number
  recorded: number
  has_unseen_waiting_record: boolean
}

export async function getAnalyzeTaskStatusCount(): Promise<AnalyzeTaskStatusCount> {
  const res = await authenticatedRequest('/api/analyze/tasks/status-count', { method: 'GET' })
  if (res.statusCode !== 200) {
    throw new Error((res.data as any)?.detail || '获取任务状态数量失败')
  }
  return res.data as AnalyzeTaskStatusCount
}

/** 标记用户已查看识别记录列表 */
export async function markAnalyzeHistorySeen(): Promise<{ success: boolean }> {
  const res = await authenticatedRequest('/api/user/last-seen-analyze-history', { method: 'POST' })
  if (res.statusCode !== 200) {
    throw new Error((res.data as any)?.detail || '标记查看状态失败')
  }
  return res.data as { success: boolean }
}

/** 提交食物分析任务，立即返回 task_id */
export async function submitAnalyzeTask(body: AnalyzeTaskSubmitParams): Promise<{ task_id: string; message: string }> {
  const payload = await enrichAnalyzePayloadWithGeoContext(body)
  const res = await authenticatedRequest('/api/analyze/submit', {
    method: 'POST',
    data: payload,
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '提交任务失败')
  }
  const data = normalizeTaroResponseJson(res.data)
  const taskId = String(data?.task_id ?? data?.taskId ?? '').trim()
  const message = String(data?.message ?? '任务已提交')
  if (!taskId) {
    console.error('[submitAnalyzeTask] 响应缺少 task_id', res.data)
    throw new Error('服务器未返回任务编号，请稍后重试')
  }
  return { task_id: taskId, message }
}

/** 批量图片分析提交参数 */
export interface AnalyzeBatchSubmitParams {
  image_urls: string[]
  meal_type?: MealType
  timezone_offset_minutes?: number
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  suggest_ratio_enabled?: boolean
  additionalContext?: string
  modelName?: string
  execution_mode?: ExecutionMode
  reference_objects?: PrecisionReferenceObjectInput[]
}

/** 批量图片分析响应 */
export interface AnalyzeBatchResponse {
  task_id: string
  image_count: number
  result: AnalyzeResponse
}

/** 批量分析多张食物图片（每张单独识别，结果累加） */
export async function submitAnalyzeBatch(body: AnalyzeBatchSubmitParams): Promise<AnalyzeBatchResponse> {
  const payload: AnalyzeBatchSubmitParams = {
    ...body,
    timezone_offset_minutes: Number.isFinite(body.timezone_offset_minutes)
      ? body.timezone_offset_minutes
      : new Date().getTimezoneOffset()
  }
  const res = await authenticatedRequest('/api/analyze/batch', {
    method: 'POST',
    data: payload,
    timeout: 120000 // 批量分析可能耗时较长，120 秒超时
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '批量分析失败')
  }
  const data = normalizeTaroResponseJson(res.data)
  if (!data?.task_id) {
    console.error('[submitAnalyzeBatch] 响应缺少 task_id', res.data)
    throw new Error('服务器未返回任务编号，请稍后重试')
  }
  return {
    task_id: String(data.task_id).trim(),
    image_count: Number(data.image_count) || 0,
    result: data.result as AnalyzeResponse,
  }
}

/** 文字分析提交参数 */
export interface AnalyzeTextTaskSubmitParams {
  text: string
  meal_type?: MealType
  date?: string
  timezone_offset_minutes?: number
  province?: string
  city?: string
  district?: string
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  suggest_ratio_enabled?: boolean
  additionalContext?: string
  execution_mode?: ExecutionMode
  analysis_engine?: AnalysisEngine
  previousResult?: AnalyzeResponse
  correction_source_task_id?: string
  correction_root_task_id?: string
  precision_session_id?: string
  reference_objects?: PrecisionReferenceObjectInput[]
  correctionItems?: Array<{
    name: string
    weight: number
    originalWeight?: number
    calorie?: number
    protein?: number
    carbs?: number
    fat?: number
    waterMl?: number
    nutrients?: Nutrients
    sourceName?: string
    sourceItemId?: number
    nameEdited?: boolean
    weightEdited?: boolean
    nutritionEdited?: boolean
  }>
}

/** 提交文字分析任务（异步） */
export async function submitTextAnalyzeTask(body: AnalyzeTextTaskSubmitParams): Promise<{ task_id: string; message: string }> {
  const payload = await enrichAnalyzePayloadWithGeoContext(body)
  const res = await authenticatedRequest('/api/analyze-text/submit', {
    method: 'POST',
    data: payload,
    timeout: 30000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '提交任务失败')
  }
  const parsed = normalizeTaroResponseJson(res.data)
  if (!parsed?.task_id && !parsed?.taskId) {
    console.error('[submitTextAnalyzeTask] 响应缺少 task_id', res.data)
    throw new Error('服务器未返回任务编号，请稍后重试')
  }
  return {
    task_id: String(parsed.task_id ?? parsed.taskId ?? '').trim(),
    message: String(parsed.message ?? '任务已提交')
  }
}

export interface ContinuePrecisionSessionParams {
  source_type: PrecisionSourceType
  image_url?: string
  image_urls?: string[]
  text?: string
  date?: string
  additionalContext?: string
  meal_type?: MealType
  timezone_offset_minutes?: number
  province?: string
  city?: string
  district?: string
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  suggest_ratio_enabled?: boolean
  is_multi_view?: boolean
  reference_objects?: PrecisionReferenceObjectInput[]
}

export async function continuePrecisionSession(
  sessionId: string,
  body: ContinuePrecisionSessionParams,
): Promise<{ task_id: string; message: string }> {
  const payload = await enrichAnalyzePayloadWithGeoContext(body)
  const res = await authenticatedRequest(`/api/precision-sessions/${sessionId}/continue`, {
    method: 'POST',
    data: payload,
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '继续试验模式失败')
  }
  const data = normalizeTaroResponseJson(res.data)
  const taskId = String(data?.task_id ?? data?.taskId ?? '').trim()
  const message = String(data?.message ?? '任务已提交')
  if (!taskId) {
    console.error('[continuePrecisionSession] 响应缺少 task_id', res.data)
    throw new Error('服务器未返回任务编号，请稍后重试')
  }
  return { task_id: taskId, message }
}

/** 查询单条分析任务 */
export async function getAnalyzeTask(taskId: string): Promise<AnalysisTask> {
  const res = await authenticatedRequest(`/api/analyze/tasks/${taskId}`, { method: 'GET', timeout: 10000 })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取任务失败'
    throw new Error(msg)
  }
  const task = res.data as AnalysisTask
  const responseTraceId = extractTraceIdFromHeaders(res.header as Record<string, any> | undefined)
  const responseRequestId = extractRequestIdFromHeaders(res.header as Record<string, any> | undefined)
  if (responseTraceId && !task.trace_id && !task.traceId) task.trace_id = responseTraceId
  if (responseRequestId && !task.request_id && !task.requestId) task.request_id = responseRequestId
  return task
}

/** 查询当前用户的分析任务列表 */
export async function listAnalyzeTasks(params?: { task_type?: string; status?: string; search?: string; limit?: number }): Promise<{ tasks: AnalysisTask[] }> {
  const q = new URLSearchParams()
  if (params?.task_type) q.set('task_type', params.task_type)
  if (params?.status) q.set('status', params.status)
  if (params?.search?.trim()) q.set('search', params.search.trim())
  if (params?.limit != null && Number.isFinite(params.limit)) q.set('limit', String(Math.min(200, Math.max(1, Math.floor(params.limit)))))
  const url = `/api/analyze/tasks${q.toString() ? '?' + q.toString() : ''}`
  const res = await authenticatedRequest(url, { method: 'GET', timeout: 20000 })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取任务列表失败'
    throw new Error(msg)
  }
  return res.data as { tasks: AnalysisTask[] }
}

/**
 * 更新分析任务结果（修正食物名称等）
 * PATCH /api/analyze/tasks/{task_id}/result
 */
export async function updateAnalysisTaskResult(taskId: string, result: AnalyzeResponse | ModelAnalyzeResult): Promise<{ message: string; task: AnalysisTask }> {
  // 注意：后端接收的 result 是 AnalyzeResponse 结构（description, insight, items 等）
  // 或者 ModelAnalyzeResult 结构（items, description, insight...）
  // 这里直接传整个对象即可，后端会覆盖 result 字段
  const res = await authenticatedRequest(`/api/analyze/tasks/${taskId}/result`, {
    method: 'PATCH',
    data: { result }
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '更新分析结果失败'
    throw new Error(msg)
  }
  return res.data as { message: string; task: AnalysisTask }
}

export type AnalysisFeedbackType =
  | 'weight_mismatch'
  | 'nutrition_mismatch'
  | 'suspect_distrust'
  | 'record_corrected'
  | 'correction'
  | 'failed'
  | 'retry'
  | 'manual_entry'

export type AnalysisResolutionState = 'user_corrected' | 'still_distrust'

export interface AnalysisFeedbackRequest {
  feedback_type: AnalysisFeedbackType
  resolution_state?: AnalysisResolutionState
  source_task_id?: string
  source_record_id?: string
  before_result?: Record<string, unknown>
  after_result?: Record<string, unknown>
  user_correction_items?: Record<string, unknown>[]
  payload_snapshot?: Record<string, unknown>
  model_name?: string
  analysis_engine?: string
}

/**
 * 控制是否真正向后端发送 analysis_feedback_samples 埋点请求。
 * 临时关闭开关：设为 false 即可禁用所有 feedback 网络请求，便于线上排障或灰度。
 */
export const ANALYSIS_FEEDBACK_SUBMISSION_ENABLED = false

/**
 * 提交分析反馈样本（前端埋点统一入口）
 * POST /api/analyze/feedback
 */
export async function submitAnalysisFeedback(data: AnalysisFeedbackRequest): Promise<{ message: string }> {
  if (!ANALYSIS_FEEDBACK_SUBMISSION_ENABLED) {
    console.log('[Feedback] submission disabled', data)
    return { message: 'feedback submission disabled' }
  }
  const res = await authenticatedRequest('/api/analyze/feedback', {
    method: 'POST',
    data,
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '提交反馈失败'
    throw new Error(msg)
  }
  return res.data as { message: string }
}

/** 使用原任务已上传的图片或文字重新提交识别任务 */
export async function retryAnalyzeTask(taskId: string): Promise<{ task_id: string; message: string; source_task_id: string }> {
  const res = await authenticatedRequest('/api/analyze/tasks/retry', {
    method: 'POST',
    data: { task_id: taskId },
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '重新识别失败')
  }
  const data = normalizeTaroResponseJson(res.data)
  const retryTaskId = String(data?.task_id ?? data?.taskId ?? '').trim()
  if (!retryTaskId) {
    console.error('[retryAnalyzeTask] 响应缺少 task_id', res.data)
    throw new Error('服务器未返回任务编号，请稍后重试')
  }
  return {
    task_id: retryTaskId,
    message: String(data?.message ?? '已重新提交识别任务'),
    source_task_id: String(data?.source_task_id ?? data?.sourceTaskId ?? taskId)
  }
}

/**
 * 删除分析任务
 * DELETE /api/analyze/tasks/{task_id}
 * 支持删除进行中的任务，会自动取消并清理关联资源
 */
export interface DeleteTaskResult {
  message: string
  deleted: boolean
  cancelled?: boolean
  images_deleted?: number
}

export async function deleteAnalysisTask(taskId: string): Promise<DeleteTaskResult> {
  const res = await authenticatedRequest(`/api/analyze/tasks/${taskId}`, {
    method: 'DELETE',
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '删除任务失败'
    throw new Error(msg)
  }
  return res.data as DeleteTaskResult
}

/**
 * 提交偏差样本（用户点击「认为 AI 估算偏差大，点击标记样本」）
 * 需登录。items 中每条为：食物名、AI 重量、用户修正重量、偏差百分比。
 */
export async function saveCriticalSamples(items: CriticalSamplePayload[]): Promise<{ message: string; count: number }> {
  const res = await authenticatedRequest('/api/critical-samples', {
    method: 'POST',
    data: { items },
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '保存偏差样本失败'
    throw new Error(msg)
  }
  return res.data as { message: string; count: number }
}

/**
 * 获取饮食记录列表，可选按日期筛选（YYYY-MM-DD）
 */
export async function getFoodRecordList(date?: string): Promise<{ records: FoodRecord[] }> {
  const url = date ? `/api/food-record/list?date=${encodeURIComponent(date)}` : '/api/food-record/list'
  const res = await authenticatedRequest(url, { method: 'GET', timeout: 10000 })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取记录失败'
    throw new Error(msg)
  }
  const data = res.data as { records?: FoodRecord[] }
  const records = Array.isArray(data.records) ? data.records.map(normalizeFoodRecord) : []
  return { records }
}

/** 分享海报「较昨同餐」对比（服务端按中国自然日计算；仅本人；403 不触发重登） */
export interface PosterCalorieCompareResponse {
  has_baseline: boolean
  baseline_kcal: number
  delta_kcal: number
  current_kcal: number
  /** 当前餐次在仪表盘目标下的计划热量（与首页三餐分配/加餐参考一致） */
  meal_plan_kcal: number
}

export async function getPosterCalorieCompare(recordId: string): Promise<PosterCalorieCompareResponse | null> {
  const token = getAccessToken()
  if (!token) return null
  const res = await Taro.request({
    url: `${API_BASE_URL}/api/food-record/${encodeURIComponent(recordId)}/poster-calorie-compare`,
    method: 'GET',
    header: withNgrokBypassHeaders({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    timeout: 10000,
  })
  if (res.statusCode === 200) return unwrapResponse<PosterCalorieCompareResponse>(res)
  return null
}

/** 餐次记录完整数据缓存（由 getHomeDashboard 填充，供首页直接编辑使用） */
const mealFullRecordCache: Record<string, FoodRecord> = {}

export function getCachedMealFullRecord(recordId: string): FoodRecord | undefined {
  return mealFullRecordCache[recordId]
}

function stripMealFullRecordsFromDashboard(data: HomeDashboard): HomeDashboard {
  const meals = (data.meals || []).map((meal) => {
    const entries = (meal.meal_record_entries || []).map((entry) => {
      if ((entry as any).full_record) {
        mealFullRecordCache[entry.id] = normalizeFoodRecord((entry as any).full_record as FoodRecord)
      }
      const { full_record, ...rest } = entry as any
      return rest
    })
    return {
      ...meal,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      meal_record_entries: entries.length > 0 ? entries : meal.meal_record_entries,
    }
  })
  return { ...data, meals }
}

/**
 * 获取单条饮食记录详情（通过 ID，从数据库获取最新数据）
 */
export async function getFoodRecordById(recordId: string): Promise<{ record: FoodRecord }> {
  const res = await authenticatedRequest(`/api/food-record/${encodeURIComponent(recordId)}`, {
    method: 'GET',
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取记录详情失败'
    throw new Error(msg)
  }
  const data = res.data as { record: FoodRecord }
  return { record: normalizeFoodRecord(data.record) }
}

/** 更新饮食记录请求 */
export interface UpdateFoodRecordRequest {
  meal_type?: string
  items?: FoodRecordItemPayload[]
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  total_weight_grams?: number
  description?: string
  image_path?: string
  image_paths?: string[]
  diet_goal?: DietGoal
  activity_timing?: ActivityTiming
}

/**
 * 更新当前用户的饮食记录（修改食物参数等）
 */
export async function updateFoodRecord(recordId: string, data: UpdateFoodRecordRequest): Promise<{ message: string; record: FoodRecord }> {
  const res = await authenticatedRequest(`/api/food-record/${encodeURIComponent(recordId)}`, {
    method: 'PUT',
    data,
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '更新记录失败'
    throw new Error(msg)
  }
  return res.data as { message: string; record: FoodRecord }
}

/**
 * 删除当前用户的饮食记录
 */
export async function deleteFoodRecord(recordId: string): Promise<void> {
  const res = await authenticatedRequest(`/api/food-record/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '删除失败'
    throw new Error(msg)
  }
}

/**
 * 获取分享的饮食记录详情（无需登录，供别人通过分享链接查看）
 * 若记录所有者设置了「不公开饮食记录」则后端会返回 403。
 */
export async function getSharedFoodRecord(recordId: string): Promise<{ record: FoodRecord }> {
  const res = await Taro.request({
    url: `${API_BASE_URL}/api/food-record/share/${encodeURIComponent(recordId)}`,
    method: 'GET',
    header: withNgrokBypassHeaders(),
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取记录详情失败'
    throw new Error(msg)
  }
  return unwrapResponse<{ record: FoodRecord }>(res)
}

/**
 * 获取当前小程序运行环境版本（develop / trial / release）
 */
export function getWeappEnvVersion(): 'release' | 'trial' | 'develop' {
  try {
    const info = Taro.getAccountInfoSync()
    const env = info?.miniProgram?.envVersion
    if (env === 'develop' || env === 'trial' || env === 'release') {
      return env
    }
  } catch {
    // ignore
  }
  // 某些模拟器/低版本基础库可能 Taro 封装取不到，直接调原生 wx 兜底
  try {
    const globalWx = (globalThis as any).wx
    const wxInfo = globalWx?.getAccountInfoSync?.()
    const env = wxInfo?.miniProgram?.envVersion
    if (env === 'develop' || env === 'trial' || env === 'release') {
      return env
    }
  } catch {
    // ignore
  }
  return 'release'
}

/**
 * 分享卡片/海报二维码始终跳正式版小程序。
 * 当前小程序自身仍按真实 envVersion 选择 API；这里只影响微信码扫码后的目标版本。
 */
export function getShareQrEnvVersion(): 'release' {
  return 'release'
}

/**
 * 获取小程序无限拉新二维码（Base64）
 */
export async function getUnlimitedQRCode(
  scene: string,
  page?: string,
  envVersion?: 'release' | 'trial' | 'develop'
): Promise<{ base64: string }> {
  const payload: any = { scene }
  if (page) payload.page = page
  if (envVersion) payload.env_version = envVersion

  const res = await authenticatedRequest('/api/qrcode', {
    method: 'POST',
    data: payload,
    timeout: 15000
  })

  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取分享二维码失败'
    throw new Error(msg)
  }
  return res.data as { base64: string }
}

/**
 * 与首页 dashboard 一致：日期条曾用 2025 显示年时，后端需使用真实数据年（如 2026）。
 * 身体指标写入接口也经此映射，避免与统计周范围错年。
 */
export function mapCalendarDateToApi(date?: string): string | undefined {
  if (!date) return undefined
  return date.replace(/^2025-/, '2026-')
}

/**
 * 获取首页仪表盘数据（今日摄入 + 今日餐食，不含运动）
 */
export async function getHomeDashboard(date?: string): Promise<HomeDashboard> {
  // 添加时间戳禁用缓存
  const timestamp = Date.now()
  const apiDate = mapCalendarDateToApi(date)
  const url = apiDate 
    ? `/api/home/dashboard?date=${encodeURIComponent(apiDate)}&_t=${timestamp}`
    : `/api/home/dashboard?_t=${timestamp}`
  console.log('[DEBUG API] ====== 请求开始 ======')
  console.log('[DEBUG API] 原始日期参数:', date)
  console.log('[DEBUG API] 转换后日期:', apiDate)
  console.log('[DEBUG API] 请求 URL:', url)
  
  let res
  try {
    res = await authenticatedRequest(url, { 
      method: 'GET', 
      timeout: 30000,
      header: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    })
  } catch (err) {
    console.error('[DEBUG API] authenticatedRequest 抛出异常:', err)
    throw err
  }
  console.log('[DEBUG API] 响应状态:', res.statusCode)
  console.log('[DEBUG API] 响应数据类型:', typeof res.data)
  console.log('[DEBUG API] 响应数据 intakeData:', res.data?.intakeData)
  console.log('[DEBUG API] ====== 请求结束 ======')
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取首页数据失败'
    throw new Error(msg)
  }
  let data: HomeDashboard
  try {
    data = res.data as HomeDashboard
    const meals = Array.isArray(data.meals) ? data.meals.map(normalizeHomeMealItem) : []
    return stripMealFullRecordsFromDashboard({ ...data, meals })
  } catch (parseErr) {
    console.error('[DEBUG API] 解析响应数据失败:', parseErr)
    console.error('[DEBUG API] 原始数据:', JSON.stringify(res.data).slice(0, 500))
    throw parseErr
  }
}

export async function getPetSummary(date?: string): Promise<PetSummary> {
  const apiDate = mapCalendarDateToApi(date)
  const query = apiDate ? `?date=${encodeURIComponent(apiDate)}` : ''
  const res = await authenticatedRequest(`/api/pet/summary${query}`, { method: 'GET', timeout: 10000 })
  if (res.statusCode !== 200) {
    throw new Error('获取宠物状态失败')
  }
  return res.data as PetSummary
}

export async function claimPetEvent(eventId: string): Promise<PetClaimResult> {
  const res = await authenticatedRequest(`/api/pet/events/${encodeURIComponent(eventId)}/claim`, {
    method: 'POST',
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throw new Error('领取宠物奖励失败')
  }
  return res.data as PetClaimResult
}

export async function rerollPetAppearance(): Promise<PetAppearanceRerollResult> {
  const res = await authenticatedRequest('/api/pet/reroll-appearance', {
    method: 'POST',
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.message || '更换宠物外观失败'
    throw new Error(msg)
  }
  return res.data as PetAppearanceRerollResult
}

export async function selectPetAppearance(candidateId: string): Promise<PetAppearanceSelectResult> {
  const res = await authenticatedRequest('/api/pet/select-appearance', {
    method: 'POST',
    data: { candidate_id: candidateId },
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.message || '选择宠物外观失败'
    throw new Error(msg)
  }
  return res.data as PetAppearanceSelectResult
}

/**
 * 获取首页可编辑目标值
 */
export async function getDashboardTargets(): Promise<DashboardTargets> {
  const res = await authenticatedRequest('/api/user/dashboard-targets', { method: 'GET', timeout: 10000 })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取首页目标失败'
    throw new Error(msg)
  }
  return res.data as DashboardTargets
}

/**
 * 更新首页可编辑目标值。
 * - 优先 PUT /api/user/dashboard-targets
 * - 若线上返回 404（旧后端），则回退为 PUT /api/user/health-profile 并携带 dashboard_targets
 * - 若服务端仍未持久化（极旧版本），则写入本机 storage 并返回 saveScope: 'local'
 */
export async function updateDashboardTargets(data: DashboardTargetsUpdateInput): Promise<DashboardTargetsUpdateResult> {
  const res = await authenticatedRequest('/api/user/dashboard-targets', {
    method: 'PUT',
    data,
    timeout: 10000
  })
  if (res.statusCode === 200) {
    clearStoredDashboardTargets()
    return { targets: res.data as DashboardTargets, saveScope: 'server' }
  }

  if (res.statusCode === 404) {
    try {
      const profile = await getHealthProfile()
      const hc = profile.health_condition || {}
      const payload: HealthProfileUpdateRequest = {
        gender: profile.gender ?? undefined,
        birthday: profile.birthday ?? undefined,
        height: profile.height ?? undefined,
        weight: profile.weight ?? undefined,
        activity_level: profile.activity_level ?? undefined,
        daily_life_activity_level: typeof hc.daily_life_activity_level === 'string'
          ? hc.daily_life_activity_level
          : profile.activity_level ?? undefined,
        diet_goal: profile.diet_goal ?? undefined,
        medical_history: Array.isArray(hc.medical_history) ? (hc.medical_history as string[]) : [],
        diet_preference: Array.isArray(hc.diet_preference) ? (hc.diet_preference as string[]) : [],
        allergies: Array.isArray(hc.allergies) ? (hc.allergies as string[]) : [],
        health_notes: typeof hc.health_notes === 'string' ? hc.health_notes : undefined,
        dashboard_targets: data,
      }
      if (hc.report_extract != null) {
        payload.report_extract = hc.report_extract as ReportExtract
      }
      const res2 = await authenticatedRequest('/api/user/health-profile', {
        method: 'PUT',
        data: payload,
        timeout: 15000,
      })
      if (res2.statusCode === 200) {
        const updated = res2.data as HealthProfile
        const saved = parseDashboardTargetsFromUnknown(updated.health_condition?.dashboard_targets)
        if (saved) {
          clearStoredDashboardTargets()
          return { targets: saved, saveScope: 'server' }
        }
      }
    } catch (e) {
      console.error('回退保存摄入目标失败:', e)
    }
    persistDashboardTargetsLocal(data)
    return { targets: data, saveScope: 'local' }
  }

  const msg = (res.data as any)?.detail || '更新首页目标失败'
  throw new Error(msg)
}

/**
 * 获取数据统计（周/月摄入、日常消耗估算、连续天数、饮食结构及简单分析）
 * @param range 'week' | 'month'
 */
export async function getStatsSummary(range: 'week' | 'month'): Promise<StatsSummary> {
  const res = await authenticatedRequest(
    `/api/stats/summary?range=${encodeURIComponent(range)}`,
    { method: 'GET', timeout: 30000 }
  )
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取统计失败'
    throw new Error(msg)
  }
  return res.data as StatsSummary
}

export async function generateDietRecommendation(
  payload: DietRecommendationRequest
): Promise<DietRecommendationResult> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await authenticatedRequest('/api/diet/recommendations', {
        method: 'POST',
        data: payload,
        timeout: 18000
      })
      return res.data as DietRecommendationResult
    } catch (error) {
      lastError = error
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0)
      const message = String((error as { errMsg?: string; message?: string })?.errMsg || (error as Error)?.message || '').toLowerCase()
      const retryableNetworkError =
        message.includes('request:fail') &&
        (message.includes('timeout') || message.includes('network') || message.includes('connection'))
      const retryableServerError = statusCode >= 500
      if (attempt === 0 && (retryableNetworkError || retryableServerError)) {
        await new Promise((resolve) => setTimeout(resolve, 260))
        continue
      }
      throw error
    }
  }
  throw lastError
}

export async function getBodyMetricsSummary(range: 'week' | 'month' = 'month'): Promise<BodyMetricsSummary> {
  const res = await authenticatedRequest(
    `/api/body-metrics/summary?range=${encodeURIComponent(range)}`,
    { method: 'GET', timeout: 30000 }
  )
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取身体指标失败'
    throw new Error(msg)
  }
  return res.data as BodyMetricsSummary
}

export async function saveBodyWeightRecord(value: number, date?: string, clientId?: string): Promise<{ message: string; item: BodyMetricWeightEntry }> {
  const res = await authenticatedRequest('/api/body-metrics/weight', {
    method: 'POST',
    data: { value, date: mapCalendarDateToApi(date), client_id: clientId },
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '保存体重失败'
    throw new Error(msg)
  }
  return res.data as { message: string; item: BodyMetricWeightEntry }
}

export async function deleteBodyWeightRecord(recordId: string): Promise<{ message: string; deleted_count: number; id: string }> {
  const res = await authenticatedRequest(`/api/body-metrics/weight/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '删除体重记录失败'
    throw new Error(msg)
  }
  return res.data as { message: string; deleted_count: number; id: string }
}

export async function addBodyWaterLog(amountMl: number, date?: string): Promise<{ message: string; item: BodyMetricWaterLogItem }> {
  const apiDate = mapCalendarDateToApi(date)
  const res = await authenticatedRequest('/api/body-metrics/water', {
    method: 'POST',
    data: { amount_ml: amountMl, date: apiDate, recorded_on: apiDate },
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '保存喝水记录失败'
    throw new Error(msg)
  }
  return res.data as { message: string; item: BodyMetricWaterLogItem }
}

export async function resetBodyWaterLogs(date?: string): Promise<{ message: string; deleted_count: number; date: string }> {
  const apiDate = mapCalendarDateToApi(date)
  const res = await authenticatedRequest('/api/body-metrics/water/reset', {
    method: 'POST',
    data: { date: apiDate, recorded_on: apiDate },
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '清空喝水记录失败'
    throw new Error(msg)
  }
  return res.data as { message: string; deleted_count: number; date: string }
}

export async function deleteBodyWaterLog(logId: string): Promise<{ message: string; deleted_count: number; id: string }> {
  const res = await authenticatedRequest(`/api/body-metrics/water/${encodeURIComponent(logId)}`, {
    method: 'DELETE',
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '删除喝水记录失败'
    throw new Error(msg)
  }
  return res.data as { message: string; deleted_count: number; id: string }
}

export async function syncLocalBodyMetrics(snapshot: BodyMetricsLocalSnapshot): Promise<{ message: string; imported_weight_count: number; imported_water_count: number }> {
  const res = await authenticatedRequest('/api/body-metrics/sync-local', {
    method: 'POST',
    data: snapshot,
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '同步身体指标失败'
    throw new Error(msg)
  }
  return res.data as { message: string; imported_weight_count: number; imported_water_count: number }
}

/**
 * 请求大模型生成当前统计周期的 AI 营养洞察（不落库）
 */
export async function generateStatsInsight(range: 'week' | 'month'): Promise<{
  analysis_summary: string
  analysis_summary_generated_date?: string
  analysis_summary_needs_refresh?: boolean
  analysis_summary_daily_limit?: number
  analysis_summary_used_today?: number
  ai_usage_pricing?: AIUsagePricingResult
}> {
  const res = await authenticatedRequest(
    '/api/stats/insight/generate',
    {
      method: 'POST',
      data: { range },
      timeout: 90000
    }
  )
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, 'AI 洞察生成失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<{
    analysis_summary: string
    analysis_summary_generated_date?: string
    analysis_summary_needs_refresh?: boolean
    analysis_summary_daily_limit?: number
    analysis_summary_used_today?: number
    ai_usage_pricing?: AIUsagePricingResult
  }>(res)
}

export async function estimatePetChat(question: string, range: 'week' | 'month'): Promise<PetChatEstimateResponse> {
  const res = await authenticatedRequest('/api/pet/chat/estimate', {
    method: 'POST',
    data: { question, range },
    timeout: 30000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '小食探估价失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<PetChatEstimateResponse>(res)
}

export async function generatePetChat(question: string, range: 'week' | 'month', sessionId = '', newSession = false): Promise<PetChatResponse> {
  const res = await authenticatedRequest('/api/pet/chat', {
    method: 'POST',
    data: { question, range, session_id: sessionId, new_session: newSession },
    timeout: 90000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '小食探分析失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<PetChatResponse>(res)
}

export interface StreamGeneratePetChatCallbacks {
  onStart?: () => void
  onChunk: (text: string) => void
  onDone: (meta: PetChatStreamMeta) => void
  onError: (error: Error) => void
}

export function streamGeneratePetChat(
  question: string,
  range: 'week' | 'month',
  sessionId = '',
  newSession = false,
  callbacks: StreamGeneratePetChatCallbacks
): () => void {
  const token = getAccessToken()
  if (!token) {
    redirectToLogin('未登录，请先登录')
    callbacks.onError(new Error('未登录，请先登录'))
    return () => {}
  }

  let buffer = ''
  const decoder = new TextDecoder('utf-8')
  let doneReceived = false

  const processSSEText = (text: string) => {
    buffer += text
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''
    for (const event of events) {
      const lines = event.split('\n')
      let dataLine = ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          dataLine = line.slice(6)
        }
      }
      if (!dataLine) continue
      try {
        const parsed = JSON.parse(dataLine) as { type: string; text?: string; error?: string; meta?: PetChatStreamMeta }
        if (parsed.type === 'chunk' && typeof parsed.text === 'string') {
          callbacks.onChunk(parsed.text)
        } else if (parsed.type === 'done' && parsed.meta) {
          doneReceived = true
          callbacks.onDone(parsed.meta)
        } else if (parsed.type === 'error') {
          callbacks.onError(new Error(parsed.error || '小食探分析失败'))
        }
      } catch (_) {
        // ignore malformed sse data
      }
    }
  }

  const requestTask = Taro.request({
    url: `${API_BASE_URL}/api/pet/chat/stream`,
    method: 'POST',
    header: withNgrokBypassHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    }),
    data: { question, range, session_id: sessionId, new_session: newSession },
    enableChunked: true,
    timeout: 180000,
    success: (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        redirectToLogin('登录已失效，请重新登录')
        callbacks.onError(new Error('登录已失效，请重新登录'))
        return
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        callbacks.onError(new Error('小食探分析失败'))
        return
      }
      callbacks.onStart?.()
      // 部分环境 chunk 会聚合在 res.data 中，兜底解析
      if (typeof res.data === 'string') {
        processSSEText(res.data)
      }
    },
    fail: (err) => {
      callbacks.onError(new Error(String(err?.errMsg || err || '请求失败')))
    },
    complete: () => {
      if (!doneReceived && buffer.trim()) {
        processSSEText('\n\n')
      }
    },
  })

  requestTask.onChunkReceived?.((res: any) => {
    const chunk = res.data instanceof ArrayBuffer ? decoder.decode(res.data) : String(res.data || '')
    processSSEText(chunk)
  })

  return () => {
    try {
      requestTask.abort?.()
    } catch (_) {}
  }
}

export async function getLatestPetChatSession(): Promise<PetChatHistoryResponse> {
  const res = await authenticatedRequest('/api/pet/chat/latest', {
    method: 'GET',
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '读取宠物对话失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<PetChatHistoryResponse>(res)
}

export async function listPetChatSessions(): Promise<PetChatSessionsResponse> {
  const res = await authenticatedRequest('/api/pet/chat/sessions', {
    method: 'GET',
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '读取宠物对话列表失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<PetChatSessionsResponse>(res)
}

export async function getPetChatSession(sessionId: string): Promise<PetChatHistoryResponse> {
  const res = await authenticatedRequest(`/api/pet/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '读取宠物对话失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<PetChatHistoryResponse>(res)
}

export async function appendPetChatMessages(sessionId: string, messages: Array<{ role: string; content: string; message_type?: string; meta?: Record<string, any> }>): Promise<PetChatHistoryResponse> {
  const res = await authenticatedRequest('/api/pet/chat/messages', {
    method: 'POST',
    data: { session_id: sessionId, messages },
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '保存宠物对话失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<PetChatHistoryResponse>(res)
}

/**
 * 保存完整的 AI 营养洞察到缓存表
 */
export async function saveStatsInsight(range: 'week' | 'month', analysis_summary: string): Promise<void> {
  const res = await authenticatedRequest(
    '/api/stats/insight/save',
    {
      method: 'POST',
      data: { range, analysis_summary },
      timeout: 10000
    }
  )
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '保存 AI 洞察失败'
    throw new Error(msg)
  }
}

export async function getHealthFocuses(): Promise<{
  focuses: CustomHealthFocus[]
  max_focuses: number
}> {
  const res = await authenticatedRequest('/api/user/health-focuses', { method: 'GET', timeout: 10000 })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '获取自定义关注失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<{ focuses: CustomHealthFocus[]; max_focuses: number }>(res)
}

export async function addHealthFocus(label: string): Promise<{
  focuses: CustomHealthFocus[]
  focus_id: string
  already_exists?: boolean
}> {
  const res = await authenticatedRequest('/api/user/health-focuses', {
    method: 'POST',
    data: { label },
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '添加自定义关注失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<{
    focuses: CustomHealthFocus[]
    focus_id: string
    already_exists?: boolean
  }>(res)
}

export async function removeHealthFocus(focusId: string): Promise<{ focuses: CustomHealthFocus[] }> {
  const res = await authenticatedRequest(`/api/user/health-focuses/${encodeURIComponent(focusId)}`, {
    method: 'DELETE',
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '移除自定义关注失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<{ focuses: CustomHealthFocus[] }>(res)
}

export async function generateCustomFocusCard(
  range: 'week' | 'month',
  focusId: string,
): Promise<{
  card: RiskCard
  custom_focus_daily_limit?: number
  custom_focus_used_today?: number
  custom_focus_remaining_today?: number
}> {
  const res = await authenticatedRequest('/api/stats/custom-focus/generate', {
    method: 'POST',
    data: { range, focus_id: focusId },
    timeout: 90000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '生成 AI 关注卡片失败', res.header as Record<string, any> | undefined)
  }
  return unwrapResponse<{
    card: RiskCard
    custom_focus_daily_limit?: number
    custom_focus_used_today?: number
    custom_focus_remaining_today?: number
  }>(res)
}

/**
 * 获取存储的 access token
 * @returns string | null
 */
export function getAccessToken(): string | null {
  try {
    return Taro.getStorageSync('access_token') || null
  } catch (error) {
    console.error('获取 token 失败:', error)
    return null
  }
}

/**
 * 保存 token 到本地存储
 * @param accessToken access token
 * @param refreshToken refresh token
 * @param user_id 用户 ID
 */
export function saveTokens(accessToken: string, refreshToken: string, user_id: string) {
  try {
    Taro.setStorageSync('access_token', accessToken)
    Taro.setStorageSync('refresh_token', refreshToken)
    Taro.setStorageSync('user_id', user_id)
  } catch (error) {
    console.error('保存 token 失败:', error)
  }
}

/**
 * 清除 token
 */
export function clearTokens() {
  try {
    Taro.removeStorageSync('access_token')
    Taro.removeStorageSync('refresh_token')
    Taro.removeStorageSync('user_id')
  } catch (error) {
    console.error('清除 token 失败:', error)
  }
}

/**
 * 清除所有本地存储数据（退出登录时使用）
 */
export function clearAllStorage() {
  try {
    // 清除 token 相关
    clearTokens()

    // 清除用户信息相关
    Taro.removeStorageSync('isLoggedIn')
    Taro.removeStorageSync('userInfo')
    Taro.removeStorageSync('openid')
    Taro.removeStorageSync('unionid')
    Taro.removeStorageSync('phoneNumber')
    Taro.removeStorageSync('userRegisterTime')
    Taro.removeStorageSync('pending_friend_invite_code')
    Taro.removeStorageSync('dietGoal')
    Taro.removeStorageSync('stats_page_bundle_v1')

    // 清除业务数据（可选，根据需求决定是否清除）
    // Taro.removeStorageSync('analyzeImagePath')
    // Taro.removeStorageSync('analyzeResult')

    // 如果需要清空所有存储，可以使用：
    // Taro.clearStorageSync()

    console.log('已清除所有本地存储数据')
  } catch (error) {
    console.error('清除本地存储失败:', error)
    throw error
  }
}

/** 登录页路径，token 失效时统一跳转 */
const LOGIN_PAGE_URL = extraPkgUrl('/pages/login/index')

export async function deleteAccount(confirmation: string): Promise<{ success: boolean }> {
  const response = await authenticatedRequest('/api/user/account', {
    method: 'DELETE',
    data: { confirmation },
    timeout: 15000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '注销失败')
  }
  return response.data as { success: boolean }
}

/**
 * 清除登录态并跳转登录页（token 失效或未登录时调用）
 * @param message 可选，Toast 提示文案
 */
function redirectToLogin(message: string = '登录已失效，请重新登录') {
  try {
    clearAllStorage()
  } catch {
    try {
      clearTokens()
    } catch (_) {}
  }
  Taro.showToast({ title: message, icon: 'none' })
  Taro.redirectTo({ url: LOGIN_PAGE_URL })
}

/**
 * 带认证的请求
 * - 无 token 时清除本地并跳转登录页
 * - 响应 401/403 时视为 token 失效，清除登录态并跳转登录页
 * @param url 请求 URL
 * @param options 请求选项
 * @returns Promise<any>
 */
export async function authenticatedRequest(
  url: string,
  options: Omit<Taro.request.Option, 'url'> = {}
): Promise<any> {
  const token = getAccessToken()

  if (!token) {
    redirectToLogin('未登录，请先登录')
    throw new Error('未登录，请先登录')
  }

  const requestUrl = `${API_BASE_URL}${url}`
  const startedAt = Date.now()
  let res: Taro.request.SuccessCallbackResult<any>
  try {
    res = await Taro.request({
      url: requestUrl,
      ...options,
      header: withNgrokBypassHeaders({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.header || {})
      })
    })
    recordResponseTrace({
      url,
      method: String(options.method || 'GET'),
      startedAt,
      response: res,
    })
  } catch (error) {
    recordResponseTrace({
      url,
      method: String(options.method || 'GET'),
      startedAt,
      error,
    })
    throw error
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    redirectToLogin('登录已失效，请重新登录')
    throw new Error('登录已失效，请重新登录')
  }

  // 特殊处理 openid 相关错误：视为登录状态异常，强制重新登录
  if (res.statusCode >= 400 && res.statusCode < 500) {
    const detail = (res.data as any)?.detail as string | undefined
    if (detail && (detail.includes('openid') || detail.includes('Token 中缺少 openid'))) {
      redirectToLogin('登录状态异常，请重新登录')
      throw new Error(detail || '登录状态异常，请重新登录')
    }
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throwHttpErrorWithStatus(
      res.statusCode,
      res.data,
      '请求失败，请稍后重试',
      res.header as Record<string, any> | undefined,
      url
    )
  }

  // 解包后端标准响应 {code: 0, message: "ok", data: ...}
  const parsed = normalizeTaroResponseJson(res.data)
  if (parsed && typeof parsed.code === 'number') {
    if (parsed.code !== 0) {
      const msg = typeof parsed.message === 'string' ? parsed.message : '请求失败'
      throw new Error(msg)
    }
    res.data = parsed.data
  }

  return res
}

/**
 * 调用后端API进行微信小程序登录
 * @param code 微信小程序登录凭证
 * @param phoneCode 获取手机号的 code（可选）
 * @returns Promise<LoginResponse> 登录结果
 */
export async function login(code: string, phoneCode?: string, inviteCode?: string, testOpenid?: string): Promise<LoginResponse> {
  try {
    const requestData: LoginRequestParams = {
      code: code
    }

    if (phoneCode) {
      requestData.phoneCode = phoneCode
    }
    if (inviteCode?.trim()) {
      requestData.inviteCode = inviteCode.trim()
    }
    if (testOpenid?.trim()) {
      requestData.testOpenid = testOpenid.trim()
    }
    console.log('[invite-debug][api] login 请求体邀请码状态', {
      hasInviteCode: Boolean(requestData.inviteCode),
      inviteCode: requestData.inviteCode || '',
      hasPhoneCode: Boolean(requestData.phoneCode),
      hasTestOpenid: Boolean(requestData.testOpenid),
      requestKeys: Object.keys(requestData),
    })

    const response = await Taro.request({
      url: `${API_BASE_URL}/api/login`,
      method: 'POST',
      header: withNgrokBypassHeaders({
        'Content-Type': 'application/json'
      }),
      data: requestData,
      timeout: 10000 // 10秒超时
    })
    console.log('[invite-debug][api] login 响应状态', {
      statusCode: response.statusCode,
      responseKeys: Object.keys((response.data || {}) as Record<string, unknown>),
      requestHadInviteCode: Boolean(requestData.inviteCode),
    })

    if (response.statusCode !== 200) {
      throwHttpErrorWithStatus(
        response.statusCode,
        response.data,
        '登录失败，请重试',
        response.header as Record<string, any> | undefined
      )
    }

    const loginData = unwrapResponse<LoginResponse>(response)
    console.log('[invite-debug][api] login 响应用户摘要', {
      userId: loginData.user_id,
      hasAccessToken: Boolean(loginData.access_token),
      hasPhoneNumber: Boolean(loginData.purePhoneNumber || loginData.phoneNumber),
      requestHadInviteCode: Boolean(requestData.inviteCode),
    })

    // 保存 token 到本地存储
    saveTokens(loginData.access_token, loginData.refresh_token, loginData.user_id)

    // 缓存用户目标
    if (loginData.diet_goal) {
      Taro.setStorageSync('dietGoal', loginData.diet_goal)
    } else {
      Taro.removeStorageSync('dietGoal')
    }

    return loginData
  } catch (error: any) {
    console.error('登录API调用失败:', error)
    console.error('错误详情:', JSON.stringify(error))
    // 如果是上游已包装过的错误（含 traceId / 用户友好文案），直接透传给页面统一弹窗处理
    if (error instanceof Error && (error as ErrorLike).message) {
      throw error
    }
    // 提取更有意义的错误信息
    const errMsg = error.errMsg || error.message || ''
    if (errMsg.includes('ERR_CERT')) {
      throw new Error('SSL证书验证失败，请检查服务器证书配置')
    } else if (errMsg.includes('timeout')) {
      throw new Error('请求超时，请稍后重试')
    } else if (errMsg.includes('fail')) {
      throw new Error('网络请求失败，请稍后重试')
    }
    throw new Error('登录失败，请稍后重试')
  }
}

export async function debugImpersonateUser(userId: string, password: string): Promise<LoginResponse> {
  const trimmedUserId = userId.trim()
  const trimmedPassword = password.trim()
  if (!trimmedUserId) {
    throw new Error('请输入用户 ID')
  }
  if (!trimmedPassword) {
    throw new Error('请输入调试密码')
  }

  const response = await Taro.request({
    url: `${API_BASE_URL}/api/test-backend/impersonate-user`,
    method: 'POST',
    header: withNgrokBypassHeaders({
      'Content-Type': 'application/json'
    }),
    data: { user_id: trimmedUserId, password: trimmedPassword },
    timeout: 10000
  })

  if (response.statusCode !== 200) {
    throwHttpErrorWithStatus(
      response.statusCode,
      response.data,
      '代登录失败',
      response.header as Record<string, any> | undefined
    )
  }

  const loginData = unwrapResponse<LoginResponse>(response)
  saveTokens(loginData.access_token, loginData.refresh_token, loginData.user_id)
  if (loginData.diet_goal) {
    Taro.setStorageSync('dietGoal', loginData.diet_goal)
  } else {
    Taro.removeStorageSync('dietGoal')
  }
  return loginData
}

/**
 * 获取公开配置（无需登录）
 */
async function requestPublicConfig(path: string): Promise<PublicConfigResponse> {
  const response = await Taro.request({
    url: `${API_BASE_URL}${path}`,
    method: 'GET',
    header: withNgrokBypassHeaders({
      'Content-Type': 'application/json'
    }),
    timeout: 10000
  })

  if (response.statusCode !== 200) {
    throwHttpErrorWithStatus(
      response.statusCode,
      response.data,
      '获取配置失败',
      response.header as Record<string, any> | undefined,
      `${API_BASE_URL}${path}`
    )
  }

  return unwrapResponse<PublicConfigResponse>(response)
}

export async function getPublicConfig(): Promise<PublicConfigResponse> {
  try {
    return await requestPublicConfig('/api/app/public-config')
  } catch (err) {
    if ((err as ErrorLike)?.statusCode !== 404) {
      throw err
    }
    console.warn('[getPublicConfig] /api/app/public-config 返回 404，尝试兼容路径 /api/public-config')
    return requestPublicConfig('/api/public-config')
  }
}

/**
 * 测试用手机号密码注册
 */
export async function registerWithPassword(
  phone: string,
  password: string,
  nickname: string,
  inviteCode?: string
): Promise<LoginResponse> {
  const requestData: PasswordRegisterRequest = {
    phone: phone.trim(),
    password: password.trim(),
    nickname: nickname.trim()
  }
  if (inviteCode?.trim()) {
    requestData.inviteCode = inviteCode.trim()
  }
  console.log('[invite-debug][api] registerWithPassword 请求体邀请码状态', {
    phoneSuffix: phone.trim().slice(-4),
    inviteCode: requestData.inviteCode || '',
    hasInviteCode: Boolean(requestData.inviteCode),
    requestKeys: Object.keys(requestData),
  })

  const response = await Taro.request({
    url: `${API_BASE_URL}/api/app/register/password`,
    method: 'POST',
    header: withNgrokBypassHeaders({
      'Content-Type': 'application/json'
    }),
    data: requestData,
    timeout: 10000
  })
  console.log('[invite-debug][api] registerWithPassword 响应状态', {
    statusCode: response.statusCode,
    responseKeys: Object.keys((response.data || {}) as Record<string, unknown>),
    requestHadInviteCode: Boolean(requestData.inviteCode),
  })

  if (response.statusCode !== 200) {
    throwHttpErrorWithStatus(
      response.statusCode,
      response.data,
      '注册失败',
      response.header as Record<string, any> | undefined
    )
  }

  const loginData = unwrapResponse<LoginResponse>(response)
  console.log('[invite-debug][api] registerWithPassword 响应用户摘要', {
    userId: loginData.user_id,
    hasAccessToken: Boolean(loginData.access_token),
    hasPhoneNumber: Boolean(loginData.purePhoneNumber || loginData.phoneNumber),
    requestHadInviteCode: Boolean(requestData.inviteCode),
  })
  saveTokens(loginData.access_token, loginData.refresh_token, loginData.user_id)
  if (loginData.diet_goal) {
    Taro.setStorageSync('dietGoal', loginData.diet_goal)
  } else {
    Taro.removeStorageSync('dietGoal')
  }
  return loginData
}

/**
 * 获取用户信息
 * @returns Promise<UserInfo>
 */
export async function getUserProfile(): Promise<UserInfo> {
  try {
    const response = await authenticatedRequest('/api/user/profile', {
      method: 'GET'
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取用户信息失败'
      throw new Error(errorMsg)
    }

    return response.data as UserInfo
  } catch (error: any) {
    console.error('获取用户信息失败:', error)
    throw new Error(error.message || '获取用户信息失败')
  }
}

/**
 * 获取会员套餐列表
 */
export async function getMembershipPlans(): Promise<MembershipPlan[]> {
  try {
    const token = getAccessToken()
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/membership/plans`,
      method: 'GET',
      header: withNgrokBypassHeaders({
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      })
    })

    if (response.statusCode !== 200) {
      throwHttpErrorWithStatus(
        response.statusCode,
        response.data,
        '获取会员套餐失败',
        response.header as Record<string, any> | undefined
      )
    }

    return ((unwrapResponse<MembershipPlansResponse>(response))?.list || []) as MembershipPlan[]
  } catch (error: any) {
    console.error('获取会员套餐失败:', error)
    throw new Error(error.message || '获取会员套餐失败')
  }
}

// 会员状态短缓存：避免短时间内（如菜单弹窗→点击）重复请求
const _membershipCache = new Map<string, { data: MembershipStatus; expiresAt: number }>()
let _membershipPending: Promise<MembershipStatus> | null = null
let _membershipPendingKey = ''
const MEMBERSHIP_CACHE_TTL_MS = 30_000

/**
 * 获取当前用户会员状态（带 30s 缓存，复用 in-flight 请求）
 * @param date 可选，查询指定日期的积分状态（YYYY-MM-DD），不传则查今天
 */
export async function getMyMembership(date?: string, options?: { forceRefresh?: boolean }): Promise<MembershipStatus> {
  const key = (date || '').trim()
  const forceRefresh = options?.forceRefresh === true
  const cached = _membershipCache.get(key)
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.data
  }
  if (!forceRefresh && _membershipPending && _membershipPendingKey === key) {
    return _membershipPending
  }

  _membershipPendingKey = key
  _membershipPending = (async () => {
    try {
      const url = key ? `/api/membership/me?date=${encodeURIComponent(key)}` : '/api/membership/me'
      const response = await authenticatedRequest(url, {
        method: 'GET',
        timeout: 15000
      })

      if (response.statusCode !== 200) {
        const errorMsg = (response.data as any)?.detail || '获取会员状态失败'
        throw new Error(errorMsg)
      }

      const data = response.data as MembershipStatus
      _membershipCache.set(key, { data, expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS })
      return data
    } catch (error: any) {
      console.error('获取会员状态失败:', error)
      throw new Error(error.message || '获取会员状态失败')
    } finally {
      _membershipPending = null
      _membershipPendingKey = ''
    }
  })()

  return _membershipPending
}

export async function claimSharePosterReward(input: string | ClaimSharePosterRewardInput): Promise<ClaimSharePosterRewardResponse> {
  const payload: ClaimSharePosterRewardInput = typeof input === 'string'
    ? { record_id: input }
    : { ...input }
  if (payload.record_id) {
    payload.record_id = payload.record_id.trim()
  }
  if (!payload.record_id && !payload.share_scope) {
    throw new Error('缺少分享对象，无法领取海报奖励')
  }
  try {
    const response = await authenticatedRequest('/api/membership/rewards/share-poster/claim', {
      method: 'POST',
      data: payload
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '领取海报奖励失败'
      throw new Error(errorMsg)
    }

    return response.data as ClaimSharePosterRewardResponse
  } catch (error: any) {
    console.error('领取海报奖励失败:', error)
    throw new Error(error.message || '领取海报奖励失败')
  }
}

export async function getRewardCenter(): Promise<RewardCenterResponse> {
  try {
    const response = await authenticatedRequest('/api/membership/reward-center', {
      method: 'GET',
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取赚积分任务失败'
      throw new Error(errorMsg)
    }
    return response.data as RewardCenterResponse
  } catch (error: any) {
    console.error('获取赚积分任务失败:', error)
    throw new Error(error.message || '获取赚积分任务失败')
  }
}

export async function getInviteRewardStatus(): Promise<InviteRewardStatusResponse> {
  try {
    const response = await authenticatedRequest('/api/membership/invite-reward-status', {
      method: 'GET',
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取邀请奖励进度失败'
      throw new Error(errorMsg)
    }
    return response.data as InviteRewardStatusResponse
  } catch (error: any) {
    console.error('获取邀请奖励进度失败:', error)
    throw new Error(error.message || '获取邀请奖励进度失败')
  }
}

export async function getMyVouchers(status?: string): Promise<VoucherListResponse> {
  try {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    const response = await authenticatedRequest(`/api/vouchers/my${query}`, {
      method: 'GET',
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取可用奖励失败'
      throw new Error(errorMsg)
    }
    return (response.data as VoucherListResponse) || { items: [], total: 0 }
  } catch (error: any) {
    console.error('获取可用奖励失败:', error)
    throw new Error(error.message || '获取可用奖励失败')
  }
}

export async function useVoucher(voucherId: string): Promise<{ success: boolean }> {
  try {
    const response = await authenticatedRequest(`/api/vouchers/${encodeURIComponent(voucherId)}/use`, {
      method: 'POST',
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '启用奖励失败'
      throw new Error(errorMsg)
    }
    return (response.data as { success: boolean }) || { success: true }
  } catch (error: any) {
    console.error('启用奖励失败:', error)
    throw new Error(error.message || '启用奖励失败')
  }
}

export async function getFoodExpiryDashboard(): Promise<FoodExpiryDashboard> {
  const response = await authenticatedRequest('/api/expiry/dashboard', {
    method: 'GET',
  })
  return response.data as FoodExpiryDashboard
}

export async function listManagedFoodExpiryItems(status?: FoodExpiryStatus): Promise<{ items: FoodExpiryItem[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  const response = await authenticatedRequest(`/api/expiry/items${query}`, {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取保质期列表失败')
  }
  return response.data as { items: FoodExpiryItem[] }
}

export async function createManagedFoodExpiryItem(data: UpsertFoodExpiryItemRequest): Promise<{ message: string; item: FoodExpiryItem }> {
  const response = await authenticatedRequest('/api/expiry/items', {
    method: 'POST',
    data,
    timeout: 15000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '创建保质期条目失败')
  }
  return response.data as { message: string; item: FoodExpiryItem }
}

export async function recognizeManagedFoodExpiryItems(
  imageUrls: string[],
  additionalContext?: string,
): Promise<FoodExpiryRecognitionResponse> {
  const response = await authenticatedRequest('/api/expiry/recognize', {
    method: 'POST',
    data: {
      image_urls: imageUrls,
      additional_context: additionalContext || undefined,
    },
    timeout: 90000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '保质期识别失败')
  }
  return response.data as FoodExpiryRecognitionResponse
}

export async function getManagedFoodExpiryItem(id: string): Promise<{ item: FoodExpiryItem }> {
  const response = await authenticatedRequest(`/api/expiry/items/${id}`, {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取保质期详情失败')
  }
  return response.data as { item: FoodExpiryItem }
}

export async function updateManagedFoodExpiryItem(id: string, data: UpsertFoodExpiryItemRequest): Promise<{ message: string; item: FoodExpiryItem }> {
  const response = await authenticatedRequest(`/api/expiry/items/${id}`, {
    method: 'PUT',
    data,
    timeout: 15000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '更新保质期条目失败')
  }
  return response.data as { message: string; item: FoodExpiryItem }
}

export async function updateManagedFoodExpiryStatus(id: string, status: FoodExpiryStatus): Promise<{ message: string; item: FoodExpiryItem }> {
  const response = await authenticatedRequest(`/api/expiry/items/${id}/status`, {
    method: 'POST',
    data: { status },
    timeout: 15000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '更新保质期状态失败')
  }
  return response.data as { message: string; item: FoodExpiryItem }
}

export async function subscribeManagedFoodExpiryItem(id: string, data: FoodExpirySubscribeRequest): Promise<FoodExpirySubscribeResponse> {
  const response = await authenticatedRequest(`/api/expiry/items/${id}/subscribe`, {
    method: 'POST',
    data,
    timeout: 15000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '登记保质期提醒失败')
  }
  return response.data as FoodExpirySubscribeResponse
}

/**
 * 创建会员支付单
 */
export async function createMembershipPayment(planCode: string): Promise<CreateMembershipPaymentResponse> {
  try {
    const response = await authenticatedRequest('/api/membership/pay/create', {
      method: 'POST',
      data: {
        plan_code: planCode
      }
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '创建会员支付单失败'
      throw new Error(errorMsg)
    }

    return response.data as CreateMembershipPaymentResponse
  } catch (error: any) {
    console.error('创建会员支付单失败:', error)
    throw new Error(error.message || '创建会员支付单失败')
  }
}

/** 创建微信委托代扣纯签约参数。模板 ID 只在服务端按套餐编码映射。 */
export async function createMembershipAutoRenewSigning(planCode: string): Promise<CreateMembershipAutoRenewSigningResponse> {
  const response = await authenticatedRequest('/api/membership/auto-renew/signing', {
    method: 'POST',
    data: { plan_code: planCode },
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '创建自动续费签约失败')
  }
  return response.data as CreateMembershipAutoRenewSigningResponse
}

/** 关闭当前用户唯一的微信自动续费合同，不影响已付费会员周期。 */
export async function cancelMembershipAutoRenew(): Promise<{ cancelled: boolean }> {
  const response = await authenticatedRequest('/api/membership/auto-renew/cancel', {
    method: 'POST',
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '关闭自动续费失败')
  }
  return response.data as { cancelled: boolean }
}

export async function syncMembershipPayment(orderNo: string): Promise<SyncMembershipPaymentResponse> {
  try {
    const response = await authenticatedRequest('/api/membership/pay/sync', {
      method: 'POST',
      data: {
        order_no: orderNo,
      },
      timeout: 15000,
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '同步会员支付状态失败'
      throw new Error(errorMsg)
    }

    return response.data as SyncMembershipPaymentResponse
  } catch (error: any) {
    console.error('同步会员支付状态失败:', error)
    throw new Error(error.message || '同步会员支付状态失败')
  }
}

/**
 * 更新用户信息
 * @param userInfo 要更新的用户信息
 * @returns Promise<UserInfo>
 */
export async function updateUserInfo(userInfo: UpdateUserInfoRequest): Promise<UserInfo> {
  try {
    const response = await authenticatedRequest('/api/user/profile', {
      method: 'PUT',
      data: userInfo
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '更新用户信息失败'
      throw new Error(errorMsg)
    }

    return response.data as UserInfo
  } catch (error: any) {
    console.error('更新用户信息失败:', error)
    throw new Error(error.message || '更新用户信息失败')
  }
}

/**
 * 已登录用户用微信手机号 code 绑定手机号（写入 weapp_user.telephone）
 * @param phoneCode 微信 getPhoneNumber 返回的 code
 * @returns Promise<{ telephone?: string; purePhoneNumber?: string }>
 */
export async function bindPhone(phoneCode: string): Promise<{ telephone?: string; purePhoneNumber?: string }> {
  const response = await authenticatedRequest('/api/user/bind-phone', {
    method: 'POST',
    data: { phoneCode }
  })
  if (response.statusCode !== 200) {
    const errorMsg = (response.data as any)?.detail || '绑定手机号失败'
    throw new Error(errorMsg)
  }
  return response.data as { telephone?: string; purePhoneNumber?: string }
}

/**
 * 上传用户头像到 Supabase Storage
 * @param base64Image Base64 编码的图片
 * @returns Promise<{ imageUrl: string }>
 */
export async function uploadUserAvatar(base64Image: string): Promise<{ imageUrl: string }> {
  const response = await authenticatedRequest('/api/user/upload-avatar', {
    method: 'POST',
    data: { base64Image },
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    const msg = (response.data as any)?.detail || '上传头像失败'
    throw new Error(msg)
  }
  return response.data as { imageUrl: string }
}

export async function uploadCoverImage(base64Image: string): Promise<{ imageUrl: string }> {
  const response = await authenticatedRequest('/api/user/upload-cover', {
    method: 'POST',
    data: { base64Image },
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    const msg = (response.data as any)?.detail || '上传背景图失败'
    throw new Error(msg)
  }
  return response.data as { imageUrl: string }
}

/**
 * 获取用户记录天数统计
 * @returns Promise<{ record_days: number }>
 */
export async function getUserRecordDays(): Promise<{ record_days: number }> {
  const res = await authenticatedRequest('/api/user/record-days', { method: 'GET', timeout: 10000 })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取记录天数失败'
    throw new Error(msg)
  }
  return res.data as { record_days: number }
}

/**
 * 获取当前用户健康档案
 * @returns Promise<HealthProfile>
 */
export async function getHealthProfile(): Promise<HealthProfile> {
  try {
    const response = await authenticatedRequest('/api/user/health-profile', {
      method: 'GET'
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取健康档案失败'
      throw new Error(errorMsg)
    }
    return response.data as HealthProfile
  } catch (error: any) {
    console.error('获取健康档案失败:', error)
    throw new Error(error.message || '获取健康档案失败')
  }
}

/**
 * 从后端获取推荐的默认餐次（已结合作息与当天已有记录做顺延）。
 * @param params.date 目标日期（YYYY-MM-DD），默认今天
 * @returns Promise<{ meal_type: MealType; generated_by: string }>
 */
export async function getRecommendMealType(params?: { date?: string }): Promise<{ meal_type: MealType; generated_by: string }> {
  try {
    const query = params?.date ? `?date=${encodeURIComponent(params.date)}` : ''
    const response = await authenticatedRequest(`/api/food-record/recommend-meal-type${query}`, {
      method: 'GET'
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取推荐餐次失败'
      throw new Error(errorMsg)
    }
    return response.data as { meal_type: MealType; generated_by: string }
  } catch (error: any) {
    console.error('获取推荐餐次失败:', error)
    throw new Error(error.message || '获取推荐餐次失败')
  }
}

/**
 * 提交/更新健康档案问卷（后端自动计算 BMR、日常消耗估算）
 * @param data 问卷数据
 * @returns Promise<HealthProfile>
 */
export async function updateHealthProfile(
  data: HealthProfileUpdateRequest
): Promise<HealthProfile> {
  try {
    const response = await authenticatedRequest('/api/user/health-profile', {
      method: 'PUT',
      data
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '更新健康档案失败'
      throw new Error(errorMsg)
    }
    return response.data as HealthProfile
  } catch (error: any) {
    console.error('更新健康档案失败:', error)
    throw new Error(error.message || '更新健康档案失败')
  }
}

/**
 * 上传体检报告图片到 Supabase Storage，返回公网 URL。
 * 小程序先调此接口拿 imageUrl，再调 extractHealthReportOcr 传 imageUrl 给多模态模型识别。
 */
export async function uploadReportImage(base64Image: string): Promise<{ imageUrl: string }> {
  try {
    const response = await authenticatedRequest('/api/user/health-profile/upload-report-image', {
      method: 'POST',
      data: { base64Image }
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '上传失败'
      throw new Error(errorMsg)
    }
    return response.data as { imageUrl: string }
  } catch (error: any) {
    console.error('体检报告图片上传失败:', error)
    throw new Error(error.message || '上传失败，请重试')
  }
}

/**
 * 提交病历信息提取任务，后台异步处理，完成后自动更新到健康档案。用户无感知。
 * @param imageUrl 体检报告图片在 Supabase Storage 的公网 URL
 */
export async function submitReportExtractionTask(input: {
  imageUrl?: string
  imageUrls?: string[]
}): Promise<{ taskId: string }> {
  const imageUrl = String(input.imageUrl || '').trim()
  const imageUrls = Array.isArray(input.imageUrls)
    ? input.imageUrls.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  if (!imageUrl && imageUrls.length === 0) {
    throw new Error('请先上传体检报告')
  }
  try {
    const response = await authenticatedRequest('/api/user/health-profile/submit-report-extraction-task', {
      method: 'POST',
      data: imageUrls.length > 0 ? { imageUrl, imageUrls } : { imageUrl }
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '提交失败'
      throw new Error(errorMsg)
    }
    return response.data as { taskId: string }
  } catch (error: any) {
    console.error('提交病历提取任务失败:', error)
    throw new Error(error.message || '提交失败，请重试')
  }
}

/**
 * 仅识别体检报告/病例截图，不写入数据库。推荐先 uploadReportImage 拿 imageUrl 再传此处。
 * @param options 传 imageUrl（推荐）或 base64Image
 */
export async function extractHealthReportOcr(options: {
  imageUrl?: string
  base64Image?: string
}): Promise<{ extracted: Record<string, unknown> }> {
  const { imageUrl, base64Image } = options
  if (!imageUrl && !base64Image) {
    throw new Error('请传 imageUrl 或 base64Image')
  }
  try {
    const response = await authenticatedRequest('/api/user/health-profile/ocr-extract', {
      method: 'POST',
      data: imageUrl ? { imageUrl } : { base64Image }
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || 'OCR 识别失败'
      throw new Error(errorMsg)
    }
    return response.data as { extracted: Record<string, unknown> }
  } catch (error: any) {
    console.error('健康报告 OCR 识别失败:', error)
    throw new Error(error.message || '识别失败，请重试')
  }
}

/**
 * 上传体检报告/病例截图，OCR 识别并立即保存到健康档案
 * @param base64Image Base64 编码的图片
 * @returns Promise<{ extracted; message }>
 */
export async function uploadHealthReportOcr(base64Image: string): Promise<{
  extracted: Record<string, unknown>
  message: string
}> {
  try {
    const response = await authenticatedRequest('/api/user/health-profile/ocr', {
      method: 'POST',
      data: { base64Image }
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || 'OCR 识别失败'
      throw new Error(errorMsg)
    }
    return response.data as { extracted: Record<string, unknown>; message: string }
  } catch (error: any) {
    console.error('健康报告 OCR 失败:', error)
    throw new Error(error.message || '识别失败，请重试')
  }
}

// ---------- 手动记录：食物搜索 ----------

export interface ManualFoodSearchResult {
  id: string
  source: 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom'
  title: string
  subtitle: string
  category?: string
  default_weight_grams: number
  display_unit?: 'g' | 'ml' | 'serving' | 'piece'
  display_unit_label?: string
  serving_presets?: Array<{ label: string; grams: number; quantity: number }>
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  nutrients_per_100g?: {
    calories: number
    protein: number
    carbs: number
    fat: number
    fiber: number
    sugar: number
    saturatedFat?: number
    cholesterolMg?: number
    sodium_mg?: number
    sodiumMg?: number
    potassiumMg?: number
    calciumMg?: number
    ironMg?: number
    magnesiumMg?: number
    zincMg?: number
    vitaminARaeMcg?: number
    vitaminCMg?: number
    vitaminDMcg?: number
    vitaminEMg?: number
    vitaminKMcg?: number
    thiaminMg?: number
    riboflavinMg?: number
    niacinMg?: number
    vitaminB6Mg?: number
    folateMcg?: number
    vitaminB12Mcg?: number
  }
  extra_nutrients?: {
    fiber: number
    sugar: number
    saturatedFat?: number
    cholesterolMg?: number
    sodium_mg?: number
    sodiumMg?: number
    potassiumMg?: number
    calciumMg?: number
    ironMg?: number
    magnesiumMg?: number
    zincMg?: number
    vitaminARaeMcg?: number
    vitaminCMg?: number
    vitaminDMcg?: number
    vitaminEMg?: number
    vitaminKMcg?: number
    thiaminMg?: number
    riboflavinMg?: number
    niacinMg?: number
    vitaminB6Mg?: number
    folateMcg?: number
    vitaminB12Mcg?: number
  }
  items?: Array<{ name: string; weight?: number; nutrients?: Nutrients }> | null
  image_path?: string | null
  image_paths?: string[] | null
  portion_label?: string
  source_label?: string
  recommend_reason?: string
  nutrition_highlights?: string[]
  usage_count?: number
  collected?: boolean
  like_count?: number
  collection_count?: number
  match_score?: number
}

export interface ManualFoodCatalogCategory {
  key: string
  label: string
  count?: number
}

export interface ManualFoodCatalogResult {
  categories: ManualFoodCatalogCategory[]
  items: ManualFoodSearchResult[]
  category: string
  page: number
  page_size: number
  has_more: boolean
  stats?: {
    nutrition_food_count: number
    nutrition_alias_count: number
    public_food_count: number
  }
}

export async function searchManualFood(
  q: string,
  limit: number = 20,
  options?: { source?: 'packaged_food' }
): Promise<ManualFoodSearchResult[]> {
  const token = getAccessToken()
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) })
  if (options?.source) {
    params.set('source', options.source)
  }
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/manual-food/search?${params.toString()}`,
    method: 'GET',
    header: withNgrokBypassHeaders({
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }),
    timeout: 10000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '搜索失败')
  }
  const results = ((unwrapResponse<any>(response))?.results || []) as ManualFoodSearchResult[]
  return results.map(normalizeManualFoodSearchResult)
}

export async function fetchManualFoodCatalog(
  category: string = 'common',
  page: number = 1,
  pageSize: number = 30
): Promise<ManualFoodCatalogResult> {
  const token = getAccessToken()
  const params = new URLSearchParams({
    category,
    page: String(page),
    page_size: String(pageSize),
  })
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/manual-food/catalog?${params.toString()}`,
    method: 'GET',
    header: withNgrokBypassHeaders({
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }),
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取食物目录失败')
  }
  const data = unwrapResponse<ManualFoodCatalogResult>(response)
  return {
    ...data,
    items: Array.isArray(data.items) ? data.items.map(normalizeManualFoodSearchResult) : [],
  }
}

export interface SaveManualCustomFoodRequest {
  id?: string
  title: string
  default_weight_grams: number
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  nutrients_per_100g?: Nutrients
  extra_nutrients?: Nutrients
  image_path?: string | null
  image_paths?: string[] | null
  portion_label?: string
  recommend_reason?: string
  share_to_public?: boolean
}

export async function fetchManualCustomFoods(
  limit: number = 120,
  offset: number = 0
): Promise<{ items: ManualFoodSearchResult[]; has_more: boolean }> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  const response = await authenticatedRequest(`/api/manual-food/custom?${params.toString()}`, {
    method: 'GET',
    timeout: 15000
  })
  return unwrapResponse<{ items: ManualFoodSearchResult[]; has_more: boolean }>(response)
}

export async function saveManualCustomFood(
  data: SaveManualCustomFoodRequest
): Promise<ManualFoodSearchResult> {
  const response = await authenticatedRequest('/api/manual-food/custom', {
    method: 'POST',
    data,
    timeout: 15000
  })
  return unwrapResponse<{ item: ManualFoodSearchResult }>(response).item
}

export interface ManualFoodBrowseResult {
  recent_items: ManualFoodSearchResult[]
  collected_public_library: ManualFoodSearchResult[]
  public_library: ManualFoodSearchResult[]
  nutrition_library: ManualFoodSearchResult[]
  stats?: {
    nutrition_food_count: number
    nutrition_alias_count: number
    public_food_count: number
  }
}

export async function browseManualFood(): Promise<ManualFoodBrowseResult> {
  const token = getAccessToken()
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/manual-food/browse`,
    method: 'GET',
    header: withNgrokBypassHeaders({
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }),
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取食物库失败')
  }
  const data = unwrapResponse<ManualFoodBrowseResult>(response)
  const mapList = (list?: ManualFoodSearchResult[]) =>
    Array.isArray(list) ? list.map(normalizeManualFoodSearchResult) : []
  return {
    ...data,
    recent_items: mapList(data.recent_items),
    collected_public_library: mapList(data.collected_public_library),
    public_library: mapList(data.public_library),
    nutrition_library: mapList(data.nutrition_library),
  }
}

export interface UnresolvedFoodLog {
  id: string
  raw_name: string
  normalized_name: string
  hit_count: number
  first_seen_at?: string
  last_seen_at?: string
  task_id?: string | null
  sample_payload?: Record<string, unknown> | null
}

export interface FoodNutritionSearchCandidate {
  food_id: string
  canonical_name: string
  match_source: 'canonical' | 'alias'
  score: number
  source?: string
  unit_nutrition_per_100g: UnitNutritionPer100g
}

export async function fetchTopUnresolvedFoods(limit: number = 50): Promise<UnresolvedFoodLog[]> {
  const res = await authenticatedRequest(`/api/food-nutrition/unresolved/top?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '获取未收录食物失败')
  }
  return (((res.data as any) || {}).items || []) as UnresolvedFoodLog[]
}

export async function searchFoodNutritionCandidates(query: string, limit: number = 5): Promise<FoodNutritionSearchCandidate[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams({ query: q, limit: String(limit) })
  const res = await authenticatedRequest(`/api/food-nutrition/search?${params.toString()}`, {
    method: 'GET',
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '查询标准食物候选失败')
  }
  return (((res.data as any) || {}).items || []) as FoodNutritionSearchCandidate[]
}

// ---------- 好友与圈子 ----------

/** 搜索用户项（不包含手机号） */
export interface CreatePackagedFoodRequest {
  brand?: string
  product_name: string
  spec_text?: string
  barcode?: string
  flavor_text?: string
  package_category?: string
  ingredients_text?: string
  source_image_urls?: string[]
  ocr_raw_text?: string
  nutrition_basis_unit?: string
  energy_unit_raw?: string
  raw_label_payload?: Record<string, any>
  conversion_status?: string
  extract_confidence?: number
  field_confidence?: Record<string, any>
  ingest_method?: string
  review_status?: string
  net_weight_g: number
  serving_weight_g?: number
  kcal_per_100g: number
  protein_per_100g: number
  carbs_per_100g: number
  fat_per_100g: number
  fiber_per_100g?: number
  sugar_per_100g?: number
  saturated_fat_per_100g?: number
  cholesterol_mg_per_100g?: number
  sodium_mg_per_100g?: number
  potassium_mg_per_100g?: number
  calcium_mg_per_100g?: number
  iron_mg_per_100g?: number
  magnesium_mg_per_100g?: number
  zinc_mg_per_100g?: number
  vitamin_a_rae_mcg_per_100g?: number
  vitamin_c_mg_per_100g?: number
  vitamin_d_mcg_per_100g?: number
  vitamin_e_mg_per_100g?: number
  vitamin_k_mcg_per_100g?: number
  thiamin_mg_per_100g?: number
  riboflavin_mg_per_100g?: number
  niacin_mg_per_100g?: number
  vitamin_b6_mg_per_100g?: number
  folate_mcg_per_100g?: number
  vitamin_b12_mcg_per_100g?: number
  source_url?: string
}

export interface PackagedFoodItem {
  id: string
  brand?: string
  product_name: string
  normalized_name: string
  product_key?: string
  spec_text?: string
  barcode?: string
  flavor_text?: string
  package_category?: string
  ingredients_text?: string
  source_image_urls?: string[]
  ocr_raw_text?: string
  extract_confidence?: number
  field_confidence?: Record<string, any>
  ingest_method?: string
  net_weight_g: number
  serving_weight_g: number
  kcal_per_100g: number
  protein_per_100g: number
  carbs_per_100g: number
  fat_per_100g: number
  fiber_per_100g?: number
  sugar_per_100g?: number
  sodium_mg_per_100g?: number
  source?: string
  is_active: boolean
}

export interface PackagedNutritionLabelRecognition {
  brand?: string
  product_name?: string
  net_weight_g?: number
  serving_weight_g?: number
  kcal_per_100g?: number
  protein_per_100g?: number
  carbs_per_100g?: number
  fat_per_100g?: number
  fiber_per_100g?: number
  sugar_per_100g?: number
  saturated_fat_per_100g?: number
  cholesterol_mg_per_100g?: number
  sodium_mg_per_100g?: number
  potassium_mg_per_100g?: number
  calcium_mg_per_100g?: number
  iron_mg_per_100g?: number
  magnesium_mg_per_100g?: number
  zinc_mg_per_100g?: number
  vitamin_a_rae_mcg_per_100g?: number
  vitamin_c_mg_per_100g?: number
  vitamin_d_mcg_per_100g?: number
  vitamin_e_mg_per_100g?: number
  vitamin_k_mcg_per_100g?: number
  thiamin_mg_per_100g?: number
  riboflavin_mg_per_100g?: number
  niacin_mg_per_100g?: number
  vitamin_b6_mg_per_100g?: number
  folate_mcg_per_100g?: number
  vitamin_b12_mcg_per_100g?: number
  confidence?: number
  raw_text?: string
}

export interface PackagedAutoIngestResult {
  status?: string
  reason?: string
  upsert_action?: string
  packaged_food_id?: string
  missing_fields?: string[]
  conflict_reasons?: string[]
}

export interface PackagedProductExtractResult {
  brand?: string
  product_name?: string
  flavor_text?: string
  package_category?: string
  net_content_value?: number
  net_content_unit?: string
  unit_count?: number
  unit_content_value?: number
  unit_content_unit?: string
  net_weight_g?: number
  serving_weight_g?: number
  spec_text?: string
  barcode?: string
  ingredients_text?: string
  unit_nutrition_per_100g?: Record<string, number>
  nutrition_basis_unit?: string
  energy_unit_raw?: string
  conversion_status?: string
  raw_label_payload?: Record<string, any>
  field_confidence?: Record<string, number>
  extract_confidence?: number
  needs_more_images?: string[]
  missing_fields?: string[]
  auto_ingest_result?: PackagedAutoIngestResult
  packaged_food_id?: string
  ocr_raw_text?: string
  source_image_urls?: string[]
}

export interface PackagedUploadRewardResult {
  awarded?: boolean
  already_claimed?: boolean
  already_exists?: boolean
  daily_limit_reached?: boolean
  reward_credits?: number
  reason?: string
  packaged_food_id?: string
  reward_task?: Record<string, any>
  reward_center?: RewardCenterResponse
}

export async function createPackagedFood(payload: CreatePackagedFoodRequest): Promise<PackagedFoodItem> {
  const res = await authenticatedRequest('/api/packaged-food', {
    method: 'POST',
    data: payload,
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '保存零食数据失败')
  }
  return unwrapResponse<{ item: PackagedFoodItem }>(res).item
}

export async function recognizePackagedNutritionLabel(imageUrl: string): Promise<PackagedNutritionLabelRecognition> {
  const res = await authenticatedRequest('/api/packaged-food/nutrition-label/recognize', {
    method: 'POST',
    data: { image_url: imageUrl },
    timeout: 90000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '识别营养成分表失败')
  }
  return unwrapResponse<{ nutrition: PackagedNutritionLabelRecognition }>(res).nutrition
}

export async function submitPackagedNutritionLabelRecognition(imageUrl: string): Promise<{ task_id: string; message: string }> {
  const res = await authenticatedRequest('/api/packaged-food/nutrition-label/submit', {
    method: 'POST',
    data: { image_url: imageUrl },
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '提交营养成分表识别任务失败')
  }
  return unwrapResponse<{ task_id: string; message: string }>(res)
}

export async function submitPackagedProductExtract(payload: {
  image_urls: string[]
  source_task_id?: string
  recognized_name_hint?: string
}): Promise<{ task_id: string; message: string }> {
  const res = await authenticatedRequest('/api/packaged-food/extract/submit', {
    method: 'POST',
    data: payload,
    timeout: 10000,
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '提交预包装商品识别任务失败')
  }
  return unwrapResponse<{ task_id: string; message: string }>(res)
}

export interface FriendSearchUser {
  id: string
  nickname: string
  avatar: string
  is_friend?: boolean  // 是否已是好友
  is_pending?: boolean // 是否已发送待处理请求
}

/** 收到的好友请求 */
export interface FriendRequestItem {
  id: string
  from_user_id: string
  to_user_id: string
  status: string
  created_at: string
  from_nickname: string
  from_avatar: string
}

export interface FriendRequestOverviewItem {
  id: string
  from_user_id: string
  to_user_id: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  updated_at?: string
  counterpart_user_id: string
  counterpart_nickname: string
  counterpart_avatar: string
}

export interface FriendRequestsOverview {
  received: FriendRequestOverviewItem[]
  sent: FriendRequestOverviewItem[]
}

/** 好友列表项 */
export interface FriendListItem {
  id: string
  nickname: string
  avatar: string
}

export interface FriendBlockItem {
  id: string
  blocked_user_id: string
  nickname: string
  avatar: string
  created_at: string
}

export interface FriendBlockStatus {
  is_blocked_by_me: boolean
  has_blocked_me: boolean
  blocked_either: boolean
}

/** 好友邀请码资料（公开） */
export interface FriendInviteProfile {
  user_id: string
  nickname: string
  avatar: string
  invite_code: string
}

/** 登录后解析邀请码返回 */
export interface FriendInviteResolveResult {
  user_id: string
  nickname: string
  avatar: string
  already_friend: boolean
  is_self: boolean
}

/** 接受邀请码返回 */
export interface FriendInviteAcceptResult {
  status: 'request_sent' | 'already_friend'
  user_id: string
  nickname: string
  avatar: string
}

/** @deprecated 兼容旧登录页返回结构 */
export interface LegacyFriendInviteRequestResult {
  status: 'requested' | 'already_friend'
  user_id: string
  nickname: string
  avatar: string
}

/** 本周好友圈打卡排行榜条目 */
export interface CheckinLeaderboardItem {
  rank: number
  user_id: string
  nickname: string
  avatar: string
  checkin_count: number
  is_me: boolean
}

export type CommunityFeedSortBy = 'recommended' | 'latest' | 'hot' | 'balanced'
export type CommunityAuthorScope = 'all' | 'priority' | 'public'
export type CommunityFeedTargetType = 'food_record' | 'exercise_log' | 'campus_food' | 'circle_post'
export type CommunityFeedContentType = 'all' | CommunityFeedTargetType

export interface CommunityFeedQueryParams {
  meal_type?: MealType
  diet_goal?: DietGoal
  sort_by?: CommunityFeedSortBy
  content_type?: CommunityFeedContentType
  priority_author_ids?: string[]
  author_scope?: CommunityAuthorScope
  author_id?: string
}

export interface CirclePostNutritionInput {
  calories?: number | null
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  fiber?: number | null
  sugar?: number | null
  sodium_mg?: number | null
  total_weight_grams?: number | null
}

export type CommunityFeedRecord = FoodRecord & {
  feed_type?: CommunityFeedTargetType
  exercise_type?: string | null
  exercise_desc?: string | null
  calories_burned?: number | null
  duration_min?: number | null
  ai_reasoning?: string | null
  exercise_items?: ExerciseActivityItem[] | null
  price?: number | null
  school?: string | null
  canteen?: string | null
  /** 自定义图文动态字段 */
  title?: string | null
  body?: string | null
  /** 自定义图文动态可选营养字段 */
  fiber?: number | null
  sugar?: number | null
  sodium_mg?: number | null
  total_weight_grams?: number | null
}

/** 圈子 Feed 单条（好友 + 自己今日饮食 + 点赞信息） */
export interface CommunityFeedItem {
  target_type?: CommunityFeedTargetType
  target_id?: string
  record: CommunityFeedRecord
  author: { id: string; nickname: string; avatar: string }
  like_count: number
  liked: boolean
  /** 是否为当前用户自己的帖子 */
  is_mine?: boolean
  /** 评论列表（已包含前 N 条） */
  comments?: FeedCommentItem[]
  /** 评论总数（前端展示用） */
  comment_count?: number
  /** 推荐理由（推荐排序时展示） */
  recommend_reason?: string
}

export function normalizeCommunityFeedItem(item: CommunityFeedItem): CommunityFeedItem {
  return {
    ...item,
    record: normalizeFoodRecord(item.record as FoodRecord) as CommunityFeedRecord,
  }
}

/** 评论项 */
export interface FeedCommentItem {
  id: string
  user_id: string
  record_id?: string | null
  target_type?: CommunityFeedTargetType
  target_id?: string
  parent_comment_id?: string | null
  reply_to_user_id?: string | null
  reply_to_nickname?: string
  content: string
  created_at: string
  nickname: string
  avatar: string
  _is_temp?: boolean  // 标记为临时评论（未通过审核）
  /** 乐观更新：已展示、等待接口落库 */
  _is_pending?: boolean
}

export interface CommunityCommentTask {
  id: string
  target_id: string
  content: string
  status: 'pending' | 'processing' | 'done' | 'failed' | 'violated'
  created_at: string
  updated_at?: string
  violation_reason?: string | null
  error_message?: string | null
  result?: Record<string, any> | null
  extra?: {
    parent_comment_id?: string | null
    reply_to_user_id?: string | null
  }
}

export interface FeedInteractionNotification {
  id: string
  notification_type: 'like_received' | 'comment_received' | 'reply_received' | 'comment_rejected'
  record_id?: string | null
  target_type?: CommunityFeedTargetType
  target_id?: string | null
  comment_id?: string | null
  parent_comment_id?: string | null
  content_preview: string
  is_read: boolean
  created_at: string
  actor: {
    id?: string | null
    nickname: string
    avatar: string
  }
}

// ── 圈子搜索 ──

export interface ContentSearchAuthor {
  id: string
  nickname: string
  avatar: string
}

export interface ContentSearchManualFoodItem {
  name?: string
  manual_source?: 'public_library' | 'nutrition_library' | 'packaged_food' | string | null
  manual_source_id?: string | null
  manual_source_title?: string | null
  source_label?: string | null
  image_path?: string | null
  image_paths?: string[] | null
  nutrients?: { calories?: number }
}

export interface ContentSearchResult {
  target_type: string
  target_id: string
  user_id: string
  description?: string
  title?: string
  body?: string
  image_path?: string
  image_paths?: string[]
  record_time?: string
  created_at?: string
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  fiber?: number
  sugar?: number
  sodium_mg?: number
  exercise_desc?: string
  exercise_type?: string
  calories_burned?: number
  duration_min?: number
  exercise_items?: ExerciseActivityItem[] | null
  meal_type?: string
  diet_goal?: string
  entry_type?: FoodRecordEntryType | null
  source_task_id?: string | null
  recipe_id?: string | null
  items?: FoodRecordItemRow[] | null
  manual_food_items?: ContentSearchManualFoodItem[]
  author: ContentSearchAuthor
  liked: boolean
  like_count: number
  comment_count: number
}

export interface UserSearchResult {
  id: string
  nickname: string
  avatar: string
  is_friend: boolean
  is_self: boolean
}

/** 圈子搜索（动态内容 / 用户），需登录 */
export async function communitySearch(params: {
  keyword: string
  tab?: 'content' | 'users'
  offset?: number
  limit?: number
}): Promise<{ list: ContentSearchResult[] | UserSearchResult[]; has_more: boolean; content_count: number; user_count: number }> {
  const q = new URLSearchParams()
  q.set('keyword', params.keyword)
  if (params.tab) q.set('tab', params.tab)
  if (params.offset !== undefined) q.set('offset', String(params.offset))
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  const response = await authenticatedRequest(`/api/community/search?${q.toString()}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '搜索失败')
  return response.data as { list: ContentSearchResult[] | UserSearchResult[]; has_more: boolean; content_count: number; user_count: number }
}

/** 搜索用户（昵称模糊 / 手机号精确） */
export async function friendSearch(params: { nickname?: string; telephone?: string }): Promise<{ list: FriendSearchUser[] }> {
  const q = new URLSearchParams()
  if (params.nickname) q.set('nickname', params.nickname)
  if (params.telephone) q.set('telephone', params.telephone)
  const response = await authenticatedRequest(`/api/friend/search?${q.toString()}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '搜索失败')
  return response.data as { list: FriendSearchUser[] }
}

/** 发送好友请求 */
export async function friendSendRequest(toUserId: string): Promise<void> {
  const response = await authenticatedRequest('/api/friend/request', { method: 'POST', data: { to_user_id: toUserId } })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '发送失败')
}

/** 清理重复好友记录 */
export async function friendCleanupDuplicates(): Promise<{ cleaned: number }> {
  const response = await authenticatedRequest('/api/friend/cleanup-duplicates', { method: 'POST' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '清理失败')
  return response.data as { cleaned: number }
}

/** 收到的待处理好友请求列表 */
export async function friendGetRequests(): Promise<{ list: FriendRequestItem[] }> {
  const response = await authenticatedRequest('/api/friend/requests', { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取失败')
  return response.data as { list: FriendRequestItem[] }
}

/** 处理好友请求 */
export async function friendRespondRequest(requestId: string, action: 'accept' | 'reject'): Promise<void> {
  const response = await authenticatedRequest(`/api/friend/request/${requestId}/respond`, {
    method: 'POST',
    data: { action }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '操作失败')
}

/** 撤销本人发出的待处理好友请求 */
export async function friendCancelSentRequest(requestId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/friend/request/${encodeURIComponent(requestId)}`, {
    method: 'DELETE'
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '撤销失败')
}

/** 获取食物分析任务数量 */
export async function getAnalyzeTaskCount(): Promise<{ count: number }> {
  const res = await authenticatedRequest('/api/analyze/tasks/count', { method: 'GET' })
  if (res.statusCode !== 200) {
    throw new Error((res.data as any)?.detail || '获取任务数量失败')
  }
  return res.data as { count: number }
}

/** 好友列表 */
export async function friendGetList(): Promise<{ list: FriendListItem[] }> {
  const response = await authenticatedRequest('/api/friend/list', { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取失败')
  return response.data as { list: FriendListItem[] }
}

/** 删除好友（双向） */
export async function friendDelete(friendId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/friend/${encodeURIComponent(friendId)}`, { method: 'DELETE' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '删除失败')
}

/** 拉黑用户 */
export async function friendBlockUser(userId: string): Promise<void> {
  const response = await authenticatedRequest('/api/friend/block', {
    method: 'POST',
    data: { blocked_user_id: userId }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '无法操作')
}

/** 解除拉黑 */
export async function friendUnblockUser(userId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/friend-blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '无法操作')
}

/** 黑名单列表 */
export async function friendGetBlocks(): Promise<{ list: FriendBlockItem[] }> {
  const response = await authenticatedRequest('/api/friend/blocks', { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取失败')
  return response.data as { list: FriendBlockItem[] }
}

/** 与某用户的拉黑状态 */
export async function friendGetBlockStatus(userId: string): Promise<FriendBlockStatus> {
  const response = await authenticatedRequest(`/api/friend/block-status/${encodeURIComponent(userId)}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取失败')
  return response.data as FriendBlockStatus
}

/** @deprecated 兼容旧调用名，后续统一使用 friendDelete */
export const friendRemove = friendDelete

/** 好友请求总览（收到 + 发出） */
export async function friendGetRequestsOverview(): Promise<FriendRequestsOverview> {
  const response = await authenticatedRequest('/api/friend/requests/all', { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取失败')
  return response.data as FriendRequestsOverview
}

/** 公开获取邀请资料（用于分享海报昵称与邀请码） */
export async function getFriendInviteProfile(userId: string): Promise<FriendInviteProfile> {
  const token = getAccessToken()
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/friend/invite/profile/${encodeURIComponent(userId)}`,
    method: 'GET',
    header: withNgrokBypassHeaders(token ? { Authorization: `Bearer ${token}` } : undefined),
    timeout: 10000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取邀请资料失败')
  }
  return unwrapResponse<FriendInviteProfile>(response)
}

export async function getFriendInviteProfileByCode(code: string): Promise<FriendInviteProfile> {
  const token = getAccessToken()
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/friend/invite/profile-by-code?code=${encodeURIComponent(code.trim())}`,
    method: 'GET',
    header: withNgrokBypassHeaders(token ? { Authorization: `Bearer ${token}` } : undefined),
    timeout: 10000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取邀请资料失败')
  }
  return unwrapResponse<FriendInviteProfile>(response)
}

/** 登录后解析邀请码 */
export async function resolveFriendInvite(code: string): Promise<FriendInviteResolveResult> {
  const q = encodeURIComponent(code.trim())
  const response = await authenticatedRequest(`/api/friend/invite/resolve?code=${q}`, { method: 'GET' })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '邀请码解析失败')
  }
  return response.data as FriendInviteResolveResult
}

/** 接受邀请码并直接建立好友关系 */
export async function acceptFriendInvite(code: string): Promise<FriendInviteAcceptResult> {
  console.log('[invite-debug][api] acceptFriendInvite 请求', {
    inviteCode: code.trim(),
    hasAccessToken: Boolean(getAccessToken()),
  })
  const response = await authenticatedRequest('/api/friend/invite/accept', {
    method: 'POST',
    data: { code: code.trim() }
  })
  console.log('[invite-debug][api] acceptFriendInvite 响应状态', {
    statusCode: response.statusCode,
    responseKeys: Object.keys((response.data || {}) as Record<string, unknown>),
  })
  if (response.statusCode !== 200) {
    const detail = (response.data as any)?.detail
    const errcode = (response.data as any)?.errcode
    const errmsg = (response.data as any)?.errmsg
    const backendMsg = detail || errmsg || ''
    const baseMsg = backendMsg
      ? `添加好友失败（HTTP ${response.statusCode}）：${backendMsg}`
      : `添加好友失败（HTTP ${response.statusCode}）`
    // 线上返回 500 时，补一层「解析邀请码」兜底，尽量给出可读原因
    try {
      const resolved = await resolveFriendInvite(code)
      if (resolved.is_self) {
        throw new Error('这是你自己的分享，无需重复添加好友')
      }
      if (resolved.already_friend) {
        return {
          status: 'already_friend',
          user_id: resolved.user_id,
          nickname: resolved.nickname,
          avatar: resolved.avatar
        }
      }
    } catch (e: any) {
      // 若解析接口本身也失败，继续抛原始错误信息
      if (e?.message === '这是你自己的分享，无需重复添加好友') {
        throw e
      }
    }
    if (errcode != null) {
      throw new Error(`${baseMsg}（errcode=${errcode}）`)
    }
    throw new Error(baseMsg)
  }
  return response.data as FriendInviteAcceptResult
}

/** @deprecated 兼容旧调用名，后续统一使用 acceptFriendInvite */
export async function requestFriendByInviteCode(code: string): Promise<LegacyFriendInviteRequestResult> {
  const res = await acceptFriendInvite(code)
  return {
    ...res,
    status: res.status === 'request_sent' ? 'requested' : 'already_friend'
  }
}

// ==================== 关注 / 粉丝 ====================

export interface FollowUser {
  id: string
  nickname: string
  avatar: string
}

export interface FollowStats {
  followers_count: number
  following_count: number
  is_following: boolean
}

/** 关注用户 */
export async function followUser(userId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/user/${encodeURIComponent(userId)}/follow`, { method: 'POST' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '关注失败')
}

/** 取消关注 */
export async function unfollowUser(userId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/user/${encodeURIComponent(userId)}/follow`, { method: 'DELETE' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '取消关注失败')
}

/** 获取粉丝列表 */
export async function getFollowers(userId: string, offset = 0, limit = 20): Promise<{ list: FollowUser[]; has_more: boolean }> {
  const response = await authenticatedRequest(`/api/user/${encodeURIComponent(userId)}/followers?offset=${offset}&limit=${limit}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取粉丝列表失败')
  return response.data as { list: FollowUser[]; has_more: boolean }
}

/** 获取关注列表 */
export async function getFollowing(userId: string, offset = 0, limit = 20): Promise<{ list: FollowUser[]; has_more: boolean }> {
  const response = await authenticatedRequest(`/api/user/${encodeURIComponent(userId)}/following?offset=${offset}&limit=${limit}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取关注列表失败')
  return response.data as { list: FollowUser[]; has_more: boolean }
}

/** 获取关注统计 */
export async function getFollowStats(userId: string): Promise<FollowStats> {
  const response = await authenticatedRequest(`/api/user/${encodeURIComponent(userId)}/follow-stats`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取关注统计失败')
  return response.data as FollowStats
}

// ==================== 私信 ====================

export const SYSTEM_MESSAGE_USER_ID = '00000000-0000-0000-0000-000000000000'

function normalizePrivateMessage(raw: any): PrivateMessage {
  return {
    id: raw?.id || raw?.ID || '',
    sender_id: raw?.sender_id || raw?.SenderID || '',
    receiver_id: raw?.receiver_id || raw?.ReceiverID || '',
    content: raw?.content || raw?.Content || '',
    image_url: raw?.image_url || raw?.ImageURL || '',
    content_type: raw?.content_type || raw?.ContentType || 'text',
    action_text: raw?.action_text || raw?.ActionText || '',
    extra_data: raw?.extra_data || raw?.ExtraData || undefined,
    is_read: raw?.is_read ?? raw?.IsRead ?? false,
    created_at: raw?.created_at || raw?.CreatedAt || '',
  }
}

function normalizeConversationSummary(raw: any): ConversationSummary {
  return {
    user_id: raw?.user_id || raw?.UserID || '',
    nickname: raw?.nickname || raw?.Nickname || '',
    avatar: raw?.avatar || raw?.Avatar || '',
    last_message: raw?.last_message || raw?.LastMessage
      ? normalizePrivateMessage(raw?.last_message || raw?.LastMessage)
      : (undefined as any),
    unread_count: raw?.unread_count ?? raw?.UnreadCount ?? 0,
  }
}

export interface PrivateMessage {
  id: string
  sender_id: string
  receiver_id: string
  content: string
  image_url?: string
  content_type: 'text' | 'image' | 'system'
  action_text?: string
  extra_data?: Record<string, any>
  is_read: boolean
  created_at: string
}

export interface ConversationSummary {
  user_id: string
  nickname: string
  avatar: string
  last_message: PrivateMessage
  unread_count: number
}

/** 发送私信 */
export async function sendPrivateMessage(receiverId: string, content: string, contentType: 'text' | 'image' = 'text', imageUrl?: string): Promise<PrivateMessage> {
  const response = await authenticatedRequest('/api/messages/send', {
    method: 'POST',
    data: { receiver_id: receiverId, content, content_type: contentType, image_url: imageUrl }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '发送失败')
  return normalizePrivateMessage(response.data)
}

/** 获取与某用户的聊天记录 */
export async function getPrivateMessages(otherUserId: string, offset = 0, limit = 20): Promise<{ list: PrivateMessage[]; has_more: boolean; blocked?: boolean }> {
  const response = await authenticatedRequest(`/api/messages/conversation/${encodeURIComponent(otherUserId)}?offset=${offset}&limit=${limit}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取聊天记录失败')
  const data = (response.data || {}) as any
  return {
    list: (data.list || []).map(normalizePrivateMessage),
    has_more: data.has_more ?? data.HasMore ?? false,
    blocked: data.blocked ?? data.Blocked ?? false,
  }
}

/** 获取会话列表 */
export async function getConversations(offset = 0, limit = 20): Promise<{ list: ConversationSummary[]; has_more: boolean }> {
  const response = await authenticatedRequest(`/api/messages/conversations?offset=${offset}&limit=${limit}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取会话列表失败')
  const data = (response.data || {}) as any
  return {
    list: (data.list || []).map(normalizeConversationSummary),
    has_more: data.has_more ?? data.HasMore ?? false,
  }
}

/** 标记某人的消息为已读 */
export async function markMessagesRead(senderId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/messages/read/${encodeURIComponent(senderId)}`, { method: 'PUT' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '标记已读失败')
}

/** 获取未读消息数 */
export async function getUnreadMessageCount(): Promise<{ count: number }> {
  const response = await authenticatedRequest('/api/messages/unread-count', { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取未读数失败')
  return response.data as { count: number }
}

/** 撤回（删除）私信 */
export async function deletePrivateMessage(messageId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/messages/message/${encodeURIComponent(messageId)}`, { method: 'DELETE' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '撤回失败')
}

/** 举报私信 */
export async function reportPrivateMessage(messageId: string, reason = 'other', extraContent = ''): Promise<void> {
  const response = await authenticatedRequest(`/api/messages/message/${encodeURIComponent(messageId)}/report`, {
    method: 'POST',
    data: { reason, extra_content: extraContent },
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '举报失败')
}

// ==================== 圈子 Feed ====================

/** 圈子 Feed：好友今日饮食（可选 date YYYY-MM-DD） */
/** 圈子 Feed：好友饮食记录（分页，可选 date YYYY-MM-DD） */
export async function communityGetFeed(
  date?: string,
  offset: number = 0,
  limit: number = 20,
  includeComments: boolean = true,
  commentsLimit: number = 5,
  params?: CommunityFeedQueryParams
): Promise<{ list: CommunityFeedItem[]; has_more?: boolean }> {
  let q = `?offset=${offset}&limit=${limit}&include_comments=${includeComments}&comments_limit=${commentsLimit}`
  if (date) {
    q += `&date=${date}`
  }
  if (params?.meal_type) q += `&meal_type=${encodeURIComponent(params.meal_type)}`
  if (params?.diet_goal) q += `&diet_goal=${encodeURIComponent(params.diet_goal)}`
  if (params?.sort_by) q += `&sort_by=${encodeURIComponent(params.sort_by)}`
  if (params?.content_type) q += `&content_type=${encodeURIComponent(params.content_type)}`
  if (params?.author_scope) q += `&author_scope=${encodeURIComponent(params.author_scope)}`
  if (params?.priority_author_ids?.length) {
    q += `&priority_author_ids=${encodeURIComponent(params.priority_author_ids.join(','))}`
  }
  if (params?.author_id) q += `&author_id=${encodeURIComponent(params.author_id)}`
  const response = await authenticatedRequest(`/api/community/feed${q}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取动态失败')
  return response.data as { list: CommunityFeedItem[]; has_more?: boolean }
}

/** 本周打卡排行榜（自己 + 好友，按饮食记录条数） */
export async function communityGetCheckinLeaderboard(): Promise<{
  week_start: string
  week_end: string
  list: CheckinLeaderboardItem[]
}> {
  const response = await authenticatedRequest('/api/community/checkin-leaderboard', { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取排行榜失败')
  return response.data as {
    week_start: string
    week_end: string
    list: CheckinLeaderboardItem[]
  }
}

/** 公共 Feed：无需登录，返回公开用户的饮食记录 */
export async function communityGetPublicFeed(
  offset: number = 0,
  limit: number = 20,
  includeComments: boolean = true,
  commentsLimit: number = 5,
  params?: Pick<CommunityFeedQueryParams, 'meal_type' | 'diet_goal' | 'sort_by' | 'content_type' | 'author_id'>
): Promise<{ list: CommunityFeedItem[]; has_more?: boolean }> {
  let q = `?offset=${offset}&limit=${limit}&include_comments=${includeComments}&comments_limit=${commentsLimit}`
  if (params?.meal_type) q += `&meal_type=${encodeURIComponent(params.meal_type)}`
  if (params?.diet_goal) q += `&diet_goal=${encodeURIComponent(params.diet_goal)}`
  if (params?.sort_by) q += `&sort_by=${encodeURIComponent(params.sort_by)}`
  if (params?.content_type) q += `&content_type=${encodeURIComponent(params.content_type)}`
  if (params?.author_id) q += `&author_id=${encodeURIComponent(params.author_id)}`
  const token = getAccessToken()
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/community/public-feed${q}`,
    method: 'GET',
    header: withNgrokBypassHeaders(token ? { Authorization: `Bearer ${token}` } : undefined),
    timeout: 10000
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取动态失败')
  return unwrapResponse<{ list: CommunityFeedItem[]; has_more?: boolean }>(response)
}

/** 点赞某条动态 */
function communityFeedTargetPath(targetId: string, targetType: CommunityFeedTargetType = 'food_record'): string {
  return `/api/community/feed-targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`
}

/** 点赞某条动态 */
export async function communityLike(recordId: string, targetType: CommunityFeedTargetType = 'food_record'): Promise<void> {
  const response = await authenticatedRequest(`${communityFeedTargetPath(recordId, targetType)}/like`, { method: 'POST' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '点赞失败')
}

/** 取消点赞 */
export async function communityUnlike(recordId: string, targetType: CommunityFeedTargetType = 'food_record'): Promise<void> {
  const response = await authenticatedRequest(`${communityFeedTargetPath(recordId, targetType)}/like`, { method: 'DELETE' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '取消失败')
}

/** 将自己的动态从圈子中隐藏（不删除饮食记录本身） */
export async function communityHideFeed(recordId: string, targetType: CommunityFeedTargetType = 'food_record'): Promise<void> {
  const response = await authenticatedRequest(`${communityFeedTargetPath(recordId, targetType)}/hide`, { method: 'POST' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '操作失败')
}

/** 某条动态的评论列表 */
export async function communityGetComments(recordId: string, targetType: CommunityFeedTargetType = 'food_record'): Promise<{ list: FeedCommentItem[] }> {
  const response = await authenticatedRequest(`${communityFeedTargetPath(recordId, targetType)}/comments`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取评论失败')
  return response.data as { list: FeedCommentItem[] }
}

/** 获取单条动态的互动上下文（用于互动消息定位） */
export async function communityGetFeedContext(
  recordId: string,
  commentsLimit: number = 5,
  targetType: CommunityFeedTargetType = 'food_record'
): Promise<{ item: CommunityFeedItem }> {
  const response = await authenticatedRequest(
    `${communityFeedTargetPath(recordId, targetType)}/context?comments_limit=${Math.max(0, commentsLimit)}`,
    { method: 'GET' }
  )
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取动态上下文失败')
  return response.data as { item: CommunityFeedItem }
}

/**
 * 发表评论（直接发布）
 */
export async function communityPostComment(
  recordId: string,
  content: string,
  options?: { parent_comment_id?: string; reply_to_user_id?: string },
  targetType: CommunityFeedTargetType = 'food_record'
): Promise<{ comment: FeedCommentItem }> {
  const response = await authenticatedRequest(`${communityFeedTargetPath(recordId, targetType)}/comments`, {
    method: 'POST',
    data: {
      content: content.trim(),
      parent_comment_id: options?.parent_comment_id,
      reply_to_user_id: options?.reply_to_user_id
    }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '发表失败')
  return response.data as { comment: FeedCommentItem }
}

/** 删除圈子评论（本人或动态作者；子回复一并删除） */
export async function communityDeleteComment(
  recordId: string,
  commentId: string,
  targetType: CommunityFeedTargetType = 'food_record'
): Promise<{ deleted: number }> {
  const response = await authenticatedRequest(
    `${communityFeedTargetPath(recordId, targetType)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' }
  )
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '删除失败')
  return response.data as { deleted: number }
}

/** 获取我最近的圈子评论审核任务 */
export async function communityGetCommentTasks(limit: number = 50): Promise<{ list: CommunityCommentTask[] }> {
  const response = await authenticatedRequest(`/api/community/comment-tasks?limit=${limit}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取评论状态失败')
  return response.data as { list: CommunityCommentTask[] }
}

/** 获取圈子互动通知 */
export async function communityGetNotifications(limit: number = 20, type?: string, offset?: number): Promise<{ list: FeedInteractionNotification[]; unread_count: number; has_more: boolean }> {
  const q = new URLSearchParams()
  q.set('limit', String(limit))
  if (type) q.set('type', type)
  if (offset !== undefined) q.set('offset', String(offset))
  const response = await authenticatedRequest(`/api/community/notifications?${q.toString()}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取互动消息失败')
  return response.data as { list: FeedInteractionNotification[]; unread_count: number; has_more: boolean }
}

/** 标记圈子互动通知已读 */
export async function communityMarkNotificationsRead(notificationIds?: string[]): Promise<{ updated: number; unread_count: number }> {
  const response = await authenticatedRequest('/api/community/notifications/read', {
    method: 'POST',
    data: { notification_ids: notificationIds }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '更新互动消息失败')
  return response.data as { updated: number; unread_count: number }
}

/** 上传圈子自定义动态图片 */
export async function uploadCirclePostImage(localPath: string): Promise<{ image_url: string }> {
  const token = getAccessToken()
  const response = await Taro.uploadFile({
    url: `${API_BASE_URL}/api/community/posts/upload-image`,
    filePath: localPath,
    name: 'file',
    header: {
      Authorization: `Bearer ${token}`,
      ...withNgrokBypassHeaders()
    },
    timeout: 30000
  })
  if (response.statusCode !== 200) {
    throw new Error((JSON.parse(response.data || '{}') as any)?.detail || '上传失败')
  }
  return unwrapResponse<{ image_url: string }>(response as any)
}

export interface CreateCirclePostInput {
  title: string
  body: string
  imageUrls: string[]
  nutrition?: CirclePostNutritionInput
}

export interface UpdateCirclePostInput {
  title: string
  body: string
  imageUrls: string[]
  nutrition?: CirclePostNutritionInput
}

/** 创建圈子自定义图文动态 */
export async function createCirclePost(input: CreateCirclePostInput): Promise<{ id: string }> {
  const response = await authenticatedRequest('/api/community/posts', {
    method: 'POST',
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      image_urls: input.imageUrls || [],
      ...(input.nutrition ? buildCirclePostNutritionPayload(input.nutrition) : {})
    }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '发布失败')
  return response.data as { id: string }
}

/** 更新圈子自定义图文动态 */
export async function updateCirclePost(
  postId: string,
  input: UpdateCirclePostInput
): Promise<{ id: string }> {
  const response = await authenticatedRequest(`/api/community/posts/${encodeURIComponent(postId)}`, {
    method: 'PUT',
    data: {
      title: input.title.trim(),
      body: input.body.trim(),
      image_urls: input.imageUrls || [],
      ...(input.nutrition ? buildCirclePostNutritionPayload(input.nutrition) : {})
    }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '保存失败')
  return response.data as { id: string }
}

function buildCirclePostNutritionPayload(nutrition: CirclePostNutritionInput): Record<string, number | null> {
  const mapping: { [K in keyof CirclePostNutritionInput]: string } = {
    calories: 'total_calories',
    protein: 'total_protein',
    carbs: 'total_carbs',
    fat: 'total_fat',
    fiber: 'fiber',
    sugar: 'sugar',
    sodium_mg: 'sodium_mg',
    total_weight_grams: 'total_weight_grams'
  }
  const payload: Record<string, number | null> = {}
  Object.entries(mapping).forEach(([inputKey, backendKey]) => {
    const value = nutrition[inputKey as keyof CirclePostNutritionInput]
    payload[backendKey] = typeof value === 'number' && Number.isFinite(value) ? value : null
  })
  return payload
}

/** 删除圈子自定义图文动态 */
export async function deleteCirclePost(postId: string): Promise<{ message: string }> {
  const response = await authenticatedRequest(`/api/community/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '删除失败')
  return response.data as { message: string }
}

export type FeedReportReason = 'spam' | 'porn' | 'illegal' | 'abuse' | 'other'

export const FEED_REPORT_REASON_OPTIONS: { value: FeedReportReason; label: string }[] = [
  { value: 'spam', label: '垃圾广告' },
  { value: 'porn', label: '色情低俗' },
  { value: 'illegal', label: '违法违规' },
  { value: 'abuse', label: '人身攻击' },
  { value: 'other', label: '其他' }
]

export interface SubmitFeedReportInput {
  reason: FeedReportReason
  extra_content?: string
}

/** 举报圈子动态 */
export async function submitFeedReport(
  targetType: CommunityFeedTargetType,
  targetId: string,
  input: SubmitFeedReportInput
): Promise<{ id: string; status: string }> {
  const response = await authenticatedRequest(`/api/community/feed-targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/report`, {
    method: 'POST',
    data: {
      reason: input.reason,
      extra_content: (input.extra_content || '').trim()
    }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '举报失败')
  return response.data as { id: string; status: string }
}

/** 更新运动记录 */
export async function updateExerciseLog(
  logId: string,
  data: { exercise_desc?: string; date?: string; image_url?: string; calories_burned?: number }
): Promise<{ message: string }> {
  const response = await authenticatedRequest(`/api/exercise-logs/${encodeURIComponent(logId)}`, {
    method: 'PUT',
    data,
    timeout: 10000
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '更新失败')
  return response.data as { message: string }
}

// ---------- 公共食物库 ----------

export type PublicFoodLibraryType = 'common' | 'campus'

/** 公共食物库条目 */
export interface PublicFoodLibraryItem {
  id: string
  user_id: string
  source_record_id?: string | null
  analysis_task_id?: string | null
  analysis_status?: string | null
  analysis_error?: string | null
  image_path?: string | null
  /** 多图 URL 列表，展示时优先于 image_path */
  image_paths?: string[] | null
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  items: Array<{
    name: string
    weight?: number
    nutrients?: Nutrients
  }>
  description?: string | null
  insight?: string | null
  food_name?: string | null
  merchant_name?: string | null
  merchant_address?: string | null
  taste_rating?: number | null
  suitable_for_fat_loss: boolean
  user_tags: string[]
  user_notes?: string | null
  latitude?: number | null
  longitude?: number | null
  province?: string | null
  city?: string | null
  district?: string | null
  detail_address?: string | null
  status: string
  /** 条目类型：普通公共食物库或校园食堂 */
  type: PublicFoodLibraryType
  like_count: number
  comment_count: number
  avg_rating: number
  published_at?: string | null
  created_at: string
  updated_at: string
  /** 推荐理由 */
  recommend_reason?: string
  /** 当前用户是否已点赞 */
  liked?: boolean
  /** 收藏数 */
  collection_count?: number
  /** 当前用户是否已收藏 */
  collected?: boolean
  /** 作者信息 */
  author?: { id: string; nickname: string; avatar: string }
  /** 是否为校园食堂菜品 */
  is_campus_food?: boolean
  /** 学校 ID */
  school_id?: string | null
  /** 校区 ID */
  campus_id?: string | null
  /** 食堂 ID */
  canteen_id?: string | null
  /** 窗口 ID */
  window_id?: string | null
  /** 学校名称 */
  school_name?: string | null
  /** 校区 */
  campus_name?: string | null
  /** 食堂名称 */
  canteen_name?: string | null
  /** 楼层 */
  floor?: string | null
  /** 窗口名称 */
  window_name?: string | null
  /** 价格 */
  price?: number | null
  /** 价格类型: fixed/weight/range/combo/unknown */
  price_type?: string | null
  /** 价格下限（区间价） */
  price_min?: number | null
  /** 价格上限（区间价） */
  price_max?: number | null
  /** 价格单位 */
  price_unit?: string | null
  /** 价格采集日期 */
  price_collected_at?: string | null
  /** 份量描述 */
  portion_description?: string | null
  /** 校园位置展示文案 */
  campus_location_text?: string | null
  /** 学校校徽图片 URL */
  school_logo_url?: string | null
  /** 每元蛋白质（g/元） */
  protein_per_yuan?: number
  /** 每 100 kcal 价格（元/100kcal） */
  price_per_100_kcal?: number
}

/** 校园详情页性价比指标 */
export interface CampusFoodMetric {
  protein_per_yuan?: number
  price_per_100_kcal?: number
}

/** 校园详情页相关圈子动态摘要 */
export interface CampusRelatedFeedItem {
  id: string
  food_name: string
  image_path?: string | null
  image_paths?: string[] | null
  school_name?: string | null
  canteen_name?: string | null
  campus_location?: string | null
  school_logo_url?: string | null
  total_calories: number
  total_protein: number
  price?: number | null
  price_unit?: string | null
  like_count: number
  comment_count: number
  collection_count: number
  published_at?: string | null
}

/** 校园菜品详情聚合响应 */
export interface CampusFoodDetailResponse {
  item: PublicFoodLibraryItem
  metrics: CampusFoodMetric
  similar_items: PublicFoodLibraryItem[]
  related_feeds: CampusRelatedFeedItem[]
}

/** 公共食物库评论 */
export interface PublicFoodLibraryComment {
  id: string
  user_id: string
  library_item_id: string
  parent_comment_id?: string | null
  reply_to_user_id?: string | null
  content: string
  rating?: number | null
  created_at: string
  nickname: string
  avatar: string
  reply_to_nickname?: string
  replies?: PublicFoodLibraryComment[]
  _is_temp?: boolean  // 标记为临时评论（未通过审核）
}

/** 创建公共食物库条目请求 */
export interface CreatePublicFoodLibraryRequest {
  image_path?: string
  /** 多图 URL 列表，优先于 image_path */
  image_paths?: string[]
  source_record_id?: string
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  items?: Array<{ name: string; weight?: number; nutrients?: Nutrients }>
  description?: string
  insight?: string
  food_name?: string
  merchant_name?: string
  merchant_address?: string
  taste_rating?: number
  suitable_for_fat_loss?: boolean
  user_tags?: string[]
  user_notes?: string
  latitude?: number
  longitude?: number
  province?: string
  city?: string
  district?: string
  detail_address?: string
  /** 条目类型：普通公共食物库或校园食堂 */
  type?: PublicFoodLibraryType
  /** 是否为校园食堂菜品 */
  is_campus_food?: boolean
  school_id?: string
  campus_id?: string
  canteen_id?: string
  window_id?: string
  school_name?: string
  campus_name?: string
  canteen_name?: string
  floor?: string
  window_name?: string
  price?: number
  price_type?: string
  price_min?: number
  price_max?: number
  price_unit?: string
  price_collected_at?: string
  portion_description?: string
}

/** 公共食物库列表查询参数 */
export interface PublicFoodLibraryListParams {
  city?: string
  suitable_for_fat_loss?: boolean
  merchant_name?: string
  min_calories?: number
  max_calories?: number
  sort_by?: 'latest' | 'hot' | 'rating' | 'balanced' | 'high_protein' | 'low_calorie' | 'recommended' | 'value'
  limit?: number
  offset?: number
  type?: PublicFoodLibraryType
  is_campus_food?: boolean
  school_id?: string
  campus_id?: string
  canteen_id?: string
  window_id?: string
  school_name?: string
  canteen_name?: string
  is_campus_highlight?: boolean
}

/** 创建公共食物库条目（上传/分享） */
export async function createPublicFoodLibraryItem(
  data: CreatePublicFoodLibraryRequest
): Promise<{ id: string; message: string }> {
  const response = await authenticatedRequest('/api/public-food-library', {
    method: 'POST',
    data,
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '分享失败')
  }
  return response.data as { id: string; message: string }
}

/** 获取公共食物库列表 */
export async function getPublicFoodLibraryList(
  params?: PublicFoodLibraryListParams
): Promise<{ list: PublicFoodLibraryItem[] }> {
  const q = new URLSearchParams()
  if (params?.city) q.set('city', params.city)
  if (params?.suitable_for_fat_loss !== undefined) q.set('suitable_for_fat_loss', String(params.suitable_for_fat_loss))
  if (params?.merchant_name) q.set('merchant_name', params.merchant_name)
  if (params?.min_calories !== undefined) q.set('min_calories', String(params.min_calories))
  if (params?.max_calories !== undefined) q.set('max_calories', String(params.max_calories))
  if (params?.sort_by) q.set('sort_by', params.sort_by)
  if (params?.limit !== undefined) q.set('limit', String(params.limit))
  if (params?.offset !== undefined) q.set('offset', String(params.offset))
  if (params?.type) q.set('type', params.type)
  if (params?.is_campus_food !== undefined) q.set('is_campus_food', String(params.is_campus_food))
  if (params?.school_id) q.set('school_id', params.school_id)
  if (params?.campus_id) q.set('campus_id', params.campus_id)
  if (params?.canteen_id) q.set('canteen_id', params.canteen_id)
  if (params?.window_id) q.set('window_id', params.window_id)
  if (params?.school_name) q.set('school_name', params.school_name)
  if (params?.canteen_name) q.set('canteen_name', params.canteen_name)
  if (params?.is_campus_highlight !== undefined) q.set('is_campus_highlight', String(params.is_campus_highlight))
  const qs = q.toString()
  const url = qs ? `/api/public-food-library?${qs}` : '/api/public-food-library'
  const response = await authenticatedRequest(url, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取列表失败')
  }
  return response.data as { list: PublicFoodLibraryItem[] }
}

/** 获取当前用户上传/分享的公共食物库条目 */
export async function getMyPublicFoodLibrary(): Promise<{ list: PublicFoodLibraryItem[] }> {
  const response = await authenticatedRequest('/api/public-food-library/mine', { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取失败')
  }
  return response.data as { list: PublicFoodLibraryItem[] }
}

/** 获取当前用户收藏的公共食物库条目（收藏夹） */
export async function getPublicFoodLibraryCollections(): Promise<{ list: PublicFoodLibraryItem[] }> {
  const response = await authenticatedRequest('/api/public-food-library/collections', { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取收藏列表失败')
  }
  return response.data as { list: PublicFoodLibraryItem[] }
}

/** 获取公共食物库条目详情 */
export async function getPublicFoodLibraryItem(itemId: string): Promise<PublicFoodLibraryItem> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}`, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取详情失败')
  }
  return response.data as PublicFoodLibraryItem
}

/** 获取校园菜品详情聚合信息 */
export async function getCampusFoodDetail(itemId: string): Promise<CampusFoodDetailResponse> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/campus-detail`, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取校园菜品详情失败')
  }
  return response.data as CampusFoodDetailResponse
}

/** 点赞公共食物库条目 */
export async function likePublicFoodLibraryItem(itemId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/like`, { method: 'POST' })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '点赞失败')
  }
}

/** 取消点赞公共食物库条目 */
export async function unlikePublicFoodLibraryItem(itemId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/like`, { method: 'DELETE' })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '取消失败')
  }
}

/** 收藏公共食物库条目 */
export async function collectPublicFoodLibraryItem(itemId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/collect`, { method: 'POST' })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '收藏失败')
  }
}

/** 取消收藏公共食物库条目 */
export async function uncollectPublicFoodLibraryItem(itemId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/collect`, { method: 'DELETE' })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '取消收藏失败')
  }
}

/** 删除/下架自己上传的公共食物库条目 */
export async function deletePublicFoodLibraryItem(itemId: string): Promise<{ message: string }> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}`, { method: 'DELETE', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '删除失败')
  }
  return response.data as { message: string }
}

/** 更新/编辑自己上传的公共食物库条目 */
export async function updatePublicFoodLibraryItem(
  itemId: string,
  data: Partial<CreatePublicFoodLibraryRequest>
): Promise<{ message: string }> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}`, {
    method: 'PUT',
    data,
    timeout: 10000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '更新失败')
  }
  return response.data as { message: string }
}

/** 获取公共食物库条目的评论列表 */
export async function getPublicFoodLibraryComments(itemId: string): Promise<{ list: PublicFoodLibraryComment[] }> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/comments`, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取评论失败')
  }
  return response.data as { list: PublicFoodLibraryComment[] }
}

/**
 * 发表公共食物库评论（直接发布，可选评分 1-5）
 */
export async function postPublicFoodLibraryComment(
  itemId: string,
  content: string,
  rating?: number,
  options?: {
    parent_comment_id?: string
    reply_to_user_id?: string
  }
): Promise<{ comment: PublicFoodLibraryComment }> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/comments`, {
    method: 'POST',
    data: {
      content: content.trim(),
      ...(rating !== undefined && { rating }),
      ...(options?.parent_comment_id && { parent_comment_id: options.parent_comment_id }),
      ...(options?.reply_to_user_id && { reply_to_user_id: options.reply_to_user_id })
    }
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '发表失败')
  }
  return response.data as { comment: PublicFoodLibraryComment }
}

/** 删除自己发表的公共食物库评论 */
export async function deletePublicFoodLibraryComment(
  itemId: string,
  commentId: string
): Promise<{ message: string }> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/comments/${commentId}`, {
    method: 'DELETE',
    timeout: 10000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '删除评论失败')
  }
  return response.data as { message: string }
}

/** 提交公共食物库反馈 */
export async function submitPublicFoodLibraryFeedback(
  content: string,
  libraryItemId?: string
): Promise<{ id: string; message: string }> {
  const response = await authenticatedRequest('/api/public-food-library/feedback', {
    method: 'POST',
    data: { content: content.trim(), ...(libraryItemId && { library_item_id: libraryItemId }) }
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '反馈提交失败')
  }
  return response.data as { id: string; message: string }
}

// ---------- 用户私人食谱 ----------

/** 私人食谱接口 */
export interface UserRecipe {
  id: string
  user_id: string
  recipe_name: string
  description?: string
  image_path?: string
  items: FoodRecordItemPayload[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  tags?: string[]
  meal_type?: string
  is_favorite: boolean
  use_count: number
  last_used_at?: string
  created_at: string
  updated_at: string
}

/** 创建食谱请求 */
export interface CreateRecipeRequest {
  recipe_name: string
  description?: string
  image_path?: string
  items: FoodRecordItemPayload[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  tags?: string[]
  meal_type?: string
  is_favorite?: boolean
	source_task_id?: string
}

/** 更新食谱请求 */
export interface UpdateRecipeRequest {
  recipe_name?: string
  description?: string
  image_path?: string
  items?: FoodRecordItemPayload[]
  total_calories?: number
  total_protein?: number
  total_carbs?: number
  total_fat?: number
  total_weight_grams?: number
  tags?: string[]
  meal_type?: string
  is_favorite?: boolean
}

/** 创建私人食谱 */
export async function createUserRecipe(data: CreateRecipeRequest): Promise<{ id: string; message: string }> {
  const response = await authenticatedRequest('/api/recipes', {
    method: 'POST',
    data,
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '创建食谱失败')
  }
  return response.data as { id: string; message: string }
}

/** 获取好友数量 */
export async function getFriendCount(): Promise<{ count: number }> {
  const res = await authenticatedRequest('/api/friend/count', { method: 'GET' })
  if (res.statusCode !== 200) {
    throw new Error((res.data as any)?.detail || '获取好友数量失败')
  }
  return res.data as { count: number }
}

/** 获取私人食谱列表 */
export async function getUserRecipes(params?: { meal_type?: string; is_favorite?: boolean }): Promise<{ recipes: UserRecipe[] }> {
  const q = new URLSearchParams()
  if (params?.meal_type) q.set('meal_type', params.meal_type)
  if (params?.is_favorite !== undefined) q.set('is_favorite', String(params.is_favorite))
  const qs = q.toString()
  const url = qs ? `/api/recipes?${qs}` : '/api/recipes'
  const response = await authenticatedRequest(url, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取食谱列表失败')
  }
  return response.data as { recipes: UserRecipe[] }
}

/** 获取收藏/食谱数量 */
export async function getFavoriteCount(): Promise<{ count: number }> {
  const res = await authenticatedRequest('/api/recipes/count?is_favorite=true', { method: 'GET' })
  if (res.statusCode !== 200) {
    throw new Error((res.data as any)?.detail || '获取收藏数量失败')
  }
  return res.data as { count: number }
}

/** 获取其他用户公开资料 */
export async function getPublicUserProfile(userId: string): Promise<{
  id: string
  nickname: string
  avatar: string
  cover_image?: string
  motto?: string
  record_days: number
  create_time?: string
	public_favorite_recipes: boolean
}> {
  const response = await authenticatedRequest(`/api/user/${userId}/public-profile`, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取用户资料失败')
  }
  const p = (response.data || {}) as any
  return {
    id: p.id || p.ID || '',
    nickname: p.nickname || p.Nickname || '',
    avatar: p.avatar || p.Avatar || '',
    cover_image: p.cover_image || p.CoverImage,
    motto: p.motto || p.Motto,
    record_days: p.record_days ?? p.RecordDays ?? 0,
    create_time: p.create_time || p.CreateTime,
	public_favorite_recipes: p.public_favorite_recipes ?? p.PublicFavoriteRecipes ?? true,
  }
}

/** 获取指定用户的公共食物库收藏 */
export async function getUserCollections(userId: string): Promise<{ list: PublicFoodLibraryItem[] }> {
  const response = await authenticatedRequest(`/api/user/${userId}/collections`, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取用户收藏失败')
  }
  return response.data as { list: PublicFoodLibraryItem[] }
}

/** 获取指定用户的食谱收藏 */
export async function getUserFavoriteRecipes(userId: string): Promise<{ recipes: UserRecipe[] }> {
  const response = await authenticatedRequest(`/api/user/${userId}/favorite-recipes`, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取用户食谱收藏失败')
  }
  return response.data as { recipes: UserRecipe[] }
}

/** 获取单个食谱详情 */
export async function getUserRecipe(recipeId: string): Promise<UserRecipe> {
  const response = await authenticatedRequest(`/api/recipes/${recipeId}`, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取食谱失败')
  }
  return response.data as UserRecipe
}

/** 更新食谱 */
export async function updateUserRecipe(recipeId: string, data: UpdateRecipeRequest): Promise<{ message: string; recipe: UserRecipe }> {
  const response = await authenticatedRequest(`/api/recipes/${recipeId}`, {
    method: 'PUT',
    data,
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '更新食谱失败')
  }
  return response.data as { message: string; recipe: UserRecipe }
}

/** 删除食谱 */
export async function deleteUserRecipe(recipeId: string): Promise<{ message: string }> {
  const response = await authenticatedRequest(`/api/recipes/${recipeId}`, { method: 'DELETE', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '删除食谱失败')
  }
  return response.data as { message: string }
}

/** 使用食谱（一键记录，可指定餐次） */
export async function applyUserRecipe(recipeId: string, mealType?: string, entryType?: FoodRecordEntryType): Promise<{ message: string; record_id: string }> {
  const response = await authenticatedRequest(`/api/recipes/${recipeId}/use`, {
    method: 'POST',
    data: { meal_type: mealType, entry_type: entryType },
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '使用食谱失败')
  }
  return response.data as { message: string; record_id: string }
}

// ===== 运动记录 API =====

/** 运动记录项 */
export interface ExerciseLogItem {
  id: string
  exercise_desc: string
  exercise_type?: string | null
  image_url?: string | null
  calories_burned: number
  recorded_on?: string | null
  recorded_at?: string | null
  created_at?: string | null
  /** 模型估算时的思考过程（需库表含 ai_reasoning 列） */
  ai_reasoning?: string | null
  /** 长文本运动解析后的分项运动列表 */
  exercise_items?: ExerciseActivityItem[] | null
}

/** 获取运动记录列表 */
export async function getExerciseLogs(params?: { date?: string; start_date?: string; end_date?: string }): Promise<{ logs: ExerciseLogItem[]; total_calories: number; count: number }> {
  const queryParams = new URLSearchParams()
  if (params?.date) queryParams.set('date', mapCalendarDateToApi(params.date) ?? params.date)
  if (params?.start_date) queryParams.set('start_date', params.start_date)
  if (params?.end_date) queryParams.set('end_date', params.end_date)
  // 禁用微信小程序 GET 请求缓存
  queryParams.set('_t', String(Date.now()))

  const url = `/api/exercise-logs${queryParams.toString() ? '?' + queryParams.toString() : ''}`
  const response = await authenticatedRequest(url, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取运动记录失败')
  }
  return response.data as { logs: ExerciseLogItem[]; total_calories: number; count: number }
}

/** 单日运动消耗汇总（千卡），与 `GET /api/home/dashboard` 的 `exerciseBurnedKcal` 同源 */
export async function getExerciseDailyCalories(date?: string): Promise<{
  date: string
  total_calories_burned: number
}> {
  const apiDate = mapCalendarDateToApi(date)
  const url =
    apiDate != null
      ? `/api/exercise-calories/daily?date=${encodeURIComponent(apiDate)}`
      : '/api/exercise-calories/daily'
  const response = await authenticatedRequest(url, { method: 'GET', timeout: 10000 })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取运动消耗失败')
  }
  return response.data as { date: string; total_calories_burned: number }
}

/** 将 FastAPI 422 等返回的 detail 转成可读字符串（避免 [object Object]） */
function formatFastApiErrorDetail(data: unknown): string {
  const detail = (data as { detail?: unknown })?.detail
  if (detail == null) return '保存运动记录失败'
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((e: { msg?: string; loc?: unknown }) => {
        const loc = e?.loc != null ? JSON.stringify(e.loc) : ''
        const msg = typeof e?.msg === 'string' ? e.msg : JSON.stringify(e)
        return loc ? `${loc}: ${msg}` : msg
      })
      .join('; ')
  }
  if (typeof detail === 'object') return JSON.stringify(detail)
  return String(detail)
}

/** 运动异步任务完成后 result 结构（与食物分析共用 analysis_tasks） */
export interface ExerciseTaskResultPayload {
  exercise_log: ExerciseLogItem
  estimated_calories: number
  ai_response?: string | null
  /** 与 calories 配套的思考过程（中文） */
  reasoning?: string | null
  /** 估算时使用的用户画像快照 */
  profile_snapshot?: Record<string, any> | null
  today_total: number
  /** AI 自动识别的运动类型（如跑步、游泳等） */
  exercise_type?: string | null
}

/** 提交运动分析任务（后台 Worker 调用大模型并落库；返回 task_id，需轮询 getAnalyzeTask） */
export async function createExerciseLog(data: {
  exercise_desc: string
  image_url?: string
  date?: string
}): Promise<{ task_id: string; message: string }> {
  const trimmed = data.exercise_desc.trim()
  const parts: string[] = [`exercise_desc=${encodeURIComponent(trimmed)}`]
  if (data.image_url) {
    parts.push(`image_url=${encodeURIComponent(data.image_url)}`)
  }
  if (data.date) {
    parts.push(`date=${encodeURIComponent(data.date)}`)
  }
  const response = await authenticatedRequest('/api/exercise-logs', {
    method: 'POST',
    header: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: parts.join('&'),
    timeout: 30000
  })
  if (response.statusCode !== 200) {
    throw new Error(formatFastApiErrorDetail(response.data))
  }
  return response.data as { task_id: string; message: string }
}

/** 删除运动记录 */
export async function deleteExerciseLog(logId: string): Promise<{ message: string }> {
  const response = await authenticatedRequest(`/api/exercise-logs/${logId}`, {
    method: 'DELETE',
    timeout: 10000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '删除运动记录失败')
  }
  return response.data as { message: string }
}

/** AI 估算运动卡路里 */
export async function estimateExerciseCalories(exerciseDesc: string): Promise<{
  estimated_calories: number
  exercise_desc: string
  ai_response?: string
  reasoning?: string
  profile_snapshot?: Record<string, any>
}> {
  const response = await authenticatedRequest('/api/exercise-logs/estimate-calories', {
    method: 'POST',
    data: { exercise_desc: exerciseDesc },
    timeout: 35000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '估算卡路里失败')
  }
  return response.data as {
    estimated_calories: number
    exercise_desc: string
    ai_response?: string
    reasoning?: string
    profile_snapshot?: Record<string, any>
  }
}

/** 学校搜索 */
export interface SchoolItem {
  id: string
  name: string
  province?: string
  city?: string
  logo_url?: string
}

export interface SchoolCampusItem {
  id: string
  school_id: string
  name: string
  aliases?: string[]
  address?: string
  campus_type?: string
  status?: string
  sort_order?: number
}

export interface SchoolCanteenItem {
  id: string
  school_id: string
  campus_id?: string | null
  campus_name?: string
  name: string
  aliases?: string[]
  location_text?: string
  building_or_floor?: string
  service_type?: string
  audience?: string
  meal_periods?: string[]
  opening_hours_raw?: string
  status?: string
  sort_order?: number
}

export interface CanteenWindowItem {
  id: string
  school_id: string
  campus_id?: string | null
  canteen_id: string
  name: string
  aliases?: string[]
  floor?: string
  status?: string
  sort_order?: number
}

export interface CampusCanteenApplicationRequest {
  school_id: string
  campus_id?: string
  requested_campus_name?: string
  requested_canteen_name: string
  location_text?: string
  evidence_url?: string
  applicant_note?: string
}

export async function searchSchools(keyword: string, province?: string, limit = 20): Promise<SchoolItem[]> {
  const q = new URLSearchParams()
  if (keyword) q.set('keyword', keyword)
  if (province) q.set('province', province)
  q.set('limit', String(limit))
  const response = await authenticatedRequest(`/api/schools?${q.toString()}`, {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '搜索学校失败')
  }
  return unwrapResponse<SchoolItem[]>(response) || []
}

export async function getSchoolCampuses(schoolId: string): Promise<SchoolCampusItem[]> {
  const response = await authenticatedRequest(`/api/schools/${encodeURIComponent(schoolId)}/campuses`, {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '获取校区失败')
  }
  return unwrapResponse<SchoolCampusItem[]>(response) || []
}

export async function getSchoolCanteens(
  schoolId: string,
  params?: { campus_id?: string }
): Promise<SchoolCanteenItem[]> {
  const q = new URLSearchParams()
  if (params?.campus_id) q.set('campus_id', params.campus_id)
  const qs = q.toString()
  const response = await authenticatedRequest(`/api/schools/${encodeURIComponent(schoolId)}/canteens${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '获取食堂失败')
  }
  return unwrapResponse<SchoolCanteenItem[]>(response) || []
}

export async function getCampusCanteens(campusId: string): Promise<SchoolCanteenItem[]> {
  const response = await authenticatedRequest(`/api/school-campuses/${encodeURIComponent(campusId)}/canteens`, {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '获取食堂失败')
  }
  return unwrapResponse<SchoolCanteenItem[]>(response) || []
}

export async function getCanteenWindows(canteenId: string): Promise<CanteenWindowItem[]> {
  const response = await authenticatedRequest(`/api/school-canteens/${encodeURIComponent(canteenId)}/windows`, {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '获取窗口失败')
  }
  return unwrapResponse<CanteenWindowItem[]>(response) || []
}

export async function createSchoolCanteenApplication(
  data: CampusCanteenApplicationRequest
): Promise<{ id: string; message: string }> {
  const response = await authenticatedRequest('/api/school-canteen-applications', {
    method: 'POST',
    data,
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || (response.data as any)?.message || '提交食堂申请失败')
  }
  return response.data as { id: string; message: string }
}

/** 获取有学校的省份列表 */
export async function getSchoolProvinces(): Promise<string[]> {
  const response = await authenticatedRequest('/api/schools/provinces', {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '获取省份列表失败')
  }
  return unwrapResponse<string[]>(response) || []
}

/** 根据 IP 获取当前地理位置 */
export interface LocationInfo {
  country: string
  province: string
  city: string
}

export async function getUserLocation(): Promise<LocationInfo> {
  const response = await authenticatedRequest('/api/location', {
    method: 'GET',
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '获取定位失败')
  }
  return unwrapResponse<LocationInfo>(response) || { country: '', province: '', city: '' }
}


export type FeedbackCategory = 'bug' | 'suggestion' | 'experience' | 'other'
export type FeedbackSource = 'app' | 'campus_location' | 'campus_food' | 'food_library'

export const FEEDBACK_MAX_IMAGES = 4

export interface SubmitFeedbackRequest {
  category: FeedbackCategory
  source?: FeedbackSource
  content: string
  contact?: string
  attachRecentRequests?: boolean
  imageUrls?: string[]
  extra?: Record<string, unknown>
}

export interface SubmitStructuredFeedbackRequest {
  source: FeedbackSource
  content: string
  contact?: string
  attachRecentRequests?: boolean
  imageUrls?: string[]
  extra?: Record<string, unknown>
}

export interface SubmitFeedbackResponse {
  id: string
  message: string
}

function getClientInfo(includeDiagnostics = false): Record<string, unknown> {
  try {
    const accountInfo = Taro.getAccountInfoSync?.()
    const systemInfo = Taro.getSystemInfoSync?.()
    const base: Record<string, unknown> = {
      app_version: readInjectedString(() => __APP_VERSION__, ''),
      env_version: accountInfo?.miniProgram?.envVersion,
      platform: systemInfo?.platform,
      system: systemInfo?.system,
      model: systemInfo?.model,
      SDKVersion: systemInfo?.SDKVersion,
    }
    if (includeDiagnostics) {
      base.console_logs = getRecentConsoleLogs()
    }
    return base
  } catch {
    return {
      app_version: readInjectedString(() => __APP_VERSION__, ''),
      ...(includeDiagnostics ? { console_logs: getRecentConsoleLogs() } : {}),
    }
  }
}

export async function uploadFeedbackImage(localPath: string): Promise<{ imageUrl: string }> {
  const filePath = (localPath || '').trim()
  if (!filePath) {
    throw new Error('图片路径为空')
  }

  const token = getAccessToken()
  const response = await new Promise<any>((resolve, reject) => {
    Taro.uploadFile({
      url: `${API_BASE_URL}/api/feedback/upload-image`,
      filePath,
      name: 'file',
      header: withNgrokBypassHeaders({
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }),
      success: resolve,
      fail: reject,
    })
  })

  const parsedData = parseUploadAnalyzeResponseData(response?.data)
  const payload = unwrapUploadAnalyzePayload(parsedData)
  if (response?.statusCode !== 200) {
    throwHttpErrorWithStatus(
      Number(response?.statusCode || 0),
      parsedData,
      formatUploadAnalyzeHttpError(Number(response?.statusCode || 0), parsedData),
      response?.header as Record<string, any> | undefined
    )
  }

  const imageUrl = String(payload?.imageUrl || payload?.image_url || payload?.url || '').trim()
  if (!imageUrl) {
    throw new Error('上传图片失败：服务端未返回图片地址')
  }
  return { imageUrl }
}

export async function submitFeedback(input: SubmitFeedbackRequest): Promise<SubmitFeedbackResponse> {
  const content = input.content.trim()
  if (!content) {
    throw new Error('请填写反馈内容')
  }
  const imageUrls = (input.imageUrls || []).map((url) => url.trim()).filter(Boolean).slice(0, FEEDBACK_MAX_IMAGES)
  const response = await authenticatedRequest('/api/feedback', {
    method: 'POST',
    data: {
      category: input.category,
      source: input.source || 'app',
      content,
      contact: input.contact?.trim() || undefined,
      page_path: getCurrentPagePath(),
      app_version: readInjectedString(() => __APP_VERSION__, ''),
      client_info: getClientInfo(input.attachRecentRequests !== false),
      recent_requests: input.attachRecentRequests === false ? [] : getRecentRequestTraces(),
      image_urls: imageUrls,
      extra: input.extra || {},
    },
    timeout: 10000,
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.message || '提交反馈失败')
  }
  return response.data as SubmitFeedbackResponse
}

export async function submitStructuredFeedback(input: SubmitStructuredFeedbackRequest): Promise<SubmitFeedbackResponse> {
  return submitFeedback({
    category: 'other',
    ...input,
  })
}
