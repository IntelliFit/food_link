import { View, Text, Image, Navigator } from '@tarojs/components'
import * as React from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
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
  getRewardLevelMeta,
  getRewardLevelProgress,
  formatRewardLevelRange,
  type RewardLevelMeta,
} from '../../utils/membership'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'
import { cleanupGeneratedUserFiles } from '../../utils/weapp-user-files'
import { clearAllOnboardingGuides } from '../../utils/onboarding-guide-storage'
import { clearRecentConsoleLogs } from '../../utils/console-log-buffer'

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'

declare const __APP_VERSION__: string

interface UserInfo {
  avatar: string
  name: string
  meta: string
}

type ProfileListIconTone = {
  color: string
  backgroundColor: string
  darkColor: string
  darkBackgroundColor: string
}

const SERVICE_ICON_TONES: Record<number, ProfileListIconTone> = {
  0: { color: '#41a17a', backgroundColor: '#ecfcf4', darkColor: '#6ff6bc', darkBackgroundColor: 'rgba(111, 246, 188, 0.16)' },
  2: { color: '#987f42', backgroundColor: '#faf5e8', darkColor: '#fcd666', darkBackgroundColor: 'rgba(252, 214, 102, 0.16)' },
  4: { color: '#7c68d8', backgroundColor: '#f3f0ff', darkColor: '#c4b5fd', darkBackgroundColor: 'rgba(196, 181, 253, 0.16)' },
  5: { color: '#4c92b3', backgroundColor: '#ecf7fc', darkColor: '#81d6fb', darkBackgroundColor: 'rgba(129, 214, 251, 0.16)' },
  8: { color: '#6e5ab5', backgroundColor: '#f4f0fc', darkColor: '#b39ef4', darkBackgroundColor: 'rgba(179, 158, 244, 0.16)' },
  10: { color: '#0f8f74', backgroundColor: '#eafaf5', darkColor: '#6ee7c8', darkBackgroundColor: 'rgba(110, 231, 200, 0.16)' },
  11: { color: '#d97706', backgroundColor: '#fff7e6', darkColor: '#fbbf24', darkBackgroundColor: 'rgba(251, 191, 36, 0.16)' },
}

