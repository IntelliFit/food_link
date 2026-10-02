import { View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'

/** Cached links continue to work; only the unified account ledger may receive new results. */
function PetAdventurePage() {
  useDidShow(() => { void Taro.redirectTo({ url: '/packagePetStudio/pages/index/index?game=adventure' }) })
  return <View className='pet-route-transition' aria-label='正在打开伙伴冒险' />
}
export default withAuth(PetAdventurePage)
