import { View, Text, Input, ScrollView } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  addBodyWaterLog,
  getBodyMetricsSummary,
  getExerciseLogs,
  saveBodyWeightRecord,
  showUnifiedApiError,
  type BodyMetricWaterDay,
  type BodyMetricWeightEntry,
  type BodyMetricsSummary,
  type ExerciseLogItem,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { HOME_DASHBOARD_REFRESH_EVENT } from '../../../utils/home-events'
import { formatDateKey } from '../../../pages/index/utils/helpers'

import './index.scss'

type BodyTrendTab = 'weight' | 'water' | 'exercise'

type TrendPoint = {
  date: string
  value: number | null
}

type ExerciseDay = {
  date: string
  total: number
  count: number
}

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

const TAB_ITEMS: Array<{ key: BodyTrendTab; label: string; icon: string }> = [
  { key: 'weight', label: '体重', icon: 'icon-weight-scale' },
  { key: 'water', label: '喝水', icon: 'icon-drink' },
  { key: 'exercise', label: '运动', icon: 'icon-dumbbell' },
]

const WATER_PRESETS = [250, 350, 500, 750]

function isBodyTrendTab(value: unknown): value is BodyTrendTab {
  return value === 'weight' || value === 'water' || value === 'exercise'
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function buildDateRange(days: number): string[] {
  const today = new Date()
  const dates: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    dates.push(formatDateKey(addDays(today, -i)))
  }
  return dates
}

function formatMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${Number(month || 0)}/${Number(day || 0)}`
}

function formatChineseMonth(dateKey: string): string {
  const [year, month] = dateKey.split('-')
  return `${year}年${month}月`
}

function formatChineseMonthDay(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  return `${month}月${day}日`
}

function normalizeRouteDate(value?: string | null): string {
  const raw = String(value || '').trim()
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return formatDateKey(new Date())
  const [, yearText, monthText, dayText] = matched
  const parsed = new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
  if (Number.isNaN(parsed.getTime())) return formatDateKey(new Date())
  const normalized = formatDateKey(parsed)
  const today = formatDateKey(new Date())
  if (normalized !== raw || normalized > today) return today
  return normalized
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function getExerciseDate(log: ExerciseLogItem): string {
  if (log.recorded_on) return log.recorded_on.slice(0, 10)
  const raw = log.recorded_at || log.created_at || ''
  if (!raw) return formatDateKey(new Date())
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw.slice(0, 10)
  return formatDateKey(parsed)
}

function buildExerciseDays(logs: ExerciseLogItem[], dates: string[]): ExerciseDay[] {
  const byDate = new Map<string, ExerciseDay>()
  dates.forEach((date) => byDate.set(date, { date, total: 0, count: 0 }))
  logs.forEach((log) => {
    const date = getExerciseDate(log)
    const current = byDate.get(date)
    if (!current) return
    current.total += toNumber(log.calories_burned)
    current.count += 1
  })
  return dates.map((date) => byDate.get(date) || { date, total: 0, count: 0 })
}

function buildWeightTrend(summary: BodyMetricsSummary | null, dates: string[]): TrendPoint[] {
  const daily = summary?.weight_trend_daily || []
  if (daily.length > 0) {
    const byDate = new Map(daily.map((item) => [item.date, toNumber(item.value, NaN)]))
    return dates.map((date) => {
      const value = byDate.get(date)
      return { date, value: typeof value === 'number' && Number.isFinite(value) ? value : null }
    })
  }

  const entries = [...(summary?.weight_entries || [])]
    .filter((item) => Number.isFinite(toNumber(item.value, NaN)))
    .sort((a, b) => a.date.localeCompare(b.date))
  let latest: BodyMetricWeightEntry | null = null
  return dates.map((date) => {
    entries.forEach((item) => {
      if (item.date <= date) latest = item
    })
    return { date, value: latest ? latest.value : null }
  })
}

function buildWaterTrend(summary: BodyMetricsSummary | null, dates: string[]): TrendPoint[] {
  const byDate = new Map<string, BodyMetricWaterDay>()
  ;(summary?.water_daily || []).forEach((item) => byDate.set(item.date, item))
  return dates.map((date) => ({ date, value: byDate.get(date)?.total ?? 0 }))
}

function getWaterDay(summary: BodyMetricsSummary | null, date: string): BodyMetricWaterDay {
  const normalized = date.slice(0, 10)
  const day = (summary?.water_daily || []).find((item) => item.date === normalized)
  if (day) return day
  if (summary?.today_water?.date === normalized) return summary.today_water
  return { date: normalized, total: 0, logs: [] }
}

function formatSigned(value: number | null | undefined, unit = ''): string {
  if (value == null || !Number.isFinite(value)) return '-'
  if (value === 0) return `0${unit}`
  return `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}${unit}`
}

function formatSignedFixed(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '--'
  if (Math.abs(value) < 0.005) return Number(0).toFixed(digits)
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

function formatWeight(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return value.toFixed(1)
}

function formatWeightFixed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return value.toFixed(2)
}

function getWeightSortKey(entry: BodyMetricWeightEntry): string {
  return `${entry.date} ${entry.recorded_at || ''} ${entry.client_id || ''}`
}

function diffDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const diff = end.getTime() - start.getTime()
  if (!Number.isFinite(diff) || diff <= 0) return 1
  return Math.max(1, Math.round(diff / 86400000))
}

function buildWeightMonthGroups(entries: BodyMetricWeightEntry[]): WeightMonthGroup[] {
  const asc = [...entries]
    .filter((item) => Number.isFinite(toNumber(item.value, NaN)))
    .sort((a, b) => getWeightSortKey(a).localeCompare(getWeightSortKey(b)))

  const withDelta = asc.map((item, index): WeightHistoryItem => {
    const previous = index > 0 ? asc[index - 1] : null
    return {
      ...item,
      delta: previous ? item.value - previous.value : null
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
      items: [item]
    })
  })

  groups.forEach((group) => {
    const chronological = [...group.items].sort((a, b) => getWeightSortKey(a).localeCompare(getWeightSortKey(b)))
    const first = chronological[0]
    const last = chronological[chronological.length - 1]
    if (!first || !last || chronological.length < 2) {
      group.totalChange = null
      group.avgDailyChange = null
      return
    }
    const totalChange = last.value - first.value
    group.totalChange = totalChange
    group.avgDailyChange = totalChange / diffDays(first.date, last.date)
  })

  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
}

function MiniSkeleton() {
  return (
    <View className='body-trends-skeleton'>
      <View className='body-trends-skeleton__hero' />
      <View className='body-trends-skeleton__tabs' />
      <View className='body-trends-skeleton__chart' />
      <View className='body-trends-skeleton__row' />
      <View className='body-trends-skeleton__row body-trends-skeleton__row--short' />
    </View>
  )
}

interface MetricCardProps {
  label: string
  value: string
  unit?: string
  tone?: 'green' | 'blue' | 'orange'
}

function MetricCard({ label, value, unit = '', tone = 'green' }: MetricCardProps) {
  return (
    <View className={`metric-card metric-card--${tone}`}>
      <Text className='metric-card__label'>{label}</Text>
      <View className='metric-card__value-row'>
        <Text className='metric-card__value'>{value}</Text>
        {unit && <Text className='metric-card__unit'>{unit}</Text>}
      </View>
    </View>
  )
}

interface TrendStripProps {
  points: TrendPoint[]
  mode: 'line' | 'bar'
  goal?: number
  unit: string
}

function TrendStrip({ points, mode, goal = 0, unit }: TrendStripProps) {
  const values = points.map((item) => item.value).filter((value): value is number => value != null && Number.isFinite(value))
  const max = Math.max(goal, ...values, 1)
  const min = mode === 'line' && values.length > 0 ? Math.min(...values) : 0
  const span = Math.max(max - min, 1)

  return (
    <ScrollView scrollX className='trend-strip-scroll' enhanced showScrollbar={false}>
      <View className='trend-strip'>
        {points.map((item, index) => {
          const value = item.value
          const hasValue = value != null && Number.isFinite(value)
          const percent = hasValue
            ? mode === 'line'
              ? 10 + ((max - value) / span) * 72
              : Math.max(6, Math.min(100, (value / max) * 100))
            : 0
          return (
            <View key={item.date} className='trend-strip__item'>
              <View className={`trend-strip__plot trend-strip__plot--${mode}`}>
                {mode === 'line' ? (
                  <View
                    className={`trend-strip__dot ${hasValue ? '' : 'trend-strip__dot--empty'}`}
                    style={hasValue ? { top: `${percent}%` } : undefined}
                  />
                ) : (
                  <View
                    className={`trend-strip__bar ${hasValue && value > 0 ? '' : 'trend-strip__bar--empty'}`}
                    style={{ height: `${percent}%` }}
                  />
                )}
              </View>
              <Text className='trend-strip__value'>
                {hasValue && value > 0 ? `${Math.round(value)}${unit}` : ''}
              </Text>
              <Text className='trend-strip__date'>{index % 5 === 0 || index === points.length - 1 ? formatMonthDay(item.date) : ''}</Text>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

function BodyTrendsPage() {
  const router = useRouter()
  const initialTab = isBodyTrendTab(router.params?.tab) ? router.params.tab : 'weight'
  const selectedRecordDate = useMemo(
    () => normalizeRouteDate(String(router.params?.date || '')),
    [router.params?.date]
  )
  const [activeTab, setActiveTab] = useState<BodyTrendTab>(initialTab)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLogItem[]>([])
  const [weightInput, setWeightInput] = useState('')
  const [savingWeight, setSavingWeight] = useState(false)
  const [savingWaterAmount, setSavingWaterAmount] = useState<number | null>(null)

  const dates = useMemo(() => buildDateRange(30), [])
  const today = dates[dates.length - 1]

  const exerciseDays = useMemo(() => buildExerciseDays(exerciseLogs, dates), [exerciseLogs, dates])
  const weightTrend = useMemo(() => buildWeightTrend(summary, dates), [summary, dates])
  const waterTrend = useMemo(() => buildWaterTrend(summary, dates), [summary, dates])
  const exerciseTrend = useMemo(
    () => exerciseDays.map((item) => ({ date: item.date, value: item.total })),
    [exerciseDays]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const startDate = dates[0]
      const endDate = dates[dates.length - 1]
      const [bodyRes, exerciseRes] = await Promise.all([
        getBodyMetricsSummary('month'),
        getExerciseLogs({ start_date: startDate, end_date: endDate }).catch((err) => {
          console.error('[body-trends] get exercise logs failed', err)
          return { logs: [], total_calories: 0, count: 0 }
        }),
      ])
      setSummary(bodyRes)
      setExerciseLogs(exerciseRes.logs || [])
      setWeightInput(bodyRes.latest_weight ? String(bodyRes.latest_weight.value) : '')
    } catch (err) {
      await showUnifiedApiError(err, '获取身体趋势失败')
    } finally {
      setLoading(false)
    }
  }, [dates])

  useEffect(() => {
    loadData()
  }, [loadData])

  const latestWeight = summary?.latest_weight || null
  const weightChange = summary?.weight_change ?? null
  const selectedWaterDay = useMemo(
    () => getWaterDay(summary, selectedRecordDate),
    [summary, selectedRecordDate]
  )
  const selectedWaterTotal = selectedWaterDay.total || 0
  const waterGoal = summary?.water_goal_ml || 2000
  const waterProgress = waterGoal > 0 ? Math.round((selectedWaterTotal / waterGoal) * 100) : 0
  const exerciseTotal = exerciseDays.reduce((sum, item) => sum + item.total, 0)
  const exerciseCount = exerciseDays.reduce((sum, item) => sum + item.count, 0)
  const activeExerciseDays = exerciseDays.filter((item) => item.total > 0).length
  const selectedExercise = exerciseDays.find((item) => item.date === selectedRecordDate)?.total || 0
  const selectedRecordDateLabel = selectedRecordDate === today ? '今日' : formatChineseMonthDay(selectedRecordDate)

  const activePoints = activeTab === 'weight'
    ? weightTrend.slice(-21)
    : activeTab === 'water'
      ? waterTrend.slice(-21)
      : exerciseTrend.slice(-21)

  const handleSaveWeight = async () => {
    const value = Number(weightInput)
    if (!Number.isFinite(value) || value < 20 || value > 300) {
      Taro.showToast({ title: '请输入有效体重', icon: 'none' })
      return
    }
    setSavingWeight(true)
    try {
      await saveBodyWeightRecord(value, selectedRecordDate, `body-trends-${selectedRecordDate}-${Date.now()}`)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
      Taro.showToast({ title: '已记录体重', icon: 'success' })
      await loadData()
    } catch (err) {
      await showUnifiedApiError(err, '保存体重失败')
    } finally {
      setSavingWeight(false)
    }
  }

  const handleAddWater = async (amount: number) => {
    setSavingWaterAmount(amount)
    try {
      await addBodyWaterLog(amount, selectedRecordDate)
      Taro.eventCenter.trigger(HOME_DASHBOARD_REFRESH_EVENT)
      Taro.showToast({ title: `已加 ${amount}ml`, icon: 'success' })
      await loadData()
    } catch (err) {
      await showUnifiedApiError(err, '保存喝水失败')
    } finally {
      setSavingWaterAmount(null)
    }
  }

  const openExerciseRecord = () => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}?date=${encodeURIComponent(selectedRecordDate)}` })
  }

  const recentWeightEntries = [...(summary?.weight_entries || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
  const weightMonthGroups = useMemo(() => buildWeightMonthGroups(summary?.weight_entries || []), [summary?.weight_entries])
  const recentWaterDays = [...(summary?.water_daily || [])]
    .filter((item) => item.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)
  const recentExerciseLogs = [...exerciseLogs]
    .sort((a, b) => getExerciseDate(b).localeCompare(getExerciseDate(a)))
    .slice(0, 6)

  if (loading) {
    return (
      <View className='body-trends-page'>
        <MiniSkeleton />
      </View>
    )
  }

  return (
    <View className='body-trends-page'>
      <View className='body-trends-hero'>
        <View className='body-trends-hero__title-row'>
          <Text className='body-trends-hero__title'>身体趋势</Text>
          <Text className='body-trends-hero__range'>近 30 天</Text>
        </View>
        <Text className='body-trends-hero__desc'>体重、喝水和运动放在这里看长期变化；分析页只引用摘要，不再堆满报表。</Text>
      </View>

      <View className='body-trends-tabs'>
        {TAB_ITEMS.map((item) => (
          <View
            key={item.key}
            className={`body-trends-tab ${activeTab === item.key ? 'body-trends-tab--active' : ''}`}
            onClick={() => setActiveTab(item.key)}
          >
            <Text className={`iconfont ${item.icon} body-trends-tab__icon`} />
            <Text className='body-trends-tab__label'>{item.label}</Text>
          </View>
        ))}
      </View>

      {activeTab === 'weight' && (
        <View className='body-trends-section'>
          <View className='metric-grid'>
            <MetricCard label='最近体重' value={formatWeight(latestWeight?.value)} unit='kg' />
            <MetricCard label='较上次' value={formatSigned(weightChange, 'kg')} tone={weightChange && weightChange > 0 ? 'orange' : 'green'} />
            <MetricCard label='记录次数' value={String(summary?.weight_entries?.length || 0)} unit='次' tone='blue' />
          </View>

          <View className='trend-card'>
            <View className='trend-card__header'>
              <Text className='trend-card__title'>体重趋势</Text>
              <Text className='trend-card__meta'>越连续记录，曲线越稳定</Text>
            </View>
            <TrendStrip points={activePoints} mode='line' unit='kg' />
          </View>

          <View className='action-panel'>
            <Text className='action-panel__title'>记录今天体重</Text>
            <View className='weight-input-row'>
              <Input
                className='weight-input'
                type='digit'
                value={weightInput}
                placeholder='例如 68.5'
                onInput={(event) => setWeightInput(event.detail.value)}
              />
              <Text className='weight-input-unit'>kg</Text>
              <View className={`action-button ${savingWeight ? 'action-button--disabled' : ''}`} onClick={() => !savingWeight && handleSaveWeight()}>
                <Text className='action-button__text'>保存</Text>
              </View>
            </View>
          </View>

          <View className='history-card'>
            <Text className='history-card__title'>最近记录</Text>
            {recentWeightEntries.length > 0 ? (
              <View className='weight-history-list'>
                {weightMonthGroups.map((group) => (
                  <View key={group.key} className='weight-month-group'>
                    <View className='weight-month-header'>
                      <Text className='weight-month-title'>{group.label}</Text>
                      <View className='weight-month-stats'>
                        <Text className='weight-month-label'>总变化</Text>
                        <Text className={`weight-delta ${group.totalChange && group.totalChange > 0 ? 'is-up' : group.totalChange && group.totalChange < 0 ? 'is-down' : ''}`}>
                          {formatSignedFixed(group.totalChange)}
                        </Text>
                        <Text className='weight-month-label'>日均变化</Text>
                        <Text className={`weight-delta ${group.avgDailyChange && group.avgDailyChange > 0 ? 'is-up' : group.avgDailyChange && group.avgDailyChange < 0 ? 'is-down' : ''}`}>
                          {formatSignedFixed(group.avgDailyChange)}
                        </Text>
                      </View>
                    </View>
                    {group.items.map((item) => (
                      <View key={`${item.date}-${item.recorded_at || item.value}`} className='weight-history-row'>
                        <View className='weight-history-left'>
                          <Text className='weight-history-date'>{formatChineseMonthDay(item.date)}</Text>
                          <Text className='weight-history-label'>体重</Text>
                        </View>
                        <Text className={`weight-history-delta ${item.delta && item.delta > 0 ? 'is-up' : item.delta && item.delta < 0 ? 'is-down' : ''}`}>
                          {formatSignedFixed(item.delta)}
                        </Text>
                        <Text className='weight-history-value'>{formatWeightFixed(item.value)}</Text>
                        <Text className='weight-history-arrow'>›</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : <Text className='history-empty'>还没有体重记录</Text>}
          </View>
        </View>
      )}

      {activeTab === 'water' && (
        <View className='body-trends-section'>
          <View className='metric-grid'>
            <MetricCard label={`${selectedRecordDateLabel}喝水`} value={String(Math.round(selectedWaterTotal))} unit='ml' tone='blue' />
            <MetricCard label={`${selectedRecordDateLabel}达成`} value={`${Math.min(999, waterProgress)}%`} />
            <MetricCard label='日均喝水' value={String(Math.round(summary?.avg_daily_water_ml || 0))} unit='ml' tone='orange' />
          </View>

          <View className='trend-card'>
            <View className='trend-card__header'>
              <Text className='trend-card__title'>喝水达标趋势</Text>
              <Text className='trend-card__meta'>目标 {waterGoal}ml</Text>
            </View>
            <TrendStrip points={activePoints} mode='bar' goal={waterGoal} unit='ml' />
          </View>

          <View className='action-panel'>
            <Text className='action-panel__title'>为{selectedRecordDateLabel}快捷加水</Text>
            <View className='water-preset-grid'>
              {WATER_PRESETS.map((amount) => (
                <View
                  key={amount}
                  className={`water-preset ${savingWaterAmount === amount ? 'water-preset--saving' : ''}`}
                  onClick={() => savingWaterAmount == null && handleAddWater(amount)}
                >
                  <Text className='water-preset__text'>+{amount}ml</Text>
                </View>
              ))}
            </View>
          </View>

          <View className='history-card'>
            <Text className='history-card__title'>最近喝水</Text>
            {recentWaterDays.length > 0 ? recentWaterDays.map((item) => (
              <View key={item.date} className='history-row'>
                <Text className='history-row__date'>{formatMonthDay(item.date)}</Text>
                <Text className='history-row__main'>{Math.round(item.total)} ml</Text>
                <Text className='history-row__sub'>{item.logs.length} 次</Text>
              </View>
            )) : <Text className='history-empty'>还没有喝水记录</Text>}
          </View>
        </View>
      )}

      {activeTab === 'exercise' && (
        <View className='body-trends-section'>
          <View className='metric-grid'>
            <MetricCard label={`${selectedRecordDateLabel}消耗`} value={String(Math.round(selectedExercise))} unit='kcal' tone='orange' />
            <MetricCard label='30天合计' value={String(Math.round(exerciseTotal))} unit='kcal' />
            <MetricCard label='活跃天数' value={String(activeExerciseDays)} unit='天' tone='blue' />
          </View>

          <View className='trend-card'>
            <View className='trend-card__header'>
              <Text className='trend-card__title'>运动消耗趋势</Text>
              <Text className='trend-card__meta'>{exerciseCount} 条运动记录</Text>
            </View>
            <TrendStrip points={activePoints} mode='bar' unit='kcal' />
          </View>

          <View className='action-panel action-panel--exercise'>
            <View>
              <Text className='action-panel__title'>记录{selectedRecordDateLabel}运动</Text>
              <Text className='action-panel__desc'>用文字或图片记录，系统会估算消耗。</Text>
            </View>
            <View className='action-button action-button--wide' onClick={openExerciseRecord}>
              <Text className='action-button__text'>去记录</Text>
            </View>
          </View>

          <View className='history-card'>
            <Text className='history-card__title'>最近运动</Text>
            {recentExerciseLogs.length > 0 ? recentExerciseLogs.map((item) => (
              <View key={item.id} className='history-row history-row--stack'>
                <View className='history-row__body'>
                  <Text className='history-row__main'>{item.exercise_desc}</Text>
                  <Text className='history-row__date'>{formatMonthDay(getExerciseDate(item))}</Text>
                </View>
                <Text className='history-row__strong'>{Math.round(toNumber(item.calories_burned))} kcal</Text>
              </View>
            )) : <Text className='history-empty'>还没有运动记录</Text>}
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(BodyTrendsPage)
