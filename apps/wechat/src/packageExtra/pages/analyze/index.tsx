import { View, Text, Image, Textarea, PageMeta, Video } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  imageToBase64,
  compressImagePathForUpload,
  uploadAnalyzeImage,
  uploadAnalyzeImageFile,
  uploadAnalyzeVideoFile,
  submitAnalyzeTask,
  continuePrecisionSession,
  getAccessToken,
  MealType,
  ActivityTiming,
  getHealthProfile,
  updateHealthProfile,
  getMyMembership,
  MembershipStatus,
  PrecisionReferenceDefaults,
  PrecisionReferenceDimensions,
  PrecisionReferencePresetConfig,
  PrecisionReferencePresetKey,
  showUnifiedApiError,
} from '../../../utils/api'
import type {
  AnalyzeResponse,
  AnalyzeVideoUploadResult,
  AnalysisEngine,
  ExecutionMode,
  PrecisionCaptureReferenceInput,
  PrecisionReferenceObjectInput,
} from '../../../utils/api'
import {
  buildDualAngleCaptureViews,
  buildPrecisionOptions,
  isPrecisionCaptureComplete,
  isVideoKeyframeCaptureComplete,
} from '../../../utils/precision-mode'
import { compressAnalyzeVideoToLimit } from '../../../utils/analyze-video'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  canUseStrictModeForMembership,
  getStrictModeLockedHint,
  getStrictModeUpgradeUrl,
  isPrecisionExecutionMode,
  normalizeAvailableExecutionMode,
  promptStrictModeUpgrade,
} from '../../../utils/execution-mode'
import {
  getRecommendedMealTypeWithFallback,
  inferDefaultMealTypeFromLocalTime,
} from '../../../utils/infer-default-meal-type'
import {
  getFoodAnalysisCreditBlockMessage,
  getFoodAnalysisCreditCost,
  getMembershipCreditSummary,
  isFoodAnalysisCreditExhausted,
} from '../../../utils/membership'
import CreditShortageSheet from '../../../components/CreditShortageSheet'
import { getStoredRecordTargetDate, persistRecordTargetDate, getTodayRecordDateKey } from '../../../utils/record-date'
import {
  ANALYSIS_ENGINE_OPTIONS,
  defaultAnalysisEngineForMode,
  normalizeAnalysisEngine,
} from '../../../utils/analysis-engine'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'
import { withAuth } from '../../../utils/withAuth'
import OnboardingGuide from '../../../components/OnboardingGuide'
import {
  ONBOARDING_ANALYZE_PREP_GUIDE_KEY,
  shouldOfferOnboardingGuide,
} from '../../../utils/onboarding-guide-storage'
import { ANALYZE_PREP_ONBOARDING_STEPS } from './analyze-onboarding-steps'
import { PAGE_SCROLL_LOCK_STYLE, usePageScrollLock } from '../../../utils/page-scroll-lock'

/** 餐次（分析前选择，AI 将结合餐次分析） */
const MEAL_OPTIONS: Array<{ value: MealType; label: string; iconClass: string }> = [
  { value: 'breakfast', label: '早餐', iconClass: 'icon-zaocan1' },
  { value: 'morning_snack', label: '早加餐', iconClass: 'icon-lingshi' },
  { value: 'lunch', label: '午餐', iconClass: 'icon-wucan' },
  { value: 'afternoon_snack', label: '午加餐', iconClass: 'icon-lingshi' },
  { value: 'dinner', label: '晚餐', iconClass: 'icon-wancan' },
  { value: 'evening_snack', label: '晚加餐', iconClass: 'icon-lingshi' },
]

/** 运动时机（状态二） */
const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string; iconClass: string }> = [
  { value: 'post_workout', label: '练后', iconClass: 'icon-juzhong' },
  { value: 'daily', label: '日常', iconClass: 'icon-duoren' },
  { value: 'before_sleep', label: '睡前', iconClass: 'icon-shuijue' },
  { value: 'none', label: '无', iconClass: 'icon-nothing' }
]

type ReferencePresetValue = PrecisionReferencePresetKey
type AnalyzeBaseMode = 'fast' | 'standard' | 'strict'
type PrecisionCaptureMode = 'photos' | 'video'

interface SelectedAnalyzeVideo {
  tempFilePath: string
  duration: number
  size: number
  width: number
  height: number
}

const REFERENCE_PRESETS: Array<{
  value: ReferencePresetValue
  label: string
  dimensions: PrecisionReferenceDimensions
}> = [
  { value: 'campus_card', label: '标准卡片', dimensions: { length: 85.6, width: 53.98, height: 0.8 } },
  { value: 'round_plate', label: '圆形餐盘', dimensions: { diameter: 240 } },
  { value: 'large_card', label: '大卡片', dimensions: { length: 120, width: 76, height: 1 } },
  { value: 'custom', label: '自定义', dimensions: {} }
]

const DEFAULT_REFERENCE_PRESET: ReferencePresetValue = 'campus_card'
const ANALYSIS_ENGINE_STORAGE_KEY = 'analyzeAnalysisEngine'
const SUGGEST_RATIO_STORAGE_KEY = 'analyzeSuggestRatioEnabled'
const ANALYZE_SUBMIT_DEBOUNCE_MS = 300
const MAX_ANALYZE_IMAGES = 5
const PRECISION_CAPTURE_ROLES = ['top_down', 'oblique_45'] as const
const MAX_ANALYZE_VIDEO_SIZE_BYTES = 8 * 1024 * 1024
const MAX_ANALYZE_VIDEO_DURATION_SECONDS = 12

const readSuggestRatioPreference = (): boolean => {
  const saved = Taro.getStorageSync(SUGGEST_RATIO_STORAGE_KEY)
  if (saved === false || saved === '0' || saved === 'false') return false
  if (saved === true || saved === '1' || saved === 'true') return true
  return true
}

const resolveAnalyzeBaseMode = (mode: ExecutionMode): AnalyzeBaseMode => {
  if (mode === 'fast' || mode === 'fast_web_search') return 'fast'
  if (mode === 'strict' || mode === 'strict_separate' || mode === 'strict_web_search') return 'strict'
  return 'standard'
}

const isWebSearchExecutionMode = (mode: ExecutionMode): boolean => (
  mode === 'fast_web_search' || mode === 'standard_web_search' || mode === 'strict_web_search'
)

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

const normalizePositiveReferenceDimension = (value: unknown): number | undefined => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : undefined
}

const buildDefaultReferenceDefaults = (): PrecisionReferenceDefaults => ({
  preferred_reference_key: DEFAULT_REFERENCE_PRESET,
  presets: REFERENCE_PRESETS.reduce<Partial<Record<ReferencePresetValue, PrecisionReferencePresetConfig>>>((acc, preset) => {
    if (preset.value === 'custom') return acc
    acc[preset.value] = {
      reference_name: preset.label,
      dimensions_mm: { ...preset.dimensions },
    }
    return acc
  }, {})
})

const normalizeReferencePresetConfig = (
  preset: PrecisionReferencePresetConfig | Record<string, unknown> | undefined,
  fallbackLabel: string,
): PrecisionReferencePresetConfig => {
  const raw = preset || {}
  const dimensionsSource = (raw as PrecisionReferencePresetConfig).dimensions_mm || {}
  const normalizedDimensions: PrecisionReferenceDimensions = {}
  const length = normalizePositiveReferenceDimension(dimensionsSource.length)
  const width = normalizePositiveReferenceDimension(dimensionsSource.width)
  const height = normalizePositiveReferenceDimension(dimensionsSource.height)
  const diameter = normalizePositiveReferenceDimension(dimensionsSource.diameter)
  if (length != null) normalizedDimensions.length = length
  if (width != null) normalizedDimensions.width = width
  if (height != null) normalizedDimensions.height = height
  if (diameter != null) normalizedDimensions.diameter = diameter
  return {
    reference_name: String((raw as PrecisionReferencePresetConfig).reference_name || fallbackLabel).trim() || fallbackLabel,
    dimensions_mm: Object.keys(normalizedDimensions).length > 0 ? normalizedDimensions : undefined,
  }
}

const normalizeReferenceDefaults = (value: unknown): PrecisionReferenceDefaults => {
  const base = buildDefaultReferenceDefaults()
  if (!value || typeof value !== 'object') return base
  const raw = value as PrecisionReferenceDefaults
  const mergedPresets: Partial<Record<ReferencePresetValue, PrecisionReferencePresetConfig>> = { ...(base.presets || {}) }
  REFERENCE_PRESETS.forEach((preset) => {
    const savedPreset = raw.presets?.[preset.value]
    if (!savedPreset) {
      if (preset.value === 'custom' && !mergedPresets.custom) {
        mergedPresets.custom = { reference_name: preset.label, dimensions_mm: undefined }
      }
      return
    }
    mergedPresets[preset.value] = normalizeReferencePresetConfig(savedPreset, preset.label)
  })
  const preferred = raw.preferred_reference_key
  const preferred_reference_key = REFERENCE_PRESETS.some(preset => preset.value === preferred)
    ? preferred
    : DEFAULT_REFERENCE_PRESET
  return {
    preferred_reference_key,
    presets: mergedPresets,
  }
}

