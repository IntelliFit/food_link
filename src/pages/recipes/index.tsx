import { View, Text, Image, ScrollView } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { getUserRecipes, deleteUserRecipe, useUserRecipe, type UserRecipe } from '../../utils/api'
import './index.scss'

/** 餐次映射 */
const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

export default function RecipesPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'favorite'>('all')
  const [recipes, setRecipes] = useState<UserRecipe[]>([])
  const [loading, setLoading] = useState(false)

  /** 加载食谱列表 */
  const loadRecipes = async () => {
    setLoading(true)
    try {
      const params = activeTab === 'favorite' ? { is_favorite: true } : undefined
      const { recipes: data } = await getUserRecipes(params)
      setRecipes(data || [])
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

  useEffect(() => {
    loadRecipes()
  }, [activeTab])

  /** 下拉刷新 */
  const handlePullDownRefresh = async () => {
    await loadRecipes()
    Taro.stopPullDownRefresh()
  }

  // 注册下拉刷新回调
  useEffect(() => {
    Taro.usePullDownRefresh(() => {
      handlePullDownRefresh()
    })
  }, [activeTab])

  /** 使用食谱（一键记录） */
  const handleUseRecipe = async (recipe: UserRecipe) => {
    try {
      Taro.showLoading({ title: '记录中...', mask: true })
      await useUserRecipe(recipe.id)
      Taro.hideLoading()
      Taro.showToast({ title: '已添加到饮食记录', icon: 'success' })
      // 刷新列表以更新使用次数
      setTimeout(() => loadRecipes(), 500)
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '记录失败', icon: 'none' })
    }
  }

  /** 编辑食谱 */
  const handleEditRecipe = (recipe: UserRecipe) => {
    Taro.setStorageSync('editRecipe', recipe)
    Taro.navigateTo({ url: '/pages/recipe-edit/index' })
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

  /** 创建新食谱 */
  const handleCreateRecipe = () => {
    Taro.showToast({ title: '请从识别结果页保存食谱', icon: 'none', duration: 2000 })
  }

  /** 格式化营养数据 */
  const formatNutrition = (value: number) => {
    return Math.round(value * 10) / 10
  }

  return (
    <View className='recipes-page'>
      {/* 标签切换 */}
      <View className='tabs'>
        <View
          className={`tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          <Text className='tab-text'>全部食谱</Text>
        </View>
        <View
          className={`tab ${activeTab === 'favorite' ? 'active' : ''}`}
          onClick={() => setActiveTab('favorite')}
        >
          <Text className='tab-text'>我的收藏</Text>
        </View>
      </View>

      {/* 食谱列表 */}
      <ScrollView className='recipe-list' scrollY>
        {loading ? (
          <View className='empty-state'>
            <Text className='empty-icon'>⏳</Text>
            <Text className='empty-text'>加载中...</Text>
          </View>
        ) : recipes.length > 0 ? (
          recipes.map((recipe) => (
            <View key={recipe.id} className='recipe-card'>
              {/* 食谱图片 */}
              {recipe.image_path && (
                <Image
                  src={recipe.image_path}
                  mode='aspectFill'
                  className='recipe-image'
                />
              )}

              <View className='recipe-content'>
                {/* 标题 */}
                <View className='recipe-header'>
                  <Text className='recipe-name'>{recipe.recipe_name}</Text>
                  {recipe.is_favorite && (
                    <Text className='favorite-icon'>⭐</Text>
                  )}
                </View>

                {/* 描述 */}
                {recipe.description && (
                  <Text className='recipe-desc'>{recipe.description}</Text>
                )}

                {/* 营养摘要 */}
                <View className='nutrition-summary'>
                  <View className='nutrition-item'>
                    <Text className='nutrition-value'>
                      {formatNutrition(recipe.total_calories)}
                    </Text>
                    <Text className='nutrition-label'>千卡</Text>
                  </View>
                  <View className='nutrition-item'>
                    <Text className='nutrition-value'>
                      {formatNutrition(recipe.total_protein)}g
                    </Text>
                    <Text className='nutrition-label'>蛋白质</Text>
                  </View>
                  <View className='nutrition-item'>
                    <Text className='nutrition-value'>
                      {formatNutrition(recipe.total_carbs)}g
                    </Text>
                    <Text className='nutrition-label'>碳水</Text>
                  </View>
                  <View className='nutrition-item'>
                    <Text className='nutrition-value'>
                      {formatNutrition(recipe.total_fat)}g
                    </Text>
                    <Text className='nutrition-label'>脂肪</Text>
                  </View>
                </View>

                {/* 标签 */}
                {recipe.tags && recipe.tags.length > 0 && (
                  <View className='tags'>
                    {recipe.meal_type && (
                      <Text className='tag'>
                        {MEAL_TYPE_NAMES[recipe.meal_type] || recipe.meal_type}
                      </Text>
                    )}
                    {recipe.tags.map((tag, index) => (
                      <Text key={index} className='tag'>
                        {tag}
                      </Text>
                    ))}
                  </View>
                )}

                {/* 使用统计 */}
                <View className='recipe-stats'>
                  <Text className='stats-text'>使用 {recipe.use_count} 次</Text>
                  {recipe.last_used_at && (
                    <Text className='stats-text'>
                      最近使用：{new Date(recipe.last_used_at).toLocaleDateString()}
                    </Text>
                  )}
                </View>

                {/* 操作按钮 */}
                <View className='recipe-actions'>
                  <View
                    className='action-btn use-btn'
                    onClick={() => handleUseRecipe(recipe)}
                  >
                    <Text className='action-icon'>✅</Text>
                    <Text className='action-text'>使用</Text>
                  </View>
                  <View
                    className='action-btn edit-btn'
                    onClick={() => handleEditRecipe(recipe)}
                  >
                    <Text className='action-icon'>✏️</Text>
                    <Text className='action-text'>编辑</Text>
                  </View>
                  <View
                    className='action-btn delete-btn'
                    onClick={() => handleDeleteRecipe(recipe)}
                  >
                    <Text className='action-icon'>🗑️</Text>
                    <Text className='action-text'>删除</Text>
                  </View>
                </View>
              </View>
            </View>
          ))
        ) : (
          <View className='empty-state'>
            <Text className='empty-icon'>
              {activeTab === 'favorite' ? '⭐' : '📝'}
            </Text>
            <Text className='empty-text'>
              {activeTab === 'favorite' ? '暂无收藏的食谱' : '暂无食谱'}
            </Text>
            <Text className='empty-hint'>
              从识别结果页保存食谱后，将显示在这里
            </Text>
          </View>
        )}
      </ScrollView>

      {/* 创建按钮 */}
      <View className='create-btn' onClick={handleCreateRecipe}>
        <Text className='create-icon'>+</Text>
      </View>
    </View>
  )
}
