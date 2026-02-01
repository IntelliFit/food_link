import Taro from '@tarojs/taro'

// API 基础 URL：从环境变量读取，未配置时使用生产地址
// 开发：.env.development 中 TARO_APP_API_BASE_URL
// 生产：.env.production 中 TARO_APP_API_BASE_URL
const API_BASE_URL =
  process.env.TARO_APP_API_BASE_URL || 'https://healthymax.cn'

// 分析请求接口（base64Image 与 image_url 二选一，推荐先上传拿 image_url）
export interface AnalyzeRequest {
  base64Image?: string
  /** Supabase 等公网图片 URL，分析时用此 URL 获取图片；标记样本/保存记录时也存此 URL */
  image_url?: string
  additionalContext?: string
  modelName?: string
  user_goal?: 'muscle_gain' | 'fat_loss' | 'maintain'
  context_state?: string
  remaining_calories?: number
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack'
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
  description?: string
  insight?: string
  items: FoodRecordItemPayload[]
  total_calories: number
  total_protein: number
  total_carbs: number
  total_fat: number
  total_weight_grams: number
  context_state?: string
  pfc_ratio_comment?: string
  absorption_notes?: string
  context_advice?: string
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
  description?: string | null
  insight?: string | null
  context_state?: string | null
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
        additionalContext: request.additionalContext || '',
        modelName: request.modelName || 'qwen-vl-max',
        ...(request.user_goal != null && { user_goal: request.user_goal }),
        ...(request.context_state != null && request.context_state !== '' && { context_state: request.context_state }),
        ...(request.remaining_calories != null && { remaining_calories: request.remaining_calories }),
        ...(request.meal_type != null && request.meal_type !== '' && { meal_type: request.meal_type })
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

/** 文字分析请求参数 */
export interface AnalyzeTextParams {
  text: string
  user_goal?: 'muscle_gain' | 'fat_loss' | 'maintain'
  context_state?: string
  remaining_calories?: number
}

/**
 * 根据文字描述分析食物营养成分（与图片分析返回结构一致）
 * @param params 文本内容及可选的 user_goal、context_state、remaining_calories
 * @returns Promise<AnalyzeResponse>
 */
export async function analyzeFoodText(params: AnalyzeTextParams | string): Promise<AnalyzeResponse> {
  const payload = typeof params === 'string' ? { text: params.trim() } : {
    text: params.text.trim(),
    ...(params.user_goal != null && { user_goal: params.user_goal }),
    ...(params.context_state != null && params.context_state !== '' && { context_state: params.context_state }),
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

