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

  return (
    <View className='greeting-section'>
      <View className='greeting-main'>
        {petAvatar ? (
          <View id='home-greeting-pet' className='greeting-pet' onClick={onPetPress}>
            <View className='greeting-pet__motion'>{petAvatar}</View>
            <View className='greeting-pet__ground' />
          </View>
        ) : null}
        {petReminder ? (
          <View
            id='home-pet-analyze-reminder'
            className={`greeting-pet-reminder greeting-pet-reminder--${petReminder.tone}`}
            onClick={onPetReminderPress}
          >
            <Text className='greeting-pet-reminder__text'>{petReminder.text}</Text>
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
