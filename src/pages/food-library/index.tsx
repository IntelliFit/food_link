import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAccessToken,
  getPublicFoodLibraryList,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  type PublicFoodLibraryItem
} from '../../utils/api'
import './index.scss'

export default function FoodLibraryPage() {
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken())
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<PublicFoodLibraryItem[]>([])
  const [sortBy, setSortBy] = useState<'latest' | 'hot' | 'rating'>('latest')
  const [filterFatLoss, setFilterFatLoss] = useState<boolean | undefined>(undefined)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchMerchant, setSearchMerchant] = useState('')

  // 加载列表
  const loadList = useCallback(async () => {
    if (!getAccessToken()) return
    setLoading(true)
    try {
      const res = await getPublicFoodLibraryList({
        sort_by: sortBy,
        suitable_for_fat_loss: filterFatLoss,
        merchant_name: searchMerchant || undefined,
        limit: 50
      })
      setList(res.list || [])
    } catch (e: any) {
      console.error('加载公共食物库失败:', e)
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [sortBy, filterFatLoss, searchMerchant])

  useDidShow(() => {
    setLoggedIn(!!getAccessToken())
    if (getAccessToken()) {
      loadList()
    }
  })

  useEffect(() => {
    if (loggedIn) {
      loadList()
    }
  }, [sortBy, filterFatLoss, loggedIn])

  // 搜索
  const handleSearch = () => {
    setSearchMerchant(searchKeyword.trim())
  }

  // 点赞/取消
  const handleLike = async (item: PublicFoodLibraryItem) => {
    try {
      if (item.liked) {
        await unlikePublicFoodLibraryItem(item.id)
        setList(prev => prev.map(it => it.id === item.id ? { ...it, liked: false, like_count: Math.max(0, it.like_count - 1) } : it))
      } else {
        await likePublicFoodLibraryItem(item.id)
        setList(prev => prev.map(it => it.id === item.id ? { ...it, liked: true, like_count: it.like_count + 1 } : it))
      }
    } catch (e: any) {
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

  return (
    <View className="food-library-page">
      {/* 筛选区 */}
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

      {/* 排序区 */}
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

      {/* 列表 */}
      <ScrollView className="list-scroll" scrollY enhanced showScrollbar={false}>
        <View className="list-content">
          {loading ? (
            <View className="loading-state">
              <Text className="loading-text">加载中...</Text>
            </View>
          ) : list.length === 0 ? (
            <View className="empty-state">
              <Text className="empty-icon">🍽️</Text>
              <Text className="empty-text">暂无内容，快来分享第一份健康餐吧</Text>
              <View className="empty-btn" onClick={goShare}>去分享</View>
            </View>
          ) : (
            list.map(item => (
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
                    <Text className="food-title">{item.description || '健康餐'}</Text>
                    <Text className="food-calories">{item.total_calories.toFixed(0)} kcal</Text>
                  </View>
                  {item.merchant_name && (
                    <View className="food-merchant">
                      <Text className="merchant-icon">🏪</Text>
                      <Text className="merchant-name">{item.merchant_name}</Text>
                    </View>
                  )}
                  {item.city && (
                    <View className="food-location">
                      <Text className="location-icon">📍</Text>
                      <Text className="location-text">{item.city}{item.district ? ` ${item.district}` : ''}</Text>
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
                        <Text className={`stat-icon ${item.liked ? 'liked' : ''}`}>
                          {item.liked ? '❤️' : '🤍'}
                        </Text>
                        <Text className="stat-count">{item.like_count}</Text>
                      </View>
                      <View className="stat-item">
                        <Text className="stat-icon">💬</Text>
                        <Text className="stat-count">{item.comment_count}</Text>
                      </View>
                      {item.avg_rating > 0 && (
                        <View className="stat-item">
                          <Text className="stat-icon">⭐</Text>
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
