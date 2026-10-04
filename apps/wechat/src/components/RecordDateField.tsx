import { Picker, Text, View } from '@tarojs/components'
import { getRecordDateLabel, isAllowedRecordDate, listAllowedRecordDates } from '../utils/record-date'
import './RecordDateField.scss'

export default function RecordDateField({ date, onChange, disabled = false }: {
  date: string
  onChange: (date: string) => void
  disabled?: boolean
}) {
  const dates = listAllowedRecordDates()
  const valid = isAllowedRecordDate(date)
  const options = valid ? dates : ['', ...dates]
  return (
    <Picker mode='selector' range={options.map(getRecordDateLabel)} value={Math.max(0, options.indexOf(date))} disabled={disabled}
      onChange={event => {
        const nextDate = options[Number(event.detail.value)]
        if (nextDate) onChange(nextDate)
      }}
    >
      <View className={`record-date-field${valid ? '' : ' record-date-field--required'}`}>
        <Text>{valid ? `记录到 ${getRecordDateLabel(date)}` : date ? `${getRecordDateLabel(date)}已超出补录范围，请选择日期` : '请选择记录日期（仅近3天）'}</Text>
        {!disabled && <Text>更改 ›</Text>}
      </View>
    </Picker>
  )
}
