import { View, Text, ScrollView } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro from '@tarojs/taro'
import { getStatsSummary, type StatsSummary } from '../../utils/api'

import './index.scss'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

export default function StatsPage() {
  const [range, setRange] = useState<'week' | 'month'>('week')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      const res = await getStatsSummary(r)
      setData(res)
    } catch (e: unknown) {
      setError((e as Error).message || '获取统计失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats(range)
  }, [range, fetchStats])

  if (loading && !data) {
    return (
      <View className='stats-page'>
        <View className='loading-wrap'>
          <Text className='loading-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  if (error && !data) {
    return (
      <View className='stats-page'>
        <View className='error-wrap'>
          <Text className='error-text'>{error}</Text>
          <View className='btn-primary' onClick={() => fetchStats(range)}>
            <Text className='btn-text'>重试</Text>
          </View>
        </View>
      </View>
    )
  }

  const d = data!
  const surplusDeficit = d.cal_surplus_deficit
  const isSurplus = surplusDeficit > 0

  // Calculate max calories for the chart scaling
  const maxDailyCalories = d.daily_calories.length > 0
    ? Math.max(...d.daily_calories.map(i => i.calories))
    : 2000

  return (
    <View className='stats-page'>
      <ScrollView className='scroll-wrap' scrollY enhanced showScrollbar={false}>
        <View className='page-header'>
          <Text className='page-title'>数据统计</Text>
          <Text className='page-subtitle'>掌握您的热量收支与营养结构</Text>
        </View>

        {/* 周/月切换 - Segmented Control */}
        <View className='tabs-container'>
          <View className='segmented-control'>
            <View
              className={`segment-item ${range === 'week' ? 'active' : ''}`}
              onClick={() => setRange('week')}
            >
              <Text>近一周</Text>
            </View>
            <View
              className={`segment-item ${range === 'month' ? 'active' : ''}`}
              onClick={() => setRange('month')}
            >
              <Text>近一月</Text>
            </View>
          </View>
        </View>

        {/* 热量盈缺看板 - Hero Card */}
        <View className={`stats-card hero-card ${isSurplus ? 'surplus-mode' : 'deficit-mode'}`}>
          <View className='hero-header'>
            <Text className='hero-title'>平均每日{isSurplus ? '盈余' : '缺口'}</Text>
            <View className='hero-badge'>
              {isSurplus ? '⚠️ 热量超标' : '✅ 保持良好'}
            </View>
          </View>

          <View className='hero-main-value'>
            <Text className='hero-number'>{Math.abs(surplusDeficit).toFixed(0)}</Text>
            <Text className='hero-unit'>kcal</Text>
          </View>

          <View className='hero-grid'>
            <View className='hero-item'>
              <Text className='hero-label'>日均摄入</Text>
              <Text className='hero-sub-value'>{d.avg_calories_per_day.toFixed(0)}</Text>
            </View>
            <View className='hero-divider'></View>
            <View className='hero-item'>
              <Text className='hero-label'>日均消耗(TDEE)</Text>
              <Text className='hero-sub-value'>{d.tdee}</Text>
            </View>
          </View>
        </View>

        {/* 连续记录天数 - Streak Card */}
        <View className='stats-card streak-card'>
          <View className='streak-icon'>🔥</View>
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
        {d.daily_calories.length > 0 && (
          <View className='stats-card chart-card'>
            <View className='card-header'>
              <Text className='card-title'>摄入趋势</Text>
            </View>
            <View className='bar-chart-container'>
              {d.daily_calories.slice(-7).map((item) => {
                const heightPct = Math.max((item.calories / maxDailyCalories) * 100, 10);
                const isToday = item.date === new Date().toISOString().split('T')[0]; // Simple check, might need improve
                // Actually simplified date check for demo
                return (
                  <View key={item.date} className='chart-col'>
                    <View className='bar-wrapper'>
                      <View
                        className={`bar-fill ${item.calories > d.tdee ? 'over' : ''}`}
                        style={{ height: `${heightPct}%` }}
                      ></View>
                    </View>
                    <Text className='bar-label'>{item.date.slice(5)}</Text>
                  </View>
                )
              })}
            </View>
          </View>
        )}

        {/* 宏量营养素占比 - Macro Card */}
        <View className='stats-card macro-card'>
          <View className='card-header'>
            <Text className='card-title'>营养素占比</Text>
          </View>

          <View className='macro-list'>
            <View className='macro-row'>
              <View className='macro-info'>
                <Text className='macro-name'>蛋白质</Text>
                <Text className='macro-detail'>{d.total_protein.toFixed(0)}g / {d.macro_percent.protein}%</Text>
              </View>
              <View className='progress-track'>
                <View className='progress-fill protein' style={{ width: `${d.macro_percent.protein}%` }}></View>
              </View>
            </View>

            <View className='macro-row'>
              <View className='macro-info'>
                <Text className='macro-name'>碳水化合物</Text>
                <Text className='macro-detail'>{d.total_carbs.toFixed(0)}g / {d.macro_percent.carbs}%</Text>
              </View>
              <View className='progress-track'>
                <View className='progress-fill carbs' style={{ width: `${d.macro_percent.carbs}%` }}></View>
              </View>
            </View>

            <View className='macro-row'>
              <View className='macro-info'>
                <Text className='macro-name'>脂肪</Text>
                <Text className='macro-detail'>{d.total_fat.toFixed(0)}g / {d.macro_percent.fat}%</Text>
              </View>
              <View className='progress-track'>
                <View className='progress-fill fat' style={{ width: `${d.macro_percent.fat}%` }}></View>
              </View>
            </View>
          </View>
        </View>

        {/* 饮食结构 - Meal Structure */}
        <View className='stats-card'>
          <View className='card-header'>
            <Text className='card-title'>餐次结构</Text>
          </View>
          <View className='meal-grid'>
            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((key) => {
              const cal = d.by_meal[key];
              const pct = d.avg_calories_per_day > 0 ? (cal / d.avg_calories_per_day) * 100 : 0;
              return (
                <View key={key} className='meal-item'>
                  <View className='meal-icon-box'>
                    <Text>{MEAL_NAMES[key].slice(0, 1)}</Text>
                  </View>
                  <View className='meal-data'>
                    <Text className='meal-name'>{MEAL_NAMES[key]}</Text>
                    <Text className='meal-cal'>{cal.toFixed(0)}</Text>
                  </View>
                  <View className='meal-pct'>
                    <Text>{pct.toFixed(0)}%</Text>
                  </View>
                </View>
              )
            })}
          </View>
        </View>

        {/* 分析报告 */}
        {d.analysis_summary && (
          <View className='stats-card analysis-card'>
            <View className='card-header'>
              <Text className='card-title'>💡 AI 营养洞察</Text>
            </View>
            <Text className='analysis-content'>{d.analysis_summary}</Text>
          </View>
        )}

        <View className='footer-placeholder' />
      </ScrollView>
    </View>
  )
}
