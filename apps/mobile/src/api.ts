import AsyncStorage from '@react-native-async-storage/async-storage'
import { createFoodLinkApiClient, type ApiClientRequestOptions, type UploadFileInput } from '@food-link/api-client'
import { API_BASE_URL } from './config'

const ACCESS_TOKEN_KEY = 'food_link_mobile_access_token'
const REFRESH_TOKEN_KEY = 'food_link_mobile_refresh_token'
const USER_ID_KEY = 'food_link_mobile_user_id'

function timeoutSignal(timeoutMs?: number): AbortSignal | undefined {
  if (!timeoutMs || typeof AbortController === 'undefined') return undefined
  const controller = new AbortController()
  setTimeout(() => controller.abort(), timeoutMs)
  return controller.signal
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

function readHeaders(response: Response): Record<string, string> {
  const out: Record<string, string> = {}
  response.headers.forEach((value: string, key: string) => {
    out[key] = value
  })
  return out
}

export const apiClient = createFoodLinkApiClient({
  baseUrl: API_BASE_URL,
  adapters: {
    async request(url: string, options?: ApiClientRequestOptions) {
      const response = await fetch(url, {
        method: options?.method || 'GET',
        headers: options?.headers,
        body: options?.body == null ? undefined : JSON.stringify(options.body),
        signal: timeoutSignal(options?.timeoutMs),
      })
      return {
        status: response.status,
        data: await parseJsonResponse(response),
        headers: readHeaders(response),
      }
    },
    async uploadFile(input: UploadFileInput) {
      const formData = new FormData()
      formData.append(input.fieldName, {
        uri: input.fileUri,
        name: input.fileName || 'food.jpg',
        type: input.mimeType || 'image/jpeg',
      } as unknown as Blob)

      const response = await fetch(input.url, {
        method: 'POST',
        headers: input.headers,
        body: formData,
        signal: timeoutSignal(input.timeoutMs),
      })
      return {
        status: response.status,
        data: await parseJsonResponse(response),
        headers: readHeaders(response),
      }
    },
    tokenStorage: {
      async getAccessToken() {
        return AsyncStorage.getItem(ACCESS_TOKEN_KEY)
      },
      async setTokens(tokens) {
        await AsyncStorage.multiSet([
          [ACCESS_TOKEN_KEY, tokens.accessToken],
          [REFRESH_TOKEN_KEY, tokens.refreshToken],
          [USER_ID_KEY, tokens.userId],
        ])
      },
      async clearTokens() {
        await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_ID_KEY])
      },
    },
  },
})

export async function hasStoredToken(): Promise<boolean> {
  return Boolean(await AsyncStorage.getItem(ACCESS_TOKEN_KEY))
}

export async function getStoredUserId(): Promise<string | null> {
  return AsyncStorage.getItem(USER_ID_KEY)
}
