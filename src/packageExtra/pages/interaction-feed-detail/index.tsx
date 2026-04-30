import { View, Text, Image, ScrollView, Input } from '@tarojs/components'
import { useCallback, useMemo, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import {
  communityGetComments,
  communityGetFeedContext,
  communityLike,
  communityPostComment,
  communityUnlike,
  showUnifiedApiError,
  type CommunityFeedItem,
  type FeedCommentItem
} from '../../../utils/api'
import { getAccessToken } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth, redirectToLogin } from '../../../utils/withAuth'

import './index.scss'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const DIET_GOAL_NAMES: Record<string, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  maintain: '维持'
}

function formatFeedTime(recordTime: string): string {
  if (!recordTime) return ''
  try {
    const d = new Date(recordTime)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return d.toLocaleDateString()
  } catch {
    return recordTime.slice(0, 16).replace('T', ' ')
  }
}

type RouteOptions = Record<string, string | undefined>

function pickRecordId(options: RouteOptions): string {
  return String(options.recordId || options.record_id || options.id || '').trim()
}

function InteractionFeedDetailPage() {
  const [recordId, setRecordId] = useState('')
  const [targetCommentId, setTargetCommentId] = useState('')
  const [feedItem, setFeedItem] = useState<CommunityFeedItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [commentContent, setCommentContent] = useState('')
  const [replyTargetComment, setReplyTargetComment] = useState<FeedCommentItem | null>(null)
  const [composerVisible, setComposerVisible] = useState(false)
  const likePendingRef = useRef(false)

  const loadDetail = useCallback(async (nextRecordId: string) => {
    if (!nextRecordId) {
      setFeedItem(null)
      setLoading(false)
      return
    }
    if (!getAccessToken()) {
      setFeedItem(null)
      setLoading(false)
      redirectToLogin(`${extraPkgUrl('/pages/interaction-feed-detail/index')}?recordId=${encodeURIComponent(nextRecordId)}`)
      return
    }
    setLoading(true)
    try {
      const withTimeout = async <T,>(task: Promise<T>, timeoutMs = 12000): Promise<T> => {
        return await Promise.race<T>([
          task,
          new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error('请求超时，请稍后重试')), timeoutMs)
          })
        ])
      }

      const context = await withTimeout(communityGetFeedContext(nextRecordId, 5))
      const contextItem = context.item
      const commentsRes = await withTimeout(communityGetComments(nextRecordId))
      const fullComments = commentsRes.list || []
      setFeedItem({
        ...contextItem,
        comments: fullComments,
        comment_count: Math.max(contextItem.comment_count || 0, fullComments.length)
      })
    } catch (e) {
      console.error('加载动态详情失败:', e)
      await showUnifiedApiError(e, '加载失败')
      setFeedItem(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const hydrateFromOptions = useCallback((options: RouteOptions) => {
    const nextRecordId = pickRecordId(options)
    setRecordId(nextRecordId)
    const nextTarget = String(options?.commentId || options?.parentCommentId || '')
    setTargetCommentId(nextTarget)
    if (nextRecordId) {
      void loadDetail(nextRecordId)
    } else {
      setLoading(false)
      setFeedItem(null)
      Taro.showToast({ title: '未找到动态参数', icon: 'none' })
    }
  }, [loadDetail])

  Taro.useLoad((options) => {
    hydrateFromOptions((options || {}) as RouteOptions)
  })

  Taro.useDidShow(() => {
    if (recordId) return
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1]
    const options = (current?.options || {}) as RouteOptions
    if (pickRecordId(options)) {
      hydrateFromOptions(options)
    }
  })

  const handleLike = useCallback(async () => {
    if (!feedItem || likePendingRef.current) return
    likePendingRef.current = true
    const prev = feedItem
    const optimistic = {
      ...feedItem,
      liked: !feedItem.liked,
      like_count: Math.max(0, feedItem.like_count + (feedItem.liked ? -1 : 1))
    }
    setFeedItem(optimistic)
    try {
      if (prev.liked) {
        await communityUnlike(prev.record.id)
      } else {
        await communityLike(prev.record.id)
      }
    } catch (e) {
      setFeedItem(prev)
      await showUnifiedApiError(e, '操作失败')
    } finally {
      likePendingRef.current = false
    }
  }, [feedItem])

  const openComposer = useCallback((reply?: FeedCommentItem | null) => {
    setReplyTargetComment(reply || null)
    setComposerVisible(true)
  }, [])

  const closeComposer = useCallback(() => {
    setComposerVisible(false)
    setReplyTargetComment(null)
    setCommentContent('')
  }, [])

  const handleSubmitComment = useCallback(async () => {
    if (!feedItem) return
    const content = commentContent.trim()
    if (!content || submitting) return
    setSubmitting(true)
    try {
      await communityPostComment(feedItem.record.id, content, {
        parent_comment_id: replyTargetComment?.id,
        reply_to_user_id: replyTargetComment?.user_id
      })
      closeComposer()
      await loadDetail(feedItem.record.id)
      Taro.showToast({ title: '评论成功', icon: 'success' })
    } catch (e) {
      await showUnifiedApiError(e, '评论失败')
    } finally {
      setSubmitting(false)
    }
  }, [feedItem, commentContent, submitting, replyTargetComment, closeComposer, loadDetail])

  const highlightCommentId = useMemo(() => targetCommentId.trim(), [targetCommentId])

  const handleViewDetail = useCallback((id: string) => {
    if (!id) return
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(id)}` })
  }, [])

  return (
    <View className='interaction-feed-detail-page'>
      <ScrollView className='interaction-feed-detail-scroll' scrollY enhanced showScrollbar={false}>
        <View className='interaction-feed-detail-content'>
          {loading ? (
            <View className='interaction-feed-detail-loading'>
              <View className='interaction-feed-detail-loading-spinner' />
            </View>
          ) : !feedItem ? (
            <View className='interaction-feed-detail-empty'>
              <Text className='interaction-feed-detail-empty-text'>未找到对应动态</Text>
            </View>
          ) : (
            <View className='feed-list'>
              <View
                id={`feed-card-${feedItem.record.id}`}
                className={`feed-card${feedItem.record.description?.trim() && !feedItem.record.image_path ? ' feed-card-text-only' : ''}`}
              >
                <View className='feed-card-moments'>
                  <View className='feed-card-avatar-col'>
                    <View className='user-avatar'>
                      {feedItem.author.avatar ? (
                        <Image src={feedItem.author.avatar} mode='aspectFill' className='user-avatar-img' />
                      ) : (
                        <Text className='user-avatar-placeholder'>👤</Text>
                      )}
                    </View>
                  </View>
                  <View className='feed-card-main-col'>
                    <View className='feed-card-name-block'>
                      <Text className='user-name'>{feedItem.is_mine ? '我' : feedItem.author.nickname}</Text>
                      <Text className='post-time'>
                        {MEAL_NAMES[feedItem.record.meal_type] || feedItem.record.meal_type} · {formatFeedTime(feedItem.record.record_time)}
                      </Text>
                    </View>
                    {feedItem.record.diet_goal && feedItem.record.diet_goal !== 'none' ? (
                      <View className='feed-tags'>
                        <Text className='feed-tag'>{DIET_GOAL_NAMES[feedItem.record.diet_goal] || feedItem.record.diet_goal}</Text>
                      </View>
                    ) : null}
                    {feedItem.record.description && (
                      <Text className='feed-content'>{feedItem.record.description}</Text>
                    )}
                    {feedItem.record.image_path ? (
                      <View className='feed-image feed-tap-to-detail' onClick={() => handleViewDetail(feedItem.record.id)}>
                        <Image src={feedItem.record.image_path} mode='aspectFill' className='feed-image-content' />
                      </View>
                    ) : null}

                    <View className='feed-meta'>
                      <View className='feed-calorie feed-tap-to-detail' onClick={() => handleViewDetail(feedItem.record.id)}>
                        <Text className='feed-calorie-num'>{Number(feedItem.record.total_calories || 0).toFixed(0)}</Text>
                        <Text className='feed-calorie-unit'> kcal</Text>
                      </View>
                      <View className='feed-macros feed-tap-to-detail' onClick={() => handleViewDetail(feedItem.record.id)}>
                        <Text className='feed-macros-text'>
                          蛋白质 {Math.round(feedItem.record.total_protein ?? 0)}g · 碳水 {Math.round(feedItem.record.total_carbs ?? 0)}g · 脂肪 {Math.round(feedItem.record.total_fat ?? 0)}g
                        </Text>
                      </View>
                    </View>

                    <View className='feed-actions'>
                      <View className='action-item' onClick={handleLike}>
                        <Text className={`action-icon iconfont icon-good ${feedItem.liked ? 'liked' : ''}`} />
                        <Text className='action-count'>{feedItem.like_count}</Text>
                      </View>
                      <View
                        className='action-item feed-action-comment'
                        onClick={(e) => {
                          e.stopPropagation()
                          openComposer(null)
                        }}
                      >
                        <Text className='action-icon iconfont icon-pinglun' />
                        <Text className='action-count'>评论 {feedItem.comment_count || 0}</Text>
                      </View>
                    </View>

                    {(feedItem.comments?.length || 0) > 0 ? (
                      <View className='feed-comments'>
                        {(feedItem.comments || []).map((c) => (
                          <View
                            key={c.id}
                            className={`feed-comment-item ${c.reply_to_user_id ? 'is-reply' : ''} ${highlightCommentId && c.id === highlightCommentId ? 'is-target-comment' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openComposer(c)
                            }}
                          >
                            <View className='comment-avatar'>
                              {c.avatar ? (
                                <Image src={c.avatar} mode='aspectFill' className='comment-avatar-img' />
                              ) : (
                                <Text className='comment-avatar-placeholder'>👤</Text>
                              )}
                            </View>
                            <View className={`comment-body ${c.reply_to_user_id ? 'is-reply' : ''}`}>
                              <View className='comment-meta-line'>
                                <Text className='comment-author'>{c.nickname || '用户'}</Text>
                                {c.reply_to_user_id ? (
                                  <View className='comment-reply-join'>
                                    <Text className='comment-reply-arrow'>回复</Text>
                                    <Text className='comment-reply-target'>{c.reply_to_nickname || '用户'}</Text>
                                  </View>
                                ) : null}
                              </View>
                              <Text className='comment-content-text'>{c.content}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View className='feed-empty'>
                        <Text className='feed-empty-text'>还没有评论，来抢沙发</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {composerVisible ? (
        <View className='interaction-feed-detail-dismiss-mask' onClick={closeComposer} />
      ) : null}

      <View className={`comment-bottom-bar ${composerVisible ? 'visible' : ''}`} onClick={(e) => e.stopPropagation()}>
        <View className='comment-bottom-main'>
          <Input
            className='comment-bottom-input'
            placeholder={replyTargetComment ? `回复 ${replyTargetComment.nickname || '用户'}...` : '说点什么...'}
            placeholderClass='comment-bottom-placeholder'
            value={commentContent}
            onInput={(e) => setCommentContent(e.detail.value)}
            confirmType='send'
            focus={composerVisible}
            maxlength={500}
            cursorSpacing={24}
            onConfirm={handleSubmitComment}
          />
          <View
            className={`comment-bottom-send ${!commentContent.trim() && !submitting ? 'disabled' : ''} ${submitting ? 'is-submitting' : ''} ${commentContent.trim() ? 'is-ready' : ''}`}
            hoverClass='none'
            onClick={handleSubmitComment}
          >
            {submitting ? (
              <View className='comment-bottom-send-spinner' />
            ) : (
              <Text className='iconfont icon-send comment-bottom-send-icon' />
            )}
          </View>
        </View>
      </View>
    </View>
  )
}

export default withAuth(InteractionFeedDetailPage, { public: true })
