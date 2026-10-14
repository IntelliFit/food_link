import { readFileSync } from 'fs'
import { resolve } from 'path'
import { runInNewContext } from 'vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

type SceneResources = typeof import('../../src/utils/balanced-theme-scenes')
function resourceRuntime() {
  const source = readFileSync(resolve(__dirname, '../../src/utils/balanced-theme-scenes.ts'), 'utf8')
  const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 } }).outputText
  const exports: Partial<SceneResources> = {}
  const require = jest.fn(() => { throw new Error('Cross-package module unavailable on device') })
  const wx = { onLazyLoadError: jest.fn(), offLazyLoadError: jest.fn() }
  runInNewContext(code, { exports, require, Promise, Set, wx, console: { warn: jest.fn() } })
  return { resources: exports as SceneResources, require, wx }
}

test('lets the native component render without requiring a cross-package JS sentinel', async () => {
  const { resources, require } = resourceRuntime()
  const paper = jest.fn()
  resources.subscribeBalancedScenes(paper)
  const first = resources.loadBalancedScenes()
  expect(resources.loadBalancedScenes()).toBe(first)
  await first
  expect(require).not.toHaveBeenCalled()
  expect(paper).toHaveBeenCalledWith(0)
})

test('one retry remounts all subscribers and removed consumers receive no events', async () => {
  const { resources } = resourceRuntime()
  const paper = jest.fn()
  const drawer = jest.fn()
  const removed = jest.fn()
  const stopPaper = resources.subscribeBalancedScenes(paper)
  resources.subscribeBalancedScenes(drawer)
  resources.subscribeBalancedScenes(removed)()
  await resources.loadBalancedScenes()
  const retry = resources.retryBalancedScenes()
  expect(resources.retryBalancedScenes()).toBe(retry)
  await retry
  expect(paper).toHaveBeenLastCalledWith(1)
  expect(drawer).toHaveBeenLastCalledWith(1)
  expect(removed).not.toHaveBeenCalled()
  stopPaper()
  await resources.retryBalancedScenes()
  expect(paper).toHaveBeenCalledTimes(2)
  expect(drawer).toHaveBeenLastCalledWith(2)
})

test('only this resource package failures request recovery and listener cleanup is scoped', async () => {
  const { resources, wx } = resourceRuntime()
  const owner = jest.fn()
  const anotherOwner = jest.fn()
  const stop = resources.subscribeBalancedScenes(owner)
  const stopAnother = resources.subscribeBalancedScenes(anotherOwner)
  expect(wx.onLazyLoadError).toHaveBeenCalledTimes(1)
  const listener = wx.onLazyLoadError.mock.calls[0][0]
  listener({ subpackage: [{ root: 'packageExtra/' }], errMsg: 'loadSubpackage: fail' })
  expect(owner).not.toHaveBeenCalled()
  listener({ subpackage: [{ root: 'packageThemeScenes/' }], errMsg: 'loadSubpackage: fail' })
  expect(owner).toHaveBeenLastCalledWith(0, true, '组件下载：loadSubpackage: fail')
  listener({ subpackage: [{ name: 'theme-scenes-nature' }], errMsg: 'nature download failed' })
  expect(owner).toHaveBeenLastCalledWith(0, true, '组件下载：nature download failed')
  listener({ subpackage: [{ root: 'packageThemeScenesGallery/' }], errMsg: 'gallery download failed' })
  expect(owner).toHaveBeenLastCalledWith(0, true, '组件下载：gallery download failed')
  await resources.retryBalancedScenes()
  expect(owner).toHaveBeenLastCalledWith(1)
  stop()
  expect(wx.offLazyLoadError).not.toHaveBeenCalled()
  stopAnother()
  expect(wx.offLazyLoadError).toHaveBeenCalledWith(listener)
})

test('a single image failure requests shared recovery without invalidating other artwork', async () => {
  const { resources } = resourceRuntime()
  const owner = jest.fn()
  resources.subscribeBalancedScenes(owner)
  await resources.loadBalancedScenes()
  resources.reportBalancedSceneImageError()
  expect(owner).toHaveBeenLastCalledWith(0, true)
  await resources.retryBalancedScenes()
  expect(owner).toHaveBeenLastCalledWith(1)
})
