import { useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AccessibilityInfo, ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  type ActivityTiming,
  type AnalysisEngine,
  type AnalyzeVideoUploadResult,
  type ExecutionMode,
  type MealType,
  type MembershipStatus,
  type PrecisionCaptureReferenceInput,
  type PrecisionCaptureViewInput,
  type PrecisionOptionsInput,
  inferDefaultMealTypeFromLocalTime,
} from '@food-link/core'
import {
  Camera,
  Check,
  Coffee,
  Cookie,
  Dumbbell,
  History,
  Image as ImageIcon,
  Info,
  Moon,
  RotateCcw,
  Soup,
  Sparkles,
  Utensils,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient } from '../api'
import { PrecisionVideoCapture, type PrecisionVideoProcessStage } from '../components/PrecisionVideoCapture'
import { SHOW_DEBUG_LOGIN } from '../config'
import type { RootStackParamList } from '../navigation/types'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { useAppDialog } from '../providers/DialogProvider'
import { todayKey } from '../utils/date'
import { createDemoAnalysisTask, createDemoTextAnalysisTask, demoFoodImageUrl } from '../utils/demoAnalysisTask'
import { userFacingErrorMessage } from '../utils/errors'
import { readSuggestRatioPreference, writeSuggestRatioPreference } from '../utils/analysisPreferences'
import {
  compressAnalyzeVideoToLimit,
  getAnalyzeVideoFileSize,
  isVideoKeyframeCaptureComplete,
  MAX_ANALYZE_VIDEO_DURATION_MS,
  MAX_ANALYZE_VIDEO_SIZE_BYTES,
  MIN_ANALYZE_VIDEO_DURATION_MS,
} from '../utils/analyzeVideo'
type AnalyzeRoute = RouteProp<RootStackParamList, 'Analyze'>
type AnalyzeBaseMode = 'fast' | 'standard' | 'strict'
type PrecisionCaptureMode = 'photos' | 'video'
type AnalyzeImageAsset = ImagePicker.ImagePickerAsset
type HelpSheetState = { title: string; content: string } | null

type AnalyzeTheme = {
  page: string
  surface: string
  surfaceMuted: string
  surfaceStrong: string
  text: string
  secondary: string
  muted: string
  border: string
  divider: string
  accent: string
  accentStrong: string
  accentText: string
  accentSoft: string
  accentBorder: string
  onAccent: string
  disabled: string
  disabledText: string
  knob: string
  warningSurface: string
  warningText: string
  danger: string
  dangerSurface: string
  footer: string
  scrim: string
  shadow: string
  videoSurface: string
}

const LIGHT_ANALYZE_THEME: AnalyzeTheme = {
  page: '#f7f8fa',
  surface: '#ffffff',
  surfaceMuted: '#f8fafc',
  surfaceStrong: '#eef1f5',
  text: '#111827',
  secondary: '#475569',
  muted: '#94a3b8',
  border: '#dbe4e0',
  divider: 'rgba(15,23,42,0.06)',
  accent: '#00bc7d',
  accentStrong: '#00a870',
  accentText: '#047857',
  accentSoft: '#ecfdf5',
  accentBorder: 'rgba(0,188,125,0.28)',
  onAccent: '#ffffff',
  disabled: '#e5e7eb',
  disabledText: '#9ca3af',
  knob: '#ffffff',
  warningSurface: '#fff7ed',
  warningText: '#9a3412',
  danger: '#ef4444',
  dangerSurface: '#fff7f7',
  footer: 'rgba(247,248,250,0.96)',
  scrim: 'rgba(15,23,42,0.45)',
  shadow: '#000000',
  videoSurface: '#0f172a',
}

const DARK_ANALYZE_THEME: AnalyzeTheme = {
  page: '#111716',
  surface: '#1e2624',
  surfaceMuted: '#27322f',
  surfaceStrong: '#2d3634',
  text: '#f2f7f4',
  secondary: 'rgba(214,226,220,0.76)',
  muted: 'rgba(214,226,220,0.52)',
  border: 'rgba(214,226,220,0.16)',
  divider: 'rgba(214,226,220,0.10)',
  accent: '#4a9d7d',
  accentStrong: '#6ee7b7',
  accentText: '#7dd3b0',
  accentSoft: '#18332a',
  accentBorder: '#3d5d51',
  onAccent: '#f3fbf7',
  disabled: '#27322f',
  disabledText: '#9ca3a8',
  knob: '#edf5f1',
  warningSurface: 'rgba(154,52,18,0.22)',
  warningText: '#fdba74',
  danger: '#f87171',
  dangerSurface: 'rgba(127,29,29,0.28)',
  footer: '#111716',
  scrim: 'rgba(0,0,0,0.58)',
  shadow: '#000000',
  videoSurface: '#0f172a',
}

const MAX_ANALYZE_IMAGES = 5
const ANALYSIS_ENGINE_STORAGE_KEY = 'mobile_analysis_engine_v1'

const ANALYSIS_ENGINE_OPTIONS: Array<{ value: AnalysisEngine; label: string; description: string }> = [
  { value: 'ai_direct', label: 'AI估算', description: '速度最快，完整理解描述，不套标准食物库' },
  { value: 'ai_then_db_exact', label: '标准库校准', description: '速度较慢；精确命中时营养和微量元素更稳定' },
  { value: 'db_candidates_ai', label: '数据库候选', description: '速度较慢；AI复核候选，微量元素通常更准确' },
]



const MODE_OPTIONS: Array<{ value: AnalyzeBaseMode; label: string; desc: string }> = [
  { value: 'fast', label: '快速', desc: '更快出结果，适合先记录下来。' },
  { value: 'standard', label: '普通', desc: '日常推荐，兼顾速度和准确度。' },
  { value: 'strict', label: '精准', desc: '更细估重，适合复杂餐盘。' },
]

const MEAL_OPTIONS: Array<{ value: MealType; label: string; icon: LucideIcon }> = [
  { value: 'breakfast', label: '早餐', icon: Coffee },
  { value: 'morning_snack', label: '早加餐', icon: Cookie },
  { value: 'lunch', label: '午餐', icon: Soup },
  { value: 'afternoon_snack', label: '午加餐', icon: Utensils },
  { value: 'dinner', label: '晚餐', icon: Moon },
  { value: 'evening_snack', label: '晚加餐', icon: Cookie },
]

const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string; icon: LucideIcon }> = [
  { value: 'post_workout', label: '练后', icon: Dumbbell },
  { value: 'daily', label: '日常', icon: Check },
  { value: 'before_sleep', label: '睡前', icon: Moon },
  { value: 'none', label: '无', icon: Sparkles },
]

const HELP_TEXT = {
  photo: [
    '1. 尽量让食物完整出现在画面里。',
    '2. 光线偏暗时打开闪光灯或换到明亮位置。',
    '3. 多道菜可以一次拍全，也可以补充多张角度图。',
  ].join('\n'),
  video: [
    '1. 可以自然横扫或逐个靠近食物。',
    '2. 每种食物尽量清楚停留约半秒。',
    '3. 尽量带到一帧整餐全景和一帧侧面高度。',
    '4. 有参考物时让它随餐入镜。',
    '5. 建议录制 4–8 秒，最长 12 秒。',
  ].join('\n'),
  text: '补充“学校食堂大份”“额外加辣油”“饭盒约 500ml”这类上下文，AI 会用它修正重量和食材判断。',
  engine: 'AI估算速度最快；标准库校准和数据库候选需要额外查询与复核，命中兼容数据时营养结果更稳定，微量元素通常也更准确。',
  webSearch: '联网校准会参考品牌、包装规格或常见菜品信息，适合外卖、预包装食品和校园餐。',
  separate: '分项模式只在精准模式下可用，会尽量把每一种食物拆开估重。',
  multiView: '多视角辅助适合上传 2-5 张同一餐盘的不同角度，帮助判断隐藏食材和体积。',
  interactive: '精准模式默认开启。只有食物身份、状态口径、参考尺度或关键烹饪信息不清楚时才暂停，每轮最多 3 个问题；也可以按当前信息继续估算。',
  ratio: 'AI 摄入比例会给出可食用比例建议，适合吃剩、多人分食或只吃部分餐品的场景。',
  meal: '餐次会影响当日记录归类，也会作为营养建议的参考。',
  timing: '运动时机会影响补给建议，例如练后更关注蛋白质与碳水恢复。',
}

const resolveExecutionModeFromOptions = (
  baseMode: AnalyzeBaseMode,
  webSearchEnabled: boolean,
  separateFoodEstimateEnabled: boolean,
): ExecutionMode => {
  if (baseMode === 'fast') return webSearchEnabled ? 'fast_web_search' : 'fast'
  if (baseMode === 'standard') return webSearchEnabled ? 'standard_web_search' : 'standard'
  if (webSearchEnabled) return 'strict_web_search'
  if (separateFoodEstimateEnabled) return 'strict_separate'
  return 'strict'
}

