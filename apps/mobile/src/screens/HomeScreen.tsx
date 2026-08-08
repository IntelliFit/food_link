import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, ImageBackground, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime, type BodyMetricWaterDay, type BodyMetricWeightEntry, type DietRecommendationResult, type HomeDashboard, type HomeMealItem, type HomeMealRecordEntry, type StatsSummary } from '@food-link/core'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../providers/AuthProvider'
import { apiClient, getStoredUserId } from '../api'
import { FloatingPetCompanion } from '../components/FloatingPetCompanion'
import { HomeMicrosSection } from '../components/HomeMicrosSection'
import { IconfontText } from '../components/Iconfont'
import { RecordActionSheet, type RecordAction } from '../components/RecordActionSheet'
import { SHOW_DEBUG_LOGIN } from '../config'
import { useHomeDashboard } from '../hooks/useHomeDashboard'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { colors, compactFont } from '../theme'
import { formatShortDate, todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'
import { consumeHomeRecordMenuDate, onHomeRecordMenuRequest } from '../utils/home-record-menu'
import {
  dismissHomeBackfillDate,
  getDismissedHomeBackfillDates,
  isAllowedHomeRecordDate,
  isHealthProfileReminderSnoozed,
  isHomeRecordGuideCompleted,
  markHomeRecordGuideCompleted,
  snoozeHealthProfileReminder,
} from '../utils/homeGuidance'
import { getHomePetCollapsed, getHomePetHidden, setHomePetCollapsed as persistHomePetCollapsed } from '../utils/petPreferences'

type TargetField = 'calorieTarget' | 'proteinTarget' | 'carbsTarget' | 'fatTarget'
type TargetForm = Record<TargetField, string>
type MacroKey = 'protein' | 'carbs' | 'fat'
type WeekCell = {
  date: string
  dayName: string
  dayNum: string
  calories: number
  target: number
}
type RecordTone = 'green' | 'blue' | 'gold' | 'purple'
type HomeBannerTone = 'campus' | 'goose' | 'green' | 'gold' | 'blue'
type HomeBanner = {
  key: string
  kicker: string
  title: string
  desc: string
  actionText: string
  tone: HomeBannerTone
  imageUrl?: string
  onPress: () => void
}
type DietRecommendationScene = 'eat_out' | 'cook_home'
type RecordDetailInitialAction = 'edit' | 'share' | 'delete'

const targetFieldMeta: Array<{ key: TargetField; label: string; unit: string; step: number }> = [
  { key: 'calorieTarget', label: '基础摄入目标', unit: 'kcal', step: 100 },
  { key: 'proteinTarget', label: '蛋白质目标', unit: 'g', step: 50 },
  { key: 'carbsTarget', label: '碳水目标', unit: 'g', step: 50 },
  { key: 'fatTarget', label: '脂肪目标', unit: 'g', step: 10 },
]

const recordIconColors: Record<RecordTone, string> = {
  green: colors.brandDark,
  blue: colors.blue,
  gold: colors.warning,
  purple: colors.purple,
}

const macroConfigs: Array<{ key: MacroKey; label: string; color: string; unit: string; iconClass: string }> = [
  { key: 'protein', label: '蛋白质', color: '#5c9ed4', unit: 'g', iconClass: 'iconfont icon-danbaizhi' },
  { key: 'carbs', label: '碳水', color: '#d4ac52', unit: 'g', iconClass: 'iconfont icon-tanshui-dabiao' },
  { key: 'fat', label: '脂肪', color: '#f0985c', unit: 'g', iconClass: 'iconfont icon-zhifangyouheruhuazhifangzhipin' },
]

const CAFETERIA_HERO_BG_URL = 'https://cdn-food-images.coachlink.fit/wechat/cafeteria-hero.jpg'

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { isAuthenticated } = useAuth()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const { isDark } = useColorScheme()
  const [selectedDate, setSelectedDate] = useState(() => todayKey())
  const {
    recordDate,
    dashboard,
    petSummary,
    weekStats,
    bodyMetrics,
    exerciseBurnedKcal,
    loading,
    syncing,
    error,
    loadHome,
  } = useHomeDashboard(selectedDate)
  const [activeBannerIndex, setActiveBannerIndex] = useState(0)
  const [showRecordMenu, setShowRecordMenu] = useState(false)
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [homePetHidden, setHomePetHidden] = useState(false)
  const [homePetCollapsed, setHomePetCollapsed] = useState(false)
  const [nutritionExpanded, setNutritionExpanded] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [showHealthProfilePrompt, setShowHealthProfilePrompt] = useState(false)
  const [showHomeRecordGuide, setShowHomeRecordGuide] = useState(false)
  const [dismissedBackfillDates, setDismissedBackfillDates] = useState<string[]>([])
  const [mealRecordsSheet, setMealRecordsSheet] = useState<HomeMealItem | null>(null)
  const [mealActionRecordId, setMealActionRecordId] = useState('')
  const [dietRecommendationVisible, setDietRecommendationVisible] = useState(false)
  const [dietRecommendationScene, setDietRecommendationScene] = useState<DietRecommendationScene>('eat_out')
  const [dietRecommendationLoading, setDietRecommendationLoading] = useState(false)
  const [dietRecommendationResult, setDietRecommendationResult] = useState<DietRecommendationResult | null>(null)
  const dietRecommendationRequestSeqRef = useRef(0)
  const [targetForm, setTargetForm] = useState<TargetForm>(() => targetFormFromDashboard(null))
  const mealType = inferDefaultMealTypeFromLocalTime()
  const nutritionTarget = dashboard?.nutritionTarget
  const calibrationSuggestion = nutritionTarget?.calibration_suggestion
  const intakeData = dashboard?.intakeData
  const calorieTarget = Math.max(0, Number(intakeData?.target || 0))
  const calorieCurrent = Math.max(0, Number(intakeData?.current || 0))
  const calorieProgress = calorieTarget > 0 ? Math.min(100, Math.max(0, (calorieCurrent / calorieTarget) * 100)) : 0
  const calorieRemaining = Math.max(0, calorieTarget - calorieCurrent)
  const isCalorieOver = calorieTarget > 0 && calorieCurrent > calorieTarget
  const dashboardBusy = loading || syncing

  // 体重/喝水/运动（与微信小程序首页逻辑对齐）
  const weightSummary = useMemo(() => {
    if (!bodyMetrics) return { latestWeight: null as BodyMetricWeightEntry | null, weightChange: null as number | null, hasRecord: false }
    const entries = [...bodyMetrics.weight_entries].sort((a, b) => a.date.localeCompare(b.date))
    const latestEntry = entries.filter((e) => e.date <= recordDate).pop() || null
    const previousEntry = entries.filter((e) => e.date < recordDate).pop() || null
    const weightChange = latestEntry && previousEntry ? latestEntry.value - previousEntry.value : null
    return { latestWeight: latestEntry, weightChange, hasRecord: entries.length > 0 }
  }, [bodyMetrics, recordDate])

  const todayWater = useMemo(() => {
    if (!bodyMetrics) return { date: recordDate, total: 0, logs: [] as number[] }
    const fromDaily = bodyMetrics.water_daily?.find((d) => d.date === recordDate)
    if (fromDaily) return fromDaily
    if (bodyMetrics.today_water?.date === recordDate) return bodyMetrics.today_water
    return { date: recordDate, total: 0, logs: [] as number[] }
  }, [bodyMetrics, recordDate])

  const waterGoalMl = bodyMetrics?.water_goal_ml || 2000
  const waterProgress = useMemo(() => {
    if (waterGoalMl <= 0) return todayWater.total > 0 ? 100 : 0
    return Math.max(0, Number(((todayWater.total / waterGoalMl) * 100).toFixed(1)))
  }, [todayWater.total, waterGoalMl])

  const todayDateKey = useMemo(() => todayKey(), [])
  const weekCells = useMemo(
    () => buildWeekCells(todayDateKey, recordDate, calorieCurrent, calorieTarget, weekStats),
    [todayDateKey, recordDate, calorieCurrent, calorieTarget, weekStats],
  )
  const bannerWidth = Math.max(280, windowWidth - 32)
  const homeBanners: HomeBanner[] = [
    {
      key: 'goose-duck-chicken',
      kicker: '鹅腿阿姨热点识别',
      title: '鹅腿、鸭腿，还是鸡腿？',
      desc: '上传一张图片，只围绕鹅 / 鸭 / 鸡做判断',
      actionText: '去识别',
      tone: 'goose',
      onPress: () => navigation.navigate('GooseDuckChicken'),
    },
    {
      key: 'campus',
      kicker: '食探校园活动',
      title: '食探校园食堂计划',
      desc: '一起补全食堂菜品、价格、窗口和营养信息',
      actionText: '去看看',
      tone: 'campus',
      imageUrl: CAFETERIA_HERO_BG_URL,
      onPress: () => navigation.navigate('CampusCanteen'),
    },
    {
      key: 'reward',
      kicker: '今日任务',
      title: '赚积分换权益',
      desc: '上传、打卡和反馈都能积累奖励积分',
      actionText: '去赚',
      tone: 'green',
      onPress: () => navigation.navigate('RewardCenter'),
    },
    {
      key: 'feedback',
      kicker: '帮助食探成长',
      title: '意见反馈',
      desc: '遇到体验问题可以直接反馈给我们',
      actionText: '去反馈',
      tone: 'gold',
      onPress: () => navigation.navigate('AboutFeedback'),
    },
  ]

  const openAnalyze = useCallback((source: 'camera' | 'library') => {
    navigation.navigate('Analyze', { source, mealType, date: recordDate })
  }, [navigation, mealType, recordDate])

  const openRecordMenuFromRequest = useCallback(() => {
    void consumeHomeRecordMenuDate().then((pendingDate) => {
      if (pendingDate === null) return
      if (pendingDate) {
        setSelectedDate(pendingDate)
      }
      setShowRecordMenu(true)
    })
  }, [])

  const handleSelectRecordAction = useCallback((action: RecordAction) => {
    setShowRecordMenu(false)
    if (!isAuthenticated) {
      void navigation.getParent()?.navigate('Login')
      return
    }
    if (action === 'camera' || action === 'library') {
      openAnalyze(action)
      return
    }
    if (action === 'text') {
      navigation.navigate('TextRecord', { date: recordDate, mealType })
      return
    }
    if (action === 'manual') {
      navigation.navigate('ManualRecord', { date: recordDate, mealType })
      return
    }
    if (action === 'recipes') {
      navigation.navigate('Recipes')
      return
    }
    navigation.navigate('AnalyzeHistory')
  }, [isAuthenticated, mealType, navigation, openAnalyze, recordDate])

  useEffect(() => onHomeRecordMenuRequest(openRecordMenuFromRequest), [openRecordMenuFromRequest])

  useEffect(() => {
    if (!showTargetEditor) {
      setTargetForm(targetFormFromDashboard(dashboard))
    }
  }, [dashboard, showTargetEditor])

  useFocusEffect(
    useCallback(() => {
      openRecordMenuFromRequest()
    }, [openRecordMenuFromRequest]),
  )

  useFocusEffect(
    useCallback(() => {
      let active = true
      void Promise.all([getHomePetHidden(), getHomePetCollapsed()]).then(([hidden, collapsed]) => {
        if (!active) return
        setHomePetHidden(hidden)
        setHomePetCollapsed(collapsed)
      })
      return () => {
        active = false
      }
    }, []),
  )

  useFocusEffect(
    useCallback(() => {
      let active = true
      if (!isAuthenticated) {
        setCurrentUserId('')
        setShowHealthProfilePrompt(false)
        setShowHomeRecordGuide(false)
        setDismissedBackfillDates([])
        return () => {
          active = false
        }
      }

      void (async () => {
        try {
          const userId = String(await getStoredUserId() || '').trim()
          if (!active || !userId) return
          const [snoozed, dismissedDates, guideCompleted, profile] = await Promise.all([
            isHealthProfileReminderSnoozed(userId),
            getDismissedHomeBackfillDates(userId),
            isHomeRecordGuideCompleted(userId),
            apiClient.getHealthProfile().catch(() => null),
          ])
          if (!active) return
          setCurrentUserId(userId)
          setDismissedBackfillDates(dismissedDates)
          setShowHomeRecordGuide(!guideCompleted)
          setShowHealthProfilePrompt(Boolean(profile && !isHealthProfileCompleted(profile) && !snoozed))
        } catch {
          if (!active) return
          setShowHealthProfilePrompt(false)
          setShowHomeRecordGuide(false)
        }
      })()

      return () => {
        active = false
      }
    }, [isAuthenticated]),
  )

  const dismissHealthProfilePrompt = useCallback(async () => {
    if (!currentUserId) return
    await snoozeHealthProfileReminder(currentUserId)
    setShowHealthProfilePrompt(false)
  }, [currentUserId])

  const finishHomeRecordGuide = useCallback(async (openMenu: boolean) => {
    if (currentUserId) await markHomeRecordGuideCompleted(currentUserId)
    setShowHomeRecordGuide(false)
    if (openMenu) setShowRecordMenu(true)
  }, [currentUserId])

  const openMealRecordActions = useCallback((recordId: string) => {
    const normalized = String(recordId || '').trim()
    if (!normalized) {
      navigation.navigate('AnalyzeHistory')
      return
    }
    setMealRecordsSheet(null)
    setMealActionRecordId(normalized)
  }, [navigation])

  const handleOpenMeal = useCallback((meal: HomeMealItem) => {
    const entries = getMealRecordEntries(meal)
    if (entries.length > 1) {
      setMealRecordsSheet(meal)
      return
    }
    openMealRecordActions(entries[0]?.id || meal.primary_record_id || meal.primaryRecordId || '')
  }, [openMealRecordActions])

  const openRecordDetailAction = useCallback((initialAction?: RecordDetailInitialAction) => {
    if (!mealActionRecordId) return
    const recordId = mealActionRecordId
    setMealActionRecordId('')
    navigation.navigate('RecordDetail', { recordId, initialAction })
  }, [mealActionRecordId, navigation])

  const buildDietRecommendationPayload = useCallback((scene: DietRecommendationScene) => {
    const macros = intakeData?.macros
    const proteinCurrent = Number(macros?.protein?.current || 0)
    const proteinTarget = Number(macros?.protein?.target || 0)
    const carbsCurrent = Number(macros?.carbs?.current || 0)
    const carbsTarget = Number(macros?.carbs?.target || 0)
    const fatCurrent = Number(macros?.fat?.current || 0)
    const fatTarget = Number(macros?.fat?.target || 0)
    const remaining = Math.max(0, Number((calorieTarget - calorieCurrent).toFixed(1)))
    return {
      scene,
      date: recordDate,
      calorie_remaining: remaining,
      macro_gaps: {
        calories: remaining,
        protein: Math.max(0, Number((proteinTarget - proteinCurrent).toFixed(1))),
        carbs: Math.max(0, Number((carbsTarget - carbsCurrent).toFixed(1))),
        fat: Math.max(0, Number((fatTarget - fatCurrent).toFixed(1))),
      },
      targets: {
        calories: calorieTarget,
        protein: proteinTarget,
        carbs: carbsTarget,
        fat: fatTarget,
      },
      current: {
        calories: calorieCurrent,
        protein: proteinCurrent,
        carbs: carbsCurrent,
        fat: fatCurrent,
      },
      meals: (dashboard?.meals || []).map((meal) => ({
        type: meal.type,
        name: meal.name,
        description: meal.description || '',
        calories: Number(meal.calorie || 0),
        protein: Number(meal.protein || 0),
        carbs: Number(meal.carbs || 0),
        fat: Number(meal.fat || 0),
      })),
    }
  }, [calorieCurrent, calorieTarget, dashboard?.meals, intakeData?.macros, recordDate])

  const requestDietRecommendation = useCallback(async (scene: DietRecommendationScene) => {
    if (!isAuthenticated) {
      void navigation.getParent()?.navigate('Login')
      return
    }
    setDietRecommendationScene(scene)
    setDietRecommendationVisible(true)
    setDietRecommendationLoading(true)
    const requestSeq = ++dietRecommendationRequestSeqRef.current
    try {
      const result = await apiClient.generateDietRecommendation(buildDietRecommendationPayload(scene))
      if (requestSeq === dietRecommendationRequestSeqRef.current) setDietRecommendationResult(result)
    } catch (err) {
      if (requestSeq === dietRecommendationRequestSeqRef.current) {
        setDietRecommendationVisible(false)
        void dialog.alert('生成推荐失败', userFacingErrorMessage(err), 'danger')
      }
    } finally {
      if (requestSeq === dietRecommendationRequestSeqRef.current) setDietRecommendationLoading(false)
    }
  }, [buildDietRecommendationPayload, dialog, isAuthenticated, navigation])

  const openTargetEditor = useCallback(() => {
    setTargetForm(targetFormFromDashboard(dashboard))
    setShowTargetEditor(true)
    apiClient.getDashboardTargets()
      .then((targets) => setTargetForm(targetFormFromTargets(targets, dashboard)))
      .catch(() => undefined)
  }, [dashboard])

  const updateTargetField = useCallback((key: TargetField, value: string) => {
    setTargetForm((current) => ({ ...current, [key]: value.replace(/[^\d.]/g, '') }))
  }, [])

  const adjustTargetField = useCallback((key: TargetField, direction: -1 | 1) => {
    const meta = targetFieldMeta.find((item) => item.key === key)
    const step = meta?.step || 10
    setTargetForm((current) => ({
      ...current,
      [key]: formatTargetNumber(Math.max(0, numberFrom(current[key], 0) + step * direction)),
    }))
  }, [])

  const applyCalibrationSuggestion = useCallback(() => {
    const suggestedKcal = numberFrom(calibrationSuggestion?.suggested_kcal, 0)
    if (!suggestedKcal) return
    const currentTargets = parseTargetForm(targetForm) || parseTargetForm(targetFormFromDashboard(dashboard))
    if (!currentTargets) return
    const currentKcal = currentTargets.calorie_target > 0 ? currentTargets.calorie_target : suggestedKcal
    const ratio = currentKcal > 0 ? suggestedKcal / currentKcal : 1
    setTargetForm({
      calorieTarget: formatTargetNumber(suggestedKcal),
      proteinTarget: formatTargetNumber(currentTargets.protein_target * ratio),
      carbsTarget: formatTargetNumber(currentTargets.carbs_target * ratio),
      fatTarget: formatTargetNumber(currentTargets.fat_target * ratio),
    })
  }, [calibrationSuggestion?.suggested_kcal, dashboard, targetForm])

  const saveTargets = useCallback(async () => {
    const payload = parseTargetForm(targetForm)
    if (!payload) {
      void dialog.alert('请填写完整的数字目标', undefined, 'warning')
      return
    }
    const validationError = validateTargetPayload(payload)
    if (validationError) {
      void dialog.alert('目标范围不正确', validationError, 'warning')
      return
    }
    setSavingTargets(true)
    try {
      await apiClient.updateDashboardTargets({
        ...payload,
        target_date: recordDate,
      })
      setShowTargetEditor(false)
      await loadHome()
      void dialog.alert('基础目标已更新', undefined, 'success')
    } catch (err) {
      void dialog.alert('保存失败', userFacingErrorMessage(err), 'danger')
    } finally {
      setSavingTargets(false)
    }
  }, [dialog, loadHome, recordDate, targetForm])

  const updateHomePetCollapsed = useCallback((collapsed: boolean) => {
    setHomePetCollapsed(collapsed)
    void persistHomePetCollapsed(collapsed)
  }, [])

  const showBackfillHint = isAuthenticated
    && isAllowedHomeRecordDate(recordDate)
    && recordDate !== todayDateKey
    && !dashboardBusy
    && !dismissedBackfillDates.includes(recordDate)

  const dismissBackfillHint = useCallback(async () => {
    if (!currentUserId) return
    const confirmed = await dialog.confirm({
      title: '取消补录提醒',
      message: '取消后，这一天的补录提醒将不再显示。仍可随时通过首页记录入口补录历史餐食。',
      cancelText: '继续保留',
      confirmText: '确认取消',
    })
    if (!confirmed) return
    setDismissedBackfillDates(await dismissHomeBackfillDate(currentUserId, recordDate))
  }, [currentUserId, dialog, recordDate])

  const dynamicStyles = useHomeDynamicStyles(isDark)
  const themeColors = useHomeThemeColors(isDark)

  return (
    <View style={[styles.homeRoot, { backgroundColor: themeColors.background }]}>
      <View pointerEvents="none" style={styles.homeBackgroundLayer}>
        <View style={[styles.homeBackgroundTopTint, { backgroundColor: themeColors.backgroundTopTint }]} />
        <View style={[styles.homeBackgroundSoftTint, { backgroundColor: themeColors.backgroundSoftTint }]} />
      </View>
      <ScrollView
        style={styles.homeScroll}
        contentContainerStyle={[
          styles.homeContent,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 132 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadHome}
            tintColor={colors.brand}
            colors={[colors.brand]}
            title=""
            titleColor="transparent"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <HomeGreeting recordDate={recordDate} mealType={mealType} themeColors={themeColors} />
        {showHealthProfilePrompt ? (
          <HomeHealthProfilePrompt
            themeColors={themeColors}
            onOpen={() => {
              setShowHealthProfilePrompt(false)
              navigation.navigate('HealthProfile')
            }}
            onSnooze={() => void dismissHealthProfilePrompt()}
          />
        ) : null}
        <HomeDateSelector cells={weekCells} selectedDate={recordDate} onSelect={setSelectedDate} themeColors={themeColors} />
        {showHomeRecordGuide ? (
          <HomeFirstRecordGuide
            themeColors={themeColors}
            onStart={() => void finishHomeRecordGuide(true)}
            onSkip={() => void finishHomeRecordGuide(false)}
          />
        ) : null}
        {error ? <Text style={[styles.error, { color: themeColors.danger }]}>{error}</Text> : null}
        <HomeBannerCarousel
          banners={homeBanners}
          activeIndex={activeBannerIndex}
          bannerWidth={bannerWidth}
          onIndexChange={setActiveBannerIndex}
          themeColors={themeColors}
        />
        {showBackfillHint ? (
          <HomeBackfillHint
            themeColors={themeColors}
            onRecord={() => setShowRecordMenu(true)}
            onDismiss={() => void dismissBackfillHint()}
          />
        ) : null}
        <HomeCalorieCard
          current={calorieCurrent}
          target={calorieTarget}
          remaining={calorieRemaining}
          progress={calorieProgress}
          isOver={isCalorieOver}
          intakeData={intakeData}
          onOpenTargetEditor={openTargetEditor}
          nutritionExpanded={nutritionExpanded}
          onToggleNutrition={() => setNutritionExpanded((v) => !v)}
          isDark={isDark}
          themeColors={themeColors}
        />
        <HomeDietRecommendationEntry
          remaining={calorieRemaining}
          busy={dashboardBusy}
          themeColors={themeColors}
          onEatOut={() => void requestDietRecommendation('eat_out')}
          onCookHome={() => void requestDietRecommendation('cook_home')}
        />
        <HomeBodyStatusStrip
          weightSummary={weightSummary}
          todayWater={todayWater}
          waterGoalMl={waterGoalMl}
          waterProgress={waterProgress}
          exerciseKcal={Math.round(exerciseBurnedKcal || 0)}
          onWeight={() => navigation.navigate('BodyMetricRecord', { type: 'weight', date: recordDate })}
          onWater={() => navigation.navigate('BodyMetricRecord', { type: 'water', date: recordDate })}
          onExercise={() => navigation.navigate('BodyMetricRecord', { type: 'exercise', date: recordDate })}
          themeColors={themeColors}
        />
        <HomeMealsSection
          meals={dashboard?.meals || []}
          onOpenAll={() => navigation.navigate('DayRecord', { date: recordDate })}
          onQuickRecord={() => openAnalyze('camera')}
          onOpenHistory={() => navigation.navigate('AnalyzeHistory')}
          onOpenMeal={handleOpenMeal}
          isDark={isDark}
          themeColors={themeColors}
        />
        <HomeExpirySection
          summary={dashboard?.expirySummary || null}
          themeColors={themeColors}
          onOpen={() => navigation.navigate('Expiry')}
        />
        <HomeStatsEntry onPress={() => navigation.navigate('DayRecord', { date: recordDate })} />
        {SHOW_DEBUG_LOGIN ? (
          <View style={styles.homeDevActions}>
            <HomeMiniAction label="识别记录" onPress={() => navigation.navigate('AnalyzeHistory')} themeColors={themeColors} />
            <HomeMiniAction label="文字记录" onPress={() => navigation.navigate('TextRecord')} themeColors={themeColors} />
            <HomeMiniAction label="包装食品" onPress={() => navigation.navigate('PackagedFoodEdit')} themeColors={themeColors} />
          </View>
        ) : null}
      </ScrollView>
      <Modal visible={showTargetEditor} transparent animationType="slide" onRequestClose={() => !savingTargets && setShowTargetEditor(false)}>
        <View style={styles.targetModal}>
          <Pressable style={styles.targetModalMask} onPress={() => !savingTargets && setShowTargetEditor(false)} />
          <View style={[styles.targetModalSheet, { paddingBottom: insets.bottom + 18, backgroundColor: themeColors.sheetBackground }]}>
            <View style={[styles.targetModalHandle, { backgroundColor: themeColors.handle }]} />
            <View style={styles.rowBetween}>
              <View>
                <Text style={[styles.targetModalTitle, { color: themeColors.text }]}>基础目标设置</Text>
                <Text style={[styles.targetModalDesc, { color: themeColors.textSecondary }]}>同步首页与单日记录的长期目标</Text>
              </View>
              <Pressable onPress={() => setShowTargetEditor(false)} disabled={savingTargets} style={[styles.targetModalClose, { backgroundColor: themeColors.closeButton }]}>
                <Text style={[styles.targetModalCloseText, { color: themeColors.textSecondary }]}>×</Text>
              </Pressable>
            </View>
            {calibrationSuggestion?.available ? (
              <View style={[styles.calibrationCard, { backgroundColor: themeColors.calibrationCard }]}>
                <Text style={styles.calibrationTitle}>建议调整到 {Math.round(numberFrom(calibrationSuggestion.suggested_kcal, 0))} kcal</Text>
                <Text style={[styles.calibrationText, { color: themeColors.textSecondary }]}>{calibrationSuggestion.reason || '根据最近 14 天饮食和体重变化，建议小幅调整基础目标。'}</Text>
                <View style={styles.targetActionRow}>
                  <Pressable style={[styles.secondaryMiniButton, { backgroundColor: themeColors.surfaceMuted }]} onPress={() => void dialog.alert('已暂不调整')}>
                    <Text style={[styles.secondaryMiniButtonText, { color: themeColors.textSecondary }]}>暂不调整</Text>
                  </Pressable>
                  <Pressable style={styles.primaryMiniButton} onPress={applyCalibrationSuggestion}>
                    <Text style={styles.primaryMiniButtonText}>应用建议</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {targetFieldMeta.map((field) => (
              <TargetFieldRow
                key={field.key}
                label={field.label}
                unit={field.unit}
                value={targetForm[field.key]}
                onChangeText={(value) => updateTargetField(field.key, value)}
                onDecrease={() => adjustTargetField(field.key, -1)}
                onIncrease={() => adjustTargetField(field.key, 1)}
                themeColors={themeColors}
              />
            ))}
            <View style={styles.targetSaveRow}>
              <Pressable style={[styles.targetSaveButton, savingTargets && styles.disabledButton]} disabled={savingTargets} onPress={() => void saveTargets()}>
                {savingTargets ? <ActivityIndicator color="#fff" /> : <Text style={styles.targetSaveButtonText}>保存目标</Text>}
              </Pressable>
              <Pressable style={[styles.targetCancelButton, { backgroundColor: themeColors.cancelButton }]} disabled={savingTargets} onPress={() => setShowTargetEditor(false)}>
                <Text style={[styles.targetCancelButtonText, { color: themeColors.textSecondary }]}>取消</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <HomeMealRecordsSheet
        meal={mealRecordsSheet}
        themeColors={themeColors}
        onClose={() => setMealRecordsSheet(null)}
        onSelect={openMealRecordActions}
      />
      <HomeMealActionSheet
        visible={Boolean(mealActionRecordId)}
        themeColors={themeColors}
        onClose={() => setMealActionRecordId('')}
        onView={() => openRecordDetailAction()}
        onEdit={() => openRecordDetailAction('edit')}
        onShare={() => openRecordDetailAction('share')}
        onDelete={() => openRecordDetailAction('delete')}
      />
      <HomeDietRecommendationSheet
        visible={dietRecommendationVisible}
        scene={dietRecommendationScene}
        loading={dietRecommendationLoading}
        result={dietRecommendationResult}
        themeColors={themeColors}
        bottomInset={insets.bottom}
        onClose={() => setDietRecommendationVisible(false)}
        onChangeScene={(scene) => {
          if (scene !== dietRecommendationScene || !dietRecommendationResult) void requestDietRecommendation(scene)
        }}
        onRefresh={() => void requestDietRecommendation(dietRecommendationScene)}
      />
      <RecordActionSheet
        visible={showRecordMenu}
        onClose={() => setShowRecordMenu(false)}
        onSelect={handleSelectRecordAction}
      />
      {petSummary && !homePetHidden ? (
        <FloatingPetCompanion
          summary={petSummary}
          collapsed={homePetCollapsed}
          onCollapsedChange={updateHomePetCollapsed}
          onOpenHome={() => navigation.navigate('PetHome')}
          onOpenChat={() => navigation.navigate('PetChat')}
        />
      ) : null}
    </View>
  )
}

function useHomeThemeColors(isDark: boolean) {
  return useMemo(
    () => ({
      background: isDark ? '#0d1312' : colors.background,
      backgroundTopTint: isDark ? '#111a18' : '#eaf7f0',
      backgroundSoftTint: isDark ? 'rgba(92, 184, 150, 0.03)' : 'rgba(92, 184, 150, 0.04)',
      text: isDark ? '#f2f7f4' : colors.text,
      textSecondary: isDark ? '#a3b3ad' : colors.textSecondary,
      textMuted: isDark ? '#6b7d76' : colors.textMuted,
      surface: isDark ? '#181f1d' : colors.surface,
      surfaceMuted: isDark ? '#1e2623' : colors.surfaceMuted,
      border: isDark ? 'rgba(255,255,255,0.08)' : colors.border,
      cardBackground: isDark ? '#181f1d' : '#fff',
      cardBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(227, 233, 238, 0.82)',
      bodyStatusCard: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.54)',
      bodyStatusCardBorder: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.62)',
      emptyMealCard: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.54)',
      emptyMealCardBorder: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.62)',
      mealCard: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.56)',
      mealCardBorder: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.62)',
      mealCardWarningBorder: isDark ? 'rgba(229, 115, 115, 0.32)' : 'rgba(229, 115, 115, 0.32)',
      mealCardWarningBg: isDark ? 'rgba(239, 68, 68, 0.10)' : '#fef8f8',
      macroCard: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
      macroCardOver: isDark ? 'rgba(239, 68, 68, 0.14)' : '#fef3f2',
      macroCardOverBorder: isDark ? 'rgba(239, 68, 68, 0.35)' : '#fecaca',
      progressTrack: isDark ? 'rgba(255,255,255,0.10)' : '#e5e7eb',
      mealProgressTrack: isDark ? 'rgba(255,255,255,0.10)' : '#eef2f4',
      nutritionTitle: isDark ? '#b9c9c2' : '#34495e',
      nutritionAffordanceBg: isDark ? 'rgba(92, 184, 150, 0.12)' : '#f3f8f5',
      nutritionAffordanceText: isDark ? '#7dd3aa' : '#5aa783',
      bannerGoose: isDark ? '#2a1e12' : '#fff3e3',
      bannerGreen: isDark ? '#0f261c' : '#e9fbf3',
      bannerGold: isDark ? '#261d10' : '#fff7ed',
      bannerBlue: isDark ? '#0f1f2a' : '#edf7ff',
      bannerTextLight: isDark ? '#fff' : '#fff',
      sheetBackground: isDark ? '#181f1d' : '#fff',
      handle: isDark ? 'rgba(255,255,255,0.12)' : '#e5e7eb',
      closeButton: isDark ? 'rgba(255,255,255,0.10)' : '#f3f4f6',
      cancelButton: isDark ? 'rgba(255,255,255,0.10)' : '#f3f4f6',
      calibrationCard: isDark ? 'rgba(240, 152, 92, 0.14)' : '#fff7ed',
      dateSelectedBg: isDark ? 'rgba(0, 188, 125, 0.45)' : 'rgba(0, 188, 125, 0.55)',
      dateCircle: isDark ? '#181f1d' : '#fff',
      dateText: isDark ? '#f2f7f4' : colors.text,
      dateTextMuted: isDark ? '#6b7d76' : colors.textMuted,
      danger: isDark ? '#ff6b6b' : colors.danger,
      over: isDark ? '#ff6b6b' : colors.homeWarningRed,
      overText: isDark ? '#ff6b6b' : 'colors.homeWarningRed',
      bodyStatusChangeDown: isDark ? '#7dd3aa' : '#5cb896',
      mealIconBg: isDark ? 'rgba(92, 184, 150, 0.12)' : '#ecfdf5',
      mealPhotoBg: isDark ? 'rgba(255,255,255,0.08)' : '#f3f4f6',
      mealIconText: isDark ? '#7dd3aa' : colors.brand,
      expiryCard: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.54)',
      expiryCardBorder: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.62)',
      expiryPillBg: isDark ? 'rgba(255,255,255,0.08)' : '#f8fafc',
      miniActionBg: isDark ? 'rgba(255,255,255,0.08)' : '#fff',
      miniActionText: isDark ? '#7dd3aa' : colors.brandDark,
    }),
    [isDark],
  )
}

