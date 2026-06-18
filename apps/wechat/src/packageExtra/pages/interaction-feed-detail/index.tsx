import { View, Text, Image, ScrollView, Input } from '@tarojs/components'
import { useCallback, useMemo, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import {
  communityGetComments,
  communityGetFeedContext,
  communityLike,
  communityPostComment,
  communityUnlike,
  deleteCirclePost,
  deleteExerciseLog,
  deleteFoodRecord,
  deletePublicFoodLibraryItem,
  showUnifiedApiError,
  type CommunityFeedTargetType,
  type CommunityFeedItem,
  type CommunityFeedRecord,
  type FeedCommentItem
} from '../../../utils/api'
import { getAccessToken } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { withAuth, redirectToLogin } from '../../../utils/withAuth'
import { CommunityFoodRecordEditSheet } from '../../../pages/community/components/CommunityFoodRecordEditSheet'
import { FeedReportMask } from '../../../pages/community/components/FeedReportMask'
import { FeedReportSheet } from '../../../pages/community/components/FeedReportSheet'
import { FeedActionSheet, type FeedActionSheetAction } from '../../../pages/community/components/FeedActionSheet'

import './index.scss'

const COLLAPSIBLE_FEED_TEXT_RUNE_THRESHOLD = 90

function shouldCollapseFeedText(value: string): boolean {
  return Array.from(String(value || '').trim()).length > COLLAPSIBLE_FEED_TEXT_RUNE_THRESHOLD
}

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
  return String(options.targetId || options.target_id || options.recordId || options.record_id || options.id || '').trim()
}

const VALID_TARGET_TYPES: CommunityFeedTargetType[] = ['food_record', 'exercise_log', 'circle_post', 'campus_food']

function pickTargetType(options: RouteOptions): CommunityFeedTargetType {
  const raw = (options.targetType || options.target_type || 'food_record') as string
  return VALID_TARGET_TYPES.includes(raw as CommunityFeedTargetType) ? (raw as CommunityFeedTargetType) : 'food_record'
}

function getFeedTargetType(item: CommunityFeedItem | null | undefined): CommunityFeedTargetType {
  return item?.target_type || item?.record?.feed_type || 'food_record'
}

function getFeedTargetId(item: CommunityFeedItem | null | undefined): string {
  return item?.target_id || item?.record?.id || ''
}

function isExerciseFeed(item: CommunityFeedItem | null | undefined): boolean {
  return getFeedTargetType(item) === 'exercise_log'
}

function isCirclePostFeed(item: CommunityFeedItem | null | undefined): boolean {
  return getFeedTargetType(item) === 'circle_post'
}

