import Taro from '@tarojs/taro'

import { extraPkgUrl } from './subpackage-extra'

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

// 使用构建时注入的 API 基础 URL
// config/index.ts 会根据 NODE_ENV 和 TARO_APP_API_BASE_URL 环境变量正确设置
export const API_BASE_URL = readInjectedString(
  () => __API_BASE_URL__,
  'https://healthymax.cn'
)
export const EXPIRY_SUBSCRIBE_TEMPLATE_ID = readInjectedString(
  () => __EXPIRY_SUBSCRIBE_TEMPLATE_ID__,
  ''
)

// 仅开发构建打印，避免真机/生产包无意义日志（且减少控制台副作用）
if (process.env.NODE_ENV !== 'production') {
  console.log('[API] 构建时 API_BASE_URL:', API_BASE_URL)
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
export type ExecutionMode = 'standard' | 'strict'
export type AnalyzeRecognitionOutcome = 'ok' | 'soft_reject' | 'hard_reject'
export type AllowedFoodCategory = 'carb' | 'lean_protein' | 'unknown'
export type PrecisionSourceType = 'image' | 'text'
export type PrecisionStatus = 'needs_user_input' | 'needs_retake' | 'estimating' | 'done'
export type PrecisionSplitStrategy = 'single_item' | 'multi_item_parallel' | 'retake_required' | 'user_annotation_required'

export interface PrecisionReferenceDimensions {
  length?: number
  width?: number
  height?: number
}

export interface PrecisionReferenceObjectInput {
  reference_type: 'preset' | 'custom'
  reference_name: string
  dimensions_mm?: PrecisionReferenceDimensions
  placement_note?: string
  applies_to_items?: string[]
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
  user_goal?: UserGoal
  diet_goal?: DietGoal
  activity_timing?: ActivityTiming
  remaining_calories?: number
  meal_type?: MealType
  timezone_offset_minutes?: number
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
}


// 食物项接口
export interface FoodItem {
  itemId?: number
  name: string
  estimatedWeightGrams: number
  originalWeightGrams: number
  nutrients: Nutrients
}

// 分析响应接口（含专业营养分析）
export interface AnalyzeResponse {
  description: string
  insight: string
  items: FoodItem[]
  pfc_ratio_comment?: string
  absorption_notes?: string
  context_advice?: string
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
}

// ---------- 双模型对比分析接口 ----------

/** 单个模型的分析结果 */
export interface ModelAnalyzeResult {
  model_name: string
  success: boolean
  error?: string
  description?: string
  insight?: string
  items: FoodItem[]
  pfc_ratio_comment?: string
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
  qwen_result: ModelAnalyzeResult
  gemini_result: ModelAnalyzeResult
}

/** 确认记录时提交的单条食物项（含调节后的 weight/ratio/intake） */
export interface FoodRecordItemPayload {
  name: string
  weight: number
  ratio: number
  intake: number
  nutrients: Nutrients
  manual_source?: 'public_library' | 'nutrition_library'
  manual_source_id?: string
  manual_source_title?: string
  manual_portion_label?: string
}

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
  /** 来源识别任务 ID（从分析历史保存而来时传入） */
  source_task_id?: string
}

/** 单条偏差样本（标记样本接口请求项） */
export interface CriticalSamplePayload {
  image_path?: string
  food_name: string
  ai_weight: number
  user_weight: number
  deviation_percent: number
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
  items: Array<{
    name: string
    weight: number
    ratio: number
    intake: number
    nutrients: Nutrients
  }>
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
}

/** 首页同一餐次下的单条饮食记录摘要（用于多选跳转） */
export interface HomeMealRecordEntry {
  id: string
  record_time?: string
  total_calories?: number
  /** 分析结果餐食标题（描述首行或首条食物名），同餐多选面板与时间与名称同显时会截断 */
  title?: string
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
  /** 该餐次食物描述（由多条记录标题拼接） */
  description?: string
}