function useHomeDynamicStyles(isDark: boolean) {
  return useMemo(
    () =>
      StyleSheet.create({
        // Reserved for component-specific computed styles if needed beyond inline colors.
      }),
    [isDark],
  )
}

function HomeHealthProfilePrompt({
  themeColors,
  onOpen,
  onSnooze,
}: {
  themeColors: ReturnType<typeof useHomeThemeColors>
  onOpen: () => void
  onSnooze: () => void
}) {
  return (
    <View style={[styles.homePromptCard, { backgroundColor: themeColors.cardBackground, borderColor: themeColors.cardBorder }]}>
      <View style={styles.homePromptIcon}><Text style={styles.homePromptIconText}>健</Text></View>
      <Pressable style={styles.homePromptCopy} onPress={onOpen}>
        <Text style={[styles.homePromptTitle, { color: themeColors.text }]}>完善健康档案，获得更贴合你的建议</Text>
        <Text style={[styles.homePromptDesc, { color: themeColors.textSecondary }]}>每日目标、饮食分析会结合你的身体数据、过敏与饮食偏好。</Text>
      </Pressable>
      <View style={styles.homePromptActions}>
        <Pressable style={styles.homePromptPrimary} onPress={onOpen}><Text style={styles.homePromptPrimaryText}>去完善</Text></Pressable>
        <Pressable style={styles.homePromptSecondary} onPress={onSnooze}><Text style={[styles.homePromptSecondaryText, { color: themeColors.textMuted }]}>7天后提醒</Text></Pressable>
      </View>
    </View>
  )
}

