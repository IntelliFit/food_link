import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'

function PetKitchenPage() {
  useDidShow(() => { void Taro.redirectTo({ url: '/packagePetStudio/pages/index/index' }) })
  return <View className='pet-route-transition' aria-label='正在打开伙伴时光' />
}
export default withAuth(PetKitchenPage)
