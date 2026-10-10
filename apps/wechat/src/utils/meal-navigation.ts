import Taro from '@tarojs/taro'
import { getPublicFoodLibraryItem, getPublicFoodMapSpots, type DietRecommendationOption } from './api'

type Destination = { latitude: number; longitude: number; name: string; address: string; level?: string }

function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && typeof longitude === 'number' &&
    Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0)
}

export function canNavigateMeal(option: DietRecommendationOption): boolean {
  return (option.source === 'public_food_library' && !!option.source_id) ||
    (option.source === 'meal_plan' && !!option.meal_components?.length)
}

function placeName(option: DietRecommendationOption, level?: string): string {
  if (level === 'school') return option.school_name || '餐食所在学校'
  if (level === 'campus') return [option.school_name, option.campus_name].filter(Boolean).join(' · ') || '餐食所在校区'
  return [option.school_name, option.canteen_name || option.merchant_name].filter(Boolean).join(' · ') || '餐食地点'
}

export async function navigateToMeal(option: DietRecommendationOption): Promise<void> {
  if (!canNavigateMeal(option)) throw new Error('这条历史餐食没有可导航的商家地点')
  let destination: Destination | undefined
  if (validCoordinates(option.latitude, option.longitude)) {
    destination = { latitude: option.latitude!, longitude: option.longitude!, name: placeName(option, option.location_level), address: option.address || '', level: option.location_level }
  } else {
    // Compatibility with deployed previews that do not yet return coordinates.
    // Combination IDs are not library IDs; use a real component from the same-place plan.
    const source = option.meal_components?.[0] || option
    if (source.source_id) {
      const item = await getPublicFoodLibraryItem(source.source_id)
      if (validCoordinates(item.latitude, item.longitude)) {
        destination = { latitude: item.latitude!, longitude: item.longitude!, name: placeName(source), address: item.detail_address || item.merchant_address || '', level: 'food' }
      } else {
        const { spots } = await getPublicFoodMapSpots()
        const ids = { canteen: item.canteen_id || source.canteen_id, campus: item.campus_id || source.campus_id, school: item.school_id || source.school_id }
        // Match directory IDs, never guess coordinates from a dish or merchant name.
        const spot = spots.find(entry => entry.featured_item.id === source.source_id) ||
          (['canteen', 'campus', 'school'] as const).map(level => ids[level] ? spots.find(entry => entry.key === `${level}:${ids[level]}`) : undefined).find(Boolean)
        if (spot && validCoordinates(spot.latitude, spot.longitude)) {
          destination = { latitude: spot.latitude, longitude: spot.longitude, name: spot.location_name, address: spot.address || '', level: spot.location_level }
        }
      }
    }
  }
  if (!destination) throw new Error('这个餐食尚未补齐地点坐标，暂时不能导航')
  if (destination.level === 'school' || destination.level === 'campus') {
    const { confirm } = await Taro.showModal({ title: '地点精度提示', content: `目前只有${destination.level === 'school' ? '学校' : '校区'}坐标，不是食堂或窗口的精确位置。是否先导航到这里？`, confirmText: '查看地图' })
    if (!confirm) return
  }
  try {
    await Taro.openLocation({ latitude: destination.latitude, longitude: destination.longitude, name: destination.name, address: destination.address, scale: 18 })
  } catch (error) {
    if (/cancel/i.test(String((error as { errMsg?: string })?.errMsg || ''))) return
    throw new Error('地图打开失败，请稍后重试')
  }
}
