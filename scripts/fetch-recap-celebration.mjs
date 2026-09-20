import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = 'https://assets2.lottiefiles.com/packages/lf20_u4yrau.json'
const expectedSha256 = '9a3c22bba054257fb034155815062f387d2d6c2c16653b0a0a257827ab64f356'
const output = resolve('apps/wechat/src/assets/animations/recap-celebration.json')
const palette = [
  [0.263, 0.561, 0.455, 1],
  [0.839, 0.639, 0.337, 1],
  [0.722, 0.859, 0.788, 1],
  [0.953, 0.827, 0.612, 1],
]

const response = await fetch(source)
if (!response.ok) throw new Error(`Failed to fetch recap animation: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (sha256 !== expectedSha256) throw new Error(`Unexpected recap animation hash: ${sha256}`)

const animation = JSON.parse(bytes.toString('utf8'))
// Keep the original top and side bursts so the animation frames the report card
// from three directions, matching the selected stage-confetti reference.

let colorIndex = 0
function applyBrandPalette(value) {
  if (!value || typeof value !== 'object') return
  if (!Array.isArray(value) && ['fl', 'st'].includes(value.ty) && Array.isArray(value.c?.k) && value.c.k.length === 4 && value.c.k.every(Number.isFinite)) {
    value.c.k = palette[colorIndex % palette.length]
    colorIndex += 1
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) applyBrandPalette(child)
}
applyBrandPalette(animation)

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(animation)}\n`, 'utf8')
console.log(`Wrote ${output} with ${colorIndex} recolored vector fills/strokes`)
