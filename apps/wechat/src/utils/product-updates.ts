import Taro from '@tarojs/taro'
import { authenticatedRequest, getAccessToken, publicRequest } from './api'

declare const __APP_VERSION__: string
export const PRODUCT_UPDATE_AUTH_EVENT = 'product_update_auth_changed'
export const PRODUCT_UPDATE_GUEST_KEY = 'product_update_guest_acknowledgements_v1'

export type ProductUpdate = { id: string; title: string; content: string }

export function productUpdateSession(): string {
  const token = getAccessToken()
  return token ? `${Taro.getStorageSync('user_id') || ''}:${token}` : 'guest'
}

export function productUpdateVersion(): string {
  try { return __APP_VERSION__ } catch { return '0.0.0' }
}

export async function pendingProductUpdates(): Promise<ProductUpdate[]> {
  const query = `app_version=${encodeURIComponent(productUpdateVersion())}`
  const authenticated = Boolean(getAccessToken())
  const res = await (authenticated ? authenticatedRequest : publicRequest)(
    `/api/product-updates${authenticated ? '/pending' : ''}?${query}`,
    { method: 'GET', timeout: 10000 },
  )
  const items = Array.isArray(res.data?.items) ? res.data.items as ProductUpdate[] : []
  if (authenticated) return items
  const seen = Taro.getStorageSync(PRODUCT_UPDATE_GUEST_KEY)
  return items.filter(item => !Array.isArray(seen) || !seen.includes(item.id))
}

export async function acknowledgeProductUpdate(id: string): Promise<void> {
  if (getAccessToken()) {
    await authenticatedRequest(`/api/product-updates/${encodeURIComponent(id)}/acknowledge`, {
      method: 'POST', data: { app_version: productUpdateVersion() }, timeout: 10000,
    })
    return
  }
  const stored = Taro.getStorageSync(PRODUCT_UPDATE_GUEST_KEY)
  Taro.setStorageSync(PRODUCT_UPDATE_GUEST_KEY, [...new Set([...(Array.isArray(stored) ? stored : []), id])])
}

// A single native dialog works on every page, including subpackages and shared
// links. No close button or mask-dismiss path; only an explicit confirmation
// creates a receipt. Failed saves keep the same notice pending.
export class ProductUpdatePrompt {
  private running = false
  private requested = false
  private active = true
  private disposed = false

  hide() { this.active = false }
  dispose() { this.disposed = true; this.active = false }
  show() { this.active = true; this.check() }

  check() {
    if (this.disposed) return
    this.requested = true
    if (!this.running && this.active) void this.run()
  }

  private async run() {
    this.running = true
    try {
      while (this.requested && this.active && !this.disposed) {
        this.requested = false
        const session = productUpdateSession()
        let items: ProductUpdate[]
        try { items = await pendingProductUpdates() } catch {
          // Do not treat request failure as acknowledgement. Retry on next open.
          break
        }
        for (const item of items) {
          let acknowledged = false
          let failed = false
          while (!acknowledged && this.active && !this.disposed && productUpdateSession() === session) {
            const result = await Taro.showModal({
              title: item.title,
              content: `${item.content}${failed ? '\n\n确认未保存，请检查网络后再次确认。' : ''}`,
              showCancel: false,
              confirmText: failed ? '重试确认' : '我知道了',
              confirmColor: '#2e6b50',
            })
            if (this.disposed || !this.active || productUpdateSession() !== session) break
            // Host back gestures/cancel callbacks must never mark a notice read.
            if (!result.confirm) continue
            try {
              await acknowledgeProductUpdate(item.id)
              acknowledged = true
            } catch (error) {
              // A withdrawal/version conflict requires fetching the current list.
              if ((error as { statusCode?: number; status?: number }).statusCode === 409 || (error as { status?: number }).status === 409) {
                this.requested = true
                break
              }
              failed = true
            }
          }
          if (!acknowledged) break
        }
        if (productUpdateSession() !== session) this.requested = true
      }
    } catch {
      // Native modal failure stays pending for the next app foreground event.
    } finally {
      this.running = false
      if (this.requested && this.active && !this.disposed) this.check()
    }
  }
}