function InteractionFeedDetailPage() {
  const [recordId, setRecordId] = useState('')
  const [targetType, setTargetType] = useState<CommunityFeedTargetType>('food_record')
  const [targetCommentId, setTargetCommentId] = useState('')
  const [feedItem, setFeedItem] = useState<CommunityFeedItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [commentContent, setCommentContent] = useState('')
  const [replyTargetComment, setReplyTargetComment] = useState<FeedCommentItem | null>(null)
  const [composerVisible, setComposerVisible] = useState(false)
  const [editSheetVisible, setEditSheetVisible] = useState(false)
  const [reportVisible, setReportVisible] = useState(false)
  const [feedActionSheetVisible, setFeedActionSheetVisible] = useState(false)
  const [reportMaskVisible, setReportMaskVisible] = useState(false)
  const [feedTextExpanded, setFeedTextExpanded] = useState<Record<string, boolean>>({})
  const likePendingRef = useRef(false)

  const loadDetail = useCallback(async (nextRecordId: string, nextTargetType: CommunityFeedTargetType = 'food_record') => {
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

      const context = await withTimeout(communityGetFeedContext(nextRecordId, 5, nextTargetType))
      const contextItem = context.item
      const commentsRes = await withTimeout(communityGetComments(nextRecordId, nextTargetType))
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
    const nextTargetType = pickTargetType(options)
    setRecordId(nextRecordId)
    setTargetType(nextTargetType)
    const nextTarget = String(options?.commentId || options?.parentCommentId || '')
    setTargetCommentId(nextTarget)
    if (nextRecordId) {
      void loadDetail(nextRecordId, nextTargetType)
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
        await communityUnlike(getFeedTargetId(prev), getFeedTargetType(prev))
      } else {
        await communityLike(getFeedTargetId(prev), getFeedTargetType(prev))
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
      await communityPostComment(getFeedTargetId(feedItem), content, {
        parent_comment_id: replyTargetComment?.id,
        reply_to_user_id: replyTargetComment?.user_id
      }, getFeedTargetType(feedItem))
      closeComposer()
      await loadDetail(getFeedTargetId(feedItem), getFeedTargetType(feedItem))
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
    if (targetType === 'exercise_log') {
      const dateText = String(feedItem?.record?.record_time || feedItem?.record?.created_at || '').slice(0, 10)
      Taro.navigateTo({ url: `${extraPkgUrl('/pages/exercise-record/index')}${dateText ? `?date=${encodeURIComponent(dateText)}` : ''}` })
      return
    }
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/record-detail/index')}?id=${encodeURIComponent(id)}` })
  }, [targetType, feedItem])

  const handleDeleteFeedItem = useCallback(async () => {
    if (!feedItem) return
    const ttype = getFeedTargetType(feedItem)
    const tid = getFeedTargetId(feedItem)
    const { confirm } = await Taro.showModal({
      title: '确认删除',
      content: '删除后不可恢复，是否继续？',
      confirmText: '删除',
      confirmColor: '#ef4444'
    })
    if (!confirm) return
    try {
      if (ttype === 'circle_post') {
        await deleteCirclePost(tid)
      } else if (ttype === 'food_record') {
        await deleteFoodRecord(tid)
      } else if (ttype === 'exercise_log') {
        await deleteExerciseLog(tid)
      } else if (ttype === 'campus_food') {
        await deletePublicFoodLibraryItem(tid)
      }
      Taro.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 500)
    } catch (e) {
      await showUnifiedApiError(e, '删除失败')
    }
  }, [feedItem])

  const feedActionSheetActions = useMemo<FeedActionSheetAction[]>(() => {
    if (!feedItem) return []
    if (!feedItem.is_mine) {
      return [{ id: 'report', label: '举报', iconClass: 'icon-jinggao', danger: true }]
    }
    const ttype = getFeedTargetType(feedItem)
    const actions: FeedActionSheetAction[] = []
    if (ttype === 'circle_post' || ttype === 'food_record' || ttype === 'exercise_log' || ttype === 'campus_food') {
      actions.push({ id: 'edit', label: '编辑', iconClass: 'icon-edit', color: '#10b981' })
    }
    actions.push({ id: 'delete', label: '删除', iconClass: 'icon-shanchu', danger: true })
    return actions
  }, [feedItem])

  const handleFeedActionSelect = useCallback((id: string) => {
    if (!feedItem) return
    if (!feedItem.is_mine) {
      if (id === 'report') setReportVisible(true)
      return
    }
    const ttype = getFeedTargetType(feedItem)
    const tid = getFeedTargetId(feedItem)
    if (id === 'edit') {
      if (ttype === 'circle_post') {
        Taro.navigateTo({ url: extraPkgUrl(`/pages/circle-post-edit/index?id=${encodeURIComponent(tid)}`) })
      } else if (ttype === 'food_record') {
        setEditSheetVisible(true)
      } else if (ttype === 'exercise_log') {
        Taro.navigateTo({ url: extraPkgUrl(`/pages/exercise-record/index?log_id=${encodeURIComponent(tid)}`) })
      } else if (ttype === 'campus_food') {
        Taro.navigateTo({ url: extraPkgUrl(`/pages/campus-food-share/index?item_id=${encodeURIComponent(tid)}`) })
      }
      return
    }
    if (id === 'delete') {
      void handleDeleteFeedItem()
    }
  }, [feedItem, handleDeleteFeedItem])

  const toggleFeedTextExpanded = useCallback((key: string): void => {
    setFeedTextExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const renderCollapsibleFeedText = useCallback((key: string, text: string, className = 'feed-content') => {
    const expandable = shouldCollapseFeedText(text)
    const collapsed = expandable && !feedTextExpanded[key]
    return (
      <View className={`feed-collapsible-text ${collapsed ? 'is-collapsed' : ''}`}>
        <Text className={className}>{text}</Text>
        {expandable ? (
          <View
            className='feed-text-toggle'
            onClick={(e) => {
              e.stopPropagation()
              toggleFeedTextExpanded(key)
            }}
          >
            <Text className='feed-text-toggle-text'>{collapsed ? '展开' : '收起'}</Text>
          </View>
        ) : null}
      </View>
    )
  }, [feedTextExpanded, toggleFeedTextExpanded])

  return (
    <>
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
              {(() => {
                const exercise = isExerciseFeed(feedItem)
                const isCirclePost = isCirclePostFeed(feedItem)
                const feedTime = String(feedItem.record.record_time || feedItem.record.created_at || '')
                const exerciseTitle = feedItem.record.exercise_type || '运动打卡'
                const exerciseDesc = feedItem.record.exercise_desc || feedItem.record.description || ''
                const circlePostTitle = isCirclePost ? (feedItem.record.title || '') : ''
                const circlePostBody = isCirclePost ? (feedItem.record.body || '') : ''
                const circlePostText = circlePostTitle || circlePostBody
                const exerciseKcal = Number(feedItem.record.calories_burned ?? feedItem.record.total_calories ?? 0)
                const detailTargetKey = `${getFeedTargetType(feedItem)}-${getFeedTargetId(feedItem)}`
                return (
              <View
                id={`feed-card-${getFeedTargetType(feedItem)}-${getFeedTargetId(feedItem)}`}
                className={`feed-card${(feedItem.record.description?.trim() || exerciseDesc || circlePostText.trim()) && !feedItem.record.image_path ? ' feed-card-text-only' : ''} ${exercise ? 'feed-card-exercise' : ''} ${isCirclePost ? 'feed-card-circle-post' : ''}`}
                style={isCirclePost ? { position: 'relative' } : undefined}
                onLongPress={() => {
                  if (isCirclePost && !feedItem.is_mine) {
                    setReportMaskVisible(true)
                  }
                }}
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
                        {isCirclePost ? `自定义动态 · ${formatFeedTime(feedTime)}` : exercise ? `运动打卡 · ${formatFeedTime(feedTime)}` : `${MEAL_NAMES[feedItem.record.meal_type] || feedItem.record.meal_type} · ${formatFeedTime(feedTime)}`}
                      </Text>
                    </View>
                    {!isCirclePost && (exercise ? (
                      <View className='feed-tags'>
                        <Text className='feed-tag'>{exerciseTitle}</Text>
                      </View>
                    ) : feedItem.record.diet_goal && feedItem.record.diet_goal !== 'none' ? (
                      <View className='feed-tags'>
                        <Text className='feed-tag'>{DIET_GOAL_NAMES[feedItem.record.diet_goal] || feedItem.record.diet_goal}</Text>
                      </View>
                    ) : null)}
                    {isCirclePost ? (
                      <>
                        {circlePostTitle ? <Text className='feed-circle-post-title'>{circlePostTitle}</Text> : null}
                        {circlePostBody ? <Text className='feed-content feed-circle-post-body'>{circlePostBody}</Text> : null}
                      </>
                    ) : (exercise ? exerciseDesc : feedItem.record.description) ? (
                      exercise
                        ? renderCollapsibleFeedText(`${detailTargetKey}-desc`, exerciseDesc)
                        : <Text className='feed-content'>{feedItem.record.description}</Text>
                    ) : null}
                    {feedItem.record.image_path && !isCirclePost ? (
                      <View className='feed-image feed-tap-to-detail' onClick={() => handleViewDetail(feedItem.record.id)}>
                        <Image src={feedItem.record.image_path} mode='aspectFill' className='feed-image-content' />
                      </View>
                    ) : null}
                    {isCirclePost && (feedItem.record.image_paths || []).length > 0 && (
                      <View className='feed-circle-post-images'>
                        {(feedItem.record.image_paths || []).map((url, idx) => (
                          <View
                            key={`detail-img-${idx}`}
                            className='feed-circle-post-image-item'
                            onClick={() => {
                              Taro.previewImage({
                                current: url,
                                urls: feedItem.record.image_paths || []
                              })
                            }}
                          >
                            <Image src={url} mode='aspectFill' className='feed-circle-post-image' />
                          </View>
                        ))}
                      </View>
                    )}
                    {isCirclePost && (() => {
                      const n = feedItem.record
                      const hasNutrition = Number(n.total_calories) > 0 || Number(n.total_protein) > 0 || Number(n.total_carbs) > 0 || Number(n.total_fat) > 0 || Number(n.fiber) > 0 || Number(n.sugar) > 0 || Number(n.sodium_mg) > 0 || Number(n.total_weight_grams) > 0
                      if (!hasNutrition) return null
                      return (
                        <View className='feed-meta feed-meta--circle-post'>
                          <View className='feed-calorie'>
                            <Text className='van-icon van-icon-fire-o taroify-icon taroify-icon--inherit feed-calorie-icon' />
                            <Text className='feed-calorie-num'>{Math.round(Number(n.total_calories || 0))}</Text>
                            <Text className='feed-calorie-unit'>kcal</Text>
                          </View>
                          <View className='feed-macros'>
                            <Text className='feed-macros-text'>
                              蛋白质 {Math.round(Number(n.total_protein ?? 0))}g · 碳水 {Math.round(Number(n.total_carbs ?? 0))}g · 脂肪 {Math.round(Number(n.total_fat ?? 0))}g
                              {Number(n.fiber) > 0 ? ` · 膳食纤维 ${Math.round(Number(n.fiber ?? 0))}g` : ''}
                              {Number(n.sugar) > 0 ? ` · 糖分 ${Math.round(Number(n.sugar ?? 0))}g` : ''}
                              {Number(n.sodium_mg) > 0 ? ` · 钠 ${Math.round(Number(n.sodium_mg ?? 0))}mg` : ''}
                              {Number(n.total_weight_grams) > 0 ? ` · 重量 ${Math.round(Number(n.total_weight_grams ?? 0))}g` : ''}
                            </Text>
                          </View>
                        </View>
                      )
                    })()}

                    {!isCirclePost && (
                      <View className='feed-meta'>
                        <View className='feed-calorie feed-tap-to-detail' onClick={() => handleViewDetail(feedItem.record.id)}>
                          <Text className='feed-calorie-num'>{(exercise ? exerciseKcal : Number(feedItem.record.total_calories || 0)).toFixed(0)}</Text>
                          <Text className='feed-calorie-unit'> kcal{exercise ? ' 消耗' : ''}</Text>
                        </View>
                        <View className='feed-macros feed-tap-to-detail' onClick={() => handleViewDetail(feedItem.record.id)}>
                          {exercise
                            ? renderCollapsibleFeedText(
                              `${detailTargetKey}-reasoning`,
                              feedItem.record.ai_reasoning || 'AI 已根据运动内容估算消耗',
                              'feed-macros-text'
                            )
                            : (
                              <Text className='feed-macros-text'>
                                蛋白质 {Math.round(feedItem.record.total_protein ?? 0)}g · 碳水 {Math.round(feedItem.record.total_carbs ?? 0)}g · 脂肪 {Math.round(feedItem.record.total_fat ?? 0)}g
                              </Text>
                            )}
                        </View>
                      </View>
                    )}

                    <View className='feed-actions'>
                      <View className='feed-actions-left'>
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
                      <View
                        className='action-item action-manage'
                        onClick={(e) => {
                          e.stopPropagation()
                          setFeedActionSheetVisible(true)
                        }}
                      >
                        <View className='action-manage-box'>
                          <Text className='action-manage-icon'>⋮</Text>
                        </View>
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
                {reportMaskVisible ? (
                  <FeedReportMask
                    visible
                    onReport={() => {
                      setReportVisible(true)
                      setReportMaskVisible(false)
                    }}
                    onCancel={() => setReportMaskVisible(false)}
                  />
                ) : null}
              </View>
                )
              })()}
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
      <CommunityFoodRecordEditSheet
        visible={editSheetVisible}
        record={feedItem?.record}
        onClose={() => setEditSheetVisible(false)}
        onSuccess={(updatedRecord) => {
          if (!feedItem) return
          setFeedItem({
            ...feedItem,
            record: {
              ...feedItem.record,
              ...updatedRecord,
              feed_type: feedItem.record.feed_type,
            },
          })
        }}
      />
      <FeedActionSheet
        visible={feedActionSheetVisible}
        actions={feedActionSheetActions}
        onClose={() => setFeedActionSheetVisible(false)}
        onSelect={handleFeedActionSelect}
      />
      <FeedReportSheet
        visible={reportVisible}
        targetType={feedItem ? getFeedTargetType(feedItem) : 'circle_post'}
        targetId={feedItem ? getFeedTargetId(feedItem) : ''}
        onClose={() => setReportVisible(false)}
      />
    </>
  )
}

export default withAuth(InteractionFeedDetailPage, { public: true })
