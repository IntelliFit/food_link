import { Camera, Canvas, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useMemo, useRef, useState } from 'react'

import CreditShortageSheet from '../../../components/CreditShortageSheet'
import { IconAlbum } from '../../../components/iconfont'
import { getAccessToken, getMyMembership, type MembershipStatus } from '../../../utils/api'
import { readCustomNavMetrics } from '../../../utils/custom-nav-metrics'
import { saveFoodCameraResult } from '../../../utils/food-camera'
import { getFoodAnalysisCreditBlockMessage, getFoodAnalysisCreditStatusForDate, isFoodAnalysisCreditExhausted } from '../../../utils/membership'
import { captureAuthSession, isAuthSessionCurrent, type AuthSession } from '../../../utils/auth-session'
import { getTodayRecordDateKey, persistRecordTargetDate } from '../../../utils/record-date'
import { useLocalToday } from '../../../hooks/useLocalToday'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  chooseImageWithPrivacy,
  ensureWeappPrivacyAuthorized,
  isCameraAuthorizationError,
  isPrivacyAuthorizeError,
  showCameraAuthorizationFailure,
  showPrivacyAuthorizeFailure,
} from '../../../utils/weapp-privacy'
import {
  buildCameraEntryUrl,
  buildLoginRedirectUrl,
  formatCameraDateChip,
  resolveCameraRecordDate,
  type CameraSideEntry,
} from './camera-entry'
import { cropPhotoToFrame } from './crop'
import { computeCameraFrame, FRAME_RATIO, type ShotOrientation } from './frame-layout'

import './index.scss'

type CameraState = 'preparing' | 'ready' | 'unavailable'

const CAMERA_PAGE_PATH = '/packageCamera/pages/shoot/index'
const ORIENTATION_STORAGE_KEY = 'foodCameraOrientation'
const CROP_CANVAS_ID = 'foodCameraCropCanvas'
const MAX_ALBUM_PHOTOS = 5
/** 底部面板内容高度（rpx），与 index.scss 的 .food-camera__panel 注释一致；另加底部 16px 和安全区 */
const PANEL_CONTENT_RPX = 348
const PANEL_CONTENT_RPX_RETURN_MODE = 252
const PANEL_BOTTOM_GAP_PX = 16

const SIDE_MODES: Array<{ id: 'photo' | CameraSideEntry; label: string }> = [
  { id: 'photo', label: '拍照' },
  { id: 'text', label: '文字' },
  { id: 'library', label: '食物库' },
]

function readStoredOrientation(): ShotOrientation {
  try {
    return Taro.getStorageSync(ORIENTATION_STORAGE_KEY) === 'landscape' ? 'landscape' : 'portrait'
  } catch {
    return 'portrait'
  }
}

