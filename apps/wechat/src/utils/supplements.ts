import {
  type PackagedNutritionLabelRecognition,
  type SupplementCatalogItem,
  type SupplementComponent,
  type SupplementComponentCategory,
} from './api'

export const SUPPLEMENT_CATALOG_SELECTION_KEY = 'supplementCatalogSelectionV1'

export function cloneCatalogComponents(item: SupplementCatalogItem): SupplementComponent[] {
  return (item.components || []).map((component) => ({ ...component }))
}

export const SUPPLEMENT_NUTRIENT_OPTIONS = [
  { key: 'fiber', label: '膳食纤维', unit: 'g', ocr: 'fiber_per_100g' },
  { key: 'sugar', label: '糖', unit: 'g', ocr: 'sugar_per_100g' },
  { key: 'saturatedFat', label: '饱和脂肪', unit: 'g', ocr: 'saturated_fat_per_100g' },
  { key: 'cholesterolMg', label: '胆固醇', unit: 'mg', ocr: 'cholesterol_mg_per_100g' },
  { key: 'sodiumMg', label: '钠', unit: 'mg', ocr: 'sodium_mg_per_100g' },
  { key: 'potassiumMg', label: '钾', unit: 'mg', ocr: 'potassium_mg_per_100g' },
  { key: 'calciumMg', label: '钙', unit: 'mg', ocr: 'calcium_mg_per_100g' },
  { key: 'ironMg', label: '铁', unit: 'mg', ocr: 'iron_mg_per_100g' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg', ocr: 'magnesium_mg_per_100g' },
  { key: 'zincMg', label: '锌', unit: 'mg', ocr: 'zinc_mg_per_100g' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg', ocr: 'vitamin_a_rae_mcg_per_100g' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg', ocr: 'vitamin_c_mg_per_100g' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg', ocr: 'vitamin_d_mcg_per_100g' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg', ocr: 'vitamin_e_mg_per_100g' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg', ocr: 'vitamin_k_mcg_per_100g' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg', ocr: 'thiamin_mg_per_100g' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg', ocr: 'riboflavin_mg_per_100g' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg', ocr: 'niacin_mg_per_100g' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg', ocr: 'vitamin_b6_mg_per_100g' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg', ocr: 'folate_mcg_per_100g' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg', ocr: 'vitamin_b12_mcg_per_100g' },
] as const

export function normalizeSupplementCode(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\-/]+/g, '_')
}

export function createEmptySupplementComponent(category: SupplementComponentCategory = 'nutrient'): SupplementComponent {
  return { code: '', name: '', category, amount: 0, unit: category === 'nutrient' ? 'mg' : 'mg' }
}

export function componentsFromNutritionLabel(label: PackagedNutritionLabelRecognition): SupplementComponent[] {
  const servingWeight = Number(label.serving_weight_g)
  const multiplier = Number.isFinite(servingWeight) && servingWeight > 0 ? servingWeight / 100 : 1
  return SUPPLEMENT_NUTRIENT_OPTIONS.flatMap((item) => {
    const raw = Number(label[item.ocr])
    if (!Number.isFinite(raw) || raw <= 0) return []
    return [{
      code: normalizeSupplementCode(item.key),
      name: item.label,
      category: 'nutrient' as const,
      amount: Math.round(raw * multiplier * 1000) / 1000,
      unit: item.unit,
      nutrient_key: item.key,
    }]
  })
}

export function supplementOcrBasisText(label: PackagedNutritionLabelRecognition): string {
  const servingWeight = Number(label.serving_weight_g)
  if (Number.isFinite(servingWeight) && servingWeight > 0) {
    return `已按每份 ${servingWeight}g 从每100g换算，请核对瓶身标签`
  }
  return '未识别到每份重量，暂按标签数值填入；保存前请逐项确认'
}
