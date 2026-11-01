import Taro from '@tarojs/taro'

const PACKAGED_FOOD_UPLOAD_CONSENT_KEY = 'packagedFoodUploadConsentV1'

function hasPackagedUploadConsent() {
  try {
    return Boolean(Taro.getStorageSync(PACKAGED_FOOD_UPLOAD_CONSENT_KEY))
  } catch {
    return false
  }
}

function rememberPackagedUploadConsent() {
  Taro.setStorageSync(PACKAGED_FOOD_UPLOAD_CONSENT_KEY, {
    acceptedAt: new Date().toISOString(),
  })
}

/** 包装照片会进入公共食物库和奖励判定，首次上传前需要用户同意。 */
export function askPackagedUploadConsent(): Promise<boolean> {
  if (hasPackagedUploadConsent()) return Promise.resolve(true)
  return new Promise((resolve) => {
    Taro.showModal({
      title: '图片使用授权',
      content: '你上传的包装照片将用于 AI 识别、食物库数据建设和奖励积分判定。请确认你有权上传这些图片，并授权平台在本服务中使用。',
      confirmText: '同意上传',
      cancelText: '暂不上传',
      success: (res) => {
        if (res.confirm) {
          rememberPackagedUploadConsent()
          resolve(true)
        } else {
          resolve(false)
        }
      },
      fail: () => resolve(false),
    })
  })
}
