import type { PublicFoodLibraryItem } from '../../../utils/api'

export interface FoodMapLocation {
  latitude: number
  longitude: number
}

export interface FoodMapSpot extends FoodMapLocation {
  key: string
  items: PublicFoodLibraryItem[]
  featuredItem: PublicFoodLibraryItem
  distanceKm?: number
}

const EARTH_RADIUS_KM = 6371

function degreesToRadians(value: number): number {
  return value * Math.PI / 180
}

export function hasValidFoodCoordinates(
  item: Pick<PublicFoodLibraryItem, 'latitude' | 'longitude'>,
): item is Pick<PublicFoodLibraryItem, 'latitude' | 'longitude'> & FoodMapLocation {
  const latitude = Number(item.latitude)
  const longitude = Number(item.longitude)
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
    && !(latitude === 0 && longitude === 0)
}

export function foodMapDistanceKm(from: FoodMapLocation, to: FoodMapLocation): number {
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude)
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude)
  const fromLatitude = degreesToRadians(from.latitude)
  const toLatitude = degreesToRadians(to.latitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine))
}

export function formatFoodMapDistance(distanceKm?: number): string {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return ''
  if (distanceKm < 1) return `${Math.max(10, Math.round(distanceKm * 1000 / 10) * 10)}m`
  if (distanceKm < 100) return `${distanceKm.toFixed(1)}km`
  return `${Math.round(distanceKm)}km`
}

function foodMapPopularity(item: PublicFoodLibraryItem): number {
  const imageBonus = item.image_path || item.image_paths?.length ? 1000 : 0
  return imageBonus
    + Math.max(0, Number(item.like_count) || 0) * 3
    + Math.max(0, Number(item.collection_count) || 0) * 4
    + Math.max(0, Number(item.comment_count) || 0) * 2
    + Math.max(0, Number(item.avg_rating) || 0)
}

function spotCoordinateKey(item: PublicFoodLibraryItem): string {
  return `${Number(item.latitude).toFixed(5)}:${Number(item.longitude).toFixed(5)}`
}

export function buildFoodMapSpots(
  items: PublicFoodLibraryItem[],
  userLocation?: FoodMapLocation | null,
): FoodMapSpot[] {
  const groups = new Map<string, PublicFoodLibraryItem[]>()
  items.forEach((item) => {
    if (!hasValidFoodCoordinates(item)) return
    const key = spotCoordinateKey(item)
    groups.set(key, [...(groups.get(key) || []), item])
  })

  return Array.from(groups.entries())
    .map(([key, spotItems]) => {
      const orderedItems = [...spotItems].sort((left, right) => foodMapPopularity(right) - foodMapPopularity(left))
      const featuredItem = orderedItems[0]
      const location = {
        latitude: Number(featuredItem.latitude),
        longitude: Number(featuredItem.longitude),
      }
      return {
        key,
        ...location,
        items: orderedItems,
        featuredItem,
        distanceKm: userLocation ? foodMapDistanceKm(userLocation, location) : undefined,
      }
    })
    .sort((left, right) => {
      if (left.distanceKm != null && right.distanceKm != null) {
        return left.distanceKm - right.distanceKm
      }
      return foodMapPopularity(right.featuredItem) - foodMapPopularity(left.featuredItem)
    })
}
