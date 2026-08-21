/** @jest-environment node */

const mockGetStorageSync = jest.fn()
const mockSetStorage = jest.fn((_options: unknown) => Promise.resolve())
const mockRemoveStorageSync = jest.fn()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: (key: string) => mockGetStorageSync(key),
    setStorage: (options: unknown) => mockSetStorage(options),
    removeStorageSync: (key: string) => mockRemoveStorageSync(key),
  },
}))

describe('console log buffer persistence', () => {
  const originalLog = console.log

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    mockGetStorageSync.mockReset().mockReturnValue([])
    mockSetStorage.mockClear()
    mockRemoveStorageSync.mockClear()
    ;(global as typeof globalThis & { __CONSOLE_LOG_BUFFER_LIMIT__?: string }).__CONSOLE_LOG_BUFFER_LIMIT__ = '80'
  })

  afterEach(() => {
    console.log = originalLog
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('coalesces a burst of logs into one asynchronous storage write', () => {
    const { installConsoleLogCapture } = require('../../src/utils/console-log-buffer') as typeof import('../../src/utils/console-log-buffer')
    installConsoleLogCapture()

    console.log('first')
    console.log('second')
    console.log('third')

    expect(mockSetStorage).not.toHaveBeenCalled()
    jest.advanceTimersByTime(500)
    expect(mockSetStorage).toHaveBeenCalledTimes(1)
    expect(mockSetStorage).toHaveBeenCalledWith(expect.objectContaining({
      key: 'recent_console_logs_v1',
      data: expect.arrayContaining([
        expect.objectContaining({ message: 'first' }),
        expect.objectContaining({ message: 'third' }),
      ]),
    }))
  })
})
