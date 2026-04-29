import { View, Text } from '@tarojs/components'
import { getGreeting } from '../utils/helpers'

interface GreetingSectionProps {
  /** 登录后点击生成「今日小结」分享图 */
  onSharePress?: () => void
}

export function GreetingSection({ onSharePress }: GreetingSectionProps) {
  const { text, iconClass } = getGreeting()

  return (
    <View className='greeting-section'>
      <View className='greeting-text'>
        <View className='greeting-title'>
          <Text className={`iconfont ${iconClass} greeting-title-icon`} />
          <Text>{text}</Text>
        </View>
        <Text className='greeting-subtitle'>今天也要健康饮食哦</Text>
      </View>
      {/* 右上角分享按钮已隐藏 */}
      {/* <View
        className={`greeting-icon ${onSharePress ? 'greeting-icon--tappable' : ''}`}
        onClick={() => onSharePress?.()}
      >
        <Text className='iconfont icon-share' />
      </View> */}
    </View>
  )
}
