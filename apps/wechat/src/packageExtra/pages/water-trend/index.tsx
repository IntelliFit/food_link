import { Text, View } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import {
  deleteBodyWaterLog,
  getBodyMetricsSummary,
  showUnifiedApiError,
  type BodyMetricWaterDay,
  type BodyMetricWaterLogItem,
  type BodyMetricsSummary,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { withAuth } from '../../../utils/withAuth'
import {
  buildDateRange,
  buildWaterTrend,
  formatChineseMonthDay,
  formatMonthDay,
  getWaterLogItems,
  normalizeRouteDate,
  type TrendPoint,
} from '../body-metrics-shared'

import './index.scss'

function waterLevel(value: number, goal: number): number {
  if (value <= 0) return 0
  const ratio = goal > 0 ? value / goal : value / 2000
  if (ratio >= 1) return 4
  if (ratio >= 0.75) return 3
  if (ratio >= 0.4) return 2
  return 1
}

function WaterHeatmap({
  points,
  goal,
  selectedDate,
  onSelect,
}: {
  points: TrendPoint[]
  goal: number
  selectedDate: string
  onSelect: (date: string) => void
}) {
  return (
    <View className='water-heatmap'>
      {points.map((item) => {
        const value = item.value || 0
        const level = waterLevel(value, goal)
          return (
            <View
              key={item.date}
              className={`water-heatmap-cell level-${level} ${selectedDate === item.date ? 'is-selected' : ''}`}
              onClick={() => onSelect(item.date)}
            >
              <Text className='water-heatmap-day'>{Number(item.date.slice(8, 10))}</Text>
            </View>
          )
      })}
      <View className='water-heatmap-legend'>
        <Text className='water-heatmap-note'>浅色表示少量记录，深色表示接近或达到目标</Text>
      </View>
    </View>
  )
}

function WaterTrendPage() {
  const router = useRouter()
  const targetDate = useMemo(() => normalizeRouteDate(String(router.params?.date || '')), [router.params?.date])
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(targetDate)
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null)
  const dates = useMemo(() => buildDateRange(30), [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await getBodyMetricsSummary('month'))
    } catch (err) {
      await showUnifiedApiError(err, '获取喝水趋势失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useDidShow(() => {
    void loadData()
  })

  const waterGoal = summary?.water_goal_ml || 2000
  const points = useMemo(() => buildWaterTrend(summary, dates), [summary, dates])
  const waterDayByDate = useMemo(() => {
    const map = new Map<string, BodyMetricWaterDay>()
    ;(summary?.water_daily || []).forEach((item) => map.set(item.date, item))
    return map
  }, [summary?.water_daily])
  const recentDays = useMemo(
    () => [...(summary?.water_daily || [])]
      .filter((item) => item.total > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30),
    [summary?.water_daily]
  )
  const selectedDay = waterDayByDate.get(selectedDate)
  const selectedLogs = useMemo(() => getWaterLogItems(selectedDay), [selectedDay])

  useEffect(() => {
    if (!summary) return
    if (waterDayByDate.has(selectedDate)) return
    const fallback = recentDays[0]?.date || targetDate
    setSelectedDate(fallback)
  }, [recentDays, selectedDate, summary, targetDate, waterDayByDate])

  const deleteWaterLog = (item: BodyMetricWaterLogItem) => {
    const logId = String(item.id || '').trim()
    if (!logId) {
      Taro.showToast({ title: '这条旧记录只能在记录页清空当天', icon: 'none' })
      return
    }
    Taro.showModal({
      title: '删除这次喝水',
      content: `确定删除 ${formatChineseMonthDay(item.date)} 的 ${Math.round(item.amount_ml)}ml 吗？`,
      confirmText: '删除',
      confirmColor: '#d45c5c',
      success: async (res) => {
        if (!res.confirm) return
        setDeletingLogId(logId)
        try {
          await deleteBodyWaterLog(logId)
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
          Taro.showToast({ title: '已删除', icon: 'success' })
          await loadData()
        } catch (err) {
          await showUnifiedApiError(err, '删除喝水记录失败')
        } finally {
          setDeletingLogId(null)
        }
      },
    })
  }

  return (
    <View className='water-trend-page'>
      <View className='trend-hero'>
        <View>
          <Text className='trend-kicker'>{targetDate}</Text>
          <Text className='trend-title'>喝水趋势</Text>
        </View>
        <View className='trend-goal'>
          <Text className='trend-goal-value'>{waterGoal}</Text>
          <Text className='trend-goal-unit'>ml目标</Text>
        </View>
      </View>

      <View className='trend-summary-grid'>
        <View className='trend-summary-card'>
          <Text className='trend-summary-label'>日均喝水</Text>
          <Text className='trend-summary-value'>{Math.round(summary?.avg_daily_water_ml || 0)}</Text>
        </View>
        <View className='trend-summary-card'>
          <Text className='trend-summary-label'>记录天数</Text>
          <Text className='trend-summary-value'>{summary?.water_recorded_days || 0}</Text>
        </View>
      </View>

      <View className='trend-card'>
        <View className='section-title-row'>
          <Text className='section-title'>近 30 天热力</Text>
          {loading ? <View className='trend-spinner' /> : null}
        </View>
        <WaterHeatmap points={points} goal={waterGoal} selectedDate={selectedDate} onSelect={setSelectedDate} />
      </View>

      <View className='history-card'>
        <View className='section-title-row'>
          <Text className='section-title'>最近喝水</Text>
          {selectedDay ? <Text className='history-selected'>{formatMonthDay(selectedDate)}</Text> : null}
        </View>
        {recentDays.length > 0 ? recentDays.map((item) => (
          <View key={item.date} className={`water-history-row ${selectedDate === item.date ? 'is-selected' : ''}`} onClick={() => setSelectedDate(item.date)}>
            <Text className='water-history-date'>{formatMonthDay(item.date)}</Text>
            <Text className='water-history-main'>{Math.round(item.total)} ml</Text>
            <Text className='water-history-sub'>{getWaterLogItems(item).length} 次</Text>
          </View>
        )) : (
          <Text className='history-empty'>还没有喝水记录</Text>
        )}
        {selectedDay && selectedLogs.length > 0 ? (
          <View className='water-day-detail'>
            <Text className='water-day-detail-title'>{formatChineseMonthDay(selectedDate)} 明细</Text>
            {selectedLogs.map((item, index) => {
              const logId = item.id || `${item.date}-${index}-${item.amount_ml}`
              const isDeleting = item.id && deletingLogId === item.id
              return (
                <View key={logId} className={`water-detail-row ${isDeleting ? 'is-deleting' : ''}`}>
                  <Text className='water-detail-amount'>+{Math.round(item.amount_ml)} ml</Text>
                  <Text className='water-detail-delete' onClick={() => !isDeleting && deleteWaterLog(item)}>删除</Text>
                </View>
              )
            })}
          </View>
        ) : null}
      </View>
    </View>
  )
}

export default withAuth(WaterTrendPage)
