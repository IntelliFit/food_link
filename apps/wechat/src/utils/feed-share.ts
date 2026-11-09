import Taro from '@tarojs/taro'
import { authenticatedRequest, getAccessToken, getUserProfile, type UserInfo } from './api'
import { extraPkgUrl } from './subpackage-extra'

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

/** 第一次保存记录后提醒的内容：直接说清楚谁能看到。 */
export function recordVisibilityNotice(profile: Pick<UserInfo, 'public_records' | 'friends_can_view_records'>): string {
  if (profile.public_records === true) {
    return '你保存的饮食、运动记录和照片会出现在圈子，所有用户（包括未登录的访客）都能看到。不想公开，可以在【我的】-【隐私设置】关闭“允许陌生人看到”。'
  }
  if (profile.friends_can_view_records === false) {
    return '你保存的记录只有你自己能看到。可以在【我的】-【隐私设置】修改。'
  }
  return '你保存的记录只有互相加了好友的人能看到。可以在【我的】-【隐私设置】修改。'
}

const VISIBILITY_NOTICE_DUE_KEY = 'record_visibility_notice_due'
const visibilityNoticeSeenKey = (userId: string) => `record_visibility_notice_seen_${userId}`

/** 保存记录成功后调用；提醒在回到首页或当前页时弹出，每个账号只提醒一次。 */
export function markRecordVisibilityNoticeDue(): void {
  try {
    Taro.setStorageSync(VISIBILITY_NOTICE_DUE_KEY, '1')
  } catch {
    /* 存储不可用时不提醒 */
  }
}

let visibilityNoticeOpen = false

export async function remindRecordVisibilityOnce(): Promise<void> {
  if (visibilityNoticeOpen || !getAccessToken()) return
  try {
    if (Taro.getStorageSync(VISIBILITY_NOTICE_DUE_KEY) !== '1') return
    const userId = String(Taro.getStorageSync('user_id') || '').trim()
    if (!userId) return
    const seenKey = visibilityNoticeSeenKey(userId)
    if (Taro.getStorageSync(seenKey)) {
      Taro.removeStorageSync(VISIBILITY_NOTICE_DUE_KEY)
      return
    }
    visibilityNoticeOpen = true
    const profile = await getUserProfile()
    // 待确认的老账号由 promptPublicRecordsReconfirm 询问，不重复打扰。
    if (profile.public_records_reconfirm_pending) return
    Taro.setStorageSync(seenKey, '1')
    Taro.removeStorageSync(VISIBILITY_NOTICE_DUE_KEY)
    const res = await Taro.showModal({
      title: '你的记录谁能看到',
      content: recordVisibilityNotice(profile),
      confirmText: '知道了',
      cancelText: '去设置',
    })
    if (res.cancel) {
      void Taro.navigateTo({ url: extraPkgUrl('/pages/privacy-settings/index') })
    }
  } catch (error) {
    console.warn('[feed-share] 记录可见范围提醒失败', error)
  } finally {
    visibilityNoticeOpen = false
  }
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
      title: '要公开你的记录吗？',
      content: '你的饮食和运动记录现在只有互相加了好友的人能看到。公开后，所有用户都能在圈子看到。也可以以后在【我的】-【隐私设置】修改。',
      confirmText: '只给好友',
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
      cancelText: '只给好友',
    })
    await savePublicRecordsChoice(second.confirm)
  } catch (error) {
    console.warn('[feed-share] 公开设置询问失败', error)
  } finally {
    reconfirmPromptOpen = false
  }
}
