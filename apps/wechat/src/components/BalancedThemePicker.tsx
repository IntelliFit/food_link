import { Image, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import React from 'react'
import { useBalancedTheme } from './BalancedThemeContext'
import {
  BALANCED_THEME_DEFINITIONS,
  type BalancedThemeId,
  getBalancedThemeDefinition,
} from '../utils/balanced-theme'

import clarityOrder from '../assets/balanced-themes/01-clarity-order-v2.webp'
import naturalSymbiosis from '../assets/balanced-themes/02-natural-symbiosis-v2.webp'
import easternSalon from '../assets/balanced-themes/03-eastern-salon-v2.webp'
import modernGallery from '../assets/balanced-themes/04-modern-gallery-v2.webp'
import miniatureWorld from '../assets/balanced-themes/05-miniature-world-v2.webp'
import picturebookCompanion from '../assets/balanced-themes/06-picturebook-companion-v2.webp'
import clearCare from '../assets/balanced-themes/07-clear-care-v2.webp'
import wayOfWater from '../assets/balanced-themes/08-way-of-water-v2.webp'

import './BalancedThemePicker.scss'

const THEME_PREVIEWS: Record<BalancedThemeId, string> = {
  'clarity-order': clarityOrder,
  'natural-symbiosis': naturalSymbiosis,
  'eastern-salon': easternSalon,
  'modern-gallery': modernGallery,
  'miniature-world': miniatureWorld,
  'picturebook-companion': picturebookCompanion,
  'clear-care': clearCare,
  'way-of-water': wayOfWater,
}

export function BalancedThemeEntry({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const { theme } = useBalancedTheme()
  const current = getBalancedThemeDefinition(theme)

  return (
    <View
      id='profile-balanced-theme-entry'
      className='balanced-theme-entry'
      role='button'
      aria-label={`当前均衡模式主题${current.name}，点击切换`}
      hoverClass='is-pressed'
      onClick={onOpen}
    >
      <Image className='balanced-theme-entry__preview' src={THEME_PREVIEWS[theme]} mode='aspectFill' />
      <View className='balanced-theme-entry__copy'>
        <Text className='balanced-theme-entry__eyebrow'>均衡模式主题</Text>
        <Text className='balanced-theme-entry__title'>{current.name}</Text>
        <Text className='balanced-theme-entry__subtitle'>{current.subtitle}</Text>
      </View>
      <View className='balanced-theme-entry__action'><Text>切换</Text></View>
    </View>
  )
}

type BalancedThemePickerProps = {
  visible: boolean
  wellnessActive: boolean
  onClose: () => void
}

export function BalancedThemePicker({ visible, wellnessActive, onClose }: BalancedThemePickerProps): React.ReactElement | null {
  const { theme, setTheme } = useBalancedTheme()
  if (!visible) return null

  const selectTheme = (next: BalancedThemeId) => {
    setTheme(next)
    const selected = getBalancedThemeDefinition(next)
    Taro.showToast({
      title: wellnessActive ? `已保存${selected.name}` : `已切换至${selected.name}`,
      icon: 'none',
    })
  }

  return (
    <View className='balanced-theme-picker' catchMove>
      <View className='balanced-theme-picker__mask' onClick={onClose} />
      <View className='balanced-theme-picker__panel'>
        <View className='balanced-theme-picker__header'>
          <View>
            <Text className='balanced-theme-picker__title'>选择均衡模式主题</Text>
            <Text className='balanced-theme-picker__subtitle'>八种风格共用真实数据与功能，只改变视觉和阅读节奏</Text>
          </View>
          <View className='balanced-theme-picker__done' onClick={onClose}><Text>完成</Text></View>
        </View>
        {wellnessActive && (
          <View className='balanced-theme-picker__notice'>
            <Text>当前处于养生模式，选择会先保存；切回均衡模式后生效。</Text>
          </View>
        )}
        <ScrollView scrollY className='balanced-theme-picker__scroll'>
          <View className='balanced-theme-picker__grid'>
            {BALANCED_THEME_DEFINITIONS.map((item) => {
              const selected = item.id === theme
              return (
                <View
                  key={item.id}
                  id={`balanced-theme-option-${item.id}`}
                  className={`balanced-theme-option${selected ? ' is-selected' : ''}`}
                  role='button'
                  aria-label={`${selected ? '当前主题' : '选择主题'}${item.name}`}
                  onClick={() => selectTheme(item.id)}
                >
                  <Image className='balanced-theme-option__preview' src={THEME_PREVIEWS[item.id]} mode='aspectFill' />
                  <View className='balanced-theme-option__body'>
                    <View className='balanced-theme-option__title-row'>
                      <Text className='balanced-theme-option__title'>{item.name}</Text>
                      {selected && <Text className='balanced-theme-option__selected'>已选</Text>}
                    </View>
                    <Text className='balanced-theme-option__subtitle'>{item.subtitle}</Text>
                    <Text className='balanced-theme-option__audience'>{item.audience}</Text>
                    <View className='balanced-theme-option__meta'>
                      <View className='balanced-theme-option__swatches'>
                        {item.swatches.map((color) => <View key={color} style={{ backgroundColor: color }} />)}
                      </View>
                      <Text>{item.toolboxLabel}</Text>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
          <View className='balanced-theme-picker__bottom-space' />
        </ScrollView>
      </View>
    </View>
  )
}
