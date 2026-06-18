import { useCallback, useEffect, useState } from 'react'
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { getMealTypeLabel, inferDefaultMealTypeFromLocalTime, type HomeDashboard, type HomeTargetCalibrationSuggestion } from '@food-link/core'
import { Camera, FileText, Image as ImageIcon, Utensils, type LucideIcon } from 'lucide-react-native'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { FloatingPetCompanion } from '../components/FloatingPetCompanion'
import { MacroRow } from '../components/MacroRow'
import { Page } from '../components/Page'
import { SHOW_DEBUG_LOGIN } from '../config'
import { useHomeDashboard } from '../hooks/useHomeDashboard'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors, compactFont } from '../theme'
import { formatShortDate } from '../utils/date'
import { createDemoAnalysisTask, createDemoTextAnalysisTask, demoFoodImageUrl } from '../utils/demoAnalysisTask'
import { userFacingErrorMessage } from '../utils/errors'
import { getHomePetCollapsed, getHomePetHidden, setHomePetCollapsed as persistHomePetCollapsed } from '../utils/petPreferences'

type TargetField = 'calorieTarget' | 'proteinTarget' | 'carbsTarget' | 'fatTarget'
type TargetForm = Record<TargetField, string>
type RecordTone = 'green' | 'blue' | 'gold' | 'purple'
type HomeBannerTone = 'campus' | 'green' | 'gold' | 'blue'
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

const targetFieldMeta: Array<{ key: TargetField; label: string; unit: string; step: number }> = [
  { key: 'calorieTarget', label: '基础摄入目标', unit: 'kcal', step: 100 },
  { key: 'proteinTarget', label: '蛋白质目标', unit: 'g', step: 50 },
  { key: 'carbsTarget', label: '碳水目标', unit: 'g', step: 50 },
  { key: 'fatTarget', label: '脂肪目标', unit: 'g', step: 10 },
]

const recordIconColors: Record<RecordTone, string> = {
  green: '#38a97b',
  blue: '#4295bc',
  gold: '#9f823a',
  purple: '#6951bd',
}

