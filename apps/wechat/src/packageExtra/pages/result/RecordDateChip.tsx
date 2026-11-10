import { Picker, Text, View } from '@tarojs/components'
import { getRecordDateLabel, isAllowedRecordDate, isTodayRecordDate, listAllowedRecordDates } from '../../../utils/record-date'

/**
 * 结果页顶部的「今天 · 午餐 ›」：点开选记录日期（近 14 天）。日期不在范围里时不用它，
 * 底栏会显示完整的 RecordDateField 提醒先选日期。已记录的餐只显示、不能改。
 */
export default function RecordDateChip({ date, mealLabel, onChange, disabled = false }: {
  date: string
  mealLabel: string
  onChange: (date: string) => void
  disabled?: boolean
}) {
  const dates = listAllowedRecordDates()
  const dayLabel = isTodayRecordDate(date) && isAllowedRecordDate(date) ? '今天' : getRecordDateLabel(date)
  const chip = (
    <View className={`result-date-chip ${disabled ? 'is-disabled' : ''}`}>
      <Text className='result-date-chip__text'>{dayLabel} · {mealLabel}</Text>
      {!disabled && <Text className='result-date-chip__arrow'>›</Text>}
    </View>
  )
  if (disabled) return chip
  return (
    <Picker
      mode='selector'
      range={dates.map(getRecordDateLabel)}
      value={Math.max(0, dates.indexOf(date))}
      onChange={(event) => {
        const next = dates[Number(event.detail.value)]
        if (next) onChange(next)
      }}
    >
      {chip}
    </Picker>
  )
}
