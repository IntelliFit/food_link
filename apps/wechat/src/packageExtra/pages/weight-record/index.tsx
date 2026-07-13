import { Input, Text, View } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import {
  deleteBodyWeightRecord,
  getBodyMetricsSummary,
  saveBodyWeightRecord,
  showUnifiedApiError,
  type BodyMetricWeightEntry,
  type BodyMetricsSummary,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth } from '../../../utils/withAuth'
import {
  formatChineseMonthDay,
  formatSignedFixed,
  formatWeight,
  getRouteDateLabel,
  getWeightSortKey,
  normalizeRouteDate,
} from '../body-metrics-shared'
import { formatBodyMetric } from '../../../utils/number-format'

import './index.scss'

function WeightRecordPage() {
  const router = useRouter()
  const initialDate = useMemo(() => normalizeRouteDate(String(router.params?.date || '')), [router.params?.date])
  const [recordDate, setRecordDate] = useState(initialDate)
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [weightInput, setWeightInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  const routeDateLabel = getRouteDateLabel(recordDate)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBodyMetricsSummary('month')
      setSummary(res)
      const sameDay = [...(res.weight_entries || [])]
        .filter((item) => item.date === recordDate)
        .sort((a, b) => getWeightSortKey(b).localeCompare(getWeightSortKey(a)))
      const defaultWeight = sameDay[0]?.value ?? res.latest_weight?.value
      setWeightInput(defaultWeight ? formatBodyMetric(defaultWeight) : '')
    } catch (err) {
      await showUnifiedApiError(err, '获取体重记录失败')
    } finally {
      setLoading(false)
    }
  }, [recordDate])

  useEffect(() => {
    setRecordDate(initialDate)
  }, [initialDate])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useDidShow(() => {
    void loadData()
  })

  const dayRecords = useMemo(
    () => [...(summary?.weight_entries || [])]
      .filter((item) => item.date === recordDate)
      .sort((a, b) => getWeightSortKey(b).localeCompare(getWeightSortKey(a))),
    [recordDate, summary?.weight_entries]
  )

  const latestWeight = summary?.latest_weight || null
  const previousWeight = summary?.previous_weight || null
  const weightChange = latestWeight && previousWeight ? latestWeight.value - previousWeight.value : summary?.weight_change ?? null

  const saveWeight = async () => {
    const value = Number(weightInput)
    if (!Number.isFinite(value) || value < 20 || value > 300) {
      Taro.showToast({ title: '请输入 20-300kg 的体重', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      await saveBodyWeightRecord(value, recordDate, `weight-${recordDate}-${Date.now()}`)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
      Taro.showToast({ title: '已记录体重', icon: 'success' })
      await loadData()
    } catch (err) {
      await showUnifiedApiError(err, '保存体重失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteWeight = (item: BodyMetricWeightEntry) => {
    if (!item.id) {
      Taro.showToast({ title: '这条记录暂不支持删除', icon: 'none' })
      return
    }
    Taro.showModal({
      title: '删除体重记录',
      content: `确定删除 ${formatChineseMonthDay(item.date)} 的 ${formatWeight(item.value)}kg 吗？`,
      confirmText: '删除',
      confirmColor: '#d45c5c',
      success: async (res) => {
        if (!res.confirm || !item.id) return
        setDeletingId(item.id)
        try {
          await deleteBodyWeightRecord(item.id)
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
          Taro.showToast({ title: '已删除', icon: 'success' })
          await loadData()
        } catch (err) {
          await showUnifiedApiError(err, '删除体重记录失败')
        } finally {
          setDeletingId('')
        }
      },
    })
  }

  const openTrend = () => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/weight-trend/index')}?date=${encodeURIComponent(recordDate)}` })
  }

  return (
    <View className='weight-record-page'>
      <View className='weight-record-topbar'>
        <View>
          <Text className='weight-record-kicker'>{routeDateLabel}</Text>
          <Text className='weight-record-title'>记录体重</Text>
        </View>
        <View className='weight-trend-link' onClick={openTrend}>
          <Text className='weight-trend-link-text'>查看趋势</Text>
        </View>
      </View>

      <View className='weight-main-card'>
        <Text className='weight-main-label'>{recordDate} 的体重</Text>
        <View className='weight-main-input-row'>
          <Input
            className='weight-main-input'
            type='digit'
            value={weightInput}
            placeholder='69.9'
            onInput={(event) => setWeightInput(event.detail.value)}
          />
          <Text className='weight-main-unit'>kg</Text>
        </View>
        <View className={`weight-save-btn ${saving ? 'is-disabled' : ''}`} onClick={() => !saving && saveWeight()}>
          <Text className='weight-save-btn-text'>{saving ? '保存中' : '保存体重'}</Text>
        </View>
        <Text className='weight-main-helper'>
          {latestWeight
            ? `最近一次 ${formatWeight(latestWeight.value)}kg，较上次 ${formatSignedFixed(weightChange, 1)}kg`
            : '保存后会同步更新首页和健康档案体重'}
        </Text>
      </View>

      <View className='weight-day-card'>
        <View className='weight-day-header'>
          <Text className='weight-day-title'>{routeDateLabel}记录</Text>
          {loading ? <View className='weight-mini-spinner' /> : null}
        </View>
        {dayRecords.length > 0 ? (
          <View className='weight-day-list'>
            {dayRecords.map((item) => (
              <View key={`${item.id || item.date}-${item.recorded_at || item.value}`} className='weight-day-row'>
                <View>
                  <Text className='weight-day-value'>{formatWeight(item.value)}kg</Text>
                  <Text className='weight-day-date'>{formatChineseMonthDay(item.date)}</Text>
                </View>
                <View
                  className={`weight-delete-btn ${deletingId === item.id ? 'is-disabled' : ''}`}
                  onClick={() => deletingId !== item.id && deleteWeight(item)}
                >
                  <Text className='weight-delete-btn-text'>删除</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text className='weight-empty'>这一天还没有体重记录</Text>
        )}
      </View>
    </View>
  )
}

export default withAuth(WeightRecordPage)
