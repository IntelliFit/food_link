import { Picker, Text, View } from '@tarojs/components'
import { getRecordDateLabel, getTodayRecordDateKey, isAllowedRecordDate, listAllowedRecordDates, RECORD_BACKFILL_WINDOW_DAYS } from '../utils/record-date'
import { isCalendarRecordDate, rememberRecordReturnDate } from '../utils/record-navigation'
import './RecordDateField.scss'

export default function RecordDateField({ date, onChange, disabled = false, unrestricted = false }: {
  date: string
  onChange: (date: string) => void
  disabled?: boolean
  unrestricted?: boolean
}) {
  const dates = listAllowedRecordDates()
  const valid = unrestricted ? isCalendarRecordDate(date) : isAllowedRecordDate(date)
  const options = valid ? dates : ['', ...dates]
  const change = (nextDate: string) => {
    if (!nextDate || disabled) return
    rememberRecordReturnDate(nextDate)
    onChange(nextDate)
  }
  const past = valid && date !== getTodayRecordDateKey()
  const content = (
    <View className={`record-date-field${valid ? '' : ' record-date-field--required'}`}>
      <Text className='record-date-field__label'>{valid ? `${past ? '正在补录' : '记录今天'} · ${getRecordDateLabel(date)}` : date ? `${getRecordDateLabel(date)}已超出补录范围，请选择日期` : `请选择记录日期（仅近${RECORD_BACKFILL_WINDOW_DAYS}天）`}</Text>
      {!disabled && <Text>切换日期 ›</Text>}
    </View>
  )
  return (
    <View className={`record-date-bar${past ? ' record-date-bar--backfill' : ''}`}>
      {unrestricted
        ? <Picker mode='date' value={date} end={getTodayRecordDateKey()} disabled={disabled} onChange={event => change(event.detail.value)}>{content}</Picker>
        : <Picker mode='selector' range={options.map(getRecordDateLabel)} value={Math.max(0, options.indexOf(date))} disabled={disabled} onChange={event => change(options[Number(event.detail.value)])}>{content}</Picker>}
      {past && !disabled && <View className='record-date-field__today' role='button' onClick={() => change(getTodayRecordDateKey())}><Text>回到今天</Text></View>}
    </View>
  )
}