function HomeFirstRecordGuide({
  themeColors,
  onStart,
  onSkip,
}: {
  themeColors: ReturnType<typeof useHomeThemeColors>
  onStart: () => void
  onSkip: () => void
}) {
  return (
    <View style={[styles.homeFirstGuide, { backgroundColor: themeColors.cardBackground, borderColor: themeColors.cardBorder }]}>
      <View style={styles.homeFirstGuideHeader}>
        <View style={styles.homeFirstGuideBadge}><Text style={styles.homeFirstGuideBadgeText}>首次记录</Text></View>
        <Pressable hitSlop={8} onPress={onSkip}><Text style={[styles.homeFirstGuideSkip, { color: themeColors.textMuted }]}>跳过</Text></Pressable>
      </View>
      <Text style={[styles.homeFirstGuideTitle, { color: themeColors.text }]}>第一次记录，从底部中间按钮开始</Text>
      <Text style={[styles.homeFirstGuideDesc, { color: themeColors.textSecondary }]}>可以拍照、从相册选择、输入文字或手动挑选食物；记录会自动归入当前选中的日期。</Text>
      <Pressable style={styles.homeFirstGuideAction} onPress={onStart}>
        <Text style={styles.homeFirstGuideActionText}>打开记录菜单</Text>
      </Pressable>
    </View>
  )
}

function HomeBackfillHint({
  themeColors,
  onRecord,
  onDismiss,
}: {
  themeColors: ReturnType<typeof useHomeThemeColors>
  onRecord: () => void
  onDismiss: () => void
}) {
  return (
    <View style={[styles.homeBackfillHint, { backgroundColor: themeColors.cardBackground, borderColor: themeColors.cardBorder }]}>
      <View style={styles.homeBackfillDot} />
      <Text style={[styles.homeBackfillText, { color: themeColors.textSecondary }]}>可补录这一天的食物、体重、喝水和运动记录</Text>
      <Pressable onPress={onRecord}><Text style={styles.homeBackfillAction}>去补录</Text></Pressable>
      <Pressable onPress={onDismiss}><Text style={[styles.homeBackfillDismiss, { color: themeColors.textMuted }]}>取消</Text></Pressable>
    </View>
  )
}

