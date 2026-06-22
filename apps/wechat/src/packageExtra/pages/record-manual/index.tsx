import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAccessToken,
  getHealthProfile,
  imageToBase64,
  saveFoodRecord,
  fetchManualFoodCatalog,
  fetchManualCustomFoods,
  searchManualFood,
  saveManualCustomFood,
  showUnifiedApiError,
  uploadAnalyzeImage,
  type CanonicalMealType,
  type FoodRecordEntryType,
  type ManualFoodCatalogCategory,
  type ManualFoodCatalogResult,
  type ManualFoodSearchResult,
  type Nutrients,
} from '../../../utils/api'
import {
  collectFoodDisplayImageUrls,
  hasFoodDisplayImage,
  pickFoodDisplayImageUrl,
} from '../../../utils/food-display-image'
import { withAuth } from '../../../utils/withAuth'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { addWaterToBodyMetricsStorage, calculateFoodRecordItemsWaterMl, refreshHomeDashboardLocalSnapshotFromCloud } from '../../../utils/home-dashboard-local-cache'
import {
  getRecommendedMealTypeWithFallback,
  inferDefaultMealTypeFromLocalTime,
} from '../../../utils/infer-default-meal-type'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getStoredRecordTargetDate, persistRecordTargetDate } from '../../../utils/record-date'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
import { chooseImageWithPrivacy, isPrivacyAuthorizeError, showPrivacyAuthorizeFailure } from '../../../utils/weapp-privacy'
import './index.scss'

const MEALS: Array<{ id: CanonicalMealType; name: string; icon: string }> = [
  { id: 'breakfast', name: '早餐', icon: 'icon-zaocan' },
  { id: 'morning_snack', name: '早加餐', icon: 'icon-lingshi' },
  { id: 'lunch', name: '午餐', icon: 'icon-wucan' },
  { id: 'afternoon_snack', name: '午加餐', icon: 'icon-lingshi' },
  { id: 'dinner', name: '晚餐', icon: 'icon-wancan' },
  { id: 'evening_snack', name: '晚加餐', icon: 'icon-lingshi' },
]

const DIET_GOALS = [
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无' },
]

const ACTIVITY_TIMINGS = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' },
]

const DEFAULT_CATALOG_CATEGORIES: ManualFoodCatalogCategory[] = [
  { key: 'common', label: '常见' },
  { key: 'campus', label: '校园食堂' },
  { key: 'custom', label: '自定义' },
  { key: 'recent', label: '最近' },
  { key: 'favorites', label: '收藏' },
  { key: 'staple', label: '主食' },
  { key: 'protein', label: '肉蛋奶' },
  { key: 'vegetable', label: '蔬菜' },
  { key: 'fruit', label: '水果' },
  { key: 'dairy', label: '乳品' },
  { key: 'beverage', label: '饮品' },
  { key: 'soup', label: '汤饮' },
  { key: 'snack', label: '零食' },
  { key: 'meal', label: '菜肴' },
  { key: 'other', label: '其他' },
]

type ManualDisplayUnit = 'g' | 'ml' | 'serving' | 'piece'
type ManualFoodSource = 'public_library' | 'nutrition_library' | 'packaged_food' | 'custom'
type CustomEnergyUnit = 'kcal' | 'kj'

const KJ_PER_KCAL = 4.184
const CUSTOM_FOOD_STORAGE_LIMIT = 120
const CUSTOM_FOOD_STORAGE_PREFIX = 'record_manual_custom_foods_v1'

interface ServingPreset {
  label: string
  grams: number
  quantity: number
}

interface SelectedItem {
  id: string
  source: ManualFoodSource
  title: string
  subtitle: string
  weight: number
  weightInput: string
  defaultWeight: number
  portionLabel: string
  baseNutrients: Nutrients
  nutrients: Nutrients
  nutrientsPer100g?: Nutrients
  displayUnit: ManualDisplayUnit
  displayUnitLabel: string
  servingPresets: ServingPreset[]
  imagePath?: string | null
  recommendReason?: string
  usageCount: number
  collected: boolean
}

type NutrientKey = keyof Nutrients

interface CustomMicroField {
  key: NutrientKey
  label: string
  unit: string
}

const NUTRIENT_SCALE_KEYS: NutrientKey[] = [
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

const CUSTOM_MICRO_FIELDS: CustomMicroField[] = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'sodium_mg', label: '钠', unit: 'mg' },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'μg RAE' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'μg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'μg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸B3', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'μg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'μg' },
]

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getItemKey(item: { source: string; id: string }) {
  return `${item.source}:${item.id}`
}

function roundToPrecision(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function roundToSingle(value: number) {
  return roundToPrecision(value, 1)
}

function roundWeightGrams(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(0.01, roundToPrecision(value, 2))
}

function positiveWeightGrams(value: unknown, fallback: number) {
  const parsed = Number(value)
  const candidate = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  const rounded = roundWeightGrams(candidate)
  return rounded > 0 ? rounded : fallback
}

function formatCompactNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return '0'
  const rounded = roundToPrecision(value, digits)
  return String(rounded)
}

function formatWeightGrams(value: number) {
  return formatCompactNumber(value, 2)
}

function nutrientNumber(nutrients: Partial<Nutrients> | undefined, key: NutrientKey) {
  const value = nutrients?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function scaledNutrients(source: Partial<Nutrients>, scale: number): Nutrients {
  const result = {} as Nutrients
  NUTRIENT_SCALE_KEYS.forEach((key) => {
    result[key] = roundToSingle(nutrientNumber(source, key) * scale) as never
  })
  if (!result.sodium_mg && result.sodiumMg) {
    result.sodium_mg = result.sodiumMg
  }
  if (!result.sodiumMg && result.sodium_mg) {
    result.sodiumMg = result.sodium_mg
  }
  return result
}

function parseOptionalNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? roundToSingle(parsed) : 0
}

function energyToKcal(value: number, unit: CustomEnergyUnit) {
  return unit === 'kj' ? value / KJ_PER_KCAL : value
}

function customFoodStorageKey() {
  let userId = ''
  try {
    userId = String(Taro.getStorageSync('user_id') || '').trim()
  } catch {
    userId = ''
  }
  return `${CUSTOM_FOOD_STORAGE_PREFIX}:${userId || 'anonymous'}`
}

function normalizeCustomFoodItem(item: any): ManualFoodSearchResult | null {
  if (!item || item.source !== 'custom') return null
  const title = String(item.title || '').trim()
  const id = String(item.id || '').trim()
  if (!title || !id) return null
  const defaultWeight = positiveWeightGrams(item.default_weight_grams, 100)
  const nutrientsPer100g = item.nutrients_per_100g || item.extra_nutrients || {
    calories: Number(item.total_calories || 0),
    protein: Number(item.total_protein || 0),
    carbs: Number(item.total_carbs || 0),
    fat: Number(item.total_fat || 0),
    fiber: 0,
    sugar: 0,
  }
  return {
    ...item,
    id,
    source: 'custom',
    title,
    subtitle: String(item.subtitle || `${Math.round(Number(item.total_calories || 0))} kcal / ${formatWeightGrams(defaultWeight)}g`),
    category: 'custom',
    default_weight_grams: defaultWeight,
    display_unit: 'g',
    display_unit_label: 'g',
    total_calories: Number(item.total_calories || 0),
    total_protein: Number(item.total_protein || 0),
    total_carbs: Number(item.total_carbs || 0),
    total_fat: Number(item.total_fat || 0),
    nutrients_per_100g: nutrientsPer100g,
    extra_nutrients: item.extra_nutrients || nutrientsPer100g,
    image_path: item.image_path || item.image_paths?.[0] || null,
    image_paths: item.image_paths || (item.image_path ? [item.image_path] : null),
    portion_label: item.portion_label || `${formatWeightGrams(defaultWeight)}g`,
    source_label: '自定义',
    usage_count: Number(item.usage_count || 0),
    collected: Boolean(item.collected),
  }
}

