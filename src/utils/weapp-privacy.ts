import Taro from '@tarojs/taro'
import { cleanupGeneratedUserFiles, isUserFileQuotaExceededError } from './weapp-user-files'

declare const wx: any

function getWxPrivacyApi(): any {
  if (typeof wx !== 'undefined') return wx
  return Taro as any
}

export function isPrivacyScopeNotDeclaredError(error: unknown): boolean {
  const message = String((error as any)?.errMsg || (error as any)?.message || error || '').toLowerCase()
  return message.includes('api scope is not declared in the privacy agreement')
}

export function isPrivacyAuthorizationDeniedError(error: unknown): boolean {
  const message = String((error as any)?.errMsg || (error as any)?.message || error || '').toLowerCase()
  return (
    message.includes('privacy permission is not authorized') ||
    message.includes('agree privacy authorization fail') ||
    message.includes('privacy authorization fail')
  )
}

export function isPrivacyAuthorizeError(error: unknown): boolean {
  return isPrivacyScopeNotDeclaredError(error) || isPrivacyAuthorizationDeniedError(error)
}

export async function ensureWeappPrivacyAuthorized(): Promise<void> {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return
  const wxApi = getWxPrivacyApi()

  if (typeof wxApi.getPrivacySetting !== 'function' || typeof wxApi.requirePrivacyAuthorize !== 'function') {
    return
  }

  const setting = await new Promise<{ needAuthorization?: boolean }>((resolve) => {
    wxApi.getPrivacySetting({
      success: resolve,
      fail: () => resolve({ needAuthorization: false }),
    })
  })

  if (!setting?.needAuthorization) return

  await new Promise<void>((resolve, reject) => {
    wxApi.requirePrivacyAuthorize({
      success: () => resolve(),
      fail: reject,
    })
  })
}

export function showPrivacyAuthorizeFailure(error: unknown, fallback = '需要先同意隐私保护指引'): void {
  if (isPrivacyScopeNotDeclaredError(error)) {
    Taro.showModal({
      title: '隐私指引未生效',
      content: '当前小程序后台的用户隐私保护指引还未生效，或未声明相册/拍照用途。请等待后台审核通过后，重新编译并清缓存再试。',
      showCancel: false,
      confirmText: '知道了',
    })
    return
  }

  if (isPrivacyAuthorizationDeniedError(error)) {
    Taro.showToast({ title: '请先同意隐私保护指引', icon: 'none' })
    return
  }

  Taro.showToast({ title: fallback, icon: 'none' })
}

export function chooseImageWithPrivacy(
  options: Taro.chooseImage.Option
): Promise<Taro.chooseImage.SuccessCallbackResult> {
  return new Promise<Taro.chooseImage.SuccessCallbackResult>((resolve, reject) => {
    const runChooseImage = () => {
      Taro.chooseImage({
        ...options,
        success: resolve,
        fail: (error) => {
          if (!isUserFileQuotaExceededError(error)) {
            reject(error)
            return
          }
          cleanupGeneratedUserFiles()
            .then(runChooseImage)
            .catch(() => reject(error))
        },
      })
    }
    runChooseImage()
  })
}