/** 解析首页餐食卡片对应的记录 id（兼容 snake_case / camelCase） */
export function resolveHomeMealPrimaryRecordId(meal: HomeMealItem | Record<string, unknown>): string | null {
  const m = meal as Record<string, unknown>
  const candidates = [m.primary_record_id, m.primaryRecordId]
  for (const v of candidates) {
    if (v != null && String(v).trim() !== '') {
      return String(v)
    }
  }
  return null
}

function normalizeHomeMealItem(raw: unknown): HomeMealItem {
  const row = raw as HomeMealItem
  const entries = Array.isArray(row.meal_record_entries)
    ? row.meal_record_entries.filter((e) => e && String(e.id || '').trim() !== '')
    : []
  return {
    ...row,
    meal_record_entries: entries.length > 0 ? entries : row.meal_record_entries,
    primary_record_id: resolveHomeMealPrimaryRecordId(row as Record<string, unknown>),
  }
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
}

/** 首页仪表盘可编辑目标值 */
export interface DashboardTargets {
  calorie_target: number
  protein_target: number
  carbs_target: number
  fat_target: number
}

/** 更新首页目标的结果：服务端成功或仅写入本机（线上未升级接口时） */
export interface DashboardTargetsUpdateResult {
  targets: DashboardTargets
  /** server：已写入数据库；local：仅本机 storage（需部署后端或检查网络） */
  saveScope: 'server' | 'local'
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
  body_metrics?: BodyMetricsSummary
}

export interface BodyMetricWeightEntry {
  id?: string
  date: string
  value: number
  client_id?: string | null
  recorded_at?: string | null
}

export interface BodyMetricWaterDay {
  date: string
  total: number
  logs: number[]
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
  /** 注册时填写邀请人码，双方各得积分（后端校验） */
  inviteCode?: string
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
  execution_mode?: ExecutionMode | null
  mode_set_by?: string | null
  mode_set_at?: string | null
  mode_reason?: string | null
  mode_commitment_days?: number | null
  mode_switch_count_30d?: number | null
  searchable?: boolean
  public_records?: boolean
}

export interface MembershipPlan {
  code: string
  name: string
  amount: number
  duration_months: number
  description?: string | null
}

export interface MembershipStatus {
  is_pro: boolean
  status: 'inactive' | 'active' | 'expired' | 'cancelled'
  current_plan_code?: string | null
  first_activated_at?: string | null
  current_period_start?: string | null
  expires_at?: string | null
  last_paid_at?: string | null
  daily_limit: number | null
  daily_used: number | null
  daily_remaining: number | null
  /** 积分制：当前余额 */
  points_balance?: number | null
  /** 自己的注册邀请码（分享用） */
  invite_code?: string | null
  /** 每 1 元充值可兑换积分（与后端 POINTS_YUAN_TO_POINTS 一致） */
  points_per_yuan?: number | null
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
  pay_params: {
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
  }
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
}

/** 健康档案中的病史/饮食/过敏等 JSON */
export interface HealthCondition {
  medical_history?: string[]
  diet_preference?: string[]
  allergies?: string[]
  health_notes?: string
  report_extract?: ReportExtract | null
  [key: string]: unknown
}

/** 健康档案（GET 返回） */
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
  gender?: string
  birthday?: string
  height?: number
  weight?: number
  activity_level?: string
  medical_history?: string[]
  diet_preference?: string[]
  allergies?: string[]
  health_notes?: string
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
}

// 更新用户信息请求接口
export interface UpdateUserInfoRequest {
  nickname?: string
  avatar?: string
  telephone?: string
  searchable?: boolean
  public_records?: boolean
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

  const targetBytes = 760 * 1024
  const originalSize = await getLocalFileSize(raw)
  if (originalSize !== null && originalSize <= targetBytes) {
    return raw
  }

  const qualities = [72, 60, 48, 36]
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

/** 解析 FastAPI `detail`（字符串或校验错误数组） */
function parseFastApiDetail(data: unknown): string | undefined {
  const obj = normalizeTaroResponseJson(data)
  if (!obj) return undefined
  const d = obj.detail
  if (typeof d === 'string' && d.trim()) return d.trim()
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0] as { msg?: string }
    if (typeof first?.msg === 'string' && first.msg.trim()) return first.msg.trim()
  }
  const m = obj.message
  if (typeof m === 'string' && m.trim()) return m.trim()
  return undefined
}

