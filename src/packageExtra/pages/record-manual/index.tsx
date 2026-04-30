import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import { useState, useEffect, useMemo } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import {
  getAccessToken,
  saveFoodRecord,
  browseManualFood,
  searchManualFood,
  showUnifiedApiError,
  type CanonicalMealType,
  type ManualFoodBrowseResult,
  type ManualFoodSearchResult,
  type Nutrients,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../../../utils/home-dashboard-local-cache'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
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

const SOURCE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'recent', label: '最近常吃' },
  { value: 'favorites', label: '收藏餐食' },
  { value: 'public_library', label: '真实餐食' },
  { value: 'nutrition_library', label: '标准食物' },
] as const

type SourceFilter = (typeof SOURCE_FILTERS)[number]['value']

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
  imagePath?: string | null
  recommendReason?: string
  usageCount: number
  collected: boolean
}

interface BrowseSection {
  key: string
  title: string
  subtitle: string
  items: ManualFoodSearchResult[]
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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [browseData, setBrowseData] = useState<ManualFoodBrowseResult | null>(null)
  const [browseLoading, setBrowseLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<ManualFoodSearchResult[]>([])
  const [saving, setSaving] = useState(false)

  const normalizedQuery = searchText.trim()

  useEffect(() => {
    const storedMeal = Taro.getStorageSync('analyzeMealType')
    const matchedMeal = typeof storedMeal === 'string'
      ? MEALS.find((meal) => meal.id === storedMeal)
      : undefined
    if (matchedMeal) {
      setSelectedMeal(matchedMeal.id)
    } else {
      setSelectedMeal(inferDefaultMealTypeFromLocalTime())
    }
    loadBrowseData()
  }, [])

  useDidShow(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  })

  useEffect(() => {
    applyThemeNavigationBar(scheme, { lightBackground: '#f0fdf4' })
  }, [scheme])