const SETTING_ICON_TONES: Record<number, ProfileListIconTone> = {
  1: { color: '#4c92b3', backgroundColor: '#ecf7fc', darkColor: '#81d6fb', darkBackgroundColor: 'rgba(129, 214, 251, 0.16)' },
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

function formatExpiryPreviewText(dashboard: FoodExpiryDashboard | null): string {
  if (!dashboard) return '把牛奶、水果、剩菜记进来，快到期时会在这里提醒你。'
  if (dashboard.active_count <= 0) return '还没有记录保质期食物，点击开始添加。'
  if (dashboard.expired_count > 0) return `当前有 ${dashboard.expired_count} 样已过期，建议先处理。`
  if (dashboard.today_count > 0) return `今天有 ${dashboard.today_count} 样需要优先吃掉。`
  if (dashboard.soon_count > 0) return `接下来有 ${dashboard.soon_count} 样即将到期。`
  return `当前共有 ${dashboard.active_count} 样食物在保鲜中。`
}

function ProfileListIcon({ name }: { name: string }) {
  return <Text className={`iconfont ${name} profile-list-icon-symbol`} />
}

function ProfilePage() {
  const { scheme } = useAppColorScheme()
  // 登录状态
  const [isLoggedIn, setIsLoggedIn] = React.useState(false)
  const [userId, setUserId] = React.useState('')

  // （个人设置已迁移到独立页面 /pages/profile-settings/index）

  // 用户信息
  const [userInfo, setUserInfo] = React.useState<UserInfo>({
    avatar: '',
    name: '用户昵称',
    meta: '已记录 0 天'
  })

  const [onboardingStatus, setOnboardingStatus] = React.useState<'pending' | 'skipped' | 'completed'>('completed')

  // 记录天数
  const [recordDays, setRecordDays] = React.useState(0)

  // 会员状态
  const [membershipStatus, setMembershipStatus] = React.useState<MembershipStatus | null>(null)
  const [expiryDashboard, setExpiryDashboard] = React.useState<FoodExpiryDashboard | null>(null)

  // 好友请求数量
  const [friendRequestCount, setFriendRequestCount] = React.useState(0)

  // 快捷入口统计数字
  const [analyzeCount, setAnalyzeCount] = React.useState(0)
  const [friendCount, setFriendCount] = React.useState(0)
  const [favoriteCount, setFavoriteCount] = React.useState(0)

  // 每次显示页面时检查登录状态并刷新数据（含会员配额）
  useDidShow(() => {
    loadUserInfo()
  })

  const loadUserInfo = async () => {
    try {
      const token = getAccessToken()
      if (token) {
        setIsLoggedIn(true)
        const cachedUserId = String(Taro.getStorageSync('user_id') || '').trim()
        setUserId(cachedUserId)

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
          const resolvedUserId = String(apiUserInfo.id || cachedUserId).trim()
          setUserId(resolvedUserId)
          setUserInfo(nextUserInfo)
          Taro.setStorageSync('userInfo', {
            ...nextUserInfo,
            nickname: apiUserInfo.nickname || '用户昵称',
          })
          const completed = apiUserInfo.onboarding_completed === true
          setOnboardingStatus(apiUserInfo.onboarding_status || (completed ? 'completed' : 'pending'))

          // 加载快捷入口统计数字
          loadQuickStats()
        } catch (error) {
          console.error('获取用户信息失败:', error)
        }
      } else {
        setIsLoggedIn(false)
        setMembershipStatus(null)
        setUserId('')
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
      iconClass: 'icon-shentinianling',
      title: '健康档案',
      desc: '生理指标、日常消耗、病史与饮食偏好'
    },
    {
      id: 4,
      iconClass: 'icon-good',
      title: '我的宠物',
      desc: `奖励积分 ${membershipEarnedBalance}，去看看你的健康伙伴`,
      path: extraPkgUrl('/pages/pet-home/index')
    },
    {
      id: 6,
      iconClass: 'icon-zengji',
      title: '赚积分',
      desc: '查看今天还能做哪些任务、每项上限和当前进度',
      path: extraPkgUrl('/pages/reward-center/index')
    },
    {
      id: 9,
      iconClass: 'icon-dizhi',
      title: '校园食堂',
      desc: '查食堂菜品热量、价格和蛋白质',
      path: extraPkgUrl('/pages/campus-canteen/index')
    },
    {
      id: 5,
      iconClass: 'icon-foodshop',
      title: '公共食物库',
      desc: '浏览公共食物营养数据',
      path: extraPkgUrl('/pages/food-library/index')
    },
    {
      id: 2,
      iconClass: 'icon-guoqi1',
      title: '食物保质期',
      desc: formatExpiryPreviewText(expiryDashboard),
      path: '/pages/expiry/index',
      badgeCount: (expiryDashboard?.expired_count ?? 0) + (expiryDashboard?.today_count ?? 0) + (expiryDashboard?.soon_count ?? 0)
    },
    {
      id: 11,
      iconClass: 'icon-duoren',
      title: '邀请好友得会员',
      desc: '好友有效使用 2 天，你得 7 天、好友得 3 天会员',
      path: extraPkgUrl('/pages/invite-friends/index')
    },
    {
      id: 8,
      iconClass: 'icon-pengyouquan',
      title: '加入用户群',
      desc: '反馈问题、提建议，一起共创食探',
      path: extraPkgUrl('/pages/user-group/index')
    },
    {
      id: 10,
      iconClass: 'icon-pinglun',
      title: '意见反馈',
      desc: '提交问题或建议，并自动附带最近请求诊断',
      path: extraPkgUrl('/pages/feedback/index')
    }
  ]

  // 设置项
  const settings = [
    { id: 1, iconClass: 'icon-user', title: '账号安全' },
    { id: 3, iconClass: 'icon-jiesuo', title: '隐私设置' },
    { id: 5, iconClass: 'icon-all', title: '关于我们' }
  ]

  const handleServiceClick = (service: typeof services[0]) => {
    // 检查登录
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

      // 健康档案：待填或稍后填写均可主动进入填写；已完成进入查看页。
      if (service.id === 0) {
        if (onboardingStatus !== 'completed') {
        Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })
      } else {
        Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile-view/index') })
      }
      return
    }
    // 食物管理
    if (service.id === 2) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/expiry/index') })
      return
    }
    // 识别记录
    if (service.id === 7) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/analyze-history/index') })
      return
    }
    // 公共食物库
    if (service.id === 5) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/food-library/index') })
      return
    }
    // 校园食堂
    if (service.id === 9) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/campus-canteen/index') })
      return
    }
    if (service.id === 8) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/user-group/index') })
      return
    }
    if (service.id === 10) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/feedback/index') })
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
    // 账号安全
    if (setting.id === 1) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/account-security/index') })
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
  const handleQuickActionClick = React.useCallback((path: string) => {
    console.log('[profile] quick action click:', path)
    Taro.navigateTo({
      url: path,
      fail: (err) => {
        console.error('[profile] navigateTo failed:', err)
        Taro.showToast({ title: '页面跳转失败', icon: 'none' })
      }
    })
  }, [])

  // 复制用户 ID
  const handleCopyUserId = React.useCallback(() => {
    const value = userId.trim()
    if (!value) {
      Taro.showToast({ title: '暂无用户ID', icon: 'none' })
      return
    }
    Taro.setClipboardData({
      data: value,
      success: () => {
        Taro.showToast({ title: '已复制用户ID', icon: 'success' })
      },
      fail: (err) => {
        console.error('[profile] copy user id failed:', err)
        Taro.showToast({ title: '复制失败', icon: 'none' })
      }
    })
  }, [userId])

  // 处理去登录
  const handleGoLogin = () => {
    redirectToLogin()
  }

  // Taro 小程序端在同一节点上移除/替换事件时可能触发 removeEventListener 崩溃；
  // 这里保持用户名节点始终使用同一个稳定 handler，登录后只做空操作。
  const handleUserNameClick = React.useCallback(() => {
    if (!getAccessToken()) {
      redirectToLogin()
    }
  }, [])

  // 处理清除缓存
  const handleClearCache = () => {
    Taro.showModal({
      title: '提示',
      content: '确定要清除缓存吗？这将重置首页、识别记录和朋友圈的本地数据，下次进入时会重新加载。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          clearAllOnboardingGuides()

          // 首页相关缓存
          Taro.removeStorageSync('home_dashboard_local_cache')
          Taro.removeStorageSync('body_metrics_storage')
          Taro.removeStorageSync('food_link_dashboard_targets_v1')
          Taro.removeStorageSync('home_poster_modal_visible')
          Taro.removeStorageSync('showRecordMenuModal')
          Taro.removeStorageSync('home_pet_companion_collapsed_v1')
          Taro.removeStorageSync('home_pet_companion_float_position_v1')

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
            if (
              key.startsWith('comment_draft_') ||
              key.startsWith('temp_comments_') ||
              key.startsWith('record_manual_custom_foods_v1:')
            ) {
              try { Taro.removeStorageSync(key) } catch (_) {}
            }
          })

          // 意见反馈诊断缓存
          Taro.removeStorageSync('recent_request_traces_v1')
          clearRecentConsoleLogs()

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
            setUserId('')
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
            {isLoggedIn ? (
              <>
                <View className='user-name-row'>
                  <Text className='user-name' onClick={handleUserNameClick}>{userInfo.name}</Text>
                  <View className='user-name-actions'>
                    <View className='user-days-pill'>
                      <Text className='user-days-pill-text'>已记录 {recordDays} 天</Text>
                    </View>
                    {userId && (
                      <View className='user-id-chip' onClick={handleCopyUserId}>
                        <Text className='user-id-chip-text'>复制ID</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View className='user-meta-row' onClick={handleSettings}>
                  <Text className='user-meta-text'>个人主页</Text>
                  <Text className='iconfont icon-right user-meta-arrow' />
                </View>
              </>
            ) : (
              <View className='user-name-row'>
                <Text className='user-name' onClick={handleUserNameClick}>点击登录</Text>
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
      {isLoggedIn && onboardingStatus !== 'completed' && (
        <View
          className='profile-card onboarding-card'
          onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile/index') })}
        >
          <Text className='onboarding-text'>📋 完善健康档案，获取更贴合你的饮食建议</Text>
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
                      <Text className='member-meter__label'>奖励积分（一直持有）</Text>
                      <Text className='member-meter__value'>{`${rewardRangeText} · Lv${rewardLevel.level} ${rewardLevel.title}`}</Text>
                    </View>
                    <View className='segmented-progress'>
                      {Array.from({ length: 10 }).map((_, i) => {
                        const filledCount = Math.min(Math.max(Math.ceil(rewardProgressPct / 10), 0), 10)
                        const isFilled = i < filledCount
                        return (
                          <View
                            key={i}
                            className={`segmented-progress__bar ${isFilled ? 'segmented-progress__bar--filled' : ''}`}
                          />
                        )
                      })}
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
            <Text className='iconfont icon-jiesuo card-bg-icon-symbol' />
          </View>
        </View>
      )}

      {/* 功能列表（合并为单个白色卡片） */}
      <View className='profile-card list-card combined-list'>
        {/* 核心功能 */}
        {services.map((service) => (
          <View key={service.id} className='list-item' onClick={() => handleServiceClick(service)}>
            <View className='list-icon' style={getProfileListIconStyle(service.id, SERVICE_ICON_TONES, scheme)}>
              <ProfileListIcon name={service.iconClass} />
            </View>
            <Text className='list-title'>{service.title}</Text>
            {(service as any).badgeCount > 0 && (
              <View className='list-badge'>
                <Text className='list-badge-text'>{(service as any).badgeCount}</Text>
              </View>
            )}
          </View>
        ))}

        {/* 设置 */}
        {settings.map((setting) => (
          <View key={setting.id} className='list-item' onClick={() => handleSettingClick(setting)}>
            <View className='list-icon' style={getProfileListIconStyle(setting.id, SETTING_ICON_TONES, scheme)}>
              <ProfileListIcon name={setting.iconClass} />
            </View>
            <Text className='list-title'>{setting.title}</Text>
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
