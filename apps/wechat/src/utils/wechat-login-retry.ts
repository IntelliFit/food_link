import { isTransientRequestError } from './transient-request-retry'

interface FreshWechatLoginRetryOptions<T> {
  initialCode: string
  request: (code: string) => Promise<T>
  getFreshCode: () => Promise<string>
  delayMs?: number
}

/**
 * 微信登录 code 是一次性的。发生临时网络故障时，必须重新调用 wx.login
 * 获取新 code，不能直接重放旧请求。
 */
export async function loginWithFreshWechatCodeRetry<T>(
  options: FreshWechatLoginRetryOptions<T>,
): Promise<T> {
  try {
    return await options.request(options.initialCode)
  } catch (error) {
    if (!isTransientRequestError(error)) {
      throw error
    }
    const delayMs = Math.max(0, options.delayMs ?? 260)
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    }
    const freshCode = String(await options.getFreshCode()).trim()
    if (!freshCode) {
      throw new Error('重新获取微信登录凭证失败，请重试')
    }
    return options.request(freshCode)
  }
}
