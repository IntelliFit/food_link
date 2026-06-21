import { View, Text, Image } from '@tarojs/components'
import './index.scss'

export interface FoodCardProps {
  imageUrl?: string
  title: string
  description?: string
  calories?: number
  badge?: string
  badgeType?: string
  onClick?: () => void
  className?: string
}

export function FoodCard({
  imageUrl,
  title,
  description,
  calories,
  badge,
  badgeType,
  onClick,
  className = ''
}: FoodCardProps) {
  const hasImage = Boolean(imageUrl?.trim())
  const badgeClass = badgeType
    ? `fl-food-card-badge source-${badgeType}`
    : 'fl-food-card-badge'

  return (
    <View
      className={`fl-food-card ${className}`}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      <View className='fl-food-card-main'>
        <View className={`fl-food-card-image-wrap ${hasImage ? '' : 'is-placeholder'}`}>
          {hasImage && imageUrl ? (
            <Image
              className='fl-food-card-image'
              src={imageUrl}
              mode='aspectFill'
            />
          ) : (
            <Text className='iconfont icon-shiwu fl-food-card-placeholder-icon' />
          )}
        </View>
        <View className='fl-food-card-info'>
          <View className='fl-food-card-title-row'>
            <Text className='fl-food-card-title'>
              {title || '食物'}
            </Text>
            {badge ? (
              <View className={badgeClass}>
                <Text className='fl-food-card-badge-text'>{badge}</Text>
              </View>
            ) : null}
          </View>
          {description ? (
            <Text className='fl-food-card-desc'>
              {description}
            </Text>
          ) : null}
          <Text className='fl-food-card-calories'>
            {Math.round(Number(calories || 0))} kcal
          </Text>
        </View>
      </View>
    </View>
  )
}
