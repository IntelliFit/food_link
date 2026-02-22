import Taro from '@tarojs/taro'

// API 基础 URL：从环境变量读取，未配置时使用生产地址
// 开发：.env.development 中 TARO_APP_API_BASE_URL
// 生产：.env.production 中 TARO_APP_API_BASE_URL
const API_BASE_URL =
  process.env.TARO_APP_API_BASE_URL || 'https://healthymax.cn'

// 基础类型定义
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type DietGoal = 'fat_loss' | 'muscle_gain' | 'maintain' | 'none'
export type ActivityTiming = 'post_workout' | 'daily' | 'before_sleep' | 'none'
export type UserGoal = 'muscle_gain' | 'fat_loss' | 'maintain'

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
  is_multi_view?: boolean
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
}

/** 确认记录请求：餐次 + 识别结果与营养汇总 + 用户状态与专业分析 */
export interface SaveFoodRecordRequest {
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
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
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
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

/** 首页今日餐食单条 */
export interface HomeMealItem {
  type: string
  name: string
  time: string
  calorie: number
  target: number
  progress: number
  tags: string[]
}

/** 首页仪表盘接口返回（不含运动） */
export interface HomeDashboard {
  intakeData: HomeIntakeData
  meals: HomeMealItem[]
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
  by_meal: { breakfast: number; lunch: number; dinner: number; snack: number }
  daily_calories: Array<{ date: string; calories: number }>
  macro_percent: { protein: number; carbs: number; fat: number }
  analysis_summary: string
}

// 登录请求接口
export interface LoginRequest {
  code: string
}

// 登录请求接口
export interface LoginRequestParams {
  code: string
  phoneCode?: string
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
}

/** 健康档案中的病史/饮食/过敏等 JSON */
export interface HealthCondition {
  medical_history?: string[]
  diet_preference?: string[]
  allergies?: string[]
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
  /** 体检报告 OCR 识别结果，保存时与问卷一并写入 user_health_documents */
  report_extract?: Record<string, unknown>
  /** 体检报告图片在 Supabase Storage 的 URL，保存时写入 user_health_documents.image_url */
  report_image_url?: string
  diet_goal?: string
}

// 更新用户信息请求接口
export interface UpdateUserInfoRequest {
  nickname?: string
  avatar?: string
  telephone?: string
}

/**
 * 将图片路径转换为base64
 * @param imagePath 图片路径
 * @returns Promise<string> base64字符串
 */
export async function imageToBase64(imagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath: imagePath,
      encoding: 'base64',
      success: (res) => {
        // 返回完整的data URL格式
        resolve(`data:image/jpeg;base64,${res.data}`)
      },
      fail: (err) => {
        console.error('图片转base64失败:', err)
        reject(new Error('图片转换失败'))
      }
    })
  })
}

/**
 * 调用后端API分析食物图片
 * @param request 分析请求参数
 * @returns Promise<AnalyzeResponse> 分析结果
 */
/**
 * 食物分析前上传图片到 Supabase，返回公网 URL
 */
