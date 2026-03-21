import { View, Text, Image, Button, Input } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Cell } from '@taroify/core'
import '@taroify/core/cell/style'
import {
  TodoListOutlined,
  NotesOutlined,
  ChartTrendingOutlined,
  LocationOutlined,
  SettingOutlined,
  ShieldOutlined,
  InfoOutlined,
  CalendarOutlined,
  EnvelopOutlined
} from '@taroify/icons'
import '@taroify/icons/style'
import {
  getUserProfile,
  getAccessToken,
  clearAllStorage,
  getUserRecordDays,
  updateUserInfo,
  uploadUserAvatar,
  imageToBase64
} from '../../utils/api'

import './index.scss'

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

export default function ProfilePage() {
  // 登录状态
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // 是否显示设置弹窗
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  // 临时头像和昵称（用于填写表单）
  const [tempAvatar, setTempAvatar] = useState('')
  const [tempNickname, setTempNickname] = useState('')

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

  // 每次显示页面时检查登录状态并刷新数据
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
          const apiUserInfo = await getUserProfile()

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
        setUserInfo({
          avatar: '',
          name: '用户昵称',
          meta: '已记录 0 天'
        })
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
      icon: <TodoListOutlined size="32" />,
      title: '健康档案',
      desc: '生理指标、BMR/TDEE、病史与饮食偏好'
    },
    {
      id: 1,
      icon: <NotesOutlined size="32" />,
      title: '收藏餐食',
      desc: '常吃的食物组合，一键记录',
      path: '/pages/recipes/index'
    },
    {
      id: 3,
      icon: <ChartTrendingOutlined size="32" />,
      title: '饮食记录',
      desc: '日历图查看每天吃多吃少'
    },
    {
      id: 5,
      icon: <LocationOutlined size="32" />,
      title: '附近美食',
      desc: '发现附近健康美食推荐'
    }
  ]

  // 设置项
  const settings = [
    { id: 1, icon: <SettingOutlined size="20" />, title: '个人设置' }, // 将 “设置” 改为 “个人设置” 更直观
    { id: 3, icon: <ShieldOutlined size="20" />, title: '隐私设置' },
    { id: 5, icon: <InfoOutlined size="20" />, title: '关于我们' },
    { id: 6, icon: <EnvelopOutlined size="20" />, title: '联系邮箱', text: 'jianwen_ma@stu.pku.edu.cn' }
  ]

  const handleServiceClick = (service: typeof services[0]) => {
    // 检查登录
    if (!isLoggedIn) {
      Taro.navigateTo({ url: '/pages/login/index' })
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
    // 饮食记录（整合日历图和数据统计）
    if (service.id === 3) {
      Taro.navigateTo({ url: '/pages/stats/index' })
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
    // 复制邮箱
    if (setting.id === 6) {
      Taro.setClipboardData({
        data: setting.text,
        success: () => {
          Taro.showToast({ title: '已复制邮箱', icon: 'success' })
        }
      })
      return
    }

    // 关于我们
    if (setting.id === 5) {
      Taro.navigateTo({ url: '/pages/about/index' })
      return
    }

    if (!isLoggedIn) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    // 设置：打开个人设置弹窗
    if (setting.id === 1) {
      handleSettings()
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
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    setShowSettingsModal(true)
    // 初始化设置弹窗的临时数据
    setTempAvatar(userInfo.avatar)
    setTempNickname(userInfo.name)
  }

  // 处理头像选择
  const handleChooseAvatar = async (e: any) => {
    const { avatarUrl } = e.detail

    const needUpload = avatarUrl && !avatarUrl.startsWith('https://')

    if (needUpload) {
      Taro.showLoading({ title: '上传中...' })
      try {
        const base64 = await imageToBase64(avatarUrl)
        const { imageUrl } = await uploadUserAvatar(base64)
        setTempAvatar(imageUrl)
        Taro.hideLoading()
      } catch (err: any) {
        Taro.hideLoading()
        Taro.showToast({ title: '上传失败', icon: 'none' })
      }
    } else {
      setTempAvatar(avatarUrl)
    }
  }

  const handleNicknameInput = (e: any) => {
    setTempNickname(e.detail.value)
  }

  const handleNicknameBlur = (e: any) => {
    setTempNickname(e.detail.value)
  }

  // 保存完善的信息
  const handleSaveProfile = async () => {
    if (!tempAvatar || !tempNickname) {
      Taro.showToast({ title: '请完善头像和昵称', icon: 'none' })
      return
    }

    Taro.showLoading({ title: '保存中...' })
    try {
      await updateUserInfo({
        nickname: tempNickname,
        avatar: tempAvatar
      })

      // 更新本地状态
      const newUserInfo = { ...userInfo, avatar: tempAvatar, name: tempNickname }
      setUserInfo(newUserInfo)
      Taro.setStorageSync('userInfo', newUserInfo)

      Taro.hideLoading()
      Taro.showToast({ title: '保存成功', icon: 'success' })

      setShowSettingsModal(false)

    } catch (err: any) {
      Taro.hideLoading()
      Taro.showToast({ title: err.message || '保存失败', icon: 'none' })
    }
  }

  // 处理去登录
  const handleGoLogin = () => {
    Taro.navigateTo({ url: '/pages/login/index' })
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
            setUserInfo({
              avatar: '',
              name: '用户昵称',
              meta: '已记录 0 天'
            })
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

  return (
    <View className='profile-page'>
      {/* 顶部区域：用户信息 + 会员卡片 */}
      <View className='header-section'>
        {/* 第一行：用户信息 + 会员码 */}
        <View className='user-header-row'>
          <View className='user-basic-info'>
            {/* 点击头像/昵称区域也可以打开设置（如果已登录） */}
            <View className={`user-avatar-wrapper ${!isLoggedIn ? 'no-border' : ''}`} onClick={isLoggedIn ? handleSettings : handleGoLogin}>
              {!isLoggedIn ? (
                <Text className='iconfont icon-weidenglu user-avatar-icon' />
              ) : userInfo.avatar && userInfo.avatar.startsWith('http') ? (
                <Image
                  src={userInfo.avatar}
                  mode='aspectFit'
                  className='user-avatar-image'
                />
              ) : (
                <Text className='iconfont icon-weidenglu user-avatar-icon' />
              )}
            </View>
            <View className='user-text-info'>
              {isLoggedIn ? (
                <View onClick={handleSettings}>
                  <View className='user-name-row'>
                    <Text className='user-name'>{userInfo.name}</Text>
                  </View>
                  <Text className='user-phone'>{Taro.getStorageSync('phoneNumber') || '188******46'}</Text>
                  <View className='user-meta-row'>
                    <CalendarOutlined size="14" className="meta-icon" />
                    <Text className='user-meta-text'>{userInfo.meta}</Text>
                  </View>
                </View>
              ) : (
                <Button
                  className='login-link-button'
                  onClick={handleGoLogin}
                  plain
                  hoverClass='none'
                >
                  点击登录
                </Button>
              )}
            </View>
          </View>
        </View>

        {/* 第二行：会员卡片（仅登录后展示） */}
        {isLoggedIn && (
          <View className='member-card'>
            <View className='card-header'>
              <View>
                <Text className='card-validity'>注册时间 {registerDate}</Text>
                <Text className='card-title'>食探会员</Text>
              </View>
            </View>

            <View className='card-body'>
              <View className='progress-info'>
                <Text className='progress-text'>{recordDays}/365</Text>
                <View className='progress-bar'>
                  <View className='progress-inner' style={{ width: `${Math.min((recordDays / 365) * 100, 100)}%` }}></View>
                </View>
              </View>
              <Text className='card-tip'>您已在食探记录了 {recordDays} 天</Text>
            </View>

            <View className='card-bg-icon'>
              {/* 装饰背景图标 */}
              <ShieldOutlined size="120" color="rgba(255,255,255,0.1)" />
            </View>
          </View>
        )}

        {/* 服务网格 (原 services 列表) */}
        <View className='services-grid'>
          {services.map((service) => (
            <View
              key={service.id}
              className='grid-item'
              onClick={() => handleServiceClick(service)}
            >
              <View className='grid-icon'>{service.icon}</View>
              <Text className='grid-text'>{service.title}</Text>
            </View>
          ))}
        </View>
      </View>

      {isLoggedIn && !onboardingCompleted && (
        <View
          className='onboarding-banner'
          onClick={() => Taro.navigateTo({ url: '/pages/health-profile/index' })}
          style={{ margin: '32rpx' }}
        >
          <Text className='onboarding-banner-text'>📋 完善健康档案，获取个性化饮食建议</Text>
          <Text className='onboarding-banner-arrow'>{'>'}</Text>
        </View>
      )}

      {/* 设置 */}
      <View className='settings-section'>
        <Cell.Group>
          {settings.map((setting) => (
            <Cell
              key={setting.id}
              title={setting.title}
              icon={setting.icon}
              isLink={!(setting as any).text}
              onClick={() => handleSettingClick(setting)}
            >
              {(setting as any).text ? <Text style={{ fontSize: '28rpx', color: '#64748b' }}>{(setting as any).text}</Text> : null}
            </Cell>
          ))}
        </Cell.Group>
      </View>

      {/* 登录/退出登录按钮 */}
      {
        isLoggedIn ? (
          <View className='logout-btn' onClick={handleLogout}>
            <Text className='logout-text'>退出登录</Text>
          </View>
        ) : (
          <Button
            className='login-btn'
            onClick={handleGoLogin}
            plain
            hoverClass='none'
          >
            <Text className='login-text'>登录</Text>
          </Button>
        )
      }

      {/* 个人设置弹窗 */}
      {showSettingsModal && (
        <View className='profile-form-modal'>
          <View className='profile-form-content'>
            <View className='profile-form-header'>
              <Text className='profile-form-title'>个人设置</Text>
              <Text className='profile-form-close' onClick={() => setShowSettingsModal(false)}>✕</Text>
            </View>
            <View className='profile-form-body'>
              <View className='avatar-choose-section'>
                <Text className='form-label'>更换头像</Text>
                <Button
                  className='avatar-choose-btn'
                  openType='chooseAvatar'
                  onChooseAvatar={handleChooseAvatar}
                >
                  <View className='avatar-choose-wrapper'>
                    {tempAvatar ? (
                      <Image src={tempAvatar} className='avatar-preview' mode='aspectFill' />
                    ) : (
                      <View className='avatar-placeholder'>
                        <Text className='avatar-placeholder-text'>点击选择</Text>
                      </View>
                    )}
                  </View>
                </Button>
              </View>

              <View className='nickname-input-section'>
                <Text className='form-label'>修改昵称</Text>
                <Input
                  className='nickname-input'
                  type='nickname'
                  placeholder='请输入昵称'
                  value={tempNickname}
                  onBlur={handleNicknameBlur}
                  onInput={handleNicknameInput}
                />
              </View>
            </View>

            <View className='profile-form-footer'>
              <Button className='form-btn skip-btn' onClick={() => setShowSettingsModal(false)}>取消</Button>
              <Button className='form-btn save-btn' onClick={handleSaveProfile}>保存</Button>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}
