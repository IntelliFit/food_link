import { Text, View } from '@tarojs/components'
import type { NextMealView, TodayRowView } from '../../packageStats/pages/stats/nutrition-state-view'

function TodayRow({ row }: { row: TodayRowView }) {
  if (!row.known) {
    return (
      <View className='stats-ns-today-row'>
        <View className='stats-ns-today-row__line'><Text className='stats-ns-today-row__label'>{row.label}</Text></View>
        <View className='stats-ns-today-row__unknown'><Text>{row.note}</Text></View>
      </View>
    )
  }
  return (
    <View className='stats-ns-today-row'>
      <View className='stats-ns-today-row__line'>
        <View className='stats-ns-today-row__label-wrap'>
          <Text className='stats-ns-today-row__label'>{row.label}</Text>
          {row.badge ? <Text className={`stats-ns-today-row__badge is-${row.tone}`}>{row.badge}</Text> : null}
        </View>
        <Text className='stats-ns-today-row__amount'>
          <Text className='stats-ns-today-row__value'>{row.valueText}</Text>
          {` ${row.targetText}`}{row.gapText ? ` · ${row.gapText}` : ''}
        </Text>
      </View>
      <View className='stats-ns-today-row__track'>
        <View className={`stats-ns-today-row__fill is-${row.tone}`} style={{ width: `${row.percent}%` }} />
      </View>
      {row.note ? <Text className='stats-ns-today-row__note'>{row.note}</Text> : null}
    </View>
  )
}

/** 「今天还差什么」+「晚餐这样补」 */
export function TodayGapsCard({ metaText, planText, rows, nextMeal, petName, onAskPet, onOpenNextMeal }: {
  metaText: string
  planText: string
  rows: TodayRowView[]
  nextMeal: NextMealView | null
  petName: string
  onAskPet: () => void
  onOpenNextMeal: () => void
}) {
  return (
    <View className='stats-card stats-ns-today'>
      <View className='stats-ns-card-head'>
        <View className='stats-ns-card-head__line'>
          <Text className='stats-ns-card-head__title'>今天还差什么</Text>
          <Text className='stats-ns-card-head__meta'>{metaText}</Text>
        </View>
        {planText ? <Text className='stats-ns-card-head__sub'>{planText}</Text> : null}
      </View>
      {rows.map(row => <TodayRow key={row.key} row={row} />)}
      {nextMeal ? (
        <View className='stats-ns-next-meal'>
          <Text className='stats-ns-next-meal__title'>{nextMeal.title}</Text>
          <Text className='stats-ns-next-meal__advice'>{nextMeal.advice}</Text>
          <View className='stats-ns-next-meal__actions'>
            <View className='stats-ns-btn stats-ns-btn--primary' aria-role='button' onClick={onAskPet}>
              <Text>让{petName}挑一份</Text>
            </View>
            <View className='stats-ns-btn' aria-role='button' onClick={onOpenNextMeal}>
              <Text>看下一餐推荐</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
