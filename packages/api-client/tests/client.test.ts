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

  it('uploads image and submits analysis task', async () => {
    const { adapters, uploads } = createMockAdapters()
    const client = createFoodLinkApiClient({ baseUrl: 'https://api.example.com', adapters })

    await client.debugImpersonateUser('user-1', 'password')
    const uploaded = await client.uploadAnalyzeImageFile({ fileUri: 'file:///food.jpg' })
    const submitted = await client.submitAnalyzeTask({ image_url: uploaded.imageUrl, meal_type: 'lunch' })

    expect(uploads[0].url).toBe('https://api.example.com/api/upload-analyze-image-file')
    expect(uploads[0].headers?.Authorization).toBe('Bearer access-token')
    expect(submitted.task_id).toBe('task-1')
  })
})