function mergeCustomFoodItems(items: ManualFoodSearchResult[]) {
  const seen = new Set<string>()
  const merged: ManualFoodSearchResult[] = []
  items.forEach((item) => {
    const normalized = normalizeCustomFoodItem(item)
    if (!normalized) return
    const key = normalized.title.trim().toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    merged.push(normalized)
  })
  return merged.slice(0, CUSTOM_FOOD_STORAGE_LIMIT)
}

function loadStoredCustomFoodItems() {
  try {
    const raw = Taro.getStorageSync(customFoodStorageKey())
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? mergeCustomFoodItems(parsed) : []
  } catch {
    return []
  }
}

function persistStoredCustomFoodItems(items: ManualFoodSearchResult[]) {
  try {
    Taro.setStorageSync(customFoodStorageKey(), mergeCustomFoodItems(items))
  } catch {
    /* ignore storage quota or serialization errors */
  }
}

function nutrientsForPayload(nutrients: Nutrients): Nutrients {
  return scaledNutrients(nutrients, 1)
}

function isEggLikeFood(title: string) {
  return /鸡蛋|水煮蛋|卤蛋|煎蛋|egg/i.test(title)
}

function isBeverageLikeFood(title: string) {
  return /咖啡|美式|拿铁|奶茶|茶饮|绿茶|红茶|乌龙茶|普洱|茉莉茶|饮料|可乐|果汁|豆浆|coffee|latte|drink/i.test(title)
}

function isSoupLikeFood(title: string) {
  return /清汤|汤|羹|soup|broth/i.test(title)
}

function servingPresets(base: number, unit: string, quantities: number[]): ServingPreset[] {
  return quantities.map((quantity) => ({
    label: `${quantity}${unit}`,
    grams: roundToSingle(base * quantity),
    quantity,
  }))
}

function inferServingProfile(item: ManualFoodSearchResult): {
  defaultWeight: number
  displayUnit: ManualDisplayUnit
  displayUnitLabel: string
  portionLabel: string
  servingPresets: ServingPreset[]
} {
  const remotePresets = (item.serving_presets || [])
    .filter((preset) => preset.grams > 0)
    .map((preset) => ({
      label: preset.label,
      grams: roundToSingle(preset.grams),
      quantity: preset.quantity,
    }))
  const remoteUnit = item.display_unit
  if (remoteUnit) {
    const defaultWeight = positiveWeightGrams(item.default_weight_grams, remotePresets[0]?.grams || 100)
    return {
      defaultWeight,
      displayUnit: remoteUnit,
      displayUnitLabel: item.display_unit_label || (remoteUnit === 'piece' ? '个' : remoteUnit === 'serving' ? '份' : remoteUnit),
      portionLabel: item.portion_label || (remoteUnit === 'serving' ? '1份' : remoteUnit === 'piece' ? '1个' : `${defaultWeight}${remoteUnit}`),
      servingPresets: remotePresets,
    }
  }

  if (item.source === 'public_library') {
    const defaultWeight = positiveWeightGrams(item.default_weight_grams, 1)
    return {
      defaultWeight,
      displayUnit: 'serving',
      displayUnitLabel: '份',
      portionLabel: item.portion_label || '1份',
      servingPresets: servingPresets(defaultWeight, '份', [0.5, 1, 1.5, 2]),
    }
  }

  if (isEggLikeFood(item.title)) {
    return {
      defaultWeight: 55,
      displayUnit: 'piece',
      displayUnitLabel: '个',
      portionLabel: '1个',
      servingPresets: [
        { label: '0.5个', grams: 27.5, quantity: 0.5 },
        { label: '1个', grams: 55, quantity: 1 },
        { label: '2个', grams: 110, quantity: 2 },
      ],
    }
  }

  if (isBeverageLikeFood(item.title) || isSoupLikeFood(item.title)) {
    const defaultWeight = isSoupLikeFood(item.title) && !isBeverageLikeFood(item.title) ? 250 : 350
    const presets = isBeverageLikeFood(item.title)
      ? [
        { label: '350ml', grams: 350, quantity: 350 },
        { label: '450ml', grams: 450, quantity: 450 },
        { label: '590ml', grams: 590, quantity: 590 },
      ]
      : [
        { label: '250ml', grams: 250, quantity: 250 },
        { label: '350ml', grams: 350, quantity: 350 },
        { label: '500ml', grams: 500, quantity: 500 },
      ]
    return {
      defaultWeight,
      displayUnit: 'ml',
      displayUnitLabel: 'ml',
      portionLabel: `${defaultWeight}ml`,
      servingPresets: presets,
    }
  }

  const defaultWeight = positiveWeightGrams(item.default_weight_grams, 100)
  return {
    defaultWeight,
    displayUnit: 'g',
    displayUnitLabel: 'g',
    portionLabel: item.portion_label || `${defaultWeight}g`,
    servingPresets: [],
  }
}

function formatSelectedAmount(item: Pick<SelectedItem, 'weight' | 'defaultWeight' | 'displayUnit' | 'displayUnitLabel'>) {
  if (item.displayUnit === 'serving') {
    return `${roundToSingle(item.weight / item.defaultWeight)}份`
  }
  if (item.displayUnit === 'piece') {
    return `${roundToSingle(item.weight / 55)}个`
  }
  return `${formatWeightGrams(item.weight)}${item.displayUnitLabel}`
}

function formatWeightInput(item: Pick<SelectedItem, 'weight' | 'defaultWeight' | 'displayUnit'>, nextWeight = item.weight) {
  if (item.displayUnit === 'serving') {
    return String(roundToSingle(nextWeight / item.defaultWeight))
  }
  if (item.displayUnit === 'piece') {
    return String(roundToSingle(nextWeight / 55))
  }
  return formatWeightGrams(nextWeight)
}

function weightFromDisplayInput(item: Pick<SelectedItem, 'defaultWeight' | 'displayUnit'>, value: number) {
  if (item.displayUnit === 'serving') {
    return item.defaultWeight * value
  }
  if (item.displayUnit === 'piece') {
    return 55 * value
  }
  return value
}

function resultPortionText(item: ManualFoodSearchResult) {
  if (item.display_unit === 'piece') return '1个'
  if (item.display_unit === 'ml') return `${formatWeightGrams(item.default_weight_grams || 350)}ml`
  if (item.display_unit === 'serving') return '1份'
  if (isEggLikeFood(item.title)) return '1个'
  if (isBeverageLikeFood(item.title) || isSoupLikeFood(item.title)) {
    const fallbackVolume = isSoupLikeFood(item.title) ? 250 : 350
    return `${formatWeightGrams(item.default_weight_grams && item.default_weight_grams !== 100 ? item.default_weight_grams : fallbackVolume)}ml`
  }
  if (item.source === 'public_library') return '1份'
  if (item.portion_label) return item.portion_label
  return item.source === 'nutrition_library' ? '100g' : '1份'
}

