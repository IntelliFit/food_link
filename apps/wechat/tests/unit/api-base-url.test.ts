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
  runtimeEnv?: 'development' | 'production'
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
  ;(global as typeof globalThis & { __RUNTIME_ENV__?: string }).__RUNTIME_ENV__ =
    input.runtimeEnv ?? 'development'
}

function loadResolver(): typeof import('../../src/utils/api-base-url') {
  jest.resetModules()
  return require('../../src/utils/api-base-url') as typeof import('../../src/utils/api-base-url')
}

describe('resolveApiBaseUrl', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    mockGetAccountInfoSync.mockReset()
    process.env.NODE_ENV = 'development'
    setInjectedUrls({
      release: 'https://api.healthymax.cn',
      trial: 'https://dev.api.healthymax.cn',
      develop: 'http://127.0.0.1:3010',
    })
  })

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('uses release url for release envVersion', () => {
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'release' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://api.healthymax.cn')
  })

  it('uses trial url for trial envVersion', () => {
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'trial' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://dev.api.healthymax.cn')
  })

  it('uses local develop url for a development build', () => {
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'develop' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('http://127.0.0.1:3010')
  })

  it('uses release url when a production review runs with develop envVersion', () => {
    process.env.NODE_ENV = 'production'
    setInjectedUrls({
      release: 'https://api.healthymax.cn',
      trial: 'https://dev.api.healthymax.cn',
      develop: 'http://127.0.0.1:3010',
      runtimeEnv: 'production',
    })
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'develop' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://api.healthymax.cn')
  })

  it('uses the develop url for an optimized development runtime', () => {
    process.env.NODE_ENV = 'production'
    setInjectedUrls({
      release: 'https://api.healthymax.cn',
      trial: 'https://dev.api.healthymax.cn',
      develop: 'http://127.0.0.1:3010',
      runtimeEnv: 'development',
    })
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'develop' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('http://127.0.0.1:3010')
  })

  it('falls back to trial url for a production review when release url is missing', () => {
    process.env.NODE_ENV = 'production'
    setInjectedUrls({
      trial: 'https://dev.api.healthymax.cn',
      develop: 'http://127.0.0.1:3010',
      runtimeEnv: 'production',
    })
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'develop' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://dev.api.healthymax.cn')
  })

  it('honors override before envVersion', () => {
    setInjectedUrls({ override: 'http://10.0.0.2:3010', release: 'https://api.healthymax.cn' })
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'release' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('http://10.0.0.2:3010')
  })

  it('ignores a localhost override in a production upload', () => {
    process.env.NODE_ENV = 'production'
    setInjectedUrls({
      override: 'http://127.0.0.1:3010',
      release: 'https://api.healthymax.cn',
      runtimeEnv: 'production',
    })
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'develop' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://api.healthymax.cn')
  })

  it('allows a secure public override in a production upload', () => {
    process.env.NODE_ENV = 'production'
    setInjectedUrls({
      override: 'https://audit.api.healthymax.cn',
      release: 'https://api.healthymax.cn',
      runtimeEnv: 'production',
    })
    mockGetAccountInfoSync.mockReturnValue({ miniProgram: { envVersion: 'develop' } })
    expect(loadResolver().resolveApiBaseUrl()).toBe('https://audit.api.healthymax.cn')
  })
})
