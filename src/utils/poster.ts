/**
 * 识别记录海报（Canvas 2D）
 * 深色页背景 + 单卡米白区（参考 Swiss/餐饮卡：上图下文、热量居中主标题感）
 * 不使用任何绿色背景或渐变底；无 PRO 徽章
 */
import type { FoodRecord } from './api'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐', morning_snack: '早加餐', lunch: '午餐',
  afternoon_snack: '午加餐', dinner: '晚餐', evening_snack: '晚加餐', snack: '午加餐'
}
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getRecordDateInfo(recordTime: string) {
  try {
    const d = new Date(recordTime)
    return {
      day: String(d.getDate()),
      month: MONTH_NAMES[d.getMonth()] || 'Jan',
    }
  } catch { return { day: '--', month: '--' } }
}

export const POSTER_WIDTH  = 375
export const POSTER_HEIGHT = 812

/** 页背景（深灰黑，无绿） */
const PAGE_BG = '#141414'
/** 卡片米白（与参考图接近） */
const CREAM = '#F9F7F2'
const TEXT_INK = '#0f172a'
const TEXT_MUTED = '#64748b'
const TEXT_SUB = '#94a3b8'
const LINE = '#e5e7eb'
const CARD_BORDER = '#2a2a2a'

const CARD_MARGIN = 16
const CARD_TOP = 20
const IMG_H = 260
const CARD_RADIUS = 20
const INNER_PAD = 22
const BOTTOM_SAFE = 24

/** 高度计算（与 drawRecordPoster 内边距一致） */
export function computePosterHeight(
  _ctx: CanvasRenderingContext2D,
  record: FoodRecord,
  _width: number = POSTER_WIDTH,
  _isPro: boolean = false
): number {
  const INNER = INNER_PAD
  const p = Math.round(record.total_protein ?? 0)
  const c = Math.round(record.total_carbs ?? 0)
  const f = Math.round(record.total_fat ?? 0)
  const items = record.items || []
  const maxItems = 4
  const n = items.length
  const creamContent =
    INNER +
    26 +
    50 +
    36 +
    28 +
    72 +
    (p + c + f > 0 ? 44 : 0) +
    22 +
    Math.min(n, maxItems) * 36 +
    (n > maxItems ? 20 : 0) +
    (n <= 2 ? 6 : 0) +
    20 +
    108

  return Math.max(CARD_TOP + IMG_H + creamContent + BOTTOM_SAFE, POSTER_HEIGHT)
}

export interface PosterDrawOptions {
  width: number
  height: number
  record: FoodRecord
  image: { width: number; height: number } | null
  qrCodeImage?: { width: number; height: number } | null
  sharerNickname?: string
  sharerAvatarImage?: { width: number; height: number } | null
  isPro?: boolean
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  r: number | { tl: number; tr: number; br: number; bl: number }
) {
  let tl = 0, tr = 0, br = 0, bl = 0
  if (typeof r === 'number') { tl = tr = br = bl = r }
  else { tl = r.tl; tr = r.tr; br = r.br; bl = r.bl }
  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr)
  ctx.lineTo(x + w, y + h - br)
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  ctx.lineTo(x + bl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl)
  ctx.lineTo(x, y + tl)
  ctx.quadraticCurveTo(x, y, x + tl, y)
  ctx.closePath()
}

/** PFC：中性色块，无绿底 */
function drawPFCBarSolid(
  ctx: CanvasRenderingContext2D,
  p: number, c: number, f: number,
  barX: number, barY: number, barW: number
) {
  const total = p + c + f
  if (total <= 0) return
  const barH = 8
  ctx.save()
  drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2)
  ctx.fillStyle = LINE
  ctx.fill()
  const pW = barW * (p / total)
  const cW = barW * (c / total)
  const fW = barW * (f / total)
  let sx = barX
  if (pW > 0.5) {
    drawRoundedRect(ctx, sx, barY, pW, barH, { tl: barH / 2, tr: 0, br: 0, bl: barH / 2 })
    ctx.fillStyle = '#404040'
    ctx.fill()
  }
  sx += pW
  if (cW > 0.5) {
    ctx.beginPath()
    ctx.rect(sx, barY, cW, barH)
    ctx.fillStyle = '#737373'
    ctx.fill()
  }
  sx += cW
  if (fW > 0.5) {
    drawRoundedRect(ctx, sx, barY, fW, barH, { tl: 0, tr: barH / 2, br: barH / 2, bl: 0 })
    ctx.fillStyle = '#a3a3a3'
    ctx.fill()
  }
  ctx.restore()
}

