import { View, Text, ScrollView, Button, Slider } from '@tarojs/components'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import {
  updateFoodRecord, showUnifiedApiError, submitAnalysisFeedback,
  type FoodRecord, type Nutrients
} from '../../../utils/api'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { COMMUNITY_FEED_CHANGED_EVENT } from '../../../utils/home-events'
import {
  MealTypeField,
  normalizeSelectableMealType,
  type SelectableMealType
} from '../../../components/MealTypeSelector'
import { buildFoodRecordItemPayloadFromResultItem } from '../../../utils/food-record-item-payload'

import './MealRecordEditModal.scss'

type EditableNutrientField = 'calories' | 'protein' | 'carbs' | 'fat' | 'waterMl'

interface EditableFoodItem {
  name: string
  weight: number
  grossWeight: number
  ediblePortionRatio: number
  ediblePortionReason?: string
  ediblePortionSource?: string
  ratio: number
  intake: number
  waterMl: number
  suggestedRatio?: number
  suggestedRatioReason?: string
  suggestedRatioSource?: string
  nutritionSource?: string | null
  nutritionSourceCategory?: string | null
  matchedFoodId?: string | null
  packagedFoodId?: string
  packageMatchStatus?: string
  packageMatchConfidence?: number
  packageWeightSource?: string
  packageWeightApplied?: boolean
  packageWeightReason?: string
  packagedCandidates?: Array<Record<string, unknown>>
  nutrients: Nutrients
  nutrientDetailsExpanded?: boolean
}

const EDITABLE_NUTRIENT_META: Record<EditableNutrientField, { label: string; unit: string }> = {
  calories: { label: '热量', unit: 'kcal' },
  protein: { label: '蛋白质', unit: 'g' },
  carbs: { label: '碳水', unit: 'g' },
  fat: { label: '脂肪', unit: 'g' },
  waterMl: { label: '含水量', unit: 'ml' }
}

const NUTRIENT_FIELD_CLASS: Record<EditableNutrientField, string> = {
  calories: 'cal',
  protein: 'protein',
  carbs: 'carbs',
  fat: 'fat',
  waterMl: 'water'
}

type NutrientDetailKey = keyof Pick<Nutrients,
  'fiber' | 'sugar' | 'saturatedFat' | 'cholesterolMg' | 'sodiumMg' | 'potassiumMg' |
  'calciumMg' | 'ironMg' | 'magnesiumMg' | 'zincMg' | 'vitaminARaeMcg' | 'vitaminCMg' |
  'vitaminDMcg' | 'vitaminEMg' | 'vitaminKMcg' | 'thiaminMg' | 'riboflavinMg' |
  'niacinMg' | 'vitaminB6Mg' | 'folateMcg' | 'vitaminB12Mcg'
>

