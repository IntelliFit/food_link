import Taro from '@tarojs/taro'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import type { WeeklyRecapSummary } from '../../../utils/weekly-recap'

type MiniCanvas = HTMLCanvasElement & { createImage: () => HTMLImageElement }
export async function createWeeklyRecapPoster(report: WeeklyRecapSummary, showNumbers: boolean, waterMl: number | null, photos: string[]): Promise<string> {
  const canvas = await new Promise<MiniCanvas>((resolve, reject) => {
    Taro.createSelectorQuery().select('#weeklyRecapCanvas').fields({ node: true, size: true }).exec(result => result?.[0]?.node ? resolve(result[0].node) : reject(new Error('画布还未就绪，请重试。')))
  })
  const images = await Promise.all(photos.slice(0, 4).map(async src => {
    const path = await resolveCanvasImageSrc(src)
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = canvas.createImage()
      const timeout = setTimeout(() => reject(new Error('餐照读取超时，请重试或取消这张照片。')), 12000)
      image.onload = () => { clearTimeout(timeout); resolve(image) }
      image.onerror = () => { clearTimeout(timeout); reject(new Error('餐照未能打开，请重新选择。')) }
      image.src = path
    })
  }))
  const width = 750
  const height = images.length === 1 ? 1280 : images.length === 2 ? 1120 : images.length ? 1380 : 940
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境暂不支持分享画布。')
  ctx.fillStyle = '#f5f5ed'; ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#e2ebd8'; ctx.beginPath(); ctx.arc(685, 105, 195, 0, Math.PI * 2); ctx.fill()
  ctx.textAlign = 'left'; ctx.fillStyle = '#567150'; ctx.font = '24px sans-serif'; ctx.fillText('食探 · 每周回顾', 60, 100)
  ctx.fillStyle = '#293d2b'; ctx.font = 'bold 56px sans-serif'; ctx.fillText('好好吃饭的小日子', 60, 203)
  ctx.font = '26px sans-serif'; ctx.fillStyle = '#788270'; ctx.fillText(`${report.start} — ${report.end}`, 60, 260)
  ctx.fillStyle = '#fff'; ctx.fillRect(48, 320, 654, 350)
  ctx.fillStyle = '#314e34'; ctx.font = 'bold 72px sans-serif'; ctx.fillText(showNumbers ? `${report.recordedDays} 天` : '我的一周', 80, 432)
  ctx.font = '28px sans-serif'; ctx.fillStyle = '#6d7d68'; ctx.fillText(showNumbers ? '留下了饮食记录' : '三餐与生活，都值得认真对待', 80, 491)
  if (showNumbers) {
    ctx.font = '24px sans-serif'; ctx.fillText(`最长连续记录 ${report.longestStreak} 天`, 80, 551)
    if (waterMl != null) ctx.fillText(`已记录饮水 ${(waterMl / 1000).toFixed(1)} L`, 80, 604)
  }
  if (images.length) {
    const side = images.length === 1 ? 602 : 288; const gap = 26
    images.forEach((image, index) => {
      const x = 74 + index % 2 * (side + gap); const y = 716 + Math.floor(index / 2) * 250
      const targetHeight = images.length === 1 ? 390 : 224; const sourceRatio = image.width / image.height; const targetRatio = side / targetHeight
      const sourceWidth = sourceRatio > targetRatio ? image.height * targetRatio : image.width
      const sourceHeight = sourceRatio > targetRatio ? image.height : image.width / targetRatio
      ctx.drawImage(image, (image.width - sourceWidth) / 2, (image.height - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, side, targetHeight)
    })
  }
  ctx.fillStyle = '#70836a'; ctx.font = '25px sans-serif'; ctx.fillText('每一餐，都是照顾自己的开始。', 60, height - 126)
  ctx.fillStyle = '#939a8b'; ctx.font = '19px sans-serif'; ctx.fillText('基于本人记录整理 · 未记录的日子不作推断', 60, height - 75)
  const exported = await Taro.canvasToTempFilePath({ canvas: canvas as unknown as NonNullable<Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas']>, fileType: 'jpg', quality: .92, destWidth: width, destHeight: height })
  return exported.tempFilePath
}
