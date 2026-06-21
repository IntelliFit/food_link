import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Svg, { Circle } from 'react-native-svg'
import {
  normalizeInsightText,
  type BodyMetricsSummary,
  type RiskCard,
  type StatsInsightResult,
  type StatsRange,
  type StatsSummary,
} from '@food-link/core'
import {
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import { IconfontText } from '../components/Iconfont'
import { InsightMarkdownView } from '../components/InsightMarkdownView'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, compactFont, radius } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type AnalysisPanel = 'health' | 'nutrition' | 'structure'

type MealKey = 'breakfast' | 'morning_snack' | 'lunch' | 'afternoon_snack' | 'dinner' | 'evening_snack'

const analysisTabs: Array<{ key: AnalysisPanel; label: string }> = [
  { key: 'health', label: '健康指数' },
  { key: 'nutrition', label: 'AI分析' },
  { key: 'structure', label: '热量分布' },
]

const rangeOptions: Array<{ key: StatsRange; label: string; helper: string }> = [
  { key: 'week', label: '近一周', helper: '最近 7 天' },
  { key: 'month', label: '近一个月', helper: '最近 30 天' },
]

const mealOrder: MealKey[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']

const mealNames: Record<MealKey, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
}

const mealColors: Record<MealKey, string> = {
  breakfast: '#5cb896',
  morning_snack: '#5cb896',
  lunch: '#5c9ed4',
  afternoon_snack: '#5c9ed4',
  dinner: '#f0985c',
  evening_snack: '#f0985c',
}

function insightContent(result: StatsInsightResult): string {
  return normalizeInsightText(String(result.analysis_summary || result.content || ''))
}

