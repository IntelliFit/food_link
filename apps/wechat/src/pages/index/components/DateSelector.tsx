import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import React from 'react'
import { type WeekHeatmapCell } from '../types'
import {
  buildCalendarRecordMap,
  buildCenteredWeekCells,
  buildMonthCalendarCells,
  formatCalendarMonthLabel,
  getCalendarMonthKey,
  shiftCalendarMonth,
} from '../utils/home-calendar'

const HOME_SELECTED_DATE_KEY = 'home_selected_date_v1'

interface DateSelectorProps {
  cells: WeekHeatmapCell[]
  historyCells?: WeekHeatmapCell[]
  selectedDate: string
  onSelect: (date: string) => void
  onVisibleMonthChange?: (month: string) => void
  monthLoading?: boolean
  monthLoadError?: boolean
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

function getCircleClass(cell?: WeekHeatmapCell): string {
  const hasRecord = cell?.hasRecord ?? Number(cell?.calories || 0) > 0
  if (!hasRecord) return 'is-empty'
  return Number(cell?.calories || 0) > Number(cell?.target || 0) ? 'is-over' : 'is-recorded'
}

export function DateSelector({ cells, historyCells = [], selectedDate, onSelect, onVisibleMonthChange, monthLoading = false, monthLoadError = false }: DateSelectorProps) {
  const todayKey = React.useMemo(() => {
    const today = new Date()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    return `${today.getFullYear()}-${month}-${day}`
  }, [])
  const [expanded, setExpanded] = React.useState(false)
  const [visibleMonth, setVisibleMonth] = React.useState(() => getCalendarMonthKey(selectedDate))

  const recordMap = React.useMemo(
    () => buildCalendarRecordMap([...historyCells, ...cells]),
    [cells, historyCells]
  )
  const weekCells = React.useMemo(
    () => buildCenteredWeekCells(selectedDate, recordMap, todayKey),
    [recordMap, selectedDate, todayKey]
  )
  const monthCells = React.useMemo(
    () => buildMonthCalendarCells(visibleMonth, recordMap, todayKey),
    [recordMap, todayKey, visibleMonth]
  )
  const currentMonth = getCalendarMonthKey(todayKey)
  const isCurrentMonth = visibleMonth >= currentMonth

  const handleSelect = (date: string) => {
    if (!date || date > todayKey) return
    try {
      Taro.setStorageSync(HOME_SELECTED_DATE_KEY, date)
    } catch (_) {}
    onSelect(date)
  }

  const toggleExpanded = () => {
    if (!expanded) {
      const selectedMonth = getCalendarMonthKey(selectedDate)
      setVisibleMonth(selectedMonth)
      onVisibleMonthChange?.(selectedMonth)
    }
    setExpanded(value => !value)
  }

  const showMonth = (offset: number) => {
    const nextMonth = shiftCalendarMonth(visibleMonth, offset)
    setVisibleMonth(nextMonth)
    onVisibleMonthChange?.(nextMonth)
  }

  const titleMonth = expanded ? visibleMonth : getCalendarMonthKey(selectedDate)

  return (
    <View className={`date-selector-section ${expanded ? 'is-calendar-expanded' : ''}`}>
      <View className='date-calendar-toolbar'>
        {expanded ? (
          <View className='date-calendar-nav' onClick={() => showMonth(-1)}>
            <Text>‹</Text>
          </View>
        ) : <View className='date-calendar-nav is-placeholder' />}
        <View className='date-calendar-title' onClick={toggleExpanded}>
          <Text className='date-calendar-title__text'>{formatCalendarMonthLabel(titleMonth)}</Text>
        </View>
        {expanded ? (
          <View
            className={`date-calendar-nav ${isCurrentMonth ? 'is-disabled' : ''}`}
            onClick={() => {
              if (!isCurrentMonth) showMonth(1)
            }}
          >
            <Text>›</Text>
          </View>
        ) : <View className='date-calendar-toggle' onClick={toggleExpanded}><Text>月历</Text></View>}
      </View>

      {expanded ? (
        <View className='month-calendar'>
          {monthLoading ? (
            <View className='month-calendar-status' aria-label='月历数据加载中'>
              <View className='loading-spinner month-calendar-spinner' />
            </View>
          ) : monthLoadError ? (
            <View className='month-calendar-status is-error'>
              <Text>月历数据加载失败，请切换月份重试</Text>
            </View>
          ) : (<>
          <View className='month-calendar-weekdays'>
            {WEEKDAY_LABELS.map(label => <Text key={label} className='month-calendar-weekday'>{label}</Text>)}
          </View>
          <View className='month-calendar-grid'>
            {monthCells.map((cell, index) => (
              <View
                key={cell.date || `empty-${index}`}
                className={`month-calendar-cell ${!cell.isCurrentMonth ? 'is-empty-slot' : ''} ${cell.isFuture ? 'is-future' : ''} ${cell.isToday ? 'is-today' : ''} ${selectedDate === cell.date ? 'is-selected' : ''}`}
                onClick={() => handleSelect(cell.date)}
              >
                {cell.isCurrentMonth ? (
                  <>
                    <Text className='month-calendar-day'>{cell.dayNum}</Text>
                    <View className={`month-calendar-record ${getCircleClass(cell.record)}`} />
                  </>
                ) : null}
              </View>
            ))}
          </View>
          <View className='month-calendar-legend'>
            <View className='month-calendar-legend__item'><View className='month-calendar-legend__dot is-recorded' /><Text>有记录</Text></View>
            <View className='month-calendar-legend__item'><View className='month-calendar-legend__dot is-over' /><Text>超过目标</Text></View>
            <Text className='month-calendar-legend__hint'>点击日期查看当天详情</Text>
          </View>
          </>)}
        </View>
      ) : (
        <View className='date-list'>
          {weekCells.map((cell) => (
              <View
                key={cell.date}
                className={`date-item ${selectedDate === cell.date ? 'is-selected' : ''}`}
                onClick={() => handleSelect(cell.date)}
              >
                <Text className='date-day-name'>{cell.dayName}</Text>
                <View className={`date-day-circle ${getCircleClass(cell)}`}>
                  <Text className='date-num-text'>{cell.dayNum}</Text>
                </View>
              </View>
          ))}
        </View>
      )}
    </View>
  )
}
