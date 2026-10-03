// Deterministic sprite packing only; all characters, limbs and vehicles are image_gen artwork.
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const root = path.resolve(__dirname, '..')
const sources = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const destination = path.join(root, 'apps/wechat/src/assets/pets/transport')
fs.mkdirSync(destination, { recursive: true })
const CELL = 128
function bounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 128) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error('Empty transport frame')
  return { left, top, right, bottom }
}
function deckAnchor(data, width, height) {
  let best = { count: 0, x: 0, y: 0, width: 0 }
  for (let y = Math.floor(height * .64); y < height * .94; y++) {
    let count = 0, left = width, right = -1
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, [r, g, b, a] = data.subarray(i, i + 4)
      if (a >= 128 && r > 130 && g > 60 && g < 210 && b < 165 && r > g * 1.18 && g > b * 1.15) { count++; left = Math.min(left, x); right = Math.max(right, x) }
    }
    if (count > best.count) best = { count, x: (left + right) / 2, y, width: right - left + 1 }
  }
  if (best.count < width * .2 || best.width < width * .3) throw new Error('Wooden deck anchor not found; inspect artwork before packing')
  return best
}
async function pack(key, source) {
  if (!['guigui', 'jianwen', 'huatuo', 'taiji', 'xiaomai', 'doudou'].includes(key)) throw new Error('Unknown identity')
  const image = sharp(source).toColourspace('srgb').ensureAlpha()
  const metadata = await image.metadata()
  if (!metadata.hasAlpha || metadata.width !== metadata.height || metadata.width % 2) throw new Error('Expected transparent square 2x2 sheet')
  const edge = metadata.width / 2
  const frames = []
  for (let frame = 0; frame < 4; frame++) {
    const { data } = await image.clone().extract({ left: frame % 2 * edge, top: Math.floor(frame / 2) * edge, width: edge, height: edge }).raw().toBuffer({ resolveWithObject: true })
    const box = bounds(data, edge, edge)
    const anchor = frame ? deckAnchor(data, edge, edge) : { x: (box.left + box.right) / 2, y: box.bottom, width: box.right - box.left + 1 }
    frames.push({ data, box, anchor })
  }
  // A wooden texture can make the row detector choose different deck edges.
  // Lock the actual wheel/ground baseline first, then retain the same deck-to-ground gap.
  const groundGap = frames.slice(1).map(({ box, anchor }) => box.bottom - anchor.y).sort((a, b) => a - b)[1]
  for (const frame of frames.slice(1)) frame.anchor.y = frame.box.bottom - groundGap
  // Keep one scale for all three board phases, then align the actual deck, not the changing leg bbox.
  let boardScale = 56 / [...frames.slice(1).map(f => f.anchor.width)].sort((a, b) => a - b)[1]
  for (const { box, anchor } of frames.slice(1)) boardScale = Math.min(boardScale, 60 / Math.max(anchor.x - box.left, box.right - anchor.x), 98 / (anchor.y - box.top), 17 / Math.max(1, box.bottom - anchor.y))
  const layers = []
  const measured = []
  for (let frame = 0; frame < 4; frame++) {
    const { data, box, anchor } = frames[frame]
    const scale = frame ? boardScale : Math.min(104 / (box.bottom - box.top + 1), 100 / anchor.width)
    const targetY = frame ? 106 : 116
    const crop = { left: box.left, top: box.top, width: box.right - box.left + 1, height: box.bottom - box.top + 1 }
    const resized = await sharp(data, { raw: { width: edge, height: edge, channels: 4 } }).extract(crop).resize(Math.round(crop.width * scale), Math.round(crop.height * scale)).png().toBuffer()
    const left = Math.round(64 - (anchor.x - box.left) * scale), top = Math.round(targetY - (anchor.y - box.top) * scale)
    const dims = await sharp(resized).metadata()
    if (left < 3 || top < 3 || left + dims.width > 125 || top + dims.height > 125) throw new Error(`${key} frame ${frame}: clipped margin; inspect source`)
    layers.push({ input: resized, left: frame % 2 * CELL + left, top: Math.floor(frame / 2) * CELL + top })
    measured.push({ frame, anchor: { x: 64, y: targetY }, scale, margin: { left, top, right: 128 - left - dims.width, bottom: 128 - top - dims.height } })
  }
  const output = path.join(destination, `${key}-transport-v1.png`)
  await sharp({ create: { width: CELL * 2, height: CELL * 2, channels: 4, background: '#00000000' } }).composite(layers).png({ palette: true, colours: 256, dither: 0, compressionLevel: 9 }).toFile(output)
  return { key, sourceSize: metadata.width, packedSize: 256, bytes: fs.statSync(output).size, frames: measured }
}
Promise.all(Object.entries(sources).map(([key, source]) => pack(key, source))).then(records => {
  fs.writeFileSync(path.join(destination, 'packing-v1.json'), JSON.stringify({ layout: ['scooter-standing', 'board-coast', 'board-push', 'board-recover'], records }, null, 2) + '\n')
  console.log(JSON.stringify(records.map(({ key, bytes }) => ({ key, bytes }))))
}).catch(error => { console.error(error.message); process.exitCode = 1 })