export function AnalyzeScreen() {
  const { styles, theme } = useAnalyzeUi()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<AnalyzeRoute>()
  const dialog = useAppDialog()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(false)
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [membership, setMembership] = useState<MembershipStatus | null>(null)
  const carriedPrecisionImageUris = route.params?.precisionImageUris || []
  const routePrecisionOptions = route.params?.precisionOptions
  const [imageAssets, setImageAssets] = useState<AnalyzeImageAsset[]>([])
  const [precisionAssets, setPrecisionAssets] = useState<Array<AnalyzeImageAsset | null>>(() => [0, 1].map((index) => {
    const uri = String(carriedPrecisionImageUris[index] || '').trim()
    return uri ? ({ uri } as AnalyzeImageAsset) : null
  }))
  const [precisionCaptureMode, setPrecisionCaptureMode] = useState<PrecisionCaptureMode>(() => (
    route.params?.precisionCaptureMode === 'video' ? 'video' : 'photos'
  ))
  const [selectedVideo, setSelectedVideo] = useState<AnalyzeImageAsset | null>(null)
  const [videoUploadResult, setVideoUploadResult] = useState<AnalyzeVideoUploadResult | null>(null)
  const [videoProcessStage, setVideoProcessStage] = useState<PrecisionVideoProcessStage>('idle')
  const [videoProgress, setVideoProgress] = useState(0)
  const [framePreviewUri, setFramePreviewUri] = useState('')
  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const precisionSessionId = String(route.params?.precisionSessionId || '').trim()
  const carriedReferenceObjects = route.params?.referenceObjects || []
  const [baseMode, setBaseMode] = useState<AnalyzeBaseMode>(precisionSessionId ? 'strict' : 'standard')
  const [analysisEngine, setAnalysisEngine] = useState<AnalysisEngine>(() => precisionSessionId ? 'db_candidates_ai' : 'ai_direct')
  const [webSearchEnabled, setWebSearchEnabled] = useState(Boolean(routePrecisionOptions?.web_search))
  const [separateFoodEstimateEnabled, setSeparateFoodEstimateEnabled] = useState(Boolean(routePrecisionOptions?.separate))
  const [multiViewEnabled, setMultiViewEnabled] = useState(false)
  const [precisionInteractiveEnabled, setPrecisionInteractiveEnabled] = useState(routePrecisionOptions?.interactive !== false)
  const [referencePresence, setReferencePresence] = useState<'present' | 'absent'>('present')
  const [referenceShape, setReferenceShape] = useState<'rectangle' | 'circle' | 'custom'>('rectangle')
  const [referenceKind, setReferenceKind] = useState('标准卡片')
  const [referenceLength, setReferenceLength] = useState('85.6')
  const [referenceWidth, setReferenceWidth] = useState('53.98')
  const [referenceDiameter, setReferenceDiameter] = useState('')
  const [referencePlacement, setReferencePlacement] = useState('')
  const [suggestRatioEnabled, setSuggestRatioEnabled] = useState(true)

  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [additionalContext, setAdditionalContext] = useState('')
  const [helpSheet, setHelpSheet] = useState<HelpSheetState>(null)
  const submitInFlightRef = useRef(false)
  const date = route.params?.date || todayKey()

  const executionMode = useMemo(
    () => precisionSessionId
      ? 'strict'
      : resolveExecutionModeFromOptions(baseMode, webSearchEnabled, separateFoodEstimateEnabled),
    [baseMode, precisionSessionId, webSearchEnabled, separateFoodEstimateEnabled],
  )
  const isVideoCaptureSelected = baseMode === 'strict' && precisionCaptureMode === 'video'
  const photoPrecisionCaptureComplete = Boolean(
    precisionAssets[0]?.uri
    && precisionAssets[1]?.uri
    && precisionAssets[0]?.uri !== precisionAssets[1]?.uri,
  )
  const videoCaptureComplete = isVideoKeyframeCaptureComplete(videoUploadResult?.keyframes || [])
  const precisionCaptureComplete = isVideoCaptureSelected ? videoCaptureComplete : photoPrecisionCaptureComplete
  const activeImageAssets = isVideoCaptureSelected
    ? (videoUploadResult?.keyframes || []).map((frame) => ({ uri: frame.image_url } as AnalyzeImageAsset))
    : baseMode === 'strict'
      ? precisionAssets.filter((asset): asset is AnalyzeImageAsset => Boolean(asset?.uri))
      : imageAssets
  const videoBusy = videoProcessStage !== 'idle'
  const quota = useMemo(() => buildAnalyzeQuota(membership), [membership])
  const canUseStrictMode = canUseStrictModeForMembership(membership)
  const strictModeAuthorized = Boolean(precisionSessionId) || canUseStrictMode

  const requiredCredits = isPrecisionExecutionMode(executionMode) ? 4 : 2
  const isQuotaExhausted = Boolean(quota && quota.remaining < requiredCredits)
  const confirmDisabled = loading || videoBusy || activeImageAssets.length === 0 || isQuotaExhausted || (baseMode === 'strict' && !precisionCaptureComplete)
  const bottomInset = Math.max(insets.bottom, 12)

  const pickImages = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('需要相机权限', '请允许使用相机拍摄食物图片。', 'warning')
        return
      }
    }

    const picked = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          allowsMultipleSelection: true,
          selectionLimit: MAX_ANALYZE_IMAGES,
          quality: 0.85,
        })
    if (picked.canceled || !picked.assets[0]) return

    const nextAssets = picked.assets.slice(0, MAX_ANALYZE_IMAGES)
    setImageAssets((current) => [...current, ...nextAssets].slice(0, MAX_ANALYZE_IMAGES))
  }

  const pickPrecisionImage = async (slotIndex: 0 | 1, source: 'camera' | 'library') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('需要相机权限', '请允许使用相机拍摄食物图片。', 'warning')
        return
      }
    }
    const picked = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          allowsMultipleSelection: false,
          selectionLimit: 1,
          quality: 0.9,
        })
    if (picked.canceled || !picked.assets[0]) return
    const asset = picked.assets[0]
    const otherIndex = slotIndex === 0 ? 1 : 0
    if (precisionAssets[otherIndex]?.uri === asset.uri) {
      await dialog.alert('请选择不同角度', '俯拍和 45° 斜拍不能使用同一张图片。', 'warning')
      return
    }
    setPrecisionAssets((current) => {
      const nextSlots: Array<AnalyzeImageAsset | null> = [current[0] || null, current[1] || null]
      nextSlots[slotIndex] = asset
      return nextSlots
    })
  }

  const selectPrecisionCaptureMode = (mode: PrecisionCaptureMode) => {
    if (videoBusy || mode === precisionCaptureMode) return
    setPrecisionCaptureMode(mode)
    setPrecisionAssets([null, null])
  }

  const clearPrecisionVideo = () => {
    if (videoBusy) return
    setSelectedVideo(null)
    setVideoUploadResult(null)
    setVideoProgress(0)
  }

  const processSelectedAnalyzeVideo = async (asset: AnalyzeImageAsset) => {
    setVideoUploadResult(null)
    setVideoProcessStage('compressing')
    setVideoProgress(1)
    try {
      const initialSize = Number(asset.fileSize || 0) || await getAnalyzeVideoFileSize(asset.uri)
      if (!initialSize) throw new Error('无法读取视频大小，请重新选择')
      const compressed = await compressAnalyzeVideoToLimit(
        { uri: asset.uri, size: initialSize },
        setVideoProgress,
      )
      if (!compressed.uri || compressed.size <= 0 || compressed.size > MAX_ANALYZE_VIDEO_SIZE_BYTES) {
        throw new Error('视频压缩后仍超过 8MB，请缩短后重试')
      }
      const readyAsset: AnalyzeImageAsset = {
        ...asset,
        uri: compressed.uri,
        fileSize: compressed.size,
      }
      setSelectedVideo(readyAsset)
      setVideoProcessStage('uploading')
      setVideoProgress(1)
      const uploaded = await apiClient.uploadAnalyzeVideoFile({
        fileUri: readyAsset.uri,
        fileName: readyAsset.fileName || 'food-video.mp4',
        mimeType: readyAsset.mimeType || 'video/mp4',
        onProgress: setVideoProgress,
      })
      setVideoUploadResult(uploaded)
      setVideoProgress(100)
      AccessibilityInfo.announceForAccessibility(`已提取 ${uploaded.keyframes.length} 个关键帧`)
    } catch (error) {
      setVideoProgress(0)
      await dialog.alert('视频处理失败', userFacingErrorMessage(error, '请重新录制或选择视频。'), 'danger')
    } finally {
      setVideoProcessStage('idle')
    }
  }

  const pickPrecisionVideo = async (source: 'camera' | 'library') => {
    if (videoBusy) return
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        await dialog.alert('需要相机权限', '请允许使用相机录制食物短视频。', 'warning')
        return
      }
    }
    try {
      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['videos'],
            allowsEditing: false,
            videoMaxDuration: MAX_ANALYZE_VIDEO_DURATION_MS / 1000,
            videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
            cameraType: ImagePicker.CameraType.back,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['videos'],
            allowsEditing: false,
            allowsMultipleSelection: false,
            selectionLimit: 1,
            videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
          })
      if (picked.canceled || !picked.assets[0]) return
      const asset = picked.assets[0]
      const durationMs = Number(asset.duration || 0)
      if (durationMs < MIN_ANALYZE_VIDEO_DURATION_MS) {
        await dialog.alert('视频太短', '请至少录制 2 秒，让每种食物都有清楚画面。', 'warning')
        return
      }
      if (durationMs > MAX_ANALYZE_VIDEO_DURATION_MS + 250) {
        await dialog.alert('视频太长', '视频最长支持 12 秒，请缩短后重试。', 'warning')
        return
      }
      setSelectedVideo(asset)
      await processSelectedAnalyzeVideo(asset)
    } catch (error) {
      await dialog.alert('选择视频失败', userFacingErrorMessage(error, '请重新录制或从相册选择。'), 'danger')
    }
  }
  useEffect(() => {
    let active = true
    setMembershipLoading(true)
    apiClient.getMyMembership(date)
      .then((status) => {
        if (active) setMembership(status)
      })
      .catch(() => {
        if (active) setMembership(null)
      })
      .finally(() => {
        if (active) setMembershipLoading(false)
      })
    return () => {
      active = false
    }
  }, [date])

  useEffect(() => {
    let active = true
    Promise.all([
      apiClient.getHealthProfile().catch(() => null),
      AsyncStorage.getItem(ANALYSIS_ENGINE_STORAGE_KEY),
      readSuggestRatioPreference(),
    ]).then(([profile, storedEngine, storedSuggestRatio]) => {
      if (!active) return
      setSuggestRatioEnabled(storedSuggestRatio)
      if (precisionSessionId) {
        setAnalysisEngine(normalizeAnalysisEngine(storedEngine, 'strict'))
        return
      }
      const profileMode = normalizeAvailableExecutionMode(profile?.execution_mode)
      setBaseMode(resolveAnalyzeBaseMode(profileMode))
      setWebSearchEnabled(isWebSearchExecutionMode(profileMode))
      setSeparateFoodEstimateEnabled(profileMode === 'strict_separate')
      setAnalysisEngine(normalizeAnalysisEngine(storedEngine, profileMode))
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [precisionSessionId])

  useEffect(() => {
    if (route.params?.source) {
      void pickImages(route.params.source)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (baseMode !== 'strict' && separateFoodEstimateEnabled) {
      setSeparateFoodEstimateEnabled(false)
    }
  }, [baseMode, separateFoodEstimateEnabled])

  useEffect(() => {
    if (baseMode !== 'strict' || imageAssets.length === 0) return
    setPrecisionAssets((current) => {
      if (current[0]?.uri || current[1]?.uri) return current
      return [imageAssets[0] || null, imageAssets[1] || null]
    })
  }, [baseMode, imageAssets])

  useEffect(() => {
    if (!membership || strictModeAuthorized || baseMode !== 'strict') return
    setBaseMode('standard')
    setSeparateFoodEstimateEnabled(false)
  }, [baseMode, membership, strictModeAuthorized])

  const promptStrictModeUpgrade = async (status: MembershipStatus | null = membership) => {
    if (!status && membershipLoading) {
      await dialog.alert('会员信息尚未就绪', '请稍后再选择精准模式。', 'info')
      return
    }
    const isLightMember = Boolean(status?.is_pro && String(status.current_plan_code || '').startsWith('light_'))
    const result = await dialog.showDialog({
      title: '解锁精准模式',
      message: isLightMember
        ? '你当前是轻度版，暂不支持精准模式。升级到标准版或进阶版后即可使用。'
        : '精准模式仅对标准版和进阶版开放。',
      kind: 'warning',
      cancelText: '取消',
      confirmText: isLightMember ? '去升级' : '去开通',
    })
    if (result === 'confirm') navigation.navigate('MembershipCenter')
  }

  const selectBaseMode = async (nextMode: AnalyzeBaseMode) => {
    if (precisionSessionId && nextMode !== 'strict') {
      await dialog.alert('正在继续精准会话', '重拍会继续当前精准估计，本轮不能切换为其他模式。', 'info')
      return
    }
    if (nextMode === 'strict' && !strictModeAuthorized) {
      await promptStrictModeUpgrade()
      return
    }
    if (nextMode === 'strict' && !precisionAssets[0] && !precisionAssets[1] && imageAssets.length > 0) {
      setPrecisionAssets([imageAssets[0] || null, imageAssets[1] || null])
    }
    setBaseMode(nextMode)
    const nextModeValue = resolveExecutionModeFromOptions(nextMode, nextMode === 'strict' ? false : webSearchEnabled, false)
    const nextEngine = defaultAnalysisEngineForMode(nextModeValue)
    setAnalysisEngine(nextEngine)
    void AsyncStorage.setItem(ANALYSIS_ENGINE_STORAGE_KEY, nextEngine)
  }

  const selectAnalysisEngine = (nextEngine: AnalysisEngine) => {
    setAnalysisEngine(nextEngine)
    void AsyncStorage.setItem(ANALYSIS_ENGINE_STORAGE_KEY, nextEngine)
  }

  const toggleSeparateFoodEstimate = async () => {
    if (!strictModeAuthorized) {
      await promptStrictModeUpgrade()
      return
    }
    setSeparateFoodEstimateEnabled((value) => !value)
  }

  const removeImage = (uri: string) => {
    setImageAssets((current) => current.filter((asset) => asset.uri !== uri))
  }

  const removePrecisionImage = (slotIndex: 0 | 1) => {
    setPrecisionAssets((current) => {
      const nextSlots: Array<AnalyzeImageAsset | null> = [current[0] || null, current[1] || null]
      nextSlots[slotIndex] = null
      return nextSlots
    })
  }

  const buildPrecisionReferenceObject = (): PrecisionCaptureReferenceInput => {
    if (referencePresence === 'absent') return { presence: 'absent' }
    const dimensions: Record<string, number> = {}
    const length = positiveNumber(referenceLength)
    const width = positiveNumber(referenceWidth)
    const diameter = positiveNumber(referenceDiameter)
    if (referenceShape === 'circle') {
      if (diameter != null) dimensions.diameter = diameter
    } else {
      if (length != null) dimensions.length = length
      if (width != null) dimensions.width = width
    }
    return {
      presence: 'present',
      kind: referenceKind.trim() || '标准卡片',
      shape: referenceShape,
      dimensions_mm: dimensions,
      placement_note: referencePlacement.trim() || undefined,
    }
  }

  const submitAnalyze = async () => {
    if (submitInFlightRef.current) return
    if (activeImageAssets.length === 0) {
      await dialog.alert(
        isVideoCaptureSelected ? '请先录制视频' : '请先选择图片',
        isVideoCaptureSelected
          ? '请录制 2–12 秒食物短视频，并等待关键帧提取完成。'
          : `可以拍照或从相册选择，最多支持 ${MAX_ANALYZE_IMAGES} 张图片一起识别。`,
        'warning',
      )
      return
    }
    if (isVideoCaptureSelected && !videoCaptureComplete) {
      await dialog.alert('关键帧尚未就绪', '请重新处理视频，等待至少 3 个关键帧提取完成。', 'warning')
      return
    }
    if (isQuotaExhausted) {
      await dialog.alert('积分不足', '当前可用积分不足，暂时不能发起图片分析。', 'warning')
      return
    }
    submitInFlightRef.current = true
    setLoading(true)
    try {
      if (isPrecisionExecutionMode(executionMode) && !precisionSessionId) {
        let verifiedMembership: MembershipStatus
        try {
          verifiedMembership = await apiClient.getMyMembership(date)
          setMembership(verifiedMembership)
        } catch {
          await dialog.alert('暂时无法验证会员权益', '为避免错误扣费，本次未提交精准分析，请检查网络后重试。', 'warning')
          return
        }
        if (!canUseStrictModeForMembership(verifiedMembership)) {
          setBaseMode('standard')
          setSeparateFoodEstimateEnabled(false)
          await promptStrictModeUpgrade(verifiedMembership)
          return
        }
      }
      const uploadedUrls: string[] = []
      for (let index = 0; index < activeImageAssets.length; index += 1) {
        const asset = activeImageAssets[index]
        if (/^https?:\/\//i.test(asset.uri)) {
          uploadedUrls.push(asset.uri)
          continue
        }
        const uploaded = await apiClient.uploadAnalyzeImageFile({
          fileUri: asset.uri,
          fileName: asset.fileName || `food-${index + 1}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        })
        uploadedUrls.push(uploaded.imageUrl)
      }
      const commonPayload = {
        image_url: uploadedUrls[0],
        image_urls: uploadedUrls,
        meal_type: mealType,
        date,
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        diet_goal: 'none',
        activity_timing: activityTiming,
        additionalContext: additionalContext.trim() || undefined,
        is_multi_view: baseMode === 'strict' ? true : multiViewEnabled,
        suggest_ratio_enabled: suggestRatioEnabled,
        analysis_engine: analysisEngine,
        precise_micronutrients: true,
        reference_objects: carriedReferenceObjects.length > 0 ? carriedReferenceObjects : undefined,
        capture_protocol: isVideoCaptureSelected
          ? 'video_keyframes_v1' as const
          : baseMode === 'strict' ? 'dual_angle_v1' as const : undefined,
        precision_options: baseMode === 'strict' ? {
          interactive: precisionInteractiveEnabled,
          separate: separateFoodEstimateEnabled,
          web_search: webSearchEnabled,
        } satisfies PrecisionOptionsInput : undefined,
        capture_views: isVideoCaptureSelected
          ? videoUploadResult?.keyframes
          : baseMode === 'strict' ? uploadedUrls.slice(0, 2).map((imageUrl, index) => ({
              role: index === 0 ? 'top_down' as const : 'oblique_45' as const,
              image_url: imageUrl,
            })) satisfies PrecisionCaptureViewInput[] : undefined,
        video_capture: isVideoCaptureSelected && videoUploadResult ? {
          video_id: videoUploadResult.video_id,
          duration_ms: videoUploadResult.duration_ms,
          width: videoUploadResult.width,
          height: videoUploadResult.height,
          size_bytes: videoUploadResult.size_bytes,
          source_retained: false as const,
        } : undefined,
        reference_object: baseMode === 'strict' ? buildPrecisionReferenceObject() : undefined,
      }
      const submitted = precisionSessionId
        ? await apiClient.continuePrecisionSession(precisionSessionId, {
            source_type: 'image',
            ...commonPayload,
          })
        : await apiClient.submitAnalyzeTask({
            ...commonPayload,
            execution_mode: executionMode,
          })
      navigation.replace('AnalyzeLoading', {
        taskId: submitted.task_id,
        imageUri: activeImageAssets[0]?.uri,
        imageUris: activeImageAssets.map((asset) => asset.uri),
        mealType,
        date,
        taskType: 'food',
        executionMode: precisionSessionId ? 'strict' : executionMode,
      })
    } catch (error) {
      await dialog.alert('分析失败', userFacingErrorMessage(error), 'danger')
    } finally {
      submitInFlightRef.current = false
      setLoading(false)
    }
  }

  const openDemoResult = () => {
    navigation.navigate('Result', {
      task: createDemoAnalysisTask(),
      imageUri: demoFoodImageUrl,
      mealType,
      date,
    })
  }

  const openDemoTextResult = () => {
    navigation.navigate('TextResult', {
      task: createDemoTextAnalysisTask(),
      mealType,
      date,
    })
  }

  return (
    <View style={styles.analyzePage}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, { paddingBottom: 170 + bottomInset }]}
      >
        {quota ? (
          <QuotaBar
            quota={quota}
            executionMode={executionMode}
            isPro={Boolean(membership?.is_pro)}
            exhausted={isQuotaExhausted}
          />
        ) : membershipLoading ? <View style={styles.quotaSpacer} /> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isVideoCaptureSelected ? '查看视频拍摄建议' : '查看摄影技巧'}
          style={({ pressed }) => [styles.photoTipBar, pressed && styles.pressed]}
          onPress={() => setHelpSheet({
            title: isVideoCaptureSelected ? '视频拍摄建议' : '摄影技巧',
            content: isVideoCaptureSelected ? HELP_TEXT.video : HELP_TEXT.photo,
          })}
        >
          <View style={styles.photoTipDot} />
          <Text style={styles.photoTipText}>{isVideoCaptureSelected ? '视频拍摄建议' : '摄影技巧'}</Text>
          <Text style={styles.photoTipAction}>查看</Text>
        </Pressable>

        {baseMode === 'strict' ? (
          <View style={styles.captureModeCard}>
            <View style={styles.captureModeCopy}>
              <Text style={styles.captureModeTitle}>采集方式</Text>
              <Text style={styles.captureModeHint}>视频只提取关键帧，原视频不会保存</Text>
            </View>
            <View accessibilityRole="radiogroup" style={styles.captureModeSwitch}>
              {(['photos', 'video'] as const).map((mode) => {
                const selected = precisionCaptureMode === mode
                const label = mode === 'photos' ? '双角度照片' : '短视频'
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="radio"
                    accessibilityLabel={label}
                    accessibilityState={{ checked: selected, disabled: videoBusy }}
                    disabled={videoBusy}
                    style={({ pressed }) => [styles.captureModeOption, selected && styles.captureModeOptionActive, pressed && !videoBusy && styles.pressed]}
                    onPress={() => selectPrecisionCaptureMode(mode)}
                  >
                    <Text style={[styles.captureModeOptionText, selected && styles.captureModeOptionTextActive]}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        ) : null}

        <View style={styles.imagePreviewSection}>
          {isVideoCaptureSelected ? (
            <PrecisionVideoCapture
              selectedVideo={selectedVideo}
              uploadResult={videoUploadResult}
              processStage={videoProcessStage}
              progress={videoProgress}
              onPickCamera={() => void pickPrecisionVideo('camera')}
              onPickLibrary={() => void pickPrecisionVideo('library')}
              onRetry={() => selectedVideo && void processSelectedAnalyzeVideo(selectedVideo)}
              onClear={clearPrecisionVideo}
              onPreviewFrame={setFramePreviewUri}
            />
          ) : baseMode === 'strict' ? (
            <View style={styles.precisionCaptureGrid}>
              <View style={styles.precisionCaptureHeader}>
                <View style={styles.precisionCaptureCopy}>
                  <Text style={styles.precisionCaptureTitle}>双角度照片</Text>
                  <Text style={styles.precisionCaptureSubtitle}>同一餐分别拍完整俯拍和约 45° 斜拍</Text>
                </View>
                {precisionSessionId ? <Text style={styles.precisionSessionBadge}>继续会话</Text> : null}
              </View>
              {([0, 1] as const).map((slotIndex) => {
                const asset = precisionAssets[slotIndex]
                const topDown = slotIndex === 0
                const role = topDown ? 'top_down' : 'oblique_45'
                const requestedRoles = route.params?.precisionRetakeRoles || []
                const requested = requestedRoles.length === 0 || requestedRoles.includes('both') || requestedRoles.includes('video') || requestedRoles.includes(role)
                return (
                  <View key={role} style={[styles.precisionSlot, requested && precisionSessionId ? styles.precisionSlotRequested : null]}>
                    <View style={styles.precisionSlotHeader}>
                      <Text style={styles.precisionSlotBadge}>{slotIndex + 1}</Text>
                      <View style={styles.precisionSlotCopy}>
                        <Text style={styles.precisionSlotTitle}>{topDown ? '完整俯拍' : '约 45° 斜拍'}</Text>
                        <Text style={styles.precisionSlotHint}>{topDown ? '看清全部食物和占比' : '看清高度、容器边缘和遮挡'}</Text>
                      </View>
                      {requested && precisionSessionId ? <Text style={styles.precisionRequestedText}>需补拍</Text> : null}
                    </View>
                    {asset ? (
                      <View style={styles.precisionSlotPreview}>
                        <Image source={{ uri: asset.uri }} style={styles.precisionSlotImage} accessibilityLabel={topDown ? '完整俯拍照片' : '45度斜拍照片'} />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={topDown ? '移除俯拍照片' : '移除45度斜拍照片'}
                          style={({ pressed }) => [styles.precisionRemoveButton, pressed && styles.pressed]}
                          onPress={() => removePrecisionImage(slotIndex)}
                        >
                          <X size={15} color={theme.onAccent} strokeWidth={3} />
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.precisionSlotEmpty}>
                        <Camera size={27} color={theme.muted} strokeWidth={1.8} />
                        <Text style={styles.precisionSlotEmptyText}>尚未选择这个角度</Text>
                      </View>
                    )}
                    <View style={styles.precisionSlotActions}>
                      <PickerPill icon={Camera} label={asset ? '重拍' : '拍照'} onPress={() => void pickPrecisionImage(slotIndex, 'camera')} />
                      <PickerPill icon={ImageIcon} label={asset ? '替换' : '相册'} onPress={() => void pickPrecisionImage(slotIndex, 'library')} />
                    </View>
                  </View>
                )
              })}
              <Text style={styles.precisionCaptureNote}>两张必须是同一餐，且不能重复使用同一图片。</Text>
            </View>
          ) : imageAssets.length > 0 ? (
            <View style={styles.imageGrid}>
              {imageAssets.map((asset, index) => (
                <View key={asset.uri + '-' + index} style={[styles.gridItem, multiViewEnabled && styles.gridItemMultiview]}>
                  <Image source={{ uri: asset.uri }} style={styles.gridImage} accessibilityLabel={'待识别食物图片 ' + (index + 1)} />
                  <Pressable accessibilityRole="button" accessibilityLabel={'移除第 ' + (index + 1) + ' 张图片'} hitSlop={8} style={styles.removeButton} onPress={() => removeImage(asset.uri)}>
                    <X size={14} color={theme.onAccent} strokeWidth={3} />
                  </Pressable>
                </View>
              ))}
              {imageAssets.length < MAX_ANALYZE_IMAGES ? (
                <Pressable accessibilityRole="button" accessibilityLabel="添加食物图片" style={({ pressed }) => [styles.gridItem, styles.addImageTile, pressed && styles.pressed]} onPress={() => pickImages('library')}>
                  <Text style={styles.addImageIcon}>+</Text>
                  <Text style={styles.addImageText}>添加</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.emptyPreview}>
              <Camera size={34} color={theme.muted} strokeWidth={1.8} />
              <Text style={styles.emptyPreviewTitle}>点击拍摄/上传食物</Text>
              <Text style={styles.emptyPreviewText}>相册上传最多支持 {MAX_ANALYZE_IMAGES} 张，多图将作为一次识别提交</Text>
              <View style={styles.placeholderActions}>
                <PickerPill icon={Camera} label="拍照" onPress={() => pickImages('camera')} />
                <PickerPill icon={ImageIcon} label="相册" onPress={() => pickImages('library')} />
              </View>
            </View>
          )}

          <View style={styles.qualityZone}>
            <View style={styles.modeCompact}>
              <View style={styles.modeCompactLeft}>
                <View style={styles.modeTitleRow}>
                  <Text style={styles.modeCompactTitle}>识别模式</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="设置默认识别模式"
                    style={styles.modeDefaultButton}
                    hitSlop={6}
                    onPress={() => navigation.navigate('HealthProfileView')}
                  >
                    <Text style={styles.modeDefaultLink}>设为默认</Text>
                  </Pressable>
                </View>
                <Text style={styles.modeSummary}>{executionModeLabel(executionMode)}</Text>
              </View>
              <View style={styles.modeSwitchRow}>
                {MODE_OPTIONS.map((option) => (
                  <ModeSwitchItem
                    key={option.value}
                    label={option.value === 'strict' && !strictModeAuthorized ? '精准锁定' : option.label}
                    active={baseMode === option.value}
                    locked={option.value === 'strict' && !strictModeAuthorized}
                    onPress={() => void selectBaseMode(option.value)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.analysisEngineSection}>
              <View style={styles.analysisEngineHeader}>
                <Text style={styles.modeCompactTitle}>营养计算方式</Text>
                <HelpIcon onPress={() => setHelpSheet({ title: '营养计算方式', content: HELP_TEXT.engine })} />
              </View>
              <View style={styles.analysisEngineOptions}>
                {ANALYSIS_ENGINE_OPTIONS.map((option) => (
                  <AnalysisEngineOption
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    active={analysisEngine === option.value}
                    onPress={() => selectAnalysisEngine(option.value)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.analysisOptionsRow}>
              {baseMode === 'strict' ? (
                <AnalysisOptionCard
                  title="交互确认"
                  enabled={precisionInteractiveEnabled}
                  onPress={() => setPrecisionInteractiveEnabled((value) => !value)}
                  onHelpPress={() => setHelpSheet({ title: '交互确认', content: HELP_TEXT.interactive })}
                />
              ) : null}
              <AnalysisOptionCard
                title="联网校准"
                enabled={webSearchEnabled}
                disabled={Boolean(precisionSessionId)}
                onPress={() => setWebSearchEnabled((value) => !value)}
                onHelpPress={() => setHelpSheet({ title: '联网校准', content: HELP_TEXT.webSearch })}
              />
              <AnalysisOptionCard
                title="分项模式"
                enabled={separateFoodEstimateEnabled}
                disabled={baseMode !== 'strict' || Boolean(precisionSessionId)}
                onPress={() => void toggleSeparateFoodEstimate()}
                onHelpPress={() => setHelpSheet({ title: '分项模式', content: HELP_TEXT.separate })}
              />
            </View>

            {baseMode !== 'strict' ? (
              <CompactSwitchRow
                title="多视角辅助"
                icon={RotateCcw}
                enabled={multiViewEnabled}
                onPress={() => setMultiViewEnabled((value) => !value)}
                onHelpPress={() => setHelpSheet({ title: '多视角辅助', content: HELP_TEXT.multiView })}
              />
            ) : null}
            <CompactSwitchRow
              title="AI摄入比例"
              icon={Sparkles}
              enabled={suggestRatioEnabled}
              onPress={() => setSuggestRatioEnabled((value) => {
                const next = !value
                void writeSuggestRatioPreference(next)
                return next
              })}
              onHelpPress={() => setHelpSheet({ title: 'AI 摄入比例', content: HELP_TEXT.ratio })}
            />
          </View>
        </View>

        <View style={styles.detailsSection}>
          <SectionHeader title="文字补充" onHelpPress={() => setHelpSheet({ title: '文字补充', content: HELP_TEXT.text })} />
          <View style={styles.inputWrapper}>
            <TextInput
              value={additionalContext}
              onChangeText={setAdditionalContext}
              placeholder="例如：这是学校食堂的大份，额外加了辣油，用的是 500ml 便当盒..."
              placeholderTextColor={theme.muted}
              multiline
              maxLength={200}
              style={styles.detailsInput}
            />
          </View>
        </View>

        {baseMode === 'strict' ? (
          <View style={styles.detailsSection}>
            <SectionHeader title="精准拍摄设置 · 参考物" />
            <Text style={styles.precisionReferenceHint}>
              {isVideoCaptureSelected
                ? '建议参考物在环绕过程中始终可见。默认标准卡片为 85.60 × 53.98 mm；也可以明确选择没有参考物。'
                : '建议两张图使用同一个已知尺寸物体。默认标准卡片为 85.60 × 53.98 mm；也可以明确选择没有参考物。'}
            </Text>
            {precisionSessionId ? <Text style={styles.precisionSessionTip}>当前正在继续上一轮精准估计，本次{isVideoCaptureSelected ? '视频' : '双角度照片'}会接到原会话继续判断。</Text> : null}
            <View accessibilityRole="radiogroup" style={styles.precisionChoiceRow}>
              <PrecisionChoice label="已放参考物" selected={referencePresence === 'present'} onPress={() => setReferencePresence('present')} />
              <PrecisionChoice label="没有参考物" selected={referencePresence === 'absent'} onPress={() => setReferencePresence('absent')} />
            </View>
            {referencePresence === 'present' ? (
              <>
                <View accessibilityRole="radiogroup" style={styles.precisionChoiceRow}>
                  <PrecisionChoice label="标准卡片" selected={referenceShape === 'rectangle'} onPress={() => {
                    setReferenceShape('rectangle')
                    setReferenceKind('标准卡片')
                    setReferenceLength('85.6')
                    setReferenceWidth('53.98')
                  }} />
                  <PrecisionChoice label="圆形餐盘" selected={referenceShape === 'circle'} onPress={() => {
                    setReferenceShape('circle')
                    setReferenceKind('圆形餐盘')
                    if (!referenceDiameter) setReferenceDiameter('240')
                  }} />
                  <PrecisionChoice label="自定义" selected={referenceShape === 'custom'} onPress={() => setReferenceShape('custom')} />
                </View>
                <PrecisionField label="参考物名称" value={referenceKind} onChangeText={setReferenceKind} />
                {referenceShape === 'circle' ? (
                  <PrecisionField label="直径（mm）" value={referenceDiameter} onChangeText={setReferenceDiameter} keyboardType="decimal-pad" />
                ) : (
                  <View style={styles.precisionDimensionRow}>
                    <View style={styles.precisionDimensionCell}><PrecisionField label="长度（mm）" value={referenceLength} onChangeText={setReferenceLength} keyboardType="decimal-pad" /></View>
                    <View style={styles.precisionDimensionCell}><PrecisionField label="宽度（mm）" value={referenceWidth} onChangeText={setReferenceWidth} keyboardType="decimal-pad" /></View>
                  </View>
                )}
                <PrecisionField label="摆放说明（可选）" value={referencePlacement} placeholder="例如：与米饭在同一平面，放在盘子右下角" onChangeText={setReferencePlacement} />
              </>
            ) : <Text style={styles.precisionReferenceWarning}>本次仍可分析，但重量结果不会显示高尺度置信度。</Text>}
          </View>
        ) : null}

        <View style={styles.mealSection}>
          <SectionHeader title="餐次" onHelpPress={() => setHelpSheet({ title: '餐次', content: HELP_TEXT.meal })} />
          <View style={styles.mealOptions}>
            {MEAL_OPTIONS.map((option) => (
              <MealOption
                key={option.value}
                label={option.label}
                icon={option.icon}
                active={mealType === option.value}
                onPress={() => setMealType(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={styles.stateSection}>
          <SectionHeader title="运动时机" onHelpPress={() => setHelpSheet({ title: '运动时机', content: HELP_TEXT.timing })} />
          <View style={styles.stateOptions}>
            {ACTIVITY_TIMING_OPTIONS.map((option) => (
              <StateOption
                key={option.value}
                label={option.label}
                icon={option.icon}
                active={activityTiming === option.value}
                onPress={() => setActivityTiming(option.value)}
              />
            ))}
          </View>
        </View>

        {SHOW_DEBUG_LOGIN ? (
          <View style={styles.debugSection}>
            <Text style={styles.debugTitle}>示例结果预览</Text>
            <Text style={styles.debugText}>仅开发环境显示，用来快速检查图片结果和文字结果页面。</Text>
            <View style={styles.debugActions}>
              <DebugButton label="图片结果" onPress={openDemoResult} />
              <DebugButton label="文字结果" onPress={openDemoTextResult} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.confirmSection, { paddingBottom: bottomInset }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="提交食物分析"
          accessibilityState={{ disabled: confirmDisabled, busy: loading || videoBusy }}
          disabled={confirmDisabled}
          style={({ pressed }) => [styles.confirmButton, confirmDisabled && styles.confirmButtonDisabled, pressed && !confirmDisabled && styles.pressed]}
          onPress={() => void submitAnalyze()}
        >
          {loading ? (
            <ActivityIndicator color={theme.onAccent} />
          ) : (
            <Text style={[styles.confirmButtonText, confirmDisabled && styles.confirmButtonTextDisabled]} numberOfLines={1} adjustsFontSizeToFit>
              {videoBusy
                ? `${videoProgress}%`
                : baseMode === 'strict' && !precisionCaptureComplete
                  ? (isVideoCaptureSelected ? '请先录制环绕短视频' : '请补齐两个拍摄角度')
                  : confirmButtonLabel(activeImageAssets.length, isQuotaExhausted, requiredCredits, isVideoCaptureSelected)}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看识别记录"
          style={({ pressed }) => [styles.historyLink, pressed && styles.pressed]}
          onPress={() => navigation.navigate('AnalyzeHistory')}
        >
          <History size={16} color={theme.accentStrong} strokeWidth={2.4} />
          <Text style={styles.historyLinkText}>查看识别记录</Text>
        </Pressable>
      </View>

      <Modal visible={Boolean(framePreviewUri)} transparent animationType="fade" onRequestClose={() => setFramePreviewUri('')}>
        <View style={styles.framePreviewModal}>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭关键帧预览" style={styles.framePreviewMask} onPress={() => setFramePreviewUri('')} />
          <Image source={{ uri: framePreviewUri }} resizeMode="contain" style={styles.framePreviewImage} accessibilityLabel="视频关键帧大图" />
          <Pressable accessibilityRole="button" accessibilityLabel="关闭关键帧预览" style={({ pressed }) => [styles.framePreviewClose, pressed && styles.pressed]} onPress={() => setFramePreviewUri('')}>
            <X size={22} color={theme.onAccent} strokeWidth={2.6} />
          </Pressable>
        </View>
      </Modal>

      <HelpSheet sheet={helpSheet} onClose={() => setHelpSheet(null)} />
    </View>
  )
}

function QuotaBar({
  quota,
  executionMode,
  isPro,
  exhausted,
}: {
  quota: AnalyzeQuota
  executionMode: ExecutionMode
  isPro: boolean
  exhausted: boolean
}) {
  const { styles } = useAnalyzeUi()
  const warn = !exhausted && quota.remaining <= 2
  return (
    <View style={styles.quotaBar}>
      <View style={[styles.quotaDot, isPro && styles.quotaDotPro, warn && styles.quotaDotWarn, exhausted && styles.quotaDotExhausted]} />
      <Text style={[styles.quotaText, exhausted && styles.quotaTextExhausted]} numberOfLines={1} adjustsFontSizeToFit>
        {formatQuotaText(quota, executionMode)}
      </Text>
    </View>
  )
}

function PickerPill({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { styles, theme } = useAnalyzeUi()
  const Icon = icon
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.pickerPill, pressed && styles.pressed]} onPress={onPress}>
      <Icon size={14} color={theme.accentText} strokeWidth={2.4} />
      <Text style={styles.pickerPillText}>{label}</Text>
    </Pressable>
  )
}

function PrecisionChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { styles, theme } = useAnalyzeUi()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [styles.precisionChoice, selected && styles.precisionChoiceActive, pressed && styles.pressed]}
      onPress={onPress}
    >
      {selected ? <Check size={15} color={theme.accentStrong} strokeWidth={3} /> : null}
      <Text style={[styles.precisionChoiceText, selected && styles.precisionChoiceTextActive]}>{label}</Text>
    </Pressable>
  )
}

function PrecisionField({ label, value, placeholder, keyboardType, onChangeText }: {
  label: string
  value: string
  placeholder?: string
  keyboardType?: 'default' | 'decimal-pad'
  onChangeText: (value: string) => void
}) {
  const { styles, theme } = useAnalyzeUi()
  return (
    <View style={styles.precisionField}>
      <Text style={styles.precisionFieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        keyboardType={keyboardType || 'default'}
        multiline={keyboardType !== 'decimal-pad'}
        maxLength={keyboardType === 'decimal-pad' ? 8 : 80}
        style={[styles.precisionFieldInput, keyboardType !== 'decimal-pad' && styles.precisionFieldInputMultiline]}
        onChangeText={onChangeText}
      />
    </View>
  )
}

function ModeSwitchItem({
  label,
  active,
  locked,
  onPress,
}: {
  label: string
  active: boolean
  locked?: boolean
  onPress: () => void
}) {
  const { styles } = useAnalyzeUi()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [
        styles.modeSwitchItem,
        active && styles.modeSwitchItemActive,
        locked && styles.modeSwitchItemLocked,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.modeSwitchText, active && styles.modeSwitchTextActive, locked && styles.modeSwitchTextLocked]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function AnalysisEngineOption({
  label,
  description,
  active,
  onPress,
}: {
  label: string
  description: string
  active: boolean
  onPress: () => void
}) {
  const { styles } = useAnalyzeUi()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${label}，${description}`}
      style={({ pressed }) => [styles.analysisEngineOption, active && styles.analysisEngineOptionActive, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={[styles.analysisEngineOptionLabel, active && styles.analysisEngineOptionLabelActive]}>{label}</Text>
      <Text style={styles.analysisEngineOptionDescription}>{description}</Text>
    </Pressable>
  )
}

function AnalysisOptionCard({  title,
  enabled,
  disabled,
  onPress,
  onHelpPress,
}: {
  title: string
  enabled: boolean
  disabled?: boolean
  onPress: () => void
  onHelpPress: () => void
}) {
  const { styles } = useAnalyzeUi()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: enabled, disabled: Boolean(disabled) }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.analysisOptionCard,
        enabled && styles.analysisOptionCardActive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.analysisOptionLeft}>
        <Text style={styles.analysisOptionTitle} numberOfLines={1}>{title}</Text>
        <HelpIcon onPress={onHelpPress} />
      </View>
      <SwitchPill enabled={enabled} small />
    </Pressable>
  )
}

function CompactSwitchRow({
  title,
  icon,
  enabled,
  onPress,
  onHelpPress,
}: {
  title: string
  icon: LucideIcon
  enabled: boolean
  onPress: () => void
  onHelpPress: () => void
}) {
  const { styles, theme } = useAnalyzeUi()
  const Icon = icon
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: enabled }}
      style={({ pressed }) => [styles.compactSwitchRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.compactSwitchLeft}>
        <Icon size={15} color={theme.secondary} strokeWidth={2.3} />
        <Text style={styles.compactSwitchTitle}>{title}</Text>
        <HelpIcon onPress={onHelpPress} />
      </View>
      <SwitchPill enabled={enabled} />
    </Pressable>
  )
}

function SwitchPill({ enabled, small }: { enabled: boolean; small?: boolean }) {
  const { styles } = useAnalyzeUi()
  return (
    <View style={[small ? styles.switchTrackSmall : styles.switchTrack, enabled && styles.switchTrackOn]}>
      <View style={[small ? styles.switchKnobSmall : styles.switchKnob, enabled && (small ? styles.switchKnobSmallOn : styles.switchKnobOn)]} />
    </View>
  )
}

function SectionHeader({ title, onHelpPress }: { title: string; onHelpPress?: () => void }) {
  const { styles } = useAnalyzeUi()
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onHelpPress ? <HelpIcon onPress={onHelpPress} /> : null}
    </View>
  )
}

function HelpIcon({ onPress }: { onPress: () => void }) {
  const { styles, theme } = useAnalyzeUi()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="查看说明"
      style={({ pressed }) => [styles.helpIcon, pressed && styles.pressed]}
      hitSlop={8}
      onPress={onPress}
    >
      <Info size={12} color={theme.muted} strokeWidth={2.4} />
    </Pressable>
  )
}

