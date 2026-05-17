import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import './index.scss'

function LegacyFoodExpiryRedirectPage() {
  useDidShow(() => {
    Taro.switchTab({ url: '/pages/expiry/index' })
      .catch(() => Taro.switchTab({ url: '/pages/profile/index' }))
      .catch(() => {})
  })

  return (
    <View className='legacy-food-expiry-page'>
      <Text className='legacy-food-expiry-text'>正在跳转到食材保质期页面...</Text>
    </View>
  )
}

export default LegacyFoodExpiryRedirectPage