/** 抛出带 HTTP 状态码的错误，便于页面区分 429 等场景 */
function throwHttpErrorWithStatus(statusCode: number, data: unknown, fallback: string): never {
  const msg = parseFastApiDetail(data) || fallback
  const err = new Error(msg) as Error & { statusCode: number }
  err.statusCode = statusCode
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
  if (response?.statusCode !== 200) {
    throw new Error(formatUploadAnalyzeHttpError(Number(response?.statusCode || 0), parsedData))
  }

  const imageUrl = String(parsedData?.imageUrl || '').trim()
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
    throw new Error(formatUploadAnalyzeHttpError(response.statusCode, response.data))
  }
  return response.data as { imageUrl: string }
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
        modelName: request.modelName || 'qwen-vl-max',
        ...(request.user_goal != null && { user_goal: request.user_goal }),
        ...(request.remaining_calories != null && { remaining_calories: request.remaining_calories }),
        ...(request.meal_type != null && { meal_type: request.meal_type }),
        timezone_offset_minutes: timezoneOffsetMinutes
      },
      timeout: 60000 // 60秒超时
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '分析失败，请重试'
      throw new Error(errorMsg)
    }

    return response.data as AnalyzeResponse
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
        modelName: request.modelName || 'qwen-vl-max',
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
      const errorMsg = (response.data as any)?.detail || '对比分析失败，请重试'
      throw new Error(errorMsg)
    }

    return response.data as CompareAnalyzeResponse
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
    ...(params.remaining_calories != null && { remaining_calories: params.remaining_calories })
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
      const errorMsg = (response.data as any)?.detail || '分析失败，请重试'
      throw new Error(errorMsg)
    }
    return response.data as AnalyzeResponse
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

// ---------- 异步分析任务（提交后 Worker 执行，可稍后在分析历史查看） ----------

export interface AnalyzeTaskSubmitParams {
  image_url: string
  image_urls?: string[]
  meal_type?: MealType
  timezone_offset_minutes?: number
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  additionalContext?: string
  modelName?: string
  is_multi_view?: boolean
  execution_mode?: ExecutionMode
  previousResult?: AnalyzeResponse
  precision_session_id?: string
  reference_objects?: PrecisionReferenceObjectInput[]
  correctionItems?: Array<{
    name: string
    weight: number
    sourceName?: string
    sourceItemId?: number
    nameEdited?: boolean
    weightEdited?: boolean
  }>
}

export interface AnalysisTask {
  id: string
  user_id: string
  task_type: string
  image_url?: string | null  // 图片分析时有值，文字分析时为空
  image_paths?: string[] | null // 多图分析时有值
  text_input?: string | null  // 文字分析时有值，图片分析时为空
  status: 'pending' | 'processing' | 'done' | 'failed' | 'violated'
  payload?: Record<string, unknown>
  result?: AnalyzeResponse
  error_message?: string
  is_violated?: boolean          // AI 审核是否违规
  violation_reason?: string | null // 违规原因
  created_at: string
  updated_at: string
}

