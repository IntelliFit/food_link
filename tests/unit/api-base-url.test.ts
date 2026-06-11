/** @jest-environment node */

const mockGetAccountInfoSync = jest.fn()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getAccountInfoSync: (...args: unknown[]) => mockGetAccountInfoSync(...args),
  },
}))

function setInjectedUrls(input: {
  release?: string
  trial?: string
  develop?: string
  override?: string
}): void {
  ;(global as typeof globalThis & {
    __API_BASE_URL_RELEASE__?: string
    __API_BASE_URL_TRIAL__?: string
    __API_BASE_URL_DEVELOP__?: string
    __API_BASE_URL_OVERRIDE__?: string
  }).__API_BASE_URL_RELEASE__ = input.release ?? ''
  ;(global as typeof globalThis & { __API_BASE_URL_TRIAL__?: string }).__API_BASE_URL_TRIAL__ =
    input.trial ?? ''
  ;(global as typeof globalThis & { __API_BASE_URL_DEVELOP__?: string }).__API_BASE_URL_DEVELOP__ =
    input.develop ?? ''
  ;(global as typeof globalThis & { __API_BASE_URL_OVERRIDE__?: string }).__API_BASE_URL_OVERRIDE__ =
    input.override ?? ''
}

function loadResolver(): typeof import('../../src/utils/api-base-url') {
  jest.resetModules()
  return require('../../src/utils/api-base-url') as typeof import('../../src/utils/api-base-url')
}

describe('resolveApiBaseUrl', () => {
  beforeEach(() => {
    mockGetAccountInfoSync.mockReset()
    setInjectedUrls({
      release: 'https://api.healthymax.cn',
      trial: 'https://dev.api.healthymax.cn',
      develop: 'http://127.0.0.1:3010',
    })
  })

  it('uses release url for release envVersion', () => {
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'release' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://api.healthymax.cn')
  })

  it('uses trial url for trial envVersion', () => {
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'trial' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://dev.api.healthymax.cn')
  })

  it('uses develop url for develop envVersion', () => {
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'develop' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('http://127.0.0.1:3010')
  })

  it('honors override before envVersion', () => {
    setInjectedUrls({ override: 'http://10.0.0.2:3010', release: 'https://api.healthymax.cn' })
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'release' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('http://10.0.0.2:3010')
  })
})
