import { View, Text, ScrollView, Input, Image } from '@tarojs/components'
import { useState, useEffect, useMemo } from 'react'
import Taro from '@tarojs/taro'
import {
  getAccessToken,
  saveFoodRecord,
  browseManualFood,
  searchManualFood,
  type ManualFoodBrowseResult,
  type ManualFoodSearchResult,
  type Nutrients,
} from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { refreshHomeDashboardLocalSnapshotFromCloud } from '../../../utils/home-dashboard-local-cache'
import { inferDefaultMealTypeFromLocalTime } from '../../../utils/infer-default-meal-type'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import './index.scss'

const MEALS = [
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
  { value: 'favorites', label: '收藏优先' },
  { value: 'public_library', label: '公共库' },
  { value: 'nutrition_library', label: '营养词典' },
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
  baseNutrients: { calories: number; protein: number; carbs: number; fat: number }
  nutrients: { calories: number; protein: number; carbs: number; fat: number }
  nutrientsPer100g?: { calories: number; protein: number; carbs: number; fat: number }
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
    }
  }

  const ratio = item.defaultWeight > 0 ? safeWeight / item.defaultWeight : 1
  return {
    calories: roundToSingle(item.baseNutrients.calories * ratio),
    protein: roundToSingle(item.baseNutrients.protein * ratio),
    carbs: roundToSingle(item.baseNutrients.carbs * ratio),
    fat: roundToSingle(item.baseNutrients.fat * ratio),
  }
}

function RecordManualPage() {
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])
  const [selectedMeal, setSelectedMeal] = useState(() => inferDefaultMealTypeFromLocalTime())
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
    if (typeof storedMeal === 'string' && MEALS.some((meal) => meal.id === storedMeal)) {
      setSelectedMeal(storedMeal)
    } else {
      setSelectedMeal(inferDefaultMealTypeFromLocalTime())
    }
    loadBrowseData()
  }, [])

  const loadBrowseData = async () => {
    if (browseData) return
    setBrowseLoading(true)
    try {
      const data = await browseManualFood()
      setBrowseData(data)
    } catch (e: any) {
      Taro.showToast({ title: '加载食物库失败', icon: 'none' })
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
        Taro.showToast({ title: e.message || '搜索失败', icon: 'none' })
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
        subtitle: '优先帮你找回最近手动补录过的食物',
        items: browseData.recent_items || [],
      },
      sourceFilter === 'all' || sourceFilter === 'recent'
    )
    maybePush(
      {
        key: 'favorites',
        title: '收藏优先',
        subtitle: '复用你已经收藏过的公共库餐食',
        items: browseData.collected_public_library || [],
      },
      sourceFilter === 'all' || sourceFilter === 'favorites'
    )
    maybePush(
      {
        key: 'public_library',
        title: '公共库推荐',
        subtitle: '更适合直接补录整份餐食',
        items: browseData.public_library || [],
      },
      sourceFilter === 'all' || sourceFilter === 'public_library'
    )
    maybePush(
      {
        key: 'nutrition_library',
        title: '标准营养词典',
        subtitle: '适合单食材、按克重精调',
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
            recommendReason: item.recommend_reason,
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
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
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
          fiber: 0,
          sugar: 0,
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
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
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
              <Text>{item.source_label || (item.source === 'public_library' ? '公共库' : '营养词典')}</Text>
            </View>
          </View>
          <Text className='food-sub'>
            {Math.round(item.total_calories)} kcal
            {item.source === 'nutrition_library' ? ' / 100g' : ` / ${item.portion_label || '1份'}`}
            {item.subtitle ? ` · ${item.subtitle}` : ''}
          </Text>
          {!!item.recommend_reason && (
            <Text className='food-hint'>{item.recommend_reason}</Text>
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
              <Text className='workspace-subtitle'>先搜索，再批量加，最后统一调分量</Text>
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
              placeholder='搜索食物、菜名、品牌'
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
                : '默认优先展示最近常吃、收藏公共库和推荐词典'}
            </Text>
          </View>

          {(browseLoading || searchLoading) ? (
            <View className='loading-state'>
              <View className='loading-spinner' />
              <Text>{normalizedQuery ? '搜索中...' : '加载中...'}</Text>
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
