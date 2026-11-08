import Taro from '@tarojs/taro'

/** 拍照识别的 3:4 / 4:3 取景相机页（packageCamera 分包）。 */
export const FOOD_CAMERA_PAGE = '/packageCamera/pages/shoot/index'

const FOOD_CAMERA_RESULT_KEY = 'foodCameraReturnPaths'

/**
 * 以「拍完返回」模式打开取景相机：拍到的照片交回当前页，而不是跳到识别页。
 * 当前页在 useDidShow 里用 takeFoodCameraResult() 取回照片。
 */
export async function openFoodCameraForResult(maxCount: number): Promise<void> {
  try {
    Taro.removeStorageSync(FOOD_CAMERA_RESULT_KEY)
  } catch {
    /* 清不掉旧结果时，取回时会按数量截断 */
  }
  const max = Math.max(1, Math.floor(maxCount))
  await Taro.navigateTo({ url: `${FOOD_CAMERA_PAGE}?return=1&max=${max}` })
}

/** 相机页在「拍完返回」模式下保存结果，随后 navigateBack。 */
export function saveFoodCameraResult(paths: string[]): void {
  Taro.setStorageSync(FOOD_CAMERA_RESULT_KEY, paths)
}

/** 取回并清掉相机页交回的照片；用户没拍就返回时为空数组。 */
export function takeFoodCameraResult(): string[] {
  try {
    const stored = Taro.getStorageSync(FOOD_CAMERA_RESULT_KEY)
    Taro.removeStorageSync(FOOD_CAMERA_RESULT_KEY)
    if (!Array.isArray(stored)) return []
    return stored.map(path => String(path || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}
