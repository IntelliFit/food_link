import type { PrivateMessage } from '../../src/utils/api'
import {
  isInviteRewardSystemMessage,
  isRewardSystemMessage,
  resolveSystemMessageActionPath,
} from '../../src/utils/system-message-action'

function message(overrides: Partial<PrivateMessage>): PrivateMessage {
  return {
    id: 'message-1',
    sender_id: 'system',
    receiver_id: 'user-1',
    content: '',
    image_url: '',
    content_type: 'system',
    is_read: false,
    created_at: '2026-07-14T08:38:00+08:00',
    ...overrides,
  }
}

describe('system message reward actions', () => {
  it('makes legacy reward messages clickable even when action metadata is missing', () => {
    const legacy = message({
      content: '恭喜你获得「新用户试用卡」，点击前往「我的礼券」查看并使用。',
    })

    expect(isRewardSystemMessage(legacy)).toBe(true)
    expect(resolveSystemMessageActionPath(legacy)).toBe('/packageExtra/pages/reward-center/index?section=rewards')
  })

  it('redirects old invite membership messages to the dedicated invite channel', () => {
    const legacy = message({
      content: '恭喜你获得一周轻度版会员',
      extra_data: { path: '/packageExtra/pages/my-vouchers/index', target: 'my-vouchers' },
    })

    expect(isInviteRewardSystemMessage(legacy)).toBe(true)
    expect(resolveSystemMessageActionPath(legacy)).toBe('/packageExtra/pages/invite-friends/index?section=rewards')
  })

  it('routes new invite reward metadata to the dedicated invite channel', () => {
    const inviteReward = message({
      content: '恭喜你获得「3 天轻度版会员」，完成受邀任务奖励。',
      extra_data: { path: '/pages/invite-friends/index?section=rewards', target: 'invite-rewards' },
    })

    expect(resolveSystemMessageActionPath(inviteReward)).toBe('/packageExtra/pages/invite-friends/index?section=rewards')
  })

  it('keeps unrelated system-message actions unchanged', () => {
    const other = message({
      content: '你的反馈已处理',
      extra_data: { path: '/pages/feedback/index' },
    })

    expect(isRewardSystemMessage(other)).toBe(false)
    expect(resolveSystemMessageActionPath(other)).toBe('/packageExtra/pages/feedback/index')
  })
})
