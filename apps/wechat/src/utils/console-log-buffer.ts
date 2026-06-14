import Taro from '@tarojs/taro'

export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type ConsoleLogEntry = {
  level: ConsoleLogLevel
  message: string
  at: string
}

const CONSOLE_LOG_STORAGE_KEY = 'recent_console_logs_v1'
const DEFAULT_CONSOLE_LOG_LIMIT = 80
const MAX_CONSOLE_LOG_LIMIT = 120

declare const __CONSOLE_LOG_BUFFER_LIMIT__: string

function readConsoleLogLimit(): number {
  try {
    const raw = typeof __CONSOLE_LOG_BUFFER_LIMIT__ !== 'undefined' ? __CONSOLE_LOG_BUFFER_LIMIT__ : ''
    const parsed = Number.parseInt(String(raw || DEFAULT_CONSOLE_LOG_LIMIT), 10)
    if (!Number.isFinite(parsed)) return DEFAULT_CONSOLE_LOG_LIMIT
    return Math.min(MAX_CONSOLE_LOG_LIMIT, Math.max(0, parsed))
  } catch {
    return DEFAULT_CONSOLE_LOG_LIMIT
  }
}

export const CONSOLE_LOG_BUFFER_LIMIT = readConsoleLogLimit()

let consoleLogBuffer: ConsoleLogEntry[] | null = null
let installed = false

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((item) => {
      if (typeof item === 'string') return item
      if (item instanceof Error) return item.message
      try {
        return JSON.stringify(item)
      } catch {
        return String(item)
      }
    })
    .join(' ')
    .slice(0, 500)
}

function trimConsoleLogs(items: ConsoleLogEntry[]): ConsoleLogEntry[] {
  if (CONSOLE_LOG_BUFFER_LIMIT <= 0) return []
  return items.slice(-CONSOLE_LOG_BUFFER_LIMIT)
}

function loadConsoleLogs(): ConsoleLogEntry[] {
  if (consoleLogBuffer) return consoleLogBuffer
  try {
    const cached = Taro.getStorageSync(CONSOLE_LOG_STORAGE_KEY)
    consoleLogBuffer = Array.isArray(cached) ? trimConsoleLogs(cached as ConsoleLogEntry[]) : []
  } catch {
    consoleLogBuffer = []
  }
  return consoleLogBuffer
}

function persistConsoleLogs(items: ConsoleLogEntry[]): void {
  try {
    Taro.setStorageSync(CONSOLE_LOG_STORAGE_KEY, items)
  } catch {
    // 本地诊断缓存失败不影响主流程
  }
}

function appendConsoleLog(entry: ConsoleLogEntry): void {
  if (CONSOLE_LOG_BUFFER_LIMIT <= 0) return
  const next = trimConsoleLogs([...loadConsoleLogs(), entry])
  consoleLogBuffer = next
  persistConsoleLogs(next)
}

/** 安装 console 拦截，采集最近日志供反馈诊断附带 */
export function installConsoleLogCapture(): void {
  if (installed || CONSOLE_LOG_BUFFER_LIMIT <= 0) return
  installed = true

  ;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
    const original = console[level]?.bind(console)
    if (!original) return
    console[level] = (...args: unknown[]) => {
      appendConsoleLog({
        level,
        message: formatConsoleArgs(args),
        at: new Date().toISOString(),
      })
      original(...args)
    }
  })
}

/** 获取最近 console 输出，供意见反馈附带 */
export function getRecentConsoleLogs(limit = CONSOLE_LOG_BUFFER_LIMIT): ConsoleLogEntry[] {
  const normalizedLimit = Math.min(CONSOLE_LOG_BUFFER_LIMIT, Math.max(0, Math.floor(limit)))
  if (normalizedLimit <= 0) return []
  return loadConsoleLogs().slice(-normalizedLimit)
}

/** 供 profile 清除缓存时重置 */
export function clearRecentConsoleLogs(): void {
  consoleLogBuffer = []
  try {
    Taro.removeStorageSync(CONSOLE_LOG_STORAGE_KEY)
  } catch {
    // ignore
  }
}
