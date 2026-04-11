/**
 * 识别记录海报（Canvas 2D）
 * 参考图样式：有边距圆角卡片 + 日期左下角 + 热量左上角 + 三列宏量 + 简洁食物列表
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

/** 页背景 */
const PAGE_BG = '#f5f5f5'
/** 卡片背景 - 使用与首页一致的绿色到白色渐变 */
const CARD_BG_START = 'rgba(0, 188, 125, 0.15)'
const CARD_BG_MID = 'rgba(0, 188, 125, 0.08)'
const CARD_BG_END = '#EFF1F4'
const TEXT_INK = '#0f172a'
const TEXT_MUTED = '#64748b'
const TEXT_SUB = '#94a3b8'
const LINE = '#e5e7eb'

/** 宏量营养配色 */
const MACRO_PROTEIN = '#3b82f6'
const MACRO_CARBS = '#eab308'
const MACRO_FAT = '#f97316'

const CARD_MARGIN = 0
const CARD_TOP = 0
const IMG_H = 280
const CARD_RADIUS = 0
const INNER_PAD = 20

/** 与 drawRecordPoster 中 cy 推进一致，用于紧凑动态高度 */
const LAYOUT_IMG_BOTTOM_GAP = 28
const LAYOUT_CAL_BLOCK = 54
/** 有「较昨」胶囊且可能换行时，热量区需略增高，避免裁切 */
const LAYOUT_CAL_BLOCK_WITH_COMPARE = 82
const LAYOUT_MACRO_BLOCK = 44
const LAYOUT_BAR_EXTRA = 24
const LAYOUT_DIVIDER_AFTER = 20
const LAYOUT_ITEM_ROW = 42
const LAYOUT_OVERFLOW_EXTRA = 24
/** 食物列表最后一行与 footer（头像/二维码区）之间的垂直间距（px） */
const LAYOUT_FOOTER_GAP_AFTER_LIST = 45
/** footer 锚点（头像顶边）到画布底：含二维码与底边距，与绘制一致 */
const LAYOUT_FOOTER_ANCHOR_TAIL = 84

/** 海报热量行右侧胶囊：计划达成三点始终可画；「较昨」仅在有昨日同餐基线时展示 */
export interface PosterCalorieCompareInput {
  /** 该餐次计划热量（首页仪表盘分配），用于三点达成度 */
  mealPlanKcal: number
  hasBaseline: boolean
  deltaKcal: number
  baselineKcal: number
}

function shouldShowPosterCalorieChip(c?: PosterCalorieCompareInput): boolean {
  if (!c || !Number.isFinite(c.mealPlanKcal)) return false
  /** 有计划目标时展示达成点；无计划但有昨日对比时仍展示「较昨」条 */
  return c.mealPlanKcal > 0 || c.hasBaseline
}

/** 高度计算（与 drawRecordPoster 同步；不再强制定高 812，按餐食项数压缩空白） */
export function computePosterHeight(
  _ctx: CanvasRenderingContext2D,
  record: FoodRecord,
  _width: number = POSTER_WIDTH,
  _isPro: boolean = false,
  calorieCompare?: PosterCalorieCompareInput
): number {
  const p = Math.round(record.total_protein ?? 0)
  const c = Math.round(record.total_carbs ?? 0)
  const f = Math.round(record.total_fat ?? 0)
  const items = record.items || []
  const maxItems = 4
  const n = items.length

  const hasCompare = shouldShowPosterCalorieChip(calorieCompare)

  let cy = IMG_H + LAYOUT_IMG_BOTTOM_GAP
  cy += hasCompare ? LAYOUT_CAL_BLOCK_WITH_COMPARE : LAYOUT_CAL_BLOCK
  cy += LAYOUT_MACRO_BLOCK
  if (p + c + f > 0) cy += LAYOUT_BAR_EXTRA
  cy += LAYOUT_DIVIDER_AFTER
  cy += Math.min(n, maxItems) * LAYOUT_ITEM_ROW
  if (n > maxItems) cy += LAYOUT_OVERFLOW_EXTRA

  const footerY = cy + LAYOUT_FOOTER_GAP_AFTER_LIST
  return footerY + LAYOUT_FOOTER_ANCHOR_TAIL
}