/** 拍照识别专用相机：取景框竖拍 3:4、横拍 4:3，拍到的照片按框裁切；底部面板放文字、食物库、相册和常吃的。 */
export default function FoodCameraPage() {
  const router = useRouter()
  // return=1：同一顿饭里「添加 / 再拍一张」打开的相机，拍完把照片交回上一页。
  const returnToOpener = router.params?.return === '1'
  const maxCount = Math.min(MAX_ALBUM_PHOTOS, Math.max(1, Number(router.params?.max) || MAX_ALBUM_PHOTOS))
  const explicitBackfill = router.params?.backfill === '1'
  // Includes foreground day changes and an immediate check after returning from
  // the background. Actions below also resolve again instead of using a render's day.
  const today = useLocalToday()
  const recordDate = resolveCameraRecordDate(router.params?.date, explicitBackfill)
  const [orientation, setOrientation] = useState<ShotOrientation>(readStoredOrientation)
  const [cameraState, setCameraState] = useState<CameraState>('preparing')
  const [shooting, setShooting] = useState(false)
  const [creditSnapshot, setCreditSnapshot] = useState<{
    today: string; date: string; owner: AuthSession; status: MembershipStatus; targetStatus: MembershipStatus | null
  } | null>(null)
  const [creditSheetOpen, setCreditSheetOpen] = useState(false)
  const busyRef = useRef(false)
  const metrics = useMemo(readCustomNavMetrics, [])
  const panelContentPx = ((returnToOpener ? PANEL_CONTENT_RPX_RETURN_MODE : PANEL_CONTENT_RPX) * metrics.windowWidth) / 750
  const frame = computeCameraFrame({
    windowWidth: metrics.windowWidth,
    windowHeight: metrics.windowHeight,
    topInset: metrics.statusBarHeight + metrics.navHeight,
    panelHeight: panelContentPx + PANEL_BOTTOM_GAP_PX + metrics.safeBottom,
    orientation,
  })

  useEffect(() => {
    if (!returnToOpener && !getAccessToken()) {
      const target = resolveCameraRecordDate(router.params?.date, explicitBackfill)
      const query = target.backfill ? `?date=${encodeURIComponent(target.date)}&backfill=1` : ''
      void Taro.redirectTo({ url: buildLoginRedirectUrl(`${CAMERA_PAGE_PATH}${query}`) })
      return
    }
    ensureWeappPrivacyAuthorized()
      .then(() => setCameraState('ready'))
      .catch((error) => {
        showPrivacyAuthorizeFailure(error)
        setCameraState('unavailable')
      })
  }, [])

  useEffect(() => {
    if (returnToOpener) return
    persistRecordTargetDate(recordDate.date)
    if (recordDate.fellBackToToday) {
      void Taro.showToast({ title: '只能记近 14 天，这次记到今天', icon: 'none' })
    }
  }, [returnToOpener, recordDate.date, recordDate.fellBackToToday])

  useEffect(() => {
    if (returnToOpener) return
    const owner = captureAuthSession()
    if (!owner.token) return
    let disposed = false
    const requestedToday = getTodayRecordDateKey()
    const targetDate = recordDate.date
    setCreditSheetOpen(false)
    Promise.all([
      getMyMembership(),
      targetDate !== requestedToday ? getMyMembership(targetDate).catch(() => null) : Promise.resolve(null),
    ]).then(([status, targetStatus]) => {
      if (disposed || !isAuthSessionCurrent(owner)) return
      setCreditSnapshot({ today: requestedToday, date: targetDate, owner, status, targetStatus })
      const available = getFoodAnalysisCreditStatusForDate(status, targetStatus, targetDate !== requestedToday)
      if (isFoodAnalysisCreditExhausted(available)) setCreditSheetOpen(true)
    }).catch(() => {
      /* 无法确认积分时仍允许拍，由提交接口核验。 */
    })
    return () => { disposed = true }
  }, [returnToOpener, recordDate.date])

  const membership = creditSnapshot && isAuthSessionCurrent(creditSnapshot.owner) ? creditSnapshot.status : null
  const creditStatus = creditSnapshot && creditSnapshot.today === today && creditSnapshot.date === recordDate.date && isAuthSessionCurrent(creditSnapshot.owner)
    ? getFoodAnalysisCreditStatusForDate(creditSnapshot.status, creditSnapshot.targetStatus, recordDate.date !== today)
    : null
  const isCurrentlyCreditBlocked = () => {
    if (returnToOpener || !creditSnapshot || !isAuthSessionCurrent(creditSnapshot.owner)) return false
    const currentToday = getTodayRecordDateKey()
    const targetDate = resolveCameraRecordDate(router.params?.date, explicitBackfill).date
    if (creditSnapshot.today !== currentToday || creditSnapshot.date !== targetDate) return false
    return isFoodAnalysisCreditExhausted(getFoodAnalysisCreditStatusForDate(
      creditSnapshot.status, creditSnapshot.targetStatus, targetDate !== currentToday,
    ))
  }

  const finishWithPhotos = (paths: string[]) => {
    if (returnToOpener) {
      saveFoodCameraResult(paths.slice(0, maxCount))
      void Taro.navigateBack()
      return
    }
    const target = resolveCameraRecordDate(router.params?.date, explicitBackfill)
    persistRecordTargetDate(target.date)
    Taro.setStorageSync('analyzeImagePath', paths[0])
    Taro.setStorageSync('analyzeImagePaths', paths)
    void Taro.redirectTo({ url: `${extraPkgUrl('/pages/analyze/index')}?date=${encodeURIComponent(target.date)}${target.backfill ? '&backfill=1' : ''}` })
  }

  const switchOrientation = (next: ShotOrientation) => {
    if (next === orientation || busyRef.current) return
    setOrientation(next)
    try {
      Taro.setStorageSync(ORIENTATION_STORAGE_KEY, next)
    } catch {
      /* 记不住上次的选择不影响拍照 */
    }
  }

  const handleShoot = () => {
    if (isCurrentlyCreditBlocked()) {
      setCreditSheetOpen(true)
      return
    }
    if (busyRef.current || cameraState !== 'ready') return
    busyRef.current = true
    setShooting(true)
    const frameRatio = FRAME_RATIO[orientation]
    Taro.createCameraContext().takePhoto({
      quality: 'high',
      success: (res) => {
        cropPhotoToFrame(`#${CROP_CANVAS_ID}`, res.tempImagePath, frameRatio)
          .catch((error) => {
            // 裁切失败时用原图继续识别，不让用户重拍。
            console.error('[food-camera] crop failed, using the original photo', error)
            return res.tempImagePath
          })
          .then(path => finishWithPhotos([path]))
          .finally(() => {
            busyRef.current = false
            setShooting(false)
          })
      },
      fail: (error) => {
        busyRef.current = false
        setShooting(false)
        console.error('[food-camera] takePhoto failed', error)
        Taro.showToast({ title: '拍照失败，请重试', icon: 'none' })
      },
    })
  }

  const handlePickFromAlbum = async () => {
    if (isCurrentlyCreditBlocked()) {
      setCreditSheetOpen(true)
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    try {
      const res = await chooseImageWithPrivacy({ count: maxCount, sizeType: ['compressed'], sourceType: ['album'] })
      const paths = (res.tempFilePaths || []).filter(Boolean)
      if (paths.length > 0) finishWithPhotos(paths)
    } catch (error: any) {
      if (String(error?.errMsg || '').includes('cancel')) return
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
        return
      }
      Taro.showToast({ title: '选择图片失败', icon: 'none' })
    } finally {
      busyRef.current = false
    }
  }

  const openSideEntry = (entry: CameraSideEntry) => {
    if (busyRef.current) return
    const target = resolveCameraRecordDate(router.params?.date, explicitBackfill)
    const url = buildCameraEntryUrl(entry, target.date, target.backfill)
    // 识别记录看完还能回来拍；其他方式替换掉相机页，返回直接回到首页。
    const open = entry === 'history' ? Taro.navigateTo : Taro.redirectTo
    void open({ url }).catch(() => {
      Taro.showToast({ title: '打开失败，请重试', icon: 'none' })
    })
  }

  const handleClose = () => {
    if (Taro.getCurrentPages().length > 1) {
      void Taro.navigateBack()
      return
    }
    void Taro.switchTab({ url: '/pages/index/index' })
  }

  const handleCameraError = (event: { detail?: { errMsg?: string } }) => {
    console.error('[food-camera] camera error', event?.detail)
    setCameraState('unavailable')
    if (isCameraAuthorizationError(event?.detail)) showCameraAuthorizationFailure()
  }

  const shutterDisabled = shooting || cameraState !== 'ready'

  return (
    <View className='food-camera'>
      <View className='food-camera__nav' style={{ paddingTop: `${metrics.statusBarHeight}px`, height: `${metrics.navHeight}px` }}>
        <View className='food-camera__close' onClick={handleClose} aria-label='关闭'>
          <Text className='iconfont icon-close food-camera__close-icon' />
        </View>
        {!returnToOpener && <Text className='food-camera__date'>{formatCameraDateChip(recordDate.date)}</Text>}
      </View>

      <View className='food-camera__viewport'>
        <View
          className={`food-camera__stage food-camera__stage--${orientation}`}
          style={{ width: `${frame.width}px`, height: `${frame.height}px` }}
        >
          {cameraState === 'ready' && (
            <Camera
              className='food-camera__preview'
              devicePosition='back'
              flash='off'
              resolution='high'
              onError={handleCameraError}
            />
          )}
          {cameraState === 'unavailable' && (
            <View className='food-camera__unavailable'>
              <Text className='food-camera__unavailable-title'>相机暂时打不开</Text>
              <Text className='food-camera__unavailable-text'>请在设置里允许使用摄像头，或者从相册选一张照片。</Text>
              <View className='food-camera__unavailable-actions'>
                <View className='food-camera__pill' onClick={() => void Taro.openSetting()}>去设置</View>
                <View className='food-camera__pill food-camera__pill--primary' onClick={() => void handlePickFromAlbum()}>从相册选</View>
              </View>
            </View>
          )}
          <View className='food-camera__corner food-camera__corner--tl' />
          <View className='food-camera__corner food-camera__corner--tr' />
          <View className='food-camera__corner food-camera__corner--bl' />
          <View className='food-camera__corner food-camera__corner--br' />
          {cameraState !== 'unavailable' && (
            <Text className='food-camera__hint'>整份放进框里，每样都会标出克重</Text>
          )}
          <View className='food-camera__ratio'>
            <View
              className={`food-camera__ratio-option ${orientation === 'portrait' ? 'is-active' : ''}`}
              onClick={() => switchOrientation('portrait')}
            >
              竖 3:4
            </View>
            <View
              className={`food-camera__ratio-option ${orientation === 'landscape' ? 'is-active' : ''}`}
              onClick={() => switchOrientation('landscape')}
            >
              横 4:3
            </View>
          </View>
        </View>
      </View>

      <View
        className={`food-camera__panel ${returnToOpener ? 'food-camera__panel--return' : ''}`}
        style={{ paddingBottom: `${metrics.safeBottom + PANEL_BOTTOM_GAP_PX}px` }}
      >
        {!returnToOpener && (
          <View className='food-camera__modes'>
            {SIDE_MODES.map(mode => (
              <View
                key={mode.id}
                className={`food-camera__mode ${mode.id === 'photo' ? 'is-active' : ''}`}
                onClick={() => { if (mode.id !== 'photo') openSideEntry(mode.id) }}
              >
                <Text className='food-camera__mode-label'>{mode.label}</Text>
                <View className='food-camera__mode-bar' />
              </View>
            ))}
          </View>
        )}

        <View className='food-camera__controls'>
          <View className='food-camera__side-button' onClick={() => void handlePickFromAlbum()}>
            <View className='food-camera__side-icon food-camera__side-icon--album'>
              <IconAlbum size={44} color='#FFF9E6' />
            </View>
            <Text className='food-camera__side-label'>相册</Text>
          </View>
          <View
            className={`food-camera__shutter ${shutterDisabled ? 'is-disabled' : ''} ${shooting ? 'is-shooting' : ''}`}
            onClick={handleShoot}
            aria-label='拍照'
          >
            <View className='food-camera__shutter-inner' />
          </View>
          {returnToOpener ? (
            <View className='food-camera__side-button food-camera__side-button--placeholder' />
          ) : (
            <View className='food-camera__side-button' onClick={() => openSideEntry('favorites')}>
              <View className='food-camera__side-icon'>
                <Text className='iconfont icon-collection food-camera__star' />
              </View>
              <Text className='food-camera__side-label'>常吃的</Text>
            </View>
          )}
        </View>

        <View className='food-camera__footer'>
          <Text className='food-camera__footer-text'>相册一次最多 {maxCount} 张</Text>
          {!returnToOpener && (
            <>
              <Text className='food-camera__footer-dot'>·</Text>
              <Text className='food-camera__footer-link' onClick={() => openSideEntry('history')}>识别记录 ›</Text>
            </>
          )}
        </View>
      </View>

      <Canvas type='2d' id={CROP_CANVAS_ID} className='food-camera__crop-canvas' />

      <CreditShortageSheet
        visible={creditSheetOpen}
        membershipStatus={creditStatus || membership}
        requiredCredits={2}
        scenarioLabel='食物分析'
        message={creditStatus ? getFoodAnalysisCreditBlockMessage(creditStatus) : undefined}
        onClose={() => setCreditSheetOpen(false)}
      />
    </View>
  )
}
