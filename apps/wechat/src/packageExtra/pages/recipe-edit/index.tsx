import { View, Text, Input, Textarea, Button } from '@tarojs/components'
import { useState, useEffect, useRef, useCallback } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { withAuth } from '../../../utils/withAuth'
import { getUserRecipe, updateUserRecipe, deleteUserRecipe, showUnifiedApiError, type UserRecipe } from '../../../utils/api'
import { formatMacroNutrient } from '../../../utils/number-format'

import './index.scss'

const MEAL_TYPES = [
  { id: 'breakfast', name: '早餐' },
  { id: 'morning_snack', name: '早加餐' },
  { id: 'lunch', name: '午餐' },
  { id: 'afternoon_snack', name: '午加餐' },
  { id: 'dinner', name: '晚餐' },
  { id: 'evening_snack', name: '晚加餐' }
]

function RecipeEditPage() {
  const recipeId = String(useRouter().params?.id || '').trim()
  const [loading, setLoading] = useState(Boolean(recipeId))
  const [recipe, setRecipe] = useState<UserRecipe | null>(null)
  const [busy, setBusy] = useState(false)
  const operationPending = useRef(false)
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mealType, setMealType] = useState('lunch')

  const loadRecipeDetail = useCallback(async () => {
    if (!recipeId) return
    setLoading(true)
    try {
      const detail = await getUserRecipe(recipeId)
      setRecipe(detail)
      setName(detail.recipe_name || '')
      setDescription(detail.description || '')
      setMealType(detail.meal_type || 'lunch')
    } catch (e) {
      await showUnifiedApiError(e, '加载失败')
    } finally {
      setLoading(false)
    }
  }, [recipeId])

  useEffect(() => {
    void loadRecipeDetail()
    return () => {
      if (returnTimer.current) clearTimeout(returnTimer.current)
    }
  }, [loadRecipeDetail])

  const returnAfterSuccess = (title: string) => {
    Taro.showToast({ title, icon: 'success' })
    returnTimer.current = setTimeout(() => {
      Taro.navigateBack({
        fail: () => { operationPending.current = false; setBusy(false) }
      })
    }, 1500)
  }

  const handleSave = async () => {
    if (!recipe || operationPending.current) return
    if (!name.trim()) {
      Taro.showToast({ title: '请输入食谱名称', icon: 'none' })
      return
    }

    operationPending.current = true
    setBusy(true)
    try {
      await updateUserRecipe(recipeId, { recipe_name: name.trim(), description: description.trim(), meal_type: mealType })
      returnAfterSuccess('保存成功')
    } catch (e) {
      operationPending.current = false
      setBusy(false)
      await showUnifiedApiError(e, '保存失败')
    }
  }

  const handleDelete = async () => {
    if (!recipe || operationPending.current) return
    operationPending.current = true
    setBusy(true)
    try {
      const res = await Taro.showModal({
        title: '确认删除',
        content: '删除后无法恢复，确定要删除这个食谱吗？'
      })
      if (!res.confirm) {
        operationPending.current = false
        setBusy(false)
        return
      }
      await deleteUserRecipe(recipeId)
      returnAfterSuccess('删除成功')
    } catch (e) {
      operationPending.current = false
      setBusy(false)
      await showUnifiedApiError(e, '删除失败')
    }
  }

  if (loading) {
    return (
      <View className='recipe-edit-page'>
        <View className='loading-mask'>
          <View className='loading-spinner-md' />
        </View>
      </View>
    )
  }

  if (!recipe) {
    return (
      <View className='recipe-edit-page'>
        <View className='empty-card'>
          <Text className='empty-icon'>📝</Text>
          <Text className='empty-title'>无法编辑食谱</Text>
          <Text className='empty-desc'>{recipeId ? '食谱详情未读取，请重试' : '请从识别结果页保存食谱后再编辑'}</Text>
          {recipeId ? <Button onClick={loadRecipeDetail}>重试</Button> : null}
        </View>
      </View>
    )
  }

  return (
    <View className='recipe-edit-page'>
      <View className='form-card'>
        <Text className='section-title'>基本信息</Text>
        
        <View className='form-item'>
          <Text className='label'>食谱名称</Text>
          <Input
            className='input'
            placeholder='请输入食谱名称'
            value={name}
            disabled={busy}
            onInput={(e) => setName(e.detail.value)}
          />
        </View>

        <View className='form-item'>
          <Text className='label'>描述</Text>
          <Textarea
            className='textarea'
            placeholder='请输入食谱描述（可选）'
            value={description}
            disabled={busy}
            onInput={(e) => setDescription(e.detail.value)}
          />
        </View>

        <View className='form-item'>
          <Text className='label'>适合餐次</Text>
          <View className='options'>
            {MEAL_TYPES.map((meal) => (
              <View
                key={meal.id}
                className={`option ${mealType === meal.id ? 'active' : ''}`}
                onClick={() => !busy && setMealType(meal.id)}
              >
                <Text className='option-text'>{meal.name}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View className='form-card'>
        <Text className='section-title'>营养摘要</Text>
        <View className='summary'>
          <View className='summary-item'>
            <Text className='summary-value'>{formatMacroNutrient(recipe.total_calories)}</Text>
            <Text className='summary-label'>热量 (kcal)</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>{formatMacroNutrient(recipe.total_protein)}</Text>
            <Text className='summary-label'>蛋白质 (g)</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>{formatMacroNutrient(recipe.total_carbs)}</Text>
            <Text className='summary-label'>碳水 (g)</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>{formatMacroNutrient(recipe.total_fat)}</Text>
            <Text className='summary-label'>脂肪 (g)</Text>
          </View>
        </View>
      </View>

      <View className='action-bar'>
        {recipeId && (
          <Button className='danger-btn' disabled={busy} onClick={handleDelete}>
            <Text className='danger-btn-text'>删除食谱</Text>
          </Button>
        )}
        <Button className='primary-btn' disabled={busy} loading={busy} onClick={handleSave}>
          <Text className='primary-btn-text'>保存</Text>
        </Button>
      </View>
    </View>
  )
}

export default withAuth(RecipeEditPage)
