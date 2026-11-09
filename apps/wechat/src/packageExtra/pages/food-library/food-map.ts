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
  | {
    kind: 'cluster'
    key: string
    latitude: number
    longitude: number
    focus: FoodMapLocation
    spots: FoodMapSpot[]
  }

export type FoodMapClusterTier = 'small' | 'medium' | 'large'

const EARTH_RADIUS_KM = 6371
export const FOOD_MAP_MIN_SCALE = 3
export const FOOD_MAP_MAX_CLUSTER_ZOOM_SCALE = 18
// Below this zoom the clusters are few enough to keep them all on the map.
const VIEW_CULLING_MIN_SCALE = 7
// Half the visible span is about 0.7 x 360 / 2^scale on a phone; keep a margin so
// a short drag does not reveal an empty area before the markers refresh.
const VIEW_SPAN_FACTOR = 2
// Web Mercator tiles: the fewest on-screen pixels per degree a device can show.
// Devices that render larger only spread the bubbles further apart.
const PIXELS_PER_DEGREE_AT_SCALE_ZERO = 256 / 360
// From this scale on, every spot keeps its own marker so each one can be opened.
const NO_CLUSTER_SCALE = 17
// A count bubble with its pointer is about 44 x 40 px: seeds this far apart cannot overlap.
const CLUSTER_RADIUS_X_PX = 48
const CLUSTER_RADIUS_Y_PX = 44

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

function spotMarkerItem(spot: FoodMapSpot): FoodMapMarkerItem {
  return { kind: 'spot', key: spot.key, latitude: spot.latitude, longitude: spot.longitude, spot }
}

/**
 * Greedy merge by on-screen distance: a spot joins the first seed within reach,
 * otherwise it becomes a seed. Each cluster sits on its seed, a real shop position,
 * so bubbles stay apart; tapping zooms to the members' centre instead.
 */
export function clusterFoodMapSpots(
  spots: FoodMapSpot[],
  scale: number,
  selectedKey = '',
): FoodMapMarkerItem[] {
  if (scale >= NO_CLUSTER_SCALE) return spots.map(spotMarkerItem)
  const pixelsPerDegree = PIXELS_PER_DEGREE_AT_SCALE_ZERO * 2 ** scale
  const columnWidth = CLUSTER_RADIUS_X_PX / pixelsPerDegree
  const seedsByColumn = new Map<number, { seed: FoodMapSpot, members: FoodMapSpot[] }[]>()
  const groups: { seed: FoodMapSpot, members: FoodMapSpot[] }[] = []
  const items: FoodMapMarkerItem[] = []
  spots.forEach((spot) => {
    // The open spot keeps its own marker, whatever the zoom level.
    if (spot.key === selectedKey) {
      items.push(spotMarkerItem(spot))
      return
    }
    const column = Math.floor(spot.longitude / columnWidth)
    // Latitude degrees stretch on screen away from the equator (Mercator).
    const latitudePixels = pixelsPerDegree / Math.cos(degreesToRadians(spot.latitude))
    const nearby = [column - 1, column, column + 1].flatMap(key => seedsByColumn.get(key) || [])
    const group = nearby.find(candidate => (
      Math.abs(candidate.seed.longitude - spot.longitude) * pixelsPerDegree <= CLUSTER_RADIUS_X_PX
      && Math.abs(candidate.seed.latitude - spot.latitude) * latitudePixels <= CLUSTER_RADIUS_Y_PX
    ))
    if (group) {
      group.members.push(spot)
      return
    }
    const created = { seed: spot, members: [spot] }
    groups.push(created)
    seedsByColumn.set(column, [...(seedsByColumn.get(column) || []), created])
  })
  groups.forEach(({ seed, members }) => {
    if (members.length === 1) {
      items.push(spotMarkerItem(seed))
      return
    }
    items.push({
      kind: 'cluster',
      key: `cluster:${seed.key}`,
      latitude: seed.latitude,
      longitude: seed.longitude,
      focus: {
        latitude: members.reduce((sum, spot) => sum + spot.latitude, 0) / members.length,
        longitude: members.reduce((sum, spot) => sum + spot.longitude, 0) / members.length,
      },
      spots: members,
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
  // Non-breaking spaces keep a one-digit bubble round rather than tall and thin.
  if (count < 10) return `\u00A0${count}\u00A0`
  if (count < 1000) return String(count)
  return `${(Math.floor(count / 100) / 10).toFixed(1)}k`
}

export function foodMapClusterTier(count: number): FoodMapClusterTier {
  if (count < 10) return 'small'
  return count < 100 ? 'medium' : 'large'
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

/** 只有一道菜的地点直接进详情，多道菜先看地点的餐食列表。 */
export function mapSpotOpensDishList(spot: Pick<FoodMapSpot, 'foodCount'>): boolean {
  return spot.foodCount > 1
}

export function mapSpotDishesLabel(foodCount: number): string {
  return foodCount > 1 ? `查看 ${foodCount} 道餐食` : '查看餐食'
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
