import { View } from '@tarojs/components'
import { FoodCard } from '../../../components/FoodCard'
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
      {displayItems.map((row, index) => (
        <FoodCard
          key={`manual-${index}-${row.manual_source_id || row.displayName}`}
          className='feed-manual-food-card'
          imageUrl={manualItemHasDisplayImage(row) ? row.imageUrl : undefined}
          title={row.displayName}
          description={undefined}
          calories={row.nutrients?.calories}
          badge={row.sourceLabel}
          badgeType={row.manual_source || undefined}
          onClick={() => onItemClick?.(row)}
        />
      ))}
    </View>
  )
}
