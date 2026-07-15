import { View, Text, ScrollView } from '@tarojs/components'
import type { DietRecommendationResult, DietRecommendationScene } from '../../../utils/api'
import { formatDisplayNumber } from '../utils/helpers'

interface DietRecommendationSheetProps {
  visible: boolean
  scene: DietRecommendationScene
  loading: boolean
  result: DietRecommendationResult | null
  onClose: () => void
  onChangeScene: (scene: DietRecommendationScene) => void
  onRefresh: () => void
}

const SCENE_LABELS: Record<DietRecommendationScene, string> = {
  eat_out: '外面吃',
  cook_home: '自己做'
}

const SOURCE_LABELS: Record<string, string> = {
  public_food_library: '公共食物库',
  user_food_records: '历史记录',
  food_nutrition_library: '标准营养库',
  mixed: '组合候选',
  rule_fallback: '规则兜底',
  ai_generated: 'AI 补充'
}

function getSourceLabel(source?: string) {
  if (!source) return ''
  return SOURCE_LABELS[source] || source
}

export function DietRecommendationSheet({
  visible,
  scene,
  loading,
  result,
  onClose,
  onChangeScene,
  onRefresh
}: DietRecommendationSheetProps) {
  if (!visible) return null

  return (
    <View className='diet-rec-modal'>
      <View className='diet-rec-mask' catchMove onClick={onClose} />
      <View className='diet-rec-sheet'>
        <View className='diet-rec-handle' />
        <View className='diet-rec-header'>
          <View>
            <Text className='diet-rec-kicker'>按剩余目标推荐</Text>
            <Text className='diet-rec-title'>{result?.title || '今天吃什么'}</Text>
          </View>
          <View className='diet-rec-close' onClick={onClose}>
            <Text className='diet-rec-close-text'>×</Text>
          </View>
        </View>

        <View className='diet-rec-tabs'>
          {(['eat_out', 'cook_home'] as DietRecommendationScene[]).map((item) => (
            <View
              key={item}
              className={`diet-rec-tab ${scene === item ? 'active' : ''}`}
              onClick={() => onChangeScene(item)}
            >
              <Text className='diet-rec-tab-text'>{SCENE_LABELS[item]}</Text>
            </View>
          ))}
        </View>

        <ScrollView
          scrollY
          enhanced
          showScrollbar={false}
          className='diet-rec-body'
        >
          {loading ? (
            <View className='diet-rec-loading'>
              <View className='diet-rec-loading-orbit'>
                <View className='diet-rec-loading-ring ring-one' />
                <View className='diet-rec-loading-ring ring-two' />
                <View className='diet-rec-loading-core'>
                  <View className='diet-rec-loading-leaf leaf-left' />
                  <View className='diet-rec-loading-leaf leaf-right' />
                </View>
                <View className='diet-rec-loading-particle particle-one' />
                <View className='diet-rec-loading-particle particle-two' />
                <View className='diet-rec-loading-particle particle-three' />
              </View>

              <View className='diet-rec-loading-track'>
                <View className='diet-rec-loading-track-fill' />
              </View>

              <View className='diet-rec-loading-steps'>
                {[0, 1, 2].map((step) => (
                  <View key={step} className={`diet-rec-loading-step step-${step + 1}`}>
                    <View className='diet-rec-loading-step-dot' />
                  </View>
                ))}
              </View>

              <View className='diet-rec-loading-skeletons'>
                {[0, 1, 2].map((card) => (
                  <View key={card} className='diet-rec-loading-skeleton'>
                    <View className='diet-rec-loading-shimmer' />
                    <View className='diet-rec-loading-skeleton-head'>
                      <View className='diet-rec-loading-line line-title' />
                      <View className='diet-rec-loading-line line-calorie' />
                    </View>
                    <View className='diet-rec-loading-line line-reason' />
                    <View className='diet-rec-loading-pills'>
                      <View className='diet-rec-loading-pill' />
                      <View className='diet-rec-loading-pill' />
                      <View className='diet-rec-loading-pill' />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : result ? (
            <>
              <Text className='diet-rec-summary'>{result.summary}</Text>
              <Text className='diet-rec-source-note'>
                推荐优先从公共食物库、你的历史记录和标准营养库中选取；AI 仅负责按今日剩余目标组合。每个方案下方会标出实际来源。
              </Text>
              <View className='diet-rec-gap-row'>
                <View className='diet-rec-gap-pill'>
                  <Text className='diet-rec-gap-value'>{formatDisplayNumber(Math.max(0, Math.round(result.calorie_remaining || 0)))}</Text>
                  <Text className='diet-rec-gap-label'>kcal</Text>
                </View>
                <View className='diet-rec-gap-pill'>
                  <Text className='diet-rec-gap-value'>{formatDisplayNumber(Math.max(0, result.macro_gaps?.protein || 0))}</Text>
                  <Text className='diet-rec-gap-label'>蛋白</Text>
                </View>
                <View className='diet-rec-gap-pill'>
                  <Text className='diet-rec-gap-value'>{formatDisplayNumber(Math.max(0, result.macro_gaps?.carbs || 0))}</Text>
                  <Text className='diet-rec-gap-label'>碳水</Text>
                </View>
                <View className='diet-rec-gap-pill'>
                  <Text className='diet-rec-gap-value'>{formatDisplayNumber(Math.max(0, result.macro_gaps?.fat || 0))}</Text>
                  <Text className='diet-rec-gap-label'>脂肪</Text>
                </View>
              </View>

              <View className='diet-rec-list'>
                {(result.recommendations || []).map((option, index) => (
                  <View key={`${option.title}-${index}`} className='diet-rec-option'>
                    <View className='diet-rec-option-head'>
                      <Text className='diet-rec-option-title'>{option.title}</Text>
                      <Text className='diet-rec-option-cal'>{formatDisplayNumber(Math.round(option.calories || 0))} kcal</Text>
                    </View>
                    <Text className='diet-rec-option-reason'>{option.reason}</Text>
                    {!!getSourceLabel(option.source || option.items?.[0]?.source) && (
                      <Text className='diet-rec-option-source'>
                        来源：{getSourceLabel(option.source || option.items?.[0]?.source)}
                      </Text>
                    )}
                    <View className='diet-rec-foods'>
                      {(option.items || []).map((food, idx) => (
                        <View key={`${food.name}-${idx}`} className='diet-rec-food'>
                          <Text className='diet-rec-food-name'>{food.name}</Text>
                          <Text className='diet-rec-food-amount'>{food.amount}</Text>
                        </View>
                      ))}
                    </View>
                    <View className='diet-rec-macros'>
                      <Text className='diet-rec-macro'>蛋白 {formatDisplayNumber(option.protein || 0)}g</Text>
                      <Text className='diet-rec-macro'>碳水 {formatDisplayNumber(option.carbs || 0)}g</Text>
                      <Text className='diet-rec-macro'>脂肪 {formatDisplayNumber(option.fat || 0)}g</Text>
                    </View>
                    {option.tips && option.tips.length > 0 ? (
                      <Text className='diet-rec-tip'>{option.tips[0]}</Text>
                    ) : null}
                    {option.alternatives && option.alternatives.length > 0 ? (
                      <Text className='diet-rec-alt'>可替换：{option.alternatives.slice(0, 3).join(' / ')}</Text>
                    ) : null}
                  </View>
                ))}
              </View>

              <View className='diet-rec-actions'>
                <View className='diet-rec-refresh' onClick={onRefresh}>
                  <Text className='diet-rec-refresh-text'>换一组</Text>
                </View>
              </View>
            </>
          ) : (
            <View className='diet-rec-empty'>
              <Text className='diet-rec-empty-text'>暂时没有生成结果</Text>
              <View className='diet-rec-refresh' onClick={onRefresh}>
                <Text className='diet-rec-refresh-text'>重新生成</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  )
}
