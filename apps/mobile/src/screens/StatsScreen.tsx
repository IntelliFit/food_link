import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  normalizeInsightText,
  type RiskCard,
  type StatsInsightResult,
  type StatsRange,
  type StatsSummary,
} from '@food-link/core'
import { BarChart3, ChevronDown, HeartPulse, LineChart, PieChart, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react-native'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { InsightMarkdownView } from '../components/InsightMarkdownView'
import { MacroRow } from '../components/MacroRow'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, radius } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type AnalysisPanel = 'health' | 'nutrition' | 'structure'

const analysisTabs: Array<{ key: AnalysisPanel; label: string }> = [
  { key: 'health', label: '健康指数' },
  { key: 'nutrition', label: 'AI分析' },
  { key: 'structure', label: '热量分布' },
]

function insightContent(result: StatsInsightResult): string {
  return normalizeInsightText(String(result.analysis_summary || result.content || ''))
}

export function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const [range, setRange] = useState<StatsRange>('week')
  const [panel, setPanel] = useState<AnalysisPanel>('health')
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
      void dialog.alert('获取分析失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setLoading(false)
    }
  }, [dialog, range])

  useEffect(() => {
    void load()
  }, [load])

  const health = summary?.health_index
  const riskCards = health?.risk_cards || []
  const insightText = useMemo(() => normalizeInsightText(summary?.analysis_summary || ''), [summary?.analysis_summary])
  const recordedDays = Math.max(0, Number(summary?.recorded_days ?? summary?.streak_days ?? 0))
  const hasEnoughHealthData = Boolean(health?.has_enough_data)
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
      void dialog.alert('已更新', 'AI 风险解读已生成', 'success')
    } catch (error) {
      const message = userFacingErrorMessage(error, 'AI 风险解读生成失败')
      setInsightError(message)
      void dialog.alert('生成失败', message, 'danger')
    } finally {
      setInsightLoading(false)
    }
  }, [dialog, insightLoading, range, recordedDays])

  return (
    <Page title="分析" subtitle="健康指数、AI 解读和餐次结构" refreshing={loading} onRefresh={load}>
      <View style={styles.rangeRow}>
        <RangeButton label="近一周" active={range === 'week'} onPress={() => setRange('week')} />
        <RangeButton label="近一月" active={range === 'month'} onPress={() => setRange('month')} />
      </View>

      {hasEnoughHealthData ? (
        <HealthOverviewCard health={health} summary={summary} />
      ) : (
        <Card>
          <View style={styles.gateRow}>
            <View style={styles.gateIcon}>
              <TrendingUp size={24} color="#5c9ed4" strokeWidth={2.3} />
            </View>
            <View style={styles.gateCopy}>
              <Text style={styles.gateTitle}>连续记录两天后显示健康指数</Text>
              <Text style={styles.subtitle}>
                当前已记录 {recordedDays} 天。请连续记录两天以上，我们会基于更稳定的饮食趋势展示你的健康参考指数。
              </Text>
            </View>
          </View>
        </Card>
      )}

      <View style={styles.segmented}>
        {analysisTabs.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [styles.segmentItem, panel === item.key && styles.segmentItemActive, pressed && styles.pressed]}
            onPress={() => setPanel(item.key)}
          >
            <Text style={[styles.segmentText, panel === item.key && styles.segmentTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {panel === 'health' ? (
        <HealthPanel
          hasEnoughHealthData={hasEnoughHealthData}
          riskCards={riskCards}
          health={health}
          expandedRiskKey={expandedRiskKey}
          onToggleRisk={(key) => setExpandedRiskKey((prev) => (prev === key ? null : key))}
        />
      ) : null}

      {panel === 'nutrition' ? (
        <AiPanel
          summary={summary}
          insightText={insightText}
          insightMeta={insightMeta}
          insightError={insightError}
          insightLoading={insightLoading}
          onGenerate={generateInsight}
        />
      ) : null}

      {panel === 'structure' ? <StructurePanel summary={summary} /> : null}

      <Card>
        <Text style={styles.sectionTitle}>更多分析</Text>
        <View style={styles.toolGrid}>
          <AnalysisTool icon={Sparkles} label="AI 助手" onPress={() => navigation.navigate('AiAssistant')} />
          <AnalysisTool icon={HeartPulse} label="代谢分析" onPress={() => navigation.navigate('StatsMetabolic')} />
          <AnalysisTool icon={LineChart} label="身体趋势" onPress={() => navigation.navigate('BodyTrends')} />
        </View>
      </Card>
    </Page>
  )
}

function HealthOverviewCard({ health, summary }: { health: StatsSummary['health_index']; summary: StatsSummary | null }) {
  const score = Math.round(health?.overall_score ?? 0)
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View>
          <Text style={styles.sectionTitle}>关注综合分</Text>
          <Text style={styles.subtitle}>连续记录 {summary?.streak_days || 0} 天 · 当前周期</Text>
        </View>
        <View style={[styles.scoreBadge, riskToneStyle(scoreToTone(score))]}>
          <Text style={styles.scoreBadgeText}>{scoreToLabel(score)}</Text>
        </View>
      </View>
      <View style={styles.scoreRow}>
        <Text style={styles.scoreNumber}>{score || '--'}</Text>
        <Text style={styles.scoreUnit}>/ 100</Text>
      </View>
      <Text style={styles.subtitle}>
        {health?.overview_copy || '结果仅供健康习惯参考，不代替医学判断。'}
      </Text>
    </Card>
  )
}

