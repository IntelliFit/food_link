import { View } from '@tarojs/components'
import { FoodCard } from '../../../components/FoodCard'
import {
  extractManualFoodDisplayItems,
  manualItemHasDisplayImage,
  manualFoodSourceLabel,
  type ManualFoodSourceItem
} from '../../../utils/manual-food-source'
import './ManualFoodCards.scss'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '加餐'
}

function formatAggregatedTitle(mealType: string | undefined, count: number): string {
  const meal = MEAL_NAMES[mealType || ''] || mealType || '餐食'
  return `${meal} · 共 ${count} 种食物`
}

function formatAggregatedDescription(names: string[]): string {
  const joined = names.join('、')
  // 超过 36 个字符时截断并加省略号，避免卡片描述过长
  if (joined.length > 36) {
    return joined.slice(0, 36) + '…'
  }
  return joined
}

export interface ManualFoodCardsProps {
  items?: ManualFoodSourceItem[] | null
  mealType?: string
  onItemClick?: (row: ManualFoodSourceItem & { displayName: string; sourceLabel: string; imageUrl: string }) => void
}

export function ManualFoodCards({ items, mealType, onItemClick }: ManualFoodCardsProps) {
  const displayItems = extractManualFoodDisplayItems(items)
  if (displayItems.length === 0) return null

  // 单条食物保持原来的独立卡片展示
  if (displayItems.length === 1) {
    const row = displayItems[0]
    return (
      <View className='feed-manual-foods'>
        <FoodCard
          key='manual-0'
          imageUrl={manualItemHasDisplayImage(row) ? row.imageUrl : undefined}
          title={row.displayName}
          description={undefined}
          calories={row.nutrients?.calories}
          badge={row.sourceLabel}
          badgeType={row.manual_source || undefined}
          onClick={() => onItemClick?.(row)}
        />
      </View>
    )
  }

  // 一餐包含多条食物时，聚合成一张卡片展示
  const totalCalories = displayItems.reduce((sum, row) => sum + (row.nutrients?.calories || 0), 0)
  const firstImageUrl = displayItems.find((row) => manualItemHasDisplayImage(row))?.imageUrl
  const allSourceLabels = displayItems.map((row) => row.sourceLabel)
  const commonBadge = allSourceLabels.every((label) => label === allSourceLabels[0]) ? allSourceLabels[0] : undefined
  const commonSource = displayItems.every((row) => row.manual_source === displayItems[0].manual_source)
    ? displayItems[0].manual_source || undefined
    : undefined

  const aggregatedRow = {
    ...displayItems[0],
    displayName: formatAggregatedTitle(mealType, displayItems.length),
    sourceLabel: commonBadge || '',
    imageUrl: firstImageUrl || ''
  }

  return (
    <View className='feed-manual-foods'>
      <FoodCard
        imageUrl={firstImageUrl}
        title={aggregatedRow.displayName}
        description={formatAggregatedDescription(displayItems.map((row) => row.displayName))}
        calories={totalCalories}
        badge={commonBadge}
        badgeType={commonSource}
        onClick={() => onItemClick?.(aggregatedRow)}
      />
    </View>
  )
}
