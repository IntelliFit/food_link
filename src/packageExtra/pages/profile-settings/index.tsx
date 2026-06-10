import { View, Text, Image, Button, Input } from '@tarojs/components'
import { useState, useEffect, useCallback } from 'react'
import Taro, { useRouter, useReachBottom } from '@tarojs/taro'
import {
  updateUserInfo,
  uploadUserAvatar,
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
  type PublicFoodLibraryItem,
  type UserRecipe,
  type CommunityFeedItem,
} from '../../../utils/api'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
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
  const targetUserId = String(router.params.user_id || '').trim()
  const isOwner = !targetUserId || targetUserId === currentUserId
  const resolvedUserId = isOwner ? currentUserId : targetUserId

  // 用户信息
  const [tempAvatar, setTempAvatar] = useState('')
  const [tempNickname, setTempNickname] = useState('')
  const [userId, setUserId] = useState('')
  const [recordDays, setRecordDays] = useState(0)
  const [favoriteCount, setFavoriteCount] = useState(0)
  const [pageLoading, setPageLoading] = useState(true)

  // 编辑弹窗
  const [showEditSheet, setShowEditSheet] = useState(false)
  const [editNickname, setEditNickname] = useState('')
  const [editAvatar, setEditAvatar] = useState('')
  const [saving, setSaving] = useState(false)

  // Tab
  const [activeTab, setActiveTab] = useState<TabKey>('feed')

  // 动态
  const [feedList, setFeedList] = useState<CommunityFeedItem[]>([])
  const [feedOffset, setFeedOffset] = useState(0)
  const [feedHasMore, setFeedHasMore] = useState(true)
  const [feedLoading, setFeedLoading] = useState(false)

  // 收藏
  const [foodCollections, setFoodCollections] = useState<PublicFoodLibraryItem[]>([])
  const [recipeCollections, setRecipeCollections] = useState<UserRecipe[]>([])

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f8fafc', darkBackground: '#101716' })
  }, [scheme])

  useEffect(() => {
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
      if (isOwner) {
        const [profile, recordDaysRes, foodColls, recipeColls] = await Promise.all([
          getUserProfile().catch(() => null),
          getUserRecordDays().catch(() => ({ record_days: 0 })),
          getPublicFoodLibraryCollections().catch(() => ({ list: [] })),
          getUserRecipes({ is_favorite: true }).catch(() => ({ recipes: [] })),
        ])
        const avatar = profile?.avatar || ''
        const nickname = profile?.nickname || '用户昵称'
        const uid = String(profile?.id || currentUserId).trim()
        setTempAvatar(avatar)
        setTempNickname(nickname)
        setEditAvatar(avatar)
        setEditNickname(nickname)
        setUserId(uid)
        setRecordDays(recordDaysRes.record_days || 0)
        setFoodCollections(foodColls.list || [])
        setRecipeCollections(recipeColls.recipes || [])
        setFavoriteCount(recipeColls.recipes?.length || 0)
        // 加载动态
        loadFeed(true)
      } else {
        const [publicProfile, foodColls, recipeColls] = await Promise.all([
          getPublicUserProfile(resolvedUserId).catch(() => null),
          getUserCollections(resolvedUserId).catch(() => ({ list: [] })),
          getUserFavoriteRecipes(resolvedUserId).catch(() => ({ recipes: [] })),
        ])
        const avatar = publicProfile?.avatar || ''
        const nickname = publicProfile?.nickname || '用户'
        setTempAvatar(avatar)
        setTempNickname(nickname)
        setEditAvatar(avatar)
        setEditNickname(nickname)
        setUserId(publicProfile?.id || resolvedUserId)
        setRecordDays(publicProfile?.record_days || 0)
        setFoodCollections(foodColls.list || [])
        setRecipeCollections(recipeColls.recipes || [])
        setFavoriteCount(recipeColls.recipes?.length || 0)
        // 加载动态
        loadFeed(true)
      }
    } catch (error) {
      console.error('[profile-settings] 加载用户数据失败:', error)
    } finally {
      setPageLoading(false)
    }
  }

  // 加载动态
  const loadFeed = async (reset = false) => {
    if (!resolvedUserId) return
    if (feedLoading) return
    const offset = reset ? 0 : feedOffset
    if (!reset && !feedHasMore) return

    setFeedLoading(true)
    try {
      const res = await communityGetFeed(undefined, offset, 15, false, 0, {
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

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editAvatar || !editNickname) {
      Taro.showToast({ title: '请完善头像和昵称', icon: 'none' })
      return
    }
    setSaving(true)
    Taro.showLoading({ title: '保存中...' })
    try {
      await updateUserInfo({ nickname: editNickname, avatar: editAvatar })
      const stored = Taro.getStorageSync('userInfo')
      const newUserInfo = { avatar: editAvatar, name: editNickname, meta: stored?.meta || '', id: userId || currentUserId }
      Taro.setStorageSync('userInfo', newUserInfo)
      setTempAvatar(editAvatar)
      setTempNickname(editNickname)
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
    const feedTime = String(record.record_time || record.created_at || '')

    return (
      <View key={`${record.feed_type || 'food'}-${record.id}`} className='profile-feed-card'>
        {/* 时间标签 */}
        <View className='profile-feed-header'>
          <Text className='profile-feed-time'>
            {isExercise ? '运动打卡' : isCampus ? '校园食堂' : MEAL_NAMES[record.meal_type] || record.meal_type}
            {' · '}
            {formatFeedTime(feedTime)}
          </Text>
        </View>

        {/* 描述 */}
        {record.description && (
          <Text className='profile-feed-desc'>{record.description}</Text>
        )}
        {isExercise && record.exercise_desc && (
          <Text className='profile-feed-desc'>{record.exercise_desc}</Text>
        )}

        {/* 图片 */}
        {record.image_path && (
          <View className='profile-feed-image-wrap' onClick={() => handleGoFeedDetail(item)}>
            <Image className='profile-feed-image' src={record.image_path} mode='aspectFill' />
          </View>
        )}

        {/* 营养/数据 */}
        <View className='profile-feed-footer'>
          <View className='profile-feed-nutrition-row'>
            {isExercise && record.calories_burned ? (
              <View className='profile-feed-nutri-item'>
                <Text className='iconfont icon-kcal profile-feed-nutri-icon' style={{ color: '#ef4444' }} />
                <Text className='profile-feed-nutri-text'>消耗 {record.calories_burned.toFixed(0)}</Text>
              </View>
            ) : record.total_calories > 0 ? (
              <View className='profile-feed-nutri-item'>
                <Text className='iconfont icon-kcal profile-feed-nutri-icon' style={{ color: '#ef4444' }} />
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
            {isCampus && record.price != null && (
              <View className='profile-feed-nutri-item'>
                <Text className='profile-feed-nutri-text' style={{ color: '#f59e0b', fontWeight: 600 }}>¥{Number(record.price).toFixed(1)}</Text>
              </View>
            )}
          </View>
          <View className='profile-feed-likes'>
            <Text className='profile-feed-likes-text'>❤ {item.like_count || 0}</Text>
          </View>
        </View>
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
        {/* 顶部用户信息区域 — 左对齐 */}
        <View className='profile-top-section'>
          <View className='profile-user-row'>
            {/* 头像 */}
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

            {/* 昵称 + ID */}
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
            <Text className='profile-stat-text'>
              <Text className='profile-stat-num'>{recordDays}</Text> 记录天数
            </Text>
            <Text className='profile-stat-divider'>|</Text>
            <Text className='profile-stat-text'>
              <Text className='profile-stat-num'>{favoriteCount}</Text> 收藏
            </Text>
            <Text className='profile-stat-divider'>|</Text>
            <Text className='profile-stat-text'>
              <Text className='profile-stat-num'>{recipeCollections.length}</Text> 收藏内容
            </Text>
          </View>
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
                            <Text className='iconfont icon-kcal collection-food-nutri-icon' style={{ color: '#ef4444' }} />
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
      </View>
    </FlPageThemeRoot>
  )
}
