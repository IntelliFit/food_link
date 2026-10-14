import { View } from '@tarojs/components'
import * as React from 'react'
import type { PropsWithChildren } from 'react'
import { useAppColorSchemeOptional } from './AppColorSchemeContext'
import { useBalancedTheme } from './BalancedThemeContext'
import { useInkWellness } from './InkWellness'
import { applyThemeNavigationBar } from '../utils/theme-navigation-bar'
import { BALANCED_SCENES } from '../utils/balanced-theme-scenes'
import { ThemeSceneImage } from './ThemeSceneImage'
import { ThemeSceneScope, useThemeSceneScope } from './ThemeSceneScope'

/**
 * 页面级主题壳：铺满视口，深色下提供底衬；浅色不额外盖色（沿用各页原背景）。
 */
export function FlPageThemeRoot({ children }: PropsWithChildren): React.ReactElement {
  const ctx = useAppColorSchemeOptional()
  const { theme: balancedTheme } = useBalancedTheme()
  const scheme = ctx?.scheme ?? 'light'
  // Shell and content must reconcile together, including a switch on a visible page.
  const wellness = useInkWellness()
  // The ink references use paper in both appearance settings. The shared green
  // dark palette belongs to balanced mode and must not override that material.
  const dark = scheme === 'dark' && !wellness
  const pageScope = useThemeSceneScope()

  React.useEffect(() => { applyThemeNavigationBar(scheme) }, [scheme, balancedTheme, wellness])

  return (
    <ThemeSceneScope.Provider value={`${pageScope}:${balancedTheme}:${scheme}:${wellness}`}><View
      className={`fl-page-theme-root${dark ? ' fl-d' : ''}${wellness ? ' fl-page-theme-root--wellness' : ` fl-page-theme-root--balanced fl-balanced-theme--${balancedTheme}`}`}
      style={{ minHeight: '100vh', width: '100%', boxSizing: 'border-box' }}
    >
      {!dark && !wellness && balancedTheme === 'natural-symbiosis' && <ThemeSceneImage className='natural-page-paper' src={BALANCED_SCENES.naturalPaper} />}
      {children}
    </View></ThemeSceneScope.Provider>
  )
}
