import { View, Text } from '@tarojs/components'
import { formatDisplayNumber, formatNumberWithComma } from '../utils/helpers'
import { useAnimatedNumber } from '../hooks'

export interface CalorieCardProps {
  intakeData: { target: number; current: number }
  isSwitchingDate: boolean
  calorieProgress: number
  onOpenTargetEditor: () => void
}

function clampVisualProgress(progress: number): number {
  return Math.min(100, Math.max(0, progress))
}

export function CalorieCard({
  intakeData,
  isSwitchingDate,
  calorieProgress,
  onOpenTargetEditor
}: CalorieCardProps) {
  const isCalorieOver = intakeData.current > intakeData.target
  const remaining = Math.max(0, Number((intakeData.target - intakeData.current).toFixed(1)))
  const headlineBase = isCalorieOver
    ? Number((intakeData.current - intakeData.target).toFixed(1))
    : remaining
  const animatedHeadlineCalories = useAnimatedNumber(headlineBase, 600, 0)

  return (
    <View className='main-card'>
      <View className='main-card-header'>
        <View className='main-card-title'>
          <Text className='card-label'>
            {isSwitchingDate ? '剩余可摄入' : isCalorieOver ? '已超出' : '剩余可摄入'}
          </Text>
          {isSwitchingDate ? (
            <View style={{ display: 'flex', alignItems: 'center', gap: '12rpx', marginTop: '8rpx' }}>
              <Text className='card-value' style={{ fontSize: '36rpx', color: '#9ca3af' }}>--</Text>
              <View className='loading-spinner' style={{ width: '24rpx', height: '24rpx', borderWidth: '3rpx' }} />
            </View>
          ) : (
            <Text className={`card-value${isCalorieOver ? ' is-over' : ''}`}>
              {isCalorieOver
                ? formatDisplayNumber(Math.round(animatedHeadlineCalories))
                : formatNumberWithComma(Math.round(animatedHeadlineCalories))}
            </Text>
          )}
          {!isSwitchingDate && <Text className='card-unit'>kcal</Text>}
        </View>
        <View className='target-section'>
          {isSwitchingDate ? (
            <View className='target-energy-nums-only'>
              <Text className='target-energy-num-muted'>--</Text>
              <Text className='target-energy-slash-only'>/</Text>
              <Text className='target-energy-num-muted'>--</Text>
            </View>
          ) : (
            <View className='target-energy-nums-only'>
              <Text className={`target-energy-intake-num${isCalorieOver ? ' is-over' : ''}`}>
                {formatDisplayNumber(Math.round(intakeData.current))}
              </Text>
              <Text className='target-energy-slash-only'>/</Text>
              <Text className='target-energy-target-num'>
                {formatDisplayNumber(Math.round(intakeData.target))}
              </Text>
            </View>
          )}
          <View className='target-edit-btn' onClick={onOpenTargetEditor}>
            <Text className='target-edit-text'>编辑目标</Text>
          </View>
        </View>
      </View>
      
      <View className='progress-section'>
        <View className='progress-bar-bg thick'>
          <View
            className={`progress-bar-fill thick${isCalorieOver ? ' is-over' : ''}`}
            style={{ width: `${clampVisualProgress(calorieProgress)}%` }}
          />
        </View>
      </View>
    </View>
  )
}
