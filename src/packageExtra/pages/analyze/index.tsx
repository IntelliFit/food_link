import { View, Text, Image, Textarea } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useEffect, useState, useRef, useCallback } from 'react'
import {
  imageToBase64,
  compressImagePathForUpload,
  uploadAnalyzeImage,
  uploadAnalyzeImageFile,
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
import type { AnalyzeResponse, AnalysisEngine, ExecutionMode, PrecisionReferenceObjectInput } from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import {
  canUseStrictModeForMembership,
  getStrictModeLockedHint,
  getStrictModeUpgradeUrl,
  isPrecisionExecutionMode,
  normalizeAvailableExecutionMode,
  promptStrictModeUpgrade,
} from '../../../utils/execution-mode'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import {
  getFoodAnalysisCreditBlockMessage,
  getFoodAnalysisCreditCost,
  getMembershipCreditSummary,
  isFoodAnalysisCreditExhausted,
} from '../../../utils/membership'
import CreditShortageSheet from '../../../components/CreditShortageSheet'
import { getStoredRecordTargetDate, persistRecordTargetDate, getTodayRecordDateKey } from '../../../utils/record-date'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'
import { withAuth } from '../../../utils/withAuth'

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

const REFERENCE_PRESETS: Array<{
  value: ReferencePresetValue
  label: string
  dimensions: PrecisionReferenceDimensions
}> = [
  { value: 'hand', label: '手掌', dimensions: { length: 175, width: 85, height: 25 } },
  { value: 'campus_card', label: '常规卡片', dimensions: { length: 85.6, width: 54, height: 0.8 } },
  { value: 'large_card', label: '大卡片', dimensions: { length: 120, width: 76, height: 1 } },
  { value: 'custom', label: '自定义', dimensions: {} }
]

const DEFAULT_REFERENCE_PRESET: ReferencePresetValue = 'hand'
const ANALYSIS_ENGINE_STORAGE_KEY = 'analyzeAnalysisEngine'
const SUGGEST_RATIO_STORAGE_KEY = 'analyzeSuggestRatioEnabled'
const ANALYZE_SUBMIT_DEBOUNCE_MS = 300
const MAX_ANALYZE_IMAGES = 3

const normalizeAnalysisEngine = (value: unknown): AnalysisEngine => (
  value === 'legacy_direct' ? 'legacy_direct' : 'db_first'
)

const readSuggestRatioPreference = (): boolean => {
  const saved = Taro.getStorageSync(SUGGEST_RATIO_STORAGE_KEY)
  if (saved === false || saved === '0' || saved === 'false') return false
  if (saved === true || saved === '1' || saved === 'true') return true
  return true
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
  if (length != null) normalizedDimensions.length = length
  if (width != null) normalizedDimensions.width = width
  if (height != null) normalizedDimensions.height = height
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
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
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
  const [referenceName, setReferenceName] = useState('手掌')
  const [referenceLength, setReferenceLength] = useState('175')
  const [referenceWidth, setReferenceWidth] = useState('85')
  const [referenceHeight, setReferenceHeight] = useState('25')
  const [referencePlacementNote, setReferencePlacementNote] = useState('')
  const [creditSheet, setCreditSheet] = useState<{ visible: boolean; message?: string }>({
    visible: false,
  })

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
  imagePathsRef.current = imagePaths

  const canUseStrictMode = canUseStrictModeForMembership(membershipStatus)
  const { hasInfo: hasCreditsInfo, max: creditsMax, used: creditsUsed, remaining: creditsRemaining } =
    getMembershipCreditSummary(membershipStatus)
  const precisionUpgradeUrl = getStrictModeUpgradeUrl(membershipStatus)
  const precisionUpgradeHint = canUseStrictMode ? '' : getStrictModeLockedHint(membershipStatus)

  const creditUnits = 1
  const isQuotaExhausted = isFoodAnalysisCreditExhausted(membershipStatus, executionMode, creditUnits)

  useEffect(() => {
    if (!membershipStatus) return
    if (isPrecisionExecutionMode(executionMode) && !canUseStrictMode && !precisionSessionId) {
      setExecutionMode('standard')
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

  // 每次进入拍照页都刷新配额（从分析结果页返回时）；无图时按当前时间刷新默认餐次
  useDidShow(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextSessionId = String(params?.precision_session_id || '').trim()
    const requestedAnalysisEngine = String(params?.analysis_engine || '').trim()
    const nextSignature = `${nextSessionId}|${requestedAnalysisEngine}`
    if (routeSessionSignatureRef.current !== nextSignature) {
      routeSessionSignatureRef.current = nextSignature
      console.info('[analyze] sync route session', {
        precision_session_id: nextSessionId || '(none)',
        analysis_engine: requestedAnalysisEngine || '(from storage)',
      })
      setPrecisionSessionId(nextSessionId)
      if (nextSessionId) {
        setExecutionMode('experimental')
      }
      if (requestedAnalysisEngine) {
        Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, normalizeAnalysisEngine(requestedAnalysisEngine))
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
      setMealType(inferDefaultMealTypeFromLocalTime())
    }
  })

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    const nextSessionId = String(params?.precision_session_id || '').trim()
    persistRecordTargetDate(String(params?.date || ''))
    const requestedAnalysisEngine = String(params?.analysis_engine || '').trim()
    routeSessionSignatureRef.current = `${nextSessionId}|${requestedAnalysisEngine}`
    setPrecisionSessionId(nextSessionId)
    if (nextSessionId) {
      setExecutionMode('experimental')
    }
    if (requestedAnalysisEngine) {
      Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, normalizeAnalysisEngine(requestedAnalysisEngine))
    }

    // 1. 获取分析默认配置
    const initAnalyzeDefaults = async () => {
      try {
        if (getAccessToken()) {
          const profile = await getHealthProfile()
          if (!nextSessionId && profile.execution_mode) {
            setExecutionMode(normalizeAvailableExecutionMode(profile.execution_mode))
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
    if (executionMode !== 'experimental') return []
    const name = referenceName.trim()
    if (!name) return []
    const length = normalizePositiveReferenceDimension(referenceLength)
    const width = normalizePositiveReferenceDimension(referenceWidth)
    const height = normalizePositiveReferenceDimension(referenceHeight)
    return [{
      reference_type: referencePreset === 'custom' ? 'custom' : 'preset',
      reference_name: name,
      dimensions_mm: {
        ...(length != null ? { length } : {}),
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
      },
      placement_note: referencePlacementNote.trim() || undefined,
    }]
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

  const handleRemoveImage = (index: number) => {
    setImagePaths(prev => {
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

  const handleStrictModeTap = (targetMode: ExecutionMode = 'strict') => {
    if (canUseStrictMode) {
      setExecutionMode(targetMode)
      return
    }
    promptStrictModeUpgrade({
      membershipStatus,
      source: 'precision_upgrade',
    })
  }

  const doAnalyze = async () => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录后再使用识别功能', icon: 'none' })
      return
    }
    if (imagePaths.length === 0) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }
    if (imagePaths.length > MAX_ANALYZE_IMAGES) {
      Taro.showToast({ title: `最多支持 ${MAX_ANALYZE_IMAGES} 张图片`, icon: 'none' })
      return
    }

    setIsAnalyzing(true)

    Taro.showLoading({ title: '上传图片...', mask: true })

    try {
      // 1. 依次上传所有图片获取 URL
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
          console.warn('文件直传接口暂不可用，回退 base64 上传:', fileUploadError)
        }

        const base64 = await imageToBase64(uploadPath || stablePath || path)
        const { imageUrl } = await uploadAnalyzeImage(base64)
        imageUrls.push(imageUrl)
      }

      const primaryImageUrl = imageUrls[0]
      const referenceObjects = buildReferenceObjects()
      const nextReferenceDefaults = buildNextReferenceDefaults()

      Taro.showLoading({ title: '提交任务...', mask: true })
      const commonPayload = {
        date: getStoredRecordTargetDate(),
        meal_type: mealType,
        diet_goal: 'none',
        activity_timing: activityTiming,
        additionalContext: additionalInfo || undefined,
        is_multi_view: isMultiView,
        suggest_ratio_enabled: suggestRatioEnabled,
        reference_objects: referenceObjects.length > 0 ? referenceObjects : undefined,
      }

      // 保存图片路径供后续页面使用
      if (imagePaths.length > 0) {
        Taro.setStorageSync('analyzeImagePath', imagePaths[0])
        Taro.setStorageSync('analyzeImagePaths', imagePaths)
      }
      Taro.setStorageSync('analyzeMealType', mealType)
      Taro.removeStorageSync('analyzeDietGoal')
      Taro.setStorageSync('analyzeActivityTiming', activityTiming)
      Taro.setStorageSync('analyzeExecutionMode', executionMode)
      Taro.setStorageSync(SUGGEST_RATIO_STORAGE_KEY, suggestRatioEnabled ? '1' : '0')
      const analysisEngine = normalizeAnalysisEngine(Taro.getStorageSync(ANALYSIS_ENGINE_STORAGE_KEY))
      Taro.setStorageSync(ANALYSIS_ENGINE_STORAGE_KEY, analysisEngine)
      setSavedReferenceDefaults(nextReferenceDefaults)
      updateHealthProfile({
        precision_reference_defaults: nextReferenceDefaults,
      }).catch((error) => {
        console.warn('[analyze] 保存默认参考物失败', error)
      })

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
            analysis_engine: analysisEngine,
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
    if (isAnalyzing) return
    const now = Date.now()
    if (now - analyzeSubmitDebounceRef.current < ANALYZE_SUBMIT_DEBOUNCE_MS) return
    analyzeSubmitDebounceRef.current = now
    if (isQuotaExhausted) {
      setCreditSheet({ visible: true, message: getFoodAnalysisCreditBlockMessage(membershipStatus, executionMode, creditUnits) })
      return
    }
    if (imagePaths.length === 0) {
      void handleChooseImage()
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
  if (isBackfill) {
    const targetSummary = targetDateStatus ? getMembershipCreditSummary(targetDateStatus) : null
    const targetHasInfo = targetSummary?.hasInfo ?? false
    const targetRemaining = targetSummary?.remaining ?? 0
    const monthDay = `${Number(recordTargetDate.slice(5, 7))}月${Number(recordTargetDate.slice(8, 10))}日`
    if (!targetHasInfo) {
      quotaBarText = `${monthDay}积分信息加载中`
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
      quotaBarText = `今日积分信息加载中${precisionUpgradeHint ? `  →${precisionUpgradeHint}` : ''}`
    }
    if (membershipStatus?.is_pro) {
      quotaBarClass += ' quota-bar--pro'
    }
  }

  return (
    <View className='analyze-page'>
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
          <Text className='quota-bar-dot' />
          <Text className='quota-bar-text'>{quotaBarText}</Text>
        </View>
      )}

      {/* 摄影技巧 */}
      <View
        className='photo-tip-bar'
        onClick={() => {
          const meta = EXECUTION_MODE_META[executionMode]
          setHelpSheet({
            visible: true,
            title: '摄影技巧',
            content: meta.tips.map((t, i) => `${i + 1}. ${t}`).join('\n'),
          })
        }}
      >
        <Text className='photo-tip-bar__dot' />
        <Text className='photo-tip-bar__text'>摄影技巧</Text>
        <Text className='photo-tip-bar__action'>查看</Text>
      </View>

      {/* 图片预览区域 (Grid) */}
      <View className='image-preview-section'>
        {imagePaths.length > 0 ? (
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

        {/* 图片分析设置 */}
        <View className='multiview-compact'>
          <View className='multiview-compact-left'>
            <Text className='multiview-compact-title'>识别模式</Text>
            <Text className='mode-link' onClick={handleDefaultModeEdit}>设为默认</Text>
          </View>
          <View className='mode-switch-row'>
            <View
              className={`mode-switch-item ${executionMode === 'standard' ? 'active' : ''}`}
              onClick={() => setExecutionMode('standard')}
            >
              普通
            </View>
            <View
              className={`mode-switch-item ${executionMode === 'standard_web_search' ? 'active' : ''}`}
              onClick={() => setExecutionMode('standard_web_search')}
            >
              普通联网
            </View>
            <View
              className={`mode-switch-item ${executionMode === 'strict' ? 'active' : ''} ${!canUseStrictMode ? 'locked' : ''}`}
              onClick={() => handleStrictModeTap('strict')}
            >
              {!canUseStrictMode ? '精准锁定' : '精准'}
            </View>
            <View
              className={`mode-switch-item ${executionMode === 'strict_web_search' ? 'active' : ''} ${!canUseStrictMode ? 'locked' : ''}`}
              onClick={() => handleStrictModeTap('strict_web_search')}
            >
              {!canUseStrictMode ? '联网锁定' : '精准联网'}
            </View>
          </View>
        </View>

        {!!precisionUpgradeHint && !isPrecisionExecutionMode(executionMode) && (
          <Text className='mode-upgrade-note'>{precisionUpgradeHint}</Text>
        )}

        <View className='experiment-mode-panel'>
          <View className='experiment-mode-head'>
            <Text className='experiment-mode-title'>零食库试验模式</Text>
            <Text className='experiment-mode-sub'>不影响上方正式模式</Text>
          </View>
          <View
            className={`experiment-mode-card ${executionMode === 'standard_packaged_experiment' ? 'active' : ''}`}
            onClick={() => setExecutionMode('standard_packaged_experiment')}
          >
            <View className='experiment-mode-card-main'>
              <Text className='experiment-mode-card-title'>普通 · 零食库试验</Text>
              <Text className='experiment-mode-card-desc'>用已收录零食规格校准包装食品重量</Text>
            </View>
            <Text className='experiment-mode-card-badge'>2积分</Text>
          </View>
        </View>

        {/* 多视角辅助模式 */}
        <View className='multiview-compact'>
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
        </View>

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

      {executionMode === 'experimental' && (
        <View className='details-section'>
        <View className='section-header'>
          <Text className='section-title'>参考物</Text>
        </View>
        <Text className='section-hint'>
          可录入一个参考物和尺寸。默认会记住你常用的手掌或卡片大小，下次直接复用。
        </Text>

          {precisionSessionId ? (
            <View className='precision-session-tip'>
              <Text className='precision-session-tip-text'>当前正在继续上一轮精准估计，本次拍照会接到原会话继续判断。</Text>
            </View>
          ) : null}

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
            <View className='precision-reference-row'>
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
            </View>
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
          className={`confirm-btn ${imagePaths.length === 0 || isAnalyzing || isQuotaExhausted ? 'disabled' : ''}`}
          onClick={handleAnalyzePress}
        >
          {isAnalyzing ? (
            <View className='btn-spinner' />
          ) : (
            <Text className='confirm-btn-text'>
              {isQuotaExhausted
                ? '积分不足，暂不可分析'
                : imagePaths.length === 0
                  ? '请先拍照或选图'
                  : `分析 ${imagePaths.length} 张图片`}
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
  )
}

export default withAuth(AnalyzePage)
