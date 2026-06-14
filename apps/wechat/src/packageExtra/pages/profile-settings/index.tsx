import { View, Text, Image, Button, Input, Canvas } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro, { useRouter, useReachBottom } from '@tarojs/taro'
import {
  updateUserInfo,
  uploadUserAvatar,
  uploadCoverImage,
  imageToBase64,
  showUnifiedApiError,
  clearAllStorage,
  deleteAccount,
  getUserProfile,
  getUserRecordDays,
  getPublicFoodLibraryCollections,
  getUserRecipes,
  getPublicUserProfile,
  getUserCollections,
  getUserFavoriteRecipes,
  communityGetFeed,
  communityGetPublicFeed,
  followUser,
  unfollowUser,
  getFollowStats,
  resolveFriendInvite,
  type PublicFoodLibraryItem,
  type UserRecipe,
  type CommunityFeedItem,
  type FollowStats,
  type CommunityFeedTargetType,
} from '../../../utils/api'
import drawQrcode from 'weapp-qrcode-canvas-2d'
import {
  drawProfilePoster,
  computeProfilePosterHeight,
  POSTER_WIDTH,
  loadCanvasImage,
} from '../../../utils/poster'
import { resolveCanvasImageSrc } from '../../../utils/weapp-canvas-image'
import { isShowShareImageMenuCancel } from '../../../utils/weapp-share-image'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { FeedReportMask } from '../../../pages/community/components/FeedReportMask'
import { FeedReportSheet } from '../../../pages/community/components/FeedReportSheet'
import { FeedActionSheet } from '../../../pages/community/components/FeedActionSheet'
import { LOGIN_LOGO_URL } from '../../../utils/static-asset-cdn-url'
import './index.scss'

type TabKey = 'feed' | 'collections'

function formatShortId(userId: string): string {
  if (!userId) return '—'
  const parts = userId.split('-')
  return parts[0] || userId.slice(0, 8)
}

