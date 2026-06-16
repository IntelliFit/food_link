import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  normalizeInsightText,
  type AnalysisTask,
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
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'
import { formatDateTime, todayKey } from '../utils/date'

const userGroupQr = require('../../assets/community/foodlink-user-group-permanent-20260602.jpg')

const expiryStorageOptions = [
  { value: 'refrigerated', label: '冷藏' },
  { value: 'room_temp', label: '常温' },
  { value: 'frozen', label: '冷冻' },
] as const

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
  const [loading, setLoading] = useState(false)
  const kind = route.params.kind
  const title = kind === 'weight' ? '体重趋势' : kind === 'water' ? '饮水趋势' : '运动趋势'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await apiClient.getBodyMetricsSummary('month')
      setSummary(body)
      if (kind === 'exercise') {
        const logs = await apiClient.getExerciseLogs()
        setExerciseLogs(logs.logs || [])
      }
    } catch (error) {
      showError(`获取${title}失败`, error)
    } finally {
      setLoading(false)
    }
  }, [kind, title])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title={title} subtitle="按月查看趋势明细" refreshing={loading} onRefresh={load}>
      {kind === 'weight' ? (
        <>
          <Card>
            <MetricLine label="最新体重" value={summary?.latest_weight ? `${summary.latest_weight.value} kg` : '--'} />
            <MetricLine label="较上次变化" value={summary?.weight_change != null ? `${summary.weight_change.toFixed(1)} kg` : '--'} />
          </Card>
          {(summary?.weight_entries || []).map((entry) => (
            <Card key={`${entry.id || entry.date}-${entry.value}`}>
              <MetricLine label={entry.date} value={`${entry.value} kg`} />
            </Card>
          ))}
        </>
      ) : null}

      {kind === 'water' ? (
        <>
          <Card>
            <MetricLine label="今日喝水" value={`${Math.round(summary?.today_water?.total || 0)} ml`} />
            <MetricLine label="月均喝水" value={`${Math.round(summary?.avg_daily_water_ml || 0)} ml`} />
            <MetricLine label="记录天数" value={`${summary?.water_recorded_days || 0} 天`} />
          </Card>
          {(summary?.water_daily || []).filter((day) => day.total > 0).map((day) => (
            <Card key={day.date}>
              <MetricLine label={day.date} value={`${Math.round(day.total)} ml`} />
              <Text style={styles.subtitle}>记录 {day.log_items?.length || day.logs?.length || 0} 次</Text>
            </Card>
          ))}
        </>
      ) : null}

      {kind === 'exercise' ? (
        <>
          {exerciseLogs.length === 0 ? <EmptyState text="暂无运动记录" /> : null}
          {exerciseLogs.map((log) => (
            <Card key={log.id}>
              <Text style={styles.itemName}>{log.exercise_desc || log.exercise_type || '运动'}</Text>
              <Text style={styles.subtitle}>{formatDateTime(log.date || log.created_at || '')}</Text>
              <MetricLine label="消耗" value={`${Math.round(log.calories_burned || 0)} kcal`} />
              <MetricLine label="时长" value={`${Math.round(log.duration_min || 0)} 分钟`} />
            </Card>
          ))}
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
  const [loading, setLoading] = useState(false)
  const imageUrls = useMemo(() => sourceImages.map((item) => item.imageUrl).filter(Boolean), [sourceImages])
  const autoIngest = extractResult?.auto_ingest_result

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
        <Text style={styles.sectionTitle}>原始 OCR 摘要</Text>
        <Text style={styles.monoText}>{packaged?.ocr_raw_text || '暂无 OCR 文本'}</Text>
      </Card>
    </Page>
  )
}

export function LocationSearchScreen() {
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<LocationSearchResult | null>(null)
  const [loading, setLoading] = useState(false)

  const search = async () => {
    setLoading(true)
    try {
      setResult(await apiClient.searchLocation(keyword))
    } catch (error) {
      showError('搜索位置失败', error)
    } finally {
      setLoading(false)
    }
  }

  const items = useMemo(() => normalizeLocationItems(result), [result])

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
        </Card>
      ))}
    </Page>
  )
}

export function CampusCanteenScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [items, setItems] = useState<PublicFoodItem[]>([])
  const [schoolName, setSchoolName] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.listPublicFoods({
        limit: 30,
        isCampusFood: true,
        schoolName: schoolName.trim() || undefined,
      })
      setItems(data.list || [])
    } catch (error) {
      showError('获取校园食堂失败', error)
    } finally {
      setLoading(false)
    }
  }, [schoolName])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Page title="校园食堂" subtitle="校园餐、食堂窗口和价格信息" refreshing={loading} onRefresh={load}>
      <Card>
        <Field label="学校筛选" value={schoolName} onChangeText={setSchoolName} />
        <View style={styles.buttonRow}>
          <SmallButton label="搜索" onPress={load} />
          <SmallButton label="补校园餐" onPress={() => navigation.navigate('PublicFoodShare', { mode: 'campus' })} />
        </View>
      </Card>
      {items.length === 0 ? <EmptyState text="暂无校园餐数据" /> : null}
      {items.map((item) => (
        <Pressable key={item.id} onPress={() => navigation.navigate('PublicFoodDetail', { itemId: item.id, isCampus: true })}>
          <Card>
            <Text style={styles.itemName}>{item.food_name}</Text>
            <Text style={styles.subtitle}>{item.school_name || '学校'} · {item.canteen_name || item.window_name || item.merchant_name || '食堂窗口'}</Text>
            <View style={styles.nutritionRow}>
              <Pill text={`${Math.round(item.total_calories || 0)} kcal`} />
              {item.price != null ? <Pill text={`¥${item.price}`} /> : null}
            </View>
          </Card>
        </Pressable>
      ))}
    </Page>
  )
}

