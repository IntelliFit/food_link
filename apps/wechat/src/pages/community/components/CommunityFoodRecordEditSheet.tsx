import { View, Text, Image, Textarea, Input, Button } from '@tarojs/components'
import React, { useEffect, useState, useCallback } from 'react'
import Taro from '@tarojs/taro'
import {
  updateFoodRecord,
  uploadAnalyzeImageFile,
  showUnifiedApiError,
  type CommunityFeedRecord,
} from '../../../utils/api'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'

import './CommunityFoodRecordEditSheet.scss'

const MAX_IMAGES = 3

interface CommunityFoodRecordEditSheetProps {
  visible: boolean
  record: CommunityFeedRecord | null | undefined
  onClose: () => void
  onSuccess: (updatedRecord: CommunityFeedRecord) => void
}

function normalizeImagePaths(record: CommunityFeedRecord | null | undefined): string[] {
  if (!record) return []
  const paths = record.image_paths || []
  if (paths.length > 0) return paths.filter(Boolean)
  if (record.image_path) return [record.image_path]
  return []
}

function parseNumber(value: string): number {
  const num = parseFloat(value)
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 10) / 10 : 0
}

export function CommunityFoodRecordEditSheet({
  visible,
  record,
  onClose,
  onSuccess,
}: CommunityFoodRecordEditSheetProps) {
  const { scheme } = useAppColorScheme()
  const isDark = scheme === 'dark'

  const [description, setDescription] = useState('')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)

  useEffect(() => {
    if (visible && record) {
      setDescription(record.description || '')
      setImagePaths(normalizeImagePaths(record))
      setCalories(String(record.total_calories ?? 0))
      setProtein(String(record.total_protein ?? 0))
      setCarbs(String(record.total_carbs ?? 0))
      setFat(String(record.total_fat ?? 0))
    }
  }, [visible, record])

  const handleAddImage = useCallback(async () => {
    if (imagePaths.length >= MAX_IMAGES) {
      Taro.showToast({ title: `最多 ${MAX_IMAGES} 张图片`, icon: 'none' })
      return
    }
    try {
      const res = await Taro.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      })
      const tempFile = res.tempFiles?.[0]
      if (!tempFile?.tempFilePath) {
        Taro.showToast({ title: '选择图片失败', icon: 'none' })
        return
      }
      setUploadingIndex(imagePaths.length)
      const uploadRes = await uploadAnalyzeImageFile(tempFile.tempFilePath)
      if (uploadRes.imageUrl) {
        setImagePaths((prev) => [...prev, uploadRes.imageUrl])
      }
    } catch (e: any) {
      const msg = e?.message || e?.errMsg || '上传失败'
      if (!msg.includes('cancel')) {
        Taro.showToast({ title: msg, icon: 'none' })
      }
    } finally {
      setUploadingIndex(null)
    }
  }, [imagePaths.length])

  const handleRemoveImage = useCallback((index: number) => {
    setImagePaths((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSave = useCallback(async () => {
    if (!record?.id) return
    if (!description.trim() && imagePaths.length === 0) {
      Taro.showToast({ title: '请填写动态文本或添加图片', icon: 'none' })
      return
    }
    const totalCalories = parseNumber(calories)
    const totalProtein = parseNumber(protein)
    const totalCarbs = parseNumber(carbs)
    const totalFat = parseNumber(fat)

    setSaving(true)
    try {
      const res = await updateFoodRecord(record.id, {
        description: description.trim(),
        image_paths: imagePaths.length > 0 ? imagePaths : undefined,
        image_path: imagePaths.length > 0 ? imagePaths[0] : undefined,
        total_calories: totalCalories,
        total_protein: totalProtein,
        total_carbs: totalCarbs,
        total_fat: totalFat,
      })
      Taro.showToast({ title: '保存成功', icon: 'success' })
      onSuccess({ ...record, ...res.record })
      onClose()
    } catch (e) {
      await showUnifiedApiError(e, '保存失败')
    } finally {
      setSaving(false)
    }
  }, [record, description, imagePaths, calories, protein, carbs, fat, onClose, onSuccess])

  if (!visible) return null

  return (
    <View className={`community-food-record-edit-sheet ${isDark ? 'community-food-record-edit-sheet--dark' : ''}`}>
      <View className='cfs-mask' onClick={onClose} />
      <View className='cfs-content' onClick={(e) => e.stopPropagation()}>
        <View className='cfs-header'>
          <Text className='cfs-title'>编辑动态</Text>
          <View className='cfs-close' onClick={onClose}>
            <Text className='cfs-close-icon'>×</Text>
          </View>
        </View>

        <View className='cfs-body'>
          <View className='cfs-section'>
            <Text className='cfs-label'>图片（最多 {MAX_IMAGES} 张）</Text>
            <View className='cfs-images'>
              {imagePaths.map((url, index) => (
                <View key={`${url}-${index}`} className='cfs-image-item'>
                  <Image className='cfs-image' src={url} mode='aspectFill' />
                  <View className='cfs-image-remove' onClick={() => handleRemoveImage(index)}>
                    <Text className='cfs-image-remove-icon'>×</Text>
                  </View>
                </View>
              ))}
              {uploadingIndex !== null && (
                <View className='cfs-image-item cfs-image-item--uploading'>
                  <Text className='cfs-uploading-text'>上传中...</Text>
                </View>
              )}
              {imagePaths.length < MAX_IMAGES && uploadingIndex === null && (
                <View className='cfs-image-item cfs-image-item--add' onClick={handleAddImage}>
                  <Text className='cfs-add-icon'>+</Text>
                </View>
              )}
            </View>
          </View>

          <View className='cfs-section'>
            <Text className='cfs-label'>动态文本</Text>
            <Textarea
              className='cfs-textarea'
              value={description}
              onInput={(e) => setDescription(String(e.detail.value))}
              placeholder='添加动态描述...'
              placeholderClass='cfs-placeholder'
              maxlength={500}
              autoHeight
            />
          </View>

          <View className='cfs-section'>
            <Text className='cfs-label'>营养信息</Text>
            <View className='cfs-nutrients'>
              <View className='cfs-nutrient-row'>
                <Text className='cfs-nutrient-label'>热量</Text>
                <Input
                  className='cfs-nutrient-input'
                  type='digit'
                  value={calories}
                  onInput={(e) => setCalories(String(e.detail.value))}
                />
                <Text className='cfs-nutrient-unit'>kcal</Text>
              </View>
              <View className='cfs-nutrient-row'>
                <Text className='cfs-nutrient-label'>蛋白质</Text>
                <Input
                  className='cfs-nutrient-input'
                  type='digit'
                  value={protein}
                  onInput={(e) => setProtein(String(e.detail.value))}
                />
                <Text className='cfs-nutrient-unit'>g</Text>
              </View>
              <View className='cfs-nutrient-row'>
                <Text className='cfs-nutrient-label'>碳水</Text>
                <Input
                  className='cfs-nutrient-input'
                  type='digit'
                  value={carbs}
                  onInput={(e) => setCarbs(String(e.detail.value))}
                />
                <Text className='cfs-nutrient-unit'>g</Text>
              </View>
              <View className='cfs-nutrient-row'>
                <Text className='cfs-nutrient-label'>脂肪</Text>
                <Input
                  className='cfs-nutrient-input'
                  type='digit'
                  value={fat}
                  onInput={(e) => setFat(String(e.detail.value))}
                />
                <Text className='cfs-nutrient-unit'>g</Text>
              </View>
            </View>
          </View>

          <View className='cfs-save-section'>
            <Button
              className={`cfs-save-btn ${saving ? 'cfs-save-btn--disabled' : ''}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </Button>
            <View className='cfs-bottom-spacer' />
          </View>
        </View>
      </View>
    </View>
  )
}
