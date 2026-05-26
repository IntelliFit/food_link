import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import { useMemo, useState } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import {
  compressImagePathForUpload,
  createPackagedFood,
  getAnalyzeTask,
  listAnalyzeTasks,
  sanitizeUserFacingErrorMessage,
  showUnifiedApiError,
  submitPackagedProductExtract,
  uploadAnalyzeImageFile,
  type CreatePackagedFoodRequest,
  type PackagedAutoIngestResult,
  type PackagedProductExtractResult,
  type PackagedUploadRewardResult,
} from '../../../utils/api'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

const PACKAGED_FOOD_EDIT_DRAFT_KEY = 'packagedFoodEditDraft'
const PACKAGED_FOOD_EDIT_SAVED_KEY = 'packagedFoodEditSaved'
const PACKAGED_FOOD_UPLOAD_TASKS_KEY = 'packagedFoodUploadTasks'

type CaptureStep = 'front' | 'nutrition' | 'ingredients'

type Draft = {
  itemId?: number
  sourceTaskId?: string
  recognizedNameHint?: string
  brand: string
  productName: string
  flavorText: string
  packageCategory: string
  specText: string
  barcode: string
  ingredientsText: string
  netWeightG: string
  servingWeightG: string
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

const formatRecognizedNumber = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

const normalizeString = (value: unknown) => String(value || '').trim()

function isChooseImageCancel(error: unknown) {
  const message = String((error as any)?.errMsg || (error as any)?.message || error || '').toLowerCase()
  return message.includes('chooseimage:fail cancel') || message.includes('cancel')
}

function describeAutoIngestReason(result: PackagedAutoIngestResult, rewardTaskMode = false) {
  const actionSuffix = rewardTaskMode ? '请重拍后重新识别。' : '可以重拍，或手动确认字段后保存。'
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
        ? '这次识别结果还不够稳定。请重拍包装正面和营养成分表后重新提交。'
        : '你可以继续重拍，或手动确认字段后保存。'
  }
}

