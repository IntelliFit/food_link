import { View, Text, ScrollView, Image, Textarea, Swiper, SwiperItem } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  getPublicFoodLibraryItem,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  getPublicFoodLibraryComments,
  postPublicFoodLibraryComment,
  type PublicFoodLibraryItem,
  type PublicFoodLibraryComment,
  collectPublicFoodLibraryItem,
  uncollectPublicFoodLibraryItem
} from '../../utils/api'
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

export default function FoodLibraryDetailPage() {
  const router = useRouter()
  const itemId = router.params.id || ''

  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<PublicFoodLibraryItem | null>(null)
  const [comments, setComments] = useState<PublicFoodLibraryComment[]>([])
  const [showCommentModal, setShowCommentModal] = useState(false)
  const [commentContent, setCommentContent] = useState('')
  const [commentRating, setCommentRating] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // 加载详情
  useEffect(() => {
    if (!itemId) return
    loadDetail()
    loadComments()
  }, [itemId])

  const loadDetail = async () => {
    setLoading(true)
    setCurrentImageIndex(0)
    try {
      const data = await getPublicFoodLibraryItem(itemId)
      setItem(data)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const loadComments = async () => {
    try {
      const res = await getPublicFoodLibraryComments(itemId)
      const serverComments = res.list || []

      // 合并本地临时评论（审核中）到列表顶部：最多保留 5 分钟，避免用户返回页面后“评论消失”
      const tempCommentsKey = `temp_library_comments_${itemId}`
      const now = Date.now()
      let cachedTemp: Array<{ task_id: string; comment: PublicFoodLibraryComment; timestamp: number }> = []
      try {
        const raw = Taro.getStorageSync(tempCommentsKey)
        cachedTemp = Array.isArray(raw) ? raw : []
      } catch (e) {
        console.error('读取临时评论缓存失败:', e)
      }

      const MAX_TEMP_AGE_MS = 5 * 60 * 1000
      const DEDUPE_WINDOW_MS = 10 * 60 * 1000

      const validTemp = cachedTemp
        .filter((t) => t && typeof t.timestamp === 'number' && now - t.timestamp <= MAX_TEMP_AGE_MS)
        .map((t) => ({
          ...t,
          comment: { ...t.comment, _is_temp: true }
        }))

      const remainingTemp = validTemp.filter((t) => {
        const tTime = new Date(t.comment.created_at).getTime()
        return !serverComments.some((sc) => {
          const scTime = new Date(sc.created_at).getTime()
          return (
            sc.user_id === t.comment.user_id &&
            sc.content === t.comment.content &&
            (sc.rating ?? null) === (t.comment.rating ?? null) &&
            (Number.isNaN(tTime) || Number.isNaN(scTime) ? false : Math.abs(scTime - tTime) <= DEDUPE_WINDOW_MS)
          )
        })
      })

      // 回写缓存（仅保留仍在窗口期内的临时评论）
      try {
        if (remainingTemp.length) {
          Taro.setStorageSync(tempCommentsKey, remainingTemp)
        } else {
          Taro.removeStorageSync(tempCommentsKey)
        }
      } catch (e) {
        console.error('更新临时评论缓存失败:', e)
      }

      setComments([...remainingTemp.map((t) => t.comment), ...serverComments])
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
      Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
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
      Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
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
      // 调用新接口，获取临时评论数据
      const { task_id, temp_comment } = await postPublicFoodLibraryComment(
        itemId, 
        commentContent, 
        commentRating > 0 ? commentRating : undefined
      )
      const localUserDisplay = getLocalUserDisplay()
      const displayTempComment = {
        ...temp_comment,
        nickname: temp_comment.nickname || localUserDisplay.nickname,
        avatar: temp_comment.avatar || localUserDisplay.avatar
      }
      
      // 立即将临时评论添加到评论列表开头（乐观更新）
      setComments(prev => [displayTempComment, ...prev])
      
      // 将临时评论缓存到本地存储
      const tempCommentsKey = `temp_library_comments_${itemId}`
      try {
        const existingTemp = Taro.getStorageSync(tempCommentsKey) || []
        existingTemp.push({ task_id, comment: displayTempComment, timestamp: Date.now() })
        Taro.setStorageSync(tempCommentsKey, existingTemp)
      } catch (e) {
        console.error('缓存临时评论失败:', e)
      }
      
      Taro.showToast({ title: '评论已提交审核', icon: 'success' })
      setShowCommentModal(false)
      setCommentContent('')
      setCommentRating(0)
      
      // 更新评论数
      if (item) {
        setItem({ ...item, comment_count: item.comment_count + 1 })
      }
    } catch (e: any) {
      Taro.showToast({ title: e.message || '评论失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <View className="food-detail-page skeleton-wrapper">
        {/* 图片骨架 */}
        <View className="skeleton-image" />

        {/* 基础信息骨架 */}
        <View className="skeleton-card info-card">
          <View className="skeleton-row between">
            <View className="skeleton-block title-block" />
            <View className="skeleton-block tag-block" />
          </View>
          <View className="skeleton-block text-block" />
          <View className="skeleton-block text-block short" />

          <View className="nutrients-block">
            <View className="skeleton-block nutrient-item-block" />
            <View className="skeleton-block nutrient-item-block" />
            <View className="skeleton-block nutrient-item-block" />
          </View>

          <View className="skeleton-row">
            <View className="skeleton-block avatar-block" />
            <View className="info-block">
              <View className="skeleton-block text-block" style={{ width: '40%', marginBottom: '8rpx' }} />
              <View className="skeleton-block text-block" style={{ width: '30%', marginBottom: 0 }} />
            </View>
          </View>
        </View>

        {/* 商家信息骨架 */}
        <View className="skeleton-card">
          <View className="skeleton-block text-block" style={{ width: '30%', marginBottom: '32rpx', height: '40rpx' }} />
          <View className="skeleton-row">
            <View className="skeleton-block" style={{ width: '40rpx', height: '40rpx' }} />
            <View className="skeleton-block text-block" style={{ flex: 1, marginBottom: 0 }} />
          </View>
          <View className="skeleton-row">
            <View className="skeleton-block" style={{ width: '40rpx', height: '40rpx' }} />
            <View className="skeleton-block text-block" style={{ flex: 1, marginBottom: 0 }} />
          </View>
        </View>

        {/* 评论骨架 */}
        <View className="skeleton-card">
          <View className="skeleton-row between">
            <View className="skeleton-block text-block" style={{ width: '20%', marginBottom: '24rpx', height: '40rpx' }} />
            <View className="skeleton-block tag-block" style={{ width: '80rpx', height: '32rpx' }} />
          </View>

          <View style={{ marginTop: '24rpx' }}>
            <View className="skeleton-row">
              <View className="skeleton-block avatar-block" style={{ width: '72rpx', height: '72rpx' }} />
              <View className="info-block">
                <View className="skeleton-block text-block" style={{ width: '30%', marginBottom: '8rpx' }} />
                <View className="skeleton-block text-block" style={{ width: '20%', marginBottom: 0 }} />
              </View>
            </View>
            <View className="skeleton-block text-block" style={{ width: '100%', marginTop: '16rpx' }} />
            <View className="skeleton-block text-block short" />
          </View>
        </View>
      </View>
    )
  }

  if (!item) {
    return (
      <View className="food-detail-page">
        <View className="loading-state">
          <Text className="loading-text">内容不存在</Text>
        </View>
      </View>
    )
  }

  const imageList: string[] = (item.image_paths && item.image_paths.length > 0)
    ? item.image_paths
    : (item.image_path ? [item.image_path] : [])

  return (
    <View className="food-detail-page">
      {/* 图片（支持多图轮播） */}
      <View className="image-section">
        {imageList.length > 0 ? (
          <>
            <Swiper
              className="detail-swiper"
              indicatorDots
              indicatorColor="rgba(255,255,255,0.5)"
              indicatorActiveColor="#fff"
              autoplay={false}
              circular
              onAnimationFinish={(e) => setCurrentImageIndex(e.detail.current)}
            >
              {imageList.map((src, index) => (
                <SwiperItem key={index} className="detail-swiper-item">
                  <Image className="detail-image" src={src} mode="aspectFill" />
                </SwiperItem>
              ))}
            </Swiper>
            {imageList.length > 1 && (
              <View className="image-counter">
                <Text className="image-counter-text">{currentImageIndex + 1}/{imageList.length}</Text>
              </View>
            )}
          </>
        ) : (
          <View className="image-placeholder">暂无图片</View>
        )}
        {item.suitable_for_fat_loss && (
          <View className="fat-loss-badge">适合减脂</View>
        )}
      </View>

      {/* 基础信息 */}
      <View className="info-card">
        <View className="info-header">
          <Text className="info-title">{item.food_name || item.description || '健康餐'}</Text>
          <View className="info-calories-badge">
            <FireOutlined size="16" />
            <Text className="info-calories">{item.total_calories.toFixed(0)} kcal</Text>
          </View>
        </View>
        {item.description && (
          <Text className="info-description">{item.description}</Text>
        )}
        {item.insight && (
          <Text className="info-insight">{item.insight}</Text>
        )}
        <View className="nutrients-row">
          <View className="nutrient-item">
            <Text className="nutrient-value">{item.total_protein.toFixed(1)}g</Text>
            <Text className="nutrient-label">蛋白质</Text>
          </View>
          <View className="nutrient-item">
            <Text className="nutrient-value">{item.total_carbs.toFixed(1)}g</Text>
            <Text className="nutrient-label">碳水</Text>
          </View>
          <View className="nutrient-item">
            <Text className="nutrient-value">{item.total_fat.toFixed(1)}g</Text>
            <Text className="nutrient-label">脂肪</Text>
          </View>
        </View>
        <View className="author-row">
          {item.author?.avatar ? (
            <View className="author-avatar">
              <Image className="author-avatar-img" src={item.author.avatar} />
            </View>
          ) : (
            <View className="author-avatar">
              <UserOutlined size="20" color="#9ca3af" />
            </View>
          )}
          <View className="author-info">
            <Text className="author-name">{item.author?.nickname || '用户'}</Text>
            <Text className="publish-time">{formatTime(item.published_at)}</Text>
          </View>
        </View>
      </View>

      {/* 商家信息 */}
      {(item.merchant_name || item.merchant_address || item.city) && (
        <View className="merchant-card">
          <Text className="card-title">商家信息</Text>
          {item.merchant_name && (
            <View className="merchant-item">
              <View className="merchant-icon-wrapper"><ShopOutlined size="18" /></View>
              <Text className="merchant-text">{item.merchant_name}</Text>
            </View>
          )}
          {item.merchant_address && (
            <View className="merchant-item">
              <View className="merchant-icon-wrapper"><LocationOutlined size="18" /></View>
              <Text className="merchant-text">{item.merchant_address}</Text>
            </View>
          )}
          {item.city && (
            <View className="merchant-item">
              <View className="merchant-icon-wrapper"><GuideOutlined size="18" /></View>
              <Text className="merchant-text">{item.city}{item.district ? ` ${item.district}` : ''}</Text>
            </View>
          )}
          {item.taste_rating && (
            <View className="merchant-item">
              <View className="merchant-icon-wrapper"><Star size="18" className="star-icon" /></View>
              <Text className="merchant-text">口味评分：{item.taste_rating} 分</Text>
            </View>
          )}
        </View>
      )}

      {/* 标签 */}
      {item.user_tags && item.user_tags.length > 0 && (
        <View className="tags-card">
          <Text className="card-title">标签</Text>
          <View className="tags-list">
            {item.user_tags.map((tag, idx) => (
              <Text key={idx} className="tag-item">{tag}</Text>
            ))}
          </View>
        </View>
      )}

      {/* 用户备注 */}
      {item.user_notes && (
        <View className="notes-card">
          <Text className="card-title">用户评价</Text>
          <Text className="notes-content">{item.user_notes}</Text>
        </View>
      )}

      {/* 评论区 */}
      <View className="comments-card">
        <View className="comments-header">
          <Text className="card-title">评论</Text>
          <Text className="comments-count">{comments.length} 条</Text>
        </View>
        {comments.length === 0 ? (
          <View className="comments-empty">暂无评论，快来抢沙发</View>
        ) : (
          <ScrollView className="comments-list" scrollY enhanced showScrollbar={false}>
            {comments.map(c => (
              <View key={c.id} className="comment-item">
                <View className="comment-header">
                  {c.avatar ? (
                    <View className="comment-avatar">
                      <Image className="comment-avatar-img" src={c.avatar} />
                    </View>
                  ) : (
                    <View className="comment-avatar">
                      <UserOutlined size="16" color="#9ca3af" />
                    </View>
                  )}
                  <View className="comment-info">
                    <Text className="comment-name">{c.nickname}</Text>
                    <Text className="comment-time">{formatTime(c.created_at)}</Text>
                  </View>
                  {c.rating && (
                    <View className="comment-rating-stars">
                      {Array.from({ length: c.rating }).map((_, i) => (
                        <Star key={i} size="12" className="star-filled" />
                      ))}
                    </View>
                  )}
                </View>
                <Text className="comment-content">{c.content}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* 底部操作栏 */}
      <View className="bottom-bar">
        <View className={`action-btn icon-action like-btn ${item.liked ? 'liked' : ''}`} onClick={handleLike}>
          {item.liked ? <Like size="20" /> : <LikeOutlined size="20" />}
        </View>
        <View className={`action-btn icon-action collect-btn ${item.collected ? 'collected' : ''}`} onClick={handleCollect}>
          {item.collected ? <Star size="20" className="star-filled" /> : <StarOutlined size="20" />}
        </View>
        <View className="action-btn comment-btn" onClick={() => setShowCommentModal(true)}>
          <CommentOutlined size="20" />
          <Text className="action-text">写评论</Text>
        </View>
      </View>

      {/* 评论弹窗 */}
      {showCommentModal && (
        <View className="comment-modal" onClick={() => setShowCommentModal(false)}>
          <View className="comment-modal-content" onClick={e => e.stopPropagation()}>
            <View className="modal-header">
              <Text className="modal-title">发表评论</Text>
              <View className="modal-close" onClick={() => setShowCommentModal(false)}>
                <Cross size="24" color="#9ca3af" />
              </View>
            </View>
            <View className="rating-row">
              <Text className="rating-label">评分（可选）：</Text>
              <View className="rating-stars">
                {[1, 2, 3, 4, 5].map(n => (
                  <View
                    key={n}
                    className={`rating-star-wrapper ${n <= commentRating ? 'active' : ''}`}
                    onClick={() => setCommentRating(n === commentRating ? 0 : n)}
                  >
                    {n <= commentRating ? <Star size="28" /> : <StarOutlined size="28" />}
                  </View>
                ))}
              </View>
            </View>
            <Textarea
              className="comment-input"
              placeholder="分享你的想法..."
              value={commentContent}
              onInput={e => setCommentContent(e.detail.value)}
              maxlength={500}
            />
            <View className="submit-btn" onClick={handleSubmitComment}>
              {submitting ? '提交中...' : '发表评论'}
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
