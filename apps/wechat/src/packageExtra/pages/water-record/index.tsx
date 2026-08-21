import { Input, Text, View } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import {
  addBodyWaterLog,
  deleteBodyWaterLog,
  getBodyMetricsSummary,
  resetBodyWaterLogs,
  showUnifiedApiError,
  type BodyMetricWaterLogItem,
  type BodyMetricsSummary,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import {
  addWaterToBodyMetricsStorage,
  clearWaterFromBodyMetricsStorage,
  removeWaterFromBodyMetricsStorage,
} from '../../../utils/home-dashboard-local-cache'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import {
  getRouteDateLabel,
  getWaterDay,
  getWaterLogItems,
  normalizeRouteDate,
} from '../body-metrics-shared'

import './index.scss'

const WATER_PRESETS = [150, 250, 350, 500]

function WaterRecordPage() {
  const router = useRouter()
  const initialDate = useMemo(() => normalizeRouteDate(String(router.params?.date || '')), [router.params?.date])
  const [recordDate, setRecordDate] = useState(initialDate)
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [customAmount, setCustomAmount] = useState('')
  const [savingAmount, setSavingAmount] = useState<number | 'custom' | null>(null)
  const [clearing, setClearing] = useState(false)
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null)

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

  useDidShow(() => {
    void loadData()
  })

  const waterGoal = summary?.water_goal_ml || 2000
  const currentDay = useMemo(() => getWaterDay(summary, recordDate), [summary, recordDate])
  const currentLogs = useMemo(() => getWaterLogItems(currentDay), [currentDay])
  const currentTotal = currentDay.total || 0
  const progress = waterGoal > 0 ? Math.round((currentTotal / waterGoal) * 100) : 0
  const remaining = Math.max(0, waterGoal - currentTotal)

  const addWater = async (amount: number, marker: number | 'custom') => {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) {
      Taro.showToast({ title: '请输入 1-5000ml', icon: 'none' })
      return
    }
    setSavingAmount(marker)
    try {
      const result = await addBodyWaterLog(Math.round(amount), recordDate)
      addWaterToBodyMetricsStorage(recordDate, Math.round(amount), result.item)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, {
        date: recordDate,
        force: true,
        bodyMetricsOnly: true,
      })
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
          clearWaterFromBodyMetricsStorage(recordDate)
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, {
            date: recordDate,
            force: true,
            bodyMetricsOnly: true,
          })
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

  const deleteWaterLog = (item: BodyMetricWaterLogItem) => {
    const logId = String(item.id || '').trim()
    if (!logId) {
      Taro.showToast({ title: '这条旧记录只能清空当天', icon: 'none' })
      return
    }
    Taro.showModal({
      title: '删除这次喝水',
      content: `确定删除 ${Math.round(item.amount_ml)}ml 这次记录吗？`,
      confirmText: '删除',
      confirmColor: '#d45c5c',
      success: async (res) => {
        if (!res.confirm) return
        setDeletingLogId(logId)
        try {
          await deleteBodyWaterLog(logId)
          removeWaterFromBodyMetricsStorage(item)
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT, {
            date: recordDate,
            force: true,
            bodyMetricsOnly: true,
          })
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

  const openTrend = () => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/water-trend/index')}?date=${encodeURIComponent(recordDate)}` })
  }

  return (
    <View className='water-record-page'>
      <View className='water-record-topbar'>
        <View>
          <Text className='water-record-kicker'>{routeDateLabel}</Text>
          <Text className='water-record-title'>记录喝水</Text>
        </View>
        <View className='water-trend-link' onClick={openTrend}>
          <Text className='water-trend-link-text'>查看趋势</Text>
        </View>
      </View>

      <View className='water-progress-card'>
        <View className='water-total-row'>
          <Text className='water-total-value'>{Math.round(currentTotal)}</Text>
          <Text className='water-total-unit'>ml</Text>
        </View>
        <View className='water-progress-track'>
          <View className='water-progress-fill' style={{ width: `${Math.min(100, progress)}%` }} />
        </View>
        <Text className='water-progress-note'>
          {remaining > 0 ? `距离目标还差 ${Math.round(remaining)}ml` : '这一天已达到喝水目标'}
        </Text>
      </View>

      <View className='water-action-card'>
        <View className='section-title-row'>
          <Text className='section-title'>快捷加水</Text>
          {loading ? <View className='water-mini-spinner' /> : null}
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

      <View className='water-day-card'>
        <View className='section-title-row'>
          <Text className='section-title'>{routeDateLabel}记录</Text>
          {currentTotal > 0 ? (
            <Text className={`water-clear-link ${clearing ? 'is-disabled' : ''}`} onClick={() => !clearing && clearWater()}>
              清空
            </Text>
          ) : null}
        </View>
        {currentLogs.length > 0 ? (
          <View className='water-log-list'>
            {currentLogs.map((item, index) => {
              const logId = item.id || `${index}-${item.amount_ml}`
              const isDeleting = item.id && deletingLogId === item.id
              return (
              <View key={logId} className={`water-log-chip ${isDeleting ? 'is-deleting' : ''}`}>
                <Text className='water-log-chip-text'>+{Math.round(item.amount_ml)}ml</Text>
                <Text className='water-log-delete' onClick={() => !isDeleting && deleteWaterLog(item)}>删除</Text>
              </View>
              )
            })}
          </View>
        ) : (
          <Text className='water-empty'>这一天还没有喝水记录</Text>
        )}
      </View>
    </View>
  )
}

export default withAuth(WaterRecordPage)
