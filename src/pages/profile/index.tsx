import { View, Text, Image, Navigator } from '@tarojs/components'
import { useState, useCallback } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  TodoListOutlined,
  CalendarOutlined,
  ShopOutlined,
  ShieldOutlined,
  InfoOutlined,
  Arrow,
  ChatOutlined
} from '@taroify/icons'
import '@taroify/icons/style'
import {
  getUserProfile,
  getAccessToken,
  clearAllStorage,
  getUserRecordDays,
  getMyMembership,
  getFoodExpiryDashboard,
  friendGetRequestsOverview,
  getAnalyzeTaskCount,
  getFriendCount,
  getFavoriteCount,
  MembershipStatus,
  FoodExpiryDashboard
} from '../../utils/api'
import {
  getCurrentMembershipTier,
  getMembershipTierShortLabel,
} from '../../utils/membership'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'
import { cleanupGeneratedUserFiles } from '../../utils/weapp-user-files'

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'

declare const __APP_VERSION__: string

interface UserInfo {
  avatar: string
  name: string
  meta: string
}

type RewardLevelMeta = {
  level: number
  title: string
  min: number
  max: number | null
}

type ProfileListIconTone = {
  color: string
  backgroundColor: string
  darkColor: string
  darkBackgroundColor: string
}

const REWARD_LEVELS: RewardLevelMeta[] = [
  { level: 1, title: '探味新芽', min: 0, max: 10 },
  { level: 2, title: '零食巡逻队', min: 10, max: 50 },
  { level: 3, title: '风味侦察员', min: 50, max: 200 },
  { level: 4, title: '菜单收藏家', min: 200, max: 1000 },
  { level: 5, title: '热量驯龙师', min: 1000, max: 3000 },
  { level: 6, title: '传说食探长', min: 3000, max: null },
]

const SERVICE_ICON_TONES: Record<number, ProfileListIconTone> = {
  0: { color: '#41a17a', backgroundColor: '#ecfcf4', darkColor: '#6ff6bc', darkBackgroundColor: 'rgba(111, 246, 188, 0.16)' },
  2: { color: '#987f42', backgroundColor: '#faf5e8', darkColor: '#fcd666', darkBackgroundColor: 'rgba(252, 214, 102, 0.16)' },
  5: { color: '#4c92b3', backgroundColor: '#ecf7fc', darkColor: '#81d6fb', darkBackgroundColor: 'rgba(129, 214, 251, 0.16)' },
  8: { color: '#6e5ab5', backgroundColor: '#f4f0fc', darkColor: '#b39ef4', darkBackgroundColor: 'rgba(179, 158, 244, 0.16)' },
}

const SETTING_ICON_TONES: Record<number, ProfileListIconTone> = {
  3: { color: '#48a185', backgroundColor: '#effcf7', darkColor: '#7df0cc', darkBackgroundColor: 'rgba(125, 240, 204, 0.16)' },
  5: { color: '#a4744a', backgroundColor: '#fcf5ea', darkColor: '#f1bc8a', darkBackgroundColor: 'rgba(241, 188, 138, 0.16)' },
}

function getProfileListIconStyle(id: number, tones: Record<number, ProfileListIconTone>, scheme: string) {
  const tone = tones[id] || {
    color: '#6b7280',
    backgroundColor: '#f1f5f9',
    darkColor: '#cbd5e1',
    darkBackgroundColor: 'rgba(203, 213, 225, 0.12)',
  }
  const isDark = scheme === 'dark'
  return {
    color: isDark ? tone.darkColor : tone.color,
    backgroundColor: isDark ? tone.darkBackgroundColor : tone.backgroundColor,
  }
}

function getRewardLevelMeta(points: number): RewardLevelMeta {
  const normalized = Math.max(Number(points || 0), 0)
  return REWARD_LEVELS.find(level => level.max == null ? normalized >= level.min : (normalized >= level.min && normalized < level.max)) || REWARD_LEVELS[0]
}

