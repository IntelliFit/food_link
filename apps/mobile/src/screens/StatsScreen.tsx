import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  normalizeInsightText,
  type RiskCard,
  type StatsInsightResult,
  type StatsRange,
  type StatsSummary,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { InsightMarkdownView } from '../components/InsightMarkdownView'
import { MacroRow } from '../components/MacroRow'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

function insightContent(result: StatsInsightResult): string {
  return normalizeInsightText(String(result.analysis_summary || result.content || ''))
}

export function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [range, setRange] = useState<StatsRange>('week')
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightError, setInsightError] = useState('')
  const [expandedRiskKey, setExpandedRiskKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setInsightError('')
    try {
      setSummary(await apiClient.getStatsSummary(range))
    } catch (error) {
      Alert.alert('获取分析失败', userFacingErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  const health = summary?.health_index
  const riskCards = health?.risk_cards || []
  const insightText = useMemo(() => normalizeInsightText(summary?.analysis_summary || ''), [summary?.analysis_summary])
  const recordedDays = Math.max(0, Number(summary?.recorded_days ?? 0))
  const insightMeta = insightStatusText(summary)

  const generateInsight = useCallback(async () => {
    if (insightLoading) return
    if (recordedDays <= 0) {
      setInsightError('还没有饮食记录，先记录至少一餐后再生成 AI 风险解读。')
      return
    }

    setInsightLoading(true)
    setInsightError('')
    try {
      const result = await apiClient.generateStatsInsight(range)
      const content = insightContent(result)
      if (!content) throw new Error('本次没有生成有效解读，请稍后重试。')
      setSummary((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          analysis_summary: content,
          analysis_summary_generated_date: result.analysis_summary_generated_date || result.generated_date || prev.analysis_summary_generated_date,
          analysis_summary_needs_refresh: Boolean(result.analysis_summary_needs_refresh ?? result.needs_refresh),
          analysis_summary_daily_limit: result.analysis_summary_daily_limit ?? result.daily_limit ?? prev.analysis_summary_daily_limit,
          analysis_summary_used_today: result.analysis_summary_used_today ?? result.used_today ?? prev.analysis_summary_used_today,
        }
      })
      Alert.alert('已更新', 'AI 风险解读已生成')
    } catch (error) {
      const message = userFacingErrorMessage(error, 'AI 风险解读生成失败')
      setInsightError(message)
      Alert.alert('生成失败', message)
    } finally {
      setInsightLoading(false)
    }
  }, [insightLoading, range, recordedDays])

  return (
    <Page title="分析" subtitle="健康指数、AI 解读和餐次结构" refreshing={loading} onRefresh={load}>
      <View style={styles.switchRow}>
        <RangeButton label="近一周" active={range === 'week'} onPress={() => setRange('week')} />
        <RangeButton label="近一月" active={range === 'month'} onPress={() => setRange('month')} />
      </View>
      <View style={styles.quickGrid}>
        <QuickEntry label="AI 助手" onPress={() => navigation.navigate('AiAssistant')} />
        <QuickEntry label="代谢分析" onPress={() => navigation.navigate('StatsMetabolic')} />
      </View>
      <View style={styles.quickGrid}>
        <QuickEntry label="身体趋势" onPress={() => navigation.navigate('BodyTrends')} />
        <QuickEntry label="体重趋势" onPress={() => navigation.navigate('TrendDetail', { kind: 'weight' })} />
      </View>
      <View style={styles.quickGrid}>
        <QuickEntry label="饮水趋势" onPress={() => navigation.navigate('TrendDetail', { kind: 'water' })} />
        <QuickEntry label="运动趋势" onPress={() => navigation.navigate('TrendDetail', { kind: 'exercise' })} />
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
        {riskCards.slice(0, 6).map((card) => (
          <RiskCardRow
            key={card.key}
            card={card}
            expanded={expandedRiskKey === card.key}
            onPress={() => setExpandedRiskKey((prev) => (prev === card.key ? null : card.key))}
          />
        ))}
        {(health?.action_list || []).length ? (
          <View style={styles.actionList}>
            <Text style={styles.actionListTitle}>优先行动</Text>
            {(health?.action_list || []).slice(0, 3).map((item, index) => (
              <View key={`${item}-${index}`} style={styles.actionItem}>
                <Text style={styles.actionBullet}>{index + 1}</Text>
                <Text style={styles.actionText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>AI 风险解读</Text>
          {insightMeta ? <Text style={styles.metaPill}>{insightMeta}</Text> : null}
        </View>
        {summary?.analysis_summary_needs_refresh ? (
          <Text style={styles.refreshHint}>当前数据有更新，建议重新生成一次解读。</Text>
        ) : null}
        {insightText ? (
          <View style={styles.markdownBlock}>
            <InsightMarkdownView text={insightText} />
          </View>
        ) : (
          <View style={styles.emptyInsight}>
            <Text style={styles.emptyInsightTitle}>先记录饮食后生成 AI 风险解读</Text>
            <Text style={styles.subtitle}>会按当前统计周期整理风险趋势、判断依据和下一步行动。</Text>
          </View>
        )}
        {insightError ? <Text style={styles.errorText}>{insightError}</Text> : null}
        <AppButton
          label={insightText ? '更新 AI 风险解读' : '生成 AI 风险解读'}
          loading={insightLoading}
          onPress={generateInsight}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>餐次结构</Text>
        {Object.entries(summary?.by_meal || {}).filter(([, value]) => value > 0).slice(0, 6).map(([key, value]) => (
          <View key={key} style={styles.mealLine}>
            <Text style={styles.mealName}>{mealLabel(key)}</Text>
            <Text style={styles.mealValue}>{Math.round(value)} kcal</Text>
          </View>
        ))}
        {Object.values(summary?.by_meal || {}).every((value) => value <= 0) ? (
          <Text style={styles.subtitle}>记录餐食后会展示各餐次热量结构。</Text>
        ) : null}
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

function QuickEntry({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickEntry} onPress={onPress}>
      <Text style={styles.quickEntryText}>{label}</Text>
    </Pressable>
  )
}

function RiskCardRow({ card, expanded, onPress }: { card: RiskCard; expanded: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.riskRow} onPress={onPress}>
      <View style={styles.riskHeader}>
        <View style={styles.riskTitleWrap}>
          <Text style={styles.riskTitle}>{card.title}</Text>
          <Text style={styles.riskBrief}>{card.brief}</Text>
        </View>
        <View style={[styles.riskScorePill, riskToneStyle(card.tone)]}>
          <Text style={styles.riskScoreText}>{Math.round(card.score)}分</Text>
        </View>
      </View>
      {expanded ? (
        <View style={styles.riskDetail}>
          <Text style={styles.riskDetailLabel}>判断依据</Text>
          <Text style={styles.riskDetailText}>{card.basis || card.summary}</Text>
          <Text style={styles.riskDetailLabel}>最小改善动作</Text>
          <Text style={styles.riskDetailText}>{card.action}</Text>
          <Text style={styles.riskDelta}>预计可提升 {Math.round(card.delta || 0)} 分</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function insightStatusText(summary: StatsSummary | null): string {
  if (!summary) return ''
  const used = summary.analysis_summary_used_today
  const limit = summary.analysis_summary_daily_limit
  if (typeof used === 'number' && typeof limit === 'number' && limit > 0) {
    return `${used}/${limit} 次`
  }
  if (summary.analysis_summary_generated_date) return summary.analysis_summary_generated_date
  return ''
}

function mealLabel(value: string): string {
  const labels: Record<string, string> = {
    breakfast: '早餐',
    morning_snack: '早加餐',
    lunch: '午餐',
    afternoon_snack: '午加餐',
    dinner: '晚餐',
    evening_snack: '晚加餐',
    snack: '加餐',
  }
  return labels[value] || value
}

function riskToneStyle(tone: RiskCard['tone']) {
  if (tone === 'danger') return styles.riskToneDanger
  if (tone === 'warning') return styles.riskToneWarning
  if (tone === 'positive') return styles.riskTonePositive
  return styles.riskToneNeutral
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  quickEntry: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: colors.brandSoft,
  },
  quickEntryText: {
    color: colors.brandDark,
    fontWeight: '800',
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
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  riskTitleWrap: {
    flex: 1,
  },
  riskTitle: {
    color: colors.text,
    fontWeight: '800',
  },
  riskBrief: {
    marginTop: 4,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  riskScorePill: {
    minWidth: 54,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  riskScoreText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  riskTonePositive: {
    backgroundColor: colors.brandSoft,
  },
  riskToneNeutral: {
    backgroundColor: colors.surfaceMuted,
  },
  riskToneWarning: {
    backgroundColor: '#fff7ed',
  },
  riskToneDanger: {
    backgroundColor: '#fef2f2',
  },
  riskDetail: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  riskDetailLabel: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 4,
  },
  riskDetailText: {
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 10,
  },
  riskDelta: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  actionList: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionListTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 8,
  },
  actionItem: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
  },
  actionBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 22,
    backgroundColor: colors.brandSoft,
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  actionText: {
    flex: 1,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  metaPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.brandSoft,
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  refreshHint: {
    color: colors.orange,
    lineHeight: 20,
    marginBottom: 10,
  },
  markdownBlock: {
    gap: 8,
    marginBottom: 14,
  },
  emptyInsight: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 14,
  },
  emptyInsightTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 4,
  },
  errorText: {
    color: colors.danger,
    lineHeight: 20,
    marginBottom: 12,
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
