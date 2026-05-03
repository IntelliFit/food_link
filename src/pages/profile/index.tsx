import { View, Text, Image, Button } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  TodoListOutlined,
  NotesOutlined,
  ChartTrendingOutlined,
  LocationOutlined,
  ShopOutlined,
  Bell,
  ShieldOutlined,
  InfoOutlined,
  CalendarOutlined,
  Arrow,
  ClockOutlined
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
  MembershipStatus,
  FoodExpiryDashboard
} from '../../utils/api'
import {
  getFounderPaidBonusRankLabel,
  getFounderPaidBonusSourceLabel,
  getCurrentMembershipTier,
  getMembershipTierLabel,
  getMembershipTierShortLabel,
} from '../../utils/membership'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { useAppColorScheme } from '../../components/AppColorSchemeContext'

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'

declare const __APP_VERSION__: string

interface UserInfo {
  avatar: string
  name: string
  meta: string
}

/** 注册时间格式化为 YYYY-MM-DD */
function formatRegisterDate(value: string | undefined | null): string {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatExpiry(value?: string | null): string {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type RewardLevelMeta = {
  level: number
  title: string
  min: number
  max: number | null
}

const REWARD_LEVELS: RewardLevelMeta[] = [
  { level: 1, title: '探味新芽', min: 0, max: 10 },
  { level: 2, title: '零食巡逻队', min: 10, max: 50 },
  { level: 3, title: '风味侦察员', min: 50, max: 200 },
  { level: 4, title: '菜单收藏家', min: 200, max: 1000 },
  { level: 5, title: '热量驯龙师', min: 1000, max: 3000 },
  { level: 6, title: '传说食探长', min: 3000, max: null },
]

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
  const [registerDate, setRegisterDate] = useState('--')

  // 会员状态
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [expiryDashboard, setExpiryDashboard] = useState<FoodExpiryDashboard | null>(null)
  
  // 好友请求数量
  const [friendRequestCount, setFriendRequestCount] = useState(0)

  // 每次显示页面时检查登录状态并刷新数据（含会员配额）
  useDidShow(() => {
    loadUserInfo()
  })

  const loadUserInfo = async () => {
    try {
      const token = getAccessToken()
      if (token) {
        setIsLoggedIn(true)

        // 1. 先读本地缓存，零延迟展示旧数据
        const storedUserInfo = Taro.getStorageSync('userInfo')
        if (storedUserInfo) {
          setUserInfo(storedUserInfo)
        }
        const storedRegisterTime = Taro.getStorageSync('userRegisterTime')
        if (storedRegisterTime) {
          setRegisterDate(formatRegisterDate(storedRegisterTime))
        }
        const storedMembership = Taro.getStorageSync('membershipStatus')
        if (storedMembership) {
          try {
            setMembershipStatus(JSON.parse(storedMembership))
          } catch (_) { /* ignore */ }
        }

        // 2. 异步请求网络，获取最新数据后更新
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
          if (friendRequestsData?.received) {
            const pendingCount = friendRequestsData.received.filter(r => r.status === 'pending').length
            setFriendRequestCount(pendingCount)
          }
          // 只在成功获取到数据时才更新（避免覆盖已有数据为 null）
          if (membershipData !== null) {
            setMembershipStatus(membershipData)
            Taro.setStorageSync('membershipStatus', JSON.stringify(membershipData))
          }
          if (dashboardData !== null) {
            setExpiryDashboard(dashboardData as FoodExpiryDashboard)
          }

          // 获取记录天数
          let days = 0
          try {
            const recordDaysData = await getUserRecordDays()
            days = recordDaysData.record_days
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
          const registerTime = apiUserInfo.create_time || storedRegisterTime || ''
          if (apiUserInfo.create_time) {
            Taro.setStorageSync('userRegisterTime', apiUserInfo.create_time)
          }
          setRegisterDate(formatRegisterDate(registerTime))
          const completed = apiUserInfo.onboarding_completed ?? true
          setOnboardingCompleted(completed)
          // 首次登录未填写健康档案时，先跳转到答题页面
          if (!completed) {
            Taro.redirectTo({ url: extraPkgUrl('/pages/health-profile/index') })
            return
          }
          // 同步到 storage
          Taro.setStorageSync('userInfo', nextUserInfo)
        } catch (error) {
          console.error('获取用户信息失败:', error)
          // 网络请求失败时，本地缓存已经在上面展示过了，无需额外处理
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
        setRegisterDate('--')
      }
    } catch (error) {
      console.error('读取登录状态失败:', error)
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
      desc: '生理指标、BMR/TDEE、病史与饮食偏好'
    },
      {
        id: 1,
        icon: <NotesOutlined size='20' />,
        title: '我的收藏',
        desc: '收藏过的餐食，随时复用',
        path: '/pages/recipes/index'
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
      id: 3,
      icon: <ChartTrendingOutlined size='20' />,
      title: '饮食记录',
      desc: '日历图查看每天吃多吃少'
    },
    {
      id: 4,
      icon: <LocationOutlined size='20' />,
      title: '邀请有礼',
      desc: '邀请新用户，达标后双方各得 15 积分',
      path: extraPkgUrl('/pages/invite-friends/index')
    },
    {
      id: 5,
      icon: <ShopOutlined size='20' />,
      title: '公共食物库',
      desc: '浏览公共食物营养数据',
      path: extraPkgUrl('/pages/food-library/index')
    },
    {
      id: 6,
      icon: <ShieldOutlined size='20' />,
      title: '食探会员',
      desc: membershipStatus?.is_pro
        ? (membershipStatus?.daily_credits_max ?? 0) > 0
          ? `${getMembershipTierLabel(getCurrentMembershipTier(membershipStatus))}${membershipStatus?.early_user_paid_bonus_active ? ` · 创始 x${membershipStatus?.early_user_paid_bonus_multiplier ?? 2}` : ''} · 已用 ${membershipStatus?.daily_credits_used ?? 0}/${membershipStatus?.daily_credits_max ?? 0} · 可用 ${membershipTotalAvailable} · 系统 ${membershipSystemRemaining} · 奖励 ${membershipEarnedBalance}`
          : `${getMembershipTierLabel(getCurrentMembershipTier(membershipStatus))} · 不限次数`
        : membershipStatus?.trial_active
          ? `${membershipStatus?.trial_policy === 'founding_top_500_bonus_month' ? `前 500 #${membershipStatus?.early_user_rank ?? '--'} 免费 2 个月` : (membershipStatus?.trial_policy === 'early_first_1000' || (membershipStatus?.trial_days_total ?? 0) >= 30) ? `前 1000 #${membershipStatus?.early_user_rank ?? '--'} 免费月` : '免费 3 天试用'} · 已用 ${membershipStatus?.daily_credits_used ?? 0}/${membershipStatus?.daily_credits_max ?? 0} · 可用 ${membershipTotalAvailable} · 系统 ${membershipSystemRemaining} · 奖励 ${membershipEarnedBalance}`
          : membershipStatus?.early_user_paid_bonus_eligible
            ? `创始礼遇 · ${getFounderPaidBonusSourceLabel(membershipStatus) || '前 1000 注册 / 前 100 付费'}开通后积分翻倍`
            : '3 档会员 · 每日系统积分发放',
      path: extraPkgUrl('/pages/pro-membership/index')
    }
  ]

  // 设置项
  const settings = [
    { id: 2, icon: <Bell size='20' />, title: '好友管理', badge: friendRequestCount },
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
    // 我的收藏
    if (service.id === 1) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/recipes/index') })
      return
    }
    // 食物管理
    if (service.id === 2) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/expiry/index') })
      return
    }
    // 饮食记录（整合日历图和数据统计）
    if (service.id === 3) {
      Taro.switchTab({ url: '/pages/stats/index' })
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
    // 好友管理
    if (setting.id === 2) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/friends/index') })
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
    Taro.navigateTo({ url: extraPkgUrl('/pages/profile-settings/index') })
  }

  // 处理去登录
  const handleGoLogin = () => {
    redirectToLogin()
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
            setRegisterDate('--')
            Taro.removeStorageSync('userRegisterTime')
            Taro.showToast({ title: '已退出登录', icon: 'success' })
          } catch (error) {
            console.error('退出登录失败:', error)
          }
        }
      }
    })
  }

  const getServiceColor = (id: number) => {
    const colors: Record<number, string> = {
      0: '#10b981', // 健康档案 - 绿
      1: '#f59e0b', // 收藏餐食 - 橙
      2: '#8b5cf6', // 食物管理 - 紫
      3: '#3b82f6', // 饮食记录 - 蓝
      4: '#f59e0b', // 邀请有礼 - 金
      5: '#10b981', // 公共食物库 - 绿
      6: '#f59e0b'  // 食探会员 - 金
    }
    return colors[id] || '#6b7280'
  }

  const getSettingColor = (id: number) => {
    const colors: Record<number, string> = {
      2: '#3b82f6', // 好友管理 - 蓝
      3: '#10b981', // 隐私设置 - 绿
      5: '#8b5cf6'  // 关于我们 - 紫
    }
    return colors[id] || '#6b7280'
  }

  return (
    <View className='profile-page'>
      <View className='profile-theme-chip' onClick={toggleScheme}>
        <Text className={`iconfont ${scheme === 'dark' ? 'icon-zaoshang' : 'icon-wanshang'} profile-theme-chip-icon`} />
      </View>

      {/* 顶部用户信息卡片（微信风格） */}
      <View className='profile-card user-card' onClick={isLoggedIn ? handleSettings : handleGoLogin}>
        <View className={`user-avatar-wrapper ${!isLoggedIn ? 'no-border' : ''}`}>
          {!isLoggedIn ? (
            <Text className='iconfont icon-weidenglu user-avatar-icon' />
          ) : userInfo.avatar && userInfo.avatar.startsWith('http') ? (
            <Image src={userInfo.avatar} mode='aspectFit' className='user-avatar-image' />
          ) : (
            <Text className='iconfont icon-weidenglu user-avatar-icon' />
          )}
        </View>
        <View className='user-info-main'>
          {isLoggedIn ? (
            <>
              <Text className='user-name'>{userInfo.name}</Text>
              <Text className='user-subtitle'>{userInfo.meta}</Text>
            </>
          ) : (
            <Text className='user-name'>点击登录</Text>
          )}
        </View>
        <Arrow size={20} color='#c8c9cc' className='user-arrow' />
      </View>

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
                      <Text className='member-meter__label'>系统分配（次日清0）</Text>
                      <Text className='member-meter__value'>{cMax > 0 ? `${cSystemRemain}/${cMax}` : `${cSystemRemain}`}</Text>
                    </View>
                    <View className='progress-bar'>
                      <View className='progress-inner' style={{ width: `${systemProgressPct}%` }} />
                    </View>
                  </View>

                  <View className='member-meter'>
                    <View className='member-meter__head'>
                      <Text className='member-meter__label'>奖励分（一直持有）</Text>
                      <Text className='member-meter__value'>{`${cEarned} · Lv${rewardLevel.level} ${rewardLevel.title}`}</Text>
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

      {/* 服务分组（微信列表风格） */}
      <View className='profile-card list-card'>
        {services.map((service) => (
          <View key={service.id} className='list-item' onClick={() => handleServiceClick(service)}>
            <View className='list-icon' style={{ color: getServiceColor(service.id) }}>
              {service.icon}
            </View>
            <Text className='list-title'>{service.title}</Text>
            <View className='list-arrow'>
              <Arrow size={16} color='#c8c9cc' />
            </View>
          </View>
        ))}
      </View>

      {/* 设置分组（微信列表风格） */}
      <View className='profile-card list-card'>
        {settings.map((setting) => (
          <View key={setting.id} className='list-item' onClick={() => handleSettingClick(setting)}>
            <View className='list-icon' style={{ color: getSettingColor(setting.id) }}>
              {setting.icon}
            </View>
            <Text className='list-title'>{setting.title}</Text>
            {(setting as any).text && <Text className='list-extra'>{(setting as any).text}</Text>}
            {/* 好友请求数量圆圈 */}
            {(setting as any).badge > 0 && (
              <View className='list-badge'>
                <Text className='list-badge-text'>{(setting as any).badge}</Text>
              </View>
            )}
            <View className='list-arrow'>
              <Arrow size={16} color='#c8c9cc' />
            </View>
          </View>
        ))}
      </View>

      {/* 登录/退出登录 */}
      {isLoggedIn ? (
        <View className='profile-card logout-card' onClick={handleLogout}>
          <Text className='logout-text'>退出登录</Text>
        </View>
      ) : (
        <View className='profile-card login-card' onClick={handleGoLogin}>
          <Text className='login-text'>登录</Text>
        </View>
      )}

      <View className='profile-version'>
        <Text>{`版本号 v${__APP_VERSION__}`}</Text>
      </View>


    </View>
  )
}

export default withAuth(ProfilePage, { public: true })
