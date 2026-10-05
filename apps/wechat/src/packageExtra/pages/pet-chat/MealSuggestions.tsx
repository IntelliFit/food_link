import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import type { DietRecommendationOption, DietRecommendationResult } from '../../../utils/api'
import { mealSource, mealTitle } from '../../../utils/meal-presentation'

type Props = {
  result: DietRecommendationResult
  onOpen: (option: DietRecommendationOption) => void
  onSaveSchool: (result: DietRecommendationResult) => void
  savedSchoolIDs: string[]
}

export function MealSuggestions({ result, onOpen, onSaveSchool, savedSchoolIDs }: Props) {
  const [expanded, setExpanded] = useState<string>()
  return (
    <View className='meal-suggestions'>
      {(result.recommendations || []).slice(0, 3).map((option, index) => {
        const id = option.source_id || String(index)
        const open = expanded === id
        const canOpen = option.source === 'public_food_library' || option.source === 'meal_plan'
        return (
          <View key={id} className='meal-suggestions__card'>
            <View className='meal-suggestions__summary' aria-label={`${option.title}，${open ? '收起' : '查看'}详情`} onClick={() => setExpanded(open ? undefined : id)}>
              <View className='meal-suggestions__copy'>
                <Text className='meal-suggestions__title'>{mealTitle(option)}</Text>
                <Text className='meal-suggestions__source'>{mealSource(option)}</Text>
              </View>
              <Text className={`meal-suggestions__chevron${open ? ' is-open' : ''}`}>›</Text>
            </View>
            {open && (
              <View className='meal-suggestions__detail'>
                {option.items?.map((item, itemIndex) => <Text key={`${item.name}-${itemIndex}`} className='meal-suggestions__item'>{item.name} {item.amount}</Text>)}
                {option.nutrition_basis === 'unavailable'
                  ? <Text className='meal-suggestions__note'>营养与份量待确认</Text>
                  : <Text className='meal-suggestions__note'>约 {Math.round(option.calories)} kcal · 蛋白质 {Math.round(option.protein)}g · 碳水 {Math.round(option.carbs)}g · 脂肪 {Math.round(option.fat)}g</Text>}
                {!!option.price && <Text className='meal-suggestions__item'>记录价格 ¥{option.price}{option.price_unit ? ` / ${option.price_unit.replace(/^元\/?/, '')}` : ''}</Text>}
                {!!option.address && <Text className='meal-suggestions__note'>{option.address}</Text>}
                {!!option.reason && <Text className='meal-suggestions__reason'>{option.reason}</Text>}
                {option.tips?.map(tip => <Text key={tip} className='meal-suggestions__note'>{tip}</Text>)}
                {result.data_notes?.map(note => <Text key={note} className='meal-suggestions__note'>{note}</Text>)}
                {canOpen && <View className='meal-suggestions__link' onClick={() => onOpen(option)}><Text>查看餐食 ›</Text></View>}
                {result.resolved_school && <View className='meal-suggestions__link' onClick={() => onSaveSchool(result)}><Text>{savedSchoolIDs.includes(result.resolved_school.id) ? '已设为常用学校' : '设为常用学校'}</Text></View>}
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}
