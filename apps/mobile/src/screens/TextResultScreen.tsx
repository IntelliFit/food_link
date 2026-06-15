import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  buildSaveFoodRecordRequestFromTask,
  getMealTypeLabel,
  type AnalysisTask,
  type FoodItem,
} from '@food-link/core'
import { apiClient } from '../api'
import { AppButton } from '../components/AppButton'
import { Card } from '../components/Card'
import { Page } from '../components/Page'
import type { RootStackParamList } from '../navigation/types'
import { colors } from '../theme'

type TextResultRoute = RouteProp<RootStackParamList, 'TextResult'>

const ratioOptions = [25, 50, 75, 100]

export function TextResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<TextResultRoute>()
  const { task, mealType, date } = route.params
  const foodItems = task.result?.items || []
  const [ratios, setRatios] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRatios(foodItems.map(() => 100))
  }, [task.id, foodItems.length])

  const totals = useMemo(() => calculateTotals(foodItems, ratios), [foodItems, ratios])

  const saveRecord = async () => {
    if (foodItems.length === 0) {
      Alert.alert('无法保存', '当前文字分析没有可保存的食物明细')
      return
    }
    setSaving(true)
    try {
      const payload = buildSaveFoodRecordRequestFromTask(task, {
        mealType,
        date,
        entryType: 'food_text',
      })
      payload.items = payload.items.map((item, index) => {
        const ratio = clampRatio(ratios[index] ?? 100)
        return {
          ...item,
          ratio,
          intake: Math.round(Number(item.weight || 0) * ratio / 100),
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
      Alert.alert('保存成功', saved.already_saved ? '这条记录之前已经保存。' : '已记录到当天饮食。')
      navigation.dispatch(CommonActions.navigate({ name: 'MainTabs' }))
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const updateRatio = (index: number, ratio: number) => {
    setRatios((current) => {
      const next = [...current]
      next[index] = clampRatio(ratio)
      return next
    })
  }

  return (
    <Page title="文字识别结果" subtitle={`${date} · ${getMealTypeLabel(mealType)}`}>
      <Card>
        <Text style={styles.eyebrow}>原始描述</Text>
        <Text style={styles.description}>{task.text_input || task.result?.description || '文字饮食分析已完成'}</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>营养汇总</Text>
        <View style={styles.statGrid}>
          <Stat label="热量" value={`${Math.round(totals.calories)} kcal`} />
          <Stat label="重量" value={`${Math.round(totals.weight)}g`} />
        </View>
        <View style={styles.statGrid}>
          <Stat label="蛋白质" value={`${round1(totals.protein)}g`} />
          <Stat label="碳水" value={`${round1(totals.carbs)}g`} />
          <Stat label="脂肪" value={`${round1(totals.fat)}g`} />
        </View>
      </Card>

      {foodItems.length === 0 ? (
        <Card>
          <Text style={styles.empty}>当前没有识别到可记录的食物</Text>
        </Card>
      ) : null}

      {foodItems.map((item, index) => {
        const ratio = ratios[index] ?? 100
        const nutrients = item.nutrients || {}
        return (
          <Card key={`${item.name}-${index}`}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.kcal}>{Math.round(numberFrom(nutrients.calories) * ratio / 100)} kcal</Text>
            </View>
            <Text style={styles.subtitle}>
              约 {Math.round(foodWeight(item))}g · 实际记录 {Math.round(foodWeight(item) * ratio / 100)}g
            </Text>
            <View style={styles.ratioRow}>
              {ratioOptions.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.ratioChip, ratio === option && styles.ratioChipActive]}
                  onPress={() => updateRatio(index, option)}
                >
                  <Text style={[styles.ratioText, ratio === option && styles.ratioTextActive]}>{option}%</Text>
                </Pressable>
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

function calculateTotals(items: FoodItem[], ratios: number[]) {
  return items.reduce(
    (acc, item, index) => {
      const ratio = clampRatio(ratios[index] ?? 100) / 100
      const nutrients = item.nutrients || {}
      acc.calories += numberFrom(nutrients.calories) * ratio
      acc.protein += numberFrom(nutrients.protein) * ratio
      acc.carbs += numberFrom(nutrients.carbs) * ratio
      acc.fat += numberFrom(nutrients.fat) * ratio
      acc.weight += foodWeight(item) * ratio
      return acc
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, weight: 0 },
  )
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

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString()
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
  description: {
    color: colors.text,
    lineHeight: 22,
  },
  subtitle: {
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 4,
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
  itemName: {
    flex: 1,
    color: colors.text,
    fontWeight: '900',
    fontSize: 17,
  },
  kcal: {
    color: colors.brandDark,
    fontWeight: '900',
  },
  ratioRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
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
