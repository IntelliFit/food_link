import type { FoodRecord } from './api'
import { dateMealLabel, numberLabel, type PhotoPosterLabels } from './photo-record-poster'

/** 相机水印样式：照片铺满，日期、热量、营养素和小程序码统一收进底部信息栏。 */
const PORTRAIT_PHOTO_RATIO = 3 / 4
export const WATERMARK_STRIP_HEIGHT = 72
const PADDING = 16
const QR_SIZE = 44
const COLUMN_GAP = 12
const ACCENT = '#00bc7d'

export function computeWatermarkPosterHeight(image: { width: number; height: number }, width: number): number {
  const photoHeight = image.height > image.width
    ? Math.round(width / PORTRAIT_PHOTO_RATIO)
    : Math.round(width * image.height / image.width)
  return photoHeight + WATERMARK_STRIP_HEIGHT
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let short = text
  while (short.length > 1 && ctx.measureText(`${short}…`).width > maxWidth) short = short.slice(0, -1)
  return `${short}…`
}

const gram = (value: number | null | undefined) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? `${Math.round(n)}g` : '—'
}

/** 品牌字逐字绘制，模拟字间距（小程序 canvas 不支持 letterSpacing）。 */
function drawSpacedRight(ctx: CanvasRenderingContext2D, text: string, right: number, y: number, spacing: number): number {
  const chars = Array.from(text)
  const widths = chars.map(c => ctx.measureText(c).width)
  const total = widths.reduce((sum, cw) => sum + cw, 0) + spacing * (chars.length - 1)
  let x = right - total
  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    ctx.fillText(c, x, y)
    x += widths[i] + spacing
  })
  return total
}

export function drawWatermarkRecordPoster(ctx: CanvasRenderingContext2D, options: {
  width: number
  height: number
  image: { width: number; height: number }
  record: FoodRecord
  labels: PhotoPosterLabels
  nickname?: string
  qrCodeImage?: { width: number; height: number } | null
}) {
  const { width: w, height: h, image, record, labels, nickname, qrCodeImage } = options
  const photoHeight = h - WATERMARK_STRIP_HEIGHT
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  // 居中裁到目标比例：竖图取 3:4，横图保持原比例（只吸收取整误差）。
  const targetRatio = w / photoHeight
  const sourceWidth = Math.min(image.width, image.height * targetRatio)
  const sourceHeight = Math.min(image.height, image.width / targetRatio)
  ctx.drawImage(image as CanvasImageSource,
    (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2, sourceWidth, sourceHeight,
    0, 0, w, photoHeight)

  const midY = photoHeight + WATERMARK_STRIP_HEIGHT / 2
  const topY = midY - 11
  const bottomY = midY + 12
  ctx.textBaseline = 'middle'

  let textRight = w - PADDING
  if (qrCodeImage) {
    const qrX = w - PADDING - QR_SIZE
    ctx.fillStyle = '#e2e2e2'
    ctx.fillRect(qrX - 8, midY - 17, 1, 34)
    ctx.drawImage(qrCodeImage as CanvasImageSource, qrX, midY - QR_SIZE / 2, QR_SIZE, QR_SIZE)
    textRight = qrX - 8 - COLUMN_GAP
  }

  // 右栏：品牌 + 营养素（或标语），像相机水印的「品牌 + 参数」。
  ctx.fillStyle = '#1f2a24'
  ctx.font = 'bold 15px sans-serif'
  const brandWidth = drawSpacedRight(ctx, '食探', textRight, topY, 4)
  const detail = labels === 'nutrients'
    ? `蛋白 ${gram(record.total_protein)}  碳水 ${gram(record.total_carbs)}  脂肪 ${gram(record.total_fat)}`
    : '好好吃饭，好好生活'
  ctx.font = '10px sans-serif'
  const detailWidth = ctx.measureText(detail).width
  ctx.fillStyle = '#7d847f'
  ctx.textAlign = 'right'
  ctx.fillText(detail, textRight, bottomY)
  ctx.fillStyle = ACCENT
  ctx.beginPath()
  ctx.arc(textRight - detailWidth - 7, bottomY, 3, 0, Math.PI * 2)
  ctx.fill()
  const rightColumnLeft = textRight - Math.max(brandWidth, detailWidth + 10)

  // 左栏：本餐热量 + 日期餐次与昵称，宽度不够时截断昵称行。
  const leftMax = Math.max(40, rightColumnLeft - COLUMN_GAP - PADDING)
  const kcal = numberLabel(record.total_calories)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#1f2a24'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText(kcal, PADDING, topY)
  const kcalWidth = ctx.measureText(kcal).width
  ctx.font = '11px sans-serif'
  ctx.fillStyle = '#4b5a51'
  ctx.fillText('kcal', PADDING + kcalWidth + 4, topY + 3)
  const meta = nickname ? `${dateMealLabel(record)} · ${nickname}` : dateMealLabel(record)
  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#7d847f'
  ctx.fillText(fitText(ctx, meta, leftMax), PADDING, bottomY)
  ctx.restore()
}
