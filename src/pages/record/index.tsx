import { View, Text, Camera, Image } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getAccessToken,
  getMyMembership,
  type MembershipStatus,
} from '../../utils/api'
import { withAuth, redirectToLogin } from '../../utils/withAuth'

import './index.scss'

type CameraAuthStatus = 'pending' | 'authorized' | 'denied'

function showFoodAnalysisQuotaModal(ms: MembershipStatus) {
  if (typeof ms.points_balance === 'number') {
    Taro.showModal({
      title: '积分不足',
      content: '标准分析需至少 1 积分，请先充值。',
      confirmText: '去充值',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) Taro.navigateTo({ url: '/pages/pro-membership/index' })
      }
    })
    return
  }
  const isPro = ms.is_pro
  Taro.showModal({
    title: '今日次数已用完',
    content: isPro
      ? `今日 ${ms.daily_limit ?? 30} 次拍照已用完，请明日再试。`
      : `免费版每日限 ${ms.daily_limit ?? 30} 次，开通食探会员可享更高额度与精准模式等功能。`,
    confirmText: isPro ? '知道了' : '去开通',
    cancelText: '取消',
    showCancel: !isPro,
    success: (res) => {
      if (!isPro && res.confirm) {
        Taro.navigateTo({ url: '/pages/pro-membership/index' })
      }
    }
  })
}

function isFoodAnalysisBlocked(ms: MembershipStatus | null): boolean {
  if (!ms) return false
  if (typeof ms.points_balance === 'number') {
    return ms.points_balance < 1
  }
  return ms.daily_remaining !== null && ms.daily_remaining <= 0
}

