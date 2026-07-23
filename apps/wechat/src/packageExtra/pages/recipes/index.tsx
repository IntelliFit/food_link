import { View, Text, Image, ScrollView, Input } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { getUserRecipes, deleteUserRecipe, applyUserRecipe, updateUserRecipe, showUnifiedApiError, type UserRecipe } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import { addWaterToBodyMetricsStorage, calculateFoodRecordItemsWaterMl, refreshHomeDashboardLocalSnapshotFromCloud } from '../../../utils/home-dashboard-local-cache'
import { getStoredRecordTargetDate } from '../../../utils/record-date'
import './index.scss'

/** 餐次映射 */
const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

type NutritionDraft = {
  calories: string
  protein: string
  carbs: string
  fat: string
}

type MicroNutrientKey =
  | 'fiber'
  | 'sugar'
  | 'sodium_mg'
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

type MicroNutrientTotals = Partial<Record<MicroNutrientKey, number>>

const NUTRITION_FIELDS: Array<{
  key: keyof NutritionDraft
  label: string
  unit: string
  placeholder: string
}> = [
  { key: 'calories', label: '热量', unit: 'kcal', placeholder: '0' },
  { key: 'protein', label: '蛋白质', unit: 'g', placeholder: '如 18' },
  { key: 'carbs', label: '碳水', unit: 'g', placeholder: '如 42' },
  { key: 'fat', label: '脂肪', unit: 'g', placeholder: '如 9' }
]

const MICRO_NUTRIENT_META: Array<{ key: MicroNutrientKey; label: string; unit: string; aliases?: string[] }> = [
  { key: 'fiber', label: '膳食纤维', unit: 'g' },
  { key: 'sugar', label: '糖', unit: 'g' },
  { key: 'sodium_mg', label: '钠', unit: 'mg', aliases: ['sodiumMg'] },
  { key: 'potassiumMg', label: '钾', unit: 'mg' },
  { key: 'calciumMg', label: '钙', unit: 'mg' },
  { key: 'ironMg', label: '铁', unit: 'mg' },
  { key: 'magnesiumMg', label: '镁', unit: 'mg' },
  { key: 'zincMg', label: '锌', unit: 'mg' },
  { key: 'vitaminARaeMcg', label: '维生素A', unit: 'mcg' },
  { key: 'vitaminCMg', label: '维生素C', unit: 'mg' },
  { key: 'vitaminDMcg', label: '维生素D', unit: 'mcg' },
  { key: 'vitaminEMg', label: '维生素E', unit: 'mg' },
  { key: 'vitaminKMcg', label: '维生素K', unit: 'mcg' },
  { key: 'thiaminMg', label: '维生素B1', unit: 'mg' },
  { key: 'riboflavinMg', label: '维生素B2', unit: 'mg' },
  { key: 'niacinMg', label: '烟酸', unit: 'mg' },
  { key: 'vitaminB6Mg', label: '维生素B6', unit: 'mg' },
  { key: 'folateMcg', label: '叶酸', unit: 'mcg' },
  { key: 'vitaminB12Mcg', label: '维生素B12', unit: 'mcg' }
]

function toDraftNumber(value: number | undefined) {
  const next = Number(value || 0)
  return Number.isFinite(next) ? String(Math.round(next * 10) / 10) : '0'
}

function parseDraftNumber(value: string) {
  const next = Number(String(value).trim())
  if (!Number.isFinite(next) || next < 0) return null
  return Math.round(next * 10) / 10
}

function formatDraftValue(value: number) {
  const next = Math.max(0, Math.round(value * 10) / 10)
  return Number.isInteger(next) ? String(next) : next.toFixed(1)
}

function calcCaloriesFromMacros(protein: number, carbs: number, fat: number) {
  return Math.round((protein * 4 + carbs * 4 + fat * 9) * 10) / 10
}

