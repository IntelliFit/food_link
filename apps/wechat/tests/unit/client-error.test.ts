const PAGE_PATH = 'pages/stats/index?$taroTimestamp=1'
const wait = () => new Promise(resolve => setTimeout(resolve, 150))

function load() {
  jest.resetModules()
  const Taro = require('@tarojs/taro').default ?? require('@tarojs/taro')
  Taro.getCurrentPages = jest.fn(() => [{ route: 'pages/stats/index', $taroPath: PAGE_PATH }])
  Taro.getStorageSync = jest.fn(() => '')
  Taro.showModal = jest.fn(() => Promise.resolve({ confirm: true, cancel: false }))
  Taro.reLaunch = jest.fn(() => Promise.resolve({}))
  Taro.request = jest.fn(() => Promise.resolve({ statusCode: 200, data: { code: 0, message: 'ok', data: {} }, header: {} }))
  Taro.canIUse = jest.fn(() => false)
  const logger = { error: jest.fn() }
  Taro.getRealtimeLogManager = jest.fn(() => logger)
  const client = require('../../src/utils/client-error')
  return { Taro, client, logger }
}

function mountPageRoot(children: number) {
  document.body.innerHTML = ''
  const root = document.createElement('div')
  root.id = PAGE_PATH
  for (let i = 0; i < children; i += 1) root.appendChild(document.createElement('div'))
  document.body.appendChild(root)
}

const reports = (Taro: any) => Taro.request.mock.calls
  .map(([options]: any[]) => options)
  .filter((options: any) => String(options.url).endsWith('/api/client-errors'))

describe('client error handling', () => {
  it('reports the error with page details and writes the realtime log', async () => {
    const { Taro, client, logger } = load()
    mountPageRoot(1)
    client.handleClientError('error', new Error('boom'))
    await wait()
    expect(reports(Taro)).toHaveLength(1)
    expect(reports(Taro)[0]).toMatchObject({ method: 'POST' })
    expect(reports(Taro)[0].data).toMatchObject({ kind: 'error', route: 'pages/stats/index', page_blank: false })
    expect(reports(Taro)[0].data.message).toContain('boom')
    expect(typeof reports(Taro)[0].data.app_version).toBe('string')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('leaves a page that still has content alone', async () => {
    const { Taro, client } = load()
    mountPageRoot(2)
    client.handleClientError('error', 'event handler failed')
    await wait()
    expect(Taro.showModal).not.toHaveBeenCalled()
    expect(Taro.reLaunch).not.toHaveBeenCalled()
  })

  it('offers to reopen a blank page, then explains how to recover if it stays blank', async () => {
    const { Taro, client } = load()
    mountPageRoot(0)
    client.handleClientError('error', 'render crash')
    await wait()
    expect(reports(Taro)[0].data.page_blank).toBe(true)
    expect(Taro.showModal).toHaveBeenCalledTimes(1)
    expect(Taro.showModal.mock.calls[0][0]).toMatchObject({ showCancel: false, confirmText: '重新打开' })
    expect(Taro.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/index/index' }))

    client.handleClientError('error', 'render crash')
    await wait()
    expect(Taro.showModal).toHaveBeenCalledTimes(2)
    expect(Taro.showModal.mock.calls[1][0].content).toContain('删除')
    expect(Taro.reLaunch).toHaveBeenCalledTimes(1)

    client.handleClientError('error', 'render crash')
    await wait()
    expect(Taro.showModal).toHaveBeenCalledTimes(2)
  })

  it('prefers a downloaded update over reopening the broken version', async () => {
    const { Taro, client } = load()
    const updates = require('../../src/utils/app-update')
    const manager = {
      onUpdateReady: jest.fn((fn: () => void) => fn()),
      onUpdateFailed: jest.fn(),
      applyUpdate: jest.fn(),
    }
    Taro.canIUse = jest.fn(() => true)
    Taro.getUpdateManager = jest.fn(() => manager)
    updates.installAppUpdateCheck()
    await wait()
    manager.applyUpdate.mockClear()
    mountPageRoot(0)
    client.handleClientError('error', 'render crash')
    await wait()
    expect(manager.applyUpdate).toHaveBeenCalledTimes(1)
    expect(Taro.reLaunch).not.toHaveBeenCalled()
  })

  it('offers recovery again when the app returns to a blank page after an error', async () => {
    const { Taro, client } = load()
    mountPageRoot(1)
    client.recheckBlankPageAfterError()
    expect(Taro.showModal).not.toHaveBeenCalled()
    client.handleClientError('error', 'first')
    await wait()
    expect(Taro.showModal).not.toHaveBeenCalled()
    mountPageRoot(0)
    client.recheckBlankPageAfterError()
    expect(Taro.showModal).toHaveBeenCalledTimes(1)
  })

  it('does not treat a rejected promise as a blank page', async () => {
    const { Taro, client } = load()
    mountPageRoot(0)
    client.handleClientError('rejection', new Error('request failed'))
    await wait()
    expect(reports(Taro)[0].data).toMatchObject({ kind: 'rejection', page_blank: false })
    expect(Taro.showModal).not.toHaveBeenCalled()
  })

  it('reports the message of a plain-object rejection instead of [object Object]', async () => {
    const { Taro, client } = load()
    mountPageRoot(1)
    client.handleClientError('rejection', { errMsg: 'request:fail timeout', errno: 5 })
    await wait()
    expect(reports(Taro)[0].data.message).toBe('request:fail timeout (5)')
    expect(client.errorText({ code: 7 })).toBe('{"code":7}')
    expect(client.errorText('plain')).toBe('plain')
  })

  it('skips repeats, caps reports per launch and truncates long messages', async () => {
    const { Taro, client } = load()
    mountPageRoot(1)
    client.handleClientError('error', 'same')
    client.handleClientError('error', 'same')
    await wait()
    expect(reports(Taro)).toHaveLength(1)
    for (let i = 0; i < 10; i += 1) client.handleClientError('error', `${i}-${'x'.repeat(5000)}`)
    await wait()
    expect(reports(Taro)).toHaveLength(5)
    expect(reports(Taro)[1].data.message.length).toBeLessThanOrEqual(2000)
  })

  it('survives a failing report and a missing page', async () => {
    const { Taro, client } = load()
    Taro.request = jest.fn(() => Promise.reject(new Error('offline')))
    Taro.getRealtimeLogManager = jest.fn(() => { throw new Error('unsupported') })
    Taro.getCurrentPages = jest.fn(() => [])
    expect(() => client.handleClientError('error', 'boom')).not.toThrow()
    await wait()
    expect(Taro.showModal).not.toHaveBeenCalled()
  })
})
