import { View, Text } from '@tarojs/components'
import { type WeekHeatmapCell } from '../types'

interface DateSelectorProps {
  cells: WeekHeatmapCell[]
  selectedDate: string
  onSelect: (date: string) => void
}

export function DateSelector({ cells, selectedDate, onSelect }: DateSelectorProps) {
  return (
    <View className='date-selector-section'>
      <View className='date-list'>
        {cells.map((cell) => {
          // 计算圆圈颜色状态
          // 无记录: 白色, 有记录未超目标: 绿色, 超过目标: 红色
          let circleClass = 'is-empty'  // 默认无记录白色
          if (cell.calories > 0) {
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
              onClick={() => onSelect(cell.date)}
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
