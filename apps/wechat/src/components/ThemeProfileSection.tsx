import { Image, Text, View } from '@tarojs/components'
import * as React from 'react'
import { useBalancedTheme } from './BalancedThemeContext'
import { useInkWellness } from './InkWellness'
import waterDrop from '../assets/balanced-themes/water-drop-v6.webp'
import easternLandscape from '../assets/balanced-themes/eastern-landscape.webp'
import { BALANCED_SCENES } from '../utils/balanced-theme-scenes'
import { ThemeSceneImage } from './ThemeSceneImage'

type Props = { title: string; hint: string; index: number; icon: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }

export function ThemeProfileSection({ title, hint, index, icon, expanded, onToggle, children }: Props) {
  const { theme } = useBalancedTheme()
  const ink = useInkWellness()
  return <View className={`profile-section${ink ? '' : ` tp-section tp-section--${theme}`}${expanded ? ' tp-section--open' : ''}`}>
    <View className='profile-section-heading is-toggle' role='button' aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${title}`} onClick={onToggle}>
      {!ink && theme === 'natural-symbiosis' && <ThemeSceneImage className='tp-section__drawer' src={BALANCED_SCENES.naturalDrawer} />}
      {!ink && <View className='tp-section__mark' aria-hidden>
        {theme === 'way-of-water' && <Image src={waterDrop} mode='aspectFit' />}
        {theme === 'eastern-salon' && <Image src={easternLandscape} mode='aspectFill' />}
        {theme === 'clarity-order' || theme === 'modern-gallery' || theme === 'picturebook-companion' ? <Text className='tp-section__number'>{String(index).padStart(2, '0')}</Text> : <Text className={`iconfont ${icon}`} />}
      </View>}
      <View className='tp-section__copy'><Text className='profile-section-title'>{title}</Text><Text className='profile-section-hint'>{hint}</Text></View>
      <View className={`profile-section-chevron${expanded ? ' is-expanded' : ''}`} />
    </View>
    {expanded && children}
  </View>
}
