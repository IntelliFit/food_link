import type { Nutrients } from './api'
import {
  convertFoodAmount,
  foodMeasurementGrams,
  formatFoodMeasurementAmount,
  normalizeFoodMeasurement,
  validateFoodMeasurement,
  type FoodMeasurement,
} from './food-measure'

export type MeasuredRecordItem = {
  measurement?: FoodMeasurement | null
  ratio?: number | null
  weight?: number | null
  intake?: number | null
}

export function foodRecordItemRatio(item: Pick<MeasuredRecordItem, 'ratio' | 'weight' | 'intake'>) {
  if (item.ratio != null && Number.isFinite(item.ratio)) return Math.max(0, Math.min(100, item.ratio))
  if (item.weight && item.weight > 0 && item.intake != null && Number.isFinite(item.intake)) {
    return Math.max(0, Math.min(100, item.intake / item.weight * 100))
  }
  return 100
}

export function foodRecordAmountText(item: MeasuredRecordItem): string {
  const ratio = foodRecordItemRatio(item) / 100
  if (item.measurement != null) {
    const measurement = normalizeFoodMeasurement(item.measurement)
    if (!measurement) return '份量待确认'
    const amount = measurement.amount * ratio
    const native = formatFoodMeasurementAmount(amount, measurement.unit)
    const grams = foodMeasurementGrams(measurement, amount)
    return measurement.unit !== 'g' && grams != null
      ? `${native}（约${formatFoodMeasurementAmount(grams, 'g')}）`
      : native
  }
  const grams = item.intake != null && item.intake > 0 ? item.intake : Number(item.weight || 0) * ratio
  return formatFoodMeasurementAmount(grams, 'g')
}

/** Manual edits change a record snapshot, never the original shared food. */
export function recordMeasurementWithNutrients(measurement: FoodMeasurement, nutrients: Partial<Nutrients>): FoodMeasurement {
  const normalized = normalizeFoodMeasurement(measurement)
  if (!normalized) throw new Error(validateFoodMeasurement(measurement) || '食物数量单位无效')
  const basisAmount = convertFoodAmount(normalized, normalized.amount, normalized.unit, normalized.basis_unit)
  if (basisAmount == null || basisAmount <= 0) throw new Error('缺少食物数量与营养单位的换算关系')
  const factor = basisAmount / normalized.basis_amount
  const perBasis = { ...normalized.nutrients_per_basis }
  for (const [key, value] of Object.entries(nutrients)) {
    if (value == null) continue
    if (!Number.isFinite(value) || value < 0) throw new Error('营养数值必须是不小于0的有效数字')
    perBasis[key] = value / factor
  }
  // The API accepts both sodium spellings. Keep them identical after edits.
  if (nutrients.sodium_mg != null) perBasis.sodiumMg = perBasis.sodium_mg
  else if (nutrients.sodiumMg != null) perBasis.sodium_mg = perBasis.sodiumMg
  return { ...normalized, nutrients_per_basis: perBasis }
}
