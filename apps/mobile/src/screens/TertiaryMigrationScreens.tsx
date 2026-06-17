import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  normalizeInsightText,
  type AnalysisTask,
  type BodyMetricWaterDay,
  type BodyMetricWaterLogItem,
  type BodyMetricWeightEntry,
  type BodyMetricsSummary,
  type DietRecommendationResult,
  type ExerciseLogItem,
  type FoodExpiryItem,
  type HealthProfile,
  type LocationSearchPOI,
  type LocationSearchResult,
  type ManualFoodItem,
  type MealType,
  type PackagedProductExtractResult,
  type PublicFoodItem,
  type RiskCard,
  type StatsInsightResult,
  type StatsRange,
  type StatsSummary,
  type UserInfo,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { InsightMarkdownView } from '../components/InsightMarkdownView'
import { Page } from '../components/Page'
import type { LocationSelection, RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'

const userGroupQr = require('../../assets/community/foodlink-user-group-permanent-20260602.jpg')

const expiryStorageOptions = [
  { value: 'refrigerated', label: '冷藏' },
  { value: 'room_temp', label: '常温' },
  { value: 'frozen', label: '冷冻' },
] as const

type CampusCanteenSort = 'hot' | 'high_protein' | 'low_calorie' | 'value'

const campusCanteenSortOptions: Array<{ value: CampusCanteenSort; label: string }> = [
  { value: 'hot', label: '热门' },
  { value: 'high_protein', label: '高蛋白' },
  { value: 'low_calorie', label: '低热量' },
  { value: 'value', label: '性价比' },
]

type AssistantFocusCard = Partial<RiskCard> & Record<string, unknown>
type DietRecommendationItem = NonNullable<DietRecommendationResult['recommendations']>[number]

export function AiAssistantScreen() {
  const [range, setRange] = useState<StatsRange>('week')
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [insight, setInsight] = useState<StatsInsightResult | null>(null)
  const [dietRecommendation, setDietRecommendation] = useState<DietRecommendationResult | null>(null)
  const [focusCard, setFocusCard] = useState<AssistantFocusCard | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getStatsSummary(range)
      setSummary(data)
      setInsight(data.analysis_summary ? { analysis_summary: data.analysis_summary } : null)
    } catch (error) {
      showError('获取 AI 助手失败', error)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  const insightText = normalizeInsightText(String(insight?.analysis_summary || insight?.content || ''))
  const recordedDays = Math.max(0, Number(summary?.recorded_days ?? 0))

  const generateInsight = async () => {
    if (recordedDays <= 0) {
      Alert.alert('先记录饮食', '至少记录一餐后再生成 AI 风险解读。')
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.generateStatsInsight(range)
      setInsight(data)
      const content = normalizeInsightText(String(data.analysis_summary || data.content || ''))
      if (content) await apiClient.saveStatsInsight(range, content).catch(() => undefined)
    } catch (error) {
      showError('生成风险解读失败', error)
    } finally {
      setLoading(false)
    }
  }

  const generateDiet = async () => {
    setLoading(true)
    try {
      const data = await apiClient.generateDietRecommendation({
        scene: 'mobile_ai_assistant',
        date: todayKey(),
        calorie_remaining: Math.max(0, (summary?.tdee || 0) - (summary?.avg_calories_per_day || 0)),
        macro_gaps: {
          protein: Math.max(0, (summary?.total_calories || 0) * 0.18 / 4 - (summary?.total_protein || 0)),
          carbs: Math.max(0, (summary?.total_calories || 0) * 0.5 / 4 - (summary?.total_carbs || 0)),
          fat: Math.max(0, (summary?.total_calories || 0) * 0.3 / 9 - (summary?.total_fat || 0)),
        },
        current: {
          calories: summary?.avg_calories_per_day || 0,
          protein: summary?.total_protein || 0,
          carbs: summary?.total_carbs || 0,
          fat: summary?.total_fat || 0,
        },
      })
      setDietRecommendation(data)
    } catch (error) {
      showError('生成饮食建议失败', error)
    } finally {
      setLoading(false)
    }
  }

  const generateFocus = async (focusId: string) => {
    setLoading(true)
    try {
      const data = await apiClient.generateCustomFocusCard(range, focusId)
      setFocusCard(normalizeAssistantFocusCard(data.card || data))
    } catch (error) {
      showError('生成关注卡片失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="AI 助手" subtitle="风险解读、关注卡片和饮食建议" refreshing={loading} onRefresh={load}>
      <View style={styles.segment}>
        <SegmentButton label="近一周" active={range === 'week'} onPress={() => setRange('week')} />
        <SegmentButton label="近一月" active={range === 'month'} onPress={() => setRange('month')} />
      </View>

      <Card>
        <Text style={styles.sectionTitle}>当前概览</Text>
        <MetricLine label="日均摄入" value={`${Math.round(summary?.avg_calories_per_day || 0)} kcal`} />
        <MetricLine label="TDEE" value={`${Math.round(summary?.tdee || 0)} kcal`} />
        <MetricLine label="连续记录" value={`${summary?.streak_days || 0} 天`} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>AI 风险解读</Text>
        {insightText ? (
          <InsightMarkdownView text={insightText} />
        ) : (
          <Text style={styles.bodyText}>生成后会显示饮食风险、趋势和执行建议。</Text>
        )}
        <AppButton label="生成风险解读" loading={loading} onPress={generateInsight} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>关注卡片</Text>
        <View style={styles.buttonRow}>
          <SmallButton label="蛋白质" onPress={() => generateFocus('protein')} />
          <SmallButton label="热量缺口" onPress={() => generateFocus('calorie_gap')} />
          <SmallButton label="饮水" onPress={() => generateFocus('water')} />
        </View>
        {focusCard ? (
          <AssistantFocusCardView card={focusCard} />
        ) : (
          <Text style={styles.bodyText}>选择一个关注方向后，会生成单项分数、判断依据和行动建议。</Text>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{dietRecommendation?.title || '饮食建议'}</Text>
        <DietRecommendationView recommendation={dietRecommendation} />
        <AppButton label="生成饮食建议" variant="secondary" loading={loading} onPress={generateDiet} />
      </Card>
    </Page>
  )
}

function AssistantFocusCardView({ card }: { card: AssistantFocusCard }) {
  const title = stringValue(card.title) || '关注卡片'
  const score = numberMaybe(card.score)
  const brief = stringValue(card.brief)
  const summary = stringValue(card.summary)
  const basis = stringValue(card.basis)
  const action = stringValue(card.action)
  const delta = numberMaybe(card.delta)

  return (
    <View style={styles.focusCard}>
      <View style={styles.focusHeader}>
        <View style={styles.focusTitleWrap}>
          <Text style={styles.focusTitle}>{title}</Text>
          {brief ? <Text style={styles.bodyText}>{brief}</Text> : null}
        </View>
        {score != null ? (
          <View style={styles.focusScorePill}>
            <Text style={styles.focusScore}>{Math.round(score)}分</Text>
          </View>
        ) : null}
      </View>
      {summary ? <Text style={styles.bodyText}>{summary}</Text> : null}
      {basis ? (
        <View style={styles.focusDetailBlock}>
          <Text style={styles.focusLabel}>判断依据</Text>
          <Text style={styles.bodyText}>{basis}</Text>
        </View>
      ) : null}
      {action ? (
        <View style={styles.focusDetailBlock}>
          <Text style={styles.focusLabel}>行动建议</Text>
          <Text style={styles.bodyText}>{action}</Text>
        </View>
      ) : null}
      {delta != null ? <Text style={styles.focusDelta}>预计可提升 {Math.round(delta)} 分</Text> : null}
    </View>
  )
}

function DietRecommendationView({ recommendation }: { recommendation: DietRecommendationResult | null }) {
  if (!recommendation) {
    return <Text style={styles.bodyText}>根据今日剩余额度和宏量营养缺口生成下一餐建议。</Text>
  }

  const summaryText = stringValue(recommendation.summary)
  const items = (recommendation.recommendations || []).filter((item) => item && typeof item === 'object')

  if (!summaryText && items.length === 0) {
    return <Text style={styles.bodyText}>已生成饮食建议，当前没有更多细分条目。</Text>
  }

  return (
    <View>
      {summaryText ? <Text style={styles.bodyText}>{summaryText}</Text> : null}
      {items.map((item, index) => (
        <DietRecommendationItemView key={`${stringValue(item.title) || 'diet'}-${index}`} item={item} index={index} />
      ))}
    </View>
  )
}

function DietRecommendationItemView({ item, index }: { item: DietRecommendationItem; index: number }) {
  const title = stringValue(item.title) || `建议 ${index + 1}`
  const reason = stringValue(item.reason)
  const foods = dietRecommendationFoods(item)
  const metrics = [
    { label: '热量', value: numberMaybe(item.calories), unit: 'kcal' },
    { label: '蛋白质', value: numberMaybe(item.protein), unit: 'g' },
    { label: '碳水', value: numberMaybe(item.carbs), unit: 'g' },
    { label: '脂肪', value: numberMaybe(item.fat), unit: 'g' },
  ].filter((metric) => metric.value != null)

  return (
    <View style={styles.dietRecommendationItem}>
      <Text style={styles.focusTitle}>{title}</Text>
      {reason ? <Text style={styles.bodyText}>{reason}</Text> : null}
      {foods.length > 0 ? <Text style={styles.subtitle}>包含：{foods.join('、')}</Text> : null}
      {metrics.length > 0 ? (
        <View style={styles.nutritionRow}>
          {metrics.map((metric) => (
            <Pill key={metric.label} text={`${metric.label} ${Math.round(metric.value || 0)} ${metric.unit}`} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

function dietRecommendationFoods(item: DietRecommendationItem): string[] {
  if (Array.isArray(item.foods)) return item.foods.map((food) => stringValue(food)).filter(Boolean)
  const fallback = stringValue((item as Record<string, unknown>).food)
  return fallback ? [fallback] : []
}

function normalizeAssistantFocusCard(value: unknown): AssistantFocusCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as AssistantFocusCard
}

export function StatsMetabolicScreen() {
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [stats, healthProfile] = await Promise.all([
        apiClient.getStatsSummary('month'),
        apiClient.getHealthProfile().catch(() => null),
      ])
      setSummary(stats)
      setProfile(healthProfile)
    } catch (error) {
      showError('获取代谢分析失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const bmr = numberValue(profile?.bmr) || Math.round((summary?.tdee || 0) * 0.72)
  const tdee = numberValue(profile?.tdee) || summary?.tdee || 0
  const delta = summary?.cal_surplus_deficit || 0

  return (
    <Page title="代谢分析" subtitle="BMR、TDEE 与摄入差额" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.bigNumber}>{Math.round(tdee || 0)}</Text>
        <Text style={styles.subtitle}>每日总消耗估算 kcal</Text>
        <MetricLine label="基础代谢 BMR" value={`${Math.round(bmr || 0)} kcal`} />
        <MetricLine label="月均摄入" value={`${Math.round(summary?.avg_calories_per_day || 0)} kcal`} />
        <MetricLine label="摄入差额" value={`${Math.round(delta)} kcal`} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>健康指数</Text>
        <Text style={styles.score}>{summary?.health_index?.overall_score ?? '--'}</Text>
        <Text style={styles.bodyText}>{summary?.health_index?.overview_copy || '补充身高、体重、目标和饮食记录后，代谢分析会更准确。'}</Text>
      </Card>

      {(summary?.health_index?.risk_cards || []).slice(0, 4).map((card) => (
        <Card key={card.key}>
          <View style={styles.rowBetween}>
            <Text style={styles.itemName}>{card.title}</Text>
            <Pill text={`${card.score}`} />
          </View>
          <Text style={styles.bodyText}>{card.brief || card.summary}</Text>
        </Card>
      ))}
    </Page>
  )
}

export function TrendDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'TrendDetail'>>()
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLogItem[]>([])
  const [selectedWaterDate, setSelectedWaterDate] = useState(todayKey())
  const [mutatingId, setMutatingId] = useState('')
  const [loading, setLoading] = useState(false)
  const kind = route.params.kind
  const title = kind === 'weight' ? '体重趋势' : kind === 'water' ? '饮水趋势' : '运动趋势'
  const targetDate = todayKey()
  const dates = useMemo(() => buildTrendDateRange(30, targetDate), [targetDate])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await apiClient.getBodyMetricsSummary('month')
      setSummary(body)
      if (kind === 'exercise') {
        const logs = await apiClient.getExerciseLogs({ start_date: dates[0], end_date: dates[dates.length - 1] })
        setExerciseLogs(logs.logs || [])
      }
    } catch (error) {
      showError(`获取${title}失败`, error)
    } finally {
      setLoading(false)
    }
  }, [dates, kind, title])

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const weightPoints = useMemo(() => buildWeightTrendPoints(summary, dates), [dates, summary])
  const weightGroups = useMemo(() => buildWeightMonthGroups(summary?.weight_entries || []), [summary?.weight_entries])
  const latestWeight = summary?.latest_weight || null
  const previousWeight = summary?.previous_weight || null
  const weightChange = latestWeight && previousWeight ? latestWeight.value - previousWeight.value : summary?.weight_change ?? null
  const weightRecordedDays = weightPoints.filter((item) => item.value != null).length

  const waterPoints = useMemo(() => buildWaterTrendPoints(summary, dates), [dates, summary])
  const waterDayByDate = useMemo(() => {
    const map = new Map<string, BodyMetricWaterDay>()
    ;(summary?.water_daily || []).forEach((item) => map.set(item.date, item))
    if (summary?.today_water?.date) map.set(summary.today_water.date, summary.today_water)
    return map
  }, [summary])
  const recentWaterDays = useMemo(
    () => [...(summary?.water_daily || [])]
      .filter((item) => Number(item.total || 0) > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30),
    [summary],
  )
  const selectedWaterDay = waterDayByDate.get(selectedWaterDate)
  const selectedWaterLogs = useMemo(() => getTrendWaterLogItems(selectedWaterDay), [selectedWaterDay])
  const waterGoal = summary?.water_goal_ml || 2000

  useEffect(() => {
    if (kind !== 'water' || !summary) return
    if (waterDayByDate.has(selectedWaterDate)) return
    setSelectedWaterDate(recentWaterDays[0]?.date || targetDate)
  }, [kind, recentWaterDays, selectedWaterDate, summary, targetDate, waterDayByDate])

  const exerciseDays = useMemo(() => buildExerciseTrendDays(exerciseLogs, dates), [dates, exerciseLogs])
  const exerciseTotal = exerciseDays.reduce((sum, item) => sum + (item.total || 0), 0)
  const exerciseActiveDays = exerciseDays.filter((item) => (item.total || 0) > 0).length
  const exerciseAvgActive = exerciseActiveDays > 0 ? exerciseTotal / exerciseActiveDays : 0
  const recentExerciseLogs = useMemo(
    () => [...exerciseLogs].sort((a, b) => trendExerciseDate(b).localeCompare(trendExerciseDate(a))).slice(0, 20),
    [exerciseLogs],
  )

  const deleteWeight = async (entry: BodyMetricWeightEntry) => {
    const recordId = String(entry.id || '').trim()
    if (!recordId) {
      Alert.alert('无法删除', '这条体重记录信息不完整，请刷新后重试。')
      return
    }
    setMutatingId(recordId)
    try {
      await apiClient.deleteBodyWeightRecord(recordId)
      await load()
      Alert.alert('已删除', '体重记录已删除')
    } catch (error) {
      showError('删除体重记录失败', error)
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteWeight = (entry: BodyMetricWeightEntry) => {
    Alert.alert('删除体重记录', `确定删除 ${formatTrendMonthDay(entry.date)} 的 ${formatTrendWeight(entry.value)}kg 吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void deleteWeight(entry) },
    ])
  }

  const deleteWaterLog = async (log: TrendWaterLogItem) => {
    const logId = String(log.id || '').trim()
    if (!logId) {
      Alert.alert('无法删除', '这条喝水记录信息不完整，可回到喝水记录页清空当天。')
      return
    }
    setMutatingId(logId)
    try {
      await apiClient.deleteBodyWaterLog(logId)
      await load()
      Alert.alert('已删除', '喝水记录已删除')
    } catch (error) {
      showError('删除喝水记录失败', error)
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteWater = (log: TrendWaterLogItem) => {
    Alert.alert('删除这次喝水', `确定删除 ${formatTrendMonthDay(log.date || selectedWaterDate)} 的 ${Math.round(log.amount_ml || 0)}ml 吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void deleteWaterLog(log) },
    ])
  }

  const deleteExercise = async (log: ExerciseLogItem) => {
    const logId = String(log.id || '').trim()
    if (!logId) {
      Alert.alert('无法删除', '这条运动记录信息不完整，请刷新后重试。')
      return
    }
    setMutatingId(logId)
    try {
      await apiClient.deleteExerciseLog(logId)
      await load()
      Alert.alert('已删除', '运动记录已删除')
    } catch (error) {
      showError('删除运动记录失败', error)
    } finally {
      setMutatingId('')
    }
  }

  const confirmDeleteExercise = (log: ExerciseLogItem) => {
    Alert.alert('删除运动记录', `确定删除「${trendExerciseTitle(log)}」吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void deleteExercise(log) },
    ])
  }

  return (
    <Page title={title} subtitle="近 30 天趋势和历史明细" refreshing={loading} onRefresh={load}>
      {kind === 'weight' ? (
        <>
          <Card>
            <View style={styles.trendHeroRow}>
              <View style={styles.flex}>
                <Text style={styles.sectionTitle}>最新体重</Text>
                <Text style={styles.bigNumber}>{latestWeight ? `${formatTrendWeight(latestWeight.value)} kg` : '--'}</Text>
                <Text style={styles.subtitle}>{latestWeight ? formatTrendMonthDay(latestWeight.date) : '记录体重后会形成趋势'}</Text>
              </View>
              <View style={styles.trendHeroBadge}>
                <Text style={styles.trendHeroBadgeLabel}>较上次</Text>
                <Text style={styles.trendHeroBadgeValue}>{formatTrendSigned(weightChange, 1)}</Text>
              </View>
            </View>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>近 30 天趋势</Text>
            <TrendBarChart points={weightPoints} unit="kg" emptyText="近 30 天还没有可展示的体重趋势" />
            <Text style={styles.subtitle}>有体重数据的自然日：{weightRecordedDays} 天</Text>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>历史记录</Text>
            {weightGroups.length === 0 ? <Text style={styles.empty}>还没有体重记录</Text> : null}
            {weightGroups.map((group) => (
              <View key={group.key} style={styles.trendMonthGroup}>
                <View style={styles.rowBetween}>
                  <Text style={styles.itemName}>{group.label}</Text>
                  <Text style={styles.itemMeta}>总变化 {formatTrendSigned(group.totalChange, 1)}kg</Text>
                </View>
                {group.items.map((entry) => (
                  <View key={`${entry.id || entry.date}-${entry.recorded_at || entry.value}`} style={styles.trendHistoryRow}>
                    <View style={styles.flex}>
                      <Text style={styles.itemName}>{formatTrendMonthDay(entry.date)}</Text>
                      <Text style={styles.subtitle}>较上次 {formatTrendSigned(entry.delta, 1)}kg</Text>
                    </View>
                    <View style={styles.trendHistorySide}>
                      <Text style={styles.trendHistoryValue}>{formatTrendWeight(entry.value)} kg</Text>
                      <SmallButton
                        label={mutatingId === entry.id ? '删除中' : '删除'}
                        danger
                        disabled={mutatingId === entry.id}
                        onPress={() => confirmDeleteWeight(entry)}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {kind === 'water' ? (
        <>
          <Card>
            <View style={styles.trendHeroRow}>
              <View style={styles.flex}>
                <Text style={styles.sectionTitle}>喝水目标</Text>
                <Text style={styles.bigNumber}>{waterGoal} ml</Text>
                <Text style={styles.subtitle}>今日 {Math.round(summary?.today_water?.total || 0)} ml</Text>
              </View>
              <View style={styles.trendHeroBadge}>
                <Text style={styles.trendHeroBadgeLabel}>日均</Text>
                <Text style={styles.trendHeroBadgeValue}>{Math.round(summary?.avg_daily_water_ml || 0)}</Text>
              </View>
            </View>
          </Card>
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>近 30 天热力</Text>
              <Text style={styles.itemMeta}>点选日期看明细</Text>
            </View>
            <TrendHeatmap
              points={waterPoints}
              maxValue={Math.max(waterGoal, ...waterPoints.map((item) => item.value || 0), 1)}
              selectedDate={selectedWaterDate}
              onSelect={setSelectedWaterDate}
            />
            <Text style={styles.subtitle}>记录天数：{summary?.water_recorded_days || 0} 天</Text>
          </Card>
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>最近喝水</Text>
              <Text style={styles.itemMeta}>{formatTrendMonthDay(selectedWaterDate)}</Text>
            </View>
            {recentWaterDays.length === 0 ? <Text style={styles.empty}>还没有喝水记录</Text> : null}
            {recentWaterDays.map((day) => (
              <Pressable
                key={day.date}
                style={[styles.trendHistoryRow, selectedWaterDate === day.date && styles.trendHistoryRowActive]}
                onPress={() => setSelectedWaterDate(day.date)}
              >
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{formatTrendMonthDay(day.date)}</Text>
                  <Text style={styles.subtitle}>{getTrendWaterLogItems(day).length} 次记录</Text>
                </View>
                <Text style={styles.trendHistoryValue}>{Math.round(day.total || 0)} ml</Text>
              </Pressable>
            ))}
            {selectedWaterLogs.length > 0 ? (
              <View style={styles.trendDetailBlock}>
                <Text style={styles.itemName}>{formatTrendMonthDay(selectedWaterDate)} 明细</Text>
                <View style={styles.trendChipWrap}>
                  {selectedWaterLogs.map((log, index) => {
                    const logKey = log.id || `${log.date}-${index}-${log.amount_ml}`
                    return (
                      <Pressable key={logKey} style={styles.trendChip} onPress={() => confirmDeleteWater(log)}>
                        <Text style={styles.trendChipText}>+{Math.round(log.amount_ml || 0)}ml</Text>
                        <Text style={styles.trendChipMeta}>{log.id ? (mutatingId === log.id ? '删除中' : '删除') : '仅记录页清空'}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      {kind === 'exercise' ? (
        <>
          <Card>
            <View style={styles.trendHeroRow}>
              <View style={styles.flex}>
                <Text style={styles.sectionTitle}>近 30 天消耗</Text>
                <Text style={styles.bigNumber}>{Math.round(exerciseTotal)} kcal</Text>
                <Text style={styles.subtitle}>活跃 {exerciseActiveDays} 天 · {exerciseLogs.length} 次记录</Text>
              </View>
              <View style={styles.trendHeroBadge}>
                <Text style={styles.trendHeroBadgeLabel}>活跃日均</Text>
                <Text style={styles.trendHeroBadgeValue}>{Math.round(exerciseAvgActive)}</Text>
              </View>
            </View>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>近 30 天活跃</Text>
            <TrendHeatmap
              points={exerciseDays}
              maxValue={Math.max(...exerciseDays.map((item) => item.value || 0), 1)}
            />
            <Text style={styles.subtitle}>颜色越深，表示当天运动消耗越高。</Text>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>最近运动</Text>
            {recentExerciseLogs.length === 0 ? <Text style={styles.empty}>还没有运动记录</Text> : null}
            {recentExerciseLogs.map((log) => (
              <View key={log.id || `${trendExerciseDate(log)}-${trendExerciseTitle(log)}`} style={styles.trendHistoryRow}>
                <View style={styles.flex}>
                  <Text style={styles.itemName}>{trendExerciseTitle(log)}</Text>
                  <Text style={styles.subtitle}>{formatTrendMonthDay(trendExerciseDate(log))} · {Math.round(log.duration_min || 0)} 分钟</Text>
                  {log.ai_reasoning ? <Text style={styles.itemMeta} numberOfLines={2}>{log.ai_reasoning}</Text> : null}
                </View>
                <View style={styles.trendHistorySide}>
                  <Text style={styles.trendHistoryValue}>{Math.round(log.calories_burned || 0)} kcal</Text>
                  <SmallButton
                    label={mutatingId === log.id ? '删除中' : '删除'}
                    danger
                    disabled={mutatingId === log.id}
                    onPress={() => confirmDeleteExercise(log)}
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Page>
  )

}

export function PackagedFoodEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PackagedFoodEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [sourceImages, setSourceImages] = useState<Array<{ localUri?: string; imageUrl: string }>>([])
  const [manualImageUrl, setManualImageUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [brand, setBrand] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [flavorText, setFlavorText] = useState('')
  const [packageCategory, setPackageCategory] = useState('')
  const [specText, setSpecText] = useState('')
  const [barcode, setBarcode] = useState('')
  const [ingredientsText, setIngredientsText] = useState('')
  const [netWeightG, setNetWeightG] = useState('')
  const [servingWeightG, setServingWeightG] = useState('')
  const [nutritionBasis, setNutritionBasis] = useState('100')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [fiber, setFiber] = useState('')
  const [sugar, setSugar] = useState('')
  const [saturatedFat, setSaturatedFat] = useState('')
  const [cholesterolMg, setCholesterolMg] = useState('')
  const [sodiumMg, setSodiumMg] = useState('')
  const [potassiumMg, setPotassiumMg] = useState('')
  const [calciumMg, setCalciumMg] = useState('')
  const [ironMg, setIronMg] = useState('')
  const [showMoreNutrition, setShowMoreNutrition] = useState(false)
  const [extractResult, setExtractResult] = useState<PackagedProductExtractResult | null>(null)
  const [lastTaskId, setLastTaskId] = useState(route.params?.taskId || '')
  const [librarySearchQuery, setLibrarySearchQuery] = useState('')
  const [librarySearchResults, setLibrarySearchResults] = useState<ManualFoodItem[]>([])
  const [librarySearchTouched, setLibrarySearchTouched] = useState(false)
  const [librarySearchLoading, setLibrarySearchLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const imageUrls = useMemo(() => sourceImages.map((item) => item.imageUrl).filter(Boolean), [sourceImages])
  const autoIngest = extractResult?.auto_ingest_result

  const searchPackagedLibrary = async () => {
    const keyword = librarySearchQuery.trim()
    if (!keyword) {
      Alert.alert('请输入搜索关键词', '可输入品牌、品名、口味或条形码，先确认零食库里是否已经收录。')
      return
    }
    setLibrarySearchTouched(true)
    setLibrarySearchLoading(true)
    try {
      const data = await apiClient.searchManualFood(keyword, 30, { source: 'packaged_food' })
      setLibrarySearchResults(data.results || [])
    } catch (error) {
      showError('搜索零食库失败', error)
    } finally {
      setLibrarySearchLoading(false)
    }
  }

  const applyExtractResult = useCallback((result: PackagedProductExtractResult) => {
    setExtractResult(result)
    const unit = result.unit_nutrition_per_100g || {}
    if (result.product_name) setProductName(result.product_name)
    if (result.display_name) setDisplayName(result.display_name)
    if (result.brand) setBrand(result.brand)
    if (result.flavor_text) setFlavorText(result.flavor_text)
    if (result.package_category) setPackageCategory(result.package_category)
    if (result.spec_text) setSpecText(result.spec_text)
    if (result.barcode) setBarcode(result.barcode)
    if (result.ingredients_text) setIngredientsText(result.ingredients_text)
    if (result.net_weight_g != null || result.net_content_value != null) {
      setNetWeightG(numberInput(result.net_weight_g || result.net_content_value))
    }
    if (result.serving_weight_g != null) setServingWeightG(numberInput(result.serving_weight_g))
    setNutritionBasis('100')
    setCalories(numberInput(unit.calories))
    setProtein(numberInput(unit.protein))
    setCarbs(numberInput(unit.carbs))
    setFat(numberInput(unit.fat))
    setFiber(numberInput(unit.fiber))
    setSugar(numberInput(unit.sugar))
    setSaturatedFat(numberInput(unit.saturatedFat))
    setCholesterolMg(numberInput(unit.cholesterolMg))
    setSodiumMg(numberInput(unit.sodiumMg))
    setPotassiumMg(numberInput(unit.potassiumMg))
    setCalciumMg(numberInput(unit.calciumMg))
    setIronMg(numberInput(unit.ironMg))
    if (result.source_image_urls?.length) {
      setSourceImages(result.source_image_urls.map((imageUrl) => ({ imageUrl })))
    }
  }, [])

  const loadTaskIntoForm = useCallback(async (taskId: string) => {
    if (!taskId) return
    setLoading(true)
    try {
      const task = await apiClient.getPackagedProductExtractTask(taskId)
      const packaged = task.packaged_product
      if (!packaged) {
        if (task.status === 'done') {
          Alert.alert('暂无结构化结果', '任务已完成，但没有返回可回填的包装食品数据。')
        } else {
          Alert.alert('还在分析中', '任务完成后可刷新并回填表单。')
        }
        return
      }
      applyExtractResult(packaged)
      Alert.alert('已回填', '识别结果已写入表单，请核对后保存。')
    } catch (error) {
      showError('读取识别结果失败', error)
    } finally {
      setLoading(false)
    }
  }, [applyExtractResult])

  useEffect(() => {
    if (route.params?.taskId) {
      void loadTaskIntoForm(route.params.taskId)
    }
  }, [loadTaskIntoForm, route.params?.taskId])

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请选择包装食品图片用于上传。')
      return
    }
    const remaining = Math.max(1, 3 - sourceImages.length)
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.86,
    })
    if (picked.canceled || !picked.assets.length) return
    setLoading(true)
    try {
      const nextImages: Array<{ localUri?: string; imageUrl: string }> = []
      for (const asset of picked.assets.slice(0, remaining)) {
        const uploaded = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || 'packaged-food.jpg',
          mimeType: asset.mimeType || 'image/jpeg',
        })
        nextImages.push({ localUri: asset.uri, imageUrl: uploaded.imageUrl })
      }
      setSourceImages((current) => dedupePackagedImages([...current, ...nextImages]).slice(0, 3))
    } catch (error) {
      showError('上传包装图片失败', error)
    } finally {
      setLoading(false)
    }
  }

  const removeImage = (imageUrl: string) => {
    setSourceImages((current) => current.filter((item) => item.imageUrl !== imageUrl))
  }

  const addImageUrl = (value: string) => {
    const imageUrl = value.trim()
    if (!imageUrl) return
    setSourceImages((current) => dedupePackagedImages([...current, { imageUrl }]).slice(0, 3))
    setManualImageUrl('')
  }

  const submitExtract = async () => {
    if (!imageUrls.length) {
      Alert.alert('请先上传图片', '同一种商品最多上传 3 张包装、净含量或营养成分表图片。')
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.submitPackagedProductExtractTask({
        imageUrls,
        recognizedNameHint: productName,
      })
      setLastTaskId(data.task_id)
      Alert.alert('已提交', data.message || '识别任务已提交')
    } catch (error) {
      showError('提交包装识别失败', error)
    } finally {
      setLoading(false)
    }
  }

  const submitNutrition = async () => {
    if (!imageUrls[0]) {
      Alert.alert('请先上传图片', '请选择一张清晰的营养成分表图片。')
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.submitPackagedNutritionLabelTask(imageUrls[0])
      setLastTaskId(data.task_id)
      Alert.alert('已提交', data.message || '营养成分表任务已提交')
    } catch (error) {
      showError('提交营养表识别失败', error)
    } finally {
      setLoading(false)
    }
  }

  const recognizeNutritionNow = async () => {
    if (!imageUrls[0]) {
      Alert.alert('请先上传图片', '请选择一张清晰的营养成分表图片。')
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.recognizePackagedNutritionLabel(imageUrls[0])
      const nutrition = data.nutrition
      if (nutrition.product_name) setProductName(nutrition.product_name)
      if (nutrition.brand) setBrand(nutrition.brand)
      if (nutrition.net_weight_g != null) setNetWeightG(numberInput(nutrition.net_weight_g))
      if (nutrition.serving_weight_g != null) setServingWeightG(numberInput(nutrition.serving_weight_g))
      setNutritionBasis('100')
      setCalories(numberInput(nutrition.kcal_per_100g))
      setProtein(numberInput(nutrition.protein_per_100g))
      setCarbs(numberInput(nutrition.carbs_per_100g))
      setFat(numberInput(nutrition.fat_per_100g))
      setFiber(numberInput(nutrition.fiber_per_100g))
      setSugar(numberInput(nutrition.sugar_per_100g))
      setSaturatedFat(numberInput(nutrition.saturated_fat_per_100g))
      setCholesterolMg(numberInput(nutrition.cholesterol_mg_per_100g))
      setSodiumMg(numberInput(nutrition.sodium_mg_per_100g))
      setPotassiumMg(numberInput(nutrition.potassium_mg_per_100g))
      setCalciumMg(numberInput(nutrition.calcium_mg_per_100g))
      setIronMg(numberInput(nutrition.iron_mg_per_100g))
      Alert.alert('已识别', '营养成分已回填到表单，请核对后保存。')
    } catch (error) {
      showError('识别营养表失败', error)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!productName.trim()) {
      Alert.alert('请填写商品名称')
      return
    }
    if (!imageUrls.length) {
      Alert.alert('请上传包装图片')
      return
    }
    if (!numberOrUndefined(netWeightG)) {
      Alert.alert('请填写净含量')
      return
    }
    const basis = Math.max(1, numberOrUndefined(nutritionBasis) || 100)
    setLoading(true)
    try {
      const data = await apiClient.createPackagedFood({
        productName,
        displayName,
        brand,
        barcode,
        flavorText,
        packageCategory,
        specText,
        ingredientsText,
        sourceImageUrls: imageUrls,
        ocrRawText: extractResult?.ocr_raw_text,
        extractConfidence: extractResult?.extract_confidence,
        fieldConfidence: extractResult?.field_confidence,
        rawLabelPayload: extractResult?.raw_label_payload,
        conversionStatus: extractResult?.conversion_status || 'converted',
        ingestMethod: extractResult ? 'user_capture_ocr' : 'app_manual',
        reviewStatus: 'pending',
        nutritionBasisUnit: `${basis}g`,
        netWeightG: numberOrUndefined(netWeightG),
        servingWeightG: numberOrUndefined(servingWeightG) || numberOrUndefined(netWeightG),
        kcalPer100g: nutritionValuePer100g(calories, basis),
        proteinPer100g: nutritionValuePer100g(protein, basis),
        carbsPer100g: nutritionValuePer100g(carbs, basis),
        fatPer100g: nutritionValuePer100g(fat, basis),
        fiberPer100g: nutritionValuePer100g(fiber, basis),
        sugarPer100g: nutritionValuePer100g(sugar, basis),
        saturatedFatPer100g: nutritionValuePer100g(saturatedFat, basis),
        cholesterolMgPer100g: nutritionValuePer100g(cholesterolMg, basis),
        sodiumMgPer100g: nutritionValuePer100g(sodiumMg, basis),
        potassiumMgPer100g: nutritionValuePer100g(potassiumMg, basis),
        calciumMgPer100g: nutritionValuePer100g(calciumMg, basis),
        ironMgPer100g: nutritionValuePer100g(ironMg, basis),
      })
      Alert.alert('已保存', String(data.item.display_name || data.item.product_name || '包装食品已加入'))
    } catch (error) {
      showError('保存包装食品失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="包装食品" subtitle="一组商品最多上传 3 张包装、净含量或营养成分表图片">
      <Card>
        <Text style={styles.sectionTitle}>预包装零食补库</Text>
        <Text style={styles.subtitle}>一种商品一组照片。推荐上传正面 + 营养成分表；包装弯曲、字太小或信息分散时，再补一张净含量或局部细节。</Text>
        <View style={styles.packagedGuideGrid}>
          <GuideTile count="1" title="一张能拍全" text="小包装或盒装侧面信息集中时，一张图拍清品名、净含量和营养表。" />
          <GuideTile count="2" title="最常用" text="正面拍品牌、品名、口味；营养表拍能量、蛋白质、脂肪、碳水、钠和口径。" />
          <GuideTile count="3" title="补拍细节" text="大包装、弯曲或字体小，只补拍看不清的局部，别混入另一种商品。" />
        </View>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>先搜零食库</Text>
            <Text style={styles.subtitle}>同品牌、同品名、同规格或净含量只算同一个商品；搜到同款就不用上传。</Text>
          </View>
          <Pill text="避免重复" />
        </View>
        <Field label="品牌、品名、口味或条形码" value={librarySearchQuery} onChangeText={setLibrarySearchQuery} placeholder="例：玉米薄脆 麻辣味" />
        <SmallButton label={librarySearchLoading ? '搜索中' : '搜索零食库'} onPress={searchPackagedLibrary} />
        {librarySearchResults.length ? (
          <View style={styles.packagedSearchResults}>
            <Text style={styles.subtitle}>找到 {librarySearchResults.length} 个包装食品结果，确认同款后不用再上传。</Text>
            {librarySearchResults.map((item, index) => (
              <Pressable key={`${item.source || 'packaged'}-${item.id || index}`} onPress={() => navigation.navigate('FoodLibraryDetail', { item })}>
                <View style={styles.packagedSearchItem}>
                  {item.image_path ? (
                    <Image source={{ uri: item.image_path }} style={styles.packagedSearchImage} />
                  ) : (
                    <View style={styles.packagedSearchImageFallback}>
                      <Text style={styles.packagedSearchImageText}>食</Text>
                    </View>
                  )}
                  <View style={styles.flex}>
                    <Text style={styles.itemName}>{manualFoodTitle(item)}</Text>
                    <Text style={styles.subtitle}>{packagedSearchSubtitle(item)}</Text>
                    <Text style={styles.itemMeta}>{packagedSearchNutrition(item)}</Text>
                  </View>
                  <Pill text="已收录" />
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        {librarySearchTouched && !librarySearchLoading && !librarySearchResults.length ? (
          <Text style={styles.noticeText}>没有搜到同款。确认照片清晰后，可以继续上传补库。</Text>
        ) : null}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>包装图片</Text>
          <Text style={styles.subtitle}>{imageUrls.length}/3</Text>
        </View>
        <View style={styles.packagedImageGrid}>
          {sourceImages.map((item, index) => (
            <View key={`${item.imageUrl}-${index}`} style={styles.packagedImageTile}>
              <Image source={{ uri: item.localUri || item.imageUrl }} style={styles.packagedImage} />
              <Pressable style={styles.imageRemove} onPress={() => removeImage(item.imageUrl)}>
                <Text style={styles.imageRemoveText}>移除</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <AppButton label="从相册上传包装图片" variant="secondary" loading={loading} onPress={pickImage} />
        <Field label="图片地址" value={manualImageUrl} onChangeText={setManualImageUrl} multiline />
        <SmallButton label="添加图片地址" onPress={() => addImageUrl(manualImageUrl)} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>商品信息</Text>
        <Field label="商品名称" value={productName} onChangeText={setProductName} />
        <Field label="展示名称" value={displayName} onChangeText={setDisplayName} />
        <Field label="品牌" value={brand} onChangeText={setBrand} />
        <Field label="口味" value={flavorText} onChangeText={setFlavorText} />
        <Field label="品类" value={packageCategory} onChangeText={setPackageCategory} />
        <Field label="规格" value={specText} onChangeText={setSpecText} />
        <Field label="条形码" value={barcode} onChangeText={setBarcode} />
        <Field label="净含量 g" value={netWeightG} onChangeText={setNetWeightG} keyboardType="decimal-pad" />
        <Field label="建议食用份量 g" value={servingWeightG} onChangeText={setServingWeightG} keyboardType="decimal-pad" />
        <Field label="配料表" value={ingredientsText} onChangeText={setIngredientsText} multiline />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>营养成分</Text>
        <Text style={styles.subtitle}>默认按每 100g 填写；如果包装写的是每份，可把基准改成对应克数，保存时会换算到每 100g。</Text>
        <Field label="营养基准 g" value={nutritionBasis} onChangeText={setNutritionBasis} keyboardType="decimal-pad" />
        <Field label="热量 kcal" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" />
        <Field label="蛋白质 g" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
        <Field label="碳水 g" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
        <Field label="脂肪 g" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
        <Field label="膳食纤维 g" value={fiber} onChangeText={setFiber} keyboardType="decimal-pad" />
        <Field label="糖 g" value={sugar} onChangeText={setSugar} keyboardType="decimal-pad" />
        <Field label="钠 mg" value={sodiumMg} onChangeText={setSodiumMg} keyboardType="decimal-pad" />
        <SmallButton label={showMoreNutrition ? '收起更多营养素' : '填写更多营养素'} onPress={() => setShowMoreNutrition((value) => !value)} />
        {showMoreNutrition ? (
          <>
            <Field label="饱和脂肪 g" value={saturatedFat} onChangeText={setSaturatedFat} keyboardType="decimal-pad" />
            <Field label="胆固醇 mg" value={cholesterolMg} onChangeText={setCholesterolMg} keyboardType="decimal-pad" />
            <Field label="钾 mg" value={potassiumMg} onChangeText={setPotassiumMg} keyboardType="decimal-pad" />
            <Field label="钙 mg" value={calciumMg} onChangeText={setCalciumMg} keyboardType="decimal-pad" />
            <Field label="铁 mg" value={ironMg} onChangeText={setIronMg} keyboardType="decimal-pad" />
          </>
        ) : null}
        <AppButton label="保存包装食品" loading={loading} onPress={save} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>AI 识别任务</Text>
        <Text style={styles.subtitle}>商品识别适合一组 1-3 张图；即时营养表识别会直接回填当前表单。</Text>
        <View style={styles.buttonRow}>
          <SmallButton label="提交商品识别" onPress={submitExtract} />
          <SmallButton label="即时营养表识别" onPress={recognizeNutritionNow} />
          <SmallButton label="后台营养表任务" onPress={submitNutrition} />
          {lastTaskId ? <SmallButton label="刷新并回填" onPress={() => loadTaskIntoForm(lastTaskId)} /> : null}
        </View>
        {extractResult ? (
          <View style={styles.resultBox}>
            <Text style={styles.itemName}>识别结果：{extractResult.product_name || '未识别品名'}</Text>
            <Text style={styles.subtitle}>
              {autoIngest?.status === 'ingested'
                ? '已自动入库包装食品库'
                : autoIngest?.reason || extractResult.needs_more_images?.join('、') || '请核对后保存'}
            </Text>
          </View>
        ) : null}
        {lastTaskId ? (
          <Pressable style={styles.linkRow} onPress={() => navigation.navigate('PackagedFoodTaskDetail', { taskId: lastTaskId })}>
            <Text style={styles.linkText}>查看识别任务</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ) : null}
      </Card>
    </Page>
  )
}

export function PackagedFoodTaskDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'PackagedFoodTaskDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [task, setTask] = useState<(AnalysisTask & { packaged_product?: PackagedProductExtractResult }) | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTask(await apiClient.getPackagedProductExtractTask(route.params.taskId))
    } catch (error) {
      showError('获取任务失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params.taskId])

  useEffect(() => {
    void load()
  }, [load])

  const packaged = task?.packaged_product || null
  const auto = packaged?.auto_ingest_result
  const nutrition = packaged?.unit_nutrition_per_100g || {}
  const imageUrls = packagedTaskImageUrls(task, packaged)
  const isRunning = ['pending', 'queued', 'processing', 'running'].includes(String(task?.status || ''))
  const linkedPackagedFood = Boolean(packaged?.packaged_food_id || auto?.packaged_food_id || auto?.status === 'ingested')

  return (
    <Page title="包装识别任务" subtitle="识别进度与结构化结果" refreshing={loading} onRefresh={load}>
      <Card>
        <MetricLine label="状态" value={taskStatusLabel(task?.status)} />
        <MetricLine label="任务类型" value={analysisTaskTypeLabel(task?.task_type)} />
        <MetricLine label="创建时间" value={formatDateTime(task?.created_at || '') || '--'} />
        <MetricLine label="图片数量" value={`${imageUrls.length} 张`} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>上传图片</Text>
        {imageUrls.length ? (
          <View style={styles.packagedImageGrid}>
            {imageUrls.map((url, index) => (
              <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.packagedImage} />
            ))}
          </View>
        ) : (
          <Text style={styles.subtitle}>暂无图片信息</Text>
        )}
      </Card>

      {packaged ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>结构化结果</Text>
            <MetricLine label="商品名称" value={packaged.product_name || '--'} />
            <MetricLine label="品牌" value={packaged.brand || '--'} />
            <MetricLine label="口味" value={packaged.flavor_text || '--'} />
            <MetricLine label="品类" value={packaged.package_category || '--'} />
            <MetricLine label="规格" value={packaged.spec_text || formatNutritionNumber(packaged.net_weight_g, 'g')} />
            <MetricLine label="条形码" value={packaged.barcode || '--'} />
            <MetricLine label="置信度" value={formatPercent(packaged.extract_confidence)} />
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>营养换算</Text>
            <View style={styles.nutritionRow}>
              <Pill text={`${formatNutritionNumber(nutrition.calories)} kcal`} />
              <Pill text={`蛋白 ${formatNutritionNumber(nutrition.protein, 'g')}`} />
              <Pill text={`碳水 ${formatNutritionNumber(nutrition.carbs, 'g')}`} />
              <Pill text={`脂肪 ${formatNutritionNumber(nutrition.fat, 'g')}`} />
              <Pill text={`糖 ${formatNutritionNumber(nutrition.sugar, 'g')}`} />
              <Pill text={`钠 ${formatNutritionNumber(nutrition.sodiumMg, 'mg')}`} />
            </View>
            <Text style={styles.subtitle}>基准：{packaged.nutrition_basis_unit || '100g'}；换算状态：{packagedConversionStatusLabel(packaged.conversion_status)}</Text>
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>入库状态</Text>
            <MetricLine label="结果" value={packagedIngestStatusLabel(auto?.status)} />
            <MetricLine label="动作" value={packagedUpsertActionLabel(auto?.upsert_action)} />
            {(packaged.packaged_food_id || auto?.packaged_food_id) ? <MetricLine label="商品条目" value="已关联包装食品库" /> : null}
            {auto?.reason ? <Text style={styles.subtitle}>{auto.reason}</Text> : null}
            {auto?.missing_fields?.length ? <Text style={styles.subtitle}>缺少字段：{auto.missing_fields.join('、')}</Text> : null}
            {auto?.conflict_reasons?.length ? <Text style={styles.subtitle}>需要核对：{auto.conflict_reasons.join('、')}</Text> : null}
          </Card>

          <Card>
            <Text style={styles.sectionTitle}>配料表</Text>
            <Text style={styles.bodyText}>{packaged.ingredients_text || '暂无配料信息'}</Text>
          </Card>
        </>
      ) : (
        <Card>
          <Text style={styles.sectionTitle}>{isRunning ? '还在分析中' : '暂无结构化结果'}</Text>
          <Text style={styles.subtitle}>{isRunning ? '稍后下拉刷新即可查看识别结果。' : taskFailureMessage(task)}</Text>
        </Card>
      )}

      <Card>
        <Text style={styles.sectionTitle}>下一步</Text>
        {packaged ? (
          <>
            <Text style={styles.subtitle}>
              {linkedPackagedFood
                ? '识别结果已关联包装食品库。需要修正名称、净含量或营养成分时，可回到补库表单核对后更新。'
                : '识别结果可回填到包装食品表单。请核对商品名称、净含量、图片和营养成分后再保存入库。'}
            </Text>
            <AppButton
              label={linkedPackagedFood ? '核对并更新商品' : '用识别结果补库'}
              onPress={() => navigation.navigate('PackagedFoodEdit', { taskId: route.params.taskId })}
            />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              {isRunning
                ? '任务还在后台识别。下拉刷新或点下方按钮获取最新进度，完成后即可回填到补库表单。'
                : '当前任务没有可回填的结构化结果。可以返回包装食品页重新上传更清晰的包装图或营养成分表。'}
            </Text>
            <View style={styles.buttonRow}>
              <SmallButton label="刷新任务结果" onPress={load} />
              {!isRunning ? <SmallButton label="重新上传包装图" onPress={() => navigation.navigate('PackagedFoodEdit')} /> : null}
            </View>
          </>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>原始 OCR 摘要</Text>
        <Text style={styles.monoText}>{packaged?.ocr_raw_text || '暂无 OCR 文本'}</Text>
      </Card>
    </Page>
  )
}

export function LocationSearchScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'LocationSearch'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<LocationSearchResult | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async () => {
    setLoading(true)
    try {
      setResult(await apiClient.searchLocation(keyword))
    } catch (error) {
      Alert.alert('搜索位置失败', userFacingErrorMessage(error, '位置服务暂时没有返回结果，请换个关键词后再试。'))
    } finally {
      setLoading(false)
    }
  }

  const items = useMemo(() => normalizeLocationItems(result), [result])

  const useLocation = (item: LocationSearchPOI) => {
    const selectedLocation = locationSelectionFromItem(item)
    if (selectedLocation.latitude == null || selectedLocation.longitude == null) {
      Alert.alert('无法使用这个位置', '这个结果没有返回经纬度，请换一个结果或手动填写位置。')
      return
    }
    if (route.params?.returnTo === 'PublicFoodShare') {
      navigation.replace('PublicFoodShare', {
        editId: route.params.editId,
        mode: route.params.mode,
        draft: route.params.draft,
        selectedLocation,
      })
      return
    }
    Alert.alert('已选择位置', [selectedLocation.name, selectedLocation.address].filter(Boolean).join('\n') || '位置已选中')
  }

  return (
    <Page title="定位搜索" subtitle="搜索商家、食堂或地点">
      <Card>
        <Field label="关键词" value={keyword} onChangeText={setKeyword} />
        <AppButton label="搜索" loading={loading} onPress={search} />
      </Card>
      {items.length === 0 && result ? <EmptyState text="没有搜索结果" /> : null}
      {items.map((item, index) => (
        <Card key={String(item.id || `${item.title || item.name}-${index}`)}>
          <Text style={styles.itemName}>{item.title || item.name || '地点'}</Text>
          <Text style={styles.subtitle}>{item.address || item.category || '无地址信息'}</Text>
          <MetricLine label="坐标" value={locationText(item)} />
          <View style={styles.buttonRow}>
            <SmallButton label="使用这个位置" onPress={() => useLocation(item)} />
          </View>
        </Card>
      ))}
    </Page>
  )
}

export function CampusCanteenScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [items, setItems] = useState<PublicFoodItem[]>([])
  const [schoolName, setSchoolName] = useState('')
  const [canteenName, setCanteenName] = useState('')
  const [floorName, setFloorName] = useState('')
  const [windowName, setWindowName] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [sortBy, setSortBy] = useState<CampusCanteenSort>('hot')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (keyword?: string, overrides?: Partial<{ schoolName: string; canteenName: string; sortBy: CampusCanteenSort }>) => {
    setLoading(true)
    try {
      const nextSchoolName = overrides?.schoolName ?? schoolName
      const nextCanteenName = overrides?.canteenName ?? canteenName
      const nextSortBy = overrides?.sortBy ?? sortBy
      const data = await apiClient.listPublicFoods({
        limit: 80,
        type: 'campus',
        isCampusFood: true,
        sortBy: nextSortBy,
        schoolName: nextSchoolName.trim() || undefined,
        canteenName: nextCanteenName.trim() || undefined,
        merchantName: keyword?.trim() || undefined,
      })
      setItems(data.list || [])
    } catch (error) {
      showError('获取校园食堂失败', error)
    } finally {
      setLoading(false)
    }
  }, [canteenName, schoolName, sortBy])

  useEffect(() => {
    void load()
  }, [load])

  const visibleItems = useMemo(() => {
    const floor = normalizeCampusText(floorName)
    const windowText = normalizeCampusText(windowName)
    return items.filter((item) => {
      const location = normalizeCampusText(campusLocationText(item))
      if (floor && !normalizeCampusText(item.floor).includes(floor) && !location.includes(floor)) return false
      if (windowText && !normalizeCampusText(item.window_name).includes(windowText) && !location.includes(windowText)) return false
      return true
    })
  }, [floorName, items, windowName])
  const analyzedItems = useMemo(() => visibleItems.filter(campusHasNutrition), [visibleItems])
  const hotItems = useMemo(() => analyzedItems.slice(0, 6), [analyzedItems])
  const highProteinItems = useMemo(
    () => [...analyzedItems].sort((a, b) => Number(b.total_protein || 0) - Number(a.total_protein || 0)).slice(0, 6),
    [analyzedItems],
  )
  const lowCalorieItems = useMemo(
    () => [...analyzedItems].filter((item) => Number(item.total_calories || 0) > 0).sort((a, b) => Number(a.total_calories || 0) - Number(b.total_calories || 0)).slice(0, 6),
    [analyzedItems],
  )
  const valueItems = useMemo(
    () => [...analyzedItems].filter((item) => campusValueScore(item) > 0).sort((a, b) => campusValueScore(b) - campusValueScore(a)).slice(0, 6),
    [analyzedItems],
  )

  const search = () => {
    void load(searchKeyword)
  }

  const clearFilters = () => {
    setSchoolName('')
    setCanteenName('')
    setFloorName('')
    setWindowName('')
    setSearchKeyword('')
    setSortBy('hot')
    void load('', { schoolName: '', canteenName: '', sortBy: 'hot' })
  }

  const quickRecord = (item: PublicFoodItem) => {
    if (campusIsAnalyzing(item)) {
      Alert.alert('营养信息分析中', '这份校园餐完成分析后就能记录。')
      return
    }
    if (campusAnalysisFailed(item)) {
      Alert.alert('暂时不能记录', '这份校园餐分析没有成功，可以先打开详情查看或补充信息。')
      return
    }
    if (!campusHasNutrition(item)) {
      Alert.alert('营养信息待补充', '这份校园餐还没有可记录的营养数据。')
      return
    }
    navigation.navigate('ManualRecord', {
      quickItem: manualFoodItemFromCampusFood(item),
      sourceChannel: 'campus',
    })
  }

  return (
    <Page title="校园食堂" subtitle="校园餐、食堂窗口和价格信息" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>食堂筛选</Text>
        <Field label="学校" value={schoolName} onChangeText={setSchoolName} placeholder="输入学校名称" />
        <Field label="食堂" value={canteenName} onChangeText={setCanteenName} placeholder="输入食堂名称" />
        <Field label="楼层" value={floorName} onChangeText={setFloorName} placeholder="如：二楼" />
        <Field label="窗口" value={windowName} onChangeText={setWindowName} placeholder="如：12号窗口" />
        <Field label="菜名或位置" value={searchKeyword} onChangeText={setSearchKeyword} placeholder="搜索菜品、商家或位置" />
        <View style={styles.buttonRow}>
          <SmallButton label="搜索" onPress={search} />
          <SmallButton label="清除" onPress={clearFilters} />
          <SmallButton label="补校园餐" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'campus' })} />
        </View>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>排序</Text>
        <View style={styles.segment}>
          {campusCanteenSortOptions.map((option) => (
            <SegmentButton key={option.value} label={option.label} active={sortBy === option.value} onPress={() => setSortBy(option.value)} />
          ))}
        </View>
      </Card>
      {loading && visibleItems.length === 0 ? (
        <Card>
          <ActivityIndicator color={colors.brand} />
        </Card>
      ) : null}
      {analyzedItems.length > 0 ? (
        <>
          <CampusRecommendationSection title="热门菜品" subtitle="按互动和更新时间优先展示" items={hotItems} onPress={(item) => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })} />
          <CampusRecommendationSection title="高蛋白推荐" subtitle="训练后或想吃扎实时优先看这里" items={highProteinItems} onPress={(item) => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })} />
          <CampusRecommendationSection title="低热量选择" subtitle="适合想控制总热量的一餐" items={lowCalorieItems} onPress={(item) => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })} />
          <CampusRecommendationSection title="蛋白性价比" subtitle="按蛋白质和价格粗略排序" items={valueItems} onPress={(item) => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })} />
        </>
      ) : null}
      {!loading && visibleItems.length === 0 ? <EmptyState text="暂无校园餐数据" /> : null}
      {visibleItems.map((item) => (
        <Pressable key={item.id} onPress={() => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })}>
          <Card>
            <View style={styles.campusFoodCardTop}>
              {campusPrimaryImage(item) ? (
                <Image source={{ uri: campusPrimaryImage(item) }} style={styles.campusFoodImage} />
              ) : (
                <View style={styles.campusFoodImageFallback}>
                  <Text style={styles.campusFoodImageText}>食</Text>
                </View>
              )}
              <View style={styles.flex}>
                <Text style={styles.itemName}>{item.food_name || '校园菜品'}</Text>
                <Text style={styles.subtitle}>{campusLocationText(item) || '校园食堂'}</Text>
                <View style={styles.nutritionRow}>
                  <Pill text={campusPriceText(item)} />
                  {campusHasNutrition(item) ? <Pill text={`${Math.round(item.total_calories || 0)} kcal`} /> : <Pill text={campusIsAnalyzing(item) ? '分析中' : campusAnalysisFailed(item) ? '分析失败' : '营养待补充'} />}
                  {item.total_protein > 0 ? <Pill text={`蛋白 ${Math.round(item.total_protein)}g`} /> : null}
                </View>
              </View>
            </View>
            <View style={styles.campusTagRow}>
              {campusTags(item).map((tag) => <Pill key={tag} text={tag} />)}
            </View>
            <Text style={styles.itemMeta}>
              点赞 {item.like_count || 0} · 评论 {item.comment_count || 0} · 收藏 {item.collection_count || 0}
            </Text>
            <View style={styles.buttonRow}>
              <SmallButton label="查看详情" onPress={() => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })} />
              <Pressable style={styles.smallButton} onPress={(event) => { event.stopPropagation(); quickRecord(item) }}>
                <Text style={styles.smallButtonText}>一键记录</Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      ))}
    </Page>
  )
}

export function PrivacySettingsScreen() {
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [searchable, setSearchable] = useState(true)
  const [publicRecords, setPublicRecords] = useState(true)
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<'searchable' | 'public_records' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getUserProfile()
      setProfile(data)
      setSearchable(data.searchable ?? true)
      setPublicRecords(data.public_records ?? true)
    } catch (error) {
      showError('获取隐私设置失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateSetting = async (key: 'searchable' | 'public_records', value: boolean) => {
    const previous = key === 'searchable' ? searchable : publicRecords
    if (key === 'searchable') setSearchable(value)
    if (key === 'public_records') setPublicRecords(value)
    setSavingKey(key)
    try {
      const data = await apiClient.updateUserProfile({ [key]: value })
      setProfile(data)
      if (key === 'searchable') setSearchable(data.searchable ?? value)
      if (key === 'public_records') setPublicRecords(data.public_records ?? value)
    } catch (error) {
      if (key === 'searchable') setSearchable(previous)
      if (key === 'public_records') setPublicRecords(previous)
      showError('保存隐私设置失败', error)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Page title="隐私设置" subtitle="控制资料可见性和公开记录" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>{profile?.nickname || '当前账号'}</Text>
        <SwitchLine
          label="允许在圈子中被搜索"
          subtitle="开启后，其他用户可以通过昵称或账号信息找到你。"
          value={searchable}
          disabled={savingKey === 'searchable'}
          onValueChange={(value) => updateSetting('searchable', value)}
        />
        <SwitchLine
          label="公开我的饮食记录"
          subtitle="开启后，其他用户可在圈子和个人主页看到你的公开动态。"
          value={publicRecords}
          disabled={savingKey === 'public_records'}
          onValueChange={(value) => updateSetting('public_records', value)}
        />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>说明</Text>
        <RuleLine text="开关切换后会立即保存；保存失败时会自动恢复到原状态。" />
        <RuleLine text="关闭被搜索后，其他用户不能通过昵称或账号信息搜到你。" />
        <RuleLine text="关闭公开记录后，你的饮食记录不会进入公开资料页展示。" />
      </Card>
    </Page>
  )
}

const MEMBERSHIP_AGREEMENT_SECTIONS = [
  {
    title: '一、服务说明',
    paragraphs: [
      '本协议是你与 Food Link（食探）之间，就购买和使用会员服务所订立的协议。购买前请仔细阅读全部内容。',
      '会员服务是 Food Link 提供的增值订阅服务。购买会员后，你可以享受相应的每日积分额度、识别额度、精准模式、统计洞察和其他页面展示的功能权益。',
    ],
  },
  {
    title: '二、会员档位与权益',
    paragraphs: [
      'Food Link 可能提供轻度版、标准版、进阶版等会员套餐。轻度版适合轻量记录；标准版适合日常饮食记录；进阶版适合高频记录或更精细的健康管理。',
      '标准版及以上套餐可能包含精准模式。精准模式会对食物照片进行更细的分项估算，适合有减脂、增肌或严格记录目标的用户；轻度版通常仅包含标准模式。',
      '系统积分会按账号会员状态发放。邀请好友、生成分享等行为获得的奖励积分会按活动规则计入累计余额。',
    ],
  },
  {
    title: '三、订阅周期与费用',
    paragraphs: [
      '会员套餐可能提供月卡、季卡、年卡或其他周期，具体价格、原价、优惠和节省金额以购买页实时展示为准。',
      '支付成功后会员权益即时生效。App 侧订单状态会与服务端同步，若支付成功后权益未刷新，可回到会员中心同步订单状态或提交反馈。',
      '未主动开通自动续费的套餐，到期后不会自动续费；到期未续费会恢复为基础额度，已累计的奖励积分余额不受影响。',
      '如提供自动续费服务，用户需要在签约前主动勾选并确认。签约前会展示服务名称、扣费周期、每期金额、预计续费时间和取消方式。',
    ],
  },
  {
    title: '四、升级与切换',
    paragraphs: [
      '在会员有效期内，你可以在当前连续会员期内升级档位或切换到更长周期。升级费用可能按剩余价值折抵后补差计算，具体以订单确认页为准。',
      '升级成功后，新的每日积分额度和相关权益会即时生效；当天已使用的积分仍计入当日用量。',
      '若所选套餐会缩短当前有效期、剩余价值已覆盖目标套餐，或支付渠道暂不支持该切换，系统可能限制即时切换。',
    ],
  },
  {
    title: '五、创始用户礼遇',
    paragraphs: [
      '为感谢早期用户，Food Link 可能面向前 1000 名注册用户或前 100 名付费用户提供创始用户礼遇：开通会员后，每日系统积分按所购套餐额度翻倍发放。',
      '创始用户资格以账号注册、付费和系统记录为准，具体状态可在会员中心查看。',
      '创始用户礼遇与会员套餐绑定，通常仅在会员有效期内生效。会员到期未续费时礼遇权益会暂停，重新开通后按规则恢复。',
    ],
  },
  {
    title: '六、奖励积分规则',
    paragraphs: [
      '邀请好友：通过专属邀请码邀请的新用户，在规定时间内完成有效使用后，双方可按活动规则获得奖励积分。',
      '每日分享：将饮食分析结果生成分享内容并分享，每日首次分享可按规则获得奖励积分。',
      '积分消耗：运动记录、基础饮食记录、精准模式分析、AI 建议等功能可能消耗积分，具体消耗以页面提示和服务端结算为准。',
      '我们保留调整积分获取和消耗规则的权利；如涉及重大变更，会在产品内提前说明。',
    ],
  },
  {
    title: '七、退款与取消',
    paragraphs: [
      '会员服务属于虚拟订阅服务，支付成功后原则上不支持无理由退款。若存在支付异常、重复扣款、订单未生效等特殊情况，可提交反馈协助核实。',
      '未开通自动续费的套餐无需主动取消订阅，到期后不手动续费即自动终止。',
      '已主动开通自动续费的用户，可在产品内自动续费管理路径查看关闭指引，也可在微信支付、应用商店或对应支付渠道的扣费服务中关闭。关闭后不影响已付费周期内权益。',
    ],
  },
  {
    title: '八、服务变更与中断',
    paragraphs: [
      '因系统维护、升级、外部服务异常或不可抗力因素，我们可能暂时中断会员服务，并会尽可能提前通知或在恢复后说明。',
      '如因运营策略调整需要变更会员权益，我们会提前在产品内公示；已购买且仍在有效期内的用户权益会按公示规则处理。',
    ],
  },
  {
    title: '九、争议解决',
    paragraphs: [
      '如你对会员服务、订单、积分或自动续费有任何疑问，可以通过关于与反馈、用户群或产品内客服入口联系我们协商解决。',
    ],
  },
]

export function MembershipAgreementScreen() {
  return (
    <Page title="会员服务协议" subtitle="最后更新：2026年5月">
      {MEMBERSHIP_AGREEMENT_SECTIONS.map((section) => (
        <LegalCard key={section.title} title={section.title} text={section.paragraphs} />
      ))}
    </Page>
  )
}

export function UserGroupScreen() {
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false)
  const groupTitle = '食探用户群'
  const groupSubtitle = '日常反馈、功能建议和使用交流'

  const copyGroupName = async () => {
    await Clipboard.setStringAsync(groupTitle)
    Alert.alert('群名已复制', groupTitle)
  }

  return (
    <Page title="用户群" subtitle="食探交流群">
      <Card>
        <Text style={styles.userGroupEyebrow}>食探交流群</Text>
        <Text style={styles.userGroupHeroTitle}>一起把食探做得更好用</Text>
        <Text style={styles.bodyText}>反馈识别问题、提功能建议，也可以看看其他用户怎么记录饮食。</Text>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>{groupTitle}</Text>
            <Text style={styles.subtitle}>{groupSubtitle}</Text>
          </View>
          <Pill text="永久有效" />
        </View>

        <Pressable style={styles.userGroupQrFrame} onPress={() => setQrPreviewOpen(true)}>
          <Image source={userGroupQr} style={styles.userGroupQrImage} resizeMode="contain" />
        </Pressable>
        <Text style={styles.qrExpiry}>这是当前唯一用户群二维码，可长期使用</Text>

        <View style={styles.buttonRow}>
          <SmallButton label="打开二维码" onPress={() => setQrPreviewOpen(true)} />
          <SmallButton label="复制群名" onPress={() => void copyGroupName()} />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>加入方式</Text>
        <RuleLine text="点击二维码可放大查看。" />
        <RuleLine text="截图保存后，可以在微信中识别二维码加入用户群。" />
      </Card>

      <Modal visible={qrPreviewOpen} transparent animationType="fade" onRequestClose={() => setQrPreviewOpen(false)}>
        <View style={styles.qrModalBackdrop}>
          <View style={styles.qrModalCard}>
            <Image source={userGroupQr} style={styles.qrModalImage} resizeMode="contain" />
            <AppButton label="关闭" onPress={() => setQrPreviewOpen(false)} />
          </View>
        </View>
      </Modal>
    </Page>
  )
}

export function FoodLibraryDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'FoodLibraryDetail'>>()
  const [item, setItem] = useState<ManualFoodItem | undefined>(route.params?.item)
  const [mealType, setMealType] = useState<MealType>('lunch')
  const [date, setDate] = useState(todayKey())
  const [weight, setWeight] = useState(String(Math.round(numberValue(route.params?.item?.default_weight_grams) || 100)))
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const id = String(route.params?.itemId || '').trim()
    if (!id || route.params?.item) return
    setLoading(true)
    try {
      const data = await apiClient.searchManualFood(id, 10)
      const found = (data.results || []).find((candidate) => String(candidate.id || candidate.source_id || '') === id) || data.results?.[0]
      if (found) {
        setItem(found)
        setWeight(String(Math.round(numberValue(found.default_weight_grams) || 100)))
      }
    } catch (error) {
      showError('获取食物详情失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params?.item, route.params?.itemId])

  useEffect(() => {
    void load()
  }, [load])

  const saveRecord = async () => {
    if (!item) {
      Alert.alert('请选择食物', '请返回食物库选择一个食物。')
      return
    }
    setLoading(true)
    try {
      const saved = await apiClient.saveManualFoodRecord({
        item,
        mealType,
        date,
        weight: numberOrUndefined(weight),
      })
      if (!saved.id) {
        Alert.alert('已保存', '饮食记录已写入', [
          { text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) },
        ])
        return
      }
      Alert.alert('已保存', '饮食记录已写入', [
        { text: '回到首页', onPress: () => navigation.dispatch(CommonActions.navigate('MainTabs')) },
        { text: '查看记录', onPress: () => navigation.navigate('RecordDetail', { recordId: saved.id }) },
      ])
    } catch (error) {
      showError('保存饮食记录失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="食物详情" subtitle="营养库与自定义食物信息" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.bigTitle}>{manualFoodTitle(item)}</Text>
        <MetricLine label="默认份量" value={`${Math.round(numberValue(item?.default_weight_grams) || 100)} g`} />
        <MetricLine label="热量" value={`${Math.round(numberValue(item?.total_calories ?? item?.calories))} kcal`} />
        <MetricLine label="蛋白质" value={`${round1(numberValue(item?.total_protein ?? item?.protein))} g`} />
        <MetricLine label="碳水" value={`${round1(numberValue(item?.total_carbs ?? item?.carbs))} g`} />
        <MetricLine label="脂肪" value={`${round1(numberValue(item?.total_fat ?? item?.fat))} g`} />
        {item?.portion_label ? <MetricLine label="份量说明" value={String(item.portion_label)} /> : null}
        {item?.recommend_reason ? <Text style={styles.bodyText}>{String(item.recommend_reason)}</Text> : null}
        <Text style={styles.bodyText}>来源：{manualFoodSourceLabel(item?.source)}</Text>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>记录到今天</Text>
        <View style={styles.segment}>
          {(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'] as MealType[]).map((option) => (
            <SegmentButton key={option} label={mealTypeLabel(option)} active={mealType === option} onPress={() => setMealType(option)} />
          ))}
        </View>
        <Field label="日期" value={date} onChangeText={setDate} />
        <Field label="重量 g" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
        <AppButton label="保存饮食记录" loading={loading} onPress={saveRecord} />
      </Card>
    </Page>
  )
}

export function ExpiryEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ExpiryEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [item, setItem] = useState<FoodExpiryItem | undefined>(route.params?.item)
  const [foodName, setFoodName] = useState(route.params?.item?.food_name || '')
  const [category, setCategory] = useState(route.params?.item?.category || '')
  const [expireDate, setExpireDate] = useState((route.params?.item?.expire_date || todayKey()).slice(0, 10))
  const [quantityNote, setQuantityNote] = useState(route.params?.item?.quantity_note || '')
  const [storageType, setStorageType] = useState(route.params?.item?.storage_type || 'refrigerated')
  const [note, setNote] = useState(route.params?.item?.note || '')
  const [status, setStatus] = useState(route.params?.item?.status || 'active')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const id = String(route.params?.itemId || '').trim()
    if (!id) return
    setLoading(true)
    try {
      const data = await apiClient.getFoodExpiryItem(id)
      const nextItem = data.item
      setItem(nextItem)
      setFoodName(nextItem.food_name || '')
      setCategory(nextItem.category || '')
      setExpireDate((nextItem.expire_date || todayKey()).slice(0, 10))
      setQuantityNote(nextItem.quantity_note || '')
      setStorageType(nextItem.storage_type || 'refrigerated')
      setNote(nextItem.note || '')
      setStatus(nextItem.status || 'active')
    } catch (error) {
      showError('获取保质期条目失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params?.itemId])

  useEffect(() => {
    if (!route.params?.item && route.params?.itemId) void load()
  }, [load, route.params?.item, route.params?.itemId])

  const save = async () => {
    setLoading(true)
    try {
      if (route.params?.itemId) {
        const data = await apiClient.updateFoodExpiryItem(route.params.itemId, {
          foodName,
          category,
          expireDate,
          quantityNote,
          storageType,
          note,
          status,
        })
        setItem(data.item)
        Alert.alert('已保存', '保质期记录已更新')
      } else {
        const data = await apiClient.createFoodExpiryItem({
          foodName,
          category,
          expireDate,
          quantityNote,
          storageType,
          note,
        })
        setItem(data.item)
        Alert.alert('已保存', '保质期记录已加入')
      }
      navigation.goBack()
    } catch (error) {
      showError('保存保质期失败', error)
    } finally {
      setLoading(false)
    }
  }

  const setStatusAndSave = async (nextStatus: string) => {
    setStatus(nextStatus)
    if (!route.params?.itemId) return
    setLoading(true)
    try {
      const data = await apiClient.updateFoodExpiryItem(route.params.itemId, { status: nextStatus })
      setItem(data.item)
      Alert.alert('已更新', '状态已保存')
    } catch (error) {
      showError('更新状态失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="编辑保质期" subtitle={item?.food_name || '新保质期记录'} refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>基础信息</Text>
        <Field label="食物名称" value={foodName} onChangeText={setFoodName} />
        <Field label="分类" value={category} onChangeText={setCategory} />
        <Field label="到期日期" value={expireDate} onChangeText={setExpireDate} />
        <Field label="数量说明" value={quantityNote} onChangeText={setQuantityNote} />
        <StorageTypeSegment value={storageType} onChange={setStorageType} />
        <Field label="备注" value={note} onChangeText={setNote} multiline />
        <AppButton label="保存保质期记录" loading={loading} onPress={save} />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>状态</Text>
        <View style={styles.segment}>
          <SegmentButton label="保鲜中" active={status === 'active'} onPress={() => setStatusAndSave('active')} />
          <SegmentButton label="已吃完" active={status === 'consumed'} onPress={() => setStatusAndSave('consumed')} />
          <SegmentButton label="已丢弃" active={status === 'discarded'} onPress={() => setStatusAndSave('discarded')} />
        </View>
      </Card>
    </Page>
  )
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  )
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentItem, active && styles.segmentItemActive]} onPress={onPress}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  )
}

function StorageTypeSegment({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>储存方式</Text>
      <View style={styles.segment}>
        {expiryStorageOptions.map((option) => (
          <SegmentButton key={option.value} label={option.label} active={value === option.value} onPress={() => onChange(option.value)} />
        ))}
      </View>
    </View>
  )
}

function SmallButton({
  label,
  danger,
  disabled,
  onPress,
}: {
  label: string
  danger?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      style={[styles.smallButton, danger && styles.smallButtonDanger, disabled && styles.smallButtonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText]}>{label}</Text>
    </Pressable>
  )
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{text}</Text>
    </View>
  )
}

function CampusRecommendationSection({
  title,
  subtitle,
  items,
  onPress,
}: {
  title: string
  subtitle: string
  items: PublicFoodItem[]
  onPress: (item: PublicFoodItem) => void
}) {
  if (!items.length) return null
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.campusRecommendScroll}>
        {items.map((item) => (
          <Pressable key={`${title}-${item.id}`} style={styles.campusRecommendCard} onPress={() => onPress(item)}>
            {campusPrimaryImage(item) ? (
              <Image source={{ uri: campusPrimaryImage(item) }} style={styles.campusRecommendImage} />
            ) : (
              <View style={styles.campusRecommendImageFallback}>
                <Text style={styles.campusFoodImageText}>食</Text>
              </View>
            )}
            <Text style={styles.campusRecommendTitle} numberOfLines={2}>{item.food_name || '校园菜品'}</Text>
            <Text style={styles.itemMeta} numberOfLines={1}>{campusPriceText(item)} · 蛋白 {Math.round(item.total_protein || 0)}g</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Card>
  )
}

function GuideTile({ count, title, text }: { count: string; title: string; text: string }) {
  return (
    <View style={styles.guideTile}>
      <View style={styles.guideCount}>
        <Text style={styles.guideCountText}>{count}</Text>
        <Text style={styles.guideCountUnit}>张</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.itemName}>{title}</Text>
        <Text style={styles.itemMeta}>{text}</Text>
      </View>
    </View>
  )
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricLine}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <Text style={styles.empty}>{text}</Text>
    </Card>
  )
}

function RuleLine({ text }: { text: string }) {
  return (
    <View style={styles.ruleLine}>
      <View style={styles.ruleDot} />
      <Text style={styles.bodyText}>{text}</Text>
    </View>
  )
}

function LegalCard({ title, text }: { title: string; text: string | string[] }) {
  const paragraphs = Array.isArray(text) ? text : [text]
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      {paragraphs.map((paragraph, index) => (
        <Text key={`${title}-${index}`} style={[styles.bodyText, index > 0 && styles.legalParagraph]}>
          {paragraph}
        </Text>
      ))}
    </Card>
  )
}

function SwitchLine({
  label,
  subtitle,
  value,
  disabled,
  onValueChange,
}: {
  label: string
  subtitle?: string
  value: boolean
  disabled?: boolean
  onValueChange: (value: boolean) => void
}) {
  return (
    <View style={styles.switchLine}>
      <View style={styles.switchTextBlock}>
        <Text style={styles.itemName}>{label}</Text>
        {subtitle ? <Text style={styles.switchSubtitle}>{subtitle}</Text> : null}
      </View>
      {disabled ? <ActivityIndicator size="small" color={colors.brand} /> : null}
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.surfaceMuted, true: colors.brandSoft }}
        thumbColor={value ? colors.brand : colors.textMuted}
      />
    </View>
  )
}

function normalizeCampusText(value?: string | null): string {
  return String(value || '').trim().toLowerCase()
}

function campusPrimaryImage(item: PublicFoodItem): string {
  return String(item.image_path || item.image_paths?.[0] || '').trim()
}

function campusLocationText(item: PublicFoodItem): string {
  return String(item.campus_location_text || [item.school_name, item.campus_name, item.canteen_name, item.floor, item.window_name].filter(Boolean).join(' · ') || item.merchant_name || '').trim()
}

function campusPriceText(item: PublicFoodItem): string {
  const type = String(item.price_type || 'fixed')
  if (type === 'unknown') return '价格待补充'
  if (type === 'range' && item.price_min != null && item.price_max != null) return `¥${item.price_min}-${item.price_max}`
  const price = Number(item.price || 0)
  if (!price) return '价格待补充'
  const unit = String(item.price_unit || (type === 'weight' ? 'kg' : type === 'combo' ? '套餐' : '份')).replace(/^元\/?/, '')
  return `¥${price}/${unit || '份'}`
}

function campusIsAnalyzing(item: PublicFoodItem): boolean {
  const status = normalizeCampusText(item.analysis_status)
  return status === 'pending' || status === 'processing' || status === 'running'
}

function campusAnalysisFailed(item: PublicFoodItem): boolean {
  const status = normalizeCampusText(item.analysis_status)
  return status === 'failed' || status === 'timed_out' || status === 'cancelled' || status === 'violated'
}

function campusHasNutrition(item: PublicFoodItem): boolean {
  if (Number(item.total_calories || 0) > 0 || Number(item.total_protein || 0) > 0) return true
  return (item.items || []).some((entry) => {
    const nutrients = (entry as { nutrients?: Record<string, unknown> }).nutrients
    return Number(nutrients?.calories || 0) > 0 || Number(nutrients?.protein || 0) > 0
  })
}

function campusValueScore(item: PublicFoodItem): number {
  const price = Number(item.price || 0)
  const protein = Number(item.total_protein || 0)
  return price > 0 && protein > 0 ? protein / price : 0
}

function campusTags(item: PublicFoodItem): string[] {
  if (campusIsAnalyzing(item)) return ['分析中']
  if (campusAnalysisFailed(item)) return ['分析失败']
  if (!campusHasNutrition(item)) return ['营养待补充']
  const tags: string[] = []
  if (Number(item.total_protein || 0) >= 25) tags.push('高蛋白')
  if (Number(item.total_calories || 0) > 0 && Number(item.total_calories || 0) <= 450) tags.push('低热量')
  if (item.suitable_for_fat_loss) tags.push('减脂友好')
  if (campusValueScore(item) > 1) tags.push('蛋白划算')
  return tags.slice(0, 3)
}

function manualFoodItemFromCampusFood(item: PublicFoodItem): ManualFoodItem {
  const firstItem = (item.items?.[0] || {}) as Record<string, unknown>
  const defaultWeight = Number(firstItem.intake || firstItem.weight || (item.total_calories > 0 ? 1 : 100)) || 100
  const title = String(item.food_name || item.description || '校园菜品').trim()
  const portionLabel = String(firstItem.manual_portion_label || item.portion_description || '1份').trim()
  return {
    id: item.id,
    title,
    name: title,
    source: 'public_library',
    source_id: item.id,
    source_label: '校园食堂',
    default_weight_grams: defaultWeight,
    total_calories: Number(item.total_calories || 0),
    total_protein: Number(item.total_protein || 0),
    total_carbs: Number(item.total_carbs || 0),
    total_fat: Number(item.total_fat || 0),
    portion_label: portionLabel || '1份',
    recommend_reason: '校园真实菜品，热量价格一目了然',
    image_path: item.image_path,
    image_paths: item.image_paths,
    is_campus_food: item.is_campus_food,
    type: item.type,
    campus_location_text: item.campus_location_text,
    school_name: item.school_name,
    campus_name: item.campus_name,
    canteen_name: item.canteen_name,
    floor: item.floor,
    window_name: item.window_name,
  }
}

function showError(title: string, error: unknown) {
  Alert.alert(title, userFacingErrorMessage(error))
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function numberInput(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return (Math.round(n * 100) / 100).toString()
}

function nutritionValuePer100g(value: string, basis: number): number | undefined {
  const n = numberOrUndefined(value)
  if (n == null) return undefined
  const safeBasis = basis > 0 ? basis : 100
  return Math.round((n * 100 / safeBasis) * 100) / 100
}

function dedupePackagedImages(items: Array<{ localUri?: string; imageUrl: string }>): Array<{ localUri?: string; imageUrl: string }> {
  const seen = new Set<string>()
  return items.filter((item) => {
    const imageUrl = item.imageUrl.trim()
    if (!imageUrl || seen.has(imageUrl)) return false
    seen.add(imageUrl)
    return true
  })
}

function packagedTaskImageUrls(
  task?: (AnalysisTask & { packaged_product?: PackagedProductExtractResult }) | null,
  packaged?: PackagedProductExtractResult | null,
): string[] {
  const urls = [
    ...((task?.image_paths || []) as string[]),
    task?.image_url || '',
    ...((packaged?.source_image_urls || []) as string[]),
  ].map((url) => String(url || '').trim()).filter(Boolean)
  return Array.from(new Set(urls))
}

function formatNutritionNumber(value: unknown, unit = ''): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return unit ? `-- ${unit}` : '--'
  const text = (Math.round(n * 10) / 10).toString()
  return unit ? `${text} ${unit}` : text
}

function formatPercent(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '--'
  return `${Math.round(n * 100)}%`
}

function packagedIngestStatusLabel(value?: string): string {
  const labels: Record<string, string> = {
    ingested: '已入库',
    blocked: '需要补充',
    duplicate: '已有同款',
    skipped: '未入库',
  }
  return labels[value || ''] || value || '--'
}

function packagedUpsertActionLabel(value?: string): string {
  const labels: Record<string, string> = {
    inserted: '新建商品',
    updated: '更新商品',
    skipped: '未写入',
    merged: '合并更新',
    duplicate: '已有同款',
  }
  return labels[value || ''] || value || '--'
}

function packagedConversionStatusLabel(value?: string): string {
  const labels: Record<string, string> = {
    converted: '已换算',
    pending: '待换算',
    failed: '换算失败',
    skipped: '无需换算',
  }
  return labels[value || ''] || value || '--'
}

function taskStatusLabel(value?: string): string {
  const labels: Record<string, string> = {
    pending: '等待中',
    queued: '排队中',
    processing: '处理中',
    running: '处理中',
    done: '已完成',
    completed: '已完成',
    failed: '失败',
    error: '失败',
    canceled: '已取消',
    cancelled: '已取消',
  }
  return labels[value || ''] || value || '--'
}

function analysisTaskTypeLabel(value?: string): string {
  const labels: Record<string, string> = {
    food_image: '图片识别',
    food: '图片识别',
    food_text: '文字识别',
    packaged_food: '包装食品识别',
    packaged_product_extract: '包装食品识别',
    packaged_nutrition_label: '营养成分表识别',
    nutrition_label: '营养成分表识别',
    exercise_image: '运动截图识别',
  }
  return labels[value || ''] || value || '--'
}

function taskFailureMessage(task?: AnalysisTask | null): string {
  const message = String((task as { error_message?: unknown } | null)?.error_message || '').trim()
  return userFacingMessage(message, '识别失败，请换一张更清晰的包装图或营养成分表后重新上传。')
}

function manualFoodTitle(item?: ManualFoodItem): string {
  return String(item?.title || item?.name || '食物详情')
}

function manualFoodSourceLabel(value: unknown): string {
  const key = String(value || 'nutrition_library').trim()
  const labels: Record<string, string> = {
    nutrition_library: '标准食物库',
    custom: '我的自定义食物',
    user_custom: '我的自定义食物',
    manual: '手动录入',
    public_food: '公共食物库',
    campus_food: '校园食堂',
    packaged_food: '包装食品库',
  }
  return labels[key] || key || '标准食物库'
}

function packagedSearchSubtitle(item: ManualFoodItem): string {
  return String(item.subtitle || item.source_label || item.portion_label || manualFoodSourceLabel(item.source))
}

function packagedSearchNutrition(item: ManualFoodItem): string {
  const highlights = Array.isArray(item.nutrition_highlights) ? item.nutrition_highlights.map((value) => String(value)).filter(Boolean) : []
  if (highlights.length) return highlights.slice(0, 2).join(' · ')
  const calories = Number(item.total_calories ?? item.calories)
  const weight = Number(item.default_weight_grams)
  const parts = [
    Number.isFinite(calories) && calories > 0 ? `${Math.round(calories)} kcal` : '',
    Number.isFinite(weight) && weight > 0 ? `默认 ${Math.round(weight)}g` : '',
  ].filter(Boolean)
  return parts.join(' · ') || '包装食品库条目'
}

function mealTypeLabel(value: MealType): string {
  const labels: Partial<Record<MealType, string>> = {
    breakfast: '早餐',
    lunch: '午餐',
    dinner: '晚餐',
    snack: '加餐',
    morning_snack: '上午加餐',
    afternoon_snack: '下午加餐',
    evening_snack: '夜间加餐',
  }
  return labels[value] || '加餐'
}

function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function numberMaybe(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function stringValue(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

function normalizeLocationItems(result: LocationSearchResult | null): LocationSearchPOI[] {
  if (!result) return []
  if (Array.isArray(result.pois)) return result.pois
  if (Array.isArray(result.list)) return result.list
  if (Array.isArray(result.items)) return result.items
  const maybeData = result.data as LocationSearchResult | undefined
  if (maybeData && Array.isArray(maybeData.pois)) return maybeData.pois
  if (maybeData && Array.isArray(maybeData.list)) return maybeData.list
  return []
}

function locationSelectionFromItem(item: LocationSearchPOI): LocationSelection {
  const lonlat = stringValue(item.lonlat || item.lnglat || item.lonLat)
  const parsed = parseLonLat(lonlat)
  const longitude = numberMaybe(item.location?.lng) ?? numberMaybe(item.longitude) ?? parsed.longitude
  const latitude = numberMaybe(item.location?.lat) ?? numberMaybe(item.latitude) ?? parsed.latitude
  const addressComponent = item.addressComponent || item.address_component
  const province = stringValue(item.province || fieldValue(addressComponent, 'province'))
  const city = stringValue(item.city || fieldValue(addressComponent, 'city') || item.promptCity)
  const district = stringValue(item.district || fieldValue(addressComponent, 'county') || fieldValue(addressComponent, 'district'))

  return {
    name: stringValue(item.name || item.title),
    address: stringValue(item.address),
    lonlat: longitude != null && latitude != null ? `${longitude},${latitude}` : lonlat || undefined,
    longitude: longitude ?? undefined,
    latitude: latitude ?? undefined,
    province: province || undefined,
    city: city || undefined,
    district: district || undefined,
    promptCity: stringValue(item.promptCity || city) || undefined,
  }
}

function parseLonLat(value: string): { longitude?: number; latitude?: number } {
  const [lngText, latText] = value.split(',').map((part) => part.trim())
  const longitude = numberMaybe(lngText)
  const latitude = numberMaybe(latText)
  return {
    longitude: longitude ?? undefined,
    latitude: latitude ?? undefined,
  }
}

function fieldValue(source: unknown, key: string): unknown {
  if (!source || typeof source !== 'object') return undefined
  return (source as Record<string, unknown>)[key]
}

function locationText(item: LocationSearchPOI): string {
  const selection = locationSelectionFromItem(item)
  const lat = selection.latitude
  const lng = selection.longitude
  if (lat == null || lng == null) return '--'
  return `${lat}, ${lng}`
}

type TrendPoint = {
  date: string
  value: number | null
  total?: number
}

type TrendWaterLogItem = BodyMetricWaterLogItem & {
  date: string
}

type WeightHistoryItem = BodyMetricWeightEntry & {
  delta: number | null
}

type WeightMonthGroup = {
  key: string
  label: string
  totalChange: number | null
  items: WeightHistoryItem[]
}

function buildTrendDateRange(days: number, endDate: string): string[] {
  const end = parseTrendDate(endDate)
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(end)
    day.setUTCDate(end.getUTCDate() - (days - 1 - index))
    return trendDateKey(day)
  })
}

function parseTrendDate(value: string): Date {
  const key = String(value || '').slice(0, 10)
  const fallback = `${todayKey()}T00:00:00.000Z`
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(key) ? `${key}T00:00:00.000Z` : fallback)
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed
}

function trendDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildWeightTrendPoints(summary: BodyMetricsSummary | null, dates: string[]): TrendPoint[] {
  const daily = summary?.weight_trend_daily || []
  if (daily.length > 0) {
    const byDate = new Map(daily.map((item) => [item.date, Number(item.value)]))
    return dates.map((date) => {
      const value = byDate.get(date)
      return { date, value: typeof value === 'number' && Number.isFinite(value) ? value : null }
    })
  }

  const entries = [...(summary?.weight_entries || [])]
    .filter((item) => Number.isFinite(Number(item.value)))
    .sort((a, b) => weightSortKey(a).localeCompare(weightSortKey(b)))
  let entryIndex = 0
  let carried: number | null = null
  return dates.map((date) => {
    while (entryIndex < entries.length && weightSortKey(entries[entryIndex]).slice(0, 10) <= date) {
      carried = Number(entries[entryIndex].value)
      entryIndex += 1
    }
    return { date, value: carried }
  })
}

function buildWaterTrendPoints(summary: BodyMetricsSummary | null, dates: string[]): TrendPoint[] {
  const byDate = new Map<string, number>()
  ;(summary?.water_daily || []).forEach((item) => byDate.set(item.date, Number(item.total || 0)))
  if (summary?.today_water?.date) byDate.set(summary.today_water.date, Number(summary.today_water.total || 0))
  return dates.map((date) => ({ date, value: byDate.get(date) || 0 }))
}

function buildExerciseTrendDays(logs: ExerciseLogItem[], dates: string[]): TrendPoint[] {
  const byDate = new Map<string, number>()
  logs.forEach((log) => {
    const date = trendExerciseDate(log)
    byDate.set(date, (byDate.get(date) || 0) + Number(log.calories_burned || 0))
  })
  return dates.map((date) => {
    const total = byDate.get(date) || 0
    return { date, value: total, total }
  })
}

function buildWeightMonthGroups(entries: BodyMetricWeightEntry[]): WeightMonthGroup[] {
  const sorted = [...entries]
    .filter((item) => Number.isFinite(Number(item.value)))
    .sort((a, b) => weightSortKey(a).localeCompare(weightSortKey(b)))
  const withDelta = sorted.map((item, index): WeightHistoryItem => ({
    ...item,
    delta: index > 0 ? Number(item.value) - Number(sorted[index - 1].value) : null,
  }))
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
      label: `${Number(item.date.slice(5, 7))} 月`,
      totalChange: null,
      items: [item],
    })
  })
  groups.forEach((group) => {
    const chronological = [...group.items].sort((a, b) => weightSortKey(a).localeCompare(weightSortKey(b)))
    const first = chronological[0]
    const last = chronological[chronological.length - 1]
    group.totalChange = first && last && chronological.length > 1 ? Number(last.value) - Number(first.value) : null
  })
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
}

function weightSortKey(item: BodyMetricWeightEntry): string {
  return String(item.recorded_at || item.date || '')
}

function getTrendWaterLogItems(day: BodyMetricWaterDay | null | undefined): TrendWaterLogItem[] {
  if (!day) return []
  if (Array.isArray(day.log_items)) {
    return day.log_items.map((item) => ({ ...item, date: item.date || day.date }))
  }
  if (Array.isArray(day.logs)) {
    return day.logs.map((amount, index) => ({
      date: day.date,
      amount_ml: Number(amount) || 0,
      recorded_at: `${day.date}-${index}`,
    }))
  }
  return []
}

function formatTrendMonthDay(value: string): string {
  const key = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return value || '--'
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`
}

function formatTrendWeight(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '--'
  return (Math.round(n * 10) / 10).toString()
}

function formatTrendSigned(value: unknown, digits = 0): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '--'
  const rounded = digits > 0 ? (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits) : String(Math.round(n))
  return `${n > 0 ? '+' : ''}${rounded}`
}

function trendExerciseDate(log: ExerciseLogItem): string {
  return String(log.recorded_on || log.date || log.recorded_at || log.created_at || todayKey()).slice(0, 10)
}

function trendExerciseTitle(log: ExerciseLogItem): string {
  return String(log.exercise_desc || log.exercise_type || '运动').trim() || '运动'
}

function trendLevelColor(value: number, maxValue: number): string {
  if (value <= 0) return colors.surfaceMuted
  const ratio = value / Math.max(maxValue, 1)
  if (ratio >= 0.75) return colors.brandDark
  if (ratio >= 0.45) return colors.brand
  if (ratio >= 0.2) return '#8ed4b8'
  return colors.brandSoft
}

function TrendBarChart({ points, unit, emptyText }: { points: TrendPoint[]; unit: string; emptyText: string }) {
  const values = points
    .map((item) => item.value)
    .filter((value): value is number => value != null && Number.isFinite(value))
  if (values.length === 0) {
    return <Text style={styles.empty}>{emptyText}</Text>
  }
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = Math.max(max - min, 0.1)
  const latest = [...points].reverse().find((item) => item.value != null)
  return (
    <View style={styles.trendChartBlock}>
      <View style={styles.trendBarChart}>
        {points.map((item) => {
          const value = item.value
          const height = value == null ? 3 : 10 + ((value - min) / span) * 86
          return (
            <View key={item.date} style={styles.trendBarSlot}>
              <View
                style={[
                  styles.trendBarFill,
                  value == null && styles.trendBarFillEmpty,
                  { height },
                ]}
              />
            </View>
          )
        })}
      </View>
      <View style={styles.trendAxisRow}>
        <Text style={styles.itemMeta}>{formatTrendMonthDay(points[0]?.date || '')}</Text>
        <Text style={styles.itemMeta}>{latest?.value != null ? `${formatTrendWeight(latest.value)} ${unit}` : '--'}</Text>
        <Text style={styles.itemMeta}>{formatTrendMonthDay(points[points.length - 1]?.date || '')}</Text>
      </View>
    </View>
  )
}

function TrendHeatmap({
  points,
  maxValue,
  selectedDate,
  onSelect,
}: {
  points: TrendPoint[]
  maxValue: number
  selectedDate?: string
  onSelect?: (date: string) => void
}) {
  return (
    <View style={styles.trendHeatmap}>
      {points.map((item) => {
        const value = Number(item.value || 0)
        const selected = selectedDate === item.date
        return (
          <Pressable
            key={item.date}
            style={[
              styles.trendHeatCell,
              { backgroundColor: trendLevelColor(value, maxValue) },
              selected && styles.trendHeatCellSelected,
            ]}
            disabled={!onSelect}
            onPress={() => onSelect?.(item.date)}
          >
            <Text style={[styles.trendHeatDay, value > 0 && styles.trendHeatDayActive]}>{Number(item.date.slice(8, 10))}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  segmentItem: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
  },
  segmentItemActive: {
    backgroundColor: colors.brand,
  },
  segmentText: {
    color: colors.textSecondary,
    fontWeight: '800',
    textAlign: 'center',
  },
  segmentTextActive: {
    color: '#fff',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  bigTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 14,
  },
  bigNumber: {
    color: colors.brandDark,
    fontSize: 36,
    fontWeight: '900',
  },
  score: {
    color: colors.brandDark,
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  bodyText: {
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: 14,
  },
  legalParagraph: {
    marginTop: 4,
  },
  focusCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  focusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  focusTitleWrap: {
    flex: 1,
  },
  focusTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 4,
  },
  focusScorePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.brandSoft,
  },
  focusScore: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  focusDetailBlock: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  focusLabel: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 4,
  },
  focusDelta: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  dietRecommendationItem: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  monoText: {
    marginTop: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemName: {
    color: colors.text,
    fontWeight: '800',
  },
  itemMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  noticeText: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  nutritionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  campusFoodCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  campusFoodImage: {
    width: 86,
    height: 86,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  campusFoodImageFallback: {
    width: 86,
    height: 86,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  campusFoodImageText: {
    color: colors.brandDark,
    fontSize: 20,
    fontWeight: '900',
  },
  campusTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  campusRecommendScroll: {
    gap: 12,
    paddingTop: 12,
    paddingBottom: 2,
  },
  campusRecommendCard: {
    width: 154,
    minHeight: 188,
    borderRadius: 14,
    padding: 10,
    backgroundColor: colors.surfaceMuted,
  },
  campusRecommendImage: {
    width: '100%',
    height: 82,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: colors.surface,
  },
  campusRecommendImageFallback: {
    width: '100%',
    height: 82,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    backgroundColor: colors.brandSoft,
  },
  campusRecommendTitle: {
    minHeight: 42,
    color: colors.text,
    fontWeight: '900',
    lineHeight: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  smallButton: {
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  smallButtonDanger: {
    backgroundColor: '#fee8e8',
  },
  smallButtonDisabled: {
    opacity: 0.55,
  },
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  smallButtonDangerText: {
    color: colors.danger,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.brandSoft,
  },
  pillText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  metricLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  metricLabel: {
    color: colors.textSecondary,
  },
  metricValue: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'right',
  },
  trendHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  trendHeroBadge: {
    minWidth: 92,
    minHeight: 72,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.brandSoft,
  },
  trendHeroBadgeLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  trendHeroBadgeValue: {
    color: colors.brandDark,
    fontSize: 20,
    fontWeight: '900',
  },
  trendChartBlock: {
    marginTop: 6,
    marginBottom: 10,
  },
  trendBarChart: {
    height: 116,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    paddingHorizontal: 2,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
  },
  trendBarSlot: {
    flex: 1,
    minWidth: 4,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  trendBarFill: {
    width: '100%',
    minHeight: 3,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  trendBarFillEmpty: {
    backgroundColor: colors.border,
  },
  trendAxisRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  trendHeatmap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
    marginBottom: 12,
  },
  trendHeatCell: {
    flexBasis: '12.4%',
    aspectRatio: 1,
    minWidth: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendHeatCellSelected: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  trendHeatDay: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  trendHeatDayActive: {
    color: '#fff',
  },
  trendMonthGroup: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  trendHistoryRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  trendHistoryRowActive: {
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: colors.brandSoft,
  },
  trendHistorySide: {
    alignItems: 'flex-end',
    gap: 8,
  },
  trendHistoryValue: {
    color: colors.text,
    fontWeight: '900',
  },
  trendDetailBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  trendChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  trendChip: {
    minWidth: 92,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surfaceMuted,
  },
  trendChipText: {
    color: colors.text,
    fontWeight: '900',
  },
  trendChipMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 3,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },
  textarea: {
    minHeight: 104,
    paddingTop: 12,
    paddingBottom: 12,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  previewImage: {
    width: '100%',
    height: 210,
    borderRadius: 16,
    marginBottom: 12,
    backgroundColor: colors.surfaceMuted,
  },
  packagedGuideGrid: {
    gap: 10,
    marginTop: 14,
  },
  guideTile: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  guideCount: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  guideCountText: {
    color: colors.brandDark,
    fontSize: 20,
    fontWeight: '900',
  },
  guideCountUnit: {
    color: colors.brandDark,
    fontSize: 10,
    fontWeight: '800',
    marginTop: -2,
  },
  packagedSearchResults: {
    gap: 10,
    marginTop: 14,
  },
  packagedSearchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  packagedSearchImage: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  packagedSearchImageFallback: {
    width: 58,
    height: 58,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  packagedSearchImageText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  packagedImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  packagedImageTile: {
    width: '30%',
    minWidth: 92,
  },
  packagedImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  imageRemove: {
    marginTop: 6,
    minHeight: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  imageRemoveText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  resultBox: {
    marginTop: 14,
    borderRadius: 14,
    padding: 12,
    backgroundColor: colors.surfaceMuted,
    gap: 5,
  },
  linkRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkText: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 28,
  },
  switchLine: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  switchTextBlock: {
    flex: 1,
    gap: 4,
  },
  switchSubtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
    fontSize: 13,
  },
  ruleLine: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  ruleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand,
    marginTop: 7,
  },
  qrImage: {
    width: '100%',
    height: 360,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    marginBottom: 12,
  },
  userGroupEyebrow: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
  },
  userGroupHeroTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 30,
    marginBottom: 8,
  },
  userGroupQrFrame: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  userGroupQrImage: {
    width: '100%',
    height: 440,
  },
  qrExpiry: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  qrModalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  qrModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.surface,
  },
  qrModalImage: {
    width: '100%',
    height: 560,
    borderRadius: 14,
    marginBottom: 12,
    backgroundColor: colors.surfaceMuted,
  },
})
