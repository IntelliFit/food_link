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

  return (
    <View className='stats-page'>
      <ScrollView className='scroll-wrap' scrollY enhanced showScrollbar={false}>
        {/* 周/月切换 */}
        <View className='tabs'>
          <View
            className={`tab ${range === 'week' ? 'active' : ''}`}
            onClick={() => setRange('week')}
          >
            <Text>近一周</Text>
          </View>
          <View
            className={`tab ${range === 'month' ? 'active' : ''}`}
            onClick={() => setRange('month')}
          >
            <Text>近一月</Text>
          </View>
        </View>

        {/* 热量盈缺看板 */}
        <View className='block card-cal'>
          <Text className='block-title'>热量盈缺</Text>
          <View className='cal-row'>
            <Text className='cal-label'>日均摄入</Text>
            <Text className='cal-value'>{d.avg_calories_per_day.toFixed(0)} kcal</Text>
          </View>
          <View className='cal-row'>
            <Text className='cal-label'>TDEE（日消耗）</Text>
            <Text className='cal-value'>{d.tdee} kcal</Text>
          </View>
          <View className={`cal-diff ${isSurplus ? 'surplus' : 'deficit'}`}>
            <Text className='cal-diff-label'>
              {isSurplus ? '日均盈余' : '日均缺口'}
            </Text>
            <Text className='cal-diff-value'>
              {isSurplus ? '+' : ''}{surplusDeficit.toFixed(0)} kcal
            </Text>
          </View>
        </View>

        {/* 连续记录天数 */}
        <View className='block card-streak'>
          <Text className='block-title'>连续记录</Text>
          <View className='streak-value-wrap'>
            <Text className='streak-value'>{d.streak_days}</Text>
            <Text className='streak-unit'>天</Text>
          </View>
          <Text className='streak-desc'>健康饮食连续记录天数</Text>
        </View>

        {/* 饮食结构：按餐次 */}
        <View className='block'>
          <Text className='block-title'>饮食结构（按餐次）</Text>
          {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((key) => (
            <View key={key} className='row'>
              <Text className='label'>{MEAL_NAMES[key]}</Text>
              <Text className='value'>{d.by_meal[key].toFixed(0)} kcal</Text>
            </View>
          ))}
        </View>

        {/* 宏量营养素占比 */}
        <View className='block'>
          <Text className='block-title'>宏量营养素占比</Text>
          <View className='macro-bars'>
            <View className='macro-item'>
              <Text className='macro-label'>蛋白质</Text>
              <View className='macro-bar-wrap'>
                <View
                  className='macro-bar protein'
                  style={{ width: `${d.macro_percent.protein}%` }}
                />
              </View>
              <Text className='macro-pct'>{d.macro_percent.protein}%</Text>
            </View>
            <View className='macro-item'>
              <Text className='macro-label'>碳水</Text>
              <View className='macro-bar-wrap'>
                <View
                  className='macro-bar carbs'
                  style={{ width: `${d.macro_percent.carbs}%` }}
                />
              </View>
              <Text className='macro-pct'>{d.macro_percent.carbs}%</Text>
            </View>
            <View className='macro-item'>
              <Text className='macro-label'>脂肪</Text>
              <View className='macro-bar-wrap'>
                <View
                  className='macro-bar fat'
                  style={{ width: `${d.macro_percent.fat}%` }}
                />
              </View>
              <Text className='macro-pct'>{d.macro_percent.fat}%</Text>
            </View>
          </View>
          <View className='row'>
            <Text className='label'>蛋白质总量</Text>
            <Text className='value'>{d.total_protein.toFixed(1)} g</Text>
          </View>
          <View className='row'>
            <Text className='label'>碳水总量</Text>
            <Text className='value'>{d.total_carbs.toFixed(1)} g</Text>
          </View>
          <View className='row'>
            <Text className='label'>脂肪总量</Text>
            <Text className='value'>{d.total_fat.toFixed(1)} g</Text>
          </View>
        </View>

        {/* 每日热量（简要列表） */}
        {d.daily_calories.length > 0 && (
          <View className='block'>
            <Text className='block-title'>每日摄入</Text>
            {d.daily_calories.slice(-7).reverse().map((item) => (
              <View key={item.date} className='row'>
                <Text className='label'>{item.date}</Text>
                <Text className='value'>{item.calories.toFixed(0)} kcal</Text>
              </View>
            ))}
          </View>
        )}

        {/* 分析报告 */}
        {d.analysis_summary && (
          <View className='block block-analysis'>
            <Text className='block-title'>分析报告</Text>
            <Text className='analysis-text'>{d.analysis_summary}</Text>
          </View>
        )}

        <View className='footer-placeholder' />
      </ScrollView>
    </View>
  )
}
