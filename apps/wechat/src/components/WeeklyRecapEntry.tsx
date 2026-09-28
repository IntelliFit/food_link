import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { IconChevronRight, IconTrendingUp } from './iconfont'
import { getAccessToken } from '../utils/api'
import { redirectToLogin } from '../utils/withAuth'
import { previousRecapWeek } from '../utils/weekly-recap'
import './WeeklyRecapEntry.scss'

export function openWeeklyRecap(): void {
  if (!getAccessToken()) { redirectToLogin(); return }
  void Taro.navigateTo({ url: '/packageRecap/pages/recap/index' })
}

export function WeeklyRecapEntry() {
  const week = previousRecapWeek()
  const period = `${week.start.slice(5).replace('-', '.')} — ${week.end.slice(5).replace('-', '.')}`

  return (
    <View
      className='weekly-recap-entry'
      role='button'
      aria-label={`查看${period}上周回顾`}
      onClick={openWeeklyRecap}
    >
      <View className='weekly-recap-entry__icon' aria-hidden>
        <IconTrendingUp size={30} color='inherit' />
      </View>
      <View className='weekly-recap-entry__copy'>
        <View className='weekly-recap-entry__heading'>
          <Text className='weekly-recap-entry__title'>上周回顾</Text>
          <Text className='weekly-recap-entry__period'>{period}</Text>
        </View>
        <Text className='weekly-recap-entry__description'>回看饮食、饮水与记录天数</Text>
      </View>
      <View className='weekly-recap-entry__action' aria-hidden>
        <IconChevronRight size={22} color='inherit' />
      </View>
    </View>
  )
}