function buildPackagedExtractToast(result: PackagedProductExtractResult) {
  if (result.auto_ingest_result?.status === 'ingested') return '已自动入库'
  if ((result.needs_more_images || []).includes('ingredients')) return '还需要补拍配料表'
  switch (result.auto_ingest_result?.reason) {
    case 'missing_net_weight':
      return '请重拍正面净含量'
    case 'missing_nutrition':
    case 'conversion_not_closed':
      return '请重拍营养表'
    case 'low_extract_confidence':
    case 'low_name_confidence':
    case 'low_spec_confidence':
    case 'low_nutrition_confidence':
      return '图片不够清晰，请重拍'
    case 'conflict':
      return '信息冲突，请重拍'
    default:
      return '已填充识别结果'
  }
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

function PackagedFoodEditPage() {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [captureImages, setCaptureImages] = useState<CaptureImages>({})
  const [currentStep, setCurrentStep] = useState<CaptureStep>('front')
  const [recognizing, setRecognizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showMoreNutrition, setShowMoreNutrition] = useState(false)
  const [needsIngredientsCapture, setNeedsIngredientsCapture] = useState(false)
  const [extractResult, setExtractResult] = useState<PackagedProductExtractResult | null>(null)
  const [autoIngestResult, setAutoIngestResult] = useState<PackagedAutoIngestResult | null>(null)
  const [uploadTasks, setUploadTasks] = useState<PackagedUploadTaskEntry[]>([])
  const [tasksExpanded, setTasksExpanded] = useState(false)
  const isRewardTaskMode = router.params?.task_mode === 'reward_center'

  useDidShow(() => {
    try {
      const saved = Taro.getStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
      if (!saved || typeof saved !== 'object') return
      const nextDraft = { ...emptyDraft, ...saved }
      setDraft(nextDraft)
      setCurrentStep(saved.frontImageUrl ? 'nutrition' : 'front')
      setCaptureImages({
        front: normalizeString(saved.frontImageUrl),
        nutrition: normalizeString(saved.nutritionImageUrl),
        ingredients: normalizeString(saved.ingredientsImageUrl),
      })
    } catch {}
    if (isRewardTaskMode) {
      refreshUploadTasks()
    }
  })

  const canSubmitManually = useMemo(() => {
    return draft.productName.trim() && numberFromDraft(draft.netWeightG) > 0
  }, [draft])

  const updateField = (field: keyof Draft, value: string) => {
    setDraft(current => ({ ...current, [field]: value }))
  }

  const fillIfRecognized = (current: Draft, field: keyof Draft, value: unknown) => {
    const next = formatRecognizedNumber(value)
    return next ? { ...current, [field]: next } : current
  }

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

  const chooseAndUploadImages = async (count = 2): Promise<UploadedImage[]> => {
    const chooseRes = await chooseImageWithPrivacy({
      count,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
    })
    const localPaths = (chooseRes.tempFilePaths || []).filter(Boolean).slice(0, count)
    if (localPaths.length === 0) return []
    return Promise.all(localPaths.map(async (localPath) => {
      const uploadPath = await compressImagePathForUpload(localPath)
      const { imageUrl } = await uploadAnalyzeImageFile(uploadPath)
      return { localPath, imageUrl }
    }))
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

  const handleRewardBatchUpload = async () => {
    if (recognizing) return
    setRecognizing(true)
    Taro.showLoading({ title: '提交中', mask: true })
    try {
      const uploaded = await chooseAndUploadImages(2)
      const imageUrls = uploaded.map(item => item.imageUrl).filter(Boolean)
      if (imageUrls.length === 0) {
        Taro.hideLoading()
        return
      }
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
        message: '已加入后台分析列表',
      })
      setUploadTasks(nextTasks)
      setCaptureImages({})
      setCurrentStep('front')
      setNeedsIngredientsCapture(false)
      setExtractResult(null)
      setAutoIngestResult(null)
      Taro.removeStorageSync(PACKAGED_FOOD_EDIT_DRAFT_KEY)
      Taro.hideLoading()
      Taro.showToast({ title: '已加入分析列表', icon: 'success' })
      setTimeout(() => refreshUploadTasks(nextTasks), 1200)
    } catch (error) {
      Taro.hideLoading()
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
          message: '已加入后台分析列表',
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
    if (saving || !canSubmitManually) return
    const payload: CreatePackagedFoodRequest = {
      brand: draft.brand.trim() || undefined,
      product_name: draft.productName.trim(),
      flavor_text: draft.flavorText.trim() || undefined,
      package_category: draft.packageCategory.trim() || undefined,
      spec_text: draft.specText.trim() || undefined,
      barcode: draft.barcode.trim() || undefined,
      ingredients_text: draft.ingredientsText.trim() || undefined,
      source_image_urls: [captureImages.front, captureImages.nutrition, captureImages.ingredients].filter(Boolean) as string[],
      ocr_raw_text: extractResult?.ocr_raw_text || undefined,
      extract_confidence: extractResult?.extract_confidence,
      field_confidence: extractResult?.field_confidence,
      ingest_method: 'user_capture_ocr',
      net_weight_g: numberFromDraft(draft.netWeightG),
      serving_weight_g: numberFromDraft(draft.servingWeightG) || numberFromDraft(draft.netWeightG),
      kcal_per_100g: numberFromDraft(draft.calories),
      protein_per_100g: numberFromDraft(draft.protein),
      carbs_per_100g: numberFromDraft(draft.carbs),
      fat_per_100g: numberFromDraft(draft.fat),
      fiber_per_100g: numberFromDraft(draft.fiber),
      sugar_per_100g: numberFromDraft(draft.sugar),
      sodium_mg_per_100g: numberFromDraft(draft.sodiumMg),
      saturated_fat_per_100g: numberFromDraft(draft.saturatedFat),
      cholesterol_mg_per_100g: numberFromDraft(draft.cholesterolMg),
      potassium_mg_per_100g: numberFromDraft(draft.potassiumMg),
      calcium_mg_per_100g: numberFromDraft(draft.calciumMg),
      iron_mg_per_100g: numberFromDraft(draft.ironMg),
      magnesium_mg_per_100g: numberFromDraft(draft.magnesiumMg),
      zinc_mg_per_100g: numberFromDraft(draft.zincMg),
      vitamin_a_rae_mcg_per_100g: numberFromDraft(draft.vitaminARaeMcg),
      vitamin_c_mg_per_100g: numberFromDraft(draft.vitaminCMg),
      vitamin_d_mcg_per_100g: numberFromDraft(draft.vitaminDMcg),
      vitamin_e_mg_per_100g: numberFromDraft(draft.vitaminEMg),
      vitamin_k_mcg_per_100g: numberFromDraft(draft.vitaminKMcg),
      thiamin_mg_per_100g: numberFromDraft(draft.thiaminMg),
      riboflavin_mg_per_100g: numberFromDraft(draft.riboflavinMg),
      niacin_mg_per_100g: numberFromDraft(draft.niacinMg),
      vitamin_b6_mg_per_100g: numberFromDraft(draft.vitaminB6Mg),
      folate_mcg_per_100g: numberFromDraft(draft.folateMcg),
      vitamin_b12_mcg_per_100g: numberFromDraft(draft.vitaminB12Mcg),
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
      Taro.showToast({ title: '已保存到零食库', icon: 'success' })
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
        <View className='edit-section wizard-section'>
          <Text className='section-title'>预包装零食补库</Text>
          {isRewardTaskMode ? (
            <>
              <Text className='wizard-desc'>一次上传 1-2 张照片即可加入后台分析列表。成功入库且数据库原本没有时发放奖励积分。</Text>

              <View className='shoot-guide-grid'>
                <View className='shoot-guide-card recommended'>
                  <Text className='shoot-guide-badge'>推荐</Text>
                  <Text className='shoot-guide-title'>两张图更稳</Text>
                  <View className='shoot-guide-preview-row'>
                    <View className='shoot-guide-preview'>
                      <Text className='shoot-guide-preview-main'>图 1</Text>
                      <Text className='shoot-guide-preview-sub'>正面 + 净含量</Text>
                    </View>
                    <View className='shoot-guide-preview'>
                      <Text className='shoot-guide-preview-main'>图 2</Text>
                      <Text className='shoot-guide-preview-sub'>营养成分表</Text>
                    </View>
                  </View>
                  <Text className='shoot-guide-desc'>第一张拍品牌、品名、口味和净含量；第二张拍清能量、蛋白质、脂肪、碳水、钠和每100g/每份口径。</Text>
                </View>
                <View className='shoot-guide-card'>
                  <Text className='shoot-guide-badge muted'>可选</Text>
                  <Text className='shoot-guide-title'>一张图也可以</Text>
                  <View className='shoot-guide-preview single'>
                    <Text className='shoot-guide-preview-main'>一图完整</Text>
                    <Text className='shoot-guide-preview-sub'>品名 + 净含量 + 营养表</Text>
                  </View>
                  <Text className='shoot-guide-desc'>包装较小、所有文字能同框拍清时用一张图；如果反光、字小或营养表不清楚，请改用两张图。</Text>
                </View>
              </View>

              <View className='capture-card reward-capture-card'>
                <View className='reward-upload-visual'>
                  <View className='reward-upload-icon'>+</View>
                  <Text className='reward-upload-title'>快速添加一个零食任务</Text>
                  <Text className='reward-upload-desc'>可以一次选 1 张或 2 张；提交后你可以继续添加下一组，不用等 AI 分析完。</Text>
                </View>
                <View className={`recognize-btn reward-upload-btn ${recognizing ? 'loading' : ''}`} onClick={handleRewardBatchUpload}>
                  <Text className='recognize-btn-text'>{recognizing ? '提交中' : '上传/拍摄 1-2 张照片'}</Text>
                </View>
              </View>
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
                  <Text className='upload-task-empty-text'>还没有提交任务。先上传一张完整图，或一次选择正面和营养表两张图。</Text>
                </View>
              ) : (
                <View className='upload-task-list'>
                  {visibleUploadTasks.map((task) => (
                    <View key={task.taskId} className={`upload-task-item status-${task.status}`} onClick={() => openTaskDetail(task)}>
                      <View className='upload-task-item-main'>
                        <Text className='upload-task-item-title'>{task.productName || `零食照片 ${task.imageCount} 张`}</Text>
                        <Text className='upload-task-item-desc'>{task.message || '后台分析中'}</Text>
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
              {isRewardTaskMode && (
                <Text className='ingest-status-hint'>请按提示重拍后重新识别；系统自动入库成功后才会结算奖励积分。</Text>
              )}
            </View>
          )}
        </View>

        {!isRewardTaskMode && (
          <View className='edit-section'>
            <Text className='section-title'>基础信息</Text>
            <View className='field'>
              <Text className='field-label'>名称</Text>
              <Input className='field-input' value={draft.productName} placeholder='零食名称' onInput={(e) => updateField('productName', e.detail.value)} />
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
              <Input className='field-input' value={draft.specText} placeholder='如 70g、35g*2袋' onInput={(e) => updateField('specText', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>条码</Text>
              <Input className='field-input' value={draft.barcode} placeholder='可选' onInput={(e) => updateField('barcode', e.detail.value)} />
            </View>
            <View className='field'>
              <Text className='field-label'>净含量</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.netWeightG} placeholder='净含量' onInput={(e) => updateField('netWeightG', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field'>
              <Text className='field-label'>每份重量</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.servingWeightG} placeholder='可选' onInput={(e) => updateField('servingWeightG', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field'>
              <Text className='field-label'>配料表</Text>
              <Input className='field-input' value={draft.ingredientsText} placeholder='按需补拍后会自动填入，也可手动补' onInput={(e) => updateField('ingredientsText', e.detail.value)} />
            </View>
          </View>
        )}

        {!isRewardTaskMode && <View className='edit-section'>
          <Text className='section-title'>每100g营养成分</Text>
          <View className='nutrition-grid'>
            <View className='field compact'>
              <Text className='field-label'>热量</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.calories} placeholder='0' onInput={(e) => updateField('calories', e.detail.value)} />
                <Text className='field-unit'>kcal</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>蛋白质</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.protein} placeholder='0' onInput={(e) => updateField('protein', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>碳水</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.carbs} placeholder='0' onInput={(e) => updateField('carbs', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>脂肪</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.fat} placeholder='0' onInput={(e) => updateField('fat', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>膳食纤维</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.fiber} placeholder='0' onInput={(e) => updateField('fiber', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact'>
              <Text className='field-label'>糖</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.sugar} placeholder='0' onInput={(e) => updateField('sugar', e.detail.value)} />
                <Text className='field-unit'>g</Text>
              </View>
            </View>
            <View className='field compact wide'>
              <Text className='field-label'>钠</Text>
              <View className='field-input-with-unit'>
                <Input className='field-input' type='digit' value={draft.sodiumMg} placeholder='0' onInput={(e) => updateField('sodiumMg', e.detail.value)} />
                <Text className='field-unit'>mg</Text>
              </View>
            </View>
          </View>
        </View>}

        {!isRewardTaskMode && <View className='edit-section more-section'>
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
        {!isRewardTaskMode && <View className='edit-footer-spacer' />}
      </ScrollView>

      {!isRewardTaskMode && <View className='edit-footer'>
        <View className={`save-btn ${saving ? 'loading' : ''} ${!canSubmitManually ? 'disabled' : ''}`} onClick={handleSubmit}>
          <Text className='save-btn-text'>{saving ? '保存中...' : '确认保存到零食库'}</Text>
        </View>
      </View>}
    </View>
  )
}

export default withAuth(PackagedFoodEditPage)
