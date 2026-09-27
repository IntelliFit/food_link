import { Text, View } from '@tarojs/components'
import React from 'react'
import { type BalancedThemeId, getBalancedThemeDefinition } from '../utils/balanced-theme'

import './BalancedThemeReveal.scss'

type BalancedThemeRevealProps = {
  theme: BalancedThemeId | null
  savedOnly?: boolean
}

const REVEAL_LINES: Record<BalancedThemeId, string> = {
  'clarity-order': '信息归位，秩序即刻建立',
  'natural-symbiosis': '一片叶子，正在长成你的日常',
  'eastern-salon': '生活入卷，留白也有分寸',
  'modern-gallery': '打散惯性，重新观看今天',
  'miniature-world': '缩小世界，放大每次发现',
  'picturebook-companion': '翻开下一页，把日常读成故事',
  'clear-care': '重要的内容，现在一眼可见',
  'way-of-water': '不争其形，顺势抵达',
}

function RevealArtwork({ theme }: { theme: BalancedThemeId }): React.ReactElement {
  if (theme === 'clarity-order') {
    return <View className='bt-reveal__clarity'><View /><View /><View /><View /></View>
  }
  if (theme === 'natural-symbiosis') {
    return <View className='bt-reveal__nature'><View className='bt-reveal__stem' /><View className='bt-reveal__leaf bt-reveal__leaf--one' /><View className='bt-reveal__leaf bt-reveal__leaf--two' /><View className='bt-reveal__leaf bt-reveal__leaf--three' /></View>
  }
  if (theme === 'eastern-salon') {
    return <View className='bt-reveal__scroll'><View className='bt-reveal__scroll-roller' /><View className='bt-reveal__scroll-paper'><Text>食有节</Text><Text>心有度</Text></View><View className='bt-reveal__scroll-roller' /></View>
  }
  if (theme === 'modern-gallery') {
    return <View className='bt-reveal__gallery'><View className='bt-reveal__block bt-reveal__block--blue' /><View className='bt-reveal__block bt-reveal__block--yellow' /><View className='bt-reveal__block bt-reveal__block--red' /><View className='bt-reveal__block bt-reveal__block--black' /></View>
  }
  if (theme === 'miniature-world') {
    return <View className='bt-reveal__miniature'><View className='bt-reveal__island'><View className='bt-reveal__river' /><View className='bt-reveal__mini-tree bt-reveal__mini-tree--one' /><View className='bt-reveal__mini-tree bt-reveal__mini-tree--two' /><View className='bt-reveal__traveler' /></View></View>
  }
  if (theme === 'picturebook-companion') {
    return <View className='bt-reveal__book'><View className='bt-reveal__book-page bt-reveal__book-page--left'><Text>今</Text></View><View className='bt-reveal__book-page bt-reveal__book-page--right'><Text>日</Text></View></View>
  }
  if (theme === 'clear-care') {
    return <View className='bt-reveal__care'><View className='bt-reveal__care-index'><Text>01</Text></View><View className='bt-reveal__care-line'><View /><View /></View><View className='bt-reveal__care-arrow'><Text>→</Text></View></View>
  }
  return <View className='bt-reveal__water'><View className='bt-reveal__drop' /><View className='bt-reveal__wave bt-reveal__wave--one' /><View className='bt-reveal__wave bt-reveal__wave--two' /><View className='bt-reveal__wave bt-reveal__wave--three' /></View>
}

export function BalancedThemeReveal({ theme, savedOnly = false }: BalancedThemeRevealProps): React.ReactElement | null {
  if (!theme) return null
  const definition = getBalancedThemeDefinition(theme)

  return (
    <View className={`bt-reveal bt-reveal--${theme}`} role='status' aria-label={`${definition.name}主题${savedOnly ? '已保存' : '已启用'}`}>
      <View className='bt-reveal__light' />
      <RevealArtwork theme={theme} />
      <View className='bt-reveal__copy'>
        <Text className='bt-reveal__eyebrow'>{savedOnly ? '主题已保存' : '主题已启用'}</Text>
        <Text className='bt-reveal__title'>{definition.name}</Text>
        <Text className='bt-reveal__line'>{REVEAL_LINES[theme]}</Text>
      </View>
    </View>
  )
}
