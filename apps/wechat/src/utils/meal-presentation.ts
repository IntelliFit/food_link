import type { DietRecommendationOption } from './api'

export function mealTitle(option: DietRecommendationOption): string {
  const names = option.items?.map(item => item.name.trim()).filter(Boolean) || []
  if (option.source === 'food_record' && names.length > 2) return `${names.slice(0, 2).join(' + ')}等`
  return option.title || names.join(' + ')
}

export function mealSource(option: DietRecommendationOption): string {
  if (option.source === 'food_record') return option.history_date ? `${option.history_date.slice(5).replace('-', '/')} 吃过` : '你记录过的餐食'
  const place = option.is_campus_food ? [option.school_name, option.canteen_name].filter(Boolean).join(' · ') : option.merchant_name || option.canteen_name || option.school_name || '已收录餐食'
  return `${place}${typeof option.distance_km === 'number' ? ` · 直线 ${option.distance_km.toFixed(1)} km` : ''}`
}
