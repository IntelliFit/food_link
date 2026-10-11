import { Image, Text, View } from '@tarojs/components'
import * as React from 'react'
import { useBalancedTheme } from './BalancedThemeContext'
import { useInkWellness } from './InkWellness'
import { BALANCED_SCENES } from '../utils/balanced-theme-scenes'
import { ThemeSceneImage } from './ThemeSceneImage'
import easternProfileGold from '../assets/balanced-themes/eastern-profile-gold-v11.webp'
import miniatureProfileDrawer from '../assets/balanced-themes/miniature-profile-drawer-v11.webp'

type Props = { title: string; hint: string; index: number; icon: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }

export function ThemeProfileSection({ title, hint, index, icon, expanded, onToggle, children }: Props) {
  const { theme } = useBalancedTheme()
  const ink = useInkWellness()
  const material = !ink ? theme === 'eastern-salon' ? easternProfileGold : theme === 'miniature-world' ? miniatureProfileDrawer : undefined : undefined
  // Native Image reliably renders imported WebP artwork; CSS background URLs
  // can be rejected by the simulator. The whole heading remains the hit area.
  return <View className={`profile-section${ink ? '' : ` tp-section tp-section--${theme}`}${expanded ? ' tp-section--open' : ''}`}>
    <View className='profile-section-heading is-toggle' role='button' aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}${title}`} onClick={onToggle}>
      {material && <Image className='tp-section__material' src={material} mode={theme === 'miniature-world' ? 'scaleToFill' : 'widthFix'} aria-hidden />}
      {!ink && theme === 'natural-symbiosis' && <ThemeSceneImage className='tp-section__drawer' src={BALANCED_SCENES.naturalDrawer} />}
      {ink && <View className='ink-section-icon' aria-hidden><Text className={`iconfont ${icon}`} /></View>}
      {!ink && <View className='tp-section__mark' aria-hidden>
        {theme === 'clarity-order' || theme === 'modern-gallery' || theme === 'picturebook-companion' ? <Text className='tp-section__number'>{String(index).padStart(2, '0')}</Text> : <Text className={`iconfont ${icon}`} />}
      </View>}
      <View className='tp-section__copy'><Text className='profile-section-title'>{title}</Text><Text className='profile-section-hint'>{hint}</Text></View>
      {!ink && theme === 'modern-gallery' ? <View className='tp-section__gallery-control' aria-hidden>
        <View className='tp-section__drawer-pull'>
          <View className='tp-section__pull-inset' />
          <View className='tp-section__pull-grip' />
          <View className='tp-section__pull-screw tp-section__pull-screw--tl' />
          <View className='tp-section__pull-screw tp-section__pull-screw--tr' />
          <View className='tp-section__pull-screw tp-section__pull-screw--bl' />
          <View className='tp-section__pull-screw tp-section__pull-screw--br' />
        </View>
        <View className={`profile-section-chevron${expanded ? ' is-expanded' : ''}`} />
      </View> : <View className={`profile-section-chevron${expanded ? ' is-expanded' : ''}`} />}
    </View>
    {expanded && children}
  </View>
}
