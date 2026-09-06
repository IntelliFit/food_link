import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ImagePlus,
  Images,
  RefreshCw,
  Save,
  Send,
  Utensils,
  X,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { userFacingErrorMessage } from '../utils/errors'

const MAX_IMAGES = 3
const MAX_TITLE_LENGTH = 120
const MAX_BODY_LENGTH = 2000
const DRAFT_STORAGE_KEY = 'circle_post_draft_v2'
const DRAFT_TIP_KEY = 'circle_post_draft_tip_shown_v1'

type ImageItem = {
  id: string
  url: string
  uploading?: boolean
}

type NutritionKey =
  | 'total_calories'
  | 'total_protein'
  | 'total_carbs'
  | 'total_fat'
  | 'fiber'
  | 'sugar'
  | 'sodium_mg'
  | 'total_weight_grams'

type NutritionState = Record<NutritionKey, string>
type NutritionTouched = Partial<Record<NutritionKey, boolean>>

type DraftState = {
  title?: string
  body?: string
  images?: string[] | ImageItem[]
  nutritionEnabled?: boolean
  nutrition?: Partial<NutritionState>
  savedAt?: string
}

const emptyNutrition: NutritionState = {
  total_calories: '',
  total_protein: '',
  total_carbs: '',
  total_fat: '',
  fiber: '',
  sugar: '',
  sodium_mg: '',
  total_weight_grams: '',
}

const nutritionFields: Array<{
  key: NutritionKey
  label: string
  unit: string
  max: number
}> = [
  { key: 'total_calories', label: '热量', unit: 'kcal', max: 20000 },
  { key: 'total_protein', label: '蛋白质', unit: 'g', max: 2000 },
  { key: 'total_carbs', label: '碳水', unit: 'g', max: 5000 },
  { key: 'total_fat', label: '脂肪', unit: 'g', max: 2000 },
  { key: 'fiber', label: '膳食纤维', unit: 'g', max: 2000 },
  { key: 'sugar', label: '糖分', unit: 'g', max: 2000 },
  { key: 'sodium_mg', label: '钠', unit: 'mg', max: 50000 },
  { key: 'total_weight_grams', label: '总重量', unit: 'g', max: 50000 },
]

