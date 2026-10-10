import type { FoodRecord } from './api'

export type PhotoPosterLabels = 'calories' | 'nutrients'

/** 照片按原比例完整绘制，署名放在照片外。 */
export function computePhotoPosterHeight(image: { width: number; height: number }, width: number): number {
  return Math.round(width * image.height / image.width) + 52
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const r = Math.min(16, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

const numberLabel = (value: number | null | undefined) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 10) / 10) : '—'
}

export function drawPhotoRecordPoster(ctx: CanvasRenderingContext2D, options: {
  width: number
  height: number
  image: { width: number; height: number }
  record: FoodRecord
  labels: PhotoPosterLabels
  nickname?: string
  qrCodeImage?: { width: number; height: number } | null
}) {
  const { width: w, height: h, image, record, labels, nickname, qrCodeImage } = options
  const photoHeight = h - 52
  ctx.save()
  ctx.fillStyle = '#fffaf2'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(image as CanvasImageSource, 0, 0, w, photoHeight)

  // 横图缩小贴纸，仍留出中间区域给食物；不裁图、不拉伸。
  const scale = Math.min(1, photoHeight / 280)
  ctx.save()
  ctx.scale(scale, scale)
  const sw = w / scale
  const sh = photoHeight / scale
  const meals: Record<string, string> = {
    breakfast: '早餐', morning_snack: '早加餐', lunch: '午餐', afternoon_snack: '午加餐',
    dinner: '晚餐', evening_snack: '晚加餐', snack: '加餐',
  }
  const date = new Date(record.record_time)
  const dateText = Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}.${date.getDate()}`
  pill(ctx, 16, 16, 134, 34, '#fff7de')
  ctx.fillStyle = '#795c36'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 14px sans-serif'
  ctx.fillText(`${dateText}  ${meals[record.meal_type] || '美食打卡'}`, 83, 33)

  // 矢量笑脸不依赖设备上的 emoji 字体。
  const faceX = sw - 36
  ctx.fillStyle = '#ffe184'
  ctx.beginPath()
  ctx.arc(faceX, 34, 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#795c36'
  for (const offset of [-6, 6]) {
    ctx.beginPath()
    ctx.arc(faceX + offset, 30, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.strokeStyle = '#795c36'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(faceX, 33, 7, 0.2, Math.PI - 0.2)
  ctx.stroke()

  const cardHeight = labels === 'nutrients' ? 88 : 58
  const y = sh - cardHeight - 16
  const cardWidth = Math.min(sw - 32, labels === 'nutrients' ? 332 : 214)
  pill(ctx, 16, y, cardWidth, cardHeight, 'rgba(255, 250, 240, 0.94)')
  ctx.textAlign = 'left'
  ctx.fillStyle = '#366b50'
  ctx.font = 'bold 27px sans-serif'
  ctx.fillText(numberLabel(record.total_calories), 30, y + 29)
  const valueWidth = ctx.measureText(numberLabel(record.total_calories)).width
  ctx.font = '12px sans-serif'
  ctx.fillText('kcal · 本餐摄入', 38 + valueWidth, y + 31)
  if (labels === 'nutrients') {
    ctx.font = '12px sans-serif'
    const values = [
      `蛋白质 ${numberLabel(record.total_protein)}g`,
      `碳水 ${numberLabel(record.total_carbs)}g`,
      `脂肪 ${numberLabel(record.total_fat)}g`,
    ]
    values.forEach((label, index) => {
      ctx.fillStyle = ['#5279ad', '#9b7935', '#b97557'][index]
      ctx.fillText(label, 30 + index * 104, y + 65)
    })
  }
  ctx.restore()

  ctx.fillStyle = '#366b50'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const name = nickname ? `${nickname}的美食日记` : '我的美食日记'
  let shortName = name
  while (ctx.measureText(shortName).width > w - 76 && shortName.length > 1) shortName = shortName.slice(0, -1)
  ctx.fillText(shortName === name ? name : `${shortName}…`, 16, photoHeight + 18)
  ctx.fillStyle = '#938674'
  ctx.font = '10px sans-serif'
  ctx.fillText('食探 · 好好吃饭，好好生活', 16, photoHeight + 36)
  if (qrCodeImage) ctx.drawImage(qrCodeImage as CanvasImageSource, w - 46, photoHeight + 7, 38, 38)
  ctx.restore()
}
