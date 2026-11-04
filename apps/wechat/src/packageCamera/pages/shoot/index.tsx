import { Camera, Canvas, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import { LANDSCAPE_PHOTO_FRAME_RATIO, PORTRAIT_PHOTO_FRAME_RATIO } from '@food-link/core'

import { IconAlbum } from '../../../components/iconfont'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  chooseImageWithPrivacy,
  ensureWeappPrivacyAuthorized,
  isCameraAuthorizationError,
  isPrivacyAuthorizeError,
  showCameraAuthorizationFailure,
  showPrivacyAuthorizeFailure,
} from '../../../utils/weapp-privacy'
import { cropPhotoToFrame } from './crop'

import './index.scss'

type ShotOrientation = 'portrait' | 'landscape'
type CameraState = 'preparing' | 'ready' | 'unavailable'

const ORIENTATION_STORAGE_KEY = 'foodCameraOrientation'
const CROP_CANVAS_ID = 'foodCameraCropCanvas'
const FRAME_RATIO: Record<ShotOrientation, number> = {
  portrait: PORTRAIT_PHOTO_FRAME_RATIO,
  landscape: LANDSCAPE_PHOTO_FRAME_RATIO,
}

function readStoredOrientation(): ShotOrientation {
  try {
    return Taro.getStorageSync(ORIENTATION_STORAGE_KEY) === 'landscape' ? 'landscape' : 'portrait'
  } catch {
    return 'portrait'
  }
}

/** 拍照识别专用相机：取景框竖拍 3:4、横拍 4:3，拍到的照片按框裁切，不再铺满整个屏幕。 */
export default function FoodCameraPage() {
  const router = useRouter()
  const recordDate = String(router.params?.date || '')
  const [orientation, setOrientation] = useState<ShotOrientation>(readStoredOrientation)
  const [cameraState, setCameraState] = useState<CameraState>('preparing')
  const [shooting, setShooting] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    ensureWeappPrivacyAuthorized()
      .then(() => setCameraState('ready'))
      .catch((error) => {
        showPrivacyAuthorizeFailure(error)
        setCameraState('unavailable')
      })
  }, [])

  const openAnalyze = (paths: string[]) => {
    Taro.setStorageSync('analyzeImagePath', paths[0])
    Taro.setStorageSync('analyzeImagePaths', paths)
    const query = recordDate ? `?date=${encodeURIComponent(recordDate)}` : ''
    void Taro.redirectTo({ url: `${extraPkgUrl('/pages/analyze/index')}${query}` })
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
          .then(path => openAnalyze([path]))
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
    if (busyRef.current) return
    busyRef.current = true
    try {
      const res = await chooseImageWithPrivacy({ count: 5, sizeType: ['compressed'], sourceType: ['album'] })
      const paths = (res.tempFilePaths || []).filter(Boolean)
      if (paths.length > 0) openAnalyze(paths)
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

  const handleCameraError = (event: { detail?: { errMsg?: string } }) => {
    console.error('[food-camera] camera error', event?.detail)
    setCameraState('unavailable')
    if (isCameraAuthorizationError(event?.detail)) showCameraAuthorizationFailure()
  }

  return (
    <View className='food-camera'>
      <View className={`food-camera__stage food-camera__stage--${orientation}`}>
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
              <View className='food-camera__pill' onClick={() => void handlePickFromAlbum()}>从相册选</View>
            </View>
          </View>
        )}
        <View className='food-camera__corner food-camera__corner--tl' />
        <View className='food-camera__corner food-camera__corner--tr' />
        <View className='food-camera__corner food-camera__corner--bl' />
        <View className='food-camera__corner food-camera__corner--br' />
      </View>

      <Text className='food-camera__hint'>把整份食物放进框里，拍到的照片就是框里的画面</Text>

      <View className='food-camera__ratio'>
        <View
          className={`food-camera__ratio-option ${orientation === 'portrait' ? 'is-active' : ''}`}
          onClick={() => switchOrientation('portrait')}
        >
          竖拍 3:4
        </View>
        <View
          className={`food-camera__ratio-option ${orientation === 'landscape' ? 'is-active' : ''}`}
          onClick={() => switchOrientation('landscape')}
        >
          横拍 4:3
        </View>
      </View>

      <View className='food-camera__controls'>
        <View className='food-camera__side-button' onClick={() => void handlePickFromAlbum()}>
          <IconAlbum size={44} color='#ffffff' />
          <Text className='food-camera__side-label'>相册</Text>
        </View>
        <View
          className={`food-camera__shutter ${shooting || cameraState !== 'ready' ? 'is-disabled' : ''}`}
          onClick={handleShoot}
          aria-label='拍照'
        >
          <View className='food-camera__shutter-inner' />
        </View>
        <View className='food-camera__side-button food-camera__side-button--placeholder' />
      </View>

      <Canvas type='2d' id={CROP_CANVAS_ID} className='food-camera__crop-canvas' />
    </View>
  )
}
