import Taro from '@tarojs/taro'
import React, { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useState } from 'react'
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
  const setFallback = useCallback((next: BalancedThemeId) => {
    setFallbackTheme(next)
    setStoredBalancedTheme(next)
  }, [])
  const fallback = useMemo(() => ({ theme: fallbackTheme, setTheme: setFallback }), [fallbackTheme, setFallback])
  return context ?? fallback
}

export function useBalancedThemeOptional(): BalancedThemeContextValue | null {
  return useContext(BalancedThemeContext)
}