export function CirclePostEditScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'CirclePostEdit'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const postId = route.params?.postId
  const palette = isDark ? darkPalette : lightPalette
  const styles = useMemo(() => createStyles(palette), [palette])
  const compact = width < 370

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [images, setImages] = useState<ImageItem[]>([])
  const [nutritionEnabled, setNutritionEnabled] = useState(false)
  const [nutrition, setNutrition] = useState<NutritionState>({ ...emptyNutrition })
  const [nutritionTouched, setNutritionTouched] = useState<NutritionTouched>({})
  const [hydrating, setHydrating] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [uploadingBatch, setUploadingBatch] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [sourceSheetVisible, setSourceSheetVisible] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)
  const initialSnapshotRef = useRef('')
  const allowLeaveRef = useRef(false)

  const readyImageUrls = useMemo(
    () => images.filter((item) => !item.uploading && item.url.trim()).map((item) => item.url.trim()),
    [images],
  )
  const currentSnapshot = useMemo(
    () => serializeEditor({ title, body, imageUrls: images.map((item) => item.url), nutritionEnabled, nutrition }),
    [body, images, nutrition, nutritionEnabled, title],
  )
  const dirty = Boolean(initialSnapshotRef.current) && currentSnapshot !== initialSnapshotRef.current
  const hasUploadingImages = uploadingBatch || images.some((item) => item.uploading)
  const hasPostContent = Boolean(title.trim() || body.trim() || readyImageUrls.length)
  const hasDraftContent = Boolean(title.trim() || body.trim() || readyImageUrls.length || nutritionEnabled)

  const nutritionErrors = useMemo(() => {
    const errors = {} as Record<NutritionKey, string>
    nutritionFields.forEach((field) => {
      errors[field.key] = nutritionError(field, nutrition[field.key])
    })
    return errors
  }, [nutrition])
  const hasNutritionErrors = nutritionEnabled && nutritionFields.some(({ key }) => Boolean(nutritionErrors[key]))
  const busy = hydrating || hasUploadingImages || submitting || drafting
  const canSubmit = hasPostContent && !busy && !hasNutritionErrors
  const canSaveDraft = !postId && hasDraftContent && !busy

  useEffect(() => {
    navigation.setOptions({
      title: postId ? '编辑动态' : '发布动态',
      headerStyle: { backgroundColor: palette.surface },
      headerTintColor: palette.text,
      headerShadowVisible: false,
    })
  }, [navigation, palette.surface, palette.text, postId])

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => mounted && setReduceMotion(enabled))
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  const applyLoadedState = useCallback((next: {
    title: string
    body: string
    imageUrls: string[]
    nutritionEnabled: boolean
    nutrition: NutritionState
  }) => {
    setTitle(next.title)
    setBody(next.body)
    setImages(next.imageUrls.map((url) => ({ id: url, url })))
    setNutritionEnabled(next.nutritionEnabled)
    setNutrition(next.nutrition)
    setNutritionTouched({})
    initialSnapshotRef.current = serializeEditor(next)
  }, [])

  const load = useCallback(async () => {
    setHydrating(true)
    setLoadError('')
    try {
      if (postId) {
        const response = await apiClient.communityGetContext(postId, 'circle_post')
        const record = (response.item.record || {}) as unknown as Record<string, unknown>
        const nestedNutrition = record.nutrition && typeof record.nutrition === 'object'
          ? record.nutrition as Record<string, unknown>
          : {}
        const nextNutrition = { ...emptyNutrition }
        nutritionFields.forEach(({ key }) => {
          nextNutrition[key] = numberField(record[key] ?? nestedNutrition[key])
        })
        const rawImages = Array.isArray(record.image_paths)
          ? record.image_paths
          : Array.isArray(record.image_urls)
            ? record.image_urls
            : []
        applyLoadedState({
          title: stringField(record.title),
          body: stringField(record.body || record.description),
          imageUrls: rawImages.map(stringField).filter(Boolean).slice(0, MAX_IMAGES),
          nutritionEnabled: nutritionFields.some(({ key }) => Boolean(nextNutrition[key])),
          nutrition: nextNutrition,
        })
      } else {
        const raw = await AsyncStorage.getItem(DRAFT_STORAGE_KEY)
        if (!raw) {
          applyLoadedState({ title: '', body: '', imageUrls: [], nutritionEnabled: false, nutrition: { ...emptyNutrition } })
        } else {
          const draft = JSON.parse(raw) as DraftState
          const imageUrls = Array.isArray(draft.images)
            ? draft.images
                .map((item) => typeof item === 'string' ? item : item?.url)
                .map(stringField)
                .filter(Boolean)
                .slice(0, MAX_IMAGES)
            : []
          const nextNutrition = { ...emptyNutrition }
          nutritionFields.forEach(({ key }) => {
            nextNutrition[key] = typeof draft.nutrition?.[key] === 'string' ? draft.nutrition[key] || '' : ''
          })
          applyLoadedState({
            title: typeof draft.title === 'string' ? draft.title.slice(0, MAX_TITLE_LENGTH) : '',
            body: typeof draft.body === 'string' ? draft.body.slice(0, MAX_BODY_LENGTH) : '',
            imageUrls,
            nutritionEnabled: Boolean(draft.nutritionEnabled),
            nutrition: nextNutrition,
          })
        }
      }
    } catch (error) {
      if (!postId) {
        await AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => undefined)
        applyLoadedState({ title: '', body: '', imageUrls: [], nutritionEnabled: false, nutrition: { ...emptyNutrition } })
      } else {
        setLoadError(userFacingErrorMessage(error, '动态加载失败'))
      }
    } finally {
      setHydrating(false)
    }
  }, [applyLoadedState, postId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowLeaveRef.current) return
    if (submitting || drafting || hasUploadingImages) {
      event.preventDefault()
      return
    }
    if (!dirty) return
    event.preventDefault()
    void dialog.confirm({
      title: postId ? '放弃本次修改？' : '退出动态编辑？',
      message: postId ? '尚未保存的修改会丢失。' : '尚未存为草稿的内容会丢失。',
      kind: 'warning',
      confirmText: '放弃内容',
      cancelText: '继续编辑',
    }).then((confirmed) => {
      if (!confirmed) return
      allowLeaveRef.current = true
      navigation.dispatch(event.data.action)
    })
  }), [dialog, dirty, drafting, hasUploadingImages, navigation, postId, submitting])

  const uploadAssets = useCallback(async (assets: ImagePicker.ImagePickerAsset[]) => {
    const remaining = MAX_IMAGES - images.length
    const selected = assets.slice(0, Math.max(0, remaining))
    if (!selected.length) return
    const stamp = Date.now()
    const pending = selected.map((asset, index) => ({
      id: `local-${stamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      url: asset.uri,
      uploading: true,
    }))
    setImages((current) => [...current, ...pending].slice(0, MAX_IMAGES))
    setUploadingBatch(true)
    let failures = 0
    await Promise.all(selected.map(async (asset, index) => {
      const pendingId = pending[index].id
      try {
        const uploaded = await apiClient.uploadCirclePostImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || `circle-post-${index + 1}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        })
        setImages((current) => current.map((item) => item.id === pendingId
          ? { id: uploaded.imageUrl, url: uploaded.imageUrl }
          : item))
      } catch {
        failures += 1
        setImages((current) => current.filter((item) => item.id !== pendingId))
      }
    }))
    setUploadingBatch(false)
    if (failures) {
      await dialog.alert('部分图片上传失败', failures === selected.length
        ? '图片未能上传，请检查网络后重试。'
        : `${selected.length - failures} 张已上传，${failures} 张失败，可继续补充。`, 'danger')
    } else {
      AccessibilityInfo.announceForAccessibility(`${selected.length} 张图片已上传`)
    }
  }, [dialog, images.length])

  const pickFromLibrary = useCallback(async () => {
    setSourceSheetVisible(false)
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) return
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        allowsEditing: false,
        quality: 0.86,
      })
      if (!result.canceled) await uploadAssets(result.assets)
    } catch (error) {
      await dialog.alert('无法打开相册', userFacingErrorMessage(error), 'danger')
    }
  }, [dialog, images.length, uploadAssets])

  const takePhoto = useCallback(async () => {
    setSourceSheetVisible(false)
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('需要相机权限', '请在系统设置中允许智健食探使用相机后重试。', 'warning')
        return
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.86,
      })
      if (!result.canceled && result.assets[0]) await uploadAssets([result.assets[0]])
    } catch (error) {
      await dialog.alert('无法打开相机', userFacingErrorMessage(error), 'danger')
    }
  }, [dialog, uploadAssets])

  const openImageSource = useCallback(async () => {
    if (images.length >= MAX_IMAGES) {
      await dialog.alert('图片已满', `每条动态最多添加 ${MAX_IMAGES} 张图片。`, 'warning')
      return
    }
    setSourceSheetVisible(true)
  }, [dialog, images.length])

  const removeImage = useCallback((id: string) => {
    setImages((current) => current.filter((item) => item.id !== id))
    setPreviewIndex(null)
  }, [])

  const updateNutrition = useCallback((key: NutritionKey, value: string) => {
    setNutrition((current) => ({ ...current, [key]: normalizeNumericInput(value) }))
  }, [])

  const saveDraft = useCallback(async () => {
    if (!canSaveDraft) return
    setDrafting(true)
    try {
      const tipShown = await AsyncStorage.getItem(DRAFT_TIP_KEY)
      if (!tipShown) {
        await dialog.alert(
          '草稿仅保存在本设备',
          '当前草稿只会存储在这台手机，更换设备或清理缓存后将无法查看。',
          'info',
        )
        await AsyncStorage.setItem(DRAFT_TIP_KEY, '1')
      }
      const draft: DraftState = {
        title,
        body,
        images: readyImageUrls,
        nutritionEnabled,
        nutrition,
        savedAt: new Date().toISOString(),
      }
      await AsyncStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
      initialSnapshotRef.current = currentSnapshot
      AccessibilityInfo.announceForAccessibility('草稿已保存到本机')
      await dialog.alert('草稿已保存', '下次进入发布页可以继续编辑。', 'success')
    } catch (error) {
      await dialog.alert('草稿保存失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setDrafting(false)
    }
  }, [body, canSaveDraft, currentSnapshot, dialog, nutrition, nutritionEnabled, readyImageUrls, title])

  const submit = useCallback(async () => {
    if (nutritionEnabled) {
      setNutritionTouched(Object.fromEntries(nutritionFields.map(({ key }) => [key, true])) as NutritionTouched)
    }
    if (!hasPostContent) {
      await dialog.alert('请填写动态内容', '可以填写标题、正文，或添加至少一张图片。', 'warning')
      return
    }
    if (hasUploadingImages) {
      await dialog.alert('图片仍在上传', '请等图片处理完成后再继续。', 'warning')
      return
    }
    if (hasNutritionErrors) {
      await dialog.alert('请检查营养信息', '有数值超出合理范围，请按页面提示修改。', 'warning')
      return
    }
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const input = {
        title: title.trim(),
        body: body.trim(),
        imageUrls: readyImageUrls,
        nutrition: nutritionEnabled ? buildNutritionInput(nutrition) : undefined,
      }
      if (postId) await apiClient.updateCirclePost(postId, input)
      else await apiClient.createCirclePost(input)
      if (!postId) await AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => undefined)
      allowLeaveRef.current = true
      AccessibilityInfo.announceForAccessibility(postId ? '动态修改已保存' : '动态已发布')
      await dialog.alert(postId ? '已保存' : '已发布', postId ? '动态修改已经生效。' : '动态已发布到圈子。', 'success')
      navigation.goBack()
    } catch (error) {
      await dialog.alert(postId ? '保存失败' : '发布失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setSubmitting(false)
    }
  }, [body, canSubmit, dialog, hasNutritionErrors, hasPostContent, hasUploadingImages, navigation, nutrition, nutritionEnabled, postId, readyImageUrls, title])

  if (hydrating && !loadError) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={palette.brand} accessibilityLabel={postId ? '正在读取动态' : '正在读取本机草稿'} />
      </View>
    )
  }

  if (postId && loadError) {
    return (
      <View style={styles.centerState} accessibilityRole="alert">
        <View style={styles.errorIcon}><CircleAlert size={28} color={palette.danger} /></View>
        <Text style={styles.errorTitle}>动态加载失败</Text>
        <Text style={styles.errorMessage}>{loadError}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重新加载动态"
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          onPress={() => void load()}
        >
          <RefreshCw size={18} color="#ffffff" />
          <Text style={styles.retryText}>重新加载</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 12) + 112 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>图片</Text>
              <Text style={styles.sectionHint}>支持相机或相册，最多 3 张</Text>
            </View>
            <Text style={styles.countText} accessibilityLabel={`已添加 ${images.length} 张图片，最多 ${MAX_IMAGES} 张`}>
              {images.length}/{MAX_IMAGES}
            </Text>
          </View>
          <View style={styles.imageGrid}>
            {images.map((item, index) => (
              <View key={item.id} style={styles.imageTile}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`预览第 ${index + 1} 张图片`}
                  disabled={item.uploading}
                  style={({ pressed }) => [styles.imagePreviewButton, pressed && styles.imagePressed]}
                  onPress={() => setPreviewIndex(readyImageUrls.indexOf(item.url))}
                >
                  <Image source={{ uri: item.url }} style={styles.imagePreview} resizeMode="cover" />
                  {item.uploading ? (
                    <View style={styles.imageMask}>
                      <ActivityIndicator color="#ffffff" accessibilityLabel={`第 ${index + 1} 张图片正在上传`} />
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`移除第 ${index + 1} 张图片`}
                  accessibilityState={{ disabled: item.uploading || submitting }}
                  disabled={item.uploading || submitting}
                  hitSlop={8}
                  style={({ pressed }) => [styles.removeImage, pressed && styles.pressed]}
                  onPress={() => removeImage(item.id)}
                >
                  <X size={17} color="#ffffff" strokeWidth={2.7} />
                </Pressable>
              </View>
            ))}
            {images.length < MAX_IMAGES ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加动态图片"
                accessibilityHint="选择拍照或从相册添加"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                style={({ pressed }) => [styles.imageTile, styles.addImage, pressed && !busy && styles.pressed]}
                onPress={() => void openImageSource()}
              >
                {hasUploadingImages ? <ActivityIndicator size="small" color={palette.brandStrong} /> : <ImagePlus size={27} color={palette.brandStrong} />}
                <Text style={styles.addImageText}>{hasUploadingImages ? '上传中' : '添加图片'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>动态内容</Text>
            <Text style={styles.countText}>{title.length}/{MAX_TITLE_LENGTH}</Text>
          </View>
          <Text style={styles.fieldLabel}>标题（选填）</Text>
          <TextInput
            accessibilityLabel="动态标题，可选"
            value={title}
            onChangeText={(value) => setTitle(value.slice(0, MAX_TITLE_LENGTH))}
            editable={!busy}
            maxLength={MAX_TITLE_LENGTH}
            returnKeyType="next"
            placeholder="给这条动态起个标题"
            placeholderTextColor={palette.textMuted}
            style={styles.titleInput}
          />
          <View style={styles.bodyLabelRow}>
            <Text style={styles.fieldLabel}>正文</Text>
            <Text style={styles.countText}>{body.length}/{MAX_BODY_LENGTH}</Text>
          </View>
          <TextInput
            accessibilityLabel="动态正文"
            value={body}
            onChangeText={(value) => setBody(value.slice(0, MAX_BODY_LENGTH))}
            editable={!busy}
            maxLength={MAX_BODY_LENGTH}
            multiline
            textAlignVertical="top"
            placeholder="分享你的饮食心得、运动日常…"
            placeholderTextColor={palette.textMuted}
            style={styles.bodyInput}
          />
          {!hasPostContent ? <Text style={styles.editorHint}>标题、正文或图片至少填写一项</Text> : null}
        </View>

        <View style={styles.card}>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="展示营养信息"
            accessibilityHint="开启后可填写营养数据并展示在动态卡片"
            accessibilityState={{ checked: nutritionEnabled, disabled: busy }}
            disabled={busy}
            style={({ pressed }) => [styles.nutritionToggleRow, pressed && !busy && styles.pressed]}
            onPress={() => setNutritionEnabled((current) => !current)}
          >
            <View style={styles.nutritionHeading}>
              <View style={styles.nutritionIcon}><Utensils size={19} color={palette.brandStrong} /></View>
              <View style={styles.nutritionCopy}>
                <Text style={styles.sectionTitle}>营养信息</Text>
                <Text style={styles.sectionHint}>选填，展示在动态卡片</Text>
              </View>
            </View>
            <View style={[styles.toggleTrack, nutritionEnabled && styles.toggleTrackOn]} pointerEvents="none">
              <View style={[styles.toggleThumb, nutritionEnabled && styles.toggleThumbOn]} />
            </View>
          </Pressable>

          {nutritionEnabled ? (
            <View style={styles.nutritionGrid}>
              {nutritionFields.map((field) => {
                const error = nutritionTouched[field.key] ? nutritionErrors[field.key] : ''
                return (
                  <View key={field.key} style={[styles.nutritionField, compact && styles.nutritionFieldCompact]}>
                    <Text style={styles.nutritionLabel}>{field.label}</Text>
                    <View style={[styles.nutritionInputWrap, error && styles.inputError]}>
                      <TextInput
                        accessibilityLabel={`${field.label}，单位${field.unit}`}
                        accessibilityHint={`最大值 ${field.max}`}
                        value={nutrition[field.key]}
                        onChangeText={(value) => updateNutrition(field.key, value)}
                        onBlur={() => setNutritionTouched((current) => ({ ...current, [field.key]: true }))}
                        editable={!busy}
                        keyboardType="decimal-pad"
                        maxLength={9}
                        placeholder="0"
                        placeholderTextColor={palette.textMuted}
                        style={styles.nutritionInput}
                      />
                      <Text style={styles.nutritionUnit}>{field.unit}</Text>
                    </View>
                    {error ? <Text style={styles.inlineError} accessibilityLiveRegion="polite">{error}</Text> : null}
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {!postId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="保存动态草稿"
            accessibilityState={{ disabled: !canSaveDraft, busy: drafting }}
            disabled={!canSaveDraft}
            style={({ pressed }) => [styles.draftButton, !canSaveDraft && styles.buttonDisabled, pressed && canSaveDraft && styles.pressed]}
            onPress={() => void saveDraft()}
          >
            {drafting ? <ActivityIndicator size="small" color={palette.textSecondary} /> : <Save size={18} color={canSaveDraft ? palette.text : palette.textMuted} />}
            <Text style={[styles.draftButtonText, !canSaveDraft && styles.buttonTextDisabled]}>存草稿</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={postId ? '保存动态修改' : '发布动态'}
          accessibilityState={{ disabled: !canSubmit, busy: submitting }}
          disabled={!canSubmit}
          style={({ pressed }) => [styles.submitButton, !canSubmit && styles.submitButtonDisabled, pressed && canSubmit && styles.submitButtonPressed]}
          onPress={() => void submit()}
        >
          {submitting ? <ActivityIndicator size="small" color="#ffffff" /> : <Send size={18} color="#ffffff" strokeWidth={2.5} />}
          <Text style={styles.submitButtonText}>{submitting ? (postId ? '正在保存' : '正在发布') : (postId ? '保存修改' : '发布动态')}</Text>
        </Pressable>
      </View>

      <ImageSourceSheet
        visible={sourceSheetVisible}
        reduceMotion={reduceMotion}
        palette={palette}
        styles={styles}
        insetsBottom={insets.bottom}
        onCamera={() => void takePhoto()}
        onLibrary={() => void pickFromLibrary()}
        onClose={() => setSourceSheetVisible(false)}
      />
      <ImagePreview
        index={previewIndex}
        images={readyImageUrls}
        reduceMotion={reduceMotion}
        styles={styles}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(null)}
      />
    </KeyboardAvoidingView>
  )
}

function ImageSourceSheet({ visible, reduceMotion, palette, styles, insetsBottom, onCamera, onLibrary, onClose }: {
  visible: boolean
  reduceMotion: boolean
  palette: Palette
  styles: ReturnType<typeof createStyles>
  insetsBottom: number
  onCamera: () => void
  onLibrary: () => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable
          style={styles.sheetDismiss}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭图片来源选择"
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insetsBottom, 18) }]} accessibilityViewIsModal>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>添加图片</Text>
          <Text style={styles.sheetHint}>选择拍照，或从相册一次添加多张</Text>
          <View style={styles.sourceActions}>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.sourceButton, pressed && styles.pressed]} onPress={onCamera}>
              <View style={styles.sourceIcon}><Camera size={23} color={palette.brandStrong} /></View>
              <Text style={styles.sourceButtonText}>拍照</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.sourceButton, pressed && styles.pressed]} onPress={onLibrary}>
              <View style={styles.sourceIcon}><Images size={23} color={palette.brandStrong} /></View>
              <Text style={styles.sourceButtonText}>从相册选择</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.sheetCancel, pressed && styles.pressed]} onPress={onClose}>
            <Text style={styles.sheetCancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

function ImagePreview({ index, images, reduceMotion, styles, onIndexChange, onClose }: {
  index: number | null
  images: string[]
  reduceMotion: boolean
  styles: ReturnType<typeof createStyles>
  onIndexChange: (index: number | null) => void
  onClose: () => void
}) {
  const safeIndex = index == null ? 0 : Math.max(0, Math.min(index, images.length - 1))
  return (
    <Modal visible={index != null && Boolean(images[safeIndex])} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <View style={styles.previewBackdrop} accessibilityViewIsModal>
        <Image source={{ uri: images[safeIndex] }} style={styles.fullImage} resizeMode="contain" accessibilityLabel={`第 ${safeIndex + 1} 张动态图片`} />
        <Text style={styles.previewCount}>{safeIndex + 1}/{images.length}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={({ pressed }) => [styles.previewClose, pressed && styles.pressed]} onPress={onClose}>
          <X size={24} color="#ffffff" />
        </Pressable>
        {images.length > 1 ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="上一张图片"
              accessibilityState={{ disabled: safeIndex === 0 }}
              disabled={safeIndex === 0}
              style={({ pressed }) => [styles.previewPrevious, safeIndex === 0 && styles.previewControlDisabled, pressed && styles.pressed]}
              onPress={() => onIndexChange(safeIndex - 1)}
            >
              <ChevronLeft size={28} color="#ffffff" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="下一张图片"
              accessibilityState={{ disabled: safeIndex === images.length - 1 }}
              disabled={safeIndex === images.length - 1}
              style={({ pressed }) => [styles.previewNext, safeIndex === images.length - 1 && styles.previewControlDisabled, pressed && styles.pressed]}
              onPress={() => onIndexChange(safeIndex + 1)}
            >
              <ChevronRight size={28} color="#ffffff" />
            </Pressable>
          </>
        ) : null}
      </View>
    </Modal>
  )
}