function HomeDietRecommendationEntry({
  remaining,
  busy,
  themeColors,
  onEatOut,
  onCookHome,
}: {
  remaining: number
  busy: boolean
  themeColors: ReturnType<typeof useHomeThemeColors>
  onEatOut: () => void
  onCookHome: () => void
}) {
  return (
    <View style={[styles.homeDietEntry, { backgroundColor: themeColors.cardBackground, borderColor: themeColors.cardBorder }]}>
      <View style={styles.homeDietEntryMain}>
        <View style={styles.homeDietEntryIcon}><IconfontText className="iconfont icon-canciguanli" size={20} color={colors.brandDark} /></View>
        <View style={styles.homeDietEntryCopy}>
          <Text style={[styles.homeDietEntryTitle, { color: themeColors.text }]}>今天吃什么</Text>
          <Text style={[styles.homeDietEntrySubtitle, { color: themeColors.textSecondary }]}>{busy ? '按剩余目标推荐一餐' : `还可吃 ${Math.max(0, Math.round(remaining))} kcal`}</Text>
        </View>
      </View>
      <Text style={[styles.homeDietEntryCredit, { color: themeColors.textMuted }]}>每次生成消耗 1 次系统额度；不足时使用奖励积分</Text>
      <View style={styles.homeDietEntryActions}>
        <Pressable style={[styles.homeDietEntryButton, { backgroundColor: themeColors.surfaceMuted }]} onPress={onEatOut}><Text style={[styles.homeDietEntryButtonText, { color: themeColors.textSecondary }]}>外面吃</Text></Pressable>
        <Pressable style={[styles.homeDietEntryButton, styles.homeDietEntryButtonPrimary]} onPress={onCookHome}><Text style={styles.homeDietEntryButtonPrimaryText}>自己做</Text></Pressable>
      </View>
    </View>
  )
}

