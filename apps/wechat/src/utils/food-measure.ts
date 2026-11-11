export type FoodMeasureUnit = 'g' | 'ml' | 'piece' | 'serving'

export interface FoodMeasurement {
  amount: number
  unit: FoodMeasureUnit
  basis_amount: number
  basis_unit: FoodMeasureUnit
  nutrients_per_basis: Record<string, number>
  /** 每 1 个键所指单位相当于多少 basis_unit；不提供就不允许跨单位计算。 */
  unit_conversions?: Partial<Record<FoodMeasureUnit, number>>
}

export const FOOD_MEASURE_UNITS: FoodMeasureUnit[] = ['g', 'ml', 'piece', 'serving']

export function isFoodMeasureUnit(value: unknown): value is FoodMeasureUnit {
  return typeof value === 'string' && FOOD_MEASURE_UNITS.includes(value as FoodMeasureUnit)
}

export function foodMeasureUnitLabel(unit: FoodMeasureUnit): string {
  return ({ g: 'g', ml: 'ml', piece: '个', serving: '份' })[unit]
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function validateFoodMeasurement(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '请填写食物份量和营养单位'
  const item = value as FoodMeasurement
  if (!positive(item.amount) || !positive(item.basis_amount)) return '份量和营养标示数量必须大于0'
  if (!isFoodMeasureUnit(item.unit) || !isFoodMeasureUnit(item.basis_unit)) return '请选择有效的份量单位'
  if (!item.nutrients_per_basis || typeof item.nutrients_per_basis !== 'object' || Array.isArray(item.nutrients_per_basis)) return '请填写有效的营养数据'
  const nutrients = Object.values(item.nutrients_per_basis)
  if (!nutrients.length || nutrients.some((number) => typeof number !== 'number' || !Number.isFinite(number) || number < 0)) return '营养数值不能为负数或无效数字'
  if (item.unit_conversions !== undefined) {
    if (!item.unit_conversions || typeof item.unit_conversions !== 'object' || Array.isArray(item.unit_conversions)) return '请填写有效的单位换算关系'
    for (const [unit, ratio] of Object.entries(item.unit_conversions)) {
      if (!isFoodMeasureUnit(unit) || !positive(ratio)) return '单位换算数量必须大于0'
      if (unit === item.basis_unit && ratio !== 1) return '营养标示单位的换算比例必须为1'
    }
  }
  if (item.unit !== item.basis_unit && !positive(item.unit_conversions?.[item.unit])) return '请补充份量与营养标示之间的换算关系'
  return null
}

export function normalizeFoodMeasurement(value: unknown): FoodMeasurement | null {
  if (validateFoodMeasurement(value)) return null
  const item = value as FoodMeasurement
  return {
    amount: item.amount,
    unit: item.unit,
    basis_amount: item.basis_amount,
    basis_unit: item.basis_unit,
    nutrients_per_basis: { ...item.nutrients_per_basis },
    ...(item.unit_conversions ? { unit_conversions: { ...item.unit_conversions, [item.basis_unit]: 1 } } : {}),
  }
}

export function convertFoodAmount(measurement: FoodMeasurement, amount: number, from: FoodMeasureUnit, to: FoodMeasureUnit): number | null {
  if (!Number.isFinite(amount) || amount < 0 || validateFoodMeasurement(measurement)) return null
  const fromRatio = from === measurement.basis_unit ? 1 : measurement.unit_conversions?.[from]
  const toRatio = to === measurement.basis_unit ? 1 : measurement.unit_conversions?.[to]
  if (!positive(fromRatio) || !positive(toRatio)) return null
  const converted = amount * fromRatio / toRatio
  return Number.isFinite(converted) ? converted : null
}

export function scaleFoodMeasurementNutrients(measurement: FoodMeasurement, amount = measurement.amount, unit = measurement.unit): Record<string, number> | null {
  const basisQuantity = convertFoodAmount(measurement, amount, unit, measurement.basis_unit)
  if (basisQuantity === null) return null
  const ratio = basisQuantity / measurement.basis_amount
  const values = Object.entries(measurement.nutrients_per_basis).map(([key, value]) => [key, Math.round(value * ratio * 1e6) / 1e6] as const)
  return values.every(([, value]) => Number.isFinite(value)) ? Object.fromEntries(values) : null
}

export function foodMeasurementGrams(measurement: FoodMeasurement, amount = measurement.amount, unit = measurement.unit): number | null {
  return convertFoodAmount(measurement, amount, unit, 'g')
}

export function foodMeasurementPer100g(measurement: FoodMeasurement): Record<string, number> | null {
  return scaleFoodMeasurementNutrients(measurement, 100, 'g')
}

export function foodMeasurementAllowedUnits(measurement: FoodMeasurement): FoodMeasureUnit[] {
  return FOOD_MEASURE_UNITS.filter((unit) => convertFoodAmount(measurement, 1, unit, measurement.basis_unit) !== null)
}

export function formatFoodMeasurementAmount(amount: number, unit: FoodMeasureUnit): string {
  return `${Number.isFinite(amount) ? Number(amount.toFixed(2)) : '—'}${foodMeasureUnitLabel(unit)}`
}

export function formatFoodMeasurementBasis(measurement: FoodMeasurement): string {
  return `每${formatFoodMeasurementAmount(measurement.basis_amount, measurement.basis_unit)}`
}
