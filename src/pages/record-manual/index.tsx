import { View, Text, ScrollView, Input } from '@tarojs/components'
import { useState, useEffect, useMemo } from 'react'
import Taro from '@tarojs/taro'
import {
  getAccessToken,
  saveFoodRecord,
  browseManualFood,
  type ManualFoodBrowseResult,
  type ManualFoodSearchResult,
  type Nutrients,
} from '../../utils/api'
import { withAuth } from '../../utils/withAuth'
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

type TabType = 'nutrition_library' | 'public_library'

interface SelectedItem {
  id: string
  source: TabType
  title: string
  weight: number
  defaultWeight: number
  nutrients: { calories: number; protein: number; carbs: number; fat: number }
  nutrientsPer100g?: { calories: number; protein: number; carbs: number; fat: number }
}

function RecordManualPage() {
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])
  const [selectedMeal, setSelectedMeal] = useState('breakfast')
  const [dietGoal, setDietGoal] = useState('none')
  const [activityTiming, setActivityTiming] = useState('none')
  const [filterText, setFilterText] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('nutrition_library')
  const [browseData, setBrowseData] = useState<ManualFoodBrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // 加载食物库数据
  useEffect(() => {
    loadBrowseData()
  }, [])

  const loadBrowseData = async () => {
    if (browseData) return
    setLoading(true)
    try {
      const data = await browseManualFood()
      setBrowseData(data)
    } catch (e: any) {
      Taro.showToast({ title: '加载食物库失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  // 过滤后的食物列表
  const filteredItems = useMemo(() => {
    if (!browseData) return []
    const items = activeTab === 'public_library'
      ? browseData.public_library
      : browseData.nutrition_library
    const q = filterText.trim().toLowerCase()
    if (!q) return items
    return items.filter(item =>
      item.title.toLowerCase().includes(q) || (item.subtitle || '').toLowerCase().includes(q)
    )
  }, [browseData, activeTab, filterText])

  // 添加食物
  const handleAddItem = (item: ManualFoodSearchResult) => {
    if (selectedItems.some(s => s.id === item.id && s.source === item.source)) {
      Taro.showToast({ title: '已添加', icon: 'none' })
      return
    }
    const weight = item.default_weight_grams || 100
    let nutrients: { calories: number; protein: number; carbs: number; fat: number }
    
    if (item.nutrients_per_100g) {
      const scale = weight / 100
      nutrients = {
        calories: Math.round(item.nutrients_per_100g.calories * scale * 10) / 10,
        protein: Math.round(item.nutrients_per_100g.protein * scale * 10) / 10,
        carbs: Math.round(item.nutrients_per_100g.carbs * scale * 10) / 10,
        fat: Math.round(item.nutrients_per_100g.fat * scale * 10) / 10,
      }
    } else {
      nutrients = {
        calories: item.total_calories,
        protein: item.total_protein,
        carbs: item.total_carbs,
        fat: item.total_fat,
      }
    }
    
    setSelectedItems(prev => [...prev, {
      id: item.id,
      source: item.source,
      title: item.title,
      weight,
      defaultWeight: weight,
      nutrients,
      nutrientsPer100g: item.nutrients_per_100g || undefined,
    }])
    Taro.showToast({ title: '已添加', icon: 'success', duration: 800 })
  }

  // 修改重量
  const handleWeightChange = (index: number, newWeight: number) => {
    setSelectedItems(prev => {
      const updated = [...prev]
      const item = { ...updated[index] }
      item.weight = Math.max(1, newWeight)
      if (item.nutrientsPer100g) {
        const scale = item.weight / 100
        item.nutrients = {
          calories: Math.round(item.nutrientsPer100g.calories * scale * 10) / 10,
          protein: Math.round(item.nutrientsPer100g.protein * scale * 10) / 10,
          carbs: Math.round(item.nutrientsPer100g.carbs * scale * 10) / 10,
          fat: Math.round(item.nutrientsPer100g.fat * scale * 10) / 10,
        }
      } else {
        const ratio = item.defaultWeight > 0 ? item.weight / item.defaultWeight : 1
        item.nutrients = {
          calories: Math.round(item.nutrients.calories * ratio * 10) / 10,
          protein: Math.round(item.nutrients.protein * ratio * 10) / 10,
          carbs: Math.round(item.nutrients.carbs * ratio * 10) / 10,
          fat: Math.round(item.nutrients.fat * ratio * 10) / 10,
        }
      }
      updated[index] = item
      return updated
    })
  }

  // 移除食物
  const handleRemoveItem = (index: number) => {
    setSelectedItems(prev => prev.filter((_, i) => i !== index))
  }

  // 计算总营养
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

  // 保存记录
  const handleSave = async () => {
    if (selectedItems.length === 0) {
      Taro.showToast({ title: '请先添加食物', icon: 'none' })
      return
    }
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
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
      
      Taro.showToast({ title: '记录成功', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 1200)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className='record-manual-page'>
      <ScrollView className='content-scroll' scrollY>
        {/* 已选食物区域 */}
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
              {selectedItems.map((item, index) => (
                <View key={`${item.source}-${item.id}`} className='selected-item'>
                  <View className='item-info'>
                    <Text className='item-name'>{item.title}</Text>
                    <Text className='item-cal'>{Math.round(item.nutrients.calories)} kcal</Text>
                  </View>
                  <View className='item-actions'>
                    <Input
                      className='weight-input'
                      type='number'
                      value={String(item.weight)}
                      onBlur={(e) => {
                        const val = parseInt(e.detail.value, 10)
                        if (Number.isFinite(val) && val > 0) {
                          handleWeightChange(index, val)
                        }
                      }}
                    />
                    <Text className='weight-unit'>g</Text>
                    <View className='remove-btn' onClick={() => handleRemoveItem(index)}>
                      <Text className='iconfont icon-shanchu' />
                    </View>
                  </View>
                </View>
              ))}
            </View>
            
            {/* 营养汇总 */}
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

        {/* 食物库选择 */}
        <View className='food-library-section'>
          <Text className='section-title'>食物数据库</Text>
          
          {/* Tab 切换 */}
          <View className='library-tabs'>
            <View
              className={`tab-item ${activeTab === 'nutrition_library' ? 'active' : ''}`}
              onClick={() => setActiveTab('nutrition_library')}
            >
              <Text>营养词典{browseData ? ` (${browseData.nutrition_library.length})` : ''}</Text>
            </View>
            <View
              className={`tab-item ${activeTab === 'public_library' ? 'active' : ''}`}
              onClick={() => setActiveTab('public_library')}
            >
              <Text>公共库{browseData ? ` (${browseData.public_library.length})` : ''}</Text>
            </View>
          </View>

          {/* 搜索 */}
          <View className='search-bar'>
            <Text className='iconfont icon-sousuo search-icon' />
            <Input
              className='search-input'
              placeholder='搜索食物...'
              value={filterText}
              onInput={(e) => setFilterText(e.detail.value)}
            />
            {filterText && (
              <View className='clear-btn' onClick={() => setFilterText('')}>
                <Text className='iconfont icon-guanbi' />
              </View>
            )}
          </View>

          {/* 食物列表 */}
          {loading ? (
            <View className='loading-state'>
              <View className='loading-spinner' />
              <Text>加载中...</Text>
            </View>
          ) : (
            <View className='food-list'>
              {filteredItems.length > 0 ? (
                filteredItems.map((item) => (
                  <View
                    key={`${item.source}-${item.id}`}
                    className='food-item'
                    onClick={() => handleAddItem(item)}
                  >
                    <View className='food-info'>
                      <Text className='food-name'>{item.title}</Text>
                      <Text className='food-sub'>
                        {Math.round(item.total_calories)} kcal
                        {item.source === 'nutrition_library' ? ' / 100g' : ''}
                        {item.subtitle && item.source === 'public_library' ? ` · ${item.subtitle}` : ''}
                      </Text>
                    </View>
                    <View className='add-btn'>
                      <Text className='iconfont icon-jia' />
                    </View>
                  </View>
                ))
              ) : (
                <View className='empty-state'>
                  <Text>{filterText ? '没有匹配的食物' : '暂无数据'}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* 配置选项 */}
        {selectedItems.length > 0 && (
          <>
            <View className='config-section'>
              <Text className='section-title'>选择餐次</Text>
              <View className='meal-selector'>
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
            </View>

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
          </>
        )}

        <View className='bottom-space' />
      </ScrollView>

      {/* 底部保存按钮 */}
      {selectedItems.length > 0 && (
        <View className='bottom-bar'>
          <View
            className={`save-btn ${saving ? 'loading' : ''}`}
            onClick={handleSave}
          >
            <Text>{saving ? '保存中...' : `保存记录（${Math.round(totalNutrients.calories)} kcal）`}</Text>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(RecordManualPage)
