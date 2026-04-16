import { View, Text, ScrollView, Button, Input, Slider } from '@tarojs/components'
import React, { useCallback, useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { updateFoodRecord, type FoodRecord, type Nutrients, type MealType, type DietGoal, type ActivityTiming } from '../../../utils/api'

import './MealRecordEditModal.scss'

type EditableNutrientField = 'calories' | 'protein' | 'carbs' | 'fat'

interface EditableFoodItem {
  name: string
  weight: number
  ratio: number
  intake: number
  nutrients: Nutrients
}

const EDITABLE_NUTRIENT_FIELDS: EditableNutrientField[] = ['calories', 'protein', 'carbs', 'fat']

const EDITABLE_NUTRIENT_META: Record<EditableNutrientField, { label: string; unit: string }> = {
  calories: { label: '热量', unit: 'kcal' },
  protein: { label: '蛋白质', unit: 'g' },
  carbs: { label: '碳水', unit: 'g' },
  fat: { label: '脂肪', unit: 'g' }
}

const MEAL_OPTIONS: Array<{ value: MealType; label: string; iconClass: string }> = [
  { value: 'breakfast', label: '早餐', iconClass: 'icon-zaocan1' },
  { value: 'morning_snack', label: '早加餐', iconClass: 'icon-lingshi' },
  { value: 'lunch', label: '午餐', iconClass: 'icon-wucan' },
  { value: 'afternoon_snack', label: '午加餐', iconClass: 'icon-lingshi' },
  { value: 'dinner', label: '晚餐', iconClass: 'icon-wancan' },
  { value: 'evening_snack', label: '晚加餐', iconClass: 'icon-lingshi' },
]

const DIET_GOAL_OPTIONS: Array<{ value: DietGoal; label: string; iconClass: string }> = [
  { value: 'fat_loss', label: '减脂期', iconClass: 'icon-huore' },
  { value: 'muscle_gain', label: '增肌期', iconClass: 'icon-zengji' },
  { value: 'maintain', label: '维持体重', iconClass: 'icon-tianpingzuo' },
  { value: 'none', label: '无', iconClass: 'icon-nothing' }
]

const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string; iconClass: string }> = [
  { value: 'post_workout', label: '练后', iconClass: 'icon-juzhong' },
  { value: 'daily', label: '日常', iconClass: 'icon-duoren' },
  { value: 'before_sleep', label: '睡前', iconClass: 'icon-shuijue' },
  { value: 'none', label: '无', iconClass: 'icon-nothing' }
]

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const normalizeDisplayNumber = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  const rounded = roundToSingleDecimal(value)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const getItemRatioFactor = (item: Pick<EditableFoodItem, 'ratio'>) => Math.max(0, item.ratio ?? 0) / 100

const getDisplayedNutrientValue = (item: EditableFoodItem, field: EditableNutrientField) => (
  roundToSingleDecimal((item.nutrients?.[field] ?? 0) * getItemRatioFactor(item))
)

interface MealRecordEditModalProps {
  visible: boolean
  record: FoodRecord | null
  onClose: () => void
  onSuccess: () => void
}

