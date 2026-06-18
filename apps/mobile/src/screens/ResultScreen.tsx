import { useEffect, useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  buildSaveFoodRecordRequestFromTask,
  getMealTypeLabel,
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

type ResultRoute = RouteProp<RootStackParamList, 'Result'>

type EditableResultItem = {
  name: string
  weightText: string
  ratio: number
  baseWeight: number
  baseNutrients: Nutrients
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
}

const ratioOptions = [25, 50, 75, 100]

export function ResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<ResultRoute>()
  const dialog = useAppDialog()
  const { task, imageUri, mealType, date } = route.params
  const foodItems = task.result?.items || []
  const [items, setItems] = useState<EditableResultItem[]>(() => buildEditableItems(foodItems))
  const [customPeople, setCustomPeople] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setItems(buildEditableItems(foodItems))
  }, [task.id, foodItems.length])

  const totals = useMemo(() => calculateTotals(items), [items])
  const imageSource = imageUri || stringOrUndefined(task.image_url) || firstImage(task.image_paths)

  const saveRecord = async () => {
    if (items.length === 0) {
      void dialog.alert('无法保存', '当前识别结果没有可保存的食物明细', 'warning')
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
        entryType: 'food_image',
      })

      payload.items = payload.items.map((payloadItem, index) => {
        const editable = items[index]
        if (!editable) return payloadItem
        const weight = editableWeight(editable)
        const ratio = clampRatio(editable.ratio)
        const nutrients = scaledNutrients(editable.baseNutrients, weight, editable.baseWeight)
        return {
          ...payloadItem,
          name: editable.name.trim() || payloadItem.name,
          weight,
          ratio,
          intake: Math.round(weight * ratio / 100),
          nutrients,
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

  const updateItem = (index: number, patch: Partial<EditableResultItem>) => {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )))
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

  return (
    <Page title="识别结果" subtitle={`${date} · ${getMealTypeLabel(mealType)}`}>
      <Card>
        {imageSource ? <Image source={{ uri: imageSource }} style={styles.preview} /> : null}
        <Text style={styles.eyebrow}>识别描述</Text>
        <Text style={styles.description}>{String(task.result?.description || '食物分析已完成')}</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>营养汇总</Text>
        <View style={styles.statGrid}>
          <Stat label="热量" value={`${Math.round(totals.calories)} kcal`} />
          <Stat label="实际摄入" value={`${Math.round(totals.weight)}g`} />
        </View>
        <View style={styles.statGrid}>
          <Stat label="蛋白质" value={`${round1(totals.protein)}g`} />
          <Stat label="碳水" value={`${round1(totals.carbs)}g`} />
          <Stat label="脂肪" value={`${round1(totals.fat)}g`} />
        </View>

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
      </Card>

      {items.length === 0 ? (
        <Card>
          <Text style={styles.empty}>当前没有识别到可记录的食物</Text>
        </Card>
      ) : null}

      {items.map((item, index) => {
        const weight = editableWeight(item)
        const ratio = clampRatio(item.ratio)
        const nutrients = scaledNutrients(item.baseNutrients, weight, item.baseWeight)
        const actualWeight = weight * ratio / 100
        const itemCalories = numberFrom(nutrients.calories) * ratio / 100
        const showSuggestedRatio = item.suggestedRatioSource === 'ai' && typeof item.suggestedRatio === 'number'
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
                    <Text style={styles.suggestionActionText}>应用建议</Text>
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

            <View style={styles.macroGrid}>
              <MiniStat label="蛋白质" value={`${round1(numberFrom(nutrients.protein) * ratio / 100)}g`} />
              <MiniStat label="碳水" value={`${round1(numberFrom(nutrients.carbs) * ratio / 100)}g`} />
              <MiniStat label="脂肪" value={`${round1(numberFrom(nutrients.fat) * ratio / 100)}g`} />
            </View>
          </Card>
        )
      })}

      <Card>
        <Text style={styles.sectionTitle}>饮食建议</Text>
        <AdviceLine title="建议" value={task.result?.insight} />
        <AdviceLine title="搭配" value={task.result?.pfc_ratio_comment} />
        <AdviceLine title="吸收" value={task.result?.absorption_notes} />
        <AdviceLine title="上下文" value={task.result?.context_advice} />
      </Card>

      <Card>
        <AppButton label="保存到当天饮食" loading={saving} onPress={saveRecord} />
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
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
  return foodItems.map((item) => {
    const baseWeight = foodWeight(item)
    return {
      name: item.name || '未命名食物',
      weightText: formatInputNumber(baseWeight),
      ratio: 100,
      baseWeight,
      baseNutrients: normalizeNutrients(item.nutrients),
      suggestedRatio: suggestedRatioFor(item),
      suggestedRatioReason: stringOrUndefined(item.suggestedRatioReason ?? item.suggested_ratio_reason),
      suggestedRatioSource: stringOrUndefined(item.suggestedRatioSource ?? item.suggested_ratio_source),
    }
  })
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

function foodWeight(item: FoodItem): number {
  return numberFrom(item.estimatedWeightGrams || item.originalWeightGrams)
}

function suggestedRatioFor(item: FoodItem): number | undefined {
  const ratio = Number(item.suggestedRatio ?? item.suggested_ratio)
  if (!Number.isFinite(ratio)) return undefined
  return clampRatio(ratio)
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

function stringOrUndefined(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function firstImage(images: string[] | null | undefined): string | undefined {
  return Array.isArray(images) ? images.find((image) => Boolean(stringOrUndefined(image))) : undefined
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    height: 230,
    borderRadius: 18,
    marginBottom: 16,
    backgroundColor: colors.surfaceMuted,
  },
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
  description: {
    color: colors.text,
    lineHeight: 22,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 6,
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
  peopleHeader: {
    marginTop: 6,
    marginBottom: 10,
  },
  peopleTitle: {
    color: colors.text,
    fontWeight: '900',
  },
  peopleHint: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
  },
  peopleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  peopleChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  peopleChipText: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  customPeopleRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  customPeopleInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.text,
    fontWeight: '700',
    backgroundColor: colors.surface,
  },
  applyPeopleButton: {
    minWidth: 76,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  applyPeopleText: {
    color: '#fff',
    fontWeight: '900',
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
  suggestionBox: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: colors.brandSoft,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionBadge: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  suggestionReason: {
    marginTop: 4,
    color: colors.textSecondary,
    lineHeight: 18,
    fontSize: 12,
  },
  suggestionAction: {
    minHeight: 34,
    borderRadius: 10,
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
  macroGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  miniStat: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
  },
  miniStatValue: {
    color: colors.text,
    fontWeight: '900',
  },
  miniStatLabel: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
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
