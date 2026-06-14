import { Image, Input, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Button } from '@taroify/core'
import '@taroify/core/button/style'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import {
  communityGetFeedContext,
  createCirclePost,
  showUnifiedApiError,
  type CirclePostNutritionInput,
  type CommunityFeedTargetType,
  updateCirclePost,
  uploadCirclePostImage,
} from '../../../utils/api'
import { COMMUNITY_FEED_CHANGED_EVENT } from '../../../utils/home-events'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { withAuth } from '../../../utils/withAuth'

import './index.scss'

const MAX_IMAGES = 3
const MAX_TITLE_LENGTH = 120
const MAX_BODY_LENGTH = 2000
const DRAFT_STORAGE_KEY = 'circle_post_draft_v2'
const DRAFT_TIP_SHOWN_KEY = 'circle_post_draft_tip_shown_v1'

interface CirclePostDraft {
  title: string
  body: string
  images: ImageItem[]
  nutritionEnabled: boolean
  nutrition: NutritionFormState
  savedAt: string
}

const NUTRITION_FIELDS: Array<{
  key: keyof CirclePostNutritionInput
  label: string
  unit: string
  placeholder: string
  max?: number
}> = [
  { key: 'calories', label: '热量', unit: 'kcal', placeholder: '0', max: 20000 },
  { key: 'protein', label: '蛋白质', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'carbs', label: '碳水', unit: 'g', placeholder: '0', max: 5000 },
  { key: 'fat', label: '脂肪', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'fiber', label: '膳食纤维', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'sugar', label: '糖分', unit: 'g', placeholder: '0', max: 2000 },
  { key: 'sodium_mg', label: '钠', unit: 'mg', placeholder: '0', max: 50000 },
  { key: 'total_weight_grams', label: '总重量', unit: 'g', placeholder: '0', max: 50000 },
]

type ImageItem = {
  id: string
  url: string
  localPath?: string
  uploading?: boolean
}

type NutritionFormState = Record<keyof CirclePostNutritionInput, string>

const EMPTY_NUTRITION: NutritionFormState = {
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sugar: '',
  sodium_mg: '',
  total_weight_grams: '',
}

function parseNumberInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

function buildNutritionInput(state: NutritionFormState): CirclePostNutritionInput | undefined {
  const input: CirclePostNutritionInput = {}
  let hasValue = false
  NUTRITION_FIELDS.forEach(({ key }) => {
    const value = parseNumberInput(state[key])
    if (value !== undefined) {
      input[key] = value
      hasValue = true
    }
  })
  return hasValue ? input : undefined
}

function formatNumberDisplay(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return String(value)
}

