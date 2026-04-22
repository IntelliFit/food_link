import { View } from '@tarojs/components'
import React, { type PropsWithChildren } from 'react'
import { useAppColorSchemeOptional } from './AppColorSchemeContext'

/**
 * 页面级主题壳：铺满视口，深色下提供底衬；浅色不额外盖色（沿用各页原背景）。
 */
export function FlPageThemeRoot({ children }: PropsWithChildren): React.ReactElement {
  const ctx = useAppColorSchemeOptional()
  const scheme = ctx?.scheme ?? 'light'
  const dark = scheme === 'dark'
  return (
    <View
      className={`fl-page-theme-root${dark ? ' fl-page-theme-root--dark' : ''}`}
      style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box' }}
    >
      {children}
    </View>
  )
}
