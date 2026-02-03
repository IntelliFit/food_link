import { View, Text, ScrollView, Image, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import {
  getPublicFoodLibraryItem,
  likePublicFoodLibraryItem,
  unlikePublicFoodLibraryItem,
  getPublicFoodLibraryComments,
  postPublicFoodLibraryComment,
  type PublicFoodLibraryItem,
  type PublicFoodLibraryComment
} from '../../utils/api'
import './index.scss'

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

  // 加载详情
  useEffect(() => {
    if (!itemId) return
    loadDetail()
    loadComments()
  }, [itemId])

  const loadDetail = async () => {
    setLoading(true)
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
      await postPublicFoodLibraryComment(itemId, commentContent, commentRating > 0 ? commentRating : undefined)
      Taro.showToast({ title: '评论成功', icon: 'success' })
      setShowCommentModal(false)
      setCommentContent('')
      setCommentRating(0)
      loadComments()
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
      <View className="food-detail-page">
        <View className="loading-state">
          <Text className="loading-text">加载中...</Text>
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

  return (
    <View className="food-detail-page">
      {/* 图片 */}
      <View className="image-section">
        {item.image_path ? (
          <Image className="detail-image" src={item.image_path} mode="aspectFill" />
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
          <Text className="info-title">{item.description || '健康餐'}</Text>
          <Text className="info-calories">{item.total_calories.toFixed(0)} kcal</Text>
        </View>
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
            <View className="author-avatar" />
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
              <Text className="merchant-icon">🏪</Text>
              <Text className="merchant-text">{item.merchant_name}</Text>
            </View>
          )}
          {item.merchant_address && (
            <View className="merchant-item">
              <Text className="merchant-icon">📍</Text>
              <Text className="merchant-text">{item.merchant_address}</Text>
            </View>
          )}
          {item.city && (
            <View className="merchant-item">
              <Text className="merchant-icon">🗺️</Text>
              <Text className="merchant-text">{item.city}{item.district ? ` ${item.district}` : ''}</Text>
            </View>
          )}
          {item.taste_rating && (
            <View className="merchant-item">
              <Text className="merchant-icon">⭐</Text>
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
                    <View className="comment-avatar" />
                  )}
                  <View className="comment-info">
                    <Text className="comment-name">{c.nickname}</Text>
                    <Text className="comment-time">{formatTime(c.created_at)}</Text>
                  </View>
                  {c.rating && (
                    <Text className="comment-rating">{'⭐'.repeat(c.rating)}</Text>
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
        <View className={`action-btn like-btn ${item.liked ? 'liked' : ''}`} onClick={handleLike}>
          <Text className="btn-icon">{item.liked ? '❤️' : '🤍'}</Text>
          <Text>{item.like_count} 赞</Text>
        </View>
        <View className="action-btn comment-btn" onClick={() => setShowCommentModal(true)}>
          <Text className="btn-icon">💬</Text>
          <Text>评论</Text>
        </View>
      </View>

      {/* 评论弹窗 */}
      {showCommentModal && (
        <View className="comment-modal" onClick={() => setShowCommentModal(false)}>
          <View className="comment-modal-content" onClick={e => e.stopPropagation()}>
            <View className="modal-header">
              <Text className="modal-title">发表评论</Text>
              <Text className="modal-close" onClick={() => setShowCommentModal(false)}>✕</Text>
            </View>
            <View className="rating-row">
              <Text className="rating-label">评分（可选）：</Text>
              <View className="rating-stars">
                {[1, 2, 3, 4, 5].map(n => (
                  <Text
                    key={n}
                    className={`rating-star ${n <= commentRating ? 'active' : ''}`}
                    onClick={() => setCommentRating(n === commentRating ? 0 : n)}
                  >
                    ★
                  </Text>
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