function scaleMacrosByCalories(draft: NutritionDraft, nextCalories: number): { draft: NutritionDraft; scale: number } {
  const protein = parseDraftNumber(draft.protein) ?? 0
  const carbs = parseDraftNumber(draft.carbs) ?? 0
  const fat = parseDraftNumber(draft.fat) ?? 0
  const macroCalories = calcCaloriesFromMacros(protein, carbs, fat)
  if (macroCalories <= 0) {
    return {
      draft: {
        ...draft,
        calories: formatDraftValue(nextCalories)
      },
      scale: 1
    }
  }
  const scale = nextCalories / macroCalories
  return {
    draft: {
      calories: formatDraftValue(nextCalories),
      protein: formatDraftValue(protein * scale),
      carbs: formatDraftValue(carbs * scale),
      fat: formatDraftValue(fat * scale)
    },
    scale
  }
}

function normalizeNutrientNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}

function roundNutrient(value: number) {
  return Math.max(0, Math.round(value * 10) / 10)
}

function getMicroNutrientValue(nutrients: Record<string, any> | undefined, meta: { key: MicroNutrientKey; aliases?: string[] }) {
  if (!nutrients) return 0
  const keys = [meta.key, ...(meta.aliases || [])]
  for (const key of keys) {
    const value = normalizeNutrientNumber(nutrients[key])
    if (value > 0) return value
  }
  return 0
}

function getRecipeMicroTotals(recipe: UserRecipe | null | undefined): MicroNutrientTotals {
  if (!recipe) return {}
  return (recipe.items || []).reduce<MicroNutrientTotals>((totals, item: any) => {
    const rawRatio = Number(item?.ratio)
    const ratio = Number.isFinite(rawRatio) ? Math.max(0, rawRatio) / 100 : 1
    const nutrients = item?.nutrients || {}
    MICRO_NUTRIENT_META.forEach((meta) => {
      const value = getMicroNutrientValue(nutrients, meta) * ratio
      if (value > 0) {
        totals[meta.key] = roundNutrient((totals[meta.key] || 0) + value)
      }
    })
    return totals
  }, {})
}

function getVisibleMicroRows(totals: MicroNutrientTotals, limit?: number) {
  const rows = MICRO_NUTRIENT_META
    .map((meta) => ({ ...meta, value: totals[meta.key] || 0 }))
    .filter((row) => row.value > 0)
  return typeof limit === 'number' ? rows.slice(0, limit) : rows
}

function scaleMicroTotals(totals: MicroNutrientTotals, scale: number): MicroNutrientTotals {
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.0001) return totals
  return Object.entries(totals).reduce<MicroNutrientTotals>((next, [key, value]) => {
    next[key as MicroNutrientKey] = roundNutrient((Number(value) || 0) * scale)
    return next
  }, {})
}

function formatMicroValue(value: number) {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Math.round(value * 100) / 100)
}

