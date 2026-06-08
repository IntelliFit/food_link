import { withAuth } from '../../../utils/withAuth'
import { View, Text, ScrollView, Image, Textarea, Swiper, SwiperItem } from '@tarojs/components'
import { useState, useEffect, useCallback, useRef } from 'react'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
import {
  getCampusFoodDetail,
  getPublicFoodLibraryItem,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  getPublicFoodLibraryComments,
  postPublicFoodLibraryComment,
  submitPublicFoodLibraryFeedback,
  showUnifiedApiError,
  type CampusFoodMetric,
  type CampusRelatedFeedItem,
  type PublicFoodLibraryItem,
  type PublicFoodLibraryComment,
  collectPublicFoodLibraryItem,
  uncollectPublicFoodLibraryItem,
  deletePublicFoodLibraryItem
} from '../../../utils/api'
import {
  ShopOutlined,
  LocationOutlined,
  GuideOutlined,
  Star,
  Like,
  LikeOutlined,
  CommentOutlined,
  Cross,
  StarOutlined,
  FireOutlined,
  UserOutlined
} from '@taroify/icons'
import '@taroify/icons/style'
import './index.scss'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'

function getLocalUserDisplay(): { nickname: string; avatar: string } {
  try {
    const raw = Taro.getStorageSync('userInfo')
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return {
      nickname: parsed?.name || parsed?.nickname || '用户',
      avatar: parsed?.avatar || ''
    }
  } catch {
    return { nickname: '用户', avatar: '' }
  }
}

function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return ''
  try {
    const d = new Date(timeStr)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return timeStr.slice(0, 16).replace('T', ' ')
  }
}

function fmtPriceDisplay(item: PublicFoodLibraryItem): string {
  if (item.price_type === 'unknown') return '价格待补充'
  if (item.price_type === 'range' && item.price_min != null && item.price_max != null) {
    return `${item.price_min}-${item.price_max}元`
  }
  if (item.price == null || item.price <= 0) return '价格待补充'
  const unit = item.price_unit || '元/份'
  return `${item.price}${unit.replace(/^\d+/, '')}`
}

function getCampusLocationText(item: PublicFoodLibraryItem): string {
  if (item.campus_location_text) return item.campus_location_text
  const parts = [
    item.school_name,
    item.campus_name,
    item.canteen_name,
    item.floor,
    item.window_name
  ].filter(Boolean)
  return parts.join(' · ') || '校园食堂'
}

function normalizeStatus(value?: string | null): string {
  return String(value || '').trim().toLowerCase()
}

function isAnalyzingItem(item: PublicFoodLibraryItem): boolean {
  const status = normalizeStatus(item.analysis_status)
  return status === 'pending' || status === 'processing'
}

function isAnalysisFailedItem(item: PublicFoodLibraryItem): boolean {
  const status = normalizeStatus(item.analysis_status)
  return status === 'failed' || status === 'timed_out'
}

function formatDateOnly(timeStr: string | null | undefined): string {
  if (!timeStr) return '待补充'
  return formatTime(timeStr).split(' ')[0] || '待补充'
}

