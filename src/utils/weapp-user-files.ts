import Taro from '@tarojs/taro'

const GENERATED_USER_FILE_PREFIXES = ['analyze_', 'expiry_', 'cv_'] as const

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
