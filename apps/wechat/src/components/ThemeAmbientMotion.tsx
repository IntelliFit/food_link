import { Image, View } from '@tarojs/components'
import * as React from 'react'
import type { BalancedThemeId } from '../utils/balanced-theme'
import { BALANCED_SCENES } from '../utils/balanced-theme-scenes'
import './ThemeAmbientMotion.scss'

export const THEME_MOTION_LABELS: Record<BalancedThemeId, string> = {
  'clarity-order': '刻度游标', 'natural-symbiosis': '风过枝叶', 'eastern-salon': '云行山水',
  'modern-gallery': '悬浮拼贴', 'miniature-world': '云游花园', 'picturebook-companion': '晨光浮尘',
  'clear-care': '日光舒展', 'way-of-water': '一水千纹',
}

/** Small composited layers, behind content. No per-frame JS or touch handlers. */
export function ThemeAmbientMotion({ theme, scenesReady }: { theme: BalancedThemeId; scenesReady: boolean }) {
  return <View className={`bt-ambient bt-ambient--${theme}`} aria-hidden>
    {theme === 'natural-symbiosis' ? <>
      {scenesReady && <Image className='bt-ambient__branch' src={BALANCED_SCENES.motionBranch} mode='aspectFit' />}
      {scenesReady && <Image className='bt-ambient__branch-shadow' src={BALANCED_SCENES.motionBranch} mode='aspectFit' />}
      <View className='bt-ambient__sun' />
    </> : theme === 'miniature-world' ? <>
      {scenesReady && <Image className='bt-ambient__cloud bt-ambient__cloud--near' src={BALANCED_SCENES.motionCloud} mode='aspectFit' />}
      {scenesReady && <Image className='bt-ambient__cloud bt-ambient__cloud--far' src={BALANCED_SCENES.motionCloud} mode='aspectFit' />}
      <View className='bt-ambient__river-light' />
    </> : <>
      <View className='bt-ambient__one' /><View className='bt-ambient__two' /><View className='bt-ambient__three' />
      {theme === 'picturebook-companion' && <><View className='bt-ambient__mote bt-ambient__mote--a' /><View className='bt-ambient__mote bt-ambient__mote--b' /><View className='bt-ambient__mote bt-ambient__mote--c' /></>}
    </>}
  </View>
}
