import { useState, useEffect, useRef } from 'react'

export function useAnimatedProgress(targetProgress: number, duration: number = 600, delay: number = 0): number {
  const [displayProgress, setDisplayProgress] = useState(targetProgress)
  const animationRef = useRef<{ startTime: number | null; startProgress: number; rafId: number | null }>({
    startTime: null,
    startProgress: 0,
    rafId: null
  })

  useEffect(() => {
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId)
    }

    const startProgress = displayProgress
    const startTime = performance.now() + delay
    animationRef.current = { startTime, startProgress, rafId: null }

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      
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
  }, [targetProgress, duration, delay])

  return Math.max(0, Math.min(100, displayProgress))
}
