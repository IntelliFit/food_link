import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import React, { type PropsWithChildren } from 'react'
import { useAppColorSchemeOptional } from './AppColorSchemeContext'
import { HOME_DISPLAY_MODE_STORAGE_KEY } from '../utils/home-display-mode'

function readWellnessMode(): boolean {
  try {
    return Taro.getStorageSync(HOME_DISPLAY_MODE_STORAGE_KEY) === 'wellness'
  } catch {
    return false
  }
}

/**
 * 页面级主题壳：铺满视口，深色下提供底衬；浅色不额外盖色（沿用各页原背景）。
 */
export function FlPageThemeRoot({ children }: PropsWithChildren): React.ReactElement {
  const ctx = useAppColorSchemeOptional()
  const scheme = ctx?.scheme ?? 'light'
  const dark = scheme === 'dark'
  const [wellness, setWellness] = React.useState(readWellnessMode)

  useDidShow(() => {
    setWellness(readWellnessMode())
  })

  return (
    <View
      className={`fl-page-theme-root${dark ? ' fl-d' : ''}${wellness ? ' fl-page-theme-root--wellness' : ' fl-page-theme-root--balanced'}`}
      style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box' }}
    >
      {children}
    </View>
  )
}
