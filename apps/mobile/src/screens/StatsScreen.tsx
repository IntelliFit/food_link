import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import type { StatsRange, StatsSummary } from '@food-link/core'
import { apiClient } from '../api'
import { Card } from '../components/Card'
import { MacroRow } from '../components/MacroRow'
import { Page } from '../components/Page'
import { colors } from '../theme'

export function StatsScreen() {
  const [range, setRange] = useState<StatsRange>('week')
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await apiClient.getStatsSummary(range))
    } catch (error) {
      Alert.alert('获取分析失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  const health = summary?.health_index

  return (
    <Page title="分析" subtitle="对齐小程序分析页：健康指数、AI 分析和热量结构。" refreshing={loading} onRefresh={load}>
      <View style={styles.switchRow}>
        <RangeButton label="近一周" active={range === 'week'} onPress={() => setRange('week')} />
        <RangeButton label="近一月" active={range === 'month'} onPress={() => setRange('month')} />
      </View>

      <Card>
        <Text style={styles.sectionTitle}>摄入趋势</Text>
        <Text style={styles.bigNumber}>{Math.round(summary?.avg_calories_per_day || 0)} kcal</Text>
        <Text style={styles.subtitle}>日均摄入 · 连续记录 {summary?.streak_days || 0} 天</Text>
        <MacroRow label="蛋白质" value={summary?.total_protein} target={summary?.total_calories ? summary.total_calories * 0.18 / 4 : 0} />
        <MacroRow label="碳水" value={summary?.total_carbs} target={summary?.total_calories ? summary.total_calories * 0.5 / 4 : 0} />
        <MacroRow label="脂肪" value={summary?.total_fat} target={summary?.total_calories ? summary.total_calories * 0.3 / 9 : 0} />
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>健康指数</Text>
          <Text style={styles.score}>{health?.overall_score ?? '--'}</Text>
        </View>
        <Text style={styles.subtitle}>
          {health?.overview_copy || '记录更多饮食、体重、喝水和运动数据后，会生成更完整的健康指数。'}
        </Text>
        {(health?.risk_cards || []).slice(0, 3).map((card) => (
          <View key={card.key} style={styles.riskRow}>
            <Text style={styles.riskTitle}>{card.title}</Text>
            <Text style={styles.riskBrief}>{card.brief}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>AI 分析</Text>
        <Text style={styles.analysisText}>
          {summary?.analysis_summary || '暂未生成分析。后续会继续迁移小程序的 AI 风险解读、关注项和自定义关注卡片。'}
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>餐次结构</Text>
        {Object.entries(summary?.by_meal || {}).filter(([, value]) => value > 0).slice(0, 6).map(([key, value]) => (
          <View key={key} style={styles.mealLine}>
            <Text style={styles.mealName}>{key}</Text>
            <Text style={styles.mealValue}>{Math.round(value)} kcal</Text>
          </View>
        ))}
      </Card>
    </Page>
  )
}

function RangeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.rangeButton, active && styles.rangeButtonActive]}>
      <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  rangeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  rangeButtonActive: {
    backgroundColor: colors.brand,
  },
  rangeText: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  rangeTextActive: {
    color: '#fff',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  bigNumber: {
    fontSize: 32,
    color: colors.brandDark,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  score: {
    color: colors.brandDark,
    fontSize: 26,
    fontWeight: '900',
  },
  riskRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#eef2f7',
  },
  riskTitle: {
    color: colors.text,
    fontWeight: '800',
  },
  riskBrief: {
    marginTop: 4,
    color: colors.textSecondary,
  },
  analysisText: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  mealLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  mealName: {
    color: colors.textSecondary,
  },
  mealValue: {
    color: colors.text,
    fontWeight: '800',
  },
})
