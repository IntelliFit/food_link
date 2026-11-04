import Taro from '@tarojs/taro'
import { getCenterCropRect } from '@food-link/core'

/** 与 analyze 页压缩图同档：长边 1600 足够识别，也不会让上传变慢。 */
const OUTPUT_LONG_EDGE = 1600

type MiniCanvas = HTMLCanvasElement & { createImage: () => HTMLImageElement }

function queryCanvas(selector: string): Promise<MiniCanvas> {
  return new Promise((resolve, reject) => {
    Taro.createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec(result => result?.[0]?.node ? resolve(result[0].node) : reject(new Error('裁切画布还未就绪')))
  })
}

function loadImage(canvas: MiniCanvas, src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('照片读取失败'))
    image.src = src
  })
}

/** 把相机原图居中裁成取景框的比例（宽 / 高），返回新的临时文件路径。 */
export async function cropPhotoToFrame(canvasSelector: string, src: string, frameRatio: number): Promise<string> {
  const canvas = await queryCanvas(canvasSelector)
  const image = await loadImage(canvas, src)
  const rect = getCenterCropRect(image.width, image.height, frameRatio, OUTPUT_LONG_EDGE)
  canvas.width = rect.outputWidth
  canvas.height = rect.outputHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('裁切画布不可用')
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.outputWidth, rect.outputHeight)
  const exported = await Taro.canvasToTempFilePath({
    canvas: canvas as unknown as NonNullable<Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas']>,
    fileType: 'jpg',
    quality: 0.9,
    destWidth: rect.outputWidth,
    destHeight: rect.outputHeight,
  })
  return exported.tempFilePath
}
