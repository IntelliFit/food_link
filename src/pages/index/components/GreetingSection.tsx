import { View, Text } from '@tarojs/components'
import { IconTrendingUp } from '../../../components/iconfont'
import { getGreeting } from '../utils/helpers'

export function GreetingSection() {
  return (
    <View className='greeting-section'>
      <View className='greeting-text'>
        <Text className='greeting-title'>{getGreeting()}</Text>
        <Text className='greeting-subtitle'>今天也要健康饮食哦</Text>
      </View>
      <View className='greeting-icon'>
        <IconTrendingUp size={24} color='#00bc7d' />
      </View>
    </View>
  )
}
