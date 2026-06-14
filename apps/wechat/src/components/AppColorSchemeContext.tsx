import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import Taro from '@tarojs/taro'
import {
  type AppColorScheme,
  getStoredAppColorScheme,
  setStoredAppColorScheme,
} from '../utils/app-color-scheme'
import { applyThemeNavigationBar } from '../utils/theme-navigation-bar'

export const APP_COLOR_SCHEME_EVENT = 'fl_app_color_scheme_changed'

interface AppColorSchemeContextValue {
  scheme: AppColorScheme
  setScheme: (next: AppColorScheme) => void
  toggleScheme: () => void
}

const AppColorSchemeContext = createContext<AppColorSchemeContextValue | null>(null)

export function AppColorSchemeProvider({ children }: PropsWithChildren): React.ReactElement {
  const [scheme, setSchemeState] = useState<AppColorScheme>(() => getStoredAppColorScheme())

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  const setScheme = useCallback((next: AppColorScheme): void => {
    setSchemeState(next)
    setStoredAppColorScheme(next)
    applyThemeNavigationBar(next)
    try {
      Taro.eventCenter.trigger(APP_COLOR_SCHEME_EVENT, { scheme: next })
    } catch {
      /* ignore */
    }
  }, [])

  const toggleScheme = useCallback((): void => {
    setScheme(scheme === 'dark' ? 'light' : 'dark')
  }, [scheme, setScheme])

  const value = useMemo(
    (): AppColorSchemeContextValue => ({ scheme, setScheme, toggleScheme }),
    [scheme, setScheme, toggleScheme],
  )

  return <AppColorSchemeContext.Provider value={value}>{children}</AppColorSchemeContext.Provider>
}

function useFallbackAppColorScheme(): AppColorSchemeContextValue {
  const [scheme, setSchemeState] = useState<AppColorScheme>(() => getStoredAppColorScheme())

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  const setScheme = useCallback((next: AppColorScheme): void => {
    setSchemeState(next)
    setStoredAppColorScheme(next)
    applyThemeNavigationBar(next)
    try {
      Taro.eventCenter.trigger(APP_COLOR_SCHEME_EVENT, { scheme: next })
    } catch {
      /* ignore */
    }
  }, [])

  const toggleScheme = useCallback((): void => {
    setScheme(scheme === 'dark' ? 'light' : 'dark')
  }, [scheme, setScheme])

  return useMemo(
    (): AppColorSchemeContextValue => ({ scheme, setScheme, toggleScheme }),
    [scheme, setScheme, toggleScheme],
  )
}

export function useAppColorScheme(): AppColorSchemeContextValue {
  const ctx = useContext(AppColorSchemeContext)
  const fallback = useFallbackAppColorScheme()
  return ctx ?? fallback
}

/** 供未挂 Provider 的边界场景（应尽量避免） */
export function useAppColorSchemeOptional(): AppColorSchemeContextValue | null {
  return useContext(AppColorSchemeContext)
}
