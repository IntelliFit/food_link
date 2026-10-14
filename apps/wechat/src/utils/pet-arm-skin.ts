import { distance, lerp, type Point } from './pet-rig'

type Chain = [Point, Point, Point]
export type SkinVertex = { source: Point; target: Point }
export type SkinTriangle = [SkinVertex, SkinVertex, SkinVertex]

/** Build corresponding UV stations at each chain's actual segment lengths. */
function armRails(chain: Chain, width: number, hipX: number): [Point, Point][] {
  const upper = distance(chain[0], chain[1]), lower = distance(chain[1], chain[2])
  const radius = Math.min(width * .55, upper * .45, lower * .45)
  const units = [0, 1].map(i => {
    const a = chain[i], b = chain[i + 1], length = Math.max(.001, distance(a, b))
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  })
  const turn = Math.acos(Math.max(-1, Math.min(1, units[0].x * units[1].x + units[0].y * units[1].y)))
  const corner = Math.tan(turn / 2)
  const stations = [-radius * .3, 0, upper * .45, upper - radius, upper, upper + radius, upper + lower * .55, upper + lower]
  const rows = stations.map(s => {
    const part = s <= upper ? 0 : 1
    const center = part ? lerp(chain[1], chain[2], (s - upper) / Math.max(.001, lower)) : lerp(chain[0], chain[1], s / Math.max(.001, upper))
    const blend = Math.max(0, Math.min(1, (s - upper + radius) / (radius * 2)))
    const weight = blend * blend * (3 - 2 * blend)
    // A bisector at the elbow prevents a crack when the source arm is bent.
    const nx = -(units[0].y * (1 - weight) + units[1].y * weight)
    const ny = units[0].x * (1 - weight) + units[1].x * weight
    const normalLength = Math.max(.1, Math.hypot(nx, ny))
    return [-1, 1].map(side => {
      const inward = side * nx * (hipX - chain[0].x) > 0
      // The torso owns shoulder straps. Do not rotate those pixels with skin.
      const shoulderInset = inward ? .2 + .8 * Math.max(0, Math.min(1, s / Math.max(1, upper * .35))) : 1
      const shoulderCap = s < 0 ? .4 : 1
      const tip = s > upper + lower * .55 ? 1 - .25 * (s - upper - lower * .55) / (lower * .45) : 1
      // A short, bent sleeve cannot support an unrestricted miter. Taper its
      // joint band according to the bend, so neither UV rail doubles back.
      const jointLimit = (Math.abs(s - upper) + radius * .4) / Math.max(.05, corner) * .4
      const extent = Math.min(width * .5, jointLimit) * shoulderInset * shoulderCap * tip
      const point = { x: center.x + side * nx / normalLength * extent, y: center.y + side * ny / normalLength * extent }
      return point
    }) as [Point, Point]
  })
  return rows
}

/** One connected strip: both bones share the elbow's vertices and material. */
export function armSkin(source: Chain, target: Chain, width: number, scale: number, sourceHipX: number): SkinTriangle[] {
  const sourceRows = armRails(source, width, sourceHipX)
  const targetRows = armRails(target, width * scale, target[0].x + (sourceHipX - source[0].x) * scale)
  const rows = sourceRows.map((row, i) => row.map((point, side) => ({ source: point, target: targetRows[i][side] })) as [SkinVertex, SkinVertex])
  return rows.slice(1).flatMap((row, i) => [
    [rows[i][0], rows[i][1], row[0]], [rows[i][1], row[1], row[0]],
  ] as SkinTriangle[])
}

/** Affine texture mapping, supported by the native mini-program Canvas 2D. */
export function drawArmSkin(ctx: CanvasRenderingContext2D, image: CanvasImageSource, triangles: SkinTriangle[], mask?: Point[]) {
  for (const triangle of triangles) {
    const [s0, s1, s2] = triangle.map(vertex => vertex.source)
    const [d0, d1, d2] = triangle.map(vertex => vertex.target)
    const sx1 = s1.x - s0.x, sy1 = s1.y - s0.y, sx2 = s2.x - s0.x, sy2 = s2.y - s0.y
    const det = sx1 * sy2 - sx2 * sy1
    if (Math.abs(det) < .001) continue
    const dx1 = d1.x - d0.x, dy1 = d1.y - d0.y, dx2 = d2.x - d0.x, dy2 = d2.y - d0.y
    const a = (dx1 * sy2 - dx2 * sy1) / det, c = (dx2 * sx1 - dx1 * sx2) / det
    const b = (dy1 * sy2 - dy2 * sy1) / det, d = (dy2 * sx1 - dy1 * sx2) / det
    // Native clipping antialiases both sides of an internal edge. Give adjacent
    // triangles a subpixel overlap so opaque skin does not acquire a seam.
    const points = [d0, d1, d2], winding = Math.sign(dx1 * dy2 - dx2 * dy1)
    const edges = points.map((point, i) => {
      const next = points[(i + 1) % 3], length = distance(point, next)
      return { x: (next.y - point.y) / length * winding, y: -(next.x - point.x) / length * winding }
    })
    const expanded = points.map((point, i) => {
      const before = edges[(i + 2) % 3], after = edges[i]
      const amount = .3 / Math.max(.01, 1 + before.x * after.x + before.y * after.y)
      const x = (before.x + after.x) * amount, y = (before.y + after.y) * amount
      const limit = Math.min(1, .9 / Math.max(.001, Math.hypot(x, y)))
      return { x: point.x + x * limit, y: point.y + y * limit }
    })
    ctx.save(); ctx.beginPath(); ctx.moveTo(expanded[0].x, expanded[0].y); ctx.lineTo(expanded[1].x, expanded[1].y); ctx.lineTo(expanded[2].x, expanded[2].y); ctx.closePath(); ctx.clip()
    ctx.transform(a, b, c, d, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - d * s0.y)
    if (mask?.length) {
      ctx.beginPath(); ctx.moveTo(mask[0].x, mask[0].y)
      mask.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.closePath(); ctx.clip()
    }
    const left = Math.floor(Math.min(s0.x, s1.x, s2.x)) - 1, top = Math.floor(Math.min(s0.y, s1.y, s2.y)) - 1
    const width = Math.ceil(Math.max(s0.x, s1.x, s2.x)) - left + 1, height = Math.ceil(Math.max(s0.y, s1.y, s2.y)) - top + 1
    ctx.drawImage(image, left, top, width, height, left, top, width, height); ctx.restore()
  }
}

/** Preserve elbow volume when a very short source sleeve needs a narrow UV miter. */
export function drawArmJoint(ctx: CanvasRenderingContext2D, image: CanvasImageSource, source: Chain, target: Chain, width: number, scale: number, mask?: Point[]) {
  const direction = (chain: Chain) => Math.atan2(chain[2].y - chain[0].y, chain[2].x - chain[0].x)
  const radius = width * .38
  ctx.save(); ctx.translate(target[1].x, target[1].y)
  ctx.rotate(direction(target) - direction(source)); ctx.scale(scale, scale)
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.clip()
  ctx.translate(-source[1].x, -source[1].y)
  if (mask?.length) {
    ctx.beginPath(); ctx.moveTo(mask[0].x, mask[0].y)
    mask.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.closePath(); ctx.clip()
  }
  ctx.drawImage(image, source[1].x - radius, source[1].y - radius, radius * 2, radius * 2,
    source[1].x - radius, source[1].y - radius, radius * 2, radius * 2)
  ctx.restore()
}
