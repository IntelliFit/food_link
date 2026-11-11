import { LANDSCAPE_PHOTO_FRAME_RATIO, PORTRAIT_PHOTO_FRAME_RATIO } from '@food-link/core'

export type ShotOrientation = 'portrait' | 'landscape'

export const FRAME_RATIO: Record<ShotOrientation, number> = {
  portrait: PORTRAIT_PHOTO_FRAME_RATIO,
  landscape: LANDSCAPE_PHOTO_FRAME_RATIO,
}

export interface CameraFrameInput {
  windowWidth: number
  windowHeight: number
  /** 状态栏 + 自定义导航占的高度（px） */
  topInset: number
  /** 底部操作面板的高度（px），含安全区 */
  panelHeight: number
  orientation: ShotOrientation
}

const SIDE_GUTTER = 16
const VERTICAL_GAP = 24
const MIN_FRAME_HEIGHT = 160

/**
 * 取景框尺寸：竖拍 3:4、横拍 4:3，宽度不超过屏宽减两侧留白，
 * 高度不超过导航和底部面板之间的空间；矮屏时按高度反推宽度，比例保持不变。
 */
export function computeCameraFrame(input: CameraFrameInput): { width: number; height: number } {
  const ratio = FRAME_RATIO[input.orientation]
  const maxWidth = Math.max(0, input.windowWidth - SIDE_GUTTER * 2)
  const maxHeight = Math.max(MIN_FRAME_HEIGHT, input.windowHeight - input.topInset - input.panelHeight - VERTICAL_GAP)
  let width = maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return { width: Math.floor(width), height: Math.floor(height) }
}
