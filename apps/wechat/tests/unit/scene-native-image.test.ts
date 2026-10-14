import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { runInNewContext } from 'vm'

test('native artwork resolves within its own package and forwards real image results', () => {
  let component: any
  const source = readFileSync(resolve(__dirname, '../../src/packageThemeScenes/components/scene-image/index.js'), 'utf8')
  const access = jest.fn()
  runInNewContext(source, { Component: (definition: unknown) => { component = definition }, console: { warn: jest.fn(), info: jest.fn() }, wx: { getFileSystemManager: () => ({ access }) } })
  const triggerEvent = jest.fn()
  const instance = { triggerEvent, properties: { asset: 'miniature-garden-v4.webp' } }
  const template = readFileSync(resolve(__dirname, '../../src/packageThemeScenes/components/scene-image/index.wxml'), 'utf8')
  const paths = Array.from(template.matchAll(/src="([^\"]+)"/g)).map(match => match[1])
  expect(paths).toHaveLength(22)
  expect(paths.every(path => /^\.\.\/\.\.\/assets\/[a-z0-9-]+\.webp$/.test(path))).toBe(true)
  expect(paths.map(path => path.split('/').pop()).sort()).toEqual(readdirSync(resolve(__dirname, '../../src/packageThemeScenes/assets')).filter(path => path.endsWith('.webp')).sort())
  expect(template).not.toMatch(/src="[^\"]*\{\{/)
  const detail = { width: 720, height: 1280 }
  component.methods.onLoad.call(instance, { detail })
  expect(triggerEvent).toHaveBeenLastCalledWith('load', detail)
  component.methods.onError.call(instance, { detail: { errMsg: 'image decode failed' } })
  expect(triggerEvent).toHaveBeenLastCalledWith('error', { errMsg: 'image decode failed' })
  expect(access.mock.calls[0][0].path).toBe('packageThemeScenes/assets/miniature-garden-v4.webp')
  expect(component.options.virtualHost).toBe(true)
  expect(component.externalClasses).toContain('sceneclass')
})
