import { Text, View } from '@tarojs/components'
import type { EvidenceGapView } from '../../utils/nutrition-state-view'

/** 「这些还看不准」：缺什么数据、补哪一项 */
export function EvidenceGapsCard({ gaps, onAction }: {
  gaps: EvidenceGapView[]
  onAction: (gap: EvidenceGapView) => void
}) {
  return (
    <View className='stats-card stats-ns-evidence'>
      <View className='stats-ns-card-head'>
        <Text className='stats-ns-card-head__title'>这些还看不准</Text>
        <Text className='stats-ns-card-head__sub'>补上之后，分数和推荐都会更准</Text>
      </View>
      {gaps.map(gap => (
        <View key={gap.key || gap.text} className='stats-ns-evidence__row'>
          <View className='stats-ns-evidence__copy'>
            <Text className='stats-ns-evidence__text'>{gap.text}</Text>
            {gap.hint ? <Text className='stats-ns-evidence__hint'>{gap.hint}</Text> : null}
          </View>
          {gap.buttonText ? (
            <View className='stats-ns-btn stats-ns-btn--compact' aria-role='button' onClick={() => onAction(gap)}>
              <Text>{gap.buttonText}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  )
}
