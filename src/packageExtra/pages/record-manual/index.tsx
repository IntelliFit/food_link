import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import { useState, useEffect, useMemo } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAccessToken,
  saveFoodRecord,
  fetchManualFoodCatalog,
  searchManualFood,
  showUnifiedApiError,
  type CanonicalMealType,
  type ManualFoodCatalogCategory,
  type ManualFoodCatalogResult,
  type ManualFoodSearchResult,
  type Nutrients,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../../../utils/home-dashboard-local-cache'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { getStoredRecordTargetDate, persistRecordTargetDate } from '../../../utils/record-date'
import { useAppColorScheme } from '../../../components/AppColorSchemeContext'
import { applyThemeNavigationBar } from '../../../utils/theme-navigation-bar'
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

interface ServingPreset {
  label: string
  grams: number
  quantity: number
}

interface SelectedItem {
  id: string
  source: 'public_library' | 'nutrition_library'
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

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getItemKey(item: { source: string; id: string }) {
  return `${item.source}:${item.id}`
}

function roundToSingle(value: number) {
  return Math.round(value * 10) / 10
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
    const defaultWeight = Math.max(1, Math.round(item.default_weight_grams || remotePresets[0]?.grams || 100))
    return {
      defaultWeight,
      displayUnit: remoteUnit,
      displayUnitLabel: item.display_unit_label || (remoteUnit === 'piece' ? '个' : remoteUnit === 'serving' ? '份' : remoteUnit),
      portionLabel: item.portion_label || (remoteUnit === 'serving' ? '1份' : remoteUnit === 'piece' ? '1个' : `${defaultWeight}${remoteUnit}`),
      servingPresets: remotePresets,
    }
  }

