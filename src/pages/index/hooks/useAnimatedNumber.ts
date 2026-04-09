import { useState, useLayoutEffect, useRef } from 'react'
import { getNowMs } from '../../../utils/perf-now'

/**
 * @param resetDep 传入后，每次该值变化（如选中日）时从 0 重新播放到 target，便于换日后可见数字缓动；不传则仅从当前展示值过渡到新 target
 */
export function useAnimatedNumber(
  target: number,
  duration: number = 600,
  delay: number = 0,
  resetDep?: string
): number {
  const [displayValue, setDisplayValue] = useState(0)
  const displayValueRef = useRef(0)
  displayValueRef.current = displayValue
  const lastResetDepRef = useRef<string | undefined>(undefined)
  const animationRef = useRef<{ startTime: number | null; startValue: number; rafId: number | null }>({
    startTime: null,
    startValue: 0,
    rafId: null
  })

  // useLayoutEffect：resetDep 变化时先把展示值同步归零再 rAF，避免遮罩关闭首帧仍显示上一段动画的终值（换日看不到缓动）
  useLayoutEffect(() => {
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId)
    }

    const useFromZero = resetDep !== undefined && lastResetDepRef.current !== resetDep
    if (resetDep !== undefined) {
      lastResetDepRef.current = resetDep
    }
    if (useFromZero) {
      setDisplayValue(0)
      displayValueRef.current = 0
    }
    const startValue = useFromZero ? 0 : displayValueRef.current
    const startTime = getNowMs() + delay
    animationRef.current = { startTime, startValue, rafId: null }

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

    // 微信真机 rAF 回调常不传时间戳，与 getNowMs() 混用会得到 NaN，动画失效、数字卡在 0
    const animate = (): void => {
      const now = getNowMs()
      const elapsed = now - startTime
      if (elapsed < 0) {
        animationRef.current.rafId = requestAnimationFrame(animate)
        return
      }

      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)
      const currentValue = startValue + (target - startValue) * easedProgress

      setDisplayValue(currentValue)

      if (progress < 1) {
        animationRef.current.rafId = requestAnimationFrame(animate)
      }
    }

    animationRef.current.rafId = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current.rafId) {
        cancelAnimationFrame(animationRef.current.rafId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayValue 仅作起点，故意不列入 deps，避免 rAF 每帧 setState 导致 effect 重入
  }, [target, duration, delay, resetDep])

  return displayValue
}
