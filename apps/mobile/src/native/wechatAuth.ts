import { NativeModules, Platform } from 'react-native'
import { WECHAT_APP_ID } from '../config'

type WechatAuthNativeModule = {
  authorize(appId: string): Promise<string>
}

const nativeModule = NativeModules.FoodLinkWechatAuth as WechatAuthNativeModule | undefined

export function isNativeWechatAuthAvailable() {
  return Platform.OS === 'android' && typeof nativeModule?.authorize === 'function'
}

export async function authorizeWithWechat() {
  if (!isNativeWechatAuthAvailable()) {
    throw new Error('当前 App 包不包含微信登录组件，请安装最新正式包后重试')
  }
  const code = await nativeModule!.authorize(WECHAT_APP_ID)
  const trimmedCode = code.trim()
  if (!trimmedCode) {
    throw new Error('微信授权未返回 code')
  }
  return trimmedCode
}
