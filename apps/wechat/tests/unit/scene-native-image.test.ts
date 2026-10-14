import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { runInNewContext } from 'vm'
import { BALANCED_SCENES } from '../../src/utils/balanced-theme-scenes'

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../src/theme-scene-assets.json'), 'utf8')) as { assets: Array<{ packageRoot: string; file: string; format: string; hasAlpha: boolean; losslessPixels: boolean; psnrDb: number | null }> }
const roots = ['packageThemeScenes', 'packageThemeScenesNature', 'packageThemeScenesGallery']

test.each(roots)('native artwork in %s resolves its own resources and forwards image results', root => {
  let component: any
  const source = readFileSync(resolve(__dirname, `../../src/${root}/components/scene-image/index.js`), 'utf8')
  const access = jest.fn()
  runInNewContext(source, { Component: (definition: unknown) => { component = definition }, console: { warn: jest.fn(), info: jest.fn() }, wx: { getFileSystemManager: () => ({ access }) } })
  const triggerEvent = jest.fn()
  const entries = manifest.assets.filter(entry => entry.packageRoot === root)
  const asset = entries[0].file
  const instance = { triggerEvent, properties: { asset } }
  const template = readFileSync(resolve(__dirname, `../../src/${root}/components/scene-image/index.wxml`), 'utf8')
  const paths = Array.from(template.matchAll(/src="([^\"]+)"/g)).map(match => match[1])
  expect(paths).toHaveLength(entries.length)
  expect(paths.every(path => path.startsWith(`/${root}/assets/`) && /\/[a-z0-9-]+\.(jpg|png)$/.test(path))).toBe(true)
  expect(paths.map(path => path.split('/').pop()).sort()).toEqual(readdirSync(resolve(__dirname, `../../src/${root}/assets`)).filter(path => /\.(jpg|png)$/.test(path)).sort())
  expect(template).not.toMatch(/src="[^\"]*\{\{/)
  const detail = { width: 720, height: 1280 }
  component.lifetimes.attached.call(instance)
  expect(triggerEvent).toHaveBeenLastCalledWith('ownerready', { asset })
  component.methods.onLoad.call(instance, { detail })
  expect(triggerEvent).toHaveBeenLastCalledWith('load', detail)
  component.methods.onError.call(instance, { detail: { errMsg: 'image decode failed' } })
  expect(triggerEvent).toHaveBeenLastCalledWith('error', { errMsg: 'image decode failed' })
  expect(access.mock.calls[0][0].path).toBe(`${root}/assets/${asset}`)
  expect(component.options.virtualHost).toBe(true)
  expect(component.externalClasses).toContain('sceneclass')
})

test('every scene survives the WeChat PNG/JPEG packaging whitelist with a real matching format', () => {
  const urls = manifest.assets.map(entry => `/${entry.packageRoot}/assets/${entry.file}`).sort()
  expect(urls).toHaveLength(22)
  expect(new Set(urls).size).toBe(22)
  expect(Object.values(BALANCED_SCENES).sort()).toEqual(urls)
  for (const entry of manifest.assets) {
    const bytes = readFileSync(resolve(__dirname, `../../src/${entry.packageRoot}/assets/${entry.file}`))
    if (entry.hasAlpha) {
      expect(entry.format).toBe('PNG')
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(entry.losslessPixels).toBe(true)
    } else {
      expect(entry.format).toBe('JPEG')
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]))
      expect(entry.psnrDb).toBeGreaterThan(35)
    }
    const template = readFileSync(resolve(__dirname, `../../src/${entry.packageRoot}/components/scene-image/index.wxml`), 'utf8')
    expect(template).toContain(`src="/${entry.packageRoot}/assets/${entry.file}"`)
    expect(template).not.toContain('.webp')
  }
})
