import Taro from '@tarojs/taro'

/** 自定义导航（navigationStyle: custom）页面需要的屏幕尺寸，单位 px。 */
export interface CustomNavMetrics {
  statusBarHeight: number
  /** 状态栏下面、和胶囊按钮对齐的导航内容高度 */
  navHeight: number
  windowWidth: number
  windowHeight: number
  /** 底部安全区（Home 条）高度 */
  safeBottom: number
}

const DEFAULT_METRICS: CustomNavMetrics = {
  statusBarHeight: 20,
  navHeight: 44,
  windowWidth: 375,
  windowHeight: 812,
  safeBottom: 0,
}

export function readCustomNavMetrics(): CustomNavMetrics {
  const metrics = { ...DEFAULT_METRICS }
  try {
    const info = (Taro as any).getWindowInfo?.() || Taro.getSystemInfoSync()
    metrics.statusBarHeight = Number(info.statusBarHeight) || metrics.statusBarHeight
    metrics.windowWidth = Number(info.windowWidth) || metrics.windowWidth
    metrics.windowHeight = Number(info.windowHeight) || metrics.windowHeight
    const safeArea = info.safeArea
    if (safeArea && Number(info.screenHeight) > 0) {
      metrics.safeBottom = Math.max(0, Number(info.screenHeight) - Number(safeArea.bottom))
    }
  } catch {
    /* 拿不到时用常见机型的尺寸 */
  }
  try {
    const menu = Taro.getMenuButtonBoundingClientRect()
    if (menu && menu.height > 0 && menu.top > metrics.statusBarHeight) {
      metrics.navHeight = (menu.top - metrics.statusBarHeight) * 2 + menu.height
    }
  } catch {
    /* 没有胶囊位置时用默认导航高度 */
  }
  return metrics
}

/** rpx → px，按当前屏宽换算 */
export function rpxToPx(rpx: number, windowWidth: number): number {
  return (rpx * windowWidth) / 750
}