function buildNutrientsFromWeight(
  item: Pick<SelectedItem, 'defaultWeight' | 'baseNutrients' | 'nutrientsPer100g'>,
  weight: number
) {
  const safeWeight = Math.max(0.01, weight)
  if (item.nutrientsPer100g) {
    const scale = safeWeight / 100
    return scaledNutrients(item.nutrientsPer100g, scale)
  }

  const ratio = item.defaultWeight > 0 ? safeWeight / item.defaultWeight : 1
  return scaledNutrients(item.baseNutrients, ratio)
}

function RecordManualPage() {
  const { scheme } = useAppColorScheme()
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])
  const [selectedMeal, setSelectedMeal] = useState<CanonicalMealType>(() => inferDefaultMealTypeFromLocalTime())
  const [dietGoal, setDietGoal] = useState('none')
  const [activityTiming, setActivityTiming] = useState('none')
  const [searchText, setSearchText] = useState('')
  const [activeCategory, setActiveCategory] = useState('common')
  const [catalogData, setCatalogData] = useState<ManualFoodCatalogResult | null>(null)
  const [catalogItems, setCatalogItems] = useState<ManualFoodSearchResult[]>([])
  const [catalogPage, setCatalogPage] = useState(1)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<ManualFoodSearchResult[]>([])
  const [saving, setSaving] = useState(false)
  const [showCustomPanel, setShowCustomPanel] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customWeight, setCustomWeight] = useState('100')
  const [customNutritionBasis, setCustomNutritionBasis] = useState('100')
  const [customEnergyUnit, setCustomEnergyUnit] = useState<CustomEnergyUnit>('kj')
  const [customCalories, setCustomCalories] = useState('')
  const [customProtein, setCustomProtein] = useState('')
  const [customCarbs, setCustomCarbs] = useState('')
  const [customFat, setCustomFat] = useState('')
  const [customMicroValues, setCustomMicroValues] = useState<Record<string, string>>({})
  const [showCustomMicroPanel, setShowCustomMicroPanel] = useState(false)
  const [customImageLocalPath, setCustomImageLocalPath] = useState('')
  const [customImageUrl, setCustomImageUrl] = useState('')
  const [customImageUploading, setCustomImageUploading] = useState(false)
  const [customShareToPublic, setCustomShareToPublic] = useState(false)
  const [customItems, setCustomItems] = useState<ManualFoodSearchResult[]>([])
  const [showSelectedDrawer, setShowSelectedDrawer] = useState(false)
  const entryTypeRef = useRef<FoodRecordEntryType>('food_library')

  const normalizedQuery = searchText.trim()
  const activeCategoryRef = useRef(activeCategory)
  const catalogPageRef = useRef(catalogPage)
  const catalogHasMoreRef = useRef(catalogHasMore)
  const catalogLoadingRef = useRef(false)
  const catalogLoadingMoreRef = useRef(false)
  const normalizedQueryRef = useRef('')
  const catalogRequestSeqRef = useRef(0)

  useEffect(() => {
    activeCategoryRef.current = activeCategory
  }, [activeCategory])

  useEffect(() => {
    catalogPageRef.current = catalogPage
  }, [catalogPage])

  useEffect(() => {
    catalogHasMoreRef.current = catalogHasMore
  }, [catalogHasMore])

  useEffect(() => {
    normalizedQueryRef.current = normalizedQuery
  }, [normalizedQuery])

  useEffect(() => {
    const storedCustomItems = loadStoredCustomFoodItems()
    if (storedCustomItems.length > 0) {
      setCustomItems(storedCustomItems)
    }
    const params = Taro.getCurrentInstance().router?.params
    persistRecordTargetDate(String(params?.date || ''))
    const storedMeal = Taro.getStorageSync('analyzeMealType')
    const matchedMeal = typeof storedMeal === 'string'
      ? MEALS.find((meal) => meal.id === storedMeal)
      : undefined
    if (matchedMeal) {
      setSelectedMeal(matchedMeal.id)
    } else {
      void (async () => {
        try {
          const profile = getAccessToken() ? await getHealthProfile() : null
          const mealType = await getRecommendedMealTypeWithFallback({ profile })
          setSelectedMeal(mealType)
        } catch {
          setSelectedMeal(inferDefaultMealTypeFromLocalTime())
        }
      })()
    }
    const quickSource = String(Taro.getStorageSync('campus_quick_record_source') || '')
    if (quickSource === 'campus_canteen' || quickSource === 'public_food_library') {
      entryTypeRef.current = quickSource as FoodRecordEntryType
    } else if (params?.campus_quick) {
      entryTypeRef.current = 'public_food_library'
    } else {
      entryTypeRef.current = 'food_library'
    }
    loadCatalog('common', 1, true)
    hydrateCustomItemsFromBackend(storedCustomItems)
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  }, [scheme])

  const loadCatalog = useCallback(async (category: string, page: number = 1, replace: boolean = true) => {
    const requestSeq = ++catalogRequestSeqRef.current
    if (replace) {
      catalogLoadingRef.current = true
      setCatalogLoading(true)
    } else {
      catalogLoadingMoreRef.current = true
      setCatalogLoadingMore(true)
    }
    try {
      const data = await fetchManualFoodCatalog(category, page, 30)
      if (requestSeq !== catalogRequestSeqRef.current || category !== activeCategoryRef.current) {
        return
      }
      setCatalogData(data)
      catalogPageRef.current = data.page
      catalogHasMoreRef.current = Boolean(data.has_more)
      setCatalogPage(data.page)
      setCatalogHasMore(Boolean(data.has_more))
      setCatalogItems((prev) => replace ? data.items : [...prev, ...data.items])
    } catch (e: any) {
      if (requestSeq === catalogRequestSeqRef.current) {
        await showUnifiedApiError(e, '加载食物目录失败')
      }
    } finally {
      if (requestSeq === catalogRequestSeqRef.current) {
        catalogLoadingRef.current = false
        catalogLoadingMoreRef.current = false
        setCatalogLoading(false)
        setCatalogLoadingMore(false)
      }
    }
  }, [])

  const handleSelectCategory = (category: string) => {
    if (category === activeCategory) return
    activeCategoryRef.current = category
    setActiveCategory(category)
    setSearchText('')
    setSearchResults([])
    if (category === 'custom') return
    loadCatalog(category, 1, true)
  }

  const hydrateCustomItemsFromBackend = async (baseItems: ManualFoodSearchResult[]) => {
    if (!getAccessToken()) return
    try {
      const data = await fetchManualCustomFoods(120, 0)
      const remoteCustomItems = data.items || []
      const recentData = await fetchManualFoodCatalog('recent', 1, 60)
      const recentCustomItems = (recentData.items || []).filter((item) => item.source === 'custom')
      if (remoteCustomItems.length === 0 && recentCustomItems.length === 0) return
      setCustomItems((prev) => {
        const next = mergeCustomFoodItems([
          ...remoteCustomItems,
          ...prev,
          ...baseItems,
          ...recentCustomItems,
        ])
        persistStoredCustomFoodItems(next)
        return next
      })
    } catch {
      /* 最近记录同步失败不影响手动记录主流程 */
    }
  }

  const handleLoadMoreCatalog = useCallback(() => {
    if (
      catalogLoadingRef.current ||
      catalogLoadingMoreRef.current ||
      !catalogHasMoreRef.current ||
      normalizedQueryRef.current
    ) {
      return
    }
    loadCatalog(activeCategoryRef.current, catalogPageRef.current + 1, false)
  }, [loadCatalog])

  useEffect(() => {
    const keyword = normalizedQuery
    if (!keyword) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const results = await searchManualFood(keyword, 40)
        setSearchResults(results)
      } catch (e: any) {
        await showUnifiedApiError(e, '搜索失败')
      } finally {
        setSearchLoading(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [normalizedQuery])

  const selectedMap = useMemo(() => {
    const map = new Map<string, SelectedItem>()
    selectedItems.forEach((item) => {
      map.set(getItemKey(item), item)
    })
    return map
  }, [selectedItems])

  useEffect(() => {
    if (selectedItems.length === 0 && showSelectedDrawer) {
      setShowSelectedDrawer(false)
    }
  }, [selectedItems.length, showSelectedDrawer])

  const visibleItems = useMemo(() => {
    const items = normalizedQuery
      ? [
        ...customItems.filter((item) => item.title.includes(normalizedQuery)),
        ...searchResults,
      ]
      : activeCategory === 'custom'
        ? customItems
        : catalogItems
    const seen = new Set<string>()
    return items
      .filter((item) => {
        const key = getItemKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [activeCategory, catalogItems, customItems, normalizedQuery, searchResults])

  const statsText = useMemo(() => {
    const nutritionCount = catalogData?.stats?.nutrition_food_count || 0
    const publicCount = catalogData?.stats?.public_food_count || 0
    if (normalizedQuery) {
      return `已找到 ${visibleItems.length} 个结果`
    }
    if (activeCategory === 'custom') {
      return customItems.length > 0
        ? `${customItems.length} 个自定义食物 · 可点右侧 + 加入本餐`
        : '暂无自定义食物，先新建一个常吃的'
    }
    return `${catalogItems.length} 个常用食物 · ${nutritionCount} 个标准食物 · ${publicCount} 个真实餐食`
  }, [activeCategory, catalogData, catalogItems.length, customItems.length, normalizedQuery, visibleItems.length])

  const categories = useMemo(() => {
    const remoteCategories = catalogData?.categories?.length ? catalogData.categories : DEFAULT_CATALOG_CATEGORIES
    const withoutCustom = remoteCategories.filter((category) => category.key !== 'custom')
    return [
      withoutCustom[0] || DEFAULT_CATALOG_CATEGORIES[0],
      { key: 'custom', label: '自定义', count: customItems.length },
      ...withoutCustom.slice(1),
    ]
  }, [catalogData?.categories, customItems.length])
  const activeCategoryLabel = categories.find((item) => item.key === activeCategory)?.label || '常见'

  const openCustomPanel = () => {
    if (normalizedQuery && !customName.trim()) {
      setCustomName(normalizedQuery)
    }
    setShowCustomPanel(true)
  }

  const resetCustomDraft = () => {
    setCustomName('')
    setCustomWeight('100')
    setCustomNutritionBasis('100')
    setCustomEnergyUnit('kj')
    setCustomCalories('')
    setCustomProtein('')
    setCustomCarbs('')
    setCustomFat('')
    setCustomMicroValues({})
    setShowCustomMicroPanel(false)
    setCustomImageLocalPath('')
    setCustomImageUrl('')
    setCustomImageUploading(false)
    setCustomShareToPublic(false)
  }

  const handleCustomMicroInput = (key: NutrientKey, value: string) => {
    const cleaned = value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
    setCustomMicroValues((prev) => ({ ...prev, [key]: cleaned }))
  }

  const handleChooseCustomImage = async () => {
    if (customImageUploading) return
    try {
      setCustomImageUploading(true)
      const res = await chooseImageWithPrivacy({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      const localPath = res.tempFilePaths?.[0]
      if (!localPath) return
      setCustomImageLocalPath(localPath)
      const base64 = await imageToBase64(localPath)
      const uploadRes = await uploadAnalyzeImage(base64)
      setCustomImageUrl(uploadRes.imageUrl)
    } catch (e: any) {
      const message = String(e?.errMsg || e?.message || e || '')
      if (/cancel/i.test(message)) return
      if (isPrivacyAuthorizeError(e)) {
        showPrivacyAuthorizeFailure(e, '需要授权后才能选择图片')
        return
      }
      setCustomImageLocalPath('')
      setCustomImageUrl('')
      await showUnifiedApiError(e, '上传图片失败')
    } finally {
      setCustomImageUploading(false)
    }
  }

  const handleRemoveCustomImage = () => {
    setCustomImageLocalPath('')
    setCustomImageUrl('')
  }

  const handleAddCustomItem = async () => {
    const name = customName.trim()
    const parsedWeight = Number(customWeight)
    const parsedBasis = Number(customNutritionBasis)
    const parsedEnergy = Number(customCalories)
    if (!name) {
      Taro.showToast({ title: '请输入食物名称', icon: 'none' })
      return
    }
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      Taro.showToast({ title: '请输入本次重量', icon: 'none' })
      return
    }
    if (!Number.isFinite(parsedBasis) || parsedBasis <= 0) {
      Taro.showToast({ title: '请输入营养标示重量', icon: 'none' })
      return
    }
    if (!Number.isFinite(parsedEnergy) || parsedEnergy <= 0) {
      Taro.showToast({ title: '请输入热量', icon: 'none' })
      return
    }
    if (customImageUploading) {
      Taro.showToast({ title: '图片处理后再加入', icon: 'none' })
      return
    }

    const weight = roundWeightGrams(parsedWeight)
    const nutritionBasis = roundWeightGrams(parsedBasis)
    const labelCaloriesKcal = roundToSingle(energyToKcal(parsedEnergy, customEnergyUnit))
    const labelNutrients: Nutrients = {
      calories: labelCaloriesKcal,
      protein: roundToSingle(Number(customProtein) || 0),
      carbs: roundToSingle(Number(customCarbs) || 0),
      fat: roundToSingle(Number(customFat) || 0),
      fiber: parseOptionalNumber(customMicroValues.fiber || ''),
      sugar: parseOptionalNumber(customMicroValues.sugar || ''),
      saturatedFat: parseOptionalNumber(customMicroValues.saturatedFat || ''),
      cholesterolMg: parseOptionalNumber(customMicroValues.cholesterolMg || ''),
      sodium_mg: parseOptionalNumber(customMicroValues.sodium_mg || ''),
      sodiumMg: parseOptionalNumber(customMicroValues.sodium_mg || ''),
      potassiumMg: parseOptionalNumber(customMicroValues.potassiumMg || ''),
      calciumMg: parseOptionalNumber(customMicroValues.calciumMg || ''),
      ironMg: parseOptionalNumber(customMicroValues.ironMg || ''),
      magnesiumMg: parseOptionalNumber(customMicroValues.magnesiumMg || ''),
      zincMg: parseOptionalNumber(customMicroValues.zincMg || ''),
      vitaminARaeMcg: parseOptionalNumber(customMicroValues.vitaminARaeMcg || ''),
      vitaminCMg: parseOptionalNumber(customMicroValues.vitaminCMg || ''),
      vitaminDMcg: parseOptionalNumber(customMicroValues.vitaminDMcg || ''),
      vitaminEMg: parseOptionalNumber(customMicroValues.vitaminEMg || ''),
      vitaminKMcg: parseOptionalNumber(customMicroValues.vitaminKMcg || ''),
      thiaminMg: parseOptionalNumber(customMicroValues.thiaminMg || ''),
      riboflavinMg: parseOptionalNumber(customMicroValues.riboflavinMg || ''),
      niacinMg: parseOptionalNumber(customMicroValues.niacinMg || ''),
      vitaminB6Mg: parseOptionalNumber(customMicroValues.vitaminB6Mg || ''),
      folateMcg: parseOptionalNumber(customMicroValues.folateMcg || ''),
      vitaminB12Mcg: parseOptionalNumber(customMicroValues.vitaminB12Mcg || ''),
    }
    const nutrients = scaledNutrients(labelNutrients, weight / nutritionBasis)
    const nutrientsPer100g = scaledNutrients(labelNutrients, 100 / nutritionBasis)
    const id = `custom:${Date.now()}:${name}`
    const imagePath = customImageUrl || null
    const sourceEnergyText = customEnergyUnit === 'kj'
      ? `标示 ${roundToSingle(parsedEnergy)} kJ ≈ ${labelCaloriesKcal} kcal`
      : `标示 ${labelCaloriesKcal} kcal`
    const customResult: ManualFoodSearchResult = {
        id,
        source: 'custom',
        title: name,
        subtitle: `${Math.round(nutrients.calories)} kcal / ${formatWeightGrams(weight)}g`,
        category: 'custom',
        default_weight_grams: weight,
        display_unit: 'g',
        display_unit_label: 'g',
        total_calories: nutrients.calories,
        total_protein: nutrients.protein,
        total_carbs: nutrients.carbs,
        total_fat: nutrients.fat,
        nutrients_per_100g: nutrientsPer100g,
        extra_nutrients: nutrientsPer100g,
        image_path: imagePath,
        image_paths: imagePath ? [imagePath] : null,
        portion_label: `${formatWeightGrams(weight)}g`,
        source_label: '自定义',
        recommend_reason: `${sourceEnergyText} / 每${formatWeightGrams(nutritionBasis)}g`,
        nutrition_highlights: [sourceEnergyText],
        usage_count: 0,
        collected: false,
      }
    let savedCustomResult = customResult
    if (getAccessToken()) {
      try {
        savedCustomResult = await saveManualCustomFood({
          title: customResult.title,
          default_weight_grams: customResult.default_weight_grams,
          total_calories: customResult.total_calories,
          total_protein: customResult.total_protein,
          total_carbs: customResult.total_carbs,
          total_fat: customResult.total_fat,
          nutrients_per_100g: nutrientsPer100g,
          extra_nutrients: nutrientsPer100g,
          image_path: customResult.image_path,
          image_paths: customResult.image_paths || undefined,
          portion_label: customResult.portion_label,
          recommend_reason: customResult.recommend_reason,
          share_to_public: customShareToPublic,
        })
      } catch (e) {
        Taro.showToast({ title: '已先保存到本机', icon: 'none' })
      }
    }
    setCustomItems((prev) => {
      const next = mergeCustomFoodItems([
        savedCustomResult,
        ...prev.filter((item) => item.title.trim() !== name),
      ])
      persistStoredCustomFoodItems(next)
      return next
    })
    Taro.vibrateShort({ type: 'light' }).catch(() => {})
    resetCustomDraft()
    setShowCustomPanel(false)
    setActiveCategory('custom')
    setSearchText('')
    Taro.showToast({ title: '自定义完成', icon: 'success' })
  }

  useEffect(() => {
    if (normalizedQuery || catalogLoading || catalogLoadingMore || !catalogHasMore || visibleItems.length === 0) {
      return undefined
    }
    const page = Taro.getCurrentInstance().page
    if (!page || typeof Taro.createIntersectionObserver !== 'function') {
      return undefined
    }

    // 提示文案一进入屏幕附近就预加载，避免必须滚到整个页面底部才触发。
    const observer = Taro.createIntersectionObserver(page, { thresholds: [0.1] })
    observer.relativeToViewport({ bottom: 180 }).observe('.load-more', (res) => {
      if ((res.intersectionRatio || 0) > 0) {
        handleLoadMoreCatalog()
      }
    })

    return () => observer.disconnect()
  }, [catalogHasMore, catalogLoading, catalogLoadingMore, handleLoadMoreCatalog, normalizedQuery, visibleItems.length])

  const handleAddItem = (item: ManualFoodSearchResult) => {
    const key = getItemKey(item)
    setSelectedItems(prev => {
      const index = prev.findIndex((selected) => getItemKey(selected) === key)
      const servingProfile = inferServingProfile(item)
      const defaultWeight = servingProfile.defaultWeight
      const extraNutrients = scaledNutrients(item.extra_nutrients || item.nutrients_per_100g || {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
        sugar: 0,
      }, 1)
      const baseNutrients: Nutrients = {
        ...extraNutrients,
        calories: roundToSingle(item.total_calories),
        protein: roundToSingle(item.total_protein),
        carbs: roundToSingle(item.total_carbs),
        fat: roundToSingle(item.total_fat),
      }
      if (index === -1) {
        return [
          ...prev,
          {
            id: item.id,
            source: item.source,
            title: item.title,
            subtitle: item.subtitle,
            weight: defaultWeight,
            weightInput: formatWeightInput({
              weight: defaultWeight,
              defaultWeight,
              displayUnit: servingProfile.displayUnit,
            }),
            defaultWeight,
            portionLabel: servingProfile.portionLabel,
            baseNutrients,
            nutrients: buildNutrientsFromWeight({
              defaultWeight,
              baseNutrients,
              nutrientsPer100g: item.nutrients_per_100g || undefined,
            }, defaultWeight),
            nutrientsPer100g: item.nutrients_per_100g || undefined,
            displayUnit: servingProfile.displayUnit,
            displayUnitLabel: servingProfile.displayUnitLabel,
            servingPresets: servingProfile.servingPresets,
            imagePath: pickFoodDisplayImageUrl(item) || null,
            recommendReason: item.nutrition_highlights?.join(' · ') || item.recommend_reason,
            usageCount: Number(item.usage_count || 0),
            collected: Boolean(item.collected),
          },
        ]
      }
      return prev.map((selected, selectedIndex) => {
        if (selectedIndex !== index) return selected
        const nextWeight = selected.weight + defaultWeight
        return {
          ...selected,
          weight: nextWeight,
          weightInput: formatWeightInput(selected, nextWeight),
          nutrients: buildNutrientsFromWeight(selected, nextWeight),
        }
      })
    })
  }

  const updateItemWeight = (key: string, nextWeight: number) => {
    setSelectedItems((prev) =>
      prev.map((item) => {
        if (getItemKey(item) !== key) return item
        const safeWeight = roundWeightGrams(nextWeight) || 0.01
        return {
          ...item,
          weight: safeWeight,
          weightInput: formatWeightInput(item, safeWeight),
          nutrients: buildNutrientsFromWeight(item, safeWeight),
        }
      })
    )
  }

  const handleWeightInput = (key: string, value: string) => {
    const cleaned = value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
    setSelectedItems((prev) =>
      prev.map((item) => (
        getItemKey(item) === key
          ? { ...item, weightInput: cleaned }
          : item
      ))
    )
  }

  const commitWeightInput = (key: string) => {
    const target = selectedMap.get(key)
    if (!target) return
    const parsed = parseFloat(target.weightInput)
    if (Number.isFinite(parsed) && parsed > 0) {
      updateItemWeight(key, weightFromDisplayInput(target, parsed))
      return
    }
    setSelectedItems((prev) =>
      prev.map((item) => (
        getItemKey(item) === key
          ? { ...item, weightInput: formatWeightInput(item) }
          : item
      ))
    )
  }

  const handleQuickAdjust = (key: string, delta: number) => {
    const target = selectedMap.get(key)
    if (!target) return
    updateItemWeight(key, target.weight + delta)
  }

  const handleRemoveItem = (key: string) => {
    setSelectedItems((prev) => prev.filter((item) => getItemKey(item) !== key))
  }

  const totalNutrients = useMemo(() => {
    return selectedItems.reduce(
      (acc, item) => ({
        calories: acc.calories + item.nutrients.calories,
        protein: acc.protein + item.nutrients.protein,
        carbs: acc.carbs + item.nutrients.carbs,
        fat: acc.fat + item.nutrients.fat,
        fiber: acc.fiber + (item.nutrients.fiber || 0),
        sugar: acc.sugar + (item.nutrients.sugar || 0),
        sodium_mg: acc.sodium_mg + (item.nutrients.sodium_mg || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium_mg: 0 }
    )
  }, [selectedItems])

  const handleSave = async () => {
    if (selectedItems.length === 0) {
      Taro.showToast({ title: '请先添加食物', icon: 'none' })
      return
    }
    if (!getAccessToken()) {
      Taro.navigateTo({ url: extraPkgUrl('/pages/login/index') })
      return
    }
    
    setSaving(true)
    try {
      const items = selectedItems.map(item => ({
        name: item.title,
        weight: item.weight,
        ratio: 100,
        intake: item.weight,
        image_path: item.imagePath || undefined,
        image_paths: item.imagePath ? [item.imagePath] : undefined,
        nutrients: nutrientsForPayload(item.nutrients),
        manual_source: item.source,
        manual_source_id: item.id,
        manual_source_title: item.title,
        manual_portion_label: item.portionLabel,
      }))
      const totalWeight = selectedItems.reduce((s, i) => s + i.weight, 0)
      const hasCustomItems = selectedItems.some(item => item.source === 'custom')
      const mealImagePaths = Array.from(
        new Set(
          selectedItems.flatMap((item) => collectFoodDisplayImageUrls({ image_path: item.imagePath }))
        )
      )

      const saveResult = await saveFoodRecord({
        date: getStoredRecordTargetDate(),
        meal_type: selectedMeal as any,
        image_path: mealImagePaths[0],
        image_paths: mealImagePaths.length > 0 ? mealImagePaths : undefined,
        diet_goal: dietGoal as any,
        activity_timing: activityTiming as any,
        description: '手动记录：' + selectedItems.map(i => i.title).join('、'),
        insight: hasCustomItems ? '手动记录，包含用户自定义营养数据' : '手动记录，数据来自食物词典',
        items,
        total_calories: Math.round(totalNutrients.calories * 10) / 10,
        total_protein: Math.round(totalNutrients.protein * 10) / 10,
        total_carbs: Math.round(totalNutrients.carbs * 10) / 10,
        total_fat: Math.round(totalNutrients.fat * 10) / 10,
        total_weight_grams: totalWeight,
        entry_type: entryTypeRef.current,
      })

      const targetDate = getStoredRecordTargetDate()
      if (!saveResult.already_saved) {
        addWaterToBodyMetricsStorage(targetDate, calculateFoodRecordItemsWaterMl(items))
      }
      try {
        Taro.removeStorageSync('campus_quick_record_source')
      } catch {
        /* ignore */
      }
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDate })
      } catch {
        /* ignore */
      }
      try {
        await refreshHomeDashboardLocalSnapshotFromCloud(targetDate)
      } catch {
        /* ignore */
      }
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDate, force: true })
      } catch {
        /* ignore */
      }

      Taro.showToast({ title: saveResult.already_saved ? '该餐已记录' : '记录成功', icon: saveResult.already_saved ? 'none' : 'success' })
      setTimeout(() => {
        Taro.redirectTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${targetDate}` }).catch(() => {
          Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${targetDate}` })
        })
      }, 600)
    } catch (e: any) {
      await showUnifiedApiError(e, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const renderSelectedList = (variant: 'section' | 'drawer') => (
    <View className={`selected-list ${variant === 'drawer' ? 'drawer-selected-list' : ''}`}>
      {selectedItems.map((item) => {
        const key = getItemKey(item)
        return (
          <View key={key} className='selected-item'>
            <View className='selected-main'>
              <View className='selected-thumb'>
                {item.imagePath ? (
                  <Image className='selected-thumb-image' src={item.imagePath} mode='aspectFill' />
                ) : (
                  <View className='selected-thumb-placeholder'>
                    <Text className='iconfont icon-shiwu' />
                  </View>
                )}
              </View>
              <View className='item-info'>
                <View className='item-name-row'>
                  <Text className='item-name'>{item.title}</Text>
                  <Text className='item-tag'>
                    {item.displayUnit === 'serving'
                      ? item.portionLabel
                      : item.displayUnit === 'piece'
                        ? '按个数'
                        : item.displayUnit === 'ml'
                          ? '按毫升'
                          : '按克重'}
                  </Text>
                </View>
                <Text className='item-cal'>{Math.round(item.nutrients.calories)} kcal</Text>
                {!!item.recommendReason && (
                  <Text className='item-hint'>{item.recommendReason}</Text>
                )}
              </View>
            </View>

            {item.servingPresets.length > 0 && (
              <View className='serving-row'>
                {item.servingPresets.map((preset) => (
                  <View
                    key={preset.label}
                    className={`serving-chip ${Math.abs(item.weight - preset.grams) < 1 ? 'active' : ''}`}
                    onClick={() => updateItemWeight(key, preset.grams)}
                  >
                    <Text>{preset.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {item.displayUnit === 'g' && (
              <View className='quick-adjust-row'>
                {[-50, -10, 10, 50].map((delta) => (
                  <View
                    key={delta}
                    className='quick-adjust-chip'
                    onClick={() => handleQuickAdjust(key, delta)}
                  >
                    <Text>{delta > 0 ? `+${delta}` : delta}g</Text>
                  </View>
                ))}
              </View>
            )}

            <View className='item-actions'>
              <Input
                className='weight-input'
                type='digit'
                value={item.weightInput}
                onInput={(e) => handleWeightInput(key, e.detail.value)}
                onBlur={(e) => {
                  handleWeightInput(key, e.detail.value)
                  commitWeightInput(key)
                }}
              />
              <Text className='weight-unit'>{item.displayUnitLabel}</Text>
              <View className='remove-btn' onClick={() => handleRemoveItem(key)}>
                <Text className='iconfont icon-shanchu' />
              </View>
            </View>
          </View>
        )
      })}
    </View>
  )

  const renderResultItem = (item: ManualFoodSearchResult) => {
    const key = getItemKey(item)
    const selected = selectedMap.get(key)
    return (
      <View
        key={key}
        className='food-item'
        onClick={() => handleAddItem(item)}
      >
        <View className='food-cover'>
          {hasFoodDisplayImage(item) ? (
            <Image
              className='food-cover-image'
              src={pickFoodDisplayImageUrl(item)}
              mode='aspectFill'
            />
          ) : (
            <View className='food-cover-placeholder'>
              <Text className='iconfont icon-shiwu' />
            </View>
          )}
        </View>
        <View className='food-info'>
          <View className='food-name-row'>
            <Text className='food-name'>{item.title}</Text>
            <View className={`source-badge ${item.source}`}>
              <Text>{item.source_label || (item.source === 'public_library' ? '真实餐食' : item.source === 'packaged_food' ? '包装食品' : item.source === 'custom' ? '自定义' : '标准食物')}</Text>
            </View>
          </View>
          <Text className='food-sub'>
            {Math.round(item.total_calories)} kcal
            {` / ${resultPortionText(item)}`}
            {item.subtitle ? ` · ${item.subtitle}` : ''}
          </Text>
          {!!(item.nutrition_highlights?.length || item.recommend_reason) && (
            <Text className='food-hint'>
              {item.nutrition_highlights?.length
                ? item.nutrition_highlights.join(' · ')
                : item.recommend_reason}
            </Text>
          )}
        </View>
        <View className={`add-btn ${selected ? 'active' : ''}`}>
          <Text>
            {selected
              ? formatSelectedAmount(selected)
              : '+'}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View className='record-manual-page'>
      <ScrollView
        className='content-scroll'
        scrollY
        lowerThreshold={160}
        onScrollToLower={handleLoadMoreCatalog}
      >
        <View className='workspace-card'>
          <View className='workspace-header'>
            <View>
              <Text className='workspace-title'>单餐工作台</Text>
              <Text className='workspace-subtitle'>{statsText}</Text>
            </View>
            <View className='workspace-calories'>
              <Text className='workspace-calories-value'>{Math.round(totalNutrients.calories)}</Text>
              <Text className='workspace-calories-unit'>kcal</Text>
            </View>
          </View>

          <View className='meal-grid'>
            {MEALS.map((meal) => (
              <View
                key={meal.id}
                className={`meal-item ${selectedMeal === meal.id ? 'active' : ''}`}
                onClick={() => setSelectedMeal(meal.id)}
              >
                <Text className={`iconfont ${meal.icon} meal-icon`} />
                <Text className='meal-name'>{meal.name}</Text>
              </View>
            ))}
          </View>

          <View className='search-bar primary'>
            <Text className='iconfont icon-sousuo search-icon' />
            <Input
              className='search-input'
              placeholder='搜索食物，找不到可自定义'
              value={searchText}
              onInput={(e) => setSearchText(e.detail.value)}
              confirmType='search'
            />
            {searchText && (
              <View className='clear-btn' onClick={() => setSearchText('')}>
                <Text className='iconfont icon-guanbi' />
              </View>
            )}
          </View>

          <View className='custom-entry-card'>
            <View className='custom-entry-copy'>
              <Text className='custom-entry-title'>没有找到？直接自定义</Text>
              <Text className='custom-entry-subtitle'>不拍照，不走 AI，填一次后下次可复用</Text>
            </View>
            <View className='custom-entry-btn' onClick={openCustomPanel}>
              <Text>{normalizedQuery ? `新建“${normalizedQuery}”` : '新建'}</Text>
            </View>
          </View>

          {showCustomPanel && (
            <View className='custom-food-panel'>
              <View className='custom-food-header'>
                <Text className='custom-food-title'>自定义食物</Text>
                <Text className='custom-food-close' onClick={() => setShowCustomPanel(false)}>收起</Text>
              </View>
              <View className='custom-image-row'>
                <View className='custom-image-preview' onClick={handleChooseCustomImage}>
                  {customImageLocalPath || customImageUrl ? (
                    <Image className='custom-image' src={customImageLocalPath || customImageUrl} mode='aspectFill' />
                  ) : (
                    <View className='custom-image-empty'>
                      {customImageUploading ? (
                        <View className='custom-image-spinner' />
                      ) : (
                        <Text className='iconfont icon-xiangji' />
                      )}
                    </View>
                  )}
                </View>
                <View className='custom-image-actions'>
                  <Text className='custom-image-title'>食物图片</Text>
                  <View className='custom-image-buttons'>
                    <View className={`custom-image-btn ${customImageUploading ? 'disabled' : ''}`} onClick={handleChooseCustomImage}>
                      {customImageUploading ? <View className='custom-image-btn-spinner' /> : <Text>添加图片</Text>}
                    </View>
                    {(customImageLocalPath || customImageUrl) && (
                      <View className='custom-image-remove' onClick={handleRemoveCustomImage}>
                        <Text>移除</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
              <View className='custom-food-grid'>
                <View className='custom-field custom-field-full'>
                  <Text className='custom-field-label'>名称</Text>
                  <Input
                    className='custom-field-input'
                    value={customName}
                    placeholder='例如 家里卤牛肉'
                    onInput={(e) => setCustomName(e.detail.value)}
                  />
                </View>
                <View className='custom-field'>
                  <Text className='custom-field-label'>实际重量 g</Text>
                  <Input
                    className='custom-field-input'
                    type='digit'
                    value={customWeight}
                    onInput={(e) => setCustomWeight(e.detail.value)}
                  />
                </View>
                <View className='custom-field'>
                  <Text className='custom-field-label'>营养标示每 g</Text>
                  <Input
                    className='custom-field-input'
                    type='digit'
                    value={customNutritionBasis}
                    onInput={(e) => setCustomNutritionBasis(e.detail.value)}
                  />
                </View>
                <View className='custom-basis-presets custom-field-full'>
                  {['100', '60', '30'].map((basis) => (
                    <View
                      key={basis}
                      className={`custom-basis-chip ${customNutritionBasis === basis ? 'active' : ''}`}
                      onClick={() => setCustomNutritionBasis(basis)}
                    >
                      <Text>每{basis}g</Text>
                    </View>
                  ))}
                </View>
                <View className='custom-field'>
                  <View className='custom-energy-label-row'>
                    <Text className='custom-field-label'>热量 {customEnergyUnit} / 标示</Text>
                    <View className='custom-energy-unit-switch'>
                      {(['kj', 'kcal'] as CustomEnergyUnit[]).map((unit) => (
                        <View
                          key={unit}
                          className={`custom-energy-unit ${customEnergyUnit === unit ? 'active' : ''}`}
                          onClick={() => setCustomEnergyUnit(unit)}
                        >
                          <Text>{unit === 'kcal' ? 'kcal' : 'kJ'}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <Input
                    className='custom-field-input'
                    type='digit'
                    value={customCalories}
                    placeholder='必填'
                    onInput={(e) => setCustomCalories(e.detail.value)}
                  />
                  <Text className='custom-energy-hint'>
                    {customEnergyUnit === 'kj'
                      ? '按包装 kJ 填，保存时自动换算 kcal'
                      : '1 kcal = 4.184 kJ，可切回 kJ 填包装值'}
                  </Text>
                </View>
                <View className='custom-field'>
                  <Text className='custom-field-label'>蛋白质 g / 标示</Text>
                  <Input
                    className='custom-field-input'
                    type='digit'
                    value={customProtein}
                    placeholder='可选'
                    onInput={(e) => setCustomProtein(e.detail.value)}
                  />
                </View>
                <View className='custom-field'>
                  <Text className='custom-field-label'>碳水 g / 标示</Text>
                  <Input
                    className='custom-field-input'
                    type='digit'
                    value={customCarbs}
                    placeholder='可选'
                    onInput={(e) => setCustomCarbs(e.detail.value)}
                  />
                </View>
                <View className='custom-field'>
                  <Text className='custom-field-label'>脂肪 g / 标示</Text>
                  <Input
                    className='custom-field-input'
                    type='digit'
                    value={customFat}
                    placeholder='可选'
                    onInput={(e) => setCustomFat(e.detail.value)}
                  />
                </View>
              </View>
              <View className='custom-more-toggle' onClick={() => setShowCustomMicroPanel((prev) => !prev)}>
                <Text>维生素 / 矿物质</Text>
                <Text className='custom-more-arrow'>{showCustomMicroPanel ? '收起' : '展开'}</Text>
              </View>
              {showCustomMicroPanel && (
                <View className='custom-food-grid custom-micro-grid'>
                  {CUSTOM_MICRO_FIELDS.map((field) => (
                    <View className='custom-field' key={field.key}>
                      <Text className='custom-field-label'>{field.label} {field.unit} / 标示</Text>
                      <Input
                        className='custom-field-input'
                        type='digit'
                        value={customMicroValues[field.key] || ''}
                        placeholder='可选'
                        onInput={(e) => handleCustomMicroInput(field.key, e.detail.value)}
                      />
                    </View>
                  ))}
                </View>
              )}
              <View className='custom-public-row' onClick={() => setCustomShareToPublic((prev) => !prev)}>
                <View className='custom-public-copy'>
                  <Text className='custom-public-title'>贡献到公共临时库</Text>
                  <Text className='custom-public-subtitle'>审核通过后可给大家复用</Text>
                </View>
                <View className={`custom-public-switch ${customShareToPublic ? 'active' : ''}`}>
                  <View className='custom-public-knob' />
                </View>
              </View>
              <View className='custom-food-actions'>
                <View className='custom-food-secondary' onClick={resetCustomDraft}>
                  <Text>清空</Text>
                </View>
                <View className='custom-food-primary' onClick={handleAddCustomItem}>
                  <Text>完成自定义</Text>
                </View>
              </View>
            </View>
          )}

        </View>

        <View className='catalog-shell'>
          {!normalizedQuery && (
            <ScrollView className='catalog-sidebar' scrollY>
              {categories.map((category) => (
                <View
                  key={category.key}
                  className={`catalog-tab ${activeCategory === category.key ? 'active' : ''}`}
                  onClick={() => handleSelectCategory(category.key)}
                >
                  <Text>{category.label}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          <View className='catalog-main'>
            <View className='library-header'>
              <View>
                <Text className='section-title'>{normalizedQuery ? '搜索结果' : activeCategoryLabel}</Text>
                <Text className='library-subtitle'>
                  {normalizedQuery
                    ? `围绕“${normalizedQuery}”优先展示高频食物`
                    : statsText}
                </Text>
              </View>
            </View>

            {(catalogLoading || searchLoading) ? (
              <View className='loading-state'>
                <View className='loading-spinner' />
              </View>
            ) : visibleItems.length > 0 ? (
              <View className='food-list compact-list'>
                {visibleItems.map(renderResultItem)}
                {!normalizedQuery && catalogHasMore && (
                  <View className={`load-more ${catalogLoadingMore ? 'loading' : ''}`} onClick={handleLoadMoreCatalog}>
                    {catalogLoadingMore ? (
                      <View className='load-more-spinner' />
                    ) : (
                      <Text>继续下滑自动加载</Text>
                    )}
                  </View>
                )}
              </View>
            ) : (
              <View className='empty-state'>
                <Text>{normalizedQuery ? '没有找到匹配食物，可以直接按这个名字新建' : '暂无可用食物数据'}</Text>
                {normalizedQuery && (
                  <View className='empty-create-btn' onClick={openCustomPanel}>
                    <Text>新建“{normalizedQuery}”</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>

        {selectedItems.length > 0 && (
          <View className='config-card'>
            <View className='config-section'>
              <Text className='section-title'>饮食目标</Text>
              <View className='option-selector'>
                {DIET_GOALS.map((goal) => (
                  <View
                    key={goal.value}
                    className={`option-item ${dietGoal === goal.value ? 'active' : ''}`}
                    onClick={() => setDietGoal(goal.value)}
                  >
                    <Text>{goal.label}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View className='config-section'>
              <Text className='section-title'>运动时机</Text>
              <View className='option-selector'>
                {ACTIVITY_TIMINGS.map((timing) => (
                  <View
                    key={timing.value}
                    className={`option-item ${activityTiming === timing.value ? 'active' : ''}`}
                    onClick={() => setActivityTiming(timing.value)}
                  >
                    <Text>{timing.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        <View className='bottom-space' />
      </ScrollView>

      {selectedItems.length > 0 && (
        <View className='bottom-bar'>
          <View className='bottom-summary' onClick={() => setShowSelectedDrawer(true)}>
            <View className='bottom-summary-main'>
              <Text className='bottom-summary-text'>
                已选 {selectedItems.length} 项 · {Math.round(totalNutrients.calories)} kcal
              </Text>
              <Text className='bottom-summary-action'>查看</Text>
            </View>
            <Text className='bottom-summary-subtext'>点击查看已选食物</Text>
          </View>
          <View
            className={`save-btn ${saving ? 'loading' : ''}`}
            onClick={handleSave}
          >
            <Text>{saving ? '保存中...' : '保存到今天记录'}</Text>
          </View>
        </View>
      )}

      {selectedItems.length > 0 && showSelectedDrawer && (
        <View className='selected-drawer-mask' onClick={() => setShowSelectedDrawer(false)}>
          <View className='selected-drawer' onClick={(e) => e.stopPropagation()}>
            <View className='selected-drawer-handle' />
            <View className='selected-drawer-header'>
              <View>
                <Text className='selected-drawer-title'>已选食物</Text>
                <Text className='selected-drawer-subtitle'>
                  {selectedItems.length} 项 · {Math.round(totalNutrients.calories)} kcal
                </Text>
              </View>
              <View className='selected-drawer-close' onClick={() => setShowSelectedDrawer(false)}>
                <Text className='iconfont icon-guanbi' />
              </View>
            </View>
            <View className='selected-drawer-total'>
              <View className='total-item'>
                <Text className='label'>热量</Text>
                <Text className='value'>{Math.round(totalNutrients.calories)} kcal</Text>
              </View>
              <View className='total-item'>
                <Text className='label'>蛋白质</Text>
                <Text className='value'>{Math.round(totalNutrients.protein)}g</Text>
              </View>
              <View className='total-item'>
                <Text className='label'>碳水</Text>
                <Text className='value'>{Math.round(totalNutrients.carbs)}g</Text>
              </View>
              <View className='total-item'>
                <Text className='label'>脂肪</Text>
                <Text className='value'>{Math.round(totalNutrients.fat)}g</Text>
              </View>
            </View>
            <ScrollView className='selected-drawer-scroll' scrollY>
              {renderSelectedList('drawer')}
            </ScrollView>
            <View className='selected-drawer-actions'>
              <View className='selected-drawer-secondary' onClick={() => setShowSelectedDrawer(false)}>
                <Text>继续添加</Text>
              </View>
              <View
                className={`selected-drawer-primary ${saving ? 'loading' : ''}`}
                onClick={handleSave}
              >
                <Text>{saving ? '保存中...' : '保存本餐'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(RecordManualPage)
