import { View, Text } from '@tarojs/components'
import { IconTrendingUp, IconChevronRight, IconWaterDrop } from '../../../components/iconfont'
import type { BodyMetricWaterDay } from '../../../utils/api'
import type { WeightSummary } from '../types'

function clampVisualProgress(progress: number): number {
  return Math.min(100, Math.max(0, progress))
}

export interface BodyStatusSectionProps {
  weightSummary: WeightSummary
  todayWater: BodyMetricWaterDay
  waterGoalMl: number
  waterProgress: number
  animatedWaterTotal: number
  animatedWaterProgress: number
  onOpenWeightEditor: () => void
  onOpenWaterEditor: () => void
}

export function BodyStatusSection({
  weightSummary,
  todayWater,
  waterGoalMl,
  waterProgress,
  animatedWaterTotal,
  animatedWaterProgress,
  onOpenWeightEditor,
  onOpenWaterEditor
}: BodyStatusSectionProps) {
  return (
    <View className='body-status-section'>
      {/* 体重卡片 */}
      <View className='body-status-card weight-card' onClick={onOpenWeightEditor}>
        <View className='body-status-header'>
          <View className='body-status-title-wrap'>
            <View className='body-status-icon'>
              <IconTrendingUp size={16} color='#9ca3af' />
            </View>
            <Text className='body-status-label'>体重</Text>
          </View>
          <IconChevronRight size={16} color='#9ca3af' />
        </View>
        <View className='body-status-content'>
          {weightSummary.latestWeight ? (
            <>
              <Text className='body-status-value'>{weightSummary.latestWeight.value.toFixed(1)}</Text>
              <Text className='body-status-unit'>kg</Text>
              {weightSummary.weightChange !== null && (
                <Text className={`body-status-change ${weightSummary.weightChange > 0 ? 'up' : 'down'}`}>
                  {weightSummary.weightChange > 0 ? '+' : ''}{weightSummary.weightChange.toFixed(1)}
                </Text>
              )}
            </>
          ) : (
            <Text className='body-status-empty'>点击记录</Text>
          )}
        </View>
        <Text className='body-status-hint'>
          {weightSummary.latestWeight 
            ? `上次记录: ${weightSummary.latestWeight.date.slice(5)}`
            : '记录体重，追踪变化'}
        </Text>
      </View>

      {/* 喝水卡片 */}
      <View className='body-status-card water-card' onClick={onOpenWaterEditor}>
        <View className='body-status-header'>
          <View className='body-status-title-wrap'>
            <View className='body-status-icon'>
              <IconWaterDrop size={16} color='#9ca3af' />
            </View>
            <Text className='body-status-label'>喝水</Text>
          </View>
          <IconChevronRight size={16} color='#9ca3af' />
        </View>
        <View className='body-status-content'>
          <Text className='body-status-value'>{Math.round(animatedWaterTotal)}</Text>
          <Text className='body-status-unit'>ml</Text>
        </View>
        <View className='body-status-progress-wrap'>
          <View className='body-status-progress-bg'>
            <View 
              className='body-status-progress-fill water'
              style={{ width: `${clampVisualProgress(animatedWaterProgress)}%` }}
            />
          </View>
          <Text className='body-status-progress-text'>
            {Math.round(animatedWaterProgress)}% / 目标 {waterGoalMl}ml
          </Text>
        </View>
      </View>
    </View>
  )
}
