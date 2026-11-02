import { View, Text, ScrollView, Image, Input, Button, Map } from '@tarojs/components'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Ellipsis, Plus } from '@taroify/icons'
import '@taroify/icons/style'
import { withAuth } from '../../../utils/withAuth'
import { rememberMealLocation } from '../../../utils/meal-location'
import {
  getAccessToken,
  getPublicFoodMapSpots,
  getPublicFoodLibraryList,
  getPublicFoodLibraryCollections,
  getMyPublicFoodLibrary,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  collectPublicFoodLibraryItem,
  uncollectPublicFoodLibraryItem,
  submitStructuredFeedback,
  deletePublicFoodLibraryItem,
  showUnifiedApiError,
  type PublicFoodLibraryItem,
  type PublicFoodMapSpotPayload,
} from '../../../utils/api'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import {
  buildFoodMapSpotsFromPayload,
  clusterFoodMapSpots,
  foodMapClusterTier,
  FOOD_MAP_MAX_CLUSTER_ZOOM_SCALE,
  FOOD_MAP_MIN_SCALE,
  foodMapMarkerItemsInView,
  formatFoodMapClusterCount,
  formatFoodMapDistance,
  type FoodMapLocation,
  type FoodMapSpot,
  mapSpotDishesLabel,
  mapSpotOpensDishList,
} from './food-map'

// 缓存键名常量
const CACHE_KEYS = {
  LIST: 'food_library_list_cache',
  TIMESTAMP: 'food_library_timestamp',
  FILTERS: 'food_library_filters_cache' // 缓存筛选条件
}

// 缓存有效期（5分钟）
const CACHE_DURATION = 5 * 60 * 1000

type TabMode = 'all' | 'campus' | 'collections' | 'mine'
type ViewMode = 'map' | 'list'
const RECORD_TEXT_LIBRARY_SELECTION_KEY = 'record_text_library_selection'
const FOOD_MAP_MARKER_ICON = '/assets/icons/food-map-marker.png'
const FOOD_MAP_CLUSTER_ICON = '/assets/icons/food-map-cluster.png'
const FOOD_MAP_ID = 'food-library-map'
const FOOD_MAP_NEARBY_SCALE = 15
const FOOD_MAP_ZOOM_AFTER_MARKERS_MS = 400
const FOOD_MAP_CLUSTER_STYLES = {
  small: { bgColor: '#ffffff', color: '#0a7a54', borderColor: '#0a7a54', fontSize: 12, padding: 4 },
  medium: { bgColor: '#0a7a54', color: '#ffffff', borderColor: '#ffffff', fontSize: 13, padding: 5 },
  large: { bgColor: '#0b4f3a', color: '#ffffff', borderColor: '#ffffff', fontSize: 14, padding: 6 },
}
const CHINA_OVERVIEW = { center: { latitude: 34, longitude: 108 }, scale: 4 }

