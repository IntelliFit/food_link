import { View, Text } from '@tarojs/components'
import { formatDisplayNumber, formatNumberWithComma } from '../utils/helpers'

export interface CalorieCardProps {
  intakeData: { target: number; current: number }
  isSwitchingDate: boolean
  animatedRemainingCalories: number
  calorieProgress: number
  onOpenTargetEditor: () => void
}

function clampVisualProgress(progress: number): number {
  return Math.min(100, Math.max(0, progress))
}

export function CalorieCard({
  intakeData,
  isSwitchingDate,
  animatedRemainingCalories,
  calorieProgress,
  onOpenTargetEditor
}: CalorieCardProps) {
  return (
    <View className='main-card'>
      <View className='main-card-header'>
        <View className='main-card-title'>
          <Text className='card-label'>剩余可摄入</Text>
          {isSwitchingDate ? (
            <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', marginTop: '8rpx' }}>
              <Text className='card-value' style={{ fontSize: '36rpx', color: '#9ca3af' }}>--</Text>
              <View className='loading-spinner' style={{ width: '24rpx', height: '24rpx', borderWidth: '3rpx' }} />
            </View>
          ) : (
            <Text className='card-value'>{formatNumberWithComma(Math.round(animatedRemainingCalories))}</Text>
          )}
          {!isSwitchingDate && <Text className='card-unit'>kcal</Text>}
        </View>
        <View className='target-section'>
          <Text className='target-text'>目标: {formatDisplayNumber(intakeData.target)}</Text>
          <View className='target-edit-btn' onClick={onOpenTargetEditor}>
            <Text className='target-edit-text'>编辑目标</Text>
          </View>
        </View>
      </View>
      
      <View className='progress-section'>
        <View className='progress-bar-bg thick'>
          <View
            className='progress-bar-fill thick'
            style={{ width: `${clampVisualProgress(calorieProgress)}%` }}
          />
        </View>
      </View>
    </View>
  )
}
