import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
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
  return <View className='weekly-recap-entry' role='button' onClick={openWeeklyRecap}>
    <View className='weekly-recap-entry__mark'>周</View>
    <View className='weekly-recap-entry__copy'><Text className='weekly-recap-entry__title'>上周回顾</Text><Text className='weekly-recap-entry__description'>{week.start.slice(5).replace('-', '.')} — {week.end.slice(5).replace('-', '.')} · 看看这一周的记录</Text></View>
    <Text className='weekly-recap-entry__arrow'>›</Text>
  </View>
}
