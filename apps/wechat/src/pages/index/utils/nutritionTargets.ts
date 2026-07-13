import { type Nutrients } from '../../../utils/api'

export type HomeMicronutrientKey = keyof Pick<Nutrients,
  'fiber' |
  'sugar' |
  'saturatedFat' |
  'cholesterolMg' |
  'sodiumMg' |
  'potassiumMg' |
  'calciumMg' |
  'ironMg' |
  'magnesiumMg' |
  'zincMg' |
  'vitaminARaeMcg' |
  'vitaminCMg' |
  'vitaminDMcg' |
  'vitaminEMg' |
  'vitaminKMcg' |
  'thiaminMg' |
  'riboflavinMg' |
  'niacinMg' |
  'vitaminB6Mg' |
  'folateMcg' |
  'vitaminB12Mcg'
>

export interface MicronutrientConfig {
  key: HomeMicronutrientKey
  targetKey: string
  label: string
  unit: string
  accent: string
  defaultTarget: number
  maxTarget: number
  step: number
}

export const MICRONUTRIENT_CONFIGS: MicronutrientConfig[] = [
  { key: 'fiber', targetKey: 'fiber_target', label: '膳食纤维', unit: 'g', accent: '#5dbb8a', defaultTarget: 25, maxTarget: 100, step: 5 },
  { key: 'sugar', targetKey: 'sugar_target', label: '糖', unit: 'g', accent: '#d8a84f', defaultTarget: 50, maxTarget: 200, step: 5 },
  { key: 'saturatedFat', targetKey: 'saturated_fat_target', label: '饱和脂肪', unit: 'g', accent: '#ef9a6b', defaultTarget: 20, maxTarget: 100, step: 5 },
  { key: 'cholesterolMg', targetKey: 'cholesterol_mg_target', label: '胆固醇', unit: 'mg', accent: '#9b8bd9', defaultTarget: 300, maxTarget: 1000, step: 50 },
  { key: 'sodiumMg', targetKey: 'sodium_mg_target', label: '钠', unit: 'mg', accent: '#ef8b73', defaultTarget: 2000, maxTarget: 6000, step: 100 },
  { key: 'potassiumMg', targetKey: 'potassium_mg_target', label: '钾', unit: 'mg', accent: '#57a99a', defaultTarget: 3500, maxTarget: 8000, step: 100 },
  { key: 'calciumMg', targetKey: 'calcium_mg_target', label: '钙', unit: 'mg', accent: '#6aa7d8', defaultTarget: 800, maxTarget: 3000, step: 50 },
  { key: 'ironMg', targetKey: 'iron_mg_target', label: '铁', unit: 'mg', accent: '#d88d5a', defaultTarget: 12, maxTarget: 80, step: 1 },
  { key: 'magnesiumMg', targetKey: 'magnesium_mg_target', label: '镁', unit: 'mg', accent: '#60a5a8', defaultTarget: 330, maxTarget: 1000, step: 20 },
  { key: 'zincMg', targetKey: 'zinc_mg_target', label: '锌', unit: 'mg', accent: '#7ca4d8', defaultTarget: 10, maxTarget: 80, step: 1 },
  { key: 'vitaminARaeMcg', targetKey: 'vitamin_a_rae_mcg_target', label: '维A', unit: 'mcg', accent: '#e0a14a', defaultTarget: 800, maxTarget: 3000, step: 50 },
  { key: 'vitaminCMg', targetKey: 'vitamin_c_mg_target', label: '维C', unit: 'mg', accent: '#71c16f', defaultTarget: 100, maxTarget: 2000, step: 10 },
  { key: 'vitaminDMcg', targetKey: 'vitamin_d_mcg_target', label: '维D', unit: 'mcg', accent: '#8a7be0', defaultTarget: 15, maxTarget: 100, step: 1 },
  { key: 'vitaminEMg', targetKey: 'vitamin_e_mg_target', label: '维E', unit: 'mg', accent: '#c49a52', defaultTarget: 14, maxTarget: 1000, step: 1 },
  { key: 'vitaminKMcg', targetKey: 'vitamin_k_mcg_target', label: '维K', unit: 'mcg', accent: '#5aa782', defaultTarget: 90, maxTarget: 1000, step: 10 },
  { key: 'thiaminMg', targetKey: 'thiamin_mg_target', label: '维B1', unit: 'mg', accent: '#6b9bd6', defaultTarget: 1.2, maxTarget: 20, step: 0.1 },
  { key: 'riboflavinMg', targetKey: 'riboflavin_mg_target', label: '维B2', unit: 'mg', accent: '#6c8fd8', defaultTarget: 1.3, maxTarget: 20, step: 0.1 },
  { key: 'niacinMg', targetKey: 'niacin_mg_target', label: '烟酸', unit: 'mg', accent: '#9f86d8', defaultTarget: 14, maxTarget: 100, step: 1 },
  { key: 'vitaminB6Mg', targetKey: 'vitamin_b6_mg_target', label: '维B6', unit: 'mg', accent: '#7e8ce0', defaultTarget: 1.5, maxTarget: 50, step: 0.1 },
  { key: 'folateMcg', targetKey: 'folate_mcg_target', label: '叶酸', unit: 'mcg', accent: '#d9789f', defaultTarget: 400, maxTarget: 2000, step: 50 },
  { key: 'vitaminB12Mcg', targetKey: 'vitamin_b12_mcg_target', label: '维B12', unit: 'mcg', accent: '#d07070', defaultTarget: 2.4, maxTarget: 100, step: 0.1 },
]

export function normalizeTargetNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.round((parsed + Number.EPSILON) * 10) / 10
}

export function getDefaultMicronutrientTargets(): Record<string, number> {
  return MICRONUTRIENT_CONFIGS.reduce<Record<string, number>>((acc, item) => {
    acc[item.targetKey] = item.defaultTarget
    return acc
  }, {})
}
