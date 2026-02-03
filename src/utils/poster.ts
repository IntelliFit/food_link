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
export const POSTER_HEIGHT = 750

export interface PosterDrawOptions {
  width: number
  height: number
  record: FoodRecord
  image: { width: number; height: number } | null
  logoImage?: { width: number; height: number } | null
  qrCodeImage?: { width: number; height: number } | null
}

// 风格配色
const THEME_BG = '#97B498' // 森系灰绿 (Sage Green)
const TEXT_WHITE = '#FFFFFF'
const DIVIDER_COLOR = 'rgba(255, 255, 255, 0.4)'

export function drawRecordPoster(
  ctx: CanvasRenderingContext2D,
  options: PosterDrawOptions
): void {
  const { width: W, height: H, record, image, logoImage, qrCodeImage } = options

  // 1. 背景
  ctx.fillStyle = THEME_BG
  ctx.fillRect(0, 0, W, H)

  // 增加一点噪点或纹理感？Canvas 2d 比较难做，用微弱的渐变增加质感
  const gradient = ctx.createLinearGradient(0, 0, 0, H)
  gradient.addColorStop(0, '#9EBCA0')
  gradient.addColorStop(1, '#8FA892')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, W, H)

  const centerX = W / 2
  let y = 60

  // 2. 圆形主图 (Circle Image with White Ring)
  const circleSize = 240
  const radius = circleSize / 2
  const circleX = centerX
  const circleY = y + radius

  // 外圈白环（带一点透明度让它柔和，或者纯白）
  ctx.beginPath()
  ctx.arc(circleX, circleY, radius + 6, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)' // 半透明外晕
  ctx.fill()
  
  ctx.beginPath()
  ctx.arc(circleX, circleY, radius + 2, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF' // 纯白描边
  ctx.fill()

  ctx.save()
  ctx.beginPath()
  ctx.arc(circleX, circleY, radius, 0, Math.PI * 2)
  ctx.clip()

  if (image && image.width && image.height) {
    const sw = image.width
    const sh = image.height
    // cover 模式裁剪
    const scale = Math.max(circleSize / sw, circleSize / sh)
    const dw = sw * scale
    const dh = sh * scale
    const dx = circleX - dw / 2
    const dy = circleY - dh / 2
    ctx.drawImage(image as CanvasImageSource, 0, 0, sw, sh, dx, dy, dw, dh)
  } else {
    ctx.fillStyle = '#E5E7EB'
    ctx.fillRect(circleX - radius, circleY - radius, circleSize, circleSize)
    ctx.fillStyle = '#9CA3AF'
    ctx.font = '20px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No Image', circleX, circleY)
  }
  ctx.restore()

  y += circleSize + 50

  // 3. 居中文字 (Handwritten Vibe)
  const dateInfo = getRecordDateInfo(record.record_time)
  const mealName = MEAL_NAMES[record.meal_type] || '饮食记录'

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  
  // 第一行：我在 Food Link 记录
  ctx.fillStyle = TEXT_WHITE
  ctx.font = 'italic 18px sans-serif' // 尝试 italic 模拟手写感
  ctx.fillText('我在 Food Link 坚持健康饮食', centerX, y)
  
  y += 36
  
  // 第二行：日期 / 餐次 (Big Title)
  // 参考图是 "第 365 天"，这里用 "2月3日 · 早餐"
  const titleText = `${dateInfo.month} ${dateInfo.day} · ${mealName}`
  ctx.font = 'bold 32px sans-serif'
  ctx.fillText(titleText, centerX, y)
  
  y += 60

  // 4. 分割线
  ctx.strokeStyle = DIVIDER_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(40, y)
  ctx.lineTo(W - 40, y)
  ctx.stroke()
  
  y += 30

  // 5. 数据展示 (Two Columns)
  // 左侧：热量
  const colY = y
  const leftX = W * 0.35
  const rightX = W * 0.65
  
  // Left: Calories Icon & Value
  // 画一个叶子图标 (简化为圆)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.beginPath()
  ctx.arc(leftX - 30, colY + 16, 16, 0, Math.PI * 2)
  ctx.fill()
  // 叶子芯
  ctx.fillStyle = TEXT_WHITE
  ctx.beginPath()
  ctx.ellipse(leftX - 30, colY + 16, 6, 10, Math.PI / 4, 0, Math.PI * 2)
  ctx.fill()

  const cal = Math.round((record.total_calories ?? 0))
  ctx.textAlign = 'left'
  ctx.fillStyle = TEXT_WHITE
  ctx.font = 'bold 36px sans-serif'
  ctx.fillText(String(cal), leftX - 6, colY - 6)
  
  ctx.font = '12px sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.fillText('本餐热量 (kcal)', leftX - 6, colY + 36)

  // Right: Macros Summary
  // 画一个对号图标 (简化为圆)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.beginPath()
  ctx.arc(rightX - 20, colY + 16, 12, 0, Math.PI * 2)
  ctx.fill()
  // 对号
  ctx.strokeStyle = TEXT_WHITE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(rightX - 26, colY + 16)
  ctx.lineTo(rightX - 22, colY + 20)
  ctx.lineTo(rightX - 14, colY + 12)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.font = '12px sans-serif'
  ctx.fillText('营养摄入', rightX + 4, colY + 2)
  
  const p = Math.round(record.total_protein ?? 0)
  const c = Math.round(record.total_carbs ?? 0)
  const f = Math.round(record.total_fat ?? 0)
  ctx.font = 'bold 16px sans-serif'
  ctx.fillStyle = TEXT_WHITE
  ctx.fillText(`P${p} C${c} F${f}`, rightX + 4, colY + 24)

  y += 100

  // 6. 底部 Footer (Logo & QR)
  // 参考图底部是 "没旁健康..." + 角标
  // 这里放 Logo + Slogan + QR
  
  // 底部文字 Slogan
  const tagline = record.insight || '记录健康，分享美味'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.font = 'italic 14px sans-serif'
  wrapText(ctx, tagline, centerX, y, W - 60, 20, 2)
  
  // Logo & QR at very bottom
  const footerY = H - 80
  const qrSize = 60
  
  // 居中放置 Logo 和 QR，或者左右分开放
  // 既然是 Ins 风，通常 Logo 居中，或者 QR 居中。
  // 尝试：Logo 在左下，QR 在右下
  
  const logoSize = 40
  const paddingX = 40
  
  // Left: Logo + App Name
  ctx.save()
  if (logoImage) {
    ctx.beginPath()
    ctx.arc(paddingX + logoSize / 2, footerY + logoSize / 2, logoSize / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(logoImage as CanvasImageSource, paddingX, footerY, logoSize, logoSize)
  }
  ctx.restore()
  
  ctx.textAlign = 'left'
  ctx.fillStyle = TEXT_WHITE
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText('Food Link', paddingX + logoSize + 12, footerY + 4)
  ctx.font = '10px sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fillText('Your AI Nutritionist', paddingX + logoSize + 12, footerY + 24)

  // Right: QR Code
  if (qrCodeImage) {
    // 画一个白色底框给二维码，防止背景色干扰扫描
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(W - paddingX - qrSize - 4, footerY - 4, qrSize + 8, qrSize + 8)
    ctx.drawImage(qrCodeImage as CanvasImageSource, W - paddingX - qrSize, footerY, qrSize, qrSize)
  } else {
    // Placeholder
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.fillRect(W - paddingX - qrSize, footerY, qrSize, qrSize)
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
): void {
  const chars = text.split('')
  let line = ''
  let lines = 0
  for (let i = 0; i < chars.length && lines < maxLines; i++) {
    const test = line + chars[i]
    const m = ctx.measureText(test)
    if (m.width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, y)
      y += lineHeight
      line = chars[i]
      lines++
    } else {
      line = test
    }
  }
  if (line && lines < maxLines) {
    ctx.fillText(line, x, y)
  }
}

export type { FoodRecord }
