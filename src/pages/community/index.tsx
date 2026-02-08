import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro from '@tarojs/taro'

import {
  getAccessToken,
  friendSearch,
  friendSendRequest,
  friendGetRequests,
  friendRespondRequest,
  friendGetList,
  friendCleanupDuplicates,
  communityGetFeed,
  communityLike,
  communityUnlike,
  communityGetComments,
  communityPostComment,
  type FriendSearchUser,
  type FriendRequestItem,
  type FriendListItem,
  type CommunityFeedItem,
  type FeedCommentItem
} from '../../utils/api'
import { IconCamera } from '../../components/iconfont'

import './index.scss'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
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

export default function CommunityPage() {
  const [loggedIn, setLoggedIn] = useState(!!getAccessToken())
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [requests, setRequests] = useState<FriendRequestItem[]>([])
  const [feedList, setFeedList] = useState<CommunityFeedItem[]>([])
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [loadingFeed, setLoadingFeed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddFriend, setShowAddFriend] = useState(false)
  const [showRequests, setShowRequests] = useState(false)

  // 评论：每条动态的评论列表、当前展开评论输入的 recordId、输入内容、提交中
  const [commentsByRecordId, setCommentsByRecordId] = useState<Record<string, FeedCommentItem[]>>({})
  const [expandedCommentRecordId, setExpandedCommentRecordId] = useState<string | null>(null)
  const [commentContent, setCommentContent] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)

  // 添加好友：搜索类型、关键词、结果、发送中
  const [searchType, setSearchType] = useState<'nickname' | 'telephone'>('nickname')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<FriendSearchUser[]>([])
  const [searching, setSearching] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

  const loadFriendsAndRequests = useCallback(async () => {
    if (!getAccessToken()) return
    setLoadingFriends(true)
    try {
      // 先清理可能存在的重复好友记录
      await friendCleanupDuplicates().catch(() => {})
      
      const [listRes, reqRes] = await Promise.all([
        friendGetList(),
        friendGetRequests()
      ])
      setFriends(listRes.list || [])
      setRequests(reqRes.list || [])
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '加载失败', icon: 'none' })
    } finally {
      setLoadingFriends(false)
    }
  }, [])

  const loadFeed = useCallback(async () => {
    if (!getAccessToken()) return
    setLoadingFeed(true)
    try {
      const res = await communityGetFeed()
      setFeedList(res.list || [])
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '加载动态失败', icon: 'none' })
    } finally {
      setLoadingFeed(false)
    }
  }, [])

  useEffect(() => {
    setLoggedIn(!!getAccessToken())
    if (getAccessToken()) {
      loadFriendsAndRequests()
      loadFeed()
    }
  }, [loadFriendsAndRequests, loadFeed])

  // Feed 加载后，为每条动态加载前 5 条评论
  useEffect(() => {
    if (!getAccessToken() || feedList.length === 0) return
    const loadComments = async () => {
      const results = await Promise.allSettled(
        feedList.map((item) => communityGetComments(item.record.id))
      )
      const next: Record<string, FeedCommentItem[]> = {}
      results.forEach((r, i) => {
        const recordId = feedList[i].record.id
        if (r.status === 'fulfilled' && r.value?.list) {
          next[recordId] = r.value.list.slice(0, 5)
        } else {
          next[recordId] = []
        }
      })
      setCommentsByRecordId((prev) => ({ ...prev, ...next }))
    }
    loadComments()
  }, [feedList])

  // ScrollView 自带下拉刷新（页面级下拉被内部 ScrollView 接管，需用 refresher）
  const handleRefresherRefresh = useCallback(() => {
    if (!getAccessToken()) {
      setRefreshing(false)
      return
    }
    setRefreshing(true)
    Promise.all([loadFriendsAndRequests(), loadFeed()]).finally(() => {
      setRefreshing(false)
    })
  }, [loadFriendsAndRequests, loadFeed])

  const handleSearchUser = async () => {
    const kw = searchKeyword.trim()
    if (!kw) {
      Taro.showToast({ title: '请输入昵称或手机号', icon: 'none' })
      return
    }
    setSearching(true)
    setSearchResults([])
    try {
      const params = searchType === 'telephone' ? { telephone: kw } : { nickname: kw }
      const res = await friendSearch(params)
      setSearchResults(res.list || [])
      if (!res.list?.length) Taro.showToast({ title: '未找到用户', icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '搜索失败', icon: 'none' })
    } finally {
      setSearching(false)
    }
  }

  const handleSendRequest = async (userId: string) => {
    setSendingId(userId)
    try {
      await friendSendRequest(userId)
      Taro.showToast({ title: '已发送好友请求', icon: 'success' })
      setSearchResults(prev => prev.filter(u => u.id !== userId))
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '发送失败', icon: 'none' })
    } finally {
      setSendingId(null)
    }
  }

  const handleRespondRequest = async (requestId: string, accept: boolean) => {
    try {
      await friendRespondRequest(requestId, accept ? 'accept' : 'reject')
      Taro.showToast({ title: accept ? '已添加好友' : '已拒绝', icon: 'success' })
      setRequests(prev => prev.filter(r => r.id !== requestId))
      if (accept) {
        loadFriendsAndRequests()
        loadFeed()
      }
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '操作失败', icon: 'none' })
    }
  }

  const handleLike = async (item: CommunityFeedItem) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      if (item.liked) {
        await communityUnlike(item.record.id)
      } else {
        await communityLike(item.record.id)
      }
      setFeedList(prev =>
        prev.map(f =>
          f.record.id === item.record.id
            ? {
                ...f,
                liked: !f.liked,
                like_count: f.like_count + (f.liked ? -1 : 1)
              }
            : f
        )
      )
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '操作失败', icon: 'none' })
    }
  }

  /** 点击帖子查看详情（与记录页详情共用 record-detail 页，通过 storage 传 record） */
  const handleViewDetail = (record: CommunityFeedItem['record']) => {
    try {
      Taro.setStorageSync('recordDetail', record)
      Taro.navigateTo({ url: '/pages/record-detail/index' })
    } catch (e) {
      Taro.showToast({ title: '打开详情失败', icon: 'none' })
    }
  }

  const toggleCommentInput = (recordId: string) => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    if (expandedCommentRecordId === recordId) {
      setExpandedCommentRecordId(null)
      setCommentContent('')
    } else {
      setExpandedCommentRecordId(recordId)
      setCommentContent('')
      // 若尚未加载该卡片的评论，则加载
      if (!commentsByRecordId[recordId]) {
        communityGetComments(recordId)
          .then((res) => {
            setCommentsByRecordId((prev) => ({
              ...prev,
              [recordId]: (res.list || []).slice(0, 5)
            }))
          })
          .catch(() => Taro.showToast({ title: '加载评论失败', icon: 'none' }))
      }
    }
  }

  const submitComment = async () => {
    if (!expandedCommentRecordId || !commentContent.trim()) return
    setCommentSubmitting(true)
    try {
      await communityPostComment(expandedCommentRecordId, commentContent.trim())
      const res = await communityGetComments(expandedCommentRecordId)
      setCommentsByRecordId((prev) => ({
        ...prev,
        [expandedCommentRecordId]: (res.list || []).slice(0, 5)
      }))
      setCommentContent('')
      Taro.showToast({ title: '评论成功', icon: 'success' })
    } catch (e) {
      Taro.showToast({ title: (e as Error).message || '发表失败', icon: 'none' })
    } finally {
      setCommentSubmitting(false)
    }
  }

  /**
   * 拍照识别：直接进入拍照分析流程
   */
  const handlePhotoAnalyze = () => {
    Taro.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const imagePath = res.tempFilePaths[0]
        Taro.setStorageSync('analyzeImagePath', imagePath)
        Taro.navigateTo({ url: '/pages/analyze/index' })
      },
      fail: (err) => {
        if (err?.errMsg?.includes('cancel')) return
        console.error('选择图片失败:', err)
        Taro.showToast({ title: '选择图片失败', icon: 'none' })
      }
    })
  }

  const topics = [
    { id: 1, name: '#减脂成功经验' },
    { id: 2, name: '#增肌食谱分享' },
    { id: 3, name: '#运动打卡' },
    { id: 4, name: '#健康饮食' },
    { id: 5, name: '#数据记录' }
  ]

  return (
    <View className='community-page'>
      <View className='community-scroll-wrap'>
        <ScrollView
          className='community-scroll'
          scrollY
          enhanced
          showScrollbar={false}
          refresherEnabled
          refresherTriggered={refreshing}
          onRefresherRefresh={handleRefresherRefresh}
          refresherDefaultStyle='black'
        >
          <View className='community-scroll-content'>
        <View className='page-header'>
          <Text className='page-title'>健康圈子</Text>
          <Text className='page-subtitle'>与好友一起分享健康饮食</Text>
        </View>

        {!loggedIn ? (
          <View className='login-tip'>
            <Text className='login-tip-text'>登录后查看好友动态、添加好友</Text>
            <Button className='login-tip-btn' onClick={() => Taro.navigateTo({ url: '/pages/profile/index' })}>
              去登录
            </Button>
          </View>
        ) : (
          <>
            {/* 好友区域 */}
            <View className='friends-section'>
              <View className='section-header'>
                <Text className='section-title'>好友</Text>
                <View className='header-actions'>
                  {requests.length > 0 && (
                    <View className='requests-badge' onClick={() => setShowRequests(true)}>
                      <Text className='requests-badge-text'>好友请求 ({requests.length})</Text>
                    </View>
                  )}
                  <View className='view-all-btn' onClick={() => setShowAddFriend(true)}>
                    <Text className='view-all-text'>添加好友</Text>
                    <Text className='arrow'>{'>'}</Text>
                  </View>
                </View>
              </View>
              {loadingFriends ? (
                <Text className='loading-text'>加载中...</Text>
              ) : friends.length === 0 ? (
                <Text className='empty-text'>暂无好友，点击「添加好友」搜索昵称或手机号添加</Text>
              ) : (
                <ScrollView
                  className='friends-list'
                  scrollX
                  enhanced
                  showScrollbar={false}
                >
                  <View className='friends-list-inner'>
                    {friends.map((f) => (
                      <View key={f.id} className='friend-item'>
                        <View className='friend-avatar'>
                          {f.avatar ? (
                            <Image src={f.avatar} mode='aspectFill' className='friend-avatar-img' />
                          ) : (
                            <Text className='friend-avatar-placeholder'>👤</Text>
                          )}
                        </View>
                        <Text className='friend-name' numberOfLines={1}>{f.nickname || '用户'}</Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>

            {/* 我的圈子 */}
            <View className='my-circles-section'>
              <View className='section-header'>
                <Text className='section-title'>发现</Text>
              </View>
              <View className='circles-list'>
                <View
                  className='circle-card'
                  onClick={() => Taro.navigateTo({ url: '/pages/food-library/index' })}
                >
                  <Text className='circle-icon iconfont icon-shiwu' />
                  <Text className='circle-name'>公共食物库</Text>
                  <View className='circle-members'>
                    {/* <Text className='member-icon iconfont icon-dizhi' /> */}
                    <Text className='member-count'>健康外卖推荐</Text>
                  </View>
                </View>
                <View
                  className='circle-card'
                  onClick={() => Taro.showToast({ title: '敬请期待', icon: 'none' })}
                >
                  <Text className='circle-icon iconfont icon-weibiaoti-_huabanfuben' />
                  <Text className='circle-name'>打卡排行榜</Text>
                  <View className='circle-members'>
                    {/* <Text className='member-icon iconfont icon-duoren' /> */}
                    <Text className='member-count'>本周活跃</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* 本周打卡排行榜（占位） */}
            <View
              className='ranking-banner'
              onClick={() => Taro.showToast({ title: '敬请期待', icon: 'none' })}
            >
              <View className='ranking-content'>
                <View className='ranking-text'>
                  <Text className='ranking-title'>本周打卡排行榜</Text>
                  <Text className='ranking-subtitle'>看看谁是本周最活跃</Text>
                </View>
              </View>
              <Text className='ranking-arrow'>{'>'}</Text>
            </View>

            {/* 热门话题 */}
            <View className='topics-section'>
              <View className='section-header'>
                <View className='section-title-wrapper'>
                  <Text className='section-title-icon iconfont icon-shangzhang' />
                  <Text className='section-title'>热门话题</Text>
                </View>
              </View>
              <ScrollView className='topics-list-wrapper' scrollX enhanced showScrollbar={false}>
                <View className='topics-list'>
                  {topics.map((t) => (
                    <View key={t.id} className='topic-tag'>
                      <Text>{t.name}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* 好友今日饮食动态 */}
            <View className='feed-section'>
              <View className='section-header'>
                <Text className='section-title'>好友今日饮食</Text>
              </View>
              {loadingFeed ? (
                <Text className='loading-text'>加载中...</Text>
              ) : feedList.length === 0 ? (
                <View className='feed-empty'>
                  <Text className='feed-empty-text'>暂无好友今日饮食动态，添加好友后这里会显示他们的记录</Text>
                </View>
              ) : (
                <View className='feed-list'>
                  {feedList.map((item) => (
                    <View
                      key={item.record.id}
                      className='feed-card'
                      onClick={() => handleViewDetail(item.record)}
                    >
                      <View className='feed-header'>
                        <View className='user-avatar'>
                          {item.author.avatar ? (
                            <Image src={item.author.avatar} mode='aspectFill' className='user-avatar-img' />
                          ) : (
                            <Text className='user-avatar-placeholder'>👤</Text>
                          )}
                        </View>
                        <View className='user-info'>
                          <Text className='user-name'>{item.is_mine ? '我' : item.author.nickname}</Text>
                          <Text className='post-time'>
                            {MEAL_NAMES[item.record.meal_type] || item.record.meal_type} · {formatFeedTime(item.record.record_time)}
                          </Text>
                        </View>
                      </View>
                      {item.record.description && (
                        <Text className='feed-content'>{item.record.description}</Text>
                      )}
                      {item.record.image_path && (
                        <View className='feed-image'>
                          <Image
                            src={item.record.image_path}
                            mode='aspectFill'
                            className='feed-image-content'
                          />
                        </View>
                      )}
                      <View className='feed-meta'>
                        <Text className='feed-calorie'>
                          {Number(item.record.total_calories || 0).toFixed(0)} kcal
                        </Text>
                        <Text className='feed-macros'>
                          蛋白质 {Math.round(item.record.total_protein ?? 0)}g · 碳水 {Math.round(item.record.total_carbs ?? 0)}g · 脂肪 {Math.round(item.record.total_fat ?? 0)}g
                        </Text>
                      </View>
                      <View
                        className='feed-actions'
                        onClick={(e) => e.stopPropagation()}
                      >
                        <View
                          className='action-item'
                          onClick={() => handleLike(item)}
                        >
                        <Text
                          className={`action-icon iconfont icon-good ${item.liked ? 'liked' : ''}`}
                        />
                          <Text className='action-count'>{item.like_count}</Text>
                        </View>
                        <View
                          className='action-item'
                          onClick={() => toggleCommentInput(item.record.id)}
                        >
                        <Text className='action-icon iconfont icon-pinglun' />
                          <Text className='action-count'>评论</Text>
                        </View>
                      </View>
                      {/* 前 5 条评论 */}
                      {(commentsByRecordId[item.record.id]?.length ?? 0) > 0 && (
                        <View className='feed-comments' onClick={(e) => e.stopPropagation()}>
                          {(commentsByRecordId[item.record.id] || []).map((c) => (
                            <View key={c.id} className='feed-comment-item'>
                              <View className='comment-avatar'>
                                {c.avatar ? (
                                  <Image src={c.avatar} mode='aspectFill' className='comment-avatar-img' />
                                ) : (
                                  <Text className='comment-avatar-placeholder'>👤</Text>
                                )}
                              </View>
                              <View className='comment-body'>
                                <Text className='comment-text'>
                                  <Text className='comment-author'>{c.nickname || '用户'}</Text>
                                  <Text> {c.content}</Text>
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                      {/* 评论输入框（点击评论后展开） */}
                      {expandedCommentRecordId === item.record.id && (
                        <View className='feed-comment-input-wrap' onClick={(e) => e.stopPropagation()}>
                          <Input
                            className='feed-comment-input'
                            placeholder='说点什么...'
                            value={commentContent}
                            onInput={(e) => setCommentContent(e.detail.value)}
                          />
                          <Button
                            className='feed-comment-send'
                            size='mini'
                            onClick={submitComment}
                            disabled={commentSubmitting || !commentContent.trim()}
                          >
                            {commentSubmitting ? '发送中' : '发送'}
                          </Button>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
          </View>
        </ScrollView>
      </View>

      {/* 添加好友弹窗 */}
      {showAddFriend && (
        <View className='modal-mask' onClick={() => setShowAddFriend(false)}>
          <View className='modal-box add-friend-modal' onClick={e => e.stopPropagation()}>
            <Text className='modal-title'>添加好友</Text>
            <View className='search-type-row'>
              <View
                className={`search-type-btn ${searchType === 'nickname' ? 'active' : ''}`}
                onClick={() => setSearchType('nickname')}
              >
                <Text>昵称</Text>
              </View>
              <View
                className={`search-type-btn ${searchType === 'telephone' ? 'active' : ''}`}
                onClick={() => setSearchType('telephone')}
              >
                <Text>手机号</Text>
              </View>
            </View>
            <View className='search-row'>
              <Input
                className='search-input'
                placeholder={searchType === 'nickname' ? '输入昵称搜索' : '输入手机号搜索'}
                value={searchKeyword}
                onInput={e => setSearchKeyword(e.detail.value)}
              />
              <Button className='search-btn' onClick={handleSearchUser} disabled={searching}>
                {searching ? '搜索中' : '搜索'}
              </Button>
            </View>
            <ScrollView className='search-results' scrollY>
              {searchResults.map((u) => (
                <View key={u.id} className='search-result-item'>
                  <View className='result-avatar'>
                    {u.avatar ? (
                      <Image src={u.avatar} mode='aspectFill' className='result-avatar-img' />
                    ) : (
                      <Text>👤</Text>
                    )}
                  </View>
                  <Text className='result-name'>{u.nickname || '用户'}</Text>
                  {u.is_friend ? (
                    <Text className='result-status-tag added'>已添加</Text>
                  ) : u.is_pending ? (
                    <Text className='result-status-tag pending'>已发送</Text>
                  ) : (
                    <Button
                      className='result-add-btn'
                      size='mini'
                      onClick={() => handleSendRequest(u.id)}
                      disabled={!!sendingId}
                    >
                      {sendingId === u.id ? '发送中' : '加好友'}
                    </Button>
                  )}
                </View>
              ))}
            </ScrollView>
            <Button className='modal-close-btn' onClick={() => setShowAddFriend(false)}>关闭</Button>
          </View>
        </View>
      )}

      {/* 收到的请求弹窗 */}
      {showRequests && (
        <View className='modal-mask' onClick={() => setShowRequests(false)}>
          <View className='modal-box requests-modal' onClick={e => e.stopPropagation()}>
            <Text className='modal-title'>好友请求</Text>
            <ScrollView className='requests-list' scrollY>
              {requests.map((r) => (
                <View key={r.id} className='request-item'>
                  <View className='request-avatar'>
                    {r.from_avatar ? (
                      <Image src={r.from_avatar} mode='aspectFill' className='request-avatar-img' />
                    ) : (
                      <Text>👤</Text>
                    )}
                  </View>
                  <Text className='request-name'>{r.from_nickname}</Text>
                  <View className='request-actions'>
                    <Button size='mini' className='request-reject' onClick={() => handleRespondRequest(r.id, false)}>拒绝</Button>
                    <Button size='mini' className='request-accept' onClick={() => handleRespondRequest(r.id, true)}>接受</Button>
                  </View>
                </View>
              ))}
            </ScrollView>
            <Button className='modal-close-btn' onClick={() => setShowRequests(false)}>关闭</Button>
          </View>
        </View>
      )}

      {/* 去记录一餐（记录后好友可在圈子看到） */}
      {loggedIn && (
        <View
          className='fab-button'
          onClick={handlePhotoAnalyze}
        >
          <View className='fab-icon'>
            <IconCamera size={48} color="#ffffff" />
          </View>
        </View>
      )}
    </View>
  )
}