const EXECUTION_MODE_META: Record<ExecutionMode, { title: string; desc: string; tips: string[] }> = {
  lite: {
    title: '普通模式',
    desc: '快速识别食物和重量，适合日常记录。',
    tips: [
      '尽量让食物主体完整入镜',
      '有包装袋时尽量让文字正着、清晰入镜',
      '复杂菜可在下方补充烹饪信息',
      '多角度拍摄可打开多视角辅助'
    ]
  },
  experimental: {
    title: '普通模式',
    desc: '快速识别食物和重量，适合日常记录。',
    tips: [
      '单个食物最准确，先让主体完整入镜',
      '包装文字倒着拍会降低识别率',
      '混合餐最多保留 2-3 个主体，尽量拨开后再拍',
      '菜太多或互相遮挡时，请分开拍；旁边放餐具会更稳'
    ]
  },
  standard_web_search: {
    title: '普通联网',
    desc: '先快速识别，再用低成本搜索结果保守校准包装规格、饮品容量和可用参照物。',
    tips: [
      '有包装时尽量让品名、规格、净含量正着入镜',
      '联网结果只做佐证，图片里看不到的食物不会新增',
      '适合酸奶、饮料、连锁/品牌商品、小众水果等需要规格参考的场景',
      '搜索不可用时会保留普通识别结果'
    ]
  },
  fast: {
    title: '快速模式',
    desc: '使用 Qwen Flash 快速看图识别，适合想先得到一版结果的日常记录。',
    tips: [
      '主体食物尽量完整入镜',
      '包装文字越清楚，名称和规格越稳',
      '复杂混合菜可补充烹饪方式或食材名称',
      '若需要更细估重，可切换精准模式'
    ]
  },
  fast_web_search: {
    title: '快速联网',
    desc: '使用 Qwen Flash 原生联网搜索，快速结合网络信息校准包装规格和商品名称。',
    tips: [
      '适合酸奶、饮料、零食、品牌商品等需要查规格的场景',
      '请让品名、口味、净含量尽量正着清晰入镜',
      '联网搜索只做规格佐证，不会新增图片里不存在的食物',
      '如网络搜索慢或不可用，可切回快速模式'
    ]
  },
  standard_packaged_experiment: {
    title: '普通 · 零食库试验',
    desc: '复用普通识别模型，但优先用本地零食库里的真实规格重量校准包装食品。',
    tips: [
      '适合测试已入库的零食、雪糕、饮料和酸奶',
      '包装正面、口味、净含量越清楚，越容易命中正确规格',
      '多规格商品没有明确规格时，只会保留候选，不会强行改重量',
      '普通菜品仍按普通营养库处理'
    ]
  },
  gemini35_flash: {
    title: '精准模式',
    desc: '更细致识别包装文字、小众食物和复杂场景。',
    tips: [
      '包装袋文字尽量正着拍，配料表清晰会更准',
      '复杂图片可补充品名或购买信息',
      '结果仍会走后端营养库统一回算'
    ]
  },
  gemini35_flash_grouped: {
    title: '精准模式',
    desc: '更细致识别包装文字、小众食物和复杂场景。',
    tips: [
      '包装袋文字尽量正着拍，配料表清晰会更准',
      '复杂图片可补充品名或购买信息',
      '结果仍会走后端营养库统一回算'
    ]
  },
  strict: {
    title: '精准模式',
    desc: '更细致识别包装文字、小众食物和复杂场景。',
    tips: [
      '包装袋文字尽量正着拍，配料表清晰会更准',
      '复杂菜可在下方补充烹饪方式和份量信息',
      '多角度拍摄可打开多视角辅助'
    ]
  },
  strict_separate: {
    title: '精准分项',
    desc: '尽量把混合食物拆成可单独调整比例的成分项。',
    tips: [
      '适合牛肉面、盖饭、麻辣烫、沙拉、汤面等混合食物',
      '系统会优先拆出主食、肉类、蔬菜、汤底或配料',
      '结果页可分别调整每个成分吃了多少',
      '补充说明里写“肉吃完、面剩一半”会更稳'
    ]
  },
  strict_web_search: {
    title: '精准联网',
    desc: '精准识别后，再用低成本搜索证据校准包装规格、商品重量和空间锚点。',
    tips: [
      '包装文字、倒置文字和配料表尽量拍清楚',
      '搜索结果只辅助校准重量和规格，不替代图片判断',
      '复杂品牌商品可补充购买渠道、口味或规格',
      '网络搜索慢或失败时会保留精准识别结果'
    ]
  },
  standard: {
    title: '普通模式',
    desc: '快速识别食物和重量，适合日常记录。',
    tips: [
      '尽量让食物主体完整入镜',
      '有包装袋时尽量让文字正着、清晰入镜',
      '复杂菜可在下方补充烹饪信息',
      '多角度拍摄可打开多视角辅助'
    ]
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

/**
 * 选图后立刻将临时图保存到 USER_DATA_PATH，避免微信开发者工具 tmp 路径失效
 */
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

  // devtools 不同版本返回路径格式不一致，尝试通过 getImageInfo 再取一轮可读路径
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
    const targetPath = `${userDataPath}/analyze_${Date.now()}_${Math.floor(Math.random() * 1000000)}${ext}`
    try {
      const savedFilePath = await new Promise<string>((resolve, reject) => {
        Taro.getFileSystemManager().saveFile({
          tempFilePath,
          filePath: targetPath,
          success: (res: any) => resolve(String(res?.savedFilePath || targetPath)),
          fail: reject
        })
      })
      if (savedFilePath) {
        return savedFilePath
      }
      return targetPath
    } catch (err) {
      console.warn('保存临时图片失败，尝试下一个路径:', tempFilePath, err)
    }
  }

  console.warn('临时图片持久化全部失败，回退原路径:', { raw, normalized, candidates })
  return raw
}

const persistImagePathsImmediately = async (paths: string[]): Promise<string[]> => {
  const normalizedPaths = paths.map(path => String(path || '').trim()).filter(Boolean)
  const persistedPaths: string[] = []

  for (const path of normalizedPaths) {
    try {
      const stablePath = await persistImagePathIfNeeded(path)
      persistedPaths.push(stablePath || path)
    } catch (err) {
      console.warn('图片预持久化失败，回退原路径:', path, err)
      persistedPaths.push(path)
    }
  }

  return persistedPaths
}