function serializeEditor(input: {
  title: string
  body: string
  imageUrls: string[]
  nutritionEnabled: boolean
  nutrition: NutritionState
}): string {
  return JSON.stringify({
    title: input.title,
    body: input.body,
    imageUrls: input.imageUrls,
    nutritionEnabled: input.nutritionEnabled,
    nutrition: input.nutrition,
  })
}

function normalizeNumericInput(value: string): string {
  const numeric = value.replace(/[^\d.]/g, '')
  const [whole = '', ...decimalParts] = numeric.split('.')
  return decimalParts.length ? `${whole}.${decimalParts.join('')}` : whole
}

function nutritionError(field: { label: string; unit: string; max: number }, value: string): string {
  if (!value.trim()) return ''
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return `请输入有效的${field.label}数值`
  if (numeric > field.max) return `${field.label}不能超过 ${field.max}${field.unit}`
  return ''
}

function buildNutritionInput(state: NutritionState) {
  const result: Partial<Record<NutritionKey, number>> = {}
  nutritionFields.forEach(({ key }) => {
    const value = Number(state[key])
    if (state[key].trim() && Number.isFinite(value)) result[key] = value
  })
  return Object.keys(result).length ? result : undefined
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberField(value: unknown): string {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? String(numeric) : ''
}

type Palette = typeof lightPalette

const lightPalette = {
  page: '#f8faf9',
  surface: '#ffffff',
  surfaceMuted: '#f2f6f4',
  border: '#dbe6e1',
  text: '#15231d',
  textSecondary: '#52655d',
  textMuted: '#83928b',
  brand: '#00ad73',
  brandStrong: '#087653',
  brandSoft: '#e7f8f1',
  danger: '#dc2626',
  dangerSoft: '#fff1f2',
  disabled: '#cbd5d1',
}

const darkPalette: Palette = {
  page: '#101716',
  surface: '#1a2220',
  surfaceMuted: '#222c29',
  border: '#365047',
  text: '#edf4f0',
  textSecondary: '#bdcbc5',
  textMuted: '#8fa19a',
  brand: '#21bd84',
  brandStrong: '#7ce0b7',
  brandSoft: '#17372d',
  danger: '#fb7185',
  dangerSoft: '#431d25',
  disabled: '#44534e',
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: palette.page },
    scroll: { flex: 1 },
    centerState: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.page },
    errorIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.dangerSoft },
    errorTitle: { marginTop: 14, color: palette.text, fontSize: 18, lineHeight: 25, fontWeight: '800' },
    errorMessage: { marginTop: 7, color: palette.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    retryButton: { minWidth: 144, minHeight: 48, marginTop: 20, paddingHorizontal: 20, borderRadius: 24, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brand },
    retryText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
    card: { marginBottom: 14, padding: 16, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.border, backgroundColor: palette.surface },
    sectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionTitle: { color: palette.text, fontSize: 16, lineHeight: 23, fontWeight: '800' },
    sectionHint: { marginTop: 2, color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    countText: { color: palette.textMuted, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] },
    imageGrid: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    imageTile: { width: '31%', aspectRatio: 1, minHeight: 82, borderRadius: 16, overflow: 'hidden', backgroundColor: palette.surfaceMuted },
    imagePreviewButton: { width: '100%', height: '100%' },
    imagePreview: { width: '100%', height: '100%' },
    imagePressed: { opacity: 0.84 },
    imageMask: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.46)' },
    removeImage: { position: 'absolute', top: 4, right: 4, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,20,18,0.76)' },
    addImage: { borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border, alignItems: 'center', justifyContent: 'center', gap: 7 },
    addImageText: { color: palette.brandStrong, fontSize: 12, lineHeight: 17, fontWeight: '700' },
    fieldLabel: { marginTop: 12, color: palette.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    titleInput: { minHeight: 52, marginTop: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: palette.border, color: palette.text, backgroundColor: palette.surfaceMuted, fontSize: 16, lineHeight: 23, fontWeight: '700' },
    bodyLabelRow: { marginTop: 4, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
    bodyInput: { minHeight: 148, marginTop: 7, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 15, borderWidth: 1, borderColor: palette.border, color: palette.text, backgroundColor: palette.surfaceMuted, fontSize: 15, lineHeight: 23 },
    editorHint: { marginTop: 8, color: palette.textMuted, fontSize: 12, lineHeight: 18 },
    nutritionToggleRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    nutritionHeading: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
    nutritionIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    nutritionCopy: { flex: 1, minWidth: 0 },
    toggleTrack: { width: 48, height: 28, padding: 3, borderRadius: 14, justifyContent: 'center', backgroundColor: palette.disabled },
    toggleTrackOn: { backgroundColor: palette.brand },
    toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#ffffff' },
    toggleThumbOn: { alignSelf: 'flex-end' },
    nutritionGrid: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
    nutritionField: { width: '48.3%' },
    nutritionFieldCompact: { width: '100%' },
    nutritionLabel: { marginBottom: 6, color: palette.textSecondary, fontSize: 13, lineHeight: 19, fontWeight: '700' },
    nutritionInputWrap: { minHeight: 52, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: palette.border, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surfaceMuted },
    nutritionInput: { flex: 1, minWidth: 0, minHeight: 50, paddingVertical: 0, color: palette.text, textAlign: 'right', fontSize: 15, lineHeight: 21 },
    nutritionUnit: { minWidth: 36, marginLeft: 7, color: palette.textMuted, textAlign: 'right', fontSize: 12, lineHeight: 18 },
    inputError: { borderColor: palette.danger },
    inlineError: { marginTop: 5, color: palette.danger, fontSize: 11, lineHeight: 16 },
    footer: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, flexDirection: 'row', gap: 10, backgroundColor: palette.surface },
    draftButton: { minWidth: 112, minHeight: 52, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: palette.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: palette.surfaceMuted },
    draftButtonText: { color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    submitButton: { flex: 1, minHeight: 52, paddingHorizontal: 18, borderRadius: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.brand },
    submitButtonDisabled: { backgroundColor: palette.disabled },
    submitButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
    submitButtonText: { color: '#ffffff', fontSize: 15, lineHeight: 21, fontWeight: '900' },
    buttonDisabled: { opacity: 0.58 },
    buttonTextDisabled: { color: palette.textMuted },
    pressed: { opacity: 0.72 },
    sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,13,10,0.58)' },
    sheetDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    sheet: { paddingHorizontal: 18, paddingTop: 10, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: palette.surface },
    sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: palette.border },
    sheetTitle: { marginTop: 14, color: palette.text, textAlign: 'center', fontSize: 18, lineHeight: 25, fontWeight: '900' },
    sheetHint: { marginTop: 4, color: palette.textMuted, textAlign: 'center', fontSize: 13, lineHeight: 19 },
    sourceActions: { marginTop: 18, flexDirection: 'row', gap: 12 },
    sourceButton: { flex: 1, minHeight: 92, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.surfaceMuted },
    sourceIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.brandSoft },
    sourceButtonText: { color: palette.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    sheetCancel: { minHeight: 50, marginTop: 12, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    sheetCancelText: { color: palette.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '800' },
    previewBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050807' },
    fullImage: { width: '100%', height: '100%' },
    previewCount: { position: 'absolute', top: 54, alignSelf: 'center', minWidth: 52, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, overflow: 'hidden', color: '#ffffff', textAlign: 'center', fontSize: 13, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.58)' },
    previewClose: { position: 'absolute', top: 44, right: 16, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
    previewPrevious: { position: 'absolute', left: 12, top: '48%', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
    previewNext: { position: 'absolute', right: 12, top: '48%', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
    previewControlDisabled: { opacity: 0.28 },
  })
}
