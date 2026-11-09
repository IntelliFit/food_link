import Taro from '@tarojs/taro'
import { LOGIN_LOGO_URL } from '../../../utils/static-asset-cdn-url'
import { foodMapShareMessage, type SharedFoodSpot, type SharedSpotOrigin } from './food-map-share'

/** The hidden canvas the page renders so a spot without photos still shares a real picture. */
export const FOOD_MAP_SHARE_CANVAS_ID = 'foodMapShareCanvas'

// WeChat shows share images at 5:4; draw at twice the size so chat cards stay sharp.
const COVER_WIDTH = 500
const COVER_HEIGHT = 400
const COVER_SCALE = 2
const CANVAS_WAIT_MS = 2500
const KCAL_WAIT_MS = 1500
const BRAND = '食探美食图谱'

type ShareMessage = ReturnType<typeof foodMapShareMessage>

export interface FoodMapShareCover {
  spot: SharedFoodSpot | null
  imageUrl: string
}

const pendingCovers = new Map<string, Promise<FoodMapShareCover>>()
const readyCovers = new Map<string, FoodMapShareCover>()
let canvasQueue: Promise<unknown> = Promise.resolve()

/** Everything the card draws, so a changed dish or address draws a new card. */
function coverKey(spot: SharedFoodSpot | null): string {
  if (!spot) return 'food-map'
  return [spot.key || `${spot.latitude},${spot.longitude}`, spot.name, spot.dish, spot.kcal, spot.address].join('|')
}

function fitText(ctx: CanvasRenderingContext2D, value: string, width: number): string {
  if (ctx.measureText(value).width <= width) return value
  let fitted = value
  while (fitted.length && ctx.measureText(`${fitted}…`).width > width) fitted = fitted.slice(0, -1)
  return `${fitted}…`
}

/** Splits text into at most `maxLines` lines of the given width, ending in an ellipsis if cut. */
function wrapText(ctx: CanvasRenderingContext2D, value: string, width: number, maxLines: number): string[] {
  const lines: string[] = []
  let rest = Array.from(value)
  while (rest.length && lines.length < maxLines) {
    if (lines.length === maxLines - 1) {
      lines.push(fitText(ctx, rest.join(''), width))
      break
    }
    let count = rest.length
    while (count > 1 && ctx.measureText(rest.slice(0, count).join('')).width > width) count--
    lines.push(rest.slice(0, count).join(''))
    rest = rest.slice(count)
  }
  return lines
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
  ctx.fill()
}

function drawPlate(ctx: CanvasRenderingContext2D, label: string): void {
  ctx.fillStyle = '#dff3e8'
  ctx.beginPath(); ctx.arc(418, 104, 66, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(418, 104, 48, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#0a7a54'
  ctx.font = 'bold 44px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, 418, 120)
  ctx.textAlign = 'left'
}

/** Draws the share picture: place name, one dish and its calories when known. */
export function drawFoodMapShareCover(ctx: CanvasRenderingContext2D, spot: SharedFoodSpot | null): void {
  ctx.fillStyle = '#f7f3e8'
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT)

  ctx.font = 'bold 20px sans-serif'
  const brandWidth = ctx.measureText(BRAND).width + 32
  ctx.fillStyle = '#0a7a54'
  roundRect(ctx, 32, 28, brandWidth, 40, 20)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(BRAND, 48, 55)

  drawPlate(ctx, spot ? Array.from(spot.name)[0] || '食' : '食')

  ctx.fillStyle = '#1f2d27'
  ctx.font = 'bold 38px sans-serif'
  const nameLines = spot ? wrapText(ctx, spot.name, 312, 2) : ['一起点亮', '身边的好吃的']
  nameLines.forEach((line, index) => ctx.fillText(line, 32, 122 + index * 46))
  let y = 122 + (nameLines.length - 1) * 46

  if (!spot) {
    ctx.fillStyle = '#4a5a52'
    ctx.font = '22px sans-serif'
    ctx.fillText(fitText(ctx, '朋友推荐的店、食堂和菜，都在这张地图上', 436), 32, y + 56)
  } else {
    if (!spot.dish && !spot.kcal) {
      y += 52
      ctx.fillStyle = '#4a5a52'
      ctx.font = '24px sans-serif'
      ctx.fillText('有朋友推荐了这里，点开看看', 32, y)
    }
    if (spot.dish) {
      y += 52
      ctx.fillStyle = '#28775e'
      ctx.font = 'bold 26px sans-serif'
      ctx.fillText(fitText(ctx, spot.dish, 436), 32, y)
    }
    if (spot.kcal) {
      y += 70
      ctx.fillStyle = '#0a7a54'
      ctx.font = 'bold 60px sans-serif'
      const kcal = String(spot.kcal)
      ctx.fillText(kcal, 32, y)
      const kcalWidth = ctx.measureText(kcal).width
      ctx.fillStyle = '#4a5a52'
      ctx.font = '24px sans-serif'
      ctx.fillText('千卡', 40 + kcalWidth, y)
    }
    if (spot.address) {
      y += spot.kcal ? 40 : 44
      ctx.fillStyle = '#6a7282'
      ctx.font = '20px sans-serif'
      ctx.fillText(fitText(ctx, spot.address, 436), 32, y)
    }
  }

  ctx.fillStyle = '#0a7a54'
  ctx.fillRect(0, 352, COVER_WIDTH, 48)
  ctx.fillStyle = '#ffffff'
  ctx.font = '19px sans-serif'
  ctx.fillText(spot ? '点开看位置 · 你也来点亮身边的好吃的' : '点开看看，你也来点亮一个地点', 32, 383)
}

function findShareCanvas(): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('分享图画布暂不可用')), CANVAS_WAIT_MS)
    Taro.createSelectorQuery().select(`#${FOOD_MAP_SHARE_CANVAS_ID}`).fields({ node: true }).exec(result => {
      clearTimeout(timeout)
      if (result?.[0]?.node) resolve(result[0].node)
      else reject(new Error('分享图画布暂不可用'))
    })
  })
}

