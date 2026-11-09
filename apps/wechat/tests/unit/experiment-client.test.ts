/** @jest-environment node */

import {
  ANON_ID_STORAGE_KEY,
  ASSIGNMENTS_STORAGE_KEY,
  createExperimentClient,
  type ExperimentRequest,
} from '../../src/utils/experiment-client'

function memoryStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial }
  return {
    data,
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value
    },
  }
}

function setup(overrides: { request?: ExperimentRequest; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const storage = overrides.storage ?? memoryStorage()
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  const timers: Array<() => void> = []
  const request: ExperimentRequest = overrides.request
    ?? (async (path, body) => {
      calls.push({ path, body })
      if (path === '/api/experiments/assignments') {
        return { data: { assignments: { onboarding_v2: { variant: 'pet_flow', tracked: true }, home_ai: { variant: 'control', tracked: false } } } }
      }
      return { data: {} }
    })
  const client = createExperimentClient({
    request: overrides.request ? (path, body, timeout) => {
      calls.push({ path, body })
      return request(path, body, timeout)
    } : request,
    storage,
    platform: () => 'ios',
    appVersion: '4.7.0',
    now: () => 1_700_000_000_000,
    random: () => 0.123456789,
    setTimer: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimer: () => undefined,
  })
  return { client, storage, calls, timers }
}

describe('experiment client', () => {
  it('creates one anonymous id and reuses the stored one', () => {
    const { client, storage } = setup()
    const id = client.anonId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
    expect(storage.data[ANON_ID_STORAGE_KEY]).toBe(id)
    expect(client.anonId()).toBe(id)

    const reused = setup({ storage: memoryStorage({ [ANON_ID_STORAGE_KEY]: 'a_existing_visitor' }) })
    expect(reused.client.anonId()).toBe('a_existing_visitor')
  })

  it('replaces an invalid stored id', () => {
    const { client } = setup({ storage: memoryStorage({ [ANON_ID_STORAGE_KEY]: 'bad id!' }) })
    expect(client.anonId()).not.toBe('bad id!')
  })

  it('serves the control until assignments arrive, then the server variant', async () => {
    const { client, calls, storage } = setup()
    expect(client.get('onboarding_v2', 'control')).toEqual({ variant: 'control', tracked: false, ready: false })

    let notified = 0
    client.subscribe(() => { notified += 1 })
    await client.refresh()

    expect(calls[0]).toEqual({
      path: '/api/experiments/assignments',
      body: { anon_id: client.anonId(), platform: 'ios', app_version: '4.7.0' },
    })
    expect(client.get('onboarding_v2', 'control')).toEqual({ variant: 'pet_flow', tracked: true, ready: true })
    expect(client.get('unknown_exp', 'control')).toEqual({ variant: 'control', tracked: false, ready: true })
    expect(notified).toBe(1)
    expect(storage.data[ASSIGNMENTS_STORAGE_KEY]).toEqual({
      onboarding_v2: { variant: 'pet_flow', tracked: true },
      home_ai: { variant: 'control', tracked: false },
    })
  })

  it('keeps the cached split and becomes ready when the request fails', async () => {
    const storage = memoryStorage({ [ASSIGNMENTS_STORAGE_KEY]: { onboarding_v2: { variant: 'pet_flow', tracked: true } } })
    const { client } = setup({ storage, request: async () => { throw new Error('offline') } })
    expect(client.get('onboarding_v2', 'control').variant).toBe('pet_flow')
    await client.refresh()
    expect(client.get('onboarding_v2', 'control')).toEqual({ variant: 'pet_flow', tracked: true, ready: true })
  })

  it('sends one more request when refreshed again mid-flight (login during launch)', async () => {
    let release: () => void = () => undefined
    let count = 0
    const { client } = setup({
      request: (path) => {
        if (path !== '/api/experiments/assignments') return Promise.resolve({ data: {} })
        count += 1
        if (count === 1) return new Promise((resolve) => { release = () => resolve({ data: { assignments: {} } }) })
        return Promise.resolve({ data: { assignments: { onboarding_v2: { variant: 'pet_flow', tracked: true } } } })
      },
    })
    const first = client.refresh()
    client.refresh()
    client.refresh()
    release()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(count).toBe(2)
    expect(client.get('onboarding_v2', 'control').variant).toBe('pet_flow')
  })

  it('reports exposure once per launch and only for tracked assignments', async () => {
    const { client, calls } = setup()
    await client.refresh()
    client.expose('onboarding_v2')
    client.expose('onboarding_v2')
    client.expose('home_ai')
    client.expose('unknown_exp')
    const exposures = calls.filter((c) => c.path === '/api/experiments/exposures')
    expect(exposures).toEqual([{ path: '/api/experiments/exposures', body: { anon_id: client.anonId(), keys: ['onboarding_v2'] } }])
  })

  it('batches events, drops invalid names and retries a failed upload', async () => {
    let fail = true
    const uploads: Array<Record<string, unknown>> = []
    const { client, timers } = setup({
      request: async (path, body) => {
        if (path === '/api/app-events') {
          uploads.push(body)
          if (fail) throw new Error('offline')
        }
        return { data: {} }
      },
    })
    client.track('welcome_view')
    client.track('Bad Name')
    client.track('persona_pick', { persona: 'gym' })
    expect(timers).toHaveLength(1)

    await client.flush()
    expect(uploads).toHaveLength(1)
    expect((uploads[0].events as unknown[]).length).toBe(2)

    fail = false
    await client.flush()
    expect(uploads).toHaveLength(2)
    expect(uploads[1].events).toEqual([
      { name: 'welcome_view', props: {}, client_ts: 1_700_000_000_000 },
      { name: 'persona_pick', props: { persona: 'gym' }, client_ts: 1_700_000_000_000 },
    ])
    await client.flush()
    expect(uploads).toHaveLength(2)
  })

  it('drops a batch the server rejects but retries server errors', async () => {
    let status = 400
    const uploads: Array<Record<string, unknown>> = []
    const { client } = setup({
      request: async (path, body) => {
        if (path === '/api/app-events') {
          uploads.push(body)
          throw Object.assign(new Error('rejected'), { statusCode: status })
        }
        return { data: {} }
      },
    })
    client.track('welcome_view')
    await client.flush()
    await client.flush()
    expect(uploads).toHaveLength(1)

    status = 503
    client.track('persona_pick')
    await client.flush()
    await client.flush()
    expect(uploads).toHaveLength(3)
  })

  it('drops events whose props are too large before queueing', async () => {
    const { client, calls } = setup()
    client.track('big_props', { blob: '饭'.repeat(700) })
    client.track('small_props', { persona: 'student' })
    await client.flush()
    const uploads = calls.filter((c) => c.path === '/api/app-events')
    expect((uploads[0].body.events as Array<{ name: string }>).map((e) => e.name)).toEqual(['small_props'])
  })

  it('exposes again when the served split changes after login', async () => {
    let variant = 'control'
    const { client, calls } = setup({
      request: async (path) => {
        if (path === '/api/experiments/assignments') {
          return { data: { assignments: { onboarding_v2: { variant, tracked: true } } } }
        }
        return { data: {} }
      },
    })
    await client.refresh()
    client.expose('onboarding_v2')
    await client.refresh()
    client.expose('onboarding_v2')
    variant = 'pet_flow'
    await client.refresh()
    client.expose('onboarding_v2')
    expect(calls.filter((c) => c.path === '/api/experiments/exposures')).toHaveLength(2)
  })

  it('flushes immediately once twenty events are queued', async () => {
    const { client, calls } = setup()
    for (let i = 0; i < 20; i += 1) client.track('step_view', { i })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const uploads = calls.filter((c) => c.path === '/api/app-events')
    expect(uploads).toHaveLength(1)
    expect((uploads[0].body.events as unknown[]).length).toBe(20)
  })
})
