import { View, Text, Input, Textarea, Picker, ScrollView, Image } from '@tarojs/components'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import {
  createManagedFoodExpiryItem,
  getManagedFoodExpiryItem,
  updateManagedFoodExpiryItem,
  subscribeManagedFoodExpiryItem,
  recognizeManagedFoodExpiryItems,
  EXPIRY_SUBSCRIBE_TEMPLATE_ID,
  imageToBase64,
  compressImagePathForUpload,
  uploadAnalyzeImage,
  uploadAnalyzeImageFile,
  type FoodExpiryItem,
  type FoodExpiryRecognitionItem,
  type FoodExpirySourceType,
  type FoodExpiryStorageType,
  type UpsertFoodExpiryItemRequest,
} from '../../../utils/api'
import { FOOD_EXPIRY_CHANGED_EVENT } from '../../../utils/food-expiry-events'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { FlPageThemeRoot } from '../../../components/FlPageThemeRoot'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'

import './index.scss'

const STORAGE_OPTIONS = [
  { value: '常温', label: '常温' },
  { value: '冷藏', label: '冷藏' },
  { value: '冷冻', label: '冷冻' },
]

const CATEGORY_OPTIONS = [
  '乳制品',
  '水果',
  '蔬菜',
  '肉类',
  '海鲜',
  '蛋类',
  '豆制品',
  '熟食',
  '剩菜',
  '主食',
  '面包',
  '零食',
  '饮料',
  '冷冻食品',
  '调味品',
  '其他',
]

const PRESET_ITEMS = [
  { food_name: '牛奶', category: '乳制品', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 3 },
  { food_name: '酸奶', category: '乳制品', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 5 },
  { food_name: '水果', category: '水果', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 3 },
  { food_name: '面包', category: '面包', storage_type: 'room_temp' as FoodExpiryStorageType, days: 3 },
  { food_name: '剩菜', category: '剩菜', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 1 },
  { food_name: '熟食', category: '熟食', storage_type: 'refrigerated' as FoodExpiryStorageType, days: 2 },
]

type ExpiryDraftItem = {
  clientId: string
  foodName: string
  category: string
  customCategory: string
  storageLocation: string
  quantityText: string
  deadlineDate: string
  note: string
  sourceType: FoodExpirySourceType
  aiMeta?: {
    confidence?: number | null
    expireDateIsEstimated?: boolean
    suggestedDays?: number | null
    recognitionBasis?: string | null
    missingFields?: string[]
  } | null
}

