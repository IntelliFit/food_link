import Taro from '@tarojs/taro'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getFoodImagesCdnBaseUrl } from '../../../utils/static-asset-cdn-url'
import type { CreatePublicFoodLibraryRequest } from '../../../utils/api'
import { foodMapDistanceKm, hasValidFoodCoordinates, type FoodMapLocation, type FoodMapSpot } from './food-map'

/** A map spot as carried by a share link, so it opens even before the map loads. */
export interface SharedFoodSpot extends FoodMapLocation {
  name: string
  address: string
  key?: string
  /** One dish at the spot, shown on the landing card and the drawn share cover. */
  dish?: string
  kcal?: number
  /** A photo on the food image CDN; links pointing anywhere else are dropped. */
  image?: string
}

export type SharedSpotOrigin = 'share' | 'upload'

const SHARED_SPOT_MATCH_KM = 0.08
// Chinese text is percent-encoded nine bytes a character, so keep links short.
const MAX_SHARED_NAME = 24
const MAX_SHARED_ADDRESS = 24
const MAX_SHARED_DISH = 20
const MAX_SHARED_IMAGE_URL = 300
const MAX_SHARED_KCAL = 5000
// A chat card title shows about two lines of 13 Chinese characters.
const SHARE_TITLE_NAME_UNITS = 14
const DEFAULT_SHARE_TITLE = '食探美食图谱：一起点亮身边的好吃的'

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function decodeParam(value: unknown): string {
  const text = String(value ?? '')
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function urlHost(url: string): string {
  return /^https:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase() || ''
}

/** The photo URL if it is served from the food image CDN, else an empty string. */
export function shareableFoodImage(value: unknown): string {
  const url = String(value ?? '').trim().replace(/^http:\/\//i, 'https://')
  if (!url || url.length > MAX_SHARED_IMAGE_URL || !/^https:\/\/[^/?#]+\/./i.test(url)) return ''
  return urlHost(url) === urlHost(getFoodImagesCdnBaseUrl()) ? url : ''
}

function cleanKcal(value: unknown): number | undefined {
  const kcal = Math.round(Number(value))
  return Number.isFinite(kcal) && kcal > 0 && kcal <= MAX_SHARED_KCAL ? kcal : undefined
}

function withOptionalFields(spot: SharedFoodSpot, dish: string, kcal: number | undefined, image: string): SharedFoodSpot {
  return { ...spot, ...(dish ? { dish } : {}), ...(kcal ? { kcal } : {}), ...(image ? { image } : {}) }
}

/** The spot a merchant upload lands on, or null for homemade food without a location. */
export function uploadedSpotFromPayload(payload: CreatePublicFoodLibraryRequest): SharedFoodSpot | null {
  const location = { latitude: Number(payload.latitude), longitude: Number(payload.longitude) }
  if (payload.latitude == null || payload.longitude == null || !hasValidFoodCoordinates(location)) return null
  const name = cleanText(payload.merchant_name || payload.food_name, MAX_SHARED_NAME)
  if (!name) return null
  const spot = { ...location, name, address: cleanText(payload.merchant_address || payload.detail_address, MAX_SHARED_ADDRESS) }
  const dish = payload.merchant_name ? cleanText(payload.food_name, MAX_SHARED_DISH) : ''
  return withOptionalFields(spot, dish, undefined, shareableFoodImage(payload.image_paths?.[0] || payload.image_path))
}

export function sharedSpotFromMapSpot(spot: FoodMapSpot): SharedFoodSpot {
  const item = spot.featuredItem
  const shared = {
    latitude: spot.latitude,
    longitude: spot.longitude,
    key: spot.key,
    name: cleanText(spot.locationName || item.merchant_name || item.canteen_name || item.food_name || '美食地点', MAX_SHARED_NAME),
    address: cleanText(spot.address || item.merchant_address || item.campus_location_text || '', MAX_SHARED_ADDRESS),
  }
  const dish = cleanText(item.food_name || item.description, MAX_SHARED_DISH)
  return withOptionalFields(shared, dish, undefined, shareableFoodImage(item.image_path || item.image_paths?.[0]))
}

export function sharedSpotQuery(spot: SharedFoodSpot): string {
  const params: Array<[string, string]> = [
    ['lat', spot.latitude.toFixed(6)],
    ['lng', spot.longitude.toFixed(6)],
    ['name', spot.name],
  ]
  if (spot.address) params.push(['address', spot.address])
  if (spot.key) params.push(['spot', spot.key])
  if (spot.dish) params.push(['dish', spot.dish])
  if (spot.kcal) params.push(['kcal', String(spot.kcal)])
  if (spot.image) params.push(['img', spot.image])
  return params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')
}

export function parseSharedSpot(params: Record<string, unknown> | undefined): SharedFoodSpot | null {
  if (!params) return null
  const location = { latitude: Number(params.lat), longitude: Number(params.lng) }
  if (params.lat == null || params.lng == null || !hasValidFoodCoordinates(location)) return null
  const name = cleanText(decodeParam(params.name), MAX_SHARED_NAME)
  if (!name) return null
  const key = cleanText(decodeParam(params.spot), 64)
  const spot = { ...location, name, address: cleanText(decodeParam(params.address), MAX_SHARED_ADDRESS), ...(key ? { key } : {}) }
  return withOptionalFields(
    spot,
    cleanText(decodeParam(params.dish), MAX_SHARED_DISH),
    cleanKcal(params.kcal),
    shareableFoodImage(decodeParam(params.img)),
  )
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

/** Cuts a name to a display width, counting Latin letters as about half a Chinese character. */
export function fitShareName(name: string, maxUnits = SHARE_TITLE_NAME_UNITS): string {
  let units = 0
  let fitted = ''
  for (const char of Array.from(name)) {
    units += /[\u0000-ÿ]/.test(char) ? 0.55 : 1
    if (units > maxUnits) return `${fitted}…`
    fitted += char
  }
  return fitted
}

/** Place name first and short enough that the chat card does not cut it off. */
export function foodMapShareTitle(spot: SharedFoodSpot | null, origin: SharedSpotOrigin): string {
  if (!spot) return DEFAULT_SHARE_TITLE
  const name = fitShareName(spot.name)
  return origin === 'upload' ? `${name}｜我刚在食探点亮了它` : `${name}｜食探上发现的好吃的`
}

export function foodMapShareMessage(
  spot: SharedFoodSpot | null,
  origin: SharedSpotOrigin,
  imageUrl?: string,
): { title: string; path: string; imageUrl?: string } {
  const page = extraPkgUrl('/pages/food-library/index')
  const path = spot ? `${page}?${sharedSpotQuery(spot)}&from=share` : page
  return { title: foodMapShareTitle(spot, origin), path, ...(imageUrl ? { imageUrl } : {}) }
}
