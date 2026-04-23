import { View, Text, Camera, Image, Button } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getAccessToken,
  getMyMembership,
  type MembershipStatus,
} from '../../utils/api'
import { withAuth, redirectToLogin } from '../../utils/withAuth'
import { extraPkgUrl } from '../../utils/subpackage-extra'
import { pickImageAndOpenAnalyze } from '../../utils/weapp-open-analyze-image'

import './index.scss'

type CameraAuthStatus = 'authorized' | 'denied'

/** 与 `Button openType=agreePrivacyAuthorization` 的 id 一致，供 onNeedPrivacyAuthorization 的 resolve 校验 */
const RECORD_CAMERA_PRIVACY_BTN_ID = 'record-camera-privacy-agree'

type PrivacyUiState = 'checking' | 'need' | 'ok'

/**
 * 仅当错误信息明确像「系统/微信拒绝摄像头」时才进拦截页。
 * 隐私未同意走 privacy 门禁；切勿把泛化的 operateCamera:fail 一律当权限（真机常因占用/前后台/组件未就绪等失败）。
 */
function isLikelyCameraAuthDeniedMessage(msg: string): boolean {
  const raw = msg || ''
  const m = raw.toLowerCase()
  if (m.includes('privacy') && (m.includes('not authorized') || m.includes('unauthorized'))) return false
  if (m.includes('auth deny') || m.includes('auth denied')) return true
  if (m.includes('no permission')) return true
  if (raw.includes('用户拒绝') || raw.includes('用户不允许')) return true
  if (raw.includes('不允许使用摄像头')) return true
  if (raw.includes('请在小程序设置中打开') || raw.includes('前往设置')) return true
  if (m.includes('operatecamera') && m.includes('fail')) {
    // 先排除明确的非权限类错误（相机被占用、硬件未就绪、超时等）
    const nonAuthLike =
      m.includes('not available') ||
      m.includes('unavailable') ||
      m.includes('in use') ||
      m.includes('busy') ||
      m.includes('timeout') ||
      m.includes('interrupted') ||
      m.includes('device') ||
      m.includes('hardware')
    if (nonAuthLike) return false
    return (
      m.includes('auth') ||
      m.includes('deny') ||
      m.includes('denied') ||
      m.includes('permission') ||
      m.includes('not authorized') ||
      m.includes('system deny') ||
      raw.includes('未授权') ||
      raw.includes('无权限') ||
      (raw.includes('系统') && raw.includes('拒绝'))
    )
  }
  return false
}

