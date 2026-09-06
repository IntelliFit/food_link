import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
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
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Apple, BookOpenText, Check, ChevronDown, ChevronUp, Coffee, Cookie, Edit3, Minus,
  MoonStar, Plus, Scale, Soup, Sparkles, Sun, Sunrise, type LucideIcon,
} from 'lucide-react-native'
import {
  buildSaveFoodRecordRequestFromTask,
  type AnalysisTask,
  type EatingMood,
  type FoodItem,
  type MealType,
  type Nutrients,
} from '@food-link/core'
import { apiClient } from '../api'
import { EatingMoodPicker } from '../components/EatingMoodPicker'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { userFacingErrorMessage } from '../utils/errors'
import { emitHomeIntakeDataChangedEvent } from '../utils/home-events'

type TextResultRoute = RouteProp<RootStackParamList, 'TextResult'>
type NutrientField = 'calories' | 'protein' | 'carbs' | 'fat'
type MacroField = Exclude<NutrientField, 'calories'>
type SelectableMealType = Exclude<MealType, 'snack'>

type EditableTextResultItem = {
  name: string
  weightText: string
  ratio: number
  baseWeight: number
  nutrientsText: Record<NutrientField, string>
}

type TextResultEditor =
  | { kind: 'name'; itemIndex: number }
  | { kind: 'macro'; itemIndex: number; field: MacroField }

type TextResultPalette = {
  page: string
  card: string
  cardSoft: string
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
  heroIcon: string
  heroOverlay: string
  greenSoft: string
  blue: string
  blueSoft: string
  orange: string
  orangeSoft: string
  purple: string
  purpleSoft: string
  warning: string
  track: string
  scrim: string
  shadow: string
}

function createTextResultPalette(isDark: boolean): TextResultPalette {
  return isDark
    ? {
        page: '#0b0f0e', card: '#151b19', cardSoft: '#202927', input: '#1c2421',
        border: 'rgba(255,255,255,0.12)', text: '#f3f7f5', textSecondary: '#a9b7b1',
        textMuted: '#7f918a', brand: '#7dd3b0', brandStrong: '#49b98e',
        brandSoft: '#18332a', brandBorder: 'rgba(125,211,176,0.32)',
        hero: '#101816', heroPattern: '#294239', heroIcon: 'rgba(255,255,255,0.10)',
        heroOverlay: 'rgba(11,15,14,0.88)', greenSoft: '#18332a', blue: '#79b7ef',
        blueSoft: '#1f2c38', orange: '#f2ae6f', orangeSoft: '#33261d',
        purple: '#c49ae9', purpleSoft: '#2a2235', warning: '#f8bf61',
        track: 'rgba(0,0,0,0.26)', scrim: 'rgba(0,0,0,0.74)', shadow: '#000000',
      }
    : {
        page: '#f8fafc', card: '#ffffff', cardSoft: '#f1f5f9', input: '#ffffff',
        border: '#e2e8f0', text: '#0f172a', textSecondary: '#475569',
        textMuted: '#64748b', brand: '#00bc7d', brandStrong: '#059669',
        brandSoft: '#ecfdf5', brandBorder: 'rgba(0,188,125,0.28)',
        hero: '#dbe4ee', heroPattern: '#cbd5e1', heroIcon: 'rgba(255,255,255,0.68)',
        heroOverlay: 'rgba(248,250,252,0.68)', greenSoft: '#f0fdf4',
        blue: '#3b82f6', blueSoft: '#eff6ff', orange: '#f97316', orangeSoft: '#fff7ed',
        purple: '#a855f7', purpleSoft: '#faf5ff', warning: '#d97706',
        track: '#e2e8f0', scrim: 'rgba(15,23,42,0.58)', shadow: '#0f172a',
      }
}

type TextResultStyles = ReturnType<typeof createTextResultStyles>

const mealOptions: Array<{ value: SelectableMealType; label: string; Icon: LucideIcon }> = [
  { value: 'breakfast', label: '早餐', Icon: Sunrise },
  { value: 'morning_snack', label: '早加餐', Icon: Apple },
  { value: 'lunch', label: '午餐', Icon: Sun },
  { value: 'afternoon_snack', label: '午加餐', Icon: Cookie },
  { value: 'dinner', label: '晚餐', Icon: Soup },
  { value: 'evening_snack', label: '晚加餐', Icon: MoonStar },
]

const nutrientFields: Array<{ key: MacroField; label: string; unit: string }> = [
  { key: 'protein', label: '蛋白质', unit: 'g' },
  { key: 'carbs', label: '碳水', unit: 'g' },
  { key: 'fat', label: '脂肪', unit: 'g' },
]

