/**
 * 识别记录海报绘制工具
 * 标准版：森系/Ins 浅薄荷绿渐变，毛玻璃卡片
 * Pro 版：同色系浅色背景 + 琥珀金点缀 + PRO 徽章 + PFC 图表 + 食物双Y轴柱状图
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

/** 海报尺寸 */
export const POSTER_WIDTH  = 375
export const POSTER_HEIGHT = 812

/** 高度计算 */
export function computePosterHeight(
  ctx: CanvasRenderingContext2D,
  record: FoodRecord,
  width: number = POSTER_WIDTH,
  isPro: boolean = false
): number {
  let y = 30   // cardY
  y += 260     // imgH
  y += 24      // padding after image
  y += 56      // macros row

  if (isPro) {
    y += 36    // PFC stacked bar + legend
  }

  y += 24      // divider

  // 食物列表（Pro 和标准一致）
  const items = record.items || []
  const maxItems = 4
  y += Math.min(items.length, maxItems) * 30
  if (items.length > maxItems) y += 20
  if (items.length <= 2) y += 20

  if (record.insight) { y += 10 + 96 } else { y += 30 }

  const cardW = width - 40
  const boxW  = cardW - 48
  ctx.save()
  ctx.font = '13px sans-serif'
  const measureLines = (text: string, maxW: number) => {
    const chars = text.split('')
    let line = '', lines = 1
    for (const ch of chars) {
      const test = line + ch
      if (ctx.measureText(test).width > maxW && line.length > 0) { lines++; line = ch }
      else { line = test }
    }
    return lines
  }
  const addBlock = (text: string, max: number) => {
    y += 10 + 24
    y += Math.min(measureLines(text, boxW), max) * 20 + 16
  }
  if (record.description)      addBlock(record.description, 3)
  if (record.pfc_ratio_comment) addBlock(record.pfc_ratio_comment, 4)
  if (record.absorption_notes)  addBlock(record.absorption_notes, 4)
  if (record.context_advice)    addBlock(record.context_advice, 4)
  ctx.restore()

  return Math.max(y + 180, POSTER_HEIGHT)
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

// ── 配色常量 ──────────────────────────────────────────────────
const CARD_BG        = 'rgba(255, 255, 255, 0.82)'
const TEXT_MAIN      = '#1e293b'
const TEXT_SECONDARY = '#64748b'
const TEXT_LIGHT     = '#94a3b8'
const DIVIDER_COLOR  = '#f1f5f9'
const BRAND_GREEN    = '#00bc7d'
const PRO_GOLD       = '#f59e0b'
const PRO_GOLD_LIGHT = '#fde68a'

/** 绘制圆角矩形 */
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

/**
 * 绘制 PFC 横向堆叠进度条 + 图例
 * 返回消耗的高度（36px）
 */
function drawPFCBar(
  ctx: CanvasRenderingContext2D,
  p: number, c: number, f: number,
  barX: number, barY: number, barW: number
) {
  const total = p + c + f
  if (total <= 0) return

  const barH = 10

  // ── 轨道背景 ──
  ctx.save()
  drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2)
  ctx.fillStyle = '#e5e7eb'
  ctx.fill()

  // ── 三段色块 ──
  const pW = barW * (p / total)
  const cW = barW * (c / total)
  const fW = barW * (f / total)
  let sx = barX

  if (pW > 0.5) {
    ctx.save()
    drawRoundedRect(ctx, sx, barY, pW, barH, { tl: barH/2, tr: 0, br: 0, bl: barH/2 })
    ctx.fillStyle = BRAND_GREEN
    ctx.fill()
    ctx.restore()
  }
  sx += pW
  if (cW > 0.5) {
    ctx.beginPath(); ctx.rect(sx, barY, cW, barH)
    ctx.fillStyle = '#f59e0b'; ctx.fill()
  }
  sx += cW
  if (fW > 0.5) {
    ctx.save()
    drawRoundedRect(ctx, sx, barY, fW, barH, { tl: 0, tr: barH/2, br: barH/2, bl: 0 })
    ctx.fillStyle = '#f97316'; ctx.fill()
    ctx.restore()
  }
  ctx.restore()

  // ── 图例行（三等份列，左对齐） ──
  const legendY  = barY + barH + 8
  const colW     = barW / 3
  const dotR     = 4
  const legends  = [
    { label: `蛋白 ${p}g`, pct: Math.round(p / total * 100), color: BRAND_GREEN },
    { label: `碳水 ${c}g`, pct: Math.round(c / total * 100), color: '#f59e0b'   },
    { label: `脂肪 ${f}g`, pct: Math.round(f / total * 100), color: '#f97316'   },
  ]
  ctx.save()
  ctx.font = '10px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (let i = 0; i < 3; i++) {
    const li  = legends[i]
    const lx  = barX + i * colW
    const cy  = legendY + dotR
    ctx.beginPath()
    ctx.arc(lx + dotR, cy, dotR, 0, Math.PI * 2)
    ctx.fillStyle = li.color
    ctx.fill()
    ctx.fillStyle = TEXT_SECONDARY
    ctx.fillText(`${li.label} (${li.pct}%)`, lx + dotR * 2 + 4, cy)
  }
  ctx.restore()
  // 消耗高度 = 10(bar) + 8(gap) + 18(legend dot diameter)  = 36
}

