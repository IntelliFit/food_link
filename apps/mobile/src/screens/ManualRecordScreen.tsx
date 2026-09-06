import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ImagePicker from 'expo-image-picker'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { CommonActions, useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  type ActivityTiming,
  type DietGoal,
  type FoodRecordEntryType,
  getMealTypeLabel,
  inferDefaultMealTypeFromLocalTime,
  type ManualFoodBrowseResult,
  type ManualFoodCatalogCategory,
  type ManualFoodItem,
  type MealType,
} from '@food-link/core'
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Coffee,
  Cookie,
  ImagePlus,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Soup,
  Trash2,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiClient, getStoredUserId } from '../api'
import type { RootStackParamList } from '../navigation/types'
import { useAppDialog } from '../providers/DialogProvider'
import { useColorScheme } from '../providers/ColorSchemeProvider'
import { todayKey } from '../utils/date'
import { userFacingErrorMessage } from '../utils/errors'
import { emitHomeIntakeDataChangedEvent } from '../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../utils/home-dashboard-local-cache'

type ManualDisplayUnit = 'g' | 'ml' | 'serving' | 'piece'
type CustomEnergyUnit = 'kj' | 'kcal'

type ManualFoodExtended = ManualFoodItem & {
  display_unit?: ManualDisplayUnit
  display_unit_label?: string
  serving_presets?: Array<{ label: string; grams: number; quantity?: number }>
  nutrition_highlights?: string[]
  usage_count?: number
  collected?: boolean
  is_campus_food?: boolean
  type?: string
}

type SelectedFood = {
  key: string
  item: ManualFoodExtended
  weight: number
  weightInput: string
  defaultWeight: number
  displayUnit: ManualDisplayUnit
  displayUnitLabel: string
  portionLabel: string
  servingPresets: Array<{ label: string; grams: number }>
}

type Palette = {
  page: string
  surface: string
  surfaceAlt: string
  surfaceStrong: string
  border: string
  divider: string
  text: string
  secondary: string
  muted: string
  brand: string
  brandStrong: string
  brandSoft: string
  brandWash: string
  danger: string
  dangerSoft: string
  scrim: string
  shadow: string
}

const LIGHT: Palette = {
  page: '#eef7f3',
  surface: '#ffffff',
  surfaceAlt: '#f7faf9',
  surfaceStrong: '#edf4f1',
  border: '#dbe9e3',
  divider: '#e8efec',
  text: '#12211b',
  secondary: '#52645d',
  muted: '#788b83',
  brand: '#168b66',
  brandStrong: '#0f6f51',
  brandSoft: '#dff4eb',
  brandWash: '#f1faf6',
  danger: '#c63f45',
  dangerSoft: '#fff0f0',
  scrim: 'rgba(4, 18, 13, 0.56)',
  shadow: '#0f2b20',
}

const DARK: Palette = {
  page: '#0d1512',
  surface: '#15201c',
  surfaceAlt: '#192722',
  surfaceStrong: '#22322c',
  border: '#31483f',
  divider: '#293b34',
  text: '#eef8f3',
  secondary: '#bdd0c7',
  muted: '#8fa69b',
  brand: '#5fd1a4',
  brandStrong: '#86e4bd',
  brandSoft: '#214c3d',
  brandWash: '#183229',
  danger: '#ff8589',
  dangerSoft: '#3d2225',
  scrim: 'rgba(0, 0, 0, 0.72)',
  shadow: '#000000',
}

const MEALS: Array<{ value: MealType; label: string; icon: LucideIcon }> = [
  { value: 'breakfast', label: '早餐', icon: Coffee },
  { value: 'morning_snack', label: '早加餐', icon: Cookie },
  { value: 'lunch', label: '午餐', icon: Soup },
  { value: 'afternoon_snack', label: '午加餐', icon: Utensils },
  { value: 'dinner', label: '晚餐', icon: Moon },
  { value: 'evening_snack', label: '晚加餐', icon: Cookie },
]

const DEFAULT_CATEGORIES: ManualFoodCatalogCategory[] = [
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

const DIET_GOALS: Array<{ value: DietGoal; label: string }> = [
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无' },
]

const ACTIVITY_TIMINGS: Array<{ value: ActivityTiming; label: string }> = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' },
]

const MICRO_FIELDS = [
  ['fiber', '膳食纤维', 'g'],
  ['sugar', '糖', 'g'],
  ['sodium_mg', '钠', 'mg'],
  ['potassiumMg', '钾', 'mg'],
  ['calciumMg', '钙', 'mg'],
  ['ironMg', '铁', 'mg'],
  ['magnesiumMg', '镁', 'mg'],
  ['zincMg', '锌', 'mg'],
  ['vitaminARaeMcg', '维生素A', 'μg RAE'],
  ['vitaminCMg', '维生素C', 'mg'],
  ['vitaminDMcg', '维生素D', 'μg'],
  ['vitaminEMg', '维生素E', 'mg'],
  ['vitaminKMcg', '维生素K', 'μg'],
  ['thiaminMg', '维生素B1', 'mg'],
  ['riboflavinMg', '维生素B2', 'mg'],
  ['niacinMg', '烟酸B3', 'mg'],
  ['vitaminB6Mg', '维生素B6', 'mg'],
  ['folateMcg', '叶酸', 'μg'],
  ['vitaminB12Mcg', '维生素B12', 'μg'],
] as const

const CUSTOM_STORAGE_KEY = 'mobile_manual_custom_foods_v2'
const KJ_PER_KCAL = 4.184

