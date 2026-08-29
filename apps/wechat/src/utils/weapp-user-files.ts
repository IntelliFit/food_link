import Taro from '@tarojs/taro'

const GENERATED_USER_FILE_PREFIXES = ['analyze_', 'expiry_', 'cv_'] as const
const WEAPP_HTTP_FILE_PATH_PATTERN = /^https?:\/\/(tmp|usr)(?=\/|$)/i
const WEAPP_FILE_PATH_PATTERN = /^wxfile:\/\/(tmp|usr)(?=\/|$)/i

/**
 * 微信开发者工具的 webview 渲染可能把 wxfile://tmp、wxfile://usr 暴露为
 * http://tmp、http://usr。它们是本地虚拟文件，不是可供后端或 AI 访问的公网 URL。
 */
export function normalizeWeappLocalFilePath(path: string): string {
  const raw = String(path || '').trim()
  if (!raw) return ''
  return raw.replace(WEAPP_HTTP_FILE_PATH_PATTERN, (_match, location: string) => `wxfile://${location}`)
}

export function isWeappLocalFilePath(path: string): boolean {
  const raw = String(path || '').trim()
  return WEAPP_HTTP_FILE_PATH_PATTERN.test(raw) || WEAPP_FILE_PATH_PATTERN.test(raw)
}

export function isPublicHttpImageURL(path: string): boolean {
  const raw = String(path || '').trim()
  return /^https?:\/\//i.test(raw) && !isWeappLocalFilePath(raw)
}

function getUserDataPath(): string {
  return String((Taro as unknown as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH || '').trim()
}

function stringifyError(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function isUserFileQuotaExceededError(error: unknown): boolean {
  const message = stringifyError(error).toLowerCase()
  return (
    message.includes('maximum size') ||
    message.includes('storage limit') ||
    message.includes('quota') ||
    message.includes('no space')
  )
}

function isGeneratedUserFile(name: string): boolean {
  return GENERATED_USER_FILE_PREFIXES.some((prefix) => name.startsWith(prefix))
}

export async function cleanupGeneratedUserFiles(): Promise<number> {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return 0
  const userDataPath = getUserDataPath()
  if (!userDataPath) return 0
  const fs = Taro.getFileSystemManager?.()
  if (!fs) return 0

  let files: string[] = []
  try {
    const result = await new Promise<{ files?: string[] }>((resolve, reject) => {
      ;(fs as any).readdir({
        dirPath: userDataPath,
        success: resolve,
        fail: reject,
      })
    })
    files = Array.isArray(result.files) ? result.files : []
  } catch {
    return 0
  }

  let removed = 0
  for (const file of files) {
    if (!isGeneratedUserFile(file)) continue
    try {
      await new Promise<void>((resolve, reject) => {
        ;(fs as any).unlink({
          filePath: `${userDataPath}/${file}`,
          success: () => resolve(),
          fail: reject,
        })
      })
      removed += 1
    } catch {
      // Ignore per-file cleanup failures; the next file may still free space.
    }
  }
  return removed
}

export async function retryAfterGeneratedUserFileCleanup<T>(
  operation: () => Promise<T>,
  error: unknown
): Promise<T> {
  if (!isUserFileQuotaExceededError(error)) throw error
  await cleanupGeneratedUserFiles()
  return operation()
}
