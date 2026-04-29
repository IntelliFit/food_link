/**
 * 微信小程序 type=2d Canvas 节点非浏览器 DOM，ECharts / ZRender 会调用 addEventListener 等 API。
 * Apache ECharts 官方小程序方案见 echarts-for-weixin（ec-canvas）；此处为 Taro 直连 Canvas 补最小接口。
 * @see https://github.com/apache/echarts-handbook/blob/master/contents/zh/how-to/cross-platform/wechat-app.md
 */

/** 满足 ZRender clientToLocal 对 getBoundingClientRect 的读取，无需完整 DOMRect 类型 */
interface WxPolyfillRect {
  x: number
  y: number
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  toJSON: () => Record<string, never>
}

type PatchedCanvas = Record<string, unknown> & {
  __flChartW?: number
  __flChartH?: number
}

function makeRect(w: number, h: number): WxPolyfillRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: w,
    bottom: h,
    width: w,
    height: h,
    toJSON: (): Record<string, never> => ({}),
  }
}

/**
 * 在 `echarts.init` 之前对微信返回的 canvas 实例打补丁；重复调用时更新布局尺寸供 getBoundingClientRect 使用
 */
export function patchWxCanvasNodeForEcharts(canvas: unknown, widthCssPx: number, heightCssPx: number): void {
  const el = canvas as PatchedCanvas
  el.__flChartW = widthCssPx
  el.__flChartH = heightCssPx

  if (typeof el.addEventListener !== 'function') {
    el.addEventListener = (): void => {}
  }
  if (typeof el.removeEventListener !== 'function') {
    el.removeEventListener = (): void => {}
  }

  el.getBoundingClientRect = (): WxPolyfillRect => {
    const rw = el.__flChartW ?? widthCssPx
    const rh = el.__flChartH ?? heightCssPx
    return makeRect(rw, rh)
  }
}
