import Taro from '@tarojs/taro'
import {
  compressImagePathForUpload,
  getAnalyzeTask,
  sanitizeUserFacingErrorMessage,
  uploadAnalyzeImageFile,
  type AnalysisTask,
  type PackagedProductExtractResult,
} from '../../../utils/api'
import { chooseImageWithPrivacy } from '../../../utils/weapp-privacy'
import { normalizeFoodMeasurement, type FoodMeasurement, type FoodMeasureUnit } from '../../../utils/food-measure'

export type CustomFoodCategory = 'custom' | 'snack'

export interface CustomImportNutrition {
  calories: string
  protein: string
  carbs: string
  fat: string
  micro: Record<string, string>
}

export interface CustomImportDraft {
  name: string
  weight: string
  category: CustomFoodCategory
  measurement?: FoodMeasurement
  nutritionBasis: string
  basisUnit: FoodMeasureUnit
  portionUnit: FoodMeasureUnit
  /** 没读到热量时为 null，此时不动表单里已有的营养值 */
  nutrition: CustomImportNutrition | null
}

export interface CustomImportDeps {
  getTask: (taskId: string) => Promise<AnalysisTask>
  wait: (ms: number) => Promise<void>
  now: () => number
}

const POLL_INTERVAL_MS = 1800
const POLL_TIMEOUT_MS = 120000

/** 识别结果字段 → 自定义表单微量字段（表单里钠用 sodium_mg） */
const MICRO_FIELD_BY_RESULT_KEY: Record<string, string> = {
  fiber: 'fiber',
  sugar: 'sugar',
  sodiumMg: 'sodium_mg',
  potassiumMg: 'potassiumMg',
  calciumMg: 'calciumMg',
  ironMg: 'ironMg',
  magnesiumMg: 'magnesiumMg',
  zincMg: 'zincMg',
  vitaminARaeMcg: 'vitaminARaeMcg',
  vitaminCMg: 'vitaminCMg',
  vitaminDMcg: 'vitaminDMcg',
  vitaminEMg: 'vitaminEMg',
  vitaminKMcg: 'vitaminKMcg',
  thiaminMg: 'thiaminMg',
  riboflavinMg: 'riboflavinMg',
  niacinMg: 'niacinMg',
  vitaminB6Mg: 'vitaminB6Mg',
  folateMcg: 'folateMcg',
  vitaminB12Mcg: 'vitaminB12Mcg',
}

function positiveText(value: unknown): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return ''
  return String(Math.round(parsed * 100) / 100)
}

function importedName(result: PackagedProductExtractResult): string {
  const product = String(result.product_name || '').trim()
  const parts = [result.brand, product, result.flavor_text]
    .map(part => String(part || '').trim())
    .filter(Boolean)
  return parts
    .filter(part => part === product || !product.includes(part))
    .join(' ')
}

export function customDraftFromPackagedExtract(result: PackagedProductExtractResult): CustomImportDraft {
  const measurement = packagedExtractMeasurement(result)
  const unit = measurement?.nutrients_per_basis || {}
  const calories = positiveText(unit.calories)
  const micro: Record<string, string> = {}
  Object.entries(MICRO_FIELD_BY_RESULT_KEY).forEach(([resultKey, fieldKey]) => {
    const value = positiveText(unit[resultKey])
    if (value) micro[fieldKey] = value
  })
  return {
    name: importedName(result),
    weight: measurement ? positiveText(measurement.amount) : '',
    measurement: measurement || undefined,
    nutritionBasis: String(measurement?.basis_amount || 100),
    basisUnit: measurement?.basis_unit || 'g',
    portionUnit: measurement?.unit || 'g',
    category: result.catalog_category === 'snack' ? 'snack' : 'custom',
    nutrition: calories
      ? {
        calories,
        protein: positiveText(unit.protein),
        carbs: positiveText(unit.carbs),
        fat: positiveText(unit.fat),
        micro,
      }
      : null,
  }
}

function extractUnit(value: string | undefined): FoodMeasureUnit | null {
  const unit = String(value || '').toLowerCase().replace(/\s/g, '')
  if (/ml|毫升/.test(unit)) return 'ml'
  if (/^g$|克|100g/.test(unit)) return 'g'
  if (/piece|个|枚/.test(unit)) return 'piece'
  if (/serving|份/.test(unit)) return 'serving'
  return null
}

