import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Apple, BookOpenText, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Coffee, Cookie, Edit3, Minus, MoonStar, Plus, Scale, Soup, Sparkles,
  Sun, Sunrise, Trash2, Upload, X, type LucideIcon,
} from 'lucide-react-native'
import {
  buildSaveFoodRecordRequestFromTask,
  type AnalyzeCorrectionItem,
  type AnalysisEngine,
  type EatingMood,
  type ExecutionMode,
  getMealTypeLabel,
  type FoodItem,
  type FoodRecordItemPayload,
  type MealType,
  type Nutrients,
  type PrecisionReferenceObjectInput,
} from '@food-link/core'
import { apiClient } from '../api'
import { EatingMoodPicker } from '../components/EatingMoodPicker'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
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
  grossWeight?: number
  ediblePortionRatio?: number
  ediblePortionReason?: string
}

type SelectableMealType = Exclude<MealType, 'snack'>
type ResultFoodEditorDraft = {
  itemIndex: number
  name: string
  weight: string
  calories: string
  protein: string
  carbs: string
  fat: string
  waterMl: string
}

type ResultPalette = {
  page: string
  card: string
  cardSoft: string
  cardElevated: string
  input: string
  border: string
  text: string
  textSecondary: string
  textMuted: string
  brand: string
  brandStrong: string
  brandSoft: string
  brandBorder: string
  hero: string
  heroPattern: string
  heroOverlay: string
  blue: string
  blueSoft: string
  orange: string
  orangeSoft: string
  purple: string
  purpleSoft: string
  red: string
  redSoft: string
  warning: string
  warningSoft: string
  track: string
  scrim: string
  white: string
  shadow: string
}

function createResultPalette(isDark: boolean): ResultPalette {
  return isDark
    ? {
        page: '#0b0f0e', card: '#151b19', cardSoft: '#202927', cardElevated: '#1a221f', input: '#1c2421',
        border: 'rgba(255,255,255,0.12)', text: '#f3f7f5', textSecondary: '#a9b7b1', textMuted: '#7f918a',
        brand: '#7dd3b0', brandStrong: '#49b98e', brandSoft: '#18332a', brandBorder: 'rgba(125,211,176,0.32)',
        hero: '#101816', heroPattern: '#294239', heroOverlay: 'rgba(11,15,14,0.64)',
        blue: '#79b7ef', blueSoft: '#1f2c38', orange: '#f2ae6f', orangeSoft: '#33261d',
        purple: '#c49ae9', purpleSoft: '#2a2235', red: '#ff938f', redSoft: '#351f1e',
        warning: '#f8bf61', warningSoft: '#332a19', track: 'rgba(0,0,0,0.28)',
        scrim: 'rgba(0,0,0,0.76)', white: '#ffffff', shadow: '#000000',
      }
    : {
        page: '#f8fafc', card: '#ffffff', cardSoft: '#f1f5f9', cardElevated: '#ffffff', input: '#ffffff',
        border: '#e2e8f0', text: '#0f172a', textSecondary: '#475569', textMuted: '#64748b',
        brand: '#00bc7d', brandStrong: '#059669', brandSoft: '#ecfdf5', brandBorder: 'rgba(0,188,125,0.28)',
        hero: '#dbe4ee', heroPattern: '#cbd5e1', heroOverlay: 'rgba(15,23,42,0.34)',
        blue: '#3b82f6', blueSoft: '#eff6ff', orange: '#f97316', orangeSoft: '#fff7ed',
        purple: '#a855f7', purpleSoft: '#faf5ff', red: '#dc2626', redSoft: '#fef2f2',
        warning: '#d97706', warningSoft: '#fffbeb', track: '#e2e8f0',
        scrim: 'rgba(15,23,42,0.62)', white: '#ffffff', shadow: '#0f172a',
      }
}

type ResultStyles = ReturnType<typeof createResultStyles>

const mealOptions: Array<{ value: SelectableMealType; label: string; Icon: LucideIcon }> = [
  { value: 'breakfast', label: '早餐', Icon: Sunrise },
  { value: 'morning_snack', label: '早加餐', Icon: Apple },
  { value: 'lunch', label: '午餐', Icon: Sun },
  { value: 'afternoon_snack', label: '午加餐', Icon: Cookie },
  { value: 'dinner', label: '晚餐', Icon: Soup },
  { value: 'evening_snack', label: '晚加餐', Icon: MoonStar },
]

const NUTRIENT_DETAIL_META = [
  ['fiber', '膳食纤维', 'g'], ['sugar', '糖', 'g'], ['saturatedFat', '饱和脂肪', 'g'],
  ['cholesterolMg', '胆固醇', 'mg'], ['sodiumMg', '钠', 'mg'], ['potassiumMg', '钾', 'mg'],
  ['calciumMg', '钙', 'mg'], ['ironMg', '铁', 'mg'], ['magnesiumMg', '镁', 'mg'], ['zincMg', '锌', 'mg'],
  ['vitaminARaeMcg', '维生素A', 'mcg'], ['vitaminCMg', '维生素C', 'mg'], ['vitaminDMcg', '维生素D', 'mcg'],
  ['vitaminEMg', '维生素E', 'mg'], ['vitaminKMcg', '维生素K', 'mcg'], ['thiaminMg', '维生素B1', 'mg'],
  ['riboflavinMg', '维生素B2', 'mg'], ['niacinMg', '烟酸', 'mg'], ['vitaminB6Mg', '维生素B6', 'mg'],
  ['folateMcg', '叶酸', 'mcg'], ['vitaminB12Mcg', '维生素B12', 'mcg'],
] as const
const HEALTH_PROFILE_PROMPT_SHOWN_KEY = 'food_link_mobile_analysis_health_profile_prompt_shown'


export function ResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<ResultRoute>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const { isDark } = useColorScheme()
  const palette = useMemo(() => createResultPalette(isDark), [isDark])
  const styles = useMemo(() => createResultStyles(palette), [palette])
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
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>(() => normalizeSelectableMealType(mealType))
  const [insightCollapsed, setInsightCollapsed] = useState(false)
  const [foodEditor, setFoodEditor] = useState<ResultFoodEditorDraft | null>(null)
  const [foodEditorError, setFoodEditorError] = useState('')
  const [expandedNutritionDetailIds, setExpandedNutritionDetailIds] = useState<Record<string, boolean>>({})
  const [quickRatioVisible, setQuickRatioVisible] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [previewImageIndex, setPreviewImageIndex] = useState<number | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)
  const ratioWidthsRef = useRef<Record<string, number>>({})
  const heroGestureStartXRef = useRef(0)
  const heroGestureMovedRef = useRef(false)
  const recipeSaveInFlightRef = useRef(false)
  const correctionInFlightRef = useRef(false)
  const feedbackInFlightRef = useRef(false)

  useEffect(() => {
    setItems(buildEditableItems(foodItems))
    setEatingMood(null)
    setSavedRecipeId(null)
    setReferenceObjects(taskReferenceObjects(task))
    setInsightCollapsed(false)
    setFoodEditor(null)
    setExpandedNutritionDetailIds({})
    setCurrentImageIndex(0)
    setPreviewImageIndex(null)
  }, [task.id, foodItems.length])