function formatRecipeDisplayText(value?: string | null) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/([*_~`])([^]*?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatRecipeTag(value: string) {
  return formatRecipeDisplayText(value).replace(/^#+\s*/, '').trim()
}

function scaleRecipeItemsNutrients(
  items: UserRecipe['items'],
  scales: { calories: number; protein: number; carbs: number; fat: number; micro: number }
) {
  const resolveScale = (field: string) => {
    if (field === 'calories') return scales.calories
    if (field === 'protein') return scales.protein
    if (field === 'carbs') return scales.carbs
    if (field === 'fat') return scales.fat
    return scales.micro
  }
  return (items || []).map((item: any) => {
    const nutrients = { ...(item?.nutrients || {}) }
    Object.keys(nutrients).forEach((key) => {
      const value = Number(nutrients[key])
      const scale = resolveScale(key)
      if (Number.isFinite(value)) {
        nutrients[key] = Math.round(value * (Number.isFinite(scale) && scale > 0 ? scale : 1) * 100) / 100
      }
    })
    if (nutrients.sodium_mg == null && nutrients.sodiumMg != null) {
      nutrients.sodium_mg = nutrients.sodiumMg
    }
    if (nutrients.sodiumMg == null && nutrients.sodium_mg != null) {
      nutrients.sodiumMg = nutrients.sodium_mg
    }
    return { ...item, nutrients }
  })
}

function RecipesPage() {
  const [recipes, setRecipes] = useState<UserRecipe[]>([])
  const [loading, setLoading] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<UserRecipe | null>(null)
  const [nutritionDraft, setNutritionDraft] = useState<NutritionDraft>({
    calories: '0',
    protein: '0',
    carbs: '0',
    fat: '0'
  })
  const [microTotalsDraft, setMicroTotalsDraft] = useState<MicroNutrientTotals>({})
  const [nutritionSaving, setNutritionSaving] = useState(false)
  /** 加载食谱列表 */
  const loadRecipes = async () => {
    setLoading(true)
    try {
      const { recipes: data } = await getUserRecipes()
      const favoriteRecipes = (data || []).filter((recipe) => Boolean(recipe.is_favorite))
      setRecipes(favoriteRecipes)
    } catch (e: any) {
      const msg = e.message || '加载失败'
      if (msg.includes('未登录') || msg.includes('认证')) {
        Taro.showToast({ title: '请先登录', icon: 'none' })
      } else {
        await showUnifiedApiError(e, '加载失败')
      }
      setRecipes([])
    } finally {
      setLoading(false)
    }
  }

  useDidShow(() => {
    loadRecipes()
  })

  /** 下拉刷新 */
  const handlePullDownRefresh = async () => {
    await loadRecipes()
    Taro.stopPullDownRefresh()
  }

  // 注册下拉刷新回调
  Taro.usePullDownRefresh(() => {
    handlePullDownRefresh()
  })

  /** 使用食谱（一键记录） */
  const handleUseRecipe = async (recipe: UserRecipe) => {
    try {
      const MEAL_KEYS = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']
      const MEAL_NAMES = ['早餐', '早加餐', '午餐', '午加餐', '晚餐', '晚加餐']
      const { tapIndex } = await Taro.showActionSheet({
        itemList: MEAL_NAMES,
        alertText: `将"${recipe.recipe_name}"记录为：`
      })

      const selectedMealType = MEAL_KEYS[tapIndex]
      const targetDate = getStoredRecordTargetDate()

      Taro.showLoading({ title: '记录中...', mask: true })
      await applyUserRecipe(recipe.id, selectedMealType, 'favorite_recipe')
      Taro.hideLoading()
      addWaterToBodyMetricsStorage(targetDate, calculateFoodRecordItemsWaterMl(recipe.items || []))
      try {
        Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDate, force: true })
      } catch {
        /* ignore */
      }
      try {
        await refreshHomeDashboardLocalSnapshotFromCloud(targetDate)
      } catch {
        /* ignore */
      }
      Taro.showToast({ title: '已添加到饮食记录', icon: 'success' })
      // 刷新列表以更新使用次数
      setTimeout(() => loadRecipes(), 500)
    } catch (e: any) {
      // 点击取消也会抛出错误，需区分
      if (e.errMsg && e.errMsg.includes('cancel')) return

      Taro.hideLoading()
      await showUnifiedApiError(e, '记录失败')
    }
  }

  /** 打开营养编辑弹窗 */
  const handleOpenNutritionEditor = (recipe: UserRecipe) => {
    setEditingRecipe(recipe)
    setNutritionDraft({
      calories: toDraftNumber(recipe.total_calories),
      protein: toDraftNumber(recipe.total_protein),
      carbs: toDraftNumber(recipe.total_carbs),
      fat: toDraftNumber(recipe.total_fat)
    })
    setMicroTotalsDraft(getRecipeMicroTotals(recipe))
  }

  const handleCloseNutritionEditor = () => {
    if (nutritionSaving) return
    setEditingRecipe(null)
  }

  const updateNutritionDraft = (key: keyof NutritionDraft, value: string) => {
    setNutritionDraft((prev) => {
      if (key === 'calories') {
        const nextCalories = parseDraftNumber(value)
        if (nextCalories == null) return { ...prev, calories: value }
        const { draft, scale } = scaleMacrosByCalories(prev, nextCalories)
        setMicroTotalsDraft((current) => scaleMicroTotals(current, scale))
        return draft
      }

      const previousCalories = parseDraftNumber(prev.calories) ?? 0
      const next = { ...prev, [key]: value }
      const protein = parseDraftNumber(next.protein)
      const carbs = parseDraftNumber(next.carbs)
      const fat = parseDraftNumber(next.fat)
      if (protein == null || carbs == null || fat == null) return next
      const nextCalories = calcCaloriesFromMacros(protein, carbs, fat)
      if (previousCalories > 0) {
        setMicroTotalsDraft((current) => scaleMicroTotals(current, nextCalories / previousCalories))
      }
      return {
        ...next,
        calories: formatDraftValue(nextCalories)
      }
    })
  }

  const adjustNutritionCalories = (delta: number) => {
    setNutritionDraft((prev) => {
      const currentCalories = parseDraftNumber(prev.calories) ?? calcCaloriesFromMacros(
        parseDraftNumber(prev.protein) ?? 0,
        parseDraftNumber(prev.carbs) ?? 0,
        parseDraftNumber(prev.fat) ?? 0
      )
      const { draft, scale } = scaleMacrosByCalories(prev, Math.max(0, currentCalories + delta))
      setMicroTotalsDraft((current) => scaleMicroTotals(current, scale))
      return draft
    })
  }

  /** 保存收藏餐食营养信息 */
  const handleSaveNutrition = async () => {
    if (!editingRecipe || nutritionSaving) return

    const totalCalories = parseDraftNumber(nutritionDraft.calories)
    const totalProtein = parseDraftNumber(nutritionDraft.protein)
    const totalCarbs = parseDraftNumber(nutritionDraft.carbs)
    const totalFat = parseDraftNumber(nutritionDraft.fat)

    if (totalCalories == null || totalProtein == null || totalCarbs == null || totalFat == null) {
      Taro.showToast({ title: '请输入有效营养数值', icon: 'none' })
      return
    }

    setNutritionSaving(true)
    try {
      const originalCalories = Math.max(0, Number(editingRecipe.total_calories) || 0)
      const originalProtein = Math.max(0, Number(editingRecipe.total_protein) || 0)
      const originalCarbs = Math.max(0, Number(editingRecipe.total_carbs) || 0)
      const originalFat = Math.max(0, Number(editingRecipe.total_fat) || 0)
      const scales = {
        calories: originalCalories > 0 ? totalCalories / originalCalories : 1,
        protein: originalProtein > 0 ? totalProtein / originalProtein : 1,
        carbs: originalCarbs > 0 ? totalCarbs / originalCarbs : 1,
        fat: originalFat > 0 ? totalFat / originalFat : 1,
        micro: originalCalories > 0 ? totalCalories / originalCalories : 1
      }
      const { recipe } = await updateUserRecipe(editingRecipe.id, {
        items: scaleRecipeItemsNutrients(editingRecipe.items, scales),
        total_calories: totalCalories,
        total_protein: totalProtein,
        total_carbs: totalCarbs,
        total_fat: totalFat
      })
      setRecipes((prev) => prev.map((item) => item.id === recipe.id ? recipe : item))
      setEditingRecipe(null)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (e: any) {
      await showUnifiedApiError(e, '保存失败')
    } finally {
      setNutritionSaving(false)
    }
  }

  /** 删除食谱 */
  const handleDeleteRecipe = async (recipe: UserRecipe) => {
    const { confirm } = await Taro.showModal({
      title: '确认删除',
      content: `确定要删除食谱"${recipe.recipe_name}"吗？`
    })
    if (!confirm) return

    try {
      Taro.showLoading({ title: '删除中...', mask: true })
      await deleteUserRecipe(recipe.id)
      Taro.hideLoading()
      Taro.showToast({ title: '删除成功', icon: 'success' })
      loadRecipes()
    } catch (e: any) {
      Taro.hideLoading()
      await showUnifiedApiError(e, '删除失败')
    }
  }

  /** 格式化营养数据 */
  const formatNutrition = (value: number) => {
    return Math.round(value * 10) / 10
  }

  const handleGoDetail = (recipe: UserRecipe) => {
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/recipe-detail/index')}?id=${encodeURIComponent(recipe.id)}` })
  }

  return (
    <View className='recipes-page'>
      <View className='page-header'>
        <Text className='page-title'>我的收藏</Text>
        <Text className='page-subtitle'>这里会显示你收藏过的餐食，方便之后快速记录。</Text>
      </View>

      <ScrollView className='recipe-list' scrollY>
        {loading ? (
          <View className='empty-state'>
            <View className='loading-spinner-md' />
          </View>
        ) : recipes.length > 0 ? (
          <View className='recipes-grid'>
            {recipes.map((recipe) => (
              <View key={recipe.id} className='recipe-card' onClick={() => handleGoDetail(recipe)}>
                {/* 食谱图片 */}
                <View className='recipe-image-wrapper'>
                  {recipe.image_path ? (
                    <Image
                      src={recipe.image_path}
                      mode='aspectFill'
                      className='recipe-image'
                    />
                  ) : (
                    <View className='recipe-image-placeholder'>
                      <Text className='iconfont icon-shiwu placeholder-icon'></Text>
                    </View>
                  )}
                  {recipe.is_favorite && (
                    <View className='favorite-badge'>
                      <Text className='iconfont icon-shoucang-yishoucang'></Text>
                    </View>
                  )}
                  {recipe.meal_type && (
                    <View className='meal-type-badge'>
                      <Text className='meal-type-text'>
                        {MEAL_TYPE_NAMES[recipe.meal_type] || recipe.meal_type}
                      </Text>
                    </View>
                  )}
                </View>

                <View className='recipe-content'>
                  {/* 标题 */}
                  <View className='recipe-header'>
                    <Text className='recipe-name'>{formatRecipeDisplayText(recipe.recipe_name) || '未命名食谱'}</Text>
                  </View>

                  {/* 描述 */}
                  {recipe.description && (
                    <Text className='recipe-desc' numberOfLines={2}>{formatRecipeDisplayText(recipe.description)}</Text>
                  )}

                  {/* 营养摘要 */}
                  <View className='nutrition-summary'>
                    <View className='nutrition-item highlight'>
                      <View className='nutrition-calorie-line'>
                        <Text className='nutrition-value'>
                          {formatNutrition(recipe.total_calories)}
                        </Text>
                        <Text className='nutrition-unit'>kcal</Text>
                      </View>
                    </View>
                    <View className='nutrition-divider' />
                    <View className='nutrition-item'>
                      <Text className='nutrition-label'>蛋白质</Text>
                      <Text className='nutrition-sub-value'>{formatNutrition(recipe.total_protein)}g</Text>
                    </View>
                    <View className='nutrition-item'>
                      <Text className='nutrition-label'>碳水</Text>
                      <Text className='nutrition-sub-value'>{formatNutrition(recipe.total_carbs)}g</Text>
                    </View>
                    <View className='nutrition-item'>
                      <Text className='nutrition-label'>脂肪</Text>
                      <Text className='nutrition-sub-value'>{formatNutrition(recipe.total_fat)}g</Text>
                    </View>
                  </View>
                  {/* 标签 */}
                  {recipe.tags && recipe.tags.length > 0 && (
                    <ScrollView scrollX className='tags-scroll' showScrollbar={false}>
                      <View className='tags'>
                        {recipe.tags.map((tag, index) => {
                          const label = formatRecipeTag(tag)
                          return label ? (
                            <Text key={index} className='tag'>
                              {label}
                            </Text>
                          ) : null
                        })}
                      </View>
                    </ScrollView>
                  )}

                  {getVisibleMicroRows(getRecipeMicroTotals(recipe), 4).length > 0 && (
                    <View className='micro-summary'>
                      {getVisibleMicroRows(getRecipeMicroTotals(recipe), 4).map((row) => (
                        <View key={row.key} className='micro-summary-item'>
                          <Text className='micro-summary-label'>{row.label}</Text>
                          <Text className='micro-summary-value'>{formatMicroValue(row.value)}{row.unit}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  <View className='card-footer'>
                    {/* 使用统计 */}
                    <View className='recipe-stats'>
                      <Text className='iconfont icon-shizhong stats-icon'></Text>
                      <Text className='stats-text'>
                        {recipe.last_used_at
                          ? `${new Date(recipe.last_used_at).getMonth() + 1}月${new Date(recipe.last_used_at).getDate()}日`
                          : '未使用'}
                      </Text>
                      <Text className='stats-dot'>·</Text>
                      <Text className='stats-text'>用过 {recipe.use_count} 次</Text>
                    </View>

                    {/* 操作按钮 */}
                    <View className='recipe-actions'>
                      <View
                        className='action-btn delete-btn'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteRecipe(recipe)
                        }}
                      >
                        {/* 使用 icon-shanchu */}
                        <Text className='iconfont icon-shanchu'></Text>
                      </View>
                      <View
                        className='action-btn edit-btn'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenNutritionEditor(recipe)
                        }}
                      >
                        <Text className='iconfont icon-edit'></Text>
                      </View>
                      <View
                        className='action-btn use-btn'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleUseRecipe(recipe)
                        }}
                      >
                        <Text className='iconfont icon-jishiben'></Text>
                        <Text className='btn-text'>记录</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className='empty-state'>
            <Text className='iconfont icon-shoucang-yishoucang empty-icon'></Text>
            <Text className='empty-text'>还没有收藏餐食</Text>
            <Text className='empty-hint'>分析结果页点击“收藏餐食”后，会显示在这里</Text>
          </View>
        )}
        <View className='safe-area-bottom' />
      </ScrollView>

      {editingRecipe && (
        <View className='nutrition-editor-overlay'>
          <View className='nutrition-editor-mask' onClick={handleCloseNutritionEditor} />
          <View className='nutrition-editor-panel'>
            <View className='nutrition-editor-handle' />
            <View className='nutrition-editor-header'>
              <View className='nutrition-editor-header-main'>
                <Text className='nutrition-editor-title'>{editingRecipe.recipe_name}</Text>
                <Text className='nutrition-editor-subtitle'>修改营养信息</Text>
              </View>
              <View className='nutrition-editor-close' onClick={handleCloseNutritionEditor}>
                <Text className='iconfont icon-close' />
              </View>
            </View>

            <View className='nutrition-editor-body'>
              <View className='nutrition-editor-section'>
                <Text className='nutrition-editor-section-title'>宏量营养素</Text>
                <View className='nutrition-editor-grid'>
                  {NUTRITION_FIELDS.map((field) => (
                    <View key={field.key} className='nutrition-editor-grid-item'>
                      <Text className='nutrition-editor-grid-label'>{field.label}</Text>
                      <View className='nutrition-editor-grid-input-wrap'>
                        <Input
                          className='nutrition-editor-grid-input'
                          type='digit'
                          value={nutritionDraft[field.key]}
                          placeholder={field.placeholder}
                          onInput={(e) => updateNutritionDraft(field.key, e.detail.value)}
                        />
                        <Text className='nutrition-editor-grid-unit'>{field.unit}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              {getVisibleMicroRows(microTotalsDraft).length > 0 && (
                <View className='nutrition-editor-section'>
                  <Text className='nutrition-editor-section-title'>微量营养素</Text>
                  <View className='nutrition-editor-grid'>
                    {getVisibleMicroRows(microTotalsDraft).map((row) => (
                      <View key={row.key} className='nutrition-editor-grid-item'>
                        <Text className='nutrition-editor-grid-label'>{row.label}</Text>
                        <View className='nutrition-editor-grid-input-wrap'>
                          <Text className='nutrition-editor-grid-value'>{formatMicroValue(row.value)}</Text>
                          <Text className='nutrition-editor-grid-unit'>{row.unit}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>

            <View className='nutrition-editor-actions'>
              <View className='nutrition-editor-btn nutrition-editor-btn--cancel' onClick={handleCloseNutritionEditor}>
                <Text>取消</Text>
              </View>
              <View
                className={`nutrition-editor-btn nutrition-editor-btn--confirm ${nutritionSaving ? 'nutrition-editor-btn--disabled' : ''}`}
                onClick={() => void handleSaveNutrition()}
              >
                <Text>保存修改</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default withAuth(RecipesPage)