  const loadBrowseData = async () => {
    if (browseData) return
    setBrowseLoading(true)
    try {
      const data = await browseManualFood()
      setBrowseData(data)
    } catch (e: any) {
      await showUnifiedApiError(e, '加载食物库失败')
    } finally {
      setBrowseLoading(false)
    }
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

  const filteredItems = useMemo(() => {
    const items = normalizedQuery ? searchResults : []
    return items.filter((item) => {
      if (sourceFilter === 'all') return true
      if (sourceFilter === 'favorites') return Boolean(item.collected)
      if (sourceFilter === 'recent') return Number(item.usage_count || 0) > 0
      return item.source === sourceFilter
    })
  }, [normalizedQuery, searchResults, sourceFilter])

  const browseSections = useMemo<BrowseSection[]>(() => {
    if (!browseData) return []
    const sections: BrowseSection[] = []
    const maybePush = (section: BrowseSection, enabled: boolean) => {
      if (enabled && section.items.length > 0) sections.push(section)
    }

    maybePush(
      {
        key: 'recent',
        title: '最近常吃',
        subtitle: '从标准食物库和真实餐食库里优先找回你最近常用的食物',
        items: browseData.recent_items || [],
      },
      sourceFilter === 'all' || sourceFilter === 'recent'
    )
    maybePush(
      {
        key: 'favorites',
        title: '收藏餐食',
        subtitle: '复用你已经收藏过的真实餐食',
        items: browseData.collected_public_library || [],
      },
      sourceFilter === 'all' || sourceFilter === 'favorites'
    )
    maybePush(
      {
        key: 'public_library',
        title: '真实餐食库',
        subtitle: '适合直接补录整份饭、外卖或商家餐',
        items: browseData.public_library || [],
      },
      sourceFilter === 'all' || sourceFilter === 'public_library'
    )
    maybePush(
      {
        key: 'nutrition_library',
        title: '标准食物库',
        subtitle: '适合单食物、单原料，按克重精调营养',
        items: browseData.nutrition_library || [],
      },
      sourceFilter === 'all' || sourceFilter === 'nutrition_library'
    )
    return sections
  }, [browseData, sourceFilter])

  const handleAddItem = (item: ManualFoodSearchResult) => {
    const key = getItemKey(item)
    Taro.vibrateShort({ type: 'light' }).catch(() => {})
    setSelectedItems(prev => {
      const index = prev.findIndex((selected) => getItemKey(selected) === key)
      const defaultWeight = Math.max(1, Math.round(item.default_weight_grams || 100))
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
            weightInput: String(defaultWeight),
            defaultWeight,
            portionLabel: item.portion_label || (item.source === 'public_library' ? '1份' : '100g'),
            baseNutrients,
            nutrients: buildNutrientsFromWeight({
              defaultWeight,
              baseNutrients,
              nutrientsPer100g: item.nutrients_per_100g || undefined,
            }, defaultWeight),
            nutrientsPer100g: item.nutrients_per_100g || undefined,
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
          weightInput: String(nextWeight),
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
          weightInput: String(safeWeight),
          nutrients: buildNutrientsFromWeight(item, safeWeight),
        }
      })
    )
  }

  const handleWeightInput = (key: string, value: string) => {
    const cleaned = value.replace(/[^\d]/g, '')
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
    const parsed = parseInt(target.weightInput, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      updateItemWeight(key, parsed)
      return
    }
    setSelectedItems((prev) =>
      prev.map((item) => (
        getItemKey(item) === key
          ? { ...item, weightInput: String(item.weight) }
          : item
      ))
    )
  }

  const handleSetServing = (key: string, multiplier: number) => {
    const target = selectedMap.get(key)
    if (!target) return
    updateItemWeight(key, target.defaultWeight * multiplier)
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
      const today = formatDateKey(new Date())
      void refreshHomeDashboardLocalSnapshotFromCloud(today)

      Taro.showToast({ title: '记录成功', icon: 'success' })
      setTimeout(() => {
        Taro.redirectTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${today}` }).catch(() => {
          Taro.navigateTo({ url: `${extraPkgUrl('/pages/day-record/index')}?date=${today}` })
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
            {item.source === 'nutrition_library' ? ' / 100g' : ` / ${item.portion_label || '1份'}`}
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
              ? (selected.source === 'public_library'
                ? `${roundToSingle(selected.weight / selected.defaultWeight)}份`
                : `${Math.round(selected.weight)}g`)
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
              <Text className='workspace-subtitle'>双库模式：标准食物库 + 真实餐食库</Text>
            </View>
            <View className='workspace-calories'>
              <Text className='workspace-calories-value'>{Math.round(totalNutrients.calories)}</Text>
              <Text className='workspace-calories-unit'>kcal</Text>
            </View>
          </View>

          <Text className='section-title'>本餐餐次</Text>
          <View className='meal-selector compact'>
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

          <ScrollView className='filter-scroll' scrollX showScrollbar={false}>
            <View className='filter-row'>
              {SOURCE_FILTERS.map((filter) => (
                <View
                  key={filter.value}
                  className={`filter-chip ${sourceFilter === filter.value ? 'active' : ''}`}
                  onClick={() => setSourceFilter(filter.value)}
                >
                  <Text>{filter.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
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
                          {item.source === 'public_library' ? item.portionLabel : '按克重'}
                        </Text>
                      </View>
                      <Text className='item-cal'>{Math.round(item.nutrients.calories)} kcal</Text>
                      {!!item.recommendReason && (
                        <Text className='item-hint'>{item.recommendReason}</Text>
                      )}
                    </View>
                  </View>

                  {item.source === 'public_library' && (
                    <View className='serving-row'>
                      {[0.5, 1, 1.5, 2].map((multiplier) => (
                        <View
                          key={multiplier}
                          className={`serving-chip ${Math.abs(item.weight - item.defaultWeight * multiplier) < 1 ? 'active' : ''}`}
                          onClick={() => handleSetServing(key, multiplier)}
                        >
                          <Text>{multiplier}份</Text>
                        </View>
                      ))}
                    </View>
                  )}

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
                    <Text className='weight-unit'>g</Text>
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

        <View className='food-library-section'>
          <View className='library-header'>
            <Text className='section-title'>{normalizedQuery ? '搜索结果' : '推荐食物'}</Text>
            <Text className='library-subtitle'>
              {normalizedQuery
                ? `围绕“${normalizedQuery}”统一混排结果`
                : `当前以 ${browseData?.stats?.nutrition_food_count || 0} 条标准食物和 ${browseData?.stats?.public_food_count || 0} 条真实餐食为主库`}
            </Text>
          </View>

          {(browseLoading || searchLoading) ? (
            <View className='loading-state'>
              <View className='loading-spinner' />
            </View>
          ) : normalizedQuery ? (
            <View className='food-list'>
              {filteredItems.length > 0 ? (
                filteredItems.map(renderResultItem)
              ) : (
                <View className='empty-state'>
                  <Text>没有找到匹配食物，试试更短的关键词</Text>
                </View>
              )}
            </View>
          ) : browseSections.length > 0 ? (
            browseSections.map((section) => (
              <View key={section.key} className='section-block'>
                <View className='section-block-header'>
                  <Text className='section-block-title'>{section.title}</Text>
                  <Text className='section-block-subtitle'>{section.subtitle}</Text>
                </View>
                <View className='food-list'>
                  {section.items.map(renderResultItem)}
                </View>
              </View>
            ))
          ) : (
            <View className='empty-state'>
              <Text>暂无可用食物数据</Text>
            </View>
          )}
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
