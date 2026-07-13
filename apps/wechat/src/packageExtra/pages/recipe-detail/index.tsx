import { View, Text, Image, ScrollView, Button } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import {
  getUserRecipe,
  applyUserRecipe,
  deleteUserRecipe,
  showUnifiedApiError,
  type UserRecipe
} from '../../../utils/api'
import { extraPkgUrl } from '../../../utils/subpackage-extra'
import { HOME_INTAKE_DATA_CHANGED_EVENT } from '../../../utils/home-events'
import {
  addWaterToBodyMetricsStorage,
  calculateFoodRecordItemsWaterMl,
  refreshHomeDashboardLocalSnapshotFromCloud
} from '../../../utils/home-dashboard-local-cache'
import { getStoredRecordTargetDate } from '../../../utils/record-date'

import './index.scss'

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '加餐'
}

function RecipeDetailPage() {
  const router = useRouter()
  const recipeId = String(router.params?.id || '').trim()
  const currentUserId = String(Taro.getStorageSync('user_id') || '').trim()

  const [recipe, setRecipe] = useState<UserRecipe | null>(null)
  const [loading, setLoading] = useState(false)
  const [using, setUsing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!recipeId) {
      Taro.showToast({ title: '缺少食谱ID', icon: 'none' })
      setTimeout(() => Taro.navigateBack(), 1500)
      return
    }
    loadRecipe()
  }, [recipeId])

  const loadRecipe = async () => {
    setLoading(true)
    try {
      const data = await getUserRecipe(recipeId)
      setRecipe(data)
    } catch (e) {
      await showUnifiedApiError(e, '加载失败')
      Taro.navigateBack()
    } finally {
      setLoading(false)
    }
  }

  const handleUse = async () => {
    if (!recipe) return
    setUsing(true)
    try {
      const mealType = recipe.meal_type || 'afternoon_snack'
      await applyUserRecipe(recipe.id, mealType, 'favorite_recipe')
      const targetDate = getStoredRecordTargetDate()
      addWaterToBodyMetricsStorage(targetDate, calculateFoodRecordItemsWaterMl(recipe.items || []))
      try {
        await refreshHomeDashboardLocalSnapshotFromCloud(targetDate)
      } catch (_) {}
      Taro.eventCenter.trigger(HOME_INTAKE_DATA_CHANGED_EVENT, { date: targetDate, force: true })
      Taro.showToast({ title: '已记录', icon: 'success' })
    } catch (e) {
      await showUnifiedApiError(e, '记录失败')
    } finally {
      setUsing(false)
    }
  }

  const handleEdit = () => {
    if (!recipe) return
    Taro.navigateTo({ url: `${extraPkgUrl('/pages/recipe-edit/index')}?id=${encodeURIComponent(recipe.id)}` })
  }

  const handleDelete = async () => {
    if (!recipe) return
    const res = await Taro.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这个收藏吗？'
    })
    if (!res.confirm) return
    setDeleting(true)
    try {
      await deleteUserRecipe(recipe.id)
      Taro.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 1500)
    } catch (e) {
      await showUnifiedApiError(e, '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <View className='recipe-detail-page'>
        <View className='recipe-detail-loading'>
          <View className='recipe-detail-spinner' />
        </View>
      </View>
    )
  }

  if (!recipe) {
    return (
      <View className='recipe-detail-page'>
        <View className='recipe-detail-empty'>
          <Text className='recipe-detail-empty-title'>食谱不存在或已删除</Text>
        </View>
      </View>
    )
  }

  const isOwner = recipe.user_id === currentUserId
  const mealName = MEAL_NAMES[recipe.meal_type || ''] || recipe.meal_type || '未指定餐次'

  return (
    <View className='recipe-detail-page'>
      <ScrollView className='recipe-detail-scroll' scrollY>
        {/* 顶部：名称 + 标签 */}
        <View className='recipe-detail-header'>
          <View className='recipe-detail-title-row'>
            <Text className='recipe-detail-name'>{recipe.recipe_name || '未命名食谱'}</Text>
            <View className='recipe-detail-badge'>
              <Text className='recipe-detail-badge-text'>收藏</Text>
            </View>
          </View>
          <View className='recipe-detail-meta-row'>
            <Text className='recipe-detail-meta'>{mealName}</Text>
            {recipe.use_count > 0 && (
              <Text className='recipe-detail-meta'>已使用 {recipe.use_count} 次</Text>
            )}
          </View>
        </View>

        {/* 主图 */}
        {recipe.image_path ? (
          <View className='recipe-detail-image-wrap'>
            <Image className='recipe-detail-image' src={recipe.image_path} mode='aspectFill' />
          </View>
        ) : null}

        {/* 营养摘要 */}
        <View className='recipe-detail-section'>
          <Text className='recipe-detail-section-title'>营养摘要</Text>
          <View className='recipe-detail-summary'>
            <View className='recipe-detail-summary-item'>
              <Text className='recipe-detail-summary-value'>{Math.round(recipe.total_calories)}</Text>
              <Text className='recipe-detail-summary-label'>热量 (kcal)</Text>
            </View>
            <View className='recipe-detail-summary-item'>
              <Text className='recipe-detail-summary-value'>{Math.round(recipe.total_protein)}</Text>
              <Text className='recipe-detail-summary-label'>蛋白质 (g)</Text>
            </View>
            <View className='recipe-detail-summary-item'>
              <Text className='recipe-detail-summary-value'>{Math.round(recipe.total_carbs)}</Text>
              <Text className='recipe-detail-summary-label'>碳水 (g)</Text>
            </View>
            <View className='recipe-detail-summary-item'>
              <Text className='recipe-detail-summary-value'>{Math.round(recipe.total_fat)}</Text>
              <Text className='recipe-detail-summary-label'>脂肪 (g)</Text>
            </View>
          </View>
        </View>

        {/* 食材列表 */}
        {recipe.items && recipe.items.length > 0 && (
          <View className='recipe-detail-section'>
            <Text className='recipe-detail-section-title'>食材 / 分量</Text>
            <View className='recipe-detail-items'>
              {recipe.items.map((item, idx) => (
                <View key={`item-${idx}`} className='recipe-detail-item'>
                  <View className='recipe-detail-item-main'>
                    <Text className='recipe-detail-item-name'>{item.name || '食物'}</Text>
                    <Text className='recipe-detail-item-weight'>{Math.round(item.weight || 0)}g</Text>
                  </View>
                  <Text className='recipe-detail-item-cal'>
                    {Math.round(item.nutrients?.calories || 0)} kcal
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 描述 */}
        {recipe.description ? (
          <View className='recipe-detail-section'>
            <Text className='recipe-detail-section-title'>备注</Text>
            <Text className='recipe-detail-desc'>{recipe.description}</Text>
          </View>
        ) : null}

        {/* 底部占位，避免被操作栏遮挡 */}
        <View className='recipe-detail-bottom-space' />
      </ScrollView>

      {/* 底部操作栏 */}
      <View className='recipe-detail-actions'>
        {isOwner && (
          <View className='recipe-detail-secondary-btn' onClick={handleEdit}>
            <Text className='recipe-detail-secondary-btn-text'>编辑</Text>
          </View>
        )}
        {isOwner && (
          <View className='recipe-detail-danger-btn' onClick={handleDelete}>
            <Text className='recipe-detail-danger-btn-text'>{deleting ? '删除中...' : '删除'}</Text>
          </View>
        )}
        {isOwner && (
          <Button
            className='recipe-detail-primary-btn'
            loading={using}
            onClick={handleUse}
          >
            <Text className='recipe-detail-primary-btn-text'>{using ? '记录中...' : '一键记录'}</Text>
          </Button>
        )}
      </View>
    </View>
  )
}

export default withAuth(RecipeDetailPage)
