import Taro from '@tarojs/taro'
import { authenticatedRequest, getAccessToken, getUserProfile } from '../../src/utils/api'
import { feedShareAudienceText, promptPublicRecordsReconfirm } from '../../src/utils/feed-share'

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: { showModal: jest.fn() },
}))

jest.mock('../../src/utils/api', () => ({
  authenticatedRequest: jest.fn(),
  getAccessToken: jest.fn(),
  getUserProfile: jest.fn(),
}))

const showModal = Taro.showModal as jest.Mock
const update = authenticatedRequest as jest.Mock

describe('feedShareAudienceText', () => {
  it('says exactly who can see the record', () => {
    expect(feedShareAudienceText(false, true)).toBe('只有你自己能看到')
    expect(feedShareAudienceText(true, false)).toBe('只有好友能看到')
    expect(feedShareAudienceText(true, true)).toContain('所有用户')
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
