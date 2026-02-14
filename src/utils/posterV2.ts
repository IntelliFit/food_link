/**
 * Smart Poster System V2 — 千人千面智能分享海报
 *
 * 设计理念：
 *   不同人分享的动机不同 —— 健身男要秀蛋白质，减脂女要秀自律天数，
 *   吃货要秀美食本身，健康派要秀均衡指标。
 *   系统根据「用户画像 + 本餐数据」自动选择最能激发分享欲的模板与内容。
 *
 * 4 套模板：
 *   Power  (健身达人) — 暗色科技风，大字卡路里，三宏量柱状条
 *   Bloom  (轻食自律) — 奶茶暖色调，强调打卡天数，优雅圆形照片
 *   Fresh  (均衡健康) — 森系灰绿，PFC 彩条，健康建议突出
 *   Gourmet(美食分享) — 深色质感，大图主导，极简营养行
 */
import type { FoodRecord } from './api'

// ===================== 常量 =====================
export const POSTER_WIDTH = 375
export const POSTER_HEIGHT = 750

// ===================== 类型 =====================
export type PosterPersona = 'fitness' | 'slim' | 'balanced' | 'foodie'

export interface PosterUserContext {
  nickname?: string
  gender?: string
  activity_level?: string
  diet_goal?: string
  tdee?: number
}

export interface PosterStatsContext {
  streak_days?: number
  today_calories?: number
  target_calories?: number
}

type ImgLike = { width: number; height: number }

export interface SmartPosterOptions {
  width: number
  height: number
  record: FoodRecord
  image: ImgLike | null
  logoImage?: ImgLike | null
  qrCodeImage?: ImgLike | null
  userContext?: PosterUserContext
  statsContext?: PosterStatsContext
  forcePersona?: PosterPersona
}

// ===================== 主题配色 =====================
interface ThemeColors {
  bg1: string; bg2: string
  accent: string
  text1: string; text2: string; text3: string
  divider: string; cardBg: string
  pColor: string; cColor: string; fColor: string
}

const THEMES: Record<PosterPersona, ThemeColors> = {
  fitness: {
    bg1: '#0f0c29', bg2: '#302b63',
    accent: '#00d4ff',
    text1: '#FFFFFF', text2: 'rgba(255,255,255,0.80)', text3: 'rgba(255,255,255,0.45)',
    divider: 'rgba(255,255,255,0.10)', cardBg: 'rgba(255,255,255,0.06)',
    pColor: '#00d4ff', cColor: '#ffd700', fColor: '#ff6b6b',
  },
  slim: {
    bg1: '#fef9f4', bg2: '#f3e4d4',
    accent: '#c97b5a',
    text1: '#4a3728', text2: '#7a6352', text3: '#b8a08a',
    divider: 'rgba(74,55,40,0.12)', cardBg: 'rgba(255,255,255,0.55)',
    pColor: '#c97b5a', cColor: '#c4a882', fColor: '#e0c8a8',
  },
  balanced: {
    bg1: '#a8c5aa', bg2: '#87a889',
    accent: '#FFFFFF',
    text1: '#FFFFFF', text2: 'rgba(255,255,255,0.88)', text3: 'rgba(255,255,255,0.55)',
    divider: 'rgba(255,255,255,0.28)', cardBg: 'rgba(255,255,255,0.12)',
    pColor: '#FFD93D', cColor: '#6BCB77', fColor: '#FF6B6B',
  },
  foodie: {
    bg1: '#1a1a1a', bg2: '#2d2320',
    accent: '#e8b86d',
    text1: '#FFFFFF', text2: 'rgba(255,255,255,0.82)', text3: 'rgba(255,255,255,0.45)',
    divider: 'rgba(255,255,255,0.12)', cardBg: 'rgba(255,255,255,0.06)',
    pColor: '#e8b86d', cColor: '#c4a882', fColor: '#d4886b',
  },
}

