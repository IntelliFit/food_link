import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import './index.scss'

export function FoodContributionRankEntry() {
  return (
    <View
      className='food-contribution-rank-entry'
      aria-label='查看食物贡献榜'
      onClick={(event) => {
        event.stopPropagation()
        void Taro.navigateTo({ url: extraPkgUrl('/pages/checkin-leaderboard/index?section=user&ranking=contribution') })
      }}
    >
      <Text className='iconfont icon-shiwu food-contribution-rank-entry__icon' />
      <View className='food-contribution-rank-entry__copy'>
        <Text className='food-contribution-rank-entry__title'>食物贡献榜</Text>
        <Text className='food-contribution-rank-entry__desc'>一起共建食物数据库</Text>
      </View>
      <Text className='food-contribution-rank-entry__link'>查看榜单 ›</Text>
    </View>
  )
}
