import {
  isTransientRequestError,
  withTransientRequestRetry,
} from '../../src/utils/transient-request-retry'

describe('withTransientRequestRetry', () => {
  it('retries one transient network failure', async () => {
    const request = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('request:fail timeout'))
      .mockResolvedValueOnce('ok')

    await expect(withTransientRequestRetry(request, { delayMs: 0 })).resolves.toBe('ok')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('retries retryable server responses', async () => {
    const error = Object.assign(new Error('service unavailable'), { statusCode: 503 })
    const request = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('ok')

    await expect(withTransientRequestRetry(request, { delayMs: 0 })).resolves.toBe('ok')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not retry business or authentication errors', async () => {
    const error = Object.assign(new Error('昵称已被使用'), { statusCode: 400 })
    const request = jest.fn<Promise<string>, []>().mockRejectedValue(error)

    await expect(withTransientRequestRetry(request, { delayMs: 0 })).rejects.toBe(error)
    expect(request).toHaveBeenCalledTimes(1)
    expect(isTransientRequestError(error)).toBe(false)
  })
})
