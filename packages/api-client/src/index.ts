import type {
  AnalysisTask,
  AnalyzeTaskSubmitParams,
  HomeDashboard,
  LoginResponse,
  MembershipStatus,
  SaveFoodRecordRequest,
} from '@food-link/core'

export interface ApiClientResponse<T = unknown> {
  status: number
  data: T
  headers?: Record<string, string>
}

export interface ApiClientRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export interface UploadFileInput {
  url: string
  fileUri: string
  fieldName: string
  fileName?: string
  mimeType?: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface TokenStorage {
  getAccessToken(): Promise<string | null>
  setTokens(tokens: { accessToken: string; refreshToken: string; userId: string }): Promise<void>
  clearTokens(): Promise<void>
}

export interface ApiClientAdapters {
  request(url: string, options?: ApiClientRequestOptions): Promise<ApiClientResponse<unknown>>
  uploadFile(input: UploadFileInput): Promise<ApiClientResponse<unknown>>
  tokenStorage: TokenStorage
}

export interface FoodLinkApiClientOptions {
  baseUrl: string
  adapters: ApiClientAdapters
}

export class FoodLinkApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'FoodLinkApiError'
    this.status = status
    this.data = data
  }
}

type UploadAnalyzeImageResponse = {
  imageUrl?: string
  image_url?: string
  url?: string
}

export class FoodLinkApiClient {
  private readonly baseUrl: string
  private readonly adapters: ApiClientAdapters

  constructor(options: FoodLinkApiClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
    if (!baseUrl) {
      throw new Error('FoodLinkApiClient requires a baseUrl')
    }
    this.baseUrl = baseUrl
    this.adapters = options.adapters
  }

  async debugImpersonateUser(userId: string, password: string): Promise<LoginResponse> {
    const trimmedUserId = userId.trim()
    const trimmedPassword = password.trim()
    if (!trimmedUserId) throw new Error('请输入用户 ID')
    if (!trimmedPassword) throw new Error('请输入调试密码')

    const data = await this.publicRequest<LoginResponse>('/api/test-backend/impersonate-user', {
      method: 'POST',
      body: { user_id: trimmedUserId, password: trimmedPassword },
      timeoutMs: 10000,
    })
    await this.adapters.tokenStorage.setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user_id,
    })
    return data
  }

  async debugLoginWithTestOpenID(testOpenID: string): Promise<LoginResponse> {
    const trimmedTestOpenID = testOpenID.trim()
    if (!trimmedTestOpenID) throw new Error('请输入测试 OpenID')

    const data = await this.publicRequest<LoginResponse>('/api/login', {
      method: 'POST',
      body: { testOpenid: trimmedTestOpenID },
      timeoutMs: 10000,
    })
    await this.adapters.tokenStorage.setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user_id,
    })
    return data
  }

  async getHomeDashboard(date?: string): Promise<HomeDashboard> {
    const timestamp = Date.now()
    const apiDate = mapCalendarDateToApi(date)
    const query = apiDate
      ? `?date=${encodeURIComponent(apiDate)}&_t=${timestamp}`
      : `?_t=${timestamp}`
    return this.authenticatedRequest<HomeDashboard>(`/api/home/dashboard${query}`, {
      method: 'GET',
      timeoutMs: 30000,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    })
  }

  async getMyMembership(date?: string): Promise<MembershipStatus> {
    const key = (date || '').trim()
    const query = key ? `?date=${encodeURIComponent(key)}` : ''
    return this.authenticatedRequest<MembershipStatus>(`/api/membership/me${query}`, {
      method: 'GET',
      timeoutMs: 15000,
    })
  }

  async uploadAnalyzeImageFile(input: {
    fileUri: string
    fileName?: string
    mimeType?: string
  }): Promise<{ imageUrl: string }> {
    const token = await this.adapters.tokenStorage.getAccessToken()
    if (!token) throw new Error('请先登录')

    const res = await this.adapters.uploadFile({
      url: `${this.baseUrl}/api/upload-analyze-image-file`,
      fileUri: input.fileUri,
      fieldName: 'file',
      fileName: input.fileName || 'food.jpg',
      mimeType: input.mimeType || 'image/jpeg',
      timeoutMs: 30000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    this.assertOk(res, '上传图片失败')
    const data = res.data as UploadAnalyzeImageResponse
    const imageUrl = String(data.imageUrl || data.image_url || data.url || '').trim()
    if (!imageUrl) {
      throw new Error('服务器未返回图片地址')
    }
    return { imageUrl }
  }

  async submitAnalyzeTask(body: AnalyzeTaskSubmitParams): Promise<{ task_id: string; message: string }> {
    const data = await this.authenticatedRequest<Record<string, unknown>>('/api/analyze/submit', {
      method: 'POST',
      body,
      timeoutMs: 10000,
    })
    const taskId = String(data.task_id ?? data.taskId ?? '').trim()
    const message = String(data.message ?? '任务已提交')
    if (!taskId) {
      throw new Error('服务器未返回任务编号，请稍后重试')
    }
    return { task_id: taskId, message }
  }

  async getAnalyzeTask(taskId: string): Promise<AnalysisTask> {
    return this.authenticatedRequest<AnalysisTask>(`/api/analyze/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async saveFoodRecord(payload: SaveFoodRecordRequest): Promise<{ id: string; message: string }> {
    return this.authenticatedRequest<{ id: string; message: string }>('/api/food-record', {
      method: 'POST',
      body: payload,
      timeoutMs: 15000,
    })
  }

  async clearTokens(): Promise<void> {
    await this.adapters.tokenStorage.clearTokens()
  }

  private async publicRequest<T>(path: string, options: ApiClientRequestOptions): Promise<T> {
    const res = await this.adapters.request(this.absoluteUrl(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
    this.assertOk(res, '请求失败')
    return res.data as T
  }

  private async authenticatedRequest<T>(path: string, options: ApiClientRequestOptions): Promise<T> {
    const token = await this.adapters.tokenStorage.getAccessToken()
    if (!token) throw new Error('请先登录')

    const res = await this.adapters.request(this.absoluteUrl(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    })
    this.assertOk(res, '请求失败')
    return res.data as T
  }

  private absoluteUrl(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }

  private assertOk(res: ApiClientResponse<unknown>, fallback: string): void {
    if (res.status >= 200 && res.status < 300) return
    const data = res.data as Record<string, unknown> | undefined
    const message = String(data?.detail || data?.message || fallback)
    throw new FoodLinkApiError(message, res.status, res.data)
  }
}

export function mapCalendarDateToApi(date?: string): string | undefined {
  if (!date) return undefined
  return date.replace(/^2025-/, '2026-')
}

export function createFoodLinkApiClient(options: FoodLinkApiClientOptions): FoodLinkApiClient {
  return new FoodLinkApiClient(options)
}
