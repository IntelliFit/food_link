import { useState, useEffect, useCallback, useRef } from 'react'
import Taro from '@tarojs/taro'
import type { HighlightRect, OnboardingGuideStep } from './types'

const QUERY_RETRY_MS = 120
const MAX_QUERY_RETRIES = 10

/**
 * 与 custom-tab-bar 中央绿色拍照按钮对齐（110rpx 圆 + translateY(-18rpx) 上浮）
 * 见 custom-tab-bar/index.wxss `.center-icon-wrapper`
 */
export function getTabRecordCenterRect(): HighlightRect {
  const win = Taro.getSystemInfoSync()
  const ww = win.windowWidth
  const wh = win.windowHeight
  const safeBottom = win.safeArea ? Math.max(0, wh - win.safeArea.bottom) : 0
  const rpx = ww / 750
  const btnSize = 110 * rpx
  const tabItemPaddingBottom = 20 * rpx
  const centerFloatUp = 18 * rpx
  const left = (ww - btnSize) / 2
  const top = wh - safeBottom - tabItemPaddingBottom - btnSize - centerFloatUp
  return { left, top, width: btnSize, height: btnSize }
}

function expandRect(rect: HighlightRect, padding: number): HighlightRect {
  return {
    left: Math.max(0, rect.left - padding),
    top: Math.max(0, rect.top - padding),
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  }
}

function querySelectorRect(selector: string): Promise<HighlightRect | null> {
  return new Promise((resolve) => {
    const query = Taro.createSelectorQuery()
    query.select(selector).boundingClientRect()
    query.exec((res) => {
      const node = res?.[0] as HighlightRect & { width?: number } | null
      if (node && node.width != null && node.width > 0) {
        resolve({
          left: node.left,
          top: node.top,
          width: node.width,
          height: node.height,
        })
        return
      }
      resolve(null)
    })
  })
}

async function resolveStepRect(
  step: OnboardingGuideStep,
  options?: { allowPageScroll?: boolean },
): Promise<HighlightRect | null> {
  if (step.preset === 'tab-record-center') {
    return getTabRecordCenterRect()
  }
  if (!step.selector) return null

  const allowPageScroll = options?.allowPageScroll !== false
  if (allowPageScroll && step.scrollIntoView) {
    try {
      await Taro.pageScrollTo({ selector: step.selector, duration: 200 })
    } catch {
      /* ignore */
    }
  }

  for (let i = 0; i < MAX_QUERY_RETRIES; i += 1) {
    const rect = await querySelectorRect(step.selector)
    if (rect) {
      return expandRect(rect, step.padding ?? 8)
    }
    await new Promise((r) => setTimeout(r, QUERY_RETRY_MS))
  }
  return null
}

export type UseHighlightRectOptions = {
  /** 为 false 时不触发 pageScrollTo（引导锁滚期间） */
  allowPageScroll?: boolean
}

export function useHighlightRect(
  step: OnboardingGuideStep | null,
  active: boolean,
  options?: UseHighlightRectOptions,
) {
  const [rect, setRect] = useState<HighlightRect | null>(null)
  const [ready, setReady] = useState(false)
  const querySeqRef = useRef(0)

  const refresh = useCallback(
    async (stepOverride?: OnboardingGuideStep | null) => {
      const target = stepOverride !== undefined ? stepOverride : step
      const seq = ++querySeqRef.current

      if (!active || !target) {
        setRect(null)
        setReady(false)
        return
      }

      setRect(null)
      setReady(false)

      const next = await resolveStepRect(target, options)
      if (seq !== querySeqRef.current) {
        return
      }
      setRect(next)
      setReady(true)
    },
    [active, step, options?.allowPageScroll],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  return { rect, ready, refresh }
}
