import Taro from '@tarojs/taro'
import { isPrivacyAuthorizationDeniedError, isPrivacyScopeNotDeclaredError } from './weapp-privacy'

export async function requestMealLocation(): Promise<Taro.getLocation.SuccessCallbackResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Taro.getLocation({ type: 'gcj02', isHighAccuracy: true, highAccuracyExpireTime: 6000 }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('定位超时')), 10000) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function mealLocationFailure(error: unknown): { message: string; settings?: boolean } {
  const message = String((error as { errMsg?: string; message?: string })?.errMsg || (error as Error)?.message || '').toLowerCase()
  if (isPrivacyScopeNotDeclaredError(error)) return { message: '当前版本未声明定位用途，需更新小程序隐私配置' }
  if (isPrivacyAuthorizationDeniedError(error)) return { message: '未同意定位隐私授权，可点击位置图标重试' }
  if (/timeout|超时/.test(message)) return { message: '定位超时，可到信号较好的地方点击位置图标重试' }
  if (/system|service|switch|定位服务|gps/.test(message)) return { message: '手机定位服务不可用，请检查系统定位设置' }
  if (/auth deny|auth denied|permission|authorize|用户拒绝/.test(message)) return { message: '未获得定位权限', settings: true }
  return { message: '暂时无法获取位置，可点击位置图标重试' }
}

export function mealPreviewFailure(error: unknown): string {
  const message = String((error as { errMsg?: string; message?: string })?.errMsg || (error as Error)?.message || '')
  if (/timeout|超时/i.test(message)) return '餐食推荐请求超时，点击重试（不是定位失败）'
  if (/network|request:fail|网络/i.test(message)) return '餐食推荐网络连接失败，点击重试'
  if (/未登录|登录已失效/.test(message)) return '请先登录后查看餐食推荐'
  return '餐食读取失败，点击重试'
}