const NUTRIENT_DETAIL_META: Array<{ key: NutrientDetailKey; label: string; unit: string }> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { key: 'sodiumMg', label: '钠', unit: 'mg' },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' }
]

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const normalizeDisplayNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  const rounded = roundToSingleDecimal(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const normalizeNutrientValue = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

const formatNutrientDetailValue = (value: number) => {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

const getItemRatioFactor = (item: Pick<EditableFoodItem, 'ratio'>) => Math.max(0, item.ratio ?? 0) / 100

const getDisplayedNutrientValue = (item: EditableFoodItem, field: EditableNutrientField) => {
  if (field === 'waterMl') {
    return roundToSingleDecimal(item.waterMl * getItemRatioFactor(item))
  }
  return roundToSingleDecimal((item.nutrients?.[field] ?? 0) * getItemRatioFactor(item))
}

const getNutrientDetailRows = (item: EditableFoodItem) => {
  const ratio = item.ratio / 100
  return NUTRIENT_DETAIL_META
    .map((meta) => ({
      ...meta,
      value: normalizeNutrientValue(item.nutrients[meta.key]) * ratio
    }))
    .filter((row) => row.value > 0)
}

const hasVisibleMacroData = (nutrients?: Nutrients | null) => (
  Boolean(
    nutrients &&
    (
      Number(nutrients.calories) > 0 ||
      Number(nutrients.protein) > 0 ||
      Number(nutrients.carbs) > 0 ||
      Number(nutrients.fat) > 0 ||
      Number(nutrients.waterMl ?? nutrients.water_ml) > 0
    )
  )
)

const resolveRecordItemRatio = (item: Pick<FoodRecord['items'][0], 'ratio' | 'intake' | 'weight'>): number => {
  const ratio = Number(item.ratio)
  if (Number.isFinite(ratio) && ratio > 0) return Math.min(100, ratio)
  const intake = Number(item.intake)
  const weight = Number(item.weight)
  if (Number.isFinite(intake) && Number.isFinite(weight) && intake >= 0 && weight > 0) {
    return Math.min(100, Math.round((intake / weight) * 1000) / 10)
  }
  return 100
}

const resolveRecordItemIntake = (item: Pick<FoodRecord['items'][0], 'ratio' | 'intake' | 'weight'>): number => {
  const intake = Number(item.intake)
  if (Number.isFinite(intake) && intake > 0) return intake
  const weight = Number(item.weight)
  if (!Number.isFinite(weight) || weight <= 0) return 0
  return Math.round((weight * resolveRecordItemRatio(item) / 100) * 10) / 10
}

function resolveEditableItemNutrients(
  item: FoodRecord['items'][0],
  record: FoodRecord,
  ratio: number
): Nutrients {
  const raw = { ...(item.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }) }
  if (hasVisibleMacroData(raw)) return raw
  if ((record.items || []).length !== 1) return raw

  const ratioFactor = Math.max(0.01, ratio / 100)
  return {
    ...raw,
    calories: roundToSingleDecimal((record.total_calories || 0) / ratioFactor),
    protein: roundToSingleDecimal((record.total_protein || 0) / ratioFactor),
    carbs: roundToSingleDecimal((record.total_carbs || 0) / ratioFactor),
    fat: roundToSingleDecimal((record.total_fat || 0) / ratioFactor)
  }
}

const formatWeightDisplay = (value: number) => `${Math.max(0, Math.round(value))}g`

const scaleNutrients = (nutrients: Nutrients, scale: number): Nutrients => {
  const next: Nutrients = { ...nutrients }
  ;(Object.keys(next) as Array<keyof Nutrients>).forEach((key) => {
    const value = Number(next[key])
    if (Number.isFinite(value)) {
      next[key] = roundToSingleDecimal(value * scale) as never
    }
  })
  return next
}

interface MealRecordEditModalProps {
  visible: boolean
  record: FoodRecord | null
  onClose: () => void
  onSuccess: () => void
}

export function MealRecordEditModal({ visible, record, onClose, onSuccess }: MealRecordEditModalProps) {
  const { scheme } = useAppColorScheme()
  const [editItems, setEditItems] = useState<EditableFoodItem[]>([])
  const originalItemsRef = useRef<EditableFoodItem[]>([])
  const originalMealTypeRef = useRef<SelectableMealType>('afternoon_snack')
  const submittedFeedbackRef = useRef<Set<string>>(new Set())
  const devFeedbackLogRef = useRef<{ type: string; state: string; at: number; ok: boolean; disabled?: boolean; err?: string } | null>(null)
  const [devFeedbackIndicator, setDevFeedbackIndicator] = useState(false)
  const [editMealType, setEditMealType] = useState<SelectableMealType>('afternoon_snack')
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    if (visible && record) {
      const mt = normalizeSelectableMealType(record.meal_type)
      setEditMealType(mt)
      originalMealTypeRef.current = mt
      const items = (record.items || []).map(item => {
        const ratio = resolveRecordItemRatio(item)
        return {
          name: item.name,
          weight: item.weight,
          grossWeight: Number((item as any).gross_weight_grams ?? (item as any).grossWeightGrams ?? item.weight) || item.weight,
          ediblePortionRatio: Number((item as any).edible_portion_ratio ?? (item as any).ediblePortionRatio ?? 100) || 100,
          ediblePortionReason: (item as any).edible_portion_reason ?? (item as any).ediblePortionReason,
          ediblePortionSource: (item as any).edible_portion_source ?? (item as any).ediblePortionSource,
          suggestedRatio: (item as any).suggested_ratio ?? (item as any).suggestedRatio,
          suggestedRatioReason: (item as any).suggested_ratio_reason ?? (item as any).suggestedRatioReason,
          suggestedRatioSource: (item as any).suggested_ratio_source ?? (item as any).suggestedRatioSource,
          nutritionSource: (item as any).nutrition_source ?? (item as any).nutritionSource,
          nutritionSourceCategory: (item as any).nutrition_source_category ?? (item as any).nutritionSourceCategory,
          matchedFoodId: (item as any).matched_food_id ?? (item as any).matchedFoodId,
          packagedFoodId: (item as any).packaged_food_id ?? (item as any).packagedFoodId,
          packageMatchStatus: (item as any).package_match_status ?? (item as any).packageMatchStatus,
          packageMatchConfidence: (item as any).package_match_confidence ?? (item as any).packageMatchConfidence,
          packageWeightSource: (item as any).package_weight_source ?? (item as any).packageWeightSource,
          packageWeightApplied: (item as any).package_weight_applied ?? (item as any).packageWeightApplied,
          packageWeightReason: (item as any).package_weight_reason ?? (item as any).packageWeightReason,
          packagedCandidates: (item as any).packaged_candidates ?? (item as any).packagedCandidates,
          ratio,
          intake: resolveRecordItemIntake(item),
          waterMl: item.waterMl ?? item.water_ml ?? 0,
          nutrients: resolveEditableItemNutrients(item, record, ratio),
          nutrientDetailsExpanded: false
        }
      })
      setEditItems(items)
      originalItemsRef.current = JSON.parse(JSON.stringify(items))
    } else if (!visible) {
      // 自定义 tabBar 下不调用 showTabBar/hideTabBar，避免原生 tabBar 叠加
    }
    return () => {
      // 自定义 tabBar 下不调用 showTabBar/hideTabBar，避免原生 tabBar 叠加
    }
  }, [visible, record])

  const updateIntake = useCallback((index: number, newIntake: number) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = { ...next[index] }
      item.intake = Math.max(0, Math.min(item.weight, Math.round(newIntake * 10) / 10))
      if (item.weight > 0) {
        item.ratio = Math.round((item.intake / item.weight) * 100)
      }
      next[index] = item
      return next
    })
  }, [])

  const updateRatio = useCallback((index: number, newRatio: number) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = { ...next[index] }
      item.ratio = Math.max(0, Math.min(100, newRatio))
      item.intake = Math.round(item.weight * item.ratio / 100 * 10) / 10
      next[index] = item
      return next
    })
  }, [])

  const updateEditItemName = useCallback((index: number, nextName: string) => {
    setEditItems(prev => {
      const next = [...prev]
      if (!next[index]) return prev
      next[index] = { ...next[index], name: nextName }
      return next
    })
  }, [])

  const handleEditItemName = useCallback((index: number) => {
    const currentName = editItems[index]?.name || ''
    // @ts-ignore
    Taro.showModal({
      title: '修改食物名称',
      content: currentName,
      // @ts-ignore
      editable: true,
      placeholderText: '请输入新的食物名称',
      success: (res) => {
        if (!res.confirm) return
        const nextName = String((res as any).content ?? '').trim()
        if (!nextName) {
          Taro.showToast({ title: '名称不能为空', icon: 'none' })
          return
        }
        updateEditItemName(index, nextName)
      }
    })
  }, [editItems, updateEditItemName])

  const toggleNutrientDetails = useCallback((index: number) => {
    setEditItems(prev => {
      const next = [...prev]
      if (!next[index]) return prev
      next[index] = { ...next[index], nutrientDetailsExpanded: !next[index].nutrientDetailsExpanded }
      return next
    })
  }, [])

  const updateDisplayedNutrient = useCallback((index: number, field: EditableNutrientField, nextDisplayValue: number) => {
    setEditItems(prev => {
      const next = [...prev]
      const item = next[index]
      if (!item) return prev
      const ratioFactor = getItemRatioFactor(item)
      const normalizedDisplayValue = Math.max(0, roundToSingleDecimal(nextDisplayValue))
      const nextNutrientValue = ratioFactor > 0
        ? roundToSingleDecimal(normalizedDisplayValue / ratioFactor)
        : normalizedDisplayValue

      if (field === 'waterMl') {
        next[index] = { ...item, waterMl: nextNutrientValue }
      } else {
        next[index] = {
          ...item,
          nutrients: {
            ...item.nutrients,
            [field]: nextNutrientValue
          }
        }
      }
      return next
    })
  }, [])

  const handleEditNutrient = useCallback((index: number, field: EditableNutrientField) => {
    const item = editItems[index]
    if (!item) return
    const meta = EDITABLE_NUTRIENT_META[field]
    const currentValue = getDisplayedNutrientValue(item, field)
    // @ts-ignore
    Taro.showModal({
      title: `修改${meta.label}${meta.unit === 'g' ? '(g)' : `(${meta.unit})`}`,
      content: normalizeDisplayNumber(currentValue),
      // @ts-ignore
      editable: true,
      placeholderText: `请输入${meta.label}`,
      success: (res) => {
        if (!res.confirm) return
        const nextText = String((res as any).content ?? '').trim()
        const parsed = Number(nextText)
        if (!nextText || !Number.isFinite(parsed) || parsed < 0) {
          Taro.showToast({ title: '请输入不小于0的数字', icon: 'none' })
          return
        }
        updateDisplayedNutrient(index, field, parsed)
      }
    })
  }, [editItems, updateDisplayedNutrient])

  const adjustWeight = useCallback((index: number, delta: number) => {
    setEditItems(prev => {
      const item = prev[index]
      if (!item) return prev
      const next = [...prev]
      const updated = { ...next[index] }
      const nextWeight = Math.max(10, Math.round(((item.weight || 0) + delta) * 10) / 10)
      const scale = item.weight > 0 ? nextWeight / item.weight : 1
      const nextGrossWeight = Math.max(updated.grossWeight, nextWeight)
      updated.weight = nextWeight
      updated.grossWeight = nextGrossWeight
      updated.ediblePortionRatio = nextGrossWeight > 0
        ? Math.max(1, Math.min(100, Math.round((nextWeight / nextGrossWeight) * 100)))
        : updated.ediblePortionRatio
      updated.intake = Math.round(nextWeight * (updated.ratio / 100) * 10) / 10
      if (updated.intake > nextWeight) {
        updated.intake = nextWeight
        updated.ratio = 100
      }
      updated.waterMl = roundToSingleDecimal(item.waterMl * scale)
      updated.nutrients = scaleNutrients(item.nutrients, scale)
      next[index] = updated
      return next
    })
  }, [])

  const removeEditItem = useCallback(async (index: number) => {
    const { confirm } = await Taro.showModal({
      title: '删除确认',
      content: `确定删除「${editItems[index]?.name || '该食物'}」吗？`,
      confirmText: '删除',
      confirmColor: '#ef4444'
    })
    if (!confirm) return
    setEditItems(prev => prev.filter((_, i) => i !== index))
  }, [editItems])

  const hasAnyRealChange = (): boolean => {
    if (editMealType !== originalMealTypeRef.current) return true
    const orig = originalItemsRef.current
    if (orig.length !== editItems.length) return true
    return editItems.some((item, idx) => {
      const o = orig[idx]
      if (!o) return true
      const nameChanged = item.name !== o.name
      const weightChanged = Math.abs(item.weight - o.weight) > 0.05
      const caloriesChanged = Math.abs((item.nutrients?.calories ?? 0) - (o.nutrients?.calories ?? 0)) > 0.05
      const proteinChanged = Math.abs((item.nutrients?.protein ?? 0) - (o.nutrients?.protein ?? 0)) > 0.05
      const carbsChanged = Math.abs((item.nutrients?.carbs ?? 0) - (o.nutrients?.carbs ?? 0)) > 0.05
      const fatChanged = Math.abs((item.nutrients?.fat ?? 0) - (o.nutrients?.fat ?? 0)) > 0.05
      const waterChanged = Math.abs((item.waterMl ?? 0) - (o.waterMl ?? 0)) > 0.05
      const ratioChanged = Math.abs(item.ratio - o.ratio) > 0.05 || Math.abs(item.intake - o.intake) > 0.05
      return nameChanged || weightChanged || caloriesChanged || proteinChanged || carbsChanged || fatChanged || waterChanged || ratioChanged
    })
  }

  const isOnlyRatioChanged = (): boolean => {
    if (editMealType !== originalMealTypeRef.current) return false
    const orig = originalItemsRef.current
    if (orig.length !== editItems.length) return false
    return editItems.every((item, idx) => {
      const o = orig[idx]
      if (!o) return false
      const nameChanged = item.name !== o.name
      const weightChanged = Math.abs(item.weight - o.weight) > 0.05
      const caloriesChanged = Math.abs((item.nutrients?.calories ?? 0) - (o.nutrients?.calories ?? 0)) > 0.05
      const proteinChanged = Math.abs((item.nutrients?.protein ?? 0) - (o.nutrients?.protein ?? 0)) > 0.05
      const carbsChanged = Math.abs((item.nutrients?.carbs ?? 0) - (o.nutrients?.carbs ?? 0)) > 0.05
      const fatChanged = Math.abs((item.nutrients?.fat ?? 0) - (o.nutrients?.fat ?? 0)) > 0.05
      const waterChanged = Math.abs((item.waterMl ?? 0) - (o.waterMl ?? 0)) > 0.05
      const hasRealChange = nameChanged || weightChanged || caloriesChanged || proteinChanged || carbsChanged || fatChanged || waterChanged
      return !hasRealChange
    })
  }

  const submitFeedbackDeduped = async () => {
    if (!record) return
    const key = `record:${record.id}:record_corrected`
    if (submittedFeedbackRef.current.has(key)) return
    submittedFeedbackRef.current.add(key)
    try {
      const res = await submitAnalysisFeedback({
        feedback_type: 'record_corrected',
        resolution_state: 'still_distrust',
        source_record_id: record.id,
      })
      if (__ENABLE_DEV_DEBUG_UI__) {
        const disabled = res.message === 'feedback submission disabled'
        devFeedbackLogRef.current = { type: 'record_corrected', state: 'still_distrust', at: Date.now(), ok: true, disabled }
        setDevFeedbackIndicator(true)
        Taro.showToast({ title: disabled ? '[dev] feedback 已禁用: record_corrected' : '[dev] feedback: record_corrected', icon: 'none' })
      }
    } catch (e) {
      console.error('[Feedback]', e)
      if (__ENABLE_DEV_DEBUG_UI__) {
        devFeedbackLogRef.current = { type: 'record_corrected', state: 'still_distrust', at: Date.now(), ok: false, err: e instanceof Error ? e.message : String(e) }
        setDevFeedbackIndicator(true)
        Taro.showToast({ title: '[dev] feedback 失败: record_corrected', icon: 'none' })
      }
    }
  }

  const handleSaveEdit = async () => {
    if (editItems.length === 0) {
      Taro.showToast({ title: '至少保留一项食物', icon: 'none' })
      return
    }
    if (!record) return
    const { confirm } = await Taro.showModal({
      title: '确认修改',
      content: '确定保存对食物参数的修改吗？',
      confirmText: '确定',
      confirmColor: '#00bc7d'
    })
    if (!confirm) return
    const anyChange = hasAnyRealChange()
    const onlyRatio = isOnlyRatioChanged()
    if (anyChange && !onlyRatio) {
      void submitFeedbackDeduped()
    }
    setEditSaving(true)
    Taro.showLoading({ title: '保存中...', mask: true })
    try {
      const totalCalories = editItems.reduce((sum, item) => sum + (item.nutrients.calories * (item.ratio / 100)), 0)
      const totalProtein = editItems.reduce((sum, item) => sum + (item.nutrients.protein * (item.ratio / 100)), 0)
      const totalCarbs = editItems.reduce((sum, item) => sum + (item.nutrients.carbs * (item.ratio / 100)), 0)
      const totalFat = editItems.reduce((sum, item) => sum + (item.nutrients.fat * (item.ratio / 100)), 0)
      const totalWeight = editItems.reduce((sum, item) => sum + item.intake, 0)

      await updateFoodRecord(record.id, {
        meal_type: editMealType,
        items: editItems.map(item => buildFoodRecordItemPayloadFromResultItem(item, item.nutrients)),
        total_calories: Math.round(totalCalories * 10) / 10,
        total_protein: Math.round(totalProtein * 10) / 10,
        total_carbs: Math.round(totalCarbs * 10) / 10,
        total_fat: Math.round(totalFat * 10) / 10,
        total_weight_grams: Math.round(totalWeight)
      })
      Taro.hideLoading()
      setEditSaving(false)
      onClose()
      onSuccess()
      try {
        Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
      } catch {
        /* ignore */
      }
      Taro.showToast({ title: '修改成功', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      setEditSaving(false)
      await showUnifiedApiError(e, '保存失败')
    }
  }

  if (!visible) return null

  return (
    <View className={`edit-modal ${scheme === 'dark' ? 'edit-modal--dark' : ''}`} catchMove>
      <View className='edit-modal-mask' onClick={onClose} />
      <View className='edit-modal-content'>
        <View className='edit-modal-header'>
          <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx' }}>
            <Text className='edit-modal-title'>修改饮食数据</Text>
            {__ENABLE_DEV_DEBUG_UI__ && devFeedbackIndicator && (
              <View
                style={{
                  padding: '4rpx 12rpx',
                  borderRadius: '8rpx',
                  background: devFeedbackLogRef.current?.disabled ? '#fef3c7' : devFeedbackLogRef.current?.ok ? '#dcfce7' : '#fee2e2',
                  border: `1rpx solid ${devFeedbackLogRef.current?.disabled ? '#fcd34d' : devFeedbackLogRef.current?.ok ? '#86efac' : '#fca5a5'}`,
                }}
              >
                <Text style={{ fontSize: '20rpx', color: devFeedbackLogRef.current?.disabled ? '#d97706' : devFeedbackLogRef.current?.ok ? '#16a34a' : '#dc2626' }}>
                  {devFeedbackLogRef.current?.disabled ? 'feedback 已禁用' : devFeedbackLogRef.current?.ok ? 'feedback 已发送' : 'feedback 失败'}
                </Text>
              </View>
            )}
          </View>
          <View className='edit-modal-close' onClick={onClose} />
        </View>
        <ScrollView
          scrollY
          enhanced
          showScrollbar={false}
          className='edit-modal-body'
        >
          <MealTypeField value={editMealType} onChange={setEditMealType} />
          {editItems.map((item, idx) => {
            const detailRows = getNutrientDetailRows(item)
            const detailsExpanded = item.nutrientDetailsExpanded ?? false
            return (
              <View key={idx} className='edit-food-card ingredient-card'>
                {/* 头部：名称 + 编辑/删除 */}
                <View className='ingredient-main'>
                  <View className='ingredient-header ingredient-header--title-row'>
                    <Text className='ingredient-name'>{item.name}</Text>
                    <View className='ingredient-header-actions'>
                      <View className='edit-icon-wrapper' onClick={() => handleEditItemName(idx)}>
                        <Text className='iconfont icon-shouxieqianming' />
                      </View>
                      {editItems.length > 1 && (
                        <View className='delete-icon-wrapper' onClick={() => removeEditItem(idx)}>
                          <Text className='delete-icon'>×</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>

                {/* 营养摘要条 */}
                <View className='ingredient-nutrition-strip'>
                  <View className='ingredient-summary-cell ingredient-summary-cell--cal' onClick={() => handleEditNutrient(idx, 'calories')}>
                    <Text className='ingredient-summary-label'>热量</Text>
                    <View className='ingredient-cal-kcal-line'>
                      <Text className='ingredient-cal-kcal-num'>
                        {Math.round(item.nutrients.calories * (item.ratio / 100))}
                      </Text>
                      <Text className='ingredient-cal-kcal-unit'>kcal</Text>
                    </View>
                  </View>
                  {(['protein', 'carbs', 'fat', 'waterMl'] as const).map((field) => {
                    const meta = EDITABLE_NUTRIENT_META[field]
                    const classSuffix = NUTRIENT_FIELD_CLASS[field]
                    const displayValue = getDisplayedNutrientValue(item, field)
                    return (
                      <View
                        key={`${idx}-${field}`}
                        className={`ingredient-summary-cell ingredient-summary-cell--${classSuffix}`}
                        onClick={() => handleEditNutrient(idx, field)}
                      >
                        <Text className='ingredient-summary-label'>{meta.label}</Text>
                        <View className='ingredient-macro-value-line'>
                          <Text className={`ingredient-macro-num ingredient-macro-num--${classSuffix}`}>
                            {field === 'waterMl' ? String(Math.max(0, Math.round(displayValue))) : normalizeDisplayNumber(displayValue)}
                          </Text>
                          <Text className='ingredient-macro-g'>{meta.unit}</Text>
                        </View>
                      </View>
                    )
                  })}
                </View>

                {/* 展开更多营养 */}
                {detailRows.length > 0 && (
                  <View className='ingredient-more-section'>
                    <View className='ingredient-more-toggle' onClick={() => toggleNutrientDetails(idx)}>
                      <Text className='ingredient-more-toggle-text'>
                        {detailsExpanded ? '收起更多营养' : '展开更多营养'}
                      </Text>
                      <Text className={`iconfont icon-right ingredient-more-toggle-icon ${detailsExpanded ? 'expanded' : ''}`} />
                    </View>
                    {detailsExpanded && (
                      <View className='ingredient-detail-grid'>
                        {detailRows.map((row) => (
                          <View key={`${idx}-${row.key}`} className='ingredient-detail-cell'>
                            <Text className='ingredient-detail-label'>{row.label}</Text>
                            <Text className='ingredient-detail-value'>
                              {formatNutrientDetailValue(row.value)}
                              <Text className='ingredient-detail-unit'>{row.unit}</Text>
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* 估算重量 + 实际摄入 */}
                <View className='ingredient-controls'>
                  <View className='weight-control'>
                    <Text className='control-label'>估算重量</Text>
                    <View className='weight-adjuster'>
                      <View className='adjust-btn minus' onClick={() => adjustWeight(idx, -10)}>
                        <Text className='adjust-btn-text'>−</Text>
                      </View>
                      <Text className='weight-display'>{formatWeightDisplay(item.weight)}</Text>
                      <View className='adjust-btn plus' onClick={() => adjustWeight(idx, 10)}>
                        <Text className='adjust-btn-text'>+</Text>
                      </View>
                    </View>
                  </View>

                  <View className='ratio-control'>
                    <View className='ratio-label-wrap'>
                      <Text className='control-label'>实际摄入</Text>
                    </View>
                    <View className='ratio-control-right'>
                      <View className='ratio-slider-shell'>
                        <View className='ratio-slider-hitbox'>
                          <Slider
                            className='ratio-slider-modern'
                            value={Math.min(100, item.ratio)}
                            min={0}
                            max={100}
                            step={5}
                            activeColor={item.ratio > 100 ? '#f59e0b' : '#00bc7d'}
                            backgroundColor={scheme === 'dark' ? '#2d3935' : '#dbe4dd'}
                            blockSize={24}
                            blockColor='#ffffff'
                            showValue={false}
                            onChange={(e) => updateRatio(idx, e.detail.value)}
                          />
                        </View>
                      </View>
                      <Text className='ratio-display'>{item.ratio}%</Text>
                    </View>
                  </View>
                </View>
              </View>
            )
          })}
        </ScrollView>
        <View className='edit-modal-footer'>
          <Button className='edit-cancel-btn' onClick={onClose}>取消</Button>
          <Button className='edit-save-btn' onClick={handleSaveEdit} disabled={editSaving}>
            {editSaving ? <View className='btn-spinner' /> : '保存修改'}
          </Button>
        </View>
      </View>
    </View>
  )
}
