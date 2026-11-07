import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import type { CreatePublicFoodLibraryRequest } from '../../../utils/api'
import { foodMapDistanceKm, hasValidFoodCoordinates, type FoodMapLocation, type FoodMapSpot } from './food-map'

/** A map spot as carried by a share link, so it opens even before the map loads. */
export interface SharedFoodSpot extends FoodMapLocation {
  name: string
  address: string
  key?: string
}

export type SharedSpotOrigin = 'share' | 'upload'

const SHARED_SPOT_MATCH_KM = 0.08
const MAX_SHARED_TEXT = 40

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SHARED_TEXT)
}

function decodeParam(value: unknown): string {
  const text = String(value ?? '')
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** The spot a merchant upload lands on, or null for homemade food without a location. */
export function uploadedSpotFromPayload(payload: CreatePublicFoodLibraryRequest): SharedFoodSpot | null {
  const location = { latitude: Number(payload.latitude), longitude: Number(payload.longitude) }
  if (payload.latitude == null || payload.longitude == null || !hasValidFoodCoordinates(location)) return null
  const name = cleanText(payload.merchant_name || payload.food_name)
  if (!name) return null
  return { ...location, name, address: cleanText(payload.merchant_address || payload.detail_address) }
}

export function sharedSpotFromMapSpot(spot: FoodMapSpot): SharedFoodSpot {
  const item = spot.featuredItem
  return {
    latitude: spot.latitude,
    longitude: spot.longitude,
    key: spot.key,
    name: cleanText(spot.locationName || item.merchant_name || item.canteen_name || item.food_name || '美食地点'),
    address: cleanText(spot.address || item.merchant_address || item.campus_location_text || ''),
  }
}

export function sharedSpotQuery(spot: SharedFoodSpot): string {
  const params: Array<[string, string]> = [
    ['lat', spot.latitude.toFixed(6)],
    ['lng', spot.longitude.toFixed(6)],
    ['name', spot.name],
  ]
  if (spot.address) params.push(['address', spot.address])
  if (spot.key) params.push(['spot', spot.key])
  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
}

export function parseSharedSpot(params: Record<string, unknown> | undefined): SharedFoodSpot | null {
  if (!params) return null
  const location = { latitude: Number(params.lat), longitude: Number(params.lng) }
  if (params.lat == null || params.lng == null || !hasValidFoodCoordinates(location)) return null
  const name = cleanText(decodeParam(params.name))
  if (!name) return null
  const key = cleanText(decodeParam(params.spot))
  return { ...location, name, address: cleanText(decodeParam(params.address)), ...(key ? { key } : {}) }
}

/** Whether the page being opened carries a shared spot, read before the page renders. */
export function currentPageHasSharedSpot(): boolean {
  const pages = Taro.getCurrentPages()
  const current = pages[pages.length - 1]
  return parseSharedSpot(current?.options) !== null
}

export function sharedSpotOrigin(params: Record<string, unknown> | undefined): SharedSpotOrigin {
  return params?.from === 'upload' ? 'upload' : 'share'
}

/** The loaded spot a share link points at: same key, else the closest one within about 80 m. */
export function findSharedMapSpot(spots: FoodMapSpot[], shared: SharedFoodSpot): FoodMapSpot | undefined {
  if (shared.key) {
    const exact = spots.find(spot => spot.key === shared.key)
    if (exact) return exact
  }
  let best: FoodMapSpot | undefined
  let bestKm = SHARED_SPOT_MATCH_KM
  for (const spot of spots) {
    const km = foodMapDistanceKm(shared, spot)
    if (km <= bestKm) {
      best = spot
      bestKm = km
    }
  }
  return best
}

export function foodMapShareMessage(
  spot: SharedFoodSpot | null,
  origin: SharedSpotOrigin,
  imageUrl?: string,
): { title: string; path: string; imageUrl?: string } {
  const page = extraPkgUrl('/pages/food-library/index')
  if (!spot) {
    return { title: '食探美食图谱：一起点亮身边的好吃的', path: page }
  }
  const title = origin === 'upload'
    ? `我在食探点亮了「${spot.name}」，你身边有什么好吃的？`
    : `我在食探美食图谱发现了「${spot.name}」，一起来看看`
  return { title, path: `${page}?${sharedSpotQuery(spot)}&from=share`, ...(imageUrl ? { imageUrl } : {}) }
}
