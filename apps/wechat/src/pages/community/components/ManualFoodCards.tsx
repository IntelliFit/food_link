import { View, Text, Image } from '@tarojs/components'
import {
  extractManualFoodDisplayItems,
  manualItemHasDisplayImage,
  type ManualFoodSourceItem
} from '../../../utils/manual-food-source'
import './ManualFoodCards.scss'

export interface ManualFoodCardsProps {
  items?: ManualFoodSourceItem[] | null
  onItemClick?: (row: ManualFoodSourceItem & { displayName: string; sourceLabel: string; imageUrl: string }) => void
}

export function ManualFoodCards({ items, onItemClick }: ManualFoodCardsProps) {
  const displayItems = extractManualFoodDisplayItems(items)
  if (displayItems.length === 0) return null

  return (
    <View className='feed-manual-foods'>
      {displayItems.map((row, idx) => (
        <View
          key={`manual-${idx}`}
          className='feed-manual-food-row'
          onClick={(e) => {
            e.stopPropagation()
            onItemClick?.(row)
          }}
        >
          <View className={`feed-manual-food-thumb ${manualItemHasDisplayImage(row) ? 'has-image' : ''}`}>
            {manualItemHasDisplayImage(row) ? (
              <Image
                className='feed-manual-food-image'
                src={row.imageUrl}
                mode='aspectFill'
              />
            ) : (
              <Text className='iconfont icon-shiwu feed-manual-food-placeholder-icon' />
            )}
          </View>
          <View className='feed-manual-food-info'>
            <View className='feed-manual-food-title-row'>
              <Text className='feed-manual-food-name'>{row.displayName}</Text>
              {row.sourceLabel ? (
                <View className={`feed-manual-food-badge source-${row.manual_source || 'unknown'}`}>
                  <Text className='feed-manual-food-badge-text'>{row.sourceLabel}</Text>
                </View>
              ) : null}
            </View>
            <Text className='feed-manual-food-kcal'>
              {Math.round(Number(row.nutrients?.calories || 0))} kcal
            </Text>
          </View>
        </View>
      ))}
    </View>
  )
}
