/**
 * 仅 development 构建使用：本地预置「测试用图片 URL」，供调试工具写入 analyze/记录详情等，只测前端 UI。
 */
import Taro from '@tarojs/taro'

export const DEV_DEBUG_UI_TEST_IMAGE_URL_KEY = 'devDebugUiTestImageUrl'

export function getDevDebugUiTestImageUrl(): string {
  try {
    const v = Taro.getStorageSync(DEV_DEBUG_UI_TEST_IMAGE_URL_KEY)
    if (typeof v !== 'string') return ''
    return v.trim()
  } catch {
    return ''
  }
}

/** 非空则返回单张图路径数组，供 `analyzeImagePaths` / 记录预览 */
export function getDevDebugUiTestImagePaths(): string[] {
  const u = getDevDebugUiTestImageUrl()
  return u ? [u] : []
}

export function setDevDebugUiTestImageUrl(url: string): void {
  const t = url.trim()
  if (!t) {
    try {
      Taro.removeStorageSync(DEV_DEBUG_UI_TEST_IMAGE_URL_KEY)
    } catch {
      /* ignore */
    }
    return
  }
  Taro.setStorageSync(DEV_DEBUG_UI_TEST_IMAGE_URL_KEY, t)
}
