import {
  createFoodLinkApiClient,
  type ApiClientAdapters,
  type ApiClientRequestOptions,
  type ApiClientResponse,
  type UploadFileInput,
} from '../src'

const response = <T>(data: T, status = 200): ApiClientResponse<T> => ({ status, data })

function createMockAdapters() {
  const requests: Array<{ url: string; options?: ApiClientRequestOptions }> = []
  const uploads: UploadFileInput[] = []
  let token: string | null = null

  const adapters: ApiClientAdapters = {
    async request(url, options) {
      requests.push({ url, options })
      if (url.endsWith('/api/test-backend/impersonate-user')) {
        return response({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user_id: 'user-1',
          openid: 'openid-1',
        })
      }
      if (url.endsWith('/api/login')) {
        return response({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user_id: 'user-1',
          openid: 'mobile-poc-debug-openid',
        })
      }
      if (url.endsWith('/api/app/login/wechat')) {
        return response({
          access_token: 'wechat-access-token',
          refresh_token: 'wechat-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user_id: 'wechat-user-1',
          openid: 'app-wx:openid-1',
          unionid: 'unionid-1',
        })
      }
      if (url.endsWith('/api/app/login/password') || url.endsWith('/api/app/register/password')) {
        return response({
          access_token: 'password-access-token',
          refresh_token: 'password-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user_id: 'password-user-1',
          openid: 'app-pwd:mobileuser',
        })
      }
      if (url.endsWith('/api/app/account/password')) {
        return response({
          access_token: 'account-password-access-token',
          refresh_token: 'account-password-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          user_id: 'wechat-user-1',
          openid: 'app-wx:openid-1',
        })
      }
      if (url.endsWith('/api/feedback')) {
        return response({ code: 0, data: { id: 'feedback-1', message: 'ok' } })
      }
      if (url.endsWith('/api/membership/plans')) {
        return response({ code: 0, data: { list: [{ code: 'standard_monthly', name: 'Standard', amount: 19, duration_months: 1 }] } })
      }
      if (url.endsWith('/api/membership/pay/create')) {
        return response({ code: 0, data: { order_no: 'PM1', plan_code: 'standard_monthly', amount: 19, pay_params: { package: 'prepay_id=1' } } })
      }
      if (url.endsWith('/api/membership/rewards/share-poster/claim')) {
        return response({ code: 0, data: { claimed: true, credits: 1, message: '分享奖励 +1 积分' } })
      }
      if (url.includes('/api/manual-food/custom')) {
        if (options?.method === 'POST') {
          const body = options.body as Record<string, unknown>
          return response({ code: 0, data: { item: { id: 'custom-1', ...body } } })
        }
        return response({ code: 0, data: { items: [{ id: 'custom-1', title: 'Custom food', total_calories: 180 }], has_more: false } })
      }
      if (url.endsWith('/api/expiry/items/expiry-1')) {
        return response({ code: 0, data: { message: 'ok', item: { id: 'expiry-1', food_name: '酸奶', expire_date: '2026-06-20' } } })
      }
      if (url.endsWith('/api/packaged-food')) {
        return response({ code: 0, data: { item: { id: 'packaged-1', product_name: '燕麦棒' } } })
      }
      if (url.endsWith('/api/analyze/tasks/task-packaged-1')) {
        return response({ code: 0, data: { id: 'task-packaged-1', status: 'done', task_type: 'packaged_product_extract', result: { packaged_product: { product_name: '燕麦棒', unit_nutrition_per_100g: { calories: 420 } } } } })
      }
      if (url.endsWith('/api/food-record/record-1')) {
        if (options?.method === 'GET') {
          return response({
            code: 0,
            data: {
              record: {
                id: 'record-1',
                user_id: 'user-1',
                meal_type: 'lunch',
                description: '鸡胸饭',
                items: [],
                total_calories: 100,
                total_protein: 10,
                total_carbs: 20,
                total_fat: 3,
                total_weight_grams: 200,
                record_time: '2026-06-15T12:00:00Z',
                created_at: '2026-06-15T12:00:00Z',
              },
            },
          })
        }
        if (options?.method === 'PUT') {
          return response({
            code: 0,
            data: {
              message: 'ok',
              record: {
                id: 'record-1',
                user_id: 'user-1',
                record_time: '2026-06-15T12:00:00Z',
                created_at: '2026-06-15T12:00:00Z',
                ...(options.body as Record<string, unknown>),
              },
            },
          })
        }
        if (options?.method === 'DELETE') {
          return response({ code: 0, data: { message: 'deleted' } })
        }
      }
      if (url.includes('/api/community/feed-targets/food_record/record-1/context')) {
        return response({ code: 0, data: { item: { allowed: true, record: { id: 'record-1', total_calories: 100 }, comments: [] } } })
      }
      if (url.includes('/api/community/feed-targets/food_record/record-1/comments')) {
        return response({ code: 0, data: { comment: { id: 'comment-1', user_id: 'user-1', content: 'nice' } } })
      }
      if (url.includes('/api/community/feed-targets/food_record/record-1/report')) {
        return response({ code: 0, data: { id: 'report-1', status: 'pending' } })
      }
      if (url.endsWith('/api/community/checkin-leaderboard')) {
        return response({
          code: 0,
          data: {
            week_start: '2026-06-15',
            week_end: '2026-06-21',
            list: [
              {
                rank: 1,
                user_id: 'user-1',
                nickname: 'Mobile',
                avatar: 'https://cdn.example.com/avatar.jpg',
                checkin_count: 5,
                is_me: true,
              },
            ],
          },
        })
      }
      if (url.endsWith('/api/community/posts')) {
        return response({ code: 0, data: { id: 'post-1' } })
      }
      if (url.endsWith('/api/community/posts/post-1')) {
        return response({ code: 0, data: { id: 'post-1', message: 'ok' } })
      }
      if (url.includes('/api/recipes')) {
        if (url.endsWith('/api/recipes')) return response({ code: 0, data: { recipes: [] } })
        if (url.endsWith('/api/recipes/recipe-1')) return response({ code: 0, data: { id: 'recipe-1', recipe_name: '鸡胸饭', total_calories: 420 } })
        if (url.endsWith('/api/recipes/recipe-1/use')) return response({ code: 0, data: { message: 'ok', record_id: 'record-2' } })
      }
      if (url.includes('/api/public-food-library')) {
        if (url.includes('/comments')) return response({ code: 0, data: { comment: { id: 'pf-comment-1', content: 'good' } } })
        if (url.endsWith('/like') || url.endsWith('/collect')) return response({ code: 0, data: { message: 'ok' } })
        if (url.includes('/campus-detail')) return response({ code: 0, data: { item: { id: 'food-1', food_name: '鸡胸饭', total_calories: 420 } } })
        if (url.endsWith('/api/public-food-library/food-1')) return response({ code: 0, data: { message: 'ok', item: { id: 'food-1', food_name: '鸡胸饭', total_calories: 430 } } })
        return response({ code: 0, data: { list: [{ id: 'food-1', food_name: '鸡胸饭', total_calories: 420 }] } })
      }
      if (url.endsWith('/api/user/user-2/public-profile')) {
        return response({ code: 0, data: { id: 'user-2', nickname: 'Friend', record_days: 8, is_following: false } })
      }
      if (url.includes('/api/user/user-2/followers')) {
        return response({ code: 0, data: { list: [{ id: 'user-3', nickname: 'Follower' }], has_more: false, offset: 0 } })
      }
      if (url.includes('/api/user/user-2/following')) {
        return response({ code: 0, data: { list: [{ id: 'user-4', nickname: 'Following' }], has_more: false, offset: 0 } })
      }
      if (url.endsWith('/api/user/user-2/follow-stats')) {
        return response({ code: 0, data: { followers_count: 1, following_count: 1, is_following: false } })
      }
      if (url.endsWith('/api/user/user-2/follow')) {
        return response({ code: 0, data: { message: 'ok' } })
      }
      if (url.endsWith('/api/user/profile')) {
        return response({ code: 0, data: { id: 'user-1', nickname: 'Mobile', avatar: '', cover_image: '', motto: 'keep moving' } })
      }
      if (url.endsWith('/api/user/upload-avatar')) {
        return response({ code: 0, data: { imageUrl: 'https://cdn.example.com/avatar.jpg' } })
      }
      if (url.endsWith('/api/user/upload-cover')) {
        return response({ code: 0, data: { imageUrl: 'https://cdn.example.com/cover.jpg' } })
      }
      if (url.endsWith('/api/user/account')) {
        return response({ code: 0, data: { message: 'deleted' } })
      }
      if (url.endsWith('/api/user/health-profile')) {
        return response({ code: 0, data: { id: 'user-1', nickname: 'Mobile', avatar: '', gender: 'male', health_condition: {} } })
      }
      if (url.endsWith('/api/user/health-profile/upload-report-image')) {
        return response({ code: 0, data: { imageUrl: 'https://cdn.example.com/report.jpg' } })
      }
      if (url.endsWith('/api/user/health-profile/submit-report-extraction-task')) {
        return response({ code: 0, data: { taskId: 'health-task-1' } })
      }
      if (url.endsWith('/api/body-metrics/water')) {
        return response({ code: 0, data: { message: 'water saved' } })
      }
      if (url.endsWith('/api/body-metrics/water/reset')) {
        return response({ code: 0, data: { message: 'water reset', deleted_count: 2, date: '2026-06-15' } })
      }
      if (url.endsWith('/api/body-metrics/water/water-1')) {
        return response({ code: 0, data: { message: 'water deleted', deleted_count: 1, id: 'water-1' } })
      }
      if (url.endsWith('/api/body-metrics/weight')) {
        return response({ code: 0, data: { message: 'weight saved' } })
      }
      if (url.endsWith('/api/body-metrics/weight/weight-1')) {
        return response({ code: 0, data: { message: 'weight deleted', deleted_count: 1, id: 'weight-1' } })
      }
      if (url.endsWith('/api/exercise-logs')) {
        return response({ code: 0, data: { task_id: 'exercise-task-1', message: 'exercise submitted' } })
      }
      if (url.endsWith('/api/exercise-logs/exercise-1')) {
        return response({ code: 0, data: { message: 'exercise deleted' } })
      }
      if (url.endsWith('/api/friend/invite/profile/user-1')) {
        return response({ code: 0, data: { user_id: 'user-1', nickname: 'Me', invite_code: 'ABCD1234' } })
      }
      if (url.includes('/api/friend/invite/profile-by-code')) {
        return response({ code: 0, data: { user_id: 'user-2', nickname: 'Friend', invite_code: 'ABCD1234' } })
      }
      if (url.includes('/api/friend/invite/resolve')) {
        return response({ code: 0, data: { user_id: 'user-2', nickname: 'Friend', relation: 'none' } })
      }
      if (url.endsWith('/api/friend/invite/accept')) {
        return response({ code: 0, data: { status: 'request_sent', nickname: 'Friend' } })
      }
      if (url.includes('/api/pet/summary')) {
        return response({ code: 0, data: {
          pet: { id: 'pet-1', pet_seed: 'seed', name: '青团', color: 'mint', shape: 'round', pattern: 'pattern-0', accessory: 'leaf', personality: 'gentle', level: 1, experience: 20, level_exp: 20, next_level_exp: 100, level_progress: 20, total_events: 0 },
          today: { date: '2026-06-15', habit_score: 3, exp_gained: 30 },
          status: { mood: 'calm', state: 'steady', message: '状态稳定', task_text: '保持记录', inactivity_days: 0, can_revive: false },
          rewards: { daily_credit_cap: 1 },
        } })
      }
      if (url.endsWith('/api/pet/events/event-1/claim')) {
        return response({ code: 0, data: { pet: { id: 'pet-1', name: '青团' }, event: { id: 'event-1' }, credits_awarded: 1, exp_awarded: 10 } })
      }
      if (url.endsWith('/api/pet/reroll-appearance')) {
        return response({ code: 0, data: { pet: { id: 'pet-1', name: '米粒' }, credits_cost: 5 } })
      }
      if (url.endsWith('/api/pet/select-appearance')) {
        return response({ code: 0, data: { pet: { id: 'pet-1', name: '米粒' } } })
      }
      if (url.endsWith('/api/messages/conversations')) {
        return response({ code: 0, data: { list: [{ UserID: 'user-2', Nickname: 'Friend', UnreadCount: 1 }] } })
      }
      if (url.includes('/api/messages/conversation/user-2')) {
        return response({ code: 0, data: { list: [{ ID: 'msg-1', Content: 'hello', ContentType: 'text' }], has_more: false, offset: 0 } })
      }
      if (url.endsWith('/api/messages/send')) {
        const body = options?.body as { content?: string; content_type?: string; image_url?: string } | undefined
        return response({ code: 0, data: { ID: 'msg-2', Content: body?.content || '', ContentType: body?.content_type || 'text', ImageURL: body?.image_url || '' } })
      }
      if (url.includes('/api/home/dashboard')) {
        return response({
          intakeData: {
            current: 100,
            target: 1800,
            progress: 5,
            macros: {
              protein: { current: 10, target: 100 },
              carbs: { current: 20, target: 200 },
              fat: { current: 3, target: 60 },
            },
          },
          meals: [],
        })
      }
      if (url.endsWith('/api/analyze/submit')) {
        return response({ task_id: 'task-1', message: 'ok' })
      }
      if (url.endsWith('/api/food-record')) {
        return response({ id: 'record-1', message: 'saved' })
      }
      return response({ detail: 'not found' }, 404)
    },
    async uploadFile(input) {
      uploads.push(input)
      if (input.url.endsWith('/api/community/posts/upload-image')) {
        return response({ code: 0, data: { image_url: 'https://example.com/circle.jpg' } })
      }
      if (input.url.endsWith('/api/feedback/upload-image')) {
        return response({ code: 0, data: { imageUrl: 'https://example.com/feedback.jpg' } })
      }
      return response({ imageUrl: 'https://example.com/food.jpg' })
    },
    tokenStorage: {
      async getAccessToken() {
        return token
      },
      async setTokens(tokens) {
        token = tokens.accessToken
      },
      async clearTokens() {
        token = null
      },
    },
  }

  return { adapters, requests, uploads }
}

