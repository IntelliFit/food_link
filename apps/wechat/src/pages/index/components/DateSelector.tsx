import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { type WeekHeatmapCell } from '../types'

const HOME_SELECTED_DATE_KEY = 'home_selected_date_v1'

interface DateSelectorProps {
  cells: WeekHeatmapCell[]
  selectedDate: string
  onSelect: (date: string) => void
}

export function DateSelector({ cells, selectedDate, onSelect }: DateSelectorProps) {
  const handleSelect = (date: string) => {
    try {
      Taro.setStorageSync(HOME_SELECTED_DATE_KEY, date)
    } catch (_) {}
    onSelect(date)
  }

  return (
    <View className='date-selector-section'>
      <View className='date-list'>
        {cells.map((cell) => {
          // 计算圆圈颜色状态
          // 无记录: 白色, 有记录未超目标: 绿色, 超过目标: 红色
          let circleClass = 'is-empty'  // 默认无记录白色
          const hasRecord = cell.hasRecord ?? cell.calories > 0
          if (hasRecord) {
            if (cell.calories > cell.target) {
              circleClass = 'is-over'  // 超过目标红色
            } else {
              circleClass = 'is-recorded'  // 有记录未超过绿色
            }
          }
          
          return (
            <View
              key={cell.date}
              className={`date-item ${selectedDate === cell.date ? 'is-selected' : ''}`}
              onClick={() => handleSelect(cell.date)}
            >
              <Text className='date-day-name'>{cell.dayName}</Text>
              <View className={`date-day-circle ${circleClass}`}>
                <Text className='date-num-text'>{cell.dayNum}</Text>
              </View>
            </View>
          )
        })}
      </View>
    </View>
  )
}
