import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  buildSaveFoodRecordRequestFromTask,
  type AnalysisTask,
  type FoodItem,
  type MealType,
  type Nutrients,
} from '@food-link/core'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type TextResultRoute = RouteProp<RootStackParamList, 'TextResult'>

type NutrientField = 'calories' | 'protein' | 'carbs' | 'fat'
type SelectableMealType = Exclude<MealType, 'snack'>

type EditableTextResultItem = {
  name: string
  weightText: string
  ratio: number
  baseWeight: number
  nutrientsText: Record<NutrientField, string>
}

const ratioOptions = [25, 50, 75, 100]
const mealOptions: Array<{ value: SelectableMealType; label: string; icon: string }> = [
  { value: 'breakfast', label: '早餐', icon: '早' },
  { value: 'morning_snack', label: '早加餐', icon: '加' },
  { value: 'lunch', label: '午餐', icon: '午' },
  { value: 'afternoon_snack', label: '午加餐', icon: '加' },
  { value: 'dinner', label: '晚餐', icon: '晚' },
  { value: 'evening_snack', label: '晚加餐', icon: '夜' },
]
const nutrientFields: Array<{ key: NutrientField; label: string; unit: string }> = [
  { key: 'protein', label: '蛋白质', unit: 'g' },
  { key: 'carbs', label: '碳水', unit: 'g' },
  { key: 'fat', label: '脂肪', unit: 'g' },
]

