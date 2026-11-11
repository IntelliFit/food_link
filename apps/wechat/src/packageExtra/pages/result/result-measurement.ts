import type { FoodItem, Nutrients } from '../../../utils/api'
import {
  convertFoodAmount,
  foodMeasurementGrams,
  foodMeasurementPer100g,
  formatFoodMeasurementAmount,
  normalizeFoodMeasurement,
  scaleFoodMeasurementNutrients,
  type FoodMeasurement,
} from '../../../utils/food-measure'
import type { NutritionItem } from './result-item-converter'

const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
const text = (candidate: Record<string, unknown>, ...keys: string[]) => keys.map(key => String(candidate[key] || '').trim()).find(Boolean) || ''

export function packagedCandidateMeasurement(candidate: Record<string, unknown>): FoodMeasurement | null {
  const basis = text(candidate, 'nutrition_basis_unit', 'nutritionBasisUnit').toLowerCase().replace(/\s/g, '')
  if (basis !== '100g' && basis !== '100ml') return null
  const unit = basis === '100ml' ? 'ml' : 'g'
  const contentUnit = text(candidate, 'net_content_unit', 'netContentUnit').toLowerCase()
  const amount = contentUnit === unit
    ? numeric(candidate.net_content_value ?? candidate.netContentValue)
    : unit === 'g' ? numeric(candidate.net_weight_g ?? candidate.netWeightG) : 0
  if (amount <= 0) return null
  const raw = candidate.unit_nutrition_per_100g ?? candidate.unitNutritionPer100g
  const nutrients = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, numeric(value)]))
    : {
      calories: numeric(candidate.kcal_per_100g), protein: numeric(candidate.protein_per_100g),
      carbs: numeric(candidate.carbs_per_100g), fat: numeric(candidate.fat_per_100g),
    }
  return normalizeFoodMeasurement({ amount, unit, basis_amount: 100, basis_unit: unit, nutrients_per_basis: nutrients })
}

export function matchingPackagedCandidate(item: FoodItem): Record<string, unknown> | undefined {
  const id = item.packaged_food_id ?? item.packagedFoodId
  if (!id) return undefined
  return (item.packaged_candidates ?? item.packagedCandidates)?.find(candidate => text(candidate, 'packaged_food_id', 'id') === id)
}

export function analyzeItemMeasurement(item: FoodItem): FoodMeasurement | null {
  const declared = normalizeFoodMeasurement(item.measurement)
  if (declared) return declared
  const applied = item.package_weight_applied ?? item.packageWeightApplied
  const source = item.package_weight_source ?? item.packageWeightSource
  if (applied !== true || source !== 'packaged_food_library') return null
  const candidate = matchingPackagedCandidate(item)
  return candidate ? packagedCandidateMeasurement(candidate) : null
}

export function withResultMeasurement(item: NutritionItem, measurement = normalizeFoodMeasurement(item.measurement)): NutritionItem {
  if (!measurement) return item
  const totals = scaleFoodMeasurementNutrients(measurement)
  if (!totals) return item
  const grams = foodMeasurementGrams(measurement) ?? 0
  const per100g = foodMeasurementPer100g(measurement)
  const waterMl = numeric(totals.waterMl ?? totals.water_ml ?? item.waterMl)
  const sodium = numeric(totals.sodium_mg ?? totals.sodiumMg)
  const nutrients: Nutrients = {
    ...totals,
    calories: numeric(totals.calories), protein: numeric(totals.protein), carbs: numeric(totals.carbs), fat: numeric(totals.fat),
    fiber: numeric(totals.fiber), sugar: numeric(totals.sugar), sodium_mg: sodium, sodiumMg: sodium, waterMl, water_ml: waterMl,
  }
  return {
    ...item, measurement, nutrients, calorie: nutrients.calories, protein: nutrients.protein, carbs: nutrients.carbs, fat: nutrients.fat,
    waterMl, weight: grams, grossWeight: grams, originalWeight: grams, ediblePortionRatio: 100,
    intake: grams * item.ratio / 100,
    displayWeight: formatFoodMeasurementAmount(measurement.amount, measurement.unit),
    manual_portion_label: formatFoodMeasurementAmount(measurement.amount, measurement.unit),
    unitNutritionPer100g: per100g ? { ...per100g, calories: numeric(per100g.calories), protein: numeric(per100g.protein), carbs: numeric(per100g.carbs), fat: numeric(per100g.fat), fiber: numeric(per100g.fiber), sugar: numeric(per100g.sugar) } : undefined,
  }
}

export function resizeResultMeasurement(item: NutritionItem, amount: number): NutritionItem {
  const measurement = normalizeFoodMeasurement(item.measurement)
  if (!measurement || !Number.isFinite(amount) || amount <= 0) return item
  return withResultMeasurement(item, { ...measurement, amount })
}

export function rewriteResultMeasurementNutrients(item: NutritionItem, nutrients: Nutrients): NutritionItem {
  const measurement = normalizeFoodMeasurement(item.measurement)
  if (!measurement) return item
  const quantity = convertFoodAmount(measurement, measurement.amount, measurement.unit, measurement.basis_unit)
  if (!quantity || quantity <= 0) return item
  const factor = measurement.basis_amount / quantity
  const nutrientsPerBasis = { ...measurement.nutrients_per_basis }
  for (const [key, value] of Object.entries(nutrients)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) nutrientsPerBasis[key] = value * factor
  }
  return withResultMeasurement(item, { ...measurement, nutrients_per_basis: nutrientsPerBasis })
}

export function resultMeasurementAmountText(item: NutritionItem, intake = false): string {
  return item.measurement
    ? formatFoodMeasurementAmount(item.measurement.amount * (intake ? item.ratio / 100 : 1), item.measurement.unit)
    : `${Math.max(0, Math.round(intake ? item.intake : item.weight))}g`
}

export function resultMeasurementStep(item: NutritionItem): number {
  return item.measurement?.unit === 'piece' || item.measurement?.unit === 'serving' ? 0.5 : 10
}
