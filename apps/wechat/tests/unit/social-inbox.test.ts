import Taro from '@tarojs/taro'
import { communityGetNotifications, friendGetRequests, getAccessToken, getUnreadMessageCount } from '../../src/utils/api'
import { getSocialInboxSnapshot, refreshSocialInbox, resetSocialInbox } from '../../src/utils/social-inbox'

jest.mock('../../src/utils/api', () => ({ communityGetNotifications: jest.fn(), friendGetRequests: jest.fn(), getAccessToken: jest.fn(), getUnreadMessageCount: jest.fn() }))

describe('shared social inbox', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAccessToken as jest.Mock).mockReturnValue('token-a')
    ;(Taro.getStorageSync as jest.Mock).mockReturnValue('alice')
    ;(communityGetNotifications as jest.Mock).mockResolvedValue({ unread_count: 3 })
    ;(getUnreadMessageCount as jest.Mock).mockResolvedValue({ count: 2 })
    ;(friendGetRequests as jest.Mock).mockResolvedValue({ list: [{ id: 'request-1' }] })
    resetSocialInbox()
  })
  it('shares requests between tabs and preserves successful counts on partial failure', async () => {
    const first = refreshSocialInbox(true); const second = refreshSocialInbox(true)
    expect(first).toBe(second)
    await first
    expect(communityGetNotifications).toHaveBeenCalledTimes(1)
    ;(getUnreadMessageCount as jest.Mock).mockRejectedValue(new Error('offline'))
    ;(communityGetNotifications as jest.Mock).mockResolvedValue({ unread_count: 0 })
    expect(await refreshSocialInbox(true)).toEqual({ interactions: 0, messages: 2, friendRequests: 1 })
  })
  it('never shows a prior account response after a session change', async () => {
    let resolve!: (value: { unread_count: number }) => void
    ;(communityGetNotifications as jest.Mock).mockReturnValue(new Promise(done => { resolve = done }))
    const request = refreshSocialInbox(true)
    ;(getAccessToken as jest.Mock).mockReturnValue('token-b')
    expect(getSocialInboxSnapshot()).toEqual({ interactions: 0, messages: 0, friendRequests: 0 })
    resolve({ unread_count: 99 }); await request
    expect(getSocialInboxSnapshot().interactions).toBe(0)
  })
  it('invalidates an in-flight response when the user clears caches', async () => {
    let resolve!: (value: { unread_count: number }) => void
    ;(communityGetNotifications as jest.Mock).mockReturnValue(new Promise(done => { resolve = done }))
    const request = refreshSocialInbox(true)
    resetSocialInbox(); resolve({ unread_count: 99 }); await request
    expect(getSocialInboxSnapshot().interactions).toBe(0)
  })
})
