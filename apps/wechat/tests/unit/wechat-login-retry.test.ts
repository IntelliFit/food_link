import { loginWithFreshWechatCodeRetry } from '../../src/utils/wechat-login-retry'

describe('loginWithFreshWechatCodeRetry', () => {
  it('gets a fresh one-time code before retrying a transient failure', async () => {
    const request = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(Object.assign(new Error('微信登录服务暂时繁忙，请稍后重试'), { statusCode: 503 }))
      .mockResolvedValueOnce('ok')
    const getFreshCode = jest.fn<Promise<string>, []>().mockResolvedValue('fresh-code')

    await expect(loginWithFreshWechatCodeRetry({
      initialCode: 'initial-code',
      request,
      getFreshCode,
      delayMs: 0,
    })).resolves.toBe('ok')

    expect(request).toHaveBeenNthCalledWith(1, 'initial-code')
    expect(request).toHaveBeenNthCalledWith(2, 'fresh-code')
    expect(getFreshCode).toHaveBeenCalledTimes(1)
  })

  it('does not retry business errors', async () => {
    const error = Object.assign(new Error('登录凭证无效'), { statusCode: 400 })
    const request = jest.fn<Promise<string>, [string]>().mockRejectedValue(error)
    const getFreshCode = jest.fn<Promise<string>, []>()

    await expect(loginWithFreshWechatCodeRetry({
      initialCode: 'initial-code',
      request,
      getFreshCode,
      delayMs: 0,
    })).rejects.toBe(error)
    expect(getFreshCode).not.toHaveBeenCalled()
  })
})