export function drawRecordPoster(
  ctx: CanvasRenderingContext2D,
  options: PosterDrawOptions
): void {
  const { width: W, height: H, record, image, qrCodeImage,
          sharerNickname, sharerAvatarImage } = options

  const cal = Math.round(record.total_calories ?? 0)
  const p = Math.round(record.total_protein ?? 0)
  const c = Math.round(record.total_carbs ?? 0)
  const f = Math.round(record.total_fat ?? 0)
  const items = record.items || []
  const maxItems = 4

  ctx.fillStyle = PAGE_BG
  ctx.fillRect(0, 0, W, H)

  const cardX = CARD_MARGIN
  const cardW = W - CARD_MARGIN * 2
  const cardTop = CARD_TOP
  const totalCardH = H - cardTop - BOTTOM_SAFE

  // 整张米白圆角卡（上图下文一体）
  drawRoundedRect(ctx, cardX, cardTop, cardW, totalCardH, CARD_RADIUS)
  ctx.fillStyle = CREAM
  ctx.fill()
  ctx.save()
  drawRoundedRect(ctx, cardX, cardTop, cardW, totalCardH, CARD_RADIUS)
  ctx.strokeStyle = CARD_BORDER
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()

  // 顶图：仅圆角与卡片上沿一致
  ctx.save()
  drawRoundedRect(ctx, cardX, cardTop, cardW, IMG_H, { tl: CARD_RADIUS, tr: CARD_RADIUS, br: 0, bl: 0 })
  ctx.clip()
  if (image && image.width && image.height) {
    const scale = Math.max(cardW / image.width, IMG_H / image.height)
    const dw = image.width * scale
    const dh = image.height * scale
    ctx.drawImage(image as CanvasImageSource, 0, 0, image.width, image.height,
      cardX - (dw - cardW) / 2, cardTop - (dh - IMG_H) / 2, dw, dh)
  } else {
    ctx.fillStyle = '#e8e8e8'
    ctx.fillRect(cardX, cardTop, cardW, IMG_H)
    ctx.fillStyle = '#9ca3af'
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No Image', cardX + cardW / 2, cardTop + IMG_H / 2)
  }

  // 餐次角标（参考图左上 pill）
  const mealName = MEAL_NAMES[record.meal_type] || '记录'
  const tagPad = 12
  const tagH = 26
  ctx.font = 'bold 12px sans-serif'
  const tagW = ctx.measureText(mealName).width + 20
  ctx.save()
  drawRoundedRect(ctx, cardX + tagPad, cardTop + tagPad, tagW, tagH, 13)
  ctx.fillStyle = 'rgba(255,255,255,0.94)'
  ctx.fill()
  ctx.fillStyle = TEXT_INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(mealName, cardX + tagPad + tagW / 2, cardTop + tagPad + tagH / 2)
  ctx.restore()
  ctx.restore()

  const contentW = cardW - INNER_PAD * 2
  const cx = cardX + INNER_PAD
  let cy = cardTop + IMG_H + INNER_PAD

  const dateInfo = getRecordDateInfo(record.record_time)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = TEXT_SUB
  ctx.font = '600 11px sans-serif'
  ctx.fillText(`${dateInfo.month} ${dateInfo.day}`, cardX + cardW / 2, cy)
  cy += 26

  // 总热量：居中、主标题层级（参考图大标题）
  ctx.fillStyle = TEXT_INK
  ctx.font = 'bold 46px sans-serif'
  const calStr = cal.toLocaleString('en-US')
  ctx.fillText(calStr, cardX + cardW / 2, cy)
  cy += 50
  ctx.fillStyle = TEXT_MUTED
  ctx.font = '600 13px sans-serif'
  ctx.fillText('kcal · 总摄入', cardX + cardW / 2, cy)
  cy += 36

  ctx.fillStyle = TEXT_INK
  ctx.font = '600 15px sans-serif'
  ctx.fillText('宏量营养', cardX + cardW / 2, cy)
  cy += 28

  const colW = contentW / 3
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const macroRows: [number, string][] = [
    [p, '蛋白质'],
    [c, '碳水'],
    [f, '脂肪'],
  ]
  for (let i = 0; i < 3; i++) {
    const [val, lab] = macroRows[i]
    const x = cx + i * colW + colW / 2
    ctx.fillStyle = TEXT_SUB
    ctx.font = '600 9px sans-serif'
    ctx.fillText(lab.toUpperCase(), x, cy)
    ctx.fillStyle = TEXT_INK
    ctx.font = 'bold 21px sans-serif'
    ctx.fillText(`${val}g`, x, cy + 18)
  }
  cy += 72

  if (p + c + f > 0) {
    drawPFCBarSolid(ctx, p, c, f, cx, cy, contentW)
    cy += 44
  }

  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + contentW, cy)
  ctx.strokeStyle = LINE
  ctx.lineWidth = 1
  ctx.stroke()
  cy += 22

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < Math.min(items.length, maxItems); i++) {
    const item = items[i]
    const ratio = (item.ratio ?? 100) / 100
    const itemCal = Math.round((item.nutrients?.calories ?? 0) * ratio)
    const nm = item.name.length > 12 ? item.name.slice(0, 12) + '…' : item.name
    ctx.fillStyle = TEXT_INK
    ctx.font = '600 14px sans-serif'
    ctx.fillText(nm, cx, cy)
    ctx.textAlign = 'right'
    ctx.fillStyle = TEXT_MUTED
    ctx.font = '12px sans-serif'
    ctx.fillText(`${item.intake ?? 0}g · ${itemCal} kcal`, cx + contentW, cy)
    ctx.textAlign = 'left'
    cy += 36
  }
  if (items.length > maxItems) {
    ctx.fillStyle = TEXT_SUB
    ctx.font = '12px sans-serif'
    ctx.fillText(`…还有 ${items.length - maxItems} 项`, cx, cy - 2)
    cy += 20
  }
  if (items.length <= 2) cy += 6

  const footerY = Math.min(cy + 20, cardTop + totalCardH - 100)
  const avatarSz = 22
  const titleX = sharerAvatarImage ? cx + avatarSz + 10 : cx

  if (sharerAvatarImage) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx + avatarSz / 2, footerY + avatarSz / 2, avatarSz / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(sharerAvatarImage as CanvasImageSource, cx, footerY, avatarSz, avatarSz)
    ctx.restore()
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = TEXT_INK
  ctx.font = 'bold 13px sans-serif'
  const displayName = (sharerNickname || '').trim()
  const nameText = displayName ? `${displayName} 的饮食分享` : '智健食探'
  ctx.fillText(nameText, titleX, footerY + 14)

  ctx.fillStyle = TEXT_SUB
  ctx.font = '10px sans-serif'
  ctx.fillText('扫码登录食探，可一键成为好友', titleX, footerY + 32)

  const qrSize = 72
  const qrX = cx + contentW - qrSize
  const qrY = footerY - 2
  if (qrCodeImage) {
    ctx.save()
    drawRoundedRect(ctx, qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 8)
    ctx.strokeStyle = '#d4d4d4'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
    ctx.drawImage(qrCodeImage as CanvasImageSource, qrX, qrY, qrSize, qrSize)
  } else {
    drawRoundedRect(ctx, qrX, qrY, qrSize, qrSize, 8)
    ctx.strokeStyle = LINE
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = 'rgba(148, 163, 184, 0.15)'
    ctx.fill()
    ctx.fillStyle = TEXT_MUTED
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('去记录', qrX + qrSize / 2, qrY + qrSize / 2)
  }
}

export type { FoodRecord }
