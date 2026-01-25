import Taro from '@tarojs/taro'

// API 基础URL配置
// 开发环境：使用 localhost（需要确保后端服务运行在 8000 端口）
// 生产环境：请修改为实际的后端服务器地址
const API_BASE_URL = 'http://localhost:8888'

// 分析请求接口
export interface AnalyzeRequest {
  base64Image: string
  additionalContext?: string
  modelName?: string
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

// 分析响应接口
export interface AnalyzeResponse {
  description: string
  insight: string
  items: FoodItem[]
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
export async function analyzeFoodImage(
  request: AnalyzeRequest
): Promise<AnalyzeResponse> {
  try {
    const response = await Taro.request({
      url: `${API_BASE_URL}/api/analyze`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json'
      },
      data: {
        base64Image: request.base64Image,
        additionalContext: request.additionalContext || '',
        modelName: request.modelName || 'qwen-vl-max'
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