export function MealRecordEditModal({ visible, record, onClose, onSuccess }: MealRecordEditModalProps) {
  const [editItems, setEditItems] = useState<EditableFoodItem[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [mealType, setMealType] = useState<MealType>('breakfast')
  const [dietGoal, setDietGoal] = useState<DietGoal>('none')
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')

  useEffect(() => {
    if (visible && record) {
      setEditItems(
        (record.items || []).map(item => ({
          name: item.name,
          weight: item.weight,
          ratio: item.ratio ?? 100,
          intake: item.intake ?? 0,
          nutrients: { ...(item.nutrients || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }) }
        }))
      )
      setMealType((record.meal_type as MealType) || 'breakfast')
      setDietGoal((record.diet_goal as DietGoal) || 'none')
      setActivityTiming((record.activity_timing as ActivityTiming) || 'none')
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
      item.intake = Math.max(0, Math.round(newIntake * 10) / 10)
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

      next[index] = {
        ...item,
        nutrients: {
          ...item.nutrients,
          [field]: nextNutrientValue
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

  const adjustIntake = useCallback((index: number, delta: number) => {
    setEditItems(prev => {
      const item = prev[index]
      if (!item) return prev
      const next = [...prev]
      const updated = { ...next[index] }
      updated.intake = Math.max(0, Math.round(((item.intake || 0) + delta) * 10) / 10)
      if (updated.weight > 0) {
        updated.ratio = Math.round((updated.intake / updated.weight) * 100)
      }
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
    setEditSaving(true)
    Taro.showLoading({ title: '保存中...', mask: true })
    try {
      const totalCalories = editItems.reduce((sum, item) => sum + (item.nutrients.calories * (item.ratio / 100)), 0)
      const totalProtein = editItems.reduce((sum, item) => sum + (item.nutrients.protein * (item.ratio / 100)), 0)
      const totalCarbs = editItems.reduce((sum, item) => sum + (item.nutrients.carbs * (item.ratio / 100)), 0)
      const totalFat = editItems.reduce((sum, item) => sum + (item.nutrients.fat * (item.ratio / 100)), 0)
      const totalWeight = editItems.reduce((sum, item) => sum + item.intake, 0)

      await updateFoodRecord(record.id, {
        items: editItems,
        total_calories: Math.round(totalCalories * 10) / 10,
        total_protein: Math.round(totalProtein * 10) / 10,
        total_carbs: Math.round(totalCarbs * 10) / 10,
        total_fat: Math.round(totalFat * 10) / 10,
        total_weight_grams: Math.round(totalWeight),
        meal_type: mealType,
        diet_goal: dietGoal,
        activity_timing: activityTiming
      })
      Taro.hideLoading()
      setEditSaving(false)
      onClose()
      onSuccess()
      Taro.showToast({ title: '修改成功', icon: 'success' })
    } catch (e: any) {
      Taro.hideLoading()
      setEditSaving(false)
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    }
  }

  if (!visible) return null

  return (
    <View className='edit-modal' catchMove>
      <View className='edit-modal-mask' onClick={onClose} />
      <View className='edit-modal-content'>
        <View className='edit-modal-header'>
          <Text className='edit-modal-title'>修改食物参数</Text>
          <View className='edit-modal-close' onClick={onClose} />
        </View>
        <ScrollView scrollY enhanced showScrollbar={false} className='edit-modal-body'>
          {/* 餐次选择 */}
          <View className='edit-meta-card'>
            <Text className='edit-section-label'>餐次</Text>
            <View className='meal-options'>
              {MEAL_OPTIONS.map((opt) => (
                <View
                  key={opt.value}
                  className={`meal-option ${mealType === opt.value ? 'active' : ''}`}
                  onClick={() => setMealType(opt.value)}
                >
                  <Text className={`meal-icon iconfont ${opt.iconClass}`} />
                  <Text className='meal-label'>{opt.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 饮食目标 */}
          <View className='edit-meta-card'>
            <Text className='edit-section-label'>饮食目标</Text>
            <View className='state-options'>
              {DIET_GOAL_OPTIONS.map((opt) => (
                <View
                  key={opt.value}
                  className={`state-option ${dietGoal === opt.value ? 'active' : ''}`}
                  onClick={() => setDietGoal(opt.value)}
                >
                  <Text className={`state-icon iconfont ${opt.iconClass}`} />
                  <Text className='state-label'>{opt.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 运动时机 */}
          <View className='edit-meta-card'>
            <Text className='edit-section-label'>运动时机</Text>
            <View className='state-options'>
              {ACTIVITY_TIMING_OPTIONS.map((opt) => (
                <View
                  key={opt.value}
                  className={`state-option ${activityTiming === opt.value ? 'active' : ''}`}
                  onClick={() => setActivityTiming(opt.value)}
                >
                  <Text className={`state-icon iconfont ${opt.iconClass}`} />
                  <Text className='state-label'>{opt.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {editItems.map((item, idx) => {
            return (
              <View key={idx} className='edit-food-card'>
                <View className='edit-food-header'>
                  <View className='edit-food-title-wrap'>
                    <Text className='edit-food-name'>{item.name}</Text>
                    <View className='edit-food-name-btn' onClick={() => handleEditItemName(idx)}>
                      <Text className='iconfont icon-shouxieqianming'></Text>
                    </View>
                  </View>
                  {editItems.length > 1 && (
                    <View className='edit-food-delete' onClick={() => removeEditItem(idx)}>
                      <Text className='iconfont icon-shanchu'></Text>
                    </View>
                  )}
                </View>

                <View className='edit-intake-section'>
                  <Text className='edit-section-label'>摄入克数</Text>
                  <View className='intake-adjuster'>
                    <View className='adjust-btn minus' onClick={() => adjustIntake(idx, -10)}>
                      <Text className='adjust-btn-text'>−</Text>
                    </View>
                    <Input
                      className='intake-input'
                      type='digit'
                      value={String(item.intake)}
                      onBlur={(e) => updateIntake(idx, parseFloat(e.detail.value) || 0)}
                    />
                    <Text className='intake-unit'>g</Text>
                    <View className='adjust-btn plus' onClick={() => adjustIntake(idx, 10)}>
                      <Text className='adjust-btn-text'>+</Text>
                    </View>
                  </View>
                </View>

                <View className='edit-ratio-section'>
                  <View className='ratio-header'>
                    <Text className='edit-section-label'>摄入比例</Text>
                    <Text className={`ratio-value ${item.ratio > 100 ? 'over' : ''}`}>{item.ratio}%</Text>
                  </View>
                  <Slider
                    className='ratio-slider'
                    value={Math.min(100, item.ratio)}
                    min={0}
                    max={100}
                    step={5}
                    activeColor={item.ratio > 100 ? '#f59e0b' : '#00bc7d'}
                    blockSize={20}
                    onChange={(e) => updateRatio(idx, e.detail.value)}
                  />
                </View>

                <View className='edit-nutrients-header'>
                  <Text className='edit-section-label no-margin'>营养值</Text>
                  <Text className='edit-nutrients-tip'>点击任一项直接修改</Text>
                </View>

                <View className='edit-nutrients-grid'>
                  {EDITABLE_NUTRIENT_FIELDS.map((field) => {
                    const meta = EDITABLE_NUTRIENT_META[field]
                    const displayValue = getDisplayedNutrientValue(item, field)
                    return (
                      <View
                        key={`${idx}-${field}`}
                        className='nutrient-chip nutrient-chip-editable'
                        onClick={() => handleEditNutrient(idx, field)}
                      >
                        <Text className='nutrient-chip-label'>{meta.label}</Text>
                        <Text className='nutrient-chip-value'>
                          {normalizeDisplayNumber(displayValue)}
                          <Text className='nutrient-chip-unit'>{meta.unit}</Text>
                        </Text>
                      </View>
                    )
                  })}
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