describe('FoodLinkApiClient', () => {
  it('stores token after debug impersonation and uses it for authenticated requests', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.debugImpersonateUser('user-1', 'password')
    await client.getHomeDashboard('2026-06-14')

    expect(requests[0].url).toBe('https://api.example.com/api/test-backend/impersonate-user')
    expect(requests[1].url).toContain('/api/home/dashboard?date=2026-06-14')
    expect(requests[1].options?.headers?.Authorization).toBe('Bearer access-token')
  })

  it('stores token after test openid login', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.debugLoginWithTestOpenID('mobile-poc-debug-openid')
    await client.getHomeDashboard('2026-06-14')

    expect(requests[0].url).toBe('https://api.example.com/api/login')
    expect(requests[0].options?.body).toEqual({ testOpenid: 'mobile-poc-debug-openid' })
    expect(requests[1].options?.headers?.Authorization).toBe('Bearer access-token')
  })

  it('uploads image and submits analysis task', async () => {
    const { adapters, uploads } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.debugImpersonateUser('user-1', 'password')
    await client.uploadAnalyzeImageFile({ fileUri: 'file://food.jpg', fileName: 'food.jpg', mimeType: 'image/jpeg' })
    await client.uploadCirclePostImageFile({ fileUri: 'file://circle.jpg', fileName: 'circle.jpg', mimeType: 'image/jpeg' })
    await client.uploadFeedbackImageFile({ fileUri: 'file://feedback.jpg', fileName: 'feedback.jpg', mimeType: 'image/jpeg' })

    expect(uploads[0]).toMatchObject({
      url: 'https://api.example.com/api/upload-analyze-image-file',
      fieldName: 'file',
      fileName: 'food.jpg',
      headers: { Authorization: 'Bearer access-token' },
    })
    expect(uploads[1]).toMatchObject({
      url: 'https://api.example.com/api/community/posts/upload-image',
      fieldName: 'file',
      fileName: 'circle.jpg',
      headers: { Authorization: 'Bearer access-token' },
    })
    expect(uploads[2]).toMatchObject({
      url: 'https://api.example.com/api/feedback/upload-image',
      fieldName: 'file',
      fileName: 'feedback.jpg',
      headers: { Authorization: 'Bearer access-token' },
    })
    const uploaded = await client.uploadAnalyzeImageFile({ fileUri: 'file:///food.jpg' })
    const submitted = await client.submitAnalyzeTask({ image_url: uploaded.imageUrl, meal_type: 'lunch' })

    expect(uploads[0].url).toBe('https://api.example.com/api/upload-analyze-image-file')
    expect(uploads[0].headers?.Authorization).toBe('Bearer access-token')
    expect(submitted.task_id).toBe('task-1')
  })

  it('stores token after app wechat login with invite code', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code', inviteCode: ' abcd1234 ' })
    await client.getHomeDashboard('2026-06-14')

    expect(requests[0].url).toBe('https://api.example.com/api/app/login/wechat')
    expect(requests[0].options?.body).toEqual({ code: 'expo-go-dev-wechat-code', inviteCode: 'abcd1234' })
    expect(requests[1].options?.headers?.Authorization).toBe('Bearer wechat-access-token')
  })

  it('stores token after password register and login', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.registerWithPassword({ username: 'mobileuser', password: 'password123', nickname: 'Mobile', inviteCode: 'ABCD1234' })
    await client.loginWithPassword({ username: 'mobileuser', password: 'password123' })
    await client.getHomeDashboard('2026-06-14')

    expect(requests[0].url).toBe('https://api.example.com/api/app/register/password')
    expect(requests[0].options?.body).toMatchObject({ inviteCode: 'ABCD1234' })
    expect(requests[1].url).toBe('https://api.example.com/api/app/login/password')
    expect(requests[2].options?.headers?.Authorization).toBe('Bearer password-access-token')
  })

  it('sets account password with authenticated token and stores refreshed token', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    await client.setAccountPassword({ username: 'Mobile.User', password: 'newpassword123', currentPassword: 'oldpassword123' })
    await client.getHomeDashboard('2026-06-14')

    expect(requests[1].url).toBe('https://api.example.com/api/app/account/password')
    expect(requests[1].options?.headers?.Authorization).toBe('Bearer wechat-access-token')
    expect(requests[1].options?.body).toEqual({
      username: 'Mobile.User',
      password: 'newpassword123',
      current_password: 'oldpassword123',
    })
    expect(requests[2].options?.headers?.Authorization).toBe('Bearer account-password-access-token')
  })

  it('submits app feedback with authenticated token', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    const result = await client.submitFeedback({
      category: 'suggestion',
      content: '希望 App 支持用户群二维码',
      contact: 'wechat-id',
      pagePath: 'app://about-feedback',
      appVersion: '3.0.2',
      clientInfo: { surface: 'expo', recent_request_limit: 50 },
      recentRequests: [
        {
          method: 'GET',
          path: '/api/home/dashboard',
          statusCode: 200,
          durationMs: 123,
          startedAt: '2026-06-16T10:00:00.000Z',
          traceId: 'trace-1',
          requestId: 'request-1',
          hostName: 'dev-host',
        },
      ],
    })

    expect(requests[1].url).toBe('https://api.example.com/api/feedback')
    expect(requests[1].options?.headers?.Authorization).toBe('Bearer wechat-access-token')
    expect(requests[1].options?.body).toMatchObject({
      category: 'suggestion',
      content: '希望 App 支持用户群二维码',
      contact: 'wechat-id',
      page_path: 'app://about-feedback',
      app_version: '3.0.2',
      client_info: {
        platform: 'app',
        surface: 'expo',
        recent_request_limit: 50,
      },
      recent_requests: [
        {
          method: 'GET',
          path: '/api/home/dashboard',
          statusCode: 200,
          durationMs: 123,
          startedAt: '2026-06-16T10:00:00.000Z',
          traceId: 'trace-1',
          requestId: 'request-1',
          hostName: 'dev-host',
        },
      ],
    })
    expect(result.id).toBe('feedback-1')
  })

  it('creates packaged food with structured nutrition payload and extracts packaged task result', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    await client.createPackagedFood({
      productName: '燕麦棒',
      brand: '测试品牌',
      flavorText: '巧克力味',
      packageCategory: '能量棒',
      specText: '40g',
      barcode: '6900000000000',
      sourceImageUrls: [' https://cdn.example.com/pkg-front.jpg ', 'https://cdn.example.com/pkg-label.jpg'],
      ingredientsText: '燕麦、可可粉',
      ocrRawText: '营养成分表',
      extractConfidence: 0.92,
      fieldConfidence: { product_name: 0.95 },
      rawLabelPayload: { nutrition_basis: { value: 40, unit: 'g' } },
      conversionStatus: 'converted',
      ingestMethod: 'user_capture_ocr',
      nutritionBasisUnit: '100g',
      netWeightG: 40,
      servingWeightG: 40,
      kcalPer100g: 420,
      proteinPer100g: 8,
      carbsPer100g: 66,
      fatPer100g: 12,
      fiberPer100g: 6,
      sugarPer100g: 18,
      saturatedFatPer100g: 3,
      cholesterolMgPer100g: 0,
      sodiumMgPer100g: 210,
      potassiumMgPer100g: 120,
      calciumMgPer100g: 40,
      ironMgPer100g: 2,
    })
    const task = await client.getPackagedProductExtractTask('task-packaged-1')

    const createReq = requests.find((req) => req.url.endsWith('/api/packaged-food'))
    expect(createReq?.options?.body).toMatchObject({
      product_name: '燕麦棒',
      brand: '测试品牌',
      flavor_text: '巧克力味',
      package_category: '能量棒',
      source_image_urls: ['https://cdn.example.com/pkg-front.jpg', 'https://cdn.example.com/pkg-label.jpg'],
      ingredients_text: '燕麦、可可粉',
      extract_confidence: 0.92,
      field_confidence: { product_name: 0.95 },
      raw_label_payload: { nutrition_basis: { value: 40, unit: 'g' } },
      kcal_per_100g: 420,
      saturated_fat_per_100g: 3,
      sodium_mg_per_100g: 210,
      ingest_method: 'user_capture_ocr',
      review_status: 'pending',
    })
    expect(task.packaged_product?.product_name).toBe('燕麦棒')
    expect(task.packaged_product?.unit_nutrition_per_100g?.calories).toBe(420)
  })

  it('calls expiry detail and update APIs with backend field names', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    await client.getFoodExpiryItem('expiry-1')
    await client.updateFoodExpiryItem('expiry-1', {
      foodName: '酸奶',
      category: '乳制品',
      expireDate: '2026-06-20',
      quantityNote: '2盒',
      storageType: 'refrigerated',
      note: '冰箱上层',
      status: 'active',
    })

    expect(requests[1].url).toBe('https://api.example.com/api/expiry/items/expiry-1')
    expect(requests[1].options?.method).toBe('GET')
    expect(requests[2].url).toBe('https://api.example.com/api/expiry/items/expiry-1')
    expect(requests[2].options?.method).toBe('PUT')
    expect(requests[2].options?.body).toMatchObject({
      food_name: '酸奶',
      category: '乳制品',
      expire_date: '2026-06-20',
      quantity_note: '2盒',
      storage_type: 'refrigerated',
      note: '冰箱上层',
      status: 'active',
    })
  })

  it('calls profile media and health report APIs with backend field names', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    await client.uploadUserAvatar({ base64Image: 'data:image/jpeg;base64,avatar' })
    await client.uploadUserCoverImage({ base64Image: 'data:image/jpeg;base64,cover' })
    await client.updateUserProfile({ nickname: '新昵称', motto: '长期主义', cover_image: 'https://cdn.example.com/cover.jpg' })
    await client.getHealthProfile()
    await client.updateHealthProfile({
      gender: 'male',
      birthday: '1990-01-01',
      height: 178,
      weight: 70,
      daily_life_activity_level: 'moderate',
      diet_goal: 'maintain',
      medical_history: ['none'],
      diet_preference: ['low_salt'],
      allergies: ['milk'],
      health_notes: '无',
      routine_type: '23:00-07:00',
      execution_mode: 'standard',
    })
    await client.uploadHealthReportImage({ base64Image: 'data:image/jpeg;base64,report' })
    await client.submitReportExtractionTask({ imageUrls: ['https://cdn.example.com/report.jpg'] })
    await client.deleteAccount()

    expect(requests.some((req) => req.url.endsWith('/api/user/upload-avatar') && (req.options?.body as any).base64Image.includes('avatar'))).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/user/upload-cover') && (req.options?.body as any).base64Image.includes('cover'))).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/user/profile') && req.options?.method === 'PUT' && (req.options?.body as any).motto === '长期主义')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/user/health-profile') && req.options?.method === 'PUT' && (req.options?.body as any).daily_life_activity_level === 'moderate')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/user/health-profile/upload-report-image') && (req.options?.body as any).base64Image.includes('report'))).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/user/health-profile/submit-report-extraction-task') && (req.options?.body as any).imageUrls[0].includes('report.jpg'))).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/user/account') && req.options?.method === 'DELETE')).toBe(true)
  })

  it('calls body metric and exercise mutation APIs with backend field names', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    await client.addBodyWaterLog(250, '2026-06-15')
    await client.resetBodyWaterLogs('2026-06-15')
    await client.deleteBodyWaterLog('water-1')
    await client.saveBodyWeightRecord(69.5, '2026-06-15', 'weight-client-1')
    await client.deleteBodyWeightRecord('weight-1')
    await client.createExerciseLog({ exerciseDesc: '慢跑30分钟', date: '2026-06-15' })
    await client.createExerciseLog({ exerciseDesc: '', date: '2026-06-15', imageUrl: 'https://cdn.example.com/exercise.jpg' })
    await client.deleteExerciseLog('exercise-1')

    expect(requests.some((req) => req.url.endsWith('/api/body-metrics/water') && req.options?.method === 'POST' && (req.options?.body as any).amount_ml === 250)).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/body-metrics/water/reset') && (req.options?.body as any).date === '2026-06-15')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/body-metrics/water/water-1') && req.options?.method === 'DELETE')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/body-metrics/weight') && (req.options?.body as any).value === 69.5 && (req.options?.body as any).client_id === 'weight-client-1')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/body-metrics/weight/weight-1') && req.options?.method === 'DELETE')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/exercise-logs') && (req.options?.body as any).exercise_desc === '慢跑30分钟')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/exercise-logs') && (req.options?.body as any).image_url === 'https://cdn.example.com/exercise.jpg')).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/exercise-logs/exercise-1') && req.options?.method === 'DELETE')).toBe(true)
  })

  it('updates and deletes food records with editable item payload', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    await client.getFoodRecordById('record-1')
    await client.claimSharePosterReward({ recordId: 'record-1' })
    await client.claimSharePosterReward({ shareScope: 'daily_food', shareDate: '2026-06-15' })
    await client.updateFoodRecord('record-1', {
      meal_type: 'dinner',
      description: '鸡胸饭少油版',
      items: [
        {
          name: '鸡胸饭',
          weight: 300,
          ratio: 75,
          intake: 225,
          water_ml: 0,
          nutrition_source: 'manual',
          matched_food_id: 'food-1',
          nutrients: {
            calories: 520,
            protein: 42,
            carbs: 58,
            fat: 12,
            fiber: 6,
            sugar: 4,
            sodium_mg: 330,
          },
        },
      ],
      total_calories: 390,
      total_protein: 31.5,
      total_carbs: 43.5,
      total_fat: 9,
      total_weight_grams: 225,
    })
    await client.deleteFoodRecord('record-1')

    const updateReq = requests.find((req) => req.url.endsWith('/api/food-record/record-1') && req.options?.method === 'PUT')
    const rewardReqs = requests.filter((req) => req.url.endsWith('/api/membership/rewards/share-poster/claim'))
    expect(requests.some((req) => req.url.endsWith('/api/food-record/record-1') && req.options?.method === 'GET')).toBe(true)
    expect(rewardReqs[0]?.options?.body).toMatchObject({ record_id: 'record-1' })
    expect(rewardReqs[1]?.options?.body).toMatchObject({ share_scope: 'daily_food', share_date: '2026-06-15' })
    expect(updateReq?.options?.body).toMatchObject({
      meal_type: 'dinner',
      total_calories: 390,
      total_weight_grams: 225,
      items: [
        {
          name: '鸡胸饭',
          ratio: 75,
          intake: 225,
          nutrition_source: 'manual',
          matched_food_id: 'food-1',
          nutrients: { sodium_mg: 330 },
        },
      ],
    })
    expect(requests.some((req) => req.url.endsWith('/api/food-record/record-1') && req.options?.method === 'DELETE')).toBe(true)
  })

  it('saves custom manual food with full backend payload', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    const item = await client.saveCustomFood({
      title: 'Custom tofu bowl',
      defaultWeightGrams: 180,
      totalCalories: 216,
      totalProtein: 19.8,
      totalCarbs: 14.4,
      totalFat: 9,
      nutrientsPer100g: {
        calories: 120,
        protein: 11,
        carbs: 8,
        fat: 5,
        fiber: 2,
        sugar: 1,
        sodium_mg: 180,
      },
      extraNutrients: {
        calories: 120,
        protein: 11,
        carbs: 8,
        fat: 5,
        fiber: 2,
        sugar: 1,
        sodium_mg: 180,
      },
      imagePath: ' https://cdn.example.com/food.jpg ',
      imagePaths: [' https://cdn.example.com/food.jpg ', ''],
      portionLabel: '一碗 180g',
      recommendReason: '自定义录入 / 每 100g',
      shareToPublic: true,
    })

    const req = requests.find((entry) => entry.url.includes('/api/manual-food/custom') && entry.options?.method === 'POST')
    expect(item.id).toBe('custom-1')
    expect(req?.options?.body).toMatchObject({
      title: 'Custom tofu bowl',
      default_weight_grams: 180,
      total_calories: 216,
      total_protein: 19.8,
      total_carbs: 14.4,
      total_fat: 9,
      nutrients_per_100g: {
        calories: 120,
        protein: 11,
        carbs: 8,
        fat: 5,
        fiber: 2,
        sugar: 1,
        sodium_mg: 180,
      },
      extra_nutrients: {
        calories: 120,
        protein: 11,
        carbs: 8,
        fat: 5,
        fiber: 2,
        sugar: 1,
        sodium_mg: 180,
      },
      image_path: 'https://cdn.example.com/food.jpg',
      image_paths: ['https://cdn.example.com/food.jpg'],
      portion_label: '一碗 180g',
      recommend_reason: '自定义录入 / 每 100g',
      share_to_public: true,
    })
  })

  it('calls migrated app feature APIs with backend field names', async () => {
    const { adapters, requests } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.loginWithAppWechat({ code: 'expo-go-dev-wechat-code' })
    await client.listMembershipPlans()
    await client.createMembershipPayment('standard_monthly')
    await client.communityGetContext('record-1', 'food_record')
    await client.communityAddComment({ targetId: 'record-1', targetType: 'food_record', content: 'nice' })
    await client.communityReport({ targetId: 'record-1', targetType: 'food_record', reason: 'other', extraContent: 'bad' })
    const leaderboard = await client.communityGetCheckinLeaderboard()
    await client.createCirclePost({
      title: '训练餐',
      body: '鸡胸肉和米饭',
      imageUrls: [' https://cdn.example.com/post.jpg '],
      nutrition: {
        total_calories: 520,
        total_protein: 42,
        total_carbs: 58,
        total_fat: 12,
        fiber: 6,
        sugar: 4,
        sodium_mg: 330,
        total_weight_grams: 420,
      },
    })
    await client.updateCirclePost('post-1', {
      title: '训练餐更新',
      body: '加了蔬菜',
      imageUrls: ['https://cdn.example.com/post-2.jpg'],
      nutrition: {
        total_calories: 540,
        total_protein: 45,
        total_carbs: 60,
        total_fat: 13,
        fiber: 7,
        sugar: 5,
        sodium_mg: 350,
        total_weight_grams: 450,
      },
    })
    await client.deleteCirclePost('post-1')
    await client.listRecipes()
    await client.getRecipe('recipe-1')
    await client.useRecipe('recipe-1', 'lunch')
    await client.listPublicFoods({ isCampusFood: true, schoolName: '北大' })
    await client.getCampusFoodDetail('food-1')
    await client.updatePublicFood('food-1', { foodName: '鸡胸饭', totalCalories: 430 })
    await client.deletePublicFood('food-1')
    await client.publicFoodLike('food-1', false)
    await client.publicFoodCollect('food-1', false)
    await client.addPublicFoodComment('food-1', 'good', 5)
    await client.getPublicProfile('user-2')
    await client.getFollowers('user-2')
    await client.getFollowing('user-2')
    await client.getFollowStats('user-2')
    await client.followUser('user-2', false)
    await client.getInviteProfile('user-1')
    await client.getInviteProfileByCode('ABCD1234')
    await client.resolveInvite('ABCD1234')
    await client.acceptInvite('ABCD1234')
    await client.getPetSummary('2026-06-15')
    await client.claimPetEvent('event-1')
    await client.rerollPetAppearance()
    await client.selectPetAppearance('candidate-1')
    await client.listConversations()
    await client.getConversation('user-2')
    await client.sendPrivateMessage('user-2', 'hi')
    await client.sendPrivateMessage('user-2', { contentType: 'image', imageUrl: 'https://cdn.example.com/chat.jpg' })

    expect(requests.some((req) => req.url.endsWith('/api/membership/pay/create') && (req.options?.body as any).plan_code === 'standard_monthly')).toBe(true)
    expect(requests.some((req) => req.url.includes('/api/community/feed-targets/food_record/record-1/comments') && (req.options?.body as any).content === 'nice')).toBe(true)
    expect(leaderboard.list[0]?.checkin_count).toBe(5)
    expect(requests.some((req) => req.url.endsWith('/api/community/checkin-leaderboard'))).toBe(true)
    expect(requests.some((req) => {
      const body = req.options?.body as any
      return req.url.endsWith('/api/community/posts') &&
        req.options?.method === 'POST' &&
        body.title === '训练餐' &&
        body.image_urls?.[0] === 'https://cdn.example.com/post.jpg' &&
        body.nutrition?.fiber === 6 &&
        body.nutrition?.sodium_mg === 330 &&
        body.nutrition?.total_weight_grams === 420
    })).toBe(true)
    expect(requests.some((req) => {
      const body = req.options?.body as any
      return req.url.endsWith('/api/community/posts/post-1') &&
        req.options?.method === 'PUT' &&
        body.title === '训练餐更新' &&
        body.nutrition?.total_calories === 540 &&
        body.nutrition?.fiber === 7
    })).toBe(true)
    expect(requests.some((req) => req.url.endsWith('/api/community/posts/post-1') && req.options?.method === 'DELETE')).toBe(true)
    expect(requests.some((req) => req.url.includes('/api/public-food-library?') && req.url.includes('is_campus_food=true'))).toBe(true)
    expect(requests.some((req) => req.url.includes('/api/friend/invite/resolve') && req.url.includes('ABCD1234'))).toBe(true)
    expect(requests.some((req) => req.url.includes('/api/pet/summary') && req.url.includes('date=2026-06-15'))).toBe(true)
    expect(requests.some((req) => {
      const body = req.options?.body as any
      return req.url.endsWith('/api/messages/send') &&
        body.receiver_id === 'user-2' &&
        body.content === 'hi' &&
        body.content_type === 'text'
    })).toBe(true)
    expect(requests.some((req) => {
      const body = req.options?.body as any
      return req.url.endsWith('/api/messages/send') &&
        body.receiver_id === 'user-2' &&
        body.content === '' &&
        body.content_type === 'image' &&
        body.image_url === 'https://cdn.example.com/chat.jpg'
    })).toBe(true)
  })
})