function CirclePostEditPage() {
  const [postId, setPostId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [images, setImages] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [nutritionEnabled, setNutritionEnabled] = useState(false)
  const [nutrition, setNutrition] = useState<NutritionFormState>(EMPTY_NUTRITION)

  useEffect(() => {
    const pages = Taro.getCurrentPages()
    const current = pages[pages.length - 1]
    const options = (current?.options || {}) as Record<string, string | undefined>
    const id = options.id || options.postId || options.post_id || ''
    if (id) {
      setPostId(id)
      void loadPost(id)
    } else {
      loadDraftFromStorage()
    }
  }, [])

  const loadPost = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const { item } = await communityGetFeedContext(id, 0, 'circle_post' as CommunityFeedTargetType)
      setTitle(item.record.title || '')
      setBody(item.record.body || '')
      const items: ImageItem[] = (item.record.image_paths || []).map((url) => ({
        id: url,
        url,
      }))
      setImages(items)

      const next: NutritionFormState = { ...EMPTY_NUTRITION }
      let hasNutrition = false
      NUTRITION_FIELDS.forEach(({ key }) => {
        const value = item.record[key as keyof typeof item.record]
        const formatted = formatNumberDisplay(value as number | null | undefined)
        next[key] = formatted
        if (formatted) hasNutrition = true
      })
      if (hasNutrition) {
        setNutrition(next)
        setNutritionEnabled(true)
      }
    } catch (e) {
      console.error('加载动态失败', e)
      await showUnifiedApiError(e, '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleChooseImages = async () => {
    const remain = MAX_IMAGES - images.length
    if (remain <= 0) {
      Taro.showToast({ title: `最多上传 ${MAX_IMAGES} 张图片`, icon: 'none' })
      return
    }
    try {
      const res = await chooseImageWithPrivacy({
        count: remain,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const tempFiles = res.tempFilePaths || []
      for (const localPath of tempFiles) {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        setImages((current) => [...current, { id, url: localPath, localPath, uploading: true }].slice(0, MAX_IMAGES))
        void uploadSingleImage(id, localPath)
      }
    } catch (error) {
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
        return
      }
      console.error('选择图片失败', error)
      Taro.showToast({ title: '选择图片失败', icon: 'none' })
    }
  }

  async function uploadSingleImage(id: string, localPath: string) {
    try {
      const { image_url } = await uploadCirclePostImage(localPath)
      setImages((current) =>
        current.map((item) => (item.id === id ? { ...item, url: image_url, localPath: undefined, uploading: false } : item))
      )
    } catch (error) {
      console.error('上传图片失败', error)
      setImages((current) => current.filter((item) => item.id !== id))
      await showUnifiedApiError(error, '图片上传失败')
    }
  }

  const handleRemoveImage = (id: string) => {
    setImages((current) => current.filter((item) => item.id !== id))
  }

  const loadDraftFromStorage = () => {
    try {
      const raw = Taro.getStorageSync(DRAFT_STORAGE_KEY)
      if (!raw) return
      const draft = (typeof raw === 'string' ? JSON.parse(raw) : raw) as CirclePostDraft
      if (!draft || typeof draft !== 'object') return
      setTitle(typeof draft.title === 'string' ? draft.title : '')
      setBody(typeof draft.body === 'string' ? draft.body : '')
      setImages(Array.isArray(draft.images) ? draft.images.filter((item) => item && item.url) : [])
      if (draft.nutritionEnabled) {
        setNutritionEnabled(true)
        setNutrition({ ...EMPTY_NUTRITION, ...(draft.nutrition || {}) })
      }
    } catch (e) {
      console.error('读取草稿失败', e)
    }
  }

  const saveDraftToStorage = () => {
    const draft: CirclePostDraft = {
      title,
      body,
      images: images.filter((item) => !item.uploading && item.url),
      nutritionEnabled,
      nutrition,
      savedAt: new Date().toISOString(),
    }
    try {
      Taro.setStorageSync(DRAFT_STORAGE_KEY, draft)
    } catch (e) {
      console.error('保存草稿失败', e)
      Taro.showToast({ title: '草稿保存失败', icon: 'none' })
      return
    }
    Taro.showToast({ title: '草稿已保存', icon: 'success' })
  }

  const handleSaveDraft = async () => {
    const hasContent = title.trim().length > 0 || body.trim().length > 0 || images.length > 0 || nutritionEnabled
    if (!hasContent) {
      Taro.showToast({ title: '没有内容可保存', icon: 'none' })
      return
    }
    try {
      const tipShown = Taro.getStorageSync(DRAFT_TIP_SHOWN_KEY)
      if (tipShown) {
        saveDraftToStorage()
        return
      }
      const { confirm } = await Taro.showModal({
        title: '草稿仅保存在本设备',
        content: '当前草稿只会存储在当前手机的本地缓存中，更换设备或清理缓存后将无法查看。',
        confirmText: '知道了',
        showCancel: false,
      })
      if (confirm) {
        try {
          Taro.setStorageSync(DRAFT_TIP_SHOWN_KEY, true)
        } catch (e) {
          console.error('记录草稿提示状态失败', e)
        }
        saveDraftToStorage()
      }
    } catch (e) {
      console.error('保存草稿失败', e)
    }
  }

  const handleNutritionChange = (key: keyof CirclePostNutritionInput, value: string) => {
    const field = NUTRITION_FIELDS.find((f) => f.key === key)
    const normalized = value.replace(/[^\d.]/g, '')
    const parts = normalized.split('.')
    const trimmed = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : normalized
    if (field?.max && Number(trimmed) > field.max) return
    setNutrition((prev) => ({ ...prev, [key]: trimmed }))
  }

  const handleSubmit = async () => {
    const trimmedTitle = title.trim()
    const trimmedBody = body.trim()
    if (!trimmedTitle && !trimmedBody && images.length === 0) {
      Taro.showToast({ title: '请填写标题、正文或添加图片', icon: 'none' })
      return
    }
    if (images.some((item) => item.uploading)) {
      Taro.showToast({ title: '图片上传中，请稍候', icon: 'none' })
      return
    }
    const imageUrls = images.map((item) => item.url)
    const nutritionInput = nutritionEnabled ? buildNutritionInput(nutrition) : undefined
    setSubmitting(true)
    try {
      if (postId) {
        await updateCirclePost(postId, { title: trimmedTitle, body: trimmedBody, imageUrls, nutrition: nutritionInput })
      } else {
        await createCirclePost({ title: trimmedTitle, body: trimmedBody, imageUrls, nutrition: nutritionInput })
      }
      Taro.showToast({ title: postId ? '保存成功' : '发布成功', icon: 'success' })
      try {
        Taro.eventCenter.trigger(COMMUNITY_FEED_CHANGED_EVENT)
      } catch {
        // ignore
      }
      setTimeout(() => {
        Taro.navigateBack()
      }, 500)
    } catch (error) {
      console.error('发布动态失败', error)
      await showUnifiedApiError(error, postId ? '保存失败' : '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = useMemo(
    () => (title.trim().length > 0 || body.trim().length > 0 || images.length > 0) && !submitting && !images.some((i) => i.uploading),
    [title, body, images, submitting]
  )

  return (
    <FlPageThemeRoot>
      <View className='circle-post-edit-page'>
        <View className='circle-post-edit-card circle-post-edit-image-section'>
          <View className='circle-post-edit-title-row'>
            <Text className='circle-post-edit-section-title'>图片</Text>
            <Text className='circle-post-edit-count'>
              {images.length}/{MAX_IMAGES}
            </Text>
          </View>
          <View className='circle-post-edit-image-grid'>
            {images.map((item) => (
              <View key={item.id} className='circle-post-edit-image-item'>
                <Image className='circle-post-edit-image-preview' src={item.url} mode='aspectFill' />
                {item.uploading ? (
                  <View className='circle-post-edit-image-mask'>
                    <View className='circle-post-edit-image-spinner' />
                  </View>
                ) : null}
                <View className='circle-post-edit-image-remove' onClick={() => handleRemoveImage(item.id)}>
                  <Text className='circle-post-edit-image-remove-icon'>×</Text>
                </View>
              </View>
            ))}
            {images.length < MAX_IMAGES ? (
              <View className='circle-post-edit-image-add' onClick={() => void handleChooseImages()}>
                <Text className='circle-post-edit-image-add-icon'>+</Text>
                <Text className='circle-post-edit-image-add-text'>添加图片</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View className='circle-post-edit-card circle-post-edit-editor'>
          <Input
            className='circle-post-edit-title-input'
            value={title}
            maxlength={MAX_TITLE_LENGTH}
            placeholder='标题（选填）'
            onInput={(event) => setTitle(event.detail.value)}
            disabled={loading}
          />
          <Textarea
            className='circle-post-edit-textarea'
            value={body}
            maxlength={MAX_BODY_LENGTH}
            placeholder='分享你的饮食心得、运动日常…'
            onInput={(event) => setBody(event.detail.value)}
            disabled={loading}
          />
          <Text className='circle-post-edit-count'>
            {body.length}/{MAX_BODY_LENGTH}
          </Text>
        </View>

        <View className='circle-post-edit-card'>
          <View className='circle-post-edit-title-row' onClick={() => setNutritionEnabled((v) => !v)}>
            <View className='circle-post-edit-title-left'>
              <Text className='circle-post-edit-section-title'>营养信息</Text>
              <Text className='circle-post-edit-section-subtitle'>选填，展示在动态卡片</Text>
            </View>
            <View
              className={`circle-post-edit-toggle ${nutritionEnabled ? 'is-on' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setNutritionEnabled((v) => !v)
              }}
            >
              <View className='circle-post-edit-toggle-knob' />
            </View>
          </View>
          {nutritionEnabled ? (
            <View className='circle-post-edit-nutrition-grid'>
              {NUTRITION_FIELDS.map(({ key, label, unit, placeholder }) => (
                <View key={key} className='circle-post-edit-nutrition-item'>
                  <Text className='circle-post-edit-nutrition-label'>{label}</Text>
                  <View className='circle-post-edit-nutrition-input-wrap'>
                    <Input
                      className='circle-post-edit-nutrition-input'
                      type='digit'
                      placeholder={placeholder}
                      value={nutrition[key]}
                      onInput={(e) => handleNutritionChange(key, e.detail.value)}
                    />
                    <Text className='circle-post-edit-nutrition-unit'>{unit}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View className='circle-post-edit-footer'>
          <Button
            className='circle-post-edit-draft-btn'
            onClick={() => void handleSaveDraft()}
          >
            存草稿
          </Button>
          <Button
            className='circle-post-edit-submit'
            loading={submitting}
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {postId ? '保存' : '发布动态'}
          </Button>
        </View>
      </View>
    </FlPageThemeRoot>
  )
}

export default withAuth(CirclePostEditPage)