/** 主题预览色（用于模板选择器 UI） */
export const THEME_PREVIEWS: Record<PosterPersona, { label: string; color: string; icon: string }> = {
  fitness:  { label: '力量',  color: '#302b63', icon: '💪' },
  slim:     { label: '轻食',  color: '#c97b5a', icon: '🌿' },
  balanced: { label: '均衡',  color: '#a8c5aa', icon: '🥗' },
  foodie:   { label: '美食',  color: '#2d2320', icon: '📸' },
}

// ===================== 人群画像检测 =====================
export function detectPersona(options: SmartPosterOptions): PosterPersona {
  if (options.forcePersona) return options.forcePersona
  const { record, userContext } = options
  const goal = (record as any).diet_goal || userContext?.diet_goal || ''
  const gender = userContext?.gender || ''
  const level = userContext?.activity_level || ''

  if (goal === 'muscle_gain') return 'fitness'
  if ((record as any).activity_timing === 'post_workout') return 'fitness'
  if (gender === 'male' && ['active', 'very_active'].includes(level)) return 'fitness'

  if (goal === 'fat_loss') return 'slim'
  if (gender === 'female' && ['sedentary', 'light'].includes(level)) return 'slim'

  return 'balanced'
}

// ===================== 动态文案 =====================
const MEAL_CN: Record<string, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐',
}
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(t: string) {
  try {
    const d = new Date(t)
    return {
      day: String(d.getDate()),
      month: MON[d.getMonth()] || 'Jan',
      year: String(d.getFullYear()),
    }
  } catch { return { day: '--', month: '--', year: '--' } }
}

function genTagline(p: PosterPersona, r: FoodRecord, s?: PosterStatsContext): string {
  const protein = Math.round(r.total_protein || 0)
  const cal = Math.round(r.total_calories || 0)
  const streak = s?.streak_days || 0
  switch (p) {
    case 'fitness':
      if (protein >= 30) return `蛋白质摄入 ${protein}g，持续突破`
      return '每一餐都是变强的基石'
    case 'slim':
      if (streak > 3) return `坚持第 ${streak} 天，遇见更好的自己`
      if (cal < 500) return '轻食也是一种生活态度'
      return '认真吃饭，好好生活'
    case 'foodie':
      return r.description || '这一餐，值得被记住'
    default:
      return r.insight || '均衡饮食，健康每一天'
  }
}

function genBadge(p: PosterPersona, r: FoodRecord, s?: PosterStatsContext): string | null {
  const protein = Math.round(r.total_protein || 0)
  const cal = Math.round(r.total_calories || 0)
  const streak = s?.streak_days || 0
  switch (p) {
    case 'fitness':
      if (protein >= 30) return `高蛋白 ${protein}g`
      return null
    case 'slim':
      if (cal > 0 && cal < 400) return '轻卡一餐'
      if (streak >= 7) return `连续 ${streak} 天`
      return null
    default:
      if (streak >= 3) return `连续 ${streak} 天`
      return null
  }
}

// ===================== Canvas 绘制工具 =====================
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function fillRR(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r)
  ctx.fill()
}

function coverDraw(ctx: CanvasRenderingContext2D, img: ImgLike, dx: number, dy: number, dw: number, dh: number) {
  const scale = Math.max(dw / img.width, dh / img.height)
  const nw = img.width * scale, nh = img.height * scale
  ctx.drawImage(img as CanvasImageSource, 0, 0, img.width, img.height, dx + (dw - nw) / 2, dy + (dh - nh) / 2, nw, nh)
}

function circleImg(ctx: CanvasRenderingContext2D, img: ImgLike | null, cx: number, cy: number, r: number, borderCol: string, bw = 3) {
  if (bw > 0) { ctx.beginPath(); ctx.arc(cx, cy, r + bw, 0, Math.PI * 2); ctx.fillStyle = borderCol; ctx.fill() }
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip()
  if (img) { coverDraw(ctx, img, cx - r, cy - r, r * 2, r * 2) }
  else { ctx.fillStyle = '#ddd'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2) }
  ctx.restore()
}

function rectImg(ctx: CanvasRenderingContext2D, img: ImgLike | null, x: number, y: number, w: number, h: number, r = 12) {
  ctx.save()
  roundRect(ctx, x, y, w, h, r); ctx.clip()
  if (img) { coverDraw(ctx, img, x, y, w, h) }
  else { ctx.fillStyle = '#ddd'; ctx.fillRect(x, y, w, h) }
  ctx.restore()
}

