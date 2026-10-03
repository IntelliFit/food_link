import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import sharp = require('sharp')

const directory = join(__dirname, '../../src/assets/pets/transport')
const manifest = JSON.parse(readFileSync(join(directory, 'packing-v1.json'), 'utf8'))
test.each(['guigui', 'jianwen', 'huatuo', 'taiji', 'xiaomai', 'doudou'])('%s has four distinct transparent frames with safe edges and fixed board anchors', async key => {
  const file = join(directory, `${key}-transport-v1.png`)
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect([info.width, info.height, info.channels]).toEqual([256, 256, 4])
  expect(statSync(file).size).toBeLessThan(24 * 1024)
  const frames: Buffer[] = []
  const bottoms: number[] = []
  for (let frame = 0; frame < 4; frame++) {
    const pixels: number[] = []; let visible = 0, left = 128, right = -1, top = 128, bottom = -1
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const index = ((y + Math.floor(frame / 2) * 128) * 256 + x + frame % 2 * 128) * 4
      const alpha = data[index + 3]
      if (alpha >= 128) { visible++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
      pixels.push(...data.subarray(index, index + 4))
    }
    expect(visible).toBeGreaterThan(1900)
    expect(left).toBeGreaterThanOrEqual(3); expect(right).toBeLessThan(125); expect(top).toBeGreaterThanOrEqual(3); expect(bottom).toBeLessThan(125)
    bottoms.push(bottom)
    frames.push(Buffer.from(pixels))
  }
  expect(new Set(frames.map(frame => frame.toString('base64'))).size).toBe(4)
  expect(Math.max(...bottoms.slice(1)) - Math.min(...bottoms.slice(1))).toBeLessThanOrEqual(1)
  const record = manifest.records.find((entry: { key: string }) => entry.key === key)
  expect(record.frames.slice(1).map((frame: { anchor: unknown }) => frame.anchor)).toEqual(Array(3).fill({ x: 64, y: 106 }))
  expect(new Set(record.frames.slice(1).map((frame: { scale: number }) => frame.scale)).size).toBe(1)
})