export function StatsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const dialog = useAppDialog()
  const [range, setRange] = useState<StatsRange>('week')
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false)
  const [panel, setPanel] = useState<AnalysisPanel>('health')
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightError, setInsightError] = useState('')
  const [selectedRisk, setSelectedRisk] = useState<RiskCard | null>(null)

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
  const visibleRiskCards = riskCards.slice(0, 6)
  const insightText = useMemo(() => normalizeInsightText(summary?.analysis_summary || ''), [summary?.analysis_summary])
  const recordedDays = Math.max(0, Number(summary?.recorded_days ?? summary?.streak_days ?? 0))
  const hasEnoughHealthData = Boolean(health?.has_enough_data)
  const hasAnyDietData = recordedDays > 0 || Number(summary?.total_calories || 0) > 0 || (summary?.daily_calories || []).some((item) => Number(item.calories) > 0)
  const healthScore = Math.round(health?.overall_score ?? averageRiskScore(riskCards) ?? 0)
  const projectedScore = Math.round(health?.projected_score ?? Math.min(100, healthScore + averageRiskDelta(riskCards)))
  const focusOverviewCopy = health?.overview_copy || scoreToFocusOverview(healthScore, riskCards.length > 0)
  const signalChips = [
    { label: '记录天数', value: `${recordedDays} 天` },
    { label: '日均摄入', value: `${Math.round(summary?.avg_calories_per_day || 0)} kcal` },
    { label: '摄入差额', value: signedKcal(summary?.cal_surplus_deficit || 0) },
    { label: '连续记录', value: `${summary?.streak_days || 0} 天` },
  ]
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
    <View style={styles.page}>
      <View style={styles.topWash} pointerEvents="none" />
      <Pressable
        style={[styles.rangeDropdown, { top: Math.max(insets.top + 8, 18) }, loading && styles.rangeDropdownLoading]}
        onPress={() => setRangeSheetOpen(true)}
      >
        <Text style={styles.rangeDropdownLabel}>{range === 'week' ? '近一周' : '近一个月'}</Text>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <IconfontText className="iconfont icon-right-arrow" size={14} color="#475569" />
        </View>
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 70, 96),
            paddingBottom: insets.bottom + 110,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        {hasEnoughHealthData ? (
          <>
            <View style={styles.riskOverviewCard}>
              <View style={styles.riskOverviewTop}>
                <View>
                  <Text style={styles.riskOverviewTitle}>关注综合分</Text>
                  <Text style={styles.riskOverviewSubtitle}>当前周期 · {range === 'week' ? '最近 7 天' : '最近 30 天'}</Text>
                </View>
                <View style={[styles.riskOverviewBadge, toneBadgeStyle(scoreToTone(healthScore))]}>
                  <Text style={styles.riskOverviewBadgeText}>{scoreToLabel(healthScore)}</Text>
                </View>
              </View>
              <View style={styles.riskOverviewScoreRow}>
                <Text style={styles.riskOverviewScore}>{healthScore || '--'}</Text>
                <Text style={styles.riskOverviewScoreUnit}>/ 100</Text>
              </View>
              <Text style={styles.riskOverviewHint}>
                如果完成修改，关注综合分约为 {healthScore || '--'} → {projectedScore || '--'}
              </Text>
              <Text style={styles.riskOverviewSummary}>{focusOverviewCopy}</Text>
              <View style={styles.riskOverviewChipRow}>
                {signalChips.map((chip) => (
                  <View key={chip.label} style={styles.riskOverviewChip}>
                    <Text style={styles.riskOverviewChipLabel}>{chip.label}</Text>
                    <Text style={styles.riskOverviewChipValue} numberOfLines={1} adjustsFontSizeToFit>{chip.value}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.disclaimerBanner}>
              <View style={styles.disclaimerDot} />
              <Text style={styles.disclaimerText}>结果仅供参考，不代替医学判断</Text>
              <Text style={styles.disclaimerAction}>已知悉</Text>
            </View>
          </>
        ) : (
          <DataGateCard
            iconClass="icon-shangzhang"
            title="连续记录两天后显示健康指数"
            desc={`当前已记录 ${recordedDays} 天。请连续记录两天以上，我们会基于更稳定的饮食趋势展示你的健康参考指数。`}
          />
        )}

        <View style={styles.analysisTabsContainer}>
          <View style={[styles.segmented, loading && styles.segmentedLoading]}>
            {loading ? (
              <View style={styles.tabsSpinner}>
                <ActivityIndicator size="small" color={colors.brand} />
              </View>
            ) : null}
            {analysisTabs.map((item) => (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles.segmentItem, panel === item.key && styles.segmentItemActive, pressed && styles.pressed]}
                onPress={() => !loading && setPanel(item.key)}
              >
                <Text style={[styles.segmentText, panel === item.key && styles.segmentTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {panel === 'health' ? (
          hasEnoughHealthData ? (
            <HealthPanel riskCards={visibleRiskCards} health={health} onSelectRisk={setSelectedRisk} />
          ) : null
        ) : null}

        {panel === 'nutrition' ? (
          <AiPanel
            summary={summary}
            insightText={insightText}
            insightMeta={insightMeta}
            insightError={insightError}
            insightLoading={insightLoading}
            canUseStatsInsight={hasAnyDietData}
            onGenerate={generateInsight}
          />
        ) : null}

        {panel === 'structure' ? (
          <StructurePanel summary={summary} hasAnyDietData={hasAnyDietData} />
        ) : null}

        <View style={styles.moreCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleGroup}>
              <Sparkles size={19} color={colors.brandDark} strokeWidth={2.4} />
              <View>
                <Text style={styles.cardTitle}>更多分析</Text>
                <Text style={styles.cardSubtitle}>AI、代谢和身体趋势</Text>
              </View>
            </View>
          </View>
          <View style={styles.toolGrid}>
            <AnalysisTool iconClass="icon-yiliaohangyedeICON-" label="AI 助手" onPress={() => navigation.navigate('AiAssistant')} />
            <AnalysisTool iconClass="icon-shentinianling" label="代谢分析" onPress={() => navigation.navigate('StatsMetabolic')} />
            <AnalysisTool iconClass="icon-shangzhang" label="身体趋势" onPress={() => navigation.navigate('BodyTrends')} />
          </View>
        </View>
      </ScrollView>

      <RangeSheet
        visible={rangeSheetOpen}
        current={range}
        onClose={() => setRangeSheetOpen(false)}
        onSelect={(nextRange) => {
          setRange(nextRange)
          setRangeSheetOpen(false)
        }}
      />
      <RiskDetailSheet card={selectedRisk} onClose={() => setSelectedRisk(null)} />
    </View>
  )
}

function HealthPanel({
  riskCards,
  health,
  onSelectRisk,
}: {
  riskCards: RiskCard[]
  health: StatsSummary['health_index']
  onSelectRisk: (card: RiskCard) => void
}) {
  return (
    <>
      <View style={styles.riskSectionHeader}>
        <Text style={styles.riskSectionTitle}>健康指标关注</Text>
        <View style={styles.riskFocusEditBtn}>
          <IconfontText className="iconfont icon-target" size={14} color={colors.brandDark} />
          <Text style={styles.riskFocusEditText}>我的关注</Text>
        </View>
      </View>

      {riskCards.length > 0 ? (
        <View style={styles.riskCardGrid}>
          {riskCards.map((card) => (
            <RiskTile key={card.key} card={card} onPress={() => onSelectRisk(card)} />
          ))}
        </View>
      ) : (
        <View style={styles.statsCard}>
          <Text style={styles.emptyTitle}>继续记录后生成风险卡片</Text>
          <Text style={styles.emptyText}>这里会展示你最需要关注的健康方向、分数和可执行动作。</Text>
        </View>
      )}

      {(health?.action_list || []).length ? (
        <View style={styles.actionPlanPanel}>
          <Text style={styles.actionPlanTitle}>优先行动</Text>
          {(health?.action_list || []).slice(0, 3).map((item, index) => (
            <View key={`${item}-${index}`} style={styles.actionPlanItem}>
              <Text style={styles.actionPlanBullet}>{index + 1}</Text>
              <Text style={styles.actionPlanText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  )
}

function RiskTile({ card, onPress }: { card: RiskCard; onPress: () => void }) {
  const iconClass = riskIconClass(card.key)
  return (
    <Pressable style={({ pressed }) => [styles.riskTile, { backgroundColor: riskBgColor(card.key) }, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.riskTileTop}>
        <View style={[styles.riskIconCircle, { backgroundColor: riskIconBgColor(card.key) }]}>
          <IconfontText className={`iconfont ${iconClass}`} size={19} color={riskIconColor(card.key)} />
        </View>
        <View style={styles.riskScoreWrap}>
          <Text style={styles.riskScore}>{Math.round(card.score)}</Text>
          <Text style={styles.riskScoreUnit}>分</Text>
        </View>
      </View>
      <Text style={styles.riskTileTitle} numberOfLines={1}>{card.title}</Text>
      <Text style={styles.riskTileSummary} numberOfLines={2}>{card.brief || card.summary}</Text>
    </Pressable>
  )
}

function AiPanel({
  summary,
  insightText,
  insightMeta,
  insightError,
  insightLoading,
  canUseStatsInsight,
  onGenerate,
}: {
  summary: StatsSummary | null
  insightText: string
  insightMeta: string
  insightError: string
  insightLoading: boolean
  canUseStatsInsight: boolean
  onGenerate: () => void
}) {
  const canGenerate = canUseStatsInsight && !insightLoading
  return (
    <View style={styles.aiCard}>
      <View style={styles.aiCardTop}>
        <View style={styles.cardTitleGroup}>
          <IconfontText className="iconfont icon-yiliaohangyedeICON-" size={19} color="#3d6b94" />
          <View style={styles.cardTitleCopy}>
            <Text style={styles.aiTitle}>AI 风险解读</Text>
            <Text style={styles.cardSubtitle}>按当前周期生成深度洞察</Text>
          </View>
        </View>
        {insightMeta ? <Text style={styles.aiMetaPill}>{insightMeta}</Text> : null}
      </View>

      {summary?.analysis_summary_needs_refresh ? (
        <View style={styles.analysisStatusWarning}>
          <Text style={styles.analysisStatusText}>最近新增了饮食记录，可按需手动更新。</Text>
        </View>
      ) : null}
      {insightError ? (
        <View style={styles.analysisError}>
          <Text style={styles.analysisErrorText}>{insightError}</Text>
        </View>
      ) : null}

      {!canUseStatsInsight ? (
        <View style={styles.analysisEmptyGate}>
          <Text style={styles.analysisEmptyTitle}>先记录饮食后再生成 AI 风险解读</Text>
          <Text style={styles.analysisEmptyText}>当前统计周期还没有饮食记录。记录至少一餐后，这里会基于真实数据生成解读。</Text>
        </View>
      ) : insightLoading ? (
        <View style={styles.analysisSkeletonGroup}>
          <View style={[styles.skeletonLine, styles.skeletonLine92]} />
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, styles.skeletonLine86]} />
          <View style={[styles.skeletonLine, styles.skeletonLine96]} />
          <View style={[styles.skeletonLine, styles.skeletonLine70]} />
        </View>
      ) : insightText ? (
        <View style={styles.markdownBlock}>
          <InsightMarkdownView text={insightText} />
        </View>
      ) : (
        <View style={styles.analysisEmpty}>
          <Text style={styles.analysisEmptyText}>这里不会在每次打开页面时自动重新分析。你可以在需要时手动生成一次。</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.analysisAction, !canGenerate && styles.analysisActionDisabled, pressed && canGenerate && styles.pressed]}
        onPress={onGenerate}
        disabled={!canGenerate}
      >
        {insightLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.analysisActionText}>
            {insightText ? '更新本周期解读' : '生成本周期解读'}
          </Text>
        )}
      </Pressable>
    </View>
  )
}

function StructurePanel({ summary, hasAnyDietData }: { summary: StatsSummary | null; hasAnyDietData: boolean }) {
  const chartDays = useMemo(() => {
    const days = summary?.range === 'month' ? 14 : 7
    return (summary?.daily_calories || []).slice(-days)
  }, [summary?.daily_calories, summary?.range])
  const maxDailyCalories = Math.max(1, summary?.tdee || 0, ...chartDays.map((item) => Number(item.calories || 0)))
  const macroPercent = buildMacroPercent(summary)
  const totalCalories = Math.max(0, Number(summary?.total_calories || 0))
  const byMeal = buildMealValues(summary)

  if (!hasAnyDietData) {
    return (
      <DataGateCard
        iconClass="icon-rice"
        title="记录饮食后查看营养结构"
        desc="当前统计周期还没有饮食记录。先记录一餐后，这里会展示热量趋势、宏量营养占比和餐次分布。"
      />
    )
  }

  return (
    <>
      <View style={styles.statsCard}>
        <View style={styles.collapsibleHeader}>
          <View style={styles.cardTitleGroup}>
            <IconfontText className="iconfont icon-huore" size={19} color={colors.brandDark} />
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle}>热量摄入趋势</Text>
              <Text style={styles.cardSubtitle}>{summary?.range === 'month' ? '最近 14 天' : '最近 7 天'}摄入变化和超标情况</Text>
            </View>
          </View>
          <IconfontText className="iconfont icon-right-arrow" size={18} color="#94a3b8" />
        </View>
        <View style={styles.barChartContainer}>
          {chartDays.length > 0 ? chartDays.map((item) => (
            <View key={item.date} style={styles.chartCol}>
              <Text style={styles.barCalorieText} numberOfLines={1}>{Math.round(item.calories)}</Text>
              <View style={styles.barWrapper}>
                <View
                  style={[
                    styles.barFill,
                    item.calories > (summary?.tdee || 0) && styles.barFillOver,
                    { height: `${Math.max((Number(item.calories || 0) / maxDailyCalories) * 100, 10)}%` },
                  ]}
                />
              </View>
              <Text style={styles.barLabel}>{item.date.slice(5)}</Text>
            </View>
          )) : (
            <Text style={styles.emptyText}>暂无数据</Text>
          )}
        </View>
      </View>

      <View style={styles.statsCard}>
        <View style={styles.collapsibleHeader}>
          <View style={styles.cardTitleGroup}>
            <IconfontText className="iconfont icon-zhuzhuangtu" size={19} color={colors.brandDark} />
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle}>宏量营养结构</Text>
              <Text style={styles.cardSubtitle}>蛋白质、碳水和脂肪的摄入占比</Text>
            </View>
          </View>
          <IconfontText className="iconfont icon-right-arrow" size={18} color="#94a3b8" />
        </View>
        <MacroStat label="蛋白质" value={Math.round(summary?.total_protein || 0)} percent={macroPercent.protein} color="#5c9ed4" />
        <MacroStat label="碳水化合物" value={Math.round(summary?.total_carbs || 0)} percent={macroPercent.carbs} color="#d4ac52" />
        <MacroStat label="脂肪" value={Math.round(summary?.total_fat || 0)} percent={macroPercent.fat} color="#f0985c" />
      </View>

      <View style={styles.statsCard}>
        <View style={styles.collapsibleHeader}>
          <View style={styles.cardTitleGroup}>
            <IconfontText className="iconfont icon-tubiao-zhuzhuangtu" size={19} color={colors.brandDark} />
            <View style={styles.cardTitleCopy}>
              <Text style={styles.cardTitle}>餐次热量分布</Text>
              <Text style={styles.cardSubtitle}>早餐、午餐、晚餐和加餐的热量占比</Text>
            </View>
          </View>
          <IconfontText className="iconfont icon-right-arrow" size={18} color="#94a3b8" />
        </View>
        <View style={styles.mealGaugeGrid}>
          {mealOrder.map((key) => {
            const calories = byMeal[key]
            const percent = totalCalories > 0 ? (calories / totalCalories) * 100 : 0
            return (
              <MealGauge
                key={key}
                label={mealNames[key]}
                calories={calories}
                percent={percent}
                color={mealColors[key]}
              />
            )
          })}
        </View>
      </View>

      <BodyMetricsCard bodyMetrics={summary?.body_metrics || null} />
    </>
  )
}

function BodyMetricsCard({ bodyMetrics }: { bodyMetrics: BodyMetricsSummary | null }) {
  const latestWeight = bodyMetrics?.latest_weight || null
  const previousWeight = bodyMetrics?.previous_weight || null
  const weightChange = typeof bodyMetrics?.weight_change === 'number' ? bodyMetrics.weight_change : null
  const waterTrend = (bodyMetrics?.water_daily || []).slice(-7)
  const maxWaterValue = Math.max(1, bodyMetrics?.water_goal_ml || 2000, ...waterTrend.map((item) => Number(item.total || 0)))

  return (
    <View style={styles.statsCard}>
      <View style={styles.collapsibleHeader}>
        <View style={styles.cardTitleGroup}>
          <IconfontText className="iconfont icon-shangzhang" size={19} color={colors.brandDark} />
          <View style={styles.cardTitleCopy}>
            <Text style={styles.cardTitle}>长期健康指标</Text>
            <Text style={styles.cardSubtitle}>体重趋势和喝水趋势</Text>
          </View>
        </View>
        <IconfontText className="iconfont icon-right-arrow" size={18} color="#94a3b8" />
      </View>

      <View style={styles.bodyMetricPanel}>
        <View style={styles.bodyMetricPanelHeader}>
          <View style={styles.bodyMetricTitleRow}>
            <IconfontText className="iconfont icon-weight-scale" size={18} color={colors.brandDark} />
            <Text style={styles.bodyMetricTitle}>体重趋势</Text>
          </View>
          {latestWeight ? (
            <Text style={styles.bodyMetricMain}>{Number(latestWeight.value).toFixed(1)} kg</Text>
          ) : (
            <Text style={styles.bodyMetricEmpty}>还没有云端体重记录</Text>
          )}
        </View>
        {latestWeight ? (
          <Text style={styles.bodyMetricSub}>
            {previousWeight && weightChange !== null
              ? `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)} kg，较上次`
              : '已开始累计体重趋势'}
          </Text>
        ) : null}
      </View>

      <View style={[styles.bodyMetricPanel, styles.waterPanel]}>
        <View style={styles.bodyMetricPanelHeader}>
          <View style={styles.bodyMetricTitleRow}>
            <IconfontText className="iconfont icon-drink" size={18} color="#5c9ed4" />
            <Text style={styles.bodyMetricTitle}>喝水趋势</Text>
          </View>
          <Text style={styles.bodyMetricMain}>{Math.round(bodyMetrics?.avg_daily_water_ml || 0)} ml</Text>
        </View>
        <Text style={styles.bodyMetricSub}>
          日均 {Math.round(bodyMetrics?.avg_daily_water_ml || 0)} ml，目标 {bodyMetrics?.water_goal_ml || 2000} ml，累计 {Math.round(bodyMetrics?.total_water_ml || 0)} ml
        </Text>
        {waterTrend.length > 0 ? (
          <View style={styles.waterTrendChart}>
            {waterTrend.map((item) => (
              <View key={item.date} style={styles.waterTrendCol}>
                <View style={styles.waterTrendBarWrap}>
                  <View style={[styles.waterTrendBar, { height: `${Math.max((Number(item.total || 0) / maxWaterValue) * 100, 8)}%` }]} />
                </View>
                <Text style={styles.waterTrendLabel}>{item.date.slice(5)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  )
}

function MacroStat({ label, value, percent, color }: { label: string; value: number; percent: number; color: string }) {
  return (
    <View style={styles.macroRow}>
      <View style={styles.macroInfo}>
        <Text style={styles.macroName}>{label}</Text>
        <Text style={styles.macroDetail}>{value}g / {Math.round(percent)}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { backgroundColor: color, width: `${clampPercent(percent)}%` }]} />
      </View>
    </View>
  )
}

function MealGauge({ label, calories, percent, color }: { label: string; calories: number; percent: number; color: string }) {
  return (
    <View style={styles.mealGaugeItem}>
      <View style={styles.mealGaugeLeft}>
        <View style={[styles.mealGaugeIconWrap, { backgroundColor: `${color}18` }]}>
          <IconfontText className="iconfont icon-rice" size={14} color={color} />
        </View>
        <Text style={styles.mealGaugeLabel}>{label}</Text>
        <Text style={[styles.mealGaugePercent, { color }]}>{percent.toFixed(1)}%</Text>
      </View>
      <View style={styles.mealGaugeCircle}>
        <RingProgress progress={percent / 100} color={color} />
        <View style={styles.mealGaugeCenter}>
          <Text style={[styles.mealGaugeCal, { color }]}>{Math.round(calories)}</Text>
        </View>
      </View>
    </View>
  )
}

function RingProgress({ progress, color }: { progress: number; color: string }) {
  const size = 58
  const stroke = 7
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const safeProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0))
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="#f0f0f0" strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - safeProgress)}
        rotation="-90"
        origin={`${size / 2}, ${size / 2}`}
      />
    </Svg>
  )
}

function DataGateCard({ iconClass, title, desc }: { iconClass: string; title: string; desc: string }) {
  return (
    <View style={styles.dataGateCard}>
      <View style={styles.dataGateIcon}>
        <IconfontText className={`iconfont ${iconClass}`} size={24} color="#5c9ed4" />
      </View>
      <View style={styles.dataGateCopy}>
        <Text style={styles.dataGateTitle}>{title}</Text>
        <Text style={styles.dataGateDesc}>{desc}</Text>
      </View>
    </View>
  )
}

function AnalysisTool({ iconClass, label, onPress }: { iconClass: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.toolChip, pressed && styles.pressed]} onPress={onPress}>
      <IconfontText className={`iconfont ${iconClass}`} size={17} color={colors.brandDark} />
      <Text style={styles.toolChipText}>{label}</Text>
    </Pressable>
  )
}

function RangeSheet({
  visible,
  current,
  onClose,
  onSelect,
}: {
  visible: boolean
  current: StatsRange
  onClose: () => void
  onSelect: (range: StatsRange) => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.rangeSheet, { paddingBottom: Math.max(insets.bottom + 18, 24) }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>统计周期</Text>
          <View style={styles.rangeSheetList}>
            {rangeOptions.map((item) => (
              <Pressable
                key={item.key}
                style={({ pressed }) => [styles.rangeSheetRow, current === item.key && styles.rangeSheetRowActive, pressed && styles.pressed]}
                onPress={() => onSelect(item.key)}
              >
                <View>
                  <Text style={[styles.rangeSheetLabel, current === item.key && styles.rangeSheetLabelActive]}>{item.label}</Text>
                  <Text style={styles.rangeSheetHelper}>{item.helper}</Text>
                </View>
                {current === item.key ? <Text style={styles.rangeSheetCheck}>已选</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function RiskDetailSheet({ card, onClose }: { card: RiskCard | null; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={Boolean(card)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.riskDetailPanel, { paddingBottom: Math.max(insets.bottom + 16, 24) }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHandle} />
          {card ? (
            <>
              <View style={styles.riskDetailHeader}>
                <Text style={styles.riskDetailTitle}>{card.title}</Text>
                <View style={styles.riskDetailScoreRow}>
                  <Text style={styles.riskDetailScore}>{Math.round(card.score)}</Text>
                  <Text style={styles.riskDetailScoreUnit}>分</Text>
                  <View style={[styles.riskDetailBadge, toneBadgeStyle(card.tone)]}>
                    <Text style={styles.riskDetailBadgeText}>{scoreToLabel(card.score)}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.riskDetailBodyText}>{card.summary || card.brief}</Text>
              <View style={styles.riskDetailDivider} />
              <Text style={styles.riskDetailLabel}>判断依据</Text>
              <Text style={styles.riskDetailBodyText}>{card.basis || '暂无明确依据，继续记录后会更准确。'}</Text>
              <View style={styles.riskDetailDivider} />
              <Text style={styles.riskDetailLabel}>最小改善动作</Text>
              <Text style={styles.riskDetailBodyText}>{card.action || '先从最容易坚持的一餐开始调整。'}</Text>
              <View style={styles.riskDetailDelta}>
                <Text style={styles.riskDetailDeltaText}>预计可提升 {Math.round(card.delta || 0)} 分</Text>
              </View>
              <Pressable style={({ pressed }) => [styles.riskDetailCloseBtn, pressed && styles.pressed]} onPress={onClose}>
                <Text style={styles.riskDetailCloseText}>知道了</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
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

function scoreToFocusOverview(score: number, hasRiskCards: boolean): string {
  if (!hasRiskCards) return '继续记录后会生成你当前最需要关注的健康方向。'
  if (score >= 78) return '你当前关注的核心指标整体更偏向保护，保持稳定记录即可。'
  if (score >= 60) return '你当前关注的指标总体还算稳定，但已经有一些可优化项。'
  if (score >= 42) return '你当前关注的指标出现明显拖累，建议优先处理分数最低的一项。'
  return '你当前关注的指标处在较高压力区，先从最可执行的一项小步调整。'
}

function averageRiskScore(cards: RiskCard[]): number | null {
  const scores = cards.map((card) => Number(card.score)).filter((score) => Number.isFinite(score))
  if (!scores.length) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

function averageRiskDelta(cards: RiskCard[]): number {
  const deltas = cards.map((card) => Number(card.delta || 0)).filter((delta) => Number.isFinite(delta))
  if (!deltas.length) return 0
  return deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length
}

function signedKcal(value: number): string {
  const rounded = Math.round(value || 0)
  return `${rounded >= 0 ? '+' : ''}${rounded} kcal`
}

function buildMacroPercent(summary: StatsSummary | null) {
  const protein = Number(summary?.macro_percent?.protein)
  const carbs = Number(summary?.macro_percent?.carbs)
  const fat = Number(summary?.macro_percent?.fat)
  if ([protein, carbs, fat].some((value) => Number.isFinite(value) && value > 0)) {
    return {
      protein: Number.isFinite(protein) ? protein : 0,
      carbs: Number.isFinite(carbs) ? carbs : 0,
      fat: Number.isFinite(fat) ? fat : 0,
    }
  }
  const proteinCalories = Number(summary?.total_protein || 0) * 4
  const carbsCalories = Number(summary?.total_carbs || 0) * 4
  const fatCalories = Number(summary?.total_fat || 0) * 9
  const total = Math.max(1, proteinCalories + carbsCalories + fatCalories)
  return {
    protein: (proteinCalories / total) * 100,
    carbs: (carbsCalories / total) * 100,
    fat: (fatCalories / total) * 100,
  }
}

function buildMealValues(summary: StatsSummary | null): Record<MealKey, number> {
  return {
    breakfast: toSafeNumber(summary?.by_meal?.breakfast),
    morning_snack: toSafeNumber(summary?.by_meal?.morning_snack),
    lunch: toSafeNumber(summary?.by_meal?.lunch),
    afternoon_snack: toSafeNumber(summary?.by_meal?.afternoon_snack ?? summary?.by_meal?.snack),
    dinner: toSafeNumber(summary?.by_meal?.dinner),
    evening_snack: toSafeNumber(summary?.by_meal?.evening_snack),
  }
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

function riskIconClass(key: string): string {
  if (key.includes('diabetes') || key.includes('sugar')) return 'icon-zhuzhuangtu'
  if (key.includes('cardio') || key.includes('heart')) return 'icon-yiliaohangyedeICON-'
  if (key.includes('weight')) return 'icon-weight-scale'
  if (key.includes('protein') || key.includes('calorie')) return 'icon-huore'
  return 'icon-target'
}

function riskBgColor(key: string): string {
  if (key.includes('hypertension')) return '#fff7f7'
  if (key.includes('diabetes')) return '#f4f8fe'
  if (key.includes('cardio')) return '#fff8ef'
  if (key.includes('weight')) return '#f1fbf5'
  return '#f4fbf8'
}

function riskIconBgColor(key: string): string {
  if (key.includes('hypertension')) return '#fbe4e4'
  if (key.includes('diabetes')) return '#e2effb'
  if (key.includes('cardio')) return '#ffecd8'
  if (key.includes('weight')) return '#dbf5e4'
  return '#dff4ed'
}

function riskIconColor(key: string): string {
  if (key.includes('hypertension')) return '#c45c5c'
  if (key.includes('diabetes')) return '#5a9bc7'
  if (key.includes('cardio')) return '#c9965c'
  if (key.includes('weight')) return '#5aa86e'
  return colors.brandDark
}

function toneBadgeStyle(tone: RiskCard['tone']) {
  if (tone === 'danger') return styles.toneDanger
  if (tone === 'warning') return styles.toneWarning
  if (tone === 'positive') return styles.tonePositive
  return styles.toneNeutral
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
    backgroundColor: 'rgba(92,184,150,0.08)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 0,
  },
  rangeDropdown: {
    position: 'absolute',
    left: 16,
    zIndex: 30,
    minWidth: 78,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.18)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  rangeDropdownLoading: {
    opacity: 0.68,
  },
  rangeDropdownLabel: {
    fontSize: compactFont(14, 13),
    lineHeight: 18,
    fontWeight: '800',
    color: '#1e2939',
  },
  riskOverviewCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 18,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#163c34',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#123931',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  riskOverviewTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  riskOverviewTitle: {
    color: '#fff',
    fontSize: compactFont(20, 19),
    lineHeight: 26,
    fontWeight: '800',
  },
  riskOverviewSubtitle: {
    marginTop: 5,
    color: 'rgba(226,232,240,0.72)',
    fontSize: compactFont(12, 11),
    lineHeight: 16,
    fontWeight: '700',
  },
  riskOverviewBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  riskOverviewBadgeText: {
    color: '#fff',
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  riskOverviewScoreRow: {
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  riskOverviewScore: {
    color: '#fff',
    fontSize: 48,
    lineHeight: 54,
    fontWeight: '900',
  },
  riskOverviewScoreUnit: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: compactFont(15, 14),
    fontWeight: '800',
  },
  riskOverviewHint: {
    marginTop: 5,
    color: 'rgba(226,232,240,0.78)',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
    fontWeight: '700',
  },
  riskOverviewSummary: {
    marginTop: 9,
    color: '#f8fafc',
    fontSize: compactFont(14, 13),
    lineHeight: 20,
    fontWeight: '700',
  },
  riskOverviewChipRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 15,
  },
  riskOverviewChip: {
    flex: 1,
    minWidth: 0,
  },
  riskOverviewChipLabel: {
    color: 'rgba(226,232,240,0.70)',
    fontSize: 10,
    lineHeight: 14,
  },
  riskOverviewChipValue: {
    marginTop: 4,
    color: '#fff',
    fontSize: compactFont(13, 12),
    lineHeight: 17,
    fontWeight: '900',
  },
  disclaimerBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(92,184,150,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.20)',
  },
  disclaimerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand,
  },
  disclaimerText: {
    flex: 1,
    color: '#2f7f62',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
    fontWeight: '800',
  },
  disclaimerAction: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: '#fff',
    backgroundColor: colors.brand,
    fontSize: 11,
    fontWeight: '900',
  },
  dataGateCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 17,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.16)',
  },
  dataGateIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(92,158,212,0.12)',
  },
  dataGateCopy: {
    flex: 1,
    minWidth: 0,
  },
  dataGateTitle: {
    color: colors.text,
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 6,
  },
  dataGateDesc: {
    color: '#64748b',
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  analysisTabsContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  segmented: {
    position: 'relative',
    flexDirection: 'row',
    gap: 4,
    borderRadius: 14,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.60)',
  },
  segmentedLoading: {
    opacity: 0.88,
  },
  tabsSpinner: {
    position: 'absolute',
    right: 12,
    top: 9,
    zIndex: 2,
  },
  segmentItem: {
    flex: 1,
    minHeight: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    backgroundColor: '#fff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  segmentText: {
    color: '#64748b',
    fontSize: compactFont(13, 12),
    fontWeight: '800',
  },
  segmentTextActive: {
    color: colors.brandDark,
  },
  riskSectionHeader: {
    marginHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  riskSectionTitle: {
    color: '#1e2939',
    fontSize: compactFont(17, 16),
    lineHeight: 22,
    fontWeight: '900',
  },
  riskFocusEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: '#fff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  riskFocusEditText: {
    color: colors.brandDark,
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  riskCardGrid: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  riskTile: {
    width: '48.5%',
    minHeight: 142,
    borderRadius: 16,
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  riskTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  riskIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riskScoreWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  riskScore: {
    color: '#1e2939',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
  },
  riskScoreUnit: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  riskTileTitle: {
    color: '#1e2939',
    fontSize: compactFont(14, 13),
    lineHeight: 18,
    fontWeight: '900',
  },
  riskTileSummary: {
    marginTop: 7,
    color: '#64748b',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  statsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.80)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: compactFont(15, 14),
    fontWeight: '900',
    marginBottom: 5,
  },
  emptyText: {
    color: '#64748b',
    fontSize: compactFont(13, 12),
    lineHeight: 18,
  },
  actionPlanPanel: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.16)',
  },
  actionPlanTitle: {
    color: colors.text,
    fontSize: compactFont(15, 14),
    fontWeight: '900',
    marginBottom: 8,
  },
  actionPlanItem: {
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 6,
  },
  actionPlanBullet: {
    width: 21,
    height: 21,
    borderRadius: 11,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 21,
    color: colors.brandDark,
    backgroundColor: colors.brandSoft,
    fontSize: 11,
    fontWeight: '900',
  },
  actionPlanText: {
    flex: 1,
    color: '#64748b',
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  aiCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(92,158,212,0.14)',
  },
  aiCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 13,
  },
  cardTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flex: 1,
    minWidth: 0,
  },
  cardTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  aiTitle: {
    color: '#3d6b94',
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '900',
  },
  cardTitle: {
    color: '#1e2939',
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '900',
  },
  cardSubtitle: {
    marginTop: 3,
    color: '#94a3b8',
    fontSize: compactFont(11, 10),
    lineHeight: 15,
    fontWeight: '700',
  },
  aiMetaPill: {
    flexShrink: 0,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: '#3d6b94',
    backgroundColor: 'rgba(92,158,212,0.12)',
    fontSize: 11,
    fontWeight: '900',
  },
  analysisStatusWarning: {
    marginBottom: 12,
    padding: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(245,196,154,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(240,152,92,0.22)',
  },
  analysisStatusText: {
    color: '#475569',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  analysisError: {
    marginBottom: 12,
    padding: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(254,248,248,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(245,212,212,0.90)',
  },
  analysisErrorText: {
    color: '#b45353',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  analysisEmptyGate: {
    padding: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(92,158,212,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(92,158,212,0.14)',
  },
  analysisEmptyTitle: {
    color: '#1e2939',
    fontSize: compactFont(14, 13),
    lineHeight: 19,
    fontWeight: '900',
    marginBottom: 6,
  },
  analysisEmptyText: {
    color: '#475569',
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  analysisEmpty: {
    paddingVertical: 4,
  },
  analysisSkeletonGroup: {
    gap: 10,
    paddingVertical: 6,
  },
  skeletonLine: {
    width: '100%',
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(92,158,212,0.16)',
  },
  skeletonLine96: {
    width: '96%',
  },
  skeletonLine92: {
    width: '92%',
  },
  skeletonLine86: {
    width: '86%',
  },
  skeletonLine70: {
    width: '70%',
  },
  markdownBlock: {
    gap: 8,
  },
  analysisAction: {
    marginTop: 14,
    minHeight: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  analysisActionDisabled: {
    opacity: 0.55,
  },
  analysisActionText: {
    color: '#fff',
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 15,
  },
  barChartContainer: {
    minHeight: 168,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 7,
  },
  chartCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  barCalorieText: {
    color: '#64748b',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  barWrapper: {
    width: '100%',
    maxWidth: 24,
    height: 108,
    justifyContent: 'flex-end',
    padding: 3,
    borderRadius: 14,
    backgroundColor: 'rgba(226,232,240,0.50)',
  },
  barFill: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: colors.brand,
  },
  barFillOver: {
    backgroundColor: '#e57373',
  },
  barLabel: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 13,
  },
  macroRow: {
    marginBottom: 14,
  },
  macroInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  macroName: {
    color: '#64748b',
    fontSize: compactFont(13, 12),
    fontWeight: '800',
  },
  macroDetail: {
    color: '#1e2939',
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  progressTrack: {
    height: 9,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  mealGaugeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  mealGaugeItem: {
    width: '48.5%',
    minHeight: 92,
    padding: 11,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mealGaugeLeft: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  mealGaugeIconWrap: {
    width: 25,
    height: 25,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealGaugeLabel: {
    color: '#334155',
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  mealGaugePercent: {
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  mealGaugeCircle: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealGaugeCenter: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealGaugeCal: {
    fontSize: 11,
    fontWeight: '900',
  },
  bodyMetricPanel: {
    padding: 13,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
    marginBottom: 10,
  },
  waterPanel: {
    backgroundColor: '#f6fbfd',
    marginBottom: 0,
  },
  bodyMetricPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  bodyMetricTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  bodyMetricTitle: {
    color: '#0f172a',
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  bodyMetricMain: {
    color: '#111827',
    fontSize: compactFont(18, 17),
    fontWeight: '900',
  },
  bodyMetricEmpty: {
    color: '#94a3b8',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
    fontWeight: '700',
  },
  bodyMetricSub: {
    marginTop: 7,
    color: '#64748b',
    fontSize: compactFont(12, 11),
    lineHeight: 17,
  },
  waterTrendChart: {
    marginTop: 13,
    height: 96,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 5,
  },
  waterTrendCol: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  waterTrendBarWrap: {
    width: '100%',
    maxWidth: 26,
    height: 74,
    padding: 4,
    borderRadius: 13,
    backgroundColor: 'rgba(226,232,240,0.50)',
    justifyContent: 'flex-end',
  },
  waterTrendBar: {
    width: '100%',
    borderRadius: 13,
    backgroundColor: '#5c9ed4',
  },
  waterTrendLabel: {
    color: '#94a3b8',
    fontSize: 9,
    lineHeight: 12,
  },
  moreCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(92,184,150,0.14)',
  },
  cardHeader: {
    marginBottom: 13,
  },
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  toolChip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    backgroundColor: colors.brandSoft,
  },
  toolChipText: {
    color: colors.brandDark,
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  rangeSheet: {
    margin: 12,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    backgroundColor: '#fff',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: '#1e2939',
    fontSize: compactFont(16, 15),
    lineHeight: 21,
    fontWeight: '900',
    marginBottom: 12,
  },
  rangeSheetList: {
    gap: 8,
  },
  rangeSheetRow: {
    minHeight: 58,
    borderRadius: 14,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rangeSheetRowActive: {
    backgroundColor: colors.brandSoft,
    borderColor: 'rgba(92,184,150,0.28)',
  },
  rangeSheetLabel: {
    color: '#1e2939',
    fontSize: compactFont(15, 14),
    fontWeight: '900',
  },
  rangeSheetLabelActive: {
    color: colors.brandDark,
  },
  rangeSheetHelper: {
    color: '#64748b',
    fontSize: compactFont(11, 10),
    marginTop: 3,
  },
  rangeSheetCheck: {
    color: colors.brandDark,
    fontSize: compactFont(12, 11),
    fontWeight: '900',
  },
  riskDetailPanel: {
    margin: 12,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingTop: 14,
    backgroundColor: '#fff',
  },
  riskDetailHeader: {
    gap: 8,
    marginBottom: 12,
  },
  riskDetailTitle: {
    color: '#1e2939',
    fontSize: compactFont(18, 17),
    lineHeight: 23,
    fontWeight: '900',
  },
  riskDetailScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  riskDetailScore: {
    color: '#1e2939',
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '900',
  },
  riskDetailScoreUnit: {
    color: '#64748b',
    fontSize: compactFont(12, 11),
    fontWeight: '800',
  },
  riskDetailBadge: {
    marginLeft: 6,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  riskDetailBadgeText: {
    color: '#1e2939',
    fontSize: 11,
    fontWeight: '900',
  },
  riskDetailLabel: {
    color: '#1e2939',
    fontSize: compactFont(13, 12),
    fontWeight: '900',
    marginBottom: 5,
  },
  riskDetailBodyText: {
    color: '#475569',
    fontSize: compactFont(13, 12),
    lineHeight: 19,
  },
  riskDetailDivider: {
    height: 1,
    backgroundColor: '#eef2f7',
    marginVertical: 11,
  },
  riskDetailDelta: {
    marginTop: 12,
    padding: 11,
    borderRadius: 13,
    backgroundColor: colors.brandSoft,
  },
  riskDetailDeltaText: {
    color: colors.brandDark,
    fontSize: compactFont(13, 12),
    fontWeight: '900',
  },
  riskDetailCloseBtn: {
    marginTop: 14,
    minHeight: 42,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  riskDetailCloseText: {
    color: '#fff',
    fontSize: compactFont(14, 13),
    fontWeight: '900',
  },
  tonePositive: {
    backgroundColor: 'rgba(134,239,172,0.18)',
  },
  toneNeutral: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toneWarning: {
    backgroundColor: 'rgba(251,191,36,0.20)',
  },
  toneDanger: {
    backgroundColor: 'rgba(248,113,113,0.18)',
  },
  pressed: {
    opacity: 0.72,
  },
})
