import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getAccessToken, showUnifiedApiError } from '../../../utils/api'
import { uploadResearchImage, uploadResearchVideo } from '../../../utils/research-weight-api'
import type { DraftPhoto } from './model'

const MAX_VIDEO_BYTES = 8 * 1024 * 1024

const isCancel = (error: any) => String(error?.errMsg || error?.message || '').includes('cancel')

/** 游客可以浏览计划，拍照和提交时才要求登录。 */
export function ensureLoggedIn(): boolean {
  if (getAccessToken()) return true
  Taro.navigateTo({ url: extraPkgUrl('/pages/login/index') }).catch(() => {
    // 跳转失败时用户仍可从「我的」登录。
  })
  return false
}

/** 拍一张原图并上传到本人的科研目录；取消或失败时返回 null。 */
export async function takeResearchPhoto(onStart?: () => void): Promise<DraftPhoto | null> {
  try {
    const result = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['original'], camera: 'back' })
    const path = String(result.tempFiles?.[0]?.tempFilePath || '').trim()
    if (!path) return null
    onStart?.()
    const url = await uploadResearchImage(path)
    return { url, capturedAt: new Date().toISOString() }
  } catch (error) {
    if (!isCancel(error)) await showUnifiedApiError(error, '照片上传失败')
    return null
  }
}

/** 录一段环绕视频并上传；取消、过大或失败时返回空字符串。 */
export async function takeResearchVideo(onStart?: () => void): Promise<string> {
  try {
    const result = await Taro.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['camera', 'album'], maxDuration: 10, camera: 'back' })
    const file = result.tempFiles?.[0]
    if (!file?.tempFilePath) return ''
    if (Number(file.size || 0) > MAX_VIDEO_BYTES) {
      Taro.showToast({ title: '视频超过8MB，请录短一点', icon: 'none' })
      return ''
    }
    onStart?.()
    return await uploadResearchVideo(file.tempFilePath)
  } catch (error) {
    if (!isCancel(error)) await showUnifiedApiError(error, '视频上传失败')
    return ''
  }
}
