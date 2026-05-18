import { Text, View } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import {
  deleteBodyWeightRecord,
  getBodyMetricsSummary,
  showUnifiedApiError,
  type BodyMetricWeightEntry,
  type BodyMetricsSummary,
} from '../../../utils/api'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { withAuth } from '../../../utils/withAuth'
import {
  buildDateRange,
  buildWeightTrend,
  diffDays,
  formatChineseMonth,
  formatChineseMonthDay,
  formatMonthDay,
  formatSignedFixed,
  formatWeight,
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

type WeightChartPoint = TrendPoint & {
  x: number
  y: number
  value: number
}

type WeightChartSegment = {
  key: string
  left: number
  top: number
  width: number
  angle: number
}

function buildWeightMonthGroups(entries: BodyMetricWeightEntry[]): WeightMonthGroup[] {
  const asc = [...entries]
    .filter((item) => Number.isFinite(Number(item.value)))
    .sort((a, b) => getWeightSortKey(a).localeCompare(getWeightSortKey(b)))
  const withDelta = asc.map((item, index): WeightHistoryItem => ({
    ...item,
    delta: index > 0 ? item.value - asc[index - 1].value : null,
  }))
  const groups = new Map<string, WeightMonthGroup>()
  ;[...withDelta].reverse().forEach((item) => {
    const key = item.date.slice(0, 7)
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
      return
    }
    groups.set(key, { key, label: formatChineseMonth(item.date), totalChange: null, avgDailyChange: null, items: [item] })
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

function WeightLineChart({ points }: { points: TrendPoint[] }) {
  const values = points
    .map((item) => item.value)
    .filter((value): value is number => value != null && Number.isFinite(value))
  const first = points.find((item) => item.value != null && Number.isFinite(item.value || NaN))
  const latest = [...points].reverse().find((item) => item.value != null && Number.isFinite(item.value || NaN))
  const max = values.length > 0 ? Math.max(...values) : null
  const min = values.length > 0 ? Math.min(...values) : null
  const span = max != null && min != null ? Math.max(max - min, 0.1) : 1
  const chartPoints: WeightChartPoint[] = max == null || min == null
    ? []
    : points.flatMap((item, index) => {
      if (item.value == null || !Number.isFinite(item.value)) return []
      const x = points.length > 1 ? 4 + (index / (points.length - 1)) * 92 : 50
      const y = 10 + ((max - item.value) / span) * 74
      return [{ ...item, x, y, value: item.value }]
    })
  const segments: WeightChartSegment[] = []
  const heightToWidthRatio = 0.42
  for (let i = 1; i < chartPoints.length; i++) {
    const prev = chartPoints[i - 1]
    const current = chartPoints[i]
    const dx = current.x - prev.x
    const dy = current.y - prev.y
    const width = Math.sqrt(dx * dx + (dy * heightToWidthRatio) * (dy * heightToWidthRatio))
    segments.push({
      key: `${prev.date}-${current.date}`,
      left: prev.x,
      top: prev.y,
      width,
      angle: Math.atan2(dy * heightToWidthRatio, dx) * (180 / Math.PI),
    })
  }

  return (
    <View className='weight-line-panel'>
      <View className='weight-axis-row'>
        <View className='weight-axis-labels'>
          <Text className='weight-axis-label'>{formatWeight(max)}</Text>
          <Text className='weight-axis-label'>{formatWeight(min)}</Text>
        </View>
        <View className='weight-line-plot'>
          <View className='weight-grid-line is-top' />
          <View className='weight-grid-line is-mid' />
          <View className='weight-grid-line is-bottom' />
          {segments.map((segment) => (
            <View
              key={segment.key}
              className='weight-line-segment'
              style={{
                left: `${segment.left}%`,
                top: `${segment.top}%`,
                width: `${segment.width}%`,
                transform: `rotate(${segment.angle}deg)`,
              }}
            />
          ))}
          {chartPoints.map((item, index) => (
            <View
              key={item.date}
              className={`weight-line-dot ${index === chartPoints.length - 1 ? 'is-latest' : ''}`}
              style={{ left: `${item.x}%`, top: `${item.y}%` }}
            />
          ))}
        </View>
      </View>
      <View className='weight-x-axis'>
        <Text className='weight-x-label'>{first ? formatMonthDay(first.date) : '--'}</Text>
        <Text className='weight-x-label'>{points[Math.floor(points.length / 2)] ? formatMonthDay(points[Math.floor(points.length / 2)].date) : '--'}</Text>
        <Text className='weight-x-label'>{latest ? formatMonthDay(latest.date) : '--'}</Text>
      </View>
      <Text className='weight-line-note'>
        {first && latest ? `${formatMonthDay(first.date)} 到 ${formatMonthDay(latest.date)}：${formatSignedFixed(latest.value! - first.value!, 1)}kg` : '近 30 天还没有可展示的体重趋势'}
      </Text>
    </View>
  )
}

function WeightTrendPage() {
  const router = useRouter()
  const targetDate = useMemo(() => normalizeRouteDate(String(router.params?.date || '')), [router.params?.date])
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const dates = useMemo(() => buildDateRange(30), [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await getBodyMetricsSummary('month'))
    } catch (err) {
      await showUnifiedApiError(err, '获取体重趋势失败')
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

  const points = useMemo(() => buildWeightTrend(summary, dates), [summary, dates])
  const groups = useMemo(() => buildWeightMonthGroups(summary?.weight_entries || []), [summary?.weight_entries])
  const latest = summary?.latest_weight || null
  const previous = summary?.previous_weight || null
  const change = latest && previous ? latest.value - previous.value : summary?.weight_change ?? null
  const recordedDays = points.filter((item) => item.value != null && Number.isFinite(item.value)).length

  const deleteWeight = (item: BodyMetricWeightEntry) => {
    const recordId = String(item.id || '').trim()
    if (!recordId) {
      Taro.showToast({ title: '这条旧记录缺少 ID，暂不能删除', icon: 'none' })
      return
    }
    Taro.showModal({
      title: '删除体重记录',
      content: `确定删除 ${formatChineseMonthDay(item.date)} 的 ${formatWeight(item.value)}kg 吗？`,
      confirmText: '删除',
      confirmColor: '#d45c5c',
      success: async (res) => {
        if (!res.confirm) return
        setDeletingId(recordId)
        try {
          await deleteBodyWeightRecord(recordId)
          Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
          Taro.showToast({ title: '已删除', icon: 'success' })
          await loadData()
        } catch (err) {
          await showUnifiedApiError(err, '删除体重记录失败')
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  return (
    <View className='weight-trend-page'>
      <View className='trend-hero'>
        <View>
          <Text className='trend-kicker'>{targetDate}</Text>
          <Text className='trend-title'>体重趋势</Text>
        </View>
        <View className='trend-latest'>
          <Text className='trend-latest-value'>{formatWeight(latest?.value)}</Text>
          <Text className='trend-latest-unit'>kg</Text>
        </View>
      </View>

      <View className='trend-summary-grid'>
        <View className='trend-summary-card'>
          <Text className='trend-summary-label'>较上次</Text>
          <Text className={`trend-summary-value ${change && change > 0 ? 'is-up' : change && change < 0 ? 'is-down' : ''}`}>
            {formatSignedFixed(change, 1)}
          </Text>
        </View>
        <View className='trend-summary-card'>
          <Text className='trend-summary-label'>记录次数</Text>
          <Text className='trend-summary-value'>{summary?.weight_entries?.length || 0}</Text>
        </View>
      </View>

      <View className='trend-card'>
        <View className='section-title-row'>
          <Text className='section-title'>近 30 天趋势</Text>
          {loading ? <View className='trend-spinner' /> : null}
        </View>
        <WeightLineChart points={points} />
        <Text className='trend-card-note'>有体重数据的自然日：{recordedDays} 天</Text>
      </View>

      <View className='history-card'>
        <Text className='section-title'>历史记录</Text>
        {groups.length > 0 ? groups.map((group) => (
          <View key={group.key} className='weight-month-group'>
            <View className='weight-month-header'>
              <Text className='weight-month-title'>{group.label}</Text>
              <Text className='weight-month-meta'>总变化 {formatSignedFixed(group.totalChange)}kg</Text>
            </View>
            {group.items.map((item) => {
              const isDeleting = item.id && deletingId === item.id
              return (
              <View key={`${item.id || item.date}-${item.recorded_at || item.value}`} className={`weight-history-row ${isDeleting ? 'is-deleting' : ''}`}>
                <View>
                  <Text className='weight-history-date'>{formatChineseMonthDay(item.date)}</Text>
                  <Text className='weight-history-delta'>{formatSignedFixed(item.delta)}kg</Text>
                </View>
                <View className='weight-history-side'>
                  <Text className='weight-history-value'>{formatWeight(item.value)}kg</Text>
                  <Text className='weight-delete-link' onClick={() => !isDeleting && deleteWeight(item)}>删除</Text>
                </View>
              </View>
              )
            })}
          </View>
        )) : (
          <Text className='history-empty'>还没有体重记录</Text>
        )}
      </View>
    </View>
  )
}

export default withAuth(WeightTrendPage)