function formatFeedTime(recordTime: string): string {
  if (!recordTime) return ''
  const d = new Date(recordTime)
  if (Number.isNaN(d.getTime())) return recordTime.slice(0, 16).replace('T', ' ')
  const diff = Date.now() - d.getTime()
  if (diff >= 0 && diff < 60000) return '刚刚'
  if (diff >= 0 && diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff >= 0 && diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  const now = new Date()
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (isToday) return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐',
}

export default function ProfileSettingsPage() {
  const { scheme } = useAppColorScheme()
  const router = useRouter()

  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()

  const [isOwner, setIsOwner] = useState(true)
  // 初始为空，避免在 URL 参数解析前误用当前用户 ID 加载他人主页
  const [resolvedUserId, setResolvedUserId] = useState('')

  // 用户信息
  const [tempAvatar, setTempAvatar] = useState('')
  const [tempNickname, setTempNickname] = useState('')
  const [userId, setUserId] = useState('')
  const [recordDays, setRecordDays] = useState(0)
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)

  // 分享海报
  const [posterGenerating, setPosterGenerating] = useState(false)

  // 编辑弹窗
  const [showEditSheet, setShowEditSheet] = useState(false)
  const [editNickname, setEditNickname] = useState('')
  const [editAvatar, setEditAvatar] = useState('')
  const [editCoverImage, setEditCoverImage] = useState('')
  const [editMotto, setEditMotto] = useState('')
  const [saving, setSaving] = useState(false)

  // 座右铭
  const [motto, setMotto] = useState('')

  // 背景图
  const [coverImage, setCoverImage] = useState('')

  // Tab
  const [activeTab, setActiveTab] = useState<TabKey>('feed')

  // 动态
  const [feedList, setFeedList] = useState<CommunityFeedItem[]>([])
  const [feedOffset, setFeedOffset] = useState(0)
  const [feedHasMore, setFeedHasMore] = useState(true)
  const [feedLoading, setFeedLoading] = useState(false)
  const [reportTarget, setReportTarget] = useState<{ targetType: CommunityFeedTargetType; targetId: string } | null>(null)
  const [feedActionSheetTarget, setFeedActionSheetTarget] = useState<{ targetType: CommunityFeedTargetType; targetId: string } | null>(null)
  const [reportMaskTarget, setReportMaskTarget] = useState<{ targetType: CommunityFeedTargetType; targetId: string } | null>(null)

  // 收藏
  const [foodCollections, setFoodCollections] = useState<PublicFoodLibraryItem[]>([])
  const [recipeCollections, setRecipeCollections] = useState<UserRecipe[]>([])

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
  }, [scheme])

  // 初始化：解析 URL 参数和 auto_follow 场景
  useEffect(() => {
    const init = async () => {
      const targetUserId = String(router.params.user_id || '').trim()
      const autoFollowFlag = router.params.auto_follow || router.params.pf

      if (autoFollowFlag && !targetUserId) {
        const code = Taro.getStorageSync('auto_follow') || Taro.getStorageSync('pending_profile_follow_code')
        if (code) {
          try {
            const invite = await resolveFriendInvite(code)
            if (invite?.user_id) {
              setResolvedUserId(invite.user_id)
              setIsOwner(false)
              return
            }
          } catch {
            // 解析失败，回退到默认
          }
        }
      }

      const owner = !targetUserId || targetUserId === currentUserId
      setIsOwner(owner)
      setResolvedUserId(owner ? currentUserId : targetUserId)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!resolvedUserId) return
    loadUserData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, resolvedUserId])

  const loadUserData = async () => {
    if (!resolvedUserId) {
      setPageLoading(false)
      return
    }
    setPageLoading(true)
    try {
      const followStatsPromise = getFollowStats(resolvedUserId).catch(() => ({ followers_count: 0, following_count: 0, is_following: false }))
      if (isOwner) {
        const [profile, recordDaysRes, foodColls, recipeColls, followStats] = await Promise.all([
          getUserProfile().catch(() => null),
          getUserRecordDays().catch(() => ({ record_days: 0 })),
          getPublicFoodLibraryCollections().catch(() => ({ list: [] })),
          getUserRecipes({ is_favorite: true }).catch(() => ({ recipes: [] })),
          followStatsPromise,
        ])
        const avatar = profile?.avatar || ''
        const nickname = profile?.nickname || '用户昵称'
        const uid = String(profile?.id || currentUserId).trim()
        const cover = profile?.cover_image || ''
        const userMotto = profile?.motto || ''
        setTempAvatar(avatar)
        setTempNickname(nickname)
        setEditAvatar(avatar)
        setEditNickname(nickname)
        setEditCoverImage(cover)
        setEditMotto(userMotto)
        setUserId(uid)
        setRecordDays(recordDaysRes.record_days || 0)
        setCoverImage(cover)
        setMotto(userMotto)
        setFoodCollections(foodColls.list || [])
        setRecipeCollections(recipeColls.recipes || [])
        setFavoriteCount(recipeColls.recipes?.length || 0)
        applyFollowStats(followStats)
        // 加载动态（等用户基础数据落库后再请求，避免状态竞争）
        await loadFeed(true)
      } else {
        const [publicProfile, foodColls, recipeColls, followStats] = await Promise.all([
          getPublicUserProfile(resolvedUserId).catch(() => null),
          getUserCollections(resolvedUserId).catch(() => ({ list: [] })),
          getUserFavoriteRecipes(resolvedUserId).catch(() => ({ recipes: [] })),
          followStatsPromise,
        ])
        const avatar = publicProfile?.avatar || ''
        const nickname = publicProfile?.nickname || '用户'
        const cover = publicProfile?.cover_image || ''
        const userMotto = publicProfile?.motto || ''
        setTempAvatar(avatar)
        setTempNickname(nickname)
        setEditAvatar(avatar)
        setEditNickname(nickname)
        setEditCoverImage(cover)
        setUserId(publicProfile?.id || resolvedUserId)
        setRecordDays(publicProfile?.record_days || 0)
        setCoverImage(cover)
        setMotto(userMotto)
        setFoodCollections(foodColls.list || [])
        setRecipeCollections(recipeColls.recipes || [])
        setFavoriteCount(recipeColls.recipes?.length || 0)
        applyFollowStats(followStats)
        // 加载动态（等用户基础数据落库后再请求，避免状态竞争）
        await loadFeed(true)
      }
    } catch (error) {
      console.error('[profile-settings] 加载用户数据失败:', error)
    } finally {
      setPageLoading(false)
    }
  }

  const applyFollowStats = (stats: FollowStats) => {
    setFollowersCount(stats?.followers_count || 0)
    setFollowingCount(stats?.following_count || 0)
    setIsFollowing(stats?.is_following || false)
  }

  const handleFollowToggle = async () => {
    if (!resolvedUserId || isOwner || followLoading) return
    setFollowLoading(true)
    try {
      if (isFollowing) {
        await unfollowUser(resolvedUserId)
        setIsFollowing(false)
        setFollowersCount(prev => Math.max(0, prev - 1))
      } else {
        await followUser(resolvedUserId)
        setIsFollowing(true)
        setFollowersCount(prev => prev + 1)
      }
    } catch (err: any) {
      Taro.showToast({ title: err?.message || '操作失败', icon: 'none' })
    } finally {
      setFollowLoading(false)
    }
  }

  const handleGoFollowers = () => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/follow-list/index')}?type=followers&user_id=${encodeURIComponent(resolvedUserId)}` })
  }

  const handleGoFollowing = () => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/follow-list/index')}?type=following&user_id=${encodeURIComponent(resolvedUserId)}` })
  }

  const handleGoPrivateChat = () => {
    if (!resolvedUserId) return
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/private-chat/index')}?user_id=${encodeURIComponent(resolvedUserId)}` })
  }

  // 自动关注（邀请码场景）
  useEffect(() => {
    const autoFollow = async () => {
      const inviteCode = Taro.getStorageSync('auto_follow')
      if (!inviteCode || !resolvedUserId) return
      try {
        const invite = await resolveFriendInvite(inviteCode)
        if (invite?.user_id === resolvedUserId) {
          await followUser(resolvedUserId)
          setIsFollowing(true)
          setFollowersCount(prev => prev + 1)
        }
      } catch {
        /* 静默处理 */
      } finally {
        Taro.removeStorageSync('auto_follow')
      }
    }
    autoFollow()
  }, [resolvedUserId])

  // 加载动态
  const loadFeed = async (reset = false) => {
    if (!resolvedUserId) return
    if (feedLoading) return
    const offset = reset ? 0 : feedOffset
    if (!reset && !feedHasMore) return

    setFeedLoading(true)
    try {
      const res = isOwner
        ? await communityGetFeed(undefined, offset, 15, false, 0, {
            author_id: resolvedUserId,
            sort_by: 'latest',
          })
        : await communityGetPublicFeed(offset, 15, false, 0, {
            author_id: resolvedUserId,
            sort_by: 'latest',
          })
      const list = res.list || []
      const hasMore = res.has_more ?? (list.length >= 15)
      if (reset) {
        setFeedList(list)
      } else {
        setFeedList(prev => [...prev, ...list])
      }
      setFeedOffset(offset + list.length)
      setFeedHasMore(hasMore)
    } catch (error) {
      console.error('[profile-settings] 加载动态失败:', error)
    } finally {
      setFeedLoading(false)
    }
  }

  // 下滑加载更多
  useReachBottom(() => {
    if (activeTab === 'feed' && feedHasMore && !feedLoading) {
      loadFeed(false)
    }
  })

  const handleCopyUserId = useCallback(() => {
    const value = userId.trim()
    if (!value) {
      Taro.showToast({ title: '暂无用户ID', icon: 'none' })
      return
    }
    Taro.setClipboardData({
      data: value,
      success: () => { Taro.showToast({ title: '已复制用户ID', icon: 'success' }) },
      fail: () => { Taro.showToast({ title: '复制失败', icon: 'none' }) },
    })
  }, [userId])

  // 打开编辑弹窗
  const handleOpenEdit = () => {
    if (!isOwner) return
    setEditAvatar(tempAvatar)
    setEditNickname(tempNickname)
    setEditCoverImage(coverImage)
    setEditMotto(motto)
    setShowEditSheet(true)
  }

  // 选择头像
  const handleChooseAvatar = async (e: any) => {
    const { avatarUrl } = e.detail
    const needUpload = avatarUrl && !avatarUrl.startsWith('https://')
    if (needUpload) {
      Taro.showLoading({ title: '上传中...' })
      try {
        const base64 = await imageToBase64(avatarUrl)
        const { imageUrl } = await uploadUserAvatar(base64)
        setEditAvatar(imageUrl)
        Taro.hideLoading()
      } catch (err: any) {
        Taro.hideLoading()
        await showUnifiedApiError(err, '上传失败')
      }
    } else {
      setEditAvatar(avatarUrl)
    }
  }

  // 选择背景图
  const handleChooseCoverImage = async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      })
      const tempFile = res.tempFiles?.[0]?.tempFilePath
      if (!tempFile) return
      Taro.showLoading({ title: '上传中...' })
      const base64 = await imageToBase64(tempFile)
      const { imageUrl } = await uploadCoverImage(base64)
      setEditCoverImage(imageUrl)
      Taro.hideLoading()
    } catch (err: any) {
      Taro.hideLoading()
      if (err?.errMsg?.includes('cancel')) return
      await showUnifiedApiError(err, '上传背景图失败')
    }
  }

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editAvatar || !editNickname) {
      Taro.showToast({ title: '请完善头像和昵称', icon: 'none' })
      return
    }
    setSaving(true)
    Taro.showLoading({ title: '保存中...' })
    try {
      await updateUserInfo({ nickname: editNickname, avatar: editAvatar, cover_image: editCoverImage, motto: editMotto })
      const stored = Taro.getStorageSync('userInfo')
      const newUserInfo = { avatar: editAvatar, name: editNickname, meta: stored?.meta || '', id: userId || currentUserId }
      Taro.setStorageSync('userInfo', newUserInfo)
      setTempAvatar(editAvatar)
      setTempNickname(editNickname)
      setCoverImage(editCoverImage)
      setMotto(editMotto)
      Taro.hideLoading()
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setShowEditSheet(false)
    } catch (err: any) {
      Taro.hideLoading()
      await showUnifiedApiError(err, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 注销账号
  const handleDeleteAccount = async () => {
    const modalRes = await Taro.showModal({
      title: '注销账号',
      content: '注销后，您的账号及健康记录、饮食分析历史、好友关系等数据会被删除，本地登录状态也会清空。确定要注销账号吗？',
      confirmText: '确认注销',
      confirmColor: '#ef4444',
      cancelText: '再想想'
    })
    if (!modalRes.confirm) return
    try {
      Taro.showLoading({ title: '注销中...' })
      await deleteAccount()
      clearAllStorage()
      Taro.hideLoading()
      Taro.showToast({ title: '已注销账号', icon: 'success' })
      setTimeout(() => { Taro.switchTab({ url: '/pages/index/index' }) }, 1200)
    } catch (error) {
      Taro.hideLoading()
      await showUnifiedApiError(error, '注销失败')
    }
  }

  // 分享海报
  const handleShareProfile = async () => {
    if (posterGenerating) return
    setPosterGenerating(true)
    Taro.showLoading({ title: '生成中...' })
    try {
      const qrSize = 200
      // 获取二维码 Canvas 节点并绘制普通二维码
      const qrCanvasNode = await new Promise<HTMLCanvasElement>((resolve, reject) => {
        const query = Taro.createSelectorQuery()
        query.select('#qr-gen-canvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            if (res?.[0]?.node) resolve(res[0].node)
            else reject(new Error('二维码 canvas 节点获取失败'))
          })
      })
      qrCanvasNode.width = qrSize
      qrCanvasNode.height = qrSize
      drawQrcode({
        canvas: qrCanvasNode,
        canvasId: 'qr-gen-canvas',
        width: qrSize,
        text: `pf=${userId}`,
        background: '#ffffff',
        foreground: '#000000',
      })
      const qrFileRes = await Taro.canvasToTempFilePath({
        canvas: qrCanvasNode as any,
        width: qrSize,
        height: qrSize,
      })
      const qrImagePath = qrFileRes.tempFilePath

      // 获取海报 Canvas 2D 节点
      const canvasNode = await new Promise<HTMLCanvasElement>((resolve, reject) => {
        const query = Taro.createSelectorQuery()
        query.select('#profile-poster-canvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            if (res?.[0]?.node) resolve(res[0].node)
            else reject(new Error('canvas 节点获取失败'))
          })
      })

      const width = POSTER_WIDTH
      const height = computeProfilePosterHeight()
      canvasNode.width = width
      canvasNode.height = height
      const ctx = canvasNode.getContext('2d')
      if (!ctx) throw new Error('canvas context 失败')

      const [avatarResolved, qrResolved, logoResolved] = await Promise.all([
        tempAvatar ? resolveCanvasImageSrc(tempAvatar) : Promise.resolve(''),
        resolveCanvasImageSrc(qrImagePath),
        resolveCanvasImageSrc(LOGIN_LOGO_URL),
      ])

      const [avatarImg, qrImg, logoImg] = await Promise.all([
        avatarResolved ? loadCanvasImage(canvasNode, avatarResolved) : Promise.resolve(null),
        qrResolved ? loadCanvasImage(canvasNode, qrResolved) : Promise.resolve(null),
        logoResolved ? loadCanvasImage(canvasNode, logoResolved) : Promise.resolve(null),
      ])

      drawProfilePoster(ctx, {
        width,
        height,
        data: {
          nickname: tempNickname || '用户',
          shortId: formatShortId(userId),
          recordDays,
          followersCount,
          followingCount,
          favoriteCount,
          motto,
        },
        avatarImage: avatarImg,
        qrCodeImage: qrImg,
        logoImage: logoImg,
      })

      const fileRes = await Taro.canvasToTempFilePath({
        canvas: canvasNode as any,
        width,
        height,
      })

      Taro.hideLoading()
      Taro.showShareImageMenu({
        path: fileRes.tempFilePath,
        fail: (err: any) => {
          if (isShowShareImageMenuCancel(err)) return
          Taro.showToast({ title: '分享失败', icon: 'none' })
        },
      })
    } catch (error: any) {
      Taro.hideLoading()
      console.error('[profile-settings] 海报生成失败:', error)
      Taro.showToast({ title: error?.message || '海报生成失败', icon: 'none' })
    } finally {
      setPosterGenerating(false)
    }
  }

  const handleGoDetail = (item: PublicFoodLibraryItem) => {
    Taro.navigateTo({ url: `/pages/food-library-detail/index?id=${encodeURIComponent(item.id)}` })
  }

  const handleGoRecipeDetail = (recipe: UserRecipe) => {
    Taro.navigateTo({ url: `/pages/recipe-edit/index?id=${encodeURIComponent(recipe.id)}` })
  }

  const handleGoFeedDetail = (item: CommunityFeedItem) => {
    const record = item.record
    if (!record?.id) return
    if (record.feed_type === 'campus_food') {
      const targetId = item.target_id || record.id
      Taro.navigateTo({ url: `/pages/food-library-detail/index?id=${encodeURIComponent(targetId)}` })
      return
    }
    if (record.feed_type === 'exercise_log') {
      const dateText = String(record.record_time || record.created_at || '').slice(0, 10)
      Taro.navigateTo({ url: `/pages/exercise-record/index${dateText ? `?date=${encodeURIComponent(dateText)}` : ''}` })
      return
    }
    Taro.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(record.id)}` })
  }

  // 渲染动态卡片
  const renderFeedItem = (item: CommunityFeedItem) => {
    const record = item.record
    const isExercise = record.feed_type === 'exercise_log'
    const isCampus = record.feed_type === 'campus_food'
    const isCirclePost = record.feed_type === 'circle_post'
    const targetType = (record.feed_type || 'food_record') as CommunityFeedTargetType
    const targetId = record.id
    const showReportMask = isCirclePost && reportMaskTarget?.targetType === targetType && reportMaskTarget?.targetId === targetId
    const feedTime = String(record.record_time || record.created_at || '')

    return (
      <View
        key={`${record.feed_type || 'food'}-${record.id}`}
        className='profile-feed-card'
        style={isCirclePost ? { position: 'relative' } : undefined}
        onLongPress={() => {
          if (isCirclePost && !isOwner) {
            setReportMaskTarget({ targetType, targetId })
          }
        }}
      >
        {/* 时间标签 */}
        <View className='profile-feed-header'>
          <Text className='profile-feed-time'>
            {isExercise ? '运动打卡' : isCampus ? '校园食堂' : isCirclePost ? '自定义动态' : MEAL_NAMES[record.meal_type] || record.meal_type}
            {' · '}
            {formatFeedTime(feedTime)}
          </Text>
        </View>

        {/* 描述 */}
        {isCirclePost ? (
          <>
            {record.title ? <Text className='profile-feed-title'>{record.title}</Text> : null}
            {record.body ? <Text className='profile-feed-desc'>{record.body}</Text> : null}
          </>
        ) : (
          <>
            {record.description && (
              <Text className='profile-feed-desc'>{record.description}</Text>
            )}
            {isExercise && record.exercise_desc && (
              <Text className='profile-feed-desc'>{record.exercise_desc}</Text>
            )}
          </>
        )}

        {/* 图片 */}
        {isCirclePost && (record.image_paths || []).length > 0 ? (
          <View className='profile-feed-image-grid'>
            {(record.image_paths || []).map((url, idx) => (
              <View key={`circle-img-${idx}`} className='profile-feed-image-grid-item' onClick={() => Taro.previewImage({ current: url, urls: record.image_paths || [] })}>
                <Image className='profile-feed-image' src={url} mode='aspectFill' />
              </View>
            ))}
          </View>
        ) : record.image_path ? (
          <View className='profile-feed-image-wrap' onClick={() => handleGoFeedDetail(item)}>
            <Image className='profile-feed-image' src={record.image_path} mode='aspectFill' />
          </View>
        ) : null}

        {/* 营养/数据 */}
        <View className='profile-feed-footer'>
          <View className='profile-feed-nutrition-row'>
            {isExercise && record.calories_burned ? (
              <View className='profile-feed-nutri-item'>
                <Text className='iconfont icon-kcal profile-feed-nutri-icon' style={{ color: '#00bc7d' }} />
                <Text className='profile-feed-nutri-text'>消耗 {record.calories_burned.toFixed(0)}</Text>
              </View>
            ) : record.total_calories > 0 ? (
              <View className='profile-feed-nutri-item'>
                <Text className='iconfont icon-kcal profile-feed-nutri-icon' style={{ color: '#00bc7d' }} />
                <Text className='profile-feed-nutri-text'>{record.total_calories.toFixed(0)}</Text>
              </View>
            ) : null}
            {(record.total_protein ?? 0) > 0 && (
              <View className='profile-feed-nutri-item'>
                <Text className='iconfont icon-danbaizhi profile-feed-nutri-icon' style={{ color: '#5c9ed4' }} />
                <Text className='profile-feed-nutri-text'>{record.total_protein.toFixed(0)}g</Text>
              </View>
            )}
            {(record.total_carbs ?? 0) > 0 && (
              <View className='profile-feed-nutri-item'>
                <Text className='iconfont icon-tanshui-dabiao profile-feed-nutri-icon' style={{ color: '#dcac52' }} />
                <Text className='profile-feed-nutri-text'>{record.total_carbs.toFixed(0)}g</Text>
              </View>
            )}
            {(record.total_fat ?? 0) > 0 && (
              <View className='profile-feed-nutri-item'>
                <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin profile-feed-nutri-icon' style={{ color: '#f0985c' }} />
                <Text className='profile-feed-nutri-text'>{record.total_fat.toFixed(0)}g</Text>
              </View>
            )}
            {(record.fiber ?? 0) > 0 && (
              <View className='profile-feed-nutri-item'>
                <Text className='profile-feed-nutri-icon' style={{ color: '#22c55e' }}>纤</Text>
                <Text className='profile-feed-nutri-text'>{(record.fiber ?? 0).toFixed(0)}g</Text>
              </View>
            )}
            {(record.sugar ?? 0) > 0 && (
              <View className='profile-feed-nutri-item'>
                <Text className='profile-feed-nutri-icon' style={{ color: '#ef4444' }}>糖</Text>
                <Text className='profile-feed-nutri-text'>{(record.sugar ?? 0).toFixed(0)}g</Text>
              </View>
            )}
            {(record.sodium_mg ?? 0) > 0 && (
              <View className='profile-feed-nutri-item'>
                <Text className='profile-feed-nutri-icon' style={{ color: '#3b82f6' }}>钠</Text>
                <Text className='profile-feed-nutri-text'>{(record.sodium_mg ?? 0).toFixed(0)}mg</Text>
              </View>
            )}
            {(record.total_weight_grams ?? 0) > 0 && (
              <View className='profile-feed-nutri-item'>
                <Text className='profile-feed-nutri-icon' style={{ color: '#6b7280' }}>重</Text>
                <Text className='profile-feed-nutri-text'>{(record.total_weight_grams ?? 0).toFixed(0)}g</Text>
              </View>
            )}
            {isCampus && record.price != null && (
              <View className='profile-feed-nutri-item'>
                <Text className='profile-feed-nutri-text' style={{ color: '#f59e0b', fontWeight: 600 }}>¥{Number(record.price).toFixed(1)}</Text>
              </View>
            )}
          </View>
          <View className='profile-feed-likes'>
            <Text className='profile-feed-likes-text'>❤ {item.like_count || 0}</Text>
          </View>
          {!isOwner && (
            <View
              className='profile-feed-more'
              onClick={(e) => {
                e.stopPropagation()
                setFeedActionSheetTarget({ targetType, targetId })
              }}
            >
              <View className='profile-feed-more-box'>
                <Text className='profile-feed-more-icon'>⋮</Text>
              </View>
            </View>
          )}
        </View>
        {showReportMask ? (
          <FeedReportMask
            visible
            onReport={() => {
              setReportTarget({ targetType, targetId })
              setReportMaskTarget(null)
            }}
            onCancel={() => setReportMaskTarget(null)}
          />
        ) : null}
      </View>
    )
  }

  if (pageLoading) {
    return (
      <FlPageThemeRoot>
        <View className={`profile-settings-page ${scheme === 'dark' ? 'profile-settings-page--dark' : ''}`}>
          <View className='profile-loading'>
            <View className='profile-skeleton-avatar' />
            <View className='profile-skeleton-name' />
            <View className='profile-skeleton-id' />
            <View className='profile-skeleton-stats' />
          </View>
        </View>
      </FlPageThemeRoot>
    )
  }

  return (
    <FlPageThemeRoot>
      <View className={`profile-settings-page ${scheme === 'dark' ? 'profile-settings-page--dark' : ''}`}>
        {/* 顶部用户信息区域 */}
        <View className='profile-top-section'>
          {/* 背景图 — 绝对定位覆盖整个顶部区域 */}
          <View className='profile-cover-bg'>
            {coverImage && (
              <>
                <Image className='profile-cover-bg-image' src={coverImage} mode='aspectFill' />
                <View className='profile-cover-bg-mask' />
              </>
            )}
          </View>

          {/* 右上角按钮组 */}
          {isOwner && (
            <View className='profile-top-actions'>
              <View
                className='profile-top-action-btn'
                onClick={handleOpenEdit}
              >
                <Text className='iconfont icon-edit profile-top-action-icon' />
                <Text className='profile-top-action-text'>编辑资料</Text>
              </View>
              <View
                className='profile-top-icon-btn'
                onClick={handleShareProfile}
              >
                <Text className='iconfont icon-share profile-top-icon' />
              </View>
            </View>
          )}

          {/* 头像 + 昵称 + ID */}
          <View className='profile-user-row'>
            <View
              className='profile-avatar-wrap'
              onClick={isOwner ? handleOpenEdit : undefined}
            >
              <View className='avatar-choose-wrapper'>
                {tempAvatar ? (
                  <Image src={tempAvatar} className='avatar-preview' mode='aspectFill' />
                ) : (
                  <View className='avatar-placeholder'>
                    <Text className='avatar-placeholder-text'>👤</Text>
                  </View>
                )}
              </View>
            </View>

            <View className='profile-info-col'>
              <View className='profile-name-row' onClick={isOwner ? handleOpenEdit : undefined}>
                <Text className='profile-nickname'>{tempNickname || '用户昵称'}</Text>
              </View>
              <View className='profile-id-row' onClick={isOwner ? handleOpenEdit : undefined}>
                <Text className='profile-user-id'>ID: {formatShortId(userId)}</Text>
                <View className='profile-id-copy-btn' onClick={(e) => { e.stopPropagation(); handleCopyUserId() }}>
                  <Text className='profile-id-copy-btn-text'>复制ID</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 统计行 — 数字和标签同一行，竖线分割 */}
          <View className='profile-stats-row'>
            <View className='profile-stat-item'>
              <Text className='profile-stat-num'>{recordDays}</Text>
              <Text className='profile-stat-text'>记录天数</Text>
            </View>
            <Text className='profile-stat-divider'>|</Text>
            <View className='profile-stat-item' onClick={handleGoFollowers}>
              <Text className='profile-stat-num'>{followersCount}</Text>
              <Text className='profile-stat-text'>被关注</Text>
            </View>
            <Text className='profile-stat-divider'>|</Text>
            <View className='profile-stat-item' onClick={handleGoFollowing}>
              <Text className='profile-stat-num'>{followingCount}</Text>
              <Text className='profile-stat-text'>关注</Text>
            </View>
          </View>

          {/* 座右铭 */}
          {motto ? (
            <View className='profile-motto-row' onClick={isOwner ? handleOpenEdit : undefined}>
              <Text className='profile-motto-text'>{motto}</Text>
            </View>
          ) : isOwner ? (
            <View className='profile-motto-row profile-motto-row--empty' onClick={handleOpenEdit}>
              <Text className='profile-motto-text profile-motto-text--empty'>点击编辑资料添加座右铭</Text>
            </View>
          ) : null}

          {/* 关注 + 私信操作行（仅他人主页） */}
          {!isOwner && (
            <View className='profile-action-row'>
              <View
                className={`profile-follow-btn ${isFollowing ? 'profile-follow-btn--active' : ''}`}
                onClick={handleFollowToggle}
              >
                <Text className='profile-follow-btn-text'>
                  {followLoading ? '...' : isFollowing ? '已关注' : '+ 关注'}
                </Text>
              </View>
              <View className='profile-dm-btn' onClick={handleGoPrivateChat}>
                <Text className='profile-dm-btn-text'>私信</Text>
              </View>
            </View>
          )}
        </View>

        {/* 底部内容抽屉 */}
        <View className='profile-bottom-drawer'>
          <View className='drawer-handle-bar' />

          {/* Tab */}
          <View className='profile-content-tabs'>
            <View
              className={`profile-content-tab ${activeTab === 'feed' ? 'profile-content-tab--active' : ''}`}
              onClick={() => setActiveTab('feed')}
            >
              <Text className='profile-content-tab-text'>最新动态</Text>
              {activeTab === 'feed' && <View className='profile-content-tab-indicator' />}
            </View>
            <View
              className={`profile-content-tab ${activeTab === 'collections' ? 'profile-content-tab--active' : ''}`}
              onClick={() => setActiveTab('collections')}
            >
              <Text className='profile-content-tab-text'>食物收藏</Text>
              {activeTab === 'collections' && <View className='profile-content-tab-indicator' />}
            </View>
          </View>

          {/* 最新动态 */}
          {activeTab === 'feed' && (
            <View className='profile-content-body'>
              {feedList.length === 0 && !feedLoading ? (
                <View className='profile-content-empty'>
                  <Text className='profile-content-empty-text'>暂无动态</Text>
                </View>
              ) : (
                <>
                  {feedList.map(renderFeedItem)}
                  {feedLoading && (
                    <View className='profile-feed-loading'>
                      <View className='profile-feed-spinner' />
                    </View>
                  )}
                  {!feedHasMore && feedList.length > 0 && (
                    <View className='profile-feed-end'>
                      <Text className='profile-feed-end-text'>没有更多了</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {/* 食物收藏（原食谱收藏） */}
          {activeTab === 'collections' && (
            <View className='profile-content-body'>
              {recipeCollections.length === 0 ? (
                <View className='profile-content-empty'>
                  <Text className='profile-content-empty-text'>暂无食物收藏</Text>
                </View>
              ) : (
                recipeCollections.map((item) => (
                  <View key={item.id} className='collection-food-card' onClick={() => handleGoRecipeDetail(item)}>
                    <View className='collection-food-main'>
                      <Text className='collection-food-name'>{item.recipe_name || '未命名食谱'}</Text>
                      <View className='collection-food-nutrition-row'>
                        {item.total_calories > 0 && (
                          <View className='collection-food-nutri-item'>
                            <Text className='iconfont icon-kcal collection-food-nutri-icon' style={{ color: '#00bc7d' }} />
                            <Text className='collection-food-nutri-text'>{item.total_calories.toFixed(0)}</Text>
                          </View>
                        )}
                        {item.total_protein > 0 && (
                          <View className='collection-food-nutri-item'>
                            <Text className='iconfont icon-danbaizhi collection-food-nutri-icon' style={{ color: '#5c9ed4' }} />
                            <Text className='collection-food-nutri-text'>{item.total_protein.toFixed(0)}g</Text>
                          </View>
                        )}
                        {(item.total_carbs ?? 0) > 0 && (
                          <View className='collection-food-nutri-item'>
                            <Text className='iconfont icon-tanshui-dabiao collection-food-nutri-icon' style={{ color: '#dcac52' }} />
                            <Text className='collection-food-nutri-text'>{item.total_carbs.toFixed(0)}g</Text>
                          </View>
                        )}
                        {(item.total_fat ?? 0) > 0 && (
                          <View className='collection-food-nutri-item'>
                            <Text className='iconfont icon-zhifangyouheruhuazhifangzhipin collection-food-nutri-icon' style={{ color: '#f0985c' }} />
                            <Text className='collection-food-nutri-text'>{item.total_fat.toFixed(0)}g</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    {item.image_path && (
                      <Image className='collection-food-thumb' src={item.image_path} mode='aspectFill' />
                    )}
                  </View>
                ))
              )}
            </View>
          )}
        </View>

        {/* 编辑资料底部弹窗（仅自己） */}
        {showEditSheet && isOwner && (
          <View className='edit-sheet-mask' onClick={() => setShowEditSheet(false)}>
            <View className='edit-sheet' onClick={(e) => e.stopPropagation()}>
              <View className='edit-sheet-handle' />

              <View className='edit-sheet-header'>
                <Text className='edit-sheet-title'>编辑资料</Text>
                <View className='edit-sheet-close' onClick={() => setShowEditSheet(false)}>
                  <Text className='iconfont icon-close' />
                </View>
              </View>

              {/* 头像 */}
              <View className='edit-sheet-avatar-section'>
                <Button
                  className='avatar-choose-btn'
                  openType='chooseAvatar'
                  onChooseAvatar={handleChooseAvatar}
                >
                  <View className='avatar-choose-wrapper'>
                    {editAvatar ? (
                      <Image src={editAvatar} className='avatar-preview' mode='aspectFill' />
                    ) : (
                      <View className='avatar-placeholder'>
                        <Text className='avatar-placeholder-text'>点击选择</Text>
                      </View>
                    )}
                  </View>
                </Button>
              </View>

              {/* 背景图 */}
              <View className='edit-sheet-row'>
                <Text className='edit-sheet-label'>主页背景图</Text>
                <View
                  className='edit-sheet-cover-section'
                  onClick={handleChooseCoverImage}
                >
                  {editCoverImage ? (
                    <Image className='edit-sheet-cover-image' src={editCoverImage} mode='aspectFill' />
                  ) : (
                    <View className='edit-sheet-cover-placeholder'>
                      <Text className='iconfont icon-picture edit-sheet-cover-placeholder-icon' />
                      <Text className='edit-sheet-cover-placeholder-text'>点击选择背景图</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* 昵称 */}
              <View className='edit-sheet-row'>
                <Text className='edit-sheet-label'>昵称</Text>
                <Input
                  className='edit-sheet-input'
                  type='nickname'
                  placeholder='请输入昵称'
                  value={editNickname}
                  onBlur={(e) => setEditNickname(e.detail.value)}
                  onInput={(e) => setEditNickname(e.detail.value)}
                />
              </View>

              {/* 座右铭 */}
              <View className='edit-sheet-row'>
                <Text className='edit-sheet-label'>座右铭</Text>
                <Input
                  className='edit-sheet-input'
                  type='text'
                  placeholder='写一句你的座右铭（最多30字）'
                  maxlength={30}
                  value={editMotto}
                  onBlur={(e) => setEditMotto(e.detail.value)}
                  onInput={(e) => setEditMotto(e.detail.value)}
                />
              </View>

              {/* 用户ID */}
              {userId && (
                <View className='edit-sheet-row'>
                  <Text className='edit-sheet-label'>用户ID</Text>
                  <View className='edit-sheet-id-row'>
                    <Text className='edit-sheet-id-text'>{userId}</Text>
                    <View className='edit-sheet-id-copy' onClick={handleCopyUserId}>
                      <Text className='edit-sheet-id-copy-text'>复制</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* 保存按钮 */}
              <Button className='edit-sheet-save' onClick={handleSaveEdit} disabled={saving}>
                保存
              </Button>

              {/* 注销账号 */}
              <View className='edit-sheet-delete' onClick={handleDeleteAccount}>
                <Text className='edit-sheet-delete-text'>注销账号</Text>
              </View>
            </View>
          </View>
        )}

        {/* 离屏 Canvas（用于生成海报） */}
        <Canvas
          type='2d'
          id='profile-poster-canvas'
          className='poster-offscreen-canvas'
          style={{ width: `${POSTER_WIDTH}px`, height: `${computeProfilePosterHeight()}px` }}
        />

        {/* 二维码生成 Canvas */}
        <Canvas
          type='2d'
          id='qr-gen-canvas'
          className='poster-offscreen-canvas'
          style={{ width: '200px', height: '200px' }}
        />
      </View>
      <FeedActionSheet
        visible={!!feedActionSheetTarget}
        actions={[{ id: 'report', label: '举报', iconClass: 'icon-jinggao', danger: true }]}
        onClose={() => setFeedActionSheetTarget(null)}
        onSelect={(id) => {
          if (id === 'report' && feedActionSheetTarget) {
            setReportTarget(feedActionSheetTarget)
          }
        }}
      />
      <FeedReportSheet
        visible={!!reportTarget}
        targetType={reportTarget?.targetType || 'circle_post'}
        targetId={reportTarget?.targetId || ''}
        onClose={() => setReportTarget(null)}
      />
    </FlPageThemeRoot>
  )
}