export function TextResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<TextResultRoute>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const { task, mealType, date } = route.params
  const foodItems = task.result?.items || []
  const [items, setItems] = useState<EditableTextResultItem[]>(() => buildEditableItems(foodItems))
  const [saving, setSaving] = useState(false)
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>(() => normalizeSelectableMealType(mealType))

  useEffect(() => {
    setItems(buildEditableItems(foodItems))
  }, [task.id, foodItems.length])

  useEffect(() => {
    setSelectedMealType(normalizeSelectableMealType(mealType))
  }, [mealType])

  const totals = useMemo(() => calculateTotals(items), [items])
  const originalText = textInputFromTask(task)
  const additionalContext = additionalContextFromTask(task)
  const descriptionText = stringOrUndefined(task.result?.description) || originalText
  const insightText = stringOrUndefined(task.result?.insight)
  const heroHeight = 200
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
      const pfcRatioComment = stringOrUndefined(task.result?.pfc_ratio_comment)
      const absorptionNotes = stringOrUndefined(task.result?.absorption_notes)
      const contextAdvice = stringOrUndefined(task.result?.context_advice)
      if (pfcRatioComment) payload.pfc_ratio_comment = pfcRatioComment
      if (absorptionNotes) payload.absorption_notes = absorptionNotes
      if (contextAdvice) payload.context_advice = contextAdvice
      delete payload.image_path
      delete payload.image_paths

      const saved = await apiClient.saveFoodRecord(payload)
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

  const updateItem = (index: number, patch: Partial<EditableTextResultItem>) => {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
  }

  const openMealSelector = () => {
    if (saving) return
    setSelectedMealType(normalizeSelectableMealType(mealType))
    setShowMealSelector(true)
  }

  const confirmMealTypeAndSave = () => {
    setShowMealSelector(false)
    void saveRecord(selectedMealType)
  }

  const updateNutrientText = (index: number, key: NutrientField, value: string) => {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index
        ? { ...item, nutrientsText: { ...item.nutrientsText, [key]: sanitizeNumberText(value) } }
        : item
    )))
  }

  const adjustWeight = (index: number, delta: number) => {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? adjustEditableWeight(item, delta) : item
    )))
  }

  return (
    <View style={styles.page}>
      <ScrollView
        style={styles.resultScroll}
        contentContainerStyle={[
          styles.resultScrollInner,
          { paddingBottom: 140 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroSection, { minHeight: heroHeight }]}>
          <View style={styles.heroPattern} pointerEvents="none" />
          <View style={styles.heroIconWrapper}>
            <Text style={styles.heroIconText}>文</Text>
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
                <Text style={styles.weightText}>约 {Math.round(totals.weight)}g</Text>
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

          </View>

          <View style={styles.insightCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>AI 饮食透视</Text>
            </View>
            <InsightItem tone="intro" icon="文" value={descriptionText} />
            <InsightItem tone="intro" icon="补" value={additionalContext ? `补充说明：${additionalContext}` : undefined} />
            <InsightItem tone="highlight" icon="✓" value={insightText} />
            <InsightItem tone="ratio" icon="比" label="营养比例" value={task.result?.pfc_ratio_comment} />
            <InsightItem tone="absorption" icon="吸" label="吸收与利用" value={task.result?.absorption_notes} />
            <InsightItem tone="intro" icon="时" label="情境建议" value={task.result?.context_advice} />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>包含成分</Text>
            <Text style={styles.sectionCount}>共 {items.length} 项</Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.empty}>当前没有识别到可记录的食物</Text>
            </View>
          ) : null}

          {items.map((item, index) => {
            const weight = editableWeight(item)
            const ratio = clampRatio(item.ratio)
            const nutrients = nutrientsFromEditable(item)
            const actualWeight = weight * ratio / 100
            const itemCalories = nutrients.calories * ratio / 100
            return (
              <View key={`${item.name}-${index}`} style={styles.ingredientCard}>
                <View style={styles.ingredientMain}>
                  <View style={styles.rowBetween}>
                    <TextInput
                      value={item.name}
                      onChangeText={(name) => updateItem(index, { name })}
                      placeholder="食物名称"
                      placeholderTextColor={colors.textMuted}
                      style={styles.nameInput}
                    />
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
                      <Pressable style={[styles.adjustButton, styles.adjustMinus]} onPress={() => adjustWeight(index, -10)}>
                        <Text style={styles.adjustButtonText}>-</Text>
                      </Pressable>
                      <View style={styles.weightDisplayWrap}>
                        <TextInput
                          value={item.weightText}
                          onChangeText={(weightText) => updateItem(index, { weightText: sanitizeNumberText(weightText) })}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          style={styles.weightDisplayInput}
                        />
                        <Text style={styles.weightDisplayUnit}>g</Text>
                      </View>
                      <Pressable style={[styles.adjustButton, styles.adjustPlus]} onPress={() => adjustWeight(index, 10)}>
                        <Text style={[styles.adjustButtonText, styles.adjustPlusText]}>+</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.ratioHeader}>
                    <Text style={styles.inputLabel}>实际摄入比例</Text>
                    <Text style={styles.ratioValue}>{ratio}% · {Math.round(actualWeight)}g</Text>
                  </View>
                  <View style={styles.ratioTrack}>
                    <View style={[styles.ratioFill, { width: `${ratio}%` as `${number}%` }]} />
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

                  <View style={styles.nutrientEditGrid}>
                    {nutrientFields.map((field) => (
                      <View key={field.key} style={styles.nutrientEditItem}>
                        <Text style={styles.nutrientEditLabel}>{field.label}</Text>
                        <View style={styles.nutrientEditInputWrap}>
                          <TextInput
                            value={item.nutrientsText[field.key]}
                            onChangeText={(value) => updateNutrientText(index, field.key, value)}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.textMuted}
                            style={styles.nutrientEditInput}
                          />
                          <Text style={styles.inputUnit}>{field.unit}</Text>
                        </View>
                      </View>
                    ))}
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
            style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
            onPress={openMealSelector}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>确认记录</Text>}
          </Pressable>
        </View>
      </View>

      {showMealSelector && (
        <View style={styles.mealOverlay}>
          <Pressable style={styles.mealBackdrop} onPress={() => setShowMealSelector(false)} />
          <View style={styles.mealCard}>
            <Text style={styles.mealTitle}>选择餐次</Text>
            <View style={styles.mealGrid}>
              {mealOptions.map((option) => {
                const active = selectedMealType === option.value
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.mealOption, active && styles.mealOptionActive]}
                    onPress={() => setSelectedMealType(option.value)}
                  >
                    <View style={[styles.mealIconWrap, active && styles.mealIconWrapActive]}>
                      <Text style={[styles.mealIconText, active && styles.mealIconTextActive]}>{option.icon}</Text>
                    </View>
                    <Text style={[styles.mealOptionLabel, active && styles.mealOptionLabelActive]}>{option.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <View style={styles.mealActions}>
              <Pressable style={styles.mealCancelBtn} onPress={() => setShowMealSelector(false)}>
                <Text style={styles.mealCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.mealConfirmBtn} onPress={confirmMealTypeAndSave}>
                <Text style={styles.mealConfirmText}>确认保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

function InsightItem({
  tone,
  icon,
  label,
  value,
}: {
  tone: 'intro' | 'highlight' | 'ratio' | 'absorption'
  icon: string
  label?: string
  value: unknown
}) {
  const text = stringOrUndefined(value)
  if (!text) return null
  return (
    <View style={[styles.insightItem, insightToneStyle(tone)]}>
      <View style={[styles.insightIconWrap, insightIconToneStyle(tone)]}>
        <Text style={[styles.insightIconText, insightIconTextToneStyle(tone)]}>{icon}</Text>
      </View>
      <View style={styles.insightBody}>
        {label ? <Text style={styles.insightLabel}>{label}</Text> : null}
        <Text style={styles.insightContent}>{text}</Text>
      </View>
    </View>
  )
}

function buildEditableItems(foodItems: FoodItem[]): EditableTextResultItem[] {
  return foodItems.map((item) => {
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

function insightToneStyle(tone: 'intro' | 'highlight' | 'ratio' | 'absorption') {
  if (tone === 'highlight') return styles.insightItemHighlight
  if (tone === 'ratio') return styles.insightItemRatio
  if (tone === 'absorption') return styles.insightItemAbsorption
  return styles.insightItemIntro
}

function insightIconToneStyle(tone: 'intro' | 'highlight' | 'ratio' | 'absorption') {
  if (tone === 'highlight') return styles.insightIconWrapGreen
  if (tone === 'ratio') return styles.insightIconWrapOrange
  if (tone === 'absorption') return styles.insightIconWrapPurple
  return styles.insightIconWrapBlue
}

function insightIconTextToneStyle(tone: 'intro' | 'highlight' | 'ratio' | 'absorption') {
  if (tone === 'highlight') return styles.insightIconTextGreen
  if (tone === 'ratio') return styles.insightIconTextOrange
  if (tone === 'absorption') return styles.insightIconTextPurple
  return styles.insightIconTextBlue
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

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  heroSection: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
    backgroundColor: '#dbe4ee',
  },
  heroPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    opacity: 0.14,
    backgroundColor: '#cbd5e1',
  },
  heroIconWrapper: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.62)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    zIndex: 2,
  },
  heroIconText: {
    color: '#475569',
    fontSize: 28,
    fontWeight: '800',
  },
  heroTitle: {
    color: '#334155',
    fontSize: 18,
    fontWeight: '700',
    zIndex: 2,
  },
  heroOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 80,
    zIndex: 1,
    backgroundColor: 'rgba(248,250,252,0.62)',
  },
  resultScroll: {
    flex: 1,
    zIndex: 1,
  },
  resultScrollInner: {
    minHeight: '100%',
  },
  contentContainer: {
    position: 'relative',
    zIndex: 2,
    gap: 16,
    marginTop: -50,
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 24,
    backgroundColor: '#f8fafc',
  },
  insightCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.9)',
  },
  cardHeader: {
    marginBottom: 12,
  },
  cardTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '700',
  },
  insightItem: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 10,
  },
  insightItemIntro: {
    backgroundColor: '#f1f5f9',
  },
  insightItemHighlight: {
    backgroundColor: '#f0fdf4',
    borderColor: 'rgba(0,188,125,0.2)',
  },
  insightItemRatio: {
    backgroundColor: '#fff7ed',
    borderColor: 'rgba(249,115,22,0.15)',
  },
  insightItemAbsorption: {
    backgroundColor: '#faf5ff',
    borderColor: 'rgba(168,85,247,0.15)',
  },
  insightIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  insightIconWrapBlue: {
    backgroundColor: 'rgba(59,130,246,0.1)',
  },
  insightIconWrapGreen: {
    backgroundColor: 'rgba(0,188,125,0.1)',
  },
  insightIconWrapOrange: {
    backgroundColor: 'rgba(249,115,22,0.1)',
  },
  insightIconWrapPurple: {
    backgroundColor: 'rgba(168,85,247,0.1)',
  },
  insightIconText: {
    fontSize: 13,
    fontWeight: '800',
  },
  insightIconTextBlue: {
    color: '#3b82f6',
  },
  insightIconTextGreen: {
    color: '#00bc7d',
  },
  insightIconTextOrange: {
    color: '#f97316',
  },
  insightIconTextPurple: {
    color: '#a855f7',
  },
  insightBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  insightLabel: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '700',
  },
  insightContent: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 23,
  },
  nutritionOverviewCard: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
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
    backgroundColor: '#00bc7d',
  },
  macroProgressCarbs: {
    backgroundColor: '#3b82f6',
  },
  macroProgressFat: {
    backgroundColor: '#f59e0b',
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
    color: '#00bc7d',
  },
  macroLabelCarbs: {
    color: '#3b82f6',
  },
  macroLabelFat: {
    color: '#f59e0b',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  sectionCount: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
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
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
  },
  ingredientMain: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  nameInput: {
    flex: 1,
    minHeight: 32,
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: 3,
  },
  ingredientCalories: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  calVal: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '700',
  },
  calUnit: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  ingredientControls: {
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 10,
    backgroundColor: '#f8fafc',
  },
  weightControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  weightAdjuster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 3,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  adjustButton: {
    width: 26,
    height: 26,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  adjustMinus: {
    backgroundColor: '#f1f5f9',
  },
  adjustPlus: {
    backgroundColor: '#ecfdf5',
  },
  adjustButtonText: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  adjustPlusText: {
    color: '#059669',
  },
  weightDisplayWrap: {
    minWidth: 68,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weightDisplayInput: {
    minWidth: 36,
    maxWidth: 56,
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
    padding: 0,
    textAlign: 'center',
  },
  weightDisplayUnit: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  inputUnit: {
    color: '#64748b',
    fontSize: 12,
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
    fontWeight: '700',
  },
  ratioTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
  },
  ratioFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#00bc7d',
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
  nutrientEditGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  nutrientEditItem: {
    width: '48%',
  },
  nutrientEditLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 5,
  },
  nutrientEditInputWrap: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  nutrientEditInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
    paddingVertical: 6,
  },
  footerActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 0,
  },
  primaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  primaryBtnDisabled: {
    opacity: 0.72,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  mealOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.56)',
    paddingHorizontal: 24,
  },
  mealBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  mealCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  mealTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
  },
  mealGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  mealOption: {
    width: '48%',
    minHeight: 84,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
  },
  mealOptionActive: {
    borderColor: colors.brand,
    backgroundColor: '#ecfdf5',
  },
  mealIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef2f7',
  },
  mealIconWrapActive: {
    backgroundColor: 'rgba(0,188,125,0.14)',
  },
  mealIconText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '900',
  },
  mealIconTextActive: {
    color: colors.brand,
  },
  mealOptionLabel: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '800',
  },
  mealOptionLabelActive: {
    color: '#059669',
    fontWeight: '900',
  },
  mealActions: {
    flexDirection: 'row',
    gap: 12,
  },
  mealCancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  mealCancelText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '900',
  },
  mealConfirmBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  mealConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
})
