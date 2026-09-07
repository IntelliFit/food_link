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

export type MicroTargetKey =
  | 'fiberTarget'
  | 'sugarTarget'
  | 'saturatedFatTarget'
  | 'cholesterolMgTarget'
  | 'sodiumMgTarget'
  | 'potassiumMgTarget'
  | 'calciumMgTarget'
  | 'ironMgTarget'
  | 'magnesiumMgTarget'
  | 'zincMgTarget'
  | 'vitaminARaeMcgTarget'
  | 'vitaminCMgTarget'
  | 'vitaminDMcgTarget'
  | 'vitaminEMgTarget'
  | 'vitaminKMcgTarget'
  | 'thiaminMgTarget'
  | 'riboflavinMgTarget'
  | 'niacinMgTarget'
  | 'vitaminB6MgTarget'
  | 'folateMcgTarget'
  | 'vitaminB12McgTarget'

export const MICRONUTRIENT_PREFERENCE_CONFIGS: ReadonlyArray<{
  nutrientKey: HomeMicronutrientKey
  targetFormKey: MicroTargetKey
  label: string
  unit: string
  accent: string
  step: number
}> = [
  { nutrientKey: 'fiber', targetFormKey: 'fiberTarget', label: '膳食纤维', unit: 'g', accent: '#5dbb8a', step: 1 },
  { nutrientKey: 'sugar', targetFormKey: 'sugarTarget', label: '糖', unit: 'g', accent: '#e88cb8', step: 1 },
  { nutrientKey: 'saturatedFat', targetFormKey: 'saturatedFatTarget', label: '饱和脂肪', unit: 'g', accent: '#d4a373', step: 1 },
  { nutrientKey: 'cholesterolMg', targetFormKey: 'cholesterolMgTarget', label: '胆固醇', unit: 'mg', accent: '#bc8f8f', step: 50 },
  { nutrientKey: 'sodiumMg', targetFormKey: 'sodiumMgTarget', label: '钠', unit: 'mg', accent: '#ef8b73', step: 50 },
  { nutrientKey: 'potassiumMg', targetFormKey: 'potassiumMgTarget', label: '钾', unit: 'mg', accent: '#57a99a', step: 50 },
  { nutrientKey: 'calciumMg', targetFormKey: 'calciumMgTarget', label: '钙', unit: 'mg', accent: '#6aa7d8', step: 50 },
  { nutrientKey: 'ironMg', targetFormKey: 'ironMgTarget', label: '铁', unit: 'mg', accent: '#d88d5a', step: 1 },
  { nutrientKey: 'magnesiumMg', targetFormKey: 'magnesiumMgTarget', label: '镁', unit: 'mg', accent: '#7eb8da', step: 50 },
  { nutrientKey: 'zincMg', targetFormKey: 'zincMgTarget', label: '锌', unit: 'mg', accent: '#a8a4ce', step: 1 },
  { nutrientKey: 'vitaminARaeMcg', targetFormKey: 'vitaminARaeMcgTarget', label: '维A', unit: 'mcg', accent: '#e0a14a', step: 10 },
  { nutrientKey: 'vitaminCMg', targetFormKey: 'vitaminCMgTarget', label: '维C', unit: 'mg', accent: '#71c16f', step: 10 },
  { nutrientKey: 'vitaminDMcg', targetFormKey: 'vitaminDMcgTarget', label: '维D', unit: 'mcg', accent: '#8a7be0', step: 1 },
  { nutrientKey: 'vitaminEMg', targetFormKey: 'vitaminEMgTarget', label: '维E', unit: 'mg', accent: '#c0a46e', step: 5 },
  { nutrientKey: 'vitaminKMcg', targetFormKey: 'vitaminKMcgTarget', label: '维K', unit: 'mcg', accent: '#8fbc8f', step: 10 },
  { nutrientKey: 'thiaminMg', targetFormKey: 'thiaminMgTarget', label: '维B1', unit: 'mg', accent: '#d4a5a5', step: 0.1 },
  { nutrientKey: 'riboflavinMg', targetFormKey: 'riboflavinMgTarget', label: '维B2', unit: 'mg', accent: '#9fb4cc', step: 0.1 },
  { nutrientKey: 'niacinMg', targetFormKey: 'niacinMgTarget', label: '烟酸', unit: 'mg', accent: '#b8a9c9', step: 1 },
  { nutrientKey: 'vitaminB6Mg', targetFormKey: 'vitaminB6MgTarget', label: '维B6', unit: 'mg', accent: '#a3c4a3', step: 0.1 },
  { nutrientKey: 'folateMcg', targetFormKey: 'folateMcgTarget', label: '叶酸', unit: 'mcg', accent: '#d8b4a0', step: 50 },
  { nutrientKey: 'vitaminB12Mcg', targetFormKey: 'vitaminB12McgTarget', label: '维B12', unit: 'mcg', accent: '#9ecae1', step: 0.1 },
]

export const ALL_HOME_MICRONUTRIENT_KEYS = MICRONUTRIENT_PREFERENCE_CONFIGS.map(
  (config) => config.nutrientKey
)

const HOME_MICRONUTRIENT_KEY_SET = new Set<string>(ALL_HOME_MICRONUTRIENT_KEYS)
const HOME_MICRONUTRIENT_HIDDEN_STORAGE_PREFIX = 'home_hidden_micronutrients_v1'

export function getMicronutrientPreferenceStorageKey(userId: unknown): string {
  const normalizedUserId = String(userId || '').trim()
  return `${HOME_MICRONUTRIENT_HIDDEN_STORAGE_PREFIX}:${normalizedUserId || 'guest'}`
}

export function normalizeHiddenMicronutrientKeys(raw: unknown): HomeMicronutrientKey[] {
  let candidate = raw
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return []
    }
  }
  if (!Array.isArray(candidate)) return []

  const requested = new Set(
    candidate.filter((value): value is string => typeof value === 'string' && HOME_MICRONUTRIENT_KEY_SET.has(value))
  )
  return ALL_HOME_MICRONUTRIENT_KEYS.filter((key) => requested.has(key))
}

export function getVisibleMicronutrientKeys(hiddenKeys: readonly HomeMicronutrientKey[]): HomeMicronutrientKey[] {
  const hidden = new Set(hiddenKeys)
  return ALL_HOME_MICRONUTRIENT_KEYS.filter((key) => !hidden.has(key))
}