export async function uploadAnalyzeImage(base64Image: string): Promise<{ imageUrl: string }> {
  const response = await Taro.request({
    url: `${API_BASE_URL}/api/upload-analyze-image`,
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    data: { base64Image },
    timeout: 15000
  })
  if (response.statusCode !== 200) {
    const msg = (response.data as any)?.detail || '上传图片失败'
    throw new Error(msg)
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
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/analyze`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json'
      },
      data: {
        ...(request.base64Image != null && { base64Image: request.base64Image }),
        ...(request.image_url != null && request.image_url !== '' && { image_url: request.image_url }),
        ...(request.image_urls != null && { image_urls: request.image_urls }),
        additionalContext: request.additionalContext || '',
        modelName: request.modelName || 'qwen-vl-max',
        ...(request.user_goal != null && { user_goal: request.user_goal }),
        ...(request.remaining_calories != null && { remaining_calories: request.remaining_calories }),
        ...(request.meal_type != null && { meal_type: request.meal_type })
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
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/analyze-compare`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json'
      },
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
        ...(request.meal_type != null && { meal_type: request.meal_type })
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
      header: { 'Content-Type': 'application/json' },
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
export async function saveFoodRecord(payload: SaveFoodRecordRequest): Promise<{ id: string; message: string }> {
  const res = await authenticatedRequest('/api/food-record/save', {
    method: 'POST',
    data: payload,
    timeout: 15000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '保存记录失败'
    throw new Error(msg)
  }
  return res.data as { id: string; message: string }
}

// ---------- 异步分析任务（提交后 Worker 执行，可稍后在分析历史查看） ----------

export interface AnalyzeTaskSubmitParams {
  image_url: string
  image_urls?: string[]
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
  additionalContext?: string
  modelName?: string
  is_multi_view?: boolean
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
  const res = await authenticatedRequest('/api/analyze/submit', {
    method: 'POST',
    data: body,
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '提交任务失败'
    throw new Error(msg)
  }
  return res.data as { task_id: string; message: string }
}

/** 文字分析提交参数 */
export interface AnalyzeTextTaskSubmitParams {
  text: string
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  diet_goal?: string
  activity_timing?: string
  user_goal?: string
  remaining_calories?: number
}

/** 提交文字分析任务（异步） */
export async function submitTextAnalyzeTask(body: AnalyzeTextTaskSubmitParams): Promise<{ task_id: string; message: string }> {
  const res = await authenticatedRequest('/api/analyze-text/submit', {
    method: 'POST',
    data: body,
    timeout: 10000
  })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '提交任务失败'
    throw new Error(msg)
  }
  return res.data as { task_id: string; message: string }
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
export async function listAnalyzeTasks(params?: { task_type?: string; status?: string }): Promise<{ tasks: AnalysisTask[] }> {
  const q = new URLSearchParams()
  if (params?.task_type) q.set('task_type', params.task_type)
  if (params?.status) q.set('status', params.status)
  const url = `/api/analyze/tasks${q.toString() ? '?' + q.toString() : ''}`
  const res = await authenticatedRequest(url, { method: 'GET', timeout: 10000 })
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

/**
 * 获取首页仪表盘数据（今日摄入 + 今日餐食，不含运动）
 */
export async function getHomeDashboard(): Promise<HomeDashboard> {
  const res = await authenticatedRequest('/api/home/dashboard', { method: 'GET', timeout: 10000 })
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取首页数据失败'
    throw new Error(msg)
  }
  return res.data as HomeDashboard
}

/**
 * 获取数据统计（周/月摄入、TDEE、连续天数、饮食结构及简单分析）
 * @param range 'week' | 'month'
 */
export async function getStatsSummary(range: 'week' | 'month'): Promise<StatsSummary> {
  const res = await authenticatedRequest(
    `/api/stats/summary?range=${encodeURIComponent(range)}`,
    { method: 'GET', timeout: 10000 }
  )
  if (res.statusCode !== 200) {
    const msg = (res.data as any)?.detail || '获取统计失败'
    throw new Error(msg)
  }
  return res.data as StatsSummary
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

/**
 * 带认证的请求
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
    throw new Error('未登录，请先登录')
  }

  return Taro.request({
    url: `${API_BASE_URL}${url}`,
    ...options,
    header: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.header || {})
    }
  })
}

/**
 * 调用后端API进行微信小程序登录
 * @param code 微信小程序登录凭证
 * @param phoneCode 获取手机号的 code（可选）
 * @returns Promise<LoginResponse> 登录结果
 */
export async function login(code: string, phoneCode?: string): Promise<LoginResponse> {
  try {
    const requestData: LoginRequestParams = {
      code: code
    }

    if (phoneCode) {
      requestData.phoneCode = phoneCode
    }

    const response = await Taro.request({
      url: `${API_BASE_URL}/api/login`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json'
      },
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

/** 好友列表项 */
export interface FriendListItem {
  id: string
  nickname: string
  avatar: string
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
}

/** 评论项 */
export interface FeedCommentItem {
  id: string
  user_id: string
  record_id: string
  content: string
  created_at: string
  nickname: string
  avatar: string
  _is_temp?: boolean  // 标记为临时评论（未通过审核）
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

/** 好友列表 */
export async function friendGetList(): Promise<{ list: FriendListItem[] }> {
  const response = await authenticatedRequest('/api/friend/list', { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取失败')
  return response.data as { list: FriendListItem[] }
}

/** 圈子 Feed：好友今日饮食（可选 date YYYY-MM-DD） */
/** 圈子 Feed：好友饮食记录（分页，可选 date YYYY-MM-DD） */
export async function communityGetFeed(
  date?: string,
  offset: number = 0,
  limit: number = 20,
  includeComments: boolean = true,
  commentsLimit: number = 5
): Promise<{ list: CommunityFeedItem[]; has_more?: boolean }> {
  let q = `?offset=${offset}&limit=${limit}&include_comments=${includeComments}&comments_limit=${commentsLimit}`
  if (date) {
    q += `&date=${date}`
  }
  const response = await authenticatedRequest(`/api/community/feed${q}`, { method: 'GET' })
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

/** 某条动态的评论列表 */
export async function communityGetComments(recordId: string): Promise<{ list: FeedCommentItem[] }> {
  const response = await authenticatedRequest(`/api/community/feed/${recordId}/comments`, { method: 'GET' })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '获取评论失败')
  return response.data as { list: FeedCommentItem[] }
}

/** 
 * 发表评论（异步审核版本）
 * 返回任务 ID 和临时评论数据，前端需要本地缓存显示
 */
export async function communityPostComment(recordId: string, content: string): Promise<{ task_id: string; temp_comment: FeedCommentItem }> {
  const response = await authenticatedRequest(`/api/community/feed/${recordId}/comments`, {
    method: 'POST',
    data: { content: content.trim() }
  })
  if (response.statusCode !== 200) throw new Error((response.data as any)?.detail || '发表失败')
  return response.data as { task_id: string; temp_comment: FeedCommentItem }
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
  sort_by?: 'latest' | 'hot' | 'rating'
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
 * 发表公共食物库评论（异步审核版本，可选评分 1-5）
 * 返回任务 ID 和临时评论数据，前端需要本地缓存显示
 */
export async function postPublicFoodLibraryComment(
  itemId: string,
  content: string,
  rating?: number
): Promise<{ task_id: string; temp_comment: PublicFoodLibraryComment }> {
  const response = await authenticatedRequest(`/api/public-food-library/${itemId}/comments`, {
    method: 'POST',
    data: { content: content.trim(), ...(rating !== undefined && { rating }) }
  })
  if (response.statusCode !== 200) {
    throw new Error((response.data as any)?.detail || '发表失败')
  }
  return response.data as { task_id: string; temp_comment: PublicFoodLibraryComment }
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
export async function useUserRecipe(recipeId: string, mealType?: string): Promise<{ message: string; record_id: string }> {
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

