import { useState } from 'react'
import { View, Text, Input, Image } from '@tarojs/components'
import type { MealDishItem, MealDishPriceAsk } from '../../utils/meal-dish-api'
import { parsePriceInput } from './meal-dish-state'

/** 首页刚推荐过这道菜：一键确认，不是再走选食堂。 */
export function RecommendedStep({ dish, onConfirm, onReject }: { dish: MealDishItem; onConfirm: () => void; onReject: () => void }) {
  const place = [dish.canteen_name, dish.window_name, dish.price_text].filter(Boolean).join(' · ')
  return (
    <View>
      <View className='meal-dish-head'>
        <Text className='meal-dish-eyebrow'>首页刚推荐过</Text>
        <Text className='meal-dish-skip' onClick={onReject}>不是这道</Text>
      </View>
      <View className='meal-dish-photo-row'>
        {dish.has_real_photo && dish.image_url ? (
          <Image className='meal-dish-photo' src={dish.image_url} mode='aspectFill' />
        ) : (
          <View className='meal-dish-photo meal-dish-tile-image--empty'>
            <Text className='meal-dish-tile-initial'>{dish.name.slice(0, 1)}</Text>
          </View>
        )}
        <View className='meal-dish-photo-copy'>
          <Text className='meal-dish-title'>吃的是{dish.name}吗？</Text>
          {place ? <Text className='meal-dish-sub'>{place}</Text> : null}
        </View>
      </View>
      <View className='meal-dish-actions'>
        <View className='meal-dish-btn meal-dish-btn--primary' onClick={onConfirm}>
          <Text className='meal-dish-btn-text'>是这道</Text>
        </View>
        <View className='meal-dish-btn' onClick={onReject}>
          <Text className='meal-dish-btn-text'>不是，换一道</Text>
        </View>
      </View>
    </View>
  )
}

interface PriceStepProps {
  summary: string
  ask: MealDishPriceAsk
  onSame: () => void
  onChanged: (price: number) => void
  onSkip: () => void
}

/** 积极用户的价格追问：确认“还是 X 元”，或填现在的价格。 */
export function PriceStep({ summary, ask, onSame, onChanged, onSkip }: PriceStepProps) {
  const [text, setText] = useState('')
  const price = parsePriceInput(text)
  return (
    <View>
      <View className='meal-dish-head'>
        <Text className='meal-dish-eyebrow'>{summary}</Text>
        <Text className='meal-dish-skip' onClick={onSkip}>跳过</Text>
      </View>
      <Text className='meal-dish-title'>这道现在多少钱？</Text>
      <Text className='meal-dish-sub'>帮同学核对价格：两个人填的一样就会更新</Text>
      {ask.current_price ? (
        <View className='meal-dish-actions'>
          <View className='meal-dish-btn meal-dish-btn--primary' onClick={onSame}>
            <Text className='meal-dish-btn-text'>还是 {ask.price_text || `${ask.current_price}元`}</Text>
          </View>
        </View>
      ) : null}
      <View className='meal-dish-price-row'>
        <Input
          className='meal-dish-price-input'
          type='digit'
          value={text}
          placeholder={ask.current_price ? '变了？填现在的价格' : '填一下价格，比如 12'}
          onInput={event => setText(event.detail.value)}
        />
        <Text className='meal-dish-price-unit'>元</Text>
        <View className={`meal-dish-btn meal-dish-price-submit${price ? '' : ' is-disabled'}`} onClick={() => price && onChanged(price)}>
          <Text className='meal-dish-btn-text'>提交</Text>
        </View>
      </View>
    </View>
  )
}
