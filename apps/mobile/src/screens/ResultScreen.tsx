import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  buildSaveFoodRecordRequestFromTask,
  type AnalyzeCorrectionItem,
  type AnalysisEngine,
  type EatingMood,
  type ExecutionMode,
  getMealTypeLabel,
  type FoodItem,
  type FoodRecordItemPayload,
  type Nutrients,
  type PrecisionReferenceObjectInput,
} from '@food-link/core'
import { apiClient } from '../api'
import { EatingMoodPicker } from '../components/EatingMoodPicker'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'
import { emitHomeIntakeDataChangedEvent } from '../utils/home-events'

type ResultRoute = RouteProp<RootStackParamList, 'Result'>

type EditableResultItem = {
  clientId: string
  sourceIndex: number
  isManual?: boolean
  name: string
  weightText: string
  ratio: number
  baseWeight: number
  baseNutrients: Nutrients
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
  packagedCandidates?: Array<Record<string, unknown>>
  packagedFoodId?: string
  packageMatchStatus?: string
  packageWeightApplied?: boolean
  packageWeightSource?: string
  packageWeightReason?: string
}

const ratioOptions = [25, 50, 75, 100]
const HEALTH_PROFILE_PROMPT_SHOWN_KEY = 'food_link_mobile_analysis_health_profile_prompt_shown'

type ScoreTone = 'positive' | 'neutral' | 'warning' | 'danger'

