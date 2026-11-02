import Taro from '@tarojs/taro'
import { authenticatedRequest, getAccessToken, getUserProfile } from './api'

/** 保存页开关的说明：直接告诉用户这条记录谁能看到。 */
export function feedShareAudienceText(share: boolean, accountPublic: boolean): string {
  if (!share) return '只有你自己能看到'
  return accountPublic ? '所有用户都能看到，包括未登录的访客' : '只有好友能看到'
}

async function savePublicRecordsChoice(value: boolean): Promise<void> {
  const res = await authenticatedRequest('/api/user/profile', {
    method: 'PUT',
    data: { public_records: value },
  })
  if (res.statusCode !== 200) throw new Error('Update failed')
}

let reconfirmPromptOpen = false

/**
 * 存量账号在改为默认不公开后只询问一次。公开需要二次确认，
 * 任何失败都保持不公开，下次打开再问。
 */
export async function promptPublicRecordsReconfirm(): Promise<void> {
  if (reconfirmPromptOpen || !getAccessToken()) return
  reconfirmPromptOpen = true
  try {
    const profile = await getUserProfile()
    if (!profile.public_records_reconfirm_pending) return
    const first = await Taro.showModal({
      title: '记录已改为默认不公开',
      content: '你的饮食和运动记录不再对所有用户公开，历史记录现在只有好友能看到。以后可以在保存时选择是否同步到圈子，也可以在【我的】-【隐私设置】修改。',
      confirmText: '保持不公开',
      cancelText: '公开记录',
    })
    if (first.confirm) {
      await savePublicRecordsChoice(false)
      return
    }
    const second = await Taro.showModal({
      title: '确认公开你的记录？',
      content: '公开后，所有用户（包括未登录的访客）都能在圈子看到你已同步的记录和照片，包括历史记录。之后新记录默认同步，保存时可以逐条关闭。',
      confirmText: '确认公开',
      cancelText: '保持不公开',
    })
    await savePublicRecordsChoice(second.confirm)
  } catch (error) {
    console.warn('[feed-share] 公开设置询问失败', error)
  } finally {
    reconfirmPromptOpen = false
  }
}
