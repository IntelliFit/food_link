import { Image, Text, View } from '@tarojs/components'
import type { ManualFoodSearchResult } from '../../../utils/api'
import { hasFoodDisplayImage, pickFoodDisplayImageUrl } from '../../../utils/food-display-image'
import { manualFoodResultPortionText } from '../../../utils/manual-food-serving'
import { manualFoodSourceName } from './manual-food-detail'
import { scaleFoodMeasurementNutrients } from '../../../utils/food-measure'

interface ManualFoodCardProps {
  item: ManualFoodSearchResult
  selectedAmount?: string
  portionText?: string
  onView: () => void
  onAdd: () => void
  onManage: () => void
}

export function ManualFoodCard({ item, selectedAmount, portionText, onView, onAdd, onManage }: ManualFoodCardProps) {
  const calories = item.measurement ? scaleFoodMeasurementNutrients(item.measurement)?.calories ?? item.total_calories : item.total_calories
  return (
    <View className='food-item' onClick={onView} aria-label={`查看${item.title}详情`}>
      <View className='food-cover'>
        {hasFoodDisplayImage(item) ? (
          <Image className='food-cover-image' src={pickFoodDisplayImageUrl(item)} mode='aspectFill' />
        ) : (
          <View className='food-cover-placeholder'><Text className='iconfont icon-shiwu' /></View>
        )}
      </View>
      <View className='food-info'>
        <View className='food-name-row'>
          <Text className='food-name'>{item.title}</Text>
          <View className={`source-badge ${item.source}`}><Text>{manualFoodSourceName(item)}</Text></View>
          <Text className='food-detail-chevron'>›</Text>
        </View>
        <Text className='food-sub'>
          {Math.round(calories)} kcal / {portionText || manualFoodResultPortionText(item)}
          {item.subtitle ? ` · ${item.subtitle}` : ''}
        </Text>
        {!!(item.nutrition_highlights?.length || item.recommend_reason) && (
          <Text className='food-hint'>{item.nutrition_highlights?.length ? item.nutrition_highlights.join(' · ') : item.recommend_reason}</Text>
        )}
      </View>
      {item.source === 'custom' && item.can_edit !== false && (
        <View className='custom-item-manage' onClick={(event) => { event.stopPropagation(); onManage() }}>
          <Text>编辑</Text>
        </View>
      )}
      <View className={`add-btn ${selectedAmount ? 'active' : ''}`} aria-label={`添加${item.title}到本餐`} onClick={(event) => { event.stopPropagation(); onAdd() }}>
        <Text>{selectedAmount || '+'}</Text>
      </View>
    </View>
  )
}
