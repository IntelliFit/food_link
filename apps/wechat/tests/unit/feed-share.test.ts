import Taro from '@tarojs/taro'
import { authenticatedRequest, getAccessToken, getUserProfile } from '../../src/utils/api'
import { circlePostAudienceHint, nextRecordVisibility, promptPublicRecordsReconfirm, recordVisibilityNotice, markRecordVisibilityNoticeDue, remindRecordVisibilityOnce } from '../../src/utils/feed-share'

const mockStorage = new Map<string, string>()
jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    showModal: jest.fn(),
    navigateTo: jest.fn(() => Promise.resolve()),
    getStorageSync: jest.fn((key: string) => mockStorage.get(key) || ''),
    setStorageSync: jest.fn((key: string, value: string) => { mockStorage.set(key, value) }),
    removeStorageSync: jest.fn((key: string) => { mockStorage.delete(key) }),
  },
}))

jest.mock('../../src/utils/api', () => ({
  authenticatedRequest: jest.fn(),
  getAccessToken: jest.fn(),
  getUserProfile: jest.fn(),
}))

const showModal = Taro.showModal as jest.Mock
const update = authenticatedRequest as jest.Mock

describe('nextRecordVisibility', () => {
  const friendsOnly = { friends_can_view_records: true, public_records: false }

  it('opening to strangers also opens to friends', () => {
    expect(nextRecordVisibility({ friends_can_view_records: false, public_records: false }, 'public_records', true))
      .toEqual({ friends_can_view_records: true, public_records: true })
  })

  it('closing to friends also closes to strangers', () => {
    expect(nextRecordVisibility({ friends_can_view_records: true, public_records: true }, 'friends_can_view_records', false))
      .toEqual({ friends_can_view_records: false, public_records: false })
  })

  it('closing to strangers leaves friends alone', () => {
    expect(nextRecordVisibility({ friends_can_view_records: true, public_records: true }, 'public_records', false))
      .toEqual(friendsOnly)
  })

  it('opening to friends leaves strangers closed', () => {
    expect(nextRecordVisibility({ friends_can_view_records: false, public_records: false }, 'friends_can_view_records', true))
      .toEqual(friendsOnly)
  })
})

describe('circlePostAudienceHint', () => {
  it('says exactly who can see the post', () => {
    expect(circlePostAudienceHint({ public_records: true, friends_can_view_records: true })).toBe('')
    expect(circlePostAudienceHint({ public_records: false, friends_can_view_records: true })).toContain('只有好友能看到')
    expect(circlePostAudienceHint({ public_records: false })).toContain('只有好友能看到')
    expect(circlePostAudienceHint({ public_records: false, friends_can_view_records: false })).toContain('只有你自己能看到')
  })
})

describe('promptPublicRecordsReconfirm', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAccessToken as jest.Mock).mockReturnValue('token')
    ;(getUserProfile as jest.Mock).mockResolvedValue({ public_records_reconfirm_pending: true })
    update.mockResolvedValue({ statusCode: 200 })
  })

  it('does nothing for guests', async () => {
    ;(getAccessToken as jest.Mock).mockReturnValue('')
    await promptPublicRecordsReconfirm()
    expect(getUserProfile).not.toHaveBeenCalled()
    expect(showModal).not.toHaveBeenCalled()
  })

  it('does not ask accounts that are not pending', async () => {
    ;(getUserProfile as jest.Mock).mockResolvedValue({ public_records_reconfirm_pending: false })
    await promptPublicRecordsReconfirm()
    expect(showModal).not.toHaveBeenCalled()
  })

  it('keeps the account private when the user keeps it private', async () => {
    showModal.mockResolvedValueOnce({ confirm: true, cancel: false })
    await promptPublicRecordsReconfirm()
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('/api/user/profile', { method: 'PUT', data: { public_records: false } })
  })

  it('only goes public after the second confirmation', async () => {
    showModal
      .mockResolvedValueOnce({ confirm: false, cancel: true })
      .mockResolvedValueOnce({ confirm: true, cancel: false })
    await promptPublicRecordsReconfirm()
    expect(update).toHaveBeenCalledWith('/api/user/profile', { method: 'PUT', data: { public_records: true } })
  })

  it('stays private when the second confirmation is declined', async () => {
    showModal
      .mockResolvedValueOnce({ confirm: false, cancel: true })
      .mockResolvedValueOnce({ confirm: false, cancel: true })
    await promptPublicRecordsReconfirm()
    expect(update).toHaveBeenCalledWith('/api/user/profile', { method: 'PUT', data: { public_records: false } })
  })

  it('never sends public when the first modal fails', async () => {
    showModal.mockRejectedValueOnce(new Error('modal failed'))
    await promptPublicRecordsReconfirm()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('recordVisibilityNotice', () => {
  it('says exactly who can see new records', () => {
    expect(recordVisibilityNotice({ public_records: true, friends_can_view_records: true })).toContain('所有用户')
    expect(recordVisibilityNotice({ public_records: false, friends_can_view_records: true })).toContain('互相加了好友')
    expect(recordVisibilityNotice({ public_records: false, friends_can_view_records: false })).toContain('只有你自己')
  })
})

describe('remindRecordVisibilityOnce', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorage.clear()
    mockStorage.set('user_id', 'u1')
    ;(getAccessToken as jest.Mock).mockReturnValue('token')
    ;(getUserProfile as jest.Mock).mockResolvedValue({ public_records: true, friends_can_view_records: true })
    showModal.mockResolvedValue({ confirm: true, cancel: false })
  })

  it('waits until a record has been saved', async () => {
    await remindRecordVisibilityOnce()
    expect(showModal).not.toHaveBeenCalled()
  })

  it('tells a public account once', async () => {
    markRecordVisibilityNoticeDue()
    await remindRecordVisibilityOnce()
    markRecordVisibilityNoticeDue()
    await remindRecordVisibilityOnce()
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(showModal.mock.calls[0][0].content).toContain('所有用户')
  })

  it('leaves accounts that are still being asked to the reconfirm prompt', async () => {
    ;(getUserProfile as jest.Mock).mockResolvedValue({ public_records: false, public_records_reconfirm_pending: true })
    markRecordVisibilityNoticeDue()
    await remindRecordVisibilityOnce()
    expect(showModal).not.toHaveBeenCalled()
  })
})
