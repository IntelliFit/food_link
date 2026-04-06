import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Switch } from '@taroify/core'
import { getStatsSummary, generateStatsInsight, saveStatsInsight, getBodyMetricsSummary, type StatsSummary } from '../../utils/api'
import { IconBreakfast, IconLunch, IconDinner, IconSnack } from '../../components/iconfont'
import '../../assets/iconfont/iconfont.css'
import './index.scss'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const MEAL_ICONS = {
  breakfast: IconBreakfast,
  morning_snack: IconSnack,
  lunch: IconLunch,
  afternoon_snack: IconSnack,
  dinner: IconDinner,
  evening_snack: IconSnack,
  snack: IconSnack
} as const

const MEAL_ICON_COLORS: Record<string, string> = {
  breakfast: '#f59e0b',
  morning_snack: '#7b61ff',
  lunch: '#00bc7d',
  afternoon_snack: '#ad46ff',
  dinner: '#2b7fff',
  evening_snack: '#5b21b6',
  snack: '#ad46ff'
}

function formatLocalDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

type HeatmapCell = {
  date: string
  calories: number
  delta: number
  level: 1 | 2
  state: 'none' | 'surplus' | 'deficit'
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export default function StatsPage() {
  const [range, setRange] = useState<'week' | 'month'>('week')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiDisplayText, setAiDisplayText] = useState('')
  const typingTimerRef = useRef<any>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [insightActionLoading, setInsightActionLoading] = useState(false)
  const [insightError, setInsightError] = useState<string | null>(null)
  const [showCalories, setShowCalories] = useState(false)

  const fetchStats = useCallback(async (r: 'week' | 'month') => {
    setLoading(true)
    setError(null)
    try {
      const token = Taro.getStorageSync('access_token')
      if (!token) {
        setError('请先登录')
        setLoading(false)
        return
      }
      // 并行获取统计数据和体重/喝水数据
      const [statsRes, bodyMetricsRes] = await Promise.all([
        getStatsSummary(r),
        getBodyMetricsSummary(r).catch(() => null)
      ])
      
      // 如果 stats 返回的 body_metrics 为空或缺失，使用 bodyMetricsRes 的数据
      if (bodyMetricsRes) {
        // 检查是否有有效的体重或喝水数据
        const hasWeightData = bodyMetricsRes.weight_entries && bodyMetricsRes.weight_entries.length > 0
        const hasWaterData = bodyMetricsRes.water_daily && bodyMetricsRes.water_daily.some((d: any) => d.total > 0)
        
        if (hasWeightData || hasWaterData) {
          statsRes.body_metrics = {
            weight_entries: bodyMetricsRes.weight_entries || [],
            latest_weight: bodyMetricsRes.latest_weight || null,
            previous_weight: bodyMetricsRes.previous_weight || null,
            weight_change: bodyMetricsRes.weight_change ?? null,
            water_daily: bodyMetricsRes.water_daily || [],
            water_goal_ml: bodyMetricsRes.water_goal_ml || 2000,
            total_water_ml: bodyMetricsRes.total_water_ml || 0,
            avg_daily_water_ml: bodyMetricsRes.avg_daily_water_ml || 0,
            water_recorded_days: bodyMetricsRes.water_recorded_days || 0
          }
        }
      }
      setData(statsRes)
    } catch (e: unknown) {
      setError((e as Error).message || '获取统计失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats(range)
  }, [range, fetchStats])

  useDidShow(() => {
    fetchStats(range)
  })

  const handleGenerateInsight = useCallback(async () => {
    if (!data || insightActionLoading) return

    setInsightActionLoading(true)
    setInsightError(null)
    try {
      const res = await generateStatsInsight(range)
      const full = (res.analysis_summary || '').trim()
      if (!full) throw new Error('AI 洞察生成失败')

      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          analysis_summary: full,
          analysis_summary_generated_date: formatLocalDate(),
          analysis_summary_needs_refresh: false
        }
      })

      try {
        await saveStatsInsight(range, full)
      } catch (saveError) {
        console.error('保存 AI 洞察失败:', saveError)
      }

      Taro.showToast({
        title: '洞察已更新',
        icon: 'success'
      })
    } catch (e: unknown) {
      const message = (e as Error).message || 'AI 洞察生成失败，请稍后重试'
      setInsightError(message)
      Taro.showToast({
        title: '生成失败',
        icon: 'none'
      })
    } finally {
      setInsightActionLoading(false)
    }
  }, [data, insightActionLoading, range])

  // AI 洞察打字机效果：当 analysis_summary 从空变为非空时，按字符逐步显示
  useEffect(() => {
    const full = data?.analysis_summary || ''

    // 如果还没有洞察，清空显示并停止打字
    if (!full) {
      setAiDisplayText('')
      setIsTyping(false)
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
      return
    }

    // 已经完全展示，无需重新打字
    if (aiDisplayText === full && !isTyping) {
      return
    }

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current)
      typingTimerRef.current = null
    }

    let index = 0
    const step = 2 // 每次输出的字符数
    setAiDisplayText('')
    setIsTyping(true)

    const timer = setInterval(() => {
      index += step
      if (index >= full.length) {
        setAiDisplayText(full)
        setIsTyping(false)
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current)
          typingTimerRef.current = null
        }
      } else {
        setAiDisplayText(full.slice(0, index))
      }
    }, 40)

    typingTimerRef.current = timer

    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
    // 只在后端完整洞察文本变化时重新触发打字
  }, [data?.analysis_summary])

  if (loading && !data) {
    return (
      <View className='stats-page'>
        <View className='loading-wrap'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  if (error && !data) {
    return (
      <View className='stats-page'>
        <View className='error-wrap'>
          <Text className='iconfont icon-jiesuo error-icon' />
          <Text className='error-text'>{error}</Text>
          <View className='btn-primary' onClick={() => fetchStats(range)}>
            <Text className='btn-text'>重试</Text>
          </View>
        </View>
      </View>
    )
  }

  const d = data!
  const totalCalories = toSafeNumber(d.total_calories)
  const tdee = toSafeNumber(d.tdee)
  const avgCaloriesPerDay = toSafeNumber(d.avg_calories_per_day)
  const surplusDeficit = toSafeNumber(d.cal_surplus_deficit)
  const totalProtein = toSafeNumber(d.total_protein)
  const totalCarbs = toSafeNumber(d.total_carbs)
  const totalFat = toSafeNumber(d.total_fat)
  const hasInsight = Boolean(d.analysis_summary?.trim())
  const insightGeneratedDate = d.analysis_summary_generated_date || ''
  const insightNeedsRefresh = Boolean(d.analysis_summary_needs_refresh)
  const displayInsightText = aiDisplayText || (hasInsight && !isTyping ? d.analysis_summary : '')
  const bodyMetrics = d.body_metrics
  const macroPercent = {
    protein: toSafeNumber(d.macro_percent?.protein),
    carbs: toSafeNumber(d.macro_percent?.carbs),
    fat: toSafeNumber(d.macro_percent?.fat)
  }
  const byMeal = {
    breakfast: toSafeNumber(d.by_meal?.breakfast),
    morning_snack: toSafeNumber(d.by_meal?.morning_snack),
    lunch: toSafeNumber(d.by_meal?.lunch),
    afternoon_snack: toSafeNumber(d.by_meal?.afternoon_snack ?? d.by_meal?.snack),
    dinner: toSafeNumber(d.by_meal?.dinner),
    evening_snack: toSafeNumber(d.by_meal?.evening_snack)
  } as const
  const isSurplus = surplusDeficit > 0
  const chartDays = range === 'week' ? d.daily_calories.slice(-7) : d.daily_calories.slice(-14)

  // Calculate max calories for the chart scaling
  const maxDailyCalories = d.daily_calories.length > 0
    ? Math.max(...d.daily_calories.map(i => i.calories))
    : 2000
  const weightTrend = bodyMetrics?.weight_entries || []
  const latestWeight = bodyMetrics?.latest_weight || null
  const previousWeight = bodyMetrics?.previous_weight || null
  const weightChange = bodyMetrics?.weight_change
  const waterDaily = bodyMetrics?.water_daily || []
  const waterGoalMl = toSafeNumber(bodyMetrics?.water_goal_ml, 2000)
  const avgDailyWaterMl = toSafeNumber(bodyMetrics?.avg_daily_water_ml)
  const totalWaterMl = toSafeNumber(bodyMetrics?.total_water_ml)
  const waterRecordedDays = toSafeNumber(bodyMetrics?.water_recorded_days)
  const waterTrend = range === 'week' ? waterDaily.slice(-7) : waterDaily.slice(-14)
  const maxWaterValue = waterTrend.length > 0
    ? Math.max(waterGoalMl, ...waterTrend.map(item => toSafeNumber(item.total)))
    : waterGoalMl
  const heatmapCells: HeatmapCell[] = d.daily_calories.map((item) => {
    const hasRecord = item.calories > 0
    const delta = hasRecord ? item.calories - tdee : 0
    const deltaRatio = hasRecord ? Math.abs(delta) / Math.max(tdee, 1) : 0
    const level: HeatmapCell['level'] = deltaRatio > 0.15 ? 2 : 1

    return {
      date: item.date,
      calories: item.calories,
      delta,
      level,
      state: !hasRecord ? 'none' : delta > 0 ? 'surplus' : 'deficit'
    }
  })
  const activeHeatmapCell = [...heatmapCells].reverse().find((item) => item.calories > 0) || heatmapCells[heatmapCells.length - 1]

  const openDayRecordPage = (date: string) => {
    if (!date) return
    Taro.navigateTo({ url: `/pages/day-record/index?date=${encodeURIComponent(date)}` })
  }

  return (
    <View className='stats-page'>
      <ScrollView className='scroll-wrap' scrollY enhanced showScrollbar={false}>
        {/* 页面头部已移除 - 标题和描述不再需要 */}

        {/* 周/月切换 - Segmented Control，切换时显示加载 */}
        <View className='tabs-container'>
          <View className={`segmented-control ${loading ? 'is-loading' : ''}`}>
            {loading && (
              <View className='tabs-loading'>
                <View className='loading-spinner-md' />
              </View>
            )}
            <View
              className={`segment-item ${range === 'week' ? 'active' : ''}`}
              onClick={() => !loading && setRange('week')}
            >
              <Text>近一周</Text>
            </View>
            <View
              className={`segment-item ${range === 'month' ? 'active' : ''}`}
              onClick={() => !loading && setRange('month')}
            >
              <Text>近一月</Text>
            </View>
          </View>
        </View>

        {/* 日历图 - 根据 range 显示不同视图 */}
        {range === 'week' ? (
          // 近一周：首页风格横向排列（7天）
          <View className='date-selector-section'>
            <View className='date-list'>
              {heatmapCells.slice(-7).map((item) => {
                let circleClass = 'is-empty'
                if (item.calories > 0) {
                  if (item.state === 'surplus') {
                    circleClass = 'is-over'
                  } else {
                    circleClass = 'is-recorded'
                  }
                }
                
                const date = new Date(`${item.date}T12:00:00`)
                const dayNames = ['日', '一', '二', '三', '四', '五', '六']
                const dayName = dayNames[date.getDay()]
                const dayNum = item.date.slice(-2).replace(/^0/, '')
                
                return (
                  <View
                    key={item.date}
                    className={`date-item ${item.calories > 0 ? 'is-clickable' : ''}`}
                    onClick={() => item.calories > 0 && openDayRecordPage(item.date)}
                  >
                    <Text className='date-day-name'>{dayName}</Text>
                    <View className={`date-day-circle ${circleClass}`}>
                      <Text className='date-num-text'>{dayNum}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          </View>
        ) : (
          // 近一月：日历网格视图（30天，约5行）
          <View className='stats-card heatmap-card'>
            <View className='heatmap-grid month-view'>
              {heatmapCells.slice(-30).map((item) => {
                let circleClass = 'is-empty'
                if (item.calories > 0) {
                  if (item.state === 'surplus') {
                    circleClass = 'is-over'
                  } else {
                    circleClass = 'is-recorded'
                  }
                }
                
                return (
                  <View
                    key={item.date}
                    className={`heatmap-cell ${circleClass} ${item.calories > 0 ? 'is-clickable' : ''}`}
                    onClick={() => item.calories > 0 && openDayRecordPage(item.date)}
                  >
                    <Text className='heatmap-cell-label'>{item.date.slice(-2)}</Text>
                    <View className='heatmap-cell-dot' />
                  </View>
                )
              })}
            </View>
          </View>
        )}

        {/* 热量盈缺看板 - Hero Card */}
        <View className={`stats-card hero-card ${isSurplus ? 'surplus-mode' : 'deficit-mode'}`}>
          <View className='hero-header'>
            <Text className='hero-title'>平均每日{isSurplus ? '盈余' : '缺口'}</Text>
            <View className='hero-badge'>
              <Text className={`iconfont ${isSurplus ? 'icon-huore' : 'icon-good'} hero-badge-icon`} />
              <Text>{isSurplus ? '热量超标' : '保持良好'}</Text>
            </View>
          </View>

          <View className='hero-main-value'>
            <Text className='hero-number'>{Math.abs(surplusDeficit).toFixed(0)}</Text>
            <Text className='hero-unit'>kcal</Text>
          </View>

          <View className='hero-grid'>
            <View className='hero-item'>
              <Text className='hero-label'>日均摄入</Text>
              <Text className='hero-sub-value'>{avgCaloriesPerDay.toFixed(0)}</Text>
            </View>
            <View className='hero-divider'></View>
            <View className='hero-item'>
              <Text className='hero-label'>日均消耗(TDEE)</Text>
              <Text className='hero-sub-value'>{tdee}</Text>
            </View>
          </View>
        </View>

        {/* 连续记录天数 - Streak Card */}
        <View className='stats-card streak-card'>
          <View className='streak-icon'>
            <Text className='iconfont icon-huore streak-icon-font' />
          </View>
          <View className='streak-content'>
            <Text className='streak-title'>连续记录</Text>
            <View className='streak-number-row'>
              <Text className='streak-num'>{d.streak_days}</Text>
              <Text className='streak-suffix'>天</Text>
            </View>
          </View>
          <View className='streak-badge'>
            坚持就是胜利
          </View>
        </View>

        {/* 每日摄入趋势 - Bar Chart */}
        <View className='stats-card chart-card'>
          <View className='card-header chart-card-header'>
            <View className='chart-title-group'>
              <Text className='iconfont icon-shangzhang chart-title-icon' />
              <View className='card-header-copy'>
                <Text className='card-title'>摄入趋势</Text>
                <Text className='card-subtitle'>{range === 'week' ? '最近 7 天' : '最近 14 天'}</Text>
              </View>
            </View>
            <View className='chart-switch-wrap'>
              <Text className='chart-switch-label'>显示数值</Text>
              <Switch
                className='chart-switch'
                checked={showCalories}
                onChange={(v) => setShowCalories(Boolean(typeof v === 'object' ? v.detail?.value : v))}
                style={{ '--switch-checked-background-color': '#00bc7d' } as CSSProperties}
              />
            </View>
          </View>
          {chartDays.length > 0 ? (
            <View className='bar-chart-container'>
              {chartDays.map((item) => {
                const heightPct = Math.max((item.calories / maxDailyCalories) * 100, 10)
                return (
                  <View key={item.date} className='chart-col'>
                    {showCalories && (
                      <Text className='bar-calorie-text'>{Math.round(item.calories)}</Text>
                    )}
                    <View className='bar-wrapper'>
                      <View
                        className={`bar-fill ${item.calories > tdee ? 'over' : ''}`}
                        style={{ height: `${heightPct}%` }}
                      ></View>
                    </View>
                    <Text className='bar-label'>{item.date.slice(5)}</Text>
                  </View>
                )
              })}
            </View>
          ) : (
            <View className='chart-empty-state'>
              <Text className='empty-text'>暂无数据</Text>
            </View>
          )}
        </View>

        {/* 宏量营养素占比 - Macro Card */}
        <View className='stats-card macro-card'>
          <View className='card-header'>
            <Text className='iconfont icon-tianpingzuo chart-title-icon' />
            <Text className='card-title'>营养素占比</Text>
          </View>

          <View className='macro-list'>
            <View className='macro-row'>
              <View className='macro-info'>
                <View className='macro-label-wrap'>
                  <Text className='iconfont icon-danbaizhi macro-icon protein' />
                  <Text className='macro-name'>蛋白质</Text>
                </View>
                <Text className='macro-detail'>{totalProtein.toFixed(0)}g / {macroPercent.protein}%</Text>
              </View>
              <View className='progress-track'>
                <View className='progress-fill protein' style={{ width: `${clampPercent(macroPercent.protein)}%` }}></View>
              </View>
            </View>

            <View className='macro-row'>
              <View className='macro-info'>
                <View className='macro-label-wrap'>
                  <Text className='iconfont icon-tanshui-dabiao macro-icon carbs' />
                  <Text className='macro-name'>碳水化合物</Text>
                </View>
                <Text className='macro-detail'>{totalCarbs.toFixed(0)}g / {macroPercent.carbs}%</Text>
              </View>
              <View className='progress-track'>
                <View className='progress-fill carbs' style={{ width: `${clampPercent(macroPercent.carbs)}%` }}></View>
              </View>
            </View>

            <View className='macro-row'>
              <View className='macro-info'>
                <View className='macro-label-wrap'>
                  <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin macro-icon fat' />
                  <Text className='macro-name'>脂肪</Text>
                </View>
                <Text className='macro-detail'>{totalFat.toFixed(0)}g / {macroPercent.fat}%</Text>
              </View>
              <View className='progress-track'>
                <View className='progress-fill fat' style={{ width: `${clampPercent(macroPercent.fat)}%` }}></View>
              </View>
            </View>
          </View>
        </View>

        {/* 饮食结构 - Meal Structure 仪表盘风格 */}
        <View className='stats-card meal-structure-card'>
          <View className='card-header'>
            <Text className='iconfont icon-canciguanli chart-title-icon' />
            <Text className='card-title'>餐次结构</Text>
          </View>
          <View className='meal-gauges-grid'>
            {(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'] as const).map((key) => {
              const cal = byMeal[key]
              const pct = totalCalories > 0 ? (cal / totalCalories) * 100 : 0
              const MealIcon = MEAL_ICONS[key]
              const color = MEAL_ICON_COLORS[key]
              const radius = 43
              const circumference = 2 * Math.PI * radius
              const progress = Math.min(pct / 100, 1)
              
              return (
                <View key={key} className='meal-gauge-item'>
                  <View className='meal-gauge-left'>
                    <View className='meal-gauge-icon-wrap' style={{ backgroundColor: `${color}14` }}>
                      <MealIcon size={20} color={color} />
                    </View>
                    <Text className='meal-gauge-label'>{MEAL_NAMES[key]}</Text>
                    <Text className='meal-gauge-percent' style={{ color }}>{pct.toFixed(1)}%</Text>
                  </View>
                  
                  <View className='meal-gauge-right'>
                    <View className='meal-gauge-circle'>
                      <View
                        className='meal-gauge-ring'
                        style={{
                          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                            `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='${radius}' fill='none' stroke='#f0f0f0' stroke-width='12'/><circle cx='50' cy='50' r='${radius}' fill='none' stroke='${color}' stroke-width='12' stroke-linecap='round' stroke-dasharray='${circumference}' stroke-dashoffset='${circumference * (1 - progress)}'/></svg>`
                          )}")`,
                          backgroundSize: '100% 100%'
                        }}
                      />
                      <View className='meal-gauge-center'>
                        <Text className='meal-gauge-cal' style={{ color }}>{Math.round(cal)}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        <View className='stats-card body-metrics-card'>
          <View className='card-header'>
            <Text className='iconfont icon-shangzhang chart-title-icon' />
            <View className='card-header-copy'>
              <Text className='card-title'>体重与喝水</Text>
              <Text className='card-subtitle'>跨设备同步后，这里会持续累积长期趋势</Text>
            </View>
          </View>

          <View className='body-metrics-grid'>
            <View className='body-metric-panel'>
              <View className='body-metric-panel-header'>
                <Text className='body-metric-title'>体重趋势</Text>
                {latestWeight ? (
                  <Text className='body-metric-main'>
                    {latestWeight.value.toFixed(1)} kg
                  </Text>
                ) : (
                  <Text className='body-metric-empty'>还没有云端体重记录</Text>
                )}
              </View>
              {latestWeight ? (
                <Text className='body-metric-sub'>
                  {previousWeight
                    ? `${weightChange && weightChange > 0 ? '+' : ''}${toSafeNumber(weightChange).toFixed(1)} kg，较上次`
                    : '已开始累计体重趋势'}
                </Text>
              ) : null}
              {weightTrend.length > 0 ? (
                <View className='weight-chip-row'>
                  {weightTrend.slice(-(range === 'week' ? 7 : 10)).map((item) => (
                    <View key={item.date} className='weight-chip'>
                      <Text className='weight-chip-date'>{item.date.slice(5)}</Text>
                      <Text className='weight-chip-value'>{item.value.toFixed(1)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <View className='body-metric-panel water-panel'>
              <View className='body-metric-panel-header'>
                <Text className='body-metric-title'>喝水趋势</Text>
                <Text className='body-metric-main'>
                  {avgDailyWaterMl.toFixed(0)} ml
                </Text>
              </View>
              <Text className='body-metric-sub'>
                日均 {avgDailyWaterMl.toFixed(0)} ml，目标 {waterGoalMl} ml，累计 {totalWaterMl.toFixed(0)} ml
              </Text>
              {waterTrend.length > 0 ? (
                <View className='water-trend-chart'>
                  {waterTrend.map((item) => {
                    const pct = maxWaterValue > 0 ? Math.max((toSafeNumber(item.total) / maxWaterValue) * 100, 8) : 8
                    return (
                      <View key={item.date} className='water-trend-col'>
                        <View className='water-trend-bar-wrap'>
                          <View className='water-trend-bar' style={{ height: `${pct}%` }} />
                        </View>
                        <Text className='water-trend-label'>{item.date.slice(5)}</Text>
                      </View>
                    )
                  })}
                </View>
              ) : null}
              <View className='water-metric-footer'>
                <Text className='water-metric-note'>
                  {waterRecordedDays > 0 ? `已有 ${waterRecordedDays} 天饮水记录` : '还没有云端喝水记录'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 分析报告 */}
        <View className='stats-card analysis-card'>
          <View className='card-header'>
            <View className='card-header-copy'>
              <Text className='card-title'>AI 营养洞察</Text>
              <Text className='card-subtitle'>默认读取缓存，需要时手动更新</Text>
            </View>
            <View
              className={`analysis-action-btn${insightActionLoading ? ' disabled' : ''}`}
              onClick={insightActionLoading ? undefined : handleGenerateInsight}
            >
              <Text className='analysis-action-btn-text'>
                {insightActionLoading ? '生成中...' : hasInsight ? '手动更新' : '立即生成'}
              </Text>
            </View>
          </View>
          <View className='ai-disclaimer'>
            <Text className='ai-disclaimer-text'>本内容由人工智能生成，仅供健康参考，不代替专业医疗建议。</Text>
          </View>
          {insightGeneratedDate ? (
            <View className={`analysis-status${insightNeedsRefresh ? ' warning' : ''}`}>
              <Text className='analysis-status-text'>
                {insightNeedsRefresh
                  ? `当前展示的是 ${insightGeneratedDate} 生成的缓存，你最近新增了饮食记录，可按需手动更新。`
                  : `当前展示的是 ${insightGeneratedDate} 生成的缓存。`}
              </Text>
            </View>
          ) : null}
          {insightError ? (
            <View className='analysis-error'>
              <Text className='analysis-error-text'>{insightError}</Text>
            </View>
          ) : null}
          {displayInsightText ? (
            <Text className='analysis-content'>{displayInsightText}</Text>
          ) : insightActionLoading || isTyping ? (
            <View className='analysis-loading'>
              <Text className='iconfont icon-jiazaixiao analysis-loading-icon' />
              <Text className='analysis-loading-text'>
                {insightActionLoading ? 'AI 正在生成当前统计周期的营养洞察，请稍候...' : '正在展示已生成的洞察...'}
              </Text>
            </View>
          ) : (
            <View className='analysis-empty'>
              <Text className='analysis-empty-text'>这里不会在每次打开页面时自动重新分析。你可以在需要时手动生成一次。</Text>
              <View className='analysis-empty-action' onClick={handleGenerateInsight}>
                <Text className='analysis-empty-action-text'>生成本{range === 'week' ? '周' : '月'}洞察</Text>
              </View>
            </View>
          )}
        </View>

        <View className='footer-placeholder' />
      </ScrollView>
    </View>
  )
}

