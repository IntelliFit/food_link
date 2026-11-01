function load(canUse = true) {
  jest.resetModules()
  const Taro = require('@tarojs/taro').default ?? require('@tarojs/taro')
  const handlers: Record<string, () => void> = {}
  const manager = {
    onUpdateReady: jest.fn((fn: () => void) => { handlers.ready = fn }),
    onUpdateFailed: jest.fn((fn: () => void) => { handlers.failed = fn }),
    applyUpdate: jest.fn(),
  }
  Taro.canIUse = jest.fn(() => canUse)
  Taro.getUpdateManager = jest.fn(() => manager)
  Taro.showModal = jest.fn(() => Promise.resolve({ confirm: true, cancel: false }))
  const updates = require('../../src/utils/app-update')
  return { Taro, manager, handlers, updates }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('app update check', () => {
  it('asks the user to restart once a new version is downloaded', async () => {
    const { Taro, manager, handlers, updates } = load()
    updates.installAppUpdateCheck()
    expect(Taro.showModal).not.toHaveBeenCalled()
    handlers.ready()
    await tick()
    expect(Taro.showModal).toHaveBeenCalledWith(expect.objectContaining({ showCancel: false }))
    expect(manager.applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not restart when the dialog was not confirmed', async () => {
    const { Taro, manager, handlers, updates } = load()
    Taro.showModal = jest.fn(() => Promise.resolve({ confirm: false, cancel: true }))
    updates.installAppUpdateCheck()
    handlers.ready()
    await tick()
    expect(manager.applyUpdate).not.toHaveBeenCalled()
  })

  it('reports whether a downloaded update could be applied', () => {
    const { Taro, manager, handlers, updates } = load()
    Taro.showModal = jest.fn(() => new Promise(() => {}))
    updates.installAppUpdateCheck()
    expect(updates.applyPendingAppUpdate()).toBe(false)
    expect(manager.applyUpdate).not.toHaveBeenCalled()
    handlers.ready()
    expect(updates.applyPendingAppUpdate()).toBe(true)
    expect(manager.applyUpdate).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on a client without the update manager', () => {
    const { Taro, updates } = load(false)
    expect(() => updates.installAppUpdateCheck()).not.toThrow()
    expect(Taro.getUpdateManager).not.toHaveBeenCalled()
    expect(updates.applyPendingAppUpdate()).toBe(false)
  })

  it('never lets a failing update manager break app start', () => {
    const { Taro, updates } = load()
    Taro.getUpdateManager = jest.fn(() => { throw new Error('unsupported') })
    expect(() => updates.installAppUpdateCheck()).not.toThrow()
  })
})