function bgGrad(ctx: CanvasRenderingContext2D, w: number, h: number, c1: string, c2: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, c1); g.addColorStop(1, c2)
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
}

function wrapTxt(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxL: number): number {
  const chars = text.split('')
  let line = '', lines = 0
  for (let i = 0; i < chars.length && lines < maxL; i++) {
    const test = line + chars[i]
    if (ctx.measureText(test).width > maxW && line.length > 0) {
      ctx.fillText(line, x, y); y += lh; line = chars[i]; lines++
    } else { line = test }
  }
  if (line && lines < maxL) { ctx.fillText(line, x, y); y += lh }
  return y
}

function drawDivider(ctx: CanvasRenderingContext2D, y: number, w: number, color: string, pad = 35) {
  ctx.strokeStyle = color; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke()
}

// 通用底部 Footer
function drawFooter(ctx: CanvasRenderingContext2D, w: number, h: number, t: ThemeColors, logo?: ImgLike | null, qr?: ImgLike | null) {
  const fy = h - 72, px = 32, ls = 34, qs = 52
  if (logo) {
    ctx.save()
    ctx.beginPath(); ctx.arc(px + ls / 2, fy + ls / 2, ls / 2, 0, Math.PI * 2); ctx.clip()
    ctx.drawImage(logo as CanvasImageSource, px, fy, ls, ls)
    ctx.restore()
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillStyle = t.text1; ctx.font = 'bold 13px sans-serif'
  ctx.fillText('Food Link', px + ls + 10, fy + 2)
  ctx.fillStyle = t.text3; ctx.font = '9px sans-serif'
  ctx.fillText('Your AI Nutritionist', px + ls + 10, fy + 20)
  if (qr) {
    ctx.fillStyle = '#FFFFFF'
    fillRR(ctx, w - px - qs - 3, fy - 3, qs + 6, qs + 6, 5)
    ctx.drawImage(qr as CanvasImageSource, w - px - qs, fy, qs, qs)
  } else {
    ctx.fillStyle = t.cardBg
    fillRR(ctx, w - px - qs, fy, qs, qs, 5)
    ctx.fillStyle = t.text3; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText('扫码体验', w - px - qs / 2, fy + qs / 2 - 4)
    ctx.textAlign = 'left'
  }
}

// 绘制三宏量信息行（通用）
function drawMacroRow(ctx: CanvasRenderingContext2D, y: number, w: number, r: FoodRecord, t: ThemeColors): number {
  const p = Math.round(r.total_protein || 0)
  const c = Math.round(r.total_carbs || 0)
  const f = Math.round(r.total_fat || 0)
  const total = p + c + f || 1
  const barX = 35, barW = w - 70, barH = 5

  // 堆叠彩条
  ctx.fillStyle = t.cardBg; fillRR(ctx, barX, y, barW, barH, 3)
  const pW = (p / total) * barW, cW = (c / total) * barW, fW = (f / total) * barW
  if (pW > 0) { ctx.fillStyle = t.pColor; fillRR(ctx, barX, y, Math.max(pW, barH), barH, 3) }
  if (cW > 0) { ctx.fillStyle = t.cColor; ctx.fillRect(barX + pW, y, cW, barH) }
  if (fW > 0) { ctx.fillStyle = t.fColor; fillRR(ctx, barX + pW + cW, y, Math.max(fW, barH), barH, 3) }
  y += barH + 14

  // 三列数字
  const cols = [
    { label: '蛋白质', val: `${p}g`, col: t.pColor },
    { label: '碳水',   val: `${c}g`, col: t.cColor },
    { label: '脂肪',   val: `${f}g`, col: t.fColor },
  ]
  const cw = (w - 70) / 3
  cols.forEach((m, i) => {
    const mx = 35 + cw * i + 14
    ctx.fillStyle = m.col; ctx.beginPath(); ctx.arc(mx, y + 7, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.textAlign = 'left'; ctx.fillStyle = t.text3; ctx.font = '10px sans-serif'
    ctx.fillText(m.label, mx + 8, y)
    ctx.fillStyle = t.text1; ctx.font = 'bold 15px sans-serif'
    ctx.fillText(m.val, mx + 8, y + 15)
  })
  return y + 42
}

// ===================== 模板 1：POWER（健身达人）=====================
function drawPower(ctx: CanvasRenderingContext2D, opt: SmartPosterOptions, t: ThemeColors) {
  const { width: W, height: H, record: r, image, logoImage, qrCodeImage, statsContext } = opt
  const cx = W / 2

  // 背景 + 微网格纹理
  bgGrad(ctx, W, H, t.bg1, t.bg2)
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 1
  for (let i = 0; i < W; i += 25) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke() }
  for (let i = 0; i < H; i += 25) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke() }

  let y = 26
  // 顶部品牌
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  ctx.fillStyle = t.text3; ctx.font = '9px sans-serif'
  ctx.fillText('F O O D   L I N K', cx, y)
  y += 26

  // 圆角矩形照片
  const phW = W - 56, phH = 175
  rectImg(ctx, image, 28, y, phW, phH, 14)
  y += phH + 24

  // 日期 · 餐次
  const di = fmtDate(r.record_time)
  const meal = MEAL_CN[r.meal_type] || '记录'
  ctx.fillStyle = t.text3; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(`${di.month} ${di.day}, ${di.year}  ·  ${meal}`, cx, y)
  y += 28

  // ★ 大字卡路里（光晕效果）
  const cal = Math.round(r.total_calories || 0)
  ctx.font = 'bold 68px sans-serif'; ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(0,212,255,0.12)'; ctx.fillText(String(cal), cx + 1, y + 1)
  ctx.fillStyle = t.text1; ctx.fillText(String(cal), cx, y)
  y += 68
  ctx.fillStyle = t.text3; ctx.font = '11px sans-serif'
  ctx.fillText('CALORIES', cx, y)
  y += 24

  drawDivider(ctx, y, W, t.divider); y += 16

  // 三宏量
  y = drawMacroRow(ctx, y, W, r, t)

  // 成就徽章
  const badge = genBadge('fitness', r, statsContext)
  if (badge) {
    ctx.textAlign = 'center'; ctx.font = 'bold 12px sans-serif'
    const bw = ctx.measureText(badge).width + 28
    ctx.fillStyle = 'rgba(0,212,255,0.10)'; fillRR(ctx, cx - bw / 2, y, bw, 28, 14)
    ctx.strokeStyle = 'rgba(0,212,255,0.25)'; ctx.lineWidth = 1
    roundRect(ctx, cx - bw / 2, y, bw, 28, 14); ctx.stroke()
    ctx.fillStyle = t.accent; ctx.fillText(badge, cx, y + 7)
    y += 40
  }

  // 连续天数
  const streak = statsContext?.streak_days || 0
  if (streak > 0) {
    ctx.textAlign = 'center'; ctx.fillStyle = t.text2; ctx.font = '12px sans-serif'
    ctx.fillText(`连续记录 ${streak} 天`, cx, y); y += 24
  }

  // 标语
  ctx.textAlign = 'center'; ctx.fillStyle = t.text3; ctx.font = 'italic 11px sans-serif'
  wrapTxt(ctx, genTagline('fitness', r, statsContext), cx, y, W - 60, 17, 2)

  drawFooter(ctx, W, H, t, logoImage, qrCodeImage)
}

