import Taro from '@tarojs/taro'
import { authenticatedRequest, cancelAccountDeletion, deleteAccount, getAccountDeletionStatus, saveTokens } from '../../src/utils/api'

describe('account deletion API and session isolation', () => {
  const storage = new Map<string, unknown>()
  beforeEach(() => {
    jest.clearAllMocks()
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
    ;(Taro.getCurrentPages as jest.Mock).mockReturnValue([{ route: 'pages/profile/index' }])
    saveTokens('old-token', 'refresh', 'user-1')
  })
  it.each([7, 0] as const)('submits %s days and replaces the old session with a restricted token', async days => {
    storage.set('home_dashboard_local_cache', 'old-data')
    const status = { state: 'pending', can_cancel: days === 7 }
    ;(Taro.request as jest.Mock).mockResolvedValue({ statusCode: 200, data: { code: 0, data: { status, access_token: 'restricted-token', user_id: 'user-1' } } })
    await expect(deleteAccount('注销账号', days)).resolves.toMatchObject({ status })
    expect(Taro.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE', data: { confirmation: '注销账号', cooling_off_days: days } }))
    expect(storage.get('access_token')).toBe('restricted-token')
    expect(storage.has('home_dashboard_local_cache')).toBe(false)
  })
  it('reading pending status does not send a cancellation', async () => {
    ;(Taro.request as jest.Mock).mockResolvedValue({ statusCode: 200, data: { code: 0, data: { state: 'pending', can_cancel: true } } })
    await expect(getAccountDeletionStatus()).resolves.toMatchObject({ state: 'pending' })
    expect(Taro.request).toHaveBeenCalledTimes(1)
    expect((Taro.request as jest.Mock).mock.calls[0][0].method).toBe('GET')
  })
  it('requires explicit cancellation and clears credentials only on success', async () => {
    ;(Taro.request as jest.Mock).mockResolvedValueOnce({ statusCode: 409, data: { message: '已开始永久清理' } })
    await expect(cancelAccountDeletion()).rejects.toBeDefined()
    expect(storage.get('access_token')).toBe('old-token')
    ;(Taro.request as jest.Mock).mockResolvedValueOnce({ statusCode: 200, data: { code: 0, data: { state: 'cancelled' } } })
    await cancelAccountDeletion()
    expect(storage.has('access_token')).toBe(false)
    expect(Taro.request).toHaveBeenLastCalledWith(expect.objectContaining({ data: { confirmation: '撤销注销' } }))
  })
  it('routes a suspended business request to the status page without cancelling it', async () => {
    ;(Taro.request as jest.Mock).mockResolvedValue({ statusCode: 403, data: { code: 20021, message: '账号正在注销' } })
    await expect(authenticatedRequest('/api/user/profile')).rejects.toThrow('账号正在注销')
    expect(Taro.reLaunch).toHaveBeenCalledWith({ url: '/packageExtra/pages/account-deletion/index' })
    expect(storage.get('access_token')).toBe('old-token')
  })
})
