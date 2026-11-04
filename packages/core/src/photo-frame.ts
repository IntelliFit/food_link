/** 拍照识别的照片框：横图 4:3、竖图 3:4，超出部分居中裁切，不随手机屏幕拉满。 */
export const LANDSCAPE_PHOTO_FRAME_RATIO = 4 / 3
export const PORTRAIT_PHOTO_FRAME_RATIO = 3 / 4

/** imageRatio 为照片宽 / 高；方图和尺寸未知时按横图处理。 */
export function getPhotoFrameRatio(imageRatio: number): number {
  return imageRatio < 1 ? PORTRAIT_PHOTO_FRAME_RATIO : LANDSCAPE_PHOTO_FRAME_RATIO
}

export type CenterCropRect = {
  x: number
  y: number
  width: number
  height: number
  outputWidth: number
  outputHeight: number
}

/** 从照片中间裁出 targetRatio（宽 / 高）的区域，输出长边不超过 maxLongEdge，不放大小图。 */
export function getCenterCropRect(imageWidth: number, imageHeight: number, targetRatio: number, maxLongEdge: number): CenterCropRect {
  const width = Math.min(imageWidth, imageHeight * targetRatio)
  const height = width / targetRatio
  const scale = Math.min(1, maxLongEdge / Math.max(width, height))
  return {
    x: Math.round((imageWidth - width) / 2),
    y: Math.round((imageHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
    outputWidth: Math.round(width * scale),
    outputHeight: Math.round(height * scale),
  }
}

export function getPhotoFrameSize(imageRatio: number, longEdge: number): { width: number; height: number } {
  const frameRatio = getPhotoFrameRatio(imageRatio)
  return frameRatio < 1
    ? { width: Math.round(longEdge * frameRatio), height: longEdge }
    : { width: longEdge, height: Math.round(longEdge / frameRatio) }
}
