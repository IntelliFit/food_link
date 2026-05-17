import { Input, ScrollView, Text, View } from '@tarojs/components'
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
import { withAuth } from '../../../utils/withAuth'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import {
  buildDateRange,
  buildWeightTrend,
  diffDays,
  formatChineseMonth,
  formatChineseMonthDay,
  formatMonthDay,
  formatSignedFixed,
  formatWeight,
  getRouteDateLabel,
  getWeightSortKey,
  normalizeRouteDate,
  type TrendPoint,
} from '../body-metrics-shared'

import './index.scss'

type WeightHistoryItem = BodyMetricWeightEntry & {
  delta: number | null
}

type WeightMonthGroup = {
  key: string
  label: string
  totalChange: number | null
  avgDailyChange: number | null
  items: WeightHistoryItem[]
}

function buildWeightMonthGroups(entries: BodyMetricWeightEntry[]): WeightMonthGroup[] {
  const asc = [...entries]
    .filter((item) => Number.isFinite(Number(item.value)))
    .sort((a, b) => getWeightSortKey(a).localeCompare(getWeightSortKey(b)))

  const withDelta = asc.map((item, index): WeightHistoryItem => {
    const previous = index > 0 ? asc[index - 1] : null
    return {
      ...item,
      delta: previous ? item.value - previous.value : null,
    }
  })

  const groups = new Map<string, WeightMonthGroup>()
  ;[...withDelta].reverse().forEach((item) => {
    const key = item.date.slice(0, 7)
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
      return
    }
    groups.set(key, {
      key,
      label: formatChineseMonth(item.date),
      totalChange: null,
      avgDailyChange: null,
      items: [item],
    })
  })

  groups.forEach((group) => {
    const chronological = [...group.items].sort((a, b) => getWeightSortKey(a).localeCompare(getWeightSortKey(b)))
    const first = chronological[0]
    const last = chronological[chronological.length - 1]
    if (!first || !last || chronological.length < 2) return
    const totalChange = last.value - first.value
    group.totalChange = totalChange
    group.avgDailyChange = totalChange / diffDays(first.date, last.date)
  })

  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
}

