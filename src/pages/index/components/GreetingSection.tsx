import { View, Text } from '@tarojs/components'
import { getGreeting } from '../utils/helpers'

interface GreetingSectionProps {
  /** 登录后点击生成「今日小结」分享图 */
  onSharePress?: () => void
}

export function GreetingSection({ onSharePress }: GreetingSectionProps) {
  return (
    <View className='greeting-section'>
      <View className='greeting-text'>
        <Text className='greeting-title'>{getGreeting()}</Text>
        <Text className='greeting-subtitle'>今天也要健康饮食哦</Text>
      </View>
      <View
        className={`greeting-icon ${onSharePress ? 'greeting-icon--tappable' : ''}`}
        onClick={() => onSharePress?.()}
      >
        <Text className='iconfont icon-share' />
      </View>
    </View>
  )
}
