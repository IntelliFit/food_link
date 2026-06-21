import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

type ColorScheme = 'light' | 'dark'

interface ColorSchemeContextValue {
  scheme: ColorScheme
  isDark: boolean
  setScheme: (scheme: ColorScheme) => void
  toggleScheme: () => void
}

const ColorSchemeContext = createContext<ColorSchemeContextValue>({
  scheme: 'light',
  isDark: false,
  setScheme: () => undefined,
  toggleScheme: () => undefined,
})

const STORAGE_KEY = 'food_link_color_scheme_v1'

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>('light')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!active) return
        if (value === 'dark' || value === 'light') {
          setSchemeState(value)
        }
        setReady(true)
      })
      .catch(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  const setScheme = useCallback((next: ColorScheme) => {
    setSchemeState(next)
    void AsyncStorage.setItem(STORAGE_KEY, next)
  }, [])

  const toggleScheme = useCallback(() => {
    setSchemeState((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      void AsyncStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  if (!ready) {
    return null
  }

  return (
    <ColorSchemeContext.Provider
      value={{
        scheme,
        isDark: scheme === 'dark',
        setScheme,
        toggleScheme,
      }}
    >
      {children}
    </ColorSchemeContext.Provider>
  )
}

export function useColorScheme() {
  return useContext(ColorSchemeContext)
}
