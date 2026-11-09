import { Text, View } from '@tarojs/components'
import type { WeekDeltaView, WeekHabitRowView } from '../../utils/nutrition-state-view'

/** 「这周的规律」：每个习惯一行，每天一个点，最后是做到几天 */
export function WeekHabitsCard({ dayLabels, rows, headlineDelta }: {
  dayLabels: string[]
  rows: WeekHabitRowView[]
  headlineDelta: WeekDeltaView | null
}) {
  const gridStyle = { gridTemplateColumns: `minmax(0, 1fr) repeat(${Math.max(1, dayLabels.length)}, 36rpx) 68rpx` }
  return (
    <View className='sa-card'>
      <View className='sa-card__title'>
        <Text className='sa-card__name'>这周的规律</Text>
        {headlineDelta ? <Text className='sa-card__side'>{headlineDelta.text}</Text> : null}
      </View>
      <View className='sa-habits' style={gridStyle}>
        <Text />
        {dayLabels.map((label, index) => <Text key={`d-${index}`} className='sa-habits__day'>{label}</Text>)}
        <Text />
        {rows.map(row => [
          <Text key={`${row.key}-label`} className='sa-habits__label'>{row.label}</Text>,
          ...row.cells.map((cell, index) => <View key={`${row.key}-${index}`} className={`sa-dot is-${cell}`} />),
          <Text key={`${row.key}-count`} className={`sa-habits__count ${row.warn ? 'is-bad' : ''}`}>{row.countText}</Text>,
        ])}
      </View>
    </View>
  )
}