/**
 * 绘制食物双Y轴柱状图（Pro专用）
 * 左轴：重量(g)，右轴：热量(kcal)
 * 返回图表结束的 Y 坐标
 */


export function drawRecordPoster(
  ctx: CanvasRenderingContext2D,
  options: PosterDrawOptions
): void {
  const { width: W, height: H, record, image, qrCodeImage,
          sharerNickname, sharerAvatarImage, isPro = false } = options

  // ── 1. 背景（两种模式共用浅色调） ─────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, W, H)
  bgGrad.addColorStop(0, '#e6fffa')
  bgGrad.addColorStop(1, '#f1f8e9')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  const blob1 = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, 200)
  blob1.addColorStop(0, 'rgba(0, 188, 125, 0.15)')
  blob1.addColorStop(1, 'rgba(0, 188, 125, 0)')
  ctx.fillStyle = blob1; ctx.fillRect(0, 0, W, H)

  if (isPro) {
    // Pro 多一个琥珀金光晕
    const blob2 = ctx.createRadialGradient(W * 0.1, H * 0.85, 0, W * 0.1, H * 0.85, 200)
    blob2.addColorStop(0, 'rgba(245, 158, 11, 0.12)')
    blob2.addColorStop(1, 'rgba(245, 158, 11, 0)')
    ctx.fillStyle = blob2; ctx.fillRect(0, 0, W, H)
  } else {
    const blob2 = ctx.createRadialGradient(W * 0.1, H * 0.8, 0, W * 0.1, H * 0.8, 250)
    blob2.addColorStop(0, 'rgba(56, 189, 248, 0.1)')
    blob2.addColorStop(1, 'rgba(56, 189, 248, 0)')
    ctx.fillStyle = blob2; ctx.fillRect(0, 0, W, H)
  }

  // ── 2. 主卡片 ─────────────────────────────────────────────
  const cardMargin = 20
  const cardX = cardMargin, cardY = 30
  const cardW = W - cardMargin * 2
  const cardH = H - 60
  const cardRadius = 24

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.08)'; ctx.shadowBlur = 32; ctx.shadowOffsetY = 12
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fillStyle = CARD_BG; ctx.fill()
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke()
  ctx.restore()

  let currentY = cardY

  // ── 3. 主图 ───────────────────────────────────────────────
  const imgH = 260
  ctx.save()
  drawRoundedRect(ctx, cardX, currentY, cardW, imgH, { tl: cardRadius, tr: cardRadius, br: 0, bl: 0 })
  ctx.clip()
  if (image && image.width && image.height) {
    const scale = Math.max(cardW / image.width, imgH / image.height)
    const dw = image.width * scale, dh = image.height * scale
    ctx.drawImage(image as CanvasImageSource, 0, 0, image.width, image.height,
      cardX - (dw - cardW) / 2, currentY - (dh - imgH) / 2, dw, dh)
  } else {
    ctx.fillStyle = '#E5E7EB'; ctx.fillRect(cardX, currentY, cardW, imgH)
    ctx.fillStyle = '#9CA3AF'; ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('No Image', cardX + cardW / 2, currentY + imgH / 2)
  }
  ctx.restore()

  // 图片底部渐变
  const imgGrad = ctx.createLinearGradient(0, currentY + imgH * 0.55, 0, currentY + imgH)
  imgGrad.addColorStop(0, 'rgba(0,0,0,0)')
  imgGrad.addColorStop(1, 'rgba(0,0,0,0.60)')
  ctx.fillStyle = imgGrad; ctx.fillRect(cardX, currentY + imgH * 0.5, cardW, imgH * 0.5)

  // Pro: PRO 徽章（图片右上角）
  if (isPro) {
    const bW = 48, bH = 20
    const bX = cardX + cardW - 16 - bW, bY = cardY + 14
    ctx.save()
    drawRoundedRect(ctx, bX, bY, bW, bH, 10)
    const pg = ctx.createLinearGradient(bX, bY, bX + bW, bY + bH)
    pg.addColorStop(0, PRO_GOLD_LIGHT); pg.addColorStop(1, PRO_GOLD)
    ctx.fillStyle = pg; ctx.fill()
    ctx.fillStyle = '#78350f'; ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('PRO', bX + bW / 2, bY + bH / 2)
    ctx.restore()
  }

  // 左下角日期 + 餐次 Tag
  const dateInfo   = getRecordDateInfo(record.record_time)
  const mealName   = MEAL_NAMES[record.meal_type] || '记录'
  const padX       = cardX + 24
  const padYBottom = currentY + imgH - 24

  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
  ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 32px sans-serif'
  ctx.fillText(dateInfo.day, padX, padYBottom)
  const dayW = ctx.measureText(dateInfo.day).width
  ctx.font = '16px sans-serif'
  ctx.fillText(` ${dateInfo.month}.`, padX + dayW, padYBottom - 4)

  ctx.font = 'bold 13px sans-serif'
  const tagW = ctx.measureText(mealName).width + 16
  const tagH = 26
  ctx.save()
  drawRoundedRect(ctx, padX, padYBottom - imgH + 40, tagW, tagH, 13)
  ctx.fillStyle = isPro ? 'rgba(245,158,11,0.85)' : 'rgba(255,255,255,0.75)'
  ctx.fill()
  ctx.fillStyle = isPro ? '#78350f' : '#0f172a'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(mealName, padX + tagW / 2, padYBottom - imgH + 40 + tagH / 2)
  ctx.restore()

  currentY += imgH + 24

  // ── 4. 热量 + P/C/F ──────────────────────────────────────
  const cal = Math.round(record.total_calories ?? 0)
  const p   = Math.round(record.total_protein  ?? 0)
  const c   = Math.round(record.total_carbs    ?? 0)
  const f   = Math.round(record.total_fat      ?? 0)
  const macrosX = cardX + cardW - 24

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  if (isPro) {
    // Pro：卡路里数字用金色渐变
    const cg = ctx.createLinearGradient(padX, currentY, padX + 130, currentY + 40)
    cg.addColorStop(0, PRO_GOLD_LIGHT); cg.addColorStop(1, PRO_GOLD)
    ctx.fillStyle = cg
  } else {
    ctx.fillStyle = TEXT_MAIN
  }
  ctx.font = 'bold 44px sans-serif'
  ctx.fillText(String(cal), padX, currentY + 32)
  const calW = ctx.measureText(String(cal)).width
  ctx.fillStyle = TEXT_LIGHT; ctx.font = '14px sans-serif'
  ctx.fillText('kcal', padX + calW + 4, currentY + 30)

  // P / C / F（右侧）
  ctx.textAlign = 'right'
  const macroRow: [number, string, string][] = [
    [p, '蛋 ', BRAND_GREEN],
    [c, '碳 ', '#f59e0b'],
    [f, '脂 ', '#f97316'],
  ]
  const offsets = [0, 56, 112]
  for (let i = 0; i < 3; i++) {
    const [val, label, color] = macroRow[i]
    ctx.fillStyle = color; ctx.font = 'bold 16px sans-serif'
    const txt = `${val}g`
    ctx.fillText(txt, macrosX - offsets[i], currentY + 30)
    const tw = ctx.measureText(txt).width
    ctx.fillStyle = TEXT_LIGHT; ctx.font = '12px sans-serif'
    ctx.fillText(label, macrosX - offsets[i] - tw - 2, currentY + 30)
  }
  currentY += 56

  // ── 5. Pro: PFC 堆叠图表 ─────────────────────────────────
  if (isPro) {
    drawPFCBar(ctx, p, c, f, padX, currentY, cardW - 48)
    currentY += 36
  }

  // ── 6. 分割线 ─────────────────────────────────────────────
  ctx.beginPath()
  ctx.moveTo(padX, currentY); ctx.lineTo(cardX + cardW - 24, currentY)
  ctx.strokeStyle = DIVIDER_COLOR; ctx.lineWidth = 1; ctx.stroke()
  currentY += 24

  // ── 7. 食物列表（Pro 和标准均使用文字描述） ───────────────
  {
    const items   = record.items || []
    const maxItems = 4
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    for (let i = 0; i < Math.min(items.length, maxItems); i++) {
      const item = items[i]
      ctx.fillStyle = TEXT_MAIN; ctx.font = '15px sans-serif'
      ctx.fillText(item.name.length > 8 ? item.name.slice(0, 8) + '...' : item.name, padX, currentY)
      const ratio   = (item.ratio ?? 100) / 100
      const itemCal = Math.round((item.nutrients?.calories ?? 0) * ratio)
      ctx.textAlign = 'right'; ctx.fillStyle = TEXT_SECONDARY; ctx.font = '13px sans-serif'
      ctx.fillText(`${item.intake ?? 0}g  |  ${itemCal} kcal`, macrosX, currentY)
      ctx.textAlign = 'left'
      currentY += 30
    }
    if (items.length > maxItems) {
      ctx.fillStyle = TEXT_LIGHT; ctx.font = '13px sans-serif'
      ctx.fillText(`...还有 ${items.length - maxItems} 项食物`, padX, currentY - 6)
      currentY += 20
    }
    if (items.length <= 2) currentY += 20
  }

  // ── 8. AI 评语 ────────────────────────────────────────────
  if (record.insight) {
    currentY += 10
    const boxX = padX, boxY = currentY, boxW = cardW - 48
    ctx.save()
    drawRoundedRect(ctx, boxX, boxY, boxW, 70, 12)
    ctx.fillStyle = isPro ? 'rgba(245,158,11,0.06)' : 'rgba(0,188,125,0.06)'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = isPro ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.5)'
    ctx.stroke()
    ctx.fillStyle = isPro ? PRO_GOLD : BRAND_GREEN
    ctx.font = 'italic bold 28px serif'; ctx.textBaseline = 'alphabetic'
    ctx.fillText('"', boxX + 12, boxY + 30)
    ctx.fillStyle = isPro ? '#92400e' : '#047857'
    ctx.font = '13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    wrapText(ctx, record.insight, boxX + 34, boxY + 16, boxW - 50, 20, 2)
    currentY += 96
    ctx.restore()
  } else { currentY += 30 }

  // ── 9. 额外 AI 信息块 ─────────────────────────────────────
  const drawBlock = (title: string, text: string, maxLines: number) => {
    currentY += 10
    ctx.fillStyle = isPro ? PRO_GOLD : '#0cab79'
    ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(title, padX, currentY); currentY += 24
    ctx.fillStyle = TEXT_SECONDARY; ctx.font = '13px sans-serif'
    currentY = wrapText(ctx, text, padX, currentY, cardW - 48, 20, maxLines) + 16
  }
  ctx.save()
  if (record.description)      drawBlock('识别描述', record.description, 3)
  if (record.pfc_ratio_comment) drawBlock('PFC 比例分析', record.pfc_ratio_comment, 4)
  if (record.absorption_notes)  drawBlock('吸收与利用', record.absorption_notes, 4)
  if (record.context_advice)    drawBlock('情境建议', record.context_advice, 4)
  ctx.restore()

  // ── 10. Footer ────────────────────────────────────────────
  const footerY = cardY + cardH - 84
  const titleX  = sharerAvatarImage ? padX + 22 + 10 : padX
  const avatarSz = 22

  if (sharerAvatarImage) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(padX + avatarSz / 2, footerY - 2 + avatarSz / 2, avatarSz / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(sharerAvatarImage as CanvasImageSource, padX, footerY - 2, avatarSz, avatarSz)
    ctx.restore()
  }

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = TEXT_MAIN; ctx.font = 'bold 15px sans-serif'
  const displayName = (sharerNickname || '').trim()
  const nameText = displayName ? `${displayName} 的饮食分享` : '智健食探'
  ctx.fillText(nameText, titleX, footerY + 14)

  // Pro: 昵称后面的小 PRO 标签
  if (isPro) {
    const nameW = ctx.measureText(nameText).width
    const tX = titleX + nameW + 6, tY = footerY + 3
    ctx.save()
    drawRoundedRect(ctx, tX, tY, 30, 14, 7)
    const tg = ctx.createLinearGradient(tX, tY, tX + 30, tY + 14)
    tg.addColorStop(0, PRO_GOLD_LIGHT); tg.addColorStop(1, PRO_GOLD)
    ctx.fillStyle = tg; ctx.fill()
    ctx.fillStyle = '#78350f'; ctx.font = 'bold 9px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('PRO', tX + 15, tY + 7)
    ctx.restore()
  }

  ctx.fillStyle = TEXT_LIGHT; ctx.font = '10px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillText('扫码登录食探，可一键成为好友', titleX, footerY + 32)

  // QR Code
  const qrSize = 80, qrX = cardX + cardW - 24 - qrSize, qrY = footerY - 24
  if (qrCodeImage) {
    if (isPro) {
      // Pro QR 加金框
      ctx.save()
      drawRoundedRect(ctx, qrX - 3, qrY - 3, qrSize + 6, qrSize + 6, 10)
      ctx.strokeStyle = PRO_GOLD; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.restore()
    }
    ctx.drawImage(qrCodeImage as CanvasImageSource, qrX, qrY, qrSize, qrSize)
  } else {
    drawRoundedRect(ctx, qrX, qrY, qrSize, qrSize, 8)
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill()
    ctx.fillStyle = TEXT_LIGHT; ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('去记录', qrX + qrSize / 2, qrY + qrSize / 2)
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number,
  maxWidth: number, lineHeight: number, maxLines: number
): number {
  const chars = text.split('')
  let line = '', lines = 0
  for (let i = 0; i < chars.length && lines < maxLines; i++) {
    const test = line + chars[i]
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      if (lines === maxLines - 1 && i < chars.length - 1) {
        ctx.fillText(line.slice(0, -1) + '...', x, y); return y + lineHeight
      }
      ctx.fillText(line, x, y); y += lineHeight; line = chars[i]; lines++
    } else { line = test }
  }
  if (line && lines < maxLines) { ctx.fillText(line, x, y); y += lineHeight }
  return y
}

export type { FoodRecord }
