import AsyncStorage from '@react-native-async-storage/async-storage'
import { createFoodLinkApiClient, type ApiClientRequestOptions, type RecentRequestTrace, type UploadFileInput } from '@food-link/api-client'
import { API_BASE_URL } from './config'

const ACCESS_TOKEN_KEY = 'food_link_mobile_access_token'
const REFRESH_TOKEN_KEY = 'food_link_mobile_refresh_token'
const USER_ID_KEY = 'food_link_mobile_user_id'
export const RECENT_REQUEST_TRACE_LIMIT = 50

const recentRequestTraces: RecentRequestTrace[] = []

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

function getHeaderValue(headers: Record<string, string> | undefined, key: string): string | undefined {
  if (!headers) return undefined
  const target = key.toLowerCase()
  const matchedKey = Object.keys(headers).find((candidate) => candidate.toLowerCase() === target)
  if (!matchedKey) return undefined
  const value = headers[matchedKey]?.trim()
  return value || undefined
}

function normalizeTraceId(value: string | undefined): string | undefined {
  const text = String(value || '').trim()
  if (!text) return undefined
  const lowered = text.toLowerCase()
  if (['no-trace-id', 'none', 'null', 'undefined'].includes(lowered)) return undefined
  return text
}

function normalizeRequestPath(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return '/'
  if (raw.startsWith(API_BASE_URL)) return raw.slice(API_BASE_URL.length) || '/'
  try {
    const parsed = new URL(raw)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`
  }
}

function requestErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message.slice(0, 160)
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; errMsg?: unknown }
    const message = String(record.message || record.errMsg || '').trim()
    if (message) return message.slice(0, 160)
  }
  return undefined
}

function recordRequestTrace(params: {
  url: string
  method: string
  startedAt: number
  statusCode?: number
  headers?: Record<string, string>
  error?: unknown
}): void {
  if (RECENT_REQUEST_TRACE_LIMIT <= 0) return
  const statusCode = params.statusCode ?? 0
  recentRequestTraces.push({
    method: params.method.toUpperCase(),
    path: normalizeRequestPath(params.url),
    statusCode,
    durationMs: Math.max(0, Date.now() - params.startedAt),
    startedAt: new Date(params.startedAt).toISOString(),
    traceId: normalizeTraceId(getHeaderValue(params.headers, 'x-trace-id')),
    requestId: getHeaderValue(params.headers, 'x-request-id'),
    hostName: getHeaderValue(params.headers, 'x-host-name'),
    errorMessage: requestErrorMessage(params.error) || (statusCode === 0 ? '未收到 HTTP 响应' : undefined),
  })
  if (recentRequestTraces.length > RECENT_REQUEST_TRACE_LIMIT) {
    recentRequestTraces.splice(0, recentRequestTraces.length - RECENT_REQUEST_TRACE_LIMIT)
  }
}

export function getRecentRequestTraces(limit = RECENT_REQUEST_TRACE_LIMIT): RecentRequestTrace[] {
  const normalizedLimit = Math.min(RECENT_REQUEST_TRACE_LIMIT, Math.max(0, Math.floor(limit)))
  if (normalizedLimit <= 0) return []
  return recentRequestTraces.slice(-normalizedLimit)
}

export const apiClient = createFoodLinkApiClient({
  baseUrl: API_BASE_URL,
  adapters: {
    async request(url: string, options?: ApiClientRequestOptions) {
      const method = options?.method || 'GET'
      const startedAt = Date.now()
      try {
        const response = await fetch(url, {
          method,
          headers: options?.headers,
          body: options?.body == null ? undefined : JSON.stringify(options.body),
          signal: timeoutSignal(options?.timeoutMs),
        })
        const headers = readHeaders(response)
        const data = await parseJsonResponse(response)
        recordRequestTrace({ url, method, startedAt, statusCode: response.status, headers })
        return {
          status: response.status,
          data,
          headers,
        }
      } catch (error) {
        recordRequestTrace({ url, method, startedAt, error })
        throw error
      }
    },
    async uploadFile(input: UploadFileInput) {
      const startedAt = Date.now()
      const formData = new FormData()
      formData.append(input.fieldName, {
        uri: input.fileUri,
        name: input.fileName || 'food.jpg',
        type: input.mimeType || 'image/jpeg',
      } as unknown as Blob)

      try {
        const response = await fetch(input.url, {
          method: 'POST',
          headers: input.headers,
          body: formData,
          signal: timeoutSignal(input.timeoutMs),
        })
        const headers = readHeaders(response)
        const data = await parseJsonResponse(response)
        recordRequestTrace({ url: input.url, method: 'POST', startedAt, statusCode: response.status, headers })
        return {
          status: response.status,
          data,
          headers,
        }
      } catch (error) {
        recordRequestTrace({ url: input.url, method: 'POST', startedAt, error })
        throw error
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
