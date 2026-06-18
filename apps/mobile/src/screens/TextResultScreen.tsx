import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  buildSaveFoodRecordRequestFromTask,
  getMealTypeLabel,
  type AnalysisTask,
  type FoodItem,
  type Nutrients,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { colors } from '../theme'
import { userFacingErrorMessage } from '../utils/errors'

type TextResultRoute = RouteProp<RootStackParamList, 'TextResult'>

type NutrientField = 'calories' | 'protein' | 'carbs' | 'fat'

type EditableTextResultItem = {
  name: string
  weightText: string
  ratio: number
  baseWeight: number
  nutrientsText: Record<NutrientField, string>
}

const ratioOptions = [25, 50, 75, 100]
const weightAdjustments = [-50, -10, 10, 50]
const nutrientFields: Array<{ key: NutrientField; label: string; unit: string }> = [
  { key: 'calories', label: '热量', unit: 'kcal' },
  { key: 'protein', label: '蛋白质', unit: 'g' },
  { key: 'carbs', label: '碳水', unit: 'g' },
  { key: 'fat', label: '脂肪', unit: 'g' },
]

export function TextResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<TextResultRoute>()
  const dialog = useAppDialog()
  const { task, mealType, date } = route.params
  const foodItems = task.result?.items || []
  const [items, setItems] = useState<EditableTextResultItem[]>(() => buildEditableItems(foodItems))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setItems(buildEditableItems(foodItems))
  }, [task.id, foodItems.length])

  const totals = useMemo(() => calculateTotals(items), [items])
  const originalText = textInputFromTask(task)
  const additionalContext = additionalContextFromTask(task)

  const saveRecord = async () => {
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
        mealType,
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
    <Page title="文字记录分析" subtitle={`${date} · ${getMealTypeLabel(mealType)}`}>
      <Card>
        <Text style={styles.eyebrow}>原始文字</Text>
        <Text style={styles.description}>{originalText || task.result?.description || '文字饮食分析已完成'}</Text>
        {additionalContext ? <Text style={styles.contextText}>补充说明：{additionalContext}</Text> : null}
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>营养汇总</Text>
          <Text style={styles.badge}>已识别 {items.length} 项</Text>
        </View>
        <View style={styles.statGrid}>
          <Stat label="总热量" value={`${Math.round(totals.calories)} kcal`} />
          <Stat label="实际摄入" value={`${Math.round(totals.weight)}g`} />
        </View>
        <View style={styles.statGrid}>
          <Stat label="蛋白质" value={`${round1(totals.protein)}g`} />
          <Stat label="碳水" value={`${round1(totals.carbs)}g`} />
          <Stat label="脂肪" value={`${round1(totals.fat)}g`} />
        </View>
        <Text style={styles.hint}>保存前可调整食物名称、估算重量、食用比例和营养值。</Text>
      </Card>

      {items.length === 0 ? (
        <Card>
          <Text style={styles.empty}>当前没有识别到可记录的食物</Text>
        </Card>
      ) : null}

      {items.map((item, index) => {
        const weight = editableWeight(item)
        const ratio = clampRatio(item.ratio)
        const nutrients = nutrientsFromEditable(item)
        const actualWeight = weight * ratio / 100
        const itemCalories = nutrients.calories * ratio / 100
        return (
          <Card key={`${item.name}-${index}`}>
            <View style={styles.rowBetween}>
              <TextInput
                value={item.name}
                onChangeText={(name) => updateItem(index, { name })}
                placeholder="食物名称"
                placeholderTextColor={colors.textMuted}
                style={styles.nameInput}
              />
              <Text style={styles.kcal}>{Math.round(itemCalories)} kcal</Text>
            </View>

            <Text style={styles.subtitle}>
              估算 {Math.round(weight)}g · 实际摄入 {Math.round(actualWeight)}g
            </Text>

            <View style={styles.inputLine}>
              <Text style={styles.inputLabel}>估算重量</Text>
              <View style={styles.weightInputWrap}>
                <TextInput
                  value={item.weightText}
                  onChangeText={(weightText) => updateItem(index, { weightText: sanitizeNumberText(weightText) })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  style={styles.weightInput}
                />
                <Text style={styles.inputUnit}>g</Text>
              </View>
            </View>
            <View style={styles.weightAdjustRow}>
              {weightAdjustments.map((delta) => (
                <Pressable key={delta} style={styles.weightAdjustButton} onPress={() => adjustWeight(index, delta)}>
                  <Text style={styles.weightAdjustText}>{delta > 0 ? `+${delta}` : delta}g</Text>
                </Pressable>
              ))}
            </View>

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
          </Card>
        )
      })}

      <Card>
        <Text style={styles.sectionTitle}>饮食建议</Text>
        <AdviceLine title="分析" value={task.result?.description} />
        <AdviceLine title="建议" value={task.result?.insight} />
        <AdviceLine title="搭配" value={task.result?.pfc_ratio_comment} />
        <AdviceLine title="吸收" value={task.result?.absorption_notes} />
        <AdviceLine title="上下文" value={task.result?.context_advice} />
      </Card>

      <Card>
        <AppButton label="确认记录" loading={saving} onPress={saveRecord} />
        <View style={styles.secondaryAction}>
          <AppButton label="查看识别历史" variant="secondary" onPress={() => navigation.navigate('AnalyzeHistory')} />
        </View>
      </Card>
    </Page>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  return stringOrUndefined(
    task.text_input ??
      task.payload?.text_input ??
      task.payload?.text ??
      task.payload?.original_text,
  )
}

function additionalContextFromTask(task: AnalysisTask): string | undefined {
  return stringOrUndefined(
    task.payload?.additionalContext ??
      task.payload?.additional_context ??
      task.payload?.food_amount,
  )
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

function sanitizeNumberText(value: string): string {
  return value.replace(/[^\d.]/g, '')
}

function stringOrUndefined(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: colors.brandDark,
    fontWeight: '900',
    marginBottom: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
  },
  badge: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  description: {
    color: colors.text,
    lineHeight: 22,
  },
  contextText: {
    marginTop: 8,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 6,
  },
  hint: {
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 2,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  stat: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    padding: 14,
  },
  statValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  statLabel: {
    marginTop: 4,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  nameInput: {
    flex: 1,
    minHeight: 42,
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  inputLine: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inputLabel: {
    color: colors.text,
    fontWeight: '800',
  },
  weightInputWrap: {
    width: 128,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
  },
  weightInput: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    paddingVertical: 8,
  },
  inputUnit: {
    color: colors.textSecondary,
    fontWeight: '700',
  },
  weightAdjustRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  weightAdjustButton: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  weightAdjustText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '900',
  },
  ratioHeader: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratioValue: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  ratioRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  ratioChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  ratioChipActive: {
    backgroundColor: colors.brand,
  },
  ratioText: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  ratioTextActive: {
    color: '#fff',
  },
  nutrientEditGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  nutrientEditItem: {
    width: '48%',
  },
  nutrientEditLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
  },
  nutrientEditInputWrap: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
  },
  nutrientEditInput: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
    paddingVertical: 8,
  },
  adviceLine: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  adviceTitle: {
    color: colors.text,
    fontWeight: '800',
    marginBottom: 4,
  },
  adviceText: {
    color: colors.textSecondary,
    lineHeight: 20,
  },
  secondaryAction: {
    marginTop: 12,
  },
})
