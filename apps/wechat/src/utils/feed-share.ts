import Taro from '@tarojs/taro'
import { authenticatedRequest, getAccessToken, getUserProfile, type UserInfo } from './api'

export interface RecordVisibility {
  friends_can_view_records: boolean
  public_records: boolean
}

/**
 * 隐私设置里两个开关的联动，和后端保持一致：陌生人能看到的，好友一定能看到。
 * 所以开放给陌生人时好友也打开，对好友关闭时陌生人也关闭。
 */
export function nextRecordVisibility(
  current: RecordVisibility,
  key: keyof RecordVisibility,
  value: boolean,
): RecordVisibility {
  if (key === 'public_records') {
    return { friends_can_view_records: value || current.friends_can_view_records, public_records: value }
  }
  return { friends_can_view_records: value, public_records: value && current.public_records }
}

/** 发动态前告诉用户这条动态谁能看到；已对所有人开放时不打扰。 */
export function circlePostAudienceHint(profile: Pick<UserInfo, 'public_records' | 'friends_can_view_records'>): string {
  if (profile.public_records === true) return ''
  if (profile.friends_can_view_records === false) {
    return '这条动态目前只有你自己能看到。想让好友看到，去隐私设置开启'
  }
  return '这条动态目前只有好友能看到。想让陌生人也看到，去隐私设置开启'
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
      content: '你的饮食和运动记录不再对所有用户公开，现在只有互相加了好友的人能看到。可以在【我的】-【隐私设置】修改。',
      confirmText: '保持不公开',
      cancelText: '公开记录',
    })
    if (first.confirm) {
      await savePublicRecordsChoice(false)
      return
    }
    const second = await Taro.showModal({
      title: '确认公开你的记录？',
      content: '公开后，所有用户（包括未登录的访客）都能在圈子看到你的记录和照片，包括历史记录。',
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