function RecordPage() {
  // 相机相关状态
  const [cameraAuth, setCameraAuth] = useState<CameraAuthStatus>('pending')
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off')
  const [devicePosition, setDevicePosition] = useState<'front' | 'back'>('back')
  const [isCapturing, setIsCapturing] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [scanning, setScanning] = useState(true)
  
  const cameraContextRef = useRef<Taro.CameraContext | null>(null)

  /**
   * 相机权限：仅当用户在小程序内「明确拒绝过」camera（authSetting 为 false）时拦截。
   * 不再主动调用 wx.authorize(scope.camera)：该接口易在未真正拒绝时失败，导致一进页就误判为需去设置。
   * 首次或未授权时由 <Camera> 拉起系统授权；用户拒绝时由 onError 处理。
   */
  const checkCameraAuth = useCallback(async () => {
    try {
      const { authSetting } = await Taro.getSetting()
      if (authSetting['scope.camera'] === false) {
        setCameraAuth('denied')
      } else {
        setCameraAuth('authorized')
      }
    } catch {
      setCameraAuth('authorized')
    }
  }, [])

  useDidShow(() => {
    checkCameraAuth()
    if (getAccessToken()) {
      getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
    }
    setScanning(true)
    // 自定义 tabBar 时勿调用 hideTabBar/showTabBar，否则会与原生 tabBar 叠成双导航栏；见 custom-tab-bar/updateHidden
  })

  useEffect(() => {
    cameraContextRef.current = Taro.createCameraContext()
  }, [])

  useShareAppMessage(() => ({
    title: '食探 - 记录每一餐，健康看得见',
    path: '/pages/record/index'
  }))

  useShareTimeline(() => ({
    title: '食探 - 记录每一餐，健康看得见'
  }))

  useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      // @ts-ignore
      menus: ['shareAppMessage', 'shareTimeline']
    })
  }, [])

  // 拍照处理
  const handleTakePhoto = useCallback(async () => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    if (membershipStatus && isFoodAnalysisBlocked(membershipStatus)) {
      showFoodAnalysisQuotaModal(membershipStatus)
      return
    }

    if (isCapturing || !cameraContextRef.current) return

    setIsCapturing(true)
    Taro.vibrateShort({ type: 'light' }).catch(() => {})

    try {
      const { tempImagePath } = await cameraContextRef.current.takePhoto({
        quality: 'high'
      })
      
      Taro.setStorageSync('analyzeImagePath', tempImagePath)
      Taro.navigateTo({ url: '/pages/analyze/index' })
    } catch (err) {
      console.error('拍照失败:', err)
      Taro.showToast({ title: '拍照失败', icon: 'none' })
    } finally {
      setIsCapturing(false)
    }
  }, [isCapturing, membershipStatus])

  // 返回上一页
  const handleGoBack = useCallback(() => {
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.switchTab({ url: '/pages/index/index' })
    })
  }, [])

  // 从相册选择
  const handleChooseFromAlbum = useCallback(() => {
    if (!getAccessToken()) {
      redirectToLogin()
      return
    }

    if (membershipStatus && isFoodAnalysisBlocked(membershipStatus)) {
      showFoodAnalysisQuotaModal(membershipStatus)
      return
    }

    Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (res) => {
        const imagePath = res.tempFilePaths[0]
        Taro.setStorageSync('analyzeImagePath', imagePath)
        Taro.navigateTo({ url: '/pages/analyze/index' })
      },
      fail: (err) => {
        if (err.errMsg.indexOf('cancel') > -1) return
        console.error('选择图片失败:', err)
        Taro.showToast({ title: '选择图片失败', icon: 'none' })
      }
    })
  }, [membershipStatus])

  // 官方文档：binderror 在用户不允许使用摄像头时触发
  const handleCameraError = useCallback((e: any) => {
    console.error('相机错误:', e)
    setCameraAuth('denied')
  }, [])

  // 打开设置页
  const openSettings = useCallback(() => {
    Taro.openSetting({
      success: (res) => {
        if (res.authSetting['scope.camera']) {
          setCameraAuth('authorized')
        } else {
          void checkCameraAuth()
        }
      }
    })
  }, [checkCameraAuth])

  // 权限拒绝页面
  if (cameraAuth === 'denied') {
    return (
      <View className='record-page camera-denied'>
        <View className='denied-content'>
          <Text className='iconfont icon-jiesuo denied-icon' />
          <Text className='denied-title'>需要相机权限</Text>
          <Text className='denied-desc'>请在设置中开启相机权限，以便拍照识别食物</Text>
          <View className='denied-btn' onClick={openSettings}>
            <Text>去设置</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View className='record-page camera-mode'>
      {/* 全屏相机 */}
      <Camera
        className='camera-fullscreen'
        devicePosition={devicePosition}
        flash={flashMode}
        resolution='high'
        frameSize='large'
        onError={handleCameraError}
      />

      {/* 顶部控制栏：仅保留返回 */}
      <View className='top-control-bar'>
        <View className='top-btn back-btn' onClick={handleGoBack}>
          <Text className='back-arrow'>&#8249;</Text>
        </View>
      </View>

      {/* 中间扫描框区域 */}
      <View className='scanner-container'>
        <View className='scanner-frame'>
          {/* 四角圆弧形括号 - 主题色绿色 */}
          <View className='corner corner-tl' />
          <View className='corner corner-tr' />
          <View className='corner corner-bl' />
          <View className='corner corner-br' />
          
          {/* 扫描线动画 - 绿色 */}
          {scanning && <View className='scan-line' />}
        </View>
      </View>

      {/* 底部控制区域 */}
      <View className='bottom-controls'>
        {/* 相册按钮 - 左侧 */}
        <View className='side-btn placeholder'>
        </View>

        {/* 拍照按钮 */}
        <View className={`capture-btn-wrapper ${isCapturing ? 'capturing' : ''}`} onClick={handleTakePhoto}>
          <View className='capture-btn-outer'>
            <View className='capture-btn-inner'>
              <Text className='iconfont icon-xiangji capture-icon' />
            </View>
          </View>
        </View>

        {/* 相册按钮 - 右侧 */}
        <View className='album-btn' onClick={handleChooseFromAlbum}>
          <Image
            className='album-icon-img'
            src='data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik04NTMuMzMzMzMzIDk2YzQwLjUzMzMzMyAwIDc0LjY2NjY2NyAzNC4xMzMzMzMgNzQuNjY2NjY3IDc0LjY2NjY2N3Y2ODIuNjY2NjY2YzAgNDAuNTMzMzMzLTM0LjEzMzMzMyA3NC42NjY2NjctNzQuNjY2NjY3IDc0LjY2NjY2N0gxNzAuNjY2NjY3Yy00MC41MzMzMzMgMC03NC42NjY2NjctMzQuMTMzMzMzLTc0LjY2NjY2Ny03NC42NjY2NjdWMTcwLjY2NjY2N2MwLTQwLjUzMzMzMyAzNC4xMzMzMzMtNzQuNjY2NjY3IDc0LjY2NjY2Ny03NC42NjY2NjdoNjgyLjY2NjY2NnpNNzQ2LjY2NjY2NyA0NjkuMzMzMzMzYy0xMC42NjY2NjctMTIuOC0zMi0xNC45MzMzMzMtNDQuOC0yLjEzMzMzM0wzMjAgODA4LjUzMzMzM2wtMi4xMzMzMzMgMi4xMzMzMzRjLTE5LjIgMTkuMi00LjI2NjY2NyA1My4zMzMzMzMgMjMuNDY2NjY2IDUzLjMzMzMzM2g0OTIuOGMxNy4wNjY2NjctMi4xMzMzMzMgMjkuODY2NjY3LTE0LjkzMzMzMyAyOS44NjY2NjctMzJ2LTE5Ni4yNjY2NjdjMC02LjQtMi4xMzMzMzMtMTAuNjY2NjY3LTYuNC0xNC45MzMzMzNsLTEwOC44LTE0OS4zMzMzMzMtMi4xMzMzMzMtMi4xMzMzMzR6IG0tMzk0LjY2NjY2Ny0yMDIuNjY2NjY2Yy00Ni45MzMzMzMgMC04NS4zMzMzMzMgMzguNC04NS4zMzMzMzMgODUuMzMzMzMzczM4LjQgODUuMzMzMzMzIDg1LjMzMzMzMyA4NS4zMzMzMzMgODUuMzMzMzMzLTM4LjQgODUuMzMzMzMzLTg1LjMzMzMzMy0zOC40LTg1LjMzMzMzMy04NS4zMzMzMzMtODUuMzMzMzMzeiIgZmlsbD0iI2ZmZmZmZiI+PC9wYXRoPjwvc3ZnPg=='
            mode='aspectFit'
          />
        </View>
      </View>
    </View>
  )
}

export default withAuth(RecordPage, { public: true })