function showFoodAnalysisQuotaModal(ms: MembershipStatus) {
  if (typeof ms.points_balance === 'number') {
    Taro.showModal({
      title: '积分不足',
      content: '标准分析需至少 1 积分，请先充值。',
      confirmText: '去充值',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
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
        Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
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
  const [cameraAuth, setCameraAuth] = useState<CameraAuthStatus>('authorized')
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off')
  const [devicePosition, setDevicePosition] = useState<'front' | 'back'>('back')
  const [isCapturing, setIsCapturing] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [scanning, setScanning] = useState(true)
  /** 变更后强制重挂 <Camera>，配合从设置返回、非权限类偶发错误恢复 */
  const [cameraInstanceKey, setCameraInstanceKey] = useState(0)
  /** 正式版：隐私指引未同意时 Camera 会失败；先门禁再挂载组件 */
  const [privacyUi, setPrivacyUi] = useState<PrivacyUiState>(() =>
    Taro.getEnv() === Taro.ENV_TYPE.WEAPP ? 'checking' : 'ok'
  )
  const privacyResolveRef = useRef<
    ((o: { event: 'exposureAuthorization' | 'agree' | 'disagree'; buttonId?: string }) => void) | null
  >(null)

  const cameraContextRef = useRef<Taro.CameraContext | null>(null)

  useDidShow(() => {
    if (getAccessToken()) {
      getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
    }
    setScanning(true)

    if (Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
      Taro.getPrivacySetting({
        success: (res) => {
          setPrivacyUi(res.needAuthorization ? 'need' : 'ok')
        },
        fail: () => setPrivacyUi('ok')
      })
    } else {
      setPrivacyUi('ok')
    }
  })

  useEffect(() => {
    if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return
    Taro.onNeedPrivacyAuthorization((resolve) => {
      privacyResolveRef.current = resolve
      setPrivacyUi('need')
    })
  }, [])

  useEffect(() => {
    cameraContextRef.current = Taro.createCameraContext()
  }, [cameraInstanceKey])

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
      Taro.navigateTo({ url: extraPkgUrl('/pages/analyze/index') })
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
        Taro.navigateTo({ url: extraPkgUrl('/pages/analyze/index') })
      },
      fail: (err) => {
        if (err.errMsg.indexOf('cancel') > -1) return
        console.error('选择图片失败:', err)
        Taro.showToast({ title: '选择图片失败', icon: 'none' })
      }
    })
  }, [membershipStatus])

  const handleCameraError = useCallback((e: { detail?: { errMsg?: string } }) => {
    console.error('相机错误:', e)
    const msg = String(e?.detail?.errMsg ?? '')
    const low = msg.toLowerCase()
    if (low.includes('privacy') && (low.includes('not authorized') || low.includes('unauthorized'))) {
      setPrivacyUi('need')
      return
    }
    if (isLikelyCameraAuthDeniedMessage(msg)) {
      setCameraAuth('denied')
      return
    }
    Taro.showToast({ title: '相机暂时不可用，请重试', icon: 'none' })
    setCameraInstanceKey((k) => k + 1)
  }, [])

  const handlePrivacyAgreed = useCallback(() => {
    setPrivacyUi('ok')
    const finish = privacyResolveRef.current
    privacyResolveRef.current = null
    if (finish) {
      finish({ event: 'agree', buttonId: RECORD_CAMERA_PRIVACY_BTN_ID })
    }
    setCameraInstanceKey((k) => k + 1)
  }, [])

  const handlePrivacyDecline = useCallback(() => {
    const finish = privacyResolveRef.current
    privacyResolveRef.current = null
    if (finish) finish({ event: 'disagree' })
    void Taro.switchTab({ url: '/pages/index/index' })
  }, [])

  const openSettings = useCallback(() => {
    Taro.openSetting({
      // 仅用 success + getSetting 时，部分机型授权已开但 scope.camera 仍为 false，会永久卡在拦截页
      complete: () => {
        setCameraAuth('authorized')
        setCameraInstanceKey((k) => k + 1)
      }
    })
  }, [])

  if (privacyUi === 'checking' && Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
    return (
      <View className='record-page camera-privacy-checking'>
        <View className='loading-spinner-md' />
      </View>
    )
  }

  if (privacyUi === 'need' && Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
    return (
      <View className='record-page camera-privacy-gate'>
        <View className='privacy-gate-content'>
          <Text className='iconfont icon-xiangji privacy-gate-icon' />
          <Text className='privacy-gate-title'>使用相机前请同意隐私保护指引</Text>
          <Text className='privacy-gate-desc'>
            这与微信设置里「摄像头」开关不是同一项：请先点下方「同意并使用相机」。若仅去系统设置打开摄像头，本页仍可能无法启动相机。
          </Text>
          <Button
            className='privacy-gate-agree-btn'
            id={RECORD_CAMERA_PRIVACY_BTN_ID}
            openType='agreePrivacyAuthorization'
            onAgreePrivacyAuthorization={handlePrivacyAgreed}
          >
            同意并使用相机
          </Button>
          <View
            className='privacy-gate-link'
            onClick={() => {
              Taro.openPrivacyContract({})
            }}
          >
            <Text>查看《用户隐私保护指引》全文</Text>
          </View>
          <View className='privacy-gate-link privacy-gate-link--muted' onClick={handlePrivacyDecline}>
            <Text>暂不使用，返回首页</Text>
          </View>
        </View>
      </View>
    )
  }

  // 权限拒绝页面
  if (cameraAuth === 'denied') {
    return (
      <View className='record-page camera-denied'>
        <View className='denied-content'>
          <Text className='iconfont icon-jiesuo denied-icon' />
          <Text className='denied-title'>需要相机权限</Text>
          <Text className='denied-desc'>
            若小程序设置里摄像头已开仍无法使用，请先返回确认已在相机页完成「隐私保护指引」同意。也可点「改用系统相机」绕过，或直接点击下方「从相册选择」上传图片完成分析。
          </Text>
          <View className='denied-btn' onClick={() => void pickImageAndOpenAnalyze(['camera'])}>
            <Text>改用系统相机</Text>
          </View>
          <View className='denied-btn denied-btn--secondary' onClick={openSettings}>
            <Text>打开权限设置</Text>
          </View>
          <View className='denied-btn denied-btn--tertiary' onClick={() => void pickImageAndOpenAnalyze(['album'])}>
            <Text className='iconfont icon-picture' />
            <Text>从相册选择</Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View className='record-page camera-mode'>
      {/* 全屏相机 */}
      <Camera
        key={cameraInstanceKey}
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
