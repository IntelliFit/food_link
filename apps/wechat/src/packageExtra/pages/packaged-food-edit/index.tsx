import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import { useMemo, useRef, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import {
  compressImagePathForUpload,
  createPackagedFood,
  getAnalyzeTask,
  listAnalyzeTasks,
  sanitizeUserFacingErrorMessage,
  searchManualFood,
  showUnifiedApiError,
  submitPackagedProductExtract,
  uploadAnalyzeImageFile,
  type CreatePackagedFoodRequest,
  type ManualFoodSearchResult,
  type PackagedAutoIngestResult,
  type PackagedProductExtractResult,
  type PackagedUploadRewardResult,
} from '../../../utils/api'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import { formatMacroNutrient, formatMicroNutrient } from '../../../utils/number-format'
import './index.scss'

const PACKAGED_FOOD_EDIT_DRAFT_KEY = 'packagedFoodEditDraft'
const PACKAGED_FOOD_EDIT_SAVED_KEY = 'packagedFoodEditSaved'
const PACKAGED_FOOD_UPLOAD_TASKS_KEY = 'packagedFoodUploadTasks'
const PACKAGED_FOOD_UPLOAD_CONSENT_KEY = 'packagedFoodUploadConsentV1'
const MAX_REWARD_UPLOAD_IMAGES = 3
const KJ_PER_KCAL = 4.184

type CaptureStep = 'front' | 'nutrition' | 'ingredients'
type EnergyUnit = 'kj' | 'kcal'
type UploadMode = 'upload' | 'manual'

type Draft = {
  itemId?: number
  sourceTaskId?: string
  recognizedNameHint?: string
  frontImageUrl?: string
  nutritionImageUrl?: string
  ingredientsImageUrl?: string
  brand: string
  productName: string
  flavorText: string
  packageCategory: string
  specText: string
  barcode: string
  ingredientsText: string
  netWeightG: string
  servingWeightG: string
  nutritionBasis: string
  energyUnit: EnergyUnit
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  sugar: string
  sodiumMg: string
  saturatedFat: string
  cholesterolMg: string
  potassiumMg: string
  calciumMg: string
  ironMg: string
  magnesiumMg: string
  zincMg: string
  vitaminARaeMcg: string
  vitaminCMg: string
  vitaminDMcg: string
  vitaminEMg: string
  vitaminKMcg: string
  thiaminMg: string
  riboflavinMg: string
  niacinMg: string
  vitaminB6Mg: string
  folateMcg: string
  vitaminB12Mcg: string
}

type CaptureImages = {
  front?: string
  nutrition?: string
  ingredients?: string
}

type UploadedImage = {
  localPath: string
  imageUrl: string
}

type UploadImageSource = 'album' | 'camera'

type PackagedUploadTaskEntry = {
  taskId: string
  createdAt: string
  updatedAt?: string
  imageCount: number
  status: string
  result?: PackagedProductExtractResult
  rewardResult?: PackagedUploadRewardResult
  errorMessage?: string
  productName?: string
  packagedFoodId?: string
  message?: string
  rewardAwarded?: boolean
  rewardCredits?: number
}

const emptyDraft: Draft = {
  brand: '',
  productName: '',
  flavorText: '',
  packageCategory: '',
  specText: '',
  barcode: '',
  ingredientsText: '',
  netWeightG: '',
  servingWeightG: '',
  nutritionBasis: '100',
  energyUnit: 'kj',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  fiber: '',
  sugar: '',
  sodiumMg: '',
  saturatedFat: '',
  cholesterolMg: '',
  potassiumMg: '',
  calciumMg: '',
  ironMg: '',
  magnesiumMg: '',
  zincMg: '',
  vitaminARaeMcg: '',
  vitaminCMg: '',
  vitaminDMcg: '',
  vitaminEMg: '',
  vitaminKMcg: '',
  thiaminMg: '',
  riboflavinMg: '',
  niacinMg: '',
  vitaminB6Mg: '',
  folateMcg: '',
  vitaminB12Mcg: '',
}

const moreNutritionFields: Array<{ field: keyof Draft; label: string; unit: string }> = [
  { field: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { field: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { field: 'potassiumMg', label: '钾', unit: 'mg' },
  { field: 'calciumMg', label: '钙', unit: 'mg' },
  { field: 'ironMg', label: '铁', unit: 'mg' },
  { field: 'magnesiumMg', label: '镁', unit: 'mg' },
  { field: 'zincMg', label: '锌', unit: 'mg' },
  { field: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { field: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { field: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { field: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { field: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { field: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { field: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { field: 'niacinMg', label: '烟酸', unit: 'mg' },
  { field: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { field: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { field: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' },
]

const stepMeta: Record<CaptureStep, { title: string; desc: string; cta: string }> = {
  front: {
    title: '第 1 步：拍包装正面和净含量',
    desc: '正着拍，包装名和“净含量/规格”必须完整入镜。没有重量无法完成任务。',
    cta: '拍正面和净含量',
  },
  nutrition: {
    title: '第 2 步：拍营养成分表',
    desc: '拍清楚能量、蛋白质、脂肪、碳水、钠，以及“每100g/每份”等口径。',
    cta: '拍营养成分表',
  },
  ingredients: {
    title: '补拍配料表',
    desc: '当前还需要配料表帮助确认名称或类别。只在识别不够确定时才需要这一步。',
    cta: '拍配料表',
  },
}

const numberFromDraft = (value: string) => {
  const n = Number(String(value || '').trim())
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const positiveNumberFromDraft = (value: string, fallback = 100) => {
  const n = Number(String(value || '').trim())
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const energyToKcal = (value: number, unit: EnergyUnit) => (
  unit === 'kj' ? value / KJ_PER_KCAL : value
)

const nutritionValuePer100g = (value: string, basis: number) => (
  basis > 0 ? numberFromDraft(value) * 100 / basis : numberFromDraft(value)
)

const macroFields = new Set<keyof Draft>([
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'saturatedFat',
  'netWeightG', 'servingWeightG',
])

const microFields = new Set<keyof Draft>([
  'sodiumMg', 'cholesterolMg', 'potassiumMg', 'calciumMg', 'ironMg',
  'magnesiumMg', 'zincMg', 'vitaminARaeMcg', 'vitaminCMg', 'vitaminDMcg',
  'vitaminEMg', 'vitaminKMcg', 'thiaminMg', 'riboflavinMg', 'niacinMg',
  'vitaminB6Mg', 'folateMcg', 'vitaminB12Mcg',
])

const formatRecognizedNumber = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

const formatRecognizedField = (field: keyof Draft, value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return ''
  if (macroFields.has(field)) return formatMacroNutrient(n)
  if (microFields.has(field)) return formatMicroNutrient(n)
  return formatRecognizedNumber(value)
}

const normalizeString = (value: unknown) => String(value || '').trim()

function isChooseImageCancel(error: unknown) {
  const message = String((error as any)?.errMsg || (error as any)?.message || error || '').toLowerCase()
  return message.includes('chooseimage:fail cancel') || message.includes('cancel')
}

function describeAutoIngestReason(result: PackagedAutoIngestResult, rewardTaskMode = false) {
  const actionSuffix = rewardTaskMode ? '可进入详情补充信息，或重拍后重新识别。' : '可以补齐缺失字段后提交待审核，或重拍。'
  switch (result.reason) {
    case 'missing_net_weight':
      return `还缺少净含量/规格。第 1 张包装正面必须把“净含量”拍清楚，${actionSuffix}`
    case 'missing_product_name':
      return `还缺少商品名称。请重拍包装正面，让品牌、品名和口味完整入镜，${actionSuffix}`
    case 'missing_nutrition':
      return `营养成分表还不完整。请重拍第 2 张，把能量、蛋白质、脂肪、碳水和钠拍清楚，${actionSuffix}`
    case 'conversion_not_closed':
      return `营养口径暂时无法可靠换算。请确认营养表里的“每100g/每份”和每份重量都拍清楚，${actionSuffix}`
    case 'low_extract_confidence':
    case 'low_name_confidence':
    case 'low_spec_confidence':
    case 'low_nutrition_confidence':
      return `图片文字识别还不够稳定。请减少反光和倾斜，重拍对应信息，${actionSuffix}`
    case 'conflict':
      return `包装正面、净含量或营养表之间存在冲突。请重新拍清楚正面净含量和营养成分表。`
    default:
      return rewardTaskMode
        ? '这次识别结果还不够稳定。可进入详情补充信息，或重拍包装正面和营养成分表后重新提交。'
        : '你可以补齐缺失字段后提交待审核，或继续重拍。'
  }
}

function buildPackagedExtractToast(result: PackagedProductExtractResult) {
  if (result.auto_ingest_result?.status === 'ingested') return '已自动入库'
  if ((result.needs_more_images || []).includes('ingredients')) return '还需要补拍配料表'
  switch (result.auto_ingest_result?.reason) {
    case 'missing_net_weight':
      return '可补充净含量'
    case 'missing_nutrition':
    case 'conversion_not_closed':
      return '可补充营养表'
    case 'low_extract_confidence':
    case 'low_name_confidence':
    case 'low_spec_confidence':
    case 'low_nutrition_confidence':
      return '可补充缺失信息'
    case 'conflict':
      return '信息冲突，请重拍'
    default:
      return '已填充识别结果'
  }
}

function normalizeConfirmationField(field: string) {
  const value = normalizeString(field)
  switch (value) {
    case 'product_name':
      return 'productName'
    case 'net_weight_g':
      return 'netWeightG'
    case 'serving_weight_g':
      return 'servingWeightG'
    case 'spec_text':
      return 'specText'
    case 'unit_nutrition_per_100g':
      return 'nutrition'
    case 'ingredients_text':
      return 'ingredientsText'
    case 'nutrition_basis_unit':
      return 'nutritionBasis'
    default:
      return value
  }
}

function confirmationFieldLabel(field: string) {
  switch (field) {
    case 'productName':
      return '名称'
    case 'netWeightG':
      return '净含量'
    case 'servingWeightG':
      return '每份重量'
    case 'specText':
      return '规格文本'
    case 'nutrition':
      return '营养成分'
    case 'ingredientsText':
      return '配料表'
    case 'nutritionBasis':
      return '营养标示口径'
    default:
      return field
  }
}

function describeConfirmationReason(reason: string) {
  switch (normalizeString(reason)) {
    case 'missing_product_name':
      return '商品名还不够确定'
    case 'missing_net_content':
      return '净含量或规格缺失'
    case 'conversion_not_closed':
      return '营养口径暂时没法可靠换算'
    case 'missing_nutrition':
      return '营养成分识别不完整'
    case 'nutrition_out_of_range':
      return '热量或营养值明显不合理'
    case 'need_clearer_front_package':
      return '正面包装信息还不够清楚'
    case 'need_clearer_nutrition_label':
      return '营养成分表还需要再确认'
    case 'need_clearer_net_weight':
      return '净含量位置还需要再确认'
    case 'serving_net_weight_conflict':
      return '每份重量和净含量存在冲突'
    case 'spec_total_weight_conflict':
      return '规格文本和净含量存在冲突'
    case 'low_confidence_product_name':
      return '商品名识别置信度偏低'
    case 'low_confidence_spec':
      return '规格识别置信度偏低'
    case 'low_confidence_nutrition':
      return '营养识别置信度偏低'
    case 'low_overall_confidence':
      return '整体识别结果还不够稳'
    default:
      return '有几个关键字段建议你再确认一下'
  }
}

function buildConfirmationSummary(result: PackagedProductExtractResult) {
  const reasons = (result.confirmation_reasons || []).map(describeConfirmationReason)
  const fields = (result.confirmation_fields || [])
    .map(normalizeConfirmationField)
    .map(confirmationFieldLabel)
    .filter(Boolean)
  const reasonLine = reasons.length ? `原因：${reasons.slice(0, 3).join('、')}` : ''
  const fieldLine = fields.length ? `建议重点确认：${Array.from(new Set(fields)).join('、')}` : ''
  return [reasonLine, fieldLine].filter(Boolean).join('\n')
}

function readPackagedUploadTasks(): PackagedUploadTaskEntry[] {
  try {
    const raw = Taro.getStorageSync(PACKAGED_FOOD_UPLOAD_TASKS_KEY)
    if (!Array.isArray(raw)) return []
    return raw
      .map((item) => ({
        taskId: normalizeString(item?.taskId),
        createdAt: normalizeString(item?.createdAt),
        updatedAt: normalizeString(item?.updatedAt),
        imageCount: Number(item?.imageCount) || 0,
        status: normalizeString(item?.status) || 'pending',
        productName: normalizeString(item?.productName),
        packagedFoodId: normalizeString(item?.packagedFoodId),
        message: normalizeString(item?.message),
        rewardAwarded: Boolean(item?.rewardAwarded),
        rewardCredits: Number(item?.rewardCredits) || 0,
      }))
      .filter((item) => item.taskId)
      .slice(0, 30)
  } catch {
    return []
  }
}

function writePackagedUploadTasks(tasks: PackagedUploadTaskEntry[]) {
  Taro.setStorageSync(PACKAGED_FOOD_UPLOAD_TASKS_KEY, tasks.slice(0, 30))
}

function mergePackagedUploadTask(entry: PackagedUploadTaskEntry): PackagedUploadTaskEntry[] {
  const existing = readPackagedUploadTasks().filter(item => item.taskId !== entry.taskId)
  const next = [entry, ...existing]
  writePackagedUploadTasks(next)
  return next
}

function isTaskStillRunning(status: string) {
  return ['pending', 'processing'].includes(String(status || '').trim())
}

function buildTaskEntryFromAnalyzeTask(
  current: Partial<PackagedUploadTaskEntry>,
  task: Awaited<ReturnType<typeof getAnalyzeTask>>,
): PackagedUploadTaskEntry {
  const result = (task.result || {}) as Record<string, any>
  const packagedProduct = (result.packaged_product || result.nutrition || {}) as PackagedProductExtractResult
  const auto = packagedProduct.auto_ingest_result || {}
  const reward = (result.reward_result || {}) as PackagedUploadRewardResult
  const productName = normalizeString(packagedProduct.product_name) || current.productName
  const packagedFoodId = normalizeString(packagedProduct.packaged_food_id || auto.packaged_food_id) || current.packagedFoodId
  let message = current.message || '后台分析中'
  let rewardAwarded = current.rewardAwarded
  let rewardCredits = current.rewardCredits || 0
  if (task.status === 'done') {
    if (reward.awarded) {
      rewardAwarded = true
      rewardCredits = Number(reward.reward_credits) || 1
      message = `已入库，奖励积分 +${rewardCredits}`
    } else if (reward.already_exists || auto.upsert_action === 'updated') {
      message = '数据库已有同商品，本次不发积分'
    } else if (auto.status === 'ingested') {
      message = '已入库，本次不发积分'
    } else {
      message = describeAutoIngestReason(auto as PackagedAutoIngestResult, true)
    }
  } else if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
    message = sanitizeUserFacingErrorMessage(task.error_message, '分析失败，请重拍后再试')
  }
  return {
    taskId: task.id,
    createdAt: task.created_at,
    imageCount: Array.isArray(task.image_paths) ? task.image_paths.length : (task.image_url ? 1 : current.imageCount || 0),
    ...current,
    status: task.status,
    updatedAt: task.updated_at,
    result: Object.keys(packagedProduct).length > 0 ? packagedProduct : current.result,
    rewardResult: Object.keys(reward).length > 0 ? reward : current.rewardResult,
    errorMessage: task.error_message || current.errorMessage,
    productName,
    packagedFoodId,
    message,
    rewardAwarded,
    rewardCredits,
  }
}

function formatUploadTaskStatus(task: PackagedUploadTaskEntry) {
  switch (task.status) {
    case 'done':
      return task.rewardAwarded ? `+${task.rewardCredits || 1}` : '完成'
    case 'failed':
    case 'timed_out':
    case 'cancelled':
      return '失败'
    case 'processing':
      return '分析中'
    default:
      return '排队中'
  }
}

function formatTaskTime(value?: string) {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatUploadTaskMessage(task: PackagedUploadTaskEntry) {
  if (task.message) return task.message
  if (task.status === 'pending') return '已收到，排队中'
  if (task.status === 'processing') return '后台分析中，可稍后刷新'
  if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
    return sanitizeUserFacingErrorMessage(task.errorMessage, '分析失败，请重拍后再试')
  }
  return '点击查看分析结果和奖励原因'
}

function hasPackagedUploadConsent() {
  try {
    return Boolean(Taro.getStorageSync(PACKAGED_FOOD_UPLOAD_CONSENT_KEY))
  } catch {
    return false
  }
}

function rememberPackagedUploadConsent() {
  Taro.setStorageSync(PACKAGED_FOOD_UPLOAD_CONSENT_KEY, {
    acceptedAt: new Date().toISOString(),
  })
}

function askPackagedUploadConsent(): Promise<boolean> {
  if (hasPackagedUploadConsent()) return Promise.resolve(true)
  return new Promise((resolve) => {
    Taro.showModal({
      title: '图片使用授权',
      content: '你上传的包装照片将用于 AI 识别、食物库数据建设和奖励积分判定。请确认你有权上传这些图片，并授权平台在本服务中使用。',
      confirmText: '同意上传',
      cancelText: '暂不上传',
      success: (res) => {
        if (res.confirm) {
          rememberPackagedUploadConsent()
          resolve(true)
        } else {
          resolve(false)
        }
      },
      fail: () => resolve(false),
    })
  })
}

function PackagedFoodEditPage() {
  const router = useRouter()
  const modeParam = normalizeString(router.params?.mode)
  const uploadMode: UploadMode = modeParam === 'manual' ? 'manual' : 'upload'
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [captureImages, setCaptureImages] = useState<CaptureImages>({})
  const [manualImages, setManualImages] = useState<UploadedImage[]>([])
  const [currentStep, setCurrentStep] = useState<CaptureStep>('front')
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showMoreNutrition, setShowMoreNutrition] = useState(false)
  const [needsIngredientsCapture, setNeedsIngredientsCapture] = useState(false)
  const [extractResult, setExtractResult] = useState<PackagedProductExtractResult | null>(null)
  const [autoIngestResult, setAutoIngestResult] = useState<PackagedAutoIngestResult | null>(null)
  const [uploadTasks, setUploadTasks] = useState<PackagedUploadTaskEntry[]>([])
  const [pendingRewardImages, setPendingRewardImages] = useState<UploadedImage[]>([])
  const [tasksExpanded, setTasksExpanded] = useState(false)
  const [librarySearchQuery, setLibrarySearchQuery] = useState('')
  const [librarySearchResults, setLibrarySearchResults] = useState<ManualFoodSearchResult[]>([])
  const [librarySearchLoading, setLibrarySearchLoading] = useState(false)
  const [librarySearchTouched, setLibrarySearchTouched] = useState(false)
  const latestConfirmationPromptRef = useRef('')
  const isRewardTaskMode = router.params?.task_mode === 'reward_center'
  const isUploadMode = uploadMode === 'upload'
  const isManualMode = uploadMode === 'manual'
  const needsSupplement = Boolean(autoIngestResult && autoIngestResult.status !== 'ingested')
  const sourceImageURLs = useMemo(() => {
    const urls = [
      captureImages.front,
      captureImages.nutrition,
      captureImages.ingredients,
      ...manualImages.map(item => item.imageUrl),
      ...pendingRewardImages.map(item => item.imageUrl),
    ].filter(Boolean) as string[]
    return Array.from(new Set(urls))
  }, [captureImages, manualImages, pendingRewardImages])
  const hasSupplementContext = Boolean(sourceImageURLs.length > 0 || draft.sourceTaskId || draft.recognizedNameHint || extractResult)
  const showManualForm = needsSupplement || (isManualMode && draftLoaded && hasSupplementContext)
  const showSupplementBlocked = isManualMode && draftLoaded && !showManualForm
  const confirmationFieldSet = useMemo(() => new Set(
    (extractResult?.confirmation_fields || []).map(normalizeConfirmationField).filter(Boolean),
  ), [extractResult?.confirmation_fields])

  useDidShow(() => {
    try {
      const saved = Taro.getStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
      if (saved && typeof saved === 'object') {
        const nextDraft = { ...emptyDraft, ...saved }
        setDraft(nextDraft)
        setCurrentStep(saved.frontImageUrl ? 'nutrition' : 'front')
        setCaptureImages({
          front: normalizeString(saved.frontImageUrl),
          nutrition: normalizeString(saved.nutritionImageUrl),
          ingredients: normalizeString(saved.ingredientsImageUrl),
        })
      }
    } catch {} finally {
      setDraftLoaded(true)
    }
    if (isRewardTaskMode) {
      refreshUploadTasks()
    }
  })

  const canSubmitManually = useMemo(() => Boolean(
    draft.productName.trim()
    && numberFromDraft(draft.netWeightG) > 0
    && sourceImageURLs.length > 0
  ), [draft, sourceImageURLs.length])

  const updateField = (field: keyof Draft, value: string) => {
    setDraft(current => ({ ...current, [field]: value }))
  }

  const fillIfRecognized = (current: Draft, field: keyof Draft, value: unknown) => {
    const next = formatRecognizedField(field, value)
    return next ? { ...current, [field]: next } : current
  }

  const showConfirmationPromptIfNeeded = (result: PackagedProductExtractResult) => {
    if (!result.needs_user_confirmation) {
      latestConfirmationPromptRef.current = ''
      return
    }
    const summary = buildConfirmationSummary(result)
    if (!summary || latestConfirmationPromptRef.current === summary) return
    latestConfirmationPromptRef.current = summary
    Taro.showModal({
      title: '请确认识别结果',
      content: summary,
      showCancel: false,
      confirmText: '我来检查',
    })
  }

  const highlightedFieldClass = (field: string) => (
    confirmationFieldSet.has(normalizeConfirmationField(field)) ? 'field--highlight' : ''
  )

  const applyExtractResult = (result: PackagedProductExtractResult) => {
    setExtractResult(result)
    setAutoIngestResult(result.auto_ingest_result || null)
    setNeedsIngredientsCapture((result.needs_more_images || []).includes('ingredients'))
    if ((result.needs_more_images || []).includes('ingredients')) {
      setCurrentStep('ingredients')
    }
    setDraft(current => {
      let next = { ...current }
      const unit = result.unit_nutrition_per_100g || {}
      if (normalizeString(result.product_name)) next.productName = normalizeString(result.product_name)
      if (normalizeString(result.brand)) next.brand = normalizeString(result.brand)
      if (normalizeString(result.flavor_text)) next.flavorText = normalizeString(result.flavor_text)
      if (normalizeString(result.package_category)) next.packageCategory = normalizeString(result.package_category)
      if (normalizeString(result.spec_text)) next.specText = normalizeString(result.spec_text)
      if (normalizeString(result.barcode)) next.barcode = normalizeString(result.barcode)
      if (normalizeString(result.ingredients_text)) next.ingredientsText = normalizeString(result.ingredients_text)
      next.nutritionBasis = '100'
      next.energyUnit = 'kcal'
      next = fillIfRecognized(next, 'netWeightG', result.net_weight_g)
      next = fillIfRecognized(next, 'servingWeightG', result.serving_weight_g)
      next = fillIfRecognized(next, 'calories', unit.calories)
      next = fillIfRecognized(next, 'protein', unit.protein)
      next = fillIfRecognized(next, 'carbs', unit.carbs)
      next = fillIfRecognized(next, 'fat', unit.fat)
      next = fillIfRecognized(next, 'fiber', unit.fiber)
      next = fillIfRecognized(next, 'sugar', unit.sugar)
      next = fillIfRecognized(next, 'sodiumMg', unit.sodiumMg)
      next = fillIfRecognized(next, 'saturatedFat', unit.saturatedFat)
      next = fillIfRecognized(next, 'cholesterolMg', unit.cholesterolMg)
      next = fillIfRecognized(next, 'potassiumMg', unit.potassiumMg)
      next = fillIfRecognized(next, 'calciumMg', unit.calciumMg)
      next = fillIfRecognized(next, 'ironMg', unit.ironMg)
      next = fillIfRecognized(next, 'magnesiumMg', unit.magnesiumMg)
      next = fillIfRecognized(next, 'zincMg', unit.zincMg)
      next = fillIfRecognized(next, 'vitaminARaeMcg', unit.vitaminARaeMcg)
      next = fillIfRecognized(next, 'vitaminCMg', unit.vitaminCMg)
      next = fillIfRecognized(next, 'vitaminDMcg', unit.vitaminDMcg)
      next = fillIfRecognized(next, 'vitaminEMg', unit.vitaminEMg)
      next = fillIfRecognized(next, 'vitaminKMcg', unit.vitaminKMcg)
      next = fillIfRecognized(next, 'thiaminMg', unit.thiaminMg)
      next = fillIfRecognized(next, 'riboflavinMg', unit.riboflavinMg)
      next = fillIfRecognized(next, 'niacinMg', unit.niacinMg)
      next = fillIfRecognized(next, 'vitaminB6Mg', unit.vitaminB6Mg)
      next = fillIfRecognized(next, 'folateMcg', unit.folateMcg)
      next = fillIfRecognized(next, 'vitaminB12Mcg', unit.vitaminB12Mcg)
      return next
    })
  }

  const chooseAndUploadImage = async (): Promise<string | null> => {
    const chooseRes = await chooseImageWithPrivacy({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
    })
    const localPath = chooseRes.tempFilePaths?.[0]
    if (!localPath) return null
    const uploadPath = await compressImagePathForUpload(localPath)
    const { imageUrl } = await uploadAnalyzeImageFile(uploadPath)
    return imageUrl
  }

  const chooseUploadImageSource = async (): Promise<UploadImageSource | null> => {
    const res = await Taro.showActionSheet({
      itemList: ['从相册选择', '连续拍摄'],
    })
    if (res.tapIndex === 0) return 'album'
    if (res.tapIndex === 1) return 'camera'
    return null
  }

  const uploadLocalImages = async (localPaths: string[]): Promise<UploadedImage[]> => {
    return Promise.all(localPaths.map(async (localPath) => {
      const uploadPath = await compressImagePathForUpload(localPath)
      const { imageUrl } = await uploadAnalyzeImageFile(uploadPath)
      return { localPath, imageUrl }
    }))
  }

  const askContinueCapture = async (capturedCount: number, maxCount: number): Promise<boolean> => {
    if (capturedCount >= maxCount) return false
    return new Promise((resolve) => {
      Taro.showModal({
        title: `已拍 ${capturedCount} 张`,
        content: `还可以继续补拍同一种商品的正面、净含量或营养成分表，最多 ${maxCount} 张。`,
        confirmText: '继续拍',
        cancelText: '完成',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      })
    })
  }

  const chooseAndUploadImages = async (count = 2): Promise<UploadedImage[]> => {
    const maxCount = Math.max(1, Math.min(count, MAX_REWARD_UPLOAD_IMAGES))
    const source = await chooseUploadImageSource()
    if (!source) return []

    const uploadSelectedLocalImages = async (localPaths: string[]) => {
      if (localPaths.length === 0) return []
      Taro.showLoading({ title: '上传中', mask: true })
      try {
        return await uploadLocalImages(localPaths)
      } finally {
        Taro.hideLoading()
      }
    }

    if (source === 'album') {
      const chooseRes = await chooseImageWithPrivacy({
        count: maxCount,
        sizeType: ['compressed'],
        sourceType: ['album'],
      })
      const localPaths = (chooseRes.tempFilePaths || []).filter(Boolean).slice(0, maxCount)
      return uploadSelectedLocalImages(localPaths)
    }

    const localPaths: string[] = []
    while (localPaths.length < maxCount) {
      let chooseRes: Taro.chooseImage.SuccessCallbackResult
      try {
        chooseRes = await chooseImageWithPrivacy({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['camera'],
        })
      } catch (error) {
        if (localPaths.length > 0 && isChooseImageCancel(error)) break
        throw error
      }
      const localPath = chooseRes.tempFilePaths?.[0]
      if (localPath) {
        localPaths.push(localPath)
      }
      const shouldContinue = await askContinueCapture(localPaths.length, maxCount)
      if (!shouldContinue) break
    }
    return uploadSelectedLocalImages(localPaths)
  }

  const resetRewardSelection = () => {
    setPendingRewardImages([])
  }

  const goUploadMode = () => {
    const query = ['mode=upload']
    if (isRewardTaskMode) query.push('task_mode=reward_center')
    Taro.redirectTo({
      url: `/packageExtra/pages/packaged-food-edit/index?${query.join('&')}`,
    })
  }

  const handleManualChooseImages = async () => {
    if (recognizing) return
    setRecognizing(true)
    try {
      const allowed = await askPackagedUploadConsent()
      if (!allowed) return
      const remain = Math.max(1, MAX_REWARD_UPLOAD_IMAGES - sourceImageURLs.length)
      const uploaded = await chooseAndUploadImages(remain)
      if (uploaded.length === 0) return
      setManualImages(current => {
        const next = [...current, ...uploaded]
        const seen = new Set<string>()
        return next.filter(item => {
          if (!item.imageUrl || seen.has(item.imageUrl)) return false
          seen.add(item.imageUrl)
          return true
        }).slice(0, MAX_REWARD_UPLOAD_IMAGES)
      })
    } catch (error) {
      if (isChooseImageCancel(error)) return
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
      } else {
        await showUnifiedApiError(error, '上传包装图片失败')
      }
    } finally {
      setRecognizing(false)
    }
  }

  const handleLibrarySearch = async () => {
    const keyword = librarySearchQuery.trim()
    if (!keyword) {
      setLibrarySearchTouched(false)
      setLibrarySearchResults([])
      Taro.showToast({ title: '先输入品名或口味', icon: 'none' })
      return
    }
    setLibrarySearchLoading(true)
    setLibrarySearchTouched(true)
    try {
      const results = await searchManualFood(keyword, 30, { source: 'packaged_food' })
      setLibrarySearchResults(results.slice(0, 6))
    } catch (error) {
      setLibrarySearchResults([])
      await showUnifiedApiError(error, '搜索零食库失败')
    } finally {
      setLibrarySearchLoading(false)
    }
  }

  const refreshUploadTasks = async (baseTasks?: PackagedUploadTaskEntry[]) => {
    if (!isRewardTaskMode) return
    const localTasks = baseTasks || readPackagedUploadTasks()
    let remoteEntries: PackagedUploadTaskEntry[] = []
    try {
      const remote = await listAnalyzeTasks({ task_type: 'packaged_product_extract', limit: 30 })
      remoteEntries = (remote.tasks || []).map(task => buildTaskEntryFromAnalyzeTask({}, task))
    } catch {
      remoteEntries = []
    }
    const byID = new Map<string, PackagedUploadTaskEntry>()
    remoteEntries.forEach(entry => byID.set(entry.taskId, entry))
    localTasks.forEach(entry => {
      if (!byID.has(entry.taskId)) byID.set(entry.taskId, entry)
    })
    const merged = Array.from(byID.values()).sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))
    const next = await Promise.all(merged.map(async (entry) => {
      if (!isTaskStillRunning(entry.status)) return entry
      try {
        const task = await getAnalyzeTask(entry.taskId)
        return buildTaskEntryFromAnalyzeTask(entry, task)
      } catch {
        return entry
      }
    }))
    writePackagedUploadTasks(next)
    setUploadTasks(next)
  }

  const showRewardSubmitConfirm = (taskId: string, nextTasks: PackagedUploadTaskEntry[]) => {
    Taro.showModal({
      title: '已收到，后台分析中',
      content: '这一种商品已加入上传分析列表。成功入库且数据库原本没有时，会发放奖励积分 +1。',
      confirmText: '查看详情',
      cancelText: '继续上传',
      success: (res) => {
        if (res.confirm) {
          openTaskDetail({ taskId } as PackagedUploadTaskEntry)
        } else {
          resetRewardSelection()
        }
      },
      complete: () => {
        setTimeout(() => refreshUploadTasks(nextTasks), 1200)
      },
    })
  }

  const handleRewardChooseImages = async () => {
    if (recognizing) return
    setRecognizing(true)
    try {
      const allowed = await askPackagedUploadConsent()
      if (!allowed) {
        return
      }
      const uploaded = await chooseAndUploadImages(MAX_REWARD_UPLOAD_IMAGES)
      if (uploaded.length === 0) {
        return
      }
      setPendingRewardImages(uploaded)
    } catch (error) {
      if (isChooseImageCancel(error)) return
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
      } else {
        await showUnifiedApiError(error, '提交零食分析任务失败')
      }
    } finally {
      setRecognizing(false)
    }
  }

  const handleRewardSubmitSelected = async () => {
    if (recognizing) return
    const imageUrls = pendingRewardImages.map(item => item.imageUrl).filter(Boolean)
    if (imageUrls.length < 1) {
      Taro.showToast({ title: '请先选择这一种商品的照片', icon: 'none' })
      return
    }
    if (imageUrls.length > MAX_REWARD_UPLOAD_IMAGES) {
      Taro.showToast({ title: '同一种商品最多 3 张图', icon: 'none' })
      return
    }
    setRecognizing(true)
    Taro.showLoading({ title: '提交中', mask: true })
    try {
      const { task_id: taskId } = await submitPackagedProductExtract({
        image_urls: imageUrls,
        source_task_id: draft.sourceTaskId,
        recognized_name_hint: draft.recognizedNameHint || draft.productName,
      })
      const nextTasks = mergePackagedUploadTask({
        taskId,
        createdAt: new Date().toISOString(),
        imageCount: imageUrls.length,
        status: 'pending',
        message: '已收到，排队中',
      })
      setUploadTasks(nextTasks)
      setCaptureImages({})
      setCurrentStep('front')
      setNeedsIngredientsCapture(false)
      setExtractResult(null)
      setAutoIngestResult(null)
      resetRewardSelection()
      Taro.removeStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
      Taro.hideLoading()
      showRewardSubmitConfirm(taskId, nextTasks)
    } catch (error) {
      Taro.hideLoading()
      await showUnifiedApiError(error, '提交零食分析任务失败')
    } finally {
      setRecognizing(false)
    }
  }

  const openTaskDetail = (task: PackagedUploadTaskEntry) => {
    if (!task.taskId) return
    Taro.navigateTo({
      url: `/packageExtra/pages/packaged-food-task-detail/index?task_id=${encodeURIComponent(task.taskId)}`,
    })
  }

  const pollPackagedExtractTask = async (taskId: string): Promise<PackagedProductExtractResult> => {
    const started = Date.now()
    while (Date.now() - started < 120000) {
      await new Promise(resolve => setTimeout(resolve, 1800))
      const task = await getAnalyzeTask(taskId)
      if (task.status === 'done') {
        const result = (task.result || {}) as Record<string, any>
        const packagedProduct = (result.packaged_product || result.nutrition) as PackagedProductExtractResult | undefined
        if (!packagedProduct) {
          throw new Error('识别任务已完成，但没有返回预包装商品数据')
        }
        return packagedProduct
      }
      if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
        throw new Error(sanitizeUserFacingErrorMessage(task.error_message, '预包装商品识别失败'))
      }
    }
    throw new Error('识别时间较长，请稍后重试')
  }

  const runExtract = async (overrides?: Partial<CaptureImages>) => {
    const merged = { ...captureImages, ...overrides }
    const imageUrls = [merged.front, merged.nutrition, merged.ingredients].filter(Boolean) as string[]
    if (imageUrls.length < 1) {
      return
    }
    setRecognizing(true)
    if (!isRewardTaskMode) {
      Taro.showLoading({ title: '识别中', mask: true })
    }
    try {
      const { task_id: taskId } = await submitPackagedProductExtract({
        image_urls: imageUrls,
        source_task_id: draft.sourceTaskId,
        recognized_name_hint: draft.recognizedNameHint || draft.productName,
      })
      if (isRewardTaskMode) {
        const nextTasks = mergePackagedUploadTask({
          taskId,
          createdAt: new Date().toISOString(),
          imageCount: imageUrls.length,
          status: 'pending',
          message: '已收到，排队中',
        })
        setUploadTasks(nextTasks)
        setCaptureImages({})
        setCurrentStep('front')
        setNeedsIngredientsCapture(false)
        setExtractResult(null)
        setAutoIngestResult(null)
        Taro.removeStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
        Taro.showToast({ title: '已加入分析列表', icon: 'success' })
        setTimeout(() => refreshUploadTasks(nextTasks), 1200)
        return
      }
      const result = await pollPackagedExtractTask(taskId)
      applyExtractResult(result)
      showConfirmationPromptIfNeeded(result)
      Taro.hideLoading()
      if (result.auto_ingest_result?.status === 'ingested' && result.packaged_food_id) {
        Taro.setStorageSync(PACKAGED_FOOD_EDIT_SAVED_KEY, {
          itemId: draft.itemId,
          packagedFoodId: result.packaged_food_id,
        })
        Taro.removeStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
        Taro.showToast({ title: '已自动入库', icon: 'success' })
        setTimeout(() => Taro.navigateBack(), 500)
        return
      }
      Taro.showToast({
        title: buildPackagedExtractToast(result),
        icon: result.auto_ingest_result?.status === 'blocked' ? 'none' : 'success',
      })
    } catch (error) {
      if (!isRewardTaskMode) {
        Taro.hideLoading()
      }
      throw error
    } finally {
      setRecognizing(false)
    }
  }

  const handleCaptureStep = async (step: CaptureStep) => {
    if (recognizing) return
    try {
      const imageUrl = await chooseAndUploadImage()
      if (!imageUrl) return
      const nextImages = { ...captureImages, [step]: imageUrl }
      setCaptureImages(nextImages)
      if (step === 'front') {
        setCurrentStep('nutrition')
        Taro.showToast({ title: '已上传正面图', icon: 'success' })
        return
      }
      await runExtract(nextImages)
    } catch (error) {
      if (isPrivacyAuthorizeError(error)) {
        showPrivacyAuthorizeFailure(error)
      } else {
        await showUnifiedApiError(error, step === 'ingredients' ? '补拍配料表失败' : '识别预包装商品失败')
      }
    }
  }

  const handleSubmit = async () => {
    if (saving) return
    if (!draft.productName.trim()) {
      Taro.showToast({ title: '请填写零食名称', icon: 'none' })
      return
    }
    if (numberFromDraft(draft.netWeightG) <= 0) {
      Taro.showToast({ title: '请填写净含量', icon: 'none' })
      return
    }
    if (sourceImageURLs.length === 0) {
      Taro.showToast({ title: '请先上传包装图片', icon: 'none' })
      return
    }
    const nutritionBasis = positiveNumberFromDraft(draft.nutritionBasis, 100)
    const kcalPer100g = energyToKcal(numberFromDraft(draft.calories), draft.energyUnit) * 100 / nutritionBasis
    const isSupplementSubmission = Boolean(extractResult || draft.sourceTaskId || draft.recognizedNameHint)
    const payload: CreatePackagedFoodRequest = {
      brand: draft.brand.trim() || undefined,
      product_name: draft.productName.trim(),
      flavor_text: draft.flavorText.trim() || undefined,
      package_category: draft.packageCategory.trim() || undefined,
      spec_text: draft.specText.trim() || undefined,
      barcode: draft.barcode.trim() || undefined,
      ingredients_text: draft.ingredientsText.trim() || undefined,
      source_image_urls: sourceImageURLs,
      ocr_raw_text: extractResult?.ocr_raw_text || undefined,
      extract_confidence: extractResult?.extract_confidence,
      field_confidence: extractResult?.field_confidence,
      ingest_method: isSupplementSubmission ? 'user_capture_ocr' : 'user_manual_label',
      nutrition_basis_unit: `${nutritionBasis}g`,
      energy_unit_raw: draft.energyUnit,
      raw_label_payload: {
        nutrition_basis: { type: 'per_weight', value: nutritionBasis, unit: 'g' },
        energy_unit_raw: draft.energyUnit,
        entry_source: isSupplementSubmission ? 'supplement_after_ocr' : 'manual_with_images',
      },
      conversion_status: 'converted',
      review_status: 'pending',
      net_weight_g: numberFromDraft(draft.netWeightG),
      serving_weight_g: numberFromDraft(draft.servingWeightG) || numberFromDraft(draft.netWeightG),
      kcal_per_100g: kcalPer100g,
      protein_per_100g: nutritionValuePer100g(draft.protein, nutritionBasis),
      carbs_per_100g: nutritionValuePer100g(draft.carbs, nutritionBasis),
      fat_per_100g: nutritionValuePer100g(draft.fat, nutritionBasis),
      fiber_per_100g: nutritionValuePer100g(draft.fiber, nutritionBasis),
      sugar_per_100g: nutritionValuePer100g(draft.sugar, nutritionBasis),
      sodium_mg_per_100g: nutritionValuePer100g(draft.sodiumMg, nutritionBasis),
      saturated_fat_per_100g: nutritionValuePer100g(draft.saturatedFat, nutritionBasis),
      cholesterol_mg_per_100g: nutritionValuePer100g(draft.cholesterolMg, nutritionBasis),
      potassium_mg_per_100g: nutritionValuePer100g(draft.potassiumMg, nutritionBasis),
      calcium_mg_per_100g: nutritionValuePer100g(draft.calciumMg, nutritionBasis),
      iron_mg_per_100g: nutritionValuePer100g(draft.ironMg, nutritionBasis),
      magnesium_mg_per_100g: nutritionValuePer100g(draft.magnesiumMg, nutritionBasis),
      zinc_mg_per_100g: nutritionValuePer100g(draft.zincMg, nutritionBasis),
      vitamin_a_rae_mcg_per_100g: nutritionValuePer100g(draft.vitaminARaeMcg, nutritionBasis),
      vitamin_c_mg_per_100g: nutritionValuePer100g(draft.vitaminCMg, nutritionBasis),
      vitamin_d_mcg_per_100g: nutritionValuePer100g(draft.vitaminDMcg, nutritionBasis),
      vitamin_e_mg_per_100g: nutritionValuePer100g(draft.vitaminEMg, nutritionBasis),
      vitamin_k_mcg_per_100g: nutritionValuePer100g(draft.vitaminKMcg, nutritionBasis),
      thiamin_mg_per_100g: nutritionValuePer100g(draft.thiaminMg, nutritionBasis),
      riboflavin_mg_per_100g: nutritionValuePer100g(draft.riboflavinMg, nutritionBasis),
      niacin_mg_per_100g: nutritionValuePer100g(draft.niacinMg, nutritionBasis),
      vitamin_b6_mg_per_100g: nutritionValuePer100g(draft.vitaminB6Mg, nutritionBasis),
      folate_mcg_per_100g: nutritionValuePer100g(draft.folateMcg, nutritionBasis),
      vitamin_b12_mcg_per_100g: nutritionValuePer100g(draft.vitaminB12Mcg, nutritionBasis),
    }

    setSaving(true)
    Taro.showLoading({ title: '保存中...', mask: true })
    try {
      const item = await createPackagedFood(payload)
      Taro.setStorageSync(PACKAGED_FOOD_EDIT_SAVED_KEY, {
        itemId: draft.itemId,
        packagedFoodId: item.id,
      })
      Taro.removeStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
      Taro.hideLoading()
      Taro.showToast({ title: '已提交待审核', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 450)
    } catch (error) {
      Taro.hideLoading()
      await showUnifiedApiError(error, '保存零食数据失败')
    } finally {
      setSaving(false)
    }
  }

  const currentMeta = stepMeta[currentStep]
  const showIngredientsStep = needsIngredientsCapture || Boolean(captureImages.ingredients)
  const visibleUploadTasks = tasksExpanded ? uploadTasks : uploadTasks.slice(0, 3)

  return (
    <View className='packaged-food-edit-page'>
      <ScrollView className='packaged-food-edit-scroll' scrollY>
        {isUploadMode && (
        <View className='edit-section wizard-section'>
          <Text className='section-title'>预包装零食补库</Text>
          {isRewardTaskMode ? (
            <>
              <Text className='wizard-desc'>一种食物一组照片。可以从相册一次选择 1-3 张，也可以用相机连续拍摄多张；确认后只会建立一个分析任务。</Text>

              <View className='shoot-case-list'>
                <View className='shoot-case-card'>
                  <View className='shoot-case-count'>
                    <Text className='shoot-case-count-main'>1</Text>
                    <Text className='shoot-case-count-sub'>张</Text>
                  </View>
                  <View className='shoot-case-copy'>
                    <Text className='shoot-case-title'>包装小，一张能拍全</Text>
                    <Text className='shoot-case-desc'>适合小包装、盒装侧面信息集中：同一张照片里能看清品名、净含量和营养成分表。</Text>
                  </View>
                </View>
                <View className='shoot-case-card recommended'>
                  <View className='shoot-case-count'>
                    <Text className='shoot-case-count-main'>2</Text>
                    <Text className='shoot-case-count-sub'>张</Text>
                  </View>
                  <View className='shoot-case-copy'>
                    <View className='shoot-case-title-row'>
                      <Text className='shoot-case-title'>最常用：正面 + 营养表</Text>
                      <Text className='shoot-case-badge'>推荐</Text>
                    </View>
                    <Text className='shoot-case-desc'>第 1 张拍品牌、品名、口味、净含量；第 2 张拍清能量、蛋白质、脂肪、碳水、钠和每100g/每份口径。</Text>
                  </View>
                </View>
                <View className='shoot-case-card'>
                  <View className='shoot-case-count'>
                    <Text className='shoot-case-count-main'>3</Text>
                    <Text className='shoot-case-count-sub'>张</Text>
                  </View>
                  <View className='shoot-case-copy'>
                    <Text className='shoot-case-title'>包装大、弯曲或字太小</Text>
                    <Text className='shoot-case-desc'>前两张拍正面和营养表，第 3 张只补拍看不清的局部，比如净含量、规格或营养表下半部分。</Text>
                  </View>
                </View>
              </View>

              <View className='duplicate-guide-card'>
                <View className='duplicate-guide-head'>
                  <Text className='duplicate-guide-title'>上传前先看是否重复</Text>
                  <Text className='duplicate-guide-badge'>避免白传</Text>
                </View>
                <Text className='duplicate-guide-item'>同品牌、同品名、同规格或净含量：只算同一个商品，只奖励一次。</Text>
                <Text className='duplicate-guide-item'>换口味、换规格、换包装容量：可以当作另一种商品上传。</Text>
                <Text className='duplicate-guide-item'>如果下方任务已经显示“已入库”或“数据库已有”，同商品再拍也不会重复加分。</Text>
              </View>

              <View className='library-search-card'>
                <View className='library-search-head'>
                  <Text className='library-search-title'>先搜零食库</Text>
                  <Text className='library-search-desc'>输入品牌、品名、口味或条码；搜到同款就不用上传。</Text>
                </View>
                <View className='library-search-row'>
                  <Input
                    className='library-search-input'
                    value={librarySearchQuery}
                    placeholder='例：玉米薄脆 麻辣味'
                    confirmType='search'
                    onInput={(e) => setLibrarySearchQuery(String(e.detail.value || ''))}
                    onConfirm={handleLibrarySearch}
                  />
                  <View className={`library-search-btn ${librarySearchLoading ? 'loading' : ''}`} onClick={handleLibrarySearch}>
                    <Text>{librarySearchLoading ? '搜索中' : '搜索'}</Text>
                  </View>
                </View>
                {librarySearchResults.length > 0 && (
                  <View className='library-search-results'>
                    <Text className='library-search-hit'>找到 {librarySearchResults.length} 个包装食品结果，确认同款后不用再上传。</Text>
                    {librarySearchResults.map(item => (
                      <View key={`${item.source}-${item.id}`} className='library-search-item'>
                        {item.image_path ? (
                          <Image className='library-search-image' src={item.image_path} mode='aspectFill' />
                        ) : (
                          <View className='library-search-image placeholder'>
                            <Text>食</Text>
                          </View>
                        )}
                        <View className='library-search-copy'>
                          <Text className='library-search-item-title'>{item.title}</Text>
                          <Text className='library-search-item-subtitle'>{item.subtitle || item.source_label || '包装食品'}</Text>
                          {item.nutrition_highlights?.length ? (
                            <Text className='library-search-item-meta'>{item.nutrition_highlights.slice(0, 2).join(' · ')}</Text>
                          ) : null}
                        </View>
                        <Text className='library-search-tag'>已收录</Text>
                      </View>
                    ))}
                  </View>
                )}
                {librarySearchTouched && !librarySearchLoading && librarySearchResults.length === 0 && (
                  <View className='library-search-empty'>
                    <Text>没有搜到同款。确认照片清晰后，可以继续上传补库。</Text>
                  </View>
                )}
              </View>

              <View className='capture-card reward-capture-card'>
                <View className='reward-upload-visual'>
                  <Text className='reward-upload-title'>选择这一种商品的照片</Text>
                  <Text className='reward-upload-desc'>相册可多选；手机拍摄会在每张后询问是否继续拍。请不要把不同商品混在一组。</Text>
                </View>
                <View className={`recognize-btn reward-upload-btn ${recognizing ? 'loading' : ''}`} onClick={handleRewardChooseImages}>
                  <Text className='recognize-btn-text'>{recognizing ? '处理中' : '相册多选或连续拍摄'}</Text>
                </View>
              </View>

              {pendingRewardImages.length > 0 && (
                <View className='reward-confirm-card'>
                  <View className='reward-confirm-head'>
                    <View>
                      <Text className='reward-confirm-title'>确认这一种商品</Text>
                      <Text className='reward-confirm-desc'>已选 {pendingRewardImages.length} 张图。确认这些照片都是同一个商品的正面、净含量或营养成分表后再提交。</Text>
                    </View>
                    <Text className='reward-confirm-clear' onClick={resetRewardSelection}>重选</Text>
                  </View>
                  <View className='reward-image-preview-grid'>
                    {pendingRewardImages.map((item, index) => (
                      <View key={`${item.imageUrl}-${index}`} className='reward-image-preview'>
                        <Image className='reward-image-preview-img' src={item.localPath || item.imageUrl} mode='aspectFill' />
                        <Text className='reward-image-preview-badge'>图 {index + 1}</Text>
                      </View>
                    ))}
                  </View>
                  <View className='reward-confirm-rules'>
                    <Text className='reward-confirm-rule'>同一商品：可以是正面、背面、营养表或大包装局部。</Text>
                    <Text className='reward-confirm-rule'>不同商品：请分开提交，一种食物一个任务。</Text>
                    <Text className='reward-confirm-rule'>已有商品：系统会更新数据，但不会重复发放奖励积分。</Text>
                  </View>
                  <View className={`recognize-btn reward-submit-btn ${recognizing ? 'loading' : ''}`} onClick={handleRewardSubmitSelected}>
                    <Text className='recognize-btn-text'>{recognizing ? '提交中' : '提交这一种商品'}</Text>
                  </View>
                </View>
              )}
            </>
          ) : (
            <>
              <Text className='wizard-desc'>默认先拍两张：包装正面必须带净含量，第二张拍营养成分表。系统确认数据合理并入库后才会发放奖励积分。</Text>

              <View className='capture-steps'>
                {(['front', 'nutrition'] as CaptureStep[]).map((step, index) => (
                  <View key={step} className={`capture-step ${currentStep === step ? 'active' : ''} ${captureImages[step] ? 'done' : ''}`}>
                    <View className='capture-step-index'>{index + 1}</View>
                    <View className='capture-step-copy'>
                      <Text className='capture-step-title'>{stepMeta[step].title}</Text>
                      <Text className='capture-step-desc'>{stepMeta[step].desc}</Text>
                    </View>
                  </View>
                ))}
                {showIngredientsStep && (
                  <View className={`capture-step ${currentStep === 'ingredients' ? 'active' : ''} ${captureImages.ingredients ? 'done' : ''}`}>
                    <View className='capture-step-index'>3</View>
                    <View className='capture-step-copy'>
                      <Text className='capture-step-title'>{stepMeta.ingredients.title}</Text>
                      <Text className='capture-step-desc'>{stepMeta.ingredients.desc}</Text>
                    </View>
                  </View>
                )}
              </View>

              <View className='capture-card'>
                <View className='capture-preview-row'>
                  {(['front', 'nutrition'] as CaptureStep[]).map(step => (
                    <View key={step} className='capture-preview-card'>
                      {captureImages[step] ? (
                        <Image className='capture-preview-image' src={captureImages[step]!} mode='aspectFill' />
                      ) : (
                        <View className='capture-preview-placeholder'>
                          <Text className='capture-preview-placeholder-text'>{step === 'front' ? '正面+净含量' : '营养成分表'}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
                {showIngredientsStep && (
                  <View className='capture-preview-single'>
                    {captureImages.ingredients ? (
                      <Image className='capture-preview-image' src={captureImages.ingredients} mode='aspectFill' />
                    ) : (
                      <View className='capture-preview-placeholder'>
                        <Text className='capture-preview-placeholder-text'>配料表</Text>
                      </View>
                    )}
                  </View>
                )}
                <Text className='capture-card-title'>{currentMeta.title}</Text>
                <Text className='capture-card-desc'>{currentMeta.desc}</Text>
                <View className={`recognize-btn ${recognizing ? 'loading' : ''}`} onClick={() => handleCaptureStep(currentStep)}>
                  <Text className='recognize-btn-text'>{recognizing ? '处理中' : currentMeta.cta}</Text>
                </View>
              </View>
            </>
          )}

          {isRewardTaskMode && (
            <View className='upload-task-panel'>
              <View className='upload-task-panel-head'>
                <View>
                  <Text className='upload-task-panel-title'>我的上传分析列表</Text>
                  <Text className='upload-task-panel-desc'>点击任一任务进入详情页查看分析结果、入库状态和奖励原因。</Text>
                </View>
                <Text className='upload-task-refresh' onClick={() => refreshUploadTasks()}>刷新</Text>
              </View>
              {uploadTasks.length === 0 ? (
                <View className='upload-task-empty'>
                  <Text className='upload-task-empty-text'>还没有提交任务。先上传一张完整图，或一次选择正面和营养表两张图；后续可在这里确认是否已入库或已有不奖励。</Text>
                </View>
              ) : (
                <View className='upload-task-list'>
                  {visibleUploadTasks.map((task) => (
                    <View key={task.taskId} className={`upload-task-item status-${task.status}`} onClick={() => openTaskDetail(task)}>
                      <View className='upload-task-item-main'>
                        <Text className='upload-task-item-title'>{task.productName || `零食照片 ${task.imageCount} 张`}</Text>
                        <Text className='upload-task-item-desc'>{formatUploadTaskMessage(task)}</Text>
                        <Text className='upload-task-item-time'>{formatTaskTime(task.createdAt)}</Text>
                      </View>
                      <Text className='upload-task-item-status'>{formatUploadTaskStatus(task)}</Text>
                    </View>
                  ))}
                  {uploadTasks.length > 3 && (
                    <View className='upload-task-toggle' onClick={() => setTasksExpanded(current => !current)}>
                      <Text className='upload-task-toggle-text'>{tasksExpanded ? '收起任务列表' : `展开全部 ${uploadTasks.length} 个任务`}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {autoIngestResult && autoIngestResult.status !== 'ingested' && (
            <View className='ingest-status-card'>
              <Text className='ingest-status-title'>{isRewardTaskMode ? '这次还不能发积分' : '自动入库暂未通过'}</Text>
              <Text className='ingest-status-desc'>{describeAutoIngestReason(autoIngestResult, isRewardTaskMode)}</Text>
              <Text className='ingest-status-hint'>已识别到的字段会保留在下方，你可以补齐缺失信息后提交待审核。</Text>
            </View>
          )}
          {extractResult?.needs_user_confirmation && (
            <View className='confirmation-card'>
              <Text className='confirmation-card-title'>请优先核对识别不稳的字段</Text>
              <Text className='confirmation-card-desc'>{buildConfirmationSummary(extractResult)}</Text>
            </View>
          )}
        </View>
        )}

        {showSupplementBlocked && (
          <View className='edit-section supplement-blocked-card'>
            <Text className='section-title'>请先拍照识别</Text>
            <Text className='wizard-desc'>零食补库以包装图片和 AI 提取为主。识别后如果缺少名称、规格或营养字段，再进入这里补充，不再单独创建纯手动商品。</Text>
            <View className='recognize-btn supplement-upload-btn' onClick={goUploadMode}>
              <Text className='recognize-btn-text'>去拍照上传</Text>
            </View>
          </View>
        )}

        {showManualForm && (
          <View className='edit-section manual-image-section'>
            <Text className='section-title'>补充缺失信息</Text>
            <Text className='wizard-desc'>AI 已先提取包装上的可见信息。请保留已识别内容，补齐缺少的名称、规格或营养字段后提交待审核。</Text>
            {sourceImageURLs.length > 0 ? (
              <View className='reward-image-preview-grid manual-image-grid'>
                {sourceImageURLs.map((url, index) => (
                  <View key={`${url}-${index}`} className='reward-image-preview'>
                    <Image className='reward-image-preview-img' src={url} mode='aspectFill' />
                    <Text className='reward-image-preview-badge'>图 {index + 1}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View className='manual-image-empty'>
                <Text>原识别任务没有带到图片，请补拍包装正面、净含量或营养成分表图片。</Text>
              </View>
            )}
            {sourceImageURLs.length < MAX_REWARD_UPLOAD_IMAGES && (
              <View className={`recognize-btn manual-image-btn ${recognizing ? 'loading' : ''}`} onClick={handleManualChooseImages}>
                <Text className='recognize-btn-text'>{recognizing ? '上传中' : sourceImageURLs.length > 0 ? '继续补拍/选择图片' : '补拍或选择包装图片'}</Text>
              </View>
            )}
          </View>
        )}

        {showManualForm && (
          <View className='edit-section'>
            <Text className='section-title'>基础信息</Text>
            <View className='field'>
              <Text className='field-label'>名称</Text>
              <Input className={`field-input ${highlightedFieldClass('product_name')}`} value={draft.productName} placeholder='零食名称' onInput={(e) => updateField('productName', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>品牌</Text>
              <Input className='field-input' value={draft.brand} placeholder='可选' onInput={(e) => updateField('brand', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>口味</Text>
              <Input className='field-input' value={draft.flavorText} placeholder='如原味、草莓味，可选' onInput={(e) => updateField('flavorText', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>食品分类</Text>
              <Input className='field-input' value={draft.packageCategory} placeholder='如休闲零食、含乳饮料，可选' onInput={(e) => updateField('packageCategory', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>规格文本</Text>
              <Input className={`field-input ${highlightedFieldClass('spec_text')}`} value={draft.specText} placeholder='如 70g、35g*2袋' onInput={(e) => updateField('specText', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>条码</Text>
              <Input className='field-input' value={draft.barcode} placeholder='可选' onInput={(e) => updateField('barcode', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>净含量</Text>
              <View className={`field-input-with-unit ${highlightedFieldClass('net_weight_g')}`}>
                <Input className='field-input' type='digit' value={draft.netWeightG} placeholder='净含量' onInput={(e) => updateField('netWeightG', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field'>
              <Text className='field-label'>每份重量</Text>
              <View className={`field-input-with-unit ${highlightedFieldClass('serving_weight_g')}`}>
                <Input className='field-input' type='digit' value={draft.servingWeightG} placeholder='可选' onInput={(e) => updateField('servingWeightG', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field'>
              <Text className='field-label'>配料表</Text>
              <Input className={`field-input ${highlightedFieldClass('ingredients_text')}`} value={draft.ingredientsText} placeholder='按需补拍后会自动填入，也可手动补' onInput={(e) => updateField('ingredientsText', e.detail.value)} />
            </View>
          </View>
        )}

        {showManualForm && <View className='edit-section'>
          <Text className='section-title'>营养成分</Text>
          <View className='nutrition-basis-row'>
            <View className='field compact'>
              <Text className='field-label'>营养标示每 g</Text>
              <Input className='field-input' type='digit' value={draft.nutritionBasis} placeholder='100' onInput={(e) => updateField('nutritionBasis', e.detail.value)} />
            </View>
            <View className='basis-chip-row'>
              {['100', '60', '30', '20'].map((basis) => (
                <View
                  key={basis}
                  className={`basis-chip ${draft.nutritionBasis === basis ? 'active' : ''}`}
                  onClick={() => updateField('nutritionBasis', basis)}
                >
                  <Text>每{basis}g</Text>
                </View>
              ))}
            </View>
          </View>
          <View className={`nutrition-grid ${highlightedFieldClass('nutrition')}`}>
            <View className='field compact'>
              <View className='energy-label-row'>
                <Text className='field-label'>热量 {draft.energyUnit === 'kj' ? 'kJ' : 'kcal'} / 标示</Text>
                <View className='energy-unit-switch'>
                  {(['kj', 'kcal'] as EnergyUnit[]).map((unit) => (
                    <View
                      key={unit}
                      className={`energy-unit ${draft.energyUnit === unit ? 'active' : ''}`}
                      onClick={() => updateField('energyUnit', unit)}
                    >
                      <Text>{unit === 'kj' ? 'kJ' : 'kcal'}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.calories} placeholder='0' onInput={(e) => updateField('calories', e.detail.value)} />
                <Text className='field-unit'>{draft.energyUnit === 'kj' ? 'kJ' : 'kcal'}</Text>
              </View>
              <Text className='energy-hint'>
                {draft.energyUnit === 'kj'
                  ? '按包装 kJ 填，保存时换算为 kcal/100g'
                  : '1 kcal = 4.184 kJ，可切回 kJ 填包装值'}
              </Text>
            </View>
            <View className='field compact'>
              <Text className='field-label'>蛋白质 / 标示</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.protein} placeholder='0' onInput={(e) => updateField('protein', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>碳水 / 标示</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.carbs} placeholder='0' onInput={(e) => updateField('carbs', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>脂肪 / 标示</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.fat} placeholder='0' onInput={(e) => updateField('fat', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>膳食纤维 / 标示</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.fiber} placeholder='0' onInput={(e) => updateField('fiber', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>糖 / 标示</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.sugar} placeholder='0' onInput={(e) => updateField('sugar', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact wide'>
              <Text className='field-label'>钠 / 标示</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.sodiumMg} placeholder='0' onInput={(e) => updateField('sodiumMg', e.detail.value)} />
                <Text className='field-unit'>mg</Text>
              </View>
            </View>
          </View>
        </View>}

        {showManualForm && <View className='edit-section more-section'>
          <View className='more-header' onClick={() => setShowMoreNutrition(current => !current)}>
            <View className='more-title-wrap'>
              <Text className='section-title more-title'>更多营养成分</Text>
              <Text className='more-subtitle'>维生素、矿物质等可选数据</Text>
            </View>
            <Text className={`more-arrow ${showMoreNutrition ? 'open' : ''}`}>⌄</Text>
          </View>
          {showMoreNutrition && (
            <View className='nutrition-grid more-grid'>
              {moreNutritionFields.map((item) => (
                <View key={item.field} className='field compact'>
                  <Text className='field-label'>{item.label}</Text>
                  <View className='field-input-with-unit'>
                    <Input
                      className='field-input'
                      type='digit'
                      value={String(draft[item.field] || '')}
                      placeholder='0'
                      onInput={(e) => updateField(item.field, e.detail.value)}
                    />
                    <Text className='field-unit'>{item.unit}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>}
        {showManualForm && <View className='edit-footer-spacer' />}
      </ScrollView>

      {showManualForm && <View className='edit-footer'>
        <View className={`save-btn ${saving ? 'loading' : ''} ${!canSubmitManually ? 'disabled' : ''}`} onClick={handleSubmit}>
          <Text className='save-btn-text'>{saving ? '保存中...' : '提交待审核'}</Text>
        </View>
      </View>}
    </View>
  )
}

export default withAuth(PackagedFoodEditPage)
