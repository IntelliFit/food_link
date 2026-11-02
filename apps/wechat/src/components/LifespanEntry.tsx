import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { IconChevronRight, IconTrendingUp } from './iconfont'
import './WeeklyRecapEntry.scss'

/** Standalone tool entry on the profile page; shares the weekly recap entry's look to stay tiny. */
export function LifespanEntry() {
  return (
    <View
      className='weekly-recap-entry'
      role='button'
      aria-label='打开寿命预测器'
      onClick={() => void Taro.navigateTo({ url: '/packageLifespan/pages/predictor/index' })}
    >
      <View className='weekly-recap-entry__icon' aria-hidden>
        <IconTrendingUp size={30} color='inherit' />
      </View>
      <View className='weekly-recap-entry__copy'>
        <View className='weekly-recap-entry__heading'>
          <Text className='weekly-recap-entry__title'>寿命预测器</Text>
          <Text className='weekly-recap-entry__period'>模拟估算，不用于诊断</Text>
        </View>
        <Text className='weekly-recap-entry__description'>每天一个苹果能多活多久？30 秒算一下</Text>
      </View>
      <View className='weekly-recap-entry__action' aria-hidden>
        <IconChevronRight size={22} color='inherit' />
      </View>
    </View>
  )
}
