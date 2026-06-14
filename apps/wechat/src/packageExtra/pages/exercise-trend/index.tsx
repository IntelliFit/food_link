import { Text, View } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import {
  deleteExerciseLog,
  getExerciseLogs,
  showUnifiedApiError,
  type ExerciseLogItem,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { withAuth } from '../../../utils/withAuth'
import {
  buildDateRange,
  buildExerciseDays,
  formatMonthDay,
  getExerciseDate,
  normalizeRouteDate,
  toNumber,
} from '../body-metrics-shared'

import './index.scss'

function exerciseLevel(value: number, maxValue: number): number {
  if (value <= 0) return 0
  const ratio = value / Math.max(maxValue, 1)
  if (ratio >= 0.75) return 4
  if (ratio >= 0.45) return 3
  if (ratio >= 0.2) return 2
  return 1
}

function ExerciseTrendPage() {
  const router = useRouter()
  const targetDate = useMemo(() => normalizeRouteDate(String(router.params?.date || '')), [router.params?.date])
  const [logs, setLogs] = useState<ExerciseLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const dates = useMemo(() => buildDateRange(30), [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const startDate = dates[0]
      const endDate = dates[dates.length - 1]
      const res = await getExerciseLogs({ start_date: startDate, end_date: endDate })
      setLogs(res.logs || [])
    } catch (err) {
      await showUnifiedApiError(err, '获取运动趋势失败')
    } finally {
      setLoading(false)
    }
  }, [dates])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useDidShow(() => {
    void loadData()
  })

  const days = useMemo(() => buildExerciseDays(logs, dates), [logs, dates])
  const total = days.reduce((sum, item) => sum + item.total, 0)
  const activeDays = days.filter((item) => item.total > 0).length
  const maxValue = Math.max(...days.map((item) => item.total), 1)
  const recentLogs = useMemo(
    () => [...logs]
      .sort((a, b) => getExerciseDate(b).localeCompare(getExerciseDate(a)))
      .slice(0, 14),
    [logs]
  )
  const avgActiveCalories = activeDays > 0 ? total / activeDays : 0

  const deleteLog = (item: ExerciseLogItem) => {
    const logId = String(item.id || '').trim()
    if (!logId) return
    Taro.showModal({
      title: '删除运动记录',
      content: `确定删除「${item.exercise_desc || '这条运动'}」吗？`,
      confirmText: '删除',
      confirmColor: '#d45c5c',
      success: async (res) => {
        if (!res.confirm) return
        setDeletingId(logId)
        try {
          await deleteExerciseLog(logId)
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
          Taro.showToast({ title: '已删除', icon: 'success' })
          await loadData()
        } catch (err) {
          await showUnifiedApiError(err, '删除运动记录失败')
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  return (
    <View className='exercise-trend-page'>
      <View className='trend-hero'>
        <View>
          <Text className='trend-kicker'>{targetDate}</Text>
          <Text className='trend-title'>运动趋势</Text>
        </View>
        <View className='trend-total'>
          <Text className='trend-total-value'>{Math.round(total)}</Text>
          <Text className='trend-total-unit'>kcal</Text>
        </View>
      </View>

      <View className='trend-summary-grid'>
        <View className='trend-summary-card'>
          <Text className='trend-summary-label'>活跃天数</Text>
          <Text className='trend-summary-value'>{activeDays}</Text>
        </View>
        <View className='trend-summary-card'>
          <Text className='trend-summary-label'>记录次数</Text>
          <Text className='trend-summary-value'>{logs.length}</Text>
        </View>
        <View className='trend-summary-card'>
          <Text className='trend-summary-label'>活跃日均</Text>
          <Text className='trend-summary-value'>{Math.round(avgActiveCalories)}</Text>
        </View>
      </View>

      <View className='trend-card'>
        <View className='section-title-row'>
          <Text className='section-title'>近 30 天活跃</Text>
          {loading ? <View className='trend-spinner' /> : null}
        </View>
        <View className='exercise-heatmap'>
          {days.map((item) => {
            const level = exerciseLevel(item.total, maxValue)
            return (
              <View key={item.date} className={`exercise-heatmap-cell level-${level}`}>
                <Text className='exercise-heatmap-day'>{Number(item.date.slice(8, 10))}</Text>
              </View>
            )
          })}
          <View className='exercise-heatmap-legend'>
            <Text className='exercise-heatmap-note'>深色表示当天运动消耗更高</Text>
          </View>
        </View>
      </View>

      <View className='history-card'>
        <Text className='section-title'>最近运动</Text>
        {recentLogs.length > 0 ? recentLogs.map((item) => {
          const isDeleting = deletingId === item.id
          return (
          <View key={item.id} className={`exercise-history-row ${isDeleting ? 'is-deleting' : ''}`}>
            <View className='exercise-history-body'>
              <Text className='exercise-history-title'>{item.exercise_desc}</Text>
              <Text className='exercise-history-date'>{formatMonthDay(getExerciseDate(item))}</Text>
            </View>
            <View className='exercise-history-side'>
              <Text className='exercise-history-kcal'>{Math.round(toNumber(item.calories_burned))} kcal</Text>
              <Text className='exercise-delete-link' onClick={() => !isDeleting && deleteLog(item)}>删除</Text>
            </View>
          </View>
          )
        }) : (
          <Text className='history-empty'>还没有运动记录</Text>
        )}
      </View>
    </View>
  )
}

export default withAuth(ExerciseTrendPage)
