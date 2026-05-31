import { useEffect, useState } from 'react'

/** 与 Tailwind `md` 断点一致 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)' as const

/**
 * 订阅 matchMedia 查询结果，用于移动端/桌面端分支渲染
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const sync = () => setMatches(mediaQuery.matches)

    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [query])

  return matches
}
