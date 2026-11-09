/**
 * A/B 实验客户端：匿名访客 ID、分组拉取与缓存、曝光上报、漏斗事件批量上报。
 * 不直接依赖 Taro，存储和网络由调用方注入，便于单测；默认实例见 experiments.ts。
 */

export interface ExperimentAssignment {
  variant: string
  tracked: boolean
}

export interface ExperimentSnapshot extends ExperimentAssignment {
  /** 本次启动是否已拿到服务端分组（失败也算完成，此时用缓存或对照组） */
  ready: boolean
}

export interface ExperimentStorage {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export type ExperimentRequest = (path: string, body: Record<string, unknown>, timeoutMs: number) => Promise<any>

export interface ExperimentClientOptions {
  request: ExperimentRequest
  storage: ExperimentStorage
  platform?: () => string
  appVersion?: string
  now?: () => number
  random?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export const ANON_ID_STORAGE_KEY = 'app_anon_id_v1'
export const ASSIGNMENTS_STORAGE_KEY = 'app_experiment_assignments_v1'

const ANON_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.]{1,63}$/
const ASSIGN_TIMEOUT_MS = 3000
const UPLOAD_TIMEOUT_MS = 8000
const FLUSH_DELAY_MS = 5000
const FLUSH_AT_COUNT = 20
const MAX_BATCH = 50
const MAX_QUEUE = 100
const MAX_PROPS_BYTES = 2048

interface QueuedEvent {
  name: string
  props: Record<string, unknown>
  client_ts: number
}

export interface ExperimentClient {
  anonId(): string
  refresh(): Promise<void>
  get(key: string, fallback: string): ExperimentSnapshot
  subscribe(listener: () => void): () => void
  expose(key: string): void
  track(name: string, props?: Record<string, unknown>): void
  flush(): Promise<void>
}

export function createExperimentClient(options: ExperimentClientOptions): ExperimentClient {
  const now = options.now ?? (() => Date.now())
  const random = options.random ?? Math.random
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let cachedAnonId = ''
  let assignments: Record<string, ExperimentAssignment> = readCachedAssignments(options.storage)
  let ready = false
  let inflight: Promise<void> | null = null
  let rerun = false
  const listeners = new Set<() => void>()
  const exposed = new Set<string>()
  let queue: QueuedEvent[] = []
  let flushTimer: unknown = null
  let flushing: Promise<void> | null = null

  function anonId(): string {
    if (cachedAnonId) return cachedAnonId
    try {
      const stored = String(options.storage.get(ANON_ID_STORAGE_KEY) || '').trim()
      if (ANON_ID_PATTERN.test(stored)) {
        cachedAnonId = stored
        return stored
      }
    } catch {
      // Fall through to a new id when storage is unreadable.
    }
    const id = `a_${now().toString(36)}_${randomPart(random)}${randomPart(random)}`
    cachedAnonId = id
    try {
      options.storage.set(ANON_ID_STORAGE_KEY, id)
    } catch {
      // The id still works for this launch; a later launch makes a new one.
    }
    return id
  }

  function notify() {
    listeners.forEach((listener) => listener())
  }

  function refresh(): Promise<void> {
    // A login during the launch request must still send one request with the
    // new token, so a second call while busy schedules exactly one more.
    if (inflight) {
      rerun = true
      return inflight
    }
    inflight = (async () => {
      try {
        const res = await options.request('/api/experiments/assignments', {
          anon_id: anonId(),
          platform: safeCall(options.platform),
          app_version: options.appVersion || '',
        }, ASSIGN_TIMEOUT_MS)
        const next = parseAssignments(res?.data?.assignments)
        if (next) {
          // A changed split (e.g. login moved this install onto the account's
          // own row) must be exposed again on the row now being served.
          Object.keys({ ...assignments, ...next }).forEach((key) => {
            const before = assignments[key]
            const after = next[key]
            if (before?.variant !== after?.variant || before?.tracked !== after?.tracked) exposed.delete(key)
          })
          assignments = next
          try {
            options.storage.set(ASSIGNMENTS_STORAGE_KEY, next)
          } catch {
            // Cache is only a cold-start hint; the server stays authoritative.
          }
        }
      } catch {
        // Keep the cached split; every caller falls back to its control.
      } finally {
        ready = true
        inflight = null
        notify()
        if (rerun) {
          rerun = false
          void refresh()
        }
      }
    })()
    return inflight
  }

  function get(key: string, fallback: string): ExperimentSnapshot {
    const hit = assignments[key]
    if (!hit) return { variant: fallback, tracked: false, ready }
    return { variant: hit.variant, tracked: hit.tracked, ready }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function expose(key: string) {
    if (!assignments[key]?.tracked || exposed.has(key)) return
    exposed.add(key)
    options.request('/api/experiments/exposures', { anon_id: anonId(), keys: [key] }, UPLOAD_TIMEOUT_MS)
      .catch(() => exposed.delete(key))
  }

  /** props 只放界面状态（步骤、选项、来源），不要放手机号、昵称、自由输入等个人信息 */
  function track(name: string, props: Record<string, unknown> = {}) {
    if (!EVENT_NAME_PATTERN.test(name) || !propsFit(props)) return
    queue = [...queue, { name, props, client_ts: now() }].slice(-MAX_QUEUE)
    if (queue.length >= FLUSH_AT_COUNT) {
      void flush()
      return
    }
    if (flushTimer == null) {
      flushTimer = setTimer(() => {
        flushTimer = null
        void flush()
      }, FLUSH_DELAY_MS)
    }
  }

  function flush(): Promise<void> {
    if (flushTimer != null) {
      clearTimer(flushTimer)
      flushTimer = null
    }
    if (flushing || queue.length === 0) return flushing ?? Promise.resolve()
    const batch = queue.slice(0, MAX_BATCH)
    queue = queue.slice(batch.length)
    flushing = options.request('/api/app-events', { anon_id: anonId(), events: batch }, UPLOAD_TIMEOUT_MS)
      .then(() => undefined)
      .catch((error: unknown) => {
        // Retry only what may succeed later (offline, 5xx, 429); a request the
        // server rejected as invalid would block the queue forever.
        if (isRetryable(error)) queue = [...batch, ...queue].slice(-MAX_QUEUE)
      })
      .finally(() => {
        flushing = null
      })
    return flushing
  }

  return { anonId, refresh, get, subscribe, expose, track, flush }
}

function readCachedAssignments(storage: ExperimentStorage): Record<string, ExperimentAssignment> {
  try {
    return parseAssignments(storage.get(ASSIGNMENTS_STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

function parseAssignments(raw: unknown): Record<string, ExperimentAssignment> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, ExperimentAssignment> = {}
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    const item = value as Partial<ExperimentAssignment> | null
    if (item && typeof item.variant === 'string' && item.variant) {
      out[key] = { variant: item.variant, tracked: item.tracked === true }
    }
  })
  return out
}

function randomPart(random: () => number): string {
  return random().toString(36).slice(2, 10).padEnd(8, '0')
}

function isRetryable(error: unknown): boolean {
  const status = Number((error as { statusCode?: unknown } | null)?.statusCode)
  if (!Number.isFinite(status) || status <= 0) return true
  return status === 429 || status >= 500
}

function propsFit(props: Record<string, unknown>): boolean {
  let raw: string
  try {
    raw = JSON.stringify(props)
  } catch {
    return false
  }
  if (typeof raw !== 'string') return false
  let bytes = 0
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
  }
  return bytes <= MAX_PROPS_BYTES
}

function safeCall(fn?: () => string): string {
  try {
    return fn ? String(fn() || '') : ''
  } catch {
    return ''
  }
}
