import type { PrivateMessage } from './api'
import { extraPkgUrl } from './subpackage-extra'

export function isInviteRewardSystemMessage(message: PrivateMessage): boolean {
  const target = String(message.extra_data?.target || '').trim()
  const path = String(message.extra_data?.path || '').trim()
  const content = String(message.content || '')
  return target === 'invite-rewards'
    || path.includes('invite-friends')
    || content.includes('邀请好友达标')
    || content.includes('完成受邀任务')
    || content.includes('一周轻度版会员')
    || content.includes('7 天轻度版会员')
}

export function isRewardSystemMessage(message: PrivateMessage): boolean {
  const target = String(message.extra_data?.target || '').trim()
  const path = String(message.extra_data?.path || '').trim()
  const content = String(message.content || '')
  return isInviteRewardSystemMessage(message)
    || target === 'my-vouchers'
    || target === 'reward-center'
    || path.includes('my-vouchers')
    || path.includes('reward-center')
    || content.includes('我的礼券')
    || content.includes('新用户试用卡')
}

export function resolveSystemMessageActionPath(message: PrivateMessage): string {
  if (isInviteRewardSystemMessage(message)) {
    return extraPkgUrl('/pages/invite-friends/index?section=rewards')
  }
  if (isRewardSystemMessage(message)) {
    return extraPkgUrl('/pages/reward-center/index?section=rewards')
  }
  const path = String(message.extra_data?.path || '').trim()
  return path ? extraPkgUrl(path) : ''
}