/** 提交食物分析任务，立即返回 task_id */
export async function submitAnalyzeTask(body: AnalyzeTaskSubmitParams): Promise<{ task_id: string; message: string }> {
  const payload: AnalyzeTaskSubmitParams = {
    ...body,
    timezone_offset_minutes: Number.isFinite(body.timezone_offset_minutes)
      ? body.timezone_offset_minutes
      : new Date().getTimezoneOffset()
  }
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

/** 文字分析提交参数 */
export interface AnalyzeTextTaskSubmitParams {
  text: string
  meal_type?: MealType
  timezone_offset_minutes?: number
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  additionalContext?: string
  execution_mode?: ExecutionMode
  previousResult?: AnalyzeResponse
  precision_session_id?: string
  reference_objects?: PrecisionReferenceObjectInput[]
  correctionItems?: Array<{
    name: string
    weight: number
    sourceName?: string
    sourceItemId?: number
    nameEdited?: boolean
    weightEdited?: boolean
  }>
}

/** 提交文字分析任务（异步） */
export async function submitTextAnalyzeTask(body: AnalyzeTextTaskSubmitParams): Promise<{ task_id: string; message: string }> {
  const payload: AnalyzeTextTaskSubmitParams = {
    ...body,
    timezone_offset_minutes: Number.isFinite(body.timezone_offset_minutes)
      ? body.timezone_offset_minutes
      : new Date().getTimezoneOffset()
  }
  const res = await authenticatedRequest('/api/analyze-text/submit', {
    method: 'POST',
    data: payload,
    timeout: 10000
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
  additionalContext?: string
  meal_type?: MealType
  timezone_offset_minutes?: number
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  is_multi_view?: boolean
  reference_objects?: PrecisionReferenceObjectInput[]
}

export async function continuePrecisionSession(
  sessionId: string,
  body: ContinuePrecisionSessionParams,
): Promise<{ task_id: string; message: string }> {
  const payload: ContinuePrecisionSessionParams = {
    ...body,
    timezone_offset_minutes: Number.isFinite(body.timezone_offset_minutes)
      ? body.timezone_offset_minutes
      : new Date().getTimezoneOffset(),
  }
  const res = await authenticatedRequest(`/api/precision-sessions/${sessionId}/continue`, {
    method: 'POST',
    data: payload,
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    throwHttpErrorWithStatus(res.statusCode, res.data, '继续精准模式失败')
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
  return res.data as AnalysisTask
}

/** 查询当前用户的分析任务列表 */
export async function listAnalyzeTasks(params?: { task_type?: string; status?: string; limit?: number }): Promise<{ tasks: AnalysisTask[] }> {
  const q = new URLSearchParams()
  if (params?.task_type) q.set('task_type', params.task_type)
  if (params?.status) q.set('status', params.status)
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
  return res.data as { records: FoodRecord[] }
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
  if (res.statusCode === 200) return res.data as PosterCalorieCompareResponse
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
        mealFullRecordCache[entry.id] = (entry as any).full_record as FoodRecord
      }
      const { full_record, ...rest } = entry as any
      return rest
    })
    return { ...meal, meal_record_entries: entries.length > 0 ? entries : meal.meal_record_entries }
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
  return res.data as { record: FoodRecord }
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
  return res.data as { record: FoodRecord }
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
  
  const res = await authenticatedRequest(url, { 
    method: 'GET', 
    timeout: 10000,
    header: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    }
  })
  console.log('[DEBUG API] 响应状态:', res.statusCode)
  console.log('[DEBUG API] 响应数据 intakeData:', res.data?.intakeData)
  console.log('[DEBUG API] ====== 请求结束 ======')
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取首页数据失败'
    throw new Error(msg)
  }
  const data = res.data as HomeDashboard
  const meals = Array.isArray(data.meals) ? data.meals.map(normalizeHomeMealItem) : []
  return stripMealFullRecordsFromDashboard({ ...data, meals })
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
export async function updateDashboardTargets(data: DashboardTargets): Promise<DashboardTargetsUpdateResult> {
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
 * 获取数据统计（周/月摄入、TDEE、连续天数、饮食结构及简单分析）
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

export async function addBodyWaterLog(amountMl: number, date?: string): Promise<{ message: string; item: { id?: string; date: string; amount_ml: number } }> {
  const res = await authenticatedRequest('/api/body-metrics/water', {
    method: 'POST',
    data: { amount_ml: amountMl, date: mapCalendarDateToApi(date) },
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '保存喝水记录失败'
    throw new Error(msg)
  }
  return res.data as { message: string; item: { id?: string; date: string; amount_ml: number } }
}

export async function resetBodyWaterLogs(date?: string): Promise<{ message: string; deleted_count: number; date: string }> {
  const res = await authenticatedRequest('/api/body-metrics/water/reset', {
    method: 'POST',
    data: { date: mapCalendarDateToApi(date) },
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '清空喝水记录失败'
    throw new Error(msg)
  }
  return res.data as { message: string; deleted_count: number; date: string }
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
export async function generateStatsInsight(range: 'week' | 'month'): Promise<{ analysis_summary: string }> {
  const res = await authenticatedRequest(
    '/api/stats/insight/generate',
    {
      method: 'POST',
      data: { range },
      timeout: 30000
    }
  )
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || 'AI 洞察生成失败'
    throw new Error(msg)
  }
  return res.data as { analysis_summary: string }
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

  const res = await Taro.request({
    url: `${API_BASE_URL}${url}`,
    ...options,
    header: withNgrokBypassHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.header || {})
    })
  })

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

  return res
}

/**
 * 调用后端API进行微信小程序登录
 * @param code 微信小程序登录凭证
 * @param phoneCode 获取手机号的 code（可选）
 * @returns Promise<LoginResponse> 登录结果
 */
export async function login(code: string, phoneCode?: string, inviteCode?: string): Promise<LoginResponse> {
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

    const response = await Taro.request({
      url: `${API_BASE_URL}/api/login`,
      method: 'POST',
      header: withNgrokBypassHeaders({
        'Content-Type': 'application/json'
      }),
      data: requestData,
      timeout: 10000 // 10秒超时
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '登录失败，请重试'
      throw new Error(errorMsg)
    }

    const loginData = response.data as LoginResponse

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
    // 提取更有意义的错误信息
    const errMsg = error.errMsg || error.message || ''
    if (errMsg.includes('ERR_CERT')) {
      throw new Error('SSL证书验证失败，请检查服务器证书配置')
    } else if (errMsg.includes('timeout')) {
      throw new Error('请求超时，请稍后重试')
    } else if (errMsg.includes('fail')) {
      throw new Error(`网络请求失败: ${errMsg}`)
    }
    throw new Error(error.message || '连接服务器失败，请检查网络')
  }
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
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/membership/plans`,
      method: 'GET',
      header: withNgrokBypassHeaders({
        'Content-Type': 'application/json'
      })
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取会员套餐失败'
      throw new Error(errorMsg)
    }

    return ((response.data as MembershipPlansResponse)?.list || []) as MembershipPlan[]
  } catch (error: any) {
    console.error('获取会员套餐失败:', error)
    throw new Error(error.message || '获取会员套餐失败')
  }
}

/**
 * 获取当前用户会员状态
 */
export async function getMyMembership(): Promise<MembershipStatus> {
  try {
    const response = await authenticatedRequest('/api/membership/me', {
      method: 'GET',
      timeout: 15000
    })

    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取会员状态失败'
      throw new Error(errorMsg)
    }

    return response.data as MembershipStatus
  } catch (error: any) {
    console.error('获取会员状态失败:', error)
    throw new Error(error.message || '获取会员状态失败')
  }
}

export async function getFoodExpiryDashboard(): Promise<FoodExpiryDashboard> {
  try {
    const response = await authenticatedRequest('/api/expiry/dashboard', {
      method: 'GET'
    })
    if (response.statusCode !== 200) {
      const errorMsg = (response.data as any)?.detail || '获取保质期摘要失败'
      throw new Error(errorMsg)
    }
    return response.data as FoodExpiryDashboard
  } catch (error: any) {
    console.error('获取保质期摘要失败:', error)
    throw new Error(error.message || '获取保质期摘要失败')
  }
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

/**
 * 创建积分充值支付单（1 元兑换积分数以服务端 points_per_yuan 为准）
 */
export async function createPointsRechargePayment(amountYuan: number): Promise<CreatePointsRechargeResponse> {
  const response = await authenticatedRequest('/api/points/recharge/create', {
    method: 'POST',
    data: { amount_yuan: amountYuan }
  })
  if (response.statusCode !== 200) {
    const errorMsg = (response.data as any)?.detail || '创建积分充值订单失败'
    throw new Error(errorMsg)
  }
  return response.data as CreatePointsRechargeResponse
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
 * 提交/更新健康档案问卷（后端自动计算 BMR、TDEE）
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
export async function submitReportExtractionTask(imageUrl: string): Promise<{ taskId: string }> {
  try {
    const response = await authenticatedRequest('/api/user/health-profile/submit-report-extraction-task', {
      method: 'POST',
      data: { imageUrl }
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
  source: 'public_library' | 'nutrition_library'
  title: string
  subtitle: string
  default_weight_grams: number
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  nutrients_per_100g?: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
  items?: Array<{ name: string; weight?: number; nutrients?: Nutrients }> | null
  image_path?: string | null
  image_paths?: string[] | null
  portion_label?: string
  source_label?: string
  recommend_reason?: string
  usage_count?: number
  collected?: boolean
  like_count?: number
  collection_count?: number
  match_score?: number
}

export async function searchManualFood(q: string, limit: number = 20): Promise<ManualFoodSearchResult[]> {
  const token = getAccessToken()
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) })
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
  return ((response.data as any)?.results || []) as ManualFoodSearchResult[]
}

export interface ManualFoodBrowseResult {
  recent_items: ManualFoodSearchResult[]
  collected_public_library: ManualFoodSearchResult[]
  public_library: ManualFoodSearchResult[]
  nutrition_library: ManualFoodSearchResult[]
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
  return response.data as ManualFoodBrowseResult
}

// ---------- 好友与圈子 ----------

/** 搜索用户项（不包含手机号） */
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
export type CommunityAuthorScope = 'all' | 'priority'

export interface CommunityFeedQueryParams {
  meal_type?: MealType
  diet_goal?: DietGoal
  sort_by?: CommunityFeedSortBy
  priority_author_ids?: string[]
  author_scope?: CommunityAuthorScope
}

/** 圈子 Feed 单条（好友 + 自己今日饮食 + 点赞信息） */
export interface CommunityFeedItem {
  record: FoodRecord
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

/** 评论项 */
export interface FeedCommentItem {
  id: string
  user_id: string
  record_id: string
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
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/friend/invite/profile/${encodeURIComponent(userId)}`,
    method: 'GET',
    header: withNgrokBypassHeaders(),
    timeout: 10000
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '获取邀请资料失败')
  }
  return response.data as FriendInviteProfile
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
  const response = await authenticatedRequest('/api/friend/invite/accept', {
    method: 'POST',
    data: { code: code.trim() }
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
  if (params?.author_scope) q += `&author_scope=${encodeURIComponent(params.author_scope)}`
  if (params?.priority_author_ids?.length) {
    q += `&priority_author_ids=${encodeURIComponent(params.priority_author_ids.join(','))}`
  }
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
  params?: Pick<CommunityFeedQueryParams, 'meal_type' | 'diet_goal' | 'sort_by'>
): Promise<{ list: CommunityFeedItem[]; has_more?: boolean }> {
  let q = `?offset=${offset}&limit=${limit}&include_comments=${includeComments}&comments_limit=${commentsLimit}`
  if (params?.meal_type) q += `&meal_type=${encodeURIComponent(params.meal_type)}`
  if (params?.diet_goal) q += `&diet_goal=${encodeURIComponent(params.diet_goal)}`
  if (params?.sort_by) q += `&sort_by=${encodeURIComponent(params.sort_by)}`
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/community/public-feed${q}`,
    method: 'GET',
    header: withNgrokBypassHeaders(),
    timeout: 10000
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取动态失败')
  return response.data as { list: CommunityFeedItem[]; has_more?: boolean }
}

/** 点赞某条动态 */
export async function communityLike(recordId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/community/feed/${recordId}/like`, { method: 'POST' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '点赞失败')
}

/** 取消点赞 */
export async function communityUnlike(recordId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/community/feed/${recordId}/like`, { method: 'DELETE' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '取消失败')
}

/** 将自己的动态从圈子中隐藏（不删除饮食记录本身） */
export async function communityHideFeed(recordId: string): Promise<void> {
  const response = await authenticatedRequest(`/api/community/feed/${recordId}/hide`, { method: 'POST' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '操作失败')
}

/** 某条动态的评论列表 */
export async function communityGetComments(recordId: string): Promise<{ list: FeedCommentItem[] }> {
  const response = await authenticatedRequest(`/api/community/feed/${recordId}/comments`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取评论失败')
  return response.data as { list: FeedCommentItem[] }
}

/** 获取单条动态的互动上下文（用于互动消息定位） */
export async function communityGetFeedContext(
  recordId: string,
  commentsLimit: number = 5
): Promise<{ item: CommunityFeedItem }> {
  const response = await authenticatedRequest(
    `/api/community/feed/${recordId}/context?comments_limit=${Math.max(0, commentsLimit)}`,
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
  options?: { parent_comment_id?: string; reply_to_user_id?: string }
): Promise<{ comment: FeedCommentItem }> {
  const response = await authenticatedRequest(`/api/community/feed/${recordId}/comments`, {
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
  commentId: string
): Promise<{ deleted: number }> {
  const response = await authenticatedRequest(
    `/api/community/feed/${encodeURIComponent(recordId)}/comments/${encodeURIComponent(commentId)}`,
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
export async function communityGetNotifications(limit: number = 50): Promise<{ list: FeedInteractionNotification[]; unread_count: number }> {
  const response = await authenticatedRequest(`/api/community/notifications?limit=${limit}`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取互动消息失败')
  return response.data as { list: FeedInteractionNotification[]; unread_count: number }
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

// ---------- 公共食物库 ----------

/** 公共食物库条目 */
export interface PublicFoodLibraryItem {
  id: string
  user_id: string
  source_record_id?: string | null
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
}

/** 公共食物库评论 */
export interface PublicFoodLibraryComment {
  id: string
  user_id: string
  library_item_id: string
  content: string
  rating?: number | null
  created_at: string
  nickname: string
  avatar: string
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
}

/** 公共食物库列表查询参数 */
export interface PublicFoodLibraryListParams {
  city?: string
  suitable_for_fat_loss?: boolean
  merchant_name?: string
  min_calories?: number
  max_calories?: number
  sort_by?: 'latest' | 'hot' | 'rating' | 'balanced' | 'high_protein' | 'low_calorie' | 'recommended'
  limit?: number
  offset?: number
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
  rating?: number
): Promise<{ comment: PublicFoodLibraryComment }> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/comments`, {
    method: 'POST',
    data: { content: content.trim(), ...(rating !== undefined && { rating }) }
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '发表失败')
  }
  return response.data as { comment: PublicFoodLibraryComment }
}

