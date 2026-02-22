import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAccessToken,
  getPublicFoodLibraryList,
  getPublicFoodLibraryCollections,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  collectPublicFoodLibraryItem,
  uncollectPublicFoodLibraryItem,
  type PublicFoodLibraryItem
} from '../../utils/api'
import { Star, StarOutlined } from '@taroify/icons'
import { Divider } from '@taroify/core'
import '@taroify/core/divider/style'
import './index.scss'

// 缓存键名常量
const CACHE_KEYS = {
  LIST: 'food_library_list_cache',
  TIMESTAMP: 'food_library_timestamp',
  FILTERS: 'food_library_filters_cache' // 缓存筛选条件
}

// 缓存有效期（5分钟）
const CACHE_DURATION = 5 * 60 * 1000

type TabMode = 'all' | 'collections'

export default function FoodLibraryPage() {
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

  // 性能优化相关状态
  const [refreshing, setRefreshing] = useState(false)
  const [isFirstLoad, setIsFirstLoad] = useState(true)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const lastRefreshTime = useRef<number>(0)

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

  // 筛选条件变化时刷新（仅全部列表）
  useEffect(() => {
    if (loggedIn && tabMode === 'all') {
      clearCache()
      loadList(false, true)
    }
  }, [sortBy, filterFatLoss, searchMerchant, loggedIn, tabMode])

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
    setSearchMerchant(searchKeyword.trim())
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
    Taro.navigateTo({ url: `/pages/food-library-detail/index?id=${itemId}` })
  }

  // 跳转分享页
  const goShare = () => {
    Taro.navigateTo({ url: '/pages/food-library-share/index' })
  }

  // 跳转登录
  const goLogin = () => {
    Taro.switchTab({ url: '/pages/profile/index' })
  }

  if (!loggedIn) {
    return (
      <View className="food-library-page">
        <View className="login-tip">
          <Text className="login-tip-text">登录后查看公共食物库</Text>
          <Button className="login-tip-btn" onClick={goLogin}>去登录</Button>
        </View>
      </View>
    )
  }

  const displayList = tabMode === 'all' ? list : collectionList
  const isLoading = tabMode === 'all' ? loading : collectionLoading

  return (
    <View className="food-library-page">
      {/* Tab：全部 / 收藏夹 */}
      <View className="tab-section">
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
        <View className="filter-section">
          <View className="filter-row">
            <View
              className={`filter-tag ${filterFatLoss === undefined ? 'active' : ''}`}
              onClick={() => setFilterFatLoss(undefined)}
            >
              全部
            </View>
            <View
              className={`filter-tag ${filterFatLoss === true ? 'active' : ''}`}
              onClick={() => setFilterFatLoss(true)}
            >
              适合减脂
            </View>
          </View>
          <View className="search-row">
            <Input
              className="search-input"
              placeholder="搜索商家名称"
              value={searchKeyword}
              onInput={e => setSearchKeyword(e.detail.value)}
              onConfirm={handleSearch}
            />
            <Button className="search-btn" onClick={handleSearch}>搜索</Button>
          </View>
        </View>
      )}

      {/* 排序区（仅全部时显示） */}
      {tabMode === 'all' && (
        <View className="sort-section">
          <View
            className={`sort-item ${sortBy === 'latest' ? 'active' : ''}`}
            onClick={() => setSortBy('latest')}
          >
            最新
          </View>
          <View
            className={`sort-item ${sortBy === 'hot' ? 'active' : ''}`}
            onClick={() => setSortBy('hot')}
          >
            最热
          </View>
          <View
            className={`sort-item ${sortBy === 'rating' ? 'active' : ''}`}
            onClick={() => setSortBy('rating')}
          >
            评分
          </View>
        </View>
      )}

      {/* 列表 */}
      <ScrollView
        className="list-scroll"
        scrollY
        enhanced
        showScrollbar={false}
        refresherEnabled
        refresherTriggered={refreshing}
        onRefresherRefresh={handleRefresherRefresh}
        refresherDefaultStyle='black'
      >
        <View className="list-content">
          <Divider className="refresh-divider">下拉刷新</Divider>
          {tabMode === 'all' && showSkeleton ? (
            // 骨架屏
            <View className="skeleton-container">
              {[1, 2, 3].map(i => (
                <View key={i} className="skeleton-food-card">
                  <View className="skeleton-image" />
                  <View className="skeleton-info">
                    <View className="skeleton-line" style={{ width: '60%', height: '32rpx', marginBottom: '16rpx' }} />
                    <View className="skeleton-line" style={{ width: '100%', height: '24rpx', marginBottom: '12rpx' }} />
                    <View className="skeleton-line" style={{ width: '80%', height: '24rpx' }} />
                  </View>
                </View>
              ))}
            </View>
          ) : isLoading && displayList.length === 0 ? (
            <View className="loading-state">
              <Text className="loading-text">加载中...</Text>
            </View>
          ) : tabMode === 'collections' && displayList.length === 0 ? (
            <View className="empty-state">
              <Text className="empty-icon iconfont icon-shoucang-yishoucang" />
              <Text className="empty-text">暂无收藏，去逛逛收藏喜欢的餐食</Text>
              <View className="empty-btn" onClick={() => setTabMode('all')}>去逛逛</View>
            </View>
          ) : displayList.length === 0 ? (
            <View className="empty-state">
              <Text className="empty-icon iconfont icon-shiwu" />
              <Text className="empty-text">暂无内容，快来分享第一份健康餐吧</Text>
              <View className="empty-btn" onClick={goShare}>去分享</View>
            </View>
          ) : (
            displayList.map(item => (
              <View key={item.id} className="food-card" onClick={() => goDetail(item.id)}>
                <View className="food-image-wrap">
                  {item.image_path ? (
                    <Image className="food-image" src={item.image_path} mode="aspectFill" />
                  ) : (
                    <View className="food-image-placeholder">暂无图片</View>
                  )}
                  {item.suitable_for_fat_loss && (
                    <View className="fat-loss-badge">适合减脂</View>
                  )}
                </View>
                <View className="food-info">
                  <View className="food-header">
                    <Text className="food-title">{item.food_name || item.description || '健康餐'}</Text>
                    <Text className="food-calories">{item.total_calories.toFixed(0)} kcal</Text>
                  </View>
                  {item.description && (
                    <View className="food-description">
                      <Text className="description-text">{item.description}</Text>
                    </View>
                  )}
                  {item.merchant_name && (
                    <View className="food-merchant">
                      <Text className="merchant-icon iconfont icon-shiwu" />
                      <Text className="merchant-name">{item.merchant_name}</Text>
                      {item.taste_rating && item.taste_rating > 0 && (
                        <View className="taste-rating">
                          <Text className="rating-icon">★</Text>
                          <Text className="rating-text">{item.taste_rating}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  {(item.merchant_address || item.province || item.city) && (
                    <View className="food-location">
                      <Text className="location-icon iconfont icon-dizhi" />
                      <Text className="location-text">
                        {item.merchant_address ||
                          [item.province, item.city, item.district].filter(Boolean).join(' ')}
                      </Text>
                    </View>
                  )}
                  {item.user_tags && item.user_tags.length > 0 && (
                    <View className="food-tags">
                      {item.user_tags.slice(0, 3).map((tag, idx) => (
                        <Text key={idx} className="food-tag">{tag}</Text>
                      ))}
                    </View>
                  )}
                  <View className="food-footer">
                    <View className="food-author">
                      {item.author?.avatar ? (
                        <View className="author-avatar">
                          <Image className="author-avatar-img" src={item.author.avatar} />
                        </View>
                      ) : (
                        <View className="author-avatar" />
                      )}
                      <Text className="author-name">{item.author?.nickname || '用户'}</Text>
                    </View>
                    <View className="food-stats">
                      <View
                        className="stat-item"
                        onClick={e => { e.stopPropagation(); handleLike(item) }}
                      >
                        <Text className={`stat-icon iconfont icon-good ${item.liked ? 'liked' : ''}`} />
                        <Text className="stat-count">{item.like_count}</Text>
                      </View>
                      <View
                        className="stat-item"
                        onClick={e => handleCollect(e, item)}
                      >
                        {item.collected ? (
                          <Star size="16" style={{ color: '#fbbf24' }} />
                        ) : (
                          <StarOutlined size="16" color="#6b7280" />
                        )}
                        <Text className="stat-count">{item.collection_count || 0}</Text>
                      </View>
                      <View className="stat-item">
                        <Text className="stat-icon iconfont icon-pinglun" />
                        <Text className="stat-count">{item.comment_count}</Text>
                      </View>
                      {item.avg_rating > 0 && (
                        <View className="stat-item">
                          <Text className="stat-icon iconfont icon-shoucang-yishoucang" />
                          <Text className="stat-count">{item.avg_rating.toFixed(1)}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* 浮动分享按钮 */}
      <View className="fab-button" onClick={goShare}>
        <Text className="fab-icon">+</Text>
      </View>
    </View>
  )
}