function HomeMealRecordsSheet({
  meal,
  themeColors,
  onClose,
  onSelect,
}: {
  meal: HomeMealItem | null
  themeColors: ReturnType<typeof useHomeThemeColors>
  onClose: () => void
  onSelect: (recordId: string) => void
}) {
  const entries = meal ? getMealRecordEntries(meal) : []
  return (
    <Modal visible={Boolean(meal)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.homeSheetRoot}>
        <Pressable style={styles.homeSheetMask} onPress={onClose} />
        <View style={[styles.homeSheet, { backgroundColor: themeColors.sheetBackground }]}>
          <View style={[styles.targetModalHandle, { backgroundColor: themeColors.handle }]} />
          <View style={styles.homeSheetHeader}>
            <View>
              <Text style={[styles.homeSheetTitle, { color: themeColors.text }]}>{meal?.name || getMealTypeLabel(meal?.type || '')}</Text>
              <Text style={[styles.homeSheetSubtitle, { color: themeColors.textSecondary }]}>{entries.length} 条记录 · 选择后可编辑、删除或分享</Text>
            </View>
            <Pressable style={[styles.targetModalClose, { backgroundColor: themeColors.closeButton }]} onPress={onClose}><Text style={[styles.targetModalCloseText, { color: themeColors.textSecondary }]}>×</Text></Pressable>
          </View>
          <ScrollView style={styles.homeMealRecordsScroll} showsVerticalScrollIndicator={false}>
            {entries.map((entry, index) => {
              const imageUrl = firstMealRecordImage(entry)
              return (
                <Pressable key={entry.id} style={[styles.homeMealRecordRow, { borderColor: themeColors.border }]} onPress={() => onSelect(entry.id)}>
                  <View style={[styles.homeMealRecordThumb, { backgroundColor: themeColors.mealIconBg }]}>
                    {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.homeMealRecordImage} /> : <Text style={[styles.mealIconText, { color: themeColors.mealIconText }]}>食</Text>}
                  </View>
                  <View style={styles.homeMealRecordCopy}>
                    <Text style={[styles.homeMealRecordTitle, { color: themeColors.text }]} numberOfLines={1}>{entry.title || `第 ${index + 1} 次记录`}</Text>
                    <Text style={[styles.homeMealRecordMeta, { color: themeColors.textSecondary }]}>{formatMealRecordTime(entry.record_time)} · {Math.round(Number(entry.total_calories || 0))} kcal</Text>
                    <Text style={[styles.homeMealRecordMacros, { color: themeColors.textMuted }]}>蛋白 {formatHomeNumber(entry.total_protein)}g · 碳水 {formatHomeNumber(entry.total_carbs)}g · 脂肪 {formatHomeNumber(entry.total_fat)}g</Text>
                  </View>
                  <Text style={[styles.homeMealRecordArrow, { color: themeColors.textMuted }]}>›</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function HomeMealActionSheet({
  visible,
  themeColors,
  onClose,
  onView,
  onEdit,
  onShare,
  onDelete,
}: {
  visible: boolean
  themeColors: ReturnType<typeof useHomeThemeColors>
  onClose: () => void
  onView: () => void
  onEdit: () => void
  onShare: () => void
  onDelete: () => void
}) {
  const actions = [
    { key: 'view', label: '查看详情', icon: 'icon-shiwu', onPress: onView },
    { key: 'edit', label: '修改记录', icon: 'icon-edit', onPress: onEdit },
    { key: 'share', label: '分享这餐', icon: 'icon-share', onPress: onShare },
  ]
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.homeSheetRoot}>
        <Pressable style={styles.homeSheetMask} onPress={onClose} />
        <View style={[styles.homeActionSheet, { backgroundColor: themeColors.sheetBackground }]}>
          <View style={[styles.targetModalHandle, { backgroundColor: themeColors.handle }]} />
          {actions.map((action) => (
            <Pressable key={action.key} style={[styles.homeActionRow, { borderBottomColor: themeColors.border }]} onPress={action.onPress}>
              <IconfontText className={`iconfont ${action.icon}`} size={20} color={colors.brandDark} />
              <Text style={[styles.homeActionText, { color: themeColors.text }]}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.homeActionRow, { borderBottomColor: themeColors.border }]} onPress={onDelete}>
            <IconfontText className="iconfont icon-shanchu" size={20} color={themeColors.danger} />
            <Text style={[styles.homeActionText, { color: themeColors.danger }]}>删除记录</Text>
          </Pressable>
          <Pressable style={[styles.homeActionCancel, { backgroundColor: themeColors.surfaceMuted }]} onPress={onClose}><Text style={[styles.homeActionCancelText, { color: themeColors.textSecondary }]}>取消</Text></Pressable>
        </View>
      </View>
    </Modal>
  )
}

function HomeDietRecommendationSheet({
  visible,
  scene,
  loading,
  result,
  themeColors,
  bottomInset,
  onClose,
  onChangeScene,
  onRefresh,
}: {
  visible: boolean
  scene: DietRecommendationScene
  loading: boolean
  result: DietRecommendationResult | null
  themeColors: ReturnType<typeof useHomeThemeColors>
  bottomInset: number
  onClose: () => void
  onChangeScene: (scene: DietRecommendationScene) => void
  onRefresh: () => void
}) {
  const resultRecord = asUnknownRecord(result)
  const macroGaps = asUnknownRecord(resultRecord.macro_gaps)
  const recommendations = Array.isArray(result?.recommendations) ? result.recommendations : []
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.homeSheetRoot}>
        <Pressable style={styles.homeSheetMask} onPress={onClose} />
        <View style={[styles.homeDietSheet, { paddingBottom: bottomInset + 16, backgroundColor: themeColors.sheetBackground }]}>
          <View style={[styles.targetModalHandle, { backgroundColor: themeColors.handle }]} />
          <View style={styles.homeSheetHeader}>
            <View>
              <Text style={[styles.homeDietKicker, { color: colors.brandDark }]}>按剩余目标推荐</Text>
              <Text style={[styles.homeSheetTitle, { color: themeColors.text }]}>{result?.title || '今天吃什么'}</Text>
            </View>
            <Pressable style={[styles.targetModalClose, { backgroundColor: themeColors.closeButton }]} onPress={onClose}><Text style={[styles.targetModalCloseText, { color: themeColors.textSecondary }]}>×</Text></Pressable>
          </View>
          <View style={[styles.homeDietTabs, { backgroundColor: themeColors.surfaceMuted }]}>
            {(['eat_out', 'cook_home'] as DietRecommendationScene[]).map((item) => (
              <Pressable key={item} style={[styles.homeDietTab, scene === item && styles.homeDietTabActive]} onPress={() => onChangeScene(item)}>
                <Text style={[styles.homeDietTabText, { color: scene === item ? '#fff' : themeColors.textSecondary }]}>{item === 'eat_out' ? '外面吃' : '自己做'}</Text>
              </Pressable>
            ))}
          </View>
          {loading ? (
            <View style={styles.homeDietLoading}><ActivityIndicator size="large" color={colors.brand} /></View>
          ) : (
            <ScrollView style={styles.homeDietScroll} contentContainerStyle={styles.homeDietScrollContent} showsVerticalScrollIndicator={false}>
              {result ? (
                <>
                  <Text style={[styles.homeDietSummary, { color: themeColors.textSecondary }]}>{result.summary || '已按今天的剩余热量和营养缺口生成推荐。'}</Text>
                  <Text style={[styles.homeDietSourceNote, { color: themeColors.textMuted }]}>优先从公共食物库、历史记录和标准营养库中选择，AI 仅负责按目标组合。</Text>
                  <View style={styles.homeDietGapRow}>
                    <HomeDietGap value={numberFrom(resultRecord.calorie_remaining, 0)} label="kcal" themeColors={themeColors} />
                    <HomeDietGap value={numberFrom(macroGaps.protein, 0)} label="蛋白" themeColors={themeColors} />
                    <HomeDietGap value={numberFrom(macroGaps.carbs, 0)} label="碳水" themeColors={themeColors} />
                    <HomeDietGap value={numberFrom(macroGaps.fat, 0)} label="脂肪" themeColors={themeColors} />
                  </View>
                  {recommendations.map((option, index) => {
                    const optionRecord = asUnknownRecord(option)
                    const foods = getDietRecommendationFoods(optionRecord)
                    const source = String(optionRecord.source || foods[0]?.source || '')
                    return (
                      <View key={`${option.title || 'recommendation'}-${index}`} style={[styles.homeDietOption, { borderColor: themeColors.border, backgroundColor: themeColors.cardBackground }]}>
                        <View style={styles.homeDietOptionHeader}>
                          <Text style={[styles.homeDietOptionTitle, { color: themeColors.text }]}>{option.title || `推荐方案 ${index + 1}`}</Text>
                          <Text style={styles.homeDietOptionCalories}>{Math.round(numberFrom(option.calories, 0))} kcal</Text>
                        </View>
                        {option.reason ? <Text style={[styles.homeDietOptionReason, { color: themeColors.textSecondary }]}>{option.reason}</Text> : null}
                        {source ? <Text style={[styles.homeDietOptionSource, { color: themeColors.textMuted }]}>来源：{dietRecommendationSourceLabel(source)}</Text> : null}
                        <View style={styles.homeDietFoods}>
                          {foods.map((food, foodIndex) => (
                            <View key={`${food.name}-${foodIndex}`} style={[styles.homeDietFood, { backgroundColor: themeColors.surfaceMuted }]}>
                              <Text style={[styles.homeDietFoodName, { color: themeColors.text }]}>{food.name}</Text>
                              {food.amount ? <Text style={[styles.homeDietFoodAmount, { color: themeColors.textSecondary }]}>{food.amount}</Text> : null}
                            </View>
                          ))}
                        </View>
                        <Text style={[styles.homeDietOptionMacros, { color: themeColors.textSecondary }]}>蛋白 {formatHomeNumber(option.protein)}g · 碳水 {formatHomeNumber(option.carbs)}g · 脂肪 {formatHomeNumber(option.fat)}g</Text>
                      </View>
                    )
                  })}
                  <Pressable style={styles.homeDietRefresh} onPress={onRefresh}><Text style={styles.homeDietRefreshText}>换一组（再次消耗 1 次额度）</Text></Pressable>
                </>
              ) : (
                <Pressable style={styles.homeDietRefresh} onPress={onRefresh}><Text style={styles.homeDietRefreshText}>重新生成</Text></Pressable>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

function HomeDietGap({ value, label, themeColors }: { value: number; label: string; themeColors: ReturnType<typeof useHomeThemeColors> }) {
  return (
    <View style={[styles.homeDietGap, { backgroundColor: themeColors.surfaceMuted }]}>
      <Text style={[styles.homeDietGapValue, { color: themeColors.text }]}>{formatHomeNumber(Math.max(0, value))}</Text>
      <Text style={[styles.homeDietGapLabel, { color: themeColors.textMuted }]}>{label}</Text>
    </View>
  )
}

function HomeBannerCarousel({
  banners,
  activeIndex,
  bannerWidth,
  onIndexChange,
  themeColors,
}: {
  banners: HomeBanner[]
  activeIndex: number
  bannerWidth: number
  onIndexChange: (index: number) => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  return (
    <View style={styles.homeBannerCarousel}>
      <ScrollView
        horizontal
        pagingEnabled
        snapToInterval={bannerWidth + 10}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.homeBannerTrack}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, bannerWidth + 10))
          onIndexChange(Math.max(0, Math.min(nextIndex, banners.length - 1)))
        }}
      >
        {banners.map((banner, index) => (
          <Pressable
            key={banner.key}
            style={({ pressed }) => [
              styles.homeBannerSlide,
              { width: bannerWidth, marginRight: index === banners.length - 1 ? 0 : 10 },
              pressed && styles.pressed,
            ]}
            onPress={banner.onPress}
          >
            {banner.imageUrl ? (
              <ImageBackground
                source={{ uri: banner.imageUrl }}
                resizeMode="cover"
                style={styles.homeBanner}
                imageStyle={styles.homeBannerImage}
              >
                <HomeBannerContent banner={banner} image themeColors={themeColors} />
              </ImageBackground>
            ) : (
              <View
                style={[
                  styles.homeBanner,
                  banner.tone === 'goose' && { backgroundColor: themeColors.bannerGoose },
                  banner.tone === 'green' && { backgroundColor: themeColors.bannerGreen },
                  banner.tone === 'gold' && { backgroundColor: themeColors.bannerGold },
                  banner.tone === 'blue' && { backgroundColor: themeColors.bannerBlue },
                ]}
              >
                <HomeBannerContent banner={banner} image={false} themeColors={themeColors} />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
      {banners.length > 1 ? (
        <View style={styles.homeBannerDots}>
          <View style={styles.homeBannerDotsPill}>
            {banners.map((banner, index) => (
              <View
                key={`${banner.key}-dot`}
                style={[styles.homeBannerDot, index === activeIndex && styles.homeBannerDotActive]}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function HomeBannerContent({ banner, image = false, themeColors }: { banner: HomeBanner; image?: boolean; themeColors: ReturnType<typeof useHomeThemeColors> }) {
  return (
    <View style={[styles.homeBannerOverlay, image && styles.homeBannerImageOverlay]}>
      <View style={styles.homeBannerText}>
        <Text style={[styles.homeBannerKicker, image ? styles.homeBannerTextLight : { color: themeColors.textSecondary }]} numberOfLines={1}>{banner.kicker}</Text>
        <Text style={[styles.homeBannerTitle, image ? styles.homeBannerTextLight : { color: themeColors.text }]} numberOfLines={2}>{banner.title}</Text>
        <Text style={[styles.homeBannerSubtitle, image ? styles.homeBannerTextLight : { color: themeColors.textSecondary }]} numberOfLines={2}>{banner.desc}</Text>
      </View>
      <View style={[styles.homeBannerButton, image && styles.homeBannerButtonLight]}>
        <Text style={[styles.homeBannerButtonText, image && styles.homeBannerButtonTextLight]} numberOfLines={1}>{banner.actionText}</Text>
      </View>
    </View>
  )
}

function TargetFieldRow({
  label,
  unit,
  value,
  onChangeText,
  onDecrease,
  onIncrease,
  themeColors,
}: {
  label: string
  unit: string
  value: string
  onChangeText: (value: string) => void
  onDecrease: () => void
  onIncrease: () => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  return (
    <View style={styles.targetField}>
      <Text style={[styles.targetFieldLabel, { color: themeColors.textSecondary }]}>{label}</Text>
      <View style={styles.targetInputRow}>
        <Pressable style={[styles.targetAdjustButton, { backgroundColor: themeColors.surfaceMuted }]} onPress={onDecrease}>
          <Text style={styles.targetAdjustButtonText}>-</Text>
        </Pressable>
        <View style={[styles.targetInputWrap, { borderColor: themeColors.border, backgroundColor: themeColors.surfaceMuted }]}>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            keyboardType="decimal-pad"
            style={[styles.targetInput, { color: themeColors.text }]}
            placeholder="0"
            placeholderTextColor={themeColors.textMuted}
          />
          <Text style={[styles.targetInputUnit, { color: themeColors.textSecondary }]}>{unit}</Text>
        </View>
        <Pressable style={[styles.targetAdjustButton, { backgroundColor: themeColors.surfaceMuted }]} onPress={onIncrease}>
          <Text style={styles.targetAdjustButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

function HomeGreeting({ recordDate, mealType, themeColors }: { recordDate: string; mealType: string; themeColors: ReturnType<typeof useHomeThemeColors> }) {
  return (
    <View style={styles.greetingSection}>
      <View style={styles.greetingText}>
        <Text style={[styles.greetingTitle, { color: themeColors.text }]}>{homeGreeting()}</Text>
        <Text style={[styles.greetingSubtitle, { color: themeColors.textSecondary }]}>
          今天也要健康饮食哦 · {formatShortDate(recordDate)} · {getMealTypeLabel(mealType)}
        </Text>
      </View>
    </View>
  )
}

function HomeDateSelector({
  cells,
  selectedDate,
  onSelect,
  themeColors,
}: {
  cells: WeekCell[]
  selectedDate: string
  onSelect: (date: string) => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  return (
    <View style={styles.dateSelectorSection}>
      <View style={styles.dateList}>
        {cells.map((cell) => {
          const recorded = cell.calories > 0
          const over = recorded && cell.target > 0 && cell.calories > cell.target
          const selected = selectedDate === cell.date
          return (
            <Pressable
              key={cell.date}
              style={({ pressed }) => [
                styles.dateItem,
                selected && { backgroundColor: themeColors.dateSelectedBg },
                pressed && styles.dateItemPressed,
              ]}
              onPress={() => onSelect(cell.date)}
            >
              <Text style={[styles.dateDayName, selected ? { color: '#fff' } : { color: themeColors.dateTextMuted }]}>{cell.dayName}</Text>
              <View
                style={[
                  styles.dateDayCircle,
                  recorded && { backgroundColor: colors.brand },
                  over && { backgroundColor: colors.homeWarningRed },
                  selected && [styles.dateDayCircleSelected, { backgroundColor: 'transparent' }],
                  !selected && { backgroundColor: themeColors.dateCircle },
                ]}
              >
                <Text style={[styles.dateNumText, (recorded || selected) && { color: '#fff' }, !recorded && !selected && { color: themeColors.dateText }]}>{cell.dayNum}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function HomeCalorieCard({
  current,
  target,
  remaining,
  progress,
  isOver,
  intakeData,
  onOpenTargetEditor,
  nutritionExpanded,
  onToggleNutrition,
  isDark,
  themeColors,
}: {
  current: number
  target: number
  remaining: number
  progress: number
  isOver: boolean
  intakeData?: HomeDashboard['intakeData']
  onOpenTargetEditor: () => void
  nutritionExpanded: boolean
  onToggleNutrition: () => void
  isDark: boolean
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  return (
    <View style={[styles.mainCard, { backgroundColor: themeColors.cardBackground, borderColor: themeColors.cardBorder }]}>
      <View style={styles.mainCardHeader}>
        <View style={styles.mainCardTitle}>
          <Text style={[styles.cardLabel, { color: themeColors.textSecondary }]}>{isOver ? '已超出' : '剩余可摄入'}</Text>
          <Text style={[styles.cardValue, { color: isOver ? themeColors.over : themeColors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {Math.round(isOver ? current - target : remaining)}
          </Text>
          <Text style={[styles.cardUnit, { color: themeColors.textMuted }]}>kcal</Text>
        </View>
        <View style={styles.targetSection}>
          <View style={styles.targetEnergyNumsOnly}>
            <Text style={[styles.targetEnergyIntakeNum, { color: isOver ? themeColors.over : themeColors.text }]}>{Math.round(current)}</Text>
            <Text style={[styles.targetEnergySlashOnly, { color: themeColors.textMuted }]}>/</Text>
            <Text style={[styles.targetEnergyTargetNum, { color: themeColors.textSecondary }]}>{Math.round(target)}</Text>
          </View>
          <Pressable style={({ pressed }) => [styles.targetEditButton, pressed && styles.pressed]} onPress={onOpenTargetEditor}>
            <IconfontText className="iconfont icon-target" size={12} color={themeColors.bodyStatusChangeDown} />
            <Text style={[styles.targetEditButtonText, { color: themeColors.bodyStatusChangeDown }]}>目标设置</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.progressSection}>
        <View style={[styles.progressBarBg, { backgroundColor: themeColors.progressTrack }]}>
          <View style={[styles.progressBarFill, isOver && { backgroundColor: themeColors.over }, { width: `${clamp(progress, 0, 100)}%` }]} />
        </View>
      </View>
      <View style={styles.nutritionShell}>
        <View style={styles.nutritionExpandTitleRow}>
          <Text style={[styles.nutritionTitle, { color: themeColors.nutritionTitle }]}>营养概览</Text>
          <TouchableOpacity activeOpacity={0.75} onPress={onToggleNutrition}>
            <View style={[styles.nutritionExpandAffordance, { backgroundColor: themeColors.nutritionAffordanceBg }]}>
              <IconfontText
                className="iconfont icon-right-arrow"
                size={14}
                color={themeColors.nutritionAffordanceText}
                style={{ transform: [{ rotate: nutritionExpanded ? '270deg' : '90deg' }] }}
              />
              <Text style={[styles.nutritionExpandAffordanceText, { color: themeColors.nutritionAffordanceText }]}>{nutritionExpanded ? '收起' : '展开更多'}</Text>
            </View>
          </TouchableOpacity>
        </View>
        <HomeMacroSection intakeData={intakeData} themeColors={themeColors} />
        {nutritionExpanded && <HomeMicrosSection intakeData={intakeData} />}
      </View>
    </View>
  )
}

function HomeMacroSection({ intakeData, themeColors }: { intakeData?: HomeDashboard['intakeData']; themeColors: ReturnType<typeof useHomeThemeColors> }) {
  return (
    <View style={styles.macrosSection}>
      {macroConfigs.map((config) => {
        const current = Number(intakeData?.macros?.[config.key]?.current || 0)
        const target = Number(intakeData?.macros?.[config.key]?.target || 0)
        const progress = target > 0 ? clamp((current / target) * 100, 0, 100) : 0
        const over = target > 0 && current > target
        return (
          <MacroRowCard
            key={config.key}
            label={config.label}
            current={current}
            target={target}
            color={config.color}
            progress={progress}
            unit={config.unit}
            over={over}
            iconClass={config.iconClass}
            themeColors={themeColors}
          />
        )
      })}
    </View>
  )
}

function MacroRowCard({
  label,
  current,
  target,
  color,
  progress,
  unit,
  over,
  iconClass,
  themeColors,
}: {
  label: string
  current: number
  target: number
  color: string
  progress: number
  unit: string
  over: boolean
  iconClass: string
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  const progressColor = over ? colors.homeWarningRed : color
  const excess = over ? Math.max(0, current - target) : 0
  return (
    <View style={[styles.macroCard, { backgroundColor: themeColors.macroCard }, over && { backgroundColor: themeColors.macroCardOver, borderColor: themeColors.macroCardOverBorder }]}>
      <View style={styles.macroExcessSlot}>
        {excess > 0 ? <Text style={[styles.macroOverHint, { color: themeColors.over }]}>+{formatHomeNumber(excess)}{unit}</Text> : null}
      </View>
      <View style={styles.macroTitleRow}>
        <IconfontText className={iconClass} size={13} color={color} />
        <Text style={[styles.macroLabel, { color: themeColors.text }]}>{label}</Text>
      </View>
      <View style={styles.macroValueRow}>
        <Text style={[styles.macroCurrentValue, { color: progressColor }]}>{formatHomeNumber(current)}</Text>
        <Text style={[styles.macroTargetTotal, { color: themeColors.textMuted }]}>/ {formatHomeNumber(target)}{unit}</Text>
      </View>
      <View style={[styles.macroProgressBarBg, { backgroundColor: themeColors.progressTrack }]}>
        <View style={[styles.macroProgressBarFill, { width: `${clamp(progress, 0, 100)}%`, backgroundColor: progressColor }]} />
      </View>
    </View>
  )
}

function HomeBodyStatusStrip({
  weightSummary,
  todayWater,
  waterGoalMl,
  waterProgress,
  exerciseKcal,
  onWeight,
  onWater,
  onExercise,
  themeColors,
}: {
  weightSummary: { latestWeight: BodyMetricWeightEntry | null; weightChange: number | null; hasRecord: boolean }
  todayWater: BodyMetricWaterDay | { date: string; total: number; logs: number[] }
  waterGoalMl: number
  waterProgress: number
  exerciseKcal: number
  onWeight: () => void
  onWater: () => void
  onExercise: () => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  return (
    <View style={styles.bodyStatusSection}>
      <WeightStatusCard summary={weightSummary} onPress={onWeight} themeColors={themeColors} />
      <WaterStatusCard todayWater={todayWater} waterGoalMl={waterGoalMl} waterProgress={waterProgress} onPress={onWater} themeColors={themeColors} />
      <ExerciseStatusCard kcal={exerciseKcal} onPress={onExercise} themeColors={themeColors} />
    </View>
  )
}

function WeightStatusCard({
  summary,
  onPress,
  themeColors,
}: {
  summary: { latestWeight: BodyMetricWeightEntry | null; weightChange: number | null; hasRecord: boolean }
  onPress: () => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  const toneColor = recordIconColors.green
  return (
    <Pressable style={({ pressed }) => [styles.bodyStatusCard, { backgroundColor: themeColors.bodyStatusCard, borderColor: themeColors.bodyStatusCardBorder }, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.bodyStatusHeader}>
        <View style={[styles.bodyStatusIcon, { backgroundColor: `${toneColor}18` }]}>
          <IconfontText className="iconfont icon-weight-scale" size={15} color={toneColor} />
        </View>
        <Text style={[styles.bodyStatusLabel, { color: themeColors.textSecondary }]}>体重</Text>
      </View>
      <View style={styles.bodyStatusContentRow}>
        {summary.latestWeight ? (
          <>
            <Text style={[styles.bodyStatusValue, { color: themeColors.text }]}>{summary.latestWeight.value.toFixed(1)}</Text>
            <Text style={[styles.bodyStatusUnit, { color: themeColors.textSecondary }]}>kg</Text>
            {summary.weightChange !== null && (
              <Text style={[styles.bodyStatusChange, summary.weightChange > 0 ? { color: themeColors.over } : { color: themeColors.bodyStatusChangeDown }]}>
                {summary.weightChange > 0 ? '+' : ''}{summary.weightChange.toFixed(1)}
              </Text>
            )}
          </>
        ) : (
          <Text style={[styles.bodyStatusEmpty, { color: themeColors.textSecondary }]}>点击记录</Text>
        )}
      </View>
      <Text style={[styles.bodyStatusHint, { color: themeColors.textMuted }]}>
        {summary.latestWeight ? `上次记录: ${summary.latestWeight.date.slice(5)}` : '记录体重，追踪变化'}
      </Text>
    </Pressable>
  )
}

function WaterStatusCard({
  todayWater,
  waterGoalMl,
  waterProgress,
  onPress,
  themeColors,
}: {
  todayWater: BodyMetricWaterDay | { date: string; total: number; logs: number[] }
  waterGoalMl: number
  waterProgress: number
  onPress: () => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  const toneColor = recordIconColors.blue
  return (
    <Pressable style={({ pressed }) => [styles.bodyStatusCard, { backgroundColor: themeColors.bodyStatusCard, borderColor: themeColors.bodyStatusCardBorder }, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.bodyStatusHeader}>
        <View style={[styles.bodyStatusIcon, { backgroundColor: `${toneColor}18` }]}>
          <IconfontText className="iconfont icon-drink" size={15} color={toneColor} />
        </View>
        <Text style={[styles.bodyStatusLabel, { color: themeColors.textSecondary }]}>喝水</Text>
      </View>
      <View style={styles.bodyStatusContentRow}>
        <Text style={[styles.bodyStatusValue, { color: themeColors.text }]}>{Math.round(todayWater.total)}</Text>
        <Text style={[styles.bodyStatusUnit, { color: themeColors.textSecondary }]}>ml</Text>
      </View>
      <View style={styles.bodyStatusProgressWrap}>
        <View style={[styles.bodyStatusProgressBg, { backgroundColor: themeColors.progressTrack }]}>
          <View style={[styles.bodyStatusProgressFill, { width: `${Math.min(100, Math.max(0, waterProgress))}%`, backgroundColor: toneColor }]} />
        </View>
        <Text style={[styles.bodyStatusProgressText, { color: themeColors.textMuted }]}>{Math.round(waterProgress)}% / 目标 {waterGoalMl}ml</Text>
      </View>
    </Pressable>
  )
}

function ExerciseStatusCard({ kcal, onPress, themeColors }: { kcal: number; onPress: () => void; themeColors: ReturnType<typeof useHomeThemeColors> }) {
  const toneColor = recordIconColors.gold
  return (
    <Pressable style={({ pressed }) => [styles.bodyStatusCard, { backgroundColor: themeColors.bodyStatusCard, borderColor: themeColors.bodyStatusCardBorder }, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.bodyStatusHeader}>
        <View style={[styles.bodyStatusIcon, { backgroundColor: `${toneColor}18` }]}>
          <IconfontText className="iconfont icon-dumbbell" size={15} color={toneColor} />
        </View>
        <Text style={[styles.bodyStatusLabel, { color: themeColors.textSecondary }]}>运动</Text>
      </View>
      <View style={styles.bodyStatusContentRow}>
        <Text style={[styles.bodyStatusValue, { color: themeColors.text }]}>{Math.round(kcal)}</Text>
        <Text style={[styles.bodyStatusUnit, { color: themeColors.textSecondary }]}>kcal</Text>
      </View>
      <Text style={[styles.bodyStatusHint, { color: themeColors.textMuted }]}>点击记录运动</Text>
    </Pressable>
  )
}

function HomeMealsSection({
  meals,
  onOpenAll,
  onQuickRecord,
  onOpenHistory,
  onOpenMeal,
  isDark,
  themeColors,
}: {
  meals: HomeDashboard['meals']
  onOpenAll: () => void
  onQuickRecord: () => void
  onOpenHistory: () => void
  onOpenMeal: (meal: HomeMealItem) => void
  isDark: boolean
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  return (
    <View style={styles.mealsSection}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>今日餐食</Text>
        <Pressable style={styles.viewAllButton} onPress={onOpenAll}>
          <Text style={[styles.viewAllText, { color: themeColors.textSecondary }]}>查看全部</Text>
        </Pressable>
      </View>
      <View style={styles.mealsList}>
        {meals.length === 0 ? (
          <Pressable style={({ pressed }) => [styles.mealsEmpty, { backgroundColor: themeColors.emptyMealCard, borderColor: themeColors.emptyMealCardBorder }, pressed && styles.pressed]} onPress={onQuickRecord}>
            <IconfontText className="iconfont icon-paizhao-xianxing" size={24} color={themeColors.mealIconText} />
            <Text style={[styles.mealsEmptyTitle, { color: themeColors.text }]}>暂无今日餐食</Text>
            <Text style={[styles.mealsEmptyDesc, { color: themeColors.textMuted }]}>点这里记录一餐</Text>
          </Pressable>
        ) : (
          meals.map((meal, index) => {
            const progress = normalizeProgressPercent(meal.progress, meal.calorie, meal.target)
            const imageUrl = firstMealImage(meal)
            return (
              <Pressable
                key={`${meal.type}-${meal.time}-${index}`}
                style={({ pressed }) => [styles.mealItem, { backgroundColor: themeColors.mealCard, borderColor: themeColors.mealCardBorder }, progress > 100 && { backgroundColor: themeColors.mealCardWarningBg, borderColor: themeColors.mealCardWarningBorder }, pressed && styles.pressed]}
                onPress={() => getMealRecordEntries(meal).length > 0 || meal.primary_record_id || meal.primaryRecordId ? onOpenMeal(meal) : onOpenHistory()}
              >
                <View style={[styles.mealMediaWrap, imageUrl ? { backgroundColor: themeColors.mealPhotoBg } : { backgroundColor: themeColors.mealIconBg }]}>
                  {imageUrl ? (
                    <Image source={{ uri: imageUrl }} style={styles.mealThumbImage} resizeMode="cover" />
                  ) : (
                    <Text style={[styles.mealIconText, { color: themeColors.mealIconText }]}>{mealIconLabel(meal.type)}</Text>
                  )}
                </View>
                <View style={styles.mealContent}>
                  <View style={styles.mealHeaderBlock}>
                    <Text style={[styles.mealName, { color: themeColors.text }]} numberOfLines={1}>{meal.name || getMealTypeLabel(meal.type)}</Text>
                    <Text style={[styles.mealCalorie, { color: themeColors.text }]}>{Math.round(Number(meal.calorie || 0))}<Text style={[styles.mealCalorieUnit, { color: themeColors.textSecondary }]}> kcal</Text></Text>
                  </View>
                  <View style={styles.mealProgressWrap}>
                    <View style={[styles.mealProgressBarBg, { backgroundColor: themeColors.mealProgressTrack }]}>
                      <View style={[styles.mealProgressBarFill, progress > 100 && { backgroundColor: themeColors.over }, { width: `${clamp(progress, 0, 100)}%` }]} />
                    </View>
                  </View>
                  <View style={styles.mealProgressFoot}>
                    <Text style={[styles.mealProgressText, { color: themeColors.textSecondary }]}>目标 {Math.round(Number(meal.target || 0))} kcal</Text>
                    <Text style={[styles.mealProgressPercent, { color: progress > 100 ? themeColors.over : colors.brand }]}>{Math.round(progress)}%</Text>
                  </View>
                </View>
              </Pressable>
            )
          })
        )}
      </View>
    </View>
  )
}

function HomeExpirySection({
  summary,
  onOpen,
  themeColors,
}: {
  summary: HomeDashboard['expirySummary'] | null
  onOpen: () => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  const items = summary?.preview_items || []
  return (
    <View style={styles.expirySection}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: themeColors.text }]}>食物保质期</Text>
        <Pressable style={styles.viewAllButton} onPress={onOpen}>
          <IconfontText className="iconfont icon-right-arrow" size={18} color={themeColors.textSecondary} />
        </Pressable>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.expiryCard,
          { backgroundColor: themeColors.expiryCard, borderColor: themeColors.expiryCardBorder },
          pressed && styles.pressed,
        ]}
        onPress={onOpen}
      >
        {items.length === 0 ? (
          <View style={styles.expiryEmpty}>
            <Text style={[styles.expiryEmptyTitle, { color: themeColors.text }]}>{summary?.active_count ? '暂无紧急提醒' : '暂无待吃完记录'}</Text>
            <Text style={[styles.expiryEmptyDesc, { color: themeColors.textMuted }]}>添加家中食物后，首页会展示最紧急的几项</Text>
          </View>
        ) : (
          items.slice(0, 3).map((item) => (
            <View key={item.id} style={styles.expiryItem}>
              <View style={[styles.expiryIconWrap, expiryToneStyle(item.urgency)]}>
                <Text style={styles.expiryIconText}>鲜</Text>
              </View>
              <View style={styles.expiryContent}>
                <View style={styles.expiryHeaderBlock}>
                  <Text style={[styles.expiryName, { color: themeColors.text }]} numberOfLines={1}>{item.food_name}</Text>
                  <View style={[styles.expiryTimePill, { backgroundColor: themeColors.expiryPillBg }]}>
                    <Text style={[styles.expiryTimePillText, { color: themeColors.textSecondary }]}>{item.urgency_label || getExpiryUrgencyText(item)}</Text>
                  </View>
                </View>
                <Text style={[styles.expiryMetaText, { color: themeColors.textMuted }]}>{formatExpiryMeta(item)}</Text>
              </View>
            </View>
          ))
        )}
      </Pressable>
    </View>
  )
}

function HomeStatsEntry({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.statsEntryCard, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.statsEntryIcon}>
        <IconfontText className="iconfont icon-tubiao-zhuzhuangtu" size={20} color="#fff" />
      </View>
      <View style={styles.statsEntryText}>
        <Text style={styles.statsEntryTitle}>查看饮食统计</Text>
        <Text style={styles.statsEntryDesc}>了解您的饮食趋势和营养分析</Text>
      </View>
      <IconfontText className="iconfont icon-right-arrow" size={20} color="#fff" />
    </Pressable>
  )
}

function HomeMiniAction({ label, onPress, themeColors }: {
  label: string
  onPress: () => void
  themeColors: ReturnType<typeof useHomeThemeColors>
}) {
  return (
    <Pressable style={({ pressed }) => [styles.homeMiniAction, { backgroundColor: themeColors.miniActionBg }, pressed && styles.pressed]} onPress={onPress}>
      <Text style={[styles.homeMiniActionText, { color: themeColors.miniActionText }]}>{label}</Text>
    </Pressable>
  )
}

function targetFormFromDashboard(dashboard: HomeDashboard | null): TargetForm {
  return {
    calorieTarget: formatTargetNumber(dashboard?.intakeData.target || dashboard?.nutritionTarget?.suggested_calorie_target || 0),
    proteinTarget: formatTargetNumber(dashboard?.intakeData.macros.protein.target || 0),
    carbsTarget: formatTargetNumber(dashboard?.intakeData.macros.carbs.target || 0),
    fatTarget: formatTargetNumber(dashboard?.intakeData.macros.fat.target || 0),
  }
}

function targetFormFromTargets(targets: Record<string, number>, dashboard: HomeDashboard | null): TargetForm {
  const fallback = targetFormFromDashboard(dashboard)
  return {
    calorieTarget: formatTargetNumber(targets.calorie_target ?? numberFrom(fallback.calorieTarget, 0)),
    proteinTarget: formatTargetNumber(targets.protein_target ?? numberFrom(fallback.proteinTarget, 0)),
    carbsTarget: formatTargetNumber(targets.carbs_target ?? numberFrom(fallback.carbsTarget, 0)),
    fatTarget: formatTargetNumber(targets.fat_target ?? numberFrom(fallback.fatTarget, 0)),
  }
}

function parseTargetForm(form: TargetForm): { calorie_target: number; protein_target: number; carbs_target: number; fat_target: number } | null {
  const payload = {
    calorie_target: Number(form.calorieTarget),
    protein_target: Number(form.proteinTarget),
    carbs_target: Number(form.carbsTarget),
    fat_target: Number(form.fatTarget),
  }
  return Object.values(payload).every(Number.isFinite) ? payload : null
}

function validateTargetPayload(payload: { calorie_target: number; protein_target: number; carbs_target: number; fat_target: number }): string {
  if (payload.calorie_target < 500 || payload.calorie_target > 6000) return '热量目标需在 500-6000 kcal。'
  if (payload.protein_target < 0 || payload.protein_target > 500) return '蛋白质目标需在 0-500 g。'
  if (payload.carbs_target < 0 || payload.carbs_target > 1000) return '碳水目标需在 0-1000 g。'
  if (payload.fat_target < 0 || payload.fat_target > 300) return '脂肪目标需在 0-300 g。'
  return ''
}

function numberFrom(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function formatTargetNumber(value: unknown): string {
  const n = numberFrom(value, 0)
  const rounded = Math.max(0, Math.round((n + Number.EPSILON) * 10) / 10)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function formatHomeNumber(value: unknown): string {
  const n = numberFrom(value, 0)
  const rounded = Math.round((n + Number.EPSILON) * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date()
  }
  return new Date(year, month - 1, day)
}

function formatDateKeyFromDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildWeekCells(
  todayDate: string,
  selectedDate: string,
  selectedCalories: number,
  selectedTarget: number,
  weekStats: StatsSummary | null,
): WeekCell[] {
  const base = parseDateKey(todayDate)
  const dayNames = ['日', '一', '二', '三', '四', '五', '六']
  const dailyCalorieMap = new Map(
    (weekStats?.daily_calories || []).map((item) => [item.date, Number(item.calories) || 0]),
  )
  const fallbackTarget = Number(weekStats?.tdee) || 0
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base)
    date.setDate(base.getDate() + index - 3)
    const dateKey = formatDateKeyFromDate(date)
    const isSelected = dateKey === selectedDate
    const calories = isSelected ? selectedCalories : (dailyCalorieMap.get(dateKey) || 0)
    const target = isSelected ? selectedTarget : fallbackTarget
    return {
      date: dateKey,
      dayName: dayNames[date.getDay()] || '',
      dayNum: String(date.getDate()),
      calories,
      target,
    }
  })
}

function normalizeProgressPercent(value: unknown, current?: unknown, target?: unknown): number {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return Math.max(0, numeric)
  const currentValue = Number(current)
  const targetValue = Number(target)
  if (Number.isFinite(currentValue) && Number.isFinite(targetValue) && targetValue > 0) {
    return Math.max(0, (currentValue / targetValue) * 100)
  }
  return 0
}

function firstMealImage(meal: HomeDashboard['meals'][number]): string {
  const candidates = [
    ...(Array.isArray(meal.images) ? meal.images : []),
    ...(Array.isArray(meal.image_paths) ? meal.image_paths : []),
    meal.image_path,
  ]
  return candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0) || ''
}

function getMealRecordEntries(meal: HomeMealItem): HomeMealRecordEntry[] {
  const entries = Array.isArray(meal.meal_record_entries)
    ? meal.meal_record_entries.filter((entry): entry is HomeMealRecordEntry => Boolean(entry && String(entry.id || '').trim()))
    : []
  if (entries.length > 0) return entries
  const fallbackId = String(meal.primary_record_id || meal.primaryRecordId || '').trim()
  return fallbackId ? [{ id: fallbackId, title: meal.name, total_calories: meal.calorie }] : []
}

function firstMealRecordImage(entry: HomeMealRecordEntry): string {
  const candidates = [...(Array.isArray(entry.image_paths) ? entry.image_paths : []), entry.image_path]
  return candidates.find((item): item is string => typeof item === 'string' && item.trim().length > 0) || ''
}

function formatMealRecordTime(value?: string): string {
  if (!value) return '时间未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(11, 16) || value
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function isHealthProfileCompleted(profile: unknown): boolean {
  const record = asUnknownRecord(profile)
  return record.onboarding_status === 'completed' || record.onboarding_completed === true
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function getDietRecommendationFoods(option: Record<string, unknown>): Array<{ name: string; amount: string; source: string }> {
  if (Array.isArray(option.items)) {
    return option.items
      .map((item) => asUnknownRecord(item))
      .map((item) => ({
        name: String(item.name || '').trim(),
        amount: String(item.amount || '').trim(),
        source: String(item.source || '').trim(),
      }))
      .filter((item) => item.name)
  }
  if (Array.isArray(option.foods)) {
    return option.foods
      .map((food) => String(food || '').trim())
      .filter(Boolean)
      .map((name) => ({ name, amount: '', source: '' }))
  }
  return []
}

function dietRecommendationSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    public_food_library: '公共食物库',
    user_food_records: '历史记录',
    food_nutrition_library: '标准营养库',
    mixed: '组合候选',
    rule_fallback: '规则兜底',
    ai_generated: 'AI 补充',
  }
  return labels[source] || source
}

function mealIconLabel(type: string): string {
  if (type === 'breakfast') return '早'
  if (type === 'lunch') return '午'
  if (type === 'dinner') return '晚'
  return '食'
}

function getExpiryUrgencyText(item: NonNullable<NonNullable<HomeDashboard['expirySummary']>['preview_items']>[number]): string {
  if (item.days_until_expire == null) return '查看'
  if (item.days_until_expire < 0) return `已过期 ${Math.abs(item.days_until_expire)} 天`
  if (item.days_until_expire === 0) return '今日到期'
  return `${item.days_until_expire} 天后`
}

function formatExpiryMeta(item: NonNullable<NonNullable<HomeDashboard['expirySummary']>['preview_items']>[number]): string {
  return item.expire_date ? `到期 ${item.expire_date}` : '点击查看详情'
}

function expiryToneStyle(urgency: unknown) {
  if (urgency === 'expired') return styles.expiryIconExpired
  if (urgency === 'today') return styles.expiryIconToday
  if (urgency === 'soon') return styles.expiryIconSoon
  return styles.expiryIconFresh
}

function homeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const styles = StyleSheet.create({
  homeRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  homeBackgroundLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  homeBackgroundTopTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 360,
    backgroundColor: '#eaf7f0',
  },
  homeBackgroundSoftTint: {
    position: 'absolute',
    top: 240,
    left: 0,
    right: 0,
    height: 360,
    backgroundColor: 'rgba(92, 184, 150, 0.04)',
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  link: {
    color: colors.brandDark,
    fontWeight: '700',
  },
  bigNumber: {
    fontSize: compactFont(30, 28),
    fontWeight: '800',
    color: colors.brandDark,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  targetEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 26,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  targetEditButtonText: {
    color: '#2f7f62',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  calibrationCard: {
    marginTop: 12,
    marginBottom: 10,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff7ed',
  },
  calibrationTitle: {
    color: colors.orange,
    fontWeight: '900',
  },
  calibrationText: {
    marginTop: 6,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  targetActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  primaryMiniButton: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  primaryMiniButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  secondaryMiniButton: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  secondaryMiniButtonText: {
    color: colors.textSecondary,
    fontWeight: '900',
  },
  targetField: {
    marginTop: 12,
  },
  targetFieldLabel: {
    color: colors.textSecondary,
    fontWeight: '800',
    marginBottom: 7,
  },
  targetInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  targetAdjustButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  targetAdjustButtonText: {
    color: colors.brandDark,
    fontSize: 22,
    fontWeight: '900',
  },
  targetInputWrap: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  targetInput: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    paddingVertical: 8,
  },
  targetInputUnit: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  targetSaveRow: {
    gap: 10,
    marginTop: 16,
  },
  badge: {
    color: colors.warning,
    fontWeight: '800',
  },
  petCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  petMain: {
    flex: 1,
  },
  petLevel: {
    color: colors.brandDark,
    fontWeight: '800',
    marginBottom: 5,
  },
  rewardBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: '#fff7ed',
    color: colors.orange,
    fontSize: 12,
    fontWeight: '900',
  },
  petMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 10,
  },
  petMeta: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: colors.surfaceMuted,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  progressTrack: {
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  petTask: {
    marginTop: 10,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  empty: {
    color: colors.textMuted,
  },
  homeBannerCarousel: {
    position: 'relative',
    marginBottom: 10,
  },
  homeBannerTrack: {
    alignItems: 'stretch',
  },
  homeBannerSlide: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  homeBanner: {
    minHeight: 90,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  homeBannerGoose: {
    backgroundColor: '#fff3e3',
  },
  homeBannerGreen: {
    backgroundColor: '#e9fbf3',
  },
  homeBannerGold: {
    backgroundColor: '#fff7ed',
  },
  homeBannerBlue: {
    backgroundColor: '#edf7ff',
  },
  homeBannerImage: {
    borderRadius: 14,
  },
  homeBannerOverlay: {
    minHeight: 90,
    paddingTop: 12,
    paddingHorizontal: 12,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  homeBannerImageOverlay: {
    backgroundColor: 'rgba(6, 45, 43, 0.52)',
  },
  homeBannerText: {
    flex: 1,
  },
  homeBannerKicker: {
    color: colors.brandDark,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 4,
  },
  homeBannerTitle: {
    color: colors.text,
    fontSize: compactFont(17, 16),
    fontWeight: '800',
    lineHeight: 21,
    marginBottom: 4,
  },
  homeBannerSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  homeBannerTextLight: {
    color: '#fff',
  },
  homeBannerButton: {
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  homeBannerButtonLight: {
    backgroundColor: '#fff',
  },
  homeBannerButtonText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  homeBannerButtonTextLight: {
    color: colors.brandDark,
  },
  homeBannerDots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    zIndex: 3,
    minHeight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  homeBannerDotsPill: {
    minHeight: 16,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  homeBannerDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(17, 37, 29, 0.28)',
  },
  homeBannerDotActive: {
    width: 18,
    height: 7,
    backgroundColor: colors.brand,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  quickCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.75,
  },
  quickTitle: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  quickValue: {
    marginTop: 6,
    color: colors.text,
    fontWeight: '800',
  },
  recordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  recordActionCard: {
    width: '48%',
    maxWidth: '48%',
    minHeight: 88,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  recordActionGreen: {
    backgroundColor: '#f9fefc',
    borderColor: '#d9faeb',
  },
  recordActionBlue: {
    backgroundColor: '#f9fdfe',
    borderColor: '#d9f2fa',
  },
  recordActionGold: {
    backgroundColor: '#fefcf7',
    borderColor: '#f7e9ce',
  },
  recordActionPurple: {
    backgroundColor: '#fefcfe',
    borderColor: '#e6defa',
  },
  recordActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  recordIconGreen: {
    backgroundColor: '#ebfcf4',
  },
  recordIconBlue: {
    backgroundColor: '#ebf7fc',
  },
  recordIconGold: {
    backgroundColor: '#fbf5e6',
  },
  recordIconPurple: {
    backgroundColor: '#f3effc',
  },
  recordActionTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  recordActionDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  recordQuickList: {
    marginTop: 10,
  },
  recordQuickAction: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recordQuickText: {
    flex: 1,
    paddingRight: 12,
  },
  recordQuickTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  recordQuickDesc: {
    marginTop: 3,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  recordQuickChevron: {
    color: colors.textMuted,
    fontSize: 22,
  },
  demoAction: {
    marginTop: 12,
    gap: 10,
  },
  mealRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  mealName: {
    color: colors.text,
    fontWeight: '800',
  },
  mealMeta: {
    color: colors.textSecondary,
    marginTop: 3,
  },
  mealKcal: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  homeScroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  homeContent: {
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  greetingSection: {
    paddingTop: 4,
    marginBottom: 10,
  },
  greetingText: {
    flex: 1,
  },
  greetingTitle: {
    color: colors.text,
    fontSize: compactFont(22, 21),
    lineHeight: 30,
    fontWeight: '700',
  },
  greetingSubtitle: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  dateSelectorSection: {
    marginBottom: 8,
  },
  dateList: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateItem: {
    width: 44,
    height: 80,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 11,
    paddingBottom: 8,
  },
  dateItemSelected: {
    backgroundColor: 'rgba(0, 188, 125, 0.55)',
    shadowColor: '#00bc7d',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  dateItemPressed: {
    transform: [{ scale: 0.96 }],
  },
  dateDayName: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  dateTextSelected: {
    color: '#fff',
  },
  dateDayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  dateDayCircleRecorded: {
    backgroundColor: colors.brand,
  },
  dateDayCircleOver: {
    backgroundColor: 'colors.homeWarningRed',
  },
  dateDayCircleSelected: {
    backgroundColor: 'transparent',
    shadowOpacity: 0,
  },
  dateNumText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  dateNumTextLight: {
    color: '#fff',
  },
  mainCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(227, 233, 238, 0.82)',
  },
  mainCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  mainCardTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexWrap: 'wrap',
  },
  cardLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  cardValue: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
  },
  cardValueOver: {
    color: 'colors.homeWarningRed',
  },
  cardUnit: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
  },
  targetSection: {
    alignItems: 'flex-end',
    minWidth: 96,
    gap: 4,
  },
  targetEnergyNumsOnly: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    gap: 3,
  },
  targetEnergyIntakeNum: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  targetEnergySlashOnly: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  targetEnergyTargetNum: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  progressSection: {
    marginTop: 8,
  },
  progressBarBg: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  progressBarFillOver: {
    backgroundColor: 'colors.homeWarningRed',
  },
  nutritionShell: {
    marginTop: 10,
    borderRadius: 11,
  },
  nutritionExpandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  nutritionTitle: {
    color: '#34495e',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  nutritionExpandAffordance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#f3f8f5',
  },
  nutritionExpandAffordanceText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    color: '#5aa783',
  },
  macrosSection: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 0,
  },
  macroCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 74,
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'stretch',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  macroCardOver: {
    backgroundColor: '#fef3f2',
    borderColor: '#fecaca',
  },
  macroExcessSlot: {
    height: 8,
    justifyContent: 'center',
  },
  macroOverHint: {
    color: 'colors.homeWarningRed',
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
  },
  macroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  macroIconDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  macroLabel: {
    color: '#000',
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '400',
  },
  macroValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 2,
    marginTop: 2,
    flexWrap: 'nowrap',
  },
  macroCurrentValue: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
  },
  macroTargetTotal: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '400',
  },
  macroProgressBarBg: {
    height: 3,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    marginTop: 4,
    overflow: 'hidden',
  },
  macroProgressBarFill: {
    height: 3,
    borderRadius: 999,
  },
  bodyStatusSection: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  bodyStatusCard: {
    flex: 1,
    minHeight: 96,
    borderRadius: 18,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  bodyStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bodyStatusIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyStatusLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  bodyStatusValue: {
    marginTop: 11,
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  bodyStatusHint: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  bodyStatusContentRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 8,
    minHeight: 24,
  },
  bodyStatusUnit: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  bodyStatusEmpty: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  bodyStatusChange: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
  bodyStatusChangeUp: {
    color: 'colors.homeWarningRed',
  },
  bodyStatusChangeDown: {
    color: '#5cb896',
  },
  bodyStatusProgressWrap: {
    marginTop: 6,
  },
  bodyStatusProgressBg: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  bodyStatusProgressFill: {
    height: 4,
    borderRadius: 999,
  },
  bodyStatusProgressText: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
  },
  mealsSection: {
    marginTop: 2,
    marginBottom: 16,
  },
  sectionHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewAllButton: {
    minHeight: 30,
    minWidth: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewAllText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  mealsList: {
    gap: 10,
  },
  mealsEmpty: {
    minHeight: 142,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  mealsEmptyTitle: {
    marginTop: 10,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  mealsEmptyDesc: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
  },
  mealItem: {
    minHeight: 102,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.56)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  mealItemWarning: {
    borderColor: 'rgba(229, 115, 115, 0.32)',
    backgroundColor: '#fef8f8',
  },
  mealMediaWrap: {
    width: 54,
    height: 54,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealMediaPhoto: {
    backgroundColor: '#f3f4f6',
  },
  mealMediaIcon: {
    backgroundColor: '#ecfdf5',
  },
  mealThumbImage: {
    width: '100%',
    height: '100%',
  },
  mealIconText: {
    color: colors.brand,
    fontSize: 17,
    fontWeight: '900',
  },
  mealContent: {
    flex: 1,
    minWidth: 0,
  },
  mealHeaderBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  mealCalorie: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  mealCalorieUnit: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  mealProgressWrap: {
    marginTop: 10,
  },
  mealProgressBarBg: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#eef2f4',
    overflow: 'hidden',
  },
  mealProgressBarFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  mealProgressBarFillWarning: {
    backgroundColor: 'colors.homeWarningRed',
  },
  mealProgressFoot: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mealProgressText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  mealProgressPercent: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '800',
  },
  mealProgressPercentOver: {
    color: 'colors.homeWarningRed',
  },
  expirySection: {
    marginBottom: 16,
  },
  expiryCard: {
    borderRadius: 20,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.54)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
    gap: 10,
  },
  expiryEmpty: {
    minHeight: 92,
    justifyContent: 'center',
  },
  expiryEmptyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  expiryEmptyDesc: {
    marginTop: 5,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  expiryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  expiryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expiryIconFresh: {
    backgroundColor: '#f3f4f6',
  },
  expiryIconSoon: {
    backgroundColor: '#fef3c7',
  },
  expiryIconToday: {
    backgroundColor: '#ffedd5',
  },
  expiryIconExpired: {
    backgroundColor: '#fee2e2',
  },
  expiryIconText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '900',
  },
  expiryContent: {
    flex: 1,
    minWidth: 0,
  },
  expiryHeaderBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  expiryName: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  expiryTimePill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#f8fafc',
  },
  expiryTimePillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  expiryMetaText: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
  },
  statsEntryCard: {
    minHeight: 76,
    borderRadius: 20,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  statsEntryIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  statsEntryText: {
    flex: 1,
    minWidth: 0,
  },
  statsEntryTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  statsEntryDesc: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    lineHeight: 17,
  },
  homeDevActions: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  homeMiniAction: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  homeMiniActionText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  homePromptCard: {
    marginTop: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homePromptIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f8f1',
  },
  homePromptIconText: {
    color: colors.brandDark,
    fontSize: 15,
    fontWeight: '900',
  },
  homePromptCopy: {
    flex: 1,
    minWidth: 0,
  },
  homePromptTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  homePromptDesc: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
  },
  homePromptActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  homePromptPrimary: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: colors.brand,
  },
  homePromptPrimaryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  homePromptSecondary: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  homePromptSecondaryText: {
    fontSize: 10,
    fontWeight: '700',
  },
  homeFirstGuide: {
    marginTop: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  homeFirstGuideHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  homeFirstGuideBadge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: '#e8f8f1',
  },
  homeFirstGuideBadgeText: {
    color: colors.brandDark,
    fontSize: 10,
    fontWeight: '900',
  },
  homeFirstGuideSkip: {
    fontSize: 11,
    fontWeight: '700',
  },
  homeFirstGuideTitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  homeFirstGuideDesc: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
  },
  homeFirstGuideAction: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  homeFirstGuideActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  homeBackfillHint: {
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeBackfillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.brand,
  },
  homeBackfillText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 16,
  },
  homeBackfillAction: {
    color: colors.brandDark,
    fontSize: 11,
    fontWeight: '900',
  },
  homeBackfillDismiss: {
    fontSize: 11,
    fontWeight: '700',
  },
  homeDietEntry: {
    marginBottom: 16,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  homeDietEntryMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  homeDietEntryIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f8f1',
  },
  homeDietEntryCopy: {
    flex: 1,
  },
  homeDietEntryTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  homeDietEntrySubtitle: {
    marginTop: 3,
    fontSize: 12,
  },
  homeDietEntryCredit: {
    marginTop: 9,
    fontSize: 10,
    lineHeight: 15,
  },
  homeDietEntryActions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  homeDietEntryButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeDietEntryButtonPrimary: {
    backgroundColor: colors.brand,
  },
  homeDietEntryButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  homeDietEntryButtonPrimaryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  homeSheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  homeSheetMask: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.46)',
  },
  homeSheet: {
    maxHeight: '78%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  homeSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  homeSheetTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
  },
  homeSheetSubtitle: {
    marginTop: 3,
    fontSize: 11,
  },
  homeMealRecordsScroll: {
    marginTop: 14,
  },
  homeMealRecordRow: {
    minHeight: 78,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  homeMealRecordThumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeMealRecordImage: {
    width: '100%',
    height: '100%',
  },
  homeMealRecordCopy: {
    flex: 1,
    minWidth: 0,
  },
  homeMealRecordTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  homeMealRecordMeta: {
    marginTop: 4,
    fontSize: 11,
  },
  homeMealRecordMacros: {
    marginTop: 3,
    fontSize: 10,
  },
  homeMealRecordArrow: {
    fontSize: 24,
    fontWeight: '300',
  },
  homeActionSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
  },
  homeActionRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  homeActionText: {
    fontSize: 14,
    fontWeight: '800',
  },
  homeActionCancel: {
    marginTop: 10,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeActionCancelText: {
    fontSize: 13,
    fontWeight: '800',
  },
  homeDietSheet: {
    height: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  homeDietKicker: {
    fontSize: 10,
    fontWeight: '900',
  },
  homeDietTabs: {
    marginTop: 14,
    borderRadius: 14,
    padding: 4,
    flexDirection: 'row',
  },
  homeDietTab: {
    flex: 1,
    minHeight: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeDietTabActive: {
    backgroundColor: colors.brand,
  },
  homeDietTabText: {
    fontSize: 12,
    fontWeight: '800',
  },
  homeDietLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeDietScroll: {
    flex: 1,
    marginTop: 10,
  },
  homeDietScrollContent: {
    paddingBottom: 18,
  },
  homeDietSummary: {
    fontSize: 13,
    lineHeight: 20,
  },
  homeDietSourceNote: {
    marginTop: 7,
    fontSize: 10,
    lineHeight: 15,
  },
  homeDietGapRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 7,
  },
  homeDietGap: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 5,
    paddingVertical: 9,
    alignItems: 'center',
  },
  homeDietGapValue: {
    fontSize: 13,
    fontWeight: '900',
  },
  homeDietGapLabel: {
    marginTop: 2,
    fontSize: 9,
  },
  homeDietOption: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  homeDietOptionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  homeDietOptionTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  homeDietOptionCalories: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  homeDietOptionReason: {
    marginTop: 6,
    fontSize: 11,
    lineHeight: 17,
  },
  homeDietOptionSource: {
    marginTop: 5,
    fontSize: 10,
  },
  homeDietFoods: {
    marginTop: 9,
    gap: 6,
  },
  homeDietFood: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  homeDietFoodName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  homeDietFoodAmount: {
    fontSize: 10,
  },
  homeDietOptionMacros: {
    marginTop: 9,
    fontSize: 10,
    lineHeight: 15,
  },
  homeDietRefresh: {
    marginTop: 14,
    minHeight: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f8f1',
  },
  homeDietRefreshText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  targetModal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  targetModalMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  targetModalSheet: {
    maxHeight: '86%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
  },
  targetModalHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    marginBottom: 14,
    backgroundColor: '#e5e7eb',
  },
  targetModalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  targetModalDesc: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
  },
  targetModalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  targetModalCloseText: {
    color: colors.textSecondary,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '300',
  },
  targetSaveButton: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  targetSaveButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  targetCancelButton: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  targetCancelButtonText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.72,
  },
})
