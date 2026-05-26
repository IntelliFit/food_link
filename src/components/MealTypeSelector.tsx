import { Text, View } from '@tarojs/components'

import './MealTypeSelector.scss'

export type SelectableMealType =
  | 'breakfast'
  | 'morning_snack'
  | 'lunch'
  | 'afternoon_snack'
  | 'dinner'
  | 'evening_snack'

export const MEAL_TYPE_OPTIONS: Array<{
  value: SelectableMealType
  label: string
  iconClass: string
}> = [
  { value: 'breakfast', label: '早餐', iconClass: 'icon-zaocan' },
  { value: 'morning_snack', label: '早加餐', iconClass: 'icon-lingshi' },
  { value: 'lunch', label: '午餐', iconClass: 'icon-wucan' },
  { value: 'afternoon_snack', label: '午加餐', iconClass: 'icon-lingshi' },
  { value: 'dinner', label: '晚餐', iconClass: 'icon-wancan' },
  { value: 'evening_snack', label: '晚加餐', iconClass: 'icon-lingshi' },
]

export function normalizeSelectableMealType(value: unknown, fallback: SelectableMealType = 'afternoon_snack'): SelectableMealType {
  if (value === 'snack') return 'afternoon_snack'
  const hit = MEAL_TYPE_OPTIONS.find((option) => option.value === value)
  return hit?.value || fallback
}

export function getMealTypeLabel(value: unknown): string {
  const normalized = normalizeSelectableMealType(value)
  return MEAL_TYPE_OPTIONS.find((option) => option.value === normalized)?.label || '午加餐'
}

interface MealTypeGridProps {
  value: SelectableMealType
  onChange: (value: SelectableMealType) => void
  className?: string
}

export function MealTypeGrid({ value, onChange, className = '' }: MealTypeGridProps) {
  return (
    <View className={`meal-type-selector-grid ${className}`}>
      {MEAL_TYPE_OPTIONS.map((option) => (
        <View
          key={option.value}
          className={`meal-type-selector-option ${value === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          <Text className={`iconfont ${option.iconClass} meal-type-selector-icon`} />
          <Text className='meal-type-selector-label'>{option.label}</Text>
        </View>
      ))}
    </View>
  )
}

interface MealTypeFieldProps {
  value: SelectableMealType
  onChange: (value: SelectableMealType) => void
  title?: string
}

export function MealTypeField({ value, onChange, title = '餐次' }: MealTypeFieldProps) {
  return (
    <View className='meal-type-selector-field'>
      <View className='meal-type-selector-field-header'>
        <Text className='meal-type-selector-field-title'>{title}</Text>
        <Text className='meal-type-selector-field-value'>{getMealTypeLabel(value)}</Text>
      </View>
      <MealTypeGrid value={value} onChange={onChange} />
    </View>
  )
}

interface MealTypeSelectSheetProps {
  visible: boolean
  value: SelectableMealType
  title?: string
  confirmText?: string
  onChange: (value: SelectableMealType) => void
  onCancel: () => void
  onConfirm: () => void
}

export function MealTypeSelectSheet({
  visible,
  value,
  title = '选择餐次',
  confirmText = '保存',
  onChange,
  onCancel,
  onConfirm,
}: MealTypeSelectSheetProps) {
  return (
    <View
      className={`meal-type-selector-overlay ${visible ? 'visible' : ''}`}
      onClick={onCancel}
    >
      <View
        className='meal-type-selector-card'
        onClick={(e) => e.stopPropagation()}
      >
        <View className='meal-type-selector-title'>{title}</View>
        <MealTypeGrid value={value} onChange={onChange} />
        <View className='meal-type-selector-actions'>
          <View className='meal-type-selector-cancel' onClick={onCancel}>取消</View>
          <View className='meal-type-selector-confirm' onClick={onConfirm}>{confirmText}</View>
        </View>
      </View>
    </View>
  )
}