function HealthPanel({
  hasEnoughHealthData,
  riskCards,
  health,
  expandedRiskKey,
  onToggleRisk,
}: {
  hasEnoughHealthData: boolean
  riskCards: RiskCard[]
  health: StatsSummary['health_index']
  expandedRiskKey: string | null
  onToggleRisk: (key: string) => void
}) {
  if (!hasEnoughHealthData) return null
  return (
    <Card>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>健康指标关注</Text>
        <Text style={styles.metaText}>仅供参考</Text>
      </View>
      {riskCards.length === 0 ? <Text style={styles.subtitle}>继续记录后会生成可关注的风险卡片。</Text> : null}
      {riskCards.slice(0, 6).map((card) => (
        <RiskCardRow
          key={card.key}
          card={card}
          expanded={expandedRiskKey === card.key}
          onPress={() => onToggleRisk(card.key)}
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
  )
}

function AiPanel({
  summary,
  insightText,
  insightMeta,
  insightError,
  insightLoading,
  onGenerate,
}: {
  summary: StatsSummary | null
  insightText: string
  insightMeta: string
  insightError: string
  insightLoading: boolean
  onGenerate: () => void
}) {
  return (
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
          <Sparkles size={24} color={colors.brandDark} strokeWidth={2.3} />
          <View style={styles.emptyInsightCopy}>
            <Text style={styles.emptyInsightTitle}>先记录饮食后生成 AI 风险解读</Text>
            <Text style={styles.subtitle}>会按当前统计周期整理风险趋势、判断依据和下一步行动。</Text>
          </View>
        </View>
      )}
      {insightError ? <Text style={styles.errorText}>{insightError}</Text> : null}
      <AppButton
        label={insightText ? '更新 AI 风险解读' : '生成 AI 风险解读'}
        loading={insightLoading}
        onPress={onGenerate}
      />
    </Card>
  )
}

function StructurePanel({ summary }: { summary: StatsSummary | null }) {
  return (
    <>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>摄入趋势</Text>
          <BarChart3 size={24} color={colors.brandDark} strokeWidth={2.4} />
        </View>
        <Text style={styles.bigNumber}>{Math.round(summary?.avg_calories_per_day || 0)} kcal</Text>
        <Text style={styles.subtitle}>日均摄入 · 连续记录 {summary?.streak_days || 0} 天</Text>
        <MacroRow label="蛋白质" value={summary?.total_protein} target={summary?.total_calories ? summary.total_calories * 0.18 / 4 : 0} />
        <MacroRow label="碳水" value={summary?.total_carbs} target={summary?.total_calories ? summary.total_calories * 0.5 / 4 : 0} />
        <MacroRow label="脂肪" value={summary?.total_fat} target={summary?.total_calories ? summary.total_calories * 0.3 / 9 : 0} />
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>餐次热量分布</Text>
          <PieChart size={24} color={colors.brandDark} strokeWidth={2.4} />
        </View>
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
    </>
  )
}

function RangeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.rangeButton, active && styles.rangeButtonActive, pressed && styles.pressed]}>
      <Text style={[styles.rangeText, active && styles.rangeTextActive]}>{label}</Text>
      {active ? <ChevronDown size={15} color="#fff" strokeWidth={2.4} /> : null}
    </Pressable>
  )
}

function AnalysisTool({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const Icon = icon
  return (
    <Pressable style={({ pressed }) => [styles.toolChip, pressed && styles.pressed]} onPress={onPress}>
      <Icon size={18} color={colors.brandDark} strokeWidth={2.3} />
      <Text style={styles.toolChipText}>{label}</Text>
    </Pressable>
  )
}

function RiskCardRow({ card, expanded, onPress }: { card: RiskCard; expanded: boolean; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.riskRow, pressed && styles.pressed]} onPress={onPress}>
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

function scoreToTone(score: number): RiskCard['tone'] {
  if (score >= 78) return 'positive'
  if (score >= 60) return 'neutral'
  if (score >= 42) return 'warning'
  return 'danger'
}

function scoreToLabel(score: number): string {
  if (score >= 78) return '偏保护'
  if (score >= 60) return '基本中性'
  if (score >= 42) return '需要关注'
  return '重点关注'
}

function riskToneStyle(tone: RiskCard['tone']) {
  if (tone === 'danger') return styles.riskToneDanger
  if (tone === 'warning') return styles.riskToneWarning
  if (tone === 'positive') return styles.riskTonePositive
  return styles.riskToneNeutral
}

const styles = StyleSheet.create({
  rangeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  rangeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  rangeButtonActive: {
    backgroundColor: colors.brand,
  },
  rangeText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  rangeTextActive: {
    color: '#fff',
  },
  gateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  gateIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf6ff',
  },
  gateCopy: {
    flex: 1,
  },
  gateTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 6,
  },
  segmented: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: 18,
    padding: 6,
    marginBottom: 16,
    backgroundColor: colors.surface,
  },
  segmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: colors.surfaceMuted,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: colors.brandDark,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
    marginBottom: 10,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  scoreBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  scoreBadgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 12,
    marginBottom: 8,
  },
  scoreNumber: {
    color: colors.brandDark,
    fontSize: 40,
    fontWeight: '900',
  },
  scoreUnit: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 7,
    marginLeft: 4,
  },
  bigNumber: {
    fontSize: 32,
    color: colors.brandDark,
    fontWeight: '900',
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
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
    borderRadius: radius.pill,
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
    borderRadius: radius.pill,
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
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 14,
  },
  emptyInsightCopy: {
    flex: 1,
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
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toolChip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    backgroundColor: colors.brandSoft,
  },
  toolChipText: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.72,
  },
})
