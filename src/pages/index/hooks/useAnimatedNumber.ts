import { useState, useEffect, useRef } from 'react'

export function useAnimatedNumber(target: number, duration: number = 600, delay: number = 0): number {
  const [displayValue, setDisplayValue] = useState(target)
  const animationRef = useRef<{ startTime: number | null; startValue: number; rafId: number | null }>({
    startTime: null,
    startValue: 0,
    rafId: null
  })

  useEffect(() => {
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId)
    }

    const startValue = displayValue
    const startTime = performance.now() + delay
    animationRef.current = { startTime, startValue, rafId: null }

    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      
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
  }, [target, duration, delay])

  return displayValue
}