  if (item.source === 'public_library') {
    const defaultWeight = Math.max(1, Math.round(item.default_weight_grams || 1))
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

  const defaultWeight = Math.max(1, Math.round(item.default_weight_grams || 100))
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
  return `${Math.round(item.weight)}${item.displayUnitLabel}`
}

function formatWeightInput(item: Pick<SelectedItem, 'weight' | 'defaultWeight' | 'displayUnit'>, nextWeight = item.weight) {
  if (item.displayUnit === 'serving') {
    return String(roundToSingle(nextWeight / item.defaultWeight))
  }
  if (item.displayUnit === 'piece') {
    return String(roundToSingle(nextWeight / 55))
  }
  return String(Math.round(nextWeight))
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
  if (item.display_unit === 'ml') return `${Math.round(item.default_weight_grams || 350)}ml`
  if (item.display_unit === 'serving') return '1份'
  if (isEggLikeFood(item.title)) return '1个'
  if (isBeverageLikeFood(item.title) || isSoupLikeFood(item.title)) {
    const fallbackVolume = isSoupLikeFood(item.title) ? 250 : 350
    return `${Math.round(item.default_weight_grams && item.default_weight_grams !== 100 ? item.default_weight_grams : fallbackVolume)}ml`
  }
  if (item.source === 'public_library') return '1份'
  if (item.portion_label) return item.portion_label
  return item.source === 'nutrition_library' ? '100g' : '1份'
}

function buildNutrientsFromWeight(
  item: Pick<SelectedItem, 'defaultWeight' | 'baseNutrients' | 'nutrientsPer100g'>,
  weight: number
) {
  const safeWeight = Math.max(1, weight)
  if (item.nutrientsPer100g) {
    const scale = safeWeight / 100
    return {
      calories: roundToSingle(item.nutrientsPer100g.calories * scale),
      protein: roundToSingle(item.nutrientsPer100g.protein * scale),
      carbs: roundToSingle(item.nutrientsPer100g.carbs * scale),
      fat: roundToSingle(item.nutrientsPer100g.fat * scale),
      fiber: roundToSingle((item.nutrientsPer100g.fiber || 0) * scale),
      sugar: roundToSingle((item.nutrientsPer100g.sugar || 0) * scale),
      sodium_mg: roundToSingle((item.nutrientsPer100g.sodium_mg || 0) * scale),
    }
  }

  const ratio = item.defaultWeight > 0 ? safeWeight / item.defaultWeight : 1
  return {
    calories: roundToSingle(item.baseNutrients.calories * ratio),
    protein: roundToSingle(item.baseNutrients.protein * ratio),
    carbs: roundToSingle(item.baseNutrients.carbs * ratio),
    fat: roundToSingle(item.baseNutrients.fat * ratio),
    fiber: roundToSingle((item.baseNutrients.fiber || 0) * ratio),
    sugar: roundToSingle((item.baseNutrients.sugar || 0) * ratio),
    sodium_mg: roundToSingle((item.baseNutrients.sodium_mg || 0) * ratio),
  }
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

  const normalizedQuery = searchText.trim()

  useEffect(() => {
    const params = Taro.getCurrentInstance().router?.params
    persistRecordTargetDate(String(params?.date || ''))
    const storedMeal = Taro.getStorageSync('analyzeMealType')
    const matchedMeal = typeof storedMeal === 'string'
      ? MEALS.find((meal) => meal.id === storedMeal)
      : undefined
    if (matchedMeal) {
      setSelectedMeal(matchedMeal.id)
    } else {
      setSelectedMeal(inferDefaultMealTypeFromLocalTime())
    }
    loadCatalog('common', 1, true)
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  }, [scheme])

  const loadCatalog = async (category: string, page: number = 1, replace: boolean = true) => {
    if (replace) {
      setCatalogLoading(true)
    } else {
      setCatalogLoadingMore(true)
    }
    try {
      const data = await fetchManualFoodCatalog(category, page, 30)
      setCatalogData(data)
      setCatalogPage(data.page)
      setCatalogHasMore(Boolean(data.has_more))
      setCatalogItems((prev) => replace ? data.items : [...prev, ...data.items])
    } catch (e: any) {
      await showUnifiedApiError(e, '加载食物目录失败')
    } finally {
      setCatalogLoading(false)
      setCatalogLoadingMore(false)
    }
  }

  const handleSelectCategory = (category: string) => {
    if (category === activeCategory) return
    setActiveCategory(category)
    setSearchText('')
    setSearchResults([])
    loadCatalog(category, 1, true)
  }

  const handleLoadMoreCatalog = () => {
    if (catalogLoading || catalogLoadingMore || !catalogHasMore || normalizedQuery) return
    loadCatalog(activeCategory, catalogPage + 1, false)
  }

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

  const visibleItems = useMemo(() => {
    const items = normalizedQuery ? searchResults : catalogItems
    const seen = new Set<string>()
    return items
      .filter((item) => {
        const key = getItemKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [catalogItems, normalizedQuery, searchResults])

  const statsText = useMemo(() => {
    const nutritionCount = catalogData?.stats?.nutrition_food_count || 0
    const publicCount = catalogData?.stats?.public_food_count || 0
    if (normalizedQuery) {
      return `已找到 ${visibleItems.length} 个结果`
    }
    return `${catalogItems.length} 个常用食物 · ${nutritionCount} 个标准食物 · ${publicCount} 个真实餐食`
  }, [catalogData, catalogItems.length, normalizedQuery, visibleItems.length])

  const categories = catalogData?.categories?.length ? catalogData.categories : DEFAULT_CATALOG_CATEGORIES
  const activeCategoryLabel = categories.find((item) => item.key === activeCategory)?.label || '常见'

  const handleAddItem = (item: ManualFoodSearchResult) => {
    const key = getItemKey(item)
    Taro.vibrateShort({ type: 'light' }).catch(() => {})
    setSelectedItems(prev => {
      const index = prev.findIndex((selected) => getItemKey(selected) === key)
      const servingProfile = inferServingProfile(item)
      const defaultWeight = servingProfile.defaultWeight
      const baseNutrients = {
        calories: roundToSingle(item.total_calories),
        protein: roundToSingle(item.total_protein),
        carbs: roundToSingle(item.total_carbs),
        fat: roundToSingle(item.total_fat),
        fiber: roundToSingle(item.extra_nutrients?.fiber || item.nutrients_per_100g?.fiber || 0),
        sugar: roundToSingle(item.extra_nutrients?.sugar || item.nutrients_per_100g?.sugar || 0),
        sodium_mg: roundToSingle(item.extra_nutrients?.sodium_mg || item.nutrients_per_100g?.sodium_mg || 0),
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
            imagePath: item.image_path || item.image_paths?.[0] || null,
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
        const safeWeight = Math.max(1, Math.round(nextWeight))
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
        nutrients: {
          calories: item.nutrients.calories,
          protein: item.nutrients.protein,
          carbs: item.nutrients.carbs,
          fat: item.nutrients.fat,
          fiber: item.nutrients.fiber || 0,
          sugar: item.nutrients.sugar || 0,
          sodium_mg: item.nutrients.sodium_mg || 0,
        } as Nutrients,
        manual_source: item.source,
        manual_source_id: item.id,
        manual_source_title: item.title,
        manual_portion_label: item.portionLabel,
      }))
      const totalWeight = selectedItems.reduce((s, i) => s + i.weight, 0)
      
      await saveFoodRecord({
        date: getStoredRecordTargetDate(),
        meal_type: selectedMeal as any,
        diet_goal: dietGoal as any,
        activity_timing: activityTiming as any,
        description: '手动记录：' + selectedItems.map(i => i.title).join('、'),
        insight: '手动记录，数据来自食物词典',
        items,
        total_calories: Math.round(totalNutrients.calories * 10) / 10,
        total_protein: Math.round(totalNutrients.protein * 10) / 10,
        total_carbs: Math.round(totalNutrients.carbs * 10) / 10,
        total_fat: Math.round(totalNutrients.fat * 10) / 10,
        total_weight_grams: totalWeight,
      })
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT)
      } catch {
        /* ignore */
      }
      const targetDate = getStoredRecordTargetDate()
      void refreshHomeDashboardLocalSnapshotFromCloud(targetDate)

      Taro.showToast({ title: '记录成功', icon: 'success' })
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
          {item.image_path || item.image_paths?.[0] ? (
            <Image
              className='food-cover-image'
              src={item.image_path || item.image_paths?.[0] || ''}
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
              <Text>{item.source_label || (item.source === 'public_library' ? '真实餐食' : '标准食物')}</Text>
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
      <ScrollView className='content-scroll' scrollY>
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
              placeholder='搜索标准食物、菜名、商家餐'
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

        </View>

        {selectedItems.length > 0 && (
          <View className='selected-section'>
            <View className='section-header'>
              <Text className='section-title'>已选食物（{selectedItems.length}）</Text>
              <View className='total-calories'>
                <Text>{Math.round(totalNutrients.calories)}</Text>
                <Text className='unit'>kcal</Text>
              </View>
            </View>
            
            <View className='selected-list'>
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
                      type='number'
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
            
            <View className='nutrition-total'>
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
          </View>
        )}

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
                  <View className='load-more' onClick={handleLoadMoreCatalog}>
                    <Text>{catalogLoadingMore ? '加载中' : '加载更多'}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View className='empty-state'>
                <Text>{normalizedQuery ? '没有找到匹配食物，试试“米饭”“鸡蛋”这类关键词' : '暂无可用食物数据'}</Text>
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
          <View className='bottom-summary'>
            <Text className='bottom-summary-text'>
              已选 {selectedItems.length} 项 · {Math.round(totalNutrients.calories)} kcal
            </Text>
            <Text className='bottom-summary-subtext'>
              保存后会直接回到今天记录页
            </Text>
          </View>
          <View
            className={`save-btn ${saving ? 'loading' : ''}`}
            onClick={handleSave}
          >
            <Text>{saving ? '保存中...' : '保存到今天记录'}</Text>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(RecordManualPage)
