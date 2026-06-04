import Taro from '@tarojs/taro'
import { imageToBase64, uploadUserAvatar, showUnifiedApiError } from './api'
import { defaultAvatarImage } from './default-user-profile'

/** 处理微信 chooseAvatar 回调：本地路径则上传，https 则直接使用 */
export async function processChooseAvatarSelection(
  avatarUrl: string,
  onSetAvatar: (url: string) => void
): Promise<void> {
  if (!avatarUrl) return
  const needUpload = !avatarUrl.startsWith('https://') && !avatarUrl.startsWith('http://')
  if (needUpload) {
    Taro.showLoading({ title: '上传中...' })
    try {
      const base64 = await imageToBase64(avatarUrl)
      const { imageUrl } = await uploadUserAvatar(base64)
      onSetAvatar(imageUrl)
      Taro.hideLoading()
    } catch (err: unknown) {
      Taro.hideLoading()
      await showUnifiedApiError(err, '上传失败')
    }
  } else {
    onSetAvatar(avatarUrl)
  }
}

/** 保存资料前：本地默认头像等资源需先上传至 COS */
export async function ensureAvatarUploadedForSave(avatarUrl: string): Promise<string> {
  const value = String(avatarUrl || '').trim()
  if (!value) return ''
  if (value.startsWith('https://') || value.startsWith('http://')) {
    return value
  }
  const base64 = await imageToBase64(value)
  const { imageUrl } = await uploadUserAvatar(base64)
  return imageUrl
}

/** 注册弹窗初始头像：优先 API，否则本地默认图 */
export function getInitialRegistrationAvatar(avatar?: string | null): string {
  const value = String(avatar || '').trim()
  return value || defaultAvatarImage
}
