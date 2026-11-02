import Taro from '@tarojs/taro'
import { getAccessToken, getShareQrEnvVersion, getUnlimitedQRCode } from '../../../utils/api'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import { drawFigure, HERO, type Ctx } from '../../charts/draw'
import type { PosterContent } from '../../model/share'

export const POSTER_CANVAS_ID = 'lpPosterCanvas'
export const PREDICTOR_PAGE = 'packageLifespan/pages/predictor/index'

type MiniCanvas = HTMLCanvasElement & { createImage: () => HTMLImageElement }

export interface PosterAssets {
  canvas: MiniCanvas
  qr: HTMLImageElement | null
}

const WIDTH = 750
const HEIGHT = 1040
const PAD = 60
const QR_SIZE = 132
const QR_TIMEOUT_MS = 3000
const CANVAS_ATTEMPTS = 12
const TITLE_LINES = 3
const TONES = { a: HERO.a, b: HERO.b, c: HERO.c }

/** The sheet has just been rendered, so the native canvas may take a moment to appear. */
function queryCanvas(attempt = 0): Promise<MiniCanvas> {
  return new Promise((resolve, reject) => {
    Taro.createSelectorQuery().select(`#${POSTER_CANVAS_ID}`).fields({ node: true }).exec((result) => {
      if (result?.[0]?.node) resolve(result[0].node)
      else if (attempt >= CANVAS_ATTEMPTS) reject(new Error('画布还未就绪，请重试。'))
      else setTimeout(() => queryCanvas(attempt + 1).then(resolve, reject), 80)
    })
  })
}

function wrapLines(ctx: Ctx, value: string, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const char of value) {
    if (ctx.measureText(current + char).width > maxWidth && current) {
      lines.push(current)
      current = char
    } else {
      current += char
    }
  }
  return current ? [...lines, current] : lines
}

/** The mini-program code is optional: without a login or a released page the card still works. */
async function loadQrImage(canvas: MiniCanvas): Promise<HTMLImageElement | null> {
  if (!getAccessToken()) return null
  const load = async (): Promise<HTMLImageElement | null> => {
    const { base64 } = await getUnlimitedQRCode('share=1', PREDICTOR_PAGE, getShareQrEnvVersion())
    const path = await resolveCanvasImageSrc(base64)
    return new Promise((resolve) => {
      const image = canvas.createImage()
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = path
    })
  }
  const timeout = new Promise<null>((resolve) => { setTimeout(() => resolve(null), QR_TIMEOUT_MS) })
  return Promise.race([load().catch(() => null), timeout])
}

function drawHeader(ctx: Ctx, content: PosterContent): number {
  ctx.textAlign = 'left'
  ctx.fillStyle = HERO.b
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText('食探 · 寿命预测器', PAD, 96)
  ctx.fillStyle = HERO.ink
  ctx.font = 'bold 48px sans-serif'
  let y = 170
  const titleLines = wrapLines(ctx, content.title, WIDTH - PAD * 2)
  titleLines.slice(0, TITLE_LINES).forEach((text, index) => {
    const cut = index === TITLE_LINES - 1 && titleLines.length > TITLE_LINES
    ctx.fillText(cut ? `${text.slice(0, -1)}…` : text, PAD, y)
    y += 64
  })
  if (content.subtitle) {
    ctx.fillStyle = HERO.dim
    ctx.font = '28px sans-serif'
    ctx.fillText(content.subtitle, PAD, y)
    y += 52
  }
  const { highlight } = content
  if (highlight) {
    ctx.fillStyle = HERO.dim
    ctx.font = '30px sans-serif'
    ctx.fillText(highlight.before, PAD, y + 6)
    const beforeWidth = ctx.measureText(highlight.before).width
    ctx.fillStyle = TONES[highlight.tone]
    ctx.font = 'bold 76px sans-serif'
    ctx.fillText(highlight.value, PAD + beforeWidth + 14, y + 14)
    const valueWidth = ctx.measureText(highlight.value).width
    ctx.fillStyle = HERO.ink
    ctx.font = '30px sans-serif'
    ctx.fillText(highlight.after, PAD + beforeWidth + valueWidth + 28, y + 6)
    y += 64
  }
  return y
}

function drawColumns(ctx: Ctx, content: PosterContent, top: number): void {
  const columnWidth = (WIDTH - PAD * 2) / content.columns.length
  content.columns.forEach((column, index) => {
    const center = PAD + columnWidth * (index + 0.5)
    const color = TONES[column.tone]
    drawFigure(ctx, center, top, 2.9, column.bmi, color, 1)
    ctx.textAlign = 'center'
    ctx.fillStyle = color
    ctx.font = 'bold 64px sans-serif'
    ctx.fillText(column.value, center, top + 330)
    ctx.fillStyle = HERO.dim
    ctx.font = '26px sans-serif'
    ctx.fillText(column.name, center, top + 374)
    if (column.caption) ctx.fillText(column.caption, center, top + 410)
    if (column.note) ctx.fillText(column.note, center, top + 446)
  })
}

function drawFooter(ctx: Ctx, content: PosterContent, qr: HTMLImageElement | null): void {
  const top = HEIGHT - 190
  ctx.fillStyle = HERO.line
  ctx.fillRect(PAD, top, WIDTH - PAD * 2, 2)
  ctx.textAlign = 'left'
  ctx.fillStyle = HERO.dim
  ctx.font = '24px sans-serif'
  content.footer.forEach((text, index) => ctx.fillText(text, PAD, top + 50 + index * 38))
  ctx.fillText(qr ? '长按识别，算算你自己' : '微信搜索「食探」，我的 → 寿命预测器', PAD, top + 50 + content.footer.length * 38)
  if (!qr) return
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(WIDTH - PAD - QR_SIZE - 8, top + 22, QR_SIZE + 16, QR_SIZE + 16)
  ctx.drawImage(qr, WIDTH - PAD - QR_SIZE, top + 30, QR_SIZE, QR_SIZE)
}

export async function loadPosterAssets(): Promise<PosterAssets> {
  const canvas = await queryCanvas()
  return { canvas, qr: await loadQrImage(canvas) }
}

/** All cards share one canvas, so callers must not run two of these at the same time. */
export async function renderLifespanPoster({ canvas, qr }: PosterAssets, content: PosterContent): Promise<string> {
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境暂不支持分享画布。')
  const background = ctx.createLinearGradient(0, 0, WIDTH * 0.3, HEIGHT)
  background.addColorStop(0, '#0f6b4b')
  background.addColorStop(1, '#0b4b36')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const bottom = drawHeader(ctx, content)
  drawColumns(ctx, content, Math.max(bottom + 10, 330))
  drawFooter(ctx, content, qr)
  const exported = await Taro.canvasToTempFilePath({
    canvas: canvas as unknown as NonNullable<Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas']>,
    fileType: 'jpg',
    quality: 0.92,
    destWidth: WIDTH,
    destHeight: HEIGHT,
  })
  return exported.tempFilePath
}
