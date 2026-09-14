import { View, Text, ScrollView, Image, Input, Button, Map } from '@tarojs/components'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import {
  getAccessToken,
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
  type PublicFoodLibraryItem
} from '../../../utils/api'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import {
  buildFoodMapSpots,
  formatFoodMapDistance,
  type FoodMapLocation,
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
const DEFAULT_MAP_LOCATION: FoodMapLocation = { latitude: 39.9042, longitude: 116.4074 }
const FOOD_MAP_MARKER_ICON = '/assets/icons/food-map-marker.png'

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
  return item.type === 'campus' || !!item.is_campus_food
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

function foodMapAddress(item: PublicFoodLibraryItem): string {
  return item.detail_address
    || item.merchant_address
    || item.campus_location_text
    || [item.city, item.district, item.merchant_name].filter(Boolean).join(' ')
}

function foodMapImage(item: PublicFoodLibraryItem): string {
  return item.image_path || item.image_paths?.[0] || ''
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
  const [mapList, setMapList] = useState<PublicFoodLibraryItem[]>([])
  const [mapLoading, setMapLoading] = useState(false)
  const [mapLocating, setMapLocating] = useState(false)
  const [mapCenter, setMapCenter] = useState<FoodMapLocation>(DEFAULT_MAP_LOCATION)
  const [mapScale, setMapScale] = useState(14)
  const [userLocation, setUserLocation] = useState<FoodMapLocation | null>(null)
  const [selectedMapSpotKey, setSelectedMapSpotKey] = useState('')
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
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()
  const mapSpots = useMemo(() => buildFoodMapSpots(mapList, userLocation), [mapList, userLocation])
  const selectedMapSpot = useMemo(
    () => mapSpots.find(spot => spot.key === selectedMapSpotKey) || null,
    [mapSpots, selectedMapSpotKey],
  )
  const nearbySpotCount = useMemo(
    () => mapSpots.filter(spot => spot.distanceKm != null && spot.distanceKm <= 10).length,
    [mapSpots],
  )
  const mapMarkers = useMemo(() => mapSpots.map((spot, index) => ({
    id: index + 1,
    latitude: spot.latitude,
    longitude: spot.longitude,
    iconPath: FOOD_MAP_MARKER_ICON,
    width: selectedMapSpotKey === spot.key ? 52 : 44,
    height: selectedMapSpotKey === spot.key ? 52 : 44,
    zIndex: selectedMapSpotKey === spot.key ? 10 : 2,
    anchor: { x: 0.5, y: 1 },
    callout: {
      content: `${foodMapPlace(spot.featuredItem)}${spot.items.length > 1 ? ` · ${spot.items.length} 道` : ''}`,
      color: '#153129',
      fontSize: 12,
      anchorX: 0,
      anchorY: -4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#d5eee4',
      bgColor: '#ffffff',
      padding: 8,
      display: selectedMapSpotKey === spot.key ? 'ALWAYS' as const : 'BYCLICK' as const,
      textAlign: 'center' as const,
    },
  })), [mapSpots, selectedMapSpotKey])

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

          // 恢复筛选条件
          setSortBy(parsedFilters.sortBy || 'latest')
          setFilterFatLoss(parsedFilters.filterFatLoss)
          setSearchMerchant(parsedFilters.searchMerchant || '')

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
  const saveToCache = useCallback((listData: PublicFoodLibraryItem[]) => {
    try {
      // 只缓存前50条
      const dataToCache = listData.slice(0, 50)
      Taro.setStorageSync(CACHE_KEYS.LIST, JSON.stringify(dataToCache))
      Taro.setStorageSync(CACHE_KEYS.TIMESTAMP, Date.now().toString())

      // 缓存筛选条件
      Taro.setStorageSync(CACHE_KEYS.FILTERS, JSON.stringify({
        sortBy,
        filterFatLoss,
        searchMerchant
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

    try {
      const res = await getPublicFoodLibraryList({
        sort_by: sortBy,
        suitable_for_fat_loss: filterFatLoss,
        merchant_name: searchMerchant || undefined,
        limit: 50
      })
      const newList = res.list || []
      setList(newList)

      // 保存到缓存
      saveToCache(newList)

      // 更新刷新时间
      lastRefreshTime.current = Date.now()
    } catch (e: any) {
      console.error('加载公共食物库失败:', e)
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
    clearCache()
    lastRefreshTime.current = 0
    try {
      const res = await getPublicFoodLibraryList({
        sort_by: params.sortBy,
        suitable_for_fat_loss: params.filterFatLoss,
        merchant_name: params.searchMerchant || undefined,
        limit: 50
      })
      const newList = res.list || []
      setList(newList)
      saveToCache(newList)
      lastRefreshTime.current = Date.now()
    } catch (e: any) {
      console.error('加载公共食物库失败:', e)
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
      const res = await getPublicFoodLibraryList({ type: 'campus', limit: 50 })
      setCampusList(res.list || [])
    } catch (e: any) {
      await showUnifiedApiError(e, '加载校园食堂失败')
    } finally {
      setCampusLoading(false)
    }
  }, [])

  /** 加载可上图的公共餐食，并同时尝试定位到用户附近。 */
  const loadMapList = useCallback(async (force = false) => {
    if (!getAccessToken()) return
    if (!force && mapLoadedRef.current) return
    mapLoadedRef.current = true
    setMapLoading(true)
    setMapLocating(true)
    try {
      const [foodResult, locationResult] = await Promise.allSettled([
        getPublicFoodLibraryList({ has_location: true, sort_by: 'hot', limit: 100 }),
        Taro.getLocation({ type: 'gcj02' }),
      ])

      if (foodResult.status === 'rejected') throw foodResult.reason
      const mappedItems = foodResult.value.list || []
      setMapList(mappedItems)

      if (locationResult.status === 'fulfilled') {
        const location = {
          latitude: locationResult.value.latitude,
          longitude: locationResult.value.longitude,
        }
        setUserLocation(location)
        setMapCenter(location)
        setMapScale(15)
      } else {
        const firstMappedItem = mappedItems.find(item => item.latitude != null && item.longitude != null)
        if (firstMappedItem) {
          setMapCenter({
            latitude: Number(firstMappedItem.latitude),
            longitude: Number(firstMappedItem.longitude),
          })
        }
      }
    } catch (e: any) {
      mapLoadedRef.current = false
      await showUnifiedApiError(e, '获取美食地图失败')
    } finally {
      setMapLoading(false)
      setMapLocating(false)
    }
  }, [])

  const locateMapAroundMe = useCallback(async () => {
    setMapLocating(true)
    try {
      const result = await Taro.getLocation({ type: 'gcj02' })
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
      } else {
        clearCache()
        loadList(false, true)
      }
    } else if (tabMode === 'campus') {
      loadCampusList(false)
    } else if (tabMode === 'mine') {
      loadMineList(false)
    }
  }, [loggedIn, tabMode, viewMode])

  // 下拉刷新处理
  const handleRefresherRefresh = useCallback(() => {
    if (!getAccessToken()) {
      setRefreshing(false)
      return
    }
    setRefreshing(true)
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
  const handleSearch = () => {
    const kw = searchKeyword.trim()
    setSearchMerchant(kw)
    refreshList({ sortBy, filterFatLoss, searchMerchant: kw })
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
    const spot = mapSpots[Number(markerId) - 1]
    if (!spot) return
    setSelectedMapSpotKey(spot.key)
    setMapCenter({ latitude: spot.latitude, longitude: spot.longitude })
    setMapScale(17)
  }

  const focusNearestMapSpot = () => {
    const spot = mapSpots[0]
    if (!spot) return
    setSelectedMapSpotKey(spot.key)
    setMapCenter({ latitude: spot.latitude, longitude: spot.longitude })
    setMapScale(17)
  }

  const navigateToMapFood = async (item: PublicFoodLibraryItem) => {
    if (item.latitude == null || item.longitude == null) return
    try {
      await Taro.openLocation({
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        name: foodMapPlace(item),
        address: foodMapAddress(item),
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
            <Text className='pick-mode-title'>从公共食物库选择</Text>
            <Text className='pick-mode-subtitle'>点任意餐食卡片，可直接带回到文字记录里</Text>
          </View>
        )}
        <View className='login-tip'>
          <Text className='login-tip-text'>{fromRecord ? '登录后才能从公共食物库带回记录' : '登录后查看公共食物库'}</Text>
          <Button className='login-tip-btn' onClick={goLogin}>去登录</Button>
        </View>
      </View>
      </FlPageThemeRoot>
    )
  }

  const displayList = tabMode === 'all' ? list : tabMode === 'campus' ? campusList : tabMode === 'mine' ? mineList : collectionList
  const isLoading = tabMode === 'all' ? loading : tabMode === 'campus' ? campusLoading : tabMode === 'mine' ? mineLoading : collectionLoading

  return (
    <FlPageThemeRoot>
    <View className='food-library-page'>
      {fromRecord && (
        <View className='pick-mode-tip'>
          <Text className='pick-mode-title'>从公共食物库选择</Text>
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
          校园食堂
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

      {tabMode === 'all' && !fromRecord && (
        <View className='discovery-header'>
          <View className='discovery-copy'>
            <Text className='discovery-eyebrow'>FOOD MAP</Text>
            <Text className='discovery-title'>点亮美食</Text>
            <Text className='discovery-subtitle'>看看附近被真实吃过的好味道</Text>
          </View>
          <View className='view-mode-switch'>
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
          </View>
        </View>
      )}

      {/* 筛选区（仅全部时显示） */}
      {tabMode === 'all' && viewMode === 'list' && (
        <View className='filter-section'>
          <View className='search-row'>
            <View className='search-input-wrap'>
              <Text className='search-input-icon iconfont icon-sousuo' />
              <Input
                className='search-input'
                placeholder='搜索商家名称或食物'
                value={searchKeyword}
                onInput={e => setSearchKeyword(e.detail.value)}
                onConfirm={handleSearch}
              />
            </View>
            <Button className='search-btn' onClick={handleSearch}>搜索</Button>
          </View>
        </View>
      )}

      {/* 排序区（仅全部时显示） */}
      {tabMode === 'all' && viewMode === 'list' && (
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
      {tabMode === 'all' && viewMode === 'list' && showFilterPanel && (
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
          <View className='map-summary-bar'>
            <View className='map-summary-copy'>
              <Text className='map-summary-title'>
                {userLocation ? `附近 ${nearbySpotCount} 个点亮地点` : `已点亮 ${mapSpots.length} 个地点`}
              </Text>
              <Text className='map-summary-meta'>全图共 {mapSpots.length} 个 · 点击标记看美食</Text>
            </View>
            <View className='map-locate-button' onClick={() => void locateMapAroundMe()}>
              {mapLocating ? <View className='map-locate-spinner' /> : <Text className='iconfont icon-dizhi' />}
              <Text>我附近</Text>
            </View>
          </View>
          <View className='food-map-wrap'>
            <Map
              className='food-map'
              latitude={mapCenter.latitude}
              longitude={mapCenter.longitude}
              scale={mapScale}
              markers={mapMarkers}
              showLocation
              enableRotate={false}
              enableOverlooking={false}
              onMarkerTap={e => selectMapSpot(e.detail.markerId)}
              onCallOutTap={e => selectMapSpot(e.detail.markerId)}
              onError={() => {}}
            />
            {mapLoading && (
              <View className='map-loading-mask'>
                <View className='loading-spinner-md' />
              </View>
            )}

            {!mapLoading && selectedMapSpot && (
              <View className='map-food-sheet' onClick={() => goDetail(selectedMapSpot.featuredItem.id)}>
                <View className='map-food-sheet-main'>
                  <View className='map-food-sheet-image-wrap'>
                    {foodMapImage(selectedMapSpot.featuredItem) ? (
                      <Image className='map-food-sheet-image' src={foodMapImage(selectedMapSpot.featuredItem)} mode='aspectFill' />
                    ) : (
                      <View className='map-food-sheet-placeholder'><Text className='iconfont icon-shiwu' /></View>
                    )}
                    {selectedMapSpot.items.length > 1 && (
                      <Text className='map-food-count'>{selectedMapSpot.items.length} 道</Text>
                    )}
                  </View>
                  <View className='map-food-sheet-copy'>
                    <Text className='map-food-sheet-title'>{foodMapTitle(selectedMapSpot.featuredItem)}</Text>
                    <Text className='map-food-sheet-place'>{foodMapPlace(selectedMapSpot.featuredItem)}</Text>
                    <View className='map-food-sheet-meta'>
                      {selectedMapSpot.distanceKm != null && (
                        <Text className='map-food-distance'>距你 {formatFoodMapDistance(selectedMapSpot.distanceKm)}</Text>
                      )}
                      <Text>{selectedMapSpot.featuredItem.total_calories.toFixed(0)} kcal</Text>
                    </View>
                  </View>
                </View>
                <View className='map-food-sheet-actions'>
                  <View
                    className='map-food-action map-food-action--secondary'
                    onClick={(e) => { e.stopPropagation(); void searchMapFoodDelivery(selectedMapSpot.featuredItem) }}
                  >
                    搜外卖
                  </View>
                  <View
                    className='map-food-action map-food-action--primary'
                    onClick={(e) => { e.stopPropagation(); void navigateToMapFood(selectedMapSpot.featuredItem) }}
                  >
                    <Text className='iconfont icon-dizhi' />
                    导航去吃
                  </View>
                </View>
              </View>
            )}

            {!mapLoading && !selectedMapSpot && (
              <View className='map-discovery-sheet'>
                <View className='map-discovery-icon'><Text>✦</Text></View>
                <View className='map-discovery-copy'>
                  <Text className='map-discovery-title'>
                    {mapSpots.length > 0 && (!userLocation || nearbySpotCount > 0)
                      ? '点一个标记，看看这里有什么好吃的'
                      : '附近还没有被点亮的美食'}
                  </Text>
                  <Text className='map-discovery-subtitle'>
                    {mapSpots.length > 0 ? '可以看看已点亮地点，或成为第一个分享的人' : '拍下你吃过的一餐，让这张地图从这里亮起来'}
                  </Text>
                </View>
                {mapSpots.length > 0 ? (
                  <View className='map-discovery-button' onClick={focusNearestMapSpot}>看已点亮</View>
                ) : (
                  <View className='map-discovery-button' onClick={goLightFood}>点亮一家</View>
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
          ) : tabMode === 'collections' && displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shoucang-yishoucang' />
              <Text className='empty-text'>暂无收藏，去逛逛收藏喜欢的餐食</Text>
              <View className='empty-btn' onClick={() => setTabMode('all')}>去逛逛</View>
            </View>
          ) : tabMode === 'campus' && displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shiwu' />
              <Text className='empty-text'>暂无校园食堂数据</Text>
              <View className='empty-btn' onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/campus-canteen/index') })}>去校园专区</View>
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
              <Text className='empty-text'>暂无内容，快来分享第一份健康餐吧</Text>
              <View className='empty-btn' onClick={goShare}>去分享</View>
            </View>
          ) : (
          displayList.map((item, index) => {
            const isOwner = Boolean(currentUserId && item.user_id === currentUserId)
            const campusFood = isCampusFoodItem(item)
            const officialAuthor = !String(item.user_id || '').trim() && item.author?.nickname === '食探官方'
            return (
              <View
                key={item.id}
                className={`food-card ${fromRecord ? 'is-pick-mode' : ''}`}
                onClick={() => (fromRecord ? pickForRecord(item) : goDetail(item.id))}
              >
                <View className='food-card-main'>
                  <View className='food-image-wrap'>
                    {item.image_path ? (
                      <Image className='food-image' src={item.image_path} mode='aspectFill' />
                    ) : (
                      <View className='food-image-placeholder'>暂无图片</View>
                    )}
                    {sortBy === 'latest' && index === 0 && (
                      <View className='card-badge-latest'>最新</View>
                    )}
                    {item.suitable_for_fat_loss && (
                      <View className='fat-loss-badge'>适合减脂</View>
                    )}
                    {campusFood && (
                      <View className='campus-food-badge'>校园食堂</View>
                    )}
                  </View>
                  <View className='food-info'>
                    <Text className='food-title'>{item.food_name || item.description || '健康餐'}</Text>
                    {item.description && item.food_name && !campusFood && (
                      <Text className='description-text'>{item.description}</Text>
                    )}
                    {item.merchant_name && !campusFood && (
                      <View className='food-merchant'>
                        <Text className='merchant-icon iconfont icon-shiwu' />
                        <Text className='merchant-name'>{item.merchant_name}</Text>
                      </View>
                    )}
                    {campusFood && (
                      <View className='campus-food-meta'>
                        <Text className='campus-food-location'>{campusLocation(item) || '校园食堂'}</Text>
                        <View className='campus-food-summary'>
                          <Text className='campus-food-nutrition'>蛋白 {item.total_protein.toFixed(0)}g</Text>
                          <Text className='campus-food-calories'>{item.total_calories.toFixed(0)} kcal</Text>
                        </View>
                      </View>
                    )}
                    {!campusFood && (
                      <Text className='food-calories'>{item.total_calories.toFixed(0)} kcal</Text>
                    )}
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
                    ) : !officialAuthor ? (
                      <View className='author-avatar' />
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
        </View>
      </ScrollView>
      )}

      {/* 浮动分享按钮 */}
      <View
        className={`fab-button ${viewMode === 'map' && tabMode === 'all' && !fromRecord ? 'fab-button--map' : ''}`}
        onClick={viewMode === 'map' && tabMode === 'all' && !fromRecord ? goLightFood : goShare}
      >
        {viewMode === 'map' && tabMode === 'all' && !fromRecord ? (
          <><Text className='fab-spark'>✦</Text><Text className='fab-map-text'>点亮一家</Text></>
        ) : (
          <Text className='fab-icon'>+</Text>
        )}
      </View>
    </View>
    </FlPageThemeRoot>
  )
}

export default withAuth(FoodLibraryPage)
