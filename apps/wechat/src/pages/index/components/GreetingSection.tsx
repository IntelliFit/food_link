import { View, Text } from '@tarojs/components'
import type { ReactNode } from 'react'
import { getGreeting } from '../utils/helpers'

interface GreetingSectionProps {
  /** 保留既有今日小结能力，当前问候区不展示分享入口。 */
  onSharePress?: () => void
  petAvatar?: ReactNode
  onPetPress?: () => void
  petReminder?: {
    text: string
    tone: 'recognizing' | 'waiting' | 'recorded' | 'meal'
    count?: number
  }
  onPetReminderPress?: () => void
}

export function GreetingSection({ petAvatar, onPetPress, petReminder, onPetReminderPress }: GreetingSectionProps) {
  const { text } = getGreeting()
  const activeTone = petReminder?.tone === 'recognizing' || petReminder?.tone === 'waiting' ? petReminder.tone : ''

  return (
    <View className='greeting-section'>
      <View className={`greeting-main${activeTone ? ` greeting-main--${activeTone}` : ''}`}>
        {petAvatar ? (
          <View id='home-greeting-pet' className='greeting-pet' onClick={onPetPress}>
            {activeTone && <View className='greeting-pet__aura' />}
            <View className='greeting-pet__motion'>{petAvatar}</View>
            <View className='greeting-pet__ground' />
            {activeTone === 'waiting' && <>
              <Text className='greeting-pet__spark greeting-pet__spark--left'>✦</Text>
              <Text className='greeting-pet__spark greeting-pet__spark--right'>✦</Text>
            </>}
          </View>
        ) : null}
        {petReminder ? (
          <View
            id='home-pet-analyze-reminder'
            className={`greeting-pet-reminder greeting-pet-reminder--${petReminder.tone}`}
            onClick={onPetReminderPress}
            role='button'
            aria-label={petReminder.text}
          >
            <Text className='greeting-pet-reminder__text'>{petReminder.text}</Text>
            {activeTone === 'recognizing' && <View className='greeting-pet-reminder__dots'>
              <View /><View /><View />
            </View>}
            {petReminder.count && petReminder.count > 1 ? (
              <Text className='greeting-pet-reminder__count'>{petReminder.count}</Text>
            ) : null}
          </View>
        ) : (
          <View className='greeting-pet-reminder greeting-pet-reminder--default'>
            <Text className='greeting-pet-reminder__text'>{text}，今天也要好好吃饭</Text>
          </View>
        )}
      </View>
    </View>
  )
}
