import { useState, useLayoutEffect, useRef } from 'react'
import { getNowMs } from '../../../utils/perf-now'

/** @param resetDep 变化时从 0 开始播放到 targetProgress（与 useAnimatedNumber 一致） */
export function useAnimatedProgress(
  targetProgress: number,
  duration: number = 600,
  delay: number = 0,
  resetDep?: string
): number {
  const [displayProgress, setDisplayProgress] = useState(0)
  const displayProgressRef = useRef(0)
  displayProgressRef.current = displayProgress
  const lastResetDepRef = useRef<string | undefined>(undefined)
  const animationRef = useRef<{ startTime: number | null; startProgress: number; rafId: number | null }>({
    startTime: null,
    startProgress: 0,
    rafId: null
  })

  useLayoutEffect(() => {
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId)
    }

    const useFromZero = resetDep !== undefined && lastResetDepRef.current !== resetDep
    if (resetDep !== undefined) {
      lastResetDepRef.current = resetDep
    }
    if (useFromZero) {
      setDisplayProgress(0)
      displayProgressRef.current = 0
    }
    const startProgress = useFromZero ? 0 : displayProgressRef.current
    const startTime = getNowMs() + delay
    animationRef.current = { startTime, startProgress, rafId: null }

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

    const animate = (): void => {
      const now = getNowMs()
      const elapsed = now - startTime
      if (elapsed < 0) {
        animationRef.current.rafId = requestAnimationFrame(animate)
        return
      }

      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeOutCubic(progress)
      const currentProgress = startProgress + (targetProgress - startProgress) * easedProgress

      setDisplayProgress(currentProgress)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayProgress 故意不列入 deps
  }, [targetProgress, duration, delay, resetDep])

  return Math.max(0, Math.min(100, displayProgress))
}
