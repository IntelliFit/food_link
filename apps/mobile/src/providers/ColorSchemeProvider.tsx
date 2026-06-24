import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { Appearance, type ColorSchemeName } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type ColorSchemeContextValue = {
  isDark: boolean
  toggleScheme: () => void
}

const STORAGE_KEY = 'food_link_mobile_color_scheme'

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null)

function isDarkScheme(scheme: ColorSchemeName | null | undefined): boolean {
  return scheme === 'dark'
}

export function ColorSchemeProvider({ children }: PropsWithChildren<unknown>) {
  const [isDark, setIsDark] = useState<boolean>(() => isDarkScheme(Appearance.getColorScheme()))

  useEffect(() => {
    let canceled = false
    void AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (canceled) return
      if (!stored) return
      setIsDark(stored === 'dark')
    })
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    void AsyncStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light').catch(() => {
      // ignore persistence failures
    })
  }, [isDark])

  const toggleScheme = useCallback(() => {
    setIsDark((current) => !current)
  }, [])

  const value = useMemo(
    () => ({
      isDark,
      toggleScheme,
    }),
    [isDark, toggleScheme],
  )

  return <ColorSchemeContext.Provider value={value}>{children}</ColorSchemeContext.Provider>
}

export function useColorScheme(): ColorSchemeContextValue {
  const context = useContext(ColorSchemeContext)
  if (context) return context

  return {
    isDark: isDarkScheme(Appearance.getColorScheme()),
    toggleScheme: () => {
      // fallback for tests/edge cases where provider is missing
    },
  }
}