function FoodLibraryDetailPage() {
  const router = useRouter()
  const itemId = router.params.id || ''
  const { scheme } = useAppColorScheme()

  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<PublicFoodLibraryItem | null>(null)
  const [comments, setComments] = useState<PublicFoodLibraryComment[]>([])
  const [showCommentModal, setShowCommentModal] = useState(false)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [commentContent, setCommentContent] = useState('')
  const [commentRating, setCommentRating] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [campusMetrics, setCampusMetrics] = useState<CampusFoodMetric>({})
  const [similarItems, setSimilarItems] = useState<PublicFoodLibraryItem[]>([])
  const [relatedFeeds, setRelatedFeeds] = useState<CampusRelatedFeedItem[]>([])
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null)
  const sceneRef = useRef(router.params.scene || '')

  // 加载详情
  useEffect(() => {
    if (!itemId) return
    loadDetail()
    loadComments()
  }, [itemId])

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  useShareAppMessage(() => {
    if (!item) return { title: '食探 - 发现健康餐' }
    const title = item.food_name || item.description || '来看看这道菜'
    const path = `${extraPkgUrl('/pages/food-library-detail/index')}?id=${item.id}${item.is_campus_food ? '&scene=campus' : ''}`
    const imageUrl = item.image_path || ''
    return { title, path, imageUrl }
  })

  // 分析中状态轮询：仅在详情页且当前 item 处于分析中时才轮询
  useEffect(() => {
    if (!item || !isAnalyzingItem(item)) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      return
    }
    if (pollTimerRef.current) return
    pollTimerRef.current = setInterval(() => {
      loadDetail()
    }, 8000)
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [item])

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setCurrentImageIndex(0)
    setCampusMetrics({})
    setSimilarItems([])
    setRelatedFeeds([])
    try {
      const shouldPreferCampus = sceneRef.current === 'campus'
      if (shouldPreferCampus) {
        const detail = await getCampusFoodDetail(itemId)
        setItem({ ...detail.item, ...detail.metrics })
        setCampusMetrics(detail.metrics || {})
        setSimilarItems(detail.similar_items || [])
        setRelatedFeeds(detail.related_feeds || [])
        return
      }
      const data = await getPublicFoodLibraryItem(itemId)
      if (data.is_campus_food) {
        const detail = await getCampusFoodDetail(itemId)
        setItem({ ...detail.item, ...detail.metrics })
        setCampusMetrics(detail.metrics || {})
        setSimilarItems(detail.similar_items || [])
        setRelatedFeeds(detail.related_feeds || [])
        return
      }
      setItem(data)
    } catch (e: any) {
      await showUnifiedApiError(e, '加载失败')
    } finally {
      setLoading(false)
    }
  }, [itemId])

  const loadComments = async () => {
    try {
      const res = await getPublicFoodLibraryComments(itemId)
      try {
        Taro.removeStorageSync(`temp_library_comments_${itemId}`)
      } catch (e) {
        console.error('清理旧临时评论缓存失败:', e)
      }
      setComments(res.list || [])
    } catch (e) {
      console.error('加载评论失败:', e)
    }
  }

  // 点赞/取消
  const handleLike = async () => {
    if (!item) return
    try {
      if (item.liked) {
        await unlikePublicFoodLibraryItem(item.id)
        setItem({ ...item, liked: false, like_count: Math.max(0, item.like_count - 1) })
      } else {
        await likePublicFoodLibraryItem(item.id)
        setItem({ ...item, liked: true, like_count: item.like_count + 1 })
      }
    } catch (e: any) {
      await showUnifiedApiError(e, '操作失败')
    }
  }

  // 收藏/取消
  const handleCollect = async () => {
    if (!item) return
    try {
      if (item.collected) {
        await uncollectPublicFoodLibraryItem(item.id)
        setItem({ ...item, collected: false, collection_count: Math.max(0, (item.collection_count || 0) - 1) })
      } else {
        await collectPublicFoodLibraryItem(item.id)
        setItem({ ...item, collected: true, collection_count: (item.collection_count || 0) + 1 })
      }
    } catch (e: any) {
      await showUnifiedApiError(e, '操作失败')
    }
  }

  const handleDelete = async () => {
    if (!item || deleting) return
    setShowActionSheet(false)
    const { confirm } = await Taro.showModal({
      title: '删除上传',
      content: '删除后这条食物会从公共库下架，其他用户将无法再查看。',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#ef4444'
    })
    if (!confirm) return

    setDeleting(true)
    Taro.showLoading({ title: '删除中...', mask: true })
    try {
      await deletePublicFoodLibraryItem(item.id)
      Taro.setStorageSync('food_library_need_refresh', '1')
      Taro.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack({
          fail: () => Taro.redirectTo({ url: extraPkgUrl('/pages/food-library/index') })
        })
      }, 500)
    } catch (e: any) {
      await showUnifiedApiError(e, '删除失败')
    } finally {
      Taro.hideLoading()
      setDeleting(false)
    }
  }

  const handleEdit = () => {
    setShowActionSheet(false)
    if (!item) return
    if (item.is_campus_food) {
      Taro.navigateTo({ url: `${extraPkgUrl('/pages/campus-food-share/index')}?edit_id=${item.id}` })
    } else {
      Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-share/index')}?edit_id=${item.id}` })
    }
  }

  const handleShare = () => {
    setShowActionSheet(false)
    Taro.showShareMenu({ withShareTicket: true })
  }

  // 一键记录
  const handleQuickRecord = () => {
    if (!item) return
    if (isAnalyzingItem(item)) {
      Taro.showToast({ title: '营养信息分析中', icon: 'none' })
      return
    }
    if (isAnalysisFailedItem(item)) {
      Taro.showToast({ title: '分析失败，暂不能记录', icon: 'none' })
      return
    }
    Taro.setStorageSync('campus_quick_record_item', JSON.stringify(item))
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-manual/index')}?campus_quick=1` })
  }

  // 提交修正
  const handleCorrection = async () => {
    if (!item) return
    const { confirm, content } = await Taro.showModal({
      title: '修正食物信息',
      content: '',
      editable: true,
      placeholderText: '请说明您认为有误的地方（如食物名称、热量等）…',
      confirmText: '提交',
      cancelText: '取消',
      confirmColor: '#5cb896',
    })
    if (!confirm || !content || !content.trim()) return

    Taro.showLoading({ title: '提交中...', mask: true })
    try {
      await submitPublicFoodLibraryFeedback(content.trim(), item.id)
      Taro.showToast({ title: '修正已提交', icon: 'success' })
    } catch (e: any) {
      await showUnifiedApiError(e, '提交失败')
    } finally {
      Taro.hideLoading()
    }
  }

  // 提交评论
  const handleSubmitComment = async () => {
    if (!commentContent.trim()) {
      Taro.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }
    setSubmitting(true)
    try {
      const { comment } = await postPublicFoodLibraryComment(
        itemId, 
        commentContent, 
        commentRating > 0 ? commentRating : undefined
      )
      const localUserDisplay = getLocalUserDisplay()
      const displayComment = {
        ...comment,
        nickname: comment.nickname || localUserDisplay.nickname,
        avatar: comment.avatar || localUserDisplay.avatar
      }

      setComments(prev => [displayComment, ...prev])

      Taro.showToast({ title: '评论成功', icon: 'success' })
      setShowCommentModal(false)
      setCommentContent('')
      setCommentRating(0)
      
      // 更新评论数
      if (item) {
        setItem({ ...item, comment_count: item.comment_count + 1 })
      }
    } catch (e: any) {
      await showUnifiedApiError(e, '评论失败')
    } finally {
      setSubmitting(false)
    }
  }

  const pageClassName = `food-detail-page ${scheme === 'dark' ? 'food-detail-page--dark' : ''}`

  if (loading) {
    return (
      <View className={`${pageClassName} skeleton-wrapper`}>
        {/* 图片骨架 */}
        <View className='skeleton-image' />

        {/* 基础信息骨架 */}
        <View className='skeleton-card info-card'>
          <View className='skeleton-row between'>
            <View className='skeleton-block title-block' />
            <View className='skeleton-block tag-block' />
          </View>
          <View className='skeleton-block text-block' />
          <View className='skeleton-block text-block short' />

          <View className='nutrients-block'>
            <View className='skeleton-block nutrient-item-block' />
            <View className='skeleton-block nutrient-item-block' />
            <View className='skeleton-block nutrient-item-block' />
          </View>

          <View className='skeleton-row'>
            <View className='skeleton-block avatar-block' />
            <View className='info-block'>
              <View className='skeleton-block text-block' style={{ width: '40%', marginBottom: '8rpx' }} />
              <View className='skeleton-block text-block' style={{ width: '30%', marginBottom: 0 }} />
            </View>
          </View>
        </View>

        {/* 商家信息骨架 */}
        <View className='skeleton-card'>
          <View className='skeleton-block text-block' style={{ width: '30%', marginBottom: '32rpx', height: '40rpx' }} />
          <View className='skeleton-row'>
            <View className='skeleton-block' style={{ width: '40rpx', height: '40rpx' }} />
            <View className='skeleton-block text-block' style={{ flex: 1, marginBottom: 0 }} />
          </View>
          <View className='skeleton-row'>
            <View className='skeleton-block' style={{ width: '40rpx', height: '40rpx' }} />
            <View className='skeleton-block text-block' style={{ flex: 1, marginBottom: 0 }} />
          </View>
        </View>

        {/* 评论骨架 */}
        <View className='skeleton-card'>
          <View className='skeleton-row between'>
            <View className='skeleton-block text-block' style={{ width: '20%', marginBottom: '24rpx', height: '40rpx' }} />
            <View className='skeleton-block tag-block' style={{ width: '80rpx', height: '32rpx' }} />
          </View>

          <View style={{ marginTop: '24rpx' }}>
            <View className='skeleton-row'>
              <View className='skeleton-block avatar-block' style={{ width: '72rpx', height: '72rpx' }} />
              <View className='info-block'>
                <View className='skeleton-block text-block' style={{ width: '30%', marginBottom: '8rpx' }} />
                <View className='skeleton-block text-block' style={{ width: '20%', marginBottom: 0 }} />
              </View>
            </View>
            <View className='skeleton-block text-block' style={{ width: '100%', marginTop: '16rpx' }} />
            <View className='skeleton-block text-block short' />
          </View>
        </View>
      </View>
    )
  }

  if (!item) {
    return (
      <View className={pageClassName}>
        <View className='loading-state'>
          <Text className='loading-text'>内容不存在</Text>
        </View>
      </View>
    )
  }

  const imageList: string[] = (item.image_paths && item.image_paths.length > 0)
    ? item.image_paths
    : (item.image_path ? [item.image_path] : [])
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()
  const isOwner = Boolean(currentUserId && item.user_id === currentUserId)
  const campusProteinPerYuan = campusMetrics.protein_per_yuan ?? item.protein_per_yuan
  const campusPricePer100Kcal = campusMetrics.price_per_100_kcal ?? item.price_per_100_kcal
  const analyzing = isAnalyzingItem(item)
  const analysisFailed = isAnalysisFailedItem(item)
  const renderCampusMiniCard = (card: PublicFoodLibraryItem) => (
    <View key={card.id} className='campus-related-card' onClick={() => Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-detail/index')}?id=${card.id}&scene=campus` })}>
      {card.image_path ? (
        <Image className='campus-related-image' src={card.image_path} mode='aspectFill' />
      ) : (
        <View className='campus-related-image campus-related-image--empty'>暂无图片</View>
      )}
      <Text className='campus-related-title'>{card.food_name || '未命名菜品'}</Text>
      <Text className='campus-related-meta'>{fmtPriceDisplay(card)} · {Math.round(card.total_calories || 0)} kcal</Text>
    </View>
  )

  return (
    <View className={pageClassName}>
      {/* 图片（支持多图轮播） */}
      <View className='image-section'>
        {imageList.length > 0 ? (
          <>
            <Swiper
              className='detail-swiper'
              indicatorDots
              indicatorColor='rgba(255,255,255,0.5)'
              indicatorActiveColor='#fff'
              autoplay={false}
              circular
              onAnimationFinish={(e) => setCurrentImageIndex(e.detail.current)}
            >
              {imageList.map((src, index) => (
                <SwiperItem key={index} className='detail-swiper-item'>
                  <Image
                    className='detail-image'
                    src={src}
                    mode='aspectFill'
                    onClick={() => Taro.previewImage({ urls: imageList, current: src })}
                  />
                </SwiperItem>
              ))}
            </Swiper>
            {imageList.length > 1 && (
              <View className='image-counter'>
                <Text className='image-counter-text'>{currentImageIndex + 1}/{imageList.length}</Text>
              </View>
            )}
          </>
        ) : (
          <View className='image-placeholder'>暂无图片</View>
        )}
        {item.suitable_for_fat_loss && (
          <View className='fat-loss-badge'>适合减脂</View>
        )}
      </View>

      {/* 基础信息 */}
      <View className='info-card'>
        <View className='info-header'>
          <Text className='info-title'>{item.food_name || item.description || '健康餐'}</Text>
          <View className='info-calories-badge'>
            <FireOutlined size='16' />
            <Text className='info-calories'>{item.total_calories.toFixed(0)} kcal</Text>
          </View>
        </View>
        {item.description && (
          <Text className='info-description'>{item.description}</Text>
        )}
        {item.insight && (
          <Text className='info-insight'>{item.insight}</Text>
        )}
        <View className='nutrients-row'>
          <View className='nutrient-item'>
            <Text className='nutrient-value'>{item.total_calories.toFixed(0)}</Text>
            <Text className='nutrient-label'>热量 kcal</Text>
          </View>
          <View className='nutrient-item'>
            <Text className='nutrient-value'>{item.total_protein.toFixed(1)}g</Text>
            <Text className='nutrient-label'>蛋白质</Text>
          </View>
          <View className='nutrient-item'>
            <Text className='nutrient-value'>{item.total_carbs.toFixed(1)}g</Text>
            <Text className='nutrient-label'>碳水</Text>
          </View>
          <View className='nutrient-item'>
            <Text className='nutrient-value'>{item.total_fat.toFixed(1)}g</Text>
            <Text className='nutrient-label'>脂肪</Text>
          </View>
        </View>
        <View className='author-row'>
          {item.author?.avatar ? (
            <View className='author-avatar'>
              <Image className='author-avatar-img' src={item.author.avatar} />
            </View>
          ) : (
            <View className='author-avatar'>
              <UserOutlined size='20' color='#9ca3af' />
            </View>
          )}
          <View className='author-info'>
            <Text className='author-name'>{item.author?.nickname || '用户'}</Text>
            <Text className='publish-time'>{formatTime(item.published_at)}</Text>
          </View>
        </View>
      </View>

      {/* 校园食堂信息 */}
      {item.is_campus_food && (
        <View className='campus-card'>
          {(() => {
            return (
              <>
          <View className='campus-header-row'>
            <Text className='campus-badge'>校园食堂</Text>
            <Text className={`campus-fat-loss ${item.suitable_for_fat_loss ? 'active' : ''}`}>
              {item.suitable_for_fat_loss ? '适合减脂' : '不标记减脂'}
            </Text>
            {item.portion_description && (
              <Text className='campus-portion'>{item.portion_description}</Text>
            )}
          </View>
          <View className='campus-info-grid'>
            <View className='campus-info-cell'>
              <Text className='campus-info-label'>学校</Text>
              <Text className='campus-info-value'>{item.school_name || '待补充'}</Text>
            </View>
            <View className='campus-info-cell'>
              <Text className='campus-info-label'>食堂</Text>
              <Text className='campus-info-value'>{item.canteen_name || '待补充'}</Text>
            </View>
            <View className='campus-info-cell'>
              <Text className='campus-info-label'>楼层/窗口</Text>
              <Text className='campus-info-value'>{[item.floor, item.window_name].filter(Boolean).join(' · ') || '待补充'}</Text>
            </View>
            <View className='campus-info-cell'>
              <Text className='campus-info-label'>估算份量</Text>
              <Text className='campus-info-value'>{item.portion_description || '约 1 份'}</Text>
            </View>
          </View>
          <Text className='campus-location'>{getCampusLocationText(item)}</Text>
          <View className='campus-price-row'>
            <Text className='campus-price'>{fmtPriceDisplay(item)}</Text>
            {!!campusProteinPerYuan && (
              <Text className='campus-metric'>
                蛋白质 {campusProteinPerYuan.toFixed(1)}g/元
              </Text>
            )}
            {!!campusPricePer100Kcal && (
              <Text className='campus-metric'>
                {campusPricePer100Kcal.toFixed(2)}元/100kcal
              </Text>
            )}
          </View>
          <Text className='campus-price-date'>价格更新于 {formatDateOnly(item.price_collected_at)}</Text>
          {analyzing && <Text className='campus-analysis-tip'>营养信息正在分析中，完成后会自动补齐热量和宏量营养素。</Text>}
          {analysisFailed && <Text className='campus-analysis-tip campus-analysis-tip--error'>营养分析失败，暂不建议一键记录，可通过纠错入口反馈。</Text>}
              </>
            )
          })()}
        </View>
      )}

      {item.is_campus_food && similarItems.length > 0 && (
        <View className='campus-related-section'>
          <View className='campus-section-head'>
            <Text className='card-title'>同食堂相似菜品</Text>
            <Text className='campus-section-subtitle'>同学校同食堂优先推荐</Text>
          </View>
          <ScrollView scrollX enhanced showScrollbar={false} className='campus-related-scroll'>
            <View className='campus-related-list'>
              {similarItems.map(renderCampusMiniCard)}
            </View>
          </ScrollView>
        </View>
      )}

      {item.is_campus_food && relatedFeeds.length > 0 && (
        <View className='campus-feed-section'>
          <View className='campus-section-head'>
            <Text className='card-title'>圈子相关动态</Text>
            <Text className='campus-section-subtitle'>来自同食堂精选动态</Text>
          </View>
          {relatedFeeds.map(feed => (
            <View key={feed.id} className='campus-feed-item' onClick={() => Taro.navigateTo({ url: `${extraPkgUrl('/pages/food-library-detail/index')}?id=${feed.id}&scene=campus` })}>
              {feed.image_path ? (
                <Image className='campus-feed-image' src={feed.image_path} mode='aspectFill' />
              ) : (
                <View className='campus-feed-image campus-feed-image--empty'>食堂</View>
              )}
              <View className='campus-feed-copy'>
                <Text className='campus-feed-title'>{feed.food_name || '校园菜品动态'}</Text>
                <Text className='campus-feed-meta'>{feed.campus_location || [feed.school_name, feed.canteen_name].filter(Boolean).join(' · ')}</Text>
                <Text className='campus-feed-stats'>{Math.round(feed.total_calories || 0)} kcal · 蛋白 {Math.round(feed.total_protein || 0)}g · {feed.like_count} 赞</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 商家信息 */}
      {(item.merchant_name || item.merchant_address || item.city) && (
        <View className='merchant-card'>
          <Text className='card-title'>商家信息</Text>
          {item.merchant_name && (
            <View className='merchant-item'>
              <View className='merchant-icon-wrapper'><ShopOutlined size='18' /></View>
              <Text className='merchant-text'>{item.merchant_name}</Text>
            </View>
          )}
          {item.merchant_address && (
            <View className='merchant-item'>
              <View className='merchant-icon-wrapper'><LocationOutlined size='18' /></View>
              <Text className='merchant-text'>{item.merchant_address}</Text>
            </View>
          )}
          {item.city && (
            <View className='merchant-item'>
              <View className='merchant-icon-wrapper'><GuideOutlined size='18' /></View>
              <Text className='merchant-text'>{item.city}{item.district ? ` ${item.district}` : ''}</Text>
            </View>
          )}
          {item.taste_rating && (
            <View className='merchant-item'>
              <View className='merchant-icon-wrapper'><Star size='18' className='star-icon' /></View>
              <Text className='merchant-text'>口味评分：{item.taste_rating} 分</Text>
            </View>
          )}
        </View>
      )}

      {/* 标签 */}
      {item.user_tags && item.user_tags.length > 0 && (
        <View className='tags-card'>
          <Text className='card-title'>标签</Text>
          <View className='tags-list'>
            {item.user_tags.map((tag, idx) => (
              <Text key={idx} className='tag-item'>{tag}</Text>
            ))}
          </View>
        </View>
      )}

      {/* 用户备注 */}
      {item.user_notes && (
        <View className='notes-card'>
          <Text className='card-title'>用户评价</Text>
          <Text className='notes-content'>{item.user_notes}</Text>
        </View>
      )}

      {/* 评论区 */}
      <View className='comments-card'>
        <View className='comments-header'>
          <Text className='card-title'>评论</Text>
          <Text className='comments-count'>{comments.length} 条</Text>
        </View>
        {comments.length === 0 ? (
          <View className='comments-empty'>暂无评论，快来抢沙发</View>
        ) : (
          <ScrollView className='comments-list' scrollY enhanced showScrollbar={false}>
            {comments.map(c => (
              <View key={c.id} className='comment-item'>
                <View className='comment-header'>
                  {c.avatar ? (
                    <View className='comment-avatar'>
                      <Image className='comment-avatar-img' src={c.avatar} />
                    </View>
                  ) : (
                    <View className='comment-avatar'>
                      <UserOutlined size='16' color='#9ca3af' />
                    </View>
                  )}
                  <View className='comment-info'>
                    <Text className='comment-name'>{c.nickname}</Text>
                    <Text className='comment-time'>{formatTime(c.created_at)}</Text>
                  </View>
                  {c.rating && (
                    <View className='comment-rating-stars'>
                      {Array.from({ length: c.rating }).map((_, i) => (
                        <Star key={i} size='12' className='star-filled' />
                      ))}
                    </View>
                  )}
                </View>
                <Text className='comment-content'>{c.content}</Text>
              </View>
            ))}
          </ScrollView>
        )}
        {/* 快速评论输入条 */}
        <View className='quick-comment-bar' onClick={() => setShowCommentModal(true)}>
          {(() => {
            const localUser = getLocalUserDisplay()
            return localUser.avatar ? (
              <View className='quick-comment-avatar'>
                <Image className='quick-comment-avatar-img' src={localUser.avatar} />
              </View>
            ) : (
              <View className='quick-comment-avatar'>
                <UserOutlined size='16' color='#9ca3af' />
              </View>
            )
          })()}
          <View className='quick-comment-input'>
            <Text className='quick-comment-placeholder'>理性发言</Text>
          </View>
        </View>
      </View>

      {/* 底部操作栏 */}
      <View className='bottom-bar'>
        <View className='bottom-bar-row1'>
          {item.is_campus_food && (
            <View className={`action-btn quick-record-btn ${analyzing || analysisFailed ? 'disabled' : ''}`} onClick={handleQuickRecord}>
              <Text className='action-text'>{analyzing ? '分析中' : analysisFailed ? '暂不可记' : '一键记录'}</Text>
            </View>
          )}
          <View className={`action-btn icon-action like-btn ${item.liked ? 'liked' : ''}`} onClick={handleLike}>
            {item.liked ? <Like size='20' /> : <LikeOutlined size='20' />}
          </View>
          <View className={`action-btn icon-action collect-btn ${item.collected ? 'collected' : ''}`} onClick={handleCollect}>
            {item.collected ? <Star size='20' className='star-filled' /> : <StarOutlined size='20' />}
          </View>
          <View className='action-btn icon-action comment-btn' onClick={() => setShowCommentModal(true)}>
            <CommentOutlined size='20' />
            <Text className='action-text'>写评论</Text>
          </View>
          <View className='action-btn icon-action more-btn' onClick={() => setShowActionSheet(true)}>
            <Text className='more-icon'>⋮</Text>
          </View>
        </View>
        <View className='correction-bar'>
          <Text className='correction-hint'>信息有误？</Text>
          <Text className='correction-link' onClick={handleCorrection}>点击修正</Text>
        </View>
      </View>

      {/* 评论弹窗 */}
      {showCommentModal && (
        <View className='comment-modal' onClick={() => setShowCommentModal(false)}>
          <View className='comment-modal-content' onClick={e => e.stopPropagation()}>
            <View className='modal-header'>
              <Text className='modal-title'>发表评论</Text>
              <View className='modal-close' onClick={() => setShowCommentModal(false)}>
                <Cross size='24' color='#9ca3af' />
              </View>
            </View>
            <View className='rating-row'>
              <Text className='rating-label'>评分（可选）：</Text>
              <View className='rating-stars'>
                {[1, 2, 3, 4, 5].map(n => (
                  <View
                    key={n}
                    className={`rating-star-wrapper ${n <= commentRating ? 'active' : ''}`}
                    onClick={() => setCommentRating(n === commentRating ? 0 : n)}
                  >
                    {n <= commentRating ? <Star size='28' /> : <StarOutlined size='28' />}
                  </View>
                ))}
              </View>
            </View>
            <Textarea
              className='comment-input'
              placeholder='分享你的想法...'
              value={commentContent}
              onInput={e => setCommentContent(e.detail.value)}
              maxlength={500}
              autoFocus
              fixed
            />
            <View className='submit-btn' onClick={handleSubmitComment}>
              {submitting ? <View className='btn-spinner' /> : '发表评论'}
            </View>
          </View>
        </View>
      )}

      {/* 更多操作 ActionSheet */}
      {showActionSheet && (
        <View className='action-sheet-modal' onClick={() => setShowActionSheet(false)}>
          <View className='action-sheet-mask' />
          <View className='action-sheet-content' onClick={e => e.stopPropagation()}>
            <View className='action-sheet-actions'>
              <View className='action-sheet-item' onClick={handleShare}>
                <Text className='iconfont icon-fenxiang action-sheet-icon action-sheet-icon--share' />
                <Text className='action-sheet-label'>转发给朋友</Text>
              </View>
              <View className='action-sheet-divider' />
              {isOwner && (
                <>
                  <View className='action-sheet-item' onClick={handleEdit}>
                    <Text className='iconfont icon-edit action-sheet-icon action-sheet-icon--edit' />
                    <Text className='action-sheet-label'>编辑</Text>
                  </View>
                  <View className='action-sheet-divider' />
                </>
              )}
              {isOwner && (
                <View className='action-sheet-item action-sheet-item--danger' onClick={handleDelete}>
                  <Text className='iconfont icon-shanchu action-sheet-icon' />
                  <Text className='action-sheet-label'>删除</Text>
                </View>
              )}
            </View>
            <View className='action-sheet-cancel' onClick={() => setShowActionSheet(false)}>
              <Text className='action-sheet-cancel-text'>取消</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(FoodLibraryDetailPage)