async function renderCover(spot: SharedFoodSpot | null): Promise<string> {
  const canvas = await findShareCanvas()
  canvas.width = COVER_WIDTH * COVER_SCALE
  canvas.height = COVER_HEIGHT * COVER_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持分享图画布')
  ctx.scale(COVER_SCALE, COVER_SCALE)
  drawFoodMapShareCover(ctx, spot)
  const result = await Taro.canvasToTempFilePath({
    canvas: canvas as unknown as NonNullable<Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas']>,
    destWidth: COVER_WIDTH * COVER_SCALE,
    destHeight: COVER_HEIGHT * COVER_SCALE,
    fileType: 'jpg',
    quality: 0.9,
  })
  return result.tempFilePath
}

/** One page canvas serves every cover, so draws run one at a time. */
function drawOnCanvas(spot: SharedFoodSpot | null): Promise<string> {
  const run = canvasQueue.then(() => renderCover(spot))
  canvasQueue = run.catch(() => undefined)
  return run
}

function settleWithin<T>(task: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    task.catch(() => undefined),
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms)),
  ])
}

/**
 * The picture to share for a spot: its photo, else a drawn card. `loadKcal` fetches the
 * dish's calories, which the map payload leaves out. Results are kept for the session.
 */
export function prepareFoodMapShareCover(
  spot: SharedFoodSpot | null,
  loadKcal?: () => Promise<number | undefined>,
): Promise<FoodMapShareCover> {
  if (spot?.image) return Promise.resolve({ spot, imageUrl: spot.image })
  const key = coverKey(spot)
  const pending = pendingCovers.get(key)
  if (pending) return pending
  const task = (async () => {
    const kcal = spot && !spot.kcal && loadKcal ? await settleWithin(loadKcal(), KCAL_WAIT_MS) : undefined
    const coverSpot = spot && kcal ? { ...spot, kcal } : spot
    const cover = { spot: coverSpot, imageUrl: await drawOnCanvas(coverSpot) }
    readyCovers.set(key, cover)
    return cover
  })()
  pendingCovers.set(key, task)
  // A failed draw (page left, canvas missing) may be retried on the next share.
  task.catch(() => pendingCovers.delete(key))
  return task
}

/**
 * Share content that never falls back to a screenshot of the map. When the drawn card is
 * not ready yet, WeChat waits up to three seconds for `promise`, then uses the app logo.
 */
export function foodMapShareWithCover(
  spot: SharedFoodSpot | null,
  origin: SharedSpotOrigin,
  loadKcal?: () => Promise<number | undefined>,
): ShareMessage & { promise?: Promise<ShareMessage> } {
  if (spot?.image) return foodMapShareMessage(spot, origin, spot.image)
  const ready = readyCovers.get(coverKey(spot))
  if (ready) return foodMapShareMessage(ready.spot, origin, ready.imageUrl)
  const fallback = foodMapShareMessage(spot, origin, LOGIN_LOGO_URL)
  return {
    ...fallback,
    promise: prepareFoodMapShareCover(spot, loadKcal).then(
      cover => foodMapShareMessage(cover.spot, origin, cover.imageUrl),
      () => fallback,
    ),
  }
}
