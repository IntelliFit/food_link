import type { FoodRecord } from './api'

/** 相机水印打卡图：照片不再叠贴纸，日期、热量、营养素和小程序码收进同一个信息区。 */
export type PosterLabels = 'calories' | 'nutrients'
export type WatermarkStyle = 'strip' | 'dark' | 'frame' | 'grid' | 'overlay'

export const WATERMARK_STYLES: ReadonlyArray<{ id: WatermarkStyle; name: string }> = [
  { id: 'strip', name: '白条' },
  { id: 'dark', name: '黑条' },
  { id: 'frame', name: '相框' },
  { id: 'grid', name: '参数' },
  { id: 'overlay', name: '叠字' },
]

type Image = { width: number; height: number }

export interface WatermarkPosterOptions {
  style: WatermarkStyle
  width: number
  height: number
  image: Image
  record: FoodRecord
  labels: PosterLabels
  nickname?: string
  qrCodeImage?: Image | null
}

interface Palette { bg: string; text: string; muted: string; accent: string; line: string }
interface Info {
  kcal: string
  date: string
  meal: string
  nickname: string
  macros: Array<{ label: string; short: string; value: string }> | null
}

const PORTRAIT_PHOTO_RATIO = 3 / 4
const CHROME: Record<WatermarkStyle, { border: number; info: number }> = {
  strip: { border: 0, info: 76 },
  dark: { border: 0, info: 76 },
  frame: { border: 14, info: 96 },
  grid: { border: 14, info: 118 },
  overlay: { border: 0, info: 0 },
}
const BAR_HEIGHT = 76
const PADDING = 16
const QR_SIZE = 44
const SMALL_QR_SIZE = 36
const COLUMN_GAP = 12
const BRAND = '食探'
const NUMBER_FONT = '"DIN Alternate", "Helvetica Neue", Arial, sans-serif'

const LIGHT: Palette = { bg: '#ffffff', text: '#1f2a24', muted: '#7d847f', accent: '#00bc7d', line: '#e4e6e3' }
const DARK: Palette = { bg: '#161816', text: '#f6f4ee', muted: '#a5a8a2', accent: '#d9b26f', line: '#3a3d39' }
const ON_PHOTO: Palette = { bg: 'transparent', text: '#ffffff', muted: 'rgba(255, 255, 255, 0.82)', accent: '#ffd479', line: 'rgba(255, 255, 255, 0.35)' }

const MEAL_LABELS: Record<string, string> = {
  breakfast: '早餐', morning_snack: '早加餐', lunch: '午餐', afternoon_snack: '午加餐',
  dinner: '晚餐', evening_snack: '晚加餐', snack: '加餐',
}

function numberLabel(value: number | null | undefined): string {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 10) / 10) : '—'
}

function gramLabel(value: number | null | undefined): string {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? `${Math.round(n)}g` : '—'
}

