import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { getUserRecipes, deleteUserRecipe, applyUserRecipe, type UserRecipe, type FoodRecord } from '../../../utils/api'
import { withAuth } from '../../../utils/withAuth'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
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

function RecipesPage() {
  const [recipes, setRecipes] = useState<UserRecipe[]>([])
  const [loading, setLoading] = useState(false)

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
        Taro.showToast({ title: msg, icon: 'none' })
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
      const selectedMealName = MEAL_NAMES[tapIndex]

      const { confirm } = await Taro.showModal({
        title: '确认记录',
        content: `确定将"${recipe.recipe_name}"记录为${selectedMealName}吗？`
      })
      if (!confirm) return

      Taro.showLoading({ title: '记录中...', mask: true })
      await applyUserRecipe(recipe.id, selectedMealType)
      Taro.hideLoading()
      Taro.showToast({ title: '已添加到饮食记录', icon: 'success' })
      // 刷新列表以更新使用次数
      setTimeout(() => loadRecipes(), 500)
    } catch (e: any) {
      // 点击取消也会抛出错误，需区分
      if (e.errMsg && e.errMsg.includes('cancel')) return

      Taro.hideLoading()
      Taro.showToast({ title: e.message || '记录失败', icon: 'none' })
    }
  }

  /** 
   * 查看食谱详情（以记录详情形式展示）
   * 注意：食谱不是真实的饮食记录，这里构造临时对象用于复用记录详情页展示。
   * 保留 storage 传参方式，因为食谱 ID 不对应 user_food_records 表中的记录。
   * 未来可考虑为食谱创建专门的详情页。
   */
  const handleViewDetail = (recipe: UserRecipe) => {
    // 构造临时 record 对象用于展示
    const record: FoodRecord = {
      id: recipe.id,
      user_id: recipe.user_id,
      meal_type: (['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack', 'snack'].includes(recipe.meal_type || '')
        ? recipe.meal_type
        : 'afternoon_snack') as any,
      image_path: recipe.image_path,
      description: recipe.description,
      insight: null,
      pfc_ratio_comment: null,
      absorption_notes: null,
      context_advice: null,
      items: recipe.items,
      total_calories: recipe.total_calories,
      total_protein: recipe.total_protein,
      total_carbs: recipe.total_carbs,
      total_fat: recipe.total_fat,
      total_weight_grams: recipe.total_weight_grams,
      record_time: recipe.created_at,
      created_at: recipe.created_at
    }

    Taro.setStorageSync('recordDetail', record)
    Taro.navigateTo({ url: extraPkgUrl('/pages/record-detail/index') })
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
      Taro.showToast({ title: e.message || '删除失败', icon: 'none' })
    }
  }

  /** 格式化营养数据 */
  const formatNutrition = (value: number) => {
    return Math.round(value * 10) / 10
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
              <View key={recipe.id} className='recipe-card'>
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
                    <Text className='recipe-name'>{recipe.recipe_name}</Text>
                  </View>

                  {/* 描述 */}
                  {recipe.description && (
                    <Text className='recipe-desc' numberOfLines={2}>{recipe.description}</Text>
                  )}

                  {/* 营养摘要 */}
                  <View className='nutrition-summary'>
                    <View className='nutrition-item highlight'>
                      <Text className='nutrition-value'>
                        {formatNutrition(recipe.total_calories)}
                      </Text>
                      <Text className='nutrition-unit'>kcal</Text>
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
                        {recipe.tags.map((tag, index) => (
                          <Text key={index} className='tag'>
                            #{tag}
                          </Text>
                        ))}
                      </View>
                    </ScrollView>
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
                          handleViewDetail(recipe)
                        }}
                      >
                        <Text className='iconfont icon-ic_detail'></Text>
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
    </View>
  )
}

export default withAuth(RecipesPage)
