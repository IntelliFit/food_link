export interface TransientRequestRetryOptions {
  retries?: number
  delayMs?: number
}

export function isTransientRequestError(error: unknown): boolean {
  const statusCode = Number((error as { statusCode?: number })?.statusCode || 0)
  if (statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500) {
    return true
  }

  const message = String(
    (error as { errMsg?: string; message?: string })?.errMsg ||
    (error as { message?: string })?.message ||
    error ||
    ''
  ).toLowerCase()

  return (
    message.includes('request:fail') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('socket') ||
    message.includes('econn')
  )
}

export async function withTransientRequestRetry<T>(
  request: () => Promise<T>,
  options: TransientRequestRetryOptions = {}
): Promise<T> {
  const retries = Math.max(0, options.retries ?? 1)
  const delayMs = Math.max(0, options.delayMs ?? 260)

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request()
    } catch (error) {
      if (attempt >= retries || !isTransientRequestError(error)) {
        throw error
      }
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
}