function campusLocation(item: PublicFoodLibraryItem): string {
  const parts = item.campus_location_text
    ? item.campus_location_text.split(/\s*·\s*/)
    : [item.school_name, item.campus_name, item.canteen_name, item.floor, item.window_name]
  const seen = new Set<string>()

  return parts
    .map(part => String(part || '').trim())
    .filter((part) => {
      if (!part) return false
      const key = part.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(' · ')
}

function isCampusFoodItem(item: PublicFoodLibraryItem): boolean {
  return !!item.venue_type || item.type === 'campus' || !!item.is_campus_food
}

function canteenBadge(item: PublicFoodLibraryItem): string {
  if (item.venue_type === 'university') return '校园食堂'
  if (item.venue_type === 'community') return '社区食堂'
  if (item.venue_type === 'office_park') return '园区食堂'
  if (item.venue_type === 'corporate') return '企业食堂'
  return '食堂'
}

function foodMapTitle(item: PublicFoodLibraryItem): string {
  return item.food_name || item.description || '一份好味道'
}

function foodMapPlace(item: PublicFoodLibraryItem): string {
  return item.merchant_name
    || item.canteen_name
    || item.campus_location_text
    || item.detail_address
    || item.merchant_address
    || 'FoodLink 用户点亮'
}

function foodMapImage(item: PublicFoodLibraryItem): string {
  return item.image_path || item.image_paths?.[0] || ''
}

function foodPrice(item: PublicFoodLibraryItem): string {
  if (item.price_type === 'unknown') return '价格待补充'
  if (item.price_type === 'range' && item.price_min != null && item.price_max != null) {
    return `${item.price_min}–${item.price_max}元${item.price_unit?.replace(/^元/, '') || ''}`
  }
  if (item.price == null || item.price <= 0) return '价格待补充'
  const unit = item.price_unit || (item.price_type === 'weight' ? '元/kg' : item.price_type === 'combo' ? '元/套餐' : '元/份')
  return `${item.price}${unit}`
}

function hasDisplayableNutrition(item: PublicFoodLibraryItem): boolean {
  if (item.nutrition_status && item.nutrition_status !== 'current') return false
  const status = String(item.analysis_status || '').trim().toLowerCase()
  if (['pending', 'processing', 'stale', 'failed', 'timed_out'].includes(status)) return false
  // 目录中没有营养数据时四项也会返回 0，不能向用户表达成零热量餐。
  // 已完成分析的真实零热量（如水）仍保留；不猜测、也不生成营养值。
  return status === 'completed' || [item.total_calories, item.total_protein, item.total_carbs, item.total_fat]
    .some(value => Number.isFinite(value) && value > 0)
}

const SPOT_DISH_PAGE_SIZE = 50

interface SpotDishSource {
  key: string
  title: string
  foodCount: number
}

interface SpotDishList extends SpotDishSource {
  items: PublicFoodLibraryItem[]
  loading: boolean
  hasMore: boolean
  error: boolean
}

function FoodLibraryPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()
  const fromRecord = router.params.from === 'record'
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken())
  const [tabMode, setTabMode] = useState<TabMode>('all')
  const [viewMode, setViewMode] = useState<ViewMode>(fromRecord ? 'list' : 'map')
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<PublicFoodLibraryItem[]>([])
  const [mapSpotPayloads, setMapSpotPayloads] = useState<PublicFoodMapSpotPayload[]>([])
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [listError, setListError] = useState(false)
  const [mapLocating, setMapLocating] = useState(false)
  const [mapCenter, setMapCenter] = useState<FoodMapLocation>(CHINA_OVERVIEW.center)
  const [mapScale, setMapScale] = useState(CHINA_OVERVIEW.scale)
  const [userLocation, setUserLocation] = useState<FoodMapLocation | null>(null)
  const [selectedMapSpotKey, setSelectedMapSpotKey] = useState('')
  const [spotDishes, setSpotDishes] = useState<SpotDishList | null>(null)
  const spotDishRequestRef = useRef(0)
  const [campusList, setCampusList] = useState<PublicFoodLibraryItem[]>([])
  const [campusLoading, setCampusLoading] = useState(false)
  const [collectionList, setCollectionList] = useState<PublicFoodLibraryItem[]>([])
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [mineList, setMineList] = useState<PublicFoodLibraryItem[]>([])
  const [mineLoading, setMineLoading] = useState(false)
  const [sortBy, setSortBy] = useState<'latest' | 'hot' | 'rating'>('latest')
  const [filterFatLoss, setFilterFatLoss] = useState<boolean | undefined>(undefined)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchMerchant, setSearchMerchant] = useState('')
  const [showFilterPanel, setShowFilterPanel] = useState(false)

  // 性能优化相关状态
  const [refreshing, setRefreshing] = useState(false)
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const lastRefreshTime = useRef<number>(0)
  const mapLoadedRef = useRef(false)
  const mapGestureVersionRef = useRef(0)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()
  const mapSpots = useMemo(
    () => buildFoodMapSpotsFromPayload(mapSpotPayloads, userLocation),
    [mapSpotPayloads, userLocation],
  )
  const selectedMapSpot = useMemo(
    () => mapSpots.find(spot => spot.key === selectedMapSpotKey) || null,
    [mapSpots, selectedMapSpotKey],
  )
  const nearbySpotCount = useMemo(
    () => mapSpots.filter(spot => spot.distanceKm != null && spot.distanceKm <= 10).length,
    [mapSpots],
  )
  const mapMarkerItems = useMemo(
    () => foodMapMarkerItemsInView(
      clusterFoodMapSpots(mapSpots, mapScale, selectedMapSpotKey),
      mapCenter,
      mapScale,
      selectedMapSpotKey,
    ),
    [mapSpots, mapScale, mapCenter, selectedMapSpotKey],
  )
  const mapMarkers = useMemo(() => mapMarkerItems.map((item, index) => {
    if (item.kind === 'cluster') {
      const count = item.spots.length
      return {
        id: index + 1,
        latitude: item.latitude,
        longitude: item.longitude,
        iconPath: FOOD_MAP_CLUSTER_ICON,
        width: 14,
        height: 14,
        // Bigger groups stay on top where bubbles come close.
        zIndex: 3 + Math.min(count, 999),
        anchor: { x: 0.5, y: 0.5 },
        callout: {
          ...FOOD_MAP_CLUSTER_STYLES[foodMapClusterTier(count)],
          content: formatFoodMapClusterCount(count),
          borderWidth: 1,
          textAlign: 'center' as const,
          anchorX: 0,
          anchorY: -2,
          borderRadius: 16,
          display: 'ALWAYS' as const,
        },
      }
    }
    const { spot } = item
    const selected = selectedMapSpotKey === spot.key
    return {
      id: index + 1,
      latitude: spot.latitude,
      longitude: spot.longitude,
      iconPath: FOOD_MAP_MARKER_ICON,
      width: selected ? 30 : 24,
      height: selected ? 30 : 24,
      zIndex: selected ? 10 : 2,
      anchor: { x: 0.5, y: 1 },
      callout: {
        fontSize: 12,
        borderWidth: 1,
        borderColor: '#d5eee4',
        bgColor: '#ffffff',
        padding: 8,
        textAlign: 'center' as const,
        content: `${spot.locationName || foodMapPlace(spot.featuredItem)}${spot.foodCount > 1 ? ` · ${spot.foodCount} 道` : ''}`,
        color: '#153129',
        anchorX: 0,
        anchorY: -4,
        borderRadius: 12,
        display: selected ? 'ALWAYS' as const : 'BYCLICK' as const,
      },
    }
  }), [mapMarkerItems, selectedMapSpotKey])

  /**
   * 从缓存加载数据
   */
  const loadFromCache = useCallback(() => {
    try {
      const cachedList = Taro.getStorageSync(CACHE_KEYS.LIST)
      const cachedFilters = Taro.getStorageSync(CACHE_KEYS.FILTERS)

      if (cachedList && cachedFilters) {
        try {
          const parsedList = JSON.parse(cachedList)
          const parsedFilters = JSON.parse(cachedFilters)
          // 旧缓存的搜索只查商家，不用它冒充新的菜名/商家搜索结果。
          if (parsedFilters.searchMerchant && parsedFilters.searchMode !== 'keyword') return false

          // 恢复筛选条件
          setSortBy(parsedFilters.sortBy || 'latest')
          setFilterFatLoss(parsedFilters.filterFatLoss)
          setSearchMerchant(parsedFilters.searchMerchant || '')
          setSearchKeyword(parsedFilters.searchMerchant || '')

          // 恢复列表
          if (Array.isArray(parsedList) && parsedList.length > 0) {
            setList(parsedList)
            return true
          }
        } catch (e) {
          console.error('解析缓存失败:', e)
        }
      }
      return false
    } catch (e) {
      console.error('加载缓存失败:', e)
      return false
    }
  }, [])

  /**
   * 保存数据到缓存
   */
  const saveToCache = useCallback((listData: PublicFoodLibraryItem[], filters = { sortBy, filterFatLoss, searchMerchant }) => {
    try {
      // 只缓存前50条
      const dataToCache = listData.slice(0, 50)
      Taro.setStorageSync(CACHE_KEYS.LIST, JSON.stringify(dataToCache))
      Taro.setStorageSync(CACHE_KEYS.TIMESTAMP, Date.now().toString())

      // 缓存筛选条件
      Taro.setStorageSync(CACHE_KEYS.FILTERS, JSON.stringify({
        ...filters,
        searchMode: 'keyword'
      }))
    } catch (e) {
      console.error('保存缓存失败:', e)
    }
  }, [sortBy, filterFatLoss, searchMerchant])

  /**
   * 清除缓存
   */
  const clearCache = useCallback(() => {
    try {
      Taro.removeStorageSync(CACHE_KEYS.LIST)
      Taro.removeStorageSync(CACHE_KEYS.TIMESTAMP)
      Taro.removeStorageSync(CACHE_KEYS.FILTERS)
    } catch (e) {
      console.error('清除缓存失败:', e)
    }
  }, [])

  /**
   * 加载列表（支持静默刷新和强制刷新）
   */
  const loadList = useCallback(async (silent = false, force = false) => {
    if (!getAccessToken()) return

    // 条件刷新：检查是否需要刷新
    const now = Date.now()
    if (!force && now - lastRefreshTime.current < CACHE_DURATION) {
      console.log('食物库刷新间隔未到，跳过刷新')
      return
    }

    if (!silent) setLoading(true)
    setListError(false)

    try {
      const res = await getPublicFoodLibraryList({
        sort_by: sortBy,
        suitable_for_fat_loss: filterFatLoss,
        keyword: searchMerchant || undefined,
        limit: 50
      })
      const newList = res.list || []
      setList(newList)

      // 保存到缓存
      saveToCache(newList)

      // 更新刷新时间
      lastRefreshTime.current = Date.now()
    } catch (e: any) {
      setListError(true)
      console.error('加载美食图谱失败:', e)
      if (!silent) {
        await showUnifiedApiError(e, '获取列表失败')
      }
    } finally {
      if (!silent) setLoading(false)
      setRefreshing(false)
      setShowSkeleton(false)
    }
  }, [sortBy, filterFatLoss, searchMerchant, saveToCache])

  /**
   * 用户主动刷新（搜索/排序/筛选切换时）
   * 先清空列表 + 显示 loading spinner，再请求数据
   */
  const refreshList = useCallback(async (
    params: {
      sortBy: 'latest' | 'hot' | 'rating'
      filterFatLoss?: boolean
      searchMerchant?: string
    }
  ) => {
    if (!getAccessToken()) return
    setList([])
    setLoading(true)
    setListError(false)
    clearCache()
    lastRefreshTime.current = 0
    try {
      const res = await getPublicFoodLibraryList({
        sort_by: params.sortBy,
        suitable_for_fat_loss: params.filterFatLoss,
        keyword: params.searchMerchant || undefined,
        limit: 50
      })
      const newList = res.list || []
      setList(newList)
      saveToCache(newList, { sortBy: params.sortBy, filterFatLoss: params.filterFatLoss, searchMerchant: params.searchMerchant || '' })
      lastRefreshTime.current = Date.now()
    } catch (e: any) {
      setListError(true)
      console.error('加载美食图谱失败:', e)
      await showUnifiedApiError(e, '获取列表失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
      setShowSkeleton(false)
    }
  }, [clearCache, saveToCache])

  /** 加载收藏夹列表，force=true 时忽略缓存强制请求 */
  const loadCollectionList = useCallback(async (force = false) => {
    if (!getAccessToken()) return
    if (!force && collectionList.length > 0) return
    setCollectionLoading(true)
    try {
      const res = await getPublicFoodLibraryCollections()
      setCollectionList(res.list || [])
    } catch (e: any) {
      await showUnifiedApiError(e, '加载收藏失败')
    } finally {
      setCollectionLoading(false)
    }
  }, [])

  /** 加载校园食堂列表 */
  const loadCampusList = useCallback(async (force = false) => {
    if (!getAccessToken()) return
    if (!force && campusList.length > 0) return
    setCampusLoading(true)
    try {
      const res = await getPublicFoodLibraryList({ canteen_scope: 'all', limit: 50 })
      setCampusList(res.list || [])
    } catch (e: any) {
      await showUnifiedApiError(e, '获取食堂菜品失败')
    } finally {
      setCampusLoading(false)
    }
  }, [])

  /** 加载服务端全量聚合的地点（含餐食/食堂/校区/学校继承坐标），并尝试定位到用户附近。 */
  const loadMapList = useCallback(async (force = false) => {
    if (!getAccessToken()) return
    const locationOwner = getAccessToken() || ''
    if (!force && mapLoadedRef.current) return
    mapLoadedRef.current = true
    setMapLoading(true)
    setMapError(false)
    setMapLocating(true)
    try {
      const [foodResult, locationResult] = await Promise.allSettled([
        getPublicFoodMapSpots(),
        Taro.getLocation({ type: 'gcj02' }),
      ])

      if (foodResult.status === 'rejected') throw foodResult.reason
      const mappedSpots = foodResult.value.spots || []
      setMapSpotPayloads(mappedSpots)

      if (locationResult.status === 'fulfilled') {
        if (locationOwner !== getAccessToken()) return
        rememberMealLocation(locationOwner, { latitude: locationResult.value.latitude, longitude: locationResult.value.longitude, accuracy_m: locationResult.value.accuracy, captured_at: Date.now(), coordinate_type: 'gcj02' })
        const location = {
          latitude: locationResult.value.latitude,
          longitude: locationResult.value.longitude,
        }
        setUserLocation(location)
        setMapCenter(location)
        // The native map drops a zoom sent in the same update as the full marker set.
        setTimeout(() => setMapScale(FOOD_MAP_NEARBY_SCALE), FOOD_MAP_ZOOM_AFTER_MARKERS_MS)
      } else {
      }
    } catch (e: any) {
      setMapError(true)
      mapLoadedRef.current = false
      await showUnifiedApiError(e, '获取美食地图失败')
    } finally {
      setMapLoading(false)
      setMapLocating(false)
    }
  }, [])

  const locateMapAroundMe = useCallback(async () => {
    setMapLocating(true)
    const locationOwner = getAccessToken() || ''
    try {
      const result = await Taro.getLocation({ type: 'gcj02' })
      if (locationOwner !== getAccessToken()) return
      rememberMealLocation(locationOwner, { latitude: result.latitude, longitude: result.longitude, accuracy_m: result.accuracy, captured_at: Date.now(), coordinate_type: 'gcj02' })
      const location = { latitude: result.latitude, longitude: result.longitude }
      setUserLocation(location)
      setMapCenter(location)
      setMapScale(16)
      setSelectedMapSpotKey('')
    } catch (e: any) {
      await showUnifiedApiError(e, '无法获取当前位置')
    } finally {
      setMapLocating(false)
    }
  }, [])

  /** 加载我的上传列表 */
  const loadMineList = useCallback(async (force = false) => {
    if (!getAccessToken()) return
    if (!force && mineList.length > 0) return
    setMineLoading(true)
    try {
      const res = await getMyPublicFoodLibrary()
      setMineList(res.list || [])
    } catch (e: any) {
      await showUnifiedApiError(e, '加载我的上传失败')
    } finally {
      setMineLoading(false)
    }
  }, [])

  // 从分享页提交成功返回时需强制刷新列表
  const NEED_REFRESH_KEY = 'food_library_need_refresh'

  // 【核心优化】智能加载策略
  useDidShow(() => {
    applyThemeNavigationBar(scheme)
    // watch 迭代时页面配置可能仍驻留旧标题，运行时也保持产品名一致。
    void Taro.setNavigationBarTitle({ title: '美食图谱' })
    setLoggedIn(!!getAccessToken())
    if (!getAccessToken()) return

    const needRefreshFromShare = Taro.getStorageSync(NEED_REFRESH_KEY)
    if (needRefreshFromShare) {
      try { Taro.removeStorageSync(NEED_REFRESH_KEY) } catch (_) {}
      if (tabMode === 'collections') {
        loadCollectionList(true)
      } else if (tabMode === 'campus') {
        loadCampusList(true)
      } else if (tabMode === 'mine') {
        loadMineList(true)
      } else if (viewMode === 'map') {
        loadMapList(true)
      } else {
        loadList(true, true)
      }
      return
    }

    if (tabMode === 'collections') {
      loadCollectionList(true)
      return
    }
    if (tabMode === 'campus') {
      loadCampusList(true)
      return
    }
    if (tabMode === 'mine') {
      loadMineList(true)
      return
    }
    if (viewMode === 'map') {
      loadMapList(false)
      return
    }

    // 从详情返回地点餐食列表时保留列表和滚动位置
    if (spotDishes) return

    // 1. 立即从缓存加载数据
    const hasCache = loadFromCache()

    // 2. 判断是否需要刷新
    const now = Date.now()
    const needRefresh = (
      list.length === 0 ||
      now - lastRefreshTime.current > CACHE_DURATION
    )

    // 3. 根据情况决定刷新策略
    if (needRefresh) {
      if (hasCache || !isFirstLoad) {
        // 有缓存或非首次：静默刷新
        loadList(true, false)
      } else {
        // 首次且无缓存：显示骨架屏
        setShowSkeleton(true)
        loadList(false, true)
        setIsFirstLoad(false)
      }
    }
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  // 仅登录态或 tab 切换时做初始化加载（sortBy/filterFatLoss/searchMerchant 的主动变更由点击函数直接处理）
  useEffect(() => {
    if (!loggedIn) return
    if (tabMode === 'all') {
      if (viewMode === 'map') {
        loadMapList(false)
      } else if (!spotDishes) {
        clearCache()
        loadList(false, true)
      }
    } else if (tabMode === 'campus') {
      loadCampusList(false)
    } else if (tabMode === 'mine') {
      loadMineList(false)
    }
  }, [loggedIn, tabMode, viewMode])

  const loadSpotDishes = useCallback(async (source: SpotDishSource, items: PublicFoodLibraryItem[]) => {
    const requestId = ++spotDishRequestRef.current
    const { key, title, foodCount } = source
    setSpotDishes({ key, title, foodCount, items, loading: true, hasMore: false, error: false })
    try {
      const res = await getPublicFoodLibraryList({ spot_key: key, limit: SPOT_DISH_PAGE_SIZE, offset: items.length })
      if (requestId !== spotDishRequestRef.current) return
      const page = res.list || []
      setSpotDishes({
        key, title, foodCount, items: [...items, ...page], loading: false,
        hasMore: page.length === SPOT_DISH_PAGE_SIZE, error: false,
      })
    } catch (e: any) {
      if (requestId !== spotDishRequestRef.current) return
      setSpotDishes({ key, title, foodCount, items, loading: false, hasMore: false, error: true })
      await showUnifiedApiError(e, '获取餐食失败')
    }
  }, [])

  const closeSpotDishes = useCallback(() => {
    spotDishRequestRef.current += 1
    setSpotDishes(null)
  }, [])

  // 切到地图或其他分类时退出地点餐食列表
  useEffect(() => {
    if (viewMode !== 'list' || tabMode !== 'all') closeSpotDishes()
  }, [viewMode, tabMode, closeSpotDishes])

  const openMapSpot = (spot: FoodMapSpot) => {
    if (!mapSpotOpensDishList(spot)) {
      goDetail(spot.featuredItem.id)
      return
    }
    setViewMode('list')
    void loadSpotDishes({
      key: spot.key,
      title: spot.locationName || foodMapPlace(spot.featuredItem),
      foodCount: spot.foodCount,
    }, [])
  }

  const loadMoreSpotDishes = () => {
    if (spotDishes?.hasMore && !spotDishes.loading) void loadSpotDishes(spotDishes, spotDishes.items)
  }

  // 下拉刷新处理
  const handleRefresherRefresh = useCallback(() => {
    if (!getAccessToken()) {
      setRefreshing(false)
      return
    }
    setRefreshing(true)
    if (spotDishes && tabMode === 'all') {
      loadSpotDishes(spotDishes, []).finally(() => setRefreshing(false))
      return
    }
    if (tabMode === 'collections') {
      loadCollectionList(true).finally(() => setRefreshing(false))
    } else if (tabMode === 'campus') {
      loadCampusList(true).finally(() => setRefreshing(false))
    } else if (tabMode === 'mine') {
      loadMineList(true).finally(() => setRefreshing(false))
    } else {
      loadList(false, true)
    }
  }, [loadList, tabMode, loadCollectionList, loadCampusList, loadMineList])

  // 搜索
  const handleSearch = (keyword = searchKeyword) => {
    const kw = keyword.trim()
    closeSpotDishes()
    setSearchKeyword(kw)
    setSearchMerchant(kw)
    if (viewMode === 'map') {
      // 地图端点只有地点代表菜；全菜名检索复用列表端点，不假装完整菜单搜索。
      setList([])
      setLoading(true)
      setViewMode('list')
    } else {
      void refreshList({ sortBy, filterFatLoss, searchMerchant: kw })
    }
  }

  // 左右滑动手势
  const onTouchStart = (e: any) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: any) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 80) {
      if (dx < 0 && tabMode === 'all') {
        setTabMode('collections')
        loadCollectionList(true)
      } else if (dx > 0 && tabMode === 'collections') {
        setTabMode('all')
      }
    }
  }

  // 点赞/取消（乐观更新）
  const handleLike = async (item: PublicFoodLibraryItem) => {
    // 1. 乐观更新：立即更新 UI
    const newList = list.map(it =>
      it.id === item.id
        ? {
          ...it,
          liked: !it.liked,
          like_count: it.liked ? Math.max(0, it.like_count - 1) : it.like_count + 1
        }
        : it
    )
    setList(newList)
    saveToCache(newList)

    // 2. 后台发送请求
    try {
      if (item.liked) {
        await unlikePublicFoodLibraryItem(item.id)
      } else {
        await likePublicFoodLibraryItem(item.id)
      }
    } catch (e: any) {
      // 3. 失败则回滚
      setList(list)
      saveToCache(list)
      await showUnifiedApiError(e, '操作失败')
    }
  }

  // 收藏/取消（乐观更新）
  const handleDelete = async (e: any, item: PublicFoodLibraryItem) => {
    e.stopPropagation()
    const { confirm } = await Taro.showModal({
      title: '删除上传',
      content: '删除后这条食物会从公共库下架，其他用户将无法再查看。',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#ef4444'
    })
    if (!confirm) return

    try {
      await deletePublicFoodLibraryItem(item.id)
      const newList = list.filter(it => it.id !== item.id)
      const newCollectionList = collectionList.filter(it => it.id !== item.id)
      setList(newList)
      setCollectionList(newCollectionList)
      saveToCache(newList)
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (e: any) {
      await showUnifiedApiError(e, '删除失败')
    }
  }

  const handleCollect = async (e: any, item: PublicFoodLibraryItem) => {
    e.stopPropagation()

    const isUncollect = item.collected

    // 1. 乐观更新：全部列表
    const newList = list.map(it =>
      it.id === item.id
        ? {
          ...it,
          collected: !it.collected,
          collection_count: it.collected ? Math.max(0, (it.collection_count || 0) - 1) : (it.collection_count || 0) + 1
        }
        : it
    )
    setList(newList)
    saveToCache(newList)

    // 收藏夹内取消收藏：从收藏夹列表移除
    if (tabMode === 'collections' && isUncollect) {
      setCollectionList(prev => prev.filter(it => it.id !== item.id))
    }

    // 2. 后台发送请求
    try {
      if (item.collected) {
        await uncollectPublicFoodLibraryItem(item.id)
      } else {
        await collectPublicFoodLibraryItem(item.id)
      }
    } catch (e: any) {
      setList(list)
      saveToCache(list)
      if (tabMode === 'collections' && isUncollect) {
        setCollectionList(prev => [...prev, item])
      }
      await showUnifiedApiError(e, '操作失败')
    }
  }

  // 跳转详情
  const goDetail = (itemId: string) => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-detail/index')}?id=${itemId}` })
  }

  const selectMapSpot = (markerId: number | string) => {
    const item = mapMarkerItems[Number(markerId) - 1]
    if (!item) return
    if (item.kind === 'cluster') {
      setSelectedMapSpotKey('')
      setMapCenter(item.focus)
      setMapScale(Math.min(mapScale + 2, FOOD_MAP_MAX_CLUSTER_ZOOM_SCALE))
      return
    }
    const { spot } = item
    setSelectedMapSpotKey(spot.key)
    setMapCenter({ latitude: spot.latitude, longitude: spot.longitude })
    setMapScale(17)
  }

  // Only real gestures feed the zoom back: programmatic moves already set state,
  // and a stale reading must not undo a later locate or cluster tap.
  const handleMapRegionChange = (event: any) => {
    const detail = event?.detail || {}
    const causedBy = detail.causedBy || event?.causedBy
    if (!['gesture', 'drag', 'scale'].includes(causedBy)) return
    const version = ++mapGestureVersionRef.current
    if ((detail.type || event?.type) !== 'end') return
    const context = Taro.createMapContext(FOOD_MAP_ID)
    context.getScale({
      success: (scaleResult) => {
        context.getCenterLocation({
          success: (centerResult) => {
            if (version !== mapGestureVersionRef.current) return
            setMapScale(scaleResult.scale)
            setMapCenter({ latitude: centerResult.latitude, longitude: centerResult.longitude })
          },
        })
      },
    })
  }

  const focusNearestMapSpot = () => {
    const spot = mapSpots[0]
    if (!spot) return
    setSelectedMapSpotKey(spot.key)
    setMapCenter({ latitude: spot.latitude, longitude: spot.longitude })
    setMapScale(17)
  }

  const navigateToMapFood = async (spot: typeof mapSpots[number]) => {
    try {
      await Taro.openLocation({
        latitude: spot.latitude,
        longitude: spot.longitude,
        name: spot.locationName || foodMapPlace(spot.featuredItem),
        address: spot.address || spot.featuredItem.campus_location_text || spot.featuredItem.merchant_address || '',
        scale: 18,
      })
    } catch (e: any) {
      await showUnifiedApiError(e, '无法打开导航')
    }
  }

  const searchMapFoodDelivery = async (item: PublicFoodLibraryItem) => {
    const keyword = [item.merchant_name || item.canteen_name, foodMapTitle(item)]
      .filter(Boolean)
      .join(' ')
    try {
      await Taro.setClipboardData({ data: keyword })
      await Taro.showModal({
        title: '外卖关键词已复制',
        content: `可打开常用外卖平台搜索“${keyword}”。后续接入官方跳转后，可以从这里直接下单。`,
        showCancel: false,
        confirmText: '知道了',
      })
    } catch (e: any) {
      await showUnifiedApiError(e, '复制外卖关键词失败')
    }
  }

  const pickForRecord = (item: PublicFoodLibraryItem) => {
    const pickedText = item.food_name
      || item.description
      || item.items?.map((food) => food.name).filter(Boolean).slice(0, 4).join('、')
      || '健康餐'
    Taro.setStorageSync(RECORD_TEXT_LIBRARY_SELECTION_KEY, {
      text: pickedText,
      source: 'public_food_library'
    })
    Taro.showToast({ title: '已带回文字记录', icon: 'success' })
    setTimeout(() => {
      Taro.navigateBack()
    }, 250)
  }

  // 跳转分享页
  const goShare = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/food-contribution/index?focus=public') })
  }

  const goLightFood = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/food-library-share/index?task_mode=contribution&map_light=1') })
  }

  const showMapFoodActions = async (item: PublicFoodLibraryItem) => {
    try {
      const { tapIndex } = await Taro.showActionSheet({ itemList: ['复制外卖搜索词', '补充餐食', '反馈问题'] })
      if (tapIndex === 0) await searchMapFoodDelivery(item)
      if (tapIndex === 1) goLightFood()
      if (tapIndex === 2) await handleFeedback()
    } catch (_) {
      // 用户取消操作菜单时不弹错误。
    }
  }

  // 提交反馈
  const handleFeedback = async () => {
    const modalResult = await Taro.showModal({
      title: '提交反馈',
      content: '',
      editable: true,
      placeholderText: '请描述您认为不准确的地方，我们会认真处理…',
      confirmText: '提交',
      cancelText: '取消',
      confirmColor: '#00bc7d',
    } as any)
    const { confirm } = modalResult
    const content = String((modalResult as any).content || '')
    if (!confirm || !content || !content.trim()) return

    Taro.showLoading({ title: '提交中...', mask: true })
    try {
      await submitStructuredFeedback({
        source: 'food_library',
        content: content.trim(),
        extra: {
          page: 'food_library',
          tab_mode: tabMode,
          sort_by: sortBy,
          filter_fat_loss: filterFatLoss ?? null,
          search_keyword: searchKeyword || null,
          search_merchant: searchMerchant || null,
        },
      })
      Taro.showToast({ title: '反馈已提交', icon: 'success' })
    } catch (e: any) {
      await showUnifiedApiError(e, '提交失败')
    } finally {
      Taro.hideLoading()
    }
  }

  // 跳转登录
  const goLogin = () => {
    Taro.switchTab({ url: '/pages/profile/index' })
  }

  if (!loggedIn) {
    return (
      <FlPageThemeRoot>
      <View className='food-library-page'>
        {fromRecord && (
          <View className='pick-mode-tip'>
            <Text className='pick-mode-title'>从美食图谱选择</Text>
            <Text className='pick-mode-subtitle'>点任意餐食卡片，可直接带回到文字记录里</Text>
          </View>
        )}
        <View className='login-tip'>
          <Text className='login-tip-text'>{fromRecord ? '登录后才能从美食图谱带回记录' : '登录后查看美食图谱'}</Text>
          <Button className='login-tip-btn' onClick={goLogin}>去登录</Button>
        </View>
      </View>
      </FlPageThemeRoot>
    )
  }

  const displayList = spotDishes && tabMode === 'all' ? spotDishes.items : tabMode === 'all' ? list : tabMode === 'campus' ? campusList : tabMode === 'mine' ? mineList : collectionList
  const isLoading = spotDishes && tabMode === 'all' ? spotDishes.loading : tabMode === 'all' ? loading : tabMode === 'campus' ? campusLoading : tabMode === 'mine' ? mineLoading : collectionLoading

  return (
    <FlPageThemeRoot>
    <View className='food-library-page food-library-page--place-first'>
      {fromRecord && (
        <View className='pick-mode-tip'>
          <Text className='pick-mode-title'>从美食图谱选择</Text>
          <Text className='pick-mode-subtitle'>点任意餐食卡片，可直接带回到文字记录里</Text>
        </View>
      )}
      {/* Tab：全部 / 校园食堂 / 收藏夹 / 我上传的 */}
      <View className='tab-section'>
        <View
          className={`tab-item ${tabMode === 'all' ? 'active' : ''}`}
          onClick={() => setTabMode('all')}
        >
          全部
        </View>
        <View
          className={`tab-item ${tabMode === 'campus' ? 'active' : ''}`}
          onClick={() => {
            setTabMode('campus')
            loadCampusList(true)
          }}
        >
          食堂
        </View>
        <View
          className={`tab-item ${tabMode === 'collections' ? 'active' : ''}`}
          onClick={() => {
            setTabMode('collections')
            loadCollectionList(true)
          }}
        >
          收藏夹
        </View>
        <View
          className={`tab-item ${tabMode === 'mine' ? 'active' : ''}`}
          onClick={() => {
            setTabMode('mine')
            loadMineList(true)
          }}
        >
          我上传的
        </View>
      </View>

      {tabMode === 'all' && (
        <View className='atlas-toolbar'>
          <View className='search-input-wrap'>
            <Text className='search-input-icon iconfont icon-search' />
            <Input
              className='search-input'
              placeholder='搜餐食、商家'
              confirmType='search'
              value={searchKeyword}
              onInput={e => setSearchKeyword(e.detail.value)}
              onConfirm={() => handleSearch()}
            />
            {searchKeyword && (
              <Button className='atlas-search-clear' aria-label='清除搜索' onClick={() => handleSearch('')}>
                <Text className='iconfont icon-close' />
              </Button>
            )}
          </View>
          {fromRecord ? (
            <Button className='search-btn' onClick={() => handleSearch()}>搜索</Button>
          ) : <View className='view-mode-switch'>
            <View
              className={`view-mode-option ${viewMode === 'map' ? 'active' : ''}`}
              onClick={() => setViewMode('map')}
            >
              地图
            </View>
            <View
              className={`view-mode-option ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
            >
              列表
            </View>
          </View>}
        </View>
      )}

      {spotDishes && tabMode === 'all' && viewMode === 'list' && (
        <View className='sort-section spot-dish-bar'>
          <Text className='sort-item spot-dish-bar-title'>{spotDishes.title} · {spotDishes.foodCount} 道</Text>
          <View className='sort-item spot-dish-bar-back' onClick={() => setViewMode('map')}>返回地图</View>
        </View>
      )}

      {/* 排序区（仅全部时显示） */}
      {tabMode === 'all' && viewMode === 'list' && !spotDishes && (
        <View className='sort-section'>
          <View className='sort-left'>
            <View
              className={`sort-item ${sortBy === 'latest' ? 'active' : ''}`}
              onClick={() => { setSortBy('latest'); refreshList({ sortBy: 'latest', filterFatLoss, searchMerchant }) }}
            >
              最新
            </View>
            <View
              className={`sort-item ${sortBy === 'hot' ? 'active' : ''}`}
              onClick={() => { setSortBy('hot'); refreshList({ sortBy: 'hot', filterFatLoss, searchMerchant }) }}
            >
              最热
            </View>
            <View
              className={`sort-item ${sortBy === 'rating' ? 'active' : ''}`}
              onClick={() => { setSortBy('rating'); refreshList({ sortBy: 'rating', filterFatLoss, searchMerchant }) }}
            >
              评分
            </View>
          </View>
          <View className='sort-filter-btn' onClick={() => setShowFilterPanel(v => !v)}>
            <Text className='sort-filter-icon iconfont icon-filter-filling' />
            <Text className='sort-filter-text'>筛选</Text>
          </View>
        </View>
      )}

      {/* 筛选下拉面板 */}
      {tabMode === 'all' && viewMode === 'list' && !spotDishes && showFilterPanel && (
        <View className='filter-dropdown-panel'>
          <View className='filter-dropdown-row'>
            <Text className='filter-dropdown-label'>类型</Text>
            <View className='filter-dropdown-options'>
              <View
                className={`filter-dropdown-option ${filterFatLoss === undefined ? 'active' : ''}`}
                onClick={() => { setFilterFatLoss(undefined); setShowFilterPanel(false); refreshList({ sortBy, filterFatLoss: undefined, searchMerchant }) }}
              >
                全部
              </View>
              <View
                className={`filter-dropdown-option ${filterFatLoss === true ? 'active' : ''}`}
                onClick={() => { setFilterFatLoss(true); setShowFilterPanel(false); refreshList({ sortBy, filterFatLoss: true, searchMerchant }) }}
              >
                适合减脂
              </View>
            </View>
          </View>
        </View>
      )}

      {tabMode === 'all' && viewMode === 'map' && !fromRecord ? (
        <View className='food-map-experience'>
          <View className='food-map-wrap'>
            <Map
              id={FOOD_MAP_ID}
              className='food-map'
              latitude={mapCenter.latitude}
              longitude={mapCenter.longitude}
              scale={mapScale}
              minScale={FOOD_MAP_MIN_SCALE}
              markers={mapMarkers}
              showLocation
              enableRotate={false}
              enableOverlooking={false}
              onMarkerTap={e => selectMapSpot(e.detail.markerId)}
              onCallOutTap={e => selectMapSpot(e.detail.markerId)}
              onRegionChange={handleMapRegionChange}
              onError={() => {}}
            />
            {mapLoading && (
              <View className='map-loading-mask'>
                <View className='loading-spinner-md' />
              </View>
            )}

            <View className='atlas-map-tools'>
              <Button className='atlas-map-tool' aria-label='补充地图餐食' onClick={goLightFood}><Plus /></Button>
              <Button className='atlas-map-tool map-locate-button' aria-label='定位到我附近' disabled={mapLocating} onClick={() => void locateMapAroundMe()}>
                {mapLocating ? <View className='map-locate-spinner' /> : <Text className='iconfont icon-dizhi' />}
              </Button>
            </View>

            {!mapLoading && !mapError && selectedMapSpot && (
              <View className='map-food-sheet' onClick={() => openMapSpot(selectedMapSpot)}>
                <View className='map-food-sheet-main'>
                  <View className='map-food-sheet-image-wrap'>
                    {foodMapImage(selectedMapSpot.featuredItem) ? (
                      <Image className='map-food-sheet-image' src={foodMapImage(selectedMapSpot.featuredItem)} mode='aspectFill' />
                    ) : (
                      <View className='map-food-sheet-placeholder'><Text className='iconfont icon-shiwu' /></View>
                    )}
                    {selectedMapSpot.foodCount > 1 && (
                      <Text className='map-food-count'>{selectedMapSpot.foodCount} 道</Text>
                    )}
                  </View>
                  <View className='map-food-sheet-copy'>
                    <View className='map-food-sheet-heading'>
                      <Text className='map-food-sheet-title'>{selectedMapSpot.locationName || foodMapPlace(selectedMapSpot.featuredItem)}</Text>
                      <Button className='map-food-more' aria-label='更多餐食操作' onClick={(e) => { e.stopPropagation(); void showMapFoodActions(selectedMapSpot.featuredItem) }}><Ellipsis /></Button>
                    </View>
                    <Text className='map-food-sheet-place'>
                      {[selectedMapSpot.featuredItem.school_name || selectedMapSpot.address,
                        selectedMapSpot.distanceKm != null ? `距你 ${formatFoodMapDistance(selectedMapSpot.distanceKm)}` : '位置来自收录']
                        .filter(Boolean).join(' · ')}
                    </Text>
                    <Text className='map-food-sheet-dish'>{foodMapTitle(selectedMapSpot.featuredItem)} · {foodPrice(selectedMapSpot.featuredItem)}</Text>
                  </View>
                </View>
                <View className='map-food-sheet-actions'>
                  <View
                    className='map-food-action map-food-action--secondary'
                    onClick={(e) => { e.stopPropagation(); openMapSpot(selectedMapSpot) }}
                  >
                    {mapSpotDishesLabel(selectedMapSpot.foodCount)}
                  </View>
                  <View
                    className='map-food-action map-food-action--primary'
                    onClick={(e) => { e.stopPropagation(); void navigateToMapFood(selectedMapSpot) }}
                  >
                    <Text className='iconfont icon-dizhi' />
                    {selectedMapSpot.locationLevel === 'school'
                      ? '导航到学校'
                      : selectedMapSpot.locationLevel === 'canteen'
                        ? '导航到食堂'
                        : selectedMapSpot.locationLevel === 'campus'
                          ? '导航到校区'
                          : '导航去吃'}
                  </View>
                </View>
              </View>
            )}

            {!mapLoading && mapError && (
              <View className='map-discovery-sheet'>
                <Text className='map-discovery-title'>地点暂时未取到</Text>
                <Button className='map-discovery-button' onClick={() => void loadMapList(true)}>重试</Button>
                <Button className='map-discovery-button' onClick={() => setViewMode('list')}>看列表</Button>
              </View>
            )}

            {!mapLoading && !mapError && !selectedMapSpot && (
              <View className='map-discovery-sheet'>
                <View className='map-discovery-copy'>
                  <Text className='map-discovery-title'>
                    {mapSpots.length > 0 && (!userLocation || nearbySpotCount > 0)
                      ? '点数字放大，点标记看餐食'
                      : mapSpots.length > 0 ? '附近暂无收录地点' : '地图暂无收录地点'}
                  </Text>
                </View>
                {mapSpots.length > 0 ? (
                  <Button className='map-discovery-button' onClick={focusNearestMapSpot}>看地点</Button>
                ) : (
                  <Button className='map-discovery-button' onClick={() => setViewMode('list')}>看列表</Button>
                )}
              </View>
            )}
          </View>
        </View>
      ) : (
      /* 列表 */
      <ScrollView
        className='list-scroll'
        scrollY
        enhanced
        showScrollbar={false}
        refresherEnabled
        refresherTriggered={refreshing}
        onRefresherRefresh={handleRefresherRefresh}
        refresherDefaultStyle='black'
        onScrollToLower={loadMoreSpotDishes}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <View className='list-content'>
          {tabMode === 'all' && showSkeleton ? (
            // 骨架屏
            <View className='skeleton-container'>
              {[1, 2, 3].map(i => (
                <View key={i} className='skeleton-food-card'>
                  <View className='skeleton-main'>
                    <View className='skeleton-image' />
                    <View className='skeleton-info'>
                      <View className='skeleton-line' style={{ width: '70%', height: '32rpx', marginBottom: '16rpx' }} />
                      <View className='skeleton-line' style={{ width: '90%', height: '24rpx', marginBottom: '12rpx' }} />
                      <View className='skeleton-line' style={{ width: '40%', height: '28rpx', marginTop: 'auto' }} />
                    </View>
                  </View>
                  <View className='skeleton-footer'>
                    <View className='skeleton-line' style={{ width: '120rpx', height: '24rpx' }} />
                    <View className='skeleton-line' style={{ width: '200rpx', height: '24rpx' }} />
                  </View>
                </View>
              ))}
            </View>
          ) : isLoading && displayList.length === 0 ? (
            <View className='loading-state'>
              <View className='loading-spinner-md' />
            </View>
          ) : tabMode === 'all' && (spotDishes ? spotDishes.error : listError) && displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-text'>餐食暂时未取到</Text>
              <Button className='empty-btn' onClick={() => void (spotDishes ? loadSpotDishes(spotDishes, []) : loadList(false, true))}>重试</Button>
            </View>
          ) : tabMode === 'collections' && displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shoucang-yishoucang' />
              <Text className='empty-text'>暂无收藏，去逛逛收藏喜欢的餐食</Text>
              <View className='empty-btn' onClick={() => setTabMode('all')}>去逛逛</View>
            </View>
          ) : tabMode === 'campus' && displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shiwu' />
              <Text className='empty-text'>暂未取得食堂菜品</Text>
              <View className='empty-btn' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/campus-canteen/index') })}>浏览校园与社区食堂</View>
            </View>
          ) : tabMode === 'mine' && displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shiwu' />
              <Text className='empty-text'>暂无上传，快来分享第一份健康餐吧</Text>
              <View className='empty-btn' onClick={goShare}>去分享</View>
            </View>
          ) : displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shiwu' />
              <Text className='empty-text'>{searchMerchant || filterFatLoss ? '没有找到匹配的餐食' : '暂未收录餐食'}</Text>
              {searchMerchant || filterFatLoss ? (
                <View className='empty-btn' onClick={() => {
                  setSearchKeyword(''); setSearchMerchant(''); setFilterFatLoss(undefined)
                  void refreshList({ sortBy })
                }}
                >清除筛选</View>
              ) : <View className='empty-btn' onClick={goShare}>补充餐食</View>}
            </View>
          ) : (
          displayList.map((item) => {
            const isOwner = Boolean(currentUserId && item.user_id === currentUserId)
            const campusFood = isCampusFoodItem(item)
            const nutritionAvailable = hasDisplayableNutrition(item)
            const officialAuthor = !String(item.user_id || '').trim() && item.author?.nickname === '食探官方'
            return (
              <View
                key={item.id}
                className={`food-card ${fromRecord ? 'is-pick-mode' : ''}`}
                onClick={() => (fromRecord ? pickForRecord(item) : goDetail(item.id))}
              >
                <View className='food-card-main'>
                  <View className='food-image-wrap'>
                    {foodMapImage(item) ? (
                      <Image className='food-image' src={foodMapImage(item)} mode='aspectFill' />
                    ) : (
                      <View className='food-image-placeholder'><Text className='iconfont icon-shiwu' /><Text>暂无餐照</Text></View>
                    )}
                    {item.suitable_for_fat_loss && (
                      <View className='fat-loss-badge'>适合减脂</View>
                    )}
                    {campusFood && (
                      <View className='campus-food-badge'>{canteenBadge(item)}</View>
                    )}
                  </View>
                  <View className='food-info'>
                    <Text className='food-title'>{item.food_name || item.description || '健康餐'}</Text>
                    {!campusFood && (
                      <View className='food-merchant'>
                        <Text className='merchant-icon iconfont icon-shiwu' />
                        <Text className='merchant-name'>{item.merchant_name || item.detail_address || item.merchant_address || '地点待补充'}</Text>
                      </View>
                    )}
                    {campusFood && <Text className='campus-food-location'>{campusLocation(item) || item.merchant_name || item.detail_address || item.merchant_address || '地点待补充'}</Text>}
                    <Text className='atlas-food-price'>{foodPrice(item)}</Text>
                    <Text className={`atlas-food-nutrition${nutritionAvailable ? '' : ' food-nutrition-unavailable'}`}>
                      {nutritionAvailable ? `${item.total_calories.toFixed(0)} kcal · 蛋白 ${item.total_protein.toFixed(0)}g` : '营养待补充'}
                    </Text>
                  </View>
                </View>
                <View className='food-footer'>
                  <View className='food-author'>
                    {!officialAuthor && item.author?.avatar ? (
                      <View
                        className='author-avatar'
                        onClick={(e) => {
                          e.stopPropagation()
                          if (item.author?.id) {
                            Taro.navigateTo({ url: extraPkgUrl(`/pages/profile-settings/index?user_id=${encodeURIComponent(item.author.id)}`) })
                          }
                        }}
                      >
                        <Image className='author-avatar-img' src={item.author.avatar} />
                      </View>
                    ) : null}
                    <Text
                      className={`author-name ${officialAuthor ? 'author-name--official' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (item.author?.id) {
                          Taro.navigateTo({ url: extraPkgUrl(`/pages/profile-settings/index?user_id=${encodeURIComponent(item.author.id)}`) })
                        }
                      }}
                    >{item.author?.nickname || '用户'}</Text>
                  </View>
                  <View className='food-stats'>
                    <View
                      className='stat-item'
                      onClick={e => { e.stopPropagation(); handleLike(item) }}
                    >
                      <Text className={`stat-icon iconfont icon-good ${item.liked ? 'liked' : ''}`} />
                      <Text className='stat-count'>{item.like_count}</Text>
                    </View>
                    <View
                      className='stat-item'
                      onClick={e => handleCollect(e, item)}
                    >
                      <Text className={`stat-icon iconfont ${item.collected ? 'icon-collection_fill collected' : 'icon-collection'}`} />
                      <Text className='stat-count'>{item.collection_count || 0}</Text>
                    </View>
                    <View className='stat-item'>
                      <Text className='stat-icon iconfont icon-comment' />
                      {(item.comment_count || 0) > 0 && (
                        <Text className='stat-count'>{item.comment_count}</Text>
                      )}
                    </View>
                    {item.avg_rating > 0 && (
                      <View className='stat-item'>
                        <Text className='stat-icon iconfont icon-shoucang-yishoucang' />
                        <Text className='stat-count'>{item.avg_rating.toFixed(1)}</Text>
                      </View>
                    )}
                    {isOwner && (
                      <View
                        className='stat-item delete-stat'
                        onClick={e => handleDelete(e, item)}
                      >
                        <Text className='stat-icon iconfont icon-shanchu delete-stat-icon' />
                      </View>
                    )}
                  </View>
                </View>
              </View>
            )
          })
          )}
          {spotDishes?.loading && spotDishes.items.length > 0 && (
            <View className='loading-state'>
              <View className='loading-spinner-md' />
            </View>
          )}
        </View>
      </ScrollView>
      )}

      {/* 浮动分享按钮 */}
      {(viewMode !== 'map' || tabMode !== 'all' || fromRecord) && (
        <Button className='fab-button' aria-label='补充餐食' onClick={goShare}><Plus /></Button>
      )}
    </View>
    </FlPageThemeRoot>
  )
}

export default withAuth(FoodLibraryPage)
