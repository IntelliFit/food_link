import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import type { CustomImportDeps } from '@food-link/core'
import { apiClient } from '../api'
import type { useAppDialog } from '../providers/DialogProvider'

type AppDialog = ReturnType<typeof useAppDialog>

const PACKAGED_FOOD_UPLOAD_CONSENT_KEY = 'packagedFoodUploadConsentV1'
const PHOTO_QUALITY = 0.82

export const packageExtractPollDeps: CustomImportDeps = {
  getTask: (taskId) => apiClient.getAnalyzeTask(taskId),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
}

async function hasPackagedUploadConsent() {
  try {
    return Boolean(await AsyncStorage.getItem(PACKAGED_FOOD_UPLOAD_CONSENT_KEY))
  } catch {
    return false
  }
}

/** 包装照片会进入公共食物库和奖励判定，首次上传前需要用户同意。 */
export async function askPackagedUploadConsent(dialog: AppDialog): Promise<boolean> {
  if (await hasPackagedUploadConsent()) return true
  const accepted = await dialog.confirm({
    title: '图片使用授权',
    message: '你上传的包装照片将用于 AI 识别、食物库数据建设和奖励积分判定。请确认你有权上传这些图片，并授权平台在本服务中使用。',
    confirmText: '同意上传',
    cancelText: '暂不上传',
  })
  if (accepted) {
    await AsyncStorage.setItem(PACKAGED_FOOD_UPLOAD_CONSENT_KEY, new Date().toISOString()).catch(() => undefined)
  }
  return accepted
}

async function capturePhotos(dialog: AppDialog, maxCount: number): Promise<ImagePicker.ImagePickerAsset[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) throw new Error('需要相机权限才能拍摄包装')
  let photos: ImagePicker.ImagePickerAsset[] = []
  while (photos.length < maxCount) {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: PHOTO_QUALITY })
    if (result.canceled || !result.assets[0]) break
    photos = [...photos, result.assets[0]]
    if (photos.length >= maxCount) break
    const keepGoing = await dialog.confirm({
      title: `已拍 ${photos.length} 张`,
      message: '再拍一张营养成分表，识别更准。',
      confirmText: '继续拍',
      cancelText: '开始识别',
    })
    if (!keepGoing) break
  }
  return photos
}

/** 相机每次只出一张，所以一张张拍；相册可一次多选。用户取消时返回空数组。 */
export async function choosePackagePhotos(dialog: AppDialog, maxCount: number): Promise<ImagePicker.ImagePickerAsset[]> {
  const source = await dialog.showDialog({
    title: '拍包装导入',
    message: '拍包装正面和营养成分表，识别后填好表单，核对后再保存。',
    confirmText: '拍照',
    cancelText: '从相册选择',
  })
  if (source === 'dismiss') return []
  if (source === 'confirm') return capturePhotos(dialog, maxCount)
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: maxCount,
    quality: PHOTO_QUALITY,
  })
  return result.canceled ? [] : result.assets.slice(0, maxCount)
}

export async function uploadPackagePhotos(photos: ImagePicker.ImagePickerAsset[]): Promise<string[]> {
  return Promise.all(photos.map(async (photo) => {
    const uploaded = await apiClient.uploadAnalyzeImageFile({
      fileUri: photo.uri,
      fileName: photo.fileName || 'packaged-food.jpg',
      mimeType: photo.mimeType || 'image/jpeg',
    })
    return uploaded.imageUrl
  }))
}
