import { getAdminApiBaseUrl } from '@/config'

export const API_BASE_URL = getAdminApiBaseUrl()

type ApiEnvelope<T> = {
  code?: number
  message?: string
  data?: T
}

/** 带 Cookie 的管理员 API 请求 */
export async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>
  if (!res.ok || body.code !== 0) {
    throw new Error(body.message || `请求失败 ${res.status}`)
  }
  return body.data as T
}

/** 带 Cookie 的管理员文件上传请求；由浏览器自动生成 multipart boundary。 */
export async function adminUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>
  if (!res.ok || body.code !== 0) {
    throw new Error(body.message || `上传失败 ${res.status}`)
  }
  return body.data as T
}

/** 复制文本到剪贴板并提示 */
export async function copyText(text: string): Promise<void> {
  if (!text) return
  await navigator.clipboard.writeText(text)
}

export function displayApiBase(): string {
  return API_BASE_URL || '同源'
}
