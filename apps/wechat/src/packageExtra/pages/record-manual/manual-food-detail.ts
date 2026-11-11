import type { ManualFoodSearchResult } from '../../../utils/api'
import { normalizeFoodMeasurement, scaleFoodMeasurementNutrients, type FoodMeasureUnit } from '../../../utils/food-measure'

export const manualFoodSourceName = (item: ManualFoodSearchResult) => item.source_label || ({
  public_library: '真实餐食',
  nutrition_library: '标准食物',
  packaged_food: '包装食品',
  custom: '自定义',
}[item.source])

export function formatFoodDetailNumber(value: unknown) {
  const number = Number(value)
  return value == null || !Number.isFinite(number) || number < 0 ? '—' : String(Math.round(number * 100) / 100)
}

/** 包装库字段沿用 per100g 命名，只有保留的原始口径能确定它实际指克还是毫升。 */
export function manualFoodNutritionBasis(item: ManualFoodSearchResult): FoodMeasureUnit | null {
  if (item.measurement) return normalizeFoodMeasurement(item.measurement)?.basis_unit || null
  if (!item.nutrients_per_100g) return null
  if (item.source === 'custom' || item.source === 'nutrition_library') return 'g'
  if (item.source === 'packaged_food') {
    const basis = item.subtitle.match(/营养口径\s*100\s*(ml|g)(?![a-z])/i)?.[1]?.toLowerCase()
    return basis === 'g' || basis === 'ml' ? basis : null
  }
  return null
}

const MICRO_FIELDS = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg' },
  { key: 'sodium_mg', alias: 'sodiumMg', label: '钠', unit: 'mg' },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素 A', unit: 'μg' },
  { key: 'vitaminCMg', label: '维生素 C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素 D', unit: 'μg' },
  { key: 'vitaminEMg', label: '维生素 E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素 K', unit: 'μg' },
  { key: 'thiaminMg', label: '维生素 B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素 B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'μg' },
  { key: 'vitaminB12Mcg', label: '维生素 B12', unit: 'μg' },
]

export function manualFoodDetailNutrition(item: ManualFoodSearchResult, perHundred = false) {
  const measurement = normalizeFoodMeasurement(item.measurement)
  const basis = manualFoodNutritionBasis(item)
  const usePerHundred = perHundred && basis != null
  const perHundredValues = item.nutrients_per_100g
  const totals = { calories: item.total_calories, protein: item.total_protein, carbs: item.total_carbs, fat: item.total_fat }
  const measuredValues = measurement
    ? (perHundred ? measurement.nutrients_per_basis : scaleFoodMeasurementNutrients(measurement))
    : null
  const macros = measuredValues || (usePerHundred ? perHundredValues! : totals)
  const macroRows = [
    { key: 'calories', label: '热量', unit: 'kcal' },
    { key: 'protein', label: '蛋白质', unit: 'g' },
    { key: 'carbs', label: '碳水', unit: 'g' },
    { key: 'fat', label: '脂肪', unit: 'g' },
  ].map((field) => ({ ...field, value: formatFoodDetailNumber(macros[field.key]) }))

  // 不把自定义条目的每100g微量值当成默认份量值，也不在克/毫升口径不明时自行换算。
  const canScale = basis === 'ml' ? item.display_unit === 'ml' : basis === 'g' && item.display_unit !== 'ml'
  const microValues = (measuredValues || (usePerHundred || canScale ? perHundredValues : basis ? undefined : item.extra_nutrients)) as Record<string, number> | undefined
  const scale = measurement ? 1 : !usePerHundred && canScale ? item.default_weight_grams / 100 : 1
  const microRows = MICRO_FIELDS.flatMap((field) => {
    const raw = microValues?.[field.key] ?? (field.alias ? microValues?.[field.alias] : undefined)
    const value = Number(raw) * scale
    return raw != null && Number.isFinite(value) && value > 0
      ? [{ ...field, value: formatFoodDetailNumber(value) }]
      : []
  })
  return { macroRows, microRows }
}