async function getCustomStorageKey() {
  const userId = await getStoredUserId()
  return `${CUSTOM_STORAGE_KEY}:${userId || 'guest'}`
}

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positive(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function compact(value: number, digits = 1) {
  return String(round(value, digits))
}

function normalizeDate(value?: string) {
  const candidate = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return todayKey()
  const [year, month, day] = candidate.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? candidate : todayKey()
}

function validDate(value: string) {
  return normalizeDate(value) === value.trim()
}

function foodTitle(item: ManualFoodExtended) {
  return String(item.title || item.name || '食物')
}

function foodKey(item: ManualFoodExtended) {
  const id = String(item.source_id || item.id || '').trim()
  return String(item.source || 'manual') + ':' + (id || foodTitle(item))
}

function foodImage(item: ManualFoodExtended) {
  const first = Array.isArray(item.image_paths) ? item.image_paths.find(Boolean) : undefined
  const value = String(item.image_path || first || '').trim()
  return /^(https?:|file:|content:)/i.test(value) ? value : undefined
}

function sourceLabel(item: ManualFoodExtended) {
  const label = String(item.source_label || '').trim()
  if (label) return label
  if (item.source === 'public_library' && (item.is_campus_food || item.type === 'campus')) return '校园食堂'
  if (item.source === 'public_library') return '真实餐食'
  if (item.source === 'packaged_food') return '包装食品'
  if (item.source === 'custom') return '自定义'
  if (item.source === 'recent') return '最近记录'
  return '标准食物'
}

function isEgg(title: string) {
  return /鸡蛋|水煮蛋|卤蛋|煎蛋|egg/i.test(title)
}

function isDrink(title: string) {
  return /咖啡|美式|拿铁|奶茶|茶饮|绿茶|红茶|乌龙茶|普洱|茉莉茶|饮料|可乐|果汁|豆浆|coffee|latte|drink/i.test(title)
}

function isSoup(title: string) {
  return /清汤|汤|羹|soup|broth/i.test(title)
}

function servingProfile(item: ManualFoodExtended) {
  const remote = (item.serving_presets || [])
    .filter((preset) => positive(preset.grams, 0) > 0)
    .map((preset) => ({ label: String(preset.label || ''), grams: round(positive(preset.grams, 0)) }))
  if (item.display_unit) {
    const defaultWeight = positive(item.default_weight_grams, remote[0]?.grams || 100)
    const displayUnitLabel = String(
      item.display_unit_label ||
      (item.display_unit === 'piece' ? '个' : item.display_unit === 'serving' ? '份' : item.display_unit),
    )
    return {
      defaultWeight,
      displayUnit: item.display_unit,
      displayUnitLabel,
      portionLabel: String(item.portion_label || '1' + displayUnitLabel),
      servingPresets: remote,
    }
  }
  const title = foodTitle(item)
  if (item.source === 'public_library') {
    const defaultWeight = positive(item.default_weight_grams, 1)
    return {
      defaultWeight,
      displayUnit: 'serving' as const,
      displayUnitLabel: '份',
      portionLabel: String(item.portion_label || '1份'),
      servingPresets: [0.5, 1, 1.5, 2].map((quantity) => ({ label: String(quantity) + '份', grams: round(defaultWeight * quantity) })),
    }
  }
  if (isEgg(title)) {
    return {
      defaultWeight: 55,
      displayUnit: 'piece' as const,
      displayUnitLabel: '个',
      portionLabel: '1个',
      servingPresets: [0.5, 1, 2].map((quantity) => ({ label: String(quantity) + '个', grams: 55 * quantity })),
    }
  }
  if (isDrink(title) || isSoup(title)) {
    const fallback = isSoup(title) && !isDrink(title) ? 250 : 350
    const defaultWeight = positive(item.default_weight_grams, 100) === 100 ? fallback : positive(item.default_weight_grams, fallback)
    const amounts = isDrink(title) ? [350, 450, 590] : [250, 350, 500]
    return {
      defaultWeight,
      displayUnit: 'ml' as const,
      displayUnitLabel: 'ml',
      portionLabel: String(item.portion_label || String(defaultWeight) + 'ml'),
      servingPresets: amounts.map((amount) => ({ label: String(amount) + 'ml', grams: amount })),
    }
  }
  const raw = positive(item.default_weight_grams, 100)
  const defaultWeight = item.source === 'nutrition_library' ? Math.max(1, Math.round(raw)) : raw
  return {
    defaultWeight,
    displayUnit: 'g' as const,
    displayUnitLabel: 'g',
    portionLabel: String(item.portion_label || compact(defaultWeight) + 'g'),
    servingPresets: [],
  }
}

function displayInput(item: Pick<SelectedFood, 'weight' | 'defaultWeight' | 'displayUnit'>, weight = item.weight) {
  if (item.displayUnit === 'serving' || item.displayUnit === 'piece') {
    return compact(weight / positive(item.defaultWeight, 1), 2)
  }
  return compact(weight, 2)
}

function weightFromInput(item: Pick<SelectedFood, 'defaultWeight' | 'displayUnit'>, input: number) {
  return item.displayUnit === 'serving' || item.displayUnit === 'piece'
    ? positive(item.defaultWeight, 1) * input
    : input
}

function resultPortion(item: ManualFoodExtended) {
  const profile = servingProfile(item)
  if (profile.displayUnit === 'piece' || profile.displayUnit === 'serving') {
    return '1' + profile.displayUnitLabel + (profile.defaultWeight > 1 ? '（约' + compact(profile.defaultWeight) + 'g）' : '')
  }
  return compact(profile.defaultWeight) + profile.displayUnitLabel
}

function scaledNutrition(item: ManualFoodExtended, weight: number, baseWeight = positive(item.default_weight_grams, 100)) {
  const ratio = weight / positive(baseWeight, 100)
  return {
    calories: numeric(item.total_calories ?? item.calories) * ratio,
    protein: numeric(item.total_protein ?? item.protein) * ratio,
    carbs: numeric(item.total_carbs ?? item.carbs) * ratio,
    fat: numeric(item.total_fat ?? item.fat) * ratio,
  }
}

function mergeFoods(items: ManualFoodExtended[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = foodKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function initialEntryType(route: RouteProp<RootStackParamList, 'ManualRecord'>): FoodRecordEntryType {
  const item = route.params?.quickItem as ManualFoodExtended | undefined
  return route.params?.sourceChannel === 'campus' ||
    (item?.source === 'public_library' && (item.is_campus_food || item.type === 'campus'))
    ? 'public_food_library'
    : 'food_library'
}

export function ManualRecordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'ManualRecord'>>()
  const dialog = useAppDialog()
  const { isDark } = useColorScheme()
  const insets = useSafeAreaInsets()
  const { width, fontScale } = useWindowDimensions()
  const palette = isDark ? DARK : LIGHT
  const styles = useMemo(() => createStyles(palette), [palette])
  const compactLayout = width < 390 || fontScale >= 1.2
  const entryTypeRef = useRef<FoodRecordEntryType>(initialEntryType(route))
  const allowLeaveRef = useRef(false)
  const catalogRequestRef = useRef(0)
  const searchRequestRef = useRef(0)
  const categoryRef = useRef(route.params?.sourceChannel === 'recommended' ? 'common' : route.params?.sourceChannel || 'common')

  const [mealType, setMealType] = useState<MealType>(route.params?.mealType || inferDefaultMealTypeFromLocalTime())
  const [date, setDate] = useState(normalizeDate(route.params?.date))
  const [dietGoal, setDietGoal] = useState<DietGoal>('none')
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(
    route.params?.sourceChannel === 'recommended' ? 'common' : route.params?.sourceChannel || 'common',
  )
  const [browse, setBrowse] = useState<ManualFoodBrowseResult | null>(null)
  const [categories, setCategories] = useState<ManualFoodCatalogCategory[]>(DEFAULT_CATEGORIES)
  const [catalogItems, setCatalogItems] = useState<ManualFoodExtended[]>([])
  const [customItems, setCustomItems] = useState<ManualFoodExtended[]>([])
  const [searchItems, setSearchItems] = useState<ManualFoodExtended[]>([])
  const [selected, setSelected] = useState<SelectedFood[]>([])
  const [catalogPage, setCatalogPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searching, setSearching] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customMore, setCustomMore] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customWeight, setCustomWeight] = useState('100')
  const [customBasis, setCustomBasis] = useState('100')
  const [customEnergyUnit, setCustomEnergyUnit] = useState<CustomEnergyUnit>('kj')
  const [customEnergy, setCustomEnergy] = useState('')
  const [customProtein, setCustomProtein] = useState('')
  const [customCarbs, setCustomCarbs] = useState('')
  const [customFat, setCustomFat] = useState('')
  const [customMicro, setCustomMicro] = useState<Record<string, string>>({})
  const [customImageLocal, setCustomImageLocal] = useState('')
  const [customImageRemote, setCustomImageRemote] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [customSaving, setCustomSaving] = useState(false)
  const [customTouched, setCustomTouched] = useState<Record<string, boolean>>({})

  const dirty = selected.length > 0 ||
    (customOpen && Boolean(customName.trim() || customEnergy.trim() || customImageLocal))

  useEffect(() => {
    navigation.setOptions({
      title: '手动记录',
      headerStyle: { backgroundColor: palette.surface },
      headerTintColor: palette.text,
      headerShadowVisible: false,
    })
  }, [navigation, palette.surface, palette.text])

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowLeaveRef.current || !dirty) return
    event.preventDefault()
    if (saving || customSaving || uploadingImage) return
    void dialog.confirm({
      title: '放弃这次手动记录？',
      message: '已选择的食物和未完成的自定义内容不会保留。',
      kind: 'warning',
      confirmText: '放弃记录',
      cancelText: '继续编辑',
    }).then((confirmed) => {
      if (!confirmed) return
      allowLeaveRef.current = true
      navigation.dispatch(event.data.action)
    })
  }), [customSaving, dialog, dirty, navigation, saving, uploadingImage])

  const loadStoredCustom = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(await getCustomStorageKey())
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed as ManualFoodExtended[] : []
    } catch {
      return []
    }
  }, [])

  const persistCustom = useCallback(async (items: ManualFoodExtended[]) => {
    await AsyncStorage.setItem(await getCustomStorageKey(), JSON.stringify(items.slice(0, 120)))
  }, [])

  const loadCatalog = useCallback(async (nextCategory: string, page = 1, append = false) => {
    if (nextCategory === 'custom') return
    const requestId = ++catalogRequestRef.current
    append ? setLoadingMore(true) : setCatalogLoading(true)
    if (!append) setLoadError('')
    try {
      const data = await apiClient.getManualFoodCatalog(nextCategory, { page, pageSize: 30 })
      if (requestId !== catalogRequestRef.current) return
      const nextItems = (data.items || []) as ManualFoodExtended[]
      setCatalogItems((current) => append ? mergeFoods([...current, ...nextItems]) : nextItems)
      setCatalogPage(data.page || page)
      setHasMore(Boolean(data.has_more))
      if (data.categories?.length) {
        const withoutCustom = data.categories.filter((item) => item.key !== 'custom')
        setCategories([
          withoutCustom[0] || DEFAULT_CATEGORIES[0],
          { key: 'custom', label: '自定义' },
          ...withoutCustom.slice(1),
        ])
      }
    } catch (error) {
      if (requestId === catalogRequestRef.current) {
        setLoadError(userFacingErrorMessage(error, '食物目录暂时无法读取'))
      }
    } finally {
      if (requestId === catalogRequestRef.current) {
        setCatalogLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  const loadAll = useCallback(async (asRefresh = false) => {
    asRefresh ? setRefreshing(true) : setInitialLoading(true)
    setLoadError('')
    const stored = await loadStoredCustom()
    const [browseResult, customResult, recommendedResult] = await Promise.allSettled([
      apiClient.getManualFoodBrowse(20),
      apiClient.getCustomFoods(120),
      route.params?.mealType ? Promise.resolve(null) : apiClient.getRecommendedMealType(date),
    ])
    if (browseResult.status === 'fulfilled') setBrowse(browseResult.value)
    if (recommendedResult.status === 'fulfilled' && recommendedResult.value?.meal_type) {
      setMealType(recommendedResult.value.meal_type)
    }
    const remote = customResult.status === 'fulfilled'
      ? customResult.value.items as ManualFoodExtended[]
      : []
    const merged = mergeFoods([...remote, ...stored])
    setCustomItems(merged)
    void persistCustom(merged)
    if (browseResult.status === 'rejected' && customResult.status === 'rejected') {
      setLoadError(userFacingErrorMessage(browseResult.reason, '食物库暂时无法读取'))
    }
    await loadCatalog(categoryRef.current, 1, false)
    setInitialLoading(false)
    setRefreshing(false)
  }, [date, loadCatalog, loadStoredCustom, persistCustom, route.params?.mealType])

  useFocusEffect(useCallback(() => {
    void loadAll(false)
  }, [loadAll]))

  const addFood = useCallback((item: ManualFoodExtended) => {
    const key = foodKey(item)
    const profile = servingProfile(item)
    setSelected((current) => {
      const existing = current.find((entry) => entry.key === key)
      if (existing) {
        return current.map((entry) => {
          if (entry.key !== key) return entry
          const weight = round(entry.weight + profile.defaultWeight, 2)
          return { ...entry, weight, weightInput: displayInput(entry, weight) }
        })
      }
      return [...current, {
        key,
        item,
        weight: profile.defaultWeight,
        weightInput: profile.displayUnit === 'serving' || profile.displayUnit === 'piece'
          ? '1'
          : compact(profile.defaultWeight, 2),
        ...profile,
      }]
    })
  }, [])

  useEffect(() => {
    const quick = route.params?.quickItem as ManualFoodExtended | undefined
    if (quick) addFood(quick)
  }, [addFood, route.params?.quickItem])

  const selectCategory = useCallback((next: string) => {
    if (next === category) return
    categoryRef.current = next
    catalogRequestRef.current += 1
    setCategory(next)
    setQuery('')
    setSearchItems([])
    setLoadError('')
    if (next !== 'custom') void loadCatalog(next, 1, false)
  }, [category, loadCatalog])

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      searchRequestRef.current += 1
      setSearchItems([])
      setSearching(false)
      return
    }
    const requestId = ++searchRequestRef.current
    const timer = setTimeout(() => {
      setSearching(true)
      void apiClient.searchManualFood(keyword, 40)
        .then((data) => {
          if (requestId === searchRequestRef.current) {
            setSearchItems(data.results as ManualFoodExtended[])
            setLoadError('')
          }
        })
        .catch((error) => {
          if (requestId === searchRequestRef.current) {
            setLoadError(userFacingErrorMessage(error, '搜索失败，请稍后重试'))
          }
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) setSearching(false)
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const recommended = useMemo(() => {
    if (!browse) return []
    return mergeFoods([
      ...((browse.recent_items || []) as ManualFoodExtended[]),
      ...((browse.collected_public_library || []) as ManualFoodExtended[]),
      ...((browse.public_library || []) as ManualFoodExtended[]),
      ...((browse.nutrition_library || []) as ManualFoodExtended[]),
    ])
  }, [browse])

  const visibleItems = useMemo(() => {
    const keyword = query.trim()
    if (keyword) {
      return mergeFoods([
        ...customItems.filter((item) => foodTitle(item).includes(keyword)),
        ...searchItems,
      ])
    }
    if (category === 'custom') return customItems
    if (category === 'common' && !catalogItems.length) return recommended
    return catalogItems
  }, [catalogItems, category, customItems, query, recommended, searchItems])

  const totals = useMemo(() => selected.reduce((sum, entry) => {
    const nutrients = scaledNutrition(entry.item, entry.weight, entry.defaultWeight)
    return {
      calories: sum.calories + nutrients.calories,
      protein: sum.protein + nutrients.protein,
      carbs: sum.carbs + nutrients.carbs,
      fat: sum.fat + nutrients.fat,
      weight: sum.weight + entry.weight,
    }
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, weight: 0 }), [selected])

  const selectedKeys = useMemo(() => new Set(selected.map((entry) => entry.key)), [selected])
  const activeCategoryLabel = categories.find((item) => item.key === category)?.label || '常见'
  const statsText = query.trim()
    ? '已找到 ' + visibleItems.length + ' 个结果'
    : category === 'custom'
      ? customItems.length + ' 个自定义食物 · 可直接加入本餐'
      : visibleItems.length + ' 个常用食物 · 点击右侧加入'

  const openCustom = useCallback(() => {
    if (query.trim() && !customName.trim()) setCustomName(query.trim())
    setCustomOpen(true)
  }, [customName, query])

  const resetCustom = useCallback(() => {
    setCustomName('')
    setCustomWeight('100')
    setCustomBasis('100')
    setCustomEnergyUnit('kj')
    setCustomEnergy('')
    setCustomProtein('')
    setCustomCarbs('')
    setCustomFat('')
    setCustomMicro({})
    setCustomMore(false)
    setCustomImageLocal('')
    setCustomImageRemote('')
    setCustomTouched({})
  }, [])

  const pickCustomImage = useCallback(async (source: 'camera' | 'library') => {
    if (uploadingImage) return
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync()
        if (!permission.granted) throw new Error('需要相机权限才能拍摄食物图片')
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.82 })
      if (result.canceled || !result.assets[0]) return
      const asset = result.assets[0]
      setCustomImageLocal(asset.uri)
      setUploadingImage(true)
      const uploaded = await apiClient.uploadAnalyzeImageFile({
        fileUri: asset.uri,
        fileName: asset.fileName || 'custom-food.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      })
      setCustomImageRemote(uploaded.imageUrl)
    } catch (error) {
      setCustomImageLocal('')
      setCustomImageRemote('')
      void dialog.alert('图片处理失败', userFacingErrorMessage(error), 'danger')
    } finally {
      setUploadingImage(false)
    }
  }, [dialog, uploadingImage])

  const customErrors = useMemo(() => ({
    name: customTouched.name && !customName.trim() ? '请输入食物名称' : '',
    weight: customTouched.weight && positive(customWeight, 0) <= 0 ? '请输入大于 0 的实际重量' : '',
    basis: customTouched.basis && positive(customBasis, 0) <= 0 ? '请输入大于 0 的营养标示重量' : '',
    energy: customTouched.energy && positive(customEnergy, 0) <= 0 ? '请输入大于 0 的热量' : '',
  }), [customBasis, customEnergy, customName, customTouched, customWeight])

  const completeCustom = useCallback(async () => {
    setCustomTouched({ name: true, weight: true, basis: true, energy: true })
    const name = customName.trim()
    const weight = positive(customWeight, 0)
    const basis = positive(customBasis, 0)
    const energy = positive(customEnergy, 0)
    if (!name || weight <= 0 || basis <= 0 || energy <= 0) {
      AccessibilityInfo.announceForAccessibility('请检查自定义食物的必填项')
      return
    }
    if (uploadingImage) return
    setCustomSaving(true)
    const kcal = customEnergyUnit === 'kj' ? energy / KJ_PER_KCAL : energy
    const per100Factor = 100 / basis
    const perWeightFactor = weight / basis
    const per100: Record<string, number> = {
      calories: round(kcal * per100Factor),
      protein: round(numeric(customProtein) * per100Factor),
      carbs: round(numeric(customCarbs) * per100Factor),
      fat: round(numeric(customFat) * per100Factor),
    }
    MICRO_FIELDS.forEach(([key]) => {
      per100[key] = round(numeric(customMicro[key]) * per100Factor)
    })
    const localItem: ManualFoodExtended = {
      id: 'custom:' + Date.now() + ':' + name,
      source: 'custom',
      source_label: '自定义',
      title: name,
      default_weight_grams: weight,
      display_unit: 'g',
      display_unit_label: 'g',
      portion_label: compact(weight) + 'g',
      total_calories: round(kcal * perWeightFactor),
      total_protein: round(numeric(customProtein) * perWeightFactor),
      total_carbs: round(numeric(customCarbs) * perWeightFactor),
      total_fat: round(numeric(customFat) * perWeightFactor),
      nutrients_per_100g: per100,
      extra_nutrients: per100,
      image_path: customImageRemote || undefined,
      image_paths: customImageRemote ? [customImageRemote] : undefined,
      recommend_reason: customEnergyUnit === 'kj'
        ? '标示 ' + compact(energy) + ' kJ ≈ ' + compact(kcal) + ' kcal / 每' + compact(basis) + 'g'
        : '标示 ' + compact(kcal) + ' kcal / 每' + compact(basis) + 'g',
    }
    let saved = localItem
    let cloudSaved = true
    try {
      saved = await apiClient.saveCustomFood({
        title: name,
        defaultWeightGrams: weight,
        totalCalories: numeric(localItem.total_calories),
        totalProtein: numeric(localItem.total_protein),
        totalCarbs: numeric(localItem.total_carbs),
        totalFat: numeric(localItem.total_fat),
        nutrientsPer100g: per100,
        extraNutrients: per100,
        imagePath: customImageRemote || undefined,
        imagePaths: customImageRemote ? [customImageRemote] : undefined,
        portionLabel: localItem.portion_label,
        recommendReason: localItem.recommend_reason,
        shareToPublic: false,
      }) as ManualFoodExtended
    } catch {
      cloudSaved = false
    }
    const next = mergeFoods([saved, ...customItems.filter((item) => foodTitle(item) !== name)])
    setCustomItems(next)
    await persistCustom(next).catch(() => undefined)
    resetCustom()
    setCustomOpen(false)
    setCategory('custom')
    setQuery('')
    setCustomSaving(false)
    AccessibilityInfo.announceForAccessibility('自定义食物已完成')
    if (!cloudSaved) {
      void dialog.alert('已保存到本机', '网络暂时不可用；这个自定义食物仍可在本机继续记录。', 'warning')
    }
  }, [
    customBasis,
    customCarbs,
    customEnergy,
    customEnergyUnit,
    customFat,
    customImageRemote,
    customItems,
    customMicro,
    customName,
    customProtein,
    customWeight,
    dialog,
    persistCustom,
    resetCustom,
    uploadingImage,
  ])

  const updateWeightInput = useCallback((key: string, value: string) => {
    const cleaned = value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
    setSelected((current) => current.map((entry) => entry.key === key ? { ...entry, weightInput: cleaned } : entry))
  }, [])

  const commitWeight = useCallback((key: string) => {
    setSelected((current) => current.map((entry) => {
      if (entry.key !== key) return entry
      const parsed = Number(entry.weightInput)
      if (!Number.isFinite(parsed) || parsed <= 0) return { ...entry, weightInput: displayInput(entry) }
      const weight = Math.max(0.01, round(weightFromInput(entry, parsed), 2))
      return { ...entry, weight, weightInput: displayInput(entry, weight) }
    }))
  }, [])

  const setWeight = useCallback((key: string, weight: number) => {
    setSelected((current) => current.map((entry) => entry.key === key
      ? { ...entry, weight: Math.max(0.01, round(weight, 2)), weightInput: displayInput(entry, weight) }
      : entry))
  }, [])

  const save = useCallback(async () => {
    if (!selected.length || saving) return
    if (!validDate(date)) {
      void dialog.alert('日期格式不正确', '请使用 YYYY-MM-DD，例如 2026-09-03。', 'warning')
      return
    }
    setSaving(true)
    try {
      const result = await apiClient.saveManualFoodRecords({
        items: selected.map((entry) => ({
          item: { ...entry.item, default_weight_grams: entry.defaultWeight },
          weight: entry.weight,
        })),
        mealType,
        date,
        dietGoal,
        activityTiming,
        entryType: entryTypeRef.current,
      })
      emitHomeIntakeDataChangedEvent({ date, force: true })
      void refreshHomeDashboardLocalSnapshotFromCloud(date).catch(() => undefined)
      allowLeaveRef.current = true
      setDrawerOpen(false)
      const message = '已将 ' + selected.length + ' 项食物写入' + getMealTypeLabel(mealType) + '。'
      if (result.id) {
        const choice = await dialog.showDialog({
          title: '已保存',
          message,
          kind: 'success',
          cancelText: '回到首页',
          confirmText: '查看记录',
        })
        setSelected([])
        if (choice === 'confirm') navigation.navigate('RecordDetail', { recordId: result.id })
        else navigation.dispatch(CommonActions.navigate('MainTabs'))
      } else {
        await dialog.alert('已保存', message, 'success')
        setSelected([])
        navigation.dispatch(CommonActions.navigate('MainTabs'))
      }
    } catch (error) {
      void dialog.alert('保存失败', userFacingErrorMessage(error, '请检查网络后重试'), 'danger')
    } finally {
      setSaving(false)
    }
  }, [activityTiming, date, dialog, dietGoal, mealType, navigation, saving, selected])

  const contentLoading = (initialLoading || catalogLoading || searching) && !visibleItems.length
  const dateLabel = date === todayKey() ? '今天' : date

  return (
    <KeyboardAvoidingView
      style={[styles.page, { backgroundColor: palette.page }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          selected.length > 0 && { paddingBottom: 126 + Math.max(insets.bottom, 12) },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadAll(true)}
            tintColor={palette.brand}
            colors={[palette.brand]}
          />
        }
      >
        <View style={styles.workspaceCard}>
          <View style={styles.workspaceHeader}>
            <View style={styles.flex}>
              <Text style={styles.workspaceTitle}>单餐工作台</Text>
              <Text style={styles.workspaceSubtitle}>{statsText}</Text>
            </View>
            <View style={styles.caloriesPill} accessibilityLabel={'当前总热量 ' + Math.round(totals.calories) + ' 千卡'}>
              <Text style={styles.caloriesValue}>{Math.round(totals.calories)}</Text>
              <Text style={styles.caloriesUnit}>kcal</Text>
            </View>
          </View>

          <View style={styles.mealGrid}>
            {MEALS.map((meal) => {
              const Icon = meal.icon
              const active = mealType === meal.value
              return (
                <Pressable
                  key={meal.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={meal.label}
                  style={({ pressed }) => [
                    styles.meal,
                    active && styles.mealActive,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setMealType(meal.value)}
                >
                  <Icon size={17} color={active ? palette.brandStrong : palette.muted} strokeWidth={2} />
                  <Text style={[styles.mealText, active && styles.mealTextActive]}>{meal.label}</Text>
                </Pressable>
              )
            })}
          </View>

          <View style={styles.dateRow}>
            <CalendarDays size={18} color={palette.secondary} />
            <Text style={styles.dateLabel}>记录日期</Text>
            <Text style={styles.dateHint}>{dateLabel}</Text>
            <TextInput
              accessibilityLabel="记录日期"
              value={date}
              onChangeText={setDate}
              maxLength={10}
              keyboardType="numbers-and-punctuation"
              placeholder="YYYY-MM-DD"
              placeholderTextColor={palette.muted}
              style={styles.dateInput}
            />
          </View>

          <View style={styles.searchBar}>
            <Search size={19} color={palette.muted} />
            <TextInput
              accessibilityLabel="搜索食物"
              value={query}
              onChangeText={setQuery}
              placeholder="搜索食物，找不到可自定义"
              placeholderTextColor={palette.muted}
              returnKeyType="search"
              style={styles.searchInput}
            />
            {searching ? <ActivityIndicator size="small" color={palette.brand} /> : null}
            {query.trim() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="清空搜索"
                hitSlop={10}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                onPress={() => setQuery('')}
              >
                <X size={18} color={palette.secondary} />
              </Pressable>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="新建自定义食物"
            style={({ pressed }) => [styles.customEntry, pressed && styles.pressed]}
            onPress={openCustom}
          >
            <View style={styles.flex}>
              <Text style={styles.customEntryTitle}>没有找到？直接自定义</Text>
              <Text style={styles.customEntrySubtitle}>不拍照，不走 AI，填一次后下次可复用</Text>
            </View>
            <View style={styles.customEntryButton}>
              <Plus size={16} color="#ffffff" />
              <Text style={styles.customEntryButtonText}>{query.trim() ? '按搜索词新建' : '新建'}</Text>
            </View>
          </Pressable>

          {customOpen ? (
            <View style={styles.customPanel}>
              <View style={styles.sectionHeader}>
                <View style={styles.flex}>
                  <Text style={styles.sectionTitle}>自定义食物</Text>
                  <Text style={styles.sectionSubtitle}>营养标示可按包装上的 kJ 原样填写</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="收起自定义食物"
                  style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                  onPress={() => setCustomOpen(false)}
                >
                  <Text style={styles.textButtonLabel}>收起</Text>
                </Pressable>
              </View>

              <View style={styles.imageRow}>
                <View style={styles.imagePreview}>
                  {customImageLocal ? (
                    <Image source={{ uri: customImageLocal }} style={styles.image} />
                  ) : uploadingImage ? (
                    <ActivityIndicator color={palette.brand} />
                  ) : (
                    <ImagePlus size={28} color={palette.muted} />
                  )}
                </View>
                <View style={[styles.flex, styles.imageActions]}>
                  <Text style={styles.fieldLabel}>食物图片（可选）</Text>
                  <View style={styles.inlineButtons}>
                    <SmallAction icon={Camera} label="拍照" palette={palette} styles={styles} onPress={() => void pickCustomImage('camera')} />
                    <SmallAction icon={ImagePlus} label="相册" palette={palette} styles={styles} onPress={() => void pickCustomImage('library')} />
                    {customImageLocal ? (
                      <SmallAction icon={Trash2} label="移除" danger palette={palette} styles={styles} onPress={() => {
                        setCustomImageLocal('')
                        setCustomImageRemote('')
                      }} />
                    ) : null}
                  </View>
                </View>
              </View>

              <FormField
                label="名称"
                value={customName}
                placeholder="例如 家里卤牛肉"
                error={customErrors.name}
                palette={palette}
                styles={styles}
                onChangeText={setCustomName}
                onBlur={() => setCustomTouched((current) => ({ ...current, name: true }))}
              />
              <View style={[styles.twoColumns, compactLayout && styles.oneColumn]}>
                <View style={styles.fieldColumn}>
                  <FormField
                    label="实际重量 g"
                    value={customWeight}
                    error={customErrors.weight}
                    numeric
                    palette={palette}
                    styles={styles}
                    onChangeText={setCustomWeight}
                    onBlur={() => setCustomTouched((current) => ({ ...current, weight: true }))}
                  />
                </View>
                <View style={styles.fieldColumn}>
                  <FormField
                    label="营养标示每 g"
                    value={customBasis}
                    error={customErrors.basis}
                    numeric
                    palette={palette}
                    styles={styles}
                    onChangeText={setCustomBasis}
                    onBlur={() => setCustomTouched((current) => ({ ...current, basis: true }))}
                  />
                </View>
              </View>
              <View style={styles.chipRow}>
                {['100', '60', '30'].map((basis) => (
                  <ChoiceChip
                    key={basis}
                    label={'每' + basis + 'g'}
                    selected={customBasis === basis}
                    palette={palette}
                    styles={styles}
                    onPress={() => setCustomBasis(basis)}
                  />
                ))}
              </View>

              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>热量 / 标示</Text>
                <View style={styles.energySwitch}>
                  {(['kj', 'kcal'] as CustomEnergyUnit[]).map((unit) => (
                    <ChoiceChip
                      key={unit}
                      label={unit === 'kj' ? 'kJ' : 'kcal'}
                      selected={customEnergyUnit === unit}
                      palette={palette}
                      styles={styles}
                      onPress={() => setCustomEnergyUnit(unit)}
                      compact
                    />
                  ))}
                </View>
              </View>
              <TextInput
                accessibilityLabel="热量"
                value={customEnergy}
                onChangeText={setCustomEnergy}
                onBlur={() => setCustomTouched((current) => ({ ...current, energy: true }))}
                keyboardType="decimal-pad"
                placeholder="必填"
                placeholderTextColor={palette.muted}
                style={[styles.input, customErrors.energy ? styles.inputError : null]}
              />
              {customErrors.energy ? <Text style={styles.errorText}>{customErrors.energy}</Text> : null}
              <Text style={styles.helperText}>
                {customEnergyUnit === 'kj'
                  ? '保存时自动换算为 kcal，1 kcal = 4.184 kJ'
                  : '可切回 kJ，直接照包装营养表填写'}
              </Text>

              <View style={[styles.twoColumns, compactLayout && styles.oneColumn]}>
                {[
                  ['蛋白质 g / 标示', customProtein, setCustomProtein],
                  ['碳水 g / 标示', customCarbs, setCustomCarbs],
                  ['脂肪 g / 标示', customFat, setCustomFat],
                ].map(([label, value, setter]) => (
                  <View key={label as string} style={styles.fieldColumn}>
                    <FormField
                      label={label as string}
                      value={value as string}
                      placeholder="可选"
                      numeric
                      palette={palette}
                      styles={styles}
                      onChangeText={setter as (value: string) => void}
                    />
                  </View>
                ))}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: customMore }}
                style={({ pressed }) => [styles.moreToggle, pressed && styles.pressed]}
                onPress={() => setCustomMore((current) => !current)}
              >
                <Text style={styles.moreToggleText}>维生素 / 矿物质</Text>
                {customMore
                  ? <ChevronUp size={19} color={palette.secondary} />
                  : <ChevronDown size={19} color={palette.secondary} />}
              </Pressable>
              {customMore ? (
                <View style={[styles.twoColumns, compactLayout && styles.oneColumn]}>
                  {MICRO_FIELDS.map(([key, label, unit]) => (
                    <View key={key} style={styles.fieldColumn}>
                      <FormField
                        label={label + ' ' + unit + ' / 标示'}
                        value={customMicro[key] || ''}
                        placeholder="可选"
                        numeric
                        palette={palette}
                        styles={styles}
                        onChangeText={(value) => setCustomMicro((current) => ({ ...current, [key]: value }))}
                      />
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.customActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                  onPress={resetCustom}
                >
                  <RefreshCw size={17} color={palette.secondary} />
                  <Text style={styles.secondaryButtonText}>清空</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: customSaving || uploadingImage }}
                  disabled={customSaving || uploadingImage}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (customSaving || uploadingImage) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => void completeCustom()}
                >
                  {customSaving ? <ActivityIndicator color="#ffffff" /> : (
                    <>
                      <Check size={18} color="#ffffff" />
                      <Text style={styles.primaryButtonText}>完成自定义</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.catalogCard}>
          {!query.trim() ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
              accessibilityRole="tablist"
            >
              {categories.map((item) => (
                <ChoiceChip
                  key={item.key}
                  label={item.label}
                  selected={category === item.key}
                  palette={palette}
                  styles={styles}
                  onPress={() => selectCategory(item.key)}
                />
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.catalogHeader}>
            <View style={styles.flex}>
              <Text style={styles.sectionTitle}>{query.trim() ? '搜索结果' : activeCategoryLabel}</Text>
              <Text style={styles.sectionSubtitle}>
                {query.trim() ? '围绕“' + query.trim() + '”优先展示精准匹配' : statsText}
              </Text>
            </View>
          </View>

          {contentLoading ? (
            <FoodListSkeleton styles={styles} />
          ) : loadError && !visibleItems.length ? (
            <View style={styles.stateBox}>
              <AlertTriangle size={28} color={palette.danger} />
              <Text style={styles.stateTitle}>食物库暂时无法读取</Text>
              <Text style={styles.stateText}>{loadError}</Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                onPress={() => void loadAll(false)}
              >
                <RefreshCw size={17} color={palette.brandStrong} />
                <Text style={styles.retryText}>重新加载</Text>
              </Pressable>
            </View>
          ) : visibleItems.length ? (
            <View>
              {visibleItems.map((item, index) => (
                <FoodChoiceRow
                  key={foodKey(item) + ':' + index}
                  item={item}
                  selected={selectedKeys.has(foodKey(item))}
                  palette={palette}
                  styles={styles}
                  onPress={() => addFood(item)}
                />
              ))}
              {!query.trim() && hasMore && category !== 'custom' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: loadingMore }}
                  disabled={loadingMore}
                  style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
                  onPress={() => void loadCatalog(category, catalogPage + 1, true)}
                >
                  {loadingMore ? <ActivityIndicator color={palette.brand} /> : (
                    <>
                      <ChevronDown size={18} color={palette.brandStrong} />
                      <Text style={styles.loadMoreText}>继续加载更多</Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.stateBox}>
              <Search size={28} color={palette.muted} />
              <Text style={styles.stateTitle}>{query.trim() ? '没有找到匹配食物' : '暂无可用食物'}</Text>
              <Text style={styles.stateText}>{query.trim() ? '可以按这个名称直接新建，之后还能重复使用。' : '换一个分类，或下拉刷新再试。'}</Text>
              {query.trim() ? (
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                  onPress={openCustom}
                >
                  <Plus size={17} color={palette.brandStrong} />
                  <Text style={styles.retryText}>新建“{query.trim()}”</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {selected.length ? (
          <View style={styles.configCard}>
            <OptionGroup title="饮食目标" value={dietGoal} options={DIET_GOALS} palette={palette} styles={styles} onChange={setDietGoal} />
            <View style={styles.divider} />
            <OptionGroup title="运动时机" value={activityTiming} options={ACTIVITY_TIMINGS} palette={palette} styles={styles} onChange={setActivityTiming} />
          </View>
        ) : null}
      </ScrollView>

      {selected.length ? (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'查看已选 ' + selected.length + ' 项食物'}
            style={({ pressed }) => [styles.bottomSummary, pressed && styles.pressed]}
            onPress={() => setDrawerOpen(true)}
          >
            <Text style={styles.bottomSummaryMain}>已选 {selected.length} 项 · {Math.round(totals.calories)} kcal</Text>
            <Text style={styles.bottomSummarySub}>共 {Math.round(totals.weight)}g · 点击调整</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            style={({ pressed }) => [styles.saveButton, saving && styles.disabled, pressed && styles.pressed]}
            onPress={() => void save()}
          >
            {saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>保存本餐</Text>}
          </Pressable>
        </View>
      ) : null}

      <Modal
        transparent
        visible={drawerOpen}
        animationType="slide"
        onRequestClose={() => setDrawerOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.scrim} onPress={() => setDrawerOpen(false)}>
          <Pressable
            accessibilityViewIsModal
            style={[styles.drawer, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.drawerHandle} />
            <View style={styles.drawerHeader}>
              <View style={styles.flex}>
                <Text style={styles.drawerTitle}>已选食物</Text>
                <Text style={styles.drawerSubtitle}>{selected.length} 项 · {Math.round(totals.calories)} kcal</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭已选食物"
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                onPress={() => setDrawerOpen(false)}
              >
                <X size={22} color={palette.secondary} />
              </Pressable>
            </View>
            <View style={styles.totalGrid}>
              <Summary value={Math.round(totals.calories)} label="热量 kcal" styles={styles} />
              <Summary value={round(totals.protein)} label="蛋白质 g" styles={styles} />
              <Summary value={round(totals.carbs)} label="碳水 g" styles={styles} />
              <Summary value={round(totals.fat)} label="脂肪 g" styles={styles} />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.selectedScroll}
              contentContainerStyle={styles.selectedList}
            >
              {selected.map((entry) => (
                <SelectedFoodCard
                  key={entry.key}
                  entry={entry}
                  palette={palette}
                  styles={styles}
                  onInput={(value) => updateWeightInput(entry.key, value)}
                  onBlur={() => commitWeight(entry.key)}
                  onSetWeight={(weight) => setWeight(entry.key, weight)}
                  onRemove={() => setSelected((current) => current.filter((item) => item.key !== entry.key))}
                />
              ))}
            </ScrollView>
            <View style={styles.drawerActions}>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondaryButton, styles.drawerAction, pressed && styles.pressed]}
                onPress={() => setDrawerOpen(false)}
              >
                <Text style={styles.secondaryButtonText}>继续添加</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                disabled={saving}
                style={({ pressed }) => [styles.primaryButton, styles.drawerAction, saving && styles.disabled, pressed && styles.pressed]}
                onPress={() => void save()}
              >
                {saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>保存本餐</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  )
}

function SmallAction({
  icon: Icon,
  label,
  danger,
  palette,
  styles,
  onPress,
}: {
  icon: LucideIcon
  label: string
  danger?: boolean
  palette: Palette
  styles: ReturnType<typeof createStyles>
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.smallAction, danger && styles.smallActionDanger, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Icon size={16} color={danger ? palette.danger : palette.brandStrong} />
      <Text style={[styles.smallActionText, danger && { color: palette.danger }]}>{label}</Text>
    </Pressable>
  )
}

function FormField({
  label,
  value,
  placeholder,
  error,
  numeric: isNumeric,
  palette,
  styles,
  onChangeText,
  onBlur,
}: {
  label: string
  value: string
  placeholder?: string
  error?: string
  numeric?: boolean
  palette: Palette
  styles: ReturnType<typeof createStyles>
  onChangeText: (value: string) => void
  onBlur?: () => void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        keyboardType={isNumeric ? 'decimal-pad' : 'default'}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}
    </View>
  )
}

function ChoiceChip({
  label,
  selected,
  compact: isCompact,
  styles,
  onPress,
}: {
  label: string
  selected: boolean
  compact?: boolean
  palette: Palette
  styles: ReturnType<typeof createStyles>
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.chip,
        isCompact && styles.chipCompact,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      {selected ? <Check size={15} color={styles.chipTextSelected.color} strokeWidth={2.5} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  )
}

function FoodChoiceRow({
  item,
  selected,
  palette,
  styles,
  onPress,
}: {
  item: ManualFoodExtended
  selected: boolean
  palette: Palette
  styles: ReturnType<typeof createStyles>
  onPress: () => void
}) {
  const image = foodImage(item)
  const calories = Math.round(numeric(item.total_calories ?? item.calories))
  const protein = round(numeric(item.total_protein ?? item.protein))
  const hint = item.nutrition_highlights?.join(' · ') || String(item.recommend_reason || '')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={(selected ? '再添加一份' : '添加') + foodTitle(item)}
      style={({ pressed }) => [styles.foodRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      {image ? (
        <Image source={{ uri: image }} style={styles.foodImage} />
      ) : (
        <View style={styles.foodImagePlaceholder}>
          <Utensils size={20} color={palette.brand} />
        </View>
      )}
      <View style={styles.flex}>
        <View style={styles.foodNameRow}>
          <Text style={styles.foodName} numberOfLines={2}>{foodTitle(item)}</Text>
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceBadgeText} numberOfLines={1}>{sourceLabel(item)}</Text>
          </View>
        </View>
        <Text style={styles.foodMeta} numberOfLines={1}>{calories} kcal / {resultPortion(item)} · 蛋白 {protein}g</Text>
        {hint ? <Text style={styles.foodHint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      <View style={[styles.addButton, selected && styles.addButtonSelected]}>
        {selected ? <Check size={18} color={palette.brandStrong} /> : <Plus size={20} color={palette.brandStrong} />}
      </View>
    </Pressable>
  )
}

function SelectedFoodCard({
  entry,
  palette,
  styles,
  onInput,
  onBlur,
  onSetWeight,
  onRemove,
}: {
  entry: SelectedFood
  palette: Palette
  styles: ReturnType<typeof createStyles>
  onInput: (value: string) => void
  onBlur: () => void
  onSetWeight: (weight: number) => void
  onRemove: () => void
}) {
  const nutrients = scaledNutrition(entry.item, entry.weight, entry.defaultWeight)
  const image = foodImage(entry.item)
  const unit = entry.displayUnitLabel
  const defaultPresets = entry.servingPresets.length
    ? entry.servingPresets
    : [0.25, 0.5, 1].map((ratio) => ({ label: String(Math.round(ratio * 100)) + '%', grams: entry.defaultWeight * ratio }))
  const adjust = entry.displayUnit === 'g' || entry.displayUnit === 'ml' ? 10 : entry.defaultWeight * 0.25
  return (
    <View style={styles.selectedCard}>
      <View style={styles.selectedHeader}>
        {image ? <Image source={{ uri: image }} style={styles.selectedImage} /> : (
          <View style={styles.selectedImagePlaceholder}><Utensils size={18} color={palette.brand} /></View>
        )}
        <View style={styles.flex}>
          <Text style={styles.selectedName} numberOfLines={2}>{foodTitle(entry.item)}</Text>
          <Text style={styles.selectedMeta}>{sourceLabel(entry.item)} · {Math.round(nutrients.calories)} kcal</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'移除' + foodTitle(entry.item)}
          style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
          onPress={onRemove}
        >
          <Trash2 size={18} color={palette.danger} />
        </Pressable>
      </View>
      <View style={styles.amountRow}>
        <Text style={styles.fieldLabel}>本次份量</Text>
        <View style={styles.amountInputWrap}>
          <TextInput
            accessibilityLabel={foodTitle(entry.item) + '份量'}
            value={entry.weightInput}
            onChangeText={onInput}
            onBlur={onBlur}
            keyboardType="decimal-pad"
            style={styles.amountInput}
          />
          <Text style={styles.amountUnit}>{unit}</Text>
        </View>
        <Text style={styles.gramHint}>约 {compact(entry.weight)}g</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
        <ChoiceChip label={'−' + compact(entry.displayUnit === 'g' || entry.displayUnit === 'ml' ? adjust : adjust / entry.defaultWeight, 2) + unit} selected={false} palette={palette} styles={styles} onPress={() => onSetWeight(Math.max(0.01, entry.weight - adjust))} />
        {defaultPresets.map((preset) => (
          <ChoiceChip key={preset.label} label={preset.label} selected={Math.abs(entry.weight - preset.grams) < 0.01} palette={palette} styles={styles} onPress={() => onSetWeight(preset.grams)} />
        ))}
        <ChoiceChip label={'+' + compact(entry.displayUnit === 'g' || entry.displayUnit === 'ml' ? adjust : adjust / entry.defaultWeight, 2) + unit} selected={false} palette={palette} styles={styles} onPress={() => onSetWeight(entry.weight + adjust)} />
      </ScrollView>
    </View>
  )
}

function OptionGroup<T extends string>({
  title,
  value,
  options,
  palette,
  styles,
  onChange,
}: {
  title: string
  value: T
  options: Array<{ value: T; label: string }>
  palette: Palette
  styles: ReturnType<typeof createStyles>
  onChange: (value: T) => void
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.optionRow}>
        {options.map((option) => (
          <ChoiceChip
            key={option.value}
            label={option.label}
            selected={value === option.value}
            palette={palette}
            styles={styles}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  )
}

function Summary({ value, label, styles }: { value: string | number; label: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  )
}

function FoodListSkeleton({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View accessibilityLabel="正在读取食物">
      {[0, 1, 2, 3].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <View style={styles.skeletonImage} />
          <View style={styles.flex}>
            <View style={[styles.skeletonLine, { width: '62%' }]} />
            <View style={[styles.skeletonLine, { width: '88%' }]} />
          </View>
        </View>
      ))}
    </View>
  )
}

function createStyles(p: Palette) {
  return StyleSheet.create({
    page: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 },
    flex: { flex: 1, minWidth: 0 },
    workspaceCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surface,
      padding: 16,
      shadowColor: p.shadow,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
      elevation: 2,
    },
    workspaceHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
    workspaceTitle: { color: p.text, fontSize: 19, lineHeight: 26, fontWeight: '900' },
    workspaceSubtitle: { color: p.secondary, fontSize: 13, lineHeight: 19, marginTop: 3 },
    caloriesPill: {
      minWidth: 86,
      minHeight: 60,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.brandWash,
      paddingHorizontal: 12,
    },
    caloriesValue: { color: p.brandStrong, fontSize: 24, lineHeight: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
    caloriesUnit: { color: p.secondary, fontSize: 11, fontWeight: '700' },
    mealGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    meal: {
      width: '31.5%',
      minHeight: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surfaceAlt,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 8,
    },
    mealActive: { borderColor: p.brand, backgroundColor: p.brandSoft },
    mealText: { color: p.secondary, fontSize: 13, lineHeight: 18, fontWeight: '700' },
    mealTextActive: { color: p.brandStrong, fontWeight: '900' },
    dateRow: {
      minHeight: 50,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surfaceAlt,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      marginBottom: 10,
    },
    dateLabel: { color: p.secondary, fontSize: 13, fontWeight: '800' },
    dateHint: { color: p.brandStrong, fontSize: 12, fontWeight: '800' },
    dateInput: { flex: 1, minHeight: 48, color: p.text, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
    searchBar: {
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surfaceAlt,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
    },
    searchInput: { flex: 1, minHeight: 50, paddingVertical: 0, color: p.text, fontSize: 15 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
    customEntry: {
      minHeight: 74,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: p.brandSoft,
      backgroundColor: p.brandWash,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      marginTop: 10,
    },
    customEntryTitle: { color: p.text, fontSize: 15, lineHeight: 21, fontWeight: '900' },
    customEntrySubtitle: { color: p.secondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
    customEntryButton: {
      minHeight: 44,
      minWidth: 74,
      borderRadius: 22,
      backgroundColor: p.brand,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 12,
    },
    customEntryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
    customPanel: {
      marginTop: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surfaceAlt,
      padding: 12,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
    sectionTitle: { color: p.text, fontSize: 16, lineHeight: 22, fontWeight: '900' },
    sectionSubtitle: { color: p.secondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
    textButton: { minHeight: 44, minWidth: 52, alignItems: 'center', justifyContent: 'center' },
    textButtonLabel: { color: p.brandStrong, fontSize: 13, fontWeight: '900' },
    imageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    imagePreview: {
      width: 84,
      height: 84,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surfaceStrong,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    image: { width: '100%', height: '100%' },
    imageActions: { gap: 8 },
    inlineButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    smallAction: {
      minHeight: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingHorizontal: 12,
    },
    smallActionDanger: { borderColor: p.danger, backgroundColor: p.dangerSoft },
    smallActionText: { color: p.brandStrong, fontSize: 12, fontWeight: '800' },
    field: { marginBottom: 10 },
    fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    fieldLabel: { color: p.secondary, fontSize: 13, lineHeight: 19, fontWeight: '800', marginBottom: 6 },
    input: {
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surface,
      color: p.text,
      fontSize: 15,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    inputError: { borderColor: p.danger },
    errorText: { color: p.danger, fontSize: 12, lineHeight: 18, marginTop: 4 },
    helperText: { color: p.muted, fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 10 },
    twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    oneColumn: { flexDirection: 'column', gap: 0 },
    fieldColumn: { flexGrow: 1, flexBasis: 138, minWidth: 0 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    energySwitch: { flexDirection: 'row', gap: 6 },
    chip: {
      minHeight: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surfaceAlt,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingHorizontal: 14,
    },
    chipCompact: { minHeight: 40, paddingHorizontal: 12 },
    chipSelected: { borderColor: p.brand, backgroundColor: p.brandSoft },
    chipText: { color: p.secondary, fontSize: 13, lineHeight: 18, fontWeight: '800' },
    chipTextSelected: { color: p.brandStrong, fontWeight: '900' },
    moreToggle: {
      minHeight: 50,
      borderTopWidth: 1,
      borderTopColor: p.divider,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    moreToggleText: { color: p.text, fontSize: 14, fontWeight: '900' },
    customActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
    secondaryButton: {
      minHeight: 50,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingHorizontal: 16,
    },
    secondaryButtonText: { color: p.secondary, fontSize: 14, fontWeight: '900' },
    primaryButton: {
      flex: 1,
      minHeight: 50,
      borderRadius: 14,
      backgroundColor: p.brand,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingHorizontal: 16,
    },
    primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
    catalogCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surface,
      padding: 14,
      marginTop: 12,
      overflow: 'hidden',
    },
    categoryRow: { gap: 8, paddingBottom: 14 },
    catalogHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
    foodRow: {
      minHeight: 84,
      borderBottomWidth: 1,
      borderBottomColor: p.divider,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
    },
    foodImage: { width: 54, height: 54, borderRadius: 12, backgroundColor: p.surfaceStrong },
    foodImagePlaceholder: {
      width: 54,
      height: 54,
      borderRadius: 12,
      backgroundColor: p.brandWash,
      alignItems: 'center',
      justifyContent: 'center',
    },
    foodNameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    foodName: { flex: 1, color: p.text, fontSize: 14, lineHeight: 20, fontWeight: '900' },
    sourceBadge: {
      maxWidth: 84,
      minHeight: 24,
      borderRadius: 12,
      backgroundColor: p.brandWash,
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    sourceBadgeText: { color: p.brandStrong, fontSize: 10, fontWeight: '900' },
    foodMeta: { color: p.secondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
    foodHint: { color: p.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
    addButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButtonSelected: { borderColor: p.brand, backgroundColor: p.brandSoft },
    loadMore: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 6,
    },
    loadMoreText: { color: p.brandStrong, fontSize: 13, fontWeight: '900' },
    stateBox: { minHeight: 240, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
    stateTitle: { color: p.text, fontSize: 16, lineHeight: 22, fontWeight: '900', marginTop: 12 },
    stateText: { color: p.secondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 5 },
    retryButton: {
      minHeight: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: p.brand,
      backgroundColor: p.brandWash,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 18,
      marginTop: 14,
    },
    retryText: { color: p.brandStrong, fontSize: 13, fontWeight: '900' },
    skeletonRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: p.divider },
    skeletonImage: { width: 54, height: 54, borderRadius: 12, backgroundColor: p.surfaceStrong },
    skeletonLine: { height: 12, borderRadius: 6, backgroundColor: p.surfaceStrong, marginVertical: 5 },
    configCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.surface,
      padding: 16,
      marginTop: 12,
    },
    optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    divider: { height: 1, backgroundColor: p.divider, marginVertical: 16 },
    bottomBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      minHeight: 82,
      borderTopWidth: 1,
      borderTopColor: p.border,
      backgroundColor: p.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    bottomSummary: { flex: 1, minHeight: 52, justifyContent: 'center' },
    bottomSummaryMain: { color: p.text, fontSize: 14, lineHeight: 20, fontWeight: '900' },
    bottomSummarySub: { color: p.secondary, fontSize: 12, lineHeight: 18, marginTop: 2 },
    saveButton: {
      minWidth: 124,
      minHeight: 52,
      borderRadius: 26,
      backgroundColor: p.brand,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    saveButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
    scrim: { flex: 1, backgroundColor: p.scrim, justifyContent: 'flex-end' },
    drawer: {
      maxHeight: '88%',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: p.surface,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    drawerHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: p.border, alignSelf: 'center', marginBottom: 12 },
    drawerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    drawerTitle: { color: p.text, fontSize: 20, lineHeight: 27, fontWeight: '900' },
    drawerSubtitle: { color: p.secondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
    closeButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surfaceAlt },
    totalGrid: { flexDirection: 'row', gap: 7, marginVertical: 12 },
    summaryCell: { flex: 1, minWidth: 0, minHeight: 62, borderRadius: 12, backgroundColor: p.brandWash, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    summaryValue: { color: p.brandStrong, fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
    summaryLabel: { color: p.secondary, fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 2 },
    selectedScroll: { maxHeight: 440 },
    selectedList: { gap: 10, paddingBottom: 8 },
    selectedCard: { borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.surfaceAlt, padding: 12 },
    selectedHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    selectedImage: { width: 46, height: 46, borderRadius: 10, backgroundColor: p.surfaceStrong },
    selectedImagePlaceholder: { width: 46, height: 46, borderRadius: 10, backgroundColor: p.brandWash, alignItems: 'center', justifyContent: 'center' },
    selectedName: { color: p.text, fontSize: 14, lineHeight: 20, fontWeight: '900' },
    selectedMeta: { color: p.secondary, fontSize: 12, lineHeight: 18, marginTop: 2 },
    removeButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: p.dangerSoft, alignItems: 'center', justifyContent: 'center' },
    amountRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    amountInputWrap: { minWidth: 96, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
    amountInput: { minWidth: 48, minHeight: 46, color: p.text, fontSize: 15, fontWeight: '800', textAlign: 'right', fontVariant: ['tabular-nums'] },
    amountUnit: { color: p.secondary, fontSize: 13, fontWeight: '800', marginLeft: 4 },
    gramHint: { flex: 1, color: p.muted, fontSize: 12, textAlign: 'right' },
    presetRow: { gap: 8, paddingTop: 4 },
    drawerActions: { flexDirection: 'row', gap: 10, paddingTop: 10 },
    drawerAction: { flex: 1 },
    disabled: { opacity: 0.48 },
    pressed: { opacity: 0.72 },
  })
}
