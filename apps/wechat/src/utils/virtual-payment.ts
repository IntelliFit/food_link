export interface VirtualPaymentRequestOptions {
  signData: string
  paySig: string
  signature: string
  mode: string
}

interface VirtualPaymentCallbackOptions extends VirtualPaymentRequestOptions {
  success: (result: unknown) => void
  fail: (error: unknown) => void
}

type VirtualPaymentInvoker = (options: VirtualPaymentCallbackOptions) => unknown

/**
 * 微信虚拟支付不是当前 Taro 版本内置声明的 Promise API。
 * 必须显式等待微信原生 success / fail 回调，不能等待其同步返回值。
 */
export function requestVirtualPaymentAndWait(
  invoker: unknown,
  options: VirtualPaymentRequestOptions,
): Promise<unknown> {
  if (typeof invoker !== 'function') {
    return Promise.reject(new Error('当前微信版本暂不支持虚拟支付，请升级微信后重试'))
  }

  const invoke = invoker as VirtualPaymentInvoker
  return new Promise((resolve, reject) => {
    try {
      invoke({
        ...options,
        success: resolve,
        fail: reject,
      })
    } catch (error) {
      reject(error)
    }
  })
}

export function isVirtualPaymentCancellation(error: unknown): boolean {
  const candidate = error as { errCode?: unknown; errno?: unknown; errMsg?: unknown; message?: unknown } | null
  const errorCode = Number(candidate?.errCode ?? candidate?.errno ?? 0)
  const message = String(candidate?.errMsg ?? candidate?.message ?? '')
  return errorCode === -2 || /cancel|取消/i.test(message)
}
