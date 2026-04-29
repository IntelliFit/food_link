import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import {
  getAccessToken,
  getPublicFoodLibraryList,
  getPublicFoodLibraryCollections,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  collectPublicFoodLibraryItem,
  uncollectPublicFoodLibraryItem,
  submitPublicFoodLibraryFeedback,
  type PublicFoodLibraryItem
} from '../../../utils/api'
import { Star, StarOutlined } from '@taroify/icons'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'

// 缓存键名常量
const CACHE_KEYS = {
  LIST: 'food_library_list_cache',
  TIMESTAMP: 'food_library_timestamp',
  FILTERS: 'food_library_filters_cache' // 缓存筛选条件
}

// 缓存有效期（5分钟）
const CACHE_DURATION = 5 * 60 * 1000

type TabMode = 'all' | 'collections'
const RECORD_TEXT_LIBRARY_SELECTION_KEY = 'record_text_library_selection'

function FoodLibraryPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()
  const fromRecord = router.params.from === 'record'
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken())
  const [tabMode, setTabMode] = useState<TabMode>('all')
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<PublicFoodLibraryItem[]>([])
  const [collectionList, setCollectionList] = useState<PublicFoodLibraryItem[]>([])
  const [collectionLoading, setCollectionLoading] = useState(false)
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
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

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
        Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
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
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
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
      Taro.showToast({ title: e.message || '加载收藏失败', icon: 'none' })
    } finally {
      setCollectionLoading(false)
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
      } else {
        loadList(true, true)
      }
      return
    }

    if (tabMode === 'collections') {
      loadCollectionList(true)
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
    if (loggedIn && tabMode === 'all') {
      clearCache()
      loadList(false, true)
    }
  }, [loggedIn, tabMode])

  // 下拉刷新处理
  const handleRefresherRefresh = useCallback(() => {
    if (!getAccessToken()) {
      setRefreshing(false)
      return
    }
    setRefreshing(true)
    if (tabMode === 'collections') {
      loadCollectionList(true).finally(() => setRefreshing(false))
    } else {
      loadList(false, true)
    }
  }, [loadList, tabMode, loadCollectionList])

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
      Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  }

  // 收藏/取消（乐观更新）
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
      Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
    }
  }

  // 跳转详情
  const goDetail = (itemId: string) => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-detail/index')}?id=${itemId}` })
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
    Taro.navigateTo({ url: extraPkgUrl('/pages/food-library-share/index') })
  }

  // 提交反馈
  const handleFeedback = async () => {
    const { confirm, content } = await Taro.showModal({
      title: '提交反馈',
      content: '',
      editable: true,
      placeholderText: '请描述您认为不准确的地方，我们会认真处理…',
      confirmText: '提交',
      cancelText: '取消',
      confirmColor: '#00bc7d',
    })
    if (!confirm || !content || !content.trim()) return

    Taro.showLoading({ title: '提交中...', mask: true })
    try {
      await submitPublicFoodLibraryFeedback(content.trim())
      Taro.showToast({ title: '反馈已提交', icon: 'success' })
    } catch (e: any) {
      Taro.showToast({ title: e.message || '提交失败', icon: 'none' })
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
    )
  }

  const displayList = tabMode === 'all' ? list : collectionList
  const isLoading = tabMode === 'all' ? loading : collectionLoading

  return (
    <FlPageThemeRoot>
    <View className='food-library-page'>
      {fromRecord && (
        <View className='pick-mode-tip'>
          <Text className='pick-mode-title'>从公共食物库选择</Text>
          <Text className='pick-mode-subtitle'>点任意餐食卡片，可直接带回到文字记录里</Text>
        </View>
      )}
      {/* Tab：全部 / 收藏夹 */}
      <View className='tab-section'>
        <View
          className={`tab-item ${tabMode === 'all' ? 'active' : ''}`}
          onClick={() => setTabMode('all')}
        >
          全部
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
      </View>

      {/* 筛选区（仅全部时显示） */}
      {tabMode === 'all' && (
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
      {tabMode === 'all' && (
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
      {tabMode === 'all' && showFilterPanel && (
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

      {/* 列表 */}
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
          ) : displayList.length === 0 ? (
            <View className='empty-state'>
              <Text className='empty-icon iconfont icon-shiwu' />
              <Text className='empty-text'>暂无内容，快来分享第一份健康餐吧</Text>
              <View className='empty-btn' onClick={goShare}>去分享</View>
            </View>
          ) : (
            displayList.map((item, index) => (
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
                  </View>
                  <View className='food-info'>
                    <Text className='food-title'>{item.food_name || item.description || '健康餐'}</Text>
                    {item.description && item.food_name && (
                      <Text className='description-text'>{item.description}</Text>
                    )}
                    {item.merchant_name && (
                      <View className='food-merchant'>
                        <Text className='merchant-icon iconfont icon-shiwu' />
                        <Text className='merchant-name'>{item.merchant_name}</Text>
                      </View>
                    )}
                    <Text className='food-calories'>{item.total_calories.toFixed(0)} kcal</Text>
                  </View>
                </View>
                <View className='food-footer'>
                  <View className='food-author'>
                    {item.author?.avatar ? (
                      <View className='author-avatar'>
                        <Image className='author-avatar-img' src={item.author.avatar} />
                      </View>
                    ) : (
                      <View className='author-avatar' />
                    )}
                    <Text className='author-name'>{item.author?.nickname || '用户'}</Text>
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
                      {item.collected ? (
                        <Star size='16' style={{ color: '#fbbf24' }} />
                      ) : (
                        <StarOutlined size='16' color='#6b7280' />
                      )}
                      <Text className='stat-count'>{item.collection_count || 0}</Text>
                    </View>
                    <View className='stat-item'>
                      <Text className='stat-icon iconfont icon-pinglun' />
                      <Text className='stat-count'>{item.comment_count}</Text>
                    </View>
                    {item.avg_rating > 0 && (
                      <View className='stat-item'>
                        <Text className='stat-icon iconfont icon-shoucang-yishoucang' />
                        <Text className='stat-count'>{item.avg_rating.toFixed(1)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* 浮动分享按钮 */}
      <View className='fab-button' onClick={goShare}>
        <Text className='fab-icon'>+</Text>
      </View>
    </View>
    </FlPageThemeRoot>
  )
}

export default withAuth(FoodLibraryPage)
