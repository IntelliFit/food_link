/**
 * 识别记录海报绘制工具
 * 按《用户端升级方案》5.2：分享卡片需足够美观
 * V4 设计：参考用户提供的森系/Ins风格图 (Sage Green)
 * - 背景：灰绿色 (#9EBCA0)
 * - 图片：圆形 + 白边
 * - 文字：居中，白色，手写风(尽量模拟)
 * - 数据：分割线 + 左右布局
 * - 底部：Logo + 二维码
 */
import type { FoodRecord } from './api'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

function getRecordDateInfo(recordTime: string) {
  try {
    const d = new Date(recordTime)
    return {
      day: String(d.getDate()),
      month: MONTH_NAMES[d.getMonth()] || 'Jan',
      year: String(d.getFullYear()),
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
  } catch {
    return { day: '--', month: '--', year: '--', time: '--' }
  }
}

/** 海报尺寸 */
export const POSTER_WIDTH = 375
export const POSTER_HEIGHT = 812

export function computePosterHeight(
  ctx: CanvasRenderingContext2D,
  record: FoodRecord,
  width: number = POSTER_WIDTH
): number {
  let currentY = 30 // cardY
  currentY += 260 // imgH
  currentY += 24 // date padding
  currentY += 56 // macros
  currentY += 24 // divider

  const items = record.items || []
  const maxItems = 4
  currentY += Math.min(items.length, maxItems) * 30
  if (items.length > maxItems) currentY += 20
  if (items.length <= 2) currentY += 20

  if (record.insight) {
    currentY += 10 + 96
  } else {
    currentY += 30
  }

  const cardW = width - 40
  const boxW = cardW - 48

  ctx.save()
  ctx.font = '13px sans-serif'
  const measureLines = (text: string, maxW: number) => {
    const chars = text.split('')
    let line = ''
    let lines = 1
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i]
      if (ctx.measureText(test).width > maxW && line.length > 0) {
        lines++
        line = chars[i]
      } else {
        line = test
      }
    }
    return lines
  }

  const addBlock = (text: string, maxLines: number) => {
    currentY += 10
    currentY += 24 // title
    const lines = Math.min(measureLines(text, boxW), maxLines)
    currentY += lines * 20
    currentY += 16
  }

  if (record.description) addBlock(record.description, 3)
  if (record.pfc_ratio_comment) addBlock(record.pfc_ratio_comment, 4)
  if (record.absorption_notes) addBlock(record.absorption_notes, 4)
  if (record.context_advice) addBlock(record.context_advice, 4)
  ctx.restore()

  return Math.max(currentY + 180, POSTER_HEIGHT)
}

export interface PosterDrawOptions {
  width: number
  height: number
  record: FoodRecord
  image: { width: number; height: number } | null
  qrCodeImage?: { width: number; height: number } | null
}

// 风格配色
const CARD_BG = 'rgba(255, 255, 255, 0.82)' // 毛玻璃半透明背景
const TEXT_MAIN = '#1e293b'
const TEXT_SECONDARY = '#64748b'
const TEXT_LIGHT = '#94a3b8'
const DIVIDER_COLOR = '#f1f5f9'
const BRAND_GREEN = '#00bc7d'

