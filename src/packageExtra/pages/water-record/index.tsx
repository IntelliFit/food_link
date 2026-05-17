import { Input, ScrollView, Text, View } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import {
  addBodyWaterLog,
  getBodyMetricsSummary,
  resetBodyWaterLogs,
  showUnifiedApiError,
  type BodyMetricsSummary,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import {
  buildDateRange,
  buildWaterTrend,
  formatMonthDay,
  getRouteDateLabel,
  getWaterDay,
  normalizeRouteDate,
  type TrendPoint,
} from '../body-metrics-shared'

import './index.scss'

const WATER_PRESETS = [150, 250, 350, 500]

function WaterTrendPreview({ points, goal }: { points: TrendPoint[]; goal: number }) {
  const values = points.map((item) => item.value).filter((value): value is number => value != null && Number.isFinite(value))
  const max = Math.max(goal, ...values, 1)

  return (
    <ScrollView scrollX className='water-trend-scroll' enhanced showScrollbar={false}>
      <View className='water-trend-strip'>
        {points.map((item, index) => {
          const value = item.value || 0
          const height = value > 0 ? Math.max(8, Math.min(100, (value / max) * 100)) : 5
          return (
            <View key={item.date} className='water-trend-item'>
              <View className='water-trend-bar-wrap'>
                <View className={`water-trend-bar ${value > 0 ? '' : 'is-empty'}`} style={{ height: `${height}%` }} />
              </View>
              <Text className='water-trend-value'>{value > 0 ? `${Math.round(value)}` : ''}</Text>
              <Text className='water-trend-date'>{index % 5 === 0 || index === points.length - 1 ? formatMonthDay(item.date) : ''}</Text>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

function WaterRecordPage() {
  const router = useRouter()
  const initialDate = useMemo(() => normalizeRouteDate(String(router.params?.date || '')), [router.params?.date])
  const [recordDate, setRecordDate] = useState(initialDate)
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [customAmount, setCustomAmount] = useState('')
  const [savingAmount, setSavingAmount] = useState<number | 'custom' | null>(null)
  const [clearing, setClearing] = useState(false)

  const dates = useMemo(() => buildDateRange(30), [])
  const routeDateLabel = getRouteDateLabel(recordDate)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBodyMetricsSummary('month')
      setSummary(res)
    } catch (err) {
      await showUnifiedApiError(err, '获取喝水记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setRecordDate(initialDate)
  }, [initialDate])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useDidShow(() => {
    void loadData()
  })

  const waterGoal = summary?.water_goal_ml || 2000
  const currentDay = useMemo(() => getWaterDay(summary, recordDate), [summary, recordDate])
  const currentTotal = currentDay.total || 0
  const progress = waterGoal > 0 ? Math.round((currentTotal / waterGoal) * 100) : 0
  const remaining = Math.max(0, waterGoal - currentTotal)
  const trendPoints = useMemo(() => buildWaterTrend(summary, dates).slice(-21), [summary, dates])
  const recentDays = useMemo(
    () => [...(summary?.water_daily || [])]
      .filter((item) => item.total > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10),
    [summary?.water_daily]
  )

  const addWater = async (amount: number, marker: number | 'custom') => {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) {
      Taro.showToast({ title: '请输入 1-5000ml', icon: 'none' })
      return
    }
    setSavingAmount(marker)
    try {
      await addBodyWaterLog(Math.round(amount), recordDate)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
      Taro.showToast({ title: `已加 ${Math.round(amount)}ml`, icon: 'success' })
      setCustomAmount('')
      await loadData()
    } catch (err) {
      await showUnifiedApiError(err, '保存喝水记录失败')
    } finally {
      setSavingAmount(null)
    }
  }

  const addCustomWater = () => {
    void addWater(Number(customAmount), 'custom')
  }

  const clearWater = () => {
    if (currentTotal <= 0) return
    Taro.showModal({
      title: '清空喝水记录',
      content: `确定清空 ${routeDateLabel} 的 ${Math.round(currentTotal)}ml 喝水记录吗？`,
      confirmText: '清空',
      confirmColor: '#d45c5c',
      success: async (res) => {
        if (!res.confirm) return
        setClearing(true)
        try {
          await resetBodyWaterLogs(recordDate)
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
          Taro.showToast({ title: '已清空', icon: 'success' })
          await loadData()
        } catch (err) {
          await showUnifiedApiError(err, '清空喝水记录失败')
        } finally {
          setClearing(false)
        }
      },
    })
  }

  return (
    <View className='water-record-page'>
      <View className='water-record-hero'>
        <View>
          <Text className='water-record-kicker'>{routeDateLabel}记录</Text>
          <Text className='water-record-title'>记喝水</Text>
        </View>
        <View className='water-record-total'>
          <Text className='water-record-total-value'>{Math.round(currentTotal)}</Text>
          <Text className='water-record-total-unit'>ml</Text>
        </View>
      </View>

      <View className='water-progress-card'>
        <View className='water-progress-header'>
          <Text className='water-progress-title'>喝水进度</Text>
          <Text className='water-progress-meta'>{Math.min(999, progress)}%</Text>
        </View>
        <View className='water-progress-track'>
          <View className='water-progress-fill' style={{ width: `${Math.min(100, progress)}%` }} />
        </View>
        <Text className='water-progress-note'>
          {remaining > 0 ? `距离目标还差 ${Math.round(remaining)}ml` : '今天已达到喝水目标'}
        </Text>
      </View>

      <View className='water-action-card'>
        <View className='section-title-row'>
          <Text className='section-title'>快捷加水</Text>
          {currentTotal > 0 ? (
            <Text className={`water-clear-link ${clearing ? 'is-disabled' : ''}`} onClick={() => !clearing && clearWater()}>
              清空
            </Text>
          ) : null}
        </View>
        <View className='water-preset-grid'>
          {WATER_PRESETS.map((amount) => (
            <View
              key={amount}
              className={`water-preset ${savingAmount === amount ? 'is-saving' : ''}`}
              onClick={() => savingAmount == null && addWater(amount, amount)}
            >
              <Text className='water-preset-text'>+{amount}ml</Text>
            </View>
          ))}
        </View>
        <View className='water-custom-row'>
          <Input
            className='water-custom-input'
            type='number'
            value={customAmount}
            placeholder='自定义 ml'
            onInput={(event) => setCustomAmount(event.detail.value)}
          />
          <View
            className={`water-custom-btn ${savingAmount === 'custom' ? 'is-saving' : ''}`}
            onClick={() => savingAmount == null && addCustomWater()}
          >
            <Text className='water-custom-btn-text'>添加</Text>
          </View>
        </View>
      </View>

      <View className='water-trend-card'>
        <View className='section-title-row'>
          <Text className='section-title'>喝水趋势</Text>
          <Text className='section-meta'>目标 {waterGoal}ml</Text>
        </View>
        {loading ? (
          <View className='water-card-skeleton' />
        ) : (
          <WaterTrendPreview points={trendPoints} goal={waterGoal} />
        )}
      </View>

      <View className='water-history-card'>
        <Text className='section-title'>最近喝水</Text>
        {recentDays.length > 0 ? (
          <View className='water-history-list'>
            {recentDays.map((item) => (
              <View key={item.date} className='water-history-row'>
                <Text className='water-history-date'>{formatMonthDay(item.date)}</Text>
                <Text className='water-history-main'>{Math.round(item.total)} ml</Text>
                <Text className='water-history-sub'>{item.logs.length} 次</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className='water-empty'>还没有喝水记录</Text>
        )}
      </View>
    </View>
  )
}

export default withAuth(WaterRecordPage)
