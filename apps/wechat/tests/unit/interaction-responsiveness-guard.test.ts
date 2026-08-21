import { readFileSync } from 'fs'
import { join } from 'path'

describe('mini program interaction responsiveness guards', () => {
  const readSource = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8')
  const homeSource = readSource('src/pages/index/index.tsx')
  const recordMenuSource = readSource('src/pages/index/components/RecordMenu.tsx')
  const tabBarSource = readSource('custom-tab-bar/index.js')
  const apiSource = readSource('src/utils/api.ts')
  const consoleBufferSource = readSource('src/utils/console-log-buffer.ts')
  const appSource = readSource('src/app.ts')

  it('does not keep hidden tab bars or the home record menu on aggressive polling loops', () => {
    expect(tabBarSource).toContain('pageLifetimes')
    expect(tabBarSource).toMatch(/hide\(\)\s*\{\s*this\.stopPolling\(\)/)
    expect(tabBarSource).toContain('openRecordMenuWithRetry()')
    expect(tabBarSource).toContain("url: '/packageExtra/pages/analyze/index'")
    expect(homeSource).not.toContain('const maxChecks = 1200')
    expect(homeSource).not.toContain('}, 50)')
  })

  it('locks duplicate image actions and records the native picker stages', () => {
    expect(recordMenuSource).toContain('const MEMBERSHIP_PREFLIGHT_TIMEOUT_MS = 500')
    expect(recordMenuSource).toContain('imagePickLockRef.current')
    expect(recordMenuSource).toContain("logRecordMenuStage('native-picker-start'")
    expect(recordMenuSource).toContain("logRecordMenuStage('native-picker-failed'")
  })

  it('keeps diagnostics off the synchronous storage hot path', () => {
    expect(consoleBufferSource).toContain('schedulePersistConsoleLogs()')
    expect(consoleBufferSource).not.toContain('Taro.setStorageSync(CONSOLE_LOG_STORAGE_KEY')
    expect(apiSource).toContain('scheduleRecentRequestTracePersist()')
    expect(apiSource).not.toContain('Taro.setStorageSync(RECENT_REQUEST_TRACE_STORAGE_KEY')
    expect(apiSource).toContain("recordResponseTrace({ url: uploadUrl, method: 'POST'")
    expect(apiSource).toContain('const key = `${getMembershipCacheOwnerId()}:${dateKey}`')
  })

  it('captures global runtime, promise and memory failures for feedback diagnostics', () => {
    expect(appSource).toContain('onError?.(onGlobalError)')
    expect(appSource).toContain('onUnhandledRejection?.(onUnhandledRejection)')
    expect(appSource).toContain('onMemoryWarning?.(onMemoryWarning)')
  })
})