// ---------- 用户私人食谱 ----------

/** 私人食谱接口 */
export interface UserRecipe {
  id: string
  user_id: string
  recipe_name: string
  description?: string
  image_path?: string
  items: Array<{
    name: string
    weight: number
    ratio: number
    intake: number
    nutrients: Nutrients
  }>
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
  items: Array<{
    name: string
    weight: number
    ratio: number
    intake: number
    nutrients: Nutrients
  }>
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  tags?: string[]
  meal_type?: string
  is_favorite?: boolean
}

/** 更新食谱请求 */
export interface UpdateRecipeRequest {
  recipe_name?: string
  description?: string
  image_path?: string
  items?: Array<{
    name: string
    weight: number
    ratio: number
    intake: number
    nutrients: Nutrients
  }>
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
export async function applyUserRecipe(recipeId: string, mealType?: string): Promise<{ message: string; record_id: string }> {
  const response = await authenticatedRequest(`/api/recipes/${recipeId}/use`, {
    method: 'POST',
    data: { meal_type: mealType },
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
  calories_burned: number
  recorded_on: string
  recorded_at: string
  /** 模型估算时的思考过程（需库表含 ai_reasoning 列） */
  ai_reasoning?: string | null
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
}

/** 提交运动分析任务（后台 Worker 调用大模型并落库；返回 task_id，需轮询 getAnalyzeTask） */
export async function createExerciseLog(data: {
  exercise_desc: string
  date?: string
}): Promise<{ task_id: string; message: string }> {
  const trimmed = data.exercise_desc.trim()
  const parts: string[] = [`exercise_desc=${encodeURIComponent(trimmed)}`]
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