export function TextResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<TextResultRoute>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const { isDark } = useColorScheme()
  const palette = useMemo(() => createTextResultPalette(isDark), [isDark])
  const styles = useMemo(() => createTextResultStyles(palette), [palette])
  const { task, mealType, date } = route.params
  const foodItems = task.result?.items || []

  const [items, setItems] = useState<EditableTextResultItem[]>(() => buildEditableItems(foodItems))
  const [eatingMood, setEatingMood] = useState<EatingMood | null>(null)
  const [saving, setSaving] = useState(false)
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>(() => normalizeSelectableMealType(mealType))
  const [insightCollapsed, setInsightCollapsed] = useState(false)
  const [editor, setEditor] = useState<TextResultEditor | null>(null)
  const [editorValue, setEditorValue] = useState('')
  const [editorError, setEditorError] = useState('')
  const [reduceMotion, setReduceMotion] = useState(false)

  const ratioWidthsRef = useRef<Record<number, number>>({})
  const weightAdjustedRef = useRef(false)
  const nutritionAdjustedRef = useRef(false)
  const ratioAdjustedRef = useRef(false)

  useEffect(() => {
    setItems(buildEditableItems(foodItems))
    setEatingMood(null)
    setInsightCollapsed(false)
    setEditor(null)
    weightAdjustedRef.current = false
    nutritionAdjustedRef.current = false
    ratioAdjustedRef.current = false
  }, [task.id])

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

  const totals = useMemo(() => calculateTotals(items), [items])
  const originalText = textInputFromTask(task)
  const additionalContext = additionalContextFromTask(task)
  const descriptionText = stringOrUndefined(task.result?.description) || originalText
  const insightText = stringOrUndefined(task.result?.insight)
  const hasInsights = Boolean(
    descriptionText || additionalContext || insightText
    || stringOrUndefined(task.result?.pfc_ratio_comment)
    || stringOrUndefined(task.result?.absorption_notes)
    || stringOrUndefined(task.result?.context_advice),
  )
  const macroMax = Math.max(totals.protein, totals.carbs, totals.fat, 1)

  const saveRecord = async (confirmedMealType: SelectableMealType) => {
    if (items.length === 0) {
      void dialog.alert('无法保存', '当前文字分析没有可保存的食物明细', 'warning')
      return
    }
    const invalidItem = items.find((item) => editableWeight(item) <= 0 || !item.name.trim())
    if (invalidItem) {
      void dialog.alert('无法保存', '请确认每个食物都有名称，并且重量大于 0g', 'warning')
      return
    }

    setSaving(true)
    try {
      const payload = buildSaveFoodRecordRequestFromTask(task, {
        mealType: confirmedMealType,
        date,
        entryType: 'food_text',
      })
      payload.items = items.map((editable, index) => {
        const original = payload.items[index] || {
          name: editable.name,
          weight: editableWeight(editable),
          ratio: editable.ratio,
          intake: Math.round(editableWeight(editable) * editable.ratio / 100),
          nutrients: nutrientsFromEditable(editable),
        }
        const weight = editableWeight(editable)
        const ratio = clampRatio(editable.ratio)
        return {
          ...original,
          name: editable.name.trim() || original.name,
          weight,
          ratio,
          intake: Math.round(weight * ratio / 100),
          nutrients: nutrientsFromEditable(editable),
        }
      })
      payload.total_calories = totals.calories
      payload.total_protein = totals.protein
      payload.total_carbs = totals.carbs
      payload.total_fat = totals.fat
      payload.total_weight_grams = totals.weight
      if (eatingMood) payload.eating_mood = eatingMood
      const pfcRatioComment = stringOrUndefined(task.result?.pfc_ratio_comment)
      const absorptionNotes = stringOrUndefined(task.result?.absorption_notes)
      const contextAdvice = stringOrUndefined(task.result?.context_advice)
      if (pfcRatioComment) payload.pfc_ratio_comment = pfcRatioComment
      if (absorptionNotes) payload.absorption_notes = absorptionNotes
      if (contextAdvice) payload.context_advice = contextAdvice
      delete payload.image_path
      delete payload.image_paths

      const feedbackType = nutritionAdjustedRef.current
        ? 'nutrition_mismatch'
        : weightAdjustedRef.current && !ratioAdjustedRef.current
          ? 'weight_mismatch'
          : null
      if (feedbackType) {
        void apiClient.submitAnalysisFeedback({
          feedback_type: feedbackType,
          resolution_state: 'still_distrust',
          source_task_id: task.id,
          before_result: task.result || undefined,
          after_result: {
            ...(task.result || {}),
            items: payload.items,
            total_calories: totals.calories,
            total_protein: totals.protein,
            total_carbs: totals.carbs,
            total_fat: totals.fat,
            total_weight_grams: totals.weight,
          },
        }).catch(() => undefined)
      }

      const saved = await apiClient.saveFoodRecord(payload)
      emitHomeIntakeDataChangedEvent({ date: payload.date || date, force: true })
      const message = saved.already_saved ? '这条记录之前已经保存。' : '已记录到当天饮食。'
      if (!saved.id) {
        const result = await dialog.showDialog({
          title: '保存成功',
          message,
          kind: 'success',
          confirmText: '回到首页',
        })
        if (result === 'confirm') navigation.dispatch(CommonActions.navigate('MainTabs'))
        return
      }
      const result = await dialog.showDialog({
        title: '保存成功',
        message,
        kind: 'success',
        cancelText: '回到首页',
        confirmText: '查看记录',
      })
      if (result === 'confirm') navigation.navigate('RecordDetail', { recordId: saved.id })
      else if (result === 'cancel') navigation.dispatch(CommonActions.navigate('MainTabs'))
    } catch (error) {
      void dialog.alert('保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const updateItem = (index: number, patch: Partial<EditableTextResultItem>) => {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  const openMealSelector = () => {
    if (saving || items.length === 0) return
    setSelectedMealType(normalizeSelectableMealType(mealType))
    setShowMealSelector(true)
  }

  const confirmMealTypeAndSave = () => {
    setShowMealSelector(false)
    void saveRecord(selectedMealType)
  }

  const adjustWeight = (index: number, delta: number) => {
    weightAdjustedRef.current = true
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? adjustEditableWeight(item, delta) : item
    )))
  }

  const updateRatio = (index: number, nextRatio: number) => {
    ratioAdjustedRef.current = true
    updateItem(index, { ratio: clampRatio(Math.round(nextRatio / 5) * 5) })
  }

  const updateRatioFromPress = (index: number, event: GestureResponderEvent) => {
    const width = ratioWidthsRef.current[index] || 0
    if (width <= 20) return
    updateRatio(index, (event.nativeEvent.locationX - 10) / (width - 20) * 100)
  }

  const openNameEditor = (itemIndex: number) => {
    setEditor({ kind: 'name', itemIndex })
    setEditorValue(items[itemIndex]?.name || '')
    setEditorError('')
  }

  const openMacroEditor = (itemIndex: number, field: MacroField) => {
    setEditor({ kind: 'macro', itemIndex, field })
    setEditorValue(items[itemIndex]?.nutrientsText[field] || '')
    setEditorError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setEditorValue('')
    setEditorError('')
  }

  const saveEditor = () => {
    if (!editor) return
    if (editor.kind === 'name') {
      const name = editorValue.trim()
      if (!name) {
        setEditorError('名称不能为空')
        return
      }
      nutritionAdjustedRef.current = true
      updateItem(editor.itemIndex, { name })
      closeEditor()
      AccessibilityInfo.announceForAccessibility('食物名称已更新')
      return
    }

    const parsed = Number(editorValue.trim())
    if (!editorValue.trim() || !Number.isFinite(parsed) || parsed < 0) {
      setEditorError('请输入不小于 0 的数字')
      return
    }
    nutritionAdjustedRef.current = true
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== editor.itemIndex) return item
      const nutrientsText = {
        ...item.nutrientsText,
        [editor.field]: formatInputNumberAllowZero(parsed),
      }
      return {
        ...item,
        nutrientsText: {
          ...nutrientsText,
          calories: formatInputNumberAllowZero(caloriesFromMacroText(nutrientsText)),
        },
      }
    }))
    closeEditor()
    AccessibilityInfo.announceForAccessibility('营养数值已更新')
  }

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.resultScroll}
        contentContainerStyle={[styles.resultScrollInner, { paddingBottom: 140 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroSection}>
          <View style={styles.heroPattern} pointerEvents="none" />
          <View style={styles.heroIconWrapper}>
            <BookOpenText size={30} color={palette.textSecondary} strokeWidth={2.1} />
          </View>
          <Text style={styles.heroTitle}>文字记录分析</Text>
          <View style={styles.heroOverlay} pointerEvents="none" />
        </View>

        <View style={styles.contentContainer}>
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
                <Scale size={15} color={palette.textSecondary} strokeWidth={2.2} />
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
                  <View style={styles.macroBar}>
                    <View style={[styles.macroProgress, fillStyle, { width: progressWidth(value, macroMax) }]} />
                  </View>
                  <Text style={styles.macroValue}>{round1(value)}<Text style={styles.macroUnit}>g</Text></Text>
                  <Text style={[styles.macroLabel, labelStyle]}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          {hasInsights ? (
            <View style={styles.insightCard}>
              <Pressable
                style={({ pressed }) => [styles.cardHeaderToggle, pressed && styles.cardHeaderPressed]}
                onPress={() => {
                  const next = !insightCollapsed
                  setInsightCollapsed(next)
                  AccessibilityInfo.announceForAccessibility(next ? 'AI 饮食透视已收起' : 'AI 饮食透视已展开')
                }}
                accessibilityRole="button"
                accessibilityLabel="AI 饮食透视"
                accessibilityHint={insightCollapsed ? '双击展开分析详情' : '双击收起分析详情'}
                accessibilityState={{ expanded: !insightCollapsed }}
              >
                <View style={styles.cardHeaderTitleRow}>
                  <Sparkles size={19} color={palette.brand} strokeWidth={2.2} />
                  <Text style={styles.cardTitle}>AI 饮食透视</Text>
                </View>
                <View style={styles.insightToggle}>
                  <Text style={styles.insightToggleText}>{insightCollapsed ? '展开' : '收起'}</Text>
                  {insightCollapsed
                    ? <ChevronDown size={18} color={palette.textSecondary} />
                    : <ChevronUp size={18} color={palette.textSecondary} />}
                </View>
              </Pressable>
              {!insightCollapsed ? (
                <View style={styles.insightItems}>
                  <InsightItem styles={styles} palette={palette} tone="intro" Icon={BookOpenText} value={descriptionText} />
                  <InsightItem styles={styles} palette={palette} tone="intro" Icon={Edit3} value={additionalContext ? '补充说明：' + additionalContext : undefined} />
                  <InsightItem styles={styles} palette={palette} tone="highlight" Icon={Check} value={insightText} />
                  <InsightItem styles={styles} palette={palette} tone="ratio" Icon={Sparkles} label="营养比例" value={task.result?.pfc_ratio_comment} />
                  <InsightItem styles={styles} palette={palette} tone="absorption" Icon={Coffee} label="吸收与利用" value={task.result?.absorption_notes} />
                  <InsightItem styles={styles} palette={palette} tone="intro" Icon={Coffee} label="情境建议" value={task.result?.context_advice} />
                </View>
              ) : null}
            </View>
          ) : null}

          <EatingMoodPicker value={eatingMood} onChange={setEatingMood} />

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>包含成分</Text>
            <Text style={styles.sectionCount}>共 {items.length} 项</Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}><BookOpenText size={24} color={palette.textMuted} /></View>
              <Text style={styles.emptyTitle}>没有识别到食物</Text>
              <Text style={styles.emptyDescription}>返回文字记录页补充更具体的食物名称和份量后再试。</Text>
            </View>
          ) : null}

          {items.map((item, index) => {
            const weight = editableWeight(item)
            const ratio = clampRatio(item.ratio)
            const nutrients = nutrientsFromEditable(item)
            const actualWeight = weight * ratio / 100
            const itemCalories = nutrients.calories * ratio / 100
            return (
              <View key={task.id + '-' + index} style={styles.ingredientCard}>
                <View style={styles.ingredientMain}>
                  <View style={styles.rowBetween}>
                    <Pressable
                      style={({ pressed }) => [styles.nameButton, pressed && styles.nameButtonPressed]}
                      onPress={() => openNameEditor(index)}
                      accessibilityRole="button"
                      accessibilityLabel={'修改食物名称，当前为' + (item.name || '未填写')}
                      accessibilityHint="双击打开名称编辑"
                    >
                      <Edit3 size={18} color={palette.brandStrong} strokeWidth={2.2} />
                      <Text style={styles.nameText} numberOfLines={2}>{item.name || '未填写食物名称'}</Text>
                    </Pressable>
                    <View style={styles.ingredientCalories}>
                      <Text style={styles.calVal}>{Math.round(itemCalories)}</Text>
                      <Text style={styles.calUnit}>kcal</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.ingredientControls}>
                  <View style={styles.weightControl}>
                    <Text style={styles.inputLabel}>估算重量</Text>
                    <View style={styles.weightAdjuster}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.adjustButton,
                          weight <= 1 && styles.adjustButtonDisabled,
                          pressed && weight > 1 && styles.adjustButtonPressed,
                        ]}
                        onPress={() => adjustWeight(index, -10)}
                        disabled={weight <= 1}
                        accessibilityRole="button"
                        accessibilityLabel={'减少' + item.name + '重量 10 克'}
                        accessibilityState={{ disabled: weight <= 1 }}
                      >
                        <Minus size={18} color={weight <= 1 ? palette.textMuted : palette.textSecondary} />
                      </Pressable>
                      <View style={styles.weightDisplayWrap} accessible accessibilityLabel={'估算重量 ' + round1(weight) + ' 克'}>
                        <Text style={styles.weightDisplay}>{round1(weight)}</Text>
                        <Text style={styles.weightDisplayUnit}>g</Text>
                      </View>
                      <Pressable
                        style={({ pressed }) => [styles.adjustButton, pressed && styles.adjustButtonPressed]}
                        onPress={() => adjustWeight(index, 10)}
                        accessibilityRole="button"
                        accessibilityLabel={'增加' + item.name + '重量 10 克'}
                      >
                        <Plus size={18} color={palette.brandStrong} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.ratioHeader}>
                    <Text style={styles.inputLabel}>实际摄入比例</Text>
                    <Text style={styles.ratioValue}>{ratio}% · {Math.round(actualWeight)}g</Text>
                  </View>
                  <Pressable
                    style={styles.ratioAdjustable}
                    onLayout={(event) => { ratioWidthsRef.current[index] = event.nativeEvent.layout.width }}
                    onPress={(event) => updateRatioFromPress(index, event)}
                    accessibilityRole="adjustable"
                    accessibilityLabel={item.name + '实际摄入比例'}
                    accessibilityValue={{ min: 0, max: 100, now: ratio, text: ratio + '%' }}
                    accessibilityActions={[
                      { name: 'increment', label: '增加 5%' },
                      { name: 'decrement', label: '减少 5%' },
                    ]}
                    onAccessibilityAction={(event) => {
                      if (event.nativeEvent.actionName === 'increment') updateRatio(index, ratio + 5)
                      if (event.nativeEvent.actionName === 'decrement') updateRatio(index, ratio - 5)
                    }}
                  >
                    <View style={styles.ratioRail} pointerEvents="none">
                      <View style={[styles.ratioFill, { width: (ratio + '%') as any }]} />
                      <View style={[styles.ratioKnob, { left: (ratio + '%') as any }]} />
                    </View>
                  </Pressable>

                  <View style={styles.macroEditorGrid}>
                    {nutrientFields.map((field) => {
                      const intakeValue = numberFromText(item.nutrientsText[field.key]) * ratio / 100
                      const toneStyle = field.key === 'protein'
                        ? styles.macroEditorProtein
                        : field.key === 'carbs'
                          ? styles.macroEditorCarbs
                          : styles.macroEditorFat
                      return (
                        <View key={field.key} style={styles.macroEditorItem}>
                          <Pressable
                            style={({ pressed }) => [styles.macroEditorChip, toneStyle, pressed && styles.macroEditorChipPressed]}
                            onPress={() => openMacroEditor(index, field.key)}
                            accessibilityRole="button"
                            accessibilityLabel={'修改' + item.name + field.label + '，当前摄入 ' + round1(intakeValue) + ' 克'}
                            accessibilityHint="双击输入识别总量"
                          >
                            <Text style={styles.macroEditorLabel}>{field.label}</Text>
                            <View style={styles.macroEditorValueRow}>
                              <Text style={styles.macroEditorValue}>{round1(intakeValue)}g</Text>
                              <Edit3 size={14} color={palette.textMuted} strokeWidth={2.1} />
                            </View>
                          </Pressable>
                        </View>
                      )
                    })}
                  </View>
                </View>
              </View>
            )
          })}
        </View>
      </ScrollView>

      <View style={[styles.footerActions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.actionGrid}>
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              (saving || items.length === 0) && styles.primaryBtnDisabled,
              pressed && !saving && items.length > 0 && styles.primaryBtnPressed,
            ]}
            onPress={openMealSelector}
            disabled={saving || items.length === 0}
            accessibilityRole="button"
            accessibilityLabel={saving ? '正在保存饮食记录' : '确认记录'}
            accessibilityState={{ disabled: saving || items.length === 0, busy: saving }}
          >
            {saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryBtnText}>确认记录</Text>}
          </Pressable>
        </View>
      </View>

      <Modal visible={showMealSelector} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => setShowMealSelector(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowMealSelector(false)} accessibilityRole="button" accessibilityLabel="关闭餐次选择" />
          <View style={[styles.mealCard, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <Text style={styles.mealTitle}>选择餐次</Text>
            <View style={styles.mealGrid}>
              {mealOptions.map((option) => {
                const active = selectedMealType === option.value
                const MealIcon = option.Icon
                return (
                  <Pressable
                    key={option.value}
                    style={({ pressed }) => [styles.mealOption, active && styles.mealOptionActive, pressed && styles.mealOptionPressed]}
                    onPress={() => setSelectedMealType(option.value)}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ checked: active }}
                  >
                    <View style={[styles.mealIconWrap, active && styles.mealIconWrapActive]}>
                      <MealIcon size={20} color={active ? palette.brand : palette.textSecondary} strokeWidth={2.2} />
                    </View>
                    <Text style={[styles.mealOptionLabel, active && styles.mealOptionLabelActive]}>{option.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <View style={styles.mealActions}>
              <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.mealOptionPressed]} onPress={() => setShowMealSelector(false)} accessibilityRole="button" accessibilityLabel="取消">
                <Text style={styles.secondaryButtonText}>取消</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.mealConfirmButton, pressed && styles.primaryBtnPressed]} onPress={confirmMealTypeAndSave} accessibilityRole="button" accessibilityLabel={'确认保存到' + (mealOptions.find((item) => item.value === selectedMealType)?.label || '')}>
                <Text style={styles.mealConfirmText}>确认保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(editor)} transparent animationType={reduceMotion ? 'none' : 'fade'} statusBarTranslucent onRequestClose={closeEditor}>
        <KeyboardAvoidingView style={styles.editorKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.modalBackdrop} onPress={closeEditor} accessibilityRole="button" accessibilityLabel="关闭编辑" />
          <View style={[styles.editorCard, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <Text style={styles.editorTitle}>
              {editor?.kind === 'name'
                ? '修改食物名称'
                : '修改' + (nutrientFields.find((field) => field.key === editor?.field)?.label || '营养')}
            </Text>
            <Text style={styles.editorLabel}>{editor?.kind === 'name' ? '食物名称' : '识别总量（g）'}</Text>
            <View style={[styles.editorInputShell, editorError && styles.editorInputShellError]}>
              <TextInput
                value={editorValue}
                onChangeText={(value) => {
                  setEditorValue(editor?.kind === 'name' ? value : sanitizeNumberText(value))
                  if (editorError) setEditorError('')
                }}
                placeholder={editor?.kind === 'name' ? '请输入新的食物名称' : '请输入不小于 0 的数字'}
                placeholderTextColor={palette.textMuted}
                keyboardType={editor?.kind === 'macro' ? 'decimal-pad' : 'default'}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveEditor}
                style={styles.editorInput}
                accessibilityLabel={editor?.kind === 'name' ? '食物名称' : '营养数值'}
              />
              {editor?.kind === 'macro' ? <Text style={styles.editorUnit}>g</Text> : null}
            </View>
            {editorError ? <Text style={styles.editorError} accessibilityRole="alert">{editorError}</Text> : null}
            <View style={styles.editorActions}>
              <Pressable style={({ pressed }) => [styles.editorCancel, pressed && styles.mealOptionPressed]} onPress={closeEditor} accessibilityRole="button" accessibilityLabel="取消编辑">
                <Text style={styles.editorCancelText}>取消</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.editorSave, pressed && styles.primaryBtnPressed]} onPress={saveEditor} accessibilityRole="button" accessibilityLabel="保存编辑">
                <Text style={styles.editorSaveText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function InsightItem({
  styles,
  palette,
  tone,
  Icon,
  label,
  value,
}: {
  styles: TextResultStyles
  palette: TextResultPalette
  tone: 'intro' | 'highlight' | 'ratio' | 'absorption'
  Icon: LucideIcon
  label?: string
  value: unknown
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
  const iconColor = tone === 'highlight'
    ? palette.brand
    : tone === 'ratio'
      ? palette.orange
      : tone === 'absorption'
        ? palette.purple
        : palette.blue
  return (
    <View style={[styles.insightItem, toneStyle]}>
      <View style={styles.insightIconWrap}>
        <Icon size={17} color={iconColor} strokeWidth={2.2} />
      </View>
      <View style={styles.insightBody}>
        {label ? <Text style={styles.insightLabel}>{label}</Text> : null}
        <Text style={styles.insightContent}>{text}</Text>
      </View>
    </View>
  )
}

function caloriesFromMacroText(nutrientsText: Record<NutrientField, string>): number {
  return numberFromText(nutrientsText.protein) * 4
    + numberFromText(nutrientsText.carbs) * 4
    + numberFromText(nutrientsText.fat) * 9
}

function formatInputNumberAllowZero(value: number): string {
  if (!Number.isFinite(value) || value < 0) return ''
  if (Math.abs(value - Math.round(value)) < 0.05) return String(Math.round(value))
  return round1(value)
}

function buildEditableItems(foodItems: FoodItem[]): EditableTextResultItem[] {  return foodItems.map((item) => {
    const baseWeight = foodWeight(item)
    const nutrients = normalizeNutrients(item.nutrients)
    return {
      name: item.name || '未命名食物',
      weightText: formatInputNumber(baseWeight),
      ratio: 100,
      baseWeight,
      nutrientsText: {
        calories: formatInputNumber(nutrients.calories),
        protein: formatInputNumber(nutrients.protein),
        carbs: formatInputNumber(nutrients.carbs),
        fat: formatInputNumber(nutrients.fat),
      },
    }
  })
}

function calculateTotals(items: EditableTextResultItem[]) {
  return items.reduce(
    (acc, item) => {
      const weight = editableWeight(item)
      const ratio = clampRatio(item.ratio) / 100
      const nutrients = nutrientsFromEditable(item)
      acc.calories += nutrients.calories * ratio
      acc.protein += nutrients.protein * ratio
      acc.carbs += nutrients.carbs * ratio
      acc.fat += nutrients.fat * ratio
      acc.weight += weight * ratio
      return acc
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, weight: 0 },
  )
}

function nutrientsFromEditable(item: EditableTextResultItem): Nutrients {
  return {
    calories: round1Number(numberFromText(item.nutrientsText.calories)),
    protein: round1Number(numberFromText(item.nutrientsText.protein)),
    carbs: round1Number(numberFromText(item.nutrientsText.carbs)),
    fat: round1Number(numberFromText(item.nutrientsText.fat)),
    fiber: 0,
    sugar: 0,
  }
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

function adjustEditableWeight(item: EditableTextResultItem, delta: number): EditableTextResultItem {
  const currentWeight = editableWeight(item)
  const nextWeight = Math.max(1, currentWeight + delta)
  const scale = currentWeight > 0 ? nextWeight / currentWeight : 1
  return {
    ...item,
    weightText: formatInputNumber(nextWeight),
    nutrientsText: {
      calories: formatInputNumber(numberFromText(item.nutrientsText.calories) * scale),
      protein: formatInputNumber(numberFromText(item.nutrientsText.protein) * scale),
      carbs: formatInputNumber(numberFromText(item.nutrientsText.carbs) * scale),
      fat: formatInputNumber(numberFromText(item.nutrientsText.fat) * scale),
    },
  }
}

function textInputFromTask(task: AnalysisTask): string | undefined {
  return decodeDisplayText(stringOrUndefined(
    task.text_input ??
      task.payload?.text_input ??
      task.payload?.text ??
      task.payload?.original_text,
  ))
}

function additionalContextFromTask(task: AnalysisTask): string | undefined {
  return decodeDisplayText(stringOrUndefined(
    task.payload?.additionalContext ??
      task.payload?.additional_context ??
      task.payload?.food_amount,
  ))
}

function editableWeight(item: EditableTextResultItem): number {
  return Math.max(0, numberFromText(item.weightText))
}

function foodWeight(item: FoodItem): number {
  return numberFrom(item.estimatedWeightGrams || item.originalWeightGrams)
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeSelectableMealType(value: MealType | string | undefined | null): SelectableMealType {
  if (value === 'snack') return 'afternoon_snack'
  const hit = mealOptions.find((option) => option.value === value)
  return hit?.value || 'lunch'
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

function sanitizeNumberText(value: string): string {
  return value.replace(/[^\d.]/g, '')
}

function stringOrUndefined(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function decodeDisplayText(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function createTextResultStyles(palette: TextResultPalette) {
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: palette.page,
    },
    resultScroll: {
      flex: 1,
    },
    resultScrollInner: {
      minHeight: '100%',
    },
    heroSection: {
      position: 'relative',
      minHeight: 184,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      overflow: 'hidden',
      backgroundColor: palette.hero,
    },
    heroPattern: {
      ...StyleSheet.absoluteFill,
      opacity: 0.14,
      backgroundColor: palette.heroPattern,
    },
    heroIconWrapper: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.heroIcon,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      shadowColor: palette.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
      zIndex: 2,
    },
    heroTitle: {
      color: palette.text,
      fontSize: 19,
      lineHeight: 26,
      fontWeight: '800',
      zIndex: 2,
    },
    heroOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 78,
      backgroundColor: palette.heroOverlay,
      opacity: 0.76,
      zIndex: 1,
    },
    contentContainer: {
      position: 'relative',
      zIndex: 2,
      gap: 16,
      marginTop: -42,
      paddingHorizontal: 16,
      paddingBottom: 24,
      backgroundColor: palette.page,
    },
    nutritionOverviewCard: {
      borderRadius: 18,
      padding: 20,
      backgroundColor: palette.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      shadowColor: palette.shadow,
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    nutritionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 18,
    },
    caloriesMain: {
      flex: 1,
      minWidth: 0,
    },
    caloriesValue: {
      color: palette.text,
      fontSize: 42,
      lineHeight: 48,
      fontWeight: '900',
    },
    caloriesUnitRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: 8,
    },
    caloriesUnit: {
      color: palette.text,
      fontSize: 16,
      fontWeight: '900',
    },
    caloriesLabel: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    totalWeightBadge: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 12,
      backgroundColor: palette.cardSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    weightText: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '900',
    },
    macroGrid: {
      flexDirection: 'row',
      gap: 12,
    },
    macroItem: {
      flex: 1,
      minWidth: 0,
      gap: 7,
    },
    macroBar: {
      height: 5,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: palette.track,
    },
    macroProgress: {
      height: '100%',
      borderRadius: 999,
    },
    macroProgressProtein: {
      backgroundColor: palette.brand,
    },
    macroProgressCarbs: {
      backgroundColor: palette.blue,
    },
    macroProgressFat: {
      backgroundColor: palette.warning,
    },
    macroValue: {
      color: palette.text,
      fontSize: 18,
      lineHeight: 23,
      fontWeight: '900',
    },
    macroUnit: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    macroLabel: {
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '900',
    },
    macroLabelProtein: {
      color: palette.brand,
    },
    macroLabelCarbs: {
      color: palette.blue,
    },
    macroLabelFat: {
      color: palette.warning,
    },
    insightCard: {
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: palette.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    cardHeaderToggle: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    cardHeaderPressed: {
      backgroundColor: palette.cardSoft,
    },
    cardHeaderTitleRow: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    cardTitle: {
      color: palette.text,
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '800',
    },
    insightToggle: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 4,
    },
    insightToggleText: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '800',
    },
    insightItems: {
      gap: 10,
      paddingHorizontal: 14,
      paddingBottom: 14,
    },
    insightItem: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    insightItemIntro: {
      backgroundColor: palette.cardSoft,
    },
    insightItemHighlight: {
      backgroundColor: palette.greenSoft,
      borderColor: palette.brandBorder,
    },
    insightItemRatio: {
      backgroundColor: palette.orangeSoft,
    },
    insightItemAbsorption: {
      backgroundColor: palette.purpleSoft,
    },
    insightIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      backgroundColor: palette.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    insightBody: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    insightLabel: {
      color: palette.brand,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '800',
    },
    insightContent: {
      color: palette.textSecondary,
      fontSize: 14,
      lineHeight: 22,
    },
    sectionHeader: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 2,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 18,
      lineHeight: 25,
      fontWeight: '800',
    },
    sectionCount: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '800',
    },
    emptyCard: {
      alignItems: 'center',
      gap: 8,
      borderRadius: 18,
      paddingHorizontal: 24,
      paddingVertical: 28,
      backgroundColor: palette.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    emptyIconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
      backgroundColor: palette.cardSoft,
    },
    emptyTitle: {
      color: palette.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '800',
    },
    emptyDescription: {
      color: palette.textSecondary,
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'center',
    },
    ingredientCard: {
      overflow: 'hidden',
      borderRadius: 16,
      backgroundColor: palette.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    ingredientMain: {
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
    },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    nameButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      borderRadius: 10,
      paddingHorizontal: 8,
    },
    nameButtonPressed: {
      backgroundColor: palette.cardSoft,
    },
    nameText: {
      flex: 1,
      color: palette.text,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '800',
    },
    ingredientCalories: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 3,
      flexShrink: 0,
    },
    calVal: {
      color: palette.warning,
      fontSize: 15,
      fontWeight: '800',
    },
    calUnit: {
      color: palette.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    ingredientControls: {
      gap: 10,
      paddingHorizontal: 12,
      paddingTop: 11,
      paddingBottom: 13,
      backgroundColor: palette.cardSoft,
    },
    weightControl: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
    },
    inputLabel: {
      color: palette.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700',
    },
    weightAdjuster: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 4,
      borderRadius: 12,
      backgroundColor: palette.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    adjustButton: {
      width: 44,
      height: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.cardSoft,
    },
    adjustButtonPressed: {
      opacity: 0.68,
    },
    adjustButtonDisabled: {
      opacity: 0.45,
    },
    weightDisplayWrap: {
      minWidth: 74,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: 3,
    },
    weightDisplay: {
      color: palette.text,
      fontSize: 15,
      fontWeight: '900',
    },
    weightDisplayUnit: {
      color: palette.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    ratioHeader: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    ratioValue: {
      color: palette.brand,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
    },
    ratioAdjustable: {
      minHeight: 48,
      justifyContent: 'center',
    },
    ratioRail: {
      height: 7,
      marginHorizontal: 10,
      borderRadius: 999,
      backgroundColor: palette.track,
    },
    ratioFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: palette.brand,
    },
    ratioKnob: {
      position: 'absolute',
      top: -7,
      width: 21,
      height: 21,
      marginLeft: -10,
      borderRadius: 11,
      backgroundColor: palette.input,
      borderWidth: 3,
      borderColor: palette.brand,
      shadowColor: palette.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    macroEditorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    macroEditorItem: {
      flexGrow: 1,
      flexBasis: '30%',
      minWidth: 92,
    },
    macroEditorChip: {
      minHeight: 62,
      justifyContent: 'center',
      gap: 4,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    macroEditorProtein: {
      backgroundColor: palette.greenSoft,
    },
    macroEditorCarbs: {
      backgroundColor: palette.blueSoft,
    },
    macroEditorFat: {
      backgroundColor: palette.orangeSoft,
    },
    macroEditorChipPressed: {
      opacity: 0.7,
    },
    macroEditorLabel: {
      color: palette.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: '800',
    },
    macroEditorValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 6,
    },
    macroEditorValue: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '900',
    },
    footerActions: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20,
      paddingTop: 12,
      paddingHorizontal: 16,
      backgroundColor: palette.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
      shadowColor: palette.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: -4 },
      elevation: 12,
    },
    actionGrid: {
      flexDirection: 'row',
    },
    primaryBtn: {
      flex: 1,
      minHeight: 50,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.brandStrong,
      shadowColor: palette.brandStrong,
      shadowOpacity: 0.22,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    primaryBtnPressed: {
      opacity: 0.76,
    },
    primaryBtnDisabled: {
      opacity: 0.48,
    },
    primaryBtnText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '900',
    },
    modalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: palette.scrim,
    },
    mealCard: {
      width: '100%',
      maxWidth: 520,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 18,
      paddingTop: 20,
      backgroundColor: palette.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      shadowColor: palette.shadow,
      shadowOpacity: 0.28,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -8 },
      elevation: 18,
    },
    mealTitle: {
      color: palette.text,
      fontSize: 19,
      lineHeight: 26,
      fontWeight: '900',
      textAlign: 'center',
      marginBottom: 18,
    },
    mealGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 18,
    },
    mealOption: {
      width: '48%',
      minHeight: 76,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: palette.input,
    },
    mealOptionActive: {
      borderColor: palette.brandBorder,
      backgroundColor: palette.brandSoft,
    },
    mealOptionPressed: {
      opacity: 0.72,
    },
    mealIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.cardSoft,
    },
    mealIconWrapActive: {
      backgroundColor: palette.greenSoft,
    },
    mealOptionLabel: {
      color: palette.textSecondary,
      fontSize: 14,
      fontWeight: '800',
    },
    mealOptionLabelActive: {
      color: palette.brand,
      fontWeight: '900',
    },
    mealActions: {
      flexDirection: 'row',
      gap: 12,
    },
    secondaryButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.cardSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    secondaryButtonText: {
      color: palette.textSecondary,
      fontSize: 15,
      fontWeight: '900',
    },
    mealConfirmButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.brandStrong,
    },
    mealConfirmText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '900',
    },
    editorKeyboard: {
      flex: 1,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    editorCard: {
      width: '100%',
      maxWidth: 520,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 18,
      paddingTop: 20,
      backgroundColor: palette.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    editorTitle: {
      color: palette.text,
      fontSize: 19,
      lineHeight: 26,
      fontWeight: '900',
      marginBottom: 16,
    },
    editorLabel: {
      color: palette.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
      marginBottom: 7,
    },
    editorInputShell: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 12,
      paddingHorizontal: 13,
      backgroundColor: palette.input,
      borderWidth: 1,
      borderColor: palette.border,
    },
    editorInputShellError: {
      borderColor: '#ef4444',
    },
    editorInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 50,
      color: palette.text,
      fontSize: 15,
      fontWeight: '700',
      paddingVertical: 10,
    },
    editorUnit: {
      color: palette.textSecondary,
      fontSize: 14,
      fontWeight: '800',
    },
    editorError: {
      color: '#ef4444',
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '700',
      marginTop: 6,
    },
    editorActions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 18,
    },
    editorCancel: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: palette.cardSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    editorCancelText: {
      color: palette.textSecondary,
      fontSize: 15,
      fontWeight: '900',
    },
    editorSave: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: palette.brandStrong,
    },
    editorSaveText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '900',
    },
  })
}