function createClientId() {
  return `expiry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

function toStorageLocationLabel(storageType?: FoodExpiryStorageType | string | null): string {
  const normalized = String(storageType || '').trim()
  if (normalized === 'room_temp') return '常温'
  if (normalized === 'frozen') return '冷冻'
  return '冷藏'
}

function createEmptyDraft(): ExpiryDraftItem {
  return {
    clientId: createClientId(),
    foodName: '',
    category: '乳制品',
    customCategory: '',
    storageLocation: '冷藏',
    quantityText: '',
    deadlineDate: addDays(3),
    note: '',
    sourceType: 'manual',
    aiMeta: null,
  }
}

function buildDraftFromSavedItem(item: FoodExpiryItem): ExpiryDraftItem {
  const category = (item.category || '').trim() || '其他'
  const isCustomCategory = !CATEGORY_OPTIONS.includes(category)
  return {
    clientId: item.id || createClientId(),
    foodName: item.food_name || '',
    category,
    customCategory: isCustomCategory ? category : '',
    storageLocation: toStorageLocationLabel(item.storage_type),
    quantityText: item.quantity_note || '',
    deadlineDate: item.expire_date?.split('T')[0] || addDays(3),
    note: item.note || '',
    sourceType: item.source_type || 'manual',
    aiMeta: null,
  }
}

function buildDraftFromRecognition(item: FoodExpiryRecognitionItem): ExpiryDraftItem {
  const category = (item.category || '').trim() || '其他'
  const isCustomCategory = !CATEGORY_OPTIONS.includes(category)
  return {
    clientId: createClientId(),
    foodName: item.food_name || '',
    category,
    customCategory: isCustomCategory ? category : '',
    storageLocation: toStorageLocationLabel(item.storage_type),
    quantityText: item.quantity_note || '',
    deadlineDate: item.expire_date?.split('T')[0] || addDays(item.suggested_days ?? 3),
    note: item.note || '',
    sourceType: item.source_type || 'ai',
    aiMeta: {
      confidence: item.confidence,
      expireDateIsEstimated: item.expire_date_is_estimated,
      suggestedDays: item.suggested_days,
      recognitionBasis: item.recognition_basis,
      missingFields: item.missing_fields || [],
    },
  }
}

const normalizeTmpPath = (path: string): string => {
  const raw = (path || '').trim()
  if (!raw) return ''
  if (/^https?:\/\/tmp\//i.test(raw)) {
    return raw.replace(/^https?:\/\/tmp\//i, 'wxfile://tmp/')
  }
  return raw
}

const isTempImagePath = (path: string): boolean => {
  const raw = (path || '').trim()
  if (!raw) return false
  return /^https?:\/\/tmp\//i.test(raw) || /^wxfile:\/\/tmp\//i.test(raw)
}

const shouldFallbackToLegacyAnalyzeUpload = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || '').toLowerCase()
  return (
    message.includes('http 404') ||
    message.includes('http 405') ||
    message.includes('http 415') ||
    message.includes('not found')
  )
}

const persistImagePathIfNeeded = async (path: string): Promise<string> => {
  const raw = (path || '').trim()
  if (!raw) return ''
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return raw
  const normalized = normalizeTmpPath(raw)
  if (!isTempImagePath(raw) && !isTempImagePath(normalized)) return raw

  const userDataPath = (Taro as any)?.env?.USER_DATA_PATH as string | undefined
  if (!userDataPath) return raw

  const candidates: string[] = []
  const pushCandidate = (nextPath?: string) => {
    const next = (nextPath || '').trim()
    if (!next) return
    if (!candidates.includes(next)) {
      candidates.push(next)
    }
  }

  pushCandidate(raw)
  pushCandidate(normalized)

  for (const src of [raw, normalized]) {
    if (!src) continue
    try {
      const info = await Taro.getImageInfo({ src })
      pushCandidate(info.path)
    } catch {
      // ignore
    }
  }

  for (const tempFilePath of candidates) {
    const ext = (tempFilePath.match(/\.(jpg|jpeg|png|webp|heic|gif)(?:\?.*)?$/i)?.[0] || '.jpg').replace(/\?.*$/, '')
    const targetPath = `${userDataPath}/expiry_${Date.now()}_${Math.floor(Math.random() * 1000000)}${ext}`
    try {
      const savedFilePath = await new Promise<string>((resolve, reject) => {
        Taro.getFileSystemManager().saveFile({
          tempFilePath,
          filePath: targetPath,
          success: (res: any) => resolve(String(res?.savedFilePath || targetPath)),
          fail: reject,
        })
      })
      if (savedFilePath) return savedFilePath
      return targetPath
    } catch {
      // try next candidate
    }
  }

  return raw
}

const persistImagePathsImmediately = async (paths: string[]): Promise<string[]> => {
  const normalizedPaths = paths.map((path) => String(path || '').trim()).filter(Boolean)
  const persistedPaths: string[] = []

  for (const path of normalizedPaths) {
    try {
      const stablePath = await persistImagePathIfNeeded(path)
      persistedPaths.push(stablePath || path)
    } catch {
      persistedPaths.push(path)
    }
  }

  return persistedPaths
}

export default function ExpiryEditPage() {
  const router = useRouter()
  const itemId = router.params?.id
  const isEdit = !!itemId
  const scheme = useAppColorScheme()

  const [loading, setLoading] = useState(!!itemId)
  const [recognizing, setRecognizing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [draftItems, setDraftItems] = useState<ExpiryDraftItem[]>([createEmptyDraft()])
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [recognitionContext, setRecognitionContext] = useState('')
  const [lastRecognizedCount, setLastRecognizedCount] = useState(0)

  const pageTitle = useMemo(() => (isEdit ? '编辑保质期' : '新增保质期'), [isEdit])
  const showPresetBlock = useMemo(
    () => !isEdit && draftItems.length === 1 && draftItems[0]?.sourceType === 'manual',
    [draftItems, isEdit],
  )

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: pageTitle })
  }, [pageTitle])

  useDidShow(() => {
    applyThemeNavigationBar(scheme)
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme)
  }, [scheme])

  const updateDraft = (clientId: string, updater: Partial<ExpiryDraftItem> | ((draft: ExpiryDraftItem) => ExpiryDraftItem)) => {
    setDraftItems((prev) =>
      prev.map((draft) => {
        if (draft.clientId !== clientId) return draft
        if (typeof updater === 'function') return updater(draft)
        return { ...draft, ...updater }
      }),
    )
  }

  const loadDetail = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    try {
      const res = await getManagedFoodExpiryItem(itemId)
      setDraftItems([buildDraftFromSavedItem(res.item)])
    } catch (error: any) {
      Taro.showToast({ title: error?.message || '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  const handleApplyPreset = (clientId: string, preset: typeof PRESET_ITEMS[number]) => {
    updateDraft(clientId, {
      foodName: preset.food_name,
      category: preset.category,
      customCategory: '',
      storageLocation: toStorageLocationLabel(preset.storage_type),
      deadlineDate: addDays(preset.days),
      sourceType: 'manual',
    })
  }

  const handleAddManualDraft = () => {
    setDraftItems((prev) => [...prev, createEmptyDraft()])
  }

  const handleRemoveDraft = (clientId: string) => {
    setDraftItems((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((draft) => draft.clientId !== clientId)
    })
  }

  const handleChooseImage = async () => {
    const remain = 5 - imagePaths.length
    if (remain <= 0) {
      Taro.showToast({ title: '最多支持 5 张图片', icon: 'none' })
      return
    }
    try {
      const res = await Taro.chooseImage({
        count: remain,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const rawPaths = (res.tempFilePaths || []).map((path) => String(path || '').trim()).filter(Boolean)
      const newPaths = await persistImagePathsImmediately(rawPaths)
      setImagePaths((prev) => [...prev, ...newPaths])
    } catch {
      // user cancelled
    }
  }

  const handleRemoveImage = (index: number) => {
    setImagePaths((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handlePreviewImage = (current: string) => {
    Taro.previewImage({
      current,
      urls: imagePaths,
    })
  }

  const handleRecognize = async () => {
    if (recognizing) return
    if (imagePaths.length === 0) {
      await handleChooseImage()
      return
    }

    setRecognizing(true)
    Taro.showLoading({ title: '上传中...', mask: true })
    try {
      const imageUrls: string[] = []
      for (const path of imagePaths) {
        const stablePath = await persistImagePathIfNeeded(path)
        const uploadPath = await compressImagePathForUpload(stablePath || path)
        try {
          const { imageUrl } = await uploadAnalyzeImageFile(uploadPath || stablePath || path)
          imageUrls.push(imageUrl)
          continue
        } catch (fileUploadError) {
          if (!shouldFallbackToLegacyAnalyzeUpload(fileUploadError)) {
            throw fileUploadError
          }
        }

        const base64 = await imageToBase64(uploadPath || stablePath || path)
        const { imageUrl } = await uploadAnalyzeImage(base64)
        imageUrls.push(imageUrl)
      }

      Taro.showLoading({ title: '识别中...', mask: true })
      const response = await recognizeManagedFoodExpiryItems(imageUrls, recognitionContext)
      const recognizedDrafts = (response.items || []).map(buildDraftFromRecognition)
      if (recognizedDrafts.length === 0) {
        throw new Error('没有识别到可录入的食物，请换个角度再试')
      }

      setDraftItems((prev) => {
        const first = prev[0]
        const hasOnlyBlankManual =
          prev.length === 1 &&
          first?.sourceType === 'manual' &&
          !first.foodName.trim() &&
          !first.quantityText.trim() &&
          !first.note.trim()
        return hasOnlyBlankManual ? recognizedDrafts : [...prev, ...recognizedDrafts]
      })
      setLastRecognizedCount(recognizedDrafts.length)
      Taro.hideLoading()
      Taro.showToast({ title: `已预填 ${recognizedDrafts.length} 项`, icon: 'success' })
    } catch (error: any) {
      Taro.hideLoading()
      const message = error?.message || '保质期识别失败'
      if (message.includes('积分不足') || message.includes('开通会员') || message.includes('升级')) {
        Taro.showModal({
          title: '积分不足',
          content: message,
          confirmText: '去开通',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              Taro.navigateTo({ url: extraPkgUrl('/pages/pro-membership/index') })
            }
          },
        })
      } else {
        Taro.showToast({ title: message, icon: 'none' })
      }
    } finally {
      Taro.hideLoading()
      setRecognizing(false)
    }
  }

  const buildPayloadFromDraft = (draft: ExpiryDraftItem): UpsertFoodExpiryItemRequest => {
    const normalizedCategory = CATEGORY_OPTIONS.includes(draft.category)
      ? draft.category.trim()
      : draft.customCategory.trim() || draft.category.trim() || '其他'
    const storageTypeFromLabel: Record<string, FoodExpiryStorageType> = {
      常温: 'room_temp',
      冷藏: 'refrigerated',
      冷冻: 'frozen',
    }
    return {
      food_name: draft.foodName.trim(),
      category: normalizedCategory,
      storage_type: storageTypeFromLabel[draft.storageLocation.trim()] || 'refrigerated',
      quantity_note: draft.quantityText.trim() || undefined,
      expire_date: draft.deadlineDate,
      note: draft.note.trim() || undefined,
      source_type: draft.sourceType,
    }
  }

  const promptExpirySubscribe = async (items: FoodExpiryItem[]) => {
    if (!items.length || !EXPIRY_SUBSCRIBE_TEMPLATE_ID) {
      return
    }

    const modalRes = await Taro.showModal({
      title: '订阅到期提醒',
      content:
        items.length === 1
          ? '是否订阅这项食物的到期提醒？到期当天会通过微信服务通知提醒你。'
          : `是否为这 ${items.length} 项新食物订阅到期提醒？到期当天会通过微信服务通知提醒你。`,
      confirmText: '去订阅',
      cancelText: '暂不',
      confirmColor: '#00bc7d',
    })
    if (!modalRes.confirm) return

    try {
      const subscribeRes = await (Taro as any).requestSubscribeMessage({
        tmplIds: [EXPIRY_SUBSCRIBE_TEMPLATE_ID],
      })
      const subscribeStatus = String((subscribeRes as any)?.[EXPIRY_SUBSCRIBE_TEMPLATE_ID] || '')
      const errMsg = (subscribeRes as any)?.errMsg
      const results = await Promise.all(
        items.map((item) =>
          subscribeManagedFoodExpiryItem(item.id, {
            subscribe_status: subscribeStatus || 'unknown',
            err_msg: errMsg,
          }).catch(() => null),
        ),
      )
      const successCount = results.filter((item) => item?.subscribed && item?.schedule_created).length
      if (successCount > 0) {
        Taro.showToast({ title: `已订阅 ${successCount} 项提醒`, icon: 'none' })
      } else {
        Taro.showToast({ title: '未订阅提醒', icon: 'none' })
      }
    } catch (error: any) {
      console.error('[expiry] requestSubscribeMessage failed:', error)
      Taro.showToast({ title: error?.message || '订阅提醒失败', icon: 'none' })
    }
  }

  const handleSubmit = async () => {
    if (submitting) return

    const filledDrafts = draftItems.filter((draft) => draft.foodName.trim())
    if (!filledDrafts.length) {
      Taro.showToast({ title: '请至少填写 1 项食物', icon: 'none' })
      return
    }

    for (const draft of filledDrafts) {
      if (!draft.deadlineDate) {
        Taro.showToast({ title: `请为「${draft.foodName || '该食物'}」选择到期日期`, icon: 'none' })
        return
      }
    }

    setSubmitting(true)
    Taro.showLoading({ title: isEdit ? '保存中...' : '创建中...', mask: true })
    try {
      const savedItems: FoodExpiryItem[] = []
      if (isEdit && itemId) {
        const payload = buildPayloadFromDraft(filledDrafts[0])
        const res = await updateManagedFoodExpiryItem(itemId, payload)
        savedItems.push(res.item)
      } else {
        for (const draft of filledDrafts) {
          const payload = buildPayloadFromDraft(draft)
          const res = await createManagedFoodExpiryItem(payload)
          savedItems.push(res.item)
        }
      }

      Taro.hideLoading()
      if (!isEdit) {
        await promptExpirySubscribe(savedItems)
      }

      Taro.eventCenter.trigger(FOOD_EXPIRY_CHANGED_EVENT)
      Taro.showToast({
        title: isEdit ? '保存成功' : savedItems.length > 1 ? `已创建 ${savedItems.length} 项` : '创建成功',
        icon: 'success',
      })

      setTimeout(() => {
        const pages = Taro.getCurrentPages()
        if (pages.length > 1) {
          Taro.navigateBack()
          return
        }
        Taro.redirectTo({ url: extraPkgUrl('/pages/expiry/index') })
      }, 300)
    } catch (error: any) {
      Taro.hideLoading()
      Taro.showToast({ title: error?.message || '提交失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const renderDraftCard = (draft: ExpiryDraftItem, index: number) => {
    const isCustomCategory = !CATEGORY_OPTIONS.includes(draft.category)
    const confidenceText =
      draft.aiMeta?.confidence != null ? `${Math.round((draft.aiMeta.confidence || 0) * 100)}%` : ''

    return (
      <View key={draft.clientId} className='expiry-draft-card'>
        <View className='expiry-draft-head'>
          <View>
            <Text className='expiry-draft-title'>食物 {index + 1}</Text>
            {draft.sourceType === 'ai' ? (
              <Text className='expiry-draft-subtitle'>AI 已预填，缺的信息继续补就可以</Text>
            ) : (
              <Text className='expiry-draft-subtitle'>手动填写一项保质期提醒</Text>
            )}
          </View>
          <View className='expiry-draft-head-actions'>
            {draft.sourceType === 'ai' ? (
              <View className='expiry-ai-badge'>
                <Text>{confidenceText ? `AI ${confidenceText}` : 'AI 识别'}</Text>
              </View>
            ) : null}
            {!isEdit && draftItems.length > 1 ? (
              <Text className='expiry-draft-remove' onClick={() => handleRemoveDraft(draft.clientId)}>
                删除
              </Text>
            ) : null}
          </View>
        </View>

        {draft.aiMeta?.expireDateIsEstimated ? (
          <View className='expiry-ai-tip'>
            <Text className='expiry-ai-tip-text'>
              到期日为 AI 建议值{draft.aiMeta?.suggestedDays != null ? `（约 ${draft.aiMeta.suggestedDays} 天）` : ''}，建议你确认包装日期后再保存。
            </Text>
          </View>
        ) : null}

        {!!draft.aiMeta?.recognitionBasis && (
          <View className='expiry-ai-tip expiry-ai-tip--soft'>
            <Text className='expiry-ai-tip-text'>{draft.aiMeta.recognitionBasis}</Text>
          </View>
        )}

        {!!draft.aiMeta?.missingFields?.length && (
          <View className='expiry-missing-row'>
            {draft.aiMeta.missingFields.map((field) => (
              <View key={field} className='expiry-missing-chip'>
                <Text>{field}</Text>
              </View>
            ))}
          </View>
        )}

        <View className='expiry-edit-block'>
          <Text className='expiry-edit-label'>食物名称</Text>
          <Input
            className='expiry-input'
            placeholder='例如 纯牛奶 / 苹果 / 昨晚剩菜'
            value={draft.foodName}
            onInput={(e) => updateDraft(draft.clientId, { foodName: e.detail.value })}
          />
        </View>

        <View className='expiry-edit-block'>
          <Text className='expiry-edit-label'>分类</Text>
          <View className='expiry-choice-list'>
            {CATEGORY_OPTIONS.map((option) => (
              <View
                key={option}
                className={`expiry-choice-chip ${!isCustomCategory && draft.category === option ? 'is-active' : ''}`}
                onClick={() => updateDraft(draft.clientId, { category: option, customCategory: '' })}
              >
                <Text>{option}</Text>
              </View>
            ))}
            <View
              className={`expiry-choice-chip ${isCustomCategory ? 'is-active' : ''}`}
              onClick={() => updateDraft(draft.clientId, { category: draft.customCategory.trim() || '自定义' })}
            >
              <Text>自定义</Text>
            </View>
          </View>
          {isCustomCategory && (
            <View className='expiry-custom-category-wrap'>
              <Input
                className='expiry-input'
                placeholder='输入自定义分类，例如 菌菇 / 预制菜 / 宠物食品'
                value={draft.customCategory}
                maxlength={20}
                onInput={(e) => {
                  const value = e.detail.value
                  updateDraft(draft.clientId, {
                    customCategory: value,
                    category: value.trim() || '自定义',
                  })
                }}
              />
            </View>
          )}
        </View>

        <View className='expiry-edit-block'>
          <Text className='expiry-edit-label'>储存方式</Text>
          <View className='expiry-choice-list'>
            {STORAGE_OPTIONS.map((option) => (
              <View
                key={option.value}
                className={`expiry-choice-chip ${draft.storageLocation === option.value ? 'is-active' : ''}`}
                onClick={() => updateDraft(draft.clientId, { storageLocation: option.value })}
              >
                <Text>{option.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='expiry-edit-block'>
          <Text className='expiry-edit-label'>数量说明</Text>
          <Input
            className='expiry-input'
            placeholder='例如 2 盒 / 半袋 / 3 个'
            value={draft.quantityText}
            onInput={(e) => updateDraft(draft.clientId, { quantityText: e.detail.value })}
          />
        </View>

        <View className='expiry-edit-block'>
          <Text className='expiry-edit-label'>到期日期</Text>
          <Picker mode='date' value={draft.deadlineDate} onChange={(e) => updateDraft(draft.clientId, { deadlineDate: e.detail.value })}>
            <View className='expiry-picker'>
              <Text>{draft.deadlineDate || '请选择到期日期'}</Text>
            </View>
          </Picker>
        </View>

        <View className='expiry-edit-block'>
          <Text className='expiry-edit-label'>备注</Text>
          <Textarea
            className='expiry-textarea'
            placeholder='例如 已经开封、准备周末吃掉、放在冰箱第二层'
            value={draft.note}
            maxlength={200}
            onInput={(e) => updateDraft(draft.clientId, { note: e.detail.value })}
          />
        </View>
      </View>
    )
  }

  return (
    <FlPageThemeRoot>
      <View className='expiry-edit-page'>
        <ScrollView scrollY className='expiry-edit-scroll'>
          <View className='expiry-edit-panel'>
            {!isEdit && (
              <View className='expiry-ai-panel'>
                <View className='expiry-ai-head'>
                  <View>
                    <Text className='expiry-ai-title'>拍照识别预填</Text>
                    <Text className='expiry-ai-desc'>支持一张图里识别多个食物，也支持多张图一起识别。AI 会先帮你填能看出来的信息，剩下的你再补。</Text>
                  </View>
                  <View className='expiry-ai-cost'>
                    <Text>2 积分/次</Text>
                  </View>
                </View>

                {imagePaths.length > 0 ? (
                  <View className='expiry-image-grid'>
                    {imagePaths.map((path, index) => (
                      <View key={`${path}-${index}`} className='expiry-image-item'>
                        <Image
                          src={path}
                          mode='aspectFill'
                          className='expiry-image-thumb'
                          onClick={() => handlePreviewImage(path)}
                        />
                        <View
                          className='expiry-image-remove'
                          onClick={(e) => {
                            e.stopPropagation?.()
                            handleRemoveImage(index)
                          }}
                        >
                          <Text>×</Text>
                        </View>
                      </View>
                    ))}
                    {imagePaths.length < 5 && (
                      <View className='expiry-image-item expiry-image-item--add' onClick={handleChooseImage}>
                        <Text className='expiry-image-add-icon'>+</Text>
                        <Text className='expiry-image-add-text'>继续加图</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View className='expiry-upload-area' onClick={handleChooseImage}>
                    <Text className='expiry-upload-icon'>+</Text>
                    <Text className='expiry-upload-title'>拍照或上传食物</Text>
                    <Text className='expiry-upload-desc'>例如冰箱里的牛奶、水果、熟食、剩菜，最多 5 张。</Text>
                  </View>
                )}

                <View className='expiry-edit-block expiry-edit-block--embedded'>
                  <Text className='expiry-edit-label'>识别补充说明</Text>
                  <Textarea
                    className='expiry-textarea expiry-textarea--compact'
                    placeholder='例如：这些都是今晚刚买的 / 里面有已经开封的酸奶 / 左边那盒是冷冻水饺'
                    value={recognitionContext}
                    maxlength={200}
                    onInput={(e) => setRecognitionContext(e.detail.value)}
                  />
                </View>

                <View className='expiry-ai-actions'>
                  <View className='expiry-ai-btn expiry-ai-btn--ghost' onClick={handleChooseImage}>
                    <Text>重新选图</Text>
                  </View>
                  <View className='expiry-ai-btn expiry-ai-btn--primary' onClick={handleRecognize}>
                    {recognizing ? <View className='expiry-loading-spinner expiry-loading-spinner--sm' /> : <Text>识别并预填</Text>}
                  </View>
                </View>

                {lastRecognizedCount > 0 ? (
                  <View className='expiry-ai-result-banner'>
                    <Text>刚刚已预填 {lastRecognizedCount} 项，下面缺的信息继续补就行。</Text>
                  </View>
                ) : null}
              </View>
            )}

            {showPresetBlock ? (
              <View className='expiry-edit-block'>
                <Text className='expiry-edit-label'>常用模板</Text>
                <View className='expiry-preset-list'>
                  {PRESET_ITEMS.map((preset) => (
                    <View
                      key={preset.food_name}
                      className='expiry-preset-chip'
                      onClick={() => handleApplyPreset(draftItems[0].clientId, preset)}
                    >
                      <Text>{preset.food_name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {loading ? (
              <View className='expiry-loading'>
                <View className='expiry-loading-spinner' />
              </View>
            ) : (
              <>
                {draftItems.map(renderDraftCard)}

                {!isEdit && (
                  <View className='expiry-add-item-bar' onClick={handleAddManualDraft}>
                    <Text>+ 手动再加一项</Text>
                  </View>
                )}

                <View className='expiry-submit-btn' onClick={handleSubmit}>
                  {submitting ? (
                    <View className='expiry-loading-spinner expiry-loading-spinner--sm' />
                  ) : (
                    <Text>{isEdit ? '保存修改' : `保存 ${draftItems.filter((draft) => draft.foodName.trim()).length || 1} 项提醒`}</Text>
                  )}
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </FlPageThemeRoot>
  )
}
