import type {
  AnalysisTask,
  AnalyzeTaskStatusCount,
  AnalyzeTaskSubmitParams,
  BodyMetricsSummary,
  CheckinLeaderboardItem,
  CommunityFeedItem,
  CommunityFeedQueryParams,
  CommunityFeedTargetType,
  ExerciseLogItem,
  FoodExpiryDashboard,
  FoodRecord,
  HomeDashboard,
  LoginResponse,
  MembershipStatus,
  RewardCenterResponse,
  SaveFoodRecordRequest,
  StatsRange,
  StatsSummary,
  UpdateFoodRecordRequest,
  UserInfo,
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

  async saveFoodRecord(payload: SaveFoodRecordRequest): Promise<{ id: string; message: string; already_saved?: boolean }> {
    return this.authenticatedRequest<{ id: string; message: string; already_saved?: boolean }>('/api/food-record/save', {
      method: 'POST',
      body: payload,
      timeoutMs: 15000,
    })
  }

  async getFoodRecordList(date?: string): Promise<{ records: FoodRecord[] }> {
    const apiDate = mapCalendarDateToApi(date)
    const query = apiDate ? `?date=${encodeURIComponent(apiDate)}` : ''
    return this.authenticatedRequest<{ records: FoodRecord[] }>(`/api/food-record/list${query}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getFoodRecordById(recordId: string): Promise<{ record: FoodRecord }> {
    return this.authenticatedRequest<{ record: FoodRecord }>(`/api/food-record/${encodeURIComponent(recordId)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async updateFoodRecord(recordId: string, body: UpdateFoodRecordRequest): Promise<{ message: string; record: FoodRecord }> {
    return this.authenticatedRequest<{ message: string; record: FoodRecord }>(`/api/food-record/${encodeURIComponent(recordId)}`, {
      method: 'PUT',
      body,
      timeoutMs: 15000,
    })
  }

  async deleteFoodRecord(recordId: string): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(`/api/food-record/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async listAnalyzeTasks(params?: { task_type?: string; status?: string; search?: string; limit?: number }): Promise<{ tasks: AnalysisTask[] }> {
    const q = new URLSearchParams()
    if (params?.task_type) q.set('task_type', params.task_type)
    if (params?.status) q.set('status', params.status)
    if (params?.search?.trim()) q.set('search', params.search.trim())
    if (params?.limit != null && Number.isFinite(params.limit)) {
      q.set('limit', String(Math.min(200, Math.max(1, Math.floor(params.limit)))))
    }
    const query = q.toString()
    return this.authenticatedRequest<{ tasks: AnalysisTask[] }>(`/api/analyze/tasks${query ? `?${query}` : ''}`, {
      method: 'GET',
      timeoutMs: 20000,
    })
  }

  async getAnalyzeTaskStatusCount(): Promise<AnalyzeTaskStatusCount> {
    return this.authenticatedRequest<AnalyzeTaskStatusCount>('/api/analyze/tasks/status-count', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async deleteAnalysisTask(taskId: string): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(`/api/analyze/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async retryAnalyzeTask(taskId: string): Promise<{ task_id?: string; message: string }> {
    return this.authenticatedRequest<{ task_id?: string; message: string }>('/api/analyze/tasks/retry', {
      method: 'POST',
      body: { task_id: taskId },
      timeoutMs: 10000,
    })
  }

  async getUserProfile(): Promise<UserInfo> {
    return this.authenticatedRequest<UserInfo>('/api/user/profile', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getUserRecordDays(): Promise<{ record_days: number }> {
    return this.authenticatedRequest<{ record_days: number }>('/api/user/record-days', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getStatsSummary(range: StatsRange): Promise<StatsSummary> {
    return this.authenticatedRequest<StatsSummary>(`/api/stats/summary?range=${encodeURIComponent(range)}`, {
      method: 'GET',
      timeoutMs: 20000,
    })
  }

  async getBodyMetricsSummary(range: StatsRange = 'month'): Promise<BodyMetricsSummary> {
    return this.authenticatedRequest<BodyMetricsSummary>(`/api/body-metrics/summary?range=${encodeURIComponent(range)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async addBodyWaterLog(amountMl: number, date?: string): Promise<{ message: string }> {
    return this.authenticatedRequest<{ message: string }>('/api/body-metrics/water', {
      method: 'POST',
      body: { amount_ml: amountMl, date: mapCalendarDateToApi(date) },
      timeoutMs: 10000,
    })
  }

  async saveBodyWeightRecord(value: number, date?: string): Promise<{ message: string }> {
    return this.authenticatedRequest<{ message: string }>('/api/body-metrics/weight', {
      method: 'POST',
      body: { value, date: mapCalendarDateToApi(date) },
      timeoutMs: 10000,
    })
  }

  async communityGetFeed(options?: {
    date?: string
    offset?: number
    limit?: number
    includeComments?: boolean
    commentsLimit?: number
    params?: CommunityFeedQueryParams
  }): Promise<{ list: CommunityFeedItem[]; has_more?: boolean }> {
    const q = this.buildCommunityFeedQuery(options)
    return this.authenticatedRequest<{ list: CommunityFeedItem[]; has_more?: boolean }>(`/api/community/feed?${q}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async communityGetPublicFeed(options?: {
    offset?: number
    limit?: number
    includeComments?: boolean
    commentsLimit?: number
    params?: Pick<CommunityFeedQueryParams, 'meal_type' | 'diet_goal' | 'sort_by' | 'content_type'>
  }): Promise<{ list: CommunityFeedItem[]; has_more?: boolean }> {
    const q = this.buildCommunityFeedQuery(options)
    return this.publicRequest<{ list: CommunityFeedItem[]; has_more?: boolean }>(`/api/community/public-feed?${q}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async communityGetCheckinLeaderboard(): Promise<{ week_start: string; week_end: string; list: CheckinLeaderboardItem[] }> {
    return this.authenticatedRequest<{ week_start: string; week_end: string; list: CheckinLeaderboardItem[] }>(
      '/api/community/checkin-leaderboard',
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async communityLike(targetId: string, targetType: CommunityFeedTargetType = 'food_record'): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(this.communityFeedTargetPath(targetId, targetType, 'like'), {
      method: 'POST',
      timeoutMs: 10000,
    })
  }

  async communityUnlike(targetId: string, targetType: CommunityFeedTargetType = 'food_record'): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(this.communityFeedTargetPath(targetId, targetType, 'like'), {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async getRewardCenter(): Promise<RewardCenterResponse> {
    return this.authenticatedRequest<RewardCenterResponse>('/api/membership/reward-center', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getFoodExpiryDashboard(): Promise<FoodExpiryDashboard> {
    return this.authenticatedRequest<FoodExpiryDashboard>('/api/expiry/dashboard', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getExerciseLogs(params?: { date?: string; start_date?: string; end_date?: string }): Promise<{
    logs: ExerciseLogItem[]
    total_calories: number
    count: number
  }> {
    const q = new URLSearchParams()
    if (params?.date) q.set('date', mapCalendarDateToApi(params.date) ?? params.date)
    if (params?.start_date) q.set('start_date', params.start_date)
    if (params?.end_date) q.set('end_date', params.end_date)
    q.set('_t', String(Date.now()))
    return this.authenticatedRequest<{ logs: ExerciseLogItem[]; total_calories: number; count: number }>(
      `/api/exercise-logs?${q.toString()}`,
      { method: 'GET', timeoutMs: 10000 },
    )
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

  private buildCommunityFeedQuery(options?: {
    date?: string
    offset?: number
    limit?: number
    includeComments?: boolean
    commentsLimit?: number
    params?: Partial<CommunityFeedQueryParams>
  }): string {
    const q = new URLSearchParams()
    q.set('offset', String(options?.offset ?? 0))
    q.set('limit', String(options?.limit ?? 20))
    q.set('include_comments', String(options?.includeComments ?? true))
    q.set('comments_limit', String(options?.commentsLimit ?? 5))
    if (options?.date) q.set('date', options.date)
    const params = options?.params
    if (params?.meal_type) q.set('meal_type', params.meal_type)
    if (params?.diet_goal) q.set('diet_goal', params.diet_goal)
    if (params?.sort_by) q.set('sort_by', params.sort_by)
    if (params?.content_type) q.set('content_type', params.content_type)
    if (params?.author_scope) q.set('author_scope', params.author_scope)
    if (params?.author_id) q.set('author_id', params.author_id)
    if (params?.priority_author_ids?.length) {
      q.set('priority_author_ids', params.priority_author_ids.join(','))
    }
    return q.toString()
  }

  private communityFeedTargetPath(targetId: string, targetType: CommunityFeedTargetType, action?: string): string {
    const base = `/api/community/feed-targets/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`
    return action ? `${base}/${action}` : base
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
