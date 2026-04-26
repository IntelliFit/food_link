/**
 * 微信小程序无标准 DOM：`document.createElement('canvas')` 往往没有 `getContext`，
 * ZRender 的 `measureText` 仍会调用 `getContext('2d')` → 报错。
 * 通过 `setPlatformAPI` 改为字符宽估算（与 zrender 无 2d 上下文时的 fallback 一致）。
 * @see zrender/lib/core/platform.js
 */
import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  DEFAULT_TEXT_WIDTH_MAP,
  setPlatformAPI,
} from 'zrender/lib/core/platform.js'

let installed = false

export function installWxZrenderTextMeasure(): void {
  if (installed) return
  if (process.env.TARO_ENV !== 'weapp') return

  installed = true
  setPlatformAPI({
    measureText(text: string | undefined, font: string | undefined): { width: number } {
      const t = text ?? ''
      const f = font ?? DEFAULT_FONT
      const res = /((?:\d+)?\.?\d*)px/.exec(f)
      const fontSize = (res && +res[1]) || DEFAULT_FONT_SIZE
      let width = 0
      if (f.indexOf('mono') >= 0) {
        width = fontSize * t.length
      } else {
        for (let i = 0; i < t.length; i++) {
          const preCalcWidth = DEFAULT_TEXT_WIDTH_MAP[t[i]]
          width += preCalcWidth == null ? fontSize : preCalcWidth * fontSize
        }
      }
      return { width }
    },
  })
}
