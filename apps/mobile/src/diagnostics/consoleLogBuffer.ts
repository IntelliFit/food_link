export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type ConsoleLogEntry = {
  level: ConsoleLogLevel
  message: string
  at: string
}

export const CONSOLE_LOG_BUFFER_LIMIT = 80

let installed = false
let consoleLogBuffer: ConsoleLogEntry[] = []

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

function appendConsoleLog(entry: ConsoleLogEntry): void {
  if (CONSOLE_LOG_BUFFER_LIMIT <= 0) return
  consoleLogBuffer = [...consoleLogBuffer, entry].slice(-CONSOLE_LOG_BUFFER_LIMIT)
}

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

export function getRecentConsoleLogs(limit = CONSOLE_LOG_BUFFER_LIMIT): ConsoleLogEntry[] {
  const normalizedLimit = Math.min(CONSOLE_LOG_BUFFER_LIMIT, Math.max(0, Math.floor(limit)))
  if (normalizedLimit <= 0) return []
  return consoleLogBuffer.slice(-normalizedLimit)
}

export function clearRecentConsoleLogs(): void {
  consoleLogBuffer = []
}
