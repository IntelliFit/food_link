import { NativeModules, Platform } from 'react-native'
import { WECHAT_APP_ID } from '../config'

export type WechatShareScene = 'session' | 'timeline'

type WechatAuthNativeModule = {
  authorize(appId: string): Promise<string>
  shareWebpage?(
    appId: string,
    webpageUrl: string,
    title: string,
    description: string,
    scene: WechatShareScene,
  ): Promise<boolean>
}

const nativeModule = NativeModules.FoodLinkWechatAuth as WechatAuthNativeModule | undefined

export function isNativeWechatAuthAvailable() {
  return Platform.OS === 'android' && typeof nativeModule?.authorize === 'function'
}

export function isNativeWechatShareAvailable() {
  return Platform.OS === 'android' && typeof nativeModule?.shareWebpage === 'function'
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

export async function shareWebpageToWechat(input: {
  webpageUrl: string
  title: string
  description: string
  scene?: WechatShareScene
}) {
  if (!isNativeWechatShareAvailable()) {
    throw new Error('当前 App 包不包含微信分享组件，请安装最新正式包后重试')
  }
  const webpageUrl = input.webpageUrl.trim()
  if (!webpageUrl) throw new Error('缺少分享链接')
  await nativeModule!.shareWebpage!(
    WECHAT_APP_ID,
    webpageUrl,
    input.title.trim() || 'Food Link 饮食记录',
    input.description.trim() || '来自 Food Link 的饮食记录',
    input.scene || 'session',
  )
}
