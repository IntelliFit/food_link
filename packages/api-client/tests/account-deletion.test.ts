import { createFoodLinkApiClient, type ApiClientAdapters, type ApiClientRequestOptions } from '../src'

describe('shared account deletion contract', () => {
  function setup() {
    const request = jest.fn(async (_url: string, _options?: ApiClientRequestOptions) => ({ status: 200, data: { code: 0, data: { status: { state: 'pending', can_cancel: true }, access_token: 'limited', user_id: 'u1' } } }))
    const setTokens = jest.fn(async () => undefined)
    const clearTokens = jest.fn(async () => undefined)
    const adapters: ApiClientAdapters = { request, uploadFile: jest.fn(), tokenStorage: { getAccessToken: async () => 'access', setTokens, clearTokens } }
    return { client: createFoodLinkApiClient({ baseUrl: 'https://example.test', adapters }), request, setTokens, clearTokens }
  }
  it.each([7, 0] as const)('uses the same explicit %s day choice and restricted credentials', async days => {
    const { client, request, setTokens } = setup()
    await client.deleteAccount(days)
    expect(request).toHaveBeenCalledWith('https://example.test/api/user/account', expect.objectContaining({ method: 'DELETE', body: { confirmation: '注销账号', cooling_off_days: days } }))
    expect(setTokens).toHaveBeenCalledWith({ accessToken: 'limited', refreshToken: '', userId: 'u1' })
  })
  it('defaults old callers to seven days', async () => {
    const { client, request } = setup()
    await client.deleteAccount()
    expect(request.mock.calls[0][1]).toEqual(expect.objectContaining({ body: { confirmation: '注销账号', cooling_off_days: 7 } }))
  })
  it('reads status separately and explicitly confirms cancellation', async () => {
    const { client, request, clearTokens } = setup()
    await client.getAccountDeletionStatus()
    expect(clearTokens).not.toHaveBeenCalled()
    await client.cancelAccountDeletion()
    expect(request).toHaveBeenLastCalledWith('https://example.test/api/user/account/deletion/cancel', expect.objectContaining({ method: 'POST', body: { confirmation: '撤销注销' } }))
    expect(clearTokens).toHaveBeenCalledTimes(1)
  })
})
