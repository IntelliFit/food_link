import Taro from '@tarojs/taro'
import { imageToBase64, uploadUserAvatar, showUnifiedApiError } from './api'

/** 处理微信 chooseAvatar 回调：本地路径则上传，https 则直接使用 */
export async function processChooseAvatarSelection(
  avatarUrl: string,
  onSetAvatar: (url: string) => void
): Promise<void> {
  if (!avatarUrl) return
  const needUpload = !avatarUrl.startsWith('https://')
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
