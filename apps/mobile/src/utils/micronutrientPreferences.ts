import AsyncStorage from '@react-native-async-storage/async-storage'

export type HomeMicronutrientKey =
  | 'fiber'
  | 'sugar'
  | 'saturatedFat'
  | 'cholesterolMg'
  | 'sodiumMg'
  | 'potassiumMg'
  | 'calciumMg'
  | 'ironMg'
  | 'magnesiumMg'
  | 'zincMg'
  | 'vitaminARaeMcg'
  | 'vitaminCMg'
  | 'vitaminDMcg'
  | 'vitaminEMg'
  | 'vitaminKMcg'
  | 'thiaminMg'
  | 'riboflavinMg'
  | 'niacinMg'
  | 'vitaminB6Mg'
  | 'folateMcg'
  | 'vitaminB12Mcg'

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

export type MicronutrientPreferenceConfig = {
  nutrientKey: HomeMicronutrientKey
  targetFormKey: MicroTargetKey
  apiTargetKey: string
  label: string
  unit: string
  accent: string
  step: number
  defaultTarget: number
}

export const MICRONUTRIENT_PREFERENCE_CONFIGS: readonly MicronutrientPreferenceConfig[] = [
  { nutrientKey: 'fiber', targetFormKey: 'fiberTarget', apiTargetKey: 'fiber_target', label: '膳食纤维', unit: 'g', accent: '#5dbb8a', step: 1, defaultTarget: 25 },
  { nutrientKey: 'sugar', targetFormKey: 'sugarTarget', apiTargetKey: 'sugar_target', label: '糖', unit: 'g', accent: '#e88cb8', step: 1, defaultTarget: 50 },
  { nutrientKey: 'saturatedFat', targetFormKey: 'saturatedFatTarget', apiTargetKey: 'saturated_fat_target', label: '饱和脂肪', unit: 'g', accent: '#d4a373', step: 1, defaultTarget: 20 },
  { nutrientKey: 'cholesterolMg', targetFormKey: 'cholesterolMgTarget', apiTargetKey: 'cholesterol_mg_target', label: '胆固醇', unit: 'mg', accent: '#bc8f8f', step: 50, defaultTarget: 300 },
  { nutrientKey: 'sodiumMg', targetFormKey: 'sodiumMgTarget', apiTargetKey: 'sodium_mg_target', label: '钠', unit: 'mg', accent: '#ef8b73', step: 50, defaultTarget: 2000 },
  { nutrientKey: 'potassiumMg', targetFormKey: 'potassiumMgTarget', apiTargetKey: 'potassium_mg_target', label: '钾', unit: 'mg', accent: '#57a99a', step: 50, defaultTarget: 3500 },
  { nutrientKey: 'calciumMg', targetFormKey: 'calciumMgTarget', apiTargetKey: 'calcium_mg_target', label: '钙', unit: 'mg', accent: '#6aa7d8', step: 50, defaultTarget: 800 },
  { nutrientKey: 'ironMg', targetFormKey: 'ironMgTarget', apiTargetKey: 'iron_mg_target', label: '铁', unit: 'mg', accent: '#d88d5a', step: 1, defaultTarget: 12 },
  { nutrientKey: 'magnesiumMg', targetFormKey: 'magnesiumMgTarget', apiTargetKey: 'magnesium_mg_target', label: '镁', unit: 'mg', accent: '#7eb8da', step: 50, defaultTarget: 330 },
  { nutrientKey: 'zincMg', targetFormKey: 'zincMgTarget', apiTargetKey: 'zinc_mg_target', label: '锌', unit: 'mg', accent: '#a8a4ce', step: 1, defaultTarget: 12.5 },
  { nutrientKey: 'vitaminARaeMcg', targetFormKey: 'vitaminARaeMcgTarget', apiTargetKey: 'vitamin_a_rae_mcg_target', label: '维A', unit: 'mcg', accent: '#e0a14a', step: 10, defaultTarget: 700 },
  { nutrientKey: 'vitaminCMg', targetFormKey: 'vitaminCMgTarget', apiTargetKey: 'vitamin_c_mg_target', label: '维C', unit: 'mg', accent: '#71c16f', step: 10, defaultTarget: 100 },
  { nutrientKey: 'vitaminDMcg', targetFormKey: 'vitaminDMcgTarget', apiTargetKey: 'vitamin_d_mcg_target', label: '维D', unit: 'mcg', accent: '#8a7be0', step: 1, defaultTarget: 10 },
  { nutrientKey: 'vitaminEMg', targetFormKey: 'vitaminEMgTarget', apiTargetKey: 'vitamin_e_mg_target', label: '维E', unit: 'mg', accent: '#c0a46e', step: 5, defaultTarget: 14 },
  { nutrientKey: 'vitaminKMcg', targetFormKey: 'vitaminKMcgTarget', apiTargetKey: 'vitamin_k_mcg_target', label: '维K', unit: 'mcg', accent: '#8fbc8f', step: 10, defaultTarget: 80 },
  { nutrientKey: 'thiaminMg', targetFormKey: 'thiaminMgTarget', apiTargetKey: 'thiamin_mg_target', label: '维B1', unit: 'mg', accent: '#d4a5a5', step: 0.1, defaultTarget: 1.4 },
  { nutrientKey: 'riboflavinMg', targetFormKey: 'riboflavinMgTarget', apiTargetKey: 'riboflavin_mg_target', label: '维B2', unit: 'mg', accent: '#9fb4cc', step: 0.1, defaultTarget: 1.4 },
  { nutrientKey: 'niacinMg', targetFormKey: 'niacinMgTarget', apiTargetKey: 'niacin_mg_target', label: '烟酸', unit: 'mg', accent: '#b8a9c9', step: 1, defaultTarget: 15 },
  { nutrientKey: 'vitaminB6Mg', targetFormKey: 'vitaminB6MgTarget', apiTargetKey: 'vitamin_b6_mg_target', label: '维B6', unit: 'mg', accent: '#a3c4a3', step: 0.1, defaultTarget: 1.4 },
  { nutrientKey: 'folateMcg', targetFormKey: 'folateMcgTarget', apiTargetKey: 'folate_mcg_target', label: '叶酸', unit: 'mcg', accent: '#d8b4a0', step: 50, defaultTarget: 400 },
  { nutrientKey: 'vitaminB12Mcg', targetFormKey: 'vitaminB12McgTarget', apiTargetKey: 'vitamin_b12_mcg_target', label: '维B12', unit: 'mcg', accent: '#9ecae1', step: 0.1, defaultTarget: 2.4 },
]

export const ALL_HOME_MICRONUTRIENT_KEYS = MICRONUTRIENT_PREFERENCE_CONFIGS.map((item) => item.nutrientKey)
const keySet = new Set<string>(ALL_HOME_MICRONUTRIENT_KEYS)
const storagePrefix = 'home_hidden_micronutrients_v1'

export function normalizeHiddenMicronutrientKeys(raw: unknown): HomeMicronutrientKey[] {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  const requested = new Set(value.filter((item): item is string => typeof item === 'string' && keySet.has(item)))
  return ALL_HOME_MICRONUTRIENT_KEYS.filter((key) => requested.has(key))
}

function storageKey(userId?: string | null) {
  return `${storagePrefix}:${String(userId || '').trim() || 'guest'}`
}

export async function getHiddenMicronutrientKeys(userId?: string | null): Promise<HomeMicronutrientKey[]> {
  return normalizeHiddenMicronutrientKeys(await AsyncStorage.getItem(storageKey(userId)).catch(() => null))
}

export async function saveHiddenMicronutrientKeys(userId: string | null | undefined, keys: readonly HomeMicronutrientKey[]) {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(normalizeHiddenMicronutrientKeys(keys))).catch(() => undefined)
}
