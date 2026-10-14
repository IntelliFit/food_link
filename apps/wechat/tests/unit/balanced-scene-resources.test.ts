import { readFileSync } from 'fs'
import { resolve } from 'path'
import { runInNewContext } from 'vm'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

type SceneResources = typeof import('../../src/utils/balanced-theme-scenes')

/** Execute the real loader with WeChat's module require, rather than Node's require. */
function resourceRuntime(importScene: jest.Mock): SceneResources {
  const source = readFileSync(resolve(__dirname, '../../src/utils/balanced-theme-scenes.ts'), 'utf8')
  const code = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 } }).outputText
  const exports: Partial<SceneResources> = {}
  runInNewContext(code, { exports, require: Object.assign(jest.fn(), { async: importScene }), Promise, Set })
  return exports as SceneResources
}

test('uses a relative native module address and deduplicates all mounted consumers', async () => {
  const importScene = jest.fn().mockResolvedValue(true)
  const resources = resourceRuntime(importScene)
  const paper = jest.fn()
  const drawer = jest.fn()
  resources.subscribeBalancedScenes(paper)
  resources.subscribeBalancedScenes(drawer)
  const first = resources.loadBalancedScenes()
  expect(resources.loadBalancedScenes()).toBe(first)
  await first
  expect(importScene).toHaveBeenCalledTimes(1)
  expect(importScene).toHaveBeenCalledWith('./packageThemeScenes/ready.js')
  expect(paper).toHaveBeenCalledWith(0)
  expect(drawer).toHaveBeenCalledWith(0)
})

test('one retry recovers all subscribers and a cached-package retry remounts failed images', async () => {
  const importScene = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true)
  const resources = resourceRuntime(importScene)
  const paper = jest.fn()
  const drawer = jest.fn()
  const removed = jest.fn()
  const stopPaper = resources.subscribeBalancedScenes(paper)
  resources.subscribeBalancedScenes(drawer)
  resources.subscribeBalancedScenes(removed)()
  await expect(resources.loadBalancedScenes()).rejects.toThrow('offline')
  expect(paper).not.toHaveBeenCalled()
  const retry = resources.retryBalancedScenes()
  expect(resources.retryBalancedScenes()).toBe(retry)
  await retry
  expect(importScene).toHaveBeenCalledTimes(2)
  expect(paper).toHaveBeenCalledTimes(1)
  expect(drawer).toHaveBeenCalledWith(1)
  expect(removed).not.toHaveBeenCalled()
  await resources.retryBalancedScenes()
  expect(importScene).toHaveBeenCalledTimes(2)
  expect(paper).toHaveBeenLastCalledWith(2)
  expect(drawer).toHaveBeenLastCalledWith(2)
  stopPaper()
  await resources.retryBalancedScenes()
  expect(paper).toHaveBeenCalledTimes(2)
  expect(drawer).toHaveBeenLastCalledWith(3)
})

test('a synchronous native module exception is retryable and never escapes the caller', async () => {
  const importScene = jest.fn().mockImplementationOnce(() => { throw new Error('bridge unavailable') }).mockResolvedValue(true)
  const resources = resourceRuntime(importScene)
  let request: Promise<void> | undefined
  expect(() => { request = resources.loadBalancedScenes() }).not.toThrow()
  await expect(request).rejects.toThrow('bridge unavailable')
  await expect(resources.retryBalancedScenes()).resolves.toBeUndefined()
  expect(importScene).toHaveBeenCalledTimes(2)
})

test('a single image error preserves the downloaded package and can request a shared remount', async () => {
  const importScene = jest.fn().mockResolvedValue(true)
  const resources = resourceRuntime(importScene)
  const owner = jest.fn()
  resources.subscribeBalancedScenes(owner)
  await resources.loadBalancedScenes()
  resources.reportBalancedSceneImageError()
  expect(owner).toHaveBeenLastCalledWith(0, true)
  await resources.retryBalancedScenes()
  expect(owner).toHaveBeenLastCalledWith(1)
  expect(importScene).toHaveBeenCalledTimes(1)
})