export interface PosterDrawOptions {
  width: number
  height: number
  record: FoodRecord
  calorieCompare?: PosterCalorieCompareInput
  image: { width: number; height: number } | null
  qrCodeImage?: { width: number; height: number } | null
  sharerNickname?: string
  sharerAvatarImage?: { width: number; height: number } | null
  isPro?: boolean
}

/**
 * 本餐热量相对该餐计划目标的达成度：33% / 66% / 100% 各点亮一格（共 3 格）。
 * 计划为 0 或无效时不点亮。
 */
function mealPlanAchievementLevel(currentKcal: number, mealPlanKcal: number): number {
  if (!Number.isFinite(mealPlanKcal) || mealPlanKcal <= 0 || !Number.isFinite(currentKcal)) return 0
  const ratio = currentKcal / mealPlanKcal
  if (ratio >= 1) return 3
  if (ratio >= 0.66) return 2
  if (ratio >= 0.33) return 1
  return 0
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

export function drawRecordPoster(
  ctx: CanvasRenderingContext2D,
  options: PosterDrawOptions
): void {
  const { width: W, height: H, record, image, qrCodeImage,
          calorieCompare,
          sharerNickname, sharerAvatarImage } = options

  const cal = Math.round(record.total_calories ?? 0)
  const p = Math.round(record.total_protein ?? 0)
  const c = Math.round(record.total_carbs ?? 0)
  const f = Math.round(record.total_fat ?? 0)
  const items = record.items || []
  const maxItems = 4

  const cardX = 0
  const cardW = W
  const cardTop = 0

  // 米白色卡片背景（全屏无margin，顶格渲染）
  ctx.fillStyle = '#F9F7F2'
  ctx.fillRect(0, 0, W, H)

  // 顶图（全宽，无圆角）
  ctx.save()
  ctx.beginPath()
  ctx.rect(cardX, cardTop, cardW, IMG_H)
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

  // 餐次角标（左上）
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

  // 日期：左下角，格式 "9 Apr."，日期和月份底部对齐
  const dateInfo = getRecordDateInfo(record.record_time)
  const datePad = 16
  const monthStr = String(dateInfo.month).charAt(0).toUpperCase() + String(dateInfo.month).slice(1).toLowerCase()
  const dayStr = String(dateInfo.day)
  
  // 底部渐变遮罩
  const gradientH = 80
  const grad = ctx.createLinearGradient(0, cardTop + IMG_H - gradientH, 0, cardTop + IMG_H)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.save()
  ctx.fillStyle = grad
  ctx.fillRect(cardX, cardTop + IMG_H - gradientH, cardW, gradientH)
  ctx.restore()
  
  // 绘制日期（底部对齐，月份往上调整）
  ctx.save()
  const tx = cardX + datePad
  const ty = cardTop + IMG_H - datePad
  
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.font = 'bold 40px sans-serif'
  ctx.fillStyle = '#ffffff'
  const dayW = ctx.measureText(dayStr).width
  ctx.fillText(dayStr, tx, ty)
  
  // 月份往上调整（ty - 6 使月份位置更高）
  ctx.font = '500 16px sans-serif'
  ctx.fillText(` ${monthStr}.`, tx + dayW, ty - 6)
  ctx.restore()
  ctx.restore()

  const contentW = cardW - INNER_PAD * 2
  const cx = cardX + INNER_PAD
  let cy = cardTop + IMG_H + LAYOUT_IMG_BOTTOM_GAP

  // 热量：数字与「 kcal」共用 alphabetic baseline 下沿对齐；胶囊条同一行靠右（紧跟 kcal 或换行）
  const calBaselineY = cy + 38
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = TEXT_INK
  ctx.font = 'bold 44px sans-serif'
  const calStr = cal.toLocaleString('en-US')
  ctx.fillText(calStr, cx, calBaselineY)
  const calStrW = ctx.measureText(calStr).width
  ctx.fillStyle = TEXT_MUTED
  ctx.font = '600 14px sans-serif'
  const kcalSuffix = ' kcal'
  ctx.fillText(kcalSuffix, cx + calStrW, calBaselineY)
  const kcalSuffixW = ctx.measureText(kcalSuffix).width

  if (shouldShowPosterCalorieChip(calorieCompare)) {
    const cc = calorieCompare!
    const absDelta = Math.abs(Math.round(cc.deltaKcal))
    const prefix = cc.deltaKcal > 0 ? '+' : cc.deltaKcal < 0 ? '-' : '±'
    const chipText = cc.hasBaseline ? `较昨 ${prefix}${absDelta}` : ''
    /** 三点：本餐热量相对该餐计划目标的 33% / 66% / 100% 档位 */
    const level = mealPlanAchievementLevel(cal, cc.mealPlanKcal)

    const chipH = 32
    const padL = chipText ? 12 : 10
    const padR = 10
    const dotGap = 7
    const dotR = 4.5
    const dotsBandW = dotGap * 2 + dotR * 2 * 3

    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = '800 13px sans-serif'
    const textW = chipText ? ctx.measureText(chipText).width : 0
    const chipW = Math.ceil(padL + textW + padR + dotsBandW + (chipText ? 10 : 6))
    /** 同一行最右侧（内容区内右对齐） */
    let chipX = cx + contentW - chipW
    let chipY = calBaselineY - chipH / 2 - 14
    const kcalBlockRight = cx + calStrW + kcalSuffixW
    const minGap = 8
    if (kcalBlockRight + minGap > chipX) {
      chipY = calBaselineY + 14
    }

    /** 胶囊条背景色（产品指定）+ 深色字 + 右侧三点等级 */
    const CHIP_BG = '#E5C68D'
    const CHIP_STROKE = 'rgba(17, 24, 39, 0.12)'
    drawRoundedRect(ctx, chipX, chipY, chipW, chipH, chipH / 2)
    ctx.fillStyle = CHIP_BG
    ctx.fill()
    ctx.strokeStyle = CHIP_STROKE
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = '#111827'
    ctx.font = '800 13px sans-serif'
    if (chipText) {
      ctx.fillText(chipText, chipX + padL, chipY + chipH / 2 + 0.5)
    }

    const dotsLeft = chipX + chipW - padR - dotsBandW
    const iconCenterY = chipY + chipH / 2
    for (let i = 0; i < 3; i++) {
      const iconX = dotsLeft + dotR + i * (dotR * 2 + dotGap)
      ctx.beginPath()
      ctx.arc(iconX, iconCenterY, dotR, 0, Math.PI * 2)
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 1.35
      ctx.stroke()
      if (i < level) {
        ctx.beginPath()
        ctx.arc(iconX, iconCenterY, dotR - 2.2, 0, Math.PI * 2)
        ctx.fillStyle = '#111827'
        ctx.fill()
      }
    }
    ctx.restore()
  }
  cy += shouldShowPosterCalorieChip(calorieCompare) ? LAYOUT_CAL_BLOCK_WITH_COMPARE : LAYOUT_CAL_BLOCK

  // 宏量营养：蛋白质左对齐，脂肪右对齐，数值字体减小
  const macroY = cy
  const valueY = macroY + 18
  
  // 标签行
  ctx.textBaseline = 'top'
  ctx.font = '600 13px sans-serif'
  
  // 蛋白质（左对齐）
  ctx.textAlign = 'left'
  ctx.fillStyle = MACRO_PROTEIN
  ctx.fillText('蛋白质', cx, macroY)
  
  // 碳水（居中）
  ctx.textAlign = 'center'
  ctx.fillStyle = MACRO_CARBS
  ctx.fillText('碳水', cx + contentW / 2, macroY)
  
  // 脂肪（右对齐）
  ctx.textAlign = 'right'
  ctx.fillStyle = MACRO_FAT
  ctx.fillText('脂肪', cx + contentW, macroY)
  
  // 数值行（适当放大，增强海报可读性）
  ctx.fillStyle = TEXT_INK
  ctx.font = 'bold 21px sans-serif'
  
  // 蛋白质数值（左对齐）
  ctx.textAlign = 'left'
  ctx.fillText(`${p}g`, cx, valueY)
  
  // 碳水数值（居中）
  ctx.textAlign = 'center'
  ctx.fillText(`${c}g`, cx + contentW / 2, valueY)
  
  // 脂肪数值（右对齐）
  ctx.textAlign = 'right'
  ctx.fillText(`${f}g`, cx + contentW, valueY)
  
  cy += LAYOUT_MACRO_BLOCK

  // PFC 进度条
  if (p + c + f > 0) {
    const total = p + c + f
    const barW = contentW
    const barH = 8
    const pW = barW * (p / total)
    const cW = barW * (c / total)
    const fW = barW * (f / total)
    
    // 背景
    ctx.save()
    drawRoundedRect(ctx, cx, cy, barW, barH, barH / 2)
    ctx.fillStyle = LINE
    ctx.fill()
    
    // 蛋白质段
    let sx = cx
    if (pW > 0.5) {
      drawRoundedRect(ctx, sx, cy, pW, barH, { tl: barH / 2, tr: 0, br: 0, bl: barH / 2 })
      ctx.fillStyle = MACRO_PROTEIN
      ctx.fill()
    }
    sx += pW
    // 碳水段
    if (cW > 0.5) {
      ctx.beginPath()
      ctx.rect(sx, cy, cW, barH)
      ctx.fillStyle = MACRO_CARBS
      ctx.fill()
    }
    sx += cW
    // 脂肪段
    if (fW > 0.5) {
      drawRoundedRect(ctx, sx, cy, fW, barH, { tl: 0, tr: barH / 2, br: barH / 2, bl: 0 })
      ctx.fillStyle = MACRO_FAT
      ctx.fill()
    }
    ctx.restore()
    cy += LAYOUT_BAR_EXTRA
  }

  // 分隔线
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + contentW, cy)
  ctx.strokeStyle = LINE
  ctx.lineWidth = 1
  ctx.stroke()
  cy += LAYOUT_DIVIDER_AFTER

  // 食物列表：简洁样式，无背景色（与参考图一致）
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  
  for (let i = 0; i < Math.min(items.length, maxItems); i++) {
    const item = items[i]
    const ratio = (item.ratio ?? 100) / 100
    const itemCal = Math.round((item.nutrients?.calories ?? 0) * ratio)
    const nm = item.name.length > 12 ? item.name.slice(0, 12) + '…' : item.name
    
    const itemY = cy
    const itemH = 40
    
    // 食物名称（左侧，放大）
    ctx.fillStyle = TEXT_INK
    ctx.font = '600 16px sans-serif'
    ctx.fillText(nm, cx, itemY + itemH / 2)
    
    // 右侧信息：克数 · 热量（放大）
    ctx.textAlign = 'right'
    ctx.fillStyle = TEXT_MUTED
    ctx.font = '14px sans-serif'
    const infoText = `${item.intake ?? 0}g · ${itemCal} kcal`
    ctx.fillText(infoText, cx + contentW, itemY + itemH / 2)
    
    ctx.textAlign = 'left'
    cy += itemH + 2
  }
  
  if (items.length > maxItems) {
    cy += 8
    ctx.fillStyle = TEXT_SUB
    ctx.font = 'italic 12px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`还有 ${items.length - maxItems} 项`, cx + contentW / 2, cy)
    ctx.textAlign = 'left'
    cy += 16
  }

  // Footer：紧跟食物列表，避免大块留白（总高度 H 由 computePosterHeight 与之一致）
  const footerY = cy + LAYOUT_FOOTER_GAP_AFTER_LIST
  const avatarSz = 36
  const titleX = sharerAvatarImage ? cx + avatarSz + 12 : cx

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
  ctx.font = 'bold 15px sans-serif'
  const displayName = (sharerNickname || '').trim()
  const nameText = displayName ? `${displayName} 的饮食分享` : '智健食探'
  ctx.fillText(nameText, titleX, footerY + 16)

  ctx.fillStyle = TEXT_SUB
  ctx.font = '12px sans-serif'
  ctx.fillText('扫码登录食探，可一键成为好友', titleX, footerY + 36)

  const qrSize = 72
  const qrX = cx + contentW - qrSize
  const qrY = footerY - 4
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
