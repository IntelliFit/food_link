import { View, Text } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import './index.scss'

const TARGET_URL = '/pages/expiry/index'

function LegacyFoodExpiryRedirectPage() {
  useDidShow(() => {
    Taro.redirectTo({ url: TARGET_URL })
      .catch(() => Taro.navigateTo({ url: TARGET_URL }))
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
