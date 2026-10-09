import { View, Text } from '@tarojs/components'
import type { CommunityFeedRecord } from '../../../utils/api'
import { formatSupplementDose } from '../../../utils/supplements'
import './SupplementFeedCard.scss'

export function SupplementFeedCard({ record, showAll = false }: { record: CommunityFeedRecord; showAll?: boolean }) {
  const components = record.supplement_components || []
  const visible = showAll ? components : components.slice(0, 3)
  return (
    <View className='supplement-feed-card'>
      <View className='supplement-feed-card__head'>
        <Text className='iconfont icon-yiliaohangyedeICON- supplement-feed-card__icon' />
        <Text className='supplement-feed-card__name'>{record.supplement_name || '补剂'}</Text>
      </View>
      <Text className='supplement-feed-card__dose'>本次服用 · {formatSupplementDose(Number(record.servings), record.serving_label || '1份')}</Text>
      {visible.length > 0 && (
        <View className='supplement-feed-card__components'>
          {visible.map((component, index) => {
            const amount = Number(component.amount) * Number(record.servings || 1)
            return (
              <View key={`${component.code}-${index}`} className='supplement-feed-card__component'>
                <Text>{component.name}</Text>
                <Text>{amount > 0 && Number.isFinite(amount) ? `${Number(amount.toFixed(3))} ${component.unit}` : '含量未标注'}</Text>
              </View>
            )
          })}
          {!showAll && components.length > visible.length && <Text className='supplement-feed-card__more'>另有 {components.length - visible.length} 项成分 · 查看详情</Text>}
        </View>
      )}
    </View>
  )
}
