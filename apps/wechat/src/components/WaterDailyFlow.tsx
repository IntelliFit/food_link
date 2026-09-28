import { Image, Text, View } from '@tarojs/components'
import * as React from 'react'
import waterDrop from '../assets/balanced-themes/water-drop-v6.webp'

type DailyValue = { date: string; calories: number }
type DailyWater = { date: string; total: number }
type Props = {
  endDate: string
  days?: DailyValue[]
  water?: DailyWater[]
  guest?: boolean
  onRecord: () => void
}

/** Calendar slots, not fabricated samples. Missing records remain unknown. */
export function waterFlowDays(endDate: string, days: DailyValue[] = [], water: DailyWater[] = []) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? new Date(`${endDate}T12:00:00`) : new Date()
  const end = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const positive = (value: number | undefined) => Number.isFinite(value) && Number(value) > 0 ? Math.round(Number(value)) : null
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end)
    day.setDate(end.getDate() - 6 + index)
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    return { date, calories: positive(days.find(item => item.date === date)?.calories), waterMl: positive(water.find(item => item.date === date)?.total) }
  })
}

export function WaterDailyFlow({ endDate, days, water, guest = false, onRecord }: Props) {
  const entries = waterFlowDays(endDate, guest ? [] : days, guest ? [] : water)
  const [selectedDate, setSelectedDate] = React.useState('')
  const selected = entries.find(item => item.date === selectedDate) || entries[entries.length - 1]
  const recordDays = entries.filter(item => item.calories !== null).length
  return <View className='water-daily-flow' id='water-daily-flow'>
    <View className='water-daily-flow__heading'><Text>七日 · 点滴</Text><Text>{guest ? '等待你的第一笔' : `${recordDays} 天饮食记录`}</Text></View>
    <Text className='water-daily-flow__hint'>轻触水珠，回看那一天</Text>
    <View className='water-daily-flow__days'>
      {entries.map((day, index) => {
        const recorded = day.calories !== null || day.waterMl !== null
        return <View key={day.date} id={`water-day-${index}`} role='button' aria-label={`${day.date}，${recorded ? '有记录' : '暂无记录'}，查看详情`} aria-pressed={selected.date === day.date}
          className={`water-daily-flow__day${selected.date === day.date ? ' is-selected' : ''}${recorded ? ' is-recorded' : ''}`}
          hoverClass='water-daily-flow__day--pressed' onClick={() => setSelectedDate(day.date)}
        >
          <View className='water-daily-flow__orb'><Image src={waterDrop} mode='aspectFit' /><Text>{recorded ? '有记' : '待记'}</Text></View>
          <Text className='water-daily-flow__date'>{day.date.slice(5).replace('-', '.')}</Text>
        </View>
      })}
    </View>
    <View className='water-daily-flow__detail' aria-live='polite'>
      <View className='water-daily-flow__detail-title'><Text>{selected.date.slice(5).replace('-', ' / ')}</Text><Text>{guest ? '属于你的日常，等你写下' : '这一天，留下的点滴'}</Text></View>
      <View className='water-daily-flow__metrics'>
        <View><Text>饮食摄入</Text><Text>{selected.calories === null ? '暂无记录' : `${selected.calories} kcal`}</Text></View>
        <View><Text>饮水记录</Text><Text>{selected.waterMl === null ? '暂无记录' : `${selected.waterMl} ml`}</Text></View>
      </View>
      <Text className='water-daily-flow__note'>留白也是日常的一部分，从下一次记录开始。</Text>
      <View role='button' className='water-daily-flow__record' onClick={onRecord}>{guest ? '登录，开始记录' : '回首页记录'}<Text> →</Text></View>
    </View>
  </View>
}
