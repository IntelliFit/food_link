import { View, Text, Camera, Image } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useDidShow, useDidHide, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getAccessToken,
  getMyMembership,
  type MembershipStatus,
} from '../../utils/api'
import { withAuth } from '../../utils/withAuth'

import './index.scss'

type CameraAuthStatus = 'pending' | 'authorized' | 'denied'

function RecordPage() {
  // 相机相关状态
  const [cameraAuth, setCameraAuth] = useState<CameraAuthStatus>('pending')
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off')
  const [devicePosition, setDevicePosition] = useState<'front' | 'back'>('back')
  const [isCapturing, setIsCapturing] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [scanning, setScanning] = useState(true)
  
  const cameraContextRef = useRef<Taro.CameraContext | null>(null)

  // 检查相机权限
  const checkCameraAuth = useCallback(async () => {
    try {
      const { authSetting } = await Taro.getSetting()
      if (authSetting['scope.camera']) {
        setCameraAuth('authorized')
      } else {
        setCameraAuth('pending')
        try {
          await Taro.authorize({ scope: 'scope.camera' })
          setCameraAuth('authorized')
        } catch {
          setCameraAuth('denied')
        }
      }
    } catch {
      setCameraAuth('denied')
    }
  }, [])

  useDidShow(() => {
    checkCameraAuth()
    if (getAccessToken()) {
      getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
    }
    setScanning(true)
    Taro.hideTabBar({ animation: true }).catch(() => {})
  })

  useDidHide(() => {
    Taro.showTabBar({ animation: true }).catch(() => {})
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
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }

    if (membershipStatus && membershipStatus.daily_remaining !== null && membershipStatus.daily_remaining <= 0) {
      const isPro = membershipStatus.is_pro
      Taro.showModal({
        title: '今日次数已用完',
        content: isPro
          ? `今日 ${membershipStatus.daily_limit ?? 20} 次拍照已用完，请明日再试。`
          : '免费版每日限10次，开通食探会员可提升至每日20次。',
        confirmText: isPro ? '知道了' : '去开通',
        cancelText: '取消',
        showCancel: !isPro,
        success: (res) => {
          if (!isPro && res.confirm) {
            Taro.navigateTo({ url: '/pages/pro-membership/index' })
          }
        }
      })
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
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }

    if (membershipStatus && membershipStatus.daily_remaining !== null && membershipStatus.daily_remaining <= 0) {
      const isPro = membershipStatus.is_pro
      Taro.showModal({
        title: '今日次数已用完',
        content: isPro
          ? `今日 ${membershipStatus.daily_limit ?? 20} 次拍照已用完，请明日再试。`
          : '免费版每日限10次，开通食探会员可提升至每日20次。',
        confirmText: isPro ? '知道了' : '去开通',
        cancelText: '取消',
        showCancel: !isPro,
        success: (res) => {
          if (!isPro && res.confirm) {
            Taro.navigateTo({ url: '/pages/pro-membership/index' })
          }
        }
      })
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

  // 相机错误处理
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
        }
      }
    })
  }, [])

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

export default withAuth(RecordPage)
