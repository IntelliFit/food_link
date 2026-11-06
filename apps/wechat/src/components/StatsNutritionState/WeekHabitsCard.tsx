import { Text, View } from '@tarojs/components'
import type { WeekDeltaView, WeekHabitRowView } from '../../packageStats/pages/stats/nutrition-state-view'

/** 「本周规律」：每个习惯一行 7 个点 */
export function WeekHabitsCard({ dayLabels, rows, countTexts, headlineDelta, otherDeltas }: {
  dayLabels: string[]
  rows: WeekHabitRowView[]
  countTexts: string[]
  headlineDelta: WeekDeltaView | null
  otherDeltas: WeekDeltaView[]
}) {
  const gridStyle = { gridTemplateColumns: `184rpx repeat(${Math.max(1, dayLabels.length)}, minmax(0, 1fr)) 80rpx` }
  return (
    <View className='stats-card stats-ns-week'>
      <View className='stats-ns-week__head'>
        <Text className='stats-ns-card-head__title'>本周规律</Text>
        {headlineDelta ? <Text className={`stats-ns-chip ${headlineDelta.better ? 'is-better' : 'is-worse'}`}>{headlineDelta.text}</Text> : null}
      </View>
      {rows.length > 0 ? (
        <>
          <View className='stats-ns-week__grid stats-ns-week__days' style={gridStyle}>
            <Text />
            {dayLabels.map((label, index) => <Text key={`${label}-${index}`} className='stats-ns-week__day'>{label}</Text>)}
            <Text />
          </View>
          {rows.map(row => (
            <View key={row.key} className='stats-ns-week__grid stats-ns-week__row' style={gridStyle}>
              <Text className='stats-ns-week__label'>{row.label}</Text>
              {row.cells.map((cell, index) => (
                <View key={index} className='stats-ns-week__cell'>
                  <View className={`stats-ns-dot is-${cell}`} />
                </View>
              ))}
              <Text className={`stats-ns-week__count ${row.warn ? 'is-warn' : ''}`}>{row.countText}</Text>
            </View>
          ))}
        </>
      ) : null}
      {countTexts.length > 0 || otherDeltas.length > 0 ? (
        <View className='stats-ns-week__chips'>
          {countTexts.map(item => <Text key={item} className='stats-ns-chip'>{item}</Text>)}
          {otherDeltas.map(item => <Text key={item.key} className={`stats-ns-chip ${item.better ? 'is-better' : 'is-worse'}`}>{item.text}</Text>)}
        </View>
      ) : null}
      {rows.length > 0 ? (
        <View className='stats-ns-week__legend'>
          <View className='stats-ns-week__legend-item'><View className='stats-ns-dot stats-ns-dot--small is-hit' /><Text>做到了</Text></View>
          <View className='stats-ns-week__legend-item'><View className='stats-ns-dot stats-ns-dot--small is-miss' /><Text>没做到</Text></View>
          <View className='stats-ns-week__legend-item'><View className='stats-ns-dot stats-ns-dot--small is-today' /><Text>今天还在进行</Text></View>
        </View>
      ) : null}
    </View>
  )
}
