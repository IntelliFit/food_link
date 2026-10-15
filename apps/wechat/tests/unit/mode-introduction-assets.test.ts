import * as fs from 'fs'
import * as path from 'path'
import * as manifest from '../../src/mode-introduction-assets.json'

const source = path.resolve(__dirname, '../../src')
test('all reviewed chapters have real legal packaged media owned in the same bounded subpackage', () => {
  expect(manifest.items).toHaveLength(10)
  const sizes: Record<string, number> = {}
  for (const item of manifest.items) {
    const root = path.join(source, item.packageRoot), template = fs.readFileSync(path.join(root, 'components/media/index.wxml'), 'utf8')
    expect(template).toContain(`src="/${item.packageRoot}/assets/${item.file}.jpg"`)
    const jpg = fs.readFileSync(path.join(root, 'assets', item.file + '.jpg')), mp4 = fs.readFileSync(path.join(root, 'assets', item.file + '.mp4'))
    expect(jpg.subarray(0, 3).toString('hex')).toBe('ffd8ff'); expect(mp4.subarray(4, 8).toString()).toBe('ftyp')
    expect(mp4.length).toBe(item.videoBytes)
    sizes[item.packageRoot] = (sizes[item.packageRoot] || 0) + jpg.length + mp4.length
  }
  expect(Object.values(sizes).every(size => size < 1900000)).toBe(true)
})

test('the native owner copies only after poster load and reuses only a complete versioned cache', () => {
  const create = require('../../src/utils/native-mode-intro-media.js')
  const statSync = jest.fn().mockImplementationOnce(() => { throw Error('missing') }).mockReturnValue({ size: 123 })
  const copyFileSync = jest.fn(), triggerEvent = jest.fn()
  const previous = (globalThis as any).wx
  ;(globalThis as any).wx = { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager: () => ({ statSync, copyFileSync }) }
  try {
    const definition = create('packageModeIntroA', { chapter: { bytes: 123, revision: 'abc' } })
    const owner = { properties: { asset: 'chapter', attempt: 1 }, _alive: true, triggerEvent }
    expect(copyFileSync).not.toHaveBeenCalled()
    definition.methods.onPosterLoad.call(owner)
    expect(copyFileSync).toHaveBeenCalledWith('/packageModeIntroA/assets/chapter.mp4', '/usr/fl-intro-chapter-abc.mp4')
    expect(triggerEvent).toHaveBeenLastCalledWith('mediaready', { src: '/usr/fl-intro-chapter-abc.mp4', asset: 'chapter', attempt: 1 })
    definition.methods.onPosterLoad.call(owner)
    expect(copyFileSync).toHaveBeenCalledTimes(1)
  } finally { (globalThis as any).wx = previous }
})
