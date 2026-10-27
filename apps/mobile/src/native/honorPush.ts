import { NativeEventEmitter, NativeModules, Platform } from 'react-native'

type HonorRegistration = { provider: 'honor'; token: string; project_id: string }
type HonorPushBridge = {
  appId?: string
  getRegistration(): Promise<HonorRegistration | null>
  addListener(name: string): void
  removeListeners(count: number): void
}

const bridge = Platform.OS === 'android'
  ? NativeModules.FoodlinkHonorPush as HonorPushBridge | undefined
  : undefined

export function isHonorPushConfigured(): boolean {
  return !!bridge?.appId && typeof bridge.getRegistration === 'function'
}

/** Must be called only within the authenticated, permission-checked register flow. */
export async function getHonorPushRegistration(): Promise<HonorRegistration | null> {
  if (!isHonorPushConfigured() || !bridge) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const registration = await Promise.race([
      bridge.getRegistration(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 20000) }),
    ])
    if (registration === null) return null // OS capability is absent; retain Expo.
    if (registration.provider !== 'honor' || !registration.token || registration.project_id !== bridge.appId) {
      throw new Error('invalid registration')
    }
    return registration
  } catch {
    // Do not surface SDK errors containing a device token or vendor credentials.
    throw new Error('荣耀推送注册未完成，请检查荣耀应用配置和网络后重试')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function addHonorPushTokenListener(refresh: () => void): { remove(): void } {
  if (!bridge || !isHonorPushConfigured()) return { remove() {} }
  return new NativeEventEmitter(bridge).addListener('foodlinkHonorTokenChanged', refresh)
}
