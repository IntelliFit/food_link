import { View, Text, Image, Button } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  TodoListOutlined,
  NotesOutlined,
  ChartTrendingOutlined,
  LocationOutlined,
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

import './index.scss'
import { withAuth, redirectToLogin } from '../../utils/withAuth'

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

function formatExpiryPreviewText(dashboard: FoodExpiryDashboard | null): string {
  if (!dashboard) return '把牛奶、水果、剩菜记进来，快到期时会在这里提醒你。'
  if (dashboard.active_count <= 0) return '还没有记录保质期食物，点击开始添加。'
  if (dashboard.expired_count > 0) return `当前有 ${dashboard.expired_count} 样已过期，建议先处理。`
  if (dashboard.today_count > 0) return `今天有 ${dashboard.today_count} 样需要优先吃掉。`
  if (dashboard.soon_count > 0) return `接下来有 ${dashboard.soon_count} 样即将到期。`
  return `当前共有 ${dashboard.active_count} 样食物在保鲜中。`
}

function ProfilePage() {
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
        // 从服务器获取最新用户信息
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

          setUserInfo({
            avatar: apiUserInfo.avatar || '',
            name: apiUserInfo.nickname || '用户昵称',
            meta: `已记录 ${days} 天`
          })
          const registerTime = apiUserInfo.create_time || Taro.getStorageSync('userRegisterTime') || ''
          if (apiUserInfo.create_time) {
            Taro.setStorageSync('userRegisterTime', apiUserInfo.create_time)
          }
          setRegisterDate(formatRegisterDate(registerTime))
          const completed = apiUserInfo.onboarding_completed ?? true
          setOnboardingCompleted(completed)
          // 首次登录未填写健康档案时，先跳转到答题页面
          if (!completed) {
            Taro.redirectTo({ url: '/pages/health-profile/index' })
            return
          }
          // 同步到 storage
          Taro.setStorageSync('userInfo', {
            avatar: apiUserInfo.avatar || '',
            name: apiUserInfo.nickname || '用户昵称',
            meta: `已记录 ${days} 天`
          })
        } catch (error) {
          console.error('获取用户信息失败:', error)
          // 如果获取失败，尝试从本地存储读取
          const storedUserInfo = Taro.getStorageSync('userInfo')
          if (storedUserInfo) {
            setUserInfo(storedUserInfo)
          }
          setRegisterDate(formatRegisterDate(Taro.getStorageSync('userRegisterTime') || ''))
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
      title: '收藏餐食',
      desc: '常吃的食物组合，一键记录',
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
      id: 5,
      icon: <LocationOutlined size='20' />,
      title: '附近美食',
      desc: '发现附近健康美食推荐'
    },
    {
      id: 6,
      icon: <ShieldOutlined size='20' />,
      title: '食探会员',
      desc: membershipStatus?.is_pro ? '会员已开通' : '每日30次 · 会员100次',
      path: '/pages/pro-membership/index'
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
        Taro.navigateTo({ url: '/pages/health-profile/index' })
      } else {
        Taro.navigateTo({ url: '/pages/health-profile-view/index' })
      }
      return
    }
    // 我的食谱
    if (service.id === 1) {
      Taro.navigateTo({ url: '/pages/recipes/index' })
      return
    }
    // 食物管理
    if (service.id === 2) {
      Taro.navigateTo({ url: '/pages/expiry/index' })
      return
    }
    // 饮食记录（整合日历图和数据统计）
    if (service.id === 3) {
      Taro.switchTab({ url: '/pages/stats/index' })
      return
    }
    // 附近美食（开发中）
    if (service.id === 5) {
      Taro.showModal({
        title: '🍜 功能开发中',
        content: '「附近美食」功能正在紧锣密鼓地开发中，即将上线，敬请期待！',
        showCancel: false,
        confirmText: '好的',
        confirmColor: '#00bc7d'
      })
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
      Taro.navigateTo({ url: '/pages/about/index' })
      return
    }

    if (!isLoggedIn) {
      redirectToLogin()
      return
    }
    // 好友管理
    if (setting.id === 2) {
      Taro.navigateTo({ url: '/pages/friends/index' })
      return
    }
    // 隐私设置
    if (setting.id === 3) {
      Taro.navigateTo({ url: '/pages/privacy-settings/index' })
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
    Taro.navigateTo({ url: '/pages/profile-settings/index' })
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
      5: '#ef4444', // 附近美食 - 红
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
          onClick={() => Taro.navigateTo({ url: '/pages/pro-membership/index' })}
        >
          {membershipStatus?.is_pro ? (
            <>
              <View className='card-header'>
                <View>
                  <Text className='card-validity'>到期 {formatExpiry(membershipStatus.expires_at)}</Text>
                  <View className='card-title-row'>
                    <Text className='card-title'>食探会员</Text>
                    <Text className='card-pro-badge'>PRO</Text>
                  </View>
                </View>
              </View>
              <View className='card-body'>
                <View className='progress-info'>
                  {membershipStatus.daily_limit != null ? (
                    <>
                      <Text className='progress-text'>今日拍照 {membershipStatus.daily_used ?? 0}/{membershipStatus.daily_limit} 次</Text>
                      <View className='progress-bar'>
                        <View
                          className='progress-inner'
                          style={{
                            width: `${Math.min(((membershipStatus.daily_used ?? 0) / membershipStatus.daily_limit) * 100, 100)}%`
                          }}
                        />
                      </View>
                    </>
                  ) : (
                    <Text className='progress-text'>今日拍照分析 {membershipStatus.daily_used ?? 0} 次</Text>
                  )}
                </View>
                <Text className='card-tip'>
                  {membershipStatus.daily_limit != null
                    ? `剩余 ${membershipStatus.daily_remaining ?? 0} 次 · 精准模式已解锁`
                    : '当前不限次 · 精准模式已解锁'}
                </Text>
              </View>
            </>
          ) : (
            <>
              <View className='card-header'>
                <View>
                  <Text className='card-validity'>注册时间 {registerDate}</Text>
                  <Text className='card-title'>食探会员</Text>
                </View>
                <View className='card-upgrade-btn'>
                  <Text className='card-upgrade-text'>立即开通</Text>
                </View>
              </View>
              <View className='card-body'>
                <View className='progress-info'>
                  {membershipStatus?.daily_limit != null ? (
                    <>
                      <Text className='progress-text'>
                        今日拍照 {membershipStatus.daily_used ?? 0}/{membershipStatus.daily_limit} 次
                      </Text>
                      <View className='progress-bar'>
                        <View
                          className='progress-inner'
                          style={{
                            width: `${Math.min(((membershipStatus.daily_used ?? 0) / membershipStatus.daily_limit) * 100, 100)}%`
                          }}
                        />
                      </View>
                    </>
                  ) : (
                    <Text className='progress-text'>今日拍照分析 {membershipStatus?.daily_used ?? 0} 次</Text>
                  )}
                </View>
                <Text className='card-tip'>
                  {membershipStatus?.daily_limit != null
                    ? `剩余 ${membershipStatus?.daily_remaining ?? 0} 次 · 开通会员每日最高100次`
                    : '当前不限次 · 开通会员享专属权益'}
                </Text>
              </View>
            </>
          )}
          <View className='card-bg-icon'>
            <ShieldOutlined size='120' color='rgba(255,255,255,0.1)' />
          </View>
        </View>
      )}

      {/* 引导横幅 */}
      {isLoggedIn && !onboardingCompleted && (
        <View
          className='profile-card onboarding-card'
          onClick={() => Taro.navigateTo({ url: '/pages/health-profile/index' })}
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
        <Text>版本号 v2.0.7</Text>
      </View>


    </View>
  )
}

export default withAuth(ProfilePage, { public: true })
