import type {
  AnalysisTask,
  AnalyzeTaskStatusCount,
  AnalyzeTaskSubmitParams,
  BodyMetricsSummary,
  CampusFoodDetail,
  CheckinLeaderboardItem,
  CommunityNotificationItem,
  CommunityFeedContext,
  CommunityFeedItem,
  CommunityFeedQueryParams,
  CommunitySearchResult,
  CommunitySearchTab,
  CommunityFeedTargetType,
  ConversationSummary,
  DietRecommendationResult,
  ExecutionMode,
  ExerciseLogItem,
  FeedCommentItem,
  FollowListResponse,
  FollowStats,
  FoodExpiryDashboard,
  FoodExpiryItem,
  FoodRecord,
  FoodRecordItemPayload,
  HealthProfile,
  HealthReportExtract,
  FriendInviteProfile,
  FriendInviteResolveResult,
  FriendRequestItem,
  FriendUserItem,
  HomeDashboard,
  LoginResponse,
  ManualFoodBrowseResult,
  ManualFoodCatalogResult,
  ManualFoodItem,
  MembershipPaymentOrder,
  MembershipPlan,
  MembershipStatus,
  MealType,
  LocationSearchResult,
  PackagedFoodItem,
  PackagedProductExtractResult,
  PackagedNutritionLabelResult,
  PetClaimResult,
  PetChatEstimateResponse,
  PetChatHistoryResponse,
  PetChatResponse,
  PetChatSessionsResponse,
  PetSummary,
  PrivateMessageItem,
  PublicFoodComment,
  PublicFoodItem,
  PublicProfile,
  RecipeItem,
  RewardCenterResponse,
  SaveFoodRecordRequest,
  StatsRange,
  StatsCustomFocusResult,
  StatsInsightResult,
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

export type GooseDuckChickenSpecies = 'goose' | 'duck' | 'chicken' | 'unknown'

export interface GooseDuckChickenClassifyInput {
  imageUrl: string
  additionalContext?: string
}

export interface GooseDuckChickenClassifyResult {
  species: GooseDuckChickenSpecies
  label: string
  confidence: number
  reason: string
  evidence: string[]
}

export interface PasswordRegisterInput {
  phone: string
  password: string
  nickname?: string
  inviteCode?: string
}

export interface PasswordLoginInput {
  phone: string
  password: string
}

export interface SMSCodeInput {
  phone: string
}

export interface SMSLoginInput {
  phone: string
  code: string
  inviteCode?: string
}

export interface SMSCodeResponse {
  request_id?: string
  expires_in_seconds?: number
  cooldown_seconds?: number
  retry_after_seconds?: number
}

export interface SetAccountPasswordInput {
  phone?: string
  password: string
  currentPassword?: string
}

export interface AppWechatLoginInput {
  code: string
  inviteCode?: string
}

export interface SubmitTextTaskInput {
  text: string
  mealType?: MealType
  date?: string
  additionalContext?: string
  executionMode?: ExecutionMode
}

export interface ManualFoodRecordInput {
  item: ManualFoodItem
  mealType: MealType
  date?: string
  weight?: number
}

export interface ManualFoodRecordItemInput {
  item: ManualFoodItem
  weight?: number
}

export interface ManualFoodRecordsInput {
  items: ManualFoodRecordItemInput[]
  mealType: MealType
  date?: string
}

export interface ManualFoodSearchOptions {
  source?: 'packaged_food' | string
}

export interface ManualFoodCatalogOptions {
  page?: number
  pageSize?: number
}

export interface SaveCustomFoodInput {
  title: string
  defaultWeightGrams?: number
  totalCalories: number
  totalProtein?: number
  totalCarbs?: number
  totalFat?: number
  nutrientsPer100g?: Record<string, number>
  extraNutrients?: Record<string, number>
  imagePath?: string
  imagePaths?: string[]
  portionLabel?: string
  recommendReason?: string
  shareToPublic?: boolean
}

export interface CreateExpiryItemInput {
  foodName: string
  category?: string
  expireDate: string
  quantityNote?: string
  storageType?: string
  note?: string
}

export interface UpdateExpiryItemInput {
  foodName?: string
  category?: string
  expireDate?: string
  quantityNote?: string
  storageType?: string
  note?: string
  status?: 'active' | 'consumed' | 'discarded' | string
}

export interface HealthProfileInput {
  gender?: string
  birthday?: string
  height?: number
  weight?: number
  activity_level?: string
  daily_life_activity_level?: string
  diet_goal?: string
  execution_mode?: ExecutionMode
  mode_set_by?: string
  mode_reason?: string
  medical_history?: string[]
  diet_preference?: string[]
  allergies?: string[]
  health_notes?: string
  routine_type?: string
  routine_sleep_hour?: number
  routine_wake_hour?: number
  dashboard_targets?: DashboardTargetsInput
  report_extract?: HealthReportExtract
  report_image_url?: string
  precision_reference_defaults?: Record<string, unknown>
}

export interface UploadBase64ImageInput {
  base64Image: string
}

export interface SubmitReportExtractionTaskInput {
  imageUrl?: string
  imageUrls?: string[]
}

export interface DashboardTargetsInput {
  calorie_target: number
  protein_target: number
  carbs_target: number
  fat_target: number
  target_date?: string
  micro_targets?: Record<string, number>
}

export interface CreateCirclePostInput {
  title: string
  body: string
  imageUrls?: string[]
  nutrition?: {
    total_calories?: number
    total_protein?: number
    total_carbs?: number
    total_fat?: number
    fiber?: number
    sugar?: number
    sodium_mg?: number
    total_weight_grams?: number
  }
}

export type FeedbackCategory = 'bug' | 'suggestion' | 'experience' | 'other'

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

export interface SubmitFeedbackInput {
  category: FeedbackCategory
  content: string
  contact?: string
  pagePath?: string
  appVersion?: string
  clientInfo?: Record<string, unknown>
  recentRequests?: RecentRequestTrace[]
  imageUrls?: string[]
}

export interface SharePosterRewardClaimInput {
  recordId?: string
  shareScope?: 'meal_record' | 'daily_food' | 'daily_summary' | string
  shareDate?: string
}

export interface SharePosterRewardClaimResult {
  claimed?: boolean
  already_claimed?: boolean
  daily_cap_reached?: boolean
  share_poster_claims_today?: number
  credits?: number
  daily_credits_max?: number
  daily_credits_remaining?: number
  earned_credits_balance?: number
  total_credits_available?: number
  message?: string
}

export interface SendPrivateMessageInput {
  content?: string
  contentType?: 'text' | 'image' | string
  imageUrl?: string
}

export interface ReportPrivateMessageInput {
  reason?: PrivateMessageReportReason
  extraContent?: string
}

export interface RecipeInput {
  recipeName: string
  description?: string
  imagePath?: string
  items?: Array<Record<string, unknown>>
  totalCalories?: number
  totalProtein?: number
  totalCarbs?: number
  totalFat?: number
  totalWeightGrams?: number
  tags?: string[]
  mealType?: MealType
  isFavorite?: boolean
}

export interface PublicFoodListParams {
  limit?: number
  offset?: number
  sortBy?: 'latest' | 'hot' | 'recommended' | string
  type?: string
  city?: string
  merchantName?: string
  suitableForFatLoss?: boolean
  isCampusFood?: boolean
  isCampusHighlight?: boolean
  schoolName?: string
  canteenName?: string
  minCalories?: number
  maxCalories?: number
}

export interface CommunityNotificationListParams {
  limit?: number
  offset?: number
  type?: string
}

export interface CommunityNotificationListResult {
  list: CommunityNotificationItem[]
  unread_count: number
  has_more?: boolean
}

export interface ConversationListParams {
  limit?: number
  offset?: number
}

export interface ConversationListResult {
  list: ConversationSummary[]
  has_more?: boolean
  offset?: number
  limit?: number
}

export interface CreatePublicFoodInput {
  foodName: string
  description?: string
  sourceRecordId?: string
  totalCalories?: number
  totalProtein?: number
  totalCarbs?: number
  totalFat?: number
  items?: Array<Record<string, unknown>>
  imagePath?: string
  imagePaths?: string[]
  merchantName?: string
  merchantAddress?: string
  tasteRating?: number
  suitableForFatLoss?: boolean
  userTags?: string[]
  userNotes?: string
  latitude?: number
  longitude?: number
  province?: string
  city?: string
  district?: string
  detailAddress?: string
  type?: string
  isCampusFood?: boolean
  schoolName?: string
  campusName?: string
  canteenName?: string
  floor?: string
  windowName?: string
  price?: number
  priceType?: string
  priceMin?: number
  priceMax?: number
  priceUnit?: string
  priceCollectedAt?: string
  portionDescription?: string
  campusLocationText?: string
}

export type FeedReportReason = 'spam' | 'inappropriate' | 'false_information' | 'harassment' | 'other'
export type PrivateMessageReportReason = 'spam' | 'porn' | 'illegal' | 'abuse' | 'other'

export interface PackagedFoodInput {
  brand?: string
  productName: string
  displayName?: string
  barcode?: string
  specText?: string
  flavorText?: string
  packageCategory?: string
  sourceImageUrls: string[]
  ocrRawText?: string
  extractConfidence?: number
  fieldConfidence?: Record<string, unknown>
  ingestMethod?: string
  reviewStatus?: string
  energyUnitRaw?: string
  rawLabelPayload?: Record<string, unknown>
  conversionStatus?: string
  ingredientsText?: string
  nutritionBasisUnit?: string
  netWeightG?: number
  servingWeightG?: number
  kcalPer100g?: number
  proteinPer100g?: number
  carbsPer100g?: number
  fatPer100g?: number
  fiberPer100g?: number
  sugarPer100g?: number
  saturatedFatPer100g?: number
  cholesterolMgPer100g?: number
  sodiumMgPer100g?: number
  potassiumMgPer100g?: number
  calciumMgPer100g?: number
  ironMgPer100g?: number
  magnesiumMgPer100g?: number
  zincMgPer100g?: number
  vitaminARaeMcgPer100g?: number
  vitaminCMgPer100g?: number
  vitaminDMcgPer100g?: number
  vitaminEMgPer100g?: number
  vitaminKMcgPer100g?: number
  thiaminMgPer100g?: number
  riboflavinMgPer100g?: number
  niacinMgPer100g?: number
  vitaminB6MgPer100g?: number
  folateMcgPer100g?: number
  vitaminB12McgPer100g?: number
}

export interface DietRecommendationInput {
  scene?: string
  date?: string
  calorie_remaining?: number
  macro_gaps?: Record<string, number>
  targets?: Record<string, number>
  current?: Record<string, number>
  meals?: Array<Record<string, unknown>>
  user_goal?: string
  preference_context?: string
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
    await this.storeLoginTokens(data)
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
    await this.storeLoginTokens(data)
    return data
  }

  async loginWithAppWechat(input: AppWechatLoginInput): Promise<LoginResponse> {
    const code = input.code.trim()
    if (!code) throw new Error('缺少微信授权 code')
    const body: Record<string, string> = { code }
    if (input.inviteCode?.trim()) body.inviteCode = input.inviteCode.trim()
    const data = await this.publicRequest<LoginResponse>('/api/app/login/wechat', {
      method: 'POST',
      body,
      timeoutMs: 10000,
    })
    await this.storeLoginTokens(data)
    return data
  }

  async loginWithPassword(input: PasswordLoginInput): Promise<LoginResponse> {
    const phone = input.phone.trim()
    const password = input.password.trim()
    if (!phone) throw new Error('请输入手机号')
    if (!password) throw new Error('请输入密码')
    const data = await this.publicRequest<LoginResponse>('/api/app/login/password', {
      method: 'POST',
      body: { phone, password },
      timeoutMs: 10000,
    })
    await this.storeLoginTokens(data)
    return data
  }

  async sendSMSCode(input: SMSCodeInput): Promise<SMSCodeResponse> {
    const phone = input.phone.trim()
    if (!phone) throw new Error('请输入手机号')
    return this.publicRequest<SMSCodeResponse>('/api/app/sms/send-code', {
      method: 'POST',
      body: { phone },
      timeoutMs: 10000,
    })
  }

  async loginWithSMSCode(input: SMSLoginInput): Promise<LoginResponse> {
    const phone = input.phone.trim()
    const code = input.code.trim()
    const inviteCode = input.inviteCode?.trim()
    if (!phone) throw new Error('请输入手机号')
    if (!code) throw new Error('请输入验证码')
    const body: Record<string, string> = { phone, code }
    if (inviteCode) body.inviteCode = inviteCode
    const data = await this.publicRequest<LoginResponse>('/api/app/login/sms', {
      method: 'POST',
      body,
      timeoutMs: 10000,
    })
    await this.storeLoginTokens(data)
    return data
  }

  async registerWithPassword(input: PasswordRegisterInput): Promise<LoginResponse> {
    const phone = input.phone.trim()
    const password = input.password.trim()
    const nickname = input.nickname?.trim()
    const inviteCode = input.inviteCode?.trim()
    if (!phone) throw new Error('请输入手机号')
    if (!password) throw new Error('请输入密码')
    const body: Record<string, string> = { phone, password }
    if (nickname) body.nickname = nickname
    if (inviteCode) body.inviteCode = inviteCode
    const data = await this.publicRequest<LoginResponse>('/api/app/register/password', {
      method: 'POST',
      body,
      timeoutMs: 10000,
    })
    await this.storeLoginTokens(data)
    return data
  }

  async setAccountPassword(input: SetAccountPasswordInput): Promise<LoginResponse> {
    const phone = input.phone?.trim()
    const password = input.password.trim()
    const currentPassword = input.currentPassword?.trim()
    if (!password) throw new Error('请输入新密码')
    const body: Record<string, string> = { password }
    if (phone) body.phone = phone
    if (currentPassword) body.current_password = currentPassword
    const data = await this.authenticatedRequest<LoginResponse>('/api/app/account/password', {
      method: 'POST',
      body,
      timeoutMs: 10000,
    })
    await this.storeLoginTokens(data)
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

  async listMembershipPlans(): Promise<{ list: MembershipPlan[] }> {
    return this.publicRequest<{ list: MembershipPlan[] }>('/api/membership/plans', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async createMembershipPayment(planCode: string): Promise<MembershipPaymentOrder> {
    const code = planCode.trim()
    if (!code) throw new Error('请选择会员套餐')
    return this.authenticatedRequest<MembershipPaymentOrder>('/api/membership/pay/create', {
      method: 'POST',
      body: { plan_code: code },
      timeoutMs: 20000,
    })
  }

  async syncMembershipPayment(orderNo: string): Promise<Record<string, unknown>> {
    const order = orderNo.trim()
    if (!order) throw new Error('缺少订单号')
    return this.authenticatedRequest<Record<string, unknown>>('/api/membership/pay/sync', {
      method: 'POST',
      body: { order_no: order },
      timeoutMs: 20000,
    })
  }

  async submitTextTask(input: SubmitTextTaskInput): Promise<{ task_id: string; message: string }> {
    const text = input.text.trim()
    const additionalContext = input.additionalContext?.trim()
    if (!text && !additionalContext) throw new Error('请输入食物描述')
    const data = await this.authenticatedRequest<Record<string, unknown>>('/api/analyze-text/submit', {
      method: 'POST',
      body: {
        text,
        text_input: text,
        meal_type: input.mealType,
        date: mapCalendarDateToApi(input.date),
        additionalContext,
        execution_mode: input.executionMode,
      },
      timeoutMs: 10000,
    })
    const taskId = String(data.task_id ?? data.taskId ?? '').trim()
    const message = String(data.message ?? '任务已提交')
    if (!taskId) throw new Error('服务端未返回识别进度信息')
    return { task_id: taskId, message }
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
    const data = this.unwrapResponseData<UploadAnalyzeImageResponse>(res.data)
    const imageUrl = String(data.imageUrl || data.image_url || data.url || '').trim()
    if (!imageUrl) {
      throw new Error('服务器未返回图片地址')
    }
    return { imageUrl }
  }

  async uploadCirclePostImageFile(input: {
    fileUri: string
    fileName?: string
    mimeType?: string
  }): Promise<{ imageUrl: string }> {
    const token = await this.adapters.tokenStorage.getAccessToken()
    if (!token) throw new Error('请先登录')

    const res = await this.adapters.uploadFile({
      url: `${this.baseUrl}/api/community/posts/upload-image`,
      fileUri: input.fileUri,
      fieldName: 'file',
      fileName: input.fileName || 'circle-post.jpg',
      mimeType: input.mimeType || 'image/jpeg',
      timeoutMs: 30000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    this.assertOk(res, '上传动态图片失败')
    const data = this.unwrapResponseData<UploadAnalyzeImageResponse>(res.data)
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
      throw new Error('服务器未返回识别进度信息，请稍后重试')
    }
    return { task_id: taskId, message }
  }

  async classifyGooseDuckChicken(input: GooseDuckChickenClassifyInput): Promise<GooseDuckChickenClassifyResult> {
    const imageUrl = input.imageUrl.trim()
    if (!imageUrl) throw new Error('请先上传一张图片')
    const additionalContext = input.additionalContext?.trim()
    const data = await this.authenticatedRequest<Record<string, unknown>>('/api/analyze/goose-duck-chicken', {
      method: 'POST',
      body: {
        image_url: imageUrl,
        additional_context: additionalContext || undefined,
      },
      timeoutMs: 30000,
    })
    const rawSpecies = String(data.species || '').trim().toLowerCase()
    const species: GooseDuckChickenSpecies = rawSpecies === 'goose' || rawSpecies === 'duck' || rawSpecies === 'chicken' ? rawSpecies : 'unknown'
    const evidence = Array.isArray(data.evidence)
      ? data.evidence.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
      : []
    return {
      species,
      label: String(data.label || speciesLabel(species)).trim() || '不确定',
      confidence: normalizeConfidence(data.confidence),
      reason: String(data.reason || '').trim(),
      evidence,
    }
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

  async saveManualFoodRecord(input: ManualFoodRecordInput): Promise<{ id: string; message: string; already_saved?: boolean }> {
    return this.saveFoodRecord(buildManualFoodRecordPayload(input))
  }

  async saveManualFoodRecords(input: ManualFoodRecordsInput): Promise<{ id: string; message: string; already_saved?: boolean }> {
    return this.saveFoodRecord(buildManualFoodRecordsPayload(input))
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

  buildFoodRecordShareUrl(recordId: string): string {
    const id = recordId.trim()
    if (!id) throw new Error('缺少饮食记录 ID')
    return this.absoluteUrl(`/share/food-record/${encodeURIComponent(id)}`)
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

  async claimSharePosterReward(input: SharePosterRewardClaimInput): Promise<SharePosterRewardClaimResult> {
    const recordId = input.recordId?.trim()
    const shareScope = input.shareScope?.trim()
    const shareDate = input.shareDate?.trim()
    return this.authenticatedRequest<SharePosterRewardClaimResult>('/api/membership/rewards/share-poster/claim', {
      method: 'POST',
      body: {
        record_id: recordId || undefined,
        share_scope: recordId ? undefined : shareScope,
        share_date: recordId ? undefined : shareDate,
      },
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

  async getAnalyzeTaskCount(): Promise<{ count: number }> {
    return this.authenticatedRequest<{ count: number }>('/api/analyze/tasks/count', {
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

  async updateUserProfile(input: Partial<UserInfo>): Promise<UserInfo> {
    return this.authenticatedRequest<UserInfo>('/api/user/profile', {
      method: 'PUT',
      body: input,
      timeoutMs: 10000,
    })
  }

  async uploadUserAvatar(input: UploadBase64ImageInput): Promise<{ imageUrl: string }> {
    const image = input.base64Image.trim()
    if (!image) throw new Error('请选择头像图片')
    return this.authenticatedRequest<{ imageUrl: string }>('/api/user/upload-avatar', {
      method: 'POST',
      body: { base64Image: image },
      timeoutMs: 30000,
    })
  }

  async uploadUserCoverImage(input: UploadBase64ImageInput): Promise<{ imageUrl: string }> {
    const image = input.base64Image.trim()
    if (!image) throw new Error('请选择主页背景图片')
    return this.authenticatedRequest<{ imageUrl: string }>('/api/user/upload-cover', {
      method: 'POST',
      body: { base64Image: image },
      timeoutMs: 30000,
    })
  }

  async deleteAccount(): Promise<{ message?: string }> {
    return this.authenticatedRequest<{ message?: string }>('/api/user/account', {
      method: 'DELETE',
      timeoutMs: 15000,
    })
  }

  async getHealthProfile(): Promise<HealthProfile> {
    return this.authenticatedRequest<HealthProfile>('/api/user/health-profile', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async updateHealthProfile(input: HealthProfileInput): Promise<HealthProfile> {
    return this.authenticatedRequest<HealthProfile>('/api/user/health-profile', {
      method: 'PUT',
      body: input,
      timeoutMs: 10000,
    })
  }

  async uploadHealthReportImage(input: UploadBase64ImageInput): Promise<{ imageUrl: string }> {
    const image = input.base64Image.trim()
    if (!image) throw new Error('请选择报告图片')
    return this.authenticatedRequest<{ imageUrl: string }>('/api/user/health-profile/upload-report-image', {
      method: 'POST',
      body: { base64Image: image },
      timeoutMs: 30000,
    })
  }

  async submitReportExtractionTask(input: SubmitReportExtractionTaskInput): Promise<{ taskId: string }> {
    const imageUrls = (input.imageUrls || []).map((url) => url.trim()).filter(Boolean)
    const imageUrl = input.imageUrl?.trim() || imageUrls[0]
    if (!imageUrl && imageUrls.length === 0) throw new Error('请至少上传一张报告图片')
    return this.authenticatedRequest<{ taskId: string }>('/api/user/health-profile/submit-report-extraction-task', {
      method: 'POST',
      body: {
        imageUrl,
        imageUrls,
      },
      timeoutMs: 15000,
    })
  }

  async getDashboardTargets(): Promise<Record<string, number>> {
    return this.authenticatedRequest<Record<string, number>>('/api/user/dashboard-targets', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async updateDashboardTargets(input: DashboardTargetsInput): Promise<Record<string, number>> {
    return this.authenticatedRequest<Record<string, number>>('/api/user/dashboard-targets', {
      method: 'PUT',
      body: input,
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

  async generateStatsInsight(range: StatsRange): Promise<StatsInsightResult> {
    return this.authenticatedRequest<StatsInsightResult>('/api/stats/insight/generate', {
      method: 'POST',
      body: { range },
      timeoutMs: 30000,
    })
  }

  async saveStatsInsight(range: StatsRange, content: string): Promise<{ message: string }> {
    const text = content.trim()
    if (!text) throw new Error('缺少分析内容')
    return this.authenticatedRequest<{ message: string }>('/api/stats/insight/save', {
      method: 'POST',
      body: { range, content: text },
      timeoutMs: 10000,
    })
  }

  async generateCustomFocusCard(range: StatsRange, focusId: string): Promise<StatsCustomFocusResult> {
    return this.authenticatedRequest<StatsCustomFocusResult>('/api/stats/custom-focus/generate', {
      method: 'POST',
      body: { range, focus_id: focusId },
      timeoutMs: 30000,
    })
  }

  async generateDietRecommendation(input: DietRecommendationInput): Promise<DietRecommendationResult> {
    return this.authenticatedRequest<DietRecommendationResult>('/api/diet/recommendations', {
      method: 'POST',
      body: input,
      timeoutMs: 30000,
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

  async resetBodyWaterLogs(date?: string): Promise<{ message: string; deleted_count?: number; date?: string }> {
    return this.authenticatedRequest<{ message: string; deleted_count?: number; date?: string }>('/api/body-metrics/water/reset', {
      method: 'POST',
      body: { date: mapCalendarDateToApi(date) },
      timeoutMs: 10000,
    })
  }

  async deleteBodyWaterLog(logId: string): Promise<{ message: string; deleted_count?: number; id?: string }> {
    const id = logId.trim()
    if (!id) throw new Error('缺少喝水记录 ID')
    return this.authenticatedRequest<{ message: string; deleted_count?: number; id?: string }>(
      `/api/body-metrics/water/${encodeURIComponent(id)}`,
      { method: 'DELETE', timeoutMs: 10000 },
    )
  }

  async saveBodyWeightRecord(value: number, date?: string, clientId?: string): Promise<{ message: string }> {
    return this.authenticatedRequest<{ message: string }>('/api/body-metrics/weight', {
      method: 'POST',
      body: { value, date: mapCalendarDateToApi(date), client_id: clientId },
      timeoutMs: 10000,
    })
  }

  async deleteBodyWeightRecord(recordId: string): Promise<{ message: string; deleted_count?: number; id?: string }> {
    const id = recordId.trim()
    if (!id) throw new Error('缺少体重记录 ID')
    return this.authenticatedRequest<{ message: string; deleted_count?: number; id?: string }>(
      `/api/body-metrics/weight/${encodeURIComponent(id)}`,
      { method: 'DELETE', timeoutMs: 10000 },
    )
  }

  async createExerciseLog(input: { exerciseDesc: string; date?: string; imageUrl?: string }): Promise<Record<string, unknown>> {
    const exerciseDesc = input.exerciseDesc.trim()
    const imageUrl = input.imageUrl?.trim()
    if (!exerciseDesc && !imageUrl) throw new Error('请输入运动内容或上传运动截图')
    return this.authenticatedRequest<Record<string, unknown>>('/api/exercise-logs', {
      method: 'POST',
      body: {
        exercise_desc: exerciseDesc,
        date: mapCalendarDateToApi(input.date),
        image_url: imageUrl,
      },
      timeoutMs: 20000,
    })
  }

  async estimateExerciseCalories(exerciseDesc: string): Promise<Record<string, unknown>> {
    const text = exerciseDesc.trim()
    if (!text) throw new Error('请输入运动内容')
    return this.authenticatedRequest<Record<string, unknown>>('/api/exercise-logs/estimate-calories', {
      method: 'POST',
      body: { exercise_desc: text },
      timeoutMs: 20000,
    })
  }

  async deleteExerciseLog(logId: string): Promise<{ message: string }> {
    const id = logId.trim()
    if (!id) throw new Error('缺少运动记录 ID')
    return this.authenticatedRequest<{ message: string }>(
      `/api/exercise-logs/${encodeURIComponent(id)}`,
      { method: 'DELETE', timeoutMs: 10000 },
    )
  }

  async getManualFoodBrowse(limit = 20): Promise<ManualFoodBrowseResult> {
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)))
    return this.authenticatedRequest<ManualFoodBrowseResult>(`/api/manual-food/browse?limit=${safeLimit}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getManualFoodCatalog(category: string, options?: ManualFoodCatalogOptions): Promise<ManualFoodCatalogResult> {
    const safePage = Math.max(1, Math.floor(options?.page || 1))
    const safePageSize = Math.min(60, Math.max(1, Math.floor(options?.pageSize || 30)))
    const params = new URLSearchParams({
      category: category.trim() || 'common',
      page: String(safePage),
      page_size: String(safePageSize),
    })
    return this.authenticatedRequest<ManualFoodCatalogResult>(
      `/api/manual-food/catalog?${params.toString()}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async searchManualFood(keyword: string, limit = 20, options?: ManualFoodSearchOptions): Promise<{ results: ManualFoodItem[] }> {
    const q = keyword.trim()
    if (!q) return { results: [] }
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)))
    const params = new URLSearchParams({ q, limit: String(safeLimit) })
    if (options?.source?.trim()) params.set('source', options.source.trim())
    return this.authenticatedRequest<{ results: ManualFoodItem[] }>(
      `/api/manual-food/search?${params.toString()}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async getCustomFoods(limit = 60): Promise<{ items: ManualFoodItem[]; has_more?: boolean }> {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
    return this.authenticatedRequest<{ items: ManualFoodItem[]; has_more?: boolean }>(
      `/api/manual-food/custom?limit=${safeLimit}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async saveCustomFood(input: SaveCustomFoodInput): Promise<ManualFoodItem> {
    const title = input.title.trim()
    if (!title) throw new Error('请输入食物名称')
    const calories = normalizeNumber(input.totalCalories)
    const protein = normalizeNumber(input.totalProtein)
    const carbs = normalizeNumber(input.totalCarbs)
    const fat = normalizeNumber(input.totalFat)
    const nutrientsPer100g = input.nutrientsPer100g || { calories, protein, carbs, fat }
    const imagePaths = (input.imagePaths || []).map((url) => url.trim()).filter(Boolean)
    const imagePath = input.imagePath?.trim() || imagePaths[0]
    const data = await this.authenticatedRequest<{ item?: ManualFoodItem } | ManualFoodItem>('/api/manual-food/custom', {
      method: 'POST',
      body: {
        title,
        default_weight_grams: normalizeNumber(input.defaultWeightGrams) || 100,
        total_calories: calories,
        total_protein: protein,
        total_carbs: carbs,
        total_fat: fat,
        nutrients_per_100g: nutrientsPer100g,
        extra_nutrients: input.extraNutrients || nutrientsPer100g,
        ...(imagePath ? { image_path: imagePath } : {}),
        ...(imagePaths.length ? { image_paths: imagePaths } : {}),
        portion_label: input.portionLabel?.trim(),
        recommend_reason: input.recommendReason?.trim(),
        share_to_public: Boolean(input.shareToPublic),
      },
      timeoutMs: 10000,
    })
    if (data && typeof data === 'object' && 'item' in data) {
      const wrapped = data as { item?: ManualFoodItem }
      if (wrapped.item) return wrapped.item
    }
    return data as ManualFoodItem
  }

  async createPackagedFood(input: PackagedFoodInput): Promise<{ item: PackagedFoodItem }> {
    if (!input.productName.trim()) throw new Error('请输入商品名称')
    if (!input.sourceImageUrls.map((url) => url.trim()).filter(Boolean).length) throw new Error('请至少填写一张包装图片地址')
    return this.authenticatedRequest<{ item: PackagedFoodItem }>('/api/packaged-food', {
      method: 'POST',
      body: packagedFoodPayload(input),
      timeoutMs: 15000,
    })
  }

  async recognizePackagedNutritionLabel(imageUrl: string): Promise<{ nutrition: PackagedNutritionLabelResult }> {
    const url = imageUrl.trim()
    if (!url) throw new Error('请填写图片地址')
    return this.authenticatedRequest<{ nutrition: PackagedNutritionLabelResult }>('/api/packaged-food/nutrition-label/recognize', {
      method: 'POST',
      body: { image_url: url },
      timeoutMs: 30000,
    })
  }

  async submitPackagedNutritionLabelTask(imageUrl: string): Promise<{ task_id: string; message: string }> {
    const url = imageUrl.trim()
    if (!url) throw new Error('请填写图片地址')
    return this.authenticatedRequest<{ task_id: string; message: string }>('/api/packaged-food/nutrition-label/submit', {
      method: 'POST',
      body: { image_url: url },
      timeoutMs: 15000,
    })
  }

  async submitPackagedProductExtractTask(input: {
    imageUrls: string[]
    sourceTaskId?: string
    recognizedNameHint?: string
  }): Promise<{ task_id: string; message: string }> {
    const imageUrls = input.imageUrls.map((url) => url.trim()).filter(Boolean)
    if (!imageUrls.length) throw new Error('请至少填写一张包装图片地址')
    return this.authenticatedRequest<{ task_id: string; message: string }>('/api/packaged-food/extract/submit', {
      method: 'POST',
      body: {
        image_urls: imageUrls,
        source_task_id: input.sourceTaskId?.trim(),
        recognized_name_hint: input.recognizedNameHint?.trim(),
      },
      timeoutMs: 15000,
    })
  }

  async getPackagedProductExtractTask(taskId: string): Promise<AnalysisTask & { packaged_product?: PackagedProductExtractResult }> {
    const task = await this.getAnalyzeTask(taskId)
    return { ...task, packaged_product: extractPackagedProductFromTask(task) }
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
    params?: CommunityFeedQueryParams
  }): Promise<{ list: CommunityFeedItem[]; has_more?: boolean }> {
    const q = this.buildCommunityFeedQuery(options)
    return this.publicRequest<{ list: CommunityFeedItem[]; has_more?: boolean }>(`/api/community/public-feed?${q}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async communitySearch(params: {
    keyword: string
    tab?: CommunitySearchTab
    offset?: number
    limit?: number
  }): Promise<CommunitySearchResult> {
    const keyword = params.keyword.trim()
    if (!keyword) return { list: [], has_more: false, content_count: 0, user_count: 0 }
    const q = new URLSearchParams()
    q.set('keyword', keyword)
    if (params.tab) q.set('tab', params.tab)
    if (params.offset != null) q.set('offset', String(Math.max(0, Math.floor(params.offset))))
    if (params.limit != null) q.set('limit', String(safeLimit(params.limit)))
    return this.authenticatedRequest<CommunitySearchResult>(`/api/community/search?${q.toString()}`, {
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

  async communityGetContext(targetId: string, targetType: CommunityFeedTargetType = 'food_record'): Promise<{ item: CommunityFeedContext }> {
    return this.authenticatedRequest<{ item: CommunityFeedContext }>(this.communityFeedTargetPath(targetId, targetType, 'context'), {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async communityAddComment(input: {
    targetId: string
    targetType?: CommunityFeedTargetType
    content: string
    parentCommentId?: string
    replyToUserId?: string
  }): Promise<{ comment: FeedCommentItem }> {
    const content = input.content.trim()
    if (!content) throw new Error('请输入评论内容')
    return this.authenticatedRequest<{ comment: FeedCommentItem }>(
      this.communityFeedTargetPath(input.targetId, input.targetType || 'food_record', 'comments'),
      {
        method: 'POST',
        body: {
          content,
          parent_comment_id: input.parentCommentId,
          reply_to_user_id: input.replyToUserId,
        },
        timeoutMs: 10000,
      },
    )
  }

  async communityReport(input: {
    targetId: string
    targetType?: CommunityFeedTargetType
    reason: FeedReportReason
    extraContent?: string
  }): Promise<{ id: string; status: string }> {
    return this.authenticatedRequest<{ id: string; status: string }>(
      this.communityFeedTargetPath(input.targetId, input.targetType || 'food_record', 'report'),
      {
        method: 'POST',
        body: {
          reason: input.reason,
          extra_content: input.extraContent?.trim() || '',
        },
        timeoutMs: 10000,
      },
    )
  }

  async createCirclePost(input: CreateCirclePostInput): Promise<{ id: string }> {
    const title = input.title.trim()
    const body = input.body.trim()
    if (!title && !body && !input.imageUrls?.length) throw new Error('请输入动态内容')
    return this.authenticatedRequest<{ id: string }>('/api/community/posts', {
      method: 'POST',
      body: circlePostPayload({ title, body, imageUrls: input.imageUrls, nutrition: input.nutrition }),
      timeoutMs: 15000,
    })
  }

  async updateCirclePost(postId: string, input: CreateCirclePostInput): Promise<{ id: string }> {
    const id = postId.trim()
    if (!id) throw new Error('缺少动态 ID')
    const title = input.title.trim()
    const body = input.body.trim()
    if (!title && !body && !input.imageUrls?.length) throw new Error('请输入动态内容')
    return this.authenticatedRequest<{ id: string }>(`/api/community/posts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: circlePostPayload({ title, body, imageUrls: input.imageUrls, nutrition: input.nutrition }),
      timeoutMs: 15000,
    })
  }

  async deleteCirclePost(postId: string): Promise<{ message: string }> {
    const id = postId.trim()
    if (!id) throw new Error('缺少动态 ID')
    return this.authenticatedRequest<{ message: string }>(`/api/community/posts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async listCommunityNotifications(params: number | CommunityNotificationListParams = 50): Promise<CommunityNotificationListResult> {
    const options = typeof params === 'number' ? { limit: params } : params
    const q = new URLSearchParams()
    q.set('limit', String(safeLimit(options.limit ?? 50)))
    if (options.offset != null) q.set('offset', String(Math.max(0, Math.floor(options.offset))))
    const notificationType = options.type?.trim()
    if (notificationType) q.set('type', notificationType)
    return this.authenticatedRequest<CommunityNotificationListResult>(
      `/api/community/notifications?${q.toString()}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async markCommunityNotificationsRead(notificationIds: string[] = []): Promise<{ updated: number; unread_count: number }> {
    return this.authenticatedRequest<{ updated: number; unread_count: number }>('/api/community/notifications/read', {
      method: 'POST',
      body: { notification_ids: notificationIds },
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

  async listFoodExpiryItems(status = ''): Promise<{ items: FoodExpiryItem[] }> {
    const query = status.trim() ? `?status=${encodeURIComponent(status.trim())}` : ''
    return this.authenticatedRequest<{ items: FoodExpiryItem[] }>(`/api/expiry/items${query}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getFoodExpiryItem(itemId: string): Promise<{ item: FoodExpiryItem }> {
    const id = itemId.trim()
    if (!id) throw new Error('缺少保质期条目 ID')
    return this.authenticatedRequest<{ item: FoodExpiryItem }>(`/api/expiry/items/${encodeURIComponent(id)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async createFoodExpiryItem(input: CreateExpiryItemInput): Promise<{ message: string; item: FoodExpiryItem }> {
    const foodName = input.foodName.trim()
    const expireDate = input.expireDate.trim()
    if (!foodName) throw new Error('请输入食物名称')
    if (!expireDate) throw new Error('请输入到期日期')
    return this.authenticatedRequest<{ message: string; item: FoodExpiryItem }>('/api/expiry/items', {
      method: 'POST',
      body: {
        food_name: foodName,
        category: input.category?.trim(),
        expire_date: expireDate,
        quantity_note: input.quantityNote?.trim(),
        storage_type: input.storageType?.trim() || 'refrigerated',
        note: input.note?.trim(),
        source_type: 'manual',
        status: 'active',
      },
      timeoutMs: 10000,
    })
  }

  async updateFoodExpiryItem(itemId: string, input: UpdateExpiryItemInput): Promise<{ message: string; item: FoodExpiryItem }> {
    const id = itemId.trim()
    if (!id) throw new Error('缺少保质期条目 ID')
    const body: Record<string, unknown> = {}
    if (input.foodName !== undefined) {
      const foodName = input.foodName.trim()
      if (!foodName) throw new Error('请输入食物名称')
      body.food_name = foodName
    }
    if (input.category !== undefined) body.category = input.category.trim()
    if (input.expireDate !== undefined) {
      const expireDate = input.expireDate.trim()
      if (!expireDate) throw new Error('请输入到期日期')
      body.expire_date = expireDate
    }
    if (input.quantityNote !== undefined) body.quantity_note = input.quantityNote.trim()
    if (input.storageType !== undefined) body.storage_type = input.storageType.trim() || 'refrigerated'
    if (input.note !== undefined) body.note = input.note.trim()
    if (input.status !== undefined) body.status = input.status
    return this.authenticatedRequest<{ message: string; item: FoodExpiryItem }>(
      `/api/expiry/items/${encodeURIComponent(id)}`,
      { method: 'PUT', body, timeoutMs: 10000 },
    )
  }

  async updateFoodExpiryStatus(itemId: string, status: 'active' | 'consumed' | 'discarded' | string): Promise<{ message: string; item: FoodExpiryItem }> {
    return this.authenticatedRequest<{ message: string; item: FoodExpiryItem }>(
      `/api/expiry/items/${encodeURIComponent(itemId)}/status`,
      { method: 'POST', body: { status }, timeoutMs: 10000 },
    )
  }

  async listRecipes(params?: { mealType?: MealType; isFavorite?: boolean }): Promise<{ recipes: RecipeItem[] }> {
    const q = new URLSearchParams()
    if (params?.mealType) q.set('meal_type', params.mealType)
    if (params?.isFavorite != null) q.set('is_favorite', String(params.isFavorite))
    const query = q.toString()
    return this.authenticatedRequest<{ recipes: RecipeItem[] }>(`/api/recipes${query ? `?${query}` : ''}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getFavoriteCount(): Promise<{ count: number }> {
    return this.authenticatedRequest<{ count: number }>('/api/recipes/count?is_favorite=true', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getRecipe(recipeId: string): Promise<RecipeItem> {
    const id = recipeId.trim()
    if (!id) throw new Error('缺少食谱 ID')
    return this.authenticatedRequest<RecipeItem>(`/api/recipes/${encodeURIComponent(id)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async createRecipe(input: RecipeInput): Promise<{ id: string; message: string }> {
    const recipeName = input.recipeName.trim()
    if (!recipeName) throw new Error('请输入食谱名称')
    return this.authenticatedRequest<{ id: string; message: string }>('/api/recipes', {
      method: 'POST',
      body: recipePayload(input),
      timeoutMs: 10000,
    })
  }

  async updateRecipe(recipeId: string, input: Partial<RecipeInput>): Promise<{ message: string; recipe: RecipeItem }> {
    const id = recipeId.trim()
    if (!id) throw new Error('缺少食谱 ID')
    return this.authenticatedRequest<{ message: string; recipe: RecipeItem }>(`/api/recipes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: recipePayload(input),
      timeoutMs: 10000,
    })
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(`/api/recipes/${encodeURIComponent(recipeId)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async useRecipe(recipeId: string, mealType?: MealType): Promise<{ message: string; record_id: string }> {
    return this.authenticatedRequest<{ message: string; record_id: string }>(`/api/recipes/${encodeURIComponent(recipeId)}/use`, {
      method: 'POST',
      body: { meal_type: mealType, entry_type: 'favorite_recipe' },
      timeoutMs: 10000,
    })
  }

  async listPublicFoods(params?: PublicFoodListParams): Promise<{ list: PublicFoodItem[] }> {
    const q = buildPublicFoodQuery(params)
    return this.authenticatedRequest<{ list: PublicFoodItem[] }>(`/api/public-food-library${q ? `?${q}` : ''}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async listMyPublicFoods(): Promise<{ list: PublicFoodItem[] }> {
    return this.authenticatedRequest<{ list: PublicFoodItem[] }>('/api/public-food-library/mine', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async listCollectedPublicFoods(): Promise<{ list: PublicFoodItem[] }> {
    return this.authenticatedRequest<{ list: PublicFoodItem[] }>('/api/public-food-library/collections', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getPublicFood(itemId: string): Promise<PublicFoodItem> {
    return this.authenticatedRequest<PublicFoodItem>(`/api/public-food-library/${encodeURIComponent(itemId)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getCampusFoodDetail(itemId: string): Promise<CampusFoodDetail> {
    return this.authenticatedRequest<CampusFoodDetail>(`/api/public-food-library/${encodeURIComponent(itemId)}/campus-detail`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async createPublicFood(input: CreatePublicFoodInput): Promise<{ id: string; message: string }> {
    const foodName = input.foodName.trim()
    if (!foodName) throw new Error('请输入食物名称')
    return this.authenticatedRequest<{ id: string; message: string }>('/api/public-food-library', {
      method: 'POST',
      body: publicFoodPayload(input),
      timeoutMs: 10000,
    })
  }

  async updatePublicFood(itemId: string, input: Partial<CreatePublicFoodInput>): Promise<{ message: string; item: PublicFoodItem }> {
    const id = itemId.trim()
    if (!id) throw new Error('缺少食物 ID')
    return this.authenticatedRequest<{ message: string; item: PublicFoodItem }>(`/api/public-food-library/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: publicFoodPayload(input),
      timeoutMs: 10000,
    })
  }

  async deletePublicFood(itemId: string): Promise<void> {
    const id = itemId.trim()
    if (!id) throw new Error('缺少食物 ID')
    await this.authenticatedRequest<{ message?: string }>(`/api/public-food-library/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async publicFoodLike(itemId: string, liked: boolean): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(`/api/public-food-library/${encodeURIComponent(itemId)}/like`, {
      method: liked ? 'DELETE' : 'POST',
      timeoutMs: 10000,
    })
  }

  async publicFoodCollect(itemId: string, collected: boolean): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(`/api/public-food-library/${encodeURIComponent(itemId)}/collect`, {
      method: collected ? 'DELETE' : 'POST',
      timeoutMs: 10000,
    })
  }

  async listPublicFoodComments(itemId: string): Promise<{ list: PublicFoodComment[] }> {
    return this.authenticatedRequest<{ list: PublicFoodComment[] }>(`/api/public-food-library/${encodeURIComponent(itemId)}/comments`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async addPublicFoodComment(
    itemId: string,
    content: string,
    rating?: number,
    options?: { parentCommentId?: string; replyToUserId?: string },
  ): Promise<{ comment: PublicFoodComment }> {
    const text = content.trim()
    if (!text) throw new Error('请输入评论内容')
    return this.authenticatedRequest<{ comment: PublicFoodComment }>(`/api/public-food-library/${encodeURIComponent(itemId)}/comments`, {
      method: 'POST',
      body: {
        content: text,
        ...(rating !== undefined ? { rating } : {}),
        ...(options?.parentCommentId ? { parent_comment_id: options.parentCommentId } : {}),
        ...(options?.replyToUserId ? { reply_to_user_id: options.replyToUserId } : {}),
      },
      timeoutMs: 10000,
    })
  }

  async deletePublicFoodComment(itemId: string, commentId: string): Promise<{ message?: string }> {
    const item = itemId.trim()
    const comment = commentId.trim()
    if (!item || !comment) throw new Error('缺少评论 ID')
    return this.authenticatedRequest<{ message?: string }>(
      `/api/public-food-library/${encodeURIComponent(item)}/comments/${encodeURIComponent(comment)}`,
      {
        method: 'DELETE',
        timeoutMs: 10000,
      },
    )
  }

  async submitPublicFoodFeedback(itemId: string, content: string): Promise<{ id: string; message: string }> {
    const text = content.trim()
    if (!text) throw new Error('请输入反馈内容')
    return this.authenticatedRequest<{ id: string; message: string }>('/api/public-food-library/feedback', {
      method: 'POST',
      body: { library_item_id: itemId, content: text },
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

  async listFriends(): Promise<{ list: FriendUserItem[] }> {
    return this.authenticatedRequest<{ list: FriendUserItem[] }>('/api/friend/list', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getFriendCount(): Promise<{ count: number }> {
    return this.authenticatedRequest<{ count: number }>('/api/friend/count', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async searchFriends(input: string | { nickname?: string; telephone?: string }): Promise<{ list: FriendUserItem[] }> {
    const q = new URLSearchParams()
    if (typeof input === 'string') {
      const keyword = input.trim()
      if (!keyword) return { list: [] }
      q.set('nickname', keyword)
    } else {
      const nickname = input.nickname?.trim()
      const telephone = input.telephone?.trim()
      if (nickname) q.set('nickname', nickname)
      if (telephone) q.set('telephone', telephone)
      if (!nickname && !telephone) return { list: [] }
    }
    return this.authenticatedRequest<{ list: FriendUserItem[] }>(
      `/api/friend/search?${q.toString()}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async sendFriendRequest(toUserId: string): Promise<Record<string, unknown>> {
    const id = toUserId.trim()
    if (!id) throw new Error('缺少用户 ID')
    return this.authenticatedRequest<Record<string, unknown>>('/api/friend/request', {
      method: 'POST',
      body: { to_user_id: id },
      timeoutMs: 10000,
    })
  }

  async getFriendRequestsOverview(): Promise<{ received: FriendRequestItem[]; sent: FriendRequestItem[] }> {
    return this.authenticatedRequest<{ received: FriendRequestItem[]; sent: FriendRequestItem[] }>('/api/friend/requests/all', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async respondFriendRequest(requestId: string, action: 'accept' | 'reject'): Promise<Record<string, unknown>> {
    return this.authenticatedRequest<Record<string, unknown>>(
      `/api/friend/request/${encodeURIComponent(requestId)}/respond`,
      { method: 'POST', body: { action }, timeoutMs: 10000 },
    )
  }

  async cancelSentFriendRequest(requestId: string): Promise<Record<string, unknown>> {
    const id = requestId.trim()
    if (!id) throw new Error('缺少好友申请 ID')
    return this.authenticatedRequest<Record<string, unknown>>(`/api/friend/request/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async deleteFriend(friendId: string): Promise<Record<string, unknown>> {
    return this.authenticatedRequest<Record<string, unknown>>(`/api/friend/${encodeURIComponent(friendId)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async getPublicProfile(userId: string): Promise<PublicProfile> {
    return this.authenticatedRequest<PublicProfile>(`/api/user/${encodeURIComponent(userId)}/public-profile`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getFollowers(userId: string, offset = 0, limit = 20): Promise<FollowListResponse> {
    return this.authenticatedRequest<FollowListResponse>(
      `/api/user/${encodeURIComponent(userId)}/followers?offset=${Math.max(0, Math.floor(offset))}&limit=${safeLimit(limit)}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async getFollowing(userId: string, offset = 0, limit = 20): Promise<FollowListResponse> {
    return this.authenticatedRequest<FollowListResponse>(
      `/api/user/${encodeURIComponent(userId)}/following?offset=${Math.max(0, Math.floor(offset))}&limit=${safeLimit(limit)}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async getFollowStats(userId: string): Promise<FollowStats> {
    return this.authenticatedRequest<FollowStats>(`/api/user/${encodeURIComponent(userId)}/follow-stats`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async followUser(userId: string, following: boolean): Promise<void> {
    await this.authenticatedRequest<{ message?: string }>(`/api/user/${encodeURIComponent(userId)}/follow`, {
      method: following ? 'DELETE' : 'POST',
      timeoutMs: 10000,
    })
  }

  async getUserFavoriteRecipes(userId: string): Promise<{ recipes: RecipeItem[] }> {
    return this.authenticatedRequest<{ recipes: RecipeItem[] }>(`/api/user/${encodeURIComponent(userId)}/favorite-recipes`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getUserPublicFoodCollections(userId: string): Promise<{ list: PublicFoodItem[] }> {
    return this.authenticatedRequest<{ list: PublicFoodItem[] }>(`/api/user/${encodeURIComponent(userId)}/collections`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getInviteProfile(userId: string): Promise<FriendInviteProfile> {
    return this.publicRequest<FriendInviteProfile>(`/api/friend/invite/profile/${encodeURIComponent(userId)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getInviteProfileByCode(code: string): Promise<FriendInviteProfile> {
    const inviteCode = code.trim()
    if (!inviteCode) throw new Error('请输入邀请码')
    return this.publicRequest<FriendInviteProfile>(`/api/friend/invite/profile-by-code?code=${encodeURIComponent(inviteCode)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async resolveInvite(code: string): Promise<FriendInviteResolveResult> {
    const inviteCode = code.trim()
    if (!inviteCode) throw new Error('请输入邀请码')
    return this.authenticatedRequest<FriendInviteResolveResult>(`/api/friend/invite/resolve?code=${encodeURIComponent(inviteCode)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async acceptInvite(code: string): Promise<Record<string, unknown>> {
    const inviteCode = code.trim()
    if (!inviteCode) throw new Error('请输入邀请码')
    return this.authenticatedRequest<Record<string, unknown>>('/api/friend/invite/accept', {
      method: 'POST',
      body: { code: inviteCode },
      timeoutMs: 10000,
    })
  }

  async getPetSummary(date?: string): Promise<PetSummary> {
    const q = date ? `?date=${encodeURIComponent(mapCalendarDateToApi(date) ?? date)}` : ''
    return this.authenticatedRequest<PetSummary>(`/api/pet/summary${q}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async claimPetEvent(eventId: string): Promise<PetClaimResult> {
    const id = eventId.trim()
    if (!id) throw new Error('缺少事件 ID')
    return this.authenticatedRequest<PetClaimResult>(`/api/pet/events/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
      timeoutMs: 10000,
    })
  }

  async rerollPetAppearance(): Promise<{ pet: PetSummary['pet']; credits_cost: number; earned_credits_balance?: number }> {
    return this.authenticatedRequest<{ pet: PetSummary['pet']; credits_cost: number; earned_credits_balance?: number }>('/api/pet/reroll-appearance', {
      method: 'POST',
      timeoutMs: 10000,
    })
  }

  async selectPetAppearance(candidateId: string): Promise<{ pet: PetSummary['pet'] }> {
    const id = candidateId.trim()
    if (!id) throw new Error('请选择宠物形象')
    return this.authenticatedRequest<{ pet: PetSummary['pet'] }>('/api/pet/select-appearance', {
      method: 'POST',
      body: { candidate_id: id },
      timeoutMs: 10000,
    })
  }

  async estimatePetChat(question: string, range: StatsRange = 'week'): Promise<PetChatEstimateResponse> {
    const text = question.trim()
    if (!text) throw new Error('请输入想问伙伴的问题')
    return this.authenticatedRequest<PetChatEstimateResponse>('/api/pet/chat/estimate', {
      method: 'POST',
      body: { question: text, range },
      timeoutMs: 10000,
    })
  }

  async generatePetChat(question: string, range: StatsRange = 'week', sessionId = '', newSession = false): Promise<PetChatResponse> {
    const text = question.trim()
    if (!text) throw new Error('请输入想问伙伴的问题')
    return this.authenticatedRequest<PetChatResponse>('/api/pet/chat', {
      method: 'POST',
      body: { question: text, range, session_id: sessionId.trim(), new_session: newSession },
      timeoutMs: 30000,
    })
  }

  async getLatestPetChatSession(): Promise<PetChatHistoryResponse> {
    return this.authenticatedRequest<PetChatHistoryResponse>('/api/pet/chat/latest', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async listPetChatSessions(): Promise<PetChatSessionsResponse> {
    return this.authenticatedRequest<PetChatSessionsResponse>('/api/pet/chat/sessions', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getPetChatSession(sessionId: string): Promise<PetChatHistoryResponse> {
    const id = sessionId.trim()
    if (!id) throw new Error('缺少对话 ID')
    return this.authenticatedRequest<PetChatHistoryResponse>(`/api/pet/chat/sessions/${encodeURIComponent(id)}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async listConversations(params: number | ConversationListParams = 50): Promise<ConversationListResult> {
    const raw = typeof params === 'number' ? { limit: params } : params
    const q = new URLSearchParams()
    q.set('offset', String(Math.max(0, Math.floor(raw.offset ?? 0))))
    q.set('limit', String(safeLimit(raw.limit ?? 50)))
    return this.authenticatedRequest<ConversationListResult>(`/api/messages/conversations?${q.toString()}`, {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async getConversation(userId: string, offset = 0, limit = 40): Promise<{ list: PrivateMessageItem[]; has_more?: boolean; offset?: number }> {
    const safeOffset = Math.max(0, Math.floor(offset))
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
    return this.authenticatedRequest<{ list: PrivateMessageItem[]; has_more?: boolean; offset?: number }>(
      `/api/messages/conversation/${encodeURIComponent(userId)}?offset=${safeOffset}&limit=${safeLimit}`,
      { method: 'GET', timeoutMs: 10000 },
    )
  }

  async sendPrivateMessage(receiverId: string, input: string | SendPrivateMessageInput): Promise<PrivateMessageItem> {
    const body = typeof input === 'string'
      ? { content: input, contentType: 'text' }
      : input
    const contentType = (body.contentType || 'text').trim() || 'text'
    const text = (body.content || '').trim()
    const imageUrl = (body.imageUrl || '').trim()
    if (contentType === 'image') {
      if (!imageUrl) throw new Error('请选择要发送的图片')
    } else if (!text) {
      throw new Error('请输入消息内容')
    }
    return this.authenticatedRequest<PrivateMessageItem>('/api/messages/send', {
      method: 'POST',
      body: {
        receiver_id: receiverId,
        content: text,
        content_type: contentType,
        ...(imageUrl ? { image_url: imageUrl } : {}),
      },
      timeoutMs: 10000,
    })
  }

  async markConversationRead(userId: string): Promise<{ success: boolean }> {
    return this.authenticatedRequest<{ success: boolean }>(`/api/messages/read/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      timeoutMs: 10000,
    })
  }

  async deletePrivateMessage(messageId: string): Promise<{ message?: string }> {
    const id = messageId.trim()
    if (!id) throw new Error('消息 ID 不能为空')
    return this.authenticatedRequest<{ message?: string }>(`/api/messages/message/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      timeoutMs: 10000,
    })
  }

  async reportPrivateMessage(messageId: string, input: ReportPrivateMessageInput = {}): Promise<{ id: string; status: string }> {
    const id = messageId.trim()
    if (!id) throw new Error('消息 ID 不能为空')
    return this.authenticatedRequest<{ id: string; status: string }>(`/api/messages/message/${encodeURIComponent(id)}/report`, {
      method: 'POST',
      body: {
        reason: input.reason || 'other',
        extra_content: input.extraContent?.trim() || '',
      },
      timeoutMs: 10000,
    })
  }

  async getUnreadPrivateMessageCount(): Promise<{ count: number }> {
    return this.authenticatedRequest<{ count: number }>('/api/messages/unread-count', {
      method: 'GET',
      timeoutMs: 10000,
    })
  }

  async submitFeedback(input: SubmitFeedbackInput): Promise<{ id: string; message: string }> {
    const content = input.content.trim()
    if (content.length < 5) throw new Error('请至少填写 5 个字的反馈内容')
    return this.authenticatedRequest<{ id: string; message: string }>('/api/feedback', {
      method: 'POST',
      body: {
        category: input.category,
        content,
        contact: input.contact?.trim(),
        page_path: input.pagePath?.trim() || 'app://about-feedback',
        app_version: input.appVersion?.trim(),
        client_info: {
          platform: 'app',
          ...(input.clientInfo || {}),
        },
        recent_requests: (input.recentRequests || []).slice(-50),
        image_urls: (input.imageUrls || []).map((url) => url.trim()).filter(Boolean).slice(0, 4),
      },
      timeoutMs: 15000,
    })
  }

  async uploadFeedbackImageFile(input: {
    fileUri: string
    fileName?: string
    mimeType?: string
  }): Promise<{ imageUrl: string }> {
    const token = await this.adapters.tokenStorage.getAccessToken()
    if (!token) throw new Error('请先登录')

    const res = await this.adapters.uploadFile({
      url: `${this.baseUrl}/api/feedback/upload-image`,
      fileUri: input.fileUri,
      fieldName: 'file',
      fileName: input.fileName || 'feedback.jpg',
      mimeType: input.mimeType || 'image/jpeg',
      timeoutMs: 30000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    this.assertOk(res, '上传反馈图片失败')
    const data = this.unwrapResponseData<UploadAnalyzeImageResponse>(res.data)
    const imageUrl = String(data.imageUrl || data.image_url || data.url || '').trim()
    if (!imageUrl) {
      throw new Error('服务器未返回图片地址')
    }
    return { imageUrl }
  }

  async searchLocation(keyword: string): Promise<LocationSearchResult> {
    const q = keyword.trim()
    if (!q) return { keyword: '', pois: [] }
    return this.authenticatedRequest<LocationSearchResult>('/api/location/search', {
      method: 'POST',
      body: { keyword: q },
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
    return this.unwrapResponseData<T>(res.data)
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
    return this.unwrapResponseData<T>(res.data)
  }

  private unwrapResponseData<T>(data: unknown): T {
    if (data && typeof data === 'object' && 'code' in data && 'data' in data) {
      const envelope = data as { code?: unknown; message?: unknown; data?: unknown }
      if (Number(envelope.code) === 0) return envelope.data as T
      throw new FoodLinkApiError(String(envelope.message || '请求失败'), 200, data)
    }
    return data as T
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

  private async storeLoginTokens(data: LoginResponse): Promise<void> {
    await this.adapters.tokenStorage.setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user_id,
    })
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

function normalizeNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function manualFoodTitle(item: ManualFoodItem): string {
  return String(item.title || item.name || '手动食物')
}

function buildManualFoodRecordPayload(input: ManualFoodRecordInput): SaveFoodRecordRequest {
  return buildManualFoodRecordsPayload({
    mealType: input.mealType,
    date: input.date,
    items: [{ item: input.item, weight: input.weight }],
  }, true)
}

function buildManualFoodRecordsPayload(input: ManualFoodRecordsInput, keepSingleDescription = false): SaveFoodRecordRequest {
  const items = input.items
    .filter((entry) => entry.item)
    .map((entry) => buildManualFoodRecordItemPayload(entry.item, entry.weight))

  if (!items.length) {
    throw new Error('请选择要记录的食物')
  }

  const titles = items.map((item) => item.name).filter(Boolean)
  const totalCalories = items.reduce((sum, item) => sum + normalizeNumber(item.nutrients.calories), 0)
  const totalProtein = items.reduce((sum, item) => sum + normalizeNumber(item.nutrients.protein), 0)
  const totalCarbs = items.reduce((sum, item) => sum + normalizeNumber(item.nutrients.carbs), 0)
  const totalFat = items.reduce((sum, item) => sum + normalizeNumber(item.nutrients.fat), 0)
  const totalWeight = items.reduce((sum, item) => sum + normalizeNumber(item.intake), 0)

  return {
    meal_type: input.mealType,
    date: mapCalendarDateToApi(input.date),
    description: keepSingleDescription && titles.length === 1 ? titles[0] : `手动记录：${titles.join('、')}`,
    insight: items.some((item) => item.manual_source === 'custom') ? '手动记录，包含用户自定义营养数据' : '手动记录，数据来自食物词典',
    entry_type: 'food_library',
    items,
    total_calories: totalCalories,
    total_protein: totalProtein,
    total_carbs: totalCarbs,
    total_fat: totalFat,
    total_weight_grams: totalWeight,
  }
}

function buildManualFoodRecordItemPayload(item: ManualFoodItem, inputWeight?: number): FoodRecordItemPayload {
  const baseWeight = normalizeNumber(item.default_weight_grams, 100) || 100
  const weight = normalizeNumber(inputWeight, baseWeight) || baseWeight
  const ratio = baseWeight > 0 ? weight / baseWeight : 1
  const calories = normalizeNumber(item.total_calories ?? item.calories) * ratio
  const protein = normalizeNumber(item.total_protein ?? item.protein) * ratio
  const carbs = normalizeNumber(item.total_carbs ?? item.carbs) * ratio
  const fat = normalizeNumber(item.total_fat ?? item.fat) * ratio
  return {
    name: manualFoodTitle(item),
    weight,
    ratio: 100,
    intake: weight,
    image_path: manualFoodImagePath(item),
    image_paths: manualFoodImagePaths(item),
    nutrients: {
      calories,
      protein,
      carbs,
      fat,
      fiber: normalizePer100gNutrient(item.nutrients_per_100g?.fiber, weight),
      sugar: normalizePer100gNutrient(item.nutrients_per_100g?.sugar, weight),
      sodium_mg: normalizePer100gNutrient(item.nutrients_per_100g?.sodium_mg, weight),
    },
    manual_source: manualFoodSource(item),
    manual_source_id: String(item.source_id || item.id || ''),
    manual_source_title: manualFoodTitle(item),
    manual_portion_label: item.portion_label,
  }
}

function normalizePer100gNutrient(value: unknown, weight: number): number {
  return normalizeNumber(value) * (weight / 100)
}

function manualFoodSource(item: ManualFoodItem): FoodRecordItemPayload['manual_source'] {
  switch (item.source) {
    case 'public_library':
    case 'nutrition_library':
    case 'packaged_food':
    case 'custom':
      return item.source
    default:
      return 'nutrition_library'
  }
}

function manualFoodImagePath(item: ManualFoodItem): string | undefined {
  const value = typeof item.image_path === 'string' ? item.image_path.trim() : ''
  return value || undefined
}

function manualFoodImagePaths(item: ManualFoodItem): string[] | undefined {
  const values = Array.isArray(item.image_paths)
    ? item.image_paths.map((url) => String(url || '').trim()).filter(Boolean)
    : []
  if (!values.length) {
    const single = manualFoodImagePath(item)
    return single ? [single] : undefined
  }
  return values
}

function packagedFoodPayload(input: PackagedFoodInput): Record<string, unknown> {
  return {
    brand: input.brand?.trim(),
    product_name: input.productName.trim(),
    display_name: input.displayName?.trim() || input.productName.trim(),
    barcode: input.barcode?.trim(),
    spec_text: input.specText?.trim(),
    flavor_text: input.flavorText?.trim(),
    package_category: input.packageCategory?.trim(),
    source_image_urls: input.sourceImageUrls.map((url) => url.trim()).filter(Boolean),
    ingredients_text: input.ingredientsText?.trim(),
    ocr_raw_text: input.ocrRawText?.trim(),
    extract_confidence: normalizeNumber(input.extractConfidence),
    field_confidence: input.fieldConfidence,
    energy_unit_raw: input.energyUnitRaw?.trim(),
    raw_label_payload: input.rawLabelPayload,
    conversion_status: input.conversionStatus?.trim(),
    nutrition_basis_unit: input.nutritionBasisUnit?.trim() || 'per_100g',
    net_weight_g: normalizeNumber(input.netWeightG),
    serving_weight_g: normalizeNumber(input.servingWeightG),
    kcal_per_100g: normalizeNumber(input.kcalPer100g),
    protein_per_100g: normalizeNumber(input.proteinPer100g),
    carbs_per_100g: normalizeNumber(input.carbsPer100g),
    fat_per_100g: normalizeNumber(input.fatPer100g),
    fiber_per_100g: normalizeNumber(input.fiberPer100g),
    sugar_per_100g: normalizeNumber(input.sugarPer100g),
    saturated_fat_per_100g: normalizeNumber(input.saturatedFatPer100g),
    cholesterol_mg_per_100g: normalizeNumber(input.cholesterolMgPer100g),
    sodium_mg_per_100g: normalizeNumber(input.sodiumMgPer100g),
    potassium_mg_per_100g: normalizeNumber(input.potassiumMgPer100g),
    calcium_mg_per_100g: normalizeNumber(input.calciumMgPer100g),
    iron_mg_per_100g: normalizeNumber(input.ironMgPer100g),
    magnesium_mg_per_100g: normalizeNumber(input.magnesiumMgPer100g),
    zinc_mg_per_100g: normalizeNumber(input.zincMgPer100g),
    vitamin_a_rae_mcg_per_100g: normalizeNumber(input.vitaminARaeMcgPer100g),
    vitamin_c_mg_per_100g: normalizeNumber(input.vitaminCMgPer100g),
    vitamin_d_mcg_per_100g: normalizeNumber(input.vitaminDMcgPer100g),
    vitamin_e_mg_per_100g: normalizeNumber(input.vitaminEMgPer100g),
    vitamin_k_mcg_per_100g: normalizeNumber(input.vitaminKMcgPer100g),
    thiamin_mg_per_100g: normalizeNumber(input.thiaminMgPer100g),
    riboflavin_mg_per_100g: normalizeNumber(input.riboflavinMgPer100g),
    niacin_mg_per_100g: normalizeNumber(input.niacinMgPer100g),
    vitamin_b6_mg_per_100g: normalizeNumber(input.vitaminB6MgPer100g),
    folate_mcg_per_100g: normalizeNumber(input.folateMcgPer100g),
    vitamin_b12_mcg_per_100g: normalizeNumber(input.vitaminB12McgPer100g),
    ingest_method: input.ingestMethod?.trim() || 'app_manual',
    review_status: input.reviewStatus?.trim() || 'pending',
  }
}

function extractPackagedProductFromTask(task: AnalysisTask): PackagedProductExtractResult | undefined {
  const result = asRecord(task.result)
  const packaged = asRecord(result?.packaged_product) || asRecord(result?.nutrition)
  return packaged as PackagedProductExtractResult | undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function recipePayload(input: Partial<RecipeInput>): Record<string, unknown> {
  return {
    ...(input.recipeName != null ? { recipe_name: input.recipeName.trim() } : {}),
    ...(input.description != null ? { description: input.description.trim() } : {}),
    ...(input.imagePath != null ? { image_path: input.imagePath.trim() } : {}),
    ...(input.items != null ? { items: input.items } : {}),
    ...(input.totalCalories != null ? { total_calories: normalizeNumber(input.totalCalories) } : {}),
    ...(input.totalProtein != null ? { total_protein: normalizeNumber(input.totalProtein) } : {}),
    ...(input.totalCarbs != null ? { total_carbs: normalizeNumber(input.totalCarbs) } : {}),
    ...(input.totalFat != null ? { total_fat: normalizeNumber(input.totalFat) } : {}),
    ...(input.totalWeightGrams != null ? { total_weight_grams: normalizeNumber(input.totalWeightGrams) } : {}),
    ...(input.tags != null ? { tags: input.tags.map((tag) => tag.trim()).filter(Boolean) } : {}),
    ...(input.mealType != null ? { meal_type: input.mealType } : {}),
    ...(input.isFavorite != null ? { is_favorite: input.isFavorite } : {}),
  }
}

function buildPublicFoodQuery(params?: PublicFoodListParams): string {
  const q = new URLSearchParams()
  if (!params) return ''
  if (params.limit != null) q.set('limit', String(Math.min(100, Math.max(1, Math.floor(params.limit)))))
  if (params.offset != null) q.set('offset', String(Math.max(0, Math.floor(params.offset))))
  if (params.sortBy) q.set('sort_by', params.sortBy)
  if (params.type) q.set('type', params.type)
  if (params.city?.trim()) q.set('city', params.city.trim())
  if (params.merchantName?.trim()) q.set('merchant_name', params.merchantName.trim())
  if (params.suitableForFatLoss != null) q.set('suitable_for_fat_loss', String(params.suitableForFatLoss))
  if (params.isCampusFood != null) q.set('is_campus_food', String(params.isCampusFood))
  if (params.isCampusHighlight != null) q.set('is_campus_highlight', String(params.isCampusHighlight))
  if (params.schoolName?.trim()) q.set('school_name', params.schoolName.trim())
  if (params.canteenName?.trim()) q.set('canteen_name', params.canteenName.trim())
  if (params.minCalories != null) q.set('min_calories', String(normalizeNumber(params.minCalories)))
  if (params.maxCalories != null) q.set('max_calories', String(normalizeNumber(params.maxCalories)))
  return q.toString()
}

function publicFoodPayload(input: Partial<CreatePublicFoodInput>): Record<string, unknown> {
  return {
    ...(input.foodName != null ? { food_name: input.foodName.trim() } : {}),
    ...(input.description != null ? { description: input.description.trim() } : {}),
    ...(input.sourceRecordId != null ? { source_record_id: input.sourceRecordId.trim() } : {}),
    ...(input.totalCalories != null ? { total_calories: normalizeNumber(input.totalCalories) } : {}),
    ...(input.totalProtein != null ? { total_protein: normalizeNumber(input.totalProtein) } : {}),
    ...(input.totalCarbs != null ? { total_carbs: normalizeNumber(input.totalCarbs) } : {}),
    ...(input.totalFat != null ? { total_fat: normalizeNumber(input.totalFat) } : {}),
    ...(input.items != null ? { items: input.items } : {}),
    ...(input.imagePath != null ? { image_path: input.imagePath.trim() } : {}),
    ...(input.imagePaths != null ? { image_paths: input.imagePaths.map((url) => url.trim()).filter(Boolean) } : {}),
    ...(input.merchantName != null ? { merchant_name: input.merchantName.trim() } : {}),
    ...(input.merchantAddress != null ? { merchant_address: input.merchantAddress.trim() } : {}),
    ...(input.tasteRating != null ? { taste_rating: input.tasteRating } : {}),
    ...(input.suitableForFatLoss != null ? { suitable_for_fat_loss: Boolean(input.suitableForFatLoss) } : {}),
    ...(input.userTags != null ? { user_tags: input.userTags.map((tag) => tag.trim()).filter(Boolean) } : {}),
    ...(input.userNotes != null ? { user_notes: input.userNotes.trim() } : {}),
    ...(input.latitude != null ? { latitude: normalizeNumber(input.latitude) } : {}),
    ...(input.longitude != null ? { longitude: normalizeNumber(input.longitude) } : {}),
    ...(input.province != null ? { province: input.province.trim() } : {}),
    ...(input.city != null ? { city: input.city.trim() } : {}),
    ...(input.district != null ? { district: input.district.trim() } : {}),
    ...(input.detailAddress != null ? { detail_address: input.detailAddress.trim() } : {}),
    ...(input.type != null || input.isCampusFood != null ? { type: input.type?.trim() || (input.isCampusFood ? 'campus' : 'common') } : {}),
    ...(input.isCampusFood != null ? { is_campus_food: Boolean(input.isCampusFood) } : {}),
    ...(input.schoolName != null ? { school_name: input.schoolName.trim() } : {}),
    ...(input.campusName != null ? { campus_name: input.campusName.trim() } : {}),
    ...(input.canteenName != null ? { canteen_name: input.canteenName.trim() } : {}),
    ...(input.floor != null ? { floor: input.floor.trim() } : {}),
    ...(input.windowName != null ? { window_name: input.windowName.trim() } : {}),
    ...(input.price != null ? { price: input.price } : {}),
    ...(input.priceType != null ? { price_type: input.priceType.trim() } : {}),
    ...(input.priceMin != null ? { price_min: normalizeNumber(input.priceMin) } : {}),
    ...(input.priceMax != null ? { price_max: normalizeNumber(input.priceMax) } : {}),
    ...(input.priceUnit != null ? { price_unit: input.priceUnit.trim() } : {}),
    ...(input.priceCollectedAt != null ? { price_collected_at: input.priceCollectedAt.trim() } : {}),
    ...(input.portionDescription != null ? { portion_description: input.portionDescription.trim() } : {}),
    ...(input.campusLocationText != null ? { campus_location_text: input.campusLocationText.trim() } : {}),
  }
}

function circlePostPayload(input: CreateCirclePostInput): Record<string, unknown> {
  return {
    title: input.title.trim(),
    body: input.body.trim(),
    image_urls: (input.imageUrls || []).map((url) => url.trim()).filter(Boolean),
    nutrition: input.nutrition || {},
  }
}

function safeLimit(limit: number): number {
  return Math.min(100, Math.max(1, Math.floor(limit)))
}

function normalizeConfidence(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function speciesLabel(species: GooseDuckChickenSpecies): string {
  if (species === 'goose') return '鹅腿'
  if (species === 'duck') return '鸭腿'
  if (species === 'chicken') return '鸡腿'
  return '不确定'
}

export function createFoodLinkApiClient(options: FoodLinkApiClientOptions): FoodLinkApiClient {
  return new FoodLinkApiClient(options)
}
