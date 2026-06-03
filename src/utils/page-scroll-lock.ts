import Taro from '@tarojs/taro'
import { useEffect, useRef } from 'react'

export const PAGE_SCROLL_LOCK_STYLE = 'overflow: hidden; height: 100vh;'

type WxPageStyleApi = {
  setPageStyle?: (opts: { style: string }) => void
}

function getWxPageStyleApi(): WxPageStyleApi | undefined {
  return (globalThis as { wx?: WxPageStyleApi }).wx
}

/**
 * 锁定微信页面级滚动（PageMeta 在部分分包页/模拟器滚轮下可能不生效，用 setPageStyle 兜底）
 */
export function usePageScrollLock(locked: boolean) {
  const scrollTopRef = useRef(0)

  useEffect(() => {
    if (!locked) return undefined

    Taro.createSelectorQuery()
      .selectViewport()
      .scrollOffset((res) => {
        scrollTopRef.current = res?.scrollTop ?? 0
      })
      .exec()

    void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }).catch(() => {})

    try {
      getWxPageStyleApi()?.setPageStyle?.({ style: PAGE_SCROLL_LOCK_STYLE })
    } catch {
      /* ignore */
    }

    return () => {
      try {
        getWxPageStyleApi()?.setPageStyle?.({ style: '' })
      } catch {
        /* ignore */
      }
      void Taro.pageScrollTo({ scrollTop: scrollTopRef.current, duration: 0 }).catch(() => {})
    }
  }, [locked])
}
