import { View, Text } from '@tarojs/components'
import type { ReactNode } from 'react'
import type { HomeExperienceMode } from '../../../utils/home-experience'
import { getGreeting } from '../utils/helpers'

interface GreetingSectionProps {
  /** 保留既有今日小结能力，当前问候区不展示分享入口。 */
  onSharePress?: () => void
  mode: HomeExperienceMode
  onModeToggle: () => void
  petAvatar?: ReactNode
  onPetPress?: () => void
}

export function GreetingSection({ mode, onModeToggle, petAvatar, onPetPress }: GreetingSectionProps) {
  const { text, iconClass } = getGreeting()
  const isWellness = mode === 'wellness'

  return (
    <View className='greeting-section'>
      <View className='greeting-main'>
        {petAvatar ? (
          <View id='home-greeting-pet' className='greeting-pet' onClick={onPetPress}>
            <View className='greeting-pet__motion'>{petAvatar}</View>
            <View className='greeting-pet__ground' />
          </View>
        ) : null}
        <View className='greeting-text'>
          <View className='greeting-title'>
            <Text className={`iconfont ${iconClass} greeting-title-icon`} />
            <Text>{text}</Text>
          </View>
          <Text className='greeting-subtitle'>今天也要健康饮食哦</Text>
        </View>
      </View>
      <View
        id='home-mode-toggle'
        className={`greeting-mode-toggle greeting-mode-toggle--${mode}`}
        onClick={onModeToggle}
      >
        <Text className='greeting-mode-toggle__label'>{isWellness ? '养生' : '均衡'}</Text>
        <Text className='greeting-mode-toggle__switch'>⇄</Text>
      </View>
    </View>
  )
}
