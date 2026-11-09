import type { AnalysisTask, PackagedProductExtractResult } from './types'

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
  /** 没读到热量时为 null，此时不动表单里已有的营养值 */
  nutrition: CustomImportNutrition | null
}

export interface CustomImportDeps {
  getTask: (taskId: string) => Promise<Pick<AnalysisTask, 'status' | 'result' | 'error_message'>>
  wait: (ms: number) => Promise<void>
  now: () => number
}

const POLL_INTERVAL_MS = 1800
const POLL_TIMEOUT_MS = 120000
const EXTRACT_FAILED_MESSAGE = '包装识别失败，请重拍后再试'

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
  return [result.brand, product, result.flavor_text]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .filter((part) => part === product || !product.includes(part))
    .join(' ')
}

export function customDraftFromPackagedExtract(result: PackagedProductExtractResult): CustomImportDraft {
  const unit = result.unit_nutrition_per_100g || {}
  const calories = positiveText(unit.calories)
  const micro = Object.entries(MICRO_FIELD_BY_RESULT_KEY).reduce<Record<string, string>>((fields, [resultKey, fieldKey]) => {
    const value = positiveText(unit[resultKey])
    return value ? { ...fields, [fieldKey]: value } : fields
  }, {})
  return {
    name: importedName(result),
    weight: positiveText(result.default_portion_g) || positiveText(result.net_weight_g),
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

export function describeCustomImport(draft: CustomImportDraft, result: PackagedProductExtractResult): string {
  if (!draft.nutrition) return '没读清热量，补拍营养成分表后再识别，或手动填写'
  if (!draft.name) return '没读清商品名，补拍包装正面后再识别，或手动填写'
  const filed = draft.category === 'snack' ? '已归入零食，' : ''
  return result.needs_user_confirmation
    ? `已按包装填好，${filed}有几项不够确定，请重点核对`
    : `已按包装填好，${filed}保存前请核对`
}

export function isSnackCustomFood(item: { source?: unknown; category?: unknown }): boolean {
  return item.source === 'custom' && item.category === 'snack'
}

/** isAbandoned 为真（草稿已取消、页面已关闭）时返回 null，不再请求。 */
export async function pollPackagedExtractResult(
  taskId: string,
  isAbandoned: () => boolean,
  deps: CustomImportDeps,
): Promise<PackagedProductExtractResult | null> {
  const startedAt = deps.now()
  while (deps.now() - startedAt < POLL_TIMEOUT_MS) {
    if (isAbandoned()) return null
    const task = await deps.getTask(taskId)
    if (task.status === 'done') {
      const output = (task.result || {}) as Record<string, unknown>
      const product = (output.packaged_product || output.nutrition) as PackagedProductExtractResult | undefined
      if (!product) throw new Error(EXTRACT_FAILED_MESSAGE)
      return product
    }
    if (task.status === 'failed' || task.status === 'violated' || task.status === 'timed_out' || task.status === 'cancelled') {
      throw new Error(task.error_message || EXTRACT_FAILED_MESSAGE)
    }
    await deps.wait(POLL_INTERVAL_MS)
  }
  throw new Error('识别时间较长，请稍后重试')
}
