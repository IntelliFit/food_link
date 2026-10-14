import { readFileSync } from 'fs'
import { resolve } from 'path'
import { runInNewContext } from 'vm'

test('native artwork resolves within its own package and forwards real image results', () => {
  let component: any
  const source = readFileSync(resolve(__dirname, '../../src/packageThemeScenes/components/scene-image/index.js'), 'utf8')
  runInNewContext(source, { Component: (definition: unknown) => { component = definition }, console: { warn: jest.fn() } })
  const setData = jest.fn()
  const triggerEvent = jest.fn()
  const instance = { setData, triggerEvent, properties: { asset: 'miniature-garden-v4.webp' } }
  component.observers.asset.call(instance, 'miniature-garden-v4.webp')
  expect(setData).toHaveBeenLastCalledWith({ imageSrc: 'packageThemeScenes/assets/miniature-garden-v4.webp' })
  component.observers.asset.call(instance, '../../../private/file.webp')
  expect(setData).toHaveBeenLastCalledWith({ imageSrc: '' })
  const detail = { width: 720, height: 1280 }
  component.methods.onLoad.call(instance, { detail })
  expect(triggerEvent).toHaveBeenLastCalledWith('load', detail)
  component.methods.onError.call(instance, { detail: { errMsg: 'image decode failed' } })
  expect(triggerEvent).toHaveBeenLastCalledWith('error', { errMsg: 'image decode failed' })
  expect(component.options.virtualHost).toBe(true)
  expect(component.externalClasses).toContain('sceneclass')
})