function scoreToTone(score: number): ScoreTone {
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

const scoreToneColors: Record<ScoreTone, { bg: string; text: string }> = {
  positive: { bg: '#dcfce7', text: '#166534' },
  neutral: { bg: '#e0f2fe', text: '#075985' },
  warning: { bg: '#fef3c7', text: '#92400e' },
  danger: { bg: '#fee2e2', text: '#991b1b' },
}

function clampScorePercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function ResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<ResultRoute>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const { task, imageUri, mealType, date } = route.params
  const foodItems = task.result?.items || []
  const [items, setItems] = useState<EditableResultItem[]>(() => buildEditableItems(foodItems))
  const [customPeople, setCustomPeople] = useState('')
  const [eatingMood, setEatingMood] = useState<EatingMood | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingRecipe, setSavingRecipe] = useState(false)
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null)
  const [correctionVisible, setCorrectionVisible] = useState(false)
  const [correctionContext, setCorrectionContext] = useState('')
  const [correcting, setCorrecting] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)
  const [precisionContext, setPrecisionContext] = useState('')
  const [referenceObjects, setReferenceObjects] = useState<PrecisionReferenceObjectInput[]>(() => taskReferenceObjects(task))
  const [referenceName, setReferenceName] = useState('')
  const [referenceLength, setReferenceLength] = useState('')
  const [referenceWidth, setReferenceWidth] = useState('')
  const [referenceHeight, setReferenceHeight] = useState('')
  const [referencePlacement, setReferencePlacement] = useState('')
  const [continuingPrecision, setContinuingPrecision] = useState(false)
  const recipeSaveInFlightRef = useRef(false)
  const correctionInFlightRef = useRef(false)
  const feedbackInFlightRef = useRef(false)

  useEffect(() => {
    setItems(buildEditableItems(foodItems))
    setEatingMood(null)
    setSavedRecipeId(null)
    setReferenceObjects(taskReferenceObjects(task))
  }, [task.id, foodItems.length])

  useEffect(() => {
    let active = true
    const promptForHealthProfile = async () => {
      try {
        const shown = await AsyncStorage.getItem(HEALTH_PROFILE_PROMPT_SHOWN_KEY)
        if (shown) return
        const profile = await apiClient.getHealthProfile()
        const onboardingStatus = String(
          (profile as typeof profile & { onboarding_status?: string }).onboarding_status
          || (profile.onboarding_completed === true ? 'completed' : 'pending'),
        )
        if (onboardingStatus === 'completed' || !active) return
        await AsyncStorage.setItem(HEALTH_PROFILE_PROMPT_SHOWN_KEY, '1')
        if (!active) return
        const result = await dialog.showDialog({
          title: '让分析建议更贴合你',
          message: '完善健康档案后，食物分析会结合你的过敏/忌口、饮食偏好和每日消耗，给出更安全、更适合你的建议。',
          kind: 'info',
          cancelText: '暂不填写',
          confirmText: '去完善',
        })
        if (result === 'confirm' && active) navigation.navigate('HealthProfile')
      } catch {
        // 档案提示读取失败不影响分析结果展示。
      }
    }
    void promptForHealthProfile()
    return () => {
      active = false
    }
  }, [dialog, navigation, task.id])

  const totals = useMemo(() => calculateTotals(items), [items])
  const imageSource = imageUri || stringOrUndefined(task.image_url) || firstImage(task.image_paths)
  const mealLabel = getMealTypeLabel(mealType)
  const heroHeight = imageSource ? 292 : 246
  const macroMax = Math.max(totals.protein, totals.carbs, totals.fat, 1)
  const resultDescription = String(task.result?.description || '食物分析已完成')
  const executionMode = taskExecutionMode(task)
  const precisionSessionId = taskPrecisionSessionId(task)

  const scoreEnabled = Boolean(task.result?.score_enabled)
  const finalScore = scoreEnabled ? Number(task.result?.final_score ?? NaN) : NaN
  const micronutrientScore = scoreEnabled ? Number(task.result?.micronutrient_score ?? NaN) : NaN
  const macroBalanceScore = scoreEnabled ? Number(task.result?.macro_balance_score ?? NaN) : NaN
  const calorieScore = scoreEnabled ? Number(task.result?.calorie_score ?? NaN) : NaN

  const saveRecord = async () => {
    if (items.length === 0) {
      void dialog.alert('无法保存', '当前识别结果没有可保存的食物明细', 'warning')
      return
    }

    const invalidItem = items.find((item) => !isEditableItemValid(item))
    if (invalidItem) {
      void dialog.alert('无法保存', '请确认每项食物都有名称、重量；手动新增项还需要填写每100g热量。', 'warning')
      return
    }

    setSaving(true)
    try {
      const payload = buildCurrentRecordPayload(task, items, mealType, date, totals)
      if (eatingMood) payload.eating_mood = eatingMood

      const pfcRatioComment = stringOrUndefined(task.result?.pfc_ratio_comment)
      const absorptionNotes = stringOrUndefined(task.result?.absorption_notes)
      const contextAdvice = stringOrUndefined(task.result?.context_advice)
      if (pfcRatioComment) payload.pfc_ratio_comment = pfcRatioComment
      if (absorptionNotes) payload.absorption_notes = absorptionNotes
      if (contextAdvice) payload.context_advice = contextAdvice

      const saved = await apiClient.saveFoodRecord(payload)
      emitHomeIntakeDataChangedEvent({ date, force: true })
      const message = saved.already_saved ? '这条记录之前已经保存。' : '已记录到当天饮食。'
      if (!saved.id) {
        const result = await dialog.showDialog({
          title: '保存成功',
          message,
          kind: 'success',
          confirmText: '回到首页',
        })
        if (result === 'confirm') {
          navigation.dispatch(CommonActions.navigate('MainTabs'))
        }
        return
      }
      const result = await dialog.showDialog({
        title: '保存成功',
        message,
        kind: 'success',
        cancelText: '回到首页',
        confirmText: '查看记录',
      })
      if (result === 'confirm') {
        navigation.navigate('RecordDetail', { recordId: saved.id })
      } else if (result === 'cancel') {
        navigation.dispatch(CommonActions.navigate('MainTabs'))
      }
    } catch (error) {
      void dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const saveAsRecipe = async () => {
    if (savedRecipeId) {
      await dialog.alert('该餐食已收藏', '可以在“我的收藏”中继续查看和复用。', 'info')
      return
    }
    if (recipeSaveInFlightRef.current) return
    if (items.length === 0) {
      await dialog.alert('无法收藏', '当前识别结果没有可收藏的食物明细。', 'warning')
      return
    }
    const invalidItem = items.find((item) => !isEditableItemValid(item))
    if (invalidItem) {
      await dialog.alert('无法收藏', '请确认每项食物都有名称、重量；手动新增项还需要填写每100g热量。', 'warning')
      return
    }

    recipeSaveInFlightRef.current = true
    setSavingRecipe(true)
    try {
      const payload = buildCurrentRecordPayload(task, items, mealType, date, totals)
      const created = await apiClient.createRecipe({
        recipeName: recipeNameFromItems(items, mealLabel),
        description: resultDescription,
        imagePath: stringOrUndefined(task.image_url) || firstImage(task.image_paths),
        items: payload.items as unknown as Array<Record<string, unknown>>,
        totalCalories: payload.total_calories,
        totalProtein: payload.total_protein,
        totalCarbs: payload.total_carbs,
        totalFat: payload.total_fat,
        totalWeightGrams: payload.total_weight_grams,
        mealType,
        tags: ['识别记录'],
        isFavorite: true,
      })
      setSavedRecipeId(created.id)
      await dialog.alert('收藏成功', '已收藏到“我的收藏”，之后可以直接复用到餐食记录。', 'success')
    } catch (error) {
      await dialog.alert('收藏失败', userFacingErrorMessage(error), 'danger')
    } finally {
      recipeSaveInFlightRef.current = false
      setSavingRecipe(false)
    }
  }

  const updateItem = (index: number, patch: Partial<EditableResultItem>) => {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  const addManualItem = () => {
    setItems((current) => [
      ...current,
      {
        clientId: `manual-${Date.now()}-${current.length}`,
        sourceIndex: -1,
        isManual: true,
        name: '',
        weightText: '100',
        ratio: 100,
        baseWeight: 100,
        baseNutrients: normalizeNutrients({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }),
      },
    ])
  }

  const updateManualNutrient = (index: number, key: 'calories' | 'protein' | 'carbs' | 'fat', value: string) => {
    const parsed = Number(value.replace(',', '.'))
    setItems((current) => current.map((item, itemIndex) => itemIndex === index
      ? {
        ...item,
        baseNutrients: {
          ...item.baseNutrients,
          [key]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
        },
      }
      : item))
  }

  const addPresetReference = (reference: PrecisionReferenceObjectInput) => {
    setReferenceObjects((current) => current.some((item) => item.reference_name === reference.reference_name)
      ? current
      : [...current, reference])
  }

  const addCustomReference = async () => {
    const name = referenceName.trim()
    const dimensions = {
      length: positiveNumberOrUndefined(referenceLength),
      width: positiveNumberOrUndefined(referenceWidth),
      height: positiveNumberOrUndefined(referenceHeight),
    }
    if (!name || (!dimensions.length && !dimensions.width && !dimensions.height)) {
      await dialog.alert('参考物信息不完整', '请填写参考物名称，并至少填写一个大于 0 的尺寸。', 'warning')
      return
    }
    setReferenceObjects((current) => [...current, {
      reference_type: 'custom',
      reference_name: name,
      dimensions_mm: dimensions,
      placement_note: referencePlacement.trim() || undefined,
    }])
    setReferenceName('')
    setReferenceLength('')
    setReferenceWidth('')
    setReferenceHeight('')
    setReferencePlacement('')
  }

  const removeItem = async (index: number) => {
    const item = items[index]
    if (!item) return
    const confirmed = await dialog.confirm({
      title: '删除食物',
      message: `确定要删除“${item.name.trim() || '未命名食物'}”吗？本次保存和收藏都不会再包含它。`,
      confirmText: '删除',
      cancelText: '取消',
      kind: 'danger',
    })
    if (!confirmed) return
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const applyPackagedCandidate = async (index: number, candidate: Record<string, unknown>) => {
    const weight = candidateNumber(candidate, 'net_weight_g', 'netWeightG', 'net_content_value', 'netContentValue')
    if (weight <= 0) {
      await dialog.alert('无法使用该规格', '该包装规格缺少净含量，请选择其他规格或手动修改重量。', 'warning')
      return
    }
    const unitNutrients = candidateNutritionPer100(candidate)
    const nutrients = scaledNutrients(unitNutrients, weight, 100)
    if (numberFrom(nutrients.calories) <= 0) {
      nutrients.calories = round1Number(
        numberFrom(nutrients.protein) * 4 + numberFrom(nutrients.carbs) * 4 + numberFrom(nutrients.fat) * 9,
      )
    }
    const candidateId = candidateText(candidate, 'packaged_food_id', 'id')
    const name = candidateText(candidate, 'display_name', 'displayName', 'name') || items[index]?.name || '包装食品'
    const netLabel = candidateNetContentLabel(candidate)
    updateItem(index, {
      name,
      weightText: formatInputNumber(weight),
      baseWeight: weight,
      baseNutrients: nutrients,
      packagedFoodId: candidateId || undefined,
      packageMatchStatus: 'matched',
      packageWeightApplied: true,
      packageWeightSource: 'packaged_food_library',
      packageWeightReason: netLabel ? `已选择包装规格 ${netLabel}` : '已选择包装库候选规格',
    })
  }

  const applyPeopleRatio = (people: number) => {
    if (!Number.isFinite(people) || people < 1 || people > 99) {
      void dialog.alert('人数无效', '请输入 1 到 99 之间的人数', 'warning')
      return
    }
    const ratio = clampRatio(Math.round(100 / people))
    setItems((current) => current.map((item) => ({ ...item, ratio })))
  }

  const applyCustomPeopleRatio = () => {
    applyPeopleRatio(Number(customPeople))
  }

  const submitCorrection = async () => {
    if (correctionInFlightRef.current) return
    if (items.length === 0 || items.some((item) => !isEditableItemValid(item))) {
      await dialog.alert('无法纠错', '请保留至少一项食物，并确认名称、重量和手动新增项的热量填写完整。', 'warning')
      return
    }
    const imageUrls = taskImageUrls(task)
    if (imageUrls.length === 0) {
      await dialog.alert('缺少原图', '这条记录没有可重新分析的云端原图，请重新拍摄。', 'warning')
      return
    }

    correctionInFlightRef.current = true
    setCorrecting(true)
    try {
      const previousResult = buildEditedAnalyzeResult(task, items, totals)
      const correctionItems = buildAnalyzeCorrectionItems(foodItems, items)
      const editSummary = describeCorrectionEdits(foodItems, items)
      const context = [correctionContext.trim(), editSummary]
        .filter(Boolean)
        .join('\n') || '用户发起了二次纠错，请结合当前食物列表重新分析。'
      const submitted = await apiClient.submitAnalyzeTask({
        image_url: imageUrls[0],
        image_urls: imageUrls,
        meal_type: mealType,
        date,
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        diet_goal: stringOrUndefined(task.payload?.diet_goal) || 'none',
        activity_timing: stringOrUndefined(task.payload?.activity_timing),
        additionalContext: context,
        suggest_ratio_enabled: task.payload?.suggest_ratio_enabled !== false,
        execution_mode: executionMode,
        analysis_engine: taskAnalysisEngine(task),
        previousResult,
        correction_source_task_id: task.id,
        correction_root_task_id: taskCorrectionRootId(task),
        precision_session_id: precisionSessionId || undefined,
        reference_objects: referenceObjects.length > 0 ? referenceObjects : undefined,
        correctionItems,
      })
      void apiClient.submitAnalysisFeedback({
        feedback_type: 'suspect_distrust',
        resolution_state: 'still_distrust',
        source_task_id: task.id,
        before_result: task.result || undefined,
        after_result: previousResult,
        user_correction_items: correctionItems as unknown as Array<Record<string, unknown>>,
        payload_snapshot: feedbackPayloadSnapshot(task, precisionSessionId, items.length),
        analysis_engine: taskAnalysisEngine(task),
      }).catch(() => undefined)
      setCorrectionVisible(false)
      setCorrectionContext('')
      navigation.replace('AnalyzeLoading', {
        taskId: submitted.task_id,
        imageUri,
        imageUris: imageUrls,
        mealType,
        date,
        taskType: 'food',
        executionMode,
      })
    } catch (error) {
      await dialog.alert('重新分析失败', userFacingErrorMessage(error), 'danger')
    } finally {
      correctionInFlightRef.current = false
      setCorrecting(false)
    }
  }

  const submitFeedbackOnly = async () => {
    if (feedbackInFlightRef.current) return
    feedbackInFlightRef.current = true
    setFeedbackSubmitting(true)
    try {
      const currentResult = buildEditedAnalyzeResult(task, items, totals)
      const correctionItems = buildAnalyzeCorrectionItems(foodItems, items)
      await apiClient.submitAnalysisFeedback({
        feedback_type: 'suspect_distrust',
        resolution_state: 'still_distrust',
        source_task_id: task.id,
        before_result: task.result || undefined,
        after_result: currentResult,
        user_correction_items: correctionItems as unknown as Array<Record<string, unknown>>,
        payload_snapshot: {
          ...feedbackPayloadSnapshot(task, precisionSessionId, items.length),
          has_user_feedback: Boolean(correctionContext.trim()),
        },
        analysis_engine: taskAnalysisEngine(task),
      })
      setCorrectionVisible(false)
      setCorrectionContext('')
      await dialog.alert('感谢反馈', '本次结果已记录，我们会用于改进后续识别。', 'success')
    } catch (error) {
      await dialog.alert('反馈失败', userFacingErrorMessage(error), 'danger')
    } finally {
      feedbackInFlightRef.current = false
      setFeedbackSubmitting(false)
    }
  }

  const continuePrecision = async () => {
    if (!precisionSessionId || continuingPrecision) return
    if (!precisionContext.trim() && referenceObjects.length === 0) {
      await dialog.alert('请补充信息', '请描述需要进一步确认的食物或重量，或先重拍带参考物的照片。', 'warning')
      return
    }
    setContinuingPrecision(true)
    try {
      const currentResult = buildEditedAnalyzeResult(task, items, totals)
      const submitted = await apiClient.continuePrecisionSession(precisionSessionId, {
        source_type: 'image',
        date,
        additionalContext: precisionContext.trim() || undefined,
        meal_type: mealType,
        diet_goal: stringOrUndefined(task.payload?.diet_goal) || 'none',
        activity_timing: stringOrUndefined(task.payload?.activity_timing),
        suggest_ratio_enabled: task.payload?.suggest_ratio_enabled !== false,
        previousResult: currentResult,
        correctionItems: buildAnalyzeCorrectionItems(foodItems, items),
        reference_objects: referenceObjects.length > 0 ? referenceObjects : undefined,
      })
      navigation.replace('AnalyzeLoading', {
        taskId: submitted.task_id,
        imageUri,
        mealType,
        date,
        taskType: 'food',
        executionMode: 'strict',
      })
    } catch (error) {
      await dialog.alert('继续分析失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setContinuingPrecision(false)
    }
  }

  const retakePrecision = () => {
    if (!precisionSessionId) return
    navigation.navigate('Analyze', {
      source: 'camera',
      mealType,
      date,
      precisionSessionId,
      referenceObjects,
    })
  }

  return (
    <View style={styles.page}>
      <View style={[styles.hero, { height: heroHeight + insets.top }]}>
        {imageSource ? (
          <Image source={{ uri: imageSource }} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <View style={styles.heroPlaceholder}>
            <View style={styles.heroPlaceholderIcon}>
              <Text style={styles.heroPlaceholderIconText}>AI</Text>
            </View>
            <Text style={styles.heroPlaceholderText}>{resultDescription}</Text>
          </View>
        )}
        <View style={styles.heroShade} />
        <View style={[styles.heroCopy, { paddingTop: insets.top + 18 }]}>
          <Text style={styles.heroKicker}>识别结果</Text>
          <Text style={styles.heroTitle}>{mealLabel}</Text>
          <Text style={styles.heroMeta}>{date} · 已识别 {items.length} 项</Text>
        </View>
      </View>

      <ScrollView
        style={styles.resultScroll}
        contentContainerStyle={[
          styles.resultScrollInner,
          { paddingTop: heroHeight + insets.top - 28, paddingBottom: 188 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentContainer}>
          <View style={styles.executionModeRow}>
            <View style={styles.executionModeLeft}>
              <Text style={styles.executionModeTag}>{executionModeLabel(executionMode)}</Text>
              <Text style={styles.executionModeText}>{mealLabel} · {date}</Text>
            </View>
            <Pressable style={styles.modeHistoryButton} onPress={() => navigation.navigate('AnalyzeHistory')}>
              <Text style={styles.modeHistoryText}>历史</Text>
            </Pressable>
          </View>

          <View style={styles.insightCard}>
            <Text style={styles.eyebrow}>识别描述</Text>
            <Text style={styles.description}>{resultDescription}</Text>
          </View>

          <EatingMoodPicker value={eatingMood} onChange={setEatingMood} />

          <View style={styles.nutritionOverviewCard}>
            <View style={styles.nutritionHeader}>
              <View style={styles.caloriesMain}>
                <Text style={styles.caloriesValue}>{Math.round(totals.calories)}</Text>
                <View style={styles.caloriesUnitRow}>
                  <Text style={styles.caloriesUnit}>kcal</Text>
                  <Text style={styles.caloriesLabel}>总热量</Text>
                </View>
              </View>
              <View style={styles.totalWeightBadge}>
                <Text style={styles.weightText}>{Math.round(totals.weight)}g</Text>
              </View>
            </View>

            <View style={styles.macroGrid}>
              <View style={styles.macroItem}>
                <View style={styles.macroBar}>
                  <View
                    style={[
                      styles.macroProgress,
                      styles.macroProgressProtein,
                      { width: progressWidth(totals.protein, macroMax) },
                    ]}
                  />
                </View>
                <Text style={styles.macroValue}>{round1(totals.protein)}<Text style={styles.macroUnit}>g</Text></Text>
                <Text style={[styles.macroLabel, styles.macroLabelProtein]}>蛋白质</Text>
              </View>
              <View style={styles.macroItem}>
                <View style={styles.macroBar}>
                  <View
                    style={[
                      styles.macroProgress,
                      styles.macroProgressCarbs,
                      { width: progressWidth(totals.carbs, macroMax) },
                    ]}
                  />
                </View>
                <Text style={styles.macroValue}>{round1(totals.carbs)}<Text style={styles.macroUnit}>g</Text></Text>
                <Text style={[styles.macroLabel, styles.macroLabelCarbs]}>碳水</Text>
              </View>
              <View style={styles.macroItem}>
                <View style={styles.macroBar}>
                  <View
                    style={[
                      styles.macroProgress,
                      styles.macroProgressFat,
                      { width: progressWidth(totals.fat, macroMax) },
                    ]}
                  />
                </View>
                <Text style={styles.macroValue}>{round1(totals.fat)}<Text style={styles.macroUnit}>g</Text></Text>
                <Text style={[styles.macroLabel, styles.macroLabelFat]}>脂肪</Text>
              </View>
            </View>

            <View style={styles.peoplePanel}>
              <View style={styles.peopleHeader}>
                <Text style={styles.peopleTitle}>按人数分摊</Text>
                <Text style={styles.peopleHint}>同步调整所有食物比例</Text>
              </View>
              <View style={styles.peopleRow}>
                {[1, 2, 3, 4].map((people) => (
                  <Pressable key={people} style={styles.peopleChip} onPress={() => applyPeopleRatio(people)}>
                    <Text style={styles.peopleChipText}>{people}人</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.customPeopleRow}>
                <TextInput
                  value={customPeople}
                  onChangeText={setCustomPeople}
                  keyboardType="number-pad"
                  placeholder="自定义人数"
                  placeholderTextColor={colors.textMuted}
                  style={styles.customPeopleInput}
                />
                <Pressable style={styles.applyPeopleButton} onPress={applyCustomPeopleRatio}>
                  <Text style={styles.applyPeopleText}>应用</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {scoreEnabled && Number.isFinite(finalScore) && (
            <View style={styles.scoreCard}>
              <View style={styles.scoreHeader}>
                <View>
                  <Text style={styles.scoreTitle}>本餐评分</Text>
                  <View style={styles.scoreRow}>
                    <Text style={styles.scoreValue}>{Math.round(finalScore)}</Text>
                    <Text style={styles.scoreUnit}>/ 100</Text>
                  </View>
                </View>
                <View style={[styles.scoreBadge, { backgroundColor: scoreToneColors[scoreToTone(finalScore)].bg }]}>
                  <Text style={[styles.scoreBadgeText, { color: scoreToneColors[scoreToTone(finalScore)].text }]}>
                    {scoreToLabel(finalScore)}
                  </Text>
                </View>
              </View>
              <View style={styles.scoreBreakdown}>
                <ScoreMini label='微量元素' value={micronutrientScore} color='#5dbb8a' />
                <ScoreMini label='宏量平衡' value={macroBalanceScore} color='#5c9ed4' />
                <ScoreMini label='热量适配' value={calorieScore} color='#f0985c' />
              </View>
            </View>
          )}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>食材明细</Text>
            <View style={styles.sectionHeaderActions}>
              <Text style={styles.sectionCount}>{items.length} 项</Text>
              <Pressable accessibilityRole="button" style={styles.addItemButton} onPress={addManualItem}>
                <Text style={styles.addItemButtonText}>+ 新增食物</Text>
              </Pressable>
            </View>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.empty}>当前没有识别到可记录的食物</Text>
            </View>
          ) : null}

          {items.map((item, index) => {
            const weight = editableWeight(item)
            const ratio = clampRatio(item.ratio)
            const nutrients = scaledNutrients(item.baseNutrients, weight, item.baseWeight)
            const actualWeight = weight * ratio / 100
            const itemCalories = numberFrom(nutrients.calories) * ratio / 100
            const showSuggestedRatio = item.suggestedRatioSource === 'ai' && typeof item.suggestedRatio === 'number'
            return (
              <View key={item.clientId} style={styles.ingredientCard}>
                <View style={styles.ingredientMain}>
                  <View style={styles.rowBetween}>
                    <TextInput
                      value={item.name}
                      onChangeText={(name) => updateItem(index, { name })}
                      placeholder="食物名称"
                      placeholderTextColor={colors.textMuted}
                      style={styles.nameInput}
                    />
                    <View style={styles.ingredientHeaderActions}>
                      <Text style={styles.kcal}>{Math.round(itemCalories)} kcal</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`删除${item.name || '食物'}`}
                        hitSlop={8}
                        style={({ pressed }) => [styles.deleteItemButton, pressed && styles.deleteItemButtonPressed]}
                        onPress={() => void removeItem(index)}
                      >
                        <Text style={styles.deleteItemText}>删除</Text>
                      </Pressable>
                    </View>
                  </View>
                  <Text style={styles.subtitle}>
                    估算 {Math.round(weight)}g · 实际摄入 {Math.round(actualWeight)}g
                  </Text>
                </View>

                <View style={styles.ingredientNutritionStrip}>
                  <MiniStat label="热量" value={`${Math.round(itemCalories)}`} unit="kcal" tone="cal" />
                  <MiniStat label="蛋白质" value={round1(numberFrom(nutrients.protein) * ratio / 100)} unit="g" tone="protein" />
                  <MiniStat label="碳水" value={round1(numberFrom(nutrients.carbs) * ratio / 100)} unit="g" tone="carbs" />
                  <MiniStat label="脂肪" value={round1(numberFrom(nutrients.fat) * ratio / 100)} unit="g" tone="fat" />
                  <MiniStat label="摄入" value={`${Math.round(actualWeight)}`} unit="g" tone="weight" />
                </View>

                <View style={styles.ingredientControls}>
                  {isPackagedChoicePending(item) ? (
                    <View style={styles.packagedChoiceCard}>
                      <Text style={styles.packagedChoiceTitle}>请选择包装规格</Text>
                      <Text style={styles.packagedChoiceHint}>图片未读到确定的净含量，选择后才会计入总热量。</Text>
                      {(item.packagedCandidates || []).map((candidate, candidateIndex) => {
                        const candidateName = candidateText(candidate, 'display_name', 'displayName', 'name') || item.name
                        const netLabel = candidateNetContentLabel(candidate) || '净含量未知'
                        const unit = candidateNutritionPer100(candidate)
                        return (
                          <Pressable
                            key={`${candidateText(candidate, 'packaged_food_id', 'id') || candidateIndex}`}
                            accessibilityRole="button"
                            accessibilityLabel={`选择${candidateName}${netLabel}`}
                            style={styles.packagedChoiceOption}
                            onPress={() => void applyPackagedCandidate(index, candidate)}
                          >
                            <View style={styles.packagedChoiceCopy}>
                              <Text style={styles.packagedChoiceName}>{candidateName}</Text>
                              <Text style={styles.packagedChoiceMeta}>{netLabel} · 每100g {Math.round(numberFrom(unit.calories))} kcal</Text>
                            </View>
                            <Text style={styles.packagedChoiceAction}>选择</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : null}
                  {showSuggestedRatio ? (
                    <View style={styles.suggestionBox}>
                      <View style={styles.suggestionTextWrap}>
                        <Text style={styles.suggestionBadge}>AI建议 {item.suggestedRatio}%</Text>
                        {item.suggestedRatioReason ? (
                          <Text style={styles.suggestionReason}>{item.suggestedRatioReason}</Text>
                        ) : null}
                      </View>
                      {item.suggestedRatio !== ratio ? (
                        <Pressable
                          style={styles.suggestionAction}
                          onPress={() => updateItem(index, { ratio: item.suggestedRatio })}
                        >
                          <Text style={styles.suggestionActionText}>应用</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.inputLine}>
                    <Text style={styles.inputLabel}>估算重量</Text>
                    <View style={styles.weightInputWrap}>
                      <TextInput
                        value={item.weightText}
                        onChangeText={(weightText) => updateItem(index, { weightText })}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        style={styles.weightInput}
                      />
                      <Text style={styles.inputUnit}>g</Text>
                    </View>
                  </View>

                  {item.isManual ? (
                    <View style={styles.manualNutritionCard}>
                      <Text style={styles.manualNutritionTitle}>每100g 营养（手动填写）</Text>
                      <View style={styles.manualNutritionGrid}>
                        {([
                          ['calories', '热量', 'kcal'],
                          ['protein', '蛋白质', 'g'],
                          ['carbs', '碳水', 'g'],
                          ['fat', '脂肪', 'g'],
                        ] as const).map(([key, label, unit]) => (
                          <View key={key} style={styles.manualNutritionField}>
                            <Text style={styles.manualNutritionLabel}>{label}</Text>
                            <View style={styles.manualNutritionInputWrap}>
                              <TextInput
                                value={formatEditableNutrient(item.baseNutrients[key])}
                                onChangeText={(value) => updateManualNutrient(index, key, value)}
                                keyboardType="decimal-pad"
                                placeholder="0"
                                placeholderTextColor={colors.textMuted}
                                style={styles.manualNutritionInput}
                              />
                              <Text style={styles.manualNutritionUnit}>{unit}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  <View style={styles.ratioHeader}>
                    <Text style={styles.inputLabel}>食用比例</Text>
                    <Text style={styles.ratioValue}>{ratio}%</Text>
                  </View>
                  <View style={styles.ratioRow}>
                    {ratioOptions.map((option) => (
                      <Pressable
                        key={option}
                        style={[styles.ratioChip, ratio === option && styles.ratioChipActive]}
                        onPress={() => updateItem(index, { ratio: option })}
                      >
                        <Text style={[styles.ratioText, ratio === option && styles.ratioTextActive]}>{option}%</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            )
          })}

          <View style={styles.insightCard}>
            <Text style={styles.sectionTitle}>饮食建议</Text>
            <AdviceLine title="建议" value={task.result?.insight} />
            <AdviceLine title="搭配" value={task.result?.pfc_ratio_comment} />
            <AdviceLine title="吸收" value={task.result?.absorption_notes} />
            <AdviceLine title="上下文" value={task.result?.context_advice} />
          </View>

          {precisionSessionId ? (
            <View style={styles.precisionCard}>
              <Text style={styles.precisionTitle}>继续精准估计</Text>
              <Text style={styles.precisionHint}>
                {referenceObjects.length > 0
                  ? `已保留 ${referenceObjects.length} 个参考物。补充疑问后可继续估计，也可以重拍一张更清晰的照片。`
                  : '补充需要进一步确认的食物或重量，也可以重拍一张带参考物的照片。'}
              </Text>
              <TextInput
                value={precisionContext}
                onChangeText={setPrecisionContext}
                placeholder="例如：右侧是银行卡，重点确认米饭和肉的重量"
                placeholderTextColor={colors.textMuted}
                multiline
                maxLength={300}
                style={styles.followupInput}
              />
              <Text style={styles.referenceSectionTitle}>参考物</Text>
              <View style={styles.referencePresetRow}>
                <Pressable
                  style={styles.referencePresetButton}
                  onPress={() => addPresetReference({
                    reference_type: 'preset',
                    reference_name: '银行卡',
                    dimensions_mm: { length: 85.6, width: 54, height: 0.76 },
                  })}
                >
                  <Text style={styles.referencePresetText}>+ 银行卡</Text>
                </Pressable>
                <Pressable
                  style={styles.referencePresetButton}
                  onPress={() => addPresetReference({
                    reference_type: 'preset',
                    reference_name: '一元硬币',
                    dimensions_mm: { length: 25, width: 25, height: 1.85 },
                  })}
                >
                  <Text style={styles.referencePresetText}>+ 一元硬币</Text>
                </Pressable>
              </View>
              {referenceObjects.length > 0 ? (
                <View style={styles.referenceList}>
                  {referenceObjects.map((reference, referenceIndex) => (
                    <View key={`${reference.reference_name}-${referenceIndex}`} style={styles.referenceChip}>
                      <Text style={styles.referenceChipText}>{reference.reference_name}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`移除参考物${reference.reference_name}`}
                        hitSlop={8}
                        onPress={() => setReferenceObjects((current) => current.filter((_, index) => index !== referenceIndex))}
                      >
                        <Text style={styles.referenceRemoveText}>移除</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.customReferenceCard}>
                <TextInput
                  value={referenceName}
                  onChangeText={setReferenceName}
                  placeholder="自定义参考物名称"
                  placeholderTextColor={colors.textMuted}
                  style={styles.referenceNameInput}
                />
                <View style={styles.referenceDimensionsRow}>
                  {[
                    [referenceLength, setReferenceLength, '长 mm'],
                    [referenceWidth, setReferenceWidth, '宽 mm'],
                    [referenceHeight, setReferenceHeight, '高 mm'],
                  ].map(([value, setter, placeholder]) => (
                    <TextInput
                      key={String(placeholder)}
                      value={value as string}
                      onChangeText={setter as (text: string) => void}
                      keyboardType="decimal-pad"
                      placeholder={placeholder as string}
                      placeholderTextColor={colors.textMuted}
                      style={styles.referenceDimensionInput}
                    />
                  ))}
                </View>
                <TextInput
                  value={referencePlacement}
                  onChangeText={setReferencePlacement}
                  placeholder="摆放说明，例如：放在餐盘右侧并与桌面平行"
                  placeholderTextColor={colors.textMuted}
                  style={styles.referencePlacementInput}
                />
                <Pressable style={styles.addReferenceButton} onPress={() => void addCustomReference()}>
                  <Text style={styles.addReferenceButtonText}>添加自定义参考物</Text>
                </Pressable>
              </View>
              <View style={styles.followupActions}>
                <Pressable style={styles.followupSecondaryButton} onPress={retakePrecision}>
                  <Text style={styles.followupSecondaryText}>重拍并保留会话</Text>
                </Pressable>
                <Pressable
                  style={[styles.followupPrimaryButton, continuingPrecision && styles.primaryBtnDisabled]}
                  disabled={continuingPrecision}
                  onPress={() => void continuePrecision()}
                >
                  {continuingPrecision
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.followupPrimaryText}>继续估计</Text>}
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.correctionCard}>
            <View style={styles.correctionCopy}>
              <Text style={styles.correctionTitle}>结果和实际不一致？</Text>
              <Text style={styles.correctionHint}>当前已修改的名称、重量、比例和删除项都会用于重新分析。</Text>
            </View>
            <Pressable style={styles.correctionOpenButton} onPress={() => setCorrectionVisible(true)}>
              <Text style={styles.correctionOpenText}>反馈 / 纠错</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footerActions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.actionGrid}>
          <Pressable
            style={[styles.secondaryBtn, (savingRecipe || Boolean(savedRecipeId)) && styles.secondaryBtnDisabled]}
            onPress={() => void saveAsRecipe()}
            disabled={savingRecipe}
          >
            {savingRecipe
              ? <ActivityIndicator color={colors.brandDark} />
              : <Text style={styles.secondaryBtnText}>{savedRecipeId ? '已收藏' : '收藏餐食'}</Text>}
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
            onPress={saveRecord}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>保存到当天饮食</Text>}
          </Pressable>
        </View>
      </View>

      <Modal
        visible={correctionVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!correcting && !feedbackSubmitting) setCorrectionVisible(false)
        }}
      >
        <View style={styles.correctionModalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            disabled={correcting || feedbackSubmitting}
            onPress={() => setCorrectionVisible(false)}
          />
          <View style={styles.correctionModalCard}>
            <Text style={styles.correctionModalTitle}>反馈并纠正分析</Text>
            <Text style={styles.correctionModalHint}>说明哪里不准确。重新分析时会同时提交下方当前食物列表。</Text>
            <View style={styles.correctionItemSummary}>
              {items.slice(0, 6).map((item, index) => (
                <Text key={`${item.sourceIndex}-${index}`} style={styles.correctionItemText} numberOfLines={1}>
                  {index + 1}. {item.name.trim() || '未命名食物'} · {Math.round(editableWeight(item))}g · {clampRatio(item.ratio)}%
                </Text>
              ))}
              {items.length > 6 ? <Text style={styles.correctionMoreText}>另有 {items.length - 6} 项</Text> : null}
            </View>
            <TextInput
              value={correctionContext}
              onChangeText={setCorrectionContext}
              placeholder="例如：第二项不是鸡肉，是牛肉；米饭大约只有 120g"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={500}
              autoFocus
              style={styles.correctionInput}
            />
            <Pressable
              disabled={correcting || feedbackSubmitting}
              style={styles.feedbackOnlyButton}
              onPress={() => void submitFeedbackOnly()}
            >
              {feedbackSubmitting
                ? <ActivityIndicator color={colors.brandDark} />
                : <Text style={styles.feedbackOnlyText}>仅提交反馈，不重新分析</Text>}
            </Pressable>
            <View style={styles.correctionModalActions}>
              <Pressable
                disabled={correcting || feedbackSubmitting}
                style={styles.correctionCancelButton}
                onPress={() => setCorrectionVisible(false)}
              >
                <Text style={styles.correctionCancelText}>取消</Text>
              </Pressable>
              <Pressable
                disabled={correcting || feedbackSubmitting}
                style={[styles.correctionSubmitButton, correcting && styles.primaryBtnDisabled]}
                onPress={() => void submitCorrection()}
              >
                {correcting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.correctionSubmitText}>按当前列表重新分析</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function MiniStat({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string
  unit: string
  tone: 'cal' | 'protein' | 'carbs' | 'fat' | 'weight'
}) {
  return (
    <View style={[styles.miniStat, tone === 'cal' && styles.miniStatCal]}>
      <Text style={[styles.miniStatValue, miniStatToneStyle(tone)]}>
        {value}
        <Text style={styles.miniStatUnit}>{unit}</Text>
      </Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  )
}

function ScoreMini({ label, value, color }: { label: string; value: number; color: string }) {
  const score = Number.isFinite(value) ? Math.round(value) : 0
  return (
    <View style={styles.scoreMini}>
      <View style={styles.scoreMiniTop}>
        <Text style={styles.scoreMiniValue}>{score}</Text>
        <View style={[styles.scoreMiniDot, { backgroundColor: color }]} />
      </View>
      <Text style={styles.scoreMiniLabel}>{label}</Text>
      <View style={styles.scoreMiniTrack}>
        <View style={[styles.scoreMiniFill, { width: `${clampScorePercent(score)}%`, backgroundColor: color }]} />
      </View>
    </View>
  )
}

function AdviceLine({ title, value }: { title: string; value: unknown }) {
  const text = stringOrUndefined(value)
  if (!text) return null
  return (
    <View style={styles.adviceLine}>
      <Text style={styles.adviceTitle}>{title}</Text>
      <Text style={styles.adviceText}>{text}</Text>
    </View>
  )
}

function buildEditableItems(foodItems: FoodItem[]): EditableResultItem[] {
  return foodItems.map((item, sourceIndex) => {
    const baseWeight = foodWeight(item)
    return {
      clientId: `source-${sourceIndex}`,
      sourceIndex,
      name: item.name || '未命名食物',
      weightText: formatInputNumber(baseWeight),
      ratio: actualRatioFor(item, baseWeight),
      baseWeight,
      baseNutrients: normalizeNutrients(item.nutrients),
      suggestedRatio: suggestedRatioFor(item),
      suggestedRatioReason: stringOrUndefined(item.suggestedRatioReason ?? item.suggested_ratio_reason),
      suggestedRatioSource: stringOrUndefined(item.suggestedRatioSource ?? item.suggested_ratio_source),
      packagedCandidates: item.packagedCandidates || item.packaged_candidates,
      packagedFoodId: stringOrUndefined(item.packagedFoodId ?? item.packaged_food_id),
      packageMatchStatus: stringOrUndefined(item.packageMatchStatus ?? item.package_match_status),
      packageWeightApplied: item.packageWeightApplied ?? item.package_weight_applied,
      packageWeightSource: stringOrUndefined(item.packageWeightSource ?? item.package_weight_source),
      packageWeightReason: stringOrUndefined(item.packageWeightReason ?? item.package_weight_reason),
    }
  })
}

function buildEditedAnalyzeResult(
  task: ResultRoute['params']['task'],
  items: EditableResultItem[],
  totals: ReturnType<typeof calculateTotals>,
): NonNullable<ResultRoute['params']['task']['result']> {
  const sourceItems = task.result?.items || []
  const editedItems = items.flatMap<FoodItem>((editable) => {
    const source = sourceItems[editable.sourceIndex]
    const weight = editableWeight(editable)
    const ratio = clampRatio(editable.ratio)
    const nutrients = scaledNutrients(editable.baseNutrients, weight, editable.baseWeight)
    if (!source) {
      const manualItem: FoodItem & { ratio: number; intake: number } = {
        name: editable.name.trim(),
        type: 'custom',
        food_type: 'custom',
        category: '用户新增',
        estimatedWeightGrams: weight,
        originalWeightGrams: editable.baseWeight,
        ratio,
        intake: Math.round(weight * ratio / 100),
        nutrients,
        nutrition_source: 'manual_user',
      }
      return [manualItem]
    }
    return [{
      ...source,
      name: editable.name.trim() || source.name,
      estimatedWeightGrams: weight,
      originalWeightGrams: source.originalWeightGrams || editable.baseWeight,
      ratio,
      intake: Math.round(weight * ratio / 100),
      nutrients,
      packaged_food_id: editable.packagedFoodId || source.packaged_food_id,
      package_match_status: editable.packageMatchStatus || source.package_match_status,
      package_weight_applied: editable.packageWeightApplied ?? source.package_weight_applied,
      package_weight_source: editable.packageWeightSource || source.package_weight_source,
      package_weight_reason: editable.packageWeightReason || source.package_weight_reason,
      packaged_candidates: editable.packagedCandidates || source.packaged_candidates,
    }]
  })
  return {
    ...(task.result || {}),
    items: editedItems,
    total_calories: totals.calories,
    total_protein: totals.protein,
    total_carbs: totals.carbs,
    total_fat: totals.fat,
    total_weight_grams: totals.weight,
  }
}

function buildAnalyzeCorrectionItems(
  sourceItems: FoodItem[],
  items: EditableResultItem[],
): AnalyzeCorrectionItem[] {
  return items.map((editable) => {
    const source = sourceItems[editable.sourceIndex]
    const weight = editableWeight(editable)
    const sourceWeight = source ? foodWeight(source) : editable.baseWeight
    const nutrients = scaledNutrients(editable.baseNutrients, weight, editable.baseWeight)
    return {
      name: editable.name.trim(),
      weight,
      originalWeight: source?.originalWeightGrams || editable.baseWeight,
      calorie: numberFrom(nutrients.calories),
      protein: numberFrom(nutrients.protein),
      carbs: numberFrom(nutrients.carbs),
      fat: numberFrom(nutrients.fat),
      waterMl: numberFrom(nutrients.waterMl ?? nutrients.water_ml),
      nutrients,
      sourceName: source?.name,
      sourceItemId: source?.itemId ?? (editable.sourceIndex >= 0 ? editable.sourceIndex + 1 : undefined),
      nameEdited: !source || normalizeFoodName(editable.name) !== normalizeFoodName(source.name),
      weightEdited: !source || Math.abs(weight - sourceWeight) >= 0.01,
      nutritionEdited: Boolean(
        !source
        ||
        editable.packageWeightApplied === true
        && source?.package_weight_applied !== true
        && source?.packageWeightApplied !== true,
      ),
    }
  })
}

function describeCorrectionEdits(sourceItems: FoodItem[], items: EditableResultItem[]): string {
  const descriptions: string[] = []
  items.forEach((editable) => {
    const source = sourceItems[editable.sourceIndex]
    if (!source) {
      descriptions.push(`新增了“${editable.name.trim()}”（${formatInputNumber(editableWeight(editable))}g）`)
      return
    }
    const nameChanged = normalizeFoodName(editable.name) !== normalizeFoodName(source.name)
    const weight = editableWeight(editable)
    const sourceWeight = foodWeight(source)
    const weightChanged = Math.abs(weight - sourceWeight) >= 0.01
    if (nameChanged && weightChanged) {
      descriptions.push(`将“${source.name}”改为“${editable.name.trim()}”，重量改为 ${formatInputNumber(weight)}g`)
    } else if (nameChanged) {
      descriptions.push(`将“${source.name}”改为“${editable.name.trim()}”`)
    } else if (weightChanged) {
      descriptions.push(`将“${source.name}”重量改为 ${formatInputNumber(weight)}g`)
    }
  })
  sourceItems.forEach((source, sourceIndex) => {
    if (!items.some((item) => item.sourceIndex === sourceIndex)) descriptions.push(`删除了“${source.name}”`)
  })
  return descriptions.length > 0 ? `用户在列表中做了以下修改：${descriptions.join('；')}` : ''
}

function normalizeFoodName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]【】,，。./\\\-_:：;；·]/g, '')
}

function taskImageUrls(task: ResultRoute['params']['task']): string[] {
  return [task.image_url, ...(task.image_paths || [])]
    .map((value) => stringOrUndefined(value))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
}

function taskPrecisionSessionId(task: ResultRoute['params']['task']): string {
  return String(task.payload?.precision_session_id || task.result?.precision_session_id || '').trim()
}

function taskCorrectionRootId(task: ResultRoute['params']['task']): string {
  return String(task.payload?.correction_root_task_id || task.id).trim()
}

function taskAnalysisEngine(task: ResultRoute['params']['task']): AnalysisEngine {
  return task.payload?.analysis_engine === 'legacy_direct' ? 'legacy_direct' : 'db_first'
}

function feedbackPayloadSnapshot(
  task: ResultRoute['params']['task'],
  precisionSessionId: string,
  itemCount: number,
): Record<string, unknown> {
  return {
    task_type: task.task_type,
    execution_mode: taskExecutionMode(task),
    analysis_engine: taskAnalysisEngine(task),
    item_count: itemCount,
    has_precision_session: Boolean(precisionSessionId),
  }
}

function taskReferenceObjects(task: ResultRoute['params']['task']): PrecisionReferenceObjectInput[] {
  const raw = task.payload?.reference_objects || task.result?.reference_objects
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const referenceType = item.reference_type === 'custom' ? 'custom' : item.reference_type === 'preset' ? 'preset' : null
    const referenceName = String(item.reference_name || '').trim()
    if (!referenceType || !referenceName) return []
    const dimensions = item.dimensions_mm && typeof item.dimensions_mm === 'object'
      ? item.dimensions_mm as Record<string, unknown>
      : null
    const dimensionValue = (key: string) => {
      const number = Number(dimensions?.[key])
      return Number.isFinite(number) && number > 0 ? number : undefined
    }
    const appliesToItems = Array.isArray(item.applies_to_items)
      ? item.applies_to_items.map((entry) => String(entry || '').trim()).filter(Boolean)
      : undefined
    return [{
      reference_type: referenceType,
      reference_name: referenceName,
      dimensions_mm: dimensions ? {
        length: dimensionValue('length'),
        width: dimensionValue('width'),
        height: dimensionValue('height'),
      } : undefined,
      placement_note: stringOrUndefined(item.placement_note),
      applies_to_items: appliesToItems?.length ? appliesToItems : undefined,
    }]
  })
}

function buildCurrentRecordPayload(
  task: ResultRoute['params']['task'],
  items: EditableResultItem[],
  mealType: ResultRoute['params']['mealType'],
  date: string,
  totals: ReturnType<typeof calculateTotals>,
) {
  const payload = buildSaveFoodRecordRequestFromTask(task, {
    mealType,
    date,
    entryType: 'food_image',
  })
  payload.items = applyEditableItemsToPayload(payload.items, items)
  payload.total_calories = totals.calories
  payload.total_protein = totals.protein
  payload.total_carbs = totals.carbs
  payload.total_fat = totals.fat
  payload.total_weight_grams = totals.weight
  return payload
}

function applyEditableItemsToPayload(
  payloadItems: FoodRecordItemPayload[],
  items: EditableResultItem[],
): FoodRecordItemPayload[] {
  return items.flatMap<FoodRecordItemPayload>((editable) => {
    const payloadItem = payloadItems[editable.sourceIndex]
    const weight = editableWeight(editable)
    const ratio = clampRatio(editable.ratio)
    const nutrients = scaledNutrients(editable.baseNutrients, weight, editable.baseWeight)
    if (!payloadItem) {
      const manualItem: FoodRecordItemPayload = {
        name: editable.name.trim(),
        weight,
        ratio,
        intake: Math.round(weight * ratio / 100),
        nutrients,
        manual_source: 'custom',
        manual_source_title: editable.name.trim(),
        manual_portion_label: `${formatInputNumber(weight)}g`,
      }
      return [manualItem]
    }
    return [{
      ...payloadItem,
      name: editable.name.trim() || payloadItem.name,
      weight,
      ratio,
      intake: Math.round(weight * ratio / 100),
      nutrients,
      packaged_food_id: editable.packagedFoodId || payloadItem.packaged_food_id,
      package_match_status: editable.packageMatchStatus || payloadItem.package_match_status,
      package_weight_applied: editable.packageWeightApplied ?? payloadItem.package_weight_applied,
      package_weight_source: editable.packageWeightSource || payloadItem.package_weight_source,
      package_weight_reason: editable.packageWeightReason || payloadItem.package_weight_reason,
      packaged_candidates: editable.packagedCandidates || payloadItem.packaged_candidates,
    }]
  })
}

function isPackagedChoicePending(item: EditableResultItem): boolean {
  const status = String(item.packageMatchStatus || '').trim().toLowerCase()
  return Boolean(
    item.packagedCandidates?.length
    && item.packageWeightApplied !== true
    && (status === 'packaged_needs_confirmation' || status === 'multiple_candidates'),
  )
}

function candidateText(candidate: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = String(candidate[key] || '').trim()
    if (value && value !== '<nil>') return value
  }
  return ''
}

function candidateNumber(candidate: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(candidate[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

function candidateNetContentLabel(candidate: Record<string, unknown>): string {
  const label = candidateText(candidate, 'net_content_label', 'netContentLabel')
  if (label) return label
  const value = candidateNumber(candidate, 'net_content_value', 'netContentValue', 'net_weight_g', 'netWeightG')
  if (value <= 0) return ''
  return `${formatInputNumber(value)}${candidateText(candidate, 'net_content_unit', 'netContentUnit') || 'g'}`
}

function candidateNutritionPer100(candidate: Record<string, unknown>): Nutrients {
  const nested = candidate.unit_nutrition_per_100g || candidate.unitNutritionPer100g
  const raw = nested && typeof nested === 'object'
    ? nested as Record<string, unknown>
    : candidate
  return normalizeNutrients({
    ...raw,
    calories: candidateNumber(raw, 'calories', 'kcal_per_100g', 'calories_per_100g', 'caloriesPer100g'),
    protein: candidateNumber(raw, 'protein', 'protein_per_100g', 'proteinPer100g'),
    carbs: candidateNumber(raw, 'carbs', 'carbs_per_100g', 'carbsPer100g'),
    fat: candidateNumber(raw, 'fat', 'fat_per_100g', 'fatPer100g'),
    fiber: candidateNumber(raw, 'fiber', 'fiber_per_100g', 'fiberPer100g'),
    sugar: candidateNumber(raw, 'sugar', 'sugar_per_100g', 'sugarPer100g'),
  } as Nutrients)
}

function calculateTotals(items: EditableResultItem[]) {
  return items.reduce(
    (acc, item) => {
      const weight = editableWeight(item)
      const ratio = clampRatio(item.ratio) / 100
      const nutrients = scaledNutrients(item.baseNutrients, weight, item.baseWeight)
      acc.calories += numberFrom(nutrients.calories) * ratio
      acc.protein += numberFrom(nutrients.protein) * ratio
      acc.carbs += numberFrom(nutrients.carbs) * ratio
      acc.fat += numberFrom(nutrients.fat) * ratio
      acc.weight += weight * ratio
      return acc
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, weight: 0 },
  )
}

function scaledNutrients(baseNutrients: Nutrients, weight: number, baseWeight: number): Nutrients {
  const scale = baseWeight > 0 ? weight / baseWeight : 1
  const nutrients: Nutrients = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
  }
  Object.entries(baseNutrients).forEach(([key, value]) => {
    nutrients[key] = round1Number(numberFrom(value) * scale)
  })
  nutrients.calories = round1Number(numberFrom(baseNutrients.calories) * scale)
  nutrients.protein = round1Number(numberFrom(baseNutrients.protein) * scale)
  nutrients.carbs = round1Number(numberFrom(baseNutrients.carbs) * scale)
  nutrients.fat = round1Number(numberFrom(baseNutrients.fat) * scale)
  nutrients.fiber = round1Number(numberFrom(baseNutrients.fiber) * scale)
  nutrients.sugar = round1Number(numberFrom(baseNutrients.sugar) * scale)
  return nutrients
}

function normalizeNutrients(nutrients: FoodItem['nutrients'] | undefined): Nutrients {
  return {
    ...(nutrients || {}),
    calories: numberFrom(nutrients?.calories),
    protein: numberFrom(nutrients?.protein),
    carbs: numberFrom(nutrients?.carbs),
    fat: numberFrom(nutrients?.fat),
    fiber: numberFrom(nutrients?.fiber),
    sugar: numberFrom(nutrients?.sugar),
  }
}

function editableWeight(item: EditableResultItem): number {
  return Math.max(0, numberFromText(item.weightText))
}

function isEditableItemValid(item: EditableResultItem): boolean {
  if (!item.name.trim() || editableWeight(item) <= 0) return false
  if (!item.isManual) return true
  return numberFrom(item.baseNutrients.calories) > 0
}

function positiveNumberOrUndefined(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.').trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function foodWeight(item: FoodItem): number {
  return numberFrom(item.estimatedWeightGrams || item.originalWeightGrams)
}

function suggestedRatioFor(item: FoodItem): number | undefined {
  const ratio = Number(item.suggestedRatio ?? item.suggested_ratio)
  if (!Number.isFinite(ratio)) return undefined
  return clampRatio(ratio)
}

function actualRatioFor(item: FoodItem, weight: number): number {
  const ratio = Number((item as FoodItem & { ratio?: unknown }).ratio)
  if (Number.isFinite(ratio)) return clampRatio(ratio)
  const intake = Number((item as FoodItem & { intake?: unknown }).intake)
  if (Number.isFinite(intake) && weight > 0) return clampRatio(intake / weight * 100)
  return 100
}

function taskExecutionMode(task: ResultRoute['params']['task']): ExecutionMode {
  const candidates = [task.payload?.execution_mode, task.payload?.executionMode, task.result?.execution_mode]
  const value = candidates.find((candidate) => typeof candidate === 'string')
  if (isExecutionMode(value)) return value
  return 'standard'
}

function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === 'string' && [
    'lite',
    'standard',
    'standard_web_search',
    'fast',
    'fast_web_search',
    'standard_packaged_experiment',
    'strict',
    'strict_separate',
    'strict_web_search',
    'experimental',
    'gemini35_flash',
    'gemini35_flash_grouped',
  ].includes(value)
}

function executionModeLabel(mode: ExecutionMode): string {
  if (mode === 'fast' || mode === 'lite') return '快速'
  if (mode === 'fast_web_search') return '快速联网'
  if (mode === 'standard_web_search') return '普通联网'
  if (mode === 'standard_packaged_experiment') return '零食库试验'
  if (mode === 'strict_separate') return '精准分项'
  if (mode === 'strict_web_search') return '精准联网'
  if (mode === 'strict' || mode === 'gemini35_flash' || mode === 'gemini35_flash_grouped') return '精准'
  if (mode === 'experimental') return '试验分析'
  return '普通'
}

function recipeNameFromItems(items: EditableResultItem[], mealLabel: string): string {
  const names = items
    .map((item) => item.name.trim())
    .filter(Boolean)
    .slice(0, 3)
  const name = names.length > 0 ? names.join('、') : `${mealLabel}餐食`
  return name.slice(0, 30)
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(0, Math.min(100, Math.round(value)))
}

function numberFrom(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function numberFromText(value: string): number {
  const n = Number(String(value || '').trim())
  return Number.isFinite(n) ? n : 0
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}

function round1Number(value: number): number {
  return Math.round(value * 10) / 10
}

function formatInputNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (Math.abs(value - Math.round(value)) < 0.05) return String(Math.round(value))
  return round1(value)
}

function formatEditableNutrient(value: unknown): string {
  return formatInputNumber(numberFrom(value))
}

function progressWidth(value: number, max: number): `${number}%` {
  const percentage = max > 0 ? Math.round(value / max * 100) : 0
  return `${Math.max(6, Math.min(100, percentage))}%`
}

function miniStatToneStyle(tone: 'cal' | 'protein' | 'carbs' | 'fat' | 'weight') {
  if (tone === 'protein') return styles.miniStatValueProtein
  if (tone === 'carbs') return styles.miniStatValueCarbs
  if (tone === 'fat') return styles.miniStatValueFat
  if (tone === 'weight') return styles.miniStatValueWeight
  return styles.miniStatValueCal
}

function stringOrUndefined(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function firstImage(images: string[] | null | undefined): string | undefined {
  return Array.isArray(images) ? images.find((image) => Boolean(stringOrUndefined(image))) : undefined
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  hero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    backgroundColor: '#dcfce7',
  },
  heroPlaceholderIcon: {
    width: 78,
    height: 78,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  heroPlaceholderIconText: {
    color: colors.brandDark,
    fontSize: 22,
    fontWeight: '900',
  },
  heroPlaceholderText: {
    marginTop: 12,
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    textAlign: 'center',
  },
  heroShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '58%',
    backgroundColor: 'rgba(15,23,42,0.46)',
  },
  heroCopy: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 0,
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 12,
    fontWeight: '800',
  },
  heroTitle: {
    marginTop: 4,
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
  },
  heroMeta: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '700',
  },
  resultScroll: {
    flex: 1,
    zIndex: 1,
  },
  resultScrollInner: {
    minHeight: '100%',
  },
  contentContainer: {
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 24,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#f8fafc',
  },
  executionModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  executionModeLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  executionModeTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  executionModeText: {
    flex: 1,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  modeHistoryButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#ecfdf5',
  },
  modeHistoryText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  insightCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.9)',
  },
  eyebrow: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 8,
  },
  description: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  nutritionOverviewCard: {
    borderRadius: 18,
    padding: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  nutritionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  caloriesMain: {
    flex: 1,
  },
  caloriesValue: {
    color: '#0f172a',
    fontSize: 42,
    fontWeight: '900',
    lineHeight: 46,
  },
  caloriesUnitRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  caloriesUnit: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
  },
  caloriesLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  totalWeightBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#f1f5f9',
  },
  weightText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  macroItem: {
    flex: 1,
    gap: 7,
  },
  macroBar: {
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
  },
  macroProgress: {
    height: '100%',
    borderRadius: 999,
  },
  macroProgressProtein: {
    backgroundColor: '#3b82f6',
  },
  macroProgressCarbs: {
    backgroundColor: '#eab308',
  },
  macroProgressFat: {
    backgroundColor: '#f97316',
  },
  macroValue: {
    color: '#1e293b',
    fontSize: 18,
    fontWeight: '900',
  },
  macroUnit: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  macroLabel: {
    fontSize: 11,
    fontWeight: '900',
  },
  macroLabelProtein: {
    color: '#3b82f6',
  },
  macroLabelCarbs: {
    color: '#ca8a04',
  },
  macroLabelFat: {
    color: '#f97316',
  },
  peoplePanel: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  peopleHeader: {
    marginBottom: 10,
  },
  peopleTitle: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '900',
  },
  peopleHint: {
    marginTop: 3,
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  peopleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  peopleChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
  },
  peopleChipText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  customPeopleRow: {
    marginTop: 9,
    flexDirection: 'row',
    gap: 9,
  },
  customPeopleInput: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 7,
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: '#fff',
  },
  applyPeopleButton: {
    minWidth: 70,
    minHeight: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  applyPeopleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  scoreCard: {
    borderRadius: 20,
    backgroundColor: '#fff',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  scoreTitle: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  scoreValue: {
    color: '#0f172a',
    fontSize: 48,
    fontWeight: '800',
    lineHeight: 52,
  },
  scoreUnit: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  scoreBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  scoreBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  scoreBreakdown: {
    flexDirection: 'row',
    gap: 12,
  },
  scoreMini: {
    flex: 1,
    gap: 6,
  },
  scoreMiniTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scoreMiniValue: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
  },
  scoreMiniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scoreMiniLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  scoreMiniTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  scoreMiniFill: {
    height: '100%',
    borderRadius: 3,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '900',
  },
  sectionCount: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addItemButton: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
  },
  addItemButtonText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  emptyCard: {
    borderRadius: 16,
    padding: 18,
    backgroundColor: '#fff',
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  ingredientCard: {
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.85)',
  },
  ingredientMain: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226,232,240,0.65)',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  nameInput: {
    flex: 1,
    minHeight: 36,
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    paddingVertical: 4,
  },
  kcal: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
  ingredientHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deleteItemButton: {
    minHeight: 30,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
  },
  deleteItemButtonPressed: {
    opacity: 0.68,
  },
  deleteItemText: {
    color: '#dc2626',
    fontSize: 11,
    fontWeight: '900',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 4,
  },
  ingredientNutritionStrip: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226,232,240,0.65)',
  },
  miniStat: {
    flex: 1,
    minHeight: 62,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    backgroundColor: 'rgba(248,250,252,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.85)',
  },
  miniStatCal: {
    borderColor: 'rgba(249,115,22,0.22)',
  },
  miniStatValue: {
    fontSize: 14,
    fontWeight: '900',
  },
  miniStatValueCal: {
    color: '#0f172a',
  },
  miniStatValueProtein: {
    color: '#3b82f6',
  },
  miniStatValueCarbs: {
    color: '#eab308',
  },
  miniStatValueFat: {
    color: '#f97316',
  },
  miniStatValueWeight: {
    color: '#0ea5a4',
  },
  miniStatUnit: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
  },
  miniStatLabel: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
  },
  ingredientControls: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
  },
  packagedChoiceCard: {
    marginBottom: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 12,
    backgroundColor: '#fff7ed',
  },
  packagedChoiceTitle: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '900',
  },
  packagedChoiceHint: {
    marginTop: 3,
    marginBottom: 8,
    color: '#9a5b2a',
    fontSize: 11,
    lineHeight: 16,
  },
  packagedChoiceOption: {
    minHeight: 48,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
  },
  packagedChoiceCopy: {
    flex: 1,
    minWidth: 0,
  },
  packagedChoiceName: {
    color: '#7c2d12',
    fontSize: 12,
    fontWeight: '900',
  },
  packagedChoiceMeta: {
    marginTop: 2,
    color: '#9a5b2a',
    fontSize: 10,
    lineHeight: 14,
  },
  packagedChoiceAction: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  suggestionBox: {
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionBadge: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  suggestionReason: {
    marginTop: 3,
    color: '#64748b',
    lineHeight: 17,
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionAction: {
    minHeight: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.brand,
  },
  suggestionActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  inputLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  weightInputWrap: {
    width: 116,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  weightInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    paddingVertical: 6,
  },
  inputUnit: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  manualNutritionCard: {
    marginTop: 12,
    padding: 11,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  manualNutritionTitle: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '900',
  },
  manualNutritionGrid: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  manualNutritionField: {
    width: '48%',
  },
  manualNutritionLabel: {
    marginBottom: 4,
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
  },
  manualNutritionInputWrap: {
    minHeight: 38,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  manualNutritionInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  manualNutritionUnit: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
  },
  ratioHeader: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratioValue: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '900',
  },
  ratioRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 9,
  },
  ratioChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  ratioChipActive: {
    backgroundColor: colors.brand,
  },
  ratioText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '900',
  },
  ratioTextActive: {
    color: '#fff',
  },
  adviceLine: {
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  adviceTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 4,
  },
  adviceText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
  precisionCard: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 16,
    backgroundColor: '#ecfdf5',
  },
  precisionTitle: {
    color: '#065f46',
    fontSize: 15,
    fontWeight: '900',
  },
  precisionHint: {
    marginTop: 5,
    color: '#047857',
    fontSize: 12,
    lineHeight: 18,
  },
  followupInput: {
    minHeight: 82,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 12,
    color: colors.text,
    backgroundColor: '#fff',
    fontSize: 13,
    lineHeight: 19,
    textAlignVertical: 'top',
  },
  referenceSectionTitle: {
    marginTop: 13,
    color: '#065f46',
    fontSize: 13,
    fontWeight: '900',
  },
  referencePresetRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  referencePresetButton: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#6ee7b7',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  referencePresetText: {
    color: '#047857',
    fontSize: 11,
    fontWeight: '900',
  },
  referenceList: {
    marginTop: 8,
    gap: 6,
  },
  referenceChip: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#d1fae5',
  },
  referenceChipText: {
    flex: 1,
    color: '#065f46',
    fontSize: 11,
    fontWeight: '800',
  },
  referenceRemoveText: {
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: '900',
  },
  customReferenceCard: {
    marginTop: 9,
    padding: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    backgroundColor: 'rgba(255,255,255,0.72)',
    gap: 8,
  },
  referenceNameInput: {
    minHeight: 38,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 9,
    color: colors.text,
    backgroundColor: '#fff',
    fontSize: 12,
  },
  referenceDimensionsRow: {
    flexDirection: 'row',
    gap: 7,
  },
  referenceDimensionInput: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 9,
    color: colors.text,
    backgroundColor: '#fff',
    fontSize: 11,
  },
  referencePlacementInput: {
    minHeight: 42,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 9,
    color: colors.text,
    backgroundColor: '#fff',
    fontSize: 11,
  },
  addReferenceButton: {
    minHeight: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
  },
  addReferenceButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  followupActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  followupSecondaryButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#6ee7b7',
    borderRadius: 11,
    backgroundColor: '#fff',
  },
  followupSecondaryText: {
    color: '#047857',
    fontSize: 12,
    fontWeight: '900',
  },
  followupPrimaryButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: colors.brand,
  },
  followupPrimaryText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  correctionCard: {
    minHeight: 76,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
  },
  correctionCopy: {
    flex: 1,
  },
  correctionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  correctionHint: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
  },
  correctionOpenButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#fff7ed',
  },
  correctionOpenText: {
    color: '#c2410c',
    fontSize: 12,
    fontWeight: '900',
  },
  correctionModalBackdrop: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.52)',
  },
  correctionModalCard: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#fff',
  },
  correctionModalTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  correctionModalHint: {
    marginTop: 7,
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
  },
  correctionItemSummary: {
    marginTop: 12,
    padding: 10,
    borderRadius: 11,
    backgroundColor: '#f8fafc',
  },
  correctionItemText: {
    color: '#475569',
    fontSize: 11,
    lineHeight: 17,
  },
  correctionMoreText: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 10,
  },
  correctionInput: {
    minHeight: 108,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    color: colors.text,
    backgroundColor: '#fff',
    fontSize: 13,
    lineHeight: 19,
    textAlignVertical: 'top',
  },
  feedbackOnlyButton: {
    minHeight: 40,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackOnlyText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '800',
  },
  correctionModalActions: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 10,
  },
  correctionCancelButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  correctionCancelText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '900',
  },
  correctionSubmitButton: {
    flex: 2,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.brand,
  },
  correctionSubmitText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  footerActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 24,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  secondaryBtnText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryBtnDisabled: {
    opacity: 0.72,
  },
  primaryBtn: {
    flex: 2,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  primaryBtnDisabled: {
    opacity: 0.72,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
})