function getRewardLevelProgress(points: number, meta: RewardLevelMeta): number {
  const normalized = Math.max(Number(points || 0), 0)
  if (meta.max == null) return 100
  const span = Math.max(meta.max - meta.min, 1)
  return Math.max(0, Math.min(((normalized - meta.min) / span) * 100, 100))
}

function formatRewardLevelRange(points: number, meta: RewardLevelMeta): string {
  const normalized = Math.max(Number(points || 0), 0)
  if (meta.max == null) return `${normalized}+`
  return `${normalized}/${meta.max}`
}

function formatExpiryPreviewText(dashboard: FoodExpiryDashboard | null): string {
  if (!dashboard) return '把牛奶、水果、剩菜记进来，快到期时会在这里提醒你。'
  if (dashboard.active_count <= 0) return '还没有记录保质期食物，点击开始添加。'
  if (dashboard.expired_count > 0) return `当前有 ${dashboard.expired_count} 样已过期，建议先处理。`
  if (dashboard.today_count > 0) return `今天有 ${dashboard.today_count} 样需要优先吃掉。`
  if (dashboard.soon_count > 0) return `接下来有 ${dashboard.soon_count} 样即将到期。`
  return `当前共有 ${dashboard.active_count} 样食物在保鲜中。`
}

function ProfilePage() {
  const { scheme, toggleScheme } = useAppColorScheme()
  // 登录状态
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // （个人设置已迁移到独立页面 /pages/profile-settings/index）

  // 用户信息
  const [userInfo, setUserInfo] = useState<UserInfo>({
    avatar: '',
    name: '用户昵称',
    meta: '已记录 0 天'
  })

  // 是否已完成健康档案引导（首次问卷）
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(true)

  // 记录天数
  const [recordDays, setRecordDays] = useState(0)

  // 会员状态
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [expiryDashboard, setExpiryDashboard] = useState<FoodExpiryDashboard | null>(null)

  // 好友请求数量
  const [friendRequestCount, setFriendRequestCount] = useState(0)

  // 快捷入口统计数字
  const [analyzeCount, setAnalyzeCount] = useState(0)
  const [friendCount, setFriendCount] = useState(0)
  const [favoriteCount, setFavoriteCount] = useState(0)

  // 每次显示页面时检查登录状态并刷新数据（含会员配额）
  useDidShow(() => {
    loadUserInfo()
  })

  const loadUserInfo = async () => {
    try {
      const token = getAccessToken()
      if (token) {
        setIsLoggedIn(true)

        try {
          const [apiUserInfo, membershipData, dashboardData, friendRequestsData] = await Promise.all([
            getUserProfile(),
            getMyMembership().catch((err) => {
              console.error('[profile] 获取会员状态失败:', err)
              return null
            }),
            getFoodExpiryDashboard().catch((err) => {
              console.error('[profile] 获取保质期摘要失败:', err)
              return null
            }),
            friendGetRequestsOverview().catch((err) => {
              console.error('[profile] 获取好友请求失败:', err)
              return null
            }),
          ])

          // 计算待处理的好友请求数量
          let pendingFriendCount = 0
          if (friendRequestsData?.received) {
            pendingFriendCount = friendRequestsData.received.filter(r => r.status === 'pending').length
            setFriendRequestCount(pendingFriendCount)
            Taro.setStorageSync('profile_tab_badge_friend_count', pendingFriendCount)
          } else {
            // 保持旧值，避免网络抖动导致清零
            pendingFriendCount = Number(Taro.getStorageSync('profile_tab_badge_friend_count') || 0)
          }
          // 只在成功获取到数据时才更新（避免覆盖已有数据为 null）
          if (membershipData !== null) {
            setMembershipStatus(membershipData)
          }
          if (dashboardData !== null) {
            setExpiryDashboard(dashboardData as FoodExpiryDashboard)
          }

          // 计算底部导航栏"我的"按钮 badge 总数 = 食物保质期 + 好友请求
          try {
            const expiryTodo = dashboardData
              ? ((dashboardData as FoodExpiryDashboard).expired_count || 0)
                + ((dashboardData as FoodExpiryDashboard).today_count || 0)
                + ((dashboardData as FoodExpiryDashboard).soon_count || 0)
              : 0
            // 食物保质期：如果今天已看过，不算未读
            const today = new Date().toISOString().slice(0, 10)
            const lastSeenFoodExpiry = Taro.getStorageSync('food_expiry_last_seen_date')
            const foodExpiryBadge = lastSeenFoodExpiry === today ? 0 : expiryTodo
            Taro.setStorageSync('profile_tab_badge_count', foodExpiryBadge + pendingFriendCount)
          } catch (_) { /* ignore */ }

          // 获取记录天数
          let days = 0
          try {
            const recordDaysData = await getUserRecordDays()
            days = recordDaysData.record_days
            console.log('[Profile] getUserRecordDays 返回:', recordDaysData)
            setRecordDays(days)
          } catch (error) {
            console.error('获取记录天数失败:', error)
          }

          const nextUserInfo = {
            avatar: apiUserInfo.avatar || '',
            name: apiUserInfo.nickname || '用户昵称',
            meta: `已记录 ${days} 天`
          }
          setUserInfo(nextUserInfo)
          Taro.setStorageSync('userInfo', {
            ...nextUserInfo,
            nickname: apiUserInfo.nickname || '用户昵称',
          })
          const completed = apiUserInfo.onboarding_completed ?? true
          setOnboardingCompleted(completed)
          // 首次登录未填写健康档案时，先跳转到答题页面
          if (!completed) {
            Taro.redirectTo({ url: extraPkgUrl('/pages/health-profile/index') })
            return
          }

          // 加载快捷入口统计数字
          loadQuickStats()
        } catch (error) {
          console.error('获取用户信息失败:', error)
        }
      } else {
        setIsLoggedIn(false)
        setMembershipStatus(null)
        setUserInfo({
          avatar: '',
          name: '用户昵称',
          meta: '已记录 0 天'
        })
        setRecordDays(0)
        setAnalyzeCount(0)
        setFriendCount(0)
        setFavoriteCount(0)
      }
    } catch (error) {
      console.error('读取登录状态失败:', error)
    }
  }

  // 加载快捷入口统计数字
  const loadQuickStats = async () => {
    try {
      const [analyzeRes, friendRes, favoriteRes] = await Promise.all([
        getAnalyzeTaskCount().catch(() => null),
        getFriendCount().catch(() => null),
        getFavoriteCount().catch(() => null),
      ])

      if (analyzeRes) {
        setAnalyzeCount(analyzeRes.count)
      }
      if (friendRes) {
        setFriendCount(friendRes.count)
      }
      if (favoriteRes) {
        setFavoriteCount(favoriteRes.count)
      }
    } catch (error) {
      console.error('加载快捷入口统计失败:', error)
    }
  }

  // 我的服务
  const membershipTotalAvailable = membershipStatus?.total_credits_available ?? membershipStatus?.daily_credits_remaining ?? 0
  const membershipSystemRemaining = membershipStatus?.system_credits_remaining
    ?? Math.max((membershipStatus?.daily_credits_max ?? 0) - (membershipStatus?.daily_credits_used ?? 0), 0)
  const membershipEarnedBalance = membershipStatus?.earned_credits_balance ?? 0

  const services = [
    {
      id: 0,
      icon: <TodoListOutlined size='20' />,
      title: '健康档案',
      desc: '生理指标、日常消耗、病史与饮食偏好'
    },
    {
      id: 2,
      icon: <CalendarOutlined size='20' />,
      title: '食物保质期',
      desc: formatExpiryPreviewText(expiryDashboard),
      path: '/pages/expiry/index',
      badgeCount: (expiryDashboard?.expired_count ?? 0) + (expiryDashboard?.today_count ?? 0) + (expiryDashboard?.soon_count ?? 0)
    },
    {
      id: 5,
      icon: <ShopOutlined size='20' />,
      title: '公共食物库',
      desc: '浏览公共食物营养数据',
      path: extraPkgUrl('/pages/food-library/index')
    },
    {
      id: 8,
      icon: <ChatOutlined size='20' />,
      title: '加入用户群',
      desc: '反馈问题、提建议，一起共创食探',
      path: extraPkgUrl('/pages/user-group/index')
    }
  ]

  // 设置项
  const settings = [
    { id: 3, icon: <ShieldOutlined size='20' />, title: '隐私设置' },
    { id: 5, icon: <InfoOutlined size='20' />, title: '关于我们' }
  ]

  const handleServiceClick = (service: typeof services[0]) => {
    // 检查登录
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

    // 健康档案：未完成则去填写，已完成则去查看
    if (service.id === 0) {
      if (!onboardingCompleted) {
        Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })
      } else {
        Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile-view/index') })
      }
      return
    }
    // 食物管理
    if (service.id === 2) {
      Taro.switchTab({ url: '/pages/expiry/index' })
      return
    }
    // 识别记录
    if (service.id === 7) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/analyze-history/index') })
      return
    }
    if (service.id === 4) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/invite-friends/index') })
      return
    }
    // 公共食物库
    if (service.id === 5) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/food-library/index') })
      return
    }
    if (service.id === 8) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/user-group/index') })
      return
    }
    const path = (service as { path?: string }).path
    if (path) {
      Taro.navigateTo({ url: path })
      return
    }
    Taro.showToast({
      title: `打开${service.title}`,
      icon: 'none'
    })
  }

  const handleSettingClick = (setting: any) => {
    // 关于我们
    if (setting.id === 5) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/about/index') })
      return
    }

    if (!isLoggedIn) {
      redirectToLogin()
      return
    }
    // 隐私设置
    if (setting.id === 3) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/privacy-settings/index') })
      return
    }

    Taro.showToast({
      title: `打开${setting.title}`,
      icon: 'none'
    })
  }

  const handleSettings = () => {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }
    Taro.navigateTo({
      url: extraPkgUrl('/pages/profile-settings/index'),
      fail: (err) => {
        console.error('[profile] navigateTo profile-settings failed:', err)
        Taro.showToast({ title: '跳转失败，请重试', icon: 'none' })
      }
    })
  }

  // 快捷入口点击处理
  const handleQuickActionClick = useCallback((path: string) => {
    console.log('[profile] quick action click:', path)
    Taro.navigateTo({
      url: path,
      fail: (err) => {
        console.error('[profile] navigateTo failed:', err)
        Taro.showToast({ title: '页面跳转失败', icon: 'none' })
      }
    })
  }, [])

  // 处理去登录
  const handleGoLogin = () => {
    redirectToLogin()
  }

  // 处理清除缓存
  const handleClearCache = () => {
    Taro.showModal({
      title: '提示',
      content: '确定要清除缓存吗？这将重置首页、识别记录和朋友圈的本地数据，下次进入时会重新加载。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          // 首页相关缓存
          Taro.removeStorageSync('home_dashboard_local_cache')
          Taro.removeStorageSync('body_metrics_storage')
          Taro.removeStorageSync('food_link_dashboard_targets_v1')
          Taro.removeStorageSync('home_poster_modal_visible')
          Taro.removeStorageSync('showRecordMenuModal')

          // 识别记录 / 结果页相关缓存
          Taro.removeStorageSync('analyzeResult')
          Taro.removeStorageSync('analyzeSourceTaskId')
          Taro.removeStorageSync('analyzeImagePaths')
          Taro.removeStorageSync('analyzeImagePath')
          Taro.removeStorageSync('analyzeTextInput')
          Taro.removeStorageSync('analyzeTextAdditionalContext')
          Taro.removeStorageSync('analyzeMealType')
          Taro.removeStorageSync('analyzeDietGoal')
          Taro.removeStorageSync('analyzeActivityTiming')
          Taro.removeStorageSync('analyzeExecutionMode')
          Taro.removeStorageSync('analyzePrecisionSessionId')
          Taro.removeStorageSync('analyzeTaskType')
          Taro.removeStorageSync('analyzeCompareMode')
          Taro.removeStorageSync('analyzePendingCorrectionItems')
          Taro.removeStorageSync('analyzePendingCorrectionTaskId')
          Taro.removeStorageSync('analyzeDebugPreview')
          Taro.removeStorageSync('analyzeShareData')
          Taro.removeStorageSync('analyzeTaskIsRecorded')
          Taro.removeStorageSync('analyzeCommittedRecordId')

          // 食物保质期已读标记
          Taro.removeStorageSync('food_expiry_last_seen_date')

          // 健康指数免责声明已读标记
          Taro.removeStorageSync('health_disclaimer_dismissed')

          // 底部导航栏 badge 计数
          Taro.removeStorageSync('profile_tab_badge_count')
          Taro.removeStorageSync('profile_tab_badge_friend_count')

          // 朋友圈相关缓存
          Taro.removeStorageSync('community_feed_cache')
          Taro.removeStorageSync('community_friends_cache')
          Taro.removeStorageSync('community_requests_cache')
          Taro.removeStorageSync('community_feed_timestamp')
          Taro.removeStorageSync('community_feed_cache_session_id_v1')
          Taro.removeStorageSync('community_feed_session_id_v1')
          Taro.removeStorageSync('community_friends_timestamp')
          Taro.removeStorageSync('community_feed_filters_v2')
          Taro.removeStorageSync('community_feed_filters_v3')
          Taro.removeStorageSync('community_priority_authors_v1')
          Taro.removeStorageSync('community_notification_target_v1')
          Taro.removeStorageSync('community_comment_bar_visible')

          // 动态 key：评论草稿和临时评论（遍历所有 storage key 匹配前缀删除）
          const storageInfo = Taro.getStorageInfoSync()
          const keys = storageInfo.keys || []
          keys.forEach((key: string) => {
            if (key.startsWith('comment_draft_') || key.startsWith('temp_comments_')) {
              try { Taro.removeStorageSync(key) } catch (_) {}
            }
          })

          await cleanupGeneratedUserFiles()
          Taro.showToast({ title: '缓存已清除', icon: 'success' })
        } catch (error) {
          console.error('清除缓存失败:', error)
          Taro.showToast({ title: '清除失败', icon: 'none' })
        }
      }
    })
  }

  // 处理退出登录
  const handleLogout = () => {
    Taro.showModal({
      title: '提示',
      content: '确定要退出登录吗？退出后将清除所有本地数据。',
      success: (res) => {
        if (res.confirm) {
          try {
            clearAllStorage()
            setIsLoggedIn(false)
            setMembershipStatus(null)
            setUserInfo({
              avatar: '',
              name: '用户昵称',
              meta: '已记录 0 天'
            })
            setRecordDays(0)
            setAnalyzeCount(0)
            setFriendCount(0)
            setFavoriteCount(0)
            Taro.showToast({ title: '已退出登录', icon: 'success' })
          } catch (error) {
            console.error('退出登录失败:', error)
          }
        }
      }
    })
  }

  return (
    <View className={`profile-page ${scheme === 'dark' ? 'profile-page--dark' : ''}`}>
      {/* 顶部用户信息区域（仿知乎风格） */}
      <View className='profile-header-section'>
        <View className='user-card'>
          <View className={`user-avatar-wrapper ${!isLoggedIn ? 'no-border' : ''}`}>
            {!isLoggedIn ? (
              <Text className='iconfont icon-weidenglu user-avatar-icon' />
            ) : userInfo.avatar && userInfo.avatar.startsWith('http') ? (
              <Image src={userInfo.avatar} mode='aspectFill' className='user-avatar-image' />
            ) : (
              <Text className='iconfont icon-user user-avatar-icon' />
            )}
          </View>
          <View className='user-info-main'>
            <View className='profile-theme-chip' onClick={toggleScheme}>
              <Text className={`iconfont ${scheme === 'dark' ? 'icon-zaoshang' : 'icon-wanshang'} profile-theme-chip-icon`} />
            </View>
            {isLoggedIn ? (
              <>
                <View className='user-name-row'>
                  <Text className='user-name'>{userInfo.name}</Text>
                  <View className='user-days-pill'>
                    <Text className='user-days-pill-text'>已记录 {recordDays} 天</Text>
                  </View>
                </View>
                <View className='user-edit-row' onClick={handleSettings}>
                  <Text className='user-edit-text'>编辑资料</Text>
                  <Arrow size={12} color='#9ca3af' />
                </View>
              </>
            ) : (
              <View className='user-name-row'>
                <Text className='user-name' onClick={handleGoLogin}>点击登录</Text>
              </View>
            )}
          </View>
        </View>

        {/* 快捷入口（仿知乎头像下方统计/入口，数字 + 名称） */}
        {isLoggedIn && (
          <View className='profile-quick-actions'>
            <Navigator
              className='quick-action-item'
              url={extraPkgUrl('/pages/analyze-history/index')}
            >
              <View className='quick-action-num-wrap'>
                <Text className='quick-action-num'>{analyzeCount}</Text>
              </View>
              <Text className='quick-action-text'>识别记录</Text>
            </Navigator>
            <Navigator
              className='quick-action-item'
              url={extraPkgUrl('/pages/friends/index')}
            >
              <View className='quick-action-num-wrap'>
                <Text className='quick-action-num'>{friendCount}</Text>
                {friendRequestCount > 0 && (
                  <View className='quick-action-badge'>
                    <Text className='quick-action-badge-text'>{friendRequestCount}</Text>
                  </View>
                )}
              </View>
              <Text className='quick-action-text'>好友管理</Text>
            </Navigator>
            <Navigator
              className='quick-action-item'
              url={extraPkgUrl('/pages/recipes/index')}
            >
              <Text className='quick-action-num'>{favoriteCount}</Text>
              <Text className='quick-action-text'>我的收藏</Text>
            </Navigator>
          </View>
        )}
      </View>

      {/* 引导横幅 */}
      {isLoggedIn && !onboardingCompleted && (
        <View
          className='profile-card onboarding-card'
          onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })}
        >
          <Text className='onboarding-text'>📋 完善健康档案，获取个性化饮食建议</Text>
          <Text className='onboarding-arrow'>{'>'}</Text>
        </View>
      )}

      {/* 会员卡片（仅登录后展示） */}
      {isLoggedIn && (
        <View
          className={`profile-card member-card ${membershipStatus?.is_pro ? 'member-card--pro' : 'member-card--free'}`}
          onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })}
        >
          {(() => {
            const cMax = membershipStatus?.daily_credits_max ?? 0
            const cUsed = membershipStatus?.daily_credits_used ?? 0
            const cSystemRemain = membershipStatus?.system_credits_remaining ?? Math.max(cMax - cUsed, 0)
            const cEarned = membershipStatus?.earned_credits_balance ?? 0
            const systemProgressPct = cMax > 0 ? Math.min((cSystemRemain / cMax) * 100, 100) : 0
            const rewardLevel = getRewardLevelMeta(cEarned)
            const rewardProgressPct = getRewardLevelProgress(cEarned, rewardLevel)
            const rewardRangeText = formatRewardLevelRange(cEarned, rewardLevel)
            const systemAvailableText = cMax > 0 ? `可用 ${cSystemRemain}/${cMax}` : `可用 ${cSystemRemain}`
            const isTrial = !membershipStatus?.is_pro && !!membershipStatus?.trial_active
            const hasDoubleBenefits = !!membershipStatus?.early_user_paid_bonus_active || !!membershipStatus?.early_user_paid_bonus_eligible
            const currentTier = getCurrentMembershipTier(membershipStatus)
            const earlyUserRank = membershipStatus?.early_user_rank ?? null
            const earlyUserLimit = membershipStatus?.early_user_limit ?? 1000
            const tierText = membershipStatus?.is_pro
              ? getMembershipTierShortLabel(currentTier)
              : isTrial
                ? '试用中'
                : '未开通'
            const founderBenefitText = earlyUserRank
              ? `会员权益×2（前${earlyUserLimit}名用户优惠政策） ${earlyUserRank}/${earlyUserLimit}`
              : `会员权益×2（前${earlyUserLimit}名用户优惠政策）`

            return (
              <>
                <View className='card-header'>
                  <Text className='card-title'>食探会员</Text>
                  <Text className='card-badge'>{tierText}</Text>
                </View>
                <View className='card-body'>
                  <View className='member-meter'>
                    <View className='member-meter__head'>
                      <Text className='member-meter__label'>系统可用（次日清0）</Text>
                      <Text className='member-meter__value'>{systemAvailableText}</Text>
                    </View>
                    <View className='progress-bar'>
                      <View className='progress-inner' style={{ width: `${systemProgressPct}%` }} />
                    </View>
                  </View>

                  <View className='member-meter'>
                    <View className='member-meter__head'>
                      <Text className='member-meter__label'>奖励可用（一直持有）</Text>
                      <Text className='member-meter__value'>{`${rewardRangeText} · Lv${rewardLevel.level} ${rewardLevel.title}`}</Text>
                    </View>
                    <View className='progress-bar progress-bar--reward'>
                      <View className='progress-inner progress-inner--reward' style={{ width: `${rewardProgressPct}%` }} />
                    </View>
                  </View>

                  {hasDoubleBenefits && (
                    <Text className='card-benefit card-benefit--single-line'>{founderBenefitText}</Text>
                  )}
                </View>
              </>
            )
          })()}
          <View className='card-bg-icon'>
            <ShieldOutlined size='120' color='rgba(255,255,255,0.1)' />
          </View>
        </View>
      )}

      {/* 功能列表（合并为单个白色卡片） */}
      <View className='profile-card list-card combined-list'>
        {/* 核心功能 */}
        {services.map((service) => (
          <View key={service.id} className='list-item' onClick={() => handleServiceClick(service)}>
            <View className='list-icon' style={getProfileListIconStyle(service.id, SERVICE_ICON_TONES, scheme)}>
              {service.icon}
            </View>
            <Text className='list-title'>{service.title}</Text>
            {(service as any).badgeCount > 0 && (
              <View className='list-badge'>
                <Text className='list-badge-text'>{(service as any).badgeCount}</Text>
              </View>
            )}
            <View className='list-arrow'>
              <Arrow size={16} color='#c8c9cc' />
            </View>
          </View>
        ))}

        {/* 设置 */}
        {settings.map((setting) => (
          <View key={setting.id} className='list-item' onClick={() => handleSettingClick(setting)}>
            <View className='list-icon' style={getProfileListIconStyle(setting.id, SETTING_ICON_TONES, scheme)}>
              {setting.icon}
            </View>
            <Text className='list-title'>{setting.title}</Text>
            <View className='list-arrow'>
              <Arrow size={16} color='#c8c9cc' />
            </View>
          </View>
        ))}
      </View>

      {/* 清除缓存（独立工具卡片） */}
      <View className='profile-card tool-card' onClick={handleClearCache}>
        <Text className='tool-text'>清除缓存</Text>
      </View>

      {/* 登录/退出登录（独立工具卡片） */}
      {isLoggedIn ? (
        <View className='profile-card tool-card' onClick={handleLogout}>
          <Text className='tool-text tool-text--logout'>退出登录</Text>
        </View>
      ) : (
        <View className='profile-card tool-card' onClick={handleGoLogin}>
          <Text className='tool-text tool-text--login'>登录</Text>
        </View>
      )}

      <View className='profile-version'>
        <Text>{`版本号 v${__APP_VERSION__}`}</Text>
      </View>


    </View>
  )
}

export default withAuth(ProfilePage, { public: true })
