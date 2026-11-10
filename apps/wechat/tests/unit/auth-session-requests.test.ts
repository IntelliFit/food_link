import Taro from '@tarojs/taro'
import { authenticatedRequest, clearTokens, saveTokens, streamGeneratePetChat, submitAnalyzeTask, submitTextAnalyzeTask, continuePrecisionSession } from '../../src/utils/api'
import { captureAuthSession, isAuthSessionCurrent } from '../../src/utils/auth-session'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('authenticated requests belong to their login session', () => {
  const storage = new Map<string, unknown>()
  beforeEach(() => {
    jest.clearAllMocks()
    storage.clear()
    ;(Taro.getStorageSync as jest.Mock).mockImplementation(key => storage.get(key))
    ;(Taro.setStorageSync as jest.Mock).mockImplementation((key, value) => storage.set(key, value))
    ;(Taro.removeStorageSync as jest.Mock).mockImplementation(key => storage.delete(key))
    saveTokens('token-a', 'refresh-a', 'user-a')
  })

  it('keeps a valid login on business 403 and exposes the HTTP status', async () => {
    ;(Taro.request as jest.Mock).mockResolvedValue({ statusCode: 403, data: { detail: '无权查看这条动态' } })
    await expect(authenticatedRequest('/api/community/feed/context')).rejects.toMatchObject({ statusCode: 403 })
    expect(storage.get('access_token')).toBe('token-a')
    expect(Taro.redirectTo).not.toHaveBeenCalled()
  })

  it('still clears and redirects on a current-session 401', async () => {
    ;(Taro.request as jest.Mock).mockResolvedValue({ statusCode: 401, data: { detail: 'expired' } })
    await expect(authenticatedRequest('/api/home/dashboard')).rejects.toThrow('登录已失效')
    expect(storage.has('access_token')).toBe(false)
    expect(Taro.redirectTo).toHaveBeenCalledTimes(1)
  })

  it.each([200, 401, 403])('discards a late A response (%s) without touching B', async statusCode => {
    const response = deferred<any>()
    ;(Taro.request as jest.Mock).mockReturnValue(response.promise)
    const pending = authenticatedRequest('/api/home/dashboard')
    clearTokens()
    saveTokens('token-b', 'refresh-b', 'user-b')
    response.resolve({ statusCode, data: { meals: ['private A meal'] } })
    await expect(pending).rejects.toMatchObject({ code: 'auth_session_changed' })
    expect(storage.get('access_token')).toBe('token-b')
    expect(storage.get('user_id')).toBe('user-b')
    expect(Taro.redirectTo).not.toHaveBeenCalled()
  })

  it('discards an old A response after A -> B -> A even with the same token', async () => {
    const response = deferred<any>()
    ;(Taro.request as jest.Mock).mockReturnValue(response.promise)
    const pending = authenticatedRequest('/api/home/dashboard')
    saveTokens('token-b', 'refresh-b', 'user-b')
    saveTokens('token-a', 'refresh-a', 'user-a')
    response.resolve({ statusCode: 200, data: { meals: ['old A'] } })
    await expect(pending).rejects.toMatchObject({ code: 'auth_session_changed' })
    expect(storage.get('access_token')).toBe('token-a')
  })

  it('invalidates snapshots on logout and same-account token rotation', () => {
    const first = captureAuthSession()
    saveTokens('rotated-a', 'refresh-a', 'user-a')
    expect(isAuthSessionCurrent(first)).toBe(false)
    const rotated = captureAuthSession()
    clearTokens()
    expect(isAuthSessionCurrent(rotated)).toBe(false)
  })

  it('does not let a rejected old request produce a new-session auth error', async () => {
    const response = deferred<any>()
    ;(Taro.request as jest.Mock).mockReturnValue(response.promise)
    const pending = authenticatedRequest('/api/home/dashboard')
    saveTokens('token-b', 'refresh-b', 'user-b')
    response.reject(new Error('request timeout'))
    await expect(pending).rejects.toMatchObject({ code: 'auth_session_changed' })
    expect(storage.get('access_token')).toBe('token-b')
  })

  it('preserves login and HTTP status for a streaming business 403', () => {
    const onError = jest.fn()
    ;(Taro.request as jest.Mock).mockReturnValue({ abort: jest.fn() })
    streamGeneratePetChat('看一下', 'week', '', false, { onChunk: jest.fn(), onDone: jest.fn(), onError })
    const options = (Taro.request as jest.Mock).mock.calls[0][0]
    options.success({ statusCode: 403, data: { detail: '无权查看' } })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }))
    expect(storage.get('access_token')).toBe('token-a')
    expect(Taro.redirectTo).not.toHaveBeenCalled()
  })

  it('does not deliver old streaming chunks or let an old streaming 401 clear B', () => {
    const onChunk = jest.fn(), onDone = jest.fn(), onError = jest.fn(), onCancel = jest.fn(), abort = jest.fn()
    let onReceived!: (value: any) => void
    ;(Taro.request as jest.Mock).mockReturnValue({ abort, onChunkReceived: (callback: any) => { onReceived = callback } })
    streamGeneratePetChat('看一下', 'week', '', false, { onChunk, onDone, onError, onCancel })
    const options = (Taro.request as jest.Mock).mock.calls[0][0]
    saveTokens('token-b', 'refresh-b', 'user-b')
    onReceived({ data: 'data: {"type":"chunk","text":"A private answer"}\n\n' })
    options.success({ statusCode: 401, data: {} })
    expect(onChunk).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(storage.get('access_token')).toBe('token-b')
    expect(Taro.redirectTo).not.toHaveBeenCalled()
  })

  it('still logs out on the current stream session 401', () => {
    const onError = jest.fn()
    ;(Taro.request as jest.Mock).mockReturnValue({ abort: jest.fn() })
    streamGeneratePetChat('看一下', 'week', '', false, { onChunk: jest.fn(), onDone: jest.fn(), onError })
    ;(Taro.request as jest.Mock).mock.calls[0][0].success({ statusCode: 401, data: {} })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('登录已失效') }))
    expect(storage.has('access_token')).toBe(false)
  })

  it.each(['photo', 'text', 'precision'])('does not submit %s A payload using B token after awaiting location', async entry => {
    const setting = deferred<any>()
    Object.assign(Taro, {
      getEnv: jest.fn(() => 'WEAPP'), ENV_TYPE: { WEAPP: 'WEAPP' },
      getSetting: jest.fn(() => setting.promise),
    })
    const pending = entry === 'photo'
      ? submitAnalyzeTask({ image_url: 'https://example.invalid/A.jpg' } as any)
      : entry === 'text'
        ? submitTextAnalyzeTask({ text: 'A private meal' } as any)
        : continuePrecisionSession('session-A', {} as any)
    saveTokens('token-b', 'refresh-b', 'user-b')
    setting.resolve({ authSetting: {} })
    await expect(pending).rejects.toMatchObject({ code: 'auth_session_changed' })
    expect(Taro.request).not.toHaveBeenCalled()
  })

  it('guards the async submit boundary even when location is already supplied', async () => {
    const pending = submitTextAnalyzeTask({ text: 'A private meal', province: '北京市' } as any)
    saveTokens('token-b', 'refresh-b', 'user-b')
    await expect(pending).rejects.toMatchObject({ code: 'auth_session_changed' })
    expect(Taro.request).not.toHaveBeenCalled()
  })

  it('still submits the current owner payload after enrichment', async () => {
    ;(Taro.request as jest.Mock).mockResolvedValue({ statusCode: 200, data: { task_id: 'task-A' } })
    await expect(submitTextAnalyzeTask({ text: 'meal', province: '北京市' } as any)).resolves.toMatchObject({ task_id: 'task-A' })
    expect((Taro.request as jest.Mock).mock.calls[0][0].header.Authorization).toBe('Bearer token-a')
  })

  it('immediately cancels an idle old stream on auth change and releases its owner lock', () => {
    const listeners = new Set<() => void>()
    ;(Taro.eventCenter.on as jest.Mock).mockImplementation((_event, handler) => { listeners.add(handler) })
    ;(Taro.eventCenter.off as jest.Mock).mockImplementation((_event, handler) => { listeners.delete(handler) })
    ;(Taro.eventCenter.trigger as jest.Mock).mockImplementation(() => { [...listeners].forEach(handler => handler()) })
    const onError = jest.fn(), onChunk = jest.fn(), abort = jest.fn()
    let locked = true
    ;(Taro.request as jest.Mock).mockReturnValue({ abort })
    streamGeneratePetChat('old A question', 'week', '', false, {
      onChunk, onDone: jest.fn(), onError, onCancel: () => { locked = false },
    })
    saveTokens('token-b', 'refresh-b', 'user-b')
    expect(locked).toBe(false)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(onChunk).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
})
