import type { ManualFoodSearchResult, Nutrients } from './api'

export type ManualFoodDisplayUnit = 'g' | 'ml' | 'serving' | 'piece'

export interface ManualFoodServingLike {
  source?: string
  default_weight_grams?: number
  display_unit?: ManualFoodDisplayUnit
  display_unit_label?: string
  portion_label?: string
}

export interface SelectedManualFoodServingLike {
  weight: number
  defaultWeight: number
  displayUnit: ManualFoodDisplayUnit
  displayUnitLabel: string
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

type NutrientKey = keyof Nutrients

const DETAIL_NUTRIENT_KEYS: NutrientKey[] = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'waterMl',
  'water_ml',
  'saturatedFat',
  'cholesterolMg',
  'sodium_mg',
  'sodiumMg',
  'potassiumMg',
  'calciumMg',
  'ironMg',
  'magnesiumMg',
  'zincMg',
  'vitaminARaeMcg',
  'vitaminCMg',
  'vitaminDMcg',
  'vitaminEMg',
  'vitaminKMcg',
  'thiaminMg',
  'riboflavinMg',
  'niacinMg',
  'vitaminB6Mg',
  'folateMcg',
  'vitaminB12Mcg',
]

function nutrientNumber(nutrients: Partial<Nutrients> | undefined, key: NutrientKey) {
  const value = nutrients?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function roundNutrient(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

type ManualFoodDetailNutrientItem = Pick<
  ManualFoodSearchResult,
  | 'source'
  | 'default_weight_grams'
  | 'total_calories'
  | 'total_protein'
  | 'total_carbs'
  | 'total_fat'
  | 'nutrients_per_100g'
  | 'extra_nutrients'
>

export function manualFoodDetailPortionNutrients(item: ManualFoodDetailNutrientItem): Nutrients {
  const hasPer100gNutrients = DETAIL_NUTRIENT_KEYS.some(
    (key) => nutrientNumber(item.nutrients_per_100g, key) > 0,
  )
  const source = hasPer100gNutrients ? item.nutrients_per_100g : item.extra_nutrients
  const scale = hasPer100gNutrients ? practicalManualFoodDefaultWeight(item) / 100 : 1
  const portion = {} as Nutrients

  DETAIL_NUTRIENT_KEYS.forEach((key) => {
    portion[key] = roundNutrient(nutrientNumber(source, key) * scale, 4) as never
  })
  if (!portion.sodium_mg && portion.sodiumMg) portion.sodium_mg = portion.sodiumMg
  if (!portion.sodiumMg && portion.sodium_mg) portion.sodiumMg = portion.sodium_mg

  return {
    ...portion,
    calories: roundNutrient(item.total_calories, 1),
    protein: roundNutrient(item.total_protein, 1),
    carbs: roundNutrient(item.total_carbs, 1),
    fat: roundNutrient(item.total_fat, 1),
  }
}

export function formatManualFoodWeight(value: number, precision = 1) {
  const factor = 10 ** precision
  const rounded = Math.round((positiveNumber(value, 0) + Number.EPSILON) * factor) / factor
  return String(rounded)
}

/**
 * 高频食物的默认重量来自历史 AVG，可能出现 65.8333g。
 * 包装食品/自定义食物可能确实有 12.5g 这类标签值，因此只把营养库默认量取整到可操作的整克。
 */
export function practicalManualFoodDefaultWeight(item: ManualFoodServingLike, fallback = 100) {
  const raw = positiveNumber(item.default_weight_grams, fallback)
  if (item.source === 'nutrition_library' && (item.display_unit === 'g' || !item.display_unit)) {
    return Math.max(1, Math.round(raw))
  }
  return raw
}

export function manualFoodResultPortionText(item: ManualFoodServingLike) {
  const weight = practicalManualFoodDefaultWeight(item)
  switch (item.display_unit) {
    case 'piece':
      return `1${item.display_unit_label || '个'}（约${formatManualFoodWeight(weight)}g）`
    case 'serving':
      return weight > 1
        ? `1${item.display_unit_label || '份'}（约${formatManualFoodWeight(weight)}g）`
        : `1${item.display_unit_label || '份'}`
    case 'ml':
      return `${formatManualFoodWeight(weight)}${item.display_unit_label || 'ml'}`
    case 'g':
      return `${formatManualFoodWeight(weight)}${item.display_unit_label || 'g'}`
    default:
      return item.portion_label || `${formatManualFoodWeight(weight)}g`
  }
}

export function selectedManualFoodAmountText(item: SelectedManualFoodServingLike) {
  const weight = positiveNumber(item.weight, item.defaultWeight)
  const base = positiveNumber(item.defaultWeight, 1)
  switch (item.displayUnit) {
    case 'piece': {
      const quantity = formatManualFoodWeight(weight / base)
      return `${quantity}${item.displayUnitLabel || '个'}（约${formatManualFoodWeight(weight)}g）`
    }
    case 'serving': {
      const quantity = formatManualFoodWeight(weight / base)
      return base > 1
        ? `${quantity}${item.displayUnitLabel || '份'}（约${formatManualFoodWeight(weight)}g）`
        : `${quantity}${item.displayUnitLabel || '份'}`
    }
    case 'ml':
      return `${formatManualFoodWeight(weight)}${item.displayUnitLabel || 'ml'}`
    default:
      return `${formatManualFoodWeight(weight)}${item.displayUnitLabel || 'g'}`
  }
}

export function manualFoodDisplayInput(item: SelectedManualFoodServingLike, nextWeight = item.weight) {
  const weight = positiveNumber(nextWeight, item.defaultWeight)
  if (item.displayUnit === 'piece' || item.displayUnit === 'serving') {
    return formatManualFoodWeight(weight / positiveNumber(item.defaultWeight, 1))
  }
  return formatManualFoodWeight(weight)
}

export function manualFoodWeightFromInput(item: Pick<SelectedManualFoodServingLike, 'defaultWeight' | 'displayUnit'>, value: number) {
  if (item.displayUnit === 'piece' || item.displayUnit === 'serving') {
    return positiveNumber(item.defaultWeight, 1) * value
  }
  return value
}
