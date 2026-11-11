import { Text, View } from '@tarojs/components'
import type { NutritionItem } from './result-item-converter'
import { resultMeasurementAmountText, resultMeasurementStep } from './result-measurement'

export function ResultQuantityControl({ item, onAdjust }: { item: NutritionItem; onAdjust: (delta: number) => void }) {
  const step = resultMeasurementStep(item)
  return (
    <View className='weight-control'>
      <Text className='control-label'>{item.measurement ? '整份数量' : '估算重量'}</Text>
      {!item.measurement && item.ediblePortionRatio > 0 && item.ediblePortionRatio < 99 && (
        <Text className='control-sub-label'>原始约 {Math.round(item.grossWeight)}g · 可食 {Math.round(item.ediblePortionRatio)}%</Text>
      )}
      <View className='weight-adjuster'>
        <View className='adjust-btn minus' aria-label={`减少${item.name}份量`} onClick={() => onAdjust(-step)}>–</View>
        <Text className='weight-display'>{resultMeasurementAmountText(item)}</Text>
        <View className='adjust-btn plus' aria-label={`增加${item.name}份量`} onClick={() => onAdjust(step)}>+</View>
      </View>
    </View>
  )
}