/** 保留标签的原始数量与单位，旧 per100g 字段只有在口径明确后才能使用。 */
export function packagedExtractMeasurement(result: PackagedProductExtractResult): FoodMeasurement | null {
  const supplied = normalizeFoodMeasurement(result.measurement)
  if (supplied) return supplied
  const rawBasis = result.raw_nutrition_basis
  const declaredUnit = extractUnit(rawBasis?.unit) || extractUnit(rawBasis?.type) || extractUnit(result.nutrition_basis_unit)
  if (!declaredUnit && (rawBasis?.unit || rawBasis?.type || result.nutrition_basis_unit)) return null
  // Old responses only had a genuinely per100g field. A volume container alone
  // does not establish whether the nutrition facts use grams or milliliters.
  if (!declaredUnit && extractUnit(result.net_content_unit) === 'ml') return null
  const basisUnit = declaredUnit || 'g'
  const nativePerHundred = result.unit_nutrition_per_100g || {}
  const rawAmount = Number(rawBasis?.value)
  const basisAmount = rawAmount > 0 ? rawAmount : basisUnit === 'piece' || basisUnit === 'serving' ? 1 : 100
  let nutrients: Record<string, number> = {}
  if (basisUnit === 'g' || basisUnit === 'ml') {
    nutrients = Object.fromEntries(Object.entries(nativePerHundred).filter(([, value]) => Number.isFinite(value) && value >= 0).map(([key, value]) => [key, value * basisAmount / 100]))
  } else {
    for (const [rawKey, rawValue] of Object.entries(result.raw_nutrition_per_basis || {})) {
      const value = Number(rawValue.value)
      if (!Number.isFinite(value) || value < 0) continue
      const key = rawKey === 'energy' ? 'calories' : rawKey
      const unit = String(rawValue.unit || '').toLowerCase()
      let scaled = value
      if (key === 'calories' && unit === 'kj') scaled /= 4.184
      else if (key.endsWith('Mg')) scaled *= unit === 'g' ? 1000 : /mcg|μg|ug/.test(unit) ? 0.001 : 1
      else if (key.endsWith('Mcg')) scaled *= unit === 'mg' ? 1000 : unit === 'g' ? 1e6 : 1
      else if (key !== 'calories' && unit === 'mg') scaled /= 1000
      nutrients[key] = scaled
    }
  }
  let amount = basisAmount
  if (basisUnit === 'g') amount = Number(result.default_portion_g) || Number(result.serving_weight_g) || Number(result.net_weight_g) || basisAmount
  if (basisUnit === 'ml') {
    amount = rawBasis?.type === 'serving' && extractUnit(rawBasis.unit) === 'ml' && rawAmount > 0 ? rawAmount
      : extractUnit(result.unit_content_unit) === 'ml' && Number(result.unit_content_value) > 0 ? Number(result.unit_content_value)
        : extractUnit(result.net_content_unit) === 'ml' && Number(result.net_content_value) > 0 ? Number(result.net_content_value) : basisAmount
  }
  return normalizeFoodMeasurement({ amount, unit: basisUnit, basis_amount: basisAmount, basis_unit: basisUnit, nutrients_per_basis: nutrients })
}

export function describeCustomImport(draft: CustomImportDraft, result: PackagedProductExtractResult): string {
  if (!draft.nutrition) return '没读清热量，补拍营养成分表后再识别，或手动填写'
  if (!draft.name) return '没读清商品名，补拍包装正面后再识别，或手动填写'
  const filed = draft.category === 'snack' ? '已归入零食，' : ''
  return result.needs_user_confirmation
    ? `已按包装填好，${filed}有几项不够确定，请重点核对`
    : `已按包装填好，${filed}保存前请核对`
}

export function isSnackCustomFood(item: { source?: string; category?: string }): boolean {
  return item.source === 'custom' && item.category === 'snack'
}

const defaultDeps: CustomImportDeps = {
  getTask: getAnalyzeTask,
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => Date.now(),
}

/** isAbandoned 为真（草稿已取消、页面已关闭）时返回 null，不再请求。 */
export async function pollPackagedExtractResult(
  taskId: string,
  isAbandoned: () => boolean,
  deps: CustomImportDeps = defaultDeps,
): Promise<PackagedProductExtractResult | null> {
  const startedAt = deps.now()
  while (deps.now() - startedAt < POLL_TIMEOUT_MS) {
    if (isAbandoned()) return null
    const task = await deps.getTask(taskId)
    if (task.status === 'done') {
      const output = (task.result || {}) as Record<string, any>
      const product = (output.packaged_product || output.nutrition) as PackagedProductExtractResult | undefined
      if (!product) throw new Error('包装识别失败，请重拍后再试')
      return product
    }
    if (task.status === 'failed' || task.status === 'timed_out' || task.status === 'cancelled') {
      throw new Error(sanitizeUserFacingErrorMessage(task.error_message, '包装识别失败，请重拍后再试'))
    }
    await deps.wait(POLL_INTERVAL_MS)
  }
  throw new Error('识别时间较长，请稍后重试')
}

function askContinueCapture(capturedCount: number): Promise<boolean> {
  return new Promise((resolve) => {
    Taro.showModal({
      title: `已拍 ${capturedCount} 张`,
      content: '再拍一张营养成分表，识别更准。',
      confirmText: '继续拍',
      cancelText: '开始识别',
      success: res => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
}

async function capturePhotos(maxCount: number): Promise<string[]> {
  const localPaths: string[] = []
  while (localPaths.length < maxCount) {
    let res: Taro.chooseImage.SuccessCallbackResult
    try {
      res = await chooseImageWithPrivacy({ count: 1, sizeType: ['compressed'], sourceType: ['camera'] })
    } catch (error) {
      const message = String((error as any)?.errMsg || (error as any)?.message || error || '')
      if (localPaths.length > 0 && /cancel/i.test(message)) break
      throw error
    }
    const localPath = res.tempFilePaths?.[0]
    if (localPath) localPaths.push(localPath)
    if (localPaths.length >= maxCount || !(await askContinueCapture(localPaths.length))) break
  }
  return localPaths
}

/** 拍照时一张张拍（相机每次只出一张），相册可一次多选。用户取消时抛出微信的 cancel 错误。 */
export async function choosePackagePhotos(maxCount: number): Promise<string[]> {
  const { tapIndex } = await Taro.showActionSheet({ itemList: ['拍包装正面和营养成分表', '从相册选择'] })
  if (tapIndex === 0) return capturePhotos(maxCount)
  const res = await chooseImageWithPrivacy({ count: maxCount, sizeType: ['compressed'], sourceType: ['album'] })
  return (res.tempFilePaths || []).filter(Boolean).slice(0, maxCount)
}

export async function uploadPackagePhotos(localPaths: string[]): Promise<string[]> {
  return Promise.all(localPaths.map(async (localPath) => {
    const uploadPath = await compressImagePathForUpload(localPath)
    const { imageUrl } = await uploadAnalyzeImageFile(uploadPath)
    return imageUrl
  }))
}
