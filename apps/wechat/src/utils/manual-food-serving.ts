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
  if (item.displayUnit === 'serving') {
    return formatManualFoodWeight(weight / positiveNumber(item.defaultWeight, 1))
  }
  return formatManualFoodWeight(weight)
}

export function manualFoodWeightFromInput(item: Pick<SelectedManualFoodServingLike, 'defaultWeight' | 'displayUnit'>, value: number) {
  if (item.displayUnit === 'serving') {
    return positiveNumber(item.defaultWeight, 1) * value
  }
  return value
}

export function manualFoodWeightInputUnit(item: Pick<SelectedManualFoodServingLike, 'displayUnit' | 'displayUnitLabel'>) {
  return item.displayUnit === 'piece' ? 'g' : item.displayUnitLabel
}
