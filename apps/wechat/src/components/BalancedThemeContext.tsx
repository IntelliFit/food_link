import Taro, { useDidShow } from '@tarojs/taro'
import React, { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  type BalancedThemeId,
  getStoredBalancedTheme,
  setStoredBalancedTheme,
} from '../utils/balanced-theme'

export const BALANCED_THEME_EVENT = 'fl_balanced_theme_changed'

type BalancedThemeContextValue = {
  theme: BalancedThemeId
  setTheme: (theme: BalancedThemeId) => void
}

const BalancedThemeContext = createContext<BalancedThemeContextValue | null>(null)

export function BalancedThemeProvider({ children }: PropsWithChildren): React.ReactElement {
  const [theme, setThemeState] = useState<BalancedThemeId>(() => getStoredBalancedTheme())

  useEffect(() => {
    const sync = () => setThemeState(getStoredBalancedTheme())
    Taro.eventCenter.on(BALANCED_THEME_EVENT, sync)
    return () => { Taro.eventCenter.off(BALANCED_THEME_EVENT, sync) }
  }, [])

  const setTheme = useCallback((next: BalancedThemeId): void => {
    setThemeState(next)
    setStoredBalancedTheme(next)
    try {
      Taro.eventCenter.trigger(BALANCED_THEME_EVENT, { theme: next })
    } catch {
      /* ignore event errors */
    }
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])

  return <BalancedThemeContext.Provider value={value}>{children}</BalancedThemeContext.Provider>
}

export function useBalancedTheme(): BalancedThemeContextValue {
  const context = useContext(BalancedThemeContext)
  const [fallbackTheme, setFallbackTheme] = useState<BalancedThemeId>(() => getStoredBalancedTheme())
  useEffect(() => {
    const sync = () => setFallbackTheme(getStoredBalancedTheme())
    Taro.eventCenter.on(BALANCED_THEME_EVENT, sync)
    return () => { Taro.eventCenter.off(BALANCED_THEME_EVENT, sync) }
  }, [])
  // Cached tab pages can miss a context update while hidden. Reconcile on return.
  useDidShow(() => {
    const stored = getStoredBalancedTheme()
    if (stored !== fallbackTheme) setFallbackTheme(stored)
    if (context && stored !== context.theme) context.setTheme(stored)
  })
  const setFallback = useCallback((next: BalancedThemeId) => {
    setFallbackTheme(next)
    setStoredBalancedTheme(next)
    Taro.eventCenter.trigger(BALANCED_THEME_EVENT, { theme: next })
  }, [])
  const fallback = useMemo(() => ({ theme: fallbackTheme, setTheme: setFallback }), [fallbackTheme, setFallback])
  return context ?? fallback
}

export function useBalancedThemeOptional(): BalancedThemeContextValue | null {
  return useContext(BalancedThemeContext)
}
