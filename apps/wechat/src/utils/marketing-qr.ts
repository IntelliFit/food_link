import Taro from '@tarojs/taro'

const VISITOR_ID_KEY = 'marketing_qr_visitor_id_v1'

export function parseMarketingCodeFromLaunchOptions(options?: any): string {
  const rawScene = String(options?.query?.scene || '').trim()
  let decodedScene = rawScene
  try {
    decodedScene = decodeURIComponent(rawScene)
  } catch {
    // Keep the original scene when a third-party scanner sends malformed escaping.
  }
  const params = new URLSearchParams(decodedScene)
  const rawCode = String(
    options?.query?.marketing_code
      || options?.query?.mq
      || params.get('mq')
      || params.get('marketing_code')
      || ''
  ).trim().toLowerCase()
  return /^[a-z0-9_-]{3,32}$/.test(rawCode) ? rawCode : ''
}

export function getOrCreateMarketingVisitorID(): string {
  try {
    const existing = String(Taro.getStorageSync(VISITOR_ID_KEY) || '').trim()
    if (existing.length >= 8 && existing.length <= 128) return existing
  } catch {
    // Continue with a new local identifier.
  }
  const visitorID = `mq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
  try {
    Taro.setStorageSync(VISITOR_ID_KEY, visitorID)
  } catch {
    // Attribution remains best effort when storage is unavailable.
  }
  return visitorID
}