/** 绘制圆角矩形辅助函数 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | { tl: number; tr: number; br: number; bl: number }
) {
  let tl = 0, tr = 0, br = 0, bl = 0;
  if (typeof radius === 'number') {
    tl = tr = br = bl = radius;
  } else {
    tl = radius.tl || 0;
    tr = radius.tr || 0;
    br = radius.br || 0;
    bl = radius.bl || 0;
  }
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + width - tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + tr);
  ctx.lineTo(x + width, y + height - br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - br, y + height);
  ctx.lineTo(x + bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}


export function drawRecordPoster(
  ctx: CanvasRenderingContext2D,
  options: PosterDrawOptions
): void {
  const { width: W, height: H, record, image, qrCodeImage } = options

  // 1. 底层背景：更浅的颜色，加上光晕效果（毛玻璃的背景）
  const bgGradient = ctx.createLinearGradient(0, 0, W, H)
  bgGradient.addColorStop(0, '#e6fffa')
  bgGradient.addColorStop(1, '#f1f8e9')
  ctx.fillStyle = bgGradient
  ctx.fillRect(0, 0, W, H)

  // 背景装饰色块1 (浅绿)
  const blob1 = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, 200)
  blob1.addColorStop(0, 'rgba(0, 188, 125, 0.15)')
  blob1.addColorStop(1, 'rgba(0, 188, 125, 0)')
  ctx.fillStyle = blob1
  ctx.fillRect(0, 0, W, H)

  // 背景装饰色块2 (偏淡蓝)
  const blob2 = ctx.createRadialGradient(W * 0.1, H * 0.8, 0, W * 0.1, H * 0.8, 250)
  blob2.addColorStop(0, 'rgba(56, 189, 248, 0.1)')
  blob2.addColorStop(1, 'rgba(56, 189, 248, 0)')
  ctx.fillStyle = blob2
  ctx.fillRect(0, 0, W, H)


  // 2. 主卡片参数
  const cardMargin = 20
  const cardX = cardMargin
  const cardY = 30
  const cardW = W - cardMargin * 2
  const cardH = H - 60
  const cardRadius = 24

  // 绘制卡片底色 & 阴影（毛玻璃效果）
  ctx.save()
  // 加深阴影以突出晶莹剔透感
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)'
  ctx.shadowBlur = 32
  ctx.shadowOffsetY = 12

  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, cardRadius)
  ctx.fillStyle = CARD_BG
  ctx.fill()

  // 卡片内发光边缘（玻璃反光效果）
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.stroke()
  ctx.restore() // 清除阴影属性，避免影响后续绘制

  let currentY = cardY

  // 3. 顶部主图区域
  const imgH = 260
  ctx.save()
  // 裁剪主图区域（仅上圆角）
  drawRoundedRect(ctx, cardX, currentY, cardW, imgH, { tl: cardRadius, tr: cardRadius, br: 0, bl: 0 })
  ctx.clip()

  if (image && image.width && image.height) {
    const sw = image.width
    const sh = image.height
    const scale = Math.max(cardW / sw, imgH / sh)
    const dw = sw * scale
    const dh = sh * scale
    const dx = cardX - (dw - cardW) / 2
    const dy = currentY - (dh - imgH) / 2
    ctx.drawImage(image as CanvasImageSource, 0, 0, sw, sh, dx, dy, dw, dh)
  } else {
    ctx.fillStyle = '#E5E7EB'
    ctx.fillRect(cardX, currentY, cardW, imgH)
    ctx.fillStyle = '#9CA3AF'
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No Image', cardX + cardW / 2, currentY + imgH / 2)
  }
  ctx.restore()

  // 在图片上叠加一层半透明渐变，让底部文字清晰
  const imgGradient = ctx.createLinearGradient(0, currentY + imgH * 0.6, 0, currentY + imgH)
  imgGradient.addColorStop(0, 'rgba(0,0,0,0)')
  imgGradient.addColorStop(1, 'rgba(0,0,0,0.6)')
  ctx.fillStyle = imgGradient
  ctx.fillRect(cardX, currentY + imgH * 0.5, cardW, imgH * 0.5)

  // 在图片左下角绘制时间、餐次
  const dateInfo = getRecordDateInfo(record.record_time)
  const mealName = MEAL_NAMES[record.meal_type] || '记录'

  const textPaddingX = cardX + 24
  const textPaddingY = currentY + imgH - 24

  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'

  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 32px sans-serif'
  ctx.fillText(dateInfo.day, textPaddingX, textPaddingY)

  const dayWidth = ctx.measureText(dateInfo.day).width
  ctx.font = '16px sans-serif'
  ctx.fillText(` ${dateInfo.month}.`, textPaddingX + dayWidth, textPaddingY - 4)

  // 餐次 Tag
  ctx.font = 'bold 16px sans-serif'
  const tagW = ctx.measureText(mealName).width + 16
  const tagH = 26

  ctx.save()
  drawRoundedRect(ctx, textPaddingX, textPaddingY - imgH + 40, tagW, tagH, 13) // 左上角Tag
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)' // 降低透明度，更显眼
  ctx.fill()

  ctx.fillStyle = '#0f172a' // 降低透明度后文字改成深色以保持对比度
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 13px sans-serif'
  ctx.fillText(mealName, textPaddingX + tagW / 2, textPaddingY - imgH + 40 + tagH / 2)
  ctx.restore()

  currentY += imgH + 24

  // 4. 营养数据总览
  const cal = Math.round((record.total_calories ?? 0))
  const p = Math.round(record.total_protein ?? 0)
  const c = Math.round(record.total_carbs ?? 0)
  const f = Math.round(record.total_fat ?? 0)

  // Calories
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic' // 恢复默认基线，方便排版

  ctx.fillStyle = TEXT_MAIN
  ctx.font = 'bold 44px sans-serif'
  ctx.fillText(String(cal), textPaddingX, currentY + 32)

  const calW = ctx.measureText(String(cal)).width
  ctx.fillStyle = TEXT_LIGHT
  ctx.font = '14px sans-serif'
  ctx.fillText('kcal', textPaddingX + calW + 4, currentY + 30)

  // Macros (P C F) - 放在右侧
  const macrosX = cardX + cardW - 24
  ctx.textAlign = 'right'

  // F
  ctx.fillStyle = '#FF9F43'
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText(`${f}g`, macrosX, currentY + 30)
  const fW = ctx.measureText(`${f}g`).width
  ctx.fillStyle = TEXT_LIGHT
  ctx.font = '12px sans-serif'
  ctx.fillText('脂 ', macrosX - fW - 2, currentY + 30)

  // C
  ctx.fillStyle = '#E1A25B'
  ctx.font = 'bold 16px sans-serif'
  const cText = `${c}g`
  ctx.fillText(cText, macrosX - 52, currentY + 30)
  const cW = ctx.measureText(cText).width
  ctx.fillStyle = TEXT_LIGHT
  ctx.font = '12px sans-serif'
  ctx.fillText('碳 ', macrosX - 52 - cW - 2, currentY + 30)

  // P
  ctx.fillStyle = BRAND_GREEN
  ctx.font = 'bold 16px sans-serif'
  const pText = `${p}g`
  ctx.fillText(pText, macrosX - 108, currentY + 30)
  const pW = ctx.measureText(pText).width
  ctx.fillStyle = TEXT_LIGHT
  ctx.font = '12px sans-serif'
  ctx.fillText('蛋 ', macrosX - 108 - pW - 2, currentY + 30)

  currentY += 56

  // 5. 分割线
  ctx.beginPath()
  ctx.moveTo(textPaddingX, currentY)
  ctx.lineTo(cardX + cardW - 24, currentY)
  ctx.strokeStyle = DIVIDER_COLOR
  ctx.lineWidth = 1
  ctx.stroke()

  currentY += 24

  // 6. 食物明细列表 (最多显示4个，超出的显示提示)
  const items = record.items || []
  const maxItems = 4
  ctx.textAlign = 'left'

  for (let i = 0; i < Math.min(items.length, maxItems); i++) {
    const item = items[i]
    // 左侧：名称
    ctx.fillStyle = TEXT_MAIN
    ctx.font = '15px sans-serif'
    ctx.fillText(item.name.length > 8 ? item.name.slice(0, 8) + '...' : item.name, textPaddingX, currentY)

    // 右侧：重量和热量
    const ratio = (item.ratio ?? 100) / 100
    const itemCal = Math.round((item.nutrients?.calories ?? 0) * ratio)

    ctx.textAlign = 'right'
    ctx.fillStyle = TEXT_SECONDARY
    ctx.font = '13px sans-serif'
    ctx.fillText(`${item.intake ?? 0}g  |  ${itemCal} kcal`, macrosX, currentY)

    ctx.textAlign = 'left'
    currentY += 30
  }

  if (items.length > maxItems) {
    ctx.fillStyle = TEXT_LIGHT
    ctx.font = '13px sans-serif'
    ctx.fillText(`...还有 ${items.length - maxItems} 项食物`, textPaddingX, currentY - 6)
    currentY += 20
  }

  // 如果食物比较少，留点空隙
  if (items.length <= 2) {
    currentY += 20
  }

  // 7. AI 评语 (Insight Box)
  if (record.insight) {
    currentY += 10

    const insightBoxX = textPaddingX
    const insightBoxY = currentY
    const insightBoxW = cardW - 48

    ctx.save()
    // AI 建议框也稍微增加通透感
    drawRoundedRect(ctx, insightBoxX, insightBoxY, insightBoxW, 70, 12)
    ctx.fillStyle = 'rgba(0, 188, 125, 0.06)' // 淡淡的一层绿
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.stroke()

    // 引号装饰
    ctx.fillStyle = '#00bc7d'
    ctx.font = 'italic bold 28px serif'
    ctx.fillText('“', insightBoxX + 12, insightBoxY + 30)

    // 文本内容
    ctx.fillStyle = '#047857' // 小程序目标tag的深绿色
    ctx.font = '13px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top' // wrapText以top为基准好算

    // 简单截断处理
    const text = record.insight
    wrapText(ctx, text, insightBoxX + 34, insightBoxY + 16, insightBoxW - 50, 20, 2)
    currentY += 96
    ctx.restore()
  } else {
    currentY += 30
  }

  // 追加记录额外信息
  const drawBlock = (title: string, text: string, maxLines: number) => {
    currentY += 10
    ctx.fillStyle = '#0cab79ff' // 稍暗一些的绿色，避免过于刺眼
    ctx.font = 'bold 15px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(title, textPaddingX, currentY)
    currentY += 24

    ctx.fillStyle = TEXT_SECONDARY
    ctx.font = '13px sans-serif'
    const newY = wrapText(ctx, text, textPaddingX, currentY, cardW - 48, 20, maxLines)
    currentY = newY + 16
  }

  ctx.save()
  if (record.description) drawBlock('识别描述', record.description, 3)
  if (record.pfc_ratio_comment) drawBlock('PFC 比例分析', record.pfc_ratio_comment, 4)
  if (record.absorption_notes) drawBlock('吸收与利用', record.absorption_notes, 4)
  if (record.context_advice) drawBlock('情境建议', record.context_advice, 4)
  ctx.restore()

  // 8. 底部 Footer (Logo & QR & App Name)
  // 放在最后面了
  const footerY = cardY + cardH - 84

  // Left: Title
  const textStartX = textPaddingX

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = TEXT_MAIN
  ctx.font = 'bold 15px sans-serif'
  ctx.fillText('智健食探', textStartX, footerY + 14)

  ctx.fillStyle = TEXT_LIGHT
  ctx.font = '10px sans-serif'
  ctx.fillText('你的智能健康管理助手', textStartX, footerY + 32)

  // Right: QR Code
  const qrSize = 80
  const qrX = cardX + cardW - 24 - qrSize
  const qrY = footerY - 24

  if (qrCodeImage) {
    ctx.drawImage(qrCodeImage as CanvasImageSource, qrX, qrY, qrSize, qrSize)
  } else {
    // 画一个模拟的圆角二维码框，同样用半透明
    drawRoundedRect(ctx, qrX, qrY, qrSize, qrSize, 8)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.fill()

    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('去记录', qrX + qrSize / 2, qrY + qrSize / 2)
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const chars = text.split('')
  let line = ''
  let lines = 0
  for (let i = 0; i < chars.length && lines < maxLines; i++) {
    const test = line + chars[i]
    const m = ctx.measureText(test)
    if (m.width > maxWidth && line.length > 0) {
      if (lines === maxLines - 1 && i < chars.length - 1) {
        // Last line, add ellipsis
        ctx.fillText(line.slice(0, -1) + '...', x, y)
        return y + lineHeight
      } else {
        ctx.fillText(line, x, y)
        y += lineHeight
        line = chars[i]
        lines++
      }
    } else {
      line = test
    }
  }
  if (line && lines < maxLines) {
    ctx.fillText(line, x, y)
    y += lineHeight
  }
  return y
}

export type { FoodRecord }