useEffect(() => {
    setSelectedMealType(normalizeSelectableMealType(mealType))
  }, [mealType])

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      active = false
      subscription.remove()
    }
  }, [])

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
  const imageSources = useMemo(() => uniqueImageSources([imageUri, stringOrUndefined(task.image_url), ...(task.image_paths || [])]), [imageUri, task.image_url, task.image_paths])
  const imageSource = imageSources[0]
  const mealLabel = getMealTypeLabel(selectedMealType)
  const heroHeight = imageSource ? 292 : 246
  const macroMax = Math.max(totals.protein, totals.carbs, totals.fat, 1)
  const resultDescription = String(task.result?.description || '食物分析已完成')
  const executionMode = taskExecutionMode(task)
  const analysisEngine = taskAnalysisEngine(task)
  const precisionSessionId = taskPrecisionSessionId(task)


  const saveRecord = async (confirmedMealType: SelectableMealType) => {
    if (items.length === 0) {
      void dialog.alert('无法保存', '当前识别结果没有可保存的食物明细', 'warning')
      return
    }
    if (items.some(isPackagedChoicePending)) {
      void dialog.alert('请先确认包装规格', '选择正确的包装规格后，才能计算总量并保存记录。', 'warning')
      return
    }

    const invalidItem = items.find((item) => !isEditableItemValid(item))
    if (invalidItem) {
      void dialog.alert('无法保存', '请确认每项食物都有名称、重量；手动新增项还需要填写每100g热量。', 'warning')
      return
    }

    setSaving(true)
    try {
      const payload = buildCurrentRecordPayload(task, items, confirmedMealType, date, totals)
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
    if (items.some(isPackagedChoicePending)) {
      await dialog.alert('请先确认包装规格', '选择正确的包装规格后，才能计算总量并收藏餐食。', 'warning')
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
    setFoodEditor({ itemIndex: items.length, name: '', weight: '100', calories: '0', protein: '0', carbs: '0', fat: '0', waterMl: '0' })
    setFoodEditorError('')
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
    setQuickRatioVisible(false)
  }

  const openMealSelector = () => {
    if (saving || items.length === 0) return
    if (items.some(isPackagedChoicePending)) {
      void dialog.alert('请先确认包装规格', '还有包装食品规格待选择，确认后才能记录。', 'warning')
      return
    }
    setSelectedMealType(normalizeSelectableMealType(mealType))
    setShowMealSelector(true)
  }

  const confirmMealTypeAndSave = () => {
    setShowMealSelector(false)
    void saveRecord(selectedMealType)
  }

  const adjustWeight = (index: number, delta: number) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index
      ? { ...item, weightText: formatInputNumber(Math.max(1, editableWeight(item) + delta)) }
      : item))
  }

  const updateRatio = (index: number, nextRatio: number) => {
    updateItem(index, { ratio: clampRatio(Math.round(nextRatio / 5) * 5) })
  }

  const updateRatioFromPress = (index: number, itemKey: string, event: GestureResponderEvent) => {
    const width = ratioWidthsRef.current[itemKey] || 0
    if (width <= 20) return
    updateRatio(index, (event.nativeEvent.locationX - 10) / (width - 20) * 100)
  }

  const openFoodEditor = (itemIndex: number) => {
    const item = items[itemIndex]
    if (!item) return
    const weight = editableWeight(item)
    const nutrients = scaledNutrients(item.baseNutrients, weight, item.baseWeight)
    setFoodEditor({
      itemIndex,
      name: item.name,
      weight: formatInputNumber(weight),
      calories: formatInputNumberAllowZero(numberFrom(nutrients.calories)),
      protein: formatInputNumberAllowZero(numberFrom(nutrients.protein)),
      carbs: formatInputNumberAllowZero(numberFrom(nutrients.carbs)),
      fat: formatInputNumberAllowZero(numberFrom(nutrients.fat)),
      waterMl: formatInputNumberAllowZero(numberFrom(nutrients.waterMl ?? nutrients.water_ml)),
    })
    setFoodEditorError('')
  }

  const closeFoodEditor = () => {
    setFoodEditor(null)
    setFoodEditorError('')
  }

  const updateFoodEditorField = (field: keyof Omit<ResultFoodEditorDraft, 'itemIndex'>, value: string) => {
    setFoodEditor((current) => {
      if (!current) return current
      const nextValue = field === 'name' ? value : sanitizeNumberText(value)
      const next = { ...current, [field]: nextValue }
      if (field === 'protein' || field === 'carbs' || field === 'fat') {
        const protein = Number(next.protein)
        const carbs = Number(next.carbs)
        const fat = Number(next.fat)
        if ([protein, carbs, fat].every((number) => Number.isFinite(number) && number >= 0)) {
          next.calories = formatInputNumberAllowZero(protein * 4 + carbs * 4 + fat * 9)
        }
      }
      return next
    })
    if (foodEditorError) setFoodEditorError('')
  }

  const saveFoodEditor = () => {
    if (!foodEditor) return
    const name = foodEditor.name.trim()
    const weight = Number(foodEditor.weight)
    const protein = Number(foodEditor.protein)
    const carbs = Number(foodEditor.carbs)
    const fat = Number(foodEditor.fat)
    const waterMl = Number(foodEditor.waterMl || 0)
    const parsedCalories = Number(foodEditor.calories)
    if (!name) {
      setFoodEditorError('食物名称不能为空')
      return
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      setFoodEditorError('估算重量必须大于 0')
      return
    }
    if ([protein, carbs, fat, waterMl].some((value) => !Number.isFinite(value) || value < 0)) {
      setFoodEditorError('营养数值不能小于 0')
      return
    }
    const calories = Number.isFinite(parsedCalories) && parsedCalories >= 0
      ? parsedCalories
      : protein * 4 + carbs * 4 + fat * 9
    const isNewItem = !items[foodEditor.itemIndex]
    if (isNewItem && calories <= 0) {
      setFoodEditorError('新增食物的整份热量必须大于 0')
      return
    }
    setItems((current) => {
      const nutrients = normalizeNutrients({
        calories: round1Number(calories),
        protein: round1Number(protein),
        carbs: round1Number(carbs),
        fat: round1Number(fat),
        fiber: 0,
        sugar: 0,
        waterMl: round1Number(Math.min(waterMl, weight)),
        water_ml: round1Number(Math.min(waterMl, weight)),
      })
      if (!current[foodEditor.itemIndex]) {
        return [...current, {
          clientId: `manual-${Date.now()}-${foodEditor.itemIndex}`,
          sourceIndex: -1,
          isManual: true,
          name,
          weightText: formatInputNumber(weight),
          ratio: 100,
          baseWeight: weight,
          baseNutrients: nutrients,
        }]
      }
      return current.map((item, itemIndex) => itemIndex === foodEditor.itemIndex
        ? {
          ...item,
          name,
          weightText: formatInputNumber(weight),
          baseWeight: weight,
          baseNutrients: { ...item.baseNutrients, ...nutrients },
        }
        : item)
    })
    closeFoodEditor()
    AccessibilityInfo.announceForAccessibility('食物信息已更新')
  }

  const toggleNutritionDetails = (itemKey: string) => {
    setExpandedNutritionDetailIds((current) => ({ ...current, [itemKey]: !current[itemKey] }))
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

  const hasInsights = Boolean(
    resultDescription
    || stringOrUndefined(task.result?.insight)
    || stringOrUndefined(task.result?.pfc_ratio_comment)
    || stringOrUndefined(task.result?.absorption_notes)
    || stringOrUndefined(task.result?.context_advice),
  )
  const pendingPackagedChoiceCount = items.filter(isPackagedChoicePending).length

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.resultScroll}
        contentContainerStyle={[styles.resultScrollInner, { paddingBottom: 246 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { height: heroHeight + insets.top }]}>
          {imageSources.length > 0 ? (
            <Pressable
              style={[styles.heroImagePage, { height: heroHeight + insets.top }]}
              onTouchStart={(event) => {
                heroGestureStartXRef.current = event.nativeEvent.pageX
                heroGestureMovedRef.current = false
              }}
              onTouchMove={(event) => {
                if (Math.abs(event.nativeEvent.pageX - heroGestureStartXRef.current) > 12) heroGestureMovedRef.current = true
              }}
              onTouchEnd={(event) => {
                const deltaX = event.nativeEvent.pageX - heroGestureStartXRef.current
                if (imageSources.length > 1 && Math.abs(deltaX) >= 50) {
                  setCurrentImageIndex((current) => deltaX < 0
                    ? Math.min(imageSources.length - 1, current + 1)
                    : Math.max(0, current - 1))
                }
              }}
              onTouchCancel={() => { heroGestureMovedRef.current = false }}
              onPress={() => {
                if (!heroGestureMovedRef.current) setPreviewImageIndex(currentImageIndex)
                heroGestureMovedRef.current = false
              }}
              accessibilityRole="imagebutton"
              accessibilityLabel={`分析原图 ${currentImageIndex + 1}，共 ${imageSources.length} 张`}
              accessibilityHint={imageSources.length > 1 ? '双击全屏查看，左右滑动切换图片' : '双击全屏查看'}
              accessibilityActions={imageSources.length > 1 ? [{ name: 'increment', label: '下一张' }, { name: 'decrement', label: '上一张' }] : undefined}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'increment') setCurrentImageIndex((current) => Math.min(imageSources.length - 1, current + 1))
                if (event.nativeEvent.actionName === 'decrement') setCurrentImageIndex((current) => Math.max(0, current - 1))
              }}
            >
              <Image source={{ uri: imageSources[currentImageIndex] }} style={styles.heroImage} resizeMode="cover" />
            </Pressable>
          ) : (
            <View style={[styles.heroPlaceholder, { paddingTop: insets.top }]}>
              <View style={styles.heroPlaceholderIcon}><BookOpenText size={30} color={palette.brand} /></View>
              <Text style={styles.heroPlaceholderText}>未提供实物照片</Text>
            </View>
          )}
          <View style={styles.heroShade} pointerEvents="none" />
          {imageSources.length > 1 ? (
            <View style={[styles.imageCounter, { top: insets.top + 14 }]} pointerEvents="none">
              <Text style={styles.imageCounterText}>{currentImageIndex + 1}/{imageSources.length}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.contentContainer}>
          <View style={styles.executionModeRow}>
            <View style={styles.executionModeLeft}>
              <View style={styles.modeTag}><Text style={styles.modeTagText}>{executionModeLabel(executionMode)}</Text></View>
              <View style={styles.engineTag}><Text style={styles.engineTagText}>{analysisEngineLabel(analysisEngine)}</Text></View>
              <Pressable
                style={({ pressed }) => [styles.modeLink, pressed && styles.pressed]}
                onPress={() => navigation.navigate('HealthProfileView')}
                accessibilityRole="button"
                accessibilityLabel="设置默认识别模式"
              >
                <Text style={styles.modeLinkText}>设为默认</Text>
              </Pressable>
            </View>
            {imageSources.length > 0 ? (
              <Pressable
                style={({ pressed }) => [styles.uploadEntry, pressed && styles.pressed]}
                onPress={() => navigation.navigate('FoodContribution', { focus: 'public' })}
                accessibilityRole="button"
                accessibilityLabel="上传公共食物库"
              >
                <Upload size={16} color={palette.brandStrong} />
                <Text style={styles.uploadEntryText}>上传公共库</Text>
                <ChevronRight size={16} color={palette.textMuted} />
              </Pressable>
            ) : null}
          </View>

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
                <Scale size={17} color={palette.brandStrong} />
                <Text style={styles.weightText}>约 {Math.round(totals.weight)}g</Text>
              </View>
            </View>
            <View style={styles.macroGrid}>
              {([
                ['protein', '蛋白质', totals.protein, styles.macroProgressProtein, styles.macroLabelProtein],
                ['carbs', '碳水', totals.carbs, styles.macroProgressCarbs, styles.macroLabelCarbs],
                ['fat', '脂肪', totals.fat, styles.macroProgressFat, styles.macroLabelFat],
              ] as const).map(([key, label, value, fillStyle, labelStyle]) => (
                <View key={key} style={styles.macroItem}>
                  <View style={styles.macroBar}><View style={[styles.macroProgress, fillStyle, { width: progressWidth(value, macroMax) }]} /></View>
                  <Text style={styles.macroValue}>{round1(value)}<Text style={styles.macroUnit}>g</Text></Text>
                  <Text style={[styles.macroLabel, labelStyle]}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          {pendingPackagedChoiceCount > 0 ? (
            <View style={styles.pendingBanner} accessible accessibilityRole="alert">
              <Text style={styles.pendingBannerText}>{pendingPackagedChoiceCount} 个包装食品规格待确认，暂未计入总热量</Text>
            </View>
          ) : null}

          {hasInsights ? (
            <View style={styles.insightCard}>
              <Pressable
                style={({ pressed }) => [styles.cardHeaderToggle, pressed && styles.cardHeaderPressed]}
                onPress={() => {
                  const next = !insightCollapsed
                  setInsightCollapsed(next)
                  AccessibilityInfo.announceForAccessibility(next ? 'AI 饮食分析已收起' : 'AI 饮食分析已展开')
                }}
                accessibilityRole="button"
                accessibilityLabel="AI 饮食分析"
                accessibilityHint={insightCollapsed ? '双击展开分析详情' : '双击收起分析详情'}
                accessibilityState={{ expanded: !insightCollapsed }}
              >
                <View style={styles.cardHeaderTitleRow}>
                  <Sparkles size={19} color={palette.brand} strokeWidth={2.2} />
                  <Text style={styles.cardTitle}>AI 饮食分析</Text>
                </View>
                <View style={styles.insightToggle}>
                  <Text style={styles.insightToggleText}>{insightCollapsed ? '展开' : '收起'}</Text>
                  {insightCollapsed ? <ChevronDown size={18} color={palette.textSecondary} /> : <ChevronUp size={18} color={palette.textSecondary} />}
                </View>
              </Pressable>
              {!insightCollapsed ? (
                <View style={styles.insightItems}>
                  <ResultInsightItem styles={styles} palette={palette} Icon={BookOpenText} value={resultDescription} />
                  <ResultInsightItem styles={styles} palette={palette} Icon={Check} label="饮食比例建议" value={task.result?.insight} tone="highlight" />
                  <ResultInsightItem styles={styles} palette={palette} Icon={Sparkles} label="营养比例" value={task.result?.pfc_ratio_comment} tone="ratio" />
                  <ResultInsightItem styles={styles} palette={palette} Icon={Coffee} label="吸收与利用" value={task.result?.absorption_notes} tone="absorption" />
                  <ResultInsightItem styles={styles} palette={palette} Icon={Sunrise} label="情境建议" value={task.result?.context_advice} />
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.sectionHeader}>
            <View>
              <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>食物明细</Text><Text style={styles.sectionCount}>({items.length}种)</Text></View>
              <Text style={styles.sectionHint}>每种食物可单独调整实际摄入比例</Text>
            </View>
            <Pressable style={({ pressed }) => [styles.quickRatioButton, pressed && styles.pressed]} onPress={() => setQuickRatioVisible(true)} accessibilityRole="button" accessibilityLabel="快捷设置多人分摊比例"><Text style={styles.quickRatioButtonText}>快捷比例</Text></Pressable>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}><BookOpenText size={24} color={palette.textMuted} /></View>
              <Text style={styles.emptyTitle}>没有识别到食物</Text>
              <Text style={styles.emptyDescription}>可以在纠错入口补充食物，或返回重新拍摄更清晰的照片。</Text>
            </View>
          ) : null}
          {items.map((item, index) => {
            const weight = editableWeight(item)
            const ratio = clampRatio(item.ratio)
            const nutrients = scaledNutrients(item.baseNutrients, weight, item.baseWeight)
            const per100 = scaledNutrients(item.baseNutrients, 100, item.baseWeight)
            const actualWeight = weight * ratio / 100
            const itemCalories = numberFrom(nutrients.calories) * ratio / 100
            const detailsExpanded = Boolean(expandedNutritionDetailIds[item.clientId])
            const detailRows = NUTRIENT_DETAIL_META.map(([key, label, unit]) => ({ key, label, unit, value: numberFrom(nutrients[key]) * ratio / 100 }))
            const showSuggestedRatio = item.suggestedRatioSource === 'ai' && typeof item.suggestedRatio === 'number'
            const ediblePortionHint = getEdiblePortionHint(item)
            return (
              <View key={item.clientId} style={styles.ingredientCard}>
                <View style={styles.ingredientHeader}>
                  <Pressable
                    style={({ pressed }) => [styles.ingredientNameButton, pressed && styles.cardHeaderPressed]}
                    onPress={() => openFoodEditor(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`编辑${item.name || '未命名食物'}`}
                    accessibilityHint="双击修改名称、重量和营养"
                  >
                    <Text style={styles.ingredientName} numberOfLines={2}>{item.name || '未命名食物'}</Text>
                    <View style={styles.editAffordance}><Edit3 size={15} color={palette.brandStrong} /><Text style={styles.editAffordanceText}>编辑</Text></View>
                  </Pressable>
                  <Pressable style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]} onPress={() => void removeItem(index)} accessibilityRole="button" accessibilityLabel={`删除${item.name || '食物'}`}><Trash2 size={18} color={palette.red} /></Pressable>
                </View>
                <Text style={styles.ingredientBasis}>当前整份营养（约 {Math.round(weight)}g）</Text>
                <Text style={styles.ingredientPer100}>每100g参考：{Math.round(numberFrom(per100.calories))} kcal · 蛋白 {round1(numberFrom(per100.protein))}g · 碳水 {round1(numberFrom(per100.carbs))}g · 脂肪 {round1(numberFrom(per100.fat))}g</Text>
                {ediblePortionHint ? <View style={styles.ediblePortionHint}><Text style={styles.ediblePortionHintText}>{ediblePortionHint}</Text></View> : null}

                {isPackagedChoicePending(item) ? (
                  <View style={styles.packagedChoiceCard}>
                    <Text style={styles.packagedChoiceTitle}>请选择包装规格</Text>
                    <Text style={styles.packagedChoiceHint}>图片未读到确定净含量，确认后才计入总热量。</Text>
                    {(item.packagedCandidates || []).slice(0, 4).map((candidate, candidateIndex) => {
                      const candidateName = candidateText(candidate, 'display_name', 'displayName', 'name') || `规格 ${candidateIndex + 1}`
                      const netLabel = candidateNetContentLabel(candidate) || '规格待确认'
                      const unit = candidateNutritionPer100(candidate)
                      return (
                        <Pressable key={`${item.clientId}-candidate-${candidateIndex}`} style={({ pressed }) => [styles.packagedChoiceOption, pressed && styles.cardHeaderPressed]} onPress={() => void applyPackagedCandidate(index, candidate)} accessibilityRole="button" accessibilityLabel={`选择${candidateName}${netLabel}`}>
                          <View style={styles.packagedChoiceCopy}><Text style={styles.packagedChoiceName}>{candidateName}</Text><Text style={styles.packagedChoiceMeta}>{netLabel} · 每100g {Math.round(numberFrom(unit.calories))} kcal</Text></View>
                          <Text style={styles.packagedChoiceAction}>选择</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                ) : null}

                <View style={styles.nutritionStrip}>
                  {([
                    ['热量', Math.round(itemCalories), 'kcal', styles.nutritionCal],
                    ['蛋白质', round1(numberFrom(nutrients.protein) * ratio / 100), 'g', styles.nutritionProtein],
                    ['碳水', round1(numberFrom(nutrients.carbs) * ratio / 100), 'g', styles.nutritionCarbs],
                    ['脂肪', round1(numberFrom(nutrients.fat) * ratio / 100), 'g', styles.nutritionFat],
                  ] as const).map(([label, value, unit, tone]) => (
                    <View key={label} style={[styles.nutritionCell, tone]}><Text style={styles.nutritionCellLabel}>{label}</Text><Text style={styles.nutritionCellValue}>{value}<Text style={styles.nutritionCellUnit}>{unit}</Text></Text></View>
                  ))}
                </View>

                <Pressable style={({ pressed }) => [styles.nutritionDetailsToggle, pressed && styles.cardHeaderPressed]} onPress={() => toggleNutritionDetails(item.clientId)} accessibilityRole="button" accessibilityLabel={detailsExpanded ? `收起${item.name}更多营养` : `展开${item.name}更多营养`} accessibilityState={{ expanded: detailsExpanded }}>
                  <Text style={styles.nutritionDetailsToggleText}>{detailsExpanded ? '收起更多营养' : '展开更多营养'}</Text>
                  {detailsExpanded ? <ChevronUp size={18} color={palette.textSecondary} /> : <ChevronDown size={18} color={palette.textSecondary} />}
                </Pressable>
                {detailsExpanded ? (
                  <View style={styles.nutritionDetailGrid}>{detailRows.map((row) => (
                    <View key={row.key} style={styles.nutritionDetailCell}><Text style={styles.nutritionDetailLabel}>{row.label}</Text><Text style={styles.nutritionDetailValue}>{formatNutrientDetailValue(row.value)}<Text style={styles.nutritionDetailUnit}> {row.unit}</Text></Text></View>
                  ))}</View>
                ) : null}

                <View style={styles.ingredientControls}>
                  <View style={styles.weightControlRow}>
                    <Text style={styles.controlLabel}>估算重量</Text>
                    <View style={styles.weightAdjuster}>
                      <Pressable style={({ pressed }) => [styles.adjustButton, weight <= 1 && styles.adjustButtonDisabled, pressed && weight > 1 && styles.adjustButtonPressed]} onPress={() => adjustWeight(index, -10)} disabled={weight <= 1} accessibilityRole="button" accessibilityLabel={`减少${item.name}重量10克`} accessibilityState={{ disabled: weight <= 1 }}><Minus size={18} color={weight <= 1 ? palette.textMuted : palette.textSecondary} /></Pressable>
                      <View style={styles.weightDisplayWrap} accessible accessibilityLabel={`估算重量${round1(weight)}克`}><Text style={styles.weightDisplay}>{round1(weight)}</Text><Text style={styles.weightDisplayUnit}>g</Text></View>
                      <Pressable style={({ pressed }) => [styles.adjustButton, pressed && styles.adjustButtonPressed]} onPress={() => adjustWeight(index, 10)} accessibilityRole="button" accessibilityLabel={`增加${item.name}重量10克`}><Plus size={18} color={palette.brandStrong} /></Pressable>
                    </View>
                  </View>

                  <View style={styles.ratioHeader}><View><Text style={styles.controlLabel}>实际摄入</Text><Text style={styles.controlSubLabel}>约 {Math.round(actualWeight)}g</Text></View><Text style={styles.ratioValue}>{ratio}%</Text></View>
                  <Pressable
                    style={styles.ratioAdjustable}
                    onLayout={(event) => { ratioWidthsRef.current[item.clientId] = event.nativeEvent.layout.width }}
                    onPress={(event) => updateRatioFromPress(index, item.clientId, event)}
                    accessibilityRole="adjustable"
                    accessibilityLabel={`${item.name}实际摄入比例`}
                    accessibilityValue={{ min: 0, max: 100, now: ratio, text: `${ratio}%` }}
                    accessibilityActions={[{ name: 'increment', label: '增加5%' }, { name: 'decrement', label: '减少5%' }]}
                    onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'increment') updateRatio(index, ratio + 5); if (event.nativeEvent.actionName === 'decrement') updateRatio(index, ratio - 5) }}
                  >
                    <View style={styles.ratioRail} pointerEvents="none"><View style={[styles.ratioFill, { width: `${ratio}%` as any }]} /><View style={[styles.ratioKnob, { left: `${ratio}%` as any }]} /></View>
                  </Pressable>
                  {showSuggestedRatio ? (
                    <Pressable style={({ pressed }) => [styles.suggestionRow, pressed && styles.cardHeaderPressed]} onPress={() => updateRatio(index, item.suggestedRatio || ratio)} accessibilityRole="button" accessibilityLabel={`应用AI建议比例${item.suggestedRatio}%`}>
                      <View style={styles.suggestionCopy}><Text style={styles.suggestionTitle}>AI识别比例 {item.suggestedRatio}%</Text>{item.suggestedRatioReason ? <Text style={styles.suggestionReason}>{item.suggestedRatioReason}</Text> : null}</View><Text style={styles.suggestionAction}>一键应用</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )
          })}
          {precisionSessionId ? (
            <View style={styles.precisionCard}>
              <View style={styles.precisionTitleRow}><Scale size={19} color={palette.warning} /><Text style={styles.precisionTitle}>继续精准估计</Text></View>
              <Text style={styles.precisionHint}>{referenceObjects.length > 0 ? `已保留 ${referenceObjects.length} 个参考物，可继续补充疑问或重拍。` : '补充需要进一步确认的食物或重量，也可以重拍带参考物的照片。'}</Text>
              <Text style={styles.fieldLabel}>补充说明</Text>
              <TextInput value={precisionContext} onChangeText={setPrecisionContext} placeholder="例如：右侧是银行卡，重点确认米饭和肉的重量" placeholderTextColor={palette.textMuted} multiline maxLength={300} style={styles.multilineInput} accessibilityLabel="精准估计补充说明" />
              <Text style={styles.fieldLabel}>参考物</Text>
              <View style={styles.referencePresetRow}>
                <Pressable style={({ pressed }) => [styles.referencePresetButton, pressed && styles.pressed]} onPress={() => addPresetReference({ reference_type: 'preset', reference_name: '银行卡', dimensions_mm: { length: 85.6, width: 54, height: 0.76 } })}><Text style={styles.referencePresetText}>银行卡</Text></Pressable>
                <Pressable style={({ pressed }) => [styles.referencePresetButton, pressed && styles.pressed]} onPress={() => addPresetReference({ reference_type: 'preset', reference_name: '一元硬币', dimensions_mm: { length: 25, width: 25, height: 1.85 } })}><Text style={styles.referencePresetText}>一元硬币</Text></Pressable>
              </View>
              {referenceObjects.length > 0 ? <View style={styles.referenceList}>{referenceObjects.map((reference, referenceIndex) => (
                <View key={`${reference.reference_name}-${referenceIndex}`} style={styles.referenceChip}><Text style={styles.referenceChipText}>{reference.reference_name}</Text><Pressable style={styles.referenceRemove} onPress={() => setReferenceObjects((current) => current.filter((_, index) => index !== referenceIndex))} accessibilityRole="button" accessibilityLabel={`移除参考物${reference.reference_name}`}><X size={16} color={palette.red} /></Pressable></View>
              ))}</View> : null}
              <View style={styles.customReferenceCard}>
                <Text style={styles.fieldLabel}>自定义参考物</Text>
                <TextInput value={referenceName} onChangeText={setReferenceName} placeholder="参考物名称" placeholderTextColor={palette.textMuted} style={styles.textInput} accessibilityLabel="参考物名称" />
                <View style={styles.referenceDimensionsRow}>{[[referenceLength, setReferenceLength, '长 mm'], [referenceWidth, setReferenceWidth, '宽 mm'], [referenceHeight, setReferenceHeight, '高 mm']].map(([value, setter, placeholder]) => (
                  <TextInput key={String(placeholder)} value={value as string} onChangeText={setter as (text: string) => void} keyboardType="decimal-pad" placeholder={placeholder as string} placeholderTextColor={palette.textMuted} style={styles.referenceDimensionInput} accessibilityLabel={placeholder as string} />
                ))}</View>
                <TextInput value={referencePlacement} onChangeText={setReferencePlacement} placeholder="摆放说明，例如与食物在同一平面" placeholderTextColor={palette.textMuted} style={styles.textInput} accessibilityLabel="参考物摆放说明" />
                <Pressable style={({ pressed }) => [styles.addReferenceButton, pressed && styles.pressed]} onPress={() => void addCustomReference()} accessibilityRole="button"><Text style={styles.addReferenceButtonText}>添加参考物</Text></Pressable>
              </View>
              <View style={styles.followupActions}>
                <Pressable style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]} onPress={retakePrecision} accessibilityRole="button"><Text style={styles.secondaryActionText}>重新拍照继续</Text></Pressable>
                <Pressable style={({ pressed }) => [styles.primaryAction, continuingPrecision && styles.disabled, pressed && !continuingPrecision && styles.primaryPressed]} disabled={continuingPrecision} onPress={() => void continuePrecision()} accessibilityRole="button" accessibilityState={{ busy: continuingPrecision, disabled: continuingPrecision }}>{continuingPrecision ? <ActivityIndicator color={palette.white} /> : <Text style={styles.primaryActionText}>提交补充信息</Text>}</Pressable>
              </View>
            </View>
          ) : null}

          <EatingMoodPicker value={eatingMood} onChange={setEatingMood} />
          <View style={styles.correctionCard}>
            <View style={styles.correctionCopy}><Text style={styles.correctionTitle}>识别有误？</Text><Text style={styles.correctionHint}>名称、重量、比例和删除项都可以用于重新分析。</Text></View>
            <Pressable style={({ pressed }) => [styles.correctionButton, pressed && styles.pressed]} onPress={() => setCorrectionVisible(true)} accessibilityRole="button" accessibilityLabel="打开识别纠错"><Text style={styles.correctionButtonText}>点击纠错</Text></Pressable>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footerActions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.actionGrid}>
          <Pressable style={({ pressed }) => [styles.secondaryBtn, (savingRecipe || Boolean(savedRecipeId)) && styles.secondaryBtnDisabled, pressed && !savingRecipe && styles.pressed]} onPress={() => void saveAsRecipe()} disabled={savingRecipe} accessibilityRole="button" accessibilityState={{ busy: savingRecipe, disabled: savingRecipe }}>
            {savingRecipe ? <ActivityIndicator color={palette.brandStrong} /> : <Text style={styles.secondaryBtnText}>{savedRecipeId ? '已收藏' : '收藏餐食'}</Text>}
          </Pressable>
          <Pressable style={({ pressed }) => [styles.primaryBtn, (saving || items.length === 0) && styles.disabled, pressed && !saving && items.length > 0 && styles.primaryPressed]} onPress={openMealSelector} disabled={saving || items.length === 0} accessibilityRole="button" accessibilityLabel={saving ? '正在保存饮食记录' : '记录'} accessibilityState={{ busy: saving, disabled: saving || items.length === 0 }}>
            {saving ? <ActivityIndicator color={palette.white} /> : <Text style={styles.primaryBtnText}>记录</Text>}
          </Pressable>
        </View>
        <Pressable style={({ pressed }) => [styles.footerCorrectionLink, pressed && styles.pressed]} onPress={() => setCorrectionVisible(true)} accessibilityRole="button"><Text style={styles.footerCorrectionText}>识别有误？点击纠错</Text></Pressable>
      </View>

      <Modal visible={showMealSelector} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => setShowMealSelector(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowMealSelector(false)} accessibilityRole="button" accessibilityLabel="关闭餐次选择" />
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>选择餐次</Text><Pressable style={styles.closeButton} onPress={() => setShowMealSelector(false)} accessibilityRole="button" accessibilityLabel="关闭"><X size={20} color={palette.textSecondary} /></Pressable></View>
            <View style={styles.mealGrid}>{mealOptions.map((option) => { const active = selectedMealType === option.value; const MealIcon = option.Icon; return (
              <Pressable key={option.value} style={({ pressed }) => [styles.mealOption, active && styles.mealOptionActive, pressed && styles.cardHeaderPressed]} onPress={() => setSelectedMealType(option.value)} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: active }}><View style={[styles.mealIconWrap, active && styles.mealIconWrapActive]}><MealIcon size={20} color={active ? palette.brand : palette.textSecondary} /></View><Text style={[styles.mealOptionLabel, active && styles.mealOptionLabelActive]}>{option.label}</Text></Pressable>
            ) })}</View>
            <View style={styles.sheetActions}><Pressable style={({ pressed }) => [styles.sheetCancel, pressed && styles.cardHeaderPressed]} onPress={() => setShowMealSelector(false)}><Text style={styles.sheetCancelText}>取消</Text></Pressable><Pressable style={({ pressed }) => [styles.sheetConfirm, pressed && styles.primaryPressed]} onPress={confirmMealTypeAndSave}><Text style={styles.sheetConfirmText}>保存记录</Text></Pressable></View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(foodEditor)} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={closeFoodEditor}>
        <KeyboardAvoidingView style={styles.editorKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={closeFoodEditor} accessibilityRole="button" accessibilityLabel="关闭食物编辑" />
          <View style={[styles.editorCard, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>修改食物</Text><Pressable style={styles.closeButton} onPress={closeFoodEditor} accessibilityRole="button" accessibilityLabel="关闭"><X size={20} color={palette.textSecondary} /></Pressable></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.editorScroll}>
              <Text style={styles.editorSectionTitle}>基础信息</Text>
              <Text style={styles.fieldLabel}>名称</Text><TextInput value={foodEditor?.name || ''} onChangeText={(value) => updateFoodEditorField('name', value)} placeholder="食物名称" placeholderTextColor={palette.textMuted} style={styles.textInput} accessibilityLabel="食物名称" />
              <Text style={styles.fieldLabel}>估算重量（g）</Text><TextInput value={foodEditor?.weight || ''} onChangeText={(value) => updateFoodEditorField('weight', value)} keyboardType="decimal-pad" placeholder="重量" placeholderTextColor={palette.textMuted} style={styles.textInput} accessibilityLabel="估算重量" />
              <Text style={styles.editorSectionTitle}>整份营养</Text>
              <View style={styles.editorGrid}>{([['calories', '热量', 'kcal'], ['protein', '蛋白质', 'g'], ['carbs', '碳水', 'g'], ['fat', '脂肪', 'g'], ['waterMl', '含水量', 'ml']] as const).map(([field, label, unit]) => (
                <View key={field} style={[styles.editorField, field === 'waterMl' && styles.editorFieldWide]}><Text style={styles.fieldLabel}>{label}</Text><View style={styles.inputWithUnit}><TextInput value={foodEditor?.[field] || ''} onChangeText={(value) => updateFoodEditorField(field, value)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={palette.textMuted} style={styles.inputWithUnitControl} accessibilityLabel={label} /><Text style={styles.inputUnit}>{unit}</Text></View></View>
              ))}</View>
              {foodEditorError ? <Text style={styles.editorError} accessibilityRole="alert">{foodEditorError}</Text> : null}
            </ScrollView>
            <View style={styles.sheetActions}><Pressable style={({ pressed }) => [styles.sheetCancel, pressed && styles.cardHeaderPressed]} onPress={closeFoodEditor}><Text style={styles.sheetCancelText}>取消</Text></Pressable><Pressable style={({ pressed }) => [styles.sheetConfirm, pressed && styles.primaryPressed]} onPress={saveFoodEditor}><Text style={styles.sheetConfirmText}>保存修改</Text></Pressable></View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={quickRatioVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => setQuickRatioVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setQuickRatioVisible(false)} accessibilityRole="button" accessibilityLabel="关闭快捷比例" />
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>快捷比例</Text><Pressable style={styles.closeButton} onPress={() => setQuickRatioVisible(false)} accessibilityRole="button" accessibilityLabel="关闭"><X size={20} color={palette.textSecondary} /></Pressable></View>
            {[2, 3, 4].map((people) => <Pressable key={people} style={({ pressed }) => [styles.quickRatioOption, pressed && styles.cardHeaderPressed]} onPress={() => { applyPeopleRatio(people); setQuickRatioVisible(false) }} accessibilityRole="button" accessibilityLabel={`${people}人聚餐，每人${Math.round(100 / people)}%`}><Text style={styles.quickRatioOptionTitle}>{people === 2 ? '两人聚餐' : people === 3 ? '三人聚餐' : '四人聚餐'}</Text><Text style={styles.quickRatioOptionHint}>每人 {Math.round(100 / people)}%</Text></Pressable>)}
            <View style={styles.customPeopleRow}><TextInput value={customPeople} onChangeText={(value) => setCustomPeople(sanitizeIntegerText(value))} keyboardType="number-pad" placeholder="自定义人数 1-99" placeholderTextColor={palette.textMuted} style={styles.customPeopleInput} accessibilityLabel="自定义人数" /><Pressable style={({ pressed }) => [styles.applyPeopleButton, pressed && styles.primaryPressed]} onPress={applyCustomPeopleRatio}><Text style={styles.applyPeopleText}>应用</Text></Pressable></View>
          </View>
        </View>
      </Modal>

      <Modal visible={correctionVisible} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => { if (!correcting && !feedbackSubmitting) setCorrectionVisible(false) }}>
        <KeyboardAvoidingView style={styles.editorKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackdrop} disabled={correcting || feedbackSubmitting} onPress={() => setCorrectionVisible(false)} accessibilityRole="button" accessibilityLabel="关闭纠错" />
          <View style={[styles.correctionModalCard, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>二次分析纠正</Text><Pressable style={styles.closeButton} disabled={correcting || feedbackSubmitting} onPress={() => setCorrectionVisible(false)} accessibilityRole="button" accessibilityLabel="关闭"><X size={20} color={palette.textSecondary} /></Pressable></View>
            <Text style={styles.correctionModalHint}>名称和营养请先在食物卡片中编辑；这里补充上一轮哪里不对、这次应该怎样理解。</Text>
            <View style={styles.correctionItemSummary}>{items.slice(0, 6).map((item, index) => <Text key={`${item.clientId}-${index}`} style={styles.correctionItemText} numberOfLines={1}>{index + 1}. {item.name.trim() || '未命名食物'} · {Math.round(editableWeight(item))}g · {clampRatio(item.ratio)}%</Text>)}{items.length > 6 ? <Text style={styles.correctionMoreText}>另有 {items.length - 6} 项</Text> : null}</View>
            <Pressable style={({ pressed }) => [styles.correctionAddButton, pressed && styles.cardHeaderPressed]} onPress={() => { setCorrectionVisible(false); addManualItem() }} accessibilityRole="button" accessibilityLabel="添加遗漏食物"><Plus size={18} color={palette.brandStrong} /><Text style={styles.correctionAddButtonText}>添加遗漏食物</Text></Pressable>
            <Text style={styles.fieldLabel}>文字纠错说明</Text>
            <TextInput value={correctionContext} onChangeText={setCorrectionContext} placeholder="例如：第二项不是鸡肉，是牛肉；米饭大约只有120g" placeholderTextColor={palette.textMuted} multiline maxLength={500} autoFocus style={styles.correctionInput} accessibilityLabel="文字纠错说明" />
            <Pressable disabled={correcting || feedbackSubmitting} style={({ pressed }) => [styles.feedbackOnlyButton, (correcting || feedbackSubmitting) && styles.disabled, pressed && styles.cardHeaderPressed]} onPress={() => void submitFeedbackOnly()} accessibilityRole="button" accessibilityState={{ busy: feedbackSubmitting, disabled: correcting || feedbackSubmitting }}>{feedbackSubmitting ? <ActivityIndicator color={palette.brandStrong} /> : <Text style={styles.feedbackOnlyText}>仅提交反馈，不重新分析</Text>}</Pressable>
            <View style={styles.sheetActions}><Pressable disabled={correcting || feedbackSubmitting} style={({ pressed }) => [styles.sheetCancel, pressed && styles.cardHeaderPressed]} onPress={() => setCorrectionVisible(false)}><Text style={styles.sheetCancelText}>取消</Text></Pressable><Pressable disabled={correcting || feedbackSubmitting} style={({ pressed }) => [styles.sheetConfirm, (correcting || feedbackSubmitting) && styles.disabled, pressed && styles.primaryPressed]} onPress={() => void submitCorrection()} accessibilityState={{ busy: correcting, disabled: correcting || feedbackSubmitting }}>{correcting ? <ActivityIndicator color={palette.white} /> : <Text style={styles.sheetConfirmText}>重新智能分析</Text>}</Pressable></View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={previewImageIndex !== null} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => setPreviewImageIndex(null)}>
        <View style={styles.previewRoot}>
          <Pressable style={[styles.previewClose, { top: insets.top + 12 }]} onPress={() => setPreviewImageIndex(null)} accessibilityRole="button" accessibilityLabel="关闭图片预览"><X size={24} color={palette.white} /></Pressable>
          {previewImageIndex !== null && imageSources[previewImageIndex] ? <Image source={{ uri: imageSources[previewImageIndex] }} style={styles.previewImage} resizeMode="contain" accessibilityLabel={`分析原图 ${previewImageIndex + 1}`} /> : null}
          {imageSources.length > 1 && previewImageIndex !== null ? <><Pressable style={styles.previewPrevious} onPress={() => setPreviewImageIndex((current) => current === null ? null : (current - 1 + imageSources.length) % imageSources.length)} accessibilityRole="button" accessibilityLabel="上一张"><ChevronLeft size={26} color={palette.white} /></Pressable><Pressable style={styles.previewNext} onPress={() => setPreviewImageIndex((current) => current === null ? null : (current + 1) % imageSources.length)} accessibilityRole="button" accessibilityLabel="下一张"><ChevronRight size={26} color={palette.white} /></Pressable><Text style={[styles.previewCounter, { bottom: insets.bottom + 24 }]}>{previewImageIndex + 1}/{imageSources.length}</Text></> : null}
        </View>
      </Modal>
    </View>
  )
}

function ResultInsightItem({
  styles,
  palette,
  Icon,
  label,
  value,
  tone = 'intro',
}: {
  styles: ResultStyles
  palette: ResultPalette
  Icon: LucideIcon
  label?: string
  value: unknown
  tone?: 'intro' | 'highlight' | 'ratio' | 'absorption'
}) {
  const text = stringOrUndefined(value)
  if (!text) return null
  const toneStyle = tone === 'highlight'
    ? styles.insightItemHighlight
    : tone === 'ratio'
      ? styles.insightItemRatio
      : tone === 'absorption'
        ? styles.insightItemAbsorption
        : styles.insightItemIntro
  const iconColor = tone === 'ratio'
    ? palette.orange
    : tone === 'absorption'
      ? palette.purple
      : palette.brandStrong
  return (
    <View style={[styles.insightItem, toneStyle]}>
      <View style={styles.insightIconWrap}><Icon size={17} color={iconColor} strokeWidth={2.1} /></View>
      <View style={styles.insightBody}>
        {label ? <Text style={styles.insightLabel}>{label}</Text> : null}
        <Text style={styles.insightContent}>{text}</Text>
      </View>
    </View>
  )
}
const EDIBLE_PORTION_HINT_KEYWORDS = [
  '虾', '小龙虾', '龙虾', '蟹', '螃蟹', '贝', '蛤', '蛏', '蚝', '扇贝',
  '鸡爪', '凤爪', '鸡翅', '鸡腿', '鸭脖', '鸭掌', '鸭翅', '鸭腿', '鹅胗', '鹅翅',
  '排骨', '骨', '猪蹄', '鱼', '荔枝', '龙眼', '龙贡果', '龙宫果', '山竹', '榴莲',
  '柚子', '橙', '橘', '香蕉', '芒果', '菠萝', '玉米',
]

function getEdiblePortionHint(item: EditableResultItem): string | null {
  const ratio = item.ediblePortionRatio
  if (typeof ratio === 'number' && ratio > 0 && ratio < 99) {
    const reason = item.ediblePortionReason ? `：${item.ediblePortionReason}` : ''
    return `可食部 ${Math.round(ratio)}%，原始约 ${Math.round(item.grossWeight || editableWeight(item))}g，计入 ${Math.round(editableWeight(item))}g${reason}`
  }
  if (EDIBLE_PORTION_HINT_KEYWORDS.some((keyword) => item.name.includes(keyword))) {
    return '重量按可食部估算：去壳、去骨、去皮或去核部分未计入营养。'
  }
  return null
}

function normalizeEdiblePortionRatio(value: unknown): number | undefined {
  const ratio = Number(value)
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined
  return ratio <= 1 ? ratio * 100 : ratio
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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
      grossWeight: numberOrUndefined(item.grossWeightGrams ?? item.gross_weight_grams),
      ediblePortionRatio: normalizeEdiblePortionRatio(item.ediblePortionRatio ?? item.edible_portion_ratio),
      ediblePortionReason: stringOrUndefined(item.ediblePortionReason ?? item.edible_portion_reason),
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
  const value = task.payload?.analysis_engine || task.result?.analysis_engine
  if (value === 'ai_direct' || value === 'ai_then_db_exact' || value === 'db_candidates_ai') return value
  if (value === 'legacy_direct') return 'ai_direct'
  return isPrecisionExecutionMode(taskExecutionMode(task)) ? 'db_candidates_ai' : 'ai_direct'
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

function isPrecisionExecutionMode(mode: ExecutionMode): boolean {
  return mode === 'strict' || mode === 'strict_separate' || mode === 'strict_web_search'
}

function analysisEngineLabel(engine: AnalysisEngine): string {
  if (engine === 'ai_then_db_exact') return '标准库校准'
  if (engine === 'db_candidates_ai' || engine === 'db_first') return '数据库候选'
  return 'AI估算'
}

function taskReferenceObjects(task: ResultRoute['params']['task']): PrecisionReferenceObjectInput[] {  const raw = task.payload?.reference_objects || task.result?.reference_objects
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
  return items.filter((item) => !isPackagedChoicePending(item)).reduce(
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


function progressWidth(value: number, max: number): `${number}%` {
  const percentage = max > 0 ? Math.round(value / max * 100) : 0
  return `${Math.max(6, Math.min(100, percentage))}%`
}


function stringOrUndefined(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function firstImage(images: string[] | null | undefined): string | undefined {
  return Array.isArray(images) ? images.find((image) => Boolean(stringOrUndefined(image))) : undefined
}

function normalizeSelectableMealType(value: MealType | string | undefined | null): SelectableMealType {
  switch (value) {
    case 'breakfast':
    case 'morning_snack':
    case 'lunch':
    case 'afternoon_snack':
    case 'dinner':
    case 'evening_snack':
      return value
    default:
      return 'lunch'
  }
}

function uniqueImageSources(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const uri = stringOrUndefined(value)
    if (!uri || seen.has(uri)) return []
    seen.add(uri)
    return [uri]
  })
}

function formatInputNumberAllowZero(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function sanitizeNumberText(value: string): string {
  const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '')
  const dot = normalized.indexOf('.')
  return dot < 0 ? normalized : normalized.slice(0, dot + 1) + normalized.slice(dot + 1).replace(/\./g, '')
}

function sanitizeIntegerText(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 2)
}

function formatNutrientDetailValue(value: number): string {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

function createResultStyles(palette: ResultPalette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    hero: { overflow: 'hidden', backgroundColor: palette.hero },
    heroImagePage: { width: '100%' },
    heroImage: { width: '100%', height: '100%' },
    heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: palette.hero },
    heroPlaceholderIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brandBorder },
    heroPlaceholderText: { color: palette.textSecondary, fontSize: 14, fontWeight: '700' },
    heroShade: { ...StyleSheet.absoluteFill, backgroundColor: palette.heroOverlay },
    imageCounter: { position: 'absolute', right: 16, minWidth: 48, height: 34, paddingHorizontal: 12, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.64)' },
    imageCounterText: { color: palette.white, fontSize: 13, fontWeight: '800' },
    resultScroll: { flex: 1 },
    resultScrollInner: { flexGrow: 1 },
    contentContainer: { marginTop: -26, marginHorizontal: 14, gap: 14 },
    executionModeRow: { minHeight: 52, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    executionModeLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
    modeTag: { minHeight: 30, paddingHorizontal: 10, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    modeTagText: { color: palette.brandStrong, fontSize: 12, fontWeight: '900' },
    engineTag: { minHeight: 30, paddingHorizontal: 10, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blueSoft },
    engineTagText: { color: palette.blue, fontSize: 12, fontWeight: '800' },
    modeLink: { minHeight: 44, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
    modeLinkText: { color: palette.textSecondary, fontSize: 12, fontWeight: '700' },
    uploadEntry: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
    uploadEntryText: { color: palette.brandStrong, fontSize: 12, fontWeight: '800' },
    nutritionOverviewCard: { borderRadius: 22, padding: 20, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 3 },
    nutritionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    caloriesMain: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
    caloriesValue: { color: palette.text, fontSize: 42, lineHeight: 48, fontWeight: '900', fontVariant: ['tabular-nums'] },
    caloriesUnitRow: { paddingBottom: 5, gap: 1 },
    caloriesUnit: { color: palette.brandStrong, fontSize: 13, fontWeight: '900' },
    caloriesLabel: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    totalWeightBadge: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.brandSoft },
    weightText: { color: palette.brandStrong, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
    macroGrid: { marginTop: 22, flexDirection: 'row', gap: 10 },
    macroItem: { flex: 1, minWidth: 0, borderRadius: 14, padding: 12, backgroundColor: palette.cardSoft },
    macroBar: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: palette.track },
    macroProgress: { height: 6, borderRadius: 3 },
    macroProgressProtein: { backgroundColor: palette.blue },
    macroProgressCarbs: { backgroundColor: palette.warning },
    macroProgressFat: { backgroundColor: palette.orange },
    macroValue: { marginTop: 10, color: palette.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
    macroUnit: { fontSize: 12, fontWeight: '800' },
    macroLabel: { marginTop: 2, fontSize: 12, fontWeight: '800' },
    macroLabelProtein: { color: palette.blue },
    macroLabelCarbs: { color: palette.warning },
    macroLabelFat: { color: palette.orange },
    pendingBanner: { minHeight: 48, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center', backgroundColor: palette.warningSoft, borderWidth: 1, borderColor: palette.warning },
    pendingBannerText: { color: palette.warning, fontSize: 13, lineHeight: 19, fontWeight: '800' },
    insightCard: { borderRadius: 20, overflow: 'hidden', backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    cardHeaderToggle: { minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    cardHeaderPressed: { backgroundColor: palette.cardSoft },
    cardHeaderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle: { color: palette.text, fontSize: 16, fontWeight: '900' },
    insightToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    insightToggleText: { color: palette.textSecondary, fontSize: 12, fontWeight: '800' },
    insightItems: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
    insightItem: { minHeight: 58, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1 },
    insightItemIntro: { backgroundColor: palette.cardSoft, borderColor: palette.border },
    insightItemHighlight: { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
    insightItemRatio: { backgroundColor: palette.orangeSoft, borderColor: palette.orange },
    insightItemAbsorption: { backgroundColor: palette.purpleSoft, borderColor: palette.purple },
    insightIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card },
    insightBody: { flex: 1, minWidth: 0, gap: 3 },
    insightLabel: { color: palette.textSecondary, fontSize: 12, fontWeight: '900' },
    insightContent: { color: palette.text, fontSize: 13, lineHeight: 20, fontWeight: '600' },
    sectionHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 2 },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
    sectionTitle: { color: palette.text, fontSize: 20, fontWeight: '900' },
    sectionCount: { color: palette.textMuted, fontSize: 13, fontWeight: '700' },
    sectionHint: { marginTop: 3, color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    quickRatioButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    quickRatioButtonText: { color: palette.brandStrong, fontSize: 13, fontWeight: '900' },
    emptyCard: { minHeight: 170, borderRadius: 20, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    emptyIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.cardSoft },
    emptyTitle: { marginTop: 12, color: palette.text, fontSize: 16, fontWeight: '900' },
    emptyDescription: { marginTop: 6, maxWidth: 280, color: palette.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
    ingredientCard: { borderRadius: 20, overflow: 'hidden', backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
    ingredientHeader: { minHeight: 64, paddingLeft: 16, paddingRight: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
    ingredientNameButton: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderRadius: 12, paddingHorizontal: 4 },
    ingredientName: { flex: 1, color: palette.text, fontSize: 17, lineHeight: 23, fontWeight: '900' },
    editAffordance: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    editAffordanceText: { color: palette.brandStrong, fontSize: 12, fontWeight: '800' },
    deleteButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.redSoft },
    deleteButtonPressed: { opacity: 0.72 },
    ingredientBasis: { paddingHorizontal: 16, paddingBottom: 12, color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    ingredientPer100: { paddingHorizontal: 16, marginTop: -8, paddingBottom: 10, color: palette.textSecondary, fontSize: 11, lineHeight: 17, fontWeight: '600' },
    ediblePortionHint: { marginHorizontal: 14, marginBottom: 12, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brandBorder },
    ediblePortionHintText: { color: palette.brandStrong, fontSize: 12, lineHeight: 18, fontWeight: '700' },
    packagedChoiceCard: { marginHorizontal: 14, marginBottom: 12, borderRadius: 14, padding: 12, gap: 8, backgroundColor: palette.warningSoft, borderWidth: 1, borderColor: palette.warning },
    packagedChoiceTitle: { color: palette.text, fontSize: 14, fontWeight: '900' },
    packagedChoiceHint: { color: palette.textSecondary, fontSize: 12, lineHeight: 18 },
    packagedChoiceOption: { minHeight: 54, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    packagedChoiceCopy: { flex: 1, minWidth: 0 },
    packagedChoiceName: { color: palette.text, fontSize: 13, fontWeight: '900' },
    packagedChoiceMeta: { marginTop: 3, color: palette.textMuted, fontSize: 11, lineHeight: 16 },
    packagedChoiceAction: { color: palette.brandStrong, fontSize: 12, fontWeight: '900' },
    nutritionStrip: { marginHorizontal: 14, flexDirection: 'row', gap: 6 },
    nutritionCell: { flex: 1, minWidth: 0, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 10 },
    nutritionCal: { backgroundColor: palette.brandSoft },
    nutritionProtein: { backgroundColor: palette.blueSoft },
    nutritionCarbs: { backgroundColor: palette.warningSoft },
    nutritionFat: { backgroundColor: palette.orangeSoft },
    nutritionCellLabel: { color: palette.textSecondary, fontSize: 10, fontWeight: '800' },
    nutritionCellValue: { marginTop: 5, color: palette.text, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
    nutritionCellUnit: { fontSize: 9, fontWeight: '700' },
    nutritionDetailsToggle: { minHeight: 48, marginHorizontal: 14, marginTop: 8, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    nutritionDetailsToggleText: { color: palette.textSecondary, fontSize: 13, fontWeight: '800' },
    nutritionDetailGrid: { marginHorizontal: 14, padding: 10, borderRadius: 14, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: palette.cardSoft },
    nutritionDetailCell: { width: '50%', minHeight: 52, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'center' },
    nutritionDetailLabel: { color: palette.textMuted, fontSize: 11, fontWeight: '700' },
    nutritionDetailValue: { marginTop: 3, color: palette.text, fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
    nutritionDetailUnit: { color: palette.textMuted, fontSize: 10, fontWeight: '700' },    ingredientControls: { marginTop: 12, padding: 14, gap: 10, backgroundColor: palette.cardSoft, borderTopWidth: 1, borderTopColor: palette.border },
    weightControlRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    controlLabel: { color: palette.text, fontSize: 13, fontWeight: '900' },
    controlSubLabel: { marginTop: 3, color: palette.textMuted, fontSize: 11, fontWeight: '600' },
    weightAdjuster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    adjustButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    adjustButtonDisabled: { opacity: 0.42 },
    adjustButtonPressed: { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
    weightDisplayWrap: { minWidth: 76, height: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: palette.card },
    weightDisplay: { color: palette.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
    weightDisplayUnit: { color: palette.textSecondary, fontSize: 12, fontWeight: '800' },
    ratioHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    ratioValue: { color: palette.brandStrong, fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
    ratioAdjustable: { minHeight: 48, justifyContent: 'center' },
    ratioRail: { height: 8, marginHorizontal: 10, borderRadius: 4, backgroundColor: palette.track },
    ratioFill: { height: 8, borderRadius: 4, backgroundColor: palette.brand },
    ratioKnob: { position: 'absolute', top: -8, width: 24, height: 24, marginLeft: -12, borderRadius: 12, backgroundColor: palette.card, borderWidth: 4, borderColor: palette.brand, shadowColor: palette.shadow, shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
    suggestionRow: { minHeight: 52, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brandBorder },
    suggestionCopy: { flex: 1, minWidth: 0 },
    suggestionTitle: { color: palette.brandStrong, fontSize: 12, fontWeight: '900' },
    suggestionReason: { marginTop: 3, color: palette.textSecondary, fontSize: 11, lineHeight: 16 },
    suggestionAction: { color: palette.brandStrong, fontSize: 12, fontWeight: '900' },
    precisionCard: { borderRadius: 20, padding: 16, gap: 10, backgroundColor: palette.warningSoft, borderWidth: 1, borderColor: palette.warning },
    precisionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    precisionTitle: { color: palette.text, fontSize: 16, fontWeight: '900' },
    precisionHint: { color: palette.textSecondary, fontSize: 13, lineHeight: 20 },
    fieldLabel: { color: palette.textSecondary, fontSize: 12, fontWeight: '800' },
    multilineInput: { minHeight: 92, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 12, color: palette.text, backgroundColor: palette.input, borderWidth: 1, borderColor: palette.border, fontSize: 14, lineHeight: 21, textAlignVertical: 'top' },
    textInput: { minHeight: 48, borderRadius: 13, paddingHorizontal: 13, color: palette.text, backgroundColor: palette.input, borderWidth: 1, borderColor: palette.border, fontSize: 14 },
    referencePresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    referencePresetButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    referencePresetText: { color: palette.textSecondary, fontSize: 13, fontWeight: '800' },
    referenceList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    referenceChip: { minHeight: 44, paddingLeft: 12, paddingRight: 4, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.card },
    referenceChipText: { color: palette.text, fontSize: 12, fontWeight: '800' },
    referenceRemove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    customReferenceCard: { borderRadius: 15, padding: 12, gap: 9, backgroundColor: palette.cardSoft },
    referenceDimensionsRow: { flexDirection: 'row', gap: 8 },
    referenceDimensionInput: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 12, paddingHorizontal: 10, color: palette.text, backgroundColor: palette.input, borderWidth: 1, borderColor: palette.border, fontSize: 13 },
    addReferenceButton: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    addReferenceButtonText: { color: palette.brandStrong, fontSize: 13, fontWeight: '900' },
    followupActions: { flexDirection: 'row', gap: 10 },
    secondaryAction: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    secondaryActionText: { color: palette.textSecondary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
    primaryAction: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    primaryActionText: { color: palette.white, fontSize: 13, fontWeight: '900', textAlign: 'center' },
    correctionCard: { minHeight: 78, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border },
    correctionCopy: { flex: 1, minWidth: 0 },
    correctionTitle: { color: palette.text, fontSize: 14, fontWeight: '900' },
    correctionHint: { marginTop: 4, color: palette.textMuted, fontSize: 11, lineHeight: 16 },
    correctionButton: { minHeight: 44, paddingHorizontal: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.orangeSoft },
    correctionButtonText: { color: palette.orange, fontSize: 12, fontWeight: '900' },
    footerActions: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 14, backgroundColor: palette.card, borderTopWidth: 1, borderTopColor: palette.border, shadowColor: palette.shadow, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: -5 }, elevation: 10 },
    actionGrid: { flexDirection: 'row', gap: 10 },
    secondaryBtn: { flex: 1, minHeight: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.cardSoft, borderWidth: 1, borderColor: palette.border },
    secondaryBtnText: { color: palette.textSecondary, fontSize: 14, fontWeight: '900' },
    secondaryBtnDisabled: { opacity: 0.66 },
    primaryBtn: { flex: 1.5, minHeight: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    primaryBtnText: { color: palette.white, fontSize: 15, fontWeight: '900' },
    footerCorrectionLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    footerCorrectionText: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    disabled: { opacity: 0.48 },
    pressed: { opacity: 0.76 },
    primaryPressed: { opacity: 0.84 },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: palette.scrim },
    sheetCard: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, backgroundColor: palette.card, borderTopWidth: 1, borderColor: palette.border },
    sheetHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sheetTitle: { color: palette.text, fontSize: 19, fontWeight: '900' },
    closeButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.cardSoft },
    mealGrid: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    mealOption: { width: '31.5%', minHeight: 82, borderRadius: 15, padding: 10, alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: palette.cardSoft, borderWidth: 1, borderColor: palette.border },
    mealOptionActive: { backgroundColor: palette.brandSoft, borderColor: palette.brand },
    mealIconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card },
    mealIconWrapActive: { backgroundColor: palette.cardElevated },
    mealOptionLabel: { color: palette.textSecondary, fontSize: 13, fontWeight: '800' },
    mealOptionLabelActive: { color: palette.brandStrong },
    sheetActions: { marginTop: 14, flexDirection: 'row', gap: 10 },
    sheetCancel: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.cardSoft, borderWidth: 1, borderColor: palette.border },
    sheetCancelText: { color: palette.textSecondary, fontSize: 14, fontWeight: '900' },
    sheetConfirm: { flex: 1.3, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    sheetConfirmText: { color: palette.white, fontSize: 14, fontWeight: '900' },
    editorKeyboard: { flex: 1, justifyContent: 'flex-end' },
    editorCard: { maxHeight: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, backgroundColor: palette.card, borderTopWidth: 1, borderColor: palette.border },
    editorScroll: { paddingBottom: 8, gap: 8 },
    editorSectionTitle: { marginTop: 8, marginBottom: 2, color: palette.text, fontSize: 14, fontWeight: '900' },
    editorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    editorField: { width: '48%' },
    editorFieldWide: { width: '100%' },
    inputWithUnit: { minHeight: 48, borderRadius: 13, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.input, borderWidth: 1, borderColor: palette.border },
    inputWithUnitControl: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: 12, color: palette.text, fontSize: 14 },
    inputUnit: { paddingRight: 12, color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    editorError: { color: palette.red, fontSize: 12, lineHeight: 18, fontWeight: '800' },
    quickRatioOption: { minHeight: 60, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.cardSoft, borderWidth: 1, borderColor: palette.border },
    quickRatioOptionTitle: { color: palette.text, fontSize: 14, fontWeight: '900' },
    quickRatioOptionHint: { color: palette.textMuted, fontSize: 12, fontWeight: '700' },
    customPeopleRow: { marginTop: 10, flexDirection: 'row', gap: 8 },
    customPeopleInput: { flex: 1, minHeight: 50, borderRadius: 13, paddingHorizontal: 13, color: palette.text, backgroundColor: palette.input, borderWidth: 1, borderColor: palette.border, fontSize: 14 },
    applyPeopleButton: { width: 88, minHeight: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    applyPeopleText: { color: palette.white, fontSize: 14, fontWeight: '900' },
    correctionModalCard: { maxHeight: '90%', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, backgroundColor: palette.card, borderTopWidth: 1, borderColor: palette.border },
    correctionModalHint: { color: palette.textSecondary, fontSize: 13, lineHeight: 20 },
    correctionItemSummary: { marginTop: 10, borderRadius: 14, padding: 12, gap: 5, backgroundColor: palette.cardSoft },
    correctionItemText: { color: palette.textSecondary, fontSize: 12, lineHeight: 18 },
    correctionMoreText: { color: palette.textMuted, fontSize: 11, fontWeight: '700' },
    correctionAddButton: { marginTop: 10, minHeight: 48, borderRadius: 13, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brandBorder },
    correctionAddButtonText: { color: palette.brandStrong, fontSize: 13, fontWeight: '900' },
    correctionInput: { marginTop: 6, minHeight: 110, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 12, color: palette.text, backgroundColor: palette.input, borderWidth: 1, borderColor: palette.border, fontSize: 14, lineHeight: 21, textAlignVertical: 'top' },
    feedbackOnlyButton: { marginTop: 10, minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    feedbackOnlyText: { color: palette.brandStrong, fontSize: 13, fontWeight: '900' },
    previewRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' },
    previewImage: { width: '100%', height: '100%' },
    previewClose: { position: 'absolute', right: 14, zIndex: 3, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)' },
    previewPrevious: { position: 'absolute', left: 12, top: '47%', zIndex: 3, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)' },
    previewNext: { position: 'absolute', right: 12, top: '47%', zIndex: 3, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)' },
    previewCounter: { position: 'absolute', alignSelf: 'center', color: palette.white, fontSize: 14, fontWeight: '900' },
  })
}