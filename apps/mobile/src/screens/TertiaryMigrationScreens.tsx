import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Image, ImageBackground, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native'
import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import * as MediaLibrary from 'expo-media-library'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, Line as SvgLine, LinearGradient as SvgLinearGradient, Path as SvgPath, Rect as SvgRect, Stop } from 'react-native-svg'
import { ChevronLeft, Flame, ImagePlus, Info, UserRound, X } from 'lucide-react-native'
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
  type FoodRecord,
  type HealthProfile,
  type HomeDashboard,
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
  type PetSummary,
  type UserInfo,
} from '@food-link/core'
import { apiClient } from '../api'
import type { DiningCanteenItem, DiningFloorItem, DiningLocationItem, DiningLocationSiteItem, DiningLocationType, DiningWindowItem } from '@food-link/api-client'
import { AppButton } from '../components/AppButton'
import { InsightMarkdownView } from '../components/InsightMarkdownView'
import { PetAvatar, petMoodLabel, petStateLabel } from '../components/PetAvatar'
import { AppAlert as Alert } from '../providers/DialogProvider'
import { emitFoodExpiryChangedEvent, emitHomeDashboardRefreshEvent } from '../utils/home-events'
import type { LocationSelection, RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'
import { userFacingErrorMessage, userFacingMessage } from '../utils/errors'

const userGroupQr = require('../../assets/community/foodlink-user-group-permanent-20260602.jpg')
const cafeteriaHeroBgUrl = 'https://cdn-food-images.coachlink.fit/wechat/cafeteria-hero.jpg'

const expiryStorageOptions = [
  { value: 'refrigerated', label: '冷藏' },
  { value: 'room_temp', label: '常温' },
  { value: 'frozen', label: '冷冻' },
] as const

const DEFAULT_LOCATION_COORDS = { latitude: 39.89945, longitude: 116.40769 }

const expiryEditPresets = [
  { name: '牛奶', category: '乳制品', days: 3, storageType: 'refrigerated' },
  { name: '酸奶', category: '乳制品', days: 5, storageType: 'refrigerated' },
  { name: '水果', category: '水果', days: 3, storageType: 'refrigerated' },
  { name: '面包', category: '面包', days: 3, storageType: 'room_temp' },
  { name: '剩菜', category: '剩菜', days: 1, storageType: 'refrigerated' },
  { name: '熟食', category: '熟食', days: 2, storageType: 'refrigerated' },
] as const

const expiryCategoryOptions = ['乳制品', '水果', '蔬菜', '肉类', '海鲜', '蛋类', '豆制品', '熟食', '剩菜', '主食', '面包', '零食', '饮料', '冷冻食品', '调味品', '其他'] as const

type ExpiryDraft = {
  clientId: string
  foodName: string
  category: string
  customCategory: string
  expireDate: string
  quantityNote: string
  storageType: string
  note: string
  sourceType: 'manual' | 'ai' | string
  confidence?: number | null
  estimated?: boolean
  suggestedDays?: number | null
  recognitionBasis?: string | null
  missingFields?: string[]
}

type ExpiryImageAsset = { uri: string; fileName?: string | null; mimeType?: string | null }

function newExpiryDraft(): ExpiryDraft {
  return {
    clientId: `expiry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    foodName: '',
    category: '乳制品',
    customCategory: '',
    expireDate: dateKeyAfterDays(3),
    quantityNote: '',
    storageType: 'refrigerated',
    note: '',
    sourceType: 'manual',
  }
}

type CampusCanteenSort = 'hot' | 'high_protein' | 'low_calorie' | 'value'

const campusCanteenSortOptions: Array<{ value: CampusCanteenSort; label: string }> = [
  { value: 'hot', label: '热门' },
  { value: 'high_protein', label: '高蛋白' },
  { value: 'low_calorie', label: '低热量' },
  { value: 'value', label: '性价比' },
]

const METABOLIC_MINUTES_PER_DAY = 1440
const METABOLIC_SAMPLE_STEP_MIN = 12
const METABOLIC_ACUTE_BUFFER_MAX_KCAL = 120
const METABOLIC_ACUTE_BUFFER_START_KCAL = 40
const METABOLIC_DIRECT_FAT_FRAC = 0.18

type MetabolicPhase = 'loading' | 'ready' | 'empty' | 'error'

interface MetabolicMealEvent {
  tMin: number
  kcal: number
  carbs: number
  protein: number
  fat: number
}

interface MetabolicPhysiology {
  heightCm: number
  weightKg: number
  age: number
  male: boolean
  pal: number
  bmrMifflin: number
  tdeeKcal: number
  pRatio: number
  refBmrMifflin: number
}

interface MobileMetabolicSimResult {
  absorbPerMin: Float64Array
  outPerMin: Float64Array
  refOutPerMin: Float64Array
  fatStoragePctOfPeakAbsorbPerMin: Float64Array
  fatStorageShareOfAbsorbedPct: number
  acuteSurplusIntegralKcal: number
}

type AssistantFocusCard = Partial<RiskCard> & Record<string, unknown>
type DietRecommendationItem = NonNullable<DietRecommendationResult['recommendations']>[number]

export function AiAssistantScreen() {
  const [range, setRange] = useState<StatsRange>('week')
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [insight, setInsight] = useState<StatsInsightResult | null>(null)
  const [dietRecommendation, setDietRecommendation] = useState<DietRecommendationResult | null>(null)
  const [focusCard, setFocusCard] = useState<AssistantFocusCard | null>(null)
  const [petSummary, setPetSummary] = useState<PetSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, pet] = await Promise.all([
        apiClient.getStatsSummary(range),
        apiClient.getPetSummary().catch(() => null),
      ])
      setSummary(data)
      if (pet) setPetSummary(pet)
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
  const petName = petSummary?.pet?.name || '成长伙伴'
  const petMood = petMoodLabel(petSummary?.status.mood).replace('状态：', '')
  const petState = petStateLabel(petSummary?.status.state)
  const rangeLabel = range === 'month' ? '最近 30 天' : '最近 7 天'
  const calorieDelta = Math.round(summary?.cal_surplus_deficit || 0)
  const macroText = `${Math.round(summary?.total_protein || 0)}g / ${Math.round(summary?.total_carbs || 0)}g / ${Math.round(summary?.total_fat || 0)}g`

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
    <View style={styles.assistantPage}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.assistantContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.assistantTopbar}>
          <View style={styles.assistantRangePill}>
            <AssistantRangeButton label="近一周" active={range === 'week'} onPress={() => setRange('week')} />
            <AssistantRangeButton label="近一月" active={range === 'month'} onPress={() => setRange('month')} />
          </View>
          <Pressable style={styles.assistantRefreshButton} onPress={() => void load()} disabled={loading}>
            {loading ? <ActivityIndicator size="small" color={colors.brandDark} /> : <Text style={styles.assistantRefreshText}>刷新</Text>}
          </Pressable>
        </View>

        <View style={styles.assistantStage}>
          <PetAvatar pet={petSummary?.pet} size="medium" mood={petSummary?.status.mood} state={petSummary?.status.state} />
          <View style={styles.assistantStageBubble}>
            <Text style={styles.assistantStageTitle}>{petName}的 AI 助手</Text>
            <Text style={styles.assistantStageCopy}>
              {rangeLabel}已记录 {recordedDays} 天，{petMood} · {petState}。我会按你保存过的饮食和运动数据给建议，不替代医学诊断。
            </Text>
          </View>
        </View>

        <View style={styles.assistantOverviewCard}>
          <AssistantMetricTile label="日均摄入" value={`${Math.round(summary?.avg_calories_per_day || 0)}`} unit="kcal" />
          <AssistantMetricTile label="TDEE" value={`${Math.round(summary?.tdee || 0)}`} unit="kcal" />
          <AssistantMetricTile label="连续记录" value={`${summary?.streak_days || 0}`} unit="天" />
        </View>

        <View style={styles.assistantSectionCard}>
          <View style={styles.assistantSectionHeader}>
            <View>
              <Text style={styles.assistantSectionTitle}>AI 风险解读</Text>
              <Text style={styles.assistantSectionHint}>摄入差额 {calorieDelta >= 0 ? '+' : ''}{calorieDelta} kcal</Text>
            </View>
            <AssistantActionButton label="生成" loading={loading} onPress={generateInsight} />
          </View>
          <View style={styles.assistantBubble}>
            {insightText ? (
              <InsightMarkdownView text={insightText} />
            ) : (
              <Text style={styles.assistantBodyText}>生成后会显示饮食风险、趋势和执行建议。</Text>
            )}
          </View>
        </View>

        <View style={styles.assistantSectionCard}>
          <View style={styles.assistantSectionHeader}>
            <View>
              <Text style={styles.assistantSectionTitle}>关注卡片</Text>
              <Text style={styles.assistantSectionHint}>蛋白 / 碳水 / 脂肪：{macroText}</Text>
            </View>
          </View>
          <View style={styles.assistantQuickRow}>
            <AssistantChip label="蛋白质" onPress={() => generateFocus('protein')} disabled={loading} />
            <AssistantChip label="热量缺口" onPress={() => generateFocus('calorie_gap')} disabled={loading} />
            <AssistantChip label="饮水" onPress={() => generateFocus('water')} disabled={loading} />
          </View>
          {focusCard ? (
            <AssistantFocusCardView card={focusCard} />
          ) : (
            <Text style={styles.assistantBodyText}>选择一个关注方向后，会生成单项分数、判断依据和行动建议。</Text>
          )}
        </View>

        <View style={styles.assistantSectionCard}>
          <View style={styles.assistantSectionHeader}>
            <View>
              <Text style={styles.assistantSectionTitle}>{dietRecommendation?.title || '饮食建议'}</Text>
              <Text style={styles.assistantSectionHint}>下一餐怎么吃更容易执行</Text>
            </View>
            <AssistantActionButton label="生成" loading={loading} onPress={generateDiet} />
          </View>
          <DietRecommendationView recommendation={dietRecommendation} />
        </View>
      </ScrollView>
    </View>
  )
}

function AssistantRangeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.assistantRangeButton, active && styles.assistantRangeButtonActive]} onPress={onPress}>
      <Text style={[styles.assistantRangeText, active && styles.assistantRangeTextActive]}>{label}</Text>
    </Pressable>
  )
}

function AssistantMetricTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.assistantMetricTile}>
      <Text style={styles.assistantMetricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.assistantMetricUnit}>{unit}</Text>
      <Text style={styles.assistantMetricLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

function AssistantActionButton({ label, loading, onPress }: { label: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.assistantActionButton, loading && styles.assistantActionButtonDisabled]} disabled={loading} onPress={onPress}>
      {loading ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.assistantActionText}>{label}</Text>}
    </Pressable>
  )
}

function AssistantChip({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.assistantChip, disabled && styles.assistantChipDisabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.assistantChipText}>{label}</Text>
    </Pressable>
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
    <View style={styles.assistantFocusCard}>
      <View style={styles.assistantFocusHeader}>
        <View style={styles.assistantFocusTitleWrap}>
          <Text style={styles.assistantFocusTitle}>{title}</Text>
          {brief ? <Text style={styles.assistantBodyText}>{brief}</Text> : null}
        </View>
        {score != null ? (
          <View style={styles.assistantFocusScorePill}>
            <Text style={styles.assistantFocusScore}>{Math.round(score)}分</Text>
          </View>
        ) : null}
      </View>
      {summary ? <Text style={styles.assistantBodyText}>{summary}</Text> : null}
      {basis ? (
        <View style={styles.assistantFocusDetailBlock}>
          <Text style={styles.assistantFocusLabel}>判断依据</Text>
          <Text style={styles.assistantBodyText}>{basis}</Text>
        </View>
      ) : null}
      {action ? (
        <View style={styles.assistantFocusDetailBlock}>
          <Text style={styles.assistantFocusLabel}>行动建议</Text>
          <Text style={styles.assistantBodyText}>{action}</Text>
        </View>
      ) : null}
      {delta != null ? <Text style={styles.assistantFocusDelta}>预计可提升 {Math.round(delta)} 分</Text> : null}
    </View>
  )
}

function DietRecommendationView({ recommendation }: { recommendation: DietRecommendationResult | null }) {
  if (!recommendation) {
    return <Text style={styles.assistantBodyText}>根据今日剩余额度和宏量营养缺口生成下一餐建议。</Text>
  }

  const summaryText = stringValue(recommendation.summary)
  const items = (recommendation.recommendations || []).filter((item) => item && typeof item === 'object')

  if (!summaryText && items.length === 0) {
    return <Text style={styles.assistantBodyText}>已生成饮食建议，当前没有更多细分条目。</Text>
  }

  return (
    <View>
      {summaryText ? <Text style={styles.assistantBodyText}>{summaryText}</Text> : null}
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
    <View style={styles.assistantDietRecommendationItem}>
      <Text style={styles.assistantFocusTitle}>{title}</Text>
      {reason ? <Text style={styles.assistantBodyText}>{reason}</Text> : null}
      {foods.length > 0 ? <Text style={styles.assistantSubtleText}>包含：{foods.join('、')}</Text> : null}
      {metrics.length > 0 ? (
        <View style={styles.assistantNutritionRow}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.assistantNutritionPill}>
              <Text style={styles.assistantNutritionPillText}>{`${metric.label} ${Math.round(metric.value || 0)} ${metric.unit}`}</Text>
            </View>
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

function chinaWallDateKey(date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return todayKey()
  }
}

function metabolicRecordTimeToMinute(recordTime: unknown): { ymd: string; minuteOfDay: number } | null {
  let date: Date
  if (typeof recordTime === 'number' && Number.isFinite(recordTime)) {
    date = new Date(recordTime)
  } else if (typeof recordTime === 'string') {
    const raw = recordTime.trim()
    if (!raw) return null
    date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  } else {
    return null
  }
  if (Number.isNaN(date.getTime())) return null
  try {
    const ymd = chinaWallDateKey(date)
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? NaN)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? NaN)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
    return { ymd, minuteOfDay: hour * 60 + minute }
  } catch {
    const hour = date.getHours()
    const minute = date.getMinutes()
    return { ymd: todayKey(date), minuteOfDay: hour * 60 + minute }
  }
}

function parseMetabolicAge(birthday: string | null | undefined): number {
  if (!birthday) return 30
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday.trim())
  if (!match) return 30
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (![year, month, day].every(Number.isFinite)) return 30
  const born = new Date(year, month - 1, day)
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const monthDelta = now.getMonth() - born.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age -= 1
  return Math.max(18, Math.min(90, age))
}

function isMaleMetabolicGender(gender: string | null | undefined): boolean {
  if (!gender) return true
  const value = String(gender).toLowerCase()
  return value === 'male' || value === 'm' || value === '1' || gender === '男'
}

function metabolicActivityToPal(level: string | null | undefined): number {
  if (!level) return 1.3
  const value = String(level).toLowerCase()
  if (value.includes('久坐') || value.includes('sedentary')) return 1.2
  if (value.includes('走动') || value.includes('light')) return 1.3
  if (value.includes('站立') || value.includes('moderate')) return 1.4
  if (value.includes('体力') || value.includes('active') || value.includes('very')) return 1.55
  return 1.3
}

function metabolicMifflinBmr(weightKg: number, heightCm: number, age: number, male: boolean): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return male ? base + 5 : base - 161
}

function estimateMetabolicBodyFatPercent(bmi: number, age: number, male: boolean): number {
  const bf = 1.2 * bmi + 0.23 * age - (male ? 16.2 : 5.4)
  return Math.max(8, Math.min(45, bf))
}

function metabolicPRatioFromBodyFat(bodyFatPercent: number): number {
  return 2 / (3 * (bodyFatPercent / 100 + 1))
}

function isMetabolicProfileComplete(profile: HealthProfile | null | undefined): boolean {
  if (!profile) return false
  const height = Number(profile.height)
  const weight = Number(profile.weight)
  const bmr = Number(profile.bmr)
  if (!Number.isFinite(height) || height < 50 || height > 250) return false
  if (!Number.isFinite(weight) || weight < 20 || weight > 300) return false
  if (!profile.gender || !String(profile.gender).trim()) return false
  if (!Number.isFinite(bmr) || bmr < 500 || bmr > 8000) return false
  return true
}

function resolveMetabolicPhysiology(profile: HealthProfile): MetabolicPhysiology {
  const heightCm = Number(profile.height) > 0 ? Number(profile.height) : 170
  const weightKg = Number(profile.weight) > 0 ? Number(profile.weight) : 65
  const age = parseMetabolicAge(profile.birthday)
  const male = isMaleMetabolicGender(profile.gender)
  const pal = metabolicActivityToPal(profile.activity_level || profile.daily_life_activity_level)
  const bmrCalc = Math.max(800, metabolicMifflinBmr(weightKg, heightCm, age, male))
  const bmrMifflin = profile.bmr != null && Number(profile.bmr) > 0 ? Number(profile.bmr) : bmrCalc
  const tdeeKcal = profile.tdee != null && Number(profile.tdee) > 0
    ? Number(profile.tdee)
    : Math.max(bmrMifflin * pal, bmrMifflin * 1.2)
  const bmi = weightKg / Math.pow(heightCm / 100, 2)
  const bodyFat = estimateMetabolicBodyFatPercent(bmi, age, male)
  const hM = heightCm / 100
  const refKg = 22 * hM * hM
  return {
    heightCm,
    weightKg,
    age,
    male,
    pal,
    bmrMifflin,
    tdeeKcal,
    pRatio: metabolicPRatioFromBodyFat(bodyFat),
    refBmrMifflin: Math.max(600, metabolicMifflinBmr(refKg, heightCm, age, male)),
  }
}

function parseMetabolicMealTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

function buildMetabolicMealsFromDashboard(dashboard: HomeDashboard | null, dayYmd: string): MetabolicMealEvent[] {
  const meals: MetabolicMealEvent[] = []
  for (const meal of dashboard?.meals || []) {
    const entries = Array.isArray(meal.meal_record_entries)
      ? meal.meal_record_entries.filter((entry) => entry && String(entry.id || '').trim())
      : []
    const mealKcal = Math.max(0, meal.calorie || 0)
    const mealProtein = Math.max(0, meal.protein || 0)
    const mealCarbs = Math.max(0, meal.carbs || 0)
    const mealFat = Math.max(0, meal.fat || 0)

    if (entries.length <= 1) {
      const wall = entries[0]?.record_time ? metabolicRecordTimeToMinute(entries[0].record_time) : null
      const tMin = wall && wall.ymd === dayYmd ? wall.minuteOfDay : meal.time ? parseMetabolicMealTime(String(meal.time)) : null
      if (tMin != null && mealKcal > 0) meals.push({ tMin, kcal: mealKcal, carbs: mealCarbs, protein: mealProtein, fat: mealFat })
      continue
    }

    const validEntries = entries.filter((entry) => (entry.total_calories || 0) > 0)
    const totalEntryKcal = validEntries.reduce((sum, entry) => sum + (entry.total_calories || 0), 0)
    if (totalEntryKcal <= 0 || mealKcal <= 0) {
      const tMin = meal.time ? parseMetabolicMealTime(String(meal.time)) : null
      if (tMin != null && mealKcal > 0) meals.push({ tMin, kcal: mealKcal, carbs: mealCarbs, protein: mealProtein, fat: mealFat })
      continue
    }

    for (const entry of validEntries) {
      const wall = metabolicRecordTimeToMinute(entry.record_time)
      const tMin = wall && wall.ymd === dayYmd ? wall.minuteOfDay : meal.time ? parseMetabolicMealTime(String(meal.time)) : null
      if (tMin == null) continue
      const ratio = (entry.total_calories || 0) / totalEntryKcal
      meals.push({
        tMin,
        kcal: Math.round(mealKcal * ratio),
        carbs: Math.round(mealCarbs * ratio * 10) / 10,
        protein: Math.round(mealProtein * ratio * 10) / 10,
        fat: Math.round(mealFat * ratio * 10) / 10,
      })
    }
  }
  return meals.sort((a, b) => a.tMin - b.tMin)
}

function buildMetabolicMealsFromFoodRecords(records: FoodRecord[], dayYmd: string): MetabolicMealEvent[] {
  const meals: MetabolicMealEvent[] = []
  for (const record of records) {
    const wall = metabolicRecordTimeToMinute(record.record_time)
    if (!wall || wall.ymd !== dayYmd) continue
    let carbs = Math.max(0, record.total_carbs || 0)
    let protein = Math.max(0, record.total_protein || 0)
    let fat = Math.max(0, record.total_fat || 0)
    const kcal = Math.max(0, record.total_calories || 0)
    const macroKcal = 4 * carbs + 4 * protein + 9 * fat
    if (macroKcal > 10 && Math.abs(macroKcal - kcal) > 80 && kcal > 0) {
      const scale = kcal / macroKcal
      carbs *= scale
      protein *= scale
      fat *= scale
    }
    if (macroKcal < 10 && kcal > 0) {
      carbs = kcal / 4
      protein = 0
      fat = 0
    }
    meals.push({ tMin: wall.minuteOfDay, kcal, carbs, protein, fat })
  }
  return meals.sort((a, b) => a.tMin - b.tMin)
}

function normalizedMetabolicKernel(length: number, peakIdx: number, sigma: number): Float64Array {
  const kernel = new Float64Array(length)
  let sum = 0
  for (let i = 0; i < length; i++) {
    const value = Math.exp(-0.5 * Math.pow((i - peakIdx) / sigma, 2))
    kernel[i] = value
    sum += value
  }
  if (sum <= 0) {
    kernel[Math.min(peakIdx, length - 1)] = 1
    return kernel
  }
  for (let i = 0; i < length; i++) kernel[i] /= sum
  return kernel
}

function addMetabolicKernel(target: Float64Array, start: number, amountKcal: number, kernel: Float64Array): void {
  if (amountKcal <= 0) return
  for (let i = 0; i < kernel.length; i++) {
    const index = start + i
    if (index >= 0 && index < METABOLIC_MINUTES_PER_DAY) target[index] += amountKcal * kernel[i]
  }
}

function metabolicCircadianFactor(minute: number): number {
  const hour = Math.floor(minute / 60)
  return hour >= 22 || hour < 6 ? 0.9 : 1
}

function buildMetabolicExercisePerMinute(totalDayKcal: number): Float64Array {
  const exercise = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  if (totalDayKcal <= 0) return exercise
  const start = 6 * 60
  const end = 22 * 60
  const perMinute = totalDayKcal / Math.max(1, end - start)
  for (let minute = start; minute < end; minute++) exercise[minute] = perMinute
  return exercise
}

function maxMetabolicAbsorbKcalPerMin(absorbPerMin: Float64Array): number {
  let peak = 0
  for (let i = 0; i < absorbPerMin.length; i++) {
    const value = absorbPerMin[i] || 0
    if (value > peak) peak = value
  }
  return peak
}

function runMobileMetabolicSimulation(
  meals: MetabolicMealEvent[],
  physiology: MetabolicPhysiology,
  exerciseDayKcal: number,
): MobileMetabolicSimResult {
  const carbKernel = normalizedMetabolicKernel(120, 52, 22)
  const proteinKernel = normalizedMetabolicKernel(240, 105, 42)
  const fatKernel = normalizedMetabolicKernel(380, 145, 65)
  const carbAbs = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  const proteinAbs = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  const fatAbs = new Float64Array(METABOLIC_MINUTES_PER_DAY)

  for (const meal of meals) {
    const start = Math.max(0, Math.min(METABOLIC_MINUTES_PER_DAY - 1, meal.tMin))
    addMetabolicKernel(carbAbs, start, Math.max(0, 4 * meal.carbs), carbKernel)
    addMetabolicKernel(proteinAbs, start, Math.max(0, 4 * meal.protein), proteinKernel)
    addMetabolicKernel(fatAbs, start, Math.max(0, 9 * meal.fat), fatKernel)
  }

  const absorbPerMin = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  const outPerMin = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  const refOutPerMin = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  const exercisePerMin = buildMetabolicExercisePerMinute(exerciseDayKcal)
  const bmrBasePerMin = physiology.bmrMifflin / METABOLIC_MINUTES_PER_DAY
  const refBmrPerMin = physiology.refBmrMifflin / METABOLIC_MINUTES_PER_DAY
  const palFactor = physiology.bmrMifflin > 0 ? physiology.tdeeKcal / physiology.bmrMifflin : physiology.pal

  for (let minute = 0; minute < METABOLIC_MINUTES_PER_DAY; minute++) {
    absorbPerMin[minute] = carbAbs[minute] + proteinAbs[minute] + fatAbs[minute]
    const circadian = metabolicCircadianFactor(minute)
    const tef = 0.25 * proteinAbs[minute]
    outPerMin[minute] = bmrBasePerMin * palFactor * circadian + tef + exercisePerMin[minute]
    refOutPerMin[minute] = refBmrPerMin * 1.2 * circadian
  }

  const fatStorageKcalPerMin = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  let acuteBuffer = METABOLIC_ACUTE_BUFFER_START_KCAL
  let fatStorageKcal = 0
  let acuteSurplusIntegralKcal = 0

  for (let minute = 0; minute < METABOLIC_MINUTES_PER_DAY; minute++) {
    const delta = absorbPerMin[minute] - outPerMin[minute]
    if (delta > 0) {
      acuteSurplusIntegralKcal += delta
      const directFatKcal = delta * METABOLIC_DIRECT_FAT_FRAC * physiology.pRatio
      let fatStorageKcalMinute = directFatKcal
      fatStorageKcal += directFatKcal
      const toBuffer = delta * (1 - METABOLIC_DIRECT_FAT_FRAC)
      const fill = Math.min(toBuffer, Math.max(0, METABOLIC_ACUTE_BUFFER_MAX_KCAL - acuteBuffer))
      acuteBuffer += fill
      const spillFatKcal = (toBuffer - fill) * physiology.pRatio
      fatStorageKcal += spillFatKcal
      fatStorageKcalMinute += spillFatKcal
      fatStorageKcalPerMin[minute] = fatStorageKcalMinute
    } else {
      acuteBuffer -= Math.min(-delta, acuteBuffer)
    }
  }

  let totalAbsorbedKcal = 0
  for (let i = 0; i < absorbPerMin.length; i++) totalAbsorbedKcal += absorbPerMin[i] || 0
  const peakAbsorb = maxMetabolicAbsorbKcalPerMin(absorbPerMin)
  const fatStoragePctOfPeakAbsorbPerMin = new Float64Array(METABOLIC_MINUTES_PER_DAY)
  for (let i = 0; i < fatStorageKcalPerMin.length; i++) {
    fatStoragePctOfPeakAbsorbPerMin[i] = peakAbsorb > 0 ? (fatStorageKcalPerMin[i] / peakAbsorb) * 100 : 0
  }

  return {
    absorbPerMin,
    outPerMin,
    refOutPerMin,
    fatStoragePctOfPeakAbsorbPerMin,
    fatStorageShareOfAbsorbedPct: totalAbsorbedKcal > 0 ? (fatStorageKcal / totalAbsorbedKcal) * 100 : 0,
    acuteSurplusIntegralKcal,
  }
}

function metabolicNowMinuteForDay(dayYmd: string): number {
  if (chinaWallDateKey() !== dayYmd) return METABOLIC_MINUTES_PER_DAY - 1
  const now = new Date()
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
    return hour * 60 + minute
  } catch {
    return now.getHours() * 60 + now.getMinutes()
  }
}

function formatMetabolicOneDecimal(value: number): string {
  return `${Math.round(value * 10) / 10}`
}

function metabolicGenderLabel(gender: string | null | undefined): string {
  if (!gender) return '—'
  const value = String(gender).toLowerCase()
  if (value === 'female' || value === 'f' || gender === '女') return '女'
  if (value === 'male' || value === 'm' || gender === '男') return '男'
  return String(gender)
}

function metabolicPreviewBmr(weightKg: number, heightCm: number, birthday: string, gender: string): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || weightKg <= 0 || heightCm <= 0) return null
  const age = parseMetabolicAge(birthday)
  const bmr = metabolicMifflinBmr(weightKg, heightCm, age, isMaleMetabolicGender(gender))
  return Math.round(Math.max(800, bmr) * 10) / 10
}

function MetabolicMetricCell({
  icon,
  iconTone,
  label,
  value,
  unit,
}: {
  icon: string
  iconTone: string
  label: string
  value: string | number
  unit: string
}) {
  return (
    <View style={styles.metabolicSummaryCell}>
      <View style={styles.metabolicSummaryLabelRow}>
        <Text style={[styles.metabolicSummaryIcon, { color: iconTone }]}>{icon}</Text>
        <Text style={styles.metabolicSummaryLabel} numberOfLines={2}>{label}</Text>
      </View>
      <Text style={styles.metabolicSummaryMetric} numberOfLines={1}>
        {value}
        <Text style={styles.metabolicSummaryUnit}> {unit}</Text>
      </Text>
    </View>
  )
}

function buildMetabolicSvgPath(
  values: Array<[number, number]>,
  maxValue: number,
  plot: { left: number; top: number; width: number; height: number },
): string {
  if (!values.length || maxValue <= 0) return ''
  return values.map(([minute, value], index) => {
    const x = plot.left + (Math.max(0, Math.min(METABOLIC_MINUTES_PER_DAY - 1, minute)) / (METABOLIC_MINUTES_PER_DAY - 1)) * plot.width
    const y = plot.top + plot.height - (Math.max(0, Math.min(maxValue, value)) / maxValue) * plot.height
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

function sampleMetabolicPairs(source: Float64Array, step = METABOLIC_SAMPLE_STEP_MIN): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let minute = 0; minute < source.length; minute += step) points.push([minute, source[minute] || 0])
  if (points[points.length - 1]?.[0] !== METABOLIC_MINUTES_PER_DAY - 1) {
    points.push([METABOLIC_MINUTES_PER_DAY - 1, source[METABOLIC_MINUTES_PER_DAY - 1] || 0])
  }
  return points
}

function MetabolicChart({ sim, nowMinute }: { sim: MobileMetabolicSimResult | null; nowMinute: number }) {
  const plot = { left: 30, top: 18, width: 258, height: 168 }
  const absorb = sim ? sampleMetabolicPairs(sim.absorbPerMin) : []
  const out = sim ? sampleMetabolicPairs(sim.outPerMin) : []
  const ref = sim ? sampleMetabolicPairs(sim.refOutPerMin) : []
  const fat = sim ? sampleMetabolicPairs(sim.fatStoragePctOfPeakAbsorbPerMin) : []
  const leftMax = Math.max(0.35, ...absorb.map(([, value]) => value), ...out.map(([, value]) => value), ...ref.map(([, value]) => value)) * 1.12
  const rightMax = Math.max(5, ...fat.map(([, value]) => value)) * 1.18
  const nowX = plot.left + (Math.max(0, Math.min(METABOLIC_MINUTES_PER_DAY - 1, nowMinute)) / (METABOLIC_MINUTES_PER_DAY - 1)) * plot.width
  const absorbPath = buildMetabolicSvgPath(absorb, leftMax, plot)
  const outPath = buildMetabolicSvgPath(out, leftMax, plot)
  const refPath = buildMetabolicSvgPath(ref, leftMax, plot)
  const fatPath = buildMetabolicSvgPath(fat, rightMax, plot)

  return (
    <View style={styles.metabolicChartWrap}>
      <Svg width="100%" height="100%" viewBox="0 0 320 220" preserveAspectRatio="none">
        <SvgRect x={0} y={0} width={320} height={220} rx={16} fill="#f8fafc" opacity={0.9} />
        {[0, 1, 2, 3].map((line) => {
          const y = plot.top + (plot.height / 3) * line
          return <SvgLine key={`h-${line}`} x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} stroke="rgba(15, 23, 42, 0.06)" strokeWidth={1} />
        })}
        {[0, 1, 2, 3, 4].map((line) => {
          const x = plot.left + (plot.width / 4) * line
          return <SvgLine key={`v-${line}`} x1={x} x2={x} y1={plot.top} y2={plot.top + plot.height} stroke="rgba(15, 23, 42, 0.04)" strokeWidth={1} />
        })}
        <SvgLine x1={nowX} x2={nowX} y1={plot.top} y2={plot.top + plot.height} stroke="rgba(92, 184, 150, 0.55)" strokeWidth={1.2} />
        {refPath ? <SvgPath d={refPath} fill="none" stroke="rgba(100, 116, 139, 0.62)" strokeWidth={1.35} strokeDasharray="5 5" /> : null}
        {absorbPath ? <SvgPath d={absorbPath} fill="none" stroke="#5cb896" strokeWidth={2.4} /> : null}
        {outPath ? <SvgPath d={outPath} fill="none" stroke="#5c9ed4" strokeWidth={2.4} /> : null}
        {fatPath ? <SvgPath d={fatPath} fill="none" stroke="#e57373" strokeWidth={2} /> : null}
      </Svg>
    </View>
  )
}

function MetabolicLegend() {
  const items = [
    { label: '吸收', style: styles.metabolicLegendDotAbsorb },
    { label: '消耗', style: styles.metabolicLegendDotBurn },
    { label: '参考', style: styles.metabolicLegendDotRef },
    { label: '转脂占峰值吸收', style: styles.metabolicLegendDotFat },
  ]
  return (
    <View style={styles.metabolicLegendRow}>
      {items.map((item) => (
        <View key={item.label} style={styles.metabolicLegendItem}>
          <View style={[styles.metabolicLegendDot, item.style]} />
          <Text style={styles.metabolicLegendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  )
}

function MetabolicPhysiologySheet({
  open,
  onClose,
  physiology,
  profile,
}: {
  open: boolean
  onClose: () => void
  physiology: MetabolicPhysiology | null
  profile: HealthProfile | null
}) {
  if (!physiology || !profile) return null
  const rows = [
    { label: '性别', value: metabolicGenderLabel(profile.gender) },
    { label: '身高', value: `${formatMetabolicOneDecimal(physiology.heightCm)} cm` },
    { label: '体重', value: `${formatMetabolicOneDecimal(physiology.weightKg)} kg` },
    { label: '年龄', value: `${physiology.age} 岁` },
    { label: 'BMR', value: `${formatMetabolicOneDecimal(physiology.bmrMifflin)} kcal/日` },
    { label: '日常消耗', value: `${formatMetabolicOneDecimal(physiology.tdeeKcal)} kcal/日` },
    { label: '日常活动系数', value: formatMetabolicOneDecimal(physiology.pal) },
  ]
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.metabolicModalBackdrop} onPress={onClose}>
        <Pressable style={styles.metabolicPhysSheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.metabolicSheetTitle}>模拟所用基础数据</Text>
          <Text style={styles.metabolicSheetDesc}>与当日示意模型一致；BMR 为档案基础代谢，日常消耗只包含非运动生活活动。</Text>
          {rows.map((row) => (
            <View key={row.label} style={styles.metabolicPhysRow}>
              <Text style={styles.metabolicPhysLabel}>{row.label}</Text>
              <Text style={styles.metabolicPhysValue}>{row.value}</Text>
            </View>
          ))}
          <Pressable style={styles.metabolicSheetPrimaryButton} onPress={onClose}>
            <Text style={styles.metabolicSheetPrimaryText}>知道了</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function MetabolicProfileSheetModal({
  open,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean
  profile: HealthProfile | null
  onClose: () => void
  onSaved: (profile: HealthProfile) => void
}) {
  const [gender, setGender] = useState('male')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [birthday, setBirthday] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setGender(profile?.gender ? String(profile.gender) : 'male')
    setHeight(profile?.height != null ? String(Math.round(Number(profile.height) * 10) / 10) : '')
    setWeight(profile?.weight != null ? String(Math.round(Number(profile.weight) * 10) / 10) : '')
    setBirthday(profile?.birthday ? String(profile.birthday).slice(0, 10) : '')
  }, [open, profile])

  const preview = metabolicPreviewBmr(Number(weight), Number(height), birthday, gender)

  const save = async () => {
    const heightNum = Number(height)
    const weightNum = Number(weight)
    if (!Number.isFinite(heightNum) || heightNum < 50 || heightNum > 250) {
      Alert.alert('请填写身高', '身高需要在 50-250 cm 之间。')
      return
    }
    if (!Number.isFinite(weightNum) || weightNum < 20 || weightNum > 300) {
      Alert.alert('请填写体重', '体重需要在 20-300 kg 之间。')
      return
    }
    setSubmitting(true)
    try {
      const next = await apiClient.updateHealthProfile({
        gender,
        height: heightNum,
        weight: weightNum,
        birthday: birthday.trim() || undefined,
      })
      onSaved(next)
      onClose()
    } catch (error) {
      showError('保存代谢档案失败', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.metabolicModalBackdrop} onPress={onClose}>
        <Pressable style={styles.metabolicProfileSheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.metabolicSheetTitle}>完善代谢档案</Text>
          <Text style={styles.metabolicSheetDesc}>模拟需要身高、体重、性别与基础代谢（BMR）。保存后将写入云端健康档案。</Text>

          <View style={styles.metabolicSheetField}>
            <Text style={styles.metabolicSheetLabel}>性别</Text>
            <View style={styles.metabolicGenderRow}>
              {[
                { value: 'male', label: '男' },
                { value: 'female', label: '女' },
              ].map((item) => {
                const active = gender === item.value
                return (
                  <Pressable
                    key={item.value}
                    style={[styles.metabolicGenderButton, active && styles.metabolicGenderButtonActive]}
                    onPress={() => setGender(item.value)}
                  >
                    <Text style={[styles.metabolicGenderButtonText, active && styles.metabolicGenderButtonTextActive]}>{item.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          <MetabolicProfileField label="身高（cm）" value={height} onChangeText={setHeight} placeholder="例如 170" keyboardType="numeric" />
          <MetabolicProfileField label="体重（kg）" value={weight} onChangeText={setWeight} placeholder="例如 65" keyboardType="numeric" />
          <MetabolicProfileField label="生日（用于 BMR 与档案）" value={birthday} onChangeText={setBirthday} placeholder="YYYY-MM-DD" />
          <Text style={styles.metabolicSheetHint}>服务端会据此计算档案；离线时用 Mifflin 公式估算 BMR 预览。</Text>

          {preview != null ? (
            <View style={styles.metabolicBmrPreview}>
              <Text style={styles.metabolicBmrPreviewText}>估算 BMR 约 {preview} kcal/天（保存后以服务端为准）</Text>
            </View>
          ) : null}

          <View style={styles.metabolicSheetActions}>
            <Pressable style={styles.metabolicSheetGhostButton} onPress={onClose} disabled={submitting}>
              <Text style={styles.metabolicSheetGhostText}>取消</Text>
            </Pressable>
            <Pressable style={styles.metabolicSheetPrimaryButton} onPress={() => void save()} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.metabolicSheetPrimaryText}>保存</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function MetabolicProfileField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder: string
  keyboardType?: KeyboardTypeOptions
}) {
  return (
    <View style={styles.metabolicSheetField}>
      <Text style={styles.metabolicSheetLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType={keyboardType}
        style={styles.metabolicSheetInput}
      />
    </View>
  )
}

export function StatsMetabolicScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [phase, setPhase] = useState<MetabolicPhase>('loading')
  const [sim, setSim] = useState<MobileMetabolicSimResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)
  const [physiologySheetOpen, setPhysiologySheetOpen] = useState(false)
  const reportDate = useMemo(() => chinaWallDateKey(), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPhase('loading')
      const healthProfile = await apiClient.getHealthProfile().catch(() => null)
      setProfile(healthProfile)
      if (!healthProfile || !isMetabolicProfileComplete(healthProfile)) {
        setSim(null)
        setPhase('empty')
        return
      }

      const [dashboard, foodRecords, exerciseData] = await Promise.all([
        apiClient.getHomeDashboard(reportDate).catch(() => null),
        apiClient.getFoodRecordList(reportDate).catch(() => ({ records: [] })),
        apiClient.getExerciseLogs({ date: reportDate }).catch(() => ({ logs: [], total_calories: 0, count: 0 })),
      ])
      const dashboardMeals = buildMetabolicMealsFromDashboard(dashboard, reportDate)
      const fallbackMeals = buildMetabolicMealsFromFoodRecords(foodRecords.records || [], reportDate)
      const meals = dashboardMeals.length > 0 ? dashboardMeals : fallbackMeals
      if (meals.length === 0) {
        setSim(null)
        setPhase('empty')
        return
      }
      const exerciseKcal = dashboard?.exerciseBurnedKcal != null
        ? Math.max(0, Number(dashboard.exerciseBurnedKcal) || 0)
        : Math.max(0, Number(exerciseData.total_calories) || 0)
      const result = runMobileMetabolicSimulation(meals, resolveMetabolicPhysiology(healthProfile), exerciseKcal)
      setSim(result)
      setPhase('ready')
    } catch (error) {
      showError('获取代谢分析失败', error)
      setPhase('error')
    } finally {
      setLoading(false)
    }
  }, [reportDate])

  useEffect(() => {
    void load()
  }, [load])

  const profileComplete = isMetabolicProfileComplete(profile)
  const physiology = profile && profileComplete ? resolveMetabolicPhysiology(profile) : null
  const summaryFatStorageSharePct = sim ? Math.round(sim.fatStorageShareOfAbsorbedPct * 10) / 10 : 0
  const summaryAcuteSurplusKcal = sim ? Math.round(sim.acuteSurplusIntegralKcal) : 0
  const summaryPeakAbsorbKcalPerMin = sim ? Math.round(maxMetabolicAbsorbKcalPerMin(sim.absorbPerMin) * 10) / 10 : 0
  const nowMinute = metabolicNowMinuteForDay(reportDate)

  const renderGate = () => (
    <View style={styles.metabolicGateBody}>
      <View style={styles.metabolicGhostLayer}>
        <View style={styles.metabolicSummaryRow}>
          {[0, 1, 2].map((index) => <View key={index} style={styles.metabolicGhostCell} />)}
        </View>
        <View style={styles.metabolicGhostChart} />
        <View style={styles.metabolicGhostLegendRow}>
          {[0, 1, 2].map((index) => <View key={index} style={styles.metabolicGhostLegendPill} />)}
        </View>
      </View>
      <Pressable style={styles.metabolicGateMask} onPress={() => setProfileSheetOpen(true)}>
        <Text style={styles.metabolicGateTitle}>档案未完善</Text>
        <Text style={styles.metabolicGateDesc}>请先填写身高、体重、性别与基础代谢（BMR），保存至云端后即可查看代谢示意。</Text>
        <Text style={styles.metabolicGateCta}>点击填写</Text>
      </Pressable>
    </View>
  )

  return (
    <View style={styles.metabolicPage}>
      <ScrollView
        style={styles.metabolicScroll}
        contentContainerStyle={[
          styles.metabolicContent,
          { paddingTop: Math.max(insets.top + 20, 44), paddingBottom: Math.max(insets.bottom + 36, 72) },
        ]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.brand} colors={[colors.brand]} />}
      >
        <View style={styles.metabolicHead}>
          <View style={styles.metabolicHeadRow}>
            <Pressable style={styles.metabolicBackButton} onPress={() => navigation.goBack()}>
              <ChevronLeft size={22} color="#5cb896" strokeWidth={2.4} />
            </Pressable>
            <View style={styles.metabolicTitleRow}>
              <Flame size={21} color="#5cb896" strokeWidth={2.4} />
              <Text style={styles.metabolicTitle}>当日代谢</Text>
            </View>
            {physiology ? (
              <Pressable style={styles.metabolicPhysButton} onPress={() => setPhysiologySheetOpen(true)}>
                <UserRound size={15} color="#5cb896" strokeWidth={2.3} />
                <Text style={styles.metabolicPhysButtonText}>用户基础数据</Text>
              </Pressable>
            ) : (
              <View style={styles.metabolicHeadSpacer} />
            )}
          </View>
        </View>

        {!profileComplete ? (
          renderGate()
        ) : (
          <>
            {sim && phase === 'ready' ? (
              <View style={styles.metabolicSummaryRow}>
                <MetabolicMetricCell icon="脂" iconTone="#e57373" label="吸收转脂占比" value={summaryFatStorageSharePct} unit="%" />
                <MetabolicMetricCell icon="热" iconTone="#5cb896" label="餐后净盈余" value={summaryAcuteSurplusKcal} unit="kcal" />
                <MetabolicMetricCell icon="峰" iconTone="#5cb896" label="吸收功率峰值" value={summaryPeakAbsorbKcalPerMin} unit="kcal/分" />
              </View>
            ) : null}

            {phase === 'loading' && !sim ? (
              <View style={styles.metabolicLoadingBox}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : null}

            {phase === 'error' ? (
              <View style={styles.metabolicErrorBox}>
                <Pressable style={styles.metabolicRetryButton} onPress={() => void load()}>
                  <Text style={styles.metabolicRetryText}>重试</Text>
                </Pressable>
              </View>
            ) : null}

            <MetabolicChart sim={sim} nowMinute={nowMinute} />

            {sim ? (
              <>
                <MetabolicLegend />
                <View style={styles.metabolicFatExplainer}>
                  <Text style={styles.metabolicFatExplainerTitle}>红线口径</Text>
                  <Text style={styles.metabolicFatExplainerBody}>
                    红线表示每分钟被模型判定为转向脂肪堆积的能量，占“当天吸收峰值”的百分比；不再直接显示脂肪累计克数。
                  </Text>
                </View>
                <View style={styles.metabolicDisclaimer}>
                  <Info size={14} color="#5cb896" strokeWidth={2.2} />
                  <Text style={styles.metabolicDisclaimerText}>实验性质，仅供参考，无医学指导作用</Text>
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <MetabolicProfileSheetModal
        open={profileSheetOpen}
        profile={profile}
        onClose={() => setProfileSheetOpen(false)}
        onSaved={(next) => {
          setProfile(next)
          void load()
        }}
      />
      <MetabolicPhysiologySheet
        open={physiologySheetOpen}
        onClose={() => setPhysiologySheetOpen(false)}
        physiology={physiology}
        profile={profile}
      />
    </View>
  )
}

export function TrendDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'TrendDetail'>>()
  const targetDate = useMemo(() => normalizeTrendRouteDate(route.params.date), [route.params.date])
  const [summary, setSummary] = useState<BodyMetricsSummary | null>(null)
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLogItem[]>([])
  const [selectedWaterDate, setSelectedWaterDate] = useState(targetDate)
  const [mutatingId, setMutatingId] = useState('')
  const [loading, setLoading] = useState(false)
  const kind = route.params.kind
  const title = kind === 'weight' ? '体重趋势' : kind === 'water' ? '饮水趋势' : '运动趋势'
  const rangeEndDate = todayKey()
  const dates = useMemo(() => buildTrendDateRange(30, rangeEndDate), [rangeEndDate])

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

  useEffect(() => {
    if (kind === 'water') setSelectedWaterDate(targetDate)
  }, [kind, targetDate])

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
      emitHomeDashboardRefreshEvent({ date: entry.date, force: true })
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
      emitHomeDashboardRefreshEvent({ date: log.date || selectedWaterDate, force: true })
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
      emitHomeDashboardRefreshEvent({ date: trendExerciseDate(log), force: true })
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

  const theme = getTrendTheme(kind)
  const heroValue = kind === 'weight'
    ? formatTrendWeight(latestWeight?.value)
    : kind === 'water'
      ? String(waterGoal)
      : String(Math.round(exerciseTotal))
  const heroUnit = kind === 'weight' ? 'kg' : kind === 'water' ? 'ml目标' : 'kcal'
  const summaryCards = kind === 'weight'
    ? [
      { label: '较上次', value: formatTrendSigned(weightChange, 1), tone: Number(weightChange) > 0 ? 'up' : Number(weightChange) < 0 ? 'down' : undefined },
      { label: '记录次数', value: String(summary?.weight_entries?.length || 0) },
    ]
    : kind === 'water'
      ? [
        { label: '日均喝水', value: String(Math.round(summary?.avg_daily_water_ml || 0)) },
        { label: '记录天数', value: String(summary?.water_recorded_days || 0) },
      ]
      : [
        { label: '活跃天数', value: String(exerciseActiveDays) },
        { label: '记录次数', value: String(exerciseLogs.length) },
        { label: '活跃日均', value: String(Math.round(exerciseAvgActive)) },
      ]

  return (
    <View style={[styles.trendRoot, { backgroundColor: theme.page }]}>
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinearGradient id="trendBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.accent} stopOpacity={0.1} />
            <Stop offset="1" stopColor={theme.page} stopOpacity={1} />
          </SvgLinearGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#trendBg)" />
      </Svg>
      <ScrollView
        style={styles.trendPage}
        contentContainerStyle={styles.trendContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.accent} colors={[theme.accent]} />}
      >
      <View style={styles.trendMiniHero}>
        <View style={styles.flex}>
          <Text style={[styles.trendMiniKicker, { color: theme.deep }]}>{targetDate}</Text>
          <Text style={styles.trendMiniTitle}>{title}</Text>
        </View>
        <View style={styles.trendMiniHeroValueWrap}>
          <Text
            style={[
              styles.trendMiniHeroValue,
              kind === 'water' && styles.trendMiniHeroValueWater,
              kind === 'exercise' && styles.trendMiniHeroValueExercise,
            ]}
          >
            {heroValue}
          </Text>
          <Text style={styles.trendMiniHeroUnit}>{heroUnit}</Text>
        </View>
      </View>

      <View style={styles.trendSummaryGrid}>
        {summaryCards.map((item) => (
          <View key={item.label} style={[styles.trendSummaryCard, kind === 'exercise' && styles.trendSummaryCardExercise]}>
            <Text style={styles.trendSummaryLabel}>{item.label}</Text>
            <Text
              style={[
                styles.trendSummaryValue,
                item.tone === 'up' && styles.trendSummaryValueUp,
                item.tone === 'down' && styles.trendSummaryValueDown,
              ]}
            >
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      {kind === 'weight' ? (
        <>
          <View style={styles.trendMiniCard}>
            <View style={styles.trendSectionTitleRow}>
              <Text style={styles.trendSectionTitle}>近 30 天趋势</Text>
              {loading ? <ActivityIndicator size="small" color={theme.accent} /> : null}
            </View>
            <TrendLineChart points={weightPoints} accent={theme.accent} emptyText="近 30 天还没有可展示的体重趋势" />
            <Text style={styles.trendCardNote}>有体重数据的自然日：{weightRecordedDays} 天</Text>
          </View>

          <View style={styles.trendMiniCard}>
            <Text style={styles.trendSectionTitle}>历史记录</Text>
            {weightGroups.length === 0 ? <Text style={styles.trendHistoryEmpty}>还没有体重记录</Text> : null}
            {weightGroups.map((group) => (
              <View key={group.key} style={styles.weightTrendMonthGroup}>
                <View style={styles.weightTrendMonthHeader}>
                  <Text style={styles.weightTrendMonthTitle}>{group.label}</Text>
                  <Text style={styles.weightTrendMonthMeta}>总变化 {formatTrendSigned(group.totalChange, 1)}kg</Text>
                </View>
                {group.items.map((entry) => {
                  const isDeleting = Boolean(entry.id && mutatingId === entry.id)
                  return (
                    <View key={`${entry.id || entry.date}-${entry.recorded_at || entry.value}`} style={[styles.weightTrendHistoryRow, isDeleting && styles.trendRowMuted]}>
                      <View style={styles.flex}>
                        <Text style={styles.weightTrendDate}>{formatTrendMonthDay(entry.date)}</Text>
                        <Text style={styles.weightTrendDelta}>{formatTrendSigned(entry.delta, 1)}kg</Text>
                      </View>
                      <View style={styles.weightTrendHistorySide}>
                        <Text style={styles.weightTrendValue}>{formatTrendWeight(entry.value)}kg</Text>
                        <Pressable
                          style={styles.trendDeletePill}
                          disabled={isDeleting}
                          onPress={() => confirmDeleteWeight(entry)}
                        >
                          {isDeleting ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={styles.trendDeleteText}>删除</Text>}
                        </Pressable>
                      </View>
                    </View>
                  )
                })}
              </View>
            ))}
          </View>
        </>
      ) : null}

      {kind === 'water' ? (
        <>
          <View style={styles.trendMiniCard}>
            <View style={styles.trendSectionTitleRow}>
              <Text style={styles.trendSectionTitle}>近 30 天热力</Text>
              {loading ? <ActivityIndicator size="small" color={theme.accent} /> : null}
            </View>
            <TrendHeatmap
              points={waterPoints}
              maxValue={Math.max(waterGoal, ...waterPoints.map((item) => item.value || 0), 1)}
              selectedDate={selectedWaterDate}
              onSelect={setSelectedWaterDate}
              variant="water"
            />
            <Text style={styles.trendCardNote}>浅色表示少量记录，深色表示接近或达到目标</Text>
          </View>

          <View style={styles.trendMiniCard}>
            <View style={styles.trendSectionTitleRow}>
              <Text style={styles.trendSectionTitle}>最近喝水</Text>
              {selectedWaterDay ? <Text style={[styles.trendSelectedDate, { color: theme.deep, backgroundColor: theme.soft }]}>{formatTrendMonthDay(selectedWaterDate)}</Text> : null}
            </View>
            {recentWaterDays.length === 0 ? <Text style={styles.trendHistoryEmpty}>还没有喝水记录</Text> : null}
            {recentWaterDays.map((day) => (
              <Pressable
                key={day.date}
                style={[styles.waterTrendHistoryRow, selectedWaterDate === day.date && styles.waterTrendHistoryRowSelected]}
                onPress={() => setSelectedWaterDate(day.date)}
              >
                <Text style={styles.waterTrendDate}>{formatTrendMonthDay(day.date)}</Text>
                <Text style={styles.waterTrendMain}>{Math.round(day.total || 0)} ml</Text>
                <Text style={styles.waterTrendSub}>{getTrendWaterLogItems(day).length} 次</Text>
              </Pressable>
            ))}
            {selectedWaterLogs.length > 0 ? (
              <View style={styles.waterTrendDayDetail}>
                <Text style={styles.waterTrendDetailTitle}>{formatTrendMonthDay(selectedWaterDate)} 明细</Text>
                {selectedWaterLogs.map((log, index) => {
                  const logKey = log.id || `${log.date}-${index}-${log.amount_ml}`
                  const isDeleting = Boolean(log.id && mutatingId === log.id)
                  return (
                    <View key={logKey} style={[styles.waterTrendDetailRow, isDeleting && styles.trendRowMuted]}>
                      <Text style={styles.waterTrendDetailAmount}>+{Math.round(log.amount_ml || 0)} ml</Text>
                      <Pressable
                        style={styles.trendDeletePill}
                        disabled={isDeleting}
                        onPress={() => confirmDeleteWater(log)}
                      >
                        {isDeleting ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={styles.trendDeleteText}>{log.id ? '删除' : '仅记录页清空'}</Text>}
                      </Pressable>
                    </View>
                  )
                })}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {kind === 'exercise' ? (
        <>
          <View style={styles.trendMiniCard}>
            <View style={styles.trendSectionTitleRow}>
              <Text style={styles.trendSectionTitle}>近 30 天活跃</Text>
              {loading ? <ActivityIndicator size="small" color={theme.accent} /> : null}
            </View>
            <TrendHeatmap
              points={exerciseDays}
              maxValue={Math.max(...exerciseDays.map((item) => item.value || 0), 1)}
              variant="exercise"
            />
            <Text style={styles.trendCardNote}>深色表示当天运动消耗更高</Text>
          </View>

          <View style={styles.trendMiniCard}>
            <Text style={styles.trendSectionTitle}>最近运动</Text>
            {recentExerciseLogs.length === 0 ? <Text style={styles.trendHistoryEmpty}>还没有运动记录</Text> : null}
            {recentExerciseLogs.map((log) => {
              const isDeleting = Boolean(log.id && mutatingId === log.id)
              return (
                <View key={log.id || `${trendExerciseDate(log)}-${trendExerciseTitle(log)}`} style={[styles.exerciseTrendHistoryRow, isDeleting && styles.trendRowMuted]}>
                  <View style={styles.flex}>
                    <Text style={styles.exerciseTrendTitle} numberOfLines={2}>{trendExerciseTitle(log)}</Text>
                    <Text style={styles.exerciseTrendDate}>{formatTrendMonthDay(trendExerciseDate(log))} · {Math.round(log.duration_min || 0)} 分钟</Text>
                    {log.ai_reasoning ? <Text style={styles.exerciseTrendReason} numberOfLines={2}>{log.ai_reasoning}</Text> : null}
                  </View>
                  <View style={styles.exerciseTrendSide}>
                    <Text style={[styles.exerciseTrendKcal, { color: theme.accent }]}>{Math.round(log.calories_burned || 0)} kcal</Text>
                    <Pressable
                      style={styles.trendDeletePill}
                      disabled={isDeleting}
                      onPress={() => confirmDeleteExercise(log)}
                    >
                      {isDeleting ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={styles.trendDeleteText}>删除</Text>}
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </View>
        </>
      ) : null}
      </ScrollView>
    </View>
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

  const insets = useSafeAreaInsets()
  const captureSlots = [
    { label: '正面包装', hint: '品牌、品名、口味' },
    { label: '营养成分表', hint: '能量、蛋白质、脂肪' },
    { label: '净含量/配料', hint: '看不清时补拍' },
  ] as const
  const productInfoFields = [
    { label: '商品名称', value: productName, onChangeText: setProductName, placeholder: '例如 玉米薄脆' },
    { label: '展示名称', value: displayName, onChangeText: setDisplayName, placeholder: '可不填' },
    { label: '品牌', value: brand, onChangeText: setBrand, placeholder: '品牌名' },
    { label: '口味', value: flavorText, onChangeText: setFlavorText, placeholder: '麻辣 / 原味' },
    { label: '品类', value: packageCategory, onChangeText: setPackageCategory, placeholder: '饼干 / 膨化食品' },
    { label: '规格', value: specText, onChangeText: setSpecText, placeholder: '25g*4袋' },
    { label: '条形码', value: barcode, onChangeText: setBarcode, placeholder: '可选' },
    { label: '净含量 g', value: netWeightG, onChangeText: setNetWeightG, keyboardType: 'decimal-pad' },
    { label: '每份重量 g', value: servingWeightG, onChangeText: setServingWeightG, keyboardType: 'decimal-pad' },
  ] as const
  const mainNutritionFields = [
    { label: '热量 kcal', value: calories, onChangeText: setCalories },
    { label: '蛋白质 g', value: protein, onChangeText: setProtein },
    { label: '碳水 g', value: carbs, onChangeText: setCarbs },
    { label: '脂肪 g', value: fat, onChangeText: setFat },
    { label: '膳食纤维 g', value: fiber, onChangeText: setFiber },
    { label: '糖 g', value: sugar, onChangeText: setSugar },
    { label: '钠 mg', value: sodiumMg, onChangeText: setSodiumMg },
  ] as const
  const extraNutritionFields = [
    { label: '饱和脂肪 g', value: saturatedFat, onChangeText: setSaturatedFat },
    { label: '胆固醇 mg', value: cholesterolMg, onChangeText: setCholesterolMg },
    { label: '钾 mg', value: potassiumMg, onChangeText: setPotassiumMg },
    { label: '钙 mg', value: calciumMg, onChangeText: setCalciumMg },
    { label: '铁 mg', value: ironMg, onChangeText: setIronMg },
  ] as const
  const canSavePackaged = Boolean(productName.trim() && imageUrls.length && numberOrUndefined(netWeightG))
  const extractBannerNeedsReview = Boolean(autoIngest && autoIngest.status !== 'ingested')

  return (
    <View style={styles.packagedMiniRoot}>
      <ScrollView
        style={styles.packagedMiniRoot}
        contentContainerStyle={[styles.packagedMiniContent, { paddingTop: Math.max(insets.top + 8, 16), paddingBottom: insets.bottom + 118 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.packagedEditHero}>
          <Text style={styles.packagedEditKicker}>零食上传</Text>
          <Text style={styles.packagedEditTitle}>预包装零食补库</Text>
          <Text style={styles.packagedEditSubtitle}>一组商品最多 3 张图。先查重，再上传正面、营养表和必要细节，识别后核对入库。</Text>
        </View>

        <PackagedSection>
          <View style={styles.packagedSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.packagedSectionTitle}>拍摄示例</Text>
              <Text style={styles.packagedSectionSubtitle}>同一种商品一组照片，信息越集中越好。</Text>
            </View>
            <PackagedMiniPill text="推荐 2 张" tone="green" />
          </View>
          <View style={styles.packagedShootCaseList}>
            <View style={styles.packagedShootCaseCard}>
              <View style={styles.packagedShootCaseCount}>
                <Text style={styles.packagedShootCaseNumber}>1</Text>
                <Text style={styles.packagedShootCaseUnit}>张</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.packagedShootCaseTitle}>一张能拍全</Text>
                <Text style={styles.packagedShootCaseText}>小包装或盒装侧面信息集中时，一张图拍清品名、净含量和营养表。</Text>
              </View>
            </View>
            <View style={[styles.packagedShootCaseCard, styles.packagedShootCaseCardActive]}>
              <View style={styles.packagedShootCaseCount}>
                <Text style={styles.packagedShootCaseNumber}>2</Text>
                <Text style={styles.packagedShootCaseUnit}>张</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.packagedShootCaseTitle}>最常用</Text>
                <Text style={styles.packagedShootCaseText}>正面拍品牌、品名、口味；营养表拍能量、蛋白质、脂肪、碳水和钠。</Text>
              </View>
            </View>
            <View style={styles.packagedShootCaseCard}>
              <View style={styles.packagedShootCaseCount}>
                <Text style={styles.packagedShootCaseNumber}>3</Text>
                <Text style={styles.packagedShootCaseUnit}>张</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.packagedShootCaseTitle}>补拍细节</Text>
                <Text style={styles.packagedShootCaseText}>大包装、弯曲或字体小，只补拍看不清的局部，不混入另一种商品。</Text>
              </View>
            </View>
          </View>
          <View style={styles.packagedWarningCard}>
            <Text style={styles.packagedWarningText}>请先搜索零食库。若同品牌、同品名、同规格或同净含量已经存在，就不需要重复上传。</Text>
          </View>
        </PackagedSection>

        <PackagedSection>
          <View style={styles.packagedSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.packagedSectionTitle}>先搜零食库</Text>
              <Text style={styles.packagedSectionSubtitle}>品牌、品名、口味或条形码都可以搜。</Text>
            </View>
            <PackagedMiniPill text="避免重复" />
          </View>
          <View style={styles.packagedSearchRow}>
            <TextInput
              value={librarySearchQuery}
              onChangeText={setLibrarySearchQuery}
              placeholder="例如 玉米薄脆 麻辣味"
              placeholderTextColor="#94a3b8"
              style={styles.packagedSearchInput}
              returnKeyType="search"
              onSubmitEditing={searchPackagedLibrary}
            />
            <View style={styles.packagedSearchButton}>
              <PackagedActionButton label="搜索" loading={librarySearchLoading} onPress={searchPackagedLibrary} />
            </View>
          </View>
          {librarySearchResults.length ? (
            <View style={styles.packagedSearchResults}>
              <Text style={styles.packagedSectionSubtitle}>找到 {librarySearchResults.length} 个包装食品结果，确认同款后不用再上传。</Text>
              {librarySearchResults.map((item, index) => (
                <Pressable key={(item.source || 'packaged') + '-' + (item.id || index)} onPress={() => navigation.navigate('FoodLibraryDetail', { item })}>
                  <View style={styles.packagedSearchItem}>
                    {item.image_path ? (
                      <Image source={{ uri: item.image_path }} style={styles.packagedSearchImage} />
                    ) : (
                      <View style={styles.packagedSearchImageFallback}>
                        <Text style={styles.packagedSearchImageText}>食</Text>
                      </View>
                    )}
                    <View style={styles.flex}>
                      <Text style={styles.itemName} numberOfLines={1}>{manualFoodTitle(item)}</Text>
                      <Text style={styles.subtitle} numberOfLines={1}>{packagedSearchSubtitle(item)}</Text>
                      <Text style={styles.itemMeta} numberOfLines={1}>{packagedSearchNutrition(item)}</Text>
                    </View>
                    <PackagedMiniPill text="已收录" tone="green" />
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
          {librarySearchTouched && !librarySearchLoading && !librarySearchResults.length ? (
            <View style={styles.packagedSearchEmpty}>
              <Text style={styles.packagedSearchEmptyText}>没有搜到同款。确认照片清晰后，可以继续上传补库。</Text>
            </View>
          ) : null}
        </PackagedSection>

        <PackagedSection>
          <View style={styles.packagedSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.packagedSectionTitle}>包装图片</Text>
              <Text style={styles.packagedSectionSubtitle}>正面、营养表、净含量或配料细节。</Text>
            </View>
            <PackagedMiniPill text={imageUrls.length + '/3'} tone={imageUrls.length ? 'green' : 'neutral'} />
          </View>
          <View style={styles.packagedCaptureGrid}>
            {captureSlots.map((slot, index) => (
              <PackagedPhotoSlot
                key={slot.label}
                label={slot.label}
                hint={slot.hint}
                image={sourceImages[index]}
                onRemove={() => {
                  const target = sourceImages[index]
                  if (target) removeImage(target.imageUrl)
                }}
              />
            ))}
          </View>
          <View style={styles.packagedUploadActions}>
            <PackagedActionButton label="从相册上传包装图" tone="primary" loading={loading && !extractResult} onPress={pickImage} />
            <View style={styles.packagedManualUrlRow}>
              <TextInput
                value={manualImageUrl}
                onChangeText={setManualImageUrl}
                placeholder="也可粘贴图片地址"
                placeholderTextColor="#94a3b8"
                style={styles.packagedManualUrlInput}
              />
              <PackagedActionButton label="添加" disabled={!manualImageUrl.trim()} onPress={() => addImageUrl(manualImageUrl)} />
            </View>
          </View>

          <View style={styles.packagedAiCard}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.packagedSectionTitle}>AI 识别任务</Text>
                <Text style={styles.packagedSectionSubtitle}>商品识别适合 1-3 张图；即时营养表会直接回填。</Text>
              </View>
              {lastTaskId ? <PackagedMiniPill text="有任务" tone="amber" /> : null}
            </View>
            <View style={styles.packagedAiButtonGrid}>
              <View style={styles.packagedAiButtonItem}><PackagedActionButton label="提交商品识别" disabled={loading} onPress={submitExtract} /></View>
              <View style={styles.packagedAiButtonItem}><PackagedActionButton label="即时营养表" disabled={loading} onPress={recognizeNutritionNow} /></View>
              <View style={styles.packagedAiButtonItem}><PackagedActionButton label="后台营养任务" disabled={loading} onPress={submitNutrition} /></View>
              {lastTaskId ? <View style={styles.packagedAiButtonItem}><PackagedActionButton label="刷新回填" disabled={loading} onPress={() => loadTaskIntoForm(lastTaskId)} /></View> : null}
            </View>
            {extractResult ? (
              <View style={[styles.packagedResultBanner, extractBannerNeedsReview && styles.packagedResultBannerWarn]}>
                <Text style={styles.packagedResultTitle}>{extractResult.product_name || '识别结果待核对'}</Text>
                <Text style={styles.packagedResultText}>
                  {autoIngest?.status === 'ingested'
                    ? '已自动入库包装食品库。'
                    : autoIngest?.reason || extractResult.needs_more_images?.join('、') || '请核对字段后保存。'}
                </Text>
              </View>
            ) : null}
            {lastTaskId ? (
              <Pressable style={styles.linkRow} onPress={() => navigation.navigate('PackagedFoodTaskDetail', { taskId: lastTaskId })}>
                <Text style={styles.linkText}>查看识别任务</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ) : null}
          </View>
        </PackagedSection>

        <PackagedSection>
          <View style={styles.packagedSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.packagedSectionTitle}>商品信息</Text>
              <Text style={styles.packagedSectionSubtitle}>识别回填后仍需人工核对净含量和规格。</Text>
            </View>
          </View>
          <View style={styles.packagedFormGrid}>
            {productInfoFields.map((field) => (
              <PackagedInput
                key={field.label}
                label={field.label}
                value={field.value}
                onChangeText={field.onChangeText}
                placeholder={'placeholder' in field ? field.placeholder : undefined}
                keyboardType={'keyboardType' in field ? field.keyboardType : undefined}
              />
            ))}
            <PackagedInput
              label="配料表"
              value={ingredientsText}
              onChangeText={setIngredientsText}
              placeholder="可从包装上摘录，也可留给 OCR 回填"
              multiline
              style={styles.packagedMiniFieldFull}
            />
          </View>
        </PackagedSection>

        <PackagedSection>
          <View style={styles.packagedSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.packagedSectionTitle}>营养成分</Text>
              <Text style={styles.packagedSectionSubtitle}>默认按每 100g 填写；包装写每份时，把基准改成对应克数。</Text>
            </View>
            <PackagedMiniPill text={(nutritionBasis || '100') + 'g'} />
          </View>
          <View style={styles.packagedFormGrid}>
            <PackagedInput label="营养基准 g" value={nutritionBasis} onChangeText={setNutritionBasis} keyboardType="decimal-pad" />
            {mainNutritionFields.map((field) => (
              <PackagedInput key={field.label} label={field.label} value={field.value} onChangeText={field.onChangeText} keyboardType="decimal-pad" />
            ))}
          </View>
          <View style={styles.packagedUploadActions}>
            <PackagedActionButton label={showMoreNutrition ? '收起更多营养素' : '填写更多营养素'} tone="ghost" onPress={() => setShowMoreNutrition((value) => !value)} />
          </View>
          {showMoreNutrition ? (
            <View style={[styles.packagedFormGrid, { marginTop: 10 }]}>
              {extraNutritionFields.map((field) => (
                <PackagedInput key={field.label} label={field.label} value={field.value} onChangeText={field.onChangeText} keyboardType="decimal-pad" />
              ))}
            </View>
          ) : null}
        </PackagedSection>
      </ScrollView>

      <View style={[styles.packagedStickyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.packagedStickyInner}>
          <View style={styles.packagedStickyText}>
            <Text style={styles.packagedStickyTitle}>保存到包装食品库</Text>
            <Text style={styles.packagedStickySubtitle}>{canSavePackaged ? '信息已满足基础入库要求' : '需商品名、图片和净含量'}</Text>
          </View>
          <View style={{ minWidth: 132 }}>
            <PackagedActionButton label="保存" tone="primary" loading={loading && canSavePackaged} disabled={!canSavePackaged} onPress={save} />
          </View>
        </View>
      </View>
    </View>
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

  const insets = useSafeAreaInsets()
  const taskStatus = String(task?.status || '')
  const isFailed = ['failed', 'error', 'canceled', 'cancelled'].includes(taskStatus)
  const isDone = ['done', 'completed'].includes(taskStatus)
  const taskStatusTone: 'green' | 'amber' | 'red' = isFailed ? 'red' : isDone ? 'green' : 'amber'
  const taskTitle = packaged?.product_name || (imageUrls.length ? '包装照片 ' + imageUrls.length + ' 张' : '包装识别任务')
  const imageTitle = imageUrls.length ? '上传图片 ' + imageUrls.length + ' 张' : '上传图片'
  const resultNeedsReview = Boolean(auto && auto.status !== 'ingested')

  return (
    <View style={styles.packagedMiniRoot}>
      <ScrollView
        style={styles.packagedMiniRoot}
        contentContainerStyle={[styles.packagedMiniContent, { paddingTop: Math.max(insets.top + 8, 16), paddingBottom: insets.bottom + 30 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#16a34a" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.packagedTaskHero}>
          <Text style={styles.packagedTaskKicker}>零食上传任务</Text>
          <Text style={styles.packagedTaskTitle}>{taskTitle}</Text>
          <Text style={styles.packagedTaskSubtitle}>{formatDateTime(task?.created_at || '') || '任务创建时间待同步'}</Text>
          <View style={styles.packagedTaskHeroMeta}>
            <View style={styles.packagedTaskStatusPill}><Text style={styles.packagedTaskStatusText}>{taskStatusLabel(task?.status)}</Text></View>
            <View style={styles.packagedTaskStatusPill}><Text style={styles.packagedTaskStatusText}>{analysisTaskTypeLabel(task?.task_type)}</Text></View>
            <View style={styles.packagedTaskStatusPill}><Text style={styles.packagedTaskStatusText}>{imageUrls.length} 张图</Text></View>
          </View>
          <View style={styles.packagedTaskHeroActions}>
            <View style={styles.packagedTaskHeroAction}><PackagedActionButton label="刷新" tone="ghost" loading={loading} onPress={load} /></View>
            {!isRunning ? <View style={styles.packagedTaskHeroAction}><PackagedActionButton label="重新上传" tone="ghost" onPress={() => navigation.navigate('PackagedFoodEdit')} /></View> : null}
            {packaged ? <View style={styles.packagedTaskHeroAction}><PackagedActionButton label={linkedPackagedFood ? '核对商品' : '补充入库'} tone="ghost" onPress={() => navigation.navigate('PackagedFoodEdit', { taskId: route.params.taskId })} /></View> : null}
          </View>
        </View>

        <PackagedSection>
          <View style={styles.packagedSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.packagedSectionTitle}>{imageTitle}</Text>
              <Text style={styles.packagedSectionSubtitle}>用于识别商品包装、净含量和营养成分表。</Text>
            </View>
            <PackagedMiniPill text={taskStatusLabel(task?.status)} tone={taskStatusTone} />
          </View>
          {imageUrls.length ? (
            <View style={styles.packagedCaptureGrid}>
              {imageUrls.slice(0, 3).map((url, index) => (
                <View key={url + '-' + index} style={styles.packagedPhotoSlot}>
                  <Image source={{ uri: url }} style={styles.packagedPhotoImage} />
                  <View style={styles.packagedPhotoShade}>
                    <Text style={styles.packagedPhotoLabel}>图片 {index + 1}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : loading && !task ? (
            <View style={styles.packagedSearchEmpty}><ActivityIndicator color="#16a34a" /></View>
          ) : (
            <View style={styles.packagedSearchEmpty}><Text style={styles.packagedSearchEmptyText}>暂无图片信息</Text></View>
          )}
        </PackagedSection>

        {packaged ? (
          <>
            <View style={[styles.packagedResultBanner, resultNeedsReview && styles.packagedResultBannerWarn]}>
              <Text style={styles.packagedResultTitle}>{auto?.status === 'ingested' ? '已入库包装食品库' : '识别结果需要核对'}</Text>
              <Text style={styles.packagedResultText}>
                {auto?.status === 'ingested'
                  ? '系统已经自动关联包装食品库。'
                  : auto?.reason || taskFailureMessage(task) || '请检查缺失字段后补充入库。'}
              </Text>
            </View>

            <PackagedSection>
              <View style={styles.packagedSectionHeader}>
                <View style={styles.flex}>
                  <Text style={styles.packagedSectionTitle}>结构化结果</Text>
                  <Text style={styles.packagedSectionSubtitle}>字段来自包装图 OCR 与商品识别。</Text>
                </View>
                <PackagedMiniPill text={formatPercent(packaged.extract_confidence)} tone="green" />
              </View>
              <View style={styles.packagedInfoGrid}>
                <PackagedInfoCell label="商品名称" value={packaged.product_name || '--'} />
                <PackagedInfoCell label="品牌" value={packaged.brand || '--'} />
                <PackagedInfoCell label="口味" value={packaged.flavor_text || '--'} />
                <PackagedInfoCell label="品类" value={packaged.package_category || '--'} />
                <PackagedInfoCell label="规格" value={packaged.spec_text || formatNutritionNumber(packaged.net_weight_g, 'g')} />
                <PackagedInfoCell label="条形码" value={packaged.barcode || '--'} />
              </View>
            </PackagedSection>

            <PackagedSection>
              <View style={styles.packagedSectionHeader}>
                <View style={styles.flex}>
                  <Text style={styles.packagedSectionTitle}>营养换算</Text>
                  <Text style={styles.packagedSectionSubtitle}>基准：{packaged.nutrition_basis_unit || '100g'}；换算状态：{packagedConversionStatusLabel(packaged.conversion_status)}</Text>
                </View>
              </View>
              <View style={styles.packagedNutritionChips}>
                <PackagedMiniPill text={formatNutritionNumber(nutrition.calories) + ' kcal'} tone="green" />
                <PackagedMiniPill text={'蛋白 ' + formatNutritionNumber(nutrition.protein, 'g')} />
                <PackagedMiniPill text={'碳水 ' + formatNutritionNumber(nutrition.carbs, 'g')} />
                <PackagedMiniPill text={'脂肪 ' + formatNutritionNumber(nutrition.fat, 'g')} />
                <PackagedMiniPill text={'糖 ' + formatNutritionNumber(nutrition.sugar, 'g')} />
                <PackagedMiniPill text={'钠 ' + formatNutritionNumber(nutrition.sodiumMg, 'mg')} />
              </View>
            </PackagedSection>

            <PackagedSection>
              <View style={styles.packagedSectionHeader}>
                <View style={styles.flex}>
                  <Text style={styles.packagedSectionTitle}>入库状态</Text>
                  <Text style={styles.packagedSectionSubtitle}>自动写入、重复命中或等待人工补充。</Text>
                </View>
                <PackagedMiniPill text={packagedIngestStatusLabel(auto?.status)} tone={auto?.status === 'ingested' ? 'green' : 'amber'} />
              </View>
              <View style={styles.packagedInfoGrid}>
                <PackagedInfoCell label="结果" value={packagedIngestStatusLabel(auto?.status)} />
                <PackagedInfoCell label="动作" value={packagedUpsertActionLabel(auto?.upsert_action)} />
                <PackagedInfoCell label="商品条目" value={(packaged.packaged_food_id || auto?.packaged_food_id) ? '已关联包装食品库' : '--'} />
                <PackagedInfoCell label="置信度" value={formatPercent(packaged.extract_confidence)} />
              </View>
              {auto?.missing_fields?.length ? <Text style={styles.packagedResultText}>缺少字段：{auto.missing_fields.join('、')}</Text> : null}
              {auto?.conflict_reasons?.length ? <Text style={styles.packagedResultText}>需要核对：{auto.conflict_reasons.join('、')}</Text> : null}
            </PackagedSection>

            <PackagedSection>
              <Text style={styles.packagedSectionTitle}>配料表</Text>
              <Text style={[styles.bodyText, { marginTop: 8 }]}>{packaged.ingredients_text || '暂无配料信息'}</Text>
            </PackagedSection>
          </>
        ) : (
          <PackagedSection>
            <View style={styles.packagedSectionHeader}>
              <View style={styles.flex}>
                <Text style={styles.packagedSectionTitle}>{isRunning ? '任务仍在处理' : '暂无结构化结果'}</Text>
                <Text style={styles.packagedSectionSubtitle}>{isRunning ? '下拉刷新即可查看最新进度。' : taskFailureMessage(task)}</Text>
              </View>
              {isRunning ? <ActivityIndicator color="#16a34a" /> : <PackagedMiniPill text="未完成" tone="red" />}
            </View>
          </PackagedSection>
        )}

        <PackagedSection>
          <View style={styles.packagedSectionHeader}>
            <View style={styles.flex}>
              <Text style={styles.packagedSectionTitle}>下一步</Text>
              <Text style={styles.packagedSectionSubtitle}>
                {packaged
                  ? linkedPackagedFood
                    ? '结果已关联包装食品库，需要修正时可回到补库表单。'
                    : '用识别结果回填表单，核对后保存入库。'
                  : isRunning
                    ? '后台识别完成后会生成可回填的结构化结果。'
                    : '可返回重新上传更清晰的包装图或营养成分表。'}
              </Text>
            </View>
          </View>
          <View style={styles.packagedAiButtonGrid}>
            <View style={styles.packagedAiButtonItem}><PackagedActionButton label="刷新结果" disabled={loading} onPress={load} /></View>
            {packaged ? <View style={styles.packagedAiButtonItem}><PackagedActionButton label={linkedPackagedFood ? '核对并更新' : '用结果补库'} tone="primary" onPress={() => navigation.navigate('PackagedFoodEdit', { taskId: route.params.taskId })} /></View> : null}
            {!isRunning ? <View style={styles.packagedAiButtonItem}><PackagedActionButton label="重新上传" tone="ghost" onPress={() => navigation.navigate('PackagedFoodEdit')} /></View> : null}
          </View>
        </PackagedSection>

        <PackagedSection>
          <Text style={styles.packagedSectionTitle}>原始 OCR 摘要</Text>
          <View style={[styles.packagedOcrBox, { marginTop: 10 }]}>
            <Text style={styles.packagedOcrText}>{packaged?.ocr_raw_text || '暂无 OCR 文本'}</Text>
          </View>
        </PackagedSection>
      </ScrollView>
    </View>
  )
}

export function LocationSearchScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'LocationSearch'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<LocationSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState<LocationSelection | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  const search = async () => {
    const q = keyword.trim()
    if (!q) {
      Alert.alert('请输入关键词', '输入商家名、食堂或地点后再搜索。')
      return
    }
    setLoading(true)
    try {
      const data = await apiClient.searchLocation(q)
      setResult(data)
      setHasSearched(true)
      setSelectedLocation(null)
    } catch (error) {
      Alert.alert('搜索位置失败', userFacingErrorMessage(error, '位置服务暂时没有返回结果，请换个关键词后再试。'))
    } finally {
      setLoading(false)
    }
  }

  const items = useMemo(() => normalizeLocationItems(result), [result])
  const promptCity = useMemo(() => locationPromptCityFromResult(result), [result])

  const selectLocation = (item: LocationSearchPOI) => {
    const nextLocation = locationSelectionFromItem(item, promptCity)
    if (nextLocation.latitude == null || nextLocation.longitude == null) {
      Alert.alert('无法使用这个位置', '这个结果没有返回经纬度，请换一个结果或手动填写位置。')
      return
    }
    setSelectedLocation(nextLocation)
  }

  const confirmLocation = () => {
    if (!selectedLocation) return
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

  const mapCenter = selectedLocation?.latitude != null && selectedLocation.longitude != null
    ? { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }
    : DEFAULT_LOCATION_COORDS
  const selectionText = selectedLocation
    ? [selectedLocation.name, selectedLocation.address].filter(Boolean).join(' ') || '已选位置'
    : '点击搜索结果选择位置'

  return (
    <View style={styles.locationSearchPage}>
      <View style={styles.locationMapWrap}>
        <View style={styles.locationMapCanvas}>
          <View style={[styles.locationMapRoad, styles.locationMapRoadMain]} />
          <View style={[styles.locationMapRoad, styles.locationMapRoadSecondary]} />
          <View style={[styles.locationMapRoad, styles.locationMapRoadThinA]} />
          <View style={[styles.locationMapRoad, styles.locationMapRoadThinB]} />
          <View style={styles.locationMapBlockA} />
          <View style={styles.locationMapBlockB} />
          <View style={styles.locationMapBlockC} />
          <Text style={styles.locationMapCoord}>
            {mapCenter.latitude.toFixed(4)}, {mapCenter.longitude.toFixed(4)}
          </Text>
          <View style={styles.locationMapPin}>
            <View style={styles.locationMapPinInner} />
          </View>
          <View style={styles.locationMapBadge}>
            <Text style={styles.locationMapBadgeText}>搜索地址</Text>
          </View>
        </View>
      </View>

      <View style={[styles.locationPanel, { paddingBottom: Math.max(insets.bottom + 18, 28) }]}>
        <View style={styles.locationSearchRow}>
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="输入商家名 / 地名搜索"
            placeholderTextColor="#a1a7b0"
            returnKeyType="search"
            onSubmitEditing={() => void search()}
            style={styles.locationSearchInput}
          />
          <Pressable style={styles.locationSearchButton} onPress={() => void search()} disabled={loading}>
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.locationSearchButtonText}>搜索</Text>}
          </Pressable>
        </View>

        <View style={[styles.locationSelectedCard, selectedLocation && styles.locationSelectedCardFilled]}>
          <Text style={styles.locationSelectedLabel}>当前选中</Text>
          <Text style={[styles.locationSelectedText, selectedLocation && styles.locationSelectedTextFilled]} numberOfLines={3}>
            {selectionText}
          </Text>
        </View>

        {hasSearched && items.length === 0 ? (
          <View style={styles.locationEmptyCard}>
            <Text style={styles.locationEmptyTitle}>没有搜索结果</Text>
            <Text style={styles.locationEmptyText}>换个商家名、食堂名或附近地标再试。</Text>
          </View>
        ) : null}

        {items.length > 0 ? (
          <View style={styles.locationResultSection}>
            <Text style={styles.locationResultTitle}>搜索结果（共 {items.length} 个，点击选择）</Text>
            <ScrollView style={styles.locationResultList} showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {items.map((item, index) => {
                const selection = locationSelectionFromItem(item, promptCity)
                const active = selectedLocation?.lonlat && selection.lonlat && selectedLocation.lonlat === selection.lonlat
                return (
                  <Pressable
                    key={String(item.id || `${item.title || item.name}-${index}`)}
                    style={[styles.locationResultItem, active && styles.locationResultItemActive]}
                    onPress={() => selectLocation(item)}
                  >
                    <View style={styles.locationResultMain}>
                      <Text style={styles.locationResultIndex}>{index + 1}</Text>
                      <View style={styles.locationResultContent}>
                        <Text style={styles.locationResultName} numberOfLines={1}>{item.title || item.name || '未命名位置'}</Text>
                        <Text style={styles.locationResultAddress} numberOfLines={3}>{item.address || item.category || '无地址信息'}</Text>
                        <Text style={styles.locationResultCoord} numberOfLines={1}>{locationText(item)}</Text>
                      </View>
                    </View>
                    <Text style={styles.locationResultAction}>{active ? '已选' : '选这里'}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
            {items.length >= 4 ? <Text style={styles.locationResultMore}>下滑查看更多</Text> : null}
          </View>
        ) : null}

        <Pressable
          style={[styles.locationUseButton, !selectedLocation && styles.locationUseButtonDisabled]}
          onPress={confirmLocation}
          disabled={!selectedLocation}
        >
          <Text style={styles.locationUseButtonText}>使用该位置</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function CampusCanteenScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [items, setItems] = useState<PublicFoodItem[]>([])
  const [locationType, setLocationType] = useState<DiningLocationType>('university')
  const [selectedLocation, setSelectedLocation] = useState<DiningLocationItem | null>(null)
  const [selectedSite, setSelectedSite] = useState<DiningLocationSiteItem | null>(null)
  const [selectedCanteen, setSelectedCanteen] = useState<DiningCanteenItem | null>(null)
  const [selectedFloor, setSelectedFloor] = useState<DiningFloorItem | null>(null)
  const [selectedWindow, setSelectedWindow] = useState<DiningWindowItem | null>(null)
  const [locations, setLocations] = useState<DiningLocationItem[]>([])
  const [sites, setSites] = useState<DiningLocationSiteItem[]>([])
  const [canteens, setCanteens] = useState<DiningCanteenItem[]>([])
  const [floors, setFloors] = useState<DiningFloorItem[]>([])
  const [windows, setWindows] = useState<DiningWindowItem[]>([])
  const [picker, setPicker] = useState<'location' | 'site' | 'canteen' | 'floor' | 'window' | null>(null)
  const [pickerLoading, setPickerLoading] = useState(false)
  const schoolName = selectedLocation?.name || ''
  const canteenName = selectedCanteen?.name || ''
  const floorName = selectedFloor?.name || selectedWindow?.floor || ''
  const windowName = selectedWindow?.name || ''
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
        schoolId: selectedLocation?.id,
        campusId: selectedSite?.id,
        canteenId: selectedCanteen?.id,
        windowId: selectedWindow?.id,
        merchantName: keyword?.trim() || undefined,
      })
      setItems(data.list || [])
    } catch (error) {
      showError('获取校园食堂失败', error)
    } finally {
      setLoading(false)
    }
  }, [canteenName, schoolName, sortBy, selectedCanteen?.id, selectedLocation?.id, selectedSite?.id, selectedWindow?.id])

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
    setSelectedLocation(null); setSelectedSite(null); setSelectedCanteen(null); setSelectedFloor(null); setSelectedWindow(null)
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

  const goUpload = () => navigation.navigate('PublicFoodShare', { mode: 'campus' })
  const goDetail = (item: PublicFoodItem) => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })
  const goAuthor = (item: PublicFoodItem) => {
    if (item.author?.id) {
      navigation.navigate('ProfileSettings', { userId: item.author.id })
    }
  }

  const openPicker = async (next: 'location' | 'site' | 'canteen' | 'floor' | 'window') => {
    if (next === 'site' && !selectedLocation) return Alert.alert('请先选择地点')
    if ((next === 'canteen' || next === 'floor' || next === 'window') && !selectedSite && next === 'canteen') return Alert.alert('请先选择校区/园区')
    if ((next === 'floor' || next === 'window') && !selectedCanteen) return Alert.alert('请先选择食堂')
    if (next === 'window' && !floorName) return Alert.alert('请先选择楼层')
    setPickerLoading(true)
    try {
      if (next === 'location') setLocations(await apiClient.searchDiningLocations({ type: locationType, limit: 100 }))
      if (next === 'site' && selectedLocation) setSites(await apiClient.getDiningLocationSites(selectedLocation.id))
      if (next === 'canteen' && selectedSite) setCanteens(await apiClient.getDiningLocationCanteens(selectedSite.id))
      if (next === 'floor' && selectedCanteen) setFloors(await apiClient.getDiningCanteenFloors(selectedCanteen.id))
      if (next === 'window' && selectedCanteen) setWindows(await apiClient.getDiningCanteenWindows(selectedCanteen.id, floorName))
      setPicker(next)
    } catch (error) { showError('获取地点目录失败', error) } finally { setPickerLoading(false) }
  }

  const pickerTitle = picker === 'location' ? '选择地点' : picker === 'site' ? '选择校区/园区' : picker === 'canteen' ? '选择食堂' : picker === 'floor' ? '选择楼层' : '选择窗口'
  const pickerItems = picker === 'location' ? locations : picker === 'site' ? sites : picker === 'canteen' ? canteens : picker === 'floor' ? floors : windows
  const choosePickerItem = (item: any) => {
    if (picker === 'location') { setSelectedLocation(item); setSelectedSite(null); setSelectedCanteen(null); setSelectedFloor(null); setSelectedWindow(null) }
    if (picker === 'site') { setSelectedSite(item); setSelectedCanteen(null); setSelectedFloor(null); setSelectedWindow(null) }
    if (picker === 'canteen') { setSelectedCanteen(item); setSelectedFloor(null); setSelectedWindow(null) }
    if (picker === 'floor') { setSelectedFloor(item); setSelectedWindow(null) }
    if (picker === 'window') { setSelectedWindow(item); if (item.floor) setSelectedFloor({ name: item.floor, sort_order: 0 }) }
    setPicker(null)
  }

  const renderCampusCard = (item: PublicFoodItem) => {
    const analyzing = campusIsAnalyzing(item)
    const failed = campusAnalysisFailed(item)
    const nutritionPending = !analyzing && !failed && !campusHasNutrition(item)
    const image = campusPrimaryImage(item)
    const authorName = item.author?.nickname || '用户'
    const statusText = analyzing ? '分析中' : failed ? '分析失败' : nutritionPending ? '营养待更新' : ''
    const recordText = analyzing || nutritionPending ? '待更新' : '一键记录'

    return (
      <Pressable
        key={item.id}
        style={[styles.campusListCard, (analyzing || nutritionPending) && styles.campusListCardPending, failed && styles.campusListCardFailed]}
        onPress={() => goDetail(item)}
      >
        <View style={styles.campusListCardMain}>
          <View style={styles.campusListImageWrap}>
            {image ? (
              <Image source={{ uri: image }} style={styles.campusListImage} />
            ) : (
              <View style={styles.campusListImagePlaceholder}>
                <Text style={styles.campusListImageText}>暂无图片</Text>
              </View>
            )}
          </View>
          <View style={styles.campusListInfo}>
            <Text style={styles.campusListTitle} numberOfLines={1}>{item.food_name || '未命名菜品'}</Text>
            <View style={styles.campusListLocationRow}>
              <Text style={styles.campusLocationIcon}>⌖</Text>
              <Text style={styles.campusListLocation} numberOfLines={1}>{campusLocationText(item) || schoolName || '校园食堂'}</Text>
            </View>
            <View style={styles.campusListNutritionRow}>
              <Text style={styles.campusListPrice}>{campusPriceText(item)}</Text>
              {statusText ? (
                <Text style={[styles.campusStatusPill, failed && styles.campusStatusPillFailed]}>{statusText}</Text>
              ) : (
                <View style={styles.campusCalorieBadge}>
                  <Text style={styles.campusCalorieBadgeText}>{Math.round(item.total_calories || 0)}</Text>
                  <Text style={styles.campusCalorieUnit}>kcal</Text>
                </View>
              )}
            </View>
            <View style={styles.campusListTags}>
              {campusTags(item).map((tag) => (
                <Text key={`${item.id}-${tag}`} style={[styles.campusTag, tag === '减脂友好' && styles.campusTagFatLoss]} numberOfLines={1}>{tag}</Text>
              ))}
            </View>
          </View>
        </View>
        <View style={styles.campusListFooter}>
          <Pressable
            style={styles.campusAuthorRow}
            onPress={(event) => {
              event.stopPropagation()
              goAuthor(item)
            }}
          >
            {item.author?.avatar ? (
              <Image source={{ uri: item.author.avatar }} style={styles.campusAuthorAvatar} />
            ) : (
              <View style={styles.campusAuthorAvatarFallback}>
                <Text style={styles.campusAuthorAvatarText}>{campusAuthorInitial(authorName)}</Text>
              </View>
            )}
            <Text style={styles.campusAuthorName} numberOfLines={1}>{authorName}</Text>
          </Pressable>
          <View style={styles.campusCardActions}>
            <Text style={styles.campusCardStat}>♡ {item.like_count || 0}</Text>
            <Text style={styles.campusCardStat}>评 {item.comment_count || 0}</Text>
            <Pressable
              style={styles.campusRecordButton}
              onPress={(event) => {
                event.stopPropagation()
                quickRecord(item)
              }}
            >
              <Text style={styles.campusRecordButtonText}>{recordText}</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    )
  }

  return (
    <View style={styles.campusCanteenPage}>
      <ScrollView
        style={styles.campusCanteenScroll}
        contentContainerStyle={styles.campusCanteenContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} colors={[colors.brand]} tintColor={colors.brand} />}
      >
        <ImageBackground source={{ uri: cafeteriaHeroBgUrl }} style={styles.campusHero} imageStyle={styles.campusHeroImage}>
          <View style={styles.campusHeroOverlay} />
          <View style={styles.campusHeroCopy}>
            <Text style={styles.campusHeroEyebrow}>食探校园活动</Text>
            <Text style={styles.campusHeroTitle}>食探校园食堂计划</Text>
            <Text style={styles.campusHeroSubtitle} numberOfLines={3}>
              按你所在省份选择高校，一起补全食堂菜品价格、位置和营养信息
            </Text>
          </View>
          <Pressable style={styles.campusHeroUpload} onPress={goUpload}>
            <Text style={styles.campusHeroUploadText}>补充菜品</Text>
          </Pressable>
        </ImageBackground>

        <View style={styles.campusHeader}>
          <View style={styles.campusFilterRow}>
            <Pressable style={styles.campusFilterChip} onPress={() => void openPicker('location')}><Text style={schoolName ? styles.campusFilterInputText : styles.campusFilterPlaceholder}>{schoolName || (locationType === 'company' ? '选择公司' : locationType === 'community' ? '选择社区' : '选择高校')}</Text></Pressable>
            <Pressable style={styles.campusFilterChip} onPress={() => void openPicker('site')}><Text style={selectedSite?.name ? styles.campusFilterInputText : styles.campusFilterPlaceholder}>{selectedSite?.name || '选择校区/园区'}</Text></Pressable>
            <Pressable style={styles.campusFilterChip} onPress={() => void openPicker('canteen')}><Text style={canteenName ? styles.campusFilterInputText : styles.campusFilterPlaceholder}>{canteenName || '选择食堂'}</Text></Pressable>
            <Pressable style={styles.campusFilterChip} onPress={() => void openPicker('floor')}><Text style={floorName ? styles.campusFilterInputText : styles.campusFilterPlaceholder}>{floorName || '选择楼层'}</Text></Pressable>
            <Pressable style={styles.campusFilterChip} onPress={() => void openPicker('window')}><Text style={windowName ? styles.campusFilterInputText : styles.campusFilterPlaceholder}>{windowName || '选择窗口'}</Text></Pressable>
          </View>
          <View style={styles.campusFilterRow}>{(['university', 'company', 'community'] as DiningLocationType[]).map((type) => <Pressable key={type} style={styles.campusClearButton} onPress={() => { setLocationType(type); setSelectedLocation(null); setSelectedSite(null); setSelectedCanteen(null); setSelectedFloor(null); setSelectedWindow(null) }}><Text style={styles.campusClearButtonText}>{locationType === type ? '✓ ' : ''}{type === 'university' ? '高校' : type === 'company' ? '公司' : '社区'}</Text></Pressable>)}</View>
          <View style={styles.campusSearchRow}>
            <View style={styles.campusSearchInputWrap}>
              <Text style={styles.campusSearchIcon}>⌕</Text>
              <TextInput
                style={styles.campusSearchInput}
                value={searchKeyword}
                onChangeText={setSearchKeyword}
                placeholder="搜索菜名"
                placeholderTextColor={colors.textMuted}
                returnKeyType="search"
                onSubmitEditing={search}
              />
            </View>
            <Pressable style={styles.campusSearchButton} onPress={search}>
              <Text style={styles.campusSearchButtonText}>搜索</Text>
            </Pressable>
          </View>
          {(schoolName || canteenName || floorName || windowName || searchKeyword) ? (
            <Pressable style={styles.campusClearButton} onPress={clearFilters}>
              <Text style={styles.campusClearButtonText}>清除筛选</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.campusSortSection}>
          {campusCanteenSortOptions.map((option) => (
            <Pressable key={option.value} style={styles.campusSortItem} onPress={() => setSortBy(option.value)}>
              <Text style={[styles.campusSortText, sortBy === option.value && styles.campusSortTextActive]}>{option.label}</Text>
              {sortBy === option.value ? <View style={styles.campusSortUnderline} /> : null}
            </Pressable>
          ))}
        </View>

        {analyzedItems.length > 0 ? (
          <>
            <CampusRecommendationSection title="热门菜品" subtitle="按收藏、点赞和发布时间排序" items={hotItems} onPress={goDetail} />
            <CampusRecommendationSection title="高蛋白推荐" subtitle="适合训练后或想吃扎实一点" items={highProteinItems} onPress={goDetail} />
            <View style={styles.campusRecommendGrid}>
              <CampusRecommendationPanel title="低热量推荐" items={lowCalorieItems} formatLine={(item) => `${item.food_name || '校园菜品'} · ${Math.round(item.total_calories || 0)} kcal`} onPress={goDetail} />
              <CampusRecommendationPanel title="性价比推荐" items={valueItems} formatLine={(item) => `${item.food_name || '校园菜品'} · ${campusValueScore(item).toFixed(1)}g/元`} onPress={goDetail} />
            </View>
          </>
        ) : null}

        <View style={styles.campusSectionHead}>
          <Text style={styles.campusSectionTitle}>全部校园菜品</Text>
          <Text style={styles.campusSectionSubtitle} numberOfLines={1}>{schoolName || '全部高校'}{canteenName ? ` · ${canteenName}` : ''}</Text>
        </View>

        {loading && visibleItems.length === 0 ? (
          <View style={styles.campusLoadingState}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : visibleItems.length === 0 ? (
          <View style={styles.campusEmptyState}>
            <Text style={styles.campusEmptyIcon}>食</Text>
            <Text style={styles.campusEmptyText}>暂无校园食堂数据</Text>
            <Text style={styles.campusEmptySubtext}>快来上传第一份食堂菜品吧</Text>
            <Pressable style={styles.campusEmptyButton} onPress={goUpload}>
              <Text style={styles.campusEmptyButtonText}>去上传</Text>
            </Pressable>
          </View>
        ) : (
          visibleItems.map(renderCampusCard)
        )}
      </ScrollView>
      <Modal visible={picker !== null} transparent animationType='slide' onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.campusModalOverlay} onPress={() => setPicker(null)}>
          <Pressable style={styles.campusPickerSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.campusPickerTitle}>{pickerTitle}</Text>
            {pickerLoading ? <ActivityIndicator color={colors.brand} /> : <ScrollView style={styles.campusPickerList}>{pickerItems.map((item: any) => <Pressable key={item.id} style={styles.campusPickerRow} onPress={() => choosePickerItem(item)}><Text style={styles.campusPickerRowTitle}>{item.name}</Text>{item.floor ? <Text style={styles.campusPickerRowMeta}>{item.floor}</Text> : null}</Pressable>)}</ScrollView>}
          </Pressable>
        </Pressable>
      </Modal>

      <Pressable style={styles.campusFabButton} onPress={goUpload}>
        <Text style={styles.campusFabIcon}>+</Text>
      </Pressable>
    </View>
  )
}

export function PrivacySettingsScreen() {
  const [searchable, setSearchable] = useState(true)
  const [publicRecords, setPublicRecords] = useState(true)
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<'searchable' | 'public_records' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getUserProfile()
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
    <View style={styles.privacySettingsPage}>
      <ScrollView
        style={styles.privacySettingsScroll}
        contentContainerStyle={styles.privacySettingsContent}
        refreshControl={<RefreshControl refreshing={loading} tintColor={colors.brand} onRefresh={load} />}
      >
        {loading ? (
          <View style={styles.privacyLoadingState}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <>
            <Text style={styles.privacySettingsGroupTitle}>基础隐私</Text>
            <View style={styles.privacySettingsGroup}>
              <View style={[styles.privacySettingRow, styles.privacySettingRowBorder]}>
                <View style={styles.privacySettingCopy}>
                  <Text style={styles.privacySettingTitle}>允许在圈子中被搜索</Text>
                  <Text style={styles.privacySettingBrief}>开启后，其他用户可以通过用户名或手机号搜索到您。</Text>
                </View>
                <View style={styles.privacySwitchWrap}>
                  {savingKey === 'searchable' ? (
                    <ActivityIndicator color={colors.brand} />
                  ) : (
                    <Switch
                      value={searchable}
                      onValueChange={(value) => updateSetting('searchable', value)}
                      trackColor={{ false: '#d1d5db', true: '#00bc7d' }}
                      thumbColor={colors.surface}
                      style={styles.privacySwitch}
                    />
                  )}
                </View>
              </View>

              <View style={styles.privacySettingRow}>
                <View style={styles.privacySettingCopy}>
                  <Text style={styles.privacySettingTitle}>公开我的饮食记录</Text>
                  <Text style={styles.privacySettingBrief}>开启后，其他用户在圈子里可以看到您的动态和饮食记录。</Text>
                </View>
                <View style={styles.privacySwitchWrap}>
                  {savingKey === 'public_records' ? (
                    <ActivityIndicator color={colors.brand} />
                  ) : (
                    <Switch
                      value={publicRecords}
                      onValueChange={(value) => updateSetting('public_records', value)}
                      trackColor={{ false: '#d1d5db', true: '#00bc7d' }}
                      thumbColor={colors.surface}
                      style={styles.privacySwitch}
                    />
                  )}
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
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
    <LegalDocumentScreen title="会员服务协议" updatedAt="最后更新日期：2026年5月" sections={MEMBERSHIP_AGREEMENT_SECTIONS} />
  )
}

export function UserGroupScreen() {
  const [qrPreviewOpen, setQrPreviewOpen] = useState(false)
  const [savingQr, setSavingQr] = useState(false)
  const groupTitle = '食探用户群'
  const groupSubtitle = '日常反馈、功能建议和使用交流'

  const saveGroupQr = async () => {
    if (savingQr) return

    setSavingQr(true)
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true)
      if (!permission.granted) {
        Alert.alert('需要相册权限', '请允许保存图片到相册后再试。')
        return
      }

      const qrAsset = Asset.fromModule(userGroupQr)
      await qrAsset.downloadAsync()
      let localUri = qrAsset.localUri || qrAsset.uri
      if (!localUri) throw new Error('二维码资源不可用')

      if (!localUri.startsWith('file://')) {
        const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory
        if (!cacheDir) throw new Error('图片缓存目录不可用')
        const downloaded = await FileSystem.downloadAsync(localUri, `${cacheDir}foodlink-user-group-qr.jpg`)
        localUri = downloaded.uri
      }

      await MediaLibrary.saveToLibraryAsync(localUri)
      Alert.alert('已保存到本地', '用户群二维码已保存到相册。')
    } catch (error) {
      Alert.alert('保存失败', userFacingErrorMessage(error, '暂时无法保存二维码，请长按二维码截图后再试。'))
    } finally {
      setSavingQr(false)
    }
  }

  return (
    <View style={styles.userGroupPage}>
      <Svg style={styles.userGroupBackground} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id="userGroupBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#f0fdf4" />
            <Stop offset="0.42" stopColor="#f7faf8" />
            <Stop offset="1" stopColor="#eef2f1" />
          </SvgLinearGradient>
        </Defs>
        <SvgRect x="0" y="0" width="100%" height="100%" fill="url(#userGroupBg)" />
      </Svg>
      <ScrollView contentContainerStyle={styles.userGroupScrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.userGroupHero}>
          <Text style={styles.userGroupEyebrow}>食探交流群</Text>
          <Text style={styles.userGroupHeroTitle}>一起把食探做得更好用</Text>
          <Text style={styles.userGroupHeroSubtitle}>反馈识别问题、提功能建议，也可以看看其他用户怎么记录饮食。</Text>
        </View>

        <View style={styles.userGroupQrCard}>
          <View style={styles.userGroupQrHead}>
            <View style={styles.userGroupQrCopy}>
              <Text style={styles.userGroupQrTitle}>{groupTitle}</Text>
              <Text style={styles.userGroupQrSubtitle}>{groupSubtitle}</Text>
            </View>
            <View style={styles.userGroupTag}>
              <Text style={styles.userGroupTagText}>永久有效</Text>
            </View>
          </View>

          <Pressable style={styles.userGroupQrFrame} onPress={() => setQrPreviewOpen(true)}>
            <Image source={userGroupQr} style={styles.userGroupQrImage} resizeMode="contain" />
          </Pressable>
          <Text style={styles.qrExpiry}>这是当前唯一用户群二维码，可长期使用</Text>

          <View style={styles.userGroupActionRow}>
            <Pressable style={[styles.userGroupPrimaryAction, savingQr && styles.userGroupActionDisabled]} disabled={savingQr} onPress={() => void saveGroupQr()}>
              {savingQr ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.userGroupPrimaryActionText}>保存到本地</Text>}
            </Pressable>
          </View>
        </View>

        <View style={styles.userGroupHintCard}>
          <Text style={styles.userGroupHintTitle}>加入方式</Text>
          <Text style={styles.userGroupHintText}>点击二维码可放大查看；保存到本地后，可以在微信中识别二维码加入用户群。</Text>
        </View>
      </ScrollView>

      <Modal visible={qrPreviewOpen} transparent animationType="fade" onRequestClose={() => setQrPreviewOpen(false)}>
        <View style={styles.qrModalBackdrop}>
          <View style={styles.qrModalCard}>
            <Image source={userGroupQr} style={styles.qrModalImage} resizeMode="contain" />
            <AppButton label="关闭" onPress={() => setQrPreviewOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  )
}

export function FoodLibraryDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'FoodLibraryDetail'>>()
  const insets = useSafeAreaInsets()
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

  const defaultWeight = Math.max(1, Math.round(numberValue(item?.default_weight_grams) || 100))
  const recordWeight = Math.max(1, numberOrUndefined(weight) || defaultWeight)
  const scale = recordWeight / defaultWeight
  const baseCalories = numberValue(item?.total_calories ?? item?.calories)
  const baseProtein = numberValue(item?.total_protein ?? item?.protein)
  const baseCarbs = numberValue(item?.total_carbs ?? item?.carbs)
  const baseFat = numberValue(item?.total_fat ?? item?.fat)
  const imageUri = manualFoodImageUri(item)
  const sourceLabel = manualFoodSourceLabel(item?.source)
  const recordCalories = Math.round(baseCalories * scale)
  const portionText = String(item?.portion_label || `${defaultWeight}g`)
  const heroMeta = String(item?.subtitle || item?.recommend_reason || `默认 ${defaultWeight}g · 可直接记录到本餐`)
  const mealOptions: MealType[] = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']

  return (
    <View style={styles.manualFoodDetailPage}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} colors={[colors.brand]} />}
        contentContainerStyle={[styles.manualFoodDetailContent, { paddingBottom: 124 + insets.bottom }]}
      >
        {loading && !item ? (
          <View style={styles.manualFoodDetailSkeleton}>
            <View style={styles.manualFoodSkeletonHero} />
            <View style={styles.manualFoodSkeletonGrid}>
              {[0, 1, 2, 3].map((index) => <View key={index} style={styles.manualFoodSkeletonTile} />)}
            </View>
            <View style={styles.manualFoodSkeletonCard} />
          </View>
        ) : !item ? (
          <View style={styles.manualFoodEmptyState}>
            <Text style={styles.manualFoodEmptyTitle}>没有找到这个食物</Text>
            <Text style={styles.manualFoodEmptyText}>返回食物库重新选择，或在手动记录里新建一个常吃食物。</Text>
          </View>
        ) : (
          <>
            <View style={styles.manualFoodHeroCard}>
              <View style={styles.manualFoodImageWrap}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.manualFoodImage} />
                ) : (
                  <View style={styles.manualFoodImagePlaceholder}>
                    <Flame size={26} color={colors.brand} />
                  </View>
                )}
              </View>
              <View style={styles.manualFoodHeroCopy}>
                <View style={styles.manualFoodBadgeRow}>
                  <View style={styles.manualFoodSourceBadge}>
                    <Text style={styles.manualFoodSourceBadgeText} numberOfLines={1}>{sourceLabel}</Text>
                  </View>
                  <Text style={styles.manualFoodPortionPill} numberOfLines={1}>{portionText}</Text>
                </View>
                <Text style={styles.manualFoodHeroTitle} numberOfLines={2}>{manualFoodTitle(item)}</Text>
                <Text style={styles.manualFoodHeroMeta} numberOfLines={2}>
                  {heroMeta}
                </Text>
              </View>
            </View>

            <View style={styles.manualFoodNutrientGrid}>
              <ManualFoodNutrientTile label="热量" value={String(Math.round(baseCalories))} unit="kcal" featured />
              <ManualFoodNutrientTile label="蛋白质" value={round1(baseProtein)} unit="g" />
              <ManualFoodNutrientTile label="碳水" value={round1(baseCarbs)} unit="g" />
              <ManualFoodNutrientTile label="脂肪" value={round1(baseFat)} unit="g" />
            </View>

            <View style={styles.manualFoodInfoCard}>
              <View style={styles.manualFoodSectionHead}>
                <Text style={styles.manualFoodSectionTitle}>营养信息</Text>
                <Text style={styles.manualFoodSectionHint}>按默认份量估算</Text>
              </View>
              <ManualFoodInfoRow label="默认份量" value={`${defaultWeight} g`} />
              <ManualFoodInfoRow label="来源" value={sourceLabel} />
              {item.portion_label ? <ManualFoodInfoRow label="份量说明" value={String(item.portion_label)} /> : null}
              {item.recommend_reason ? (
                <View style={styles.manualFoodReasonBox}>
                  <Info size={14} color={colors.brandDark} />
                  <Text style={styles.manualFoodReasonText}>{String(item.recommend_reason)}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.manualFoodRecordCard}>
              <View style={styles.manualFoodSectionHead}>
                <Text style={styles.manualFoodSectionTitle}>记录到今天</Text>
                <Text style={styles.manualFoodSectionHint}>{recordWeight}g · {recordCalories} kcal</Text>
              </View>
              <View style={styles.manualFoodMealGrid}>
                {mealOptions.map((option) => {
                  const active = mealType === option
                  return (
                    <Pressable
                      key={option}
                      style={[styles.manualFoodMealChip, active && styles.manualFoodMealChipActive]}
                      onPress={() => setMealType(option)}
                    >
                      <Text style={[styles.manualFoodMealText, active && styles.manualFoodMealTextActive]} numberOfLines={1}>
                        {mealTypeLabel(option)}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              <View style={styles.manualFoodFieldGrid}>
                <View style={styles.manualFoodField}>
                  <Text style={styles.manualFoodFieldLabel}>日期</Text>
                  <TextInput
                    style={styles.manualFoodFieldInput}
                    value={date}
                    onChangeText={setDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#94a3b8"
                  />
                </View>
                <View style={styles.manualFoodField}>
                  <Text style={styles.manualFoodFieldLabel}>重量 g</Text>
                  <TextInput
                    style={styles.manualFoodFieldInput}
                    value={weight}
                    onChangeText={setWeight}
                    keyboardType="decimal-pad"
                    placeholder={`${defaultWeight}`}
                    placeholderTextColor="#94a3b8"
                  />
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {item ? (
        <View style={[styles.manualFoodBottomBar, { paddingBottom: 12 + insets.bottom }]}>
          <View style={styles.manualFoodBottomSummary}>
            <Text style={styles.manualFoodBottomTitle} numberOfLines={1}>{recordCalories} kcal</Text>
            <Text style={styles.manualFoodBottomSub} numberOfLines={1}>{mealTypeLabel(mealType)} · {recordWeight}g</Text>
          </View>
          <Pressable
            style={[styles.manualFoodSaveButton, loading && styles.manualFoodSaveButtonDisabled]}
            disabled={loading}
            onPress={saveRecord}
          >
            {loading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.manualFoodSaveText}>保存饮食记录</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

export function ExpiryEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ExpiryEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const insets = useSafeAreaInsets()
  const initialItem = route.params?.item
  const draftFromItem = (nextItem: FoodExpiryItem): ExpiryDraft => ({
    ...newExpiryDraft(),
    clientId: nextItem.id,
    foodName: nextItem.food_name || '',
    category: nextItem.category || '其他',
    customCategory: expiryCategoryOptions.includes((nextItem.category || '') as typeof expiryCategoryOptions[number]) ? '' : nextItem.category || '',
    expireDate: (nextItem.expire_date || todayKey()).slice(0, 10),
    quantityNote: nextItem.quantity_note || '',
    storageType: nextItem.storage_type || 'refrigerated',
    note: nextItem.note || '',
    sourceType: nextItem.source_type || 'manual',
  })
  const [drafts, setDrafts] = useState<ExpiryDraft[]>(initialItem ? [draftFromItem(initialItem)] : [newExpiryDraft()])
  const [images, setImages] = useState<ExpiryImageAsset[]>([])
  const [recognitionContext, setRecognitionContext] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [lastRecognizedCount, setLastRecognizedCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const id = String(route.params?.itemId || '').trim()
    if (!id) return
    setLoading(true)
    try {
      const data = await apiClient.getFoodExpiryItem(id)
      setDrafts([draftFromItem(data.item)])
    } catch (error) {
      showError('获取保质期条目失败', error)
    } finally {
      setLoading(false)
    }
  }, [route.params?.itemId])

  useEffect(() => {
    if (!route.params?.item && route.params?.itemId) void load()
  }, [load, route.params?.item, route.params?.itemId])

  const isEditing = Boolean(route.params?.itemId)
  const filledDrafts = drafts.filter((draft) => draft.foodName.trim())
  const saveDisabled = loading || filledDrafts.length === 0

  const updateDraft = (clientId: string, update: Partial<ExpiryDraft>) => {
    setDrafts((current) => current.map((draft) => draft.clientId === clientId ? { ...draft, ...update } : draft))
  }

  const applyPreset = (clientId: string, preset: (typeof expiryEditPresets)[number]) => {
    updateDraft(clientId, {
      foodName: preset.name,
      category: preset.category,
      customCategory: '',
      expireDate: dateKeyAfterDays(preset.days),
      storageType: preset.storageType,
    })
  }

  const pickImages = async (camera = false) => {
    const remaining = 5 - images.length
    if (remaining <= 0) {
      Alert.alert('最多支持 5 张图片')
      return
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82, allowsMultipleSelection: true, selectionLimit: remaining })
    if (result.canceled) return
    setImages((current) => [...current, ...result.assets.slice(0, remaining)])
  }

  const chooseImageSource = () => {
    Alert.alert('拍照或上传食物', '最多支持 5 张图片一起识别', [
      { text: '拍照', onPress: () => void pickImages(true) },
      { text: '从相册选择', onPress: () => void pickImages(false) },
      { text: '取消', style: 'cancel' },
    ])
  }

  const recognize = async () => {
    if (!images.length) {
      chooseImageSource()
      return
    }
    setRecognizing(true)
    try {
      const urls: string[] = []
      for (let index = 0; index < images.length; index += 1) {
        const asset = images[index]
        const uploaded = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || `expiry-${index + 1}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        })
        urls.push(uploaded.imageUrl)
      }
      const result = await apiClient.recognizeFoodExpiryItems(urls, recognitionContext)
      const recognized = result.items.map((recognizedItem) => {
        const category = recognizedItem.category?.trim() || '其他'
        return {
          ...newExpiryDraft(),
          foodName: recognizedItem.food_name || '',
          category,
          customCategory: expiryCategoryOptions.includes(category as typeof expiryCategoryOptions[number]) ? '' : category,
          expireDate: recognizedItem.expire_date?.slice(0, 10) || dateKeyAfterDays(recognizedItem.suggested_days ?? 3),
          quantityNote: recognizedItem.quantity_note || '',
          storageType: recognizedItem.storage_type || 'refrigerated',
          note: recognizedItem.note || '',
          sourceType: recognizedItem.source_type || 'ai',
          confidence: recognizedItem.confidence,
          estimated: recognizedItem.expire_date_is_estimated,
          suggestedDays: recognizedItem.suggested_days,
          recognitionBasis: recognizedItem.recognition_basis,
          missingFields: recognizedItem.missing_fields || [],
        } satisfies ExpiryDraft
      })
      if (!recognized.length) throw new Error('没有识别到可录入的食物，请换个角度再试')
      setDrafts((current) => {
        const first = current[0]
        const blank = current.length === 1 && !first.foodName.trim() && !first.quantityNote.trim() && !first.note.trim()
        return blank ? recognized : [...current, ...recognized]
      })
      setLastRecognizedCount(recognized.length)
    } catch (error) {
      showError('保质期识别失败', error)
    } finally {
      setRecognizing(false)
    }
  }

  const save = async () => {
    if (!filledDrafts.length) {
      Alert.alert('请至少填写 1 项食物')
      return
    }
    setLoading(true)
    try {
      if (route.params?.itemId) {
        const draft = filledDrafts[0]
        await apiClient.updateFoodExpiryItem(route.params.itemId, {
          foodName: draft.foodName,
          category: draft.customCategory.trim() || draft.category,
          expireDate: draft.expireDate,
          quantityNote: draft.quantityNote,
          storageType: draft.storageType,
          note: draft.note,
        })
        Alert.alert('已保存', '保质期记录已更新')
      } else {
        for (const draft of filledDrafts) {
          await apiClient.createFoodExpiryItem({
            foodName: draft.foodName,
            category: draft.customCategory.trim() || draft.category,
            expireDate: draft.expireDate,
            quantityNote: draft.quantityNote,
            storageType: draft.storageType,
            note: draft.note,
            sourceType: draft.sourceType,
          })
        }
        Alert.alert('已保存', `已创建 ${filledDrafts.length} 项提醒`)
      }
      emitFoodExpiryChangedEvent({ force: true })
      navigation.goBack()
    } catch (error) {
      showError('保存保质期失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.expiryEditPage}>
      <ScrollView
        style={styles.expiryEditScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.expiryEditContent, { paddingBottom: 104 + insets.bottom }]}
      >
        {loading && isEditing && drafts[0]?.foodName === '' ? (
          <View style={styles.expiryEditLoading}>
            <ActivityIndicator color="#00bc7d" />
          </View>
        ) : null}

        {!isEditing ? (
          <View style={styles.expiryAiPanel}>
            <View style={styles.expiryAiHead}>
              <View style={styles.flex}>
                <Text style={styles.expiryEditBlockTitle}>拍照识别预填</Text>
                <Text style={styles.expiryAiDesc}>支持一张图里识别多个食物，也支持多张图一起识别。AI 会先帮你填能看出来的信息，剩下的你再补。</Text>
              </View>
              <View style={styles.expiryAiCost}><Text style={styles.expiryAiCostText}>2 积分/次</Text></View>
            </View>
            {images.length ? (
              <View style={styles.expiryImageGrid}>
                {images.map((asset, index) => (
                  <View key={`${asset.uri}-${index}`} style={styles.expiryImageItem}>
                    <Image source={{ uri: asset.uri }} style={styles.expiryImageThumb} />
                    <Pressable style={styles.expiryImageRemove} onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                      <X size={14} color="#fff" />
                    </Pressable>
                  </View>
                ))}
                {images.length < 5 ? <Pressable style={styles.expiryImageAdd} onPress={chooseImageSource}><ImagePlus size={22} color={colors.brand} /><Text style={styles.expiryImageAddText}>继续加图</Text></Pressable> : null}
              </View>
            ) : (
              <Pressable style={styles.expiryUploadArea} onPress={chooseImageSource}>
                <Text style={styles.expiryUploadPlus}>＋</Text>
                <Text style={styles.expiryUploadTitle}>拍照或上传食物</Text>
                <Text style={styles.expiryUploadDesc}>例如冰箱里的牛奶、水果、熟食、剩菜，最多 5 张。</Text>
              </Pressable>
            )}
            <ExpiryEditField
              label="识别补充说明"
              value={recognitionContext}
              onChangeText={setRecognitionContext}
              placeholder="例如：这些都是今晚刚买的 / 里面有已经开封的酸奶 / 左边那盒是冷冻水饺"
              multiline
            />
            <View style={styles.expiryAiActions}>
              <Pressable style={styles.expiryAiGhost} onPress={chooseImageSource}><Text style={styles.expiryAiGhostText}>重新选图</Text></Pressable>
              <Pressable style={styles.expiryAiPrimary} onPress={() => void recognize()}>
                {recognizing ? <ActivityIndicator color="#fff" /> : <Text style={styles.expiryAiPrimaryText}>识别并预填</Text>}
              </Pressable>
            </View>
            {lastRecognizedCount > 0 ? <Text style={styles.expiryAiResult}>刚刚已预填 {lastRecognizedCount} 项，下面缺的信息继续补就行。</Text> : null}
          </View>
        ) : null}

        {!isEditing && drafts.length === 1 && drafts[0].sourceType === 'manual' ? (
          <View style={styles.expiryEditBlock}>
            <Text style={styles.expiryEditBlockTitle}>常用模板</Text>
            <View style={styles.expiryEditPresetList}>
              {expiryEditPresets.map((preset) => (
                <Pressable key={preset.name} style={styles.expiryEditPresetChip} onPress={() => applyPreset(drafts[0].clientId, preset)}>
                  <Text style={styles.expiryEditPresetText}>{preset.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {drafts.map((draft, index) => (
          <ExpiryDraftCard
            key={draft.clientId}
            draft={draft}
            index={index}
            canRemove={!isEditing && drafts.length > 1}
            onChange={(update) => updateDraft(draft.clientId, update)}
            onRemove={() => setDrafts((current) => current.filter((item) => item.clientId !== draft.clientId))}
          />
        ))}
        {!isEditing ? (
          <Pressable style={styles.expiryAddItemBar} onPress={() => setDrafts((current) => [...current, newExpiryDraft()])}>
            <Text style={styles.expiryAddItemText}>＋ 手动再加一项</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={[styles.expiryEditFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          disabled={saveDisabled}
          style={[styles.expiryEditSubmit, saveDisabled && styles.expiryEditSubmitDisabled]}
          onPress={save}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.expiryEditSubmitText, saveDisabled && styles.expiryEditSubmitTextDisabled]}>{isEditing ? '保存修改' : `保存 ${filledDrafts.length || 1} 项提醒`}</Text>}
        </Pressable>
      </View>
    </View>
  )
}

function ExpiryDraftCard({
  draft,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  draft: ExpiryDraft
  index: number
  canRemove: boolean
  onChange: (update: Partial<ExpiryDraft>) => void
  onRemove: () => void
}) {
  const customCategory = !expiryCategoryOptions.includes(draft.category as typeof expiryCategoryOptions[number])
  return (
    <View style={styles.expiryDraftCard}>
      <View style={styles.expiryDraftHead}>
        <View>
          <Text style={styles.expiryDraftTitle}>食物 {index + 1}</Text>
          <Text style={styles.expiryDraftSubtitle}>{draft.sourceType === 'ai' ? 'AI 已预填，缺的信息继续补就可以' : '手动填写一项保质期提醒'}</Text>
        </View>
        <View style={styles.expiryDraftActions}>
          {draft.sourceType === 'ai' ? <Text style={styles.expiryAiBadge}>{draft.confidence != null ? `AI ${Math.round(draft.confidence * 100)}%` : 'AI 识别'}</Text> : null}
          {canRemove ? <Pressable onPress={onRemove}><Text style={styles.expiryDraftRemove}>删除</Text></Pressable> : null}
        </View>
      </View>
      {draft.estimated ? <Text style={styles.expiryDraftTip}>到期日为 AI 建议值{draft.suggestedDays != null ? `（约 ${draft.suggestedDays} 天）` : ''}，建议确认包装日期后再保存。</Text> : null}
      {draft.recognitionBasis ? <Text style={styles.expiryDraftTip}>{draft.recognitionBasis}</Text> : null}
      <View style={styles.expiryDraftInner}>
        <ExpiryEditField label="食物名称" value={draft.foodName} onChangeText={(foodName) => onChange({ foodName })} placeholder="例如 纯牛奶 / 苹果 / 昨晚剩菜" />
      </View>
      <View style={styles.expiryDraftInner}>
        <Text style={styles.expiryEditLabel}>分类</Text>
        <View style={styles.expiryEditChoiceList}>
          {expiryCategoryOptions.map((option) => (
            <Pressable key={option} style={[styles.expiryEditChoiceChip, !customCategory && draft.category === option && styles.expiryEditChoiceChipActive]} onPress={() => onChange({ category: option, customCategory: '' })}>
              <Text style={[styles.expiryEditChoiceText, !customCategory && draft.category === option && styles.expiryEditChoiceTextActive]}>{option}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.expiryEditChoiceChip, customCategory && styles.expiryEditChoiceChipActive]} onPress={() => onChange({ category: draft.customCategory || '自定义' })}>
            <Text style={[styles.expiryEditChoiceText, customCategory && styles.expiryEditChoiceTextActive]}>自定义</Text>
          </Pressable>
        </View>
        {customCategory ? <ExpiryEditField label="" value={draft.customCategory} onChangeText={(customCategoryValue) => onChange({ customCategory: customCategoryValue, category: customCategoryValue || '自定义' })} placeholder="输入自定义分类" /> : null}
      </View>
      <View style={styles.expiryDraftInner}><StorageTypeSegment value={draft.storageType} onChange={(storageType) => onChange({ storageType })} /></View>
      <View style={styles.expiryDraftInner}><ExpiryEditField label="数量说明" value={draft.quantityNote} onChangeText={(quantityNote) => onChange({ quantityNote })} placeholder="例如 2 盒 / 半袋 / 3 个" /></View>
      <View style={styles.expiryDraftInner}><ExpiryEditField label="到期日期" value={draft.expireDate} onChangeText={(expireDate) => onChange({ expireDate })} placeholder="YYYY-MM-DD" /></View>
      <View style={styles.expiryDraftInner}><ExpiryEditField label="备注" value={draft.note} onChangeText={(note) => onChange({ note })} placeholder="例如 已经开封、准备周末吃掉、放在冰箱第二层" multiline /></View>
    </View>
  )
}

function ExpiryEditField({
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
    <View style={styles.expiryEditField}>
      <Text style={styles.expiryEditLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.expiryEditInput, multiline && styles.expiryEditTextarea]}
      />
    </View>
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

function PackagedSection({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return <View style={[styles.packagedMiniCard, style]}>{children}</View>
}

function PackagedInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  style,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: KeyboardTypeOptions
  multiline?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[styles.packagedMiniField, style]}>
      <Text style={styles.packagedMiniFieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.packagedMiniInput, multiline && styles.packagedMiniTextarea]}
      />
    </View>
  )
}

function PackagedActionButton({
  label,
  tone = 'secondary',
  loading,
  disabled,
  onPress,
}: {
  label: string
  tone?: 'primary' | 'secondary' | 'ghost' | 'danger'
  loading?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const inactive = Boolean(loading || disabled)
  return (
    <Pressable
      style={[
        styles.packagedActionButton,
        tone === 'primary' && styles.packagedActionButtonPrimary,
        tone === 'ghost' && styles.packagedActionButtonGhost,
        tone === 'danger' && styles.packagedActionButtonDanger,
        inactive && styles.packagedActionButtonDisabled,
      ]}
      disabled={inactive}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone === 'primary' || tone === 'danger' ? '#fff' : '#16a34a'} />
      ) : (
        <Text
          style={[
            styles.packagedActionButtonText,
            tone === 'primary' && styles.packagedActionButtonPrimaryText,
            tone === 'ghost' && styles.packagedActionButtonGhostText,
            tone === 'danger' && styles.packagedActionButtonPrimaryText,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

function PackagedPhotoSlot({
  label,
  hint,
  image,
  onRemove,
}: {
  label: string
  hint: string
  image?: { localUri?: string; imageUrl: string }
  onRemove: () => void
}) {
  if (image) {
    return (
      <View style={styles.packagedPhotoSlot}>
        <Image source={{ uri: image.localUri || image.imageUrl }} style={styles.packagedPhotoImage} />
        <View style={styles.packagedPhotoShade}>
          <Text style={styles.packagedPhotoLabel}>{label}</Text>
          <Pressable hitSlop={8} onPress={onRemove}>
            <Text style={styles.packagedPhotoRemove}>移除</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.packagedPhotoSlot, styles.packagedPhotoSlotEmpty]}>
      <Text style={styles.packagedPhotoEmptyTitle}>{label}</Text>
      <Text style={styles.packagedPhotoEmptyHint}>{hint}</Text>
    </View>
  )
}

function PackagedInfoCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.packagedInfoCell}>
      <Text style={styles.packagedInfoLabel}>{label}</Text>
      <Text style={styles.packagedInfoValue} numberOfLines={2}>{value || '--'}</Text>
    </View>
  )
}

function PackagedMiniPill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'green' | 'amber' | 'red' }) {
  return (
    <View
      style={[
        styles.packagedMiniPill,
        tone === 'green' && styles.packagedMiniPillGreen,
        tone === 'amber' && styles.packagedMiniPillAmber,
        tone === 'red' && styles.packagedMiniPillRed,
      ]}
    >
      <Text
        style={[
          styles.packagedMiniPillText,
          tone === 'green' && styles.packagedMiniPillTextGreen,
          tone === 'amber' && styles.packagedMiniPillTextAmber,
          tone === 'red' && styles.packagedMiniPillTextRed,
        ]}
      >
        {text}
      </Text>
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
    <View style={styles.expiryEditField}>
      <Text style={styles.expiryEditLabel}>储存方式</Text>
      <View style={styles.expiryEditChoiceList}>
        {expiryStorageOptions.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.expiryEditChoiceChip, value === option.value && styles.expiryEditChoiceChipActive]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.expiryEditChoiceText, value === option.value && styles.expiryEditChoiceTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function dateKeyAfterDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function SmallButton({
  label,
  danger,
  disabled,
  loading,
  onPress,
}: {
  label: string
  danger?: boolean
  disabled?: boolean
  loading?: boolean
  onPress: () => void
}) {
  const inactive = disabled || loading
  return (
    <Pressable
      style={[styles.smallButton, danger && styles.smallButtonDanger, inactive && styles.smallButtonDisabled]}
      disabled={inactive}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator size="small" color={danger ? colors.danger : colors.brandDark} />
      ) : (
        <Text style={[styles.smallButtonText, danger && styles.smallButtonDangerText]}>{label}</Text>
      )}
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
    <View style={styles.campusRecommendSection}>
      <View style={styles.campusSectionHead}>
        <Text style={styles.campusSectionTitle}>{title}</Text>
        <Text style={styles.campusSectionSubtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.campusRecommendScroll}>
        {items.map((item) => (
          <Pressable key={`${title}-${item.id}`} style={styles.campusRecommendCard} onPress={() => onPress(item)}>
            {campusPrimaryImage(item) ? (
              <Image source={{ uri: campusPrimaryImage(item) }} style={styles.campusRecommendImage} />
            ) : (
              <View style={styles.campusRecommendImageFallback}>
                <Text style={styles.campusFoodImageText}>暂无图片</Text>
              </View>
            )}
            <Text style={styles.campusRecommendTitle} numberOfLines={1}>{item.food_name || '校园菜品'}</Text>
            <Text style={styles.itemMeta} numberOfLines={1}>{campusPriceText(item)} · 蛋白 {Math.round(item.total_protein || 0)}g</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

function CampusRecommendationPanel({
  title,
  items,
  formatLine,
  onPress,
}: {
  title: string
  items: PublicFoodItem[]
  formatLine: (item: PublicFoodItem) => string
  onPress: (item: PublicFoodItem) => void
}) {
  if (!items.length) return null
  return (
    <View style={styles.campusRecommendPanel}>
      <Text style={styles.campusRecommendPanelTitle}>{title}</Text>
      {items.slice(0, 3).map((item) => (
        <Pressable key={`${title}-${item.id}`} onPress={() => onPress(item)}>
          <Text style={styles.campusRecommendPanelLine} numberOfLines={1}>{formatLine(item)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function CampusFilterInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string
  onChangeText: (value: string) => void
  placeholder: string
}) {
  return (
    <View style={styles.campusFilterChip}>
      <TextInput
        style={styles.campusFilterInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="done"
      />
    </View>
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

function ManualFoodNutrientTile({
  label,
  value,
  unit,
  featured,
}: {
  label: string
  value: string
  unit: string
  featured?: boolean
}) {
  return (
    <View style={[styles.manualFoodNutrientTile, featured && styles.manualFoodNutrientTileFeatured]}>
      <View style={styles.manualFoodNutrientValueRow}>
        <Text style={[styles.manualFoodNutrientValue, featured && styles.manualFoodNutrientValueFeatured]} numberOfLines={1}>{value}</Text>
        <Text style={[styles.manualFoodNutrientUnit, featured && styles.manualFoodNutrientUnitFeatured]}>{unit}</Text>
      </View>
      <Text style={styles.manualFoodNutrientLabel}>{label}</Text>
    </View>
  )
}

function ManualFoodInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.manualFoodInfoRow}>
      <Text style={styles.manualFoodInfoLabel}>{label}</Text>
      <Text style={styles.manualFoodInfoValue} numberOfLines={2}>{value}</Text>
    </View>
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

function LegalDocumentScreen({
  title,
  updatedAt,
  sections,
}: {
  title: string
  updatedAt: string
  sections: Array<{ title: string; paragraphs: string[] }>
}) {
  return (
    <View style={styles.legalDocumentPage}>
      <ScrollView style={styles.legalDocumentScroll} contentContainerStyle={styles.legalDocumentContentWrap} showsVerticalScrollIndicator={false}>
        <View style={styles.legalDocumentContent}>
          <Text style={styles.legalDocumentTitle}>{title}</Text>
          <Text style={styles.legalDocumentUpdatedAt}>{updatedAt}</Text>
          {sections.map((section) => (
            <View key={section.title} style={styles.legalDocumentSection}>
              <Text style={styles.legalDocumentSectionTitle}>{section.title}</Text>
              {section.paragraphs.map((paragraph, index) => (
                <Text key={`${section.title}-${index}`} style={styles.legalDocumentParagraph}>
                  {paragraph}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
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

function campusAuthorInitial(name: string): string {
  return (String(name || '用户').trim()[0] || '用').toUpperCase()
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
    processing: '处理',
    running: '处理',
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

function manualFoodImageUri(item?: ManualFoodItem): string | undefined {
  const firstPath = Array.isArray(item?.image_paths) ? item?.image_paths.find(Boolean) : undefined
  const value = typeof item?.image_path === 'string' && item.image_path ? item.image_path : firstPath
  if (!value) return undefined
  if (/^(https?:|file:|content:)/i.test(value)) return value
  return undefined
}

function manualFoodSourceLabel(value: unknown): string {
  const key = String(value || 'nutrition_library').trim()
  const labels: Record<string, string> = {
    nutrition_library: '标准食物库',
    custom: '我的自定义食物',
    user_custom: '我的自定义食物',
    manual: '手动录入',
    public_library: '真实餐食',
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

function locationSelectionFromItem(item: LocationSearchPOI, fallbackPromptCity?: string): LocationSelection {
  const lonlat = stringValue(item.lonlat || item.lnglat || item.lonLat)
  const parsed = parseLonLat(lonlat)
  const longitude = numberMaybe(item.location?.lng) ?? numberMaybe(item.longitude) ?? parsed.longitude
  const latitude = numberMaybe(item.location?.lat) ?? numberMaybe(item.latitude) ?? parsed.latitude
  const addressComponent = item.addressComponent || item.address_component
  const province = stringValue(item.province || fieldValue(addressComponent, 'province'))
  const city = stringValue(item.city || fieldValue(addressComponent, 'city') || item.promptCity || fallbackPromptCity)
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
    promptCity: stringValue(item.promptCity || city || fallbackPromptCity) || undefined,
  }
}

function locationPromptCityFromResult(result: LocationSearchResult | null): string {
  if (!result) return ''
  const direct = stringValue(result.promptCity || result.city)
  if (direct) return direct
  const prompt = result.prompt
  if (Array.isArray(prompt)) {
    for (const item of prompt) {
      const admins = fieldValue(item, 'admins')
      if (!Array.isArray(admins)) continue
      for (const admin of admins) {
        const name = stringValue(fieldValue(admin, 'adminName') || fieldValue(admin, 'name'))
        if (name) return name
      }
    }
  }
  const data = result.data as LocationSearchResult | undefined
  if (data && data !== result) return locationPromptCityFromResult(data)
  return ''
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

type TrendKind = RootStackParamList['TrendDetail']['kind']
type TrendHeatVariant = 'water' | 'exercise'

function getTrendTheme(kind: TrendKind): { accent: string; deep: string; soft: string; page: string } {
  if (kind === 'water') {
    return {
      accent: '#5c9ed4',
      deep: '#3278ab',
      soft: 'rgba(92, 158, 212, 0.1)',
      page: '#eef4f7',
    }
  }
  if (kind === 'exercise') {
    return {
      accent: '#f97316',
      deep: '#f97316',
      soft: 'rgba(249, 115, 22, 0.1)',
      page: '#f8fafc',
    }
  }
  return {
    accent: '#5cb896',
    deep: '#3f9474',
    soft: 'rgba(92, 184, 150, 0.1)',
    page: '#f0f3f6',
  }
}

function normalizeTrendRouteDate(value?: string): string {
  const raw = String(value || '').trim()
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return todayKey()
  const [, yearText, monthText, dayText] = matched
  const parsed = new Date(Number(yearText), Number(monthText) - 1, Number(dayText))
  if (Number.isNaN(parsed.getTime())) return todayKey()
  const normalized = todayKey(parsed)
  const today = todayKey()
  if (normalized !== raw || normalized > today) return today
  return normalized
}

function trendHeatLevel(value: number, maxValue: number): number {
  if (value <= 0) return 0
  const ratio = value / Math.max(maxValue, 1)
  if (ratio >= 0.75) return 4
  if (ratio >= 0.45) return 3
  if (ratio >= 0.2) return 2
  return 1
}

function trendHeatCellBackground(value: number, maxValue: number, variant: TrendHeatVariant): string {
  const level = trendHeatLevel(value, maxValue)
  if (variant === 'exercise') {
    if (level === 0) return '#edf0f3'
    if (level === 1) return 'rgba(249, 115, 22, 0.18)'
    if (level === 2) return 'rgba(249, 115, 22, 0.34)'
    if (level === 3) return 'rgba(249, 115, 22, 0.54)'
    return '#f97316'
  }
  if (level === 0) return '#e8edf1'
  if (level === 1) return 'rgba(92, 158, 212, 0.18)'
  if (level === 2) return 'rgba(92, 158, 212, 0.34)'
  if (level === 3) return 'rgba(92, 184, 150, 0.48)'
  return '#5c9ed4'
}

function TrendLineChart({ points, accent, emptyText }: { points: TrendPoint[]; accent: string; emptyText: string }) {
  const values = points
    .map((item) => item.value)
    .filter((value): value is number => value != null && Number.isFinite(value))
  if (values.length === 0) {
    return <Text style={styles.trendHistoryEmpty}>{emptyText}</Text>
  }
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = Math.max(max - min, 0.1)
  const first = points.find((item) => item.value != null && Number.isFinite(item.value || NaN))
  const latest = [...points].reverse().find((item) => item.value != null)
  const chartPoints = points.flatMap((item, index) => {
    if (item.value == null || !Number.isFinite(item.value)) return []
    const x = points.length > 1 ? 4 + (index / (points.length - 1)) * 92 : 50
    const y = 10 + ((max - item.value) / span) * 74
    return [{ date: item.date, value: item.value, x, y }]
  })
  const segments = chartPoints.slice(1).map((item, index) => {
    const previous = chartPoints[index]
    const dx = item.x - previous.x
    const dy = item.y - previous.y
    const heightToWidthRatio = 0.42
    return {
      key: `${previous.date}-${item.date}`,
      left: previous.x,
      top: previous.y,
      width: Math.sqrt(dx * dx + (dy * heightToWidthRatio) * (dy * heightToWidthRatio)),
      angle: Math.atan2(dy * heightToWidthRatio, dx) * (180 / Math.PI),
    }
  })

  return (
    <View style={styles.weightLinePanel}>
      <View style={styles.weightAxisRow}>
        <View style={styles.weightAxisLabels}>
          <Text style={styles.weightAxisLabel}>{formatTrendWeight(max)}</Text>
          <Text style={styles.weightAxisLabel}>{formatTrendWeight(min)}</Text>
        </View>
        <View style={styles.weightLinePlot}>
          <View style={[styles.weightGridLine, styles.weightGridLineTop]} />
          <View style={[styles.weightGridLine, styles.weightGridLineMid]} />
          <View style={[styles.weightGridLine, styles.weightGridLineBottom]} />
          {segments.map((segment) => (
            <View
              key={segment.key}
              style={[
                styles.weightLineSegment,
                {
                  left: `${segment.left}%`,
                  top: `${segment.top}%`,
                  width: `${segment.width}%`,
                  backgroundColor: accent,
                  transform: [{ rotate: `${segment.angle}deg` }],
                },
              ]}
            />
          ))}
          {chartPoints.map((item, index) => (
            <View
              key={item.date}
              style={[
                styles.weightLineDot,
                { left: `${item.x}%`, top: `${item.y}%`, backgroundColor: accent },
                index === chartPoints.length - 1 && styles.weightLineDotLatest,
              ]}
            />
          ))}
        </View>
      </View>
      <View style={styles.weightXAxis}>
        <Text style={styles.weightXAxisLabel}>{first ? formatTrendMonthDay(first.date) : '--'}</Text>
        <Text style={styles.weightXAxisLabel}>{points[Math.floor(points.length / 2)] ? formatTrendMonthDay(points[Math.floor(points.length / 2)].date) : '--'}</Text>
        <Text style={styles.weightXAxisLabel}>{latest ? formatTrendMonthDay(latest.date) : '--'}</Text>
      </View>
      <Text style={styles.weightLineNote}>
        {first && latest ? `${formatTrendMonthDay(first.date)} 到 ${formatTrendMonthDay(latest.date)}：${formatTrendSigned(latest.value! - first.value!, 1)}kg` : emptyText}
      </Text>
    </View>
  )
}

function TrendHeatmap({
  points,
  maxValue,
  selectedDate,
  onSelect,
  variant = 'water',
}: {
  points: TrendPoint[]
  maxValue: number
  selectedDate?: string
  onSelect?: (date: string) => void
  variant?: TrendHeatVariant
}) {
  return (
    <View style={styles.trendHeatmap}>
      {points.map((item) => {
        const value = Number(item.value || 0)
        const level = trendHeatLevel(value, maxValue)
        const selected = selectedDate === item.date
        return (
          <Pressable
            key={item.date}
            style={[
              styles.trendHeatCell,
              { backgroundColor: trendHeatCellBackground(value, maxValue, variant) },
              selected && styles.trendHeatCellSelected,
            ]}
            disabled={!onSelect}
            onPress={() => onSelect?.(item.date)}
          >
            <Text style={[styles.trendHeatDay, level >= 2 && styles.trendHeatDayActive]}>{Number(item.date.slice(8, 10))}</Text>
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
  manualFoodDetailPage: {
    flex: 1,
    backgroundColor: '#f4faf8',
  },
  manualFoodDetailContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  manualFoodDetailSkeleton: {
    gap: 12,
  },
  manualFoodSkeletonHero: {
    height: 132,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.12)',
  },
  manualFoodSkeletonGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  manualFoodSkeletonTile: {
    flex: 1,
    height: 70,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.1)',
  },
  manualFoodSkeletonCard: {
    height: 190,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.1)',
  },
  manualFoodEmptyState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  manualFoodEmptyTitle: {
    color: '#0f172a',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '900',
    marginBottom: 8,
  },
  manualFoodEmptyText: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  manualFoodHeroCard: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.16)',
    shadowColor: '#3a5e4c',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  manualFoodImageWrap: {
    width: 104,
    height: 104,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(92,184,150,0.1)',
  },
  manualFoodImage: {
    width: '100%',
    height: '100%',
  },
  manualFoodImagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(92,184,150,0.1)',
  },
  manualFoodHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  manualFoodBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  manualFoodSourceBadge: {
    maxWidth: 122,
    minHeight: 24,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    backgroundColor: '#ecfdf5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.22)',
  },
  manualFoodSourceBadgeText: {
    color: colors.brandDark,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
  },
  manualFoodPortionPill: {
    flexShrink: 1,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    overflow: 'hidden',
  },
  manualFoodHeroTitle: {
    color: '#0f172a',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  manualFoodHeroMeta: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  manualFoodNutrientGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  manualFoodNutrientTile: {
    flex: 1,
    minHeight: 70,
    justifyContent: 'center',
    paddingHorizontal: 9,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.18)',
  },
  manualFoodNutrientTileFeatured: {
    backgroundColor: '#ecfdf5',
    borderColor: 'rgba(92,184,150,0.24)',
  },
  manualFoodNutrientValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 3,
  },
  manualFoodNutrientValue: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    maxWidth: 48,
  },
  manualFoodNutrientValueFeatured: {
    color: colors.brandDark,
  },
  manualFoodNutrientUnit: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  manualFoodNutrientUnitFeatured: {
    color: colors.brandDark,
  },
  manualFoodNutrientLabel: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '700',
  },
  manualFoodInfoCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#eef2f7',
  },
  manualFoodRecordCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.16)',
  },
  manualFoodSectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  manualFoodSectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  manualFoodSectionHint: {
    flexShrink: 1,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
    fontWeight: '700',
  },
  manualFoodInfoRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2f7',
  },
  manualFoodInfoLabel: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  manualFoodInfoValue: {
    flex: 1,
    color: '#0f172a',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'right',
    fontWeight: '800',
  },
  manualFoodReasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#f4faf8',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.14)',
  },
  manualFoodReasonText: {
    flex: 1,
    color: '#3d6b5b',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  manualFoodMealGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  manualFoodMealChip: {
    width: '31.6%',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  manualFoodMealChipActive: {
    backgroundColor: '#ecfdf5',
    borderColor: colors.brand,
  },
  manualFoodMealText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  manualFoodMealTextActive: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  manualFoodFieldGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  manualFoodField: {
    flex: 1,
  },
  manualFoodFieldLabel: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  manualFoodFieldInput: {
    height: 42,
    borderRadius: 13,
    paddingHorizontal: 12,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.2)',
    fontSize: 14,
    fontWeight: '800',
  },
  manualFoodBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(92,184,150,0.14)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -6 },
    elevation: 4,
  },
  manualFoodBottomSummary: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(92,184,150,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.14)',
  },
  manualFoodBottomTitle: {
    color: '#0f172a',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  manualFoodBottomSub: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
    fontWeight: '700',
  },
  manualFoodSaveButton: {
    minWidth: 142,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 18,
    backgroundColor: colors.brand,
    shadowColor: colors.brandDark,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  manualFoodSaveButtonDisabled: {
    opacity: 0.72,
  },
  manualFoodSaveText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  assistantPage: {
    flex: 1,
    backgroundColor: '#f5fff8',
  },
  assistantContent: {
    padding: 14,
    paddingBottom: 28,
  },
  assistantTopbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  assistantRangePill: {
    flex: 1,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.74)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.18)',
  },
  assistantRangeButton: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  assistantRangeButtonActive: {
    backgroundColor: colors.brand,
    shadowColor: colors.brandDark,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  assistantRangeText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
  },
  assistantRangeTextActive: {
    color: '#ffffff',
  },
  assistantRefreshButton: {
    minWidth: 62,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.74)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.18)',
  },
  assistantRefreshText: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
  assistantStage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  assistantStageBubble: {
    flex: 1,
    minWidth: 0,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.84)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#3a5e4c',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  assistantStageTitle: {
    color: '#17382f',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '900',
  },
  assistantStageCopy: {
    color: 'rgba(23, 56, 47, 0.58)',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  assistantOverviewCard: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.16)',
  },
  assistantMetricTile: {
    flex: 1,
    minHeight: 74,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(238, 248, 235, 0.82)',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  assistantMetricValue: {
    color: colors.brandDark,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
  },
  assistantMetricUnit: {
    color: 'rgba(23, 56, 47, 0.48)',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  assistantMetricLabel: {
    color: '#355247',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
    fontWeight: '800',
  },
  assistantSectionCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.14)',
    shadowColor: '#3a5e4c',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  assistantSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  assistantSectionTitle: {
    color: '#17382f',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  assistantSectionHint: {
    color: 'rgba(23, 56, 47, 0.5)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  assistantActionButton: {
    minWidth: 58,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    backgroundColor: colors.brandDark,
  },
  assistantActionButtonDisabled: {
    opacity: 0.72,
  },
  assistantActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  assistantBubble: {
    padding: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 255, 248, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92, 184, 150, 0.12)',
  },
  assistantBodyText: {
    color: '#355247',
    fontSize: 14,
    lineHeight: 22,
  },
  assistantSubtleText: {
    color: 'rgba(23, 56, 47, 0.52)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  assistantQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  assistantChip: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 13,
    backgroundColor: 'rgba(255, 240, 200, 0.82)',
  },
  assistantChipDisabled: {
    opacity: 0.55,
  },
  assistantChipText: {
    color: 'rgba(128, 91, 22, 0.9)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  assistantFocusCard: {
    marginTop: 2,
    padding: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(238, 248, 235, 0.92)',
  },
  assistantFocusHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  assistantFocusTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  assistantFocusTitle: {
    color: '#17382f',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  assistantFocusScorePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.brand,
  },
  assistantFocusScore: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  assistantFocusDetailBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(92, 184, 150, 0.22)',
  },
  assistantFocusLabel: {
    color: '#17382f',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  assistantFocusDelta: {
    color: colors.brandDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    marginTop: 10,
  },
  assistantDietRecommendationItem: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(92, 184, 150, 0.18)',
  },
  assistantNutritionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  assistantNutritionPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: colors.brandSoft,
  },
  assistantNutritionPillText: {
    color: colors.brandDark,
    fontSize: 11,
    fontWeight: '900',
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
  legalDocumentPage: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  legalDocumentScroll: {
    flex: 1,
  },
  legalDocumentContentWrap: {
    padding: 16,
    paddingBottom: 28,
  },
  legalDocumentContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  legalDocumentTitle: {
    color: '#1e293b',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  legalDocumentUpdatedAt: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    borderStyle: 'dashed',
  },
  legalDocumentSection: {
    marginBottom: 20,
  },
  legalDocumentSectionTitle: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  legalDocumentParagraph: {
    color: '#475569',
    fontSize: 14,
    lineHeight: 25,
    marginBottom: 6,
    textAlign: 'justify',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  bigTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 12,
  },
  bigNumber: {
    color: colors.brandDark,
    fontSize: 28,
    fontWeight: '900',
  },
  score: {
    color: colors.brandDark,
    fontSize: 28,
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
  metabolicPage: {
    flex: 1,
    backgroundColor: '#f0f3f6',
  },
  metabolicScroll: {
    flex: 1,
  },
  metabolicContent: {
    minHeight: '100%',
    paddingHorizontal: 12,
    backgroundColor: '#f0f3f6',
  },
  metabolicHead: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  metabolicHeadRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  metabolicBackButton: {
    width: 32,
    height: 32,
    marginRight: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.22)',
  },
  metabolicTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metabolicTitle: {
    color: '#1f2937',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  metabolicPhysButton: {
    minHeight: 32,
    maxWidth: 126,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.32)',
  },
  metabolicPhysButtonText: {
    color: '#3d8f73',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  metabolicHeadSpacer: {
    width: 32,
  },
  metabolicSummaryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingVertical: 4,
    marginBottom: 14,
  },
  metabolicSummaryCell: {
    flex: 1,
    minHeight: 66,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: 'rgba(248,250,252,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.18)',
  },
  metabolicSummaryLabelRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 5,
  },
  metabolicSummaryIcon: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '900',
  },
  metabolicSummaryLabel: {
    flexShrink: 1,
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  metabolicSummaryMetric: {
    color: '#1f2937',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  metabolicSummaryUnit: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
  },
  metabolicChartWrap: {
    height: 220,
    width: '100%',
    marginTop: 4,
    marginBottom: 10,
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: 'rgba(248,250,252,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.16)',
  },
  metabolicLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  metabolicLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metabolicLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 2,
  },
  metabolicLegendDotAbsorb: {
    backgroundColor: 'rgba(92,184,150,0.88)',
  },
  metabolicLegendDotBurn: {
    backgroundColor: 'rgba(92,158,212,0.9)',
  },
  metabolicLegendDotRef: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(100,116,139,0.65)',
  },
  metabolicLegendDotFat: {
    backgroundColor: 'rgba(229,115,115,0.9)',
  },
  metabolicLegendText: {
    color: '#6b7280',
    fontSize: 11,
    lineHeight: 15,
  },
  metabolicFatExplainer: {
    marginHorizontal: 12,
    marginTop: 2,
    marginBottom: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(254,242,242,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(229,115,115,0.18)',
  },
  metabolicFatExplainerTitle: {
    color: '#b91c1c',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    marginBottom: 5,
  },
  metabolicFatExplainerBody: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 17,
  },
  metabolicDisclaimer: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 6,
    marginBottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(92,184,150,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(92,184,150,0.18)',
  },
  metabolicDisclaimerText: {
    color: '#5cb896',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  metabolicLoadingBox: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metabolicErrorBox: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metabolicRetryButton: {
    minHeight: 34,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  metabolicRetryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  metabolicGateBody: {
    position: 'relative',
    minHeight: 340,
  },
  metabolicGhostLayer: {
    opacity: 0.95,
  },
  metabolicGhostCell: {
    flex: 1,
    minHeight: 66,
    borderRadius: 9,
    backgroundColor: 'rgba(248,250,252,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.14)',
  },
  metabolicGhostChart: {
    height: 220,
    borderRadius: 16,
    backgroundColor: 'rgba(248,250,252,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.14)',
  },
  metabolicGhostLegendRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
  },
  metabolicGhostLegendPill: {
    width: 62,
    height: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(226,232,240,0.9)',
  },
  metabolicGateMask: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 28,
    bottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  metabolicGateTitle: {
    color: '#1f2937',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
    marginBottom: 8,
  },
  metabolicGateDesc: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  metabolicGateCta: {
    minHeight: 34,
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    color: '#fff',
    backgroundColor: colors.brand,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  metabolicModalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.26)',
  },
  metabolicPhysSheet: {
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    backgroundColor: colors.surface,
  },
  metabolicProfileSheet: {
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    backgroundColor: colors.surface,
  },
  metabolicSheetTitle: {
    color: '#1f2937',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    marginBottom: 8,
  },
  metabolicSheetDesc: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 14,
  },
  metabolicPhysRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eef2f4',
  },
  metabolicPhysLabel: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
  },
  metabolicPhysValue: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '900',
  },
  metabolicSheetField: {
    marginBottom: 12,
  },
  metabolicSheetLabel: {
    color: '#374151',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 7,
  },
  metabolicSheetInput: {
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#1f2937',
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    fontSize: 14,
    fontWeight: '700',
  },
  metabolicGenderRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metabolicGenderButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  metabolicGenderButtonActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  metabolicGenderButtonText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '900',
  },
  metabolicGenderButtonTextActive: {
    color: '#fff',
  },
  metabolicSheetHint: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 10,
  },
  metabolicBmrPreview: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(92,184,150,0.09)',
    marginBottom: 14,
  },
  metabolicBmrPreviewText: {
    color: '#3d8f73',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  metabolicSheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  metabolicSheetGhostButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  metabolicSheetGhostText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '900',
  },
  metabolicSheetPrimaryButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 22,
    backgroundColor: colors.brand,
  },
  metabolicSheetPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  locationSearchPage: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  locationMapWrap: {
    height: 190,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#dbe8e1',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  locationMapCanvas: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#dcebe3',
  },
  locationMapRoad: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  locationMapRoadMain: {
    width: 340,
    height: 34,
    left: -42,
    top: 68,
    transform: [{ rotate: '-16deg' }],
  },
  locationMapRoadSecondary: {
    width: 280,
    height: 24,
    right: -34,
    top: 108,
    transform: [{ rotate: '21deg' }],
  },
  locationMapRoadThinA: {
    width: 210,
    height: 12,
    left: 56,
    bottom: 34,
    backgroundColor: 'rgba(255,255,255,0.64)',
    transform: [{ rotate: '9deg' }],
  },
  locationMapRoadThinB: {
    width: 190,
    height: 12,
    right: 76,
    top: 34,
    backgroundColor: 'rgba(255,255,255,0.6)',
    transform: [{ rotate: '-31deg' }],
  },
  locationMapBlockA: {
    position: 'absolute',
    width: 92,
    height: 56,
    left: 32,
    top: 24,
    borderRadius: 14,
    backgroundColor: 'rgba(0,188,125,0.12)',
  },
  locationMapBlockB: {
    position: 'absolute',
    width: 118,
    height: 64,
    right: 34,
    bottom: 26,
    borderRadius: 16,
    backgroundColor: 'rgba(47,128,237,0.1)',
  },
  locationMapBlockC: {
    position: 'absolute',
    width: 78,
    height: 78,
    right: 150,
    top: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(244,183,64,0.12)',
  },
  locationMapCoord: {
    position: 'absolute',
    right: 14,
    top: 12,
    color: 'rgba(15,23,42,0.42)',
    fontSize: 11,
    fontWeight: '700',
  },
  locationMapPin: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 32,
    height: 32,
    marginLeft: -16,
    marginTop: -18,
    borderRadius: 16,
    backgroundColor: 'rgba(0,188,125,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationMapPinInner: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: colors.brand,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  locationMapBadge: {
    position: 'absolute',
    left: 14,
    bottom: 14,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(15,23,42,0.72)',
  },
  locationMapBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  locationPanel: {
    flex: 1,
    minHeight: 0,
    marginTop: -8,
    paddingHorizontal: 12,
    paddingTop: 14,
    backgroundColor: '#fff',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 2,
  },
  locationSearchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  locationSearchInput: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: '#f5f6f8',
    paddingHorizontal: 12,
    color: '#1f2937',
    fontSize: 14,
  },
  locationSearchButton: {
    minWidth: 74,
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  locationSearchButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  locationSelectedCard: {
    minHeight: 72,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: '#ecfdf7',
  },
  locationSelectedCardFilled: {
    backgroundColor: '#e8f8f2',
  },
  locationSelectedLabel: {
    color: colors.brand,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 4,
  },
  locationSelectedText: {
    color: '#8c8c8c',
    fontSize: 13,
    lineHeight: 20,
  },
  locationSelectedTextFilled: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '800',
  },
  locationEmptyCard: {
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#f8fafb',
    borderWidth: 1,
    borderColor: '#e8ecef',
  },
  locationEmptyTitle: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  locationEmptyText: {
    color: '#667085',
    fontSize: 12,
    lineHeight: 18,
  },
  locationResultSection: {
    flex: 1,
    minHeight: 0,
    marginBottom: 14,
  },
  locationResultTitle: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 8,
    paddingLeft: 2,
  },
  locationResultList: {
    maxHeight: 220,
  },
  locationResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8ecef',
    backgroundColor: '#f8fafb',
  },
  locationResultItemActive: {
    borderColor: colors.brand,
    backgroundColor: '#e8f8f2',
  },
  locationResultMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  locationResultIndex: {
    width: 20,
    height: 20,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,188,125,0.12)',
    color: colors.brand,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 20,
  },
  locationResultContent: {
    flex: 1,
    minWidth: 0,
  },
  locationResultName: {
    color: '#1f2937',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
  },
  locationResultAddress: {
    color: '#667085',
    fontSize: 12,
    lineHeight: 18,
  },
  locationResultCoord: {
    color: '#98a2b3',
    fontSize: 11,
    marginTop: 4,
  },
  locationResultAction: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '900',
  },
  locationResultMore: {
    color: '#9ca3af',
    fontSize: 11,
    textAlign: 'center',
    paddingTop: 2,
  },
  locationUseButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brand,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  locationUseButtonDisabled: {
    backgroundColor: '#c9cdd4',
    shadowOpacity: 0,
    elevation: 0,
  },
  locationUseButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
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
  campusCanteenPage: {
    flex: 1,
    backgroundColor: '#f3f8f5',
  },
  campusCanteenScroll: {
    flex: 1,
  },
  campusCanteenContent: {
    paddingBottom: 132,
  },
  campusHero: {
    minHeight: 174,
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 8,
    padding: 16,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#115e59',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 3,
  },
  campusHeroImage: {
    borderRadius: 16,
  },
  campusHeroOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(6, 45, 37, 0.62)',
  },
  campusHeroCopy: {
    flex: 1,
    zIndex: 1,
  },
  campusHeroEyebrow: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 4,
  },
  campusHeroTitle: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    marginBottom: 5,
  },
  campusHeroSubtitle: {
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: 12,
    lineHeight: 17,
  },
  campusHeroUpload: {
    zIndex: 1,
    flexShrink: 0,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  campusHeroUploadText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  campusHeader: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    borderRadius: 14,
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  campusFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  campusFilterChip: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 34,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  campusFilterInput: {
    minHeight: 34,
    paddingVertical: 0,
    color: colors.text,
    fontSize: 14,
  },
  campusFilterInputText: {
    color: colors.text,
    fontSize: 14,
  },
  campusFilterPlaceholder: {
    color: colors.textMuted,
    fontSize: 14,
  },
  campusSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  campusSearchInputWrap: {
    flex: 1,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
  },
  campusSearchIcon: {
    color: colors.textMuted,
    fontSize: 15,
    marginRight: 7,
  },
  campusSearchInput: {
    flex: 1,
    minHeight: 36,
    paddingVertical: 0,
    color: colors.text,
    fontSize: 14,
  },
  campusSearchButton: {
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  campusSearchButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  campusClearButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.brandSoft,
  },
  campusClearButtonText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  campusModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  campusPickerSheet: {
    maxHeight: '72%',
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
  },
  campusPickerTitle: {
    marginBottom: 12,
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  campusPickerList: { maxHeight: 420 },
  campusPickerRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  campusPickerRowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  campusPickerRowMeta: { marginTop: 3, color: colors.textMuted, fontSize: 12 },
  campusSortSection: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  campusSortItem: {
    paddingVertical: 4,
  },
  campusSortText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  campusSortTextActive: {
    color: colors.brand,
    fontWeight: '800',
  },
  campusSortUnderline: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.brand,
    marginTop: 4,
  },
  campusRecommendSection: {
    marginHorizontal: 12,
    marginBottom: 14,
  },
  campusSectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 8,
  },
  campusSectionTitle: {
    color: '#10231e',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },
  campusSectionSubtitle: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  campusRecommendScroll: {
    gap: 9,
    paddingRight: 12,
    paddingBottom: 2,
  },
  campusRecommendCard: {
    width: 110,
    flexShrink: 0,
    borderRadius: 12,
    padding: 7,
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  campusRecommendImage: {
    width: '100%',
    height: 75,
    borderRadius: 9,
    marginBottom: 6,
    backgroundColor: '#eef7f2',
  },
  campusRecommendImageFallback: {
    width: '100%',
    height: 75,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    backgroundColor: colors.brandSoft,
  },
  campusFoodImageText: {
    color: colors.brandDark,
    fontSize: 11,
    fontWeight: '800',
  },
  campusRecommendTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  campusRecommendGrid: {
    flexDirection: 'row',
    gap: 9,
    marginHorizontal: 12,
    marginBottom: 14,
  },
  campusRecommendPanel: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    backgroundColor: colors.surface,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  campusRecommendPanelTitle: {
    color: '#115e59',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
    marginBottom: 6,
  },
  campusRecommendPanelLine: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 3,
  },
  campusLoadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  campusEmptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  campusEmptyIcon: {
    color: '#d1d5db',
    fontSize: 40,
    fontWeight: '900',
    marginBottom: 12,
  },
  campusEmptyText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  campusEmptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: 16,
  },
  campusEmptyButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.brand,
  },
  campusEmptyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  campusListCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  campusListCardPending: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbf7d0',
  },
  campusListCardFailed: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fecaca',
  },
  campusListCardMain: {
    flexDirection: 'row',
    padding: 12,
  },
  campusListImageWrap: {
    width: 90,
    height: 90,
    borderRadius: 8,
    overflow: 'hidden',
    flexShrink: 0,
    marginRight: 12,
    backgroundColor: '#f3f4f6',
  },
  campusListImage: {
    width: '100%',
    height: '100%',
  },
  campusListImagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  campusListImageText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  campusListInfo: {
    flex: 1,
    minWidth: 0,
  },
  campusListTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    marginBottom: 4,
  },
  campusListLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  campusLocationIcon: {
    color: colors.textMuted,
    fontSize: 14,
  },
  campusListLocation: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
  },
  campusListNutritionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  campusListPrice: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  campusStatusPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    color: '#0f766e',
    backgroundColor: '#ecfdf5',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  campusStatusPillFailed: {
    color: '#b91c1c',
    backgroundColor: '#fef2f2',
  },
  campusCalorieBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: colors.brand,
  },
  campusCalorieBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  campusCalorieUnit: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  campusListTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  campusTag: {
    color: colors.textSecondary,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  campusTagFatLoss: {
    color: colors.brand,
    backgroundColor: '#f4faf8',
  },
  campusListFooter: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#f3f4f6',
    gap: 8,
  },
  campusAuthorRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  campusAuthorAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
  },
  campusAuthorAvatarFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  campusAuthorAvatarText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
  },
  campusAuthorName: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
  },
  campusCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  campusCardStat: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  campusRecordButton: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.brand,
  },
  campusRecordButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  campusFabButton: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  campusFabIcon: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '300',
  },
  expiryEditPage: {
    flex: 1,
    backgroundColor: '#f6f8fa',
  },
  expiryEditScroll: {
    flex: 1,
  },
  expiryEditContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  expiryEditHero: {
    borderRadius: 14,
    padding: 16,
    backgroundColor: '#e7faf3',
  },
  expiryEditKicker: {
    color: '#5b7b71',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  expiryEditTitle: {
    marginTop: 5,
    color: '#16332a',
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
  },
  expiryEditDesc: {
    marginTop: 8,
    color: '#61756d',
    fontSize: 12,
    lineHeight: 19,
  },
  expiryEditLoading: {
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  expiryEditBlock: {
    marginTop: 14,
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  expiryAiPanel: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: '#fff',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  expiryAiHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  expiryAiDesc: {
    marginTop: 5,
    color: '#61756d',
    fontSize: 12,
    lineHeight: 19,
  },
  expiryAiCost: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#e7faf3',
  },
  expiryAiCostText: {
    color: '#2d9f78',
    fontSize: 11,
    fontWeight: '800',
  },
  expiryUploadArea: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9ee6cd',
    borderRadius: 12,
    backgroundColor: '#f4fcf9',
  },
  expiryUploadPlus: {
    color: '#00bc7d',
    fontSize: 26,
    lineHeight: 30,
  },
  expiryUploadTitle: {
    color: '#16332a',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
  },
  expiryUploadDesc: {
    marginTop: 4,
    color: '#7b8d86',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  expiryImageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 14,
  },
  expiryImageItem: {
    position: 'relative',
    width: 70,
    height: 70,
  },
  expiryImageThumb: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    backgroundColor: '#eef3f1',
  },
  expiryImageRemove: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.74)',
  },
  expiryImageAdd: {
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9ee6cd',
    borderRadius: 10,
    backgroundColor: '#f4fcf9',
  },
  expiryImageAddText: {
    marginTop: 3,
    color: '#4b7668',
    fontSize: 10,
  },
  expiryAiActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  expiryAiGhost: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#f3f7f5',
  },
  expiryAiGhostText: {
    color: '#567168',
    fontSize: 14,
    fontWeight: '700',
  },
  expiryAiPrimary: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#00bc7d',
  },
  expiryAiPrimaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  expiryAiResult: {
    marginTop: 12,
    padding: 10,
    borderRadius: 9,
    color: '#27765d',
    fontSize: 12,
    lineHeight: 18,
    backgroundColor: '#e7faf3',
  },
  expiryDraftCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fff',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  expiryDraftHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  expiryDraftTitle: {
    color: '#16332a',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '900',
  },
  expiryDraftSubtitle: {
    marginTop: 3,
    color: '#71847d',
    fontSize: 11,
    lineHeight: 17,
  },
  expiryDraftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  expiryAiBadge: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#27765d',
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: '#e7faf3',
  },
  expiryDraftRemove: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  expiryDraftTip: {
    marginBottom: 10,
    padding: 9,
    borderRadius: 8,
    color: '#8a641b',
    fontSize: 11,
    lineHeight: 17,
    backgroundColor: '#fff8e7',
  },
  expiryDraftInner: {
    marginTop: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#edf1ef',
    shadowColor: '#1f2937',
    shadowOpacity: 0.035,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  expiryAddItemBar: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: '#f3f7f5',
  },
  expiryAddItemText: {
    color: '#365a4e',
    fontSize: 14,
    fontWeight: '800',
  },
  expiryEditBlockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  expiryEditBlockTitle: {
    color: '#16332a',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  expiryEditBlockMeta: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  expiryEditPresetList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  expiryEditPresetChip: {
    minHeight: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: '#f4f8f6',
  },
  expiryEditPresetText: {
    color: '#314740',
    fontSize: 13,
    fontWeight: '800',
  },
  expiryEditField: {
    marginTop: 14,
  },
  expiryEditLabel: {
    marginBottom: 8,
    color: '#16332a',
    fontSize: 14,
    fontWeight: '800',
  },
  expiryEditInput: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 12,
    color: '#16332a',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: '#f4f8f6',
  },
  expiryEditTextarea: {
    minHeight: 96,
    paddingTop: 12,
    paddingBottom: 12,
    lineHeight: 20,
  },
  expiryEditChoiceList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  expiryEditChoiceChip: {
    minHeight: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: '#f4f8f6',
  },
  expiryEditChoiceChipActive: {
    backgroundColor: '#00bc7d',
  },
  expiryEditChoiceText: {
    color: '#314740',
    fontSize: 13,
    fontWeight: '800',
  },
  expiryEditChoiceTextActive: {
    color: '#fff',
  },
  expiryEditFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  expiryEditSubmit: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#00bc7d',
    shadowColor: '#00bc7d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 3,
  },
  expiryEditSubmitDisabled: {
    backgroundColor: '#e5e7eb',
    shadowOpacity: 0,
    elevation: 0,
  },
  expiryEditSubmitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  expiryEditSubmitTextDisabled: {
    color: '#9ca3af',
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
  trendRoot: {
    flex: 1,
  },
  trendPage: {
    flex: 1,
  },
  trendContent: {
    padding: 14,
    paddingBottom: 36,
  },
  trendMiniHero: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(31, 41, 55, 0.05)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.06,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  trendMiniKicker: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    marginBottom: 4,
  },
  trendMiniTitle: {
    color: colors.text,
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '900',
  },
  trendMiniHeroValueWrap: {
    flex: 0,
    alignItems: 'flex-end',
    minWidth: 94,
  },
  trendMiniHeroValue: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
  },
  trendMiniHeroValueWater: {
    fontSize: 21,
    lineHeight: 26,
  },
  trendMiniHeroValueExercise: {
    fontSize: 22,
    lineHeight: 27,
  },
  trendMiniHeroUnit: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
    fontWeight: '700',
  },
  trendSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  trendSummaryCard: {
    flexGrow: 0,
    flexBasis: '48.6%',
    minHeight: 64,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(31, 41, 55, 0.05)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  trendSummaryCardExercise: {
    flexBasis: '48.6%',
    minWidth: 0,
  },
  trendSummaryLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  trendSummaryValue: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },
  trendSummaryValueUp: {
    color: '#d45c5c',
  },
  trendSummaryValueDown: {
    color: '#4fbfa0',
  },
  trendMiniCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(31, 41, 55, 0.05)',
    shadowColor: '#1f2937',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  trendSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  trendSectionTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },
  trendCardNote: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  weightLinePanel: {
    marginTop: 12,
  },
  weightAxisRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  weightAxisLabels: {
    width: 30,
    justifyContent: 'space-between',
    paddingTop: 2,
    paddingBottom: 4,
  },
  weightAxisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
  },
  weightLinePlot: {
    position: 'relative',
    flex: 1,
    height: 119,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8e4df',
    overflow: 'visible',
  },
  weightGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#edf3f1',
  },
  weightGridLineTop: {
    top: '10%',
  },
  weightGridLineMid: {
    top: '47%',
  },
  weightGridLineBottom: {
    top: '84%',
  },
  weightLineSegment: {
    position: 'absolute',
    height: 2,
    borderRadius: 999,
    transformOrigin: '0% 50%',
  },
  weightLineDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    marginLeft: -2.5,
    marginTop: -2.5,
    borderRadius: 99,
  },
  weightLineDotLatest: {
    width: 10,
    height: 10,
    marginLeft: -5,
    marginTop: -5,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  weightXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 36,
    marginTop: 5,
  },
  weightXAxisLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  weightLineNote: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  trendHeatmap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 10,
  },
  trendHeatCell: {
    flexBasis: '8.35%',
    aspectRatio: 1,
    minWidth: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendHeatCellSelected: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  trendHeatDay: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
  },
  trendHeatDayActive: {
    color: '#ffffff',
  },
  trendHistoryEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    paddingTop: 14,
  },
  weightTrendMonthGroup: {
    marginTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f4',
  },
  weightTrendMonthHeader: {
    minHeight: 39,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  weightTrendMonthTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  weightTrendMonthMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  weightTrendHistoryRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f4',
    paddingVertical: 6,
  },
  weightTrendDate: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  weightTrendDelta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },
  weightTrendHistorySide: {
    alignItems: 'flex-end',
  },
  weightTrendValue: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
  },
  trendDeletePill: {
    minWidth: 44,
    minHeight: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(212, 92, 92, 0.09)',
  },
  trendDeleteText: {
    color: colors.danger,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
  },
  trendRowMuted: {
    opacity: 0.55,
  },
  trendSelectedDate: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  waterTrendHistoryRow: {
    minHeight: 37,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f4',
    paddingVertical: 6,
  },
  waterTrendHistoryRowSelected: {
    backgroundColor: 'rgba(92, 158, 212, 0.07)',
  },
  waterTrendDate: {
    width: 48,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  waterTrendMain: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  waterTrendSub: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  waterTrendDayDetail: {
    marginTop: 9,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f4',
  },
  waterTrendDetailTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  waterTrendDetailRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  waterTrendDetailAmount: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  exerciseTrendHistoryRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eef2f4',
    paddingVertical: 6,
  },
  exerciseTrendTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  exerciseTrendDate: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  exerciseTrendReason: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  exerciseTrendSide: {
    alignItems: 'flex-end',
  },
  exerciseTrendKcal: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
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
    minHeight: 88,
    paddingTop: 12,
    paddingBottom: 12,
  },
  previewImage: {
    width: '100%',
    height: 210,
    borderRadius: 16,
    marginBottom: 12,
    backgroundColor: colors.surfaceMuted,
  },
  packagedMiniRoot: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  packagedMiniContent: {
    paddingHorizontal: 14,
    gap: 12,
  },
  packagedMiniCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5f2e8',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  packagedEditHero: {
    overflow: 'hidden',
    borderRadius: 18,
    padding: 18,
    backgroundColor: '#ecfdf3',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbf7d0',
  },
  packagedEditKicker: {
    color: '#16a34a',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  packagedEditTitle: {
    marginTop: 6,
    color: '#0f172a',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  packagedEditSubtitle: {
    marginTop: 8,
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  packagedSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  packagedSectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  packagedSectionSubtitle: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  packagedShootCaseList: {
    gap: 8,
  },
  packagedShootCaseCard: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 14,
    padding: 11,
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  packagedShootCaseCardActive: {
    backgroundColor: '#effcf4',
    borderColor: '#86efac',
  },
  packagedShootCaseCount: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
  },
  packagedShootCaseNumber: {
    color: '#15803d',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '900',
  },
  packagedShootCaseUnit: {
    marginTop: -2,
    color: '#16a34a',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '800',
  },
  packagedShootCaseTitle: {
    color: '#0f172a',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '900',
  },
  packagedShootCaseText: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  packagedWarningCard: {
    marginTop: 10,
    borderRadius: 14,
    padding: 11,
    backgroundColor: '#fffbeb',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fde68a',
  },
  packagedWarningText: {
    color: '#92400e',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  packagedSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  packagedSearchInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 13,
    paddingHorizontal: 12,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  packagedSearchButton: {
    width: 72,
  },
  packagedSearchEmpty: {
    marginTop: 10,
    borderRadius: 13,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  packagedSearchEmptyText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  packagedCaptureGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  packagedPhotoSlot: {
    flex: 1,
    aspectRatio: 0.82,
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
  },
  packagedPhotoImage: {
    width: '100%',
    height: '100%',
  },
  packagedPhotoShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
  },
  packagedPhotoLabel: {
    flex: 1,
    color: '#fff',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  packagedPhotoRemove: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  packagedPhotoSlotEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  packagedPhotoEmptyTitle: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textAlign: 'center',
  },
  packagedPhotoEmptyHint: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  packagedUploadActions: {
    marginTop: 10,
    gap: 8,
  },
  packagedManualUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  packagedManualUrlInput: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 11,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  packagedAiCard: {
    marginTop: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#dcfce7',
  },
  packagedAiButtonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  packagedAiButtonItem: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  packagedMiniField: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 132,
  },
  packagedMiniFieldFull: {
    flexBasis: '100%',
  },
  packagedMiniFieldLabel: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    marginBottom: 5,
  },
  packagedMiniInput: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 11,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  packagedMiniTextarea: {
    minHeight: 82,
    paddingTop: 10,
    paddingBottom: 10,
  },
  packagedFormGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  packagedActionButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#ecfdf3',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbf7d0',
  },
  packagedActionButtonPrimary: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  packagedActionButtonGhost: {
    backgroundColor: '#fff',
    borderColor: '#dbe4dd',
  },
  packagedActionButtonDanger: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  packagedActionButtonDisabled: {
    opacity: 0.62,
  },
  packagedActionButtonText: {
    color: '#15803d',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  packagedActionButtonPrimaryText: {
    color: '#fff',
  },
  packagedActionButtonGhostText: {
    color: '#334155',
  },
  packagedResultBanner: {
    marginTop: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bbf7d0',
  },
  packagedResultBannerWarn: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  packagedResultTitle: {
    color: '#14532d',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },
  packagedResultText: {
    marginTop: 4,
    color: '#475569',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  packagedStickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
  },
  packagedStickyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  packagedStickyText: {
    flex: 1,
    minWidth: 0,
  },
  packagedStickyTitle: {
    color: '#0f172a',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  packagedStickySubtitle: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  packagedTaskHero: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: '#16a34a',
  },
  packagedTaskKicker: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  packagedTaskTitle: {
    marginTop: 6,
    color: '#fff',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
  },
  packagedTaskSubtitle: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  packagedTaskHeroMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  packagedTaskHeroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  packagedTaskHeroAction: {
    flexGrow: 1,
    flexBasis: '30%',
  },
  packagedTaskStatusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  packagedTaskStatusText: {
    color: '#fff',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  packagedInfoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  packagedInfoCell: {
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 58,
    borderRadius: 13,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  packagedInfoLabel: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  packagedInfoValue: {
    marginTop: 5,
    color: '#0f172a',
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
  },
  packagedMiniPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#f1f5f9',
  },
  packagedMiniPillGreen: {
    backgroundColor: '#dcfce7',
  },
  packagedMiniPillAmber: {
    backgroundColor: '#fef3c7',
  },
  packagedMiniPillRed: {
    backgroundColor: '#fee2e2',
  },
  packagedMiniPillText: {
    color: '#475569',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  packagedMiniPillTextGreen: {
    color: '#15803d',
  },
  packagedMiniPillTextAmber: {
    color: '#92400e',
  },
  packagedMiniPillTextRed: {
    color: '#b91c1c',
  },
  packagedNutritionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  packagedOcrBox: {
    maxHeight: 160,
    borderRadius: 13,
    padding: 11,
    backgroundColor: '#0f172a',
  },
  packagedOcrText: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600',
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
    fontSize: 22,
  },
  privacySettingsPage: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  privacySettingsScroll: {
    flex: 1,
  },
  privacySettingsContent: {
    minHeight: '100%',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 32,
  },
  privacyLoadingState: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacySettingsGroupTitle: {
    paddingHorizontal: 4,
    marginBottom: 8,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  privacySettingsGroup: {
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  privacySettingRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  privacySettingRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  privacySettingCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  privacySettingTitle: {
    color: '#334155',
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  privacySettingBrief: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  privacySwitchWrap: {
    width: 60,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  privacySwitch: {
    transform: [{ scale: 0.9 }],
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
  userGroupPage: {
    flex: 1,
    backgroundColor: '#eef2f1',
  },
  userGroupBackground: {
    ...StyleSheet.absoluteFill,
  },
  userGroupScrollContent: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 36,
  },
  userGroupHero: {
    paddingHorizontal: 4,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 6,
  },
  userGroupEyebrow: {
    color: '#2f8f6b',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  userGroupHeroTitle: {
    color: '#10201a',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 27,
  },
  userGroupHeroSubtitle: {
    color: '#61716b',
    fontSize: 13,
    lineHeight: 21,
  },
  userGroupQrCard: {
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.1)',
    shadowColor: '#1b4937',
    shadowOpacity: 0.08,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  userGroupQrHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  userGroupQrCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  userGroupQrTitle: {
    color: '#10201a',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
  userGroupQrSubtitle: {
    color: '#66746f',
    fontSize: 12,
    lineHeight: 18,
  },
  userGroupTag: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#e7f8ef',
  },
  userGroupTagText: {
    color: '#2f8f6b',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  userGroupQrFrame: {
    height: 425,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#edf2ef',
    overflow: 'hidden',
    backgroundColor: '#f8faf9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userGroupQrImage: {
    width: '100%',
    height: '100%',
  },
  qrExpiry: {
    color: '#94a3a0',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 9,
  },
  userGroupActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 12,
  },
  userGroupPrimaryAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5cb896',
    shadowColor: '#5cb896',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  userGroupActionDisabled: {
    opacity: 0.72,
  },
  userGroupPrimaryActionText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  userGroupHintCard: {
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(92, 184, 150, 0.1)',
    shadowColor: '#1b4937',
    shadowOpacity: 0.08,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  userGroupHintTitle: {
    color: '#10201a',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
    marginBottom: 5,
  },
  userGroupHintText: {
    color: '#66746f',
    fontSize: 12,
    lineHeight: 20,
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
