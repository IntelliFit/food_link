import { View, Text } from '@tarojs/components'
import type { ReactNode } from 'react'
import type { HomeExperienceMode } from '../../../utils/home-experience'
import { InkHomeHero } from '../../../components/InkWellness'
import { getGreeting } from '../utils/helpers'

interface GreetingSectionProps {
  /** 保留既有今日小结能力，当前问候区不展示分享入口。 */
  onSharePress?: () => void
  current?: number
  target?: number
  date?: string
  onTarget?: () => void
  mode: HomeExperienceMode
  onModeToggle: () => void
  petAvatar?: ReactNode
  onPetPress?: () => void
  petReminder?: {
    text: string
    tone: 'recognizing' | 'waiting' | 'recorded' | 'meal' | 'messages'
    count?: number
  }
  onPetReminderPress?: () => void
}

export function GreetingSection({ current, target, date, onTarget, mode, onModeToggle, petAvatar, onPetPress, petReminder, onPetReminderPress }: GreetingSectionProps) {
  const { text, iconClass } = getGreeting()
  const isWellness = mode === 'wellness'

  if (isWellness) return <InkHomeHero current={current} target={target} date={date} onTarget={onTarget} onModeToggle={onModeToggle} reminder={petReminder?.text} onReminder={onPetReminderPress} />

  return (
    <View className={`greeting-section${isWellness ? ' greeting-section--taiji' : ''}`}>
      <View className='greeting-main'>
        {petAvatar ? (
          <View id='home-greeting-pet' className='greeting-pet' onClick={onPetPress}>
            <View className='greeting-pet__motion'>{petAvatar}</View>
            <View className='greeting-pet__ground' />
          </View>
        ) : null}
        {petReminder ? (
          <View
            id={petReminder.tone === 'messages' ? 'home-pet-message-reminder' : 'home-pet-analyze-reminder'}
            className={`greeting-pet-reminder greeting-pet-reminder--${petReminder.tone}`}
            onClick={onPetReminderPress}
          >
            <Text className='greeting-pet-reminder__text'>{petReminder.text}</Text>
            {petReminder.count && petReminder.count > 1 ? (
              <Text className='greeting-pet-reminder__count'>{petReminder.count}</Text>
            ) : null}
          </View>
        ) : (
          <View className='greeting-text'>
            <View className='greeting-title'>
              <Text className={`iconfont ${iconClass} greeting-title-icon`} />
              <Text>{text}</Text>
            </View>
            <Text className='greeting-subtitle'>{isWellness ? '三餐有节，起居有常' : '今天也要健康饮食哦'}</Text>
          </View>
        )}
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