function buildInfo(record: FoodRecord, labels: PosterLabels, nickname?: string): Info {
  const date = new Date(record.record_time)
  const macro = (label: string, short: string, value: number | null | undefined) => ({ label, short, value: gramLabel(value) })
  return {
    kcal: numberLabel(record.total_calories),
    date: Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}.${date.getDate()}`,
    meal: MEAL_LABELS[record.meal_type] || '美食打卡',
    nickname: nickname || '',
    macros: labels === 'nutrients'
      ? [macro('蛋白质', '蛋白', record.total_protein), macro('碳水', '碳水', record.total_carbs), macro('脂肪', '脂肪', record.total_fat)]
      : null,
  }
}

const metaLine = (info: Info) => [`${info.date}  ${info.meal}`.trim(), info.nickname].filter(Boolean).join(' · ')
const macroLine = (info: Info) => info.macros?.map(m => `${m.short} ${m.value}`).join('  ') ?? ''

function photoRect(style: WatermarkStyle, image: Image, width: number) {
  const { border } = CHROME[style]
  const w = width - border * 2
  const h = image.height > image.width ? Math.round(w / PORTRAIT_PHOTO_RATIO) : Math.round(w * image.height / image.width)
  return { x: border, y: border, w, h }
}

export function computeWatermarkPosterHeight(style: WatermarkStyle, image: Image, width: number): number {
  const { y, h } = photoRect(style, image, width)
  return y + h + CHROME[style].info
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let short = text
  while (short.length > 1 && ctx.measureText(`${short}…`).width > maxWidth) short = short.slice(0, -1)
  return `${short}…`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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
}

/** 小程序码始终放在白底上，深色样式也能被扫出来。 */
function drawQr(ctx: CanvasRenderingContext2D, qr: Image, x: number, y: number, size: number, plate: boolean) {
  if (plate) {
    roundRect(ctx, x - 3, y - 3, size + 6, size + 6, 6)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  ctx.drawImage(qr as CanvasImageSource, x, y, size, size)
}

/** 品牌字逐字绘制，模拟字间距（小程序 canvas 不支持 letterSpacing）。 */
function drawBrand(ctx: CanvasRenderingContext2D, x: number, y: number, align: 'left' | 'right', font: string, spacing = 4): number {
  ctx.font = font
  const chars = Array.from(BRAND)
  const widths = chars.map(c => ctx.measureText(c).width)
  const total = widths.reduce((sum, cw) => sum + cw, 0) + spacing * (chars.length - 1)
  let cursor = align === 'right' ? x - total : x
  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    ctx.fillText(c, cursor, y)
    cursor += widths[i] + spacing
  })
  return total
}

/** 热量数字与单位共用基线；返回整体宽度，供调用方排版。 */
function kcalWidth(ctx: CanvasRenderingContext2D, kcal: string, numberSize: number): number {
  ctx.font = `bold ${numberSize}px ${NUMBER_FONT}`
  const number = ctx.measureText(kcal).width
  ctx.font = '11px sans-serif'
  return number + 4 + ctx.measureText('kcal').width
}

function drawKcal(ctx: CanvasRenderingContext2D, kcal: string, x: number, y: number, numberSize: number, palette: Palette) {
  ctx.textAlign = 'left'
  ctx.fillStyle = palette.text
  ctx.font = `bold ${numberSize}px ${NUMBER_FONT}`
  ctx.fillText(kcal, x, y)
  const number = ctx.measureText(kcal).width
  ctx.font = '11px sans-serif'
  ctx.fillStyle = palette.muted
  ctx.fillText('kcal', x + number + 4, y)
}

/** 白条、黑条、叠字共用：左侧热量 + 日期昵称，右侧品牌 + 营养素，再靠右是小程序码。 */
function drawBar(ctx: CanvasRenderingContext2D, top: number, w: number, info: Info, palette: Palette, qr: Image | null | undefined, plate: boolean) {
  const midY = top + BAR_HEIGHT / 2
  const firstBaseline = midY - 3
  const secondBaseline = midY + 17
  let textRight = w - PADDING
  if (qr) {
    const qrX = w - PADDING - QR_SIZE
    ctx.fillStyle = palette.line
    ctx.fillRect(qrX - 9, midY - 17, 1, 34)
    drawQr(ctx, qr, qrX, midY - QR_SIZE / 2, QR_SIZE, plate)
    textRight = qrX - 9 - COLUMN_GAP
  }
  ctx.fillStyle = palette.text
  const brandWidth = drawBrand(ctx, textRight, firstBaseline, 'right', 'bold 15px sans-serif')
  const detail = macroLine(info) || '好好吃饭，好好生活'
  ctx.font = '11px sans-serif'
  const detailWidth = ctx.measureText(detail).width
  ctx.textAlign = 'right'
  ctx.fillStyle = palette.muted
  ctx.fillText(detail, textRight, secondBaseline)
  ctx.fillStyle = palette.accent
  ctx.beginPath()
  ctx.arc(textRight - detailWidth - 7, secondBaseline - 3.5, 2.5, 0, Math.PI * 2)
  ctx.fill()

  const leftMax = Math.max(40, textRight - Math.max(brandWidth, detailWidth + 10) - COLUMN_GAP - PADDING)
  drawKcal(ctx, info.kcal, PADDING, firstBaseline, 24, palette)
  ctx.textAlign = 'left'
  ctx.font = '10px sans-serif'
  ctx.fillStyle = palette.muted
  ctx.fillText(fitText(ctx, metaLine(info), leftMax), PADDING, secondBaseline)
}

/** 相框：品牌、热量、小程序码横向居中对齐，营养素和日期在热量下方。 */
function drawFrameInfo(ctx: CanvasRenderingContext2D, top: number, w: number, info: Info, qr?: Image | null) {
  const { border, info: infoHeight } = CHROME.frame
  const midY = top + infoHeight / 2
  ctx.fillStyle = LIGHT.text
  drawBrand(ctx, border + 2, midY + 5, 'left', 'bold 14px sans-serif', 3)
  if (qr) drawQr(ctx, qr, w - border - SMALL_QR_SIZE, midY - SMALL_QR_SIZE / 2, SMALL_QR_SIZE, false)

  const centerMax = w - (border + SMALL_QR_SIZE + 10) * 2
  const kcalLine = kcalWidth(ctx, info.kcal, 26)
  drawKcal(ctx, info.kcal, (w - kcalLine) / 2, top + 36, 26, LIGHT)
  ctx.textAlign = 'center'
  const macros = macroLine(info)
  if (macros) {
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#4b5a51'
    ctx.fillText(fitText(ctx, macros, centerMax), w / 2, top + 57)
  }
  ctx.font = '10px sans-serif'
  ctx.fillStyle = LIGHT.muted
  ctx.fillText(fitText(ctx, metaLine(info), centerMax), w / 2, top + (macros ? 75 : 62))
}

/** 参数：像相机参数表，每列「标题 + 数值」；只标热量时后两列换成日期和餐次。 */
function drawGridInfo(ctx: CanvasRenderingContext2D, top: number, w: number, info: Info, qr?: Image | null) {
  const { border } = CHROME.grid
  const inner = w - border * 2
  const rest = info.macros
    ? info.macros.map(m => ({ label: m.label, value: m.value }))
    : [{ label: '日期', value: info.date || '—' }, { label: '餐次', value: info.meal }]
  const columnCount = rest.length + 1
  const columnWidth = inner / columnCount
  const labelY = top + 22
  const valueY = top + 44
  const cellX = (index: number) => border + columnWidth * index + (index === 0 ? 2 : 10)
  ctx.textAlign = 'left'
  ;['热量', ...rest.map(c => c.label)].forEach((label, index) => {
    ctx.font = '10px sans-serif'
    ctx.fillStyle = LIGHT.muted
    ctx.fillText(label, cellX(index), labelY)
    if (index > 0) {
      ctx.fillStyle = LIGHT.line
      ctx.fillRect(border + columnWidth * index, labelY - 9, 1, 36)
    }
  })
  drawKcal(ctx, info.kcal, cellX(0), valueY, 19, LIGHT)
  rest.forEach((cell, index) => {
    ctx.textAlign = 'left'
    ctx.fillStyle = LIGHT.text
    ctx.font = `bold 17px ${NUMBER_FONT}`
    ctx.fillText(fitText(ctx, cell.value, columnWidth - 14), cellX(index + 1), valueY)
  })

  const footerTop = top + 58
  ctx.fillStyle = LIGHT.line
  ctx.fillRect(border, footerTop, inner, 1)
  const footerMid = footerTop + (CHROME.grid.info - 58) / 2
  let textRight = w - border
  if (qr) {
    drawQr(ctx, qr, w - border - SMALL_QR_SIZE, footerMid - SMALL_QR_SIZE / 2, SMALL_QR_SIZE, false)
    textRight -= SMALL_QR_SIZE + 10
  }
  ctx.fillStyle = LIGHT.text
  const brandWidth = drawBrand(ctx, textRight, footerMid + 5, 'right', 'bold 14px sans-serif', 3)
  ctx.textAlign = 'left'
  ctx.font = '10px sans-serif'
  ctx.fillStyle = LIGHT.muted
  const meta = info.macros ? metaLine(info) : (info.nickname ? `${info.nickname}的美食日记` : '我的美食日记')
  ctx.fillText(fitText(ctx, meta, textRight - brandWidth - COLUMN_GAP - border - 2), border + 2, footerMid + 5)
}

export function drawWatermarkRecordPoster(ctx: CanvasRenderingContext2D, options: WatermarkPosterOptions) {
  const { style, width: w, height: h, image, record, labels, nickname, qrCodeImage } = options
  const info = buildInfo(record, labels, nickname)
  const photo = photoRect(style, image, w)
  ctx.save()
  ctx.fillStyle = style === 'dark' ? DARK.bg : LIGHT.bg
  ctx.fillRect(0, 0, w, h)

  // 居中裁到目标比例：竖图取 3:4，横图保持原比例（只吸收取整误差）。
  const targetRatio = photo.w / photo.h
  const sourceWidth = Math.min(image.width, image.height * targetRatio)
  const sourceHeight = Math.min(image.height, image.width / targetRatio)
  ctx.drawImage(image as CanvasImageSource,
    (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2, sourceWidth, sourceHeight,
    photo.x, photo.y, photo.w, photo.h)

  ctx.textBaseline = 'alphabetic'
  const infoTop = photo.y + photo.h
  if (style === 'strip') drawBar(ctx, infoTop, w, info, LIGHT, qrCodeImage, false)
  else if (style === 'dark') drawBar(ctx, infoTop, w, info, DARK, qrCodeImage, true)
  else if (style === 'frame') drawFrameInfo(ctx, infoTop, w, info, qrCodeImage)
  else if (style === 'grid') drawGridInfo(ctx, infoTop, w, info, qrCodeImage)
  else {
    // 叠字不加高度，靠底部渐变保证浅色照片上也看得清。
    const fadeHeight = Math.min(BAR_HEIGHT + 44, photo.h)
    const fade = ctx.createLinearGradient(0, h - fadeHeight, 0, h)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 0.68)')
    ctx.fillStyle = fade
    ctx.fillRect(0, h - fadeHeight, w, fadeHeight)
    drawBar(ctx, h - BAR_HEIGHT, w, info, ON_PHOTO, qrCodeImage, true)
  }
  ctx.restore()
}