const CAFETERIA_HERO_BG_URL = 'https://cdn-food-images.coachlink.fit/wechat/cafeteria-hero.jpg'

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { width: windowWidth } = useWindowDimensions()
  const { recordDate, dashboard, petSummary, loading, error, loadHome } = useHomeDashboard()
  const [activeBannerIndex, setActiveBannerIndex] = useState(0)
  const [showTargetEditor, setShowTargetEditor] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [homePetHidden, setHomePetHidden] = useState(false)
  const [homePetCollapsed, setHomePetCollapsed] = useState(false)
  const [targetForm, setTargetForm] = useState<TargetForm>(() => targetFormFromDashboard(null))
  const mealType = inferDefaultMealTypeFromLocalTime()
  const nutritionTarget = dashboard?.nutritionTarget
  const calibrationSuggestion = nutritionTarget?.calibration_suggestion
  const bannerWidth = Math.max(280, windowWidth - 40)
  const homeBanners: HomeBanner[] = [
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
      key: 'history',
      kicker: 'AI 记录',
      title: '识别记录',
      desc: '继续查看过往图片识别和分析进度',
      actionText: '去查看',
      tone: 'blue',
      onPress: () => navigation.navigate('AnalyzeHistory'),
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

  const openDemoResult = useCallback(() => {
    navigation.navigate('Result', {
      task: createDemoAnalysisTask(),
      imageUri: demoFoodImageUrl,
      mealType,
      date: recordDate,
    })
  }, [navigation, mealType, recordDate])

  const openDemoTextResult = useCallback(() => {
    navigation.navigate('TextResult', {
      task: createDemoTextAnalysisTask(),
      mealType,
      date: recordDate,
    })
  }, [navigation, mealType, recordDate])

  useEffect(() => {
    if (!showTargetEditor) {
      setTargetForm(targetFormFromDashboard(dashboard))
    }
  }, [dashboard, showTargetEditor])

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

  return (
    <View style={styles.homeRoot}>
      <Page
        title={homeGreeting()}
        subtitle={`${formatShortDate(recordDate)} · 今天也要健康饮食哦 · 默认餐次 ${getMealTypeLabel(mealType)}`}
        refreshing={loading}
        onRefresh={loadHome}
      >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <HomeBannerCarousel
        banners={homeBanners}
        activeIndex={activeBannerIndex}
        bannerWidth={bannerWidth}
        onIndexChange={setActiveBannerIndex}
      />

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>今日概览</Text>
          <Pressable onPress={() => navigation.navigate('DayRecord', { date: recordDate })}>
            <Text style={styles.link}>单日详情</Text>
          </Pressable>
        </View>
        <Text style={styles.bigNumber} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {Math.round(dashboard?.intakeData.current || 0)} / {Math.round(dashboard?.intakeData.target || 0)} kcal
        </Text>
        <Text style={styles.subtitle}>运动消耗 {Math.round(dashboard?.exerciseBurnedKcal || 0)} kcal</Text>
        <MacroRow label="蛋白质" value={dashboard?.intakeData.macros.protein.current} target={dashboard?.intakeData.macros.protein.target} />
        <MacroRow label="碳水" value={dashboard?.intakeData.macros.carbs.current} target={dashboard?.intakeData.macros.carbs.target} />
        <MacroRow label="脂肪" value={dashboard?.intakeData.macros.fat.current} target={dashboard?.intakeData.macros.fat.target} />
        <View style={styles.targetInfoBox}>
          <View style={styles.rowBetween}>
            <View style={styles.targetInfoMain}>
              <Text style={styles.targetInfoTitle}>基础目标</Text>
              <Text style={styles.targetInfoMeta}>
                {targetSourceLabel(nutritionTarget?.source)} · 长期目标不随当天运动自动变化
              </Text>
            </View>
            <Pressable onPress={openTargetEditor} style={({ pressed }) => [styles.targetEditButton, pressed && styles.pressed]}>
              <Text style={styles.targetEditButtonText}>调整</Text>
            </Pressable>
          </View>
          {nutritionTarget?.explanation ? <Text style={styles.targetInfoText}>{nutritionTarget.explanation}</Text> : null}
          {nutritionTarget?.macro_explanation ? <Text style={styles.targetInfoText}>{nutritionTarget.macro_explanation}</Text> : null}
          {calibrationSuggestion?.available ? (
            <Text style={styles.targetHint}>
              建议调整到 {Math.round(numberFrom(calibrationSuggestion.suggested_kcal, 0))} kcal：{calibrationSuggestion.reason || '根据近期记录建议小幅校准。'}
            </Text>
          ) : null}
        </View>
      </Card>

      {showTargetEditor ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>基础目标设置</Text>
            <Pressable onPress={() => setShowTargetEditor(false)} disabled={savingTargets}>
              <Text style={styles.link}>收起</Text>
            </Pressable>
          </View>
          <Text style={styles.subtitle}>用于首页和单日记录的长期基础目标，保存后会同步刷新今日概览。</Text>
          {calibrationSuggestion?.available ? (
            <View style={styles.calibrationCard}>
              <Text style={styles.calibrationTitle}>建议调整到 {Math.round(numberFrom(calibrationSuggestion.suggested_kcal, 0))} kcal</Text>
              <Text style={styles.calibrationText}>{calibrationSuggestion.reason || '根据最近 14 天饮食和体重变化，建议小幅调整基础目标。'}</Text>
              <View style={styles.targetActionRow}>
                <Pressable style={styles.secondaryMiniButton} onPress={() => void dialog.alert('已暂不调整')}>
                  <Text style={styles.secondaryMiniButtonText}>暂不调整</Text>
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
            />
          ))}
          <View style={styles.targetSaveRow}>
            <AppButton label="保存目标" loading={savingTargets} onPress={() => void saveTargets()} />
            <AppButton label="取消" variant="secondary" onPress={() => setShowTargetEditor(false)} />
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>今天吃什么</Text>
          <Text style={styles.badge}>AI 记录</Text>
        </View>
        <View style={styles.recordGrid}>
          <RecordGridAction title="拍照识别" desc="拍摄餐食，自动估算热量" icon={Camera} tone="green" onPress={() => openAnalyze('camera')} />
          <RecordGridAction title="相册上传" desc="选择已有食物图片" icon={ImageIcon} tone="blue" onPress={() => openAnalyze('library')} />
          <RecordGridAction title="文本输入" desc="一句话描述吃了什么" icon={FileText} tone="gold" onPress={() => navigation.navigate('TextRecord')} />
          <RecordGridAction title="食物库输入" desc="按食物和重量精确录入" icon={Utensils} tone="purple" onPress={() => navigation.navigate('ManualRecord')} />
        </View>
        <View style={styles.recordQuickList}>
          <RecordQuickAction title="我的收藏" desc="快速记录常吃餐食" onPress={() => navigation.navigate('Recipes')} />
          <RecordQuickAction title="识别记录" desc="查看以往识别结果" onPress={() => navigation.navigate('AnalyzeHistory')} />
          <RecordQuickAction title="包装食品" desc="上传营养成分表或商品包装" onPress={() => navigation.navigate('PackagedFoodEdit')} />
          <RecordQuickAction title="食物库" desc="浏览营养库与自定义食物" onPress={() => navigation.navigate('FoodLibrary')} />
        </View>
        {SHOW_DEBUG_LOGIN ? (
          <View style={styles.demoAction}>
            <AppButton label="示例识别结果" variant="secondary" onPress={openDemoResult} />
            <AppButton label="示例文字结果" variant="secondary" onPress={openDemoTextResult} />
          </View>
        ) : null}
      </Card>

      <View style={styles.quickGrid}>
        <QuickCard title="体重" value="记录" onPress={() => navigation.navigate('BodyMetricRecord', { type: 'weight' })} />
        <QuickCard title="喝水" value="补水" onPress={() => navigation.navigate('BodyMetricRecord', { type: 'water' })} />
        <QuickCard title="运动" value={`${Math.round(dashboard?.exerciseBurnedKcal || 0)} kcal`} onPress={() => navigation.navigate('BodyMetricRecord', { type: 'exercise' })} />
      </View>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>今日餐食</Text>
          <Pressable onPress={() => navigation.navigate('AnalyzeHistory')}>
            <Text style={styles.link}>识别历史</Text>
          </Pressable>
        </View>
        {(dashboard?.meals || []).length === 0 ? (
          <Text style={styles.empty}>今天还没有记录餐食</Text>
        ) : (
          dashboard?.meals.map((meal) => (
            <Pressable
              key={`${meal.type}-${meal.time}`}
              style={styles.mealRow}
              onPress={() => meal.primary_record_id ? navigation.navigate('RecordDetail', { recordId: meal.primary_record_id }) : undefined}
            >
              <View>
                <Text style={styles.mealName}>{meal.name || getMealTypeLabel(meal.type)}</Text>
                <Text style={styles.mealMeta}>{getMealTypeLabel(meal.type)} · {meal.time}</Text>
              </View>
              <Text style={styles.mealKcal}>{Math.round(meal.calorie || 0)} kcal</Text>
            </Pressable>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>食物保质期</Text>
          <Pressable onPress={() => navigation.navigate('Expiry')}>
            <Text style={styles.link}>管理</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          {dashboard?.expirySummary
            ? `当前 ${dashboard.expirySummary.active_count ?? 0} 样，今日到期 ${dashboard.expirySummary.today_count ?? 0} 样`
            : '当前没有临期食物'}
        </Text>
      </Card>

      <AppButton label="刷新首页" variant="secondary" loading={loading} onPress={loadHome} />
      <AppButton label="健康档案与目标" variant="ghost" onPress={() => navigation.navigate('HealthProfile')} />
      </Page>
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

function HomeBannerCarousel({
  banners,
  activeIndex,
  bannerWidth,
  onIndexChange,
}: {
  banners: HomeBanner[]
  activeIndex: number
  bannerWidth: number
  onIndexChange: (index: number) => void
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
                <HomeBannerContent banner={banner} image />
              </ImageBackground>
            ) : (
              <View
                style={[
                  styles.homeBanner,
                  banner.tone === 'green' && styles.homeBannerGreen,
                  banner.tone === 'gold' && styles.homeBannerGold,
                  banner.tone === 'blue' && styles.homeBannerBlue,
                ]}
              >
                <HomeBannerContent banner={banner} />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
      {banners.length > 1 ? (
        <View style={styles.homeBannerDots}>
          {banners.map((banner, index) => (
            <View
              key={`${banner.key}-dot`}
              style={[styles.homeBannerDot, index === activeIndex && styles.homeBannerDotActive]}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

function HomeBannerContent({ banner, image = false }: { banner: HomeBanner; image?: boolean }) {
  return (
    <View style={[styles.homeBannerOverlay, image && styles.homeBannerImageOverlay]}>
      <View style={styles.homeBannerText}>
        <Text style={[styles.homeBannerKicker, image && styles.homeBannerTextLight]} numberOfLines={1}>{banner.kicker}</Text>
        <Text style={[styles.homeBannerTitle, image && styles.homeBannerTextLight]} numberOfLines={2}>{banner.title}</Text>
        <Text style={[styles.homeBannerSubtitle, image && styles.homeBannerTextLight]} numberOfLines={2}>{banner.desc}</Text>
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
}: {
  label: string
  unit: string
  value: string
  onChangeText: (value: string) => void
  onDecrease: () => void
  onIncrease: () => void
}) {
  return (
    <View style={styles.targetField}>
      <Text style={styles.targetFieldLabel}>{label}</Text>
      <View style={styles.targetInputRow}>
        <Pressable style={styles.targetAdjustButton} onPress={onDecrease}>
          <Text style={styles.targetAdjustButtonText}>-</Text>
        </Pressable>
        <View style={styles.targetInputWrap}>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            keyboardType="decimal-pad"
            style={styles.targetInput}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.targetInputUnit}>{unit}</Text>
        </View>
        <Pressable style={styles.targetAdjustButton} onPress={onIncrease}>
          <Text style={styles.targetAdjustButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

function QuickCard({ title, value, onPress }: { title: string; value: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickValue}>{value}</Text>
    </Pressable>
  )
}

function RecordGridAction({
  title,
  desc,
  icon,
  tone,
  onPress,
}: {
  title: string
  desc: string
  icon: LucideIcon
  tone: RecordTone
  onPress: () => void
}) {
  const Icon = icon
  return (
    <Pressable
      style={({ pressed }) => [
        styles.recordActionCard,
        tone === 'green' && styles.recordActionGreen,
        tone === 'blue' && styles.recordActionBlue,
        tone === 'gold' && styles.recordActionGold,
        tone === 'purple' && styles.recordActionPurple,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View style={[
        styles.recordActionIcon,
        tone === 'green' && styles.recordIconGreen,
        tone === 'blue' && styles.recordIconBlue,
        tone === 'gold' && styles.recordIconGold,
        tone === 'purple' && styles.recordIconPurple,
      ]}>
        <Icon size={23} color={recordIconColors[tone]} strokeWidth={2.4} />
      </View>
      <Text style={styles.recordActionTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86}>{title}</Text>
      <Text style={styles.recordActionDesc} numberOfLines={2}>{desc}</Text>
    </Pressable>
  )
}

function RecordQuickAction({ title, desc, onPress }: { title: string; desc: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.recordQuickAction, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.recordQuickText}>
        <Text style={styles.recordQuickTitle}>{title}</Text>
        <Text style={styles.recordQuickDesc}>{desc}</Text>
      </View>
      <Text style={styles.recordQuickChevron}>›</Text>
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

function targetSourceLabel(source: unknown): string {
  const labels: Record<string, string> = {
    manual: '手动目标',
    system_initial: '健康档案目标',
    profile: '健康档案估算',
    dynamic: '系统估算',
    default: '默认目标',
  }
  return labels[String(source || '').trim()] || '系统目标'
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
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  link: {
    color: colors.brandDark,
    fontWeight: '700',
  },
  bigNumber: {
    fontSize: compactFont(32, 30),
    fontWeight: '900',
    color: colors.brandDark,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  targetInfoBox: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  targetInfoMain: {
    flex: 1,
    paddingRight: 12,
  },
  targetInfoTitle: {
    color: colors.text,
    fontWeight: '900',
  },
  targetInfoMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  targetInfoText: {
    marginTop: 8,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  targetEditButton: {
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  targetEditButtonText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  targetHint: {
    marginTop: 10,
    color: colors.orange,
    lineHeight: 20,
    fontWeight: '700',
  },
  calibrationCard: {
    marginTop: 14,
    marginBottom: 12,
    borderRadius: 16,
    padding: 14,
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
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  primaryMiniButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  secondaryMiniButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
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
    width: 44,
    height: 44,
    borderRadius: 12,
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
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  targetInput: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    paddingVertical: 10,
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
    marginBottom: 14,
  },
  homeBannerTrack: {
    alignItems: 'stretch',
  },
  homeBannerSlide: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  homeBanner: {
    minHeight: 112,
    justifyContent: 'flex-end',
    overflow: 'hidden',
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
    borderRadius: 16,
  },
  homeBannerOverlay: {
    minHeight: 112,
    padding: 16,
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
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 5,
  },
  homeBannerTitle: {
    color: colors.text,
    fontSize: compactFont(21, 19),
    fontWeight: '900',
    lineHeight: 24,
    marginBottom: 6,
  },
  homeBannerSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  homeBannerTextLight: {
    color: '#fff',
  },
  homeBannerButton: {
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 14,
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
    height: 16,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  homeBannerDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  homeBannerDotActive: {
    width: 18,
    backgroundColor: colors.brand,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  quickCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.75,
  },
  quickTitle: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  quickValue: {
    marginTop: 8,
    color: colors.text,
    fontWeight: '800',
  },
  recordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  recordActionCard: {
    width: '48%',
    maxWidth: '48%',
    minHeight: 108,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
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
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
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
    fontWeight: '900',
    fontSize: 14,
  },
  recordActionDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 5,
  },
  recordQuickList: {
    marginTop: 12,
  },
  recordQuickAction: {
    minHeight: 66,
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
    fontWeight: '900',
  },
  recordQuickDesc: {
    marginTop: 3,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  recordQuickChevron: {
    color: colors.textMuted,
    fontSize: 28,
  },
  demoAction: {
    marginTop: 12,
    gap: 10,
  },
  mealRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 13,
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
})