function MealOption({ label, icon, active, onPress }: { label: string; icon: LucideIcon; active: boolean; onPress: () => void }) {
  const { styles, theme } = useAnalyzeUi()
  const Icon = icon
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [styles.mealOption, active && styles.mealOptionActive, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Icon size={19} color={active ? theme.accentStrong : theme.secondary} strokeWidth={2.3} />
      <Text style={[styles.mealLabel, active && styles.mealLabelActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function StateOption({ label, icon, active, onPress }: { label: string; icon: LucideIcon; active: boolean; onPress: () => void }) {
  const { styles, theme } = useAnalyzeUi()
  const Icon = icon
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: active }}
      style={({ pressed }) => [styles.stateOption, active && styles.stateOptionActive, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Icon size={18} color={active ? theme.accentStrong : theme.secondary} strokeWidth={2.3} />
      <Text style={[styles.stateLabel, active && styles.stateLabelActive]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </Pressable>
  )
}

function DebugButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { styles } = useAnalyzeUi()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.debugButton, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={styles.debugButtonText}>{label}</Text>
    </Pressable>
  )
}

function HelpSheet({ sheet, onClose }: { sheet: HelpSheetState; onClose: () => void }) {
  const { styles, theme } = useAnalyzeUi()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={Boolean(sheet)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.helpSheet}>
        <Pressable style={styles.helpSheetMask} onPress={onClose} />
        <View style={[styles.helpSheetContent, { paddingBottom: Math.max(insets.bottom, 18) + 20 }]}>
          <View style={styles.helpSheetHandle} />
          <View style={styles.helpSheetHeader}>
            <Text style={styles.helpSheetTitle}>{sheet?.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭说明"
              style={styles.helpSheetClose}
              hitSlop={6}
              onPress={onClose}
            >
              <X size={18} color={theme.secondary} strokeWidth={2.4} />
            </Pressable>
          </View>
          <Text style={styles.helpSheetBody}>{sheet?.content}</Text>
        </View>
      </View>
    </Modal>
  )
}

type AnalyzeQuota = {
  max: number
  used: number
  remaining: number
}

function buildAnalyzeQuota(status: MembershipStatus | null): AnalyzeQuota | null {
  if (!status) return null
  const max = numericValue(status.daily_credits_max ?? status.daily_limit)
  const remaining = numericValue(status.total_credits_available ?? status.daily_credits_remaining ?? status.daily_remaining)
  const explicitUsed = status.daily_credits_used ?? status.daily_used
  const used = explicitUsed == null && max > 0 ? Math.max(0, max - remaining) : numericValue(explicitUsed)
  return {
    max,
    used,
    remaining,
  }
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function formatQuotaText(quota: AnalyzeQuota, mode: ExecutionMode): string {
  const modeLabel = executionModeLabel(mode)
  if (quota.max > 0) {
    return `今日已用 ${quota.used}/${quota.max} 积分 · 剩余 ${quota.remaining} · ${modeLabel}`
  }
  return `可用积分 ${quota.remaining} · ${modeLabel}`
}

function confirmButtonLabel(imageCount: number, isQuotaExhausted: boolean, requiredCredits: number, video = false): string {
  if (isQuotaExhausted) return '积分不足，暂不可分析'
  if (imageCount === 0) return '请先拍照或选图'
  return video ? `分析 ${imageCount} 个关键帧 · 消耗 ${requiredCredits} 积分` : `分析 ${imageCount} 张 · 消耗 ${requiredCredits} 积分`
}

function executionModeLabel(mode: ExecutionMode): string {
  if (mode === 'fast') return '快速'
  if (mode === 'fast_web_search') return '快速联网'
  if (mode === 'standard_web_search') return '普通联网'
  if (mode === 'strict') return '精准'
  if (mode === 'strict_separate') return '精准分项'
  if (mode === 'strict_web_search') return '精准联网'
  return '普通'
}

function defaultAnalysisEngineForMode(mode: ExecutionMode): AnalysisEngine {
  return isPrecisionExecutionMode(mode) ? 'db_candidates_ai' : 'ai_direct'
}

function normalizeAnalysisEngine(value: unknown, mode: ExecutionMode): AnalysisEngine {
  if (value === 'ai_direct' || value === 'ai_then_db_exact' || value === 'db_candidates_ai') return value
  if (value === 'legacy_direct') return 'ai_direct'
  return defaultAnalysisEngineForMode(mode)
}

function normalizeAvailableExecutionMode(value: unknown): ExecutionMode {
  if (value === 'fast' || value === 'fast_web_search' || value === 'standard' || value === 'standard_web_search' || value === 'strict' || value === 'strict_separate' || value === 'strict_web_search') return value
  return 'standard'
}

function resolveAnalyzeBaseMode(mode: ExecutionMode): AnalyzeBaseMode {
  if (mode === 'fast' || mode === 'fast_web_search') return 'fast'
  if (isPrecisionExecutionMode(mode)) return 'strict'
  return 'standard'
}

function isWebSearchExecutionMode(mode: ExecutionMode): boolean {
  return mode === 'fast_web_search' || mode === 'standard_web_search' || mode === 'strict_web_search'
}

function isPrecisionExecutionMode(mode: ExecutionMode): boolean {  return mode === 'strict' || mode === 'strict_separate' || mode === 'strict_web_search'
}

function canUseStrictModeForMembership(status: MembershipStatus | null): boolean {
  if (!status?.is_pro) return false
  const planCode = String(status.current_plan_code || '').trim()
  return planCode.startsWith('standard_') || planCode.startsWith('advanced_')
}

function createAnalyzeStyles(theme: AnalyzeTheme) {
  return StyleSheet.create({
  analyzePage: {
    flex: 1,
    backgroundColor: theme.page,
  },
  content: {
    paddingTop: 12,
    paddingHorizontal: 10,
  },
  quotaSpacer: {
    height: 8,
  },
  quotaBar: {
    minHeight: 24,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  quotaDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.accent,
  },
  quotaDotPro: {
    backgroundColor: theme.accentStrong,
  },
  quotaDotWarn: {
    backgroundColor: theme.warningText,
  },
  quotaDotExhausted: {
    backgroundColor: theme.danger,
  },
  quotaText: {
    maxWidth: '92%',
    color: theme.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  quotaTextExhausted: {
    color: theme.danger,
  },
  photoTipBar: {
    minHeight: 48,
    marginBottom: 7,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.accentBorder,
    backgroundColor: theme.accentSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  photoTipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
  photoTipText: {
    flex: 1,
    color: theme.accentText,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  photoTipAction: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: theme.accent,
    color: theme.onAccent,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  captureModeCard: {
    minHeight: 76,
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    elevation: 1,
    shadowColor: theme.shadow,
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  captureModeCopy: { flexGrow: 1, flexShrink: 1, minWidth: 120 },
  captureModeTitle: { color: theme.secondary, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  captureModeHint: { marginTop: 2, color: theme.secondary, fontSize: 10, lineHeight: 15 },
  captureModeSwitch: { flexBasis: 194, flexGrow: 1, flexShrink: 0, maxWidth: '100%', padding: 3, borderRadius: 999, flexDirection: 'row', backgroundColor: theme.surfaceStrong },
  captureModeOption: { flex: 1, minHeight: 48, paddingHorizontal: 7, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  captureModeOptionActive: { backgroundColor: theme.surface, elevation: 1, shadowColor: theme.shadow, shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  captureModeOptionText: { color: theme.secondary, fontSize: 11, lineHeight: 16, fontWeight: '800' },
  captureModeOptionTextActive: { color: theme.accentText },
  imagePreviewSection: {
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    elevation: 1,
    shadowColor: theme.shadow,
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 1 },
  },
  precisionCaptureGrid: {
    padding: 10,
    gap: 10,
  },
  precisionCaptureHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  precisionCaptureCopy: { flex: 1, minWidth: 0 },
  precisionCaptureTitle: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '900',
  },
  precisionCaptureSubtitle: {
    marginTop: 2,
    color: theme.secondary,
    fontSize: 11,
    lineHeight: 16,
  },
  precisionSessionBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: theme.accentSoft,
    color: theme.accentText,
    fontSize: 10,
    fontWeight: '800',
  },
  precisionSlot: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceMuted,
  },
  precisionSlotRequested: {
    borderColor: theme.warningText,
    backgroundColor: theme.warningSurface,
  },
  precisionSlotHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  precisionSlotBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    textAlign: 'center',
    textAlignVertical: 'center',
    backgroundColor: theme.accent,
    color: theme.onAccent,
    fontSize: 12,
    fontWeight: '900',
  },
  precisionSlotCopy: {
    flex: 1,
    minWidth: 0,
  },
  precisionSlotTitle: {
    color: theme.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  precisionSlotHint: {
    marginTop: 1,
    color: theme.secondary,
    fontSize: 11,
    lineHeight: 16,
  },
  precisionRequestedText: {
    color: theme.warningText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  precisionSlotPreview: {
    height: 154,
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: theme.surfaceStrong,
  },
  precisionSlotImage: {
    width: '100%',
    height: '100%',
  },
  precisionRemoveButton: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.68)',
  },
  precisionSlotEmpty: {
    minHeight: 104,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: theme.surface,
  },
  precisionSlotEmptyText: {
    color: theme.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  precisionSlotActions: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  precisionCaptureNote: {
    color: theme.secondary,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
  },
  gridItem: {
    width: '31.7%',
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.surfaceMuted,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  gridItemMultiview: {
    borderColor: theme.accent,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  addImageTile: {
    borderStyle: 'dashed',
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceMuted,
  },
  addImageIcon: {
    color: theme.muted,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '300',
  },
  addImageText: {
    marginTop: 4,
    color: theme.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  emptyPreview: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: theme.surfaceStrong,
  },
  emptyPreviewTitle: {
    marginTop: 8,
    color: theme.secondary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  emptyPreviewText: {
    marginTop: 4,
    maxWidth: 270,
    textAlign: 'center',
    color: theme.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  placeholderActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  pickerPill: {
    minHeight: 48,
    minWidth: 88,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.accentBorder,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  pickerPillText: {
    color: theme.accentText,
    fontSize: 12,
    fontWeight: '700',
  },
  qualityZone: {
    borderTopWidth: 1,
    borderTopColor: theme.divider,
  },
  modeCompact: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: theme.divider,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modeCompactLeft: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 108,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  modeDefaultButton: {
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeDefaultLink: {
    color: theme.accentStrong,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  modeCompactTitle: {
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  modeSummary: {
    marginTop: 1,
    color: theme.accentText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  modeSwitchRow: {
    flexBasis: 210,
    flexGrow: 1,
    maxWidth: '100%',
    flexDirection: 'row',
    gap: 5,
  },
  modeSwitchItem: {
    flex: 1,
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  modeSwitchItemActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  modeSwitchItemLocked: {
    borderColor: theme.warningText,
    backgroundColor: theme.warningSurface,
  },
  modeSwitchText: {
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  modeSwitchTextActive: {
    color: theme.onAccent,
  },
  modeSwitchTextLocked: {
    color: theme.warningText,
    fontSize: 10,
  },
  analysisEngineSection: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.divider,
  },
  analysisEngineHeader: {
    minHeight: 36,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  analysisEngineOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  analysisEngineOption: {
    flexGrow: 1,
    flexBasis: 96,
    minWidth: 96,
    minHeight: 108,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceMuted,
  },
  analysisEngineOptionActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  analysisEngineOptionLabel: {
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  analysisEngineOptionLabelActive: {
    color: theme.accentText,
  },
  analysisEngineOptionDescription: {
    marginTop: 4,
    color: theme.secondary,
    fontSize: 10,
    lineHeight: 15,
  },
  analysisOptionsRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.divider,
  },
  analysisOptionCard: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 96,
    minHeight: 48,
    paddingHorizontal: 8,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  analysisOptionCardActive: {
    borderColor: theme.accentBorder,
    backgroundColor: theme.accentSoft,
  },
  analysisOptionLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  analysisOptionTitle: {
    flexShrink: 1,
    color: theme.secondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  compactSwitchRow: {
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: theme.divider,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactSwitchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactSwitchTitle: {
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 999,
    padding: 2,
    backgroundColor: theme.disabled,
  },
  switchTrackSmall: {
    width: 32,
    height: 18,
    borderRadius: 999,
    padding: 2,
    backgroundColor: theme.disabled,
  },
  switchTrackOn: {
    backgroundColor: theme.accent,
  },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.knob,
    elevation: 1,
  },
  switchKnobSmall: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.knob,
    elevation: 1,
  },
  switchKnobOn: {
    transform: [{ translateX: 20 }],
  },
  switchKnobSmallOn: {
    transform: [{ translateX: 14 }],
  },
  sectionHeader: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: theme.accent,
    color: theme.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  helpIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  precisionReferenceHint: {
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 19,
  },
  precisionSessionTip: {
    marginTop: 9,
    padding: 9,
    borderRadius: 9,
    backgroundColor: theme.accentSoft,
    color: theme.accentText,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
  },
  precisionChoiceRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  precisionChoice: {
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  precisionChoiceActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  precisionChoiceText: {
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  precisionChoiceTextActive: {
    color: theme.accentText,
  },
  precisionField: {
    marginTop: 10,
  },
  precisionFieldLabel: {
    marginBottom: 5,
    color: theme.secondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  precisionFieldInput: {
    minHeight: 48,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceMuted,
    color: theme.text,
    fontSize: 13,
    lineHeight: 19,
  },
  precisionFieldInputMultiline: {
    minHeight: 54,
    textAlignVertical: 'top',
  },
  precisionDimensionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  precisionDimensionCell: {
    flexGrow: 1,
    flexBasis: 120,
  },
  precisionReferenceWarning: {
    marginTop: 10,
    padding: 9,
    borderRadius: 9,
    backgroundColor: theme.warningSurface,
    color: theme.warningText,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
  },
  detailsSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
    elevation: 1,
    shadowColor: theme.shadow,
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  inputWrapper: {
    minHeight: 80,
    borderRadius: 8,
    backgroundColor: theme.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  detailsInput: {
    minHeight: 72,
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    padding: 0,
  },
  mealSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
    elevation: 1,
    shadowColor: theme.shadow,
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  mealOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  mealOption: {
    width: '48.5%',
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: theme.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mealOptionActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  mealLabel: {
    color: theme.secondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  mealLabelActive: {
    color: theme.accentText,
    fontWeight: '800',
  },
  stateSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
    elevation: 1,
    shadowColor: theme.shadow,
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  stateOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  stateOption: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: 5,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: theme.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  stateOptionActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  stateLabel: {
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  stateLabelActive: {
    color: theme.accentText,
    fontWeight: '800',
  },
  debugSection: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.surface,
  },
  debugTitle: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  debugText: {
    marginTop: 4,
    color: theme.secondary,
    fontSize: 12,
    lineHeight: 18,
  },
  debugActions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  debugButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accentSoft,
  },
  debugButtonText: {
    color: theme.accentText,
    fontSize: 12,
    fontWeight: '800',
  },
  confirmSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.footer,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  confirmButton: {
    width: '100%',
    maxWidth: 300,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: theme.accent,
    elevation: 3,
    shadowColor: theme.accent,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  confirmButtonDisabled: {
    backgroundColor: theme.disabled,
    elevation: 0,
    shadowOpacity: 0,
  },
  confirmButtonText: {
    color: theme.onAccent,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  confirmButtonTextDisabled: {
    color: theme.disabledText,
  },
  historyLink: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  historyLinkText: {
    color: theme.accentText,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  helpSheet: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  helpSheetMask: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.scrim,
  },
  helpSheetContent: {
    width: '100%',
    paddingTop: 10,
    paddingHorizontal: 18,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: theme.surface,
  },
  helpSheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.surfaceStrong,
    marginBottom: 12,
  },
  helpSheetHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  helpSheetTitle: {
    flex: 1,
    color: theme.text,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  helpSheetClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceStrong,
  },
  helpSheetBody: {
    marginTop: 8,
    color: theme.secondary,
    fontSize: 14,
    lineHeight: 22,
  },
  framePreviewModal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 },
  framePreviewMask: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(2,6,23,0.92)' },
  framePreviewImage: { width: '100%', height: '80%' },
  framePreviewClose: { position: 'absolute', top: 52, right: 18, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  })
}

const LIGHT_ANALYZE_STYLES = createAnalyzeStyles(LIGHT_ANALYZE_THEME)
const DARK_ANALYZE_STYLES = createAnalyzeStyles(DARK_ANALYZE_THEME)

function useAnalyzeUi() {
  const { isDark } = useColorScheme()
  return isDark
    ? { theme: DARK_ANALYZE_THEME, styles: DARK_ANALYZE_STYLES }
    : { theme: LIGHT_ANALYZE_THEME, styles: LIGHT_ANALYZE_STYLES }
}
