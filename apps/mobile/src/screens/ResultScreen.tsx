import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  buildSaveFoodRecordRequestFromTask,
  getMealTypeLabel,
  type FoodItem,
  type Nutrients,
} from '@food-link/core'
import { apiClient } from '../api'
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
  const insets = useSafeAreaInsets()
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
  const mealLabel = getMealTypeLabel(mealType)
  const heroHeight = imageSource ? 292 : 246
  const macroMax = Math.max(totals.protein, totals.carbs, totals.fat, 1)
  const resultDescription = String(task.result?.description || '食物分析已完成')

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
          { paddingTop: heroHeight + insets.top - 28, paddingBottom: 140 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentContainer}>
          <View style={styles.executionModeRow}>
            <View style={styles.executionModeLeft}>
              <Text style={styles.executionModeTag}>AI识别</Text>
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

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>食材明细</Text>
            <Text style={styles.sectionCount}>{items.length} 项</Text>
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
                    <Text style={styles.kcal}>{Math.round(itemCalories)} kcal</Text>
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
        </View>
      </ScrollView>

      <View style={[styles.footerActions, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.actionGrid}>
          <Pressable style={styles.secondaryBtn} onPress={() => navigation.navigate('AnalyzeHistory')}>
            <Text style={styles.secondaryBtnText}>识别历史</Text>
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
  footerActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
