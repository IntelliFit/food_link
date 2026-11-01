import type { PublicFoodLibraryItem, PublicFoodMapSpotPayload } from '../../../utils/api'

export interface FoodMapLocation {
  latitude: number
  longitude: number
}

export interface FoodMapSpot extends FoodMapLocation {
  key: string
  items: PublicFoodLibraryItem[]
  featuredItem: PublicFoodLibraryItem
  distanceKm?: number
  foodCount: number
  locationLevel: 'food' | 'canteen' | 'campus' | 'school'
  locationName: string
  address: string
}

export type FoodMapMarkerItem =
  | { kind: 'spot', key: string, latitude: number, longitude: number, spot: FoodMapSpot }
  | { kind: 'cluster', key: string, latitude: number, longitude: number, spots: FoodMapSpot[] }

const EARTH_RADIUS_KM = 6371
export const FOOD_MAP_MIN_SCALE = 3
export const FOOD_MAP_MAX_CLUSTER_ZOOM_SCALE = 18
// Below this zoom the clusters are few enough to keep them all on the map.
const VIEW_CULLING_MIN_SCALE = 7
// Half the visible span is about 0.7 x 360 / 2^scale on a phone; keep a margin so
// a short drag does not reveal an empty area before the markers refresh.
const VIEW_SPAN_FACTOR = 2

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

/** Grid cell in degrees for a map scale; 0 means every spot stays separate. */
export function foodMapClusterCellSize(scale: number): number {
  if (scale <= 4) return 5.5
  if (scale <= 5) return 2.8
  if (scale <= 6) return 1.6
  if (scale <= 7) return 0.9
  if (scale <= 8) return 0.45
  if (scale <= 9) return 0.24
  if (scale <= 10) return 0.12
  if (scale <= 11) return 0.06
  if (scale <= 12) return 0.03
  if (scale <= 13) return 0.015
  if (scale <= 14) return 0.008
  if (scale <= 15) return 0.004
  if (scale <= 16) return 0.002
  return 0
}

function spotMarkerItem(spot: FoodMapSpot): FoodMapMarkerItem {
  return { kind: 'spot', key: spot.key, latitude: spot.latitude, longitude: spot.longitude, spot }
}

export function clusterFoodMapSpots(
  spots: FoodMapSpot[],
  scale: number,
  selectedKey = '',
): FoodMapMarkerItem[] {
  const cellSize = foodMapClusterCellSize(scale)
  if (cellSize <= 0) return spots.map(spotMarkerItem)
  const buckets = new Map<string, FoodMapSpot[]>()
  const items: FoodMapMarkerItem[] = []
  spots.forEach((spot) => {
    // The open spot keeps its own marker, whatever the zoom level.
    if (spot.key === selectedKey) {
      items.push(spotMarkerItem(spot))
      return
    }
    const cell = `${Math.floor(spot.latitude / cellSize)}:${Math.floor(spot.longitude / cellSize)}`
    buckets.set(cell, [...(buckets.get(cell) || []), spot])
  })
  buckets.forEach((bucket, cell) => {
    if (bucket.length === 1) {
      items.push(spotMarkerItem(bucket[0]))
      return
    }
    items.push({
      kind: 'cluster',
      key: `cluster:${cell}`,
      latitude: bucket.reduce((sum, spot) => sum + spot.latitude, 0) / bucket.length,
      longitude: bucket.reduce((sum, spot) => sum + spot.longitude, 0) / bucket.length,
      spots: bucket,
    })
  })
  return items
}

export function foodMapMarkerItemsInView(
  items: FoodMapMarkerItem[],
  center: FoodMapLocation,
  scale: number,
  selectedKey = '',
): FoodMapMarkerItem[] {
  if (scale < VIEW_CULLING_MIN_SCALE) return items
  const halfSpan = VIEW_SPAN_FACTOR * 360 / 2 ** scale
  return items.filter(item => item.key === selectedKey || (
    Math.abs(item.latitude - center.latitude) <= halfSpan
    && Math.abs(item.longitude - center.longitude) <= halfSpan
  ))
}

export function formatFoodMapClusterCount(count: number): string {
  return count > 99 ? '99+' : String(count)
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
        foodCount: orderedItems.length,
        locationLevel: 'food' as const,
        locationName: '',
        address: '',
      }
    })
    .sort((left, right) => {
      if (left.distanceKm != null && right.distanceKm != null) {
        return left.distanceKm - right.distanceKm
      }
      return foodMapPopularity(right.featuredItem) - foodMapPopularity(left.featuredItem)
    })
}

export function buildFoodMapSpotsFromPayload(
  spots: PublicFoodMapSpotPayload[],
  userLocation?: FoodMapLocation | null,
): FoodMapSpot[] {
  return spots
    .filter(spot => hasValidFoodCoordinates(spot))
    .map(spot => ({
      key: spot.key,
      latitude: Number(spot.latitude),
      longitude: Number(spot.longitude),
      items: [spot.featured_item],
      featuredItem: spot.featured_item,
      foodCount: Math.max(1, Number(spot.food_count) || 1),
      locationLevel: spot.location_level,
      locationName: spot.location_name,
      address: spot.address || '',
      distanceKm: userLocation
        ? foodMapDistanceKm(userLocation, { latitude: Number(spot.latitude), longitude: Number(spot.longitude) })
        : undefined,
    }))
    .sort((left, right) => {
      if (left.distanceKm != null && right.distanceKm != null) return left.distanceKm - right.distanceKm
      return right.foodCount - left.foodCount
    })
}