function AnalyzePage() {
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [additionalInfo, setAdditionalInfo] = useState<string>('')
  const [mealType, setMealType] = useState<MealType>(() => inferDefaultMealTypeFromLocalTime())
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [defaultMealType, setDefaultMealType] = useState<MealType>(() => inferDefaultMealTypeFromLocalTime())
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [analysisEngine, setAnalysisEngine] = useState<AnalysisEngine>(() => (
    normalizeAnalysisEngine(Taro.getStorageSync(ANALYSIS_ENGINE_STORAGE_KEY), 'standard')
  ))
  const [preciseMicronutrients, setPreciseMicronutrients] = useState(false)
  const [precisionInteractiveEnabled, setPrecisionInteractiveEnabled] = useState(true)
  const [precisionSeparateEnabled, setPrecisionSeparateEnabled] = useState(false)
  const [precisionWebSearchEnabled, setPrecisionWebSearchEnabled] = useState(false)
  const [precisionCaptureMode, setPrecisionCaptureMode] = useState<PrecisionCaptureMode>('photos')
  const [selectedVideo, setSelectedVideo] = useState<SelectedAnalyzeVideo | null>(null)
  const [videoUploadResult, setVideoUploadResult] = useState<AnalyzeVideoUploadResult | null>(null)
  const [videoUploadProgress, setVideoUploadProgress] = useState(0)
  const [isVideoUploading, setIsVideoUploading] = useState(false)
  const [isMultiView, setIsMultiView] = useState(false)
  const [suggestRatioEnabled, setSuggestRatioEnabled] = useState<boolean>(() => readSuggestRatioPreference())
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null)
  const [targetDateStatus, setTargetDateStatus] = useState<MembershipStatus | null>(null)
  const [precisionSessionId, setPrecisionSessionId] = useState('')
  const [savedReferenceDefaults, setSavedReferenceDefaults] = useState<PrecisionReferenceDefaults>(
    () => buildDefaultReferenceDefaults()
  )
  const [referencePreset, setReferencePreset] = useState<ReferencePresetValue>(DEFAULT_REFERENCE_PRESET)
  const [hasReferenceObject, setHasReferenceObject] = useState(true)
  const [referenceName, setReferenceName] = useState('标准卡片')
  const [referenceLength, setReferenceLength] = useState('85.6')
  const [referenceWidth, setReferenceWidth] = useState('53.98')
  const [referenceHeight, setReferenceHeight] = useState('0.8')
  const [referenceDiameter, setReferenceDiameter] = useState('')
  const [referencePlacementNote, setReferencePlacementNote] = useState('')
  const [creditSheet, setCreditSheet] = useState<{ visible: boolean; message?: string }>({
    visible: false,
  })
  const [showAnalyzeOnboardingGuide, setShowAnalyzeOnboardingGuide] = useState(false)

  // 帮助说明底部弹窗
  const [helpSheet, setHelpSheet] = useState<{ visible: boolean; title: string; content: string }>({
    visible: false,
    title: '',
    content: ''
  })

  const openHelp = useCallback((key: string) => {
    const helpContent: Record<string, { title: string; content: string }> = {
      multiview: {
        title: '多视角辅助',
        content: '多张图片始终作为一次识别提交；开启后会更强调同一餐食的多角度综合估算。建议从不同角度拍摄同一餐食，让 AI 结合多张照片进行更准确的判断。'
      },
      text: {
        title: '文字补充',
        content: '提供更多上下文能显著提高识别准确率，例如分量、容器大小、额外配料等。你可以描述食物的具体情况，帮助 AI 更准确地进行分析。'
      },
      meal: {
        title: '餐次',
        content: '选择本餐次，AI 将结合场景给出建议。不同餐次的营养需求和推荐会有所不同，例如早餐注重能量补充，晚餐建议适当控制碳水摄入。'
      },
      timing: {
        title: '运动时机',
        content: '选择进食时机，AI 将结合时机给出针对性建议。如运动后补充蛋白有助于肌肉恢复，睡前避免过多碳水有助于睡眠质量。'
      },
      suggest_ratio: {
        title: 'AI摄入比例',
        content: '结果页自动给出每项食物的滑块比例。开启后，AI 会根据你的剩余热量和饮食目标，为每个识别出的食物建议一个摄入比例（0-100%），你可以在结果页通过滑块快速调整。'
      },
      web_search: {
        title: '联网校准',
        content: '开启后会用低成本网络搜索辅助校准包装规格、品牌商品、饮品容量或小众食物信息。联网只做佐证，不会新增图片里不存在的食物。'
      },
      separate_foods: {
        title: '分项模式',
        content: '仅在精准模式下可开启。适合牛肉面、盖饭、麻辣烫、沙拉等混合食物，会尽量拆出主食、肉类、蔬菜、汤底或配料，结果页可分别调整每项吃了多少。'
      }
    }
    const info = helpContent[key]
    if (info) {
      setHelpSheet({ visible: true, ...info })
    }
  }, [])

  const imagePathsRef = useRef<string[]>([])
  const routeSessionSignatureRef = useRef('')
  const analyzeSubmitDebounceRef = useRef(0)
  imagePathsRef.current = imagePaths.filter(Boolean)

  const canUseStrictMode = canUseStrictModeForMembership(membershipStatus)
  const { hasInfo: hasCreditsInfo, max: creditsMax, used: creditsUsed, remaining: creditsRemaining } =
    getMembershipCreditSummary(membershipStatus)
  const precisionUpgradeUrl = getStrictModeUpgradeUrl(membershipStatus)
  const precisionUpgradeHint = canUseStrictMode ? '' : getStrictModeLockedHint(membershipStatus)
  const selectedBaseMode = resolveAnalyzeBaseMode(executionMode)
  const isStrictBaseModeSelected = selectedBaseMode === 'strict'
  const isVideoCaptureSelected = isStrictBaseModeSelected && precisionCaptureMode === 'video'
  const isWebSearchEnabled = isStrictBaseModeSelected
    ? precisionWebSearchEnabled
    : isWebSearchExecutionMode(executionMode)
  const isSeparateFoodEstimateEnabled = isStrictBaseModeSelected && precisionSeparateEnabled
  const selectedImagePaths = imagePaths.filter(Boolean)
  const precisionSlotsComplete = isPrecisionCaptureComplete(imagePaths)
  const videoCaptureComplete = isVideoKeyframeCaptureComplete(videoUploadResult?.keyframes || [])
  const precisionCaptureComplete = isVideoCaptureSelected ? videoCaptureComplete : precisionSlotsComplete

  const creditUnits = 1
  const isQuotaExhausted = isFoodAnalysisCreditExhausted(membershipStatus, executionMode, creditUnits)

  useEffect(() => {
    if (!membershipStatus) return
    if (isPrecisionExecutionMode(executionMode) && !canUseStrictMode && !precisionSessionId) {
      setExecutionMode('standard')
      setAnalysisEngine(defaultAnalysisEngineForMode('standard'))
      setPreciseMicronutrients(false)
    }
  }, [membershipStatus, executionMode, canUseStrictMode, precisionSessionId])

  /** 多视角开关：纯 View 实现，避免任意 Switch 组件在分包内触发 react 未定义 */
  const handleMultiViewSwitchChange = (e: { detail?: { value?: boolean } }) => {
    const nextValue = e.detail?.value === true
    setIsMultiView(nextValue)
  }

  const toggleMultiView = () => {
    handleMultiViewSwitchChange({ detail: { value: !isMultiView } })
  }

  const toggleSuggestRatio = () => {
    const nextValue = !suggestRatioEnabled
    setSuggestRatioEnabled(nextValue)
    Taro.setStorageSync(SUGGEST_RATIO_STORAGE_KEY, nextValue ? '1' : '0')
  }

  const handleBaseModeTap = (baseMode: AnalyzeBaseMode) => {
    if (baseMode === 'strict' && !canUseStrictMode) {
      promptStrictModeUpgrade({
        membershipStatus,
        source: 'precision_upgrade',
      })
      return
    }
    if (baseMode === 'strict') {
      setExecutionMode('strict')
      setAnalysisEngine(defaultAnalysisEngineForMode('strict'))
      setImagePaths(prev => precisionCaptureMode === 'video'
        ? (videoUploadResult?.keyframes.map(frame => frame.image_url) || [])
        : [prev[0] || '', prev[1] || ''])
      return
    }
    setImagePaths(prev => precisionCaptureMode === 'video' ? [] : prev.filter(Boolean))
    const nextMode = resolveExecutionModeFromOptions(baseMode, isWebSearchEnabled, false)
    setExecutionMode(nextMode)
    setAnalysisEngine(defaultAnalysisEngineForMode(nextMode))
    setPreciseMicronutrients(false)
  }

  const handleAnalysisEngineTap = (engine: AnalysisEngine) => {
    setAnalysisEngine(engine)
    Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, engine)
    if (engine !== 'db_candidates_ai') setPreciseMicronutrients(false)
  }

  const handlePrecisionCaptureModeTap = (mode: PrecisionCaptureMode) => {
    if (isVideoUploading || mode === precisionCaptureMode) return
    setPrecisionCaptureMode(mode)
    if (mode === 'video') {
      setImagePaths(videoUploadResult?.keyframes.map(frame => frame.image_url) || [])
    } else {
      setImagePaths(['', ''])
    }
  }

  const toggleWebSearch = () => {
    if (isStrictBaseModeSelected) {
      setPrecisionWebSearchEnabled(value => !value)
      return
    }
    const nextValue = !isWebSearchEnabled
    const nextMode = resolveExecutionModeFromOptions(selectedBaseMode, nextValue, false)
    setExecutionMode(nextMode)
  }

  const toggleSeparateFoodEstimate = () => {
    if (!canUseStrictMode) {
      promptStrictModeUpgrade({
        membershipStatus,
        source: 'precision_upgrade',
      })
      return
    }
    if (!isStrictBaseModeSelected) {
      Taro.showToast({ title: '请先选择精准模式', icon: 'none' })
      return
    }
    setPrecisionSeparateEnabled(value => !value)
  }

  const togglePrecisionInteractive = () => {
    if (!isStrictBaseModeSelected) {
      Taro.showToast({ title: '请先选择精准模式', icon: 'none' })
      return
    }
    setPrecisionInteractiveEnabled(value => !value)
  }

  // 每次进入拍照页都刷新配额（从分析结果页返回时）；无图时按当前时间刷新默认餐次
  useDidShow(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextSessionId = String(params?.precision_session_id || '').trim()
    const requestedCaptureMode = String(params?.capture_mode || '').trim()
    const requestedAnalysisEngine = String(params?.analysis_engine || '').trim()
    const nextSignature = `${nextSessionId}|${requestedAnalysisEngine}|${requestedCaptureMode}`
    if (routeSessionSignatureRef.current !== nextSignature) {
      routeSessionSignatureRef.current = nextSignature
      console.info('[analyze] sync route session', {
        precision_session_id: nextSessionId || '(none)',
        analysis_engine: requestedAnalysisEngine || '(from storage)',
      })
      setPrecisionSessionId(nextSessionId)
      if (nextSessionId) {
        setExecutionMode('strict')
        if (requestedCaptureMode === 'video') setPrecisionCaptureMode('video')
      }
      if (requestedAnalysisEngine) {
        const requestedEngine = normalizeAnalysisEngine(requestedAnalysisEngine, nextSessionId ? 'strict' : executionMode)
        setAnalysisEngine(requestedEngine)
        Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, requestedEngine)
      }
    }
    if (getAccessToken()) {
      getMyMembership().then(ms => setMembershipStatus(ms)).catch(() => {})
      const targetDate = getStoredRecordTargetDate()
      if (targetDate !== getTodayRecordDateKey()) {
        getMyMembership(targetDate).then(ms => setTargetDateStatus(ms)).catch(() => {})
      } else {
        setTargetDateStatus(null)
      }
    }
    if (imagePathsRef.current.length === 0) {
      setMealType(defaultMealType)
    }
    if (shouldOfferOnboardingGuide(ONBOARDING_ANALYZE_PREP_GUIDE_KEY)) {
      setShowAnalyzeOnboardingGuide(true)
    } else {
      setShowAnalyzeOnboardingGuide(false)
    }
  })

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextSessionId = String(params?.precision_session_id || '').trim()
    const requestedCaptureMode = String(params?.capture_mode || '').trim()
    persistRecordTargetDate(String(params?.date || ''))
    const requestedAnalysisEngine = String(params?.analysis_engine || '').trim()
    routeSessionSignatureRef.current = `${nextSessionId}|${requestedAnalysisEngine}|${requestedCaptureMode}`
    setPrecisionSessionId(nextSessionId)
    if (nextSessionId) {
      setExecutionMode('strict')
      if (requestedCaptureMode === 'video') setPrecisionCaptureMode('video')
    }
    if (requestedAnalysisEngine) {
      const requestedEngine = normalizeAnalysisEngine(requestedAnalysisEngine, nextSessionId ? 'strict' : executionMode)
      setAnalysisEngine(requestedEngine)
      Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, requestedEngine)
    }

    // 1. 获取分析默认配置
    const initAnalyzeDefaults = async () => {
    try {
      if (getAccessToken()) {
        const profile = await getHealthProfile()
        const inferredMealType = await getRecommendedMealTypeWithFallback({ profile })
        setDefaultMealType(inferredMealType)
        setMealType(inferredMealType)
        if (!nextSessionId && profile.execution_mode) {
          const profileMode = normalizeAvailableExecutionMode(profile.execution_mode)
          setExecutionMode(profileMode)
          if (!requestedAnalysisEngine) setAnalysisEngine(defaultAnalysisEngineForMode(profileMode))
        }
          const referenceDefaults = normalizeReferenceDefaults(profile.health_condition?.precision_reference_defaults)
          setSavedReferenceDefaults(referenceDefaults)
          applyReferencePreset(referenceDefaults.preferred_reference_key || DEFAULT_REFERENCE_PRESET, referenceDefaults)
          // 加载会员状态和配额
          try {
            const ms = await getMyMembership()
            setMembershipStatus(ms)
            const targetDate = getStoredRecordTargetDate()
            if (targetDate !== getTodayRecordDateKey()) {
              const tms = await getMyMembership(targetDate)
              setTargetDateStatus(tms)
            } else {
              setTargetDateStatus(null)
            }
          } catch (err) {
            console.error('获取会员状态失败:', err)
          }
        }
      } catch (err) {
        console.error('初始化分析默认配置失败:', err)
      }
    }
    initAnalyzeDefaults()

    // 2. 从本地存储获取图片路径 (用于拍照/相册后的跳转)
    const initStoredImagePath = async () => {
      try {
        if (nextSessionId) {
          if (requestedCaptureMode === 'video') {
            setImagePaths([])
            return
          }
          const storedRetakePaths = Taro.getStorageSync('analyzePrecisionRetakeImagePaths')
          Taro.removeStorageSync('analyzePrecisionRetakeImagePaths')
          Taro.removeStorageSync('analyzeImagePath')
          Taro.removeStorageSync('analyzeImagePaths')
          if (Array.isArray(storedRetakePaths)) {
            setImagePaths([String(storedRetakePaths[0] || ''), String(storedRetakePaths[1] || '')])
          } else {
            setImagePaths(['', ''])
          }
          return
        }
        const storedPaths = Taro.getStorageSync('analyzeImagePaths')
        const storedPath = Taro.getStorageSync('analyzeImagePath')
        if (storedPaths && Array.isArray(storedPaths) && storedPaths.length > 0) {
          const paths = storedPaths.map((p: string) => String(p || '').trim()).filter(Boolean)
          const newPaths = await persistImagePathsImmediately(paths)
          const finalPaths = newPaths.length > 0 ? newPaths : paths
          setImagePaths(finalPaths)
          Taro.setStorageSync('analyzeImagePaths', finalPaths)
          Taro.removeStorageSync('analyzeImagePath')
        } else if (storedPath) {
          const path = String(storedPath)
          const [stablePath] = await persistImagePathsImmediately([path])
          const finalPath = stablePath || path
          setImagePaths([finalPath])
          Taro.setStorageSync('analyzeImagePaths', [finalPath])
          Taro.removeStorageSync('analyzeImagePath')
        }
      } catch (error) {
        console.error('获取图片路径失败:', error)
      }
    }
    initStoredImagePath()
  }, [])

  const getReferencePresetConfig = (
    value: ReferencePresetValue,
    defaults: PrecisionReferenceDefaults = savedReferenceDefaults,
  ): PrecisionReferencePresetConfig => {
    const presetMeta = REFERENCE_PRESETS.find(item => item.value === value)
    const fallbackLabel = presetMeta?.label || '参考物'
    const savedPreset = defaults.presets?.[value]
    if (savedPreset) {
      return normalizeReferencePresetConfig(savedPreset, fallbackLabel)
    }
    return {
      reference_name: fallbackLabel,
      dimensions_mm: presetMeta?.dimensions && Object.keys(presetMeta.dimensions).length > 0
        ? { ...presetMeta.dimensions }
        : undefined,
    }
  }

  const applyReferencePreset = (
    value: ReferencePresetValue,
    defaults: PrecisionReferenceDefaults = savedReferenceDefaults,
  ) => {
    setReferencePreset(value)
    const target = getReferencePresetConfig(value, defaults)
    setReferenceName(target.reference_name)
    setReferenceLength(target.dimensions_mm?.length != null ? String(target.dimensions_mm.length) : '')
    setReferenceWidth(target.dimensions_mm?.width != null ? String(target.dimensions_mm.width) : '')
    setReferenceHeight(target.dimensions_mm?.height != null ? String(target.dimensions_mm.height) : '')
    setReferenceDiameter(target.dimensions_mm?.diameter != null ? String(target.dimensions_mm.diameter) : '')
  }

  const handleReferencePresetSelect = (value: ReferencePresetValue) => {
    applyReferencePreset(value)
  }

  const buildNextReferenceDefaults = (): PrecisionReferenceDefaults => {
    const currentPresetConfig = normalizeReferencePresetConfig({
      reference_name: referenceName.trim() || getReferencePresetConfig(referencePreset).reference_name,
      dimensions_mm: {
        length: normalizePositiveReferenceDimension(referenceLength),
        width: normalizePositiveReferenceDimension(referenceWidth),
        height: normalizePositiveReferenceDimension(referenceHeight),
        diameter: normalizePositiveReferenceDimension(referenceDiameter),
      },
    }, getReferencePresetConfig(referencePreset).reference_name)

    return {
      preferred_reference_key: referencePreset,
      presets: {
        ...(savedReferenceDefaults.presets || {}),
        [referencePreset]: currentPresetConfig,
      },
    }
  }

  const buildReferenceObjects = (): PrecisionReferenceObjectInput[] => {
    if (!isStrictBaseModeSelected || !hasReferenceObject) return []
    const name = referenceName.trim()
    if (!name) return []
    const length = normalizePositiveReferenceDimension(referenceLength)
    const width = normalizePositiveReferenceDimension(referenceWidth)
    const height = normalizePositiveReferenceDimension(referenceHeight)
    const diameter = normalizePositiveReferenceDimension(referenceDiameter)
    return [{
      reference_type: referencePreset === 'custom' ? 'custom' : 'preset',
      reference_name: name,
      dimensions_mm: {
        ...(length != null ? { length } : {}),
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
        ...(diameter != null ? { diameter } : {}),
      },
      placement_note: referencePlacementNote.trim() || undefined,
    }]
  }

  const buildPrecisionReferenceObject = (): PrecisionCaptureReferenceInput => {
    if (!hasReferenceObject) {
      return { presence: 'absent' }
    }
    const dimensions: Record<string, number> = {}
    const length = normalizePositiveReferenceDimension(referenceLength)
    const width = normalizePositiveReferenceDimension(referenceWidth)
    const height = normalizePositiveReferenceDimension(referenceHeight)
    const diameter = normalizePositiveReferenceDimension(referenceDiameter)
    if (length != null) dimensions.length = length
    if (width != null) dimensions.width = width
    if (height != null) dimensions.height = height
    if (diameter != null) dimensions.diameter = diameter
    return {
      presence: 'present',
      kind: referenceName.trim() || getReferencePresetConfig(referencePreset).reference_name,
      shape: referencePreset === 'round_plate' ? 'circle' : referencePreset === 'custom' ? 'custom' : 'rectangle',
      dimensions_mm: dimensions,
      placement_note: referencePlacementNote.trim() || undefined,
    }
  }

  const handleChooseImage = async () => {
    const remain = MAX_ANALYZE_IMAGES - imagePaths.length
    if (remain <= 0) {
      Taro.showToast({ title: `最多支持 ${MAX_ANALYZE_IMAGES} 张图片`, icon: 'none' })
      return
    }
    try {
      // 使用 chooseImage 避免开发者工具返回 http://tmp 的不可读临时路径
      const res = await chooseImageWithPrivacy({
        count: remain,
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
      })
      const rawPaths = (res.tempFilePaths || []).map(p => String(p || '').trim()).filter(Boolean)
      const newPaths = await persistImagePathsImmediately(rawPaths)
      setImagePaths(prev => [...prev, ...newPaths])
    } catch (e) {
      if ((e as any)?.errMsg?.includes('cancel')) return
      if (isPrivacyAuthorizeError(e)) {
        showPrivacyAuthorizeFailure(e)
        return
      }
      console.log('选择图片取消/失败', e)
    }
  }

  const handleChoosePrecisionImage = async (role: 'top_down' | 'oblique_45') => {
    const slotIndex = role === 'top_down' ? 0 : 1
    try {
      const res = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
      })
      const rawPath = String(res.tempFilePaths?.[0] || '').trim()
      if (!rawPath) return
      const [stablePath] = await persistImagePathsImmediately([rawPath])
      const nextPath = stablePath || rawPath
      setImagePaths(prev => {
        const next = [prev[0] || '', prev[1] || '']
        const otherIndex = slotIndex === 0 ? 1 : 0
        if (next[otherIndex] && next[otherIndex] === nextPath) {
          Taro.showToast({ title: '两个角度不能使用同一张图片', icon: 'none' })
          return next
        }
        next[slotIndex] = nextPath
        return next
      })
    } catch (e) {
      if ((e as any)?.errMsg?.includes('cancel')) return
      if (isPrivacyAuthorizeError(e)) {
        showPrivacyAuthorizeFailure(e)
        return
      }
      console.log('选择精准模式图片取消/失败', e)
    }
  }

  const uploadSelectedAnalyzeVideo = async (video: SelectedAnalyzeVideo) => {
    setIsVideoUploading(true)
    setVideoUploadProgress(1)
    setVideoUploadResult(null)
    setImagePaths([])
    try {
      const result = await uploadAnalyzeVideoFile(video.tempFilePath, setVideoUploadProgress)
      setVideoUploadResult(result)
      setImagePaths(result.keyframes.map(frame => frame.image_url))
      Taro.showToast({ title: '关键帧已提取', icon: 'success' })
    } catch (error) {
      setVideoUploadProgress(0)
      await showUnifiedApiError(error, '视频处理失败，请重新录制')
    } finally {
      setIsVideoUploading(false)
    }
  }

  const handleChooseAnalyzeVideo = async () => {
    if (isVideoUploading) return
    try {
      const selected = await Taro.chooseVideo({
        sourceType: ['camera', 'album'],
        maxDuration: MAX_ANALYZE_VIDEO_DURATION_SECONDS,
        compressed: false,
        camera: 'back',
      })
      const duration = Number(selected.duration || 0)
      if (duration < 2) {
        Taro.showToast({ title: '请至少录制 2 秒', icon: 'none' })
        return
      }
      if (duration > MAX_ANALYZE_VIDEO_DURATION_SECONDS + 0.25) {
        Taro.showToast({ title: '视频最长支持 12 秒', icon: 'none' })
        return
      }

      let tempFilePath = String(selected.tempFilePath || '').trim()
      let size = Number(selected.size || 0)
      if (!tempFilePath) throw new Error('没有取得视频文件')
      if (size > MAX_ANALYZE_VIDEO_SIZE_BYTES) {
        setIsVideoUploading(true)
        try {
          const compressed = await compressAnalyzeVideoToLimit(
            { tempFilePath, size },
            MAX_ANALYZE_VIDEO_SIZE_BYTES,
            async (sourcePath, profile) => {
              const output = await Taro.compressVideo({
                src: sourcePath,
                quality: 'medium',
                bitrate: profile.bitrate,
                fps: profile.fps,
                resolution: profile.resolution,
              })
              const outputPath = String(output.tempFilePath || '').trim()
              const outputInfo = outputPath ? await Taro.getFileInfo({ filePath: outputPath }) : null
              return {
                tempFilePath: outputPath,
                size: Number(outputInfo && 'size' in outputInfo ? outputInfo.size : output.size || 0),
              }
            },
          )
          tempFilePath = compressed.tempFilePath
          size = compressed.size
        } finally {
          setIsVideoUploading(false)
        }
      }
      if (!tempFilePath || size <= 0 || size > MAX_ANALYZE_VIDEO_SIZE_BYTES) {
        Taro.showToast({ title: '视频压缩后仍超过 8MB，请缩短后重试', icon: 'none', duration: 3000 })
        return
      }

      const video: SelectedAnalyzeVideo = {
        tempFilePath,
        duration,
        size,
        width: Number(selected.width || 0),
        height: Number(selected.height || 0),
      }
      setSelectedVideo(video)
      await uploadSelectedAnalyzeVideo(video)
    } catch (error: any) {
      const message = String(error?.errMsg || error?.message || '')
      if (message.includes('cancel')) return
      await showUnifiedApiError(error, '选择视频失败，请重试')
    }
  }

  const clearAnalyzeVideo = () => {
    if (isVideoUploading) return
    setSelectedVideo(null)
    setVideoUploadResult(null)
    setVideoUploadProgress(0)
    setImagePaths([])
  }

  const handleRemoveImage = (index: number) => {
    setImagePaths(prev => {
      if (isStrictBaseModeSelected) {
        const next = [prev[0] || '', prev[1] || '']
        next[index] = ''
        return next
      }
      const newPaths = [...prev]
      newPaths.splice(index, 1)
      return newPaths
    })
  }

  const handleActivityTimingSelect = (value: ActivityTiming) => {
    setActivityTiming(value)
  }

  const handleDefaultModeEdit = () => {
    Taro.navigateTo({ url: extraPkgUrl('/pages/health-profile-view/index') })
  }

  usePageScrollLock(showAnalyzeOnboardingGuide)

  const doAnalyze = async () => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录后再使用识别功能', icon: 'none' })
      return
    }
    const submitImagePaths = isVideoCaptureSelected
      ? (videoUploadResult?.keyframes.map(frame => frame.image_url) || [])
      : isStrictBaseModeSelected
        ? [imagePaths[0] || '', imagePaths[1] || ''].filter(Boolean)
      : selectedImagePaths
    if (submitImagePaths.length === 0) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }
    if (isVideoCaptureSelected && !videoCaptureComplete) {
      Taro.showToast({ title: '请先录制视频并等待关键帧提取完成', icon: 'none' })
      return
    }
    if (isStrictBaseModeSelected && !isVideoCaptureSelected && !precisionSlotsComplete) {
      Taro.showToast({ title: '精准模式需要完整俯拍和 45° 斜拍各一张', icon: 'none' })
      return
    }
    if (!isVideoCaptureSelected && submitImagePaths.length > MAX_ANALYZE_IMAGES) {
      Taro.showToast({ title: `最多支持 ${MAX_ANALYZE_IMAGES} 张图片`, icon: 'none' })
      return
    }

    setIsAnalyzing(true)

    Taro.showLoading({ title: '', mask: true })

    try {
      // 1. 并行上传图片并保持原始顺序，避免多角度识别把上传耗时串行叠加。
      const imageUrls = await Promise.all(submitImagePaths.map(async path => {
        if (/^https?:\/\//i.test(path)) {
          return path
        }
        const stablePath = await persistImagePathIfNeeded(path)
        const uploadPath = await compressImagePathForUpload(stablePath || path, {
          // 精准双角度继续保留原像素，只复用原有 2.5MB 体积门槛；普通模式才收敛超高像素。
          maxLongEdge: isStrictBaseModeSelected ? 0 : 2048,
        })

        try {
          const { imageUrl } = await uploadAnalyzeImageFile(uploadPath || stablePath || path)
          return imageUrl
        } catch (fileUploadError) {
          if (!shouldFallbackToLegacyAnalyzeUpload(fileUploadError)) {
            throw fileUploadError
          }
          console.warn('文件直传接口暂不可用，回退 base64 上传:', fileUploadError)
        }

        const base64 = await imageToBase64(uploadPath || stablePath || path)
        const { imageUrl } = await uploadAnalyzeImage(base64)
        return imageUrl
      }))

      const primaryImageUrl = imageUrls[0]
      const referenceObjects = buildReferenceObjects()
      const nextReferenceDefaults = buildNextReferenceDefaults()
      const precisionOptions = isStrictBaseModeSelected
        ? buildPrecisionOptions(precisionInteractiveEnabled, precisionSeparateEnabled, precisionWebSearchEnabled)
        : undefined
      const captureViews = isVideoCaptureSelected
        ? videoUploadResult?.keyframes
        : isStrictBaseModeSelected
          ? buildDualAngleCaptureViews(imageUrls)
        : undefined
      const precisionReferenceObject = isStrictBaseModeSelected ? buildPrecisionReferenceObject() : undefined

      Taro.showLoading({ title: '', mask: true })
      const commonPayload = {
        date: getStoredRecordTargetDate(),
        meal_type: mealType,
        diet_goal: 'none',
        activity_timing: activityTiming,
        additionalContext: additionalInfo || undefined,
        is_multi_view: isStrictBaseModeSelected ? true : isMultiView,
        suggest_ratio_enabled: suggestRatioEnabled,
        analysis_engine: analysisEngine,
        precise_micronutrients: preciseMicronutrients && analysisEngine === 'db_candidates_ai' && canUseStrictMode,
        reference_objects: referenceObjects.length > 0 ? referenceObjects : undefined,
        capture_protocol: isVideoCaptureSelected
          ? 'video_keyframes_v1' as const
          : isStrictBaseModeSelected ? 'dual_angle_v1' as const : undefined,
        precision_options: precisionOptions,
        capture_views: captureViews,
        video_capture: isVideoCaptureSelected && videoUploadResult ? {
          video_id: videoUploadResult.video_id,
          duration_ms: videoUploadResult.duration_ms,
          width: videoUploadResult.width,
          height: videoUploadResult.height,
          size_bytes: videoUploadResult.size_bytes,
          source_retained: false as const,
        } : undefined,
        reference_object: precisionReferenceObject,
      }

      // 保存图片路径供后续页面使用
      if (submitImagePaths.length > 0) {
        Taro.setStorageSync('analyzeImagePath', submitImagePaths[0])
        Taro.setStorageSync('analyzeImagePaths', submitImagePaths)
      }
      Taro.setStorageSync('analyzeMealType', mealType)
      Taro.removeStorageSync('analyzeDietGoal')
      Taro.setStorageSync('analyzeActivityTiming', activityTiming)
      Taro.setStorageSync('analyzeExecutionMode', executionMode)
      Taro.setStorageSync('analyzePrecisionCaptureMode', isVideoCaptureSelected ? 'video' : 'photos')
      Taro.setStorageSync(SUGGEST_RATIO_STORAGE_KEY, suggestRatioEnabled ? '1' : '0')
      Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, analysisEngine)
      if (isStrictBaseModeSelected && hasReferenceObject) {
        setSavedReferenceDefaults(nextReferenceDefaults)
        updateHealthProfile({
          precision_reference_defaults: nextReferenceDefaults,
        }).catch((error) => {
          console.warn('[analyze] 保存默认参考物失败', error)
        })
      }

      // 图片分析统一走异步任务流程：
      // 多图也先进入 analyze-loading，由后台继续处理，用户可直接离开当前页。
      const response = precisionSessionId
        ? await continuePrecisionSession(precisionSessionId, {
            source_type: 'image',
            image_url: primaryImageUrl,
            image_urls: imageUrls,
            ...commonPayload,
          })
        : await submitAnalyzeTask({
            image_url: primaryImageUrl,
            image_urls: imageUrls,
            // modelName 默认不传，由后端按当前模式选择识别通道。
            execution_mode: executionMode,
            ...commonPayload,
          })
      const task_id = String(
        (response as { task_id?: string; taskId?: string }).task_id
          ?? (response as { task_id?: string; taskId?: string }).taskId
          ?? ''
      ).trim()
      if (!task_id) {
        throw new Error('服务器未返回任务编号，请稍后重试')
      }
      Taro.setStorageSync('analyzeTaskType', 'food')
      Taro.hideLoading()
      setIsAnalyzing(false)
      const q = `task_id=${encodeURIComponent(task_id)}&execution_mode=${encodeURIComponent(executionMode)}&task_type=food&analysis_engine=${encodeURIComponent(analysisEngine)}`
      Taro.redirectTo({
        url: `${extraPkgUrl('/pages/analyze-loading/index')}?${q}`
      })
    } catch (error: any) {
      Taro.hideLoading()
      setIsAnalyzing(false)
      const statusCode = (error as { statusCode?: number })?.statusCode
      const errMsg = error?.message || '分析失败，请重试'
      const isQuotaExhausted =
        statusCode === 402 ||
        statusCode === 429 ||
        errMsg.includes('上限') ||
        errMsg.includes('已达上限') ||
        errMsg.includes('次数已达') ||
        errMsg.includes('明日再试') ||
        errMsg.includes('积分不足')
      if (isQuotaExhausted) {
        setCreditSheet({ visible: true, message: errMsg })
      } else {
        await showUnifiedApiError(error, '分析失败，请重试')
      }
    }
  }

  /** 主按钮：无图则唤起选图；有图则直接提交并进入 analyze-loading（与拍照后进页再分析一致） */
  const handleAnalyzePress = () => {
    if (isAnalyzing || isVideoUploading) return
    const now = Date.now()
    if (now - analyzeSubmitDebounceRef.current < ANALYZE_SUBMIT_DEBOUNCE_MS) return
    analyzeSubmitDebounceRef.current = now
    if (isQuotaExhausted) {
      setCreditSheet({ visible: true, message: getFoodAnalysisCreditBlockMessage(membershipStatus, executionMode, creditUnits) })
      return
    }
    if (selectedImagePaths.length === 0) {
      if (isVideoCaptureSelected) {
        void handleChooseAnalyzeVideo()
      } else if (isStrictBaseModeSelected) {
        void handleChoosePrecisionImage('top_down')
      } else {
        void handleChooseImage()
      }
      return
    }
    void doAnalyze()
  }

  const handleVoiceInput = () => {
    Taro.showToast({
      title: '语音输入功能',
      icon: 'none'
    })
  }

  const handlePreviewImage = (current: string) => {
    const urls = imagePaths
    Taro.previewImage({
      current,
      urls
    })
  }

  // 配额提示条文案与样式计算
  const recordTargetDate = getStoredRecordTargetDate()
  const isBackfill = recordTargetDate !== getTodayRecordDateKey()
  const creditCost = getFoodAnalysisCreditCost(executionMode, creditUnits)

  let quotaBarClass = 'quota-bar'
  let quotaBarText = ''
  let quotaBarLoading = false
  if (isBackfill) {
    const targetSummary = targetDateStatus ? getMembershipCreditSummary(targetDateStatus) : null
    const targetHasInfo = targetSummary?.hasInfo ?? false
    const targetRemaining = targetSummary?.remaining ?? 0
    const monthDay = `${Number(recordTargetDate.slice(5, 7))}月${Number(recordTargetDate.slice(8, 10))}日`
    if (!targetHasInfo) {
      quotaBarLoading = true
    } else if (targetRemaining < creditCost) {
      quotaBarClass += ' quota-bar--warn'
      quotaBarText = `${monthDay}积分不足 · 将扣除今日积分 · 今日剩余 ${creditsRemaining}`
    } else {
      if (creditsRemaining <= 2) {
        quotaBarClass += ' quota-bar--warn'
      }
      quotaBarText = `${monthDay} · 已用 ${targetSummary?.used ?? 0}/${targetSummary?.max ?? 0} 积分 · 剩余 ${targetRemaining}${precisionUpgradeHint ? `  →${precisionUpgradeHint}` : ''}`
    }
  } else {
    if (isQuotaExhausted) {
      quotaBarClass += ' quota-bar--exhausted'
      quotaBarText = getFoodAnalysisCreditBlockMessage(membershipStatus, executionMode)
    } else if (hasCreditsInfo) {
      if (creditsRemaining <= 2) {
        quotaBarClass += ' quota-bar--warn'
      }
      quotaBarText = `今日已用 ${creditsUsed}/${creditsMax} 积分 · 剩余 ${creditsRemaining}${precisionUpgradeHint ? `  →${precisionUpgradeHint}` : ''}`
    } else {
      quotaBarLoading = true
    }
    if (membershipStatus?.is_pro) {
      quotaBarClass += ' quota-bar--pro'
    }
  }

  return (
    <>
      <PageMeta
        pageStyle={showAnalyzeOnboardingGuide ? PAGE_SCROLL_LOCK_STYLE : 'overflow: visible;'}
      />
      <View
        className={`analyze-page ${showAnalyzeOnboardingGuide ? 'analyze-page--scroll-locked' : ''}`}
      >
      {/* 提示：长按页面任意位置可启用开发者模式 */}
      {/* 配额提示 */}
      {membershipStatus && (
        <View
          className={quotaBarClass}
          onClick={() => {
            if (isQuotaExhausted) return
            if (!canUseStrictMode) Taro.navigateTo({ url: precisionUpgradeUrl })
          }}
        >
          {quotaBarLoading ? <View className='quota-bar-spinner' /> : (
            <>
              <Text className='quota-bar-dot' />
              <Text className='quota-bar-text'>{quotaBarText}</Text>
            </>
          )}
        </View>
      )}

      {/* 摄影技巧 */}
      <View
        className='photo-tip-bar'
        onClick={() => {
          if (isVideoCaptureSelected) {
            setHelpSheet({
              visible: true,
              title: '视频拍摄建议',
              content: '1. 可以自然横扫或逐个靠近食物\n2. 每种食物尽量清楚停留约半秒\n3. 尽量带到一帧整餐全景和一帧侧面高度\n4. 有参考物时让它随餐入镜\n5. 建议录制 4–8 秒，最长 12 秒',
            })
            return
          }
          const meta = EXECUTION_MODE_META[executionMode]
          setHelpSheet({
            visible: true,
            title: '摄影技巧',
            content: meta.tips.map((t, i) => `${i + 1}. ${t}`).join('\n'),
          })
        }}
      >
        <Text className='photo-tip-bar__dot' />
        <Text className='photo-tip-bar__text'>{isVideoCaptureSelected ? '视频拍摄建议' : '摄影技巧'}</Text>
        <Text className='photo-tip-bar__action'>查看</Text>
      </View>

      {/* 精准采集方式 */}
      {isStrictBaseModeSelected && (
        <View className='precision-capture-mode-card'>
          <View className='precision-capture-mode-copy'>
            <Text className='precision-capture-mode-title'>采集方式</Text>
            <Text className='precision-capture-mode-hint'>视频只提取关键帧，原视频不会保存</Text>
          </View>
          <View className='precision-capture-mode-switch'>
            <View
              className={`precision-capture-mode-option ${precisionCaptureMode === 'photos' ? 'active' : ''}`}
              onClick={() => handlePrecisionCaptureModeTap('photos')}
            >双角度照片</View>
            <View
              className={`precision-capture-mode-option ${precisionCaptureMode === 'video' ? 'active' : ''}`}
              onClick={() => handlePrecisionCaptureModeTap('video')}
            >短视频</View>
          </View>
        </View>
      )}

      {/* 图片或视频预览区域 */}
      <View className='image-preview-section'>
        {isVideoCaptureSelected ? (
          <View className='precision-video-capture'>
            {selectedVideo ? (
              <View className='precision-video-preview-wrap'>
                <Video
                  className='precision-video-preview'
                  src={selectedVideo.tempFilePath}
                  controls
                  showCenterPlayBtn
                  objectFit='cover'
                />
                <View className='precision-video-actions'>
                  <View className='precision-video-action' onClick={() => void handleChooseAnalyzeVideo()}>重新录制</View>
                  <View className='precision-video-action precision-video-action--danger' onClick={clearAnalyzeVideo}>移除</View>
                </View>
              </View>
            ) : (
              <View className='precision-video-empty' onClick={() => void handleChooseAnalyzeVideo()}>
                <Text className='iconfont icon-xiangji precision-video-empty__icon' />
                <Text className='precision-video-empty__title'>录制食物短视频</Text>
                <Text className='precision-video-empty__hint'>自然扫过每种食物，尽量补一帧全景和侧面</Text>
                <Text className='precision-video-empty__limit'>最长 12 秒 · 最大 8MB</Text>
              </View>
            )}

            {isVideoUploading && (
              <View className='precision-video-progress' aria-label='视频处理进度'>
                <View className='precision-video-progress__track'>
                  <View className='precision-video-progress__bar' style={{ width: `${Math.max(2, videoUploadProgress)}%` }} />
                </View>
                <Text className='precision-video-progress__percent'>{videoUploadProgress}%</Text>
              </View>
            )}

            {videoUploadResult && (
              <View className='precision-video-frames'>
                <View className='precision-video-frames__header'>
                  <Text className='precision-video-frames__title'>已提取 {videoUploadResult.keyframes.length} 个关键帧</Text>
                  <Text className='precision-video-frames__meta'>{(videoUploadResult.duration_ms / 1000).toFixed(1)} 秒</Text>
                </View>
                <View className='precision-video-frames__grid'>
                  {videoUploadResult.keyframes.map((frame, index) => (
                    <View key={frame.role} className='precision-video-frame' onClick={() => handlePreviewImage(frame.image_url)}>
                      <Image className='precision-video-frame__image' src={frame.image_url} mode='aspectFill' />
                      <Text className='precision-video-frame__label'>{index + 1} · {((frame.timestamp_ms || 0) / 1000).toFixed(1)}s</Text>
                    </View>
                  ))}
                </View>
                <Text className='precision-capture-note'>系统会综合关键帧判断食物高度、遮挡和尺度；原视频处理后即删除。</Text>
              </View>
            )}
          </View>
        ) : isStrictBaseModeSelected ? (
          <View className='precision-capture-grid'>
            {PRECISION_CAPTURE_ROLES.map((role, index) => {
              const path = imagePaths[index] || ''
              const isTopDown = role === 'top_down'
              return (
                <View key={role} className={`precision-capture-slot ${path ? 'filled' : ''}`}>
                  <View className='precision-capture-slot__header'>
                    <Text className='precision-capture-slot__badge'>{index + 1}</Text>
                    <View className='precision-capture-slot__copy'>
                      <Text className='precision-capture-slot__title'>{isTopDown ? '完整俯拍' : '约 45° 斜拍'}</Text>
                      <Text className='precision-capture-slot__hint'>
                        {isTopDown ? '看清全部食物和占比' : '看清高度、容器边缘和遮挡'}
                      </Text>
                    </View>
                  </View>
                  {path ? (
                    <View className='precision-capture-slot__preview'>
                      <Image src={path} mode='aspectFill' className='precision-capture-slot__image' onClick={() => handlePreviewImage(path)} />
                      <View className='precision-capture-slot__replace' onClick={() => handleChoosePrecisionImage(role)}>重拍/替换</View>
                      <View
                        className='remove-btn'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveImage(index)
                        }}
                      >
                        <Text className='close-icon'>×</Text>
                      </View>
                    </View>
                  ) : (
                    <View className='precision-capture-slot__empty' onClick={() => handleChoosePrecisionImage(role)}>
                      <Text className='iconfont icon-xiangji precision-capture-slot__icon' />
                      <Text className='precision-capture-slot__action'>拍摄或选择</Text>
                    </View>
                  )}
                </View>
              )
            })}
            <Text className='precision-capture-note'>两张必须是同一餐，且不能重复使用同一图片。</Text>
          </View>
        ) : imagePaths.length > 0 ? (
          <View className='image-grid'>
            {imagePaths.map((path, index) => (
              <View key={index} className={`grid-item ${isMultiView ? 'grid-item--multiview' : ''}`}>
                <Image
                  src={path}
                  mode='aspectFill'
                  className='grid-image'
                  onClick={() => handlePreviewImage(path)}
                />

                <View className='remove-btn' onClick={(e) => {
                  e.stopPropagation()
                  handleRemoveImage(index)
                }}
                >
                  <Text className='close-icon'>×</Text>
                </View>
              </View>
            ))}
            {imagePaths.length < MAX_ANALYZE_IMAGES && (
              <View className='grid-item add-btn' onClick={handleChooseImage}>
                <Text className='add-icon'>+</Text>
                <Text className='add-text'>添加</Text>
              </View>
            )}
          </View>
        ) : (
          <View className='no-image-placeholder' onClick={handleChooseImage}>
            <View className='placeholder-content'>
              <Text className='iconfont icon-xiangji' style={{ fontSize: '64rpx', color: '#9ca3af', marginBottom: '16rpx' }} />
              <Text className='placeholder-text'>点击拍摄/上传食物</Text>
              <Text className='placeholder-sub'>相册上传最多支持 {MAX_ANALYZE_IMAGES} 张，多张将作为一次识别提交</Text>
            </View>
          </View>
        )}

        <View className='analyze-guide-quality-zone' id='analyze-guide-quality-zone'>
        {/* 图片分析设置 */}
        <View className='multiview-compact'>
          <View className='multiview-compact-left'>
            <Text className='multiview-compact-title'>识别模式</Text>
            <Text className='mode-link' onClick={handleDefaultModeEdit}>设为默认</Text>
          </View>
          <View className='mode-switch-row'>
            <View
              className={`mode-switch-item ${selectedBaseMode === 'fast' ? 'active' : ''}`}
              onClick={() => handleBaseModeTap('fast')}
            >
              快速
            </View>
            <View
              className={`mode-switch-item ${selectedBaseMode === 'standard' ? 'active' : ''}`}
              onClick={() => handleBaseModeTap('standard')}
            >
              普通
            </View>
            <View
              className={`mode-switch-item ${isStrictBaseModeSelected ? 'active' : ''} ${!canUseStrictMode ? 'locked' : ''}`}
              onClick={() => handleBaseModeTap('strict')}
            >
              {!canUseStrictMode ? '精准锁定' : '精准'}
            </View>
          </View>
        </View>

        <View className='analysis-engine-section'>
          <View className='analysis-engine-header'>
            <Text className='multiview-compact-title'>营养计算方式</Text>
            <View
              className='help-icon'
              onClick={() => setHelpSheet({
                visible: true,
                title: '营养计算方式',
                content: 'AI估算会完整理解当前输入且不套标准食物库；标准库校准只接受名称、状态和重量口径一致的精确项；精准候选会把候选连同完整上下文交给AI，并允许拒绝全部候选。',
              })}
            >
              <Text className='help-icon-text'>?</Text>
            </View>
          </View>
          <View className='analysis-engine-options'>
            {ANALYSIS_ENGINE_OPTIONS.map(option => (
              <View
                key={option.value}
                className={`analysis-engine-option ${analysisEngine === option.value ? 'active' : ''}`}
                onClick={() => handleAnalysisEngineTap(option.value)}
              >
                <Text className='analysis-engine-option__label'>{option.label}</Text>
                <Text className='analysis-engine-option__description'>{option.description}</Text>
              </View>
            ))}
          </View>
          {analysisEngine === 'db_candidates_ai' && isStrictBaseModeSelected && (
            <View className='analysis-engine-micro-row' onClick={() => setPreciseMicronutrients(value => !value)}>
              <View>
                <Text className='analysis-engine-micro-title'>会员微量元素</Text>
                <Text className='analysis-engine-micro-description'>额外补齐维生素、矿物质和营养来源</Text>
              </View>
              <View className={`analysis-option-switch ${preciseMicronutrients ? 'analysis-option-switch--on' : ''}`}>
                <View className='analysis-option-switch-knob' />
              </View>
            </View>
          )}
        </View>

        <View className='analysis-options-row'>
          <View
            className={`analysis-option-card ${precisionInteractiveEnabled && isStrictBaseModeSelected ? 'active' : ''} ${!isStrictBaseModeSelected ? 'disabled' : ''}`}
            onClick={togglePrecisionInteractive}
          >
            <View className='analysis-option-card-left'>
              <Text className='analysis-option-title'>交互确认</Text>
              <View
                className='help-icon'
                onClick={(e) => {
                  e.stopPropagation()
                  setHelpSheet({ visible: true, title: '交互确认', content: '精准模式默认开启。只有食物身份、状态口径、参考尺度或关键烹饪信息不清楚时才暂停，每轮最多 3 个问题；你也可以按当前信息继续估算。' })
                }}
              >
                <Text className='help-icon-text'>?</Text>
              </View>
            </View>
            <View className={`analysis-option-switch ${precisionInteractiveEnabled && isStrictBaseModeSelected ? 'analysis-option-switch--on' : ''}`}>
              <View className='analysis-option-switch-knob' />
            </View>
          </View>

          <View className={`analysis-option-card ${isWebSearchEnabled ? 'active' : ''}`} onClick={toggleWebSearch}>
            <View className='analysis-option-card-left'>
              <Text className='analysis-option-title'>联网校准</Text>
              <View className='help-icon' onClick={(e) => {
                e.stopPropagation()
                openHelp('web_search')
              }}
              >
                <Text className='help-icon-text'>?</Text>
              </View>
            </View>
            <View className={`analysis-option-switch ${isWebSearchEnabled ? 'analysis-option-switch--on' : ''}`}>
              <View className='analysis-option-switch-knob' />
            </View>
          </View>

          <View
            className={`analysis-option-card ${isSeparateFoodEstimateEnabled ? 'active' : ''} ${!isStrictBaseModeSelected ? 'disabled' : ''}`}
            onClick={toggleSeparateFoodEstimate}
          >
            <View className='analysis-option-card-left'>
              <Text className='analysis-option-title'>分项模式</Text>
              <View className='help-icon' onClick={(e) => {
                e.stopPropagation()
                openHelp('separate_foods')
              }}
              >
                <Text className='help-icon-text'>?</Text>
              </View>
            </View>
            <View className={`analysis-option-switch ${isSeparateFoodEstimateEnabled ? 'analysis-option-switch--on' : ''}`}>
              <View className='analysis-option-switch-knob' />
            </View>
          </View>
        </View>

        {!!precisionUpgradeHint && !isPrecisionExecutionMode(executionMode) && (
          <Text className='mode-upgrade-note'>{precisionUpgradeHint}</Text>
        )}

        {/* 多视角辅助模式 */}
        {!isStrictBaseModeSelected && <View className='multiview-compact'>
          <View className='multiview-compact-left'>
            <Text className='multiview-compact-title'>多视角辅助</Text>
            <View className='help-icon' onClick={() => openHelp('multiview')}>
              <Text className='help-icon-text'>?</Text>
            </View>
          </View>
          <View
            className={`multiview-toggle ${isMultiView ? 'multiview-toggle--on' : ''}`}
            onClick={toggleMultiView}
          >
            <View className='multiview-toggle-knob' />
          </View>
        </View>}

        {/* AI摄入比例 */}
        <View className='multiview-compact'>
          <View className='multiview-compact-left'>
            <Text className='multiview-compact-title'>AI摄入比例</Text>
            <View className='help-icon' onClick={() => openHelp('suggest_ratio')}>
              <Text className='help-icon-text'>?</Text>
            </View>
          </View>
          <View
            className={`multiview-toggle ${suggestRatioEnabled ? 'multiview-toggle--on' : ''}`}
            onClick={toggleSuggestRatio}
          >
            <View className='multiview-toggle-knob' />
          </View>
        </View>
        </View>
      </View>

      {/* 文字补充区域（放在照片下方，拍完再补充上下文） */}
      <View className='details-section'>
        <View className='section-header'>
          <Text className='section-title'>文字补充</Text>
          <View className='help-icon' onClick={() => openHelp('text')}>
            <Text className='help-icon-text'>?</Text>
          </View>
        </View>

        <View className='input-wrapper'>
          <Textarea
            className='details-input'
            placeholder='例如：这是学校食堂的大份，额外加了辣油，用的是 500ml 便当盒...'
            placeholderClass='input-placeholder'
            value={additionalInfo}
            onInput={(e) => setAdditionalInfo(e.detail.value)}
            maxlength={200}
            autoHeight
            showConfirmBar={false}
          />

        </View>
      </View>

      {isStrictBaseModeSelected && (
        <View className='details-section'>
        <View className='section-header'>
          <Text className='section-title'>精准拍摄设置 · 参考物</Text>
        </View>
        <Text className='section-hint'>
          {isVideoCaptureSelected
            ? '建议参考物在环绕过程中始终可见，默认标准卡片为 85.60 × 53.98 mm。也可以明确选择没有参考物，但结果会标记尺度不足。'
            : '建议两张图使用同一个已知尺寸物体，默认标准卡片为 85.60 × 53.98 mm。也可以明确选择没有参考物，但结果会标记尺度不足。'}
        </Text>

          {precisionSessionId ? (
            <View className='precision-session-tip'>
              <Text className='precision-session-tip-text'>当前正在继续上一轮精准估计，本次{isVideoCaptureSelected ? '视频' : '拍照'}会接到原会话继续判断。</Text>
            </View>
          ) : null}

          <View className='state-options precision-presence-options'>
            <View className={`state-option ${hasReferenceObject ? 'active' : ''}`} onClick={() => setHasReferenceObject(true)}>
              <Text className='state-label'>已放参考物</Text>
            </View>
            <View className={`state-option ${!hasReferenceObject ? 'active' : ''}`} onClick={() => setHasReferenceObject(false)}>
              <Text className='state-label'>没有参考物</Text>
            </View>
          </View>

          {!hasReferenceObject ? (
            <View className='precision-scale-warning'>本次仍可分析，但重量结果不会显示高尺度置信度。</View>
          ) : <>
          <View className='state-options'>
            {REFERENCE_PRESETS.map((preset) => (
              <View
                key={preset.value}
                className={`state-option ${referencePreset === preset.value ? 'active' : ''}`}
                onClick={() => handleReferencePresetSelect(preset.value)}
              >
                <Text className='state-label'>{preset.label}</Text>
              </View>
            ))}
          </View>

          <View className='precision-reference-grid'>
            <View className='precision-reference-field'>
              <Text className='precision-reference-label'>名称</Text>
              <Textarea
                className='details-input precision-reference-input'
                value={referenceName}
                onInput={(e) => setReferenceName(e.detail.value)}
                maxlength={30}
                autoHeight
                showConfirmBar={false}
              />
            </View>
            {referencePreset === 'round_plate' ? (
              <View className='precision-reference-field'>
                <Text className='precision-reference-label'>直径(mm)</Text>
                <Textarea
                  className='details-input precision-reference-input'
                  value={referenceDiameter}
                  onInput={(e) => setReferenceDiameter(e.detail.value)}
                  maxlength={8}
                  autoHeight
                  showConfirmBar={false}
                />
              </View>
            ) : <View className='precision-reference-row'>
              <View className='precision-reference-field short'>
                <Text className='precision-reference-label'>长(mm)</Text>
                <Textarea
                  className='details-input precision-reference-input'
                  value={referenceLength}
                  onInput={(e) => setReferenceLength(e.detail.value)}
                  maxlength={8}
                  autoHeight
                  showConfirmBar={false}
                />
              </View>
              <View className='precision-reference-field short'>
                <Text className='precision-reference-label'>宽(mm)</Text>
                <Textarea
                  className='details-input precision-reference-input'
                  value={referenceWidth}
                  onInput={(e) => setReferenceWidth(e.detail.value)}
                  maxlength={8}
                  autoHeight
                  showConfirmBar={false}
                />
              </View>
              <View className='precision-reference-field short'>
                <Text className='precision-reference-label'>高(mm)</Text>
                <Textarea
                  className='details-input precision-reference-input'
                  value={referenceHeight}
                  onInput={(e) => setReferenceHeight(e.detail.value)}
                  maxlength={8}
                  autoHeight
                  showConfirmBar={false}
                />
              </View>
            </View>}
            <View className='precision-reference-field'>
              <Text className='precision-reference-label'>摆放说明</Text>
              <Textarea
                className='details-input precision-reference-input'
                placeholder='例如：和米饭在同一平面，放在盘子右下角'
                placeholderClass='input-placeholder'
                value={referencePlacementNote}
                onInput={(e) => setReferencePlacementNote(e.detail.value)}
                maxlength={80}
                autoHeight
                showConfirmBar={false}
              />
            </View>
          </View>
          </>}
        </View>
      )}

      {/* 餐次（AI 将结合餐次分析） */}
      <View className='meal-section'>
        <View className='section-header'>
          <Text className='section-title'>餐次</Text>
          <View className='help-icon' onClick={() => openHelp('meal')}>
            <Text className='help-icon-text'>?</Text>
          </View>
        </View>
        <View className='meal-options'>
          {MEAL_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`meal-option ${mealType === opt.value ? 'active' : ''}`}
              onClick={() => setMealType(opt.value)}
            >
              <Text className={`meal-icon iconfont ${opt.iconClass}`} />
              <Text className='meal-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 运动时机（状态二） */}
      <View className='state-section'>
        <View className='section-header'>
          <Text className='section-title'>运动时机</Text>
          <View className='help-icon' onClick={() => openHelp('timing')}>
            <Text className='help-icon-text'>?</Text>
          </View>
        </View>
        <View className='state-options'>
          {ACTIVITY_TIMING_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`state-option ${activityTiming === opt.value ? 'active' : ''}`}
              onClick={() => handleActivityTimingSelect(opt.value)}
            >
              <Text className={`state-icon iconfont ${opt.iconClass}`} />
              <Text className='state-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 确认按钮 */}
      <View className='confirm-section'>
        <View
          className={`confirm-btn ${selectedImagePaths.length === 0 || (isStrictBaseModeSelected && !precisionCaptureComplete) || isVideoUploading || isAnalyzing || isQuotaExhausted ? 'disabled' : ''}`}
          onClick={handleAnalyzePress}
        >
          {isAnalyzing ? (
            <View className='btn-spinner' />
          ) : (
            <Text className='confirm-btn-text'>
              {isQuotaExhausted
                ? '积分不足，暂不可分析'
                : isVideoUploading
                  ? `${videoUploadProgress}%`
                  : selectedImagePaths.length === 0
                    ? (isVideoCaptureSelected ? '请先录制环绕短视频' : '请先拍照或选图')
                    : isStrictBaseModeSelected && !precisionCaptureComplete
                      ? (isVideoCaptureSelected ? '请重新录制有效视频' : '请补齐两个拍摄角度')
                      : isVideoCaptureSelected
                        ? `分析 ${selectedImagePaths.length} 个关键帧 · 消耗 ${creditCost} 积分`
                        : `分析 ${selectedImagePaths.length} 张 · 消耗 ${creditCost} 积分`}
            </Text>
          )}
        </View>

        <View
          className='history-link'
          onClick={() => Taro.navigateTo({ url: extraPkgUrl('/pages/analyze-history/index') })}
        >
          <Text className='iconfont icon-history' />
          <Text className='history-link-text'>查看识别记录</Text>
        </View>
      </View>

      {/* 帮助说明底部弹窗 */}
      {helpSheet.visible && (
        <View className='help-sheet' catchMove>
          <View className='help-sheet-mask' onClick={() => setHelpSheet(prev => ({ ...prev, visible: false }))} />
          <View className='help-sheet-content'>
            <View className='help-sheet-handle' />
            <View className='help-sheet-header'>
              <Text className='help-sheet-title'>{helpSheet.title}</Text>
              <View
                className='help-sheet-close'
                onClick={() => setHelpSheet(prev => ({ ...prev, visible: false }))}
              >
                <Text className='help-sheet-close-icon'>×</Text>
              </View>
            </View>
            <Text className='help-sheet-body'>{helpSheet.content}</Text>
          </View>
        </View>
      )}
      <CreditShortageSheet
        visible={creditSheet.visible}
        membershipStatus={membershipStatus}
        requiredCredits={creditCost}
        scenarioLabel='食物分析'
        message={creditSheet.message}
        onClose={() => setCreditSheet({ visible: false })}
      />

      </View>

      <OnboardingGuide
        visible={showAnalyzeOnboardingGuide}
        steps={ANALYZE_PREP_ONBOARDING_STEPS}
        storageKey={ONBOARDING_ANALYZE_PREP_GUIDE_KEY}
        onClose={() => setShowAnalyzeOnboardingGuide(false)}
      />
    </>
  )
}

export default withAuth(AnalyzePage)