export function PrivacySettingsScreen() {
  const [profile, setProfile] = useState<UserInfo | null>(null)
  const [searchable, setSearchable] = useState(false)
  const [publicRecords, setPublicRecords] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getUserProfile()
      setProfile(data)
      setSearchable(Boolean(data.searchable))
      setPublicRecords(Boolean(data.public_records))
    } catch (error) {
      showError('获取隐私设置失败', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setLoading(true)
    try {
      const data = await apiClient.updateUserProfile({
        searchable,
        public_records: publicRecords,
      })
      setProfile(data)
      Alert.alert('已保存', '隐私设置已更新')
    } catch (error) {
      showError('保存隐私设置失败', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Page title="隐私设置" subtitle="控制资料可见性和公开记录" refreshing={loading} onRefresh={load}>
      <Card>
        <Text style={styles.sectionTitle}>{profile?.nickname || '当前账号'}</Text>
        <SwitchLine label="允许被搜索" value={searchable} onValueChange={setSearchable} />
        <SwitchLine label="公开饮食记录" value={publicRecords} onValueChange={setPublicRecords} />
        <AppButton label="保存设置" loading={loading} onPress={save} />
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>说明</Text>
        <RuleLine text="关闭被搜索后，其他用户不能通过昵称或 ID 搜到你。" />
        <RuleLine text="关闭公开记录后，你的饮食记录不会进入公开资料页展示。" />
      </Card>
    </Page>
  )
}

export function MembershipAgreementScreen() {
  return (
    <Page title="会员服务协议" subtitle="会员权益、积分额度和支付说明">
      <LegalCard title="会员权益" text="会员套餐包含每日 AI 积分、识别额度、统计洞察和部分高级功能。具体额度以会员中心展示为准。" />
      <LegalCard title="订单与生效" text="会员中心创建订单后，支付成功并同步订单状态，会员权益会写入账号。跨设备登录同一账号可继续使用。" />
      <LegalCard title="续费与取消" text="自动续费、取消订阅和退款规则按实际支付渠道执行；订单状态会同步到当前账号。" />
      <LegalCard title="服务限制" text="AI 分析结果受图片质量、文字描述和模型稳定性影响；异常订单和积分问题可在关于与反馈页提交。" />
    </Page>
  )
}

export function UserGroupScreen() {
  return (
    <Page title="用户群" subtitle="加入 Food Link 用户交流群">
      <Card>
        <Image source={userGroupQr} style={styles.qrImage} resizeMode="contain" />
        <Text style={styles.bodyText}>扫码加入用户群，反馈识别问题、会员订单、食堂数据和使用体验。</Text>
      </Card>
    </Page>
  )
}

export function FoodLibraryDetailScreen() {
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
      await apiClient.saveManualFoodRecord({
        item,
        mealType,
        date,
        weight: numberOrUndefined(weight),
      })
      Alert.alert('已保存', '饮食记录已写入')
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
  keyboardType,
  multiline,
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad'
  multiline?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholderTextColor={colors.textMuted}
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

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.smallButton} onPress={onPress}>
      <Text style={styles.smallButtonText}>{label}</Text>
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

function LegalCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.bodyText}>{text}</Text>
    </Card>
  )
}

function SwitchLine({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={styles.switchLine}>
      <Text style={styles.itemName}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.brandSoft }}
        thumbColor={value ? colors.brand : colors.textMuted}
      />
    </View>
  )
}

function showError(title: string, error: unknown) {
  Alert.alert(title, error instanceof Error ? error.message : '请稍后重试')
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
    food_text: '文字识别',
    packaged_food: '包装食品识别',
    packaged_nutrition_label: '营养成分表识别',
    nutrition_label: '营养成分表识别',
    exercise_image: '运动截图识别',
  }
  return labels[value || ''] || value || '--'
}

function taskFailureMessage(task?: AnalysisTask | null): string {
  const message = String((task as { error_message?: unknown } | null)?.error_message || '').trim()
  return message || '任务未返回可展示的结果。'
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

function locationText(item: LocationSearchPOI): string {
  const lat = item.location?.lat ?? item.latitude
  const lng = item.location?.lng ?? item.longitude
  if (lat == null || lng == null) return '--'
  return `${lat}, ${lng}`
}

const styles = StyleSheet.create({
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
  nutritionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
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
  smallButtonText: {
    color: colors.brandDark,
    fontWeight: '800',
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
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
})
