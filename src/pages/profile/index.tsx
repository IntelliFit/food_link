import { View, Text, Image, Button, Input } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { Cell } from '@taroify/core'
import '@taroify/core/cell/style'
import {
  TodoListOutlined,
  NotesOutlined,
  ChartTrendingOutlined,
  LocationOutlined,
  SettingOutlined,
  Bell,
  ShieldOutlined,
  CommentOutlined,
  InfoOutlined,
  StarOutlined
} from '@taroify/icons'
import '@taroify/icons/style'
import { 
  login, 
  LoginResponse, 
  getUserProfile, 
  updateUserInfo, 
  getAccessToken,
  clearAllStorage,
  uploadUserAvatar,
  imageToBase64,
  getUserRecordDays
} from '../../utils/api'

import './index.scss'

interface UserInfo {
  avatar: string
  name: string
  meta: string
}

export default function ProfilePage() {
  // 登录状态
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  
  // 是否显示头像昵称填写界面
  const [showProfileForm, setShowProfileForm] = useState(false)
  
  // 是否显示设置弹窗
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  
  // 临时头像和昵称（用于填写表单）
  const [tempAvatar, setTempAvatar] = useState('')
  const [tempNickname, setTempNickname] = useState('')
  
  // 用户信息
  const [userInfo, setUserInfo] = useState<UserInfo>({
    avatar: '👤',
    name: '用户昵称',
    meta: '已记录 0 天'
  })

  // 是否已完成健康档案引导（首次问卷）
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean>(true)
  
  // 记录天数
  const [recordDays, setRecordDays] = useState(0)

  // 从本地存储读取登录状态，并从服务器获取用户信息
  useEffect(() => {
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
              avatar: apiUserInfo.avatar || '👤',
              name: apiUserInfo.nickname || '用户昵称',
              meta: `已记录 ${days} 天`
            })
            setOnboardingCompleted(apiUserInfo.onboarding_completed ?? true)
          } catch (error) {
            console.error('获取用户信息失败:', error)
            // 如果获取失败，尝试从本地存储读取
            const storedUserInfo = Taro.getStorageSync('userInfo')
            if (storedUserInfo) {
              setUserInfo(storedUserInfo)
            }
          }
        } else {
          // 没有 token，检查是否有旧的登录状态
          const loginStatus = Taro.getStorageSync('isLoggedIn')
          const storedUserInfo = Taro.getStorageSync('userInfo')
          if (loginStatus === true && storedUserInfo) {
            setIsLoggedIn(true)
            setUserInfo(storedUserInfo)
          }
        }
      } catch (error) {
        console.error('读取登录状态失败:', error)
      }
    }
    
    loadUserInfo()
  }, [])

  // 我的服务
  const services = [
    {
      id: 0,
      icon: <TodoListOutlined size="20" />,
      title: '健康档案',
      desc: '生理指标、BMR/TDEE、病史与饮食偏好'
    },
    {
      id: 1,
      icon: <NotesOutlined size="20" />,
      title: '我的食谱',
      desc: '常吃的食物组合，一键记录',
      path: '/pages/recipes/index'
    },
    {
      id: 3,
      icon: <ChartTrendingOutlined size="20" />,
      title: '数据统计',
      desc: '查看详细的饮食和运动数据'
    },
    {
      id: 5,
      icon: <LocationOutlined size="20" />,
      title: '附近美食',
      desc: '发现附近健康美食推荐'
    }
  ]

  // 贡献值数据
  const [contribution] = useState({
    value: 1280,
    stats: {
      posts: 45,
      likes: 320,
      shares: 89
    }
  })

  // 设置项
  const settings = [
    { id: 1, icon: <SettingOutlined size="20" />, title: '账号设置' },
    { id: 2, icon: <Bell size="20" />, title: '消息通知' },
    { id: 3, icon: <ShieldOutlined size="20" />, title: '隐私设置' },
    { id: 4, icon: <CommentOutlined size="20" />, title: '意见反馈' },
    { id: 5, icon: <InfoOutlined size="20" />, title: '关于我们' }
  ]

  const handleServiceClick = (service: typeof services[0]) => {
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
    // 数据统计
    if (service.id === 3) {
      Taro.navigateTo({ url: '/pages/stats/index' })
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

  const handleSettingClick = (setting: typeof settings[0]) => {
    Taro.showToast({
      title: `打开${setting.title}`,
      icon: 'none'
    })
  }

  // 处理获取手机号（同时获取登录 code 和手机号 code）
  const handleGetPhoneNumber = async (e: any) => {
    console.log('========== handleGetPhoneNumber 被调用 ==========')
    console.log('完整事件对象:', JSON.stringify(e, null, 2))
    console.log('e.detail:', e.detail)
    
    // 检查事件详情
    if (!e || !e.detail) {
      console.error('getPhoneNumber 事件数据异常:', e)
      Taro.showToast({
        title: '获取手机号失败',
        icon: 'none'
      })
      return
    }

    console.log('errMsg:', e.detail.errMsg)
    console.log('errno:', e.detail.errno)
    console.log('code:', e.detail.code)
    console.log('==========================================')

    Taro.showLoading({
      title: '登录中...',
      mask: true
    })

    try {
      // 检查是否获取到手机号 code
      if (e.detail.errMsg !== 'getPhoneNumber:ok') {
        Taro.hideLoading()
        console.warn('获取手机号失败:', e.detail.errMsg, e.detail.errno)
        
        // 根据不同的错误类型给出不同的提示
        if (e.detail.errno === 1400001) {
          Taro.showToast({
            title: '该功能使用次数已达上限',
            icon: 'none',
            duration: 2000
          })
        } else if (e.detail.errMsg === 'getPhoneNumber:fail no permission') {
          // 没有权限或用户拒绝授权
          console.log('显示获取手机号失败提示弹窗')
          Taro.showModal({
            title: '获取手机号失败',
            content: '无法获取手机号（可能是小程序未开启"获取手机号"权限，或用户拒绝授权）。是否继续使用微信登录？',
            confirmText: '继续登录',
            cancelText: '取消',
            success: async (res) => {
              console.log('用户选择:', res.confirm ? '继续登录' : '取消')
              if (res.confirm) {
                // 用户选择继续登录
                Taro.showLoading({
                  title: '登录中...',
                  mask: true
                })
                try {
                  await handleLoginOnly()
                } catch (error) {
                  console.error('登录失败:', error)
                  Taro.hideLoading()
                  Taro.showToast({
                    title: '登录失败，请重试',
                    icon: 'none'
                  })
                }
              } else {
                console.log('用户取消了登录')
              }
            },
            fail: (err) => {
              console.error('showModal 失败:', err)
              // 如果弹窗失败，直接继续登录流程
              Taro.showLoading({
                title: '登录中...',
                mask: true
              })
              handleLoginOnly().catch((error) => {
                console.error('登录失败:', error)
                Taro.hideLoading()
              })
            }
          })
          return
        } else {
          Taro.showToast({
            title: '获取手机号失败，将仅进行登录',
            icon: 'none',
            duration: 2000
          })
        }
        // 即使获取手机号失败，也继续登录流程
        await handleLoginOnly()
        return
      }

      const phoneCode = e.detail.code
      console.log('获取到的 phoneCode:', phoneCode)

      // 1. 获取微信登录凭证 code
      const loginRes = await Taro.login()
      
      if (!loginRes.code) {
        throw new Error('获取登录凭证失败')
      }

      console.log('获取到的登录 code:', loginRes.code)

      // 2. 调用后端登录接口，同时传递登录 code 和手机号 code
      const loginData: LoginResponse = await login(loginRes.code, phoneCode)

      // 3. 打印登录结果到控制台
      console.log('登录成功，返回数据:', loginData)
      console.log('openid:', loginData.openid)
      console.log('user_id:', loginData.user_id)
      if (loginData.unionid) {
        console.log('unionid:', loginData.unionid)
      }
      if (loginData.phoneNumber) {
        console.log('手机号（含区号）:', loginData.phoneNumber)
      }
      if (loginData.purePhoneNumber) {
        console.log('手机号（不含区号）:', loginData.purePhoneNumber)
      }
      if (loginData.countryCode) {
        console.log('国家区号:', loginData.countryCode)
      }

      // 4. token 已由 login 函数自动保存
      // 保存其他信息
      Taro.setStorageSync('openid', loginData.openid)
      if (loginData.unionid) {
        Taro.setStorageSync('unionid', loginData.unionid)
      }
      if (loginData.purePhoneNumber) {
        Taro.setStorageSync('phoneNumber', loginData.purePhoneNumber)
      }

      // 5. 从服务器获取用户信息
      try {
        const apiUserInfo = await getUserProfile()
        const newUserInfo: UserInfo = {
          avatar: apiUserInfo.avatar || '👤',
          name: apiUserInfo.nickname || '用户昵称',
          meta: '已记录 30 天'
        }
        setIsLoggedIn(true)
        setUserInfo(newUserInfo)
        setOnboardingCompleted(apiUserInfo.onboarding_completed ?? true)
        Taro.setStorageSync('userInfo', newUserInfo)
        Taro.hideLoading()
        Taro.showToast({
          title: '登录成功',
          icon: 'success'
        })
        
        // 如果没有昵称或头像，显示完善信息界面
        if (!apiUserInfo.nickname || !apiUserInfo.avatar || apiUserInfo.avatar === '') {
          setShowProfileForm(true)
        }
      } catch (error) {
        console.error('获取用户信息失败:', error)
        // 即使获取失败，也标记为已登录
        setIsLoggedIn(true)
        setShowProfileForm(true)
        Taro.hideLoading()
      }
    } catch (error: any) {
      console.error('登录失败:', error)
      Taro.hideLoading()
      Taro.showToast({
        title: error.message || '登录失败',
        icon: 'none',
        duration: 2000
      })
    }
  }

  // 仅登录（不获取手机号）
  const handleLoginOnly = async () => {
    Taro.showLoading({
      title: '登录中...',
      mask: true
    })

    try {
      // 1. 获取微信登录凭证 code
      const loginRes = await Taro.login()
      
      if (!loginRes.code) {
        throw new Error('获取登录凭证失败')
      }

      console.log('获取到的登录 code:', loginRes.code)

      // 2. 调用后端登录接口（不传递手机号 code）
      const loginData: LoginResponse = await login(loginRes.code)

      // 3. 打印登录结果到控制台
      console.log('登录成功，返回数据:', loginData)
      console.log('openid:', loginData.openid)
      console.log('user_id:', loginData.user_id)
      if (loginData.unionid) {
        console.log('unionid:', loginData.unionid)
      }

      // 4. token 已由 login 函数自动保存
      // 保存其他信息
      Taro.setStorageSync('openid', loginData.openid)
      if (loginData.unionid) {
        Taro.setStorageSync('unionid', loginData.unionid)
      }
      
      // 5. 从服务器获取用户信息
      try {
        const apiUserInfo = await getUserProfile()
        const newUserInfo: UserInfo = {
          avatar: apiUserInfo.avatar || '👤',
          name: apiUserInfo.nickname || '用户昵称',
          meta: '已记录 30 天'
        }
        setIsLoggedIn(true)
        setUserInfo(newUserInfo)
        setOnboardingCompleted(apiUserInfo.onboarding_completed ?? true)
        Taro.setStorageSync('userInfo', newUserInfo)
        Taro.hideLoading()
        Taro.showToast({
          title: '登录成功',
          icon: 'success'
        })
        
        // 如果没有昵称或头像，显示完善信息界面
        if (!apiUserInfo.nickname || !apiUserInfo.avatar || apiUserInfo.avatar === '') {
          setShowProfileForm(true)
        }
      } catch (error) {
        console.error('获取用户信息失败:', error)
        setIsLoggedIn(true)
        setShowProfileForm(true)
        Taro.hideLoading()
      }

      // 5. 检查是否已有用户信息
      const storedUserInfo = Taro.getStorageSync('userInfo')
      if (storedUserInfo && storedUserInfo.avatar && storedUserInfo.avatar !== '👤' && storedUserInfo.name && storedUserInfo.name !== '用户昵称') {
        // 已有完整用户信息，直接使用
        setIsLoggedIn(true)
        setUserInfo(storedUserInfo)
        Taro.hideLoading()
        Taro.showToast({
          title: '登录成功',
          icon: 'success'
        })
      } else {
        // 没有完整用户信息，显示填写界面
        setIsLoggedIn(true)
        setShowProfileForm(true)
        Taro.hideLoading()
      }
    } catch (error: any) {
      console.error('登录失败:', error)
      Taro.hideLoading()
      Taro.showToast({
        title: error.message || '登录失败',
        icon: 'none',
        duration: 2000
      })
    }
  }

  // 处理头像选择
  const handleChooseAvatar = async (e: any) => {
    const { avatarUrl } = e.detail
    console.log('选择的头像:', avatarUrl)
    
    // 判断是否需要上传：非 https 开头的都是临时路径，需要上传
    // 兼容不同环境的临时路径格式：
    // - 开发者工具: http://tmp/xxx
    // - 真机 iOS: wxfile://tmp_xxx
    // - 真机 Android: wxfile://xxx 或其他格式
    const needUpload = avatarUrl && !avatarUrl.startsWith('https://')
    
    if (needUpload) {
      Taro.showLoading({
        title: '上传中...',
        mask: true
      })
      
      try {
        // 转换为 base64
        const base64Image = await imageToBase64(avatarUrl)
        
        // 上传到 Supabase
        const { imageUrl } = await uploadUserAvatar(base64Image)
        
        console.log('头像已上传到 Supabase:', imageUrl)
        setTempAvatar(imageUrl)
        
        Taro.hideLoading()
        Taro.showToast({
          title: '头像已选择',
          icon: 'success'
        })
      } catch (error: any) {
        console.error('上传头像失败:', error)
        Taro.hideLoading()
        Taro.showToast({
          title: error.message || '上传失败',
          icon: 'none',
          duration: 2000
        })
      }
    } else if (avatarUrl) {
      // 已经是 https URL，直接使用
      setTempAvatar(avatarUrl)
    }
  }

  // 处理昵称输入
  const handleNicknameInput = (e: any) => {
    const nickname = e.detail.value
    console.log('输入的昵称:', nickname)
    setTempNickname(nickname)
  }

  // 处理昵称失焦（安全检测）
  const handleNicknameBlur = (e: any) => {
    const nickname = e.detail.value
    console.log('昵称失焦，最终值:', nickname)
    setTempNickname(nickname)
  }

  // 保存用户信息
  const handleSaveProfile = async () => {
    // 校验：如果从设置弹窗进入，检查是否提交了空信息
    if (showSettingsModal) {
      // 检查头像是否为空（空字符串或仅包含 emoji）
      const isAvatarEmpty = !tempAvatar || tempAvatar.trim() === '' || tempAvatar === '👤'
      // 检查昵称是否为空
      const isNicknameEmpty = !tempNickname || tempNickname.trim() === ''
      
      if (isAvatarEmpty && isNicknameEmpty) {
        Taro.showToast({
          title: '请至少设置头像或昵称',
          icon: 'none',
          duration: 2000
        })
        return
      }
      
      // 如果昵称为空但有头像，或头像为空但有昵称，也需要提示
      if (isNicknameEmpty && !isAvatarEmpty) {
        Taro.showModal({
          title: '提示',
          content: '您还未设置昵称，确定只保存头像吗？',
          confirmText: '确定保存',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              performSave()
            }
          }
        })
        return
      }
      
      if (isAvatarEmpty && !isNicknameEmpty) {
        Taro.showModal({
          title: '提示',
          content: '您还未设置头像，确定只保存昵称吗？',
          confirmText: '确定保存',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              performSave()
            }
          }
        })
        return
      }
    } else {
      // 首次填写时的校验
      if (!tempAvatar && !tempNickname) {
        Taro.showToast({
          title: '请至少填写一项信息',
          icon: 'none',
          duration: 2000
        })
        return
      }
    }

    // 显示保存确认弹窗
    Taro.showModal({
      title: '确认保存',
      content: '确定要保存修改的信息吗？',
      confirmText: '保存',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          performSave()
        }
      }
    })
  }

  // 执行保存操作
  const performSave = async () => {
    Taro.showLoading({
      title: '保存中...',
      mask: true
    })

    try {
      // 构建更新数据
      const updateData: any = {}
      const changesList: string[] = []
      
      if (tempNickname && tempNickname !== userInfo.name) {
        updateData.nickname = tempNickname
        changesList.push('昵称')
      }
      if (tempAvatar && tempAvatar !== userInfo.avatar) {
        updateData.avatar = tempAvatar
        changesList.push('头像')
      }

      // 如果没有需要更新的内容，也显示保存成功
      if (Object.keys(updateData).length === 0) {
        Taro.hideLoading()
        Taro.showToast({
          title: '保存成功',
          icon: 'success',
          duration: 2000
        })
        setShowProfileForm(false)
        setShowSettingsModal(false)
        return
      }

      // 调用后端接口更新用户信息
      const updatedUser = await updateUserInfo(updateData)

      // 更新本地状态
      const newUserInfo: UserInfo = {
        avatar: updatedUser.avatar || userInfo.avatar,
        name: updatedUser.nickname || userInfo.name,
        meta: `已记录 ${recordDays} 天`
      }

      Taro.setStorageSync('userInfo', newUserInfo)
      setUserInfo(newUserInfo)
      setShowProfileForm(false)
      setShowSettingsModal(false)
      setTempAvatar('')
      setTempNickname('')

      Taro.hideLoading()
      
      // 根据修改内容给出具体提示
      const message = changesList.length > 0 
        ? `${changesList.join('和')}已更新` 
        : '保存成功'
      
      Taro.showToast({
        title: message,
        icon: 'success',
        duration: 2000
      })
    } catch (error: any) {
      console.error('保存用户信息失败:', error)
      Taro.hideLoading()
      Taro.showToast({
        title: error.message || '保存失败，请重试',
        icon: 'none',
        duration: 2500
      })
    }
  }

  // 跳过填写
  const handleSkipProfile = () => {
    const defaultUserInfo: UserInfo = {
      avatar: '👤',
      name: `用户${Taro.getStorageSync('openid')?.slice(-6) || '000000'}`,
      meta: '已记录 0 天'
    }

    Taro.setStorageSync('isLoggedIn', true)
    Taro.setStorageSync('userInfo', defaultUserInfo)

    setUserInfo(defaultUserInfo)
    setShowProfileForm(false)
  }

  // 处理退出登录
  const handleLogout = () => {
    Taro.showModal({
      title: '提示',
      content: '确定要退出登录吗？退出后将清除所有本地数据。',
      success: (res) => {
        if (res.confirm) {
          try {
            // 清除所有本地存储数据
            clearAllStorage()
            
            // 重置登录状态
            setIsLoggedIn(false)
            setShowProfileForm(false)
            
            // 重置为默认用户信息
            setUserInfo({
              avatar: '👤',
              name: '用户昵称',
              meta: '已记录 0 天'
            })
            
            Taro.showToast({
              title: '已退出登录',
              icon: 'success',
              duration: 2000
            })
          } catch (error) {
            console.error('退出登录失败:', error)
            Taro.showToast({
              title: '退出失败，请重试',
              icon: 'none',
              duration: 2000
            })
          }
        }
      }
    })
  }

  const handleSettings = () => {
    if (!isLoggedIn) {
      Taro.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }
    setShowSettingsModal(true)
    // 初始化设置弹窗的临时数据
    setTempAvatar(userInfo.avatar)
    setTempNickname(userInfo.name)
  }

  return (
    <View className='profile-page'>
      {/* 顶部渐变区域 */}
      <View className='header-section'>
        {/* 用户信息头部 */}
        <View className='user-info-header'>
          <View className='user-avatar-wrapper'>
            {userInfo.avatar && userInfo.avatar.startsWith('http') ? (
              <Image 
                src={userInfo.avatar} 
                mode='aspectFill'
                className='user-avatar-image'
              />
            ) : (
              <Text className='user-avatar'>{userInfo.avatar}</Text>
            )}
          </View>
          <View className='user-details'>
            {isLoggedIn ? (
              <>
                <Text className='user-name'>{userInfo.name}</Text>
                <Text className='user-meta'>{userInfo.meta}</Text>
              </>
            ) : (
              <Button
                className='login-link-button'
                openType='getPhoneNumber'
                onGetPhoneNumber={handleGetPhoneNumber}
                plain
                hoverClass='none'
              >
                点击登录
              </Button>
            )}
          </View>
          <View className='settings-btn' onClick={handleSettings}>
            <SettingOutlined size="20" color="#6b7280" />
          </View>
        </View>
      </View>

      {/* 未完成健康档案时显示引导 */}
      {isLoggedIn && !onboardingCompleted && (
        <View
          className='onboarding-banner'
          onClick={() => Taro.navigateTo({ url: '/pages/health-profile/index' })}
        >
          <Text className='onboarding-banner-text'>📋 完善健康档案，获取个性化饮食建议</Text>
          <Text className='onboarding-banner-arrow'>{'>'}</Text>
        </View>
      )}

      {/* 我的服务 */}
      <View className='services-section'>
        <Cell.Group>
          {services.map((service) => (
            <Cell
              key={service.id}
              title={service.title}
              brief={service.desc}
              icon={service.icon}
              isLink
              onClick={() => handleServiceClick(service)}
            />
          ))}
        </Cell.Group>
      </View>

      {/* 我的贡献值 */}
      <View className='contribution-card'>
        <View className='contribution-header'>
          <View className='contribution-title-section'>
            <View className='contribution-icon'>
              <StarOutlined size="44" color="#fff" />
            </View>
            <Text className='contribution-title'>我的贡献值</Text>
          </View>
          <Text className='contribution-value'>{contribution.value}</Text>
        </View>
        <View className='contribution-stats'>
          <View className='contribution-stat-item'>
            <Text className='contribution-stat-label'>发布</Text>
            <Text className='contribution-stat-value'>{contribution.stats.posts}</Text>
          </View>
          <View className='contribution-stat-item'>
            <Text className='contribution-stat-label'>获赞</Text>
            <Text className='contribution-stat-value'>{contribution.stats.likes}</Text>
          </View>
          <View className='contribution-stat-item'>
            <Text className='contribution-stat-label'>分享</Text>
            <Text className='contribution-stat-value'>{contribution.stats.shares}</Text>
          </View>
        </View>
        <Text className='contribution-thanks'>感谢您为社区做出的贡献！</Text>
      </View>

      {/* 设置 */}
      <View className='settings-section'>
        <Text className='section-title'>设置</Text>
        <Cell.Group>
          {settings.map((setting) => (
            <Cell
              key={setting.id}
              title={setting.title}
              icon={setting.icon}
              isLink
              onClick={() => handleSettingClick(setting)}
            />
          ))}
        </Cell.Group>
      </View>

      {/* 登录/退出登录按钮 */}
      {isLoggedIn ? (
        <View className='logout-btn' onClick={handleLogout}>
          <Text className='logout-icon'>🚪</Text>
          <Text className='logout-text'>退出登录</Text>
        </View>
      ) : (
        <Button
          className='login-btn'
          openType='getPhoneNumber'
          onGetPhoneNumber={handleGetPhoneNumber}
          plain
          hoverClass='none'
        >
          <Text className='login-icon'>🔑</Text>
          <Text className='login-text'>登录</Text>
        </Button>
      )}

      {/* 头像昵称填写弹窗 */}
      {showProfileForm && (
        <View className='profile-form-modal'>
          <View className='profile-form-content'>
            <View className='profile-form-header'>
              <Text className='profile-form-title'>完善个人信息</Text>
            </View>
            
            <View className='profile-form-body'>
              {/* 头像选择 */}
              <View className='avatar-choose-section'>
                <Text className='form-label'>选择头像</Text>
                <Button
                  className='avatar-choose-btn'
                  openType='chooseAvatar'
                  onChooseAvatar={handleChooseAvatar}
                >
                  <View className='avatar-choose-wrapper'>
                    {tempAvatar ? (
                      <Image 
                        src={tempAvatar} 
                        mode='aspectFill'
                        className='avatar-preview'
                      />
                    ) : (
                      <View className='avatar-placeholder'>
                        <Text className='avatar-placeholder-icon'>📷</Text>
                        <Text className='avatar-placeholder-text'>点击选择头像</Text>
                      </View>
                    )}
                  </View>
                </Button>
              </View>

              {/* 昵称输入 */}
              <View className='nickname-input-section'>
                <Text className='form-label'>输入昵称</Text>
                <Input
                  className='nickname-input'
                  type='nickname'
                  placeholder='请输入昵称'
                  value={tempNickname}
                  onInput={handleNicknameInput}
                  onBlur={handleNicknameBlur}
                />
              </View>
            </View>

            <View className='profile-form-footer'>
              <Button 
                className='form-btn skip-btn'
                onClick={handleSkipProfile}
              >
                跳过
              </Button>
              <Button 
                className='form-btn save-btn'
                onClick={handleSaveProfile}
              >
                保存
              </Button>
            </View>
          </View>
        </View>
      )}

      {/* 设置弹窗 */}
      {showSettingsModal && (
        <View className='profile-form-modal'>
          <View className='profile-form-content'>
            <View className='profile-form-header'>
              <Text className='profile-form-title'>个人设置</Text>
              <Text 
                className='profile-form-close'
                onClick={() => setShowSettingsModal(false)}
              >
                ✕
              </Text>
            </View>
            
            <View className='profile-form-body'>
              {/* 头像选择 */}
              <View className='avatar-choose-section'>
                <Text className='form-label'>更换头像</Text>
                <Button
                  className='avatar-choose-btn'
                  openType='chooseAvatar'
                  onChooseAvatar={handleChooseAvatar}
                >
                  <View className='avatar-choose-wrapper'>
                    {tempAvatar && tempAvatar.startsWith('http') ? (
                      <Image 
                        src={tempAvatar} 
                        mode='aspectFill'
                        className='avatar-preview'
                      />
                    ) : (
                      <View className='avatar-placeholder'>
                        <Text className='avatar-placeholder-icon'>{tempAvatar || '📷'}</Text>
                        <Text className='avatar-placeholder-text'>点击选择头像</Text>
                      </View>
                    )}
                  </View>
                </Button>
                <Text className='form-hint'>支持选择微信头像或相册图片</Text>
              </View>

              {/* 昵称输入 */}
              <View className='nickname-input-section'>
                <Text className='form-label'>修改昵称</Text>
                <Input
                  className='nickname-input'
                  type='nickname'
                  placeholder='请输入昵称'
                  value={tempNickname}
                  onInput={handleNicknameInput}
                  onBlur={handleNicknameBlur}
                />
              </View>
            </View>

            <View className='profile-form-footer'>
              <Button 
                className='form-btn skip-btn'
                onClick={() => setShowSettingsModal(false)}
              >
                取消
              </Button>
              <Button 
                className='form-btn save-btn'
                onClick={handleSaveProfile}
              >
                保存
              </Button>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}