// ===================== 模板 2：BLOOM（轻食自律）=====================
function drawBloom(ctx: CanvasRenderingContext2D, opt: SmartPosterOptions, t: ThemeColors) {
  const { width: W, height: H, record: r, image, logoImage, qrCodeImage, statsContext } = opt
  const cx = W / 2

  bgGrad(ctx, W, H, t.bg1, t.bg2)

  // 装饰小圆点（暖色调低透明度）
  const dots = [[60, 80], [300, 110], [50, 600], [320, 560], [180, 640]]
  dots.forEach(([dx, dy]) => {
    ctx.fillStyle = 'rgba(201,123,90,0.08)'
    ctx.beginPath(); ctx.arc(dx, dy, 20, 0, Math.PI * 2); ctx.fill()
  })

  let y = 42
  const streak = statsContext?.streak_days || 0

  // 主标题
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  ctx.fillStyle = t.text1; ctx.font = 'bold 26px sans-serif'
  ctx.fillText(streak > 0 ? '又是自律的一天' : '认真吃饭的一天', cx, y)
  y += 40

  // 副标题
  if (streak > 0) {
    ctx.fillStyle = t.accent; ctx.font = '13px sans-serif'
    ctx.fillText(`坚持第 ${streak} 天`, cx, y)
    y += 30
  }
  y += 10

  // 圆形照片 + 装饰双环
  const pr = 95
  // 外层装饰环
  ctx.beginPath(); ctx.arc(cx, y + pr, pr + 10, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(201,123,90,0.18)'; ctx.lineWidth = 1; ctx.stroke()
  // 白环
  circleImg(ctx, image, cx, y + pr, pr, '#FFFFFF', 4)
  y += pr * 2 + 24

  // 日期 · 餐次
  const di = fmtDate(r.record_time)
  const meal = MEAL_CN[r.meal_type] || '记录'
  ctx.fillStyle = t.text3; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(`${di.month} ${di.day}  ·  ${meal}`, cx, y)
  y += 28

  // 卡路里（优雅中号字）
  const cal = Math.round(r.total_calories || 0)
  ctx.fillStyle = t.accent; ctx.font = 'bold 44px sans-serif'
  ctx.fillText(String(cal), cx, y)
  y += 48
  ctx.fillStyle = t.text3; ctx.font = '11px sans-serif'
  ctx.fillText('kcal', cx, y)
  y += 22

  // 简洁一行 PFC
  const p = Math.round(r.total_protein || 0)
  const c = Math.round(r.total_carbs || 0)
  const f = Math.round(r.total_fat || 0)
  ctx.fillStyle = t.text2; ctx.font = '12px sans-serif'
  ctx.fillText(`蛋白质 ${p}g  ·  碳水 ${c}g  ·  脂肪 ${f}g`, cx, y)
  y += 28

  // 短分割
  ctx.strokeStyle = t.divider; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(cx - 40, y); ctx.lineTo(cx + 40, y); ctx.stroke()
  y += 20

  // 健康建议
  const tagline = genTagline('slim', r, statsContext)
  ctx.fillStyle = t.text2; ctx.font = 'italic 12px sans-serif'; ctx.textAlign = 'center'
  wrapTxt(ctx, tagline, cx, y, W - 60, 18, 2)

  drawFooter(ctx, W, H, t, logoImage, qrCodeImage)
}

// ===================== 模板 3：FRESH（均衡健康）=====================
function drawFresh(ctx: CanvasRenderingContext2D, opt: SmartPosterOptions, t: ThemeColors) {
  const { width: W, height: H, record: r, image, logoImage, qrCodeImage, statsContext } = opt
  const cx = W / 2

  bgGrad(ctx, W, H, t.bg1, t.bg2)

  let y = 32
  // 小标语
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  ctx.fillStyle = t.text2; ctx.font = 'italic 13px sans-serif'
  ctx.fillText('我在 Food Link 坚持健康饮食', cx, y)
  y += 30

  // 圆形照片
  const pr = 105
  ctx.beginPath(); ctx.arc(cx, y + pr, pr + 5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill()
  circleImg(ctx, image, cx, y + pr, pr, '#FFFFFF', 3)
  y += pr * 2 + 28

  // 日期 · 餐次
  const di = fmtDate(r.record_time)
  const meal = MEAL_CN[r.meal_type] || '记录'
  ctx.fillStyle = t.text1; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(`${di.month} ${di.day}  ·  ${meal}`, cx, y)
  y += 36

  // 卡路里
  const cal = Math.round(r.total_calories || 0)
  ctx.fillStyle = t.text1; ctx.font = 'bold 40px sans-serif'
  ctx.fillText(`${cal} kcal`, cx, y)
  y += 50

  drawDivider(ctx, y, W, t.divider); y += 16

  // PFC 彩条 + 数据
  y = drawMacroRow(ctx, y, W, r, t)

  drawDivider(ctx, y, W, t.divider); y += 16

  // 健康建议
  const insight = r.insight || genTagline('balanced', r, statsContext)
  ctx.textAlign = 'center'; ctx.fillStyle = t.text2; ctx.font = 'italic 12px sans-serif'
  wrapTxt(ctx, insight, cx, y, W - 60, 18, 3)

  drawFooter(ctx, W, H, t, logoImage, qrCodeImage)
}

// ===================== 模板 4：GOURMET（美食分享）=====================
function drawGourmet(ctx: CanvasRenderingContext2D, opt: SmartPosterOptions, t: ThemeColors) {
  const { width: W, height: H, record: r, image, logoImage, qrCodeImage, statsContext } = opt
  const cx = W / 2

  // 深色底
  bgGrad(ctx, W, H, t.bg1, t.bg2)

  // ★ 大图区：占上半部分 50%
  const photoH = 370
  rectImg(ctx, image, 0, 0, W, photoH, 0)

  // 底部渐变遮罩（让图片自然过渡到暗色区）
  const overlay = ctx.createLinearGradient(0, photoH - 120, 0, photoH)
  overlay.addColorStop(0, 'rgba(26,26,26,0)')
  overlay.addColorStop(1, 'rgba(26,26,26,1)')
  ctx.fillStyle = overlay
  ctx.fillRect(0, photoH - 120, W, 120)

  let y = photoH + 12

  // 食物描述
  const desc = r.description || '美味记录'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillStyle = t.text1; ctx.font = 'bold 22px sans-serif'
  wrapTxt(ctx, desc, 28, y, W - 56, 30, 2)
  y += desc.length > 16 ? 65 : 38

  // 健康建议
  if (r.insight) {
    ctx.fillStyle = t.text3; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'
    y = wrapTxt(ctx, r.insight, 28, y, W - 56, 17, 2) + 6
  }

  y += 8
  drawDivider(ctx, y, W, t.divider, 28); y += 16

  // 一行营养数据（金色强调）
  const cal = Math.round(r.total_calories || 0)
  const p = Math.round(r.total_protein || 0)
  const c = Math.round(r.total_carbs || 0)
  const f = Math.round(r.total_fat || 0)
  ctx.textAlign = 'left'
  ctx.fillStyle = t.accent; ctx.font = 'bold 14px sans-serif'
  ctx.fillText(`${cal} kcal`, 28, y)
  ctx.fillStyle = t.text3; ctx.font = '12px sans-serif'
  ctx.fillText(`P${p}  C${c}  F${f}`, 28 + ctx.measureText(`${cal} kcal`).width + 16, y + 1)
  y += 32

  // 日期 · 餐次
  const di = fmtDate(r.record_time)
  const meal = MEAL_CN[r.meal_type] || '记录'
  ctx.fillStyle = t.text3; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'
  ctx.fillText(`${di.month} ${di.day}, ${di.year}  ·  ${meal}`, 28, y)
  y += 28

  // 签名式标语
  const tagline = genTagline('foodie', r, statsContext)
  ctx.textAlign = 'center'; ctx.fillStyle = t.text2; ctx.font = 'italic 13px sans-serif'
  if (tagline !== (r.description || '')) {
    wrapTxt(ctx, tagline, cx, y, W - 56, 18, 2)
  }

  drawFooter(ctx, W, H, t, logoImage, qrCodeImage)
}

// ===================== 主入口 =====================
export function drawSmartPoster(ctx: CanvasRenderingContext2D, options: SmartPosterOptions): PosterPersona {
  const persona = detectPersona(options)
  const theme = THEMES[persona]

  switch (persona) {
    case 'fitness':  drawPower(ctx, options, theme); break
    case 'slim':     drawBloom(ctx, options, theme); break
    case 'foodie':   drawGourmet(ctx, options, theme); break
    default:         drawFresh(ctx, options, theme); break
  }

  return persona
}

export type { FoodRecord }