function WeightTrendPreview({ points }: { points: TrendPoint[] }) {
  const values = points.map((item) => item.value).filter((value): value is number => value != null && Number.isFinite(value))
  const max = values.length > 0 ? Math.max(...values) : 1
  const min = values.length > 0 ? Math.min(...values) : 0
  const span = Math.max(max - min, 1)

  return (
    <ScrollView scrollX className='weight-trend-scroll' enhanced showScrollbar={false}>
      <View className='weight-trend-strip'>
        {points.map((item, index) => {
          const hasValue = item.value != null && Number.isFinite(item.value)
          const top = hasValue ? 12 + ((max - item.value!) / span) * 68 : 70
          return (
            <View key={item.date} className='weight-trend-item'>
              <View className='weight-trend-plot'>
                <View
                  className={`weight-trend-dot ${hasValue ? '' : 'is-empty'}`}
                  style={{ top: `${top}%` }}
                />
              </View>
              <Text className='weight-trend-date'>{index % 5 === 0 || index === points.length - 1 ? formatMonthDay(item.date) : ''}</Text>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

function WeightRecordPage() {
  const router = useRouter()
  const initialDate = useMemo(() => normalizeRouteDate(String(router.params?.date || '')), [router.params?.date])
  const [recordDate, setRecordDate] = useState(initialDate)
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [weightInput, setWeightInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')

  const dates = useMemo(() => buildDateRange(30), [])
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
      setWeightInput(defaultWeight ? String(defaultWeight) : '')
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

  const trendPoints = useMemo(() => buildWeightTrend(summary, dates).slice(-21), [summary, dates])
  const monthGroups = useMemo(() => buildWeightMonthGroups(summary?.weight_entries || []), [summary?.weight_entries])
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

  return (
    <View className='weight-record-page'>
      <View className='weight-record-hero'>
        <View>
          <Text className='weight-record-kicker'>{routeDateLabel}记录</Text>
          <Text className='weight-record-title'>记体重</Text>
        </View>
        <View className='weight-record-latest'>
          <Text className='weight-record-latest-value'>{formatWeight(latestWeight?.value)}</Text>
          <Text className='weight-record-latest-unit'>kg</Text>
        </View>
      </View>

      <View className='weight-entry-card'>
        <Text className='weight-entry-title'>{recordDate} 的体重</Text>
        <View className='weight-input-row'>
          <Input
            className='weight-input'
            type='digit'
            value={weightInput}
            placeholder='例如 68.5'
            onInput={(event) => setWeightInput(event.detail.value)}
          />
          <Text className='weight-input-unit'>kg</Text>
          <View className={`weight-save-btn ${saving ? 'is-disabled' : ''}`} onClick={() => !saving && saveWeight()}>
            <Text className='weight-save-btn-text'>{saving ? '保存中' : '保存'}</Text>
          </View>
        </View>
      </View>

      <View className='weight-summary-grid'>
        <View className='weight-summary-card'>
          <Text className='weight-summary-label'>较上次</Text>
          <Text className={`weight-summary-value ${weightChange && weightChange > 0 ? 'is-up' : weightChange && weightChange < 0 ? 'is-down' : ''}`}>
            {formatSignedFixed(weightChange, 1)}
          </Text>
        </View>
        <View className='weight-summary-card'>
          <Text className='weight-summary-label'>记录次数</Text>
          <Text className='weight-summary-value'>{summary?.weight_entries?.length || 0}</Text>
        </View>
      </View>

      <View className='weight-trend-card'>
        <View className='section-title-row'>
          <Text className='section-title'>体重趋势</Text>
          <Text className='section-meta'>近 30 天</Text>
        </View>
        {loading ? (
          <View className='weight-card-skeleton' />
        ) : (
          <WeightTrendPreview points={trendPoints} />
        )}
      </View>

      <View className='weight-history-card'>
        <Text className='section-title'>最近记录</Text>
        {monthGroups.length > 0 ? (
          <View className='weight-history-list'>
            {monthGroups.map((group) => (
              <View key={group.key} className='weight-month-group'>
                <View className='weight-month-header'>
                  <Text className='weight-month-title'>{group.label}</Text>
                  <View className='weight-month-stats'>
                    <Text className='weight-month-label'>总变化</Text>
                    <Text className={`weight-delta ${group.totalChange && group.totalChange > 0 ? 'is-up' : group.totalChange && group.totalChange < 0 ? 'is-down' : ''}`}>
                      {formatSignedFixed(group.totalChange)}
                    </Text>
                    <Text className='weight-month-label'>日均</Text>
                    <Text className={`weight-delta ${group.avgDailyChange && group.avgDailyChange > 0 ? 'is-up' : group.avgDailyChange && group.avgDailyChange < 0 ? 'is-down' : ''}`}>
                      {formatSignedFixed(group.avgDailyChange)}
                    </Text>
                  </View>
                </View>
                {group.items.map((item) => (
                  <View key={`${item.id || item.date}-${item.recorded_at || item.value}`} className='weight-history-row'>
                    <View className='weight-history-left'>
                      <Text className='weight-history-date'>{formatChineseMonthDay(item.date)}</Text>
                      <Text className='weight-history-label'>体重</Text>
                    </View>
                    <Text className={`weight-history-delta ${item.delta && item.delta > 0 ? 'is-up' : item.delta && item.delta < 0 ? 'is-down' : ''}`}>
                      {formatSignedFixed(item.delta)}
                    </Text>
                    <Text className='weight-history-value'>{formatWeight(item.value)}</Text>
                    <View
                      className={`weight-delete-btn ${deletingId === item.id ? 'is-disabled' : ''}`}
                      onClick={() => deletingId !== item.id && deleteWeight(item)}
                    >
                      <Text className='weight-delete-btn-text'>删除</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : (
          <Text className='weight-empty'>还没有体重记录</Text>
        )}
      </View>
    </View>
  )
}

export default withAuth(WeightRecordPage)
