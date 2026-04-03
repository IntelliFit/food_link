import { View, Text, Input, Textarea, Button } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { withAuth } from '../../utils/withAuth'

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
  const [loading, setLoading] = useState(false)
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mealType, setMealType] = useState('lunch')
  const [tags, setTags] = useState<string[]>([])
  
  // 营养摘要（从传入数据读取）
  const [totalCalories, setTotalCalories] = useState(0)
  const [totalProtein, setTotalProtein] = useState(0)
  const [totalCarbs, setTotalCarbs] = useState(0)
  const [totalFat, setTotalFat] = useState(0)

  useEffect(() => {
    // 从路由参数或缓存获取数据
    const params = Taro.getCurrentInstance().router?.params
    const id = params?.id
    
    if (id) {
      setRecipeId(id)
      // 这里可以调用 API 加载食谱详情
      loadRecipeDetail(id)
    } else {
      // 新建食谱，提示用户从识别结果页保存
      Taro.showToast({
        title: '请从识别结果页保存',
        icon: 'none',
        duration: 2000
      })
      setTimeout(() => {
        Taro.navigateBack()
      }, 2000)
    }
  }, [])

  const loadRecipeDetail = async (id: string) => {
    setLoading(true)
    try {
      // TODO: 调用 API 加载食谱详情
      // const detail = await getRecipeDetail(id)
      // setName(detail.name)
      // setDescription(detail.description)
      // ...
      console.log('Load recipe:', id)
    } catch (e) {
      Taro.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      Taro.showToast({ title: '请输入食谱名称', icon: 'none' })
      return
    }

    setLoading(true)
    try {
      // TODO: 调用 API 保存食谱
      // await saveRecipe({ id: recipeId, name, description, mealType, tags })
      Taro.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 1500)
    } catch (e) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!recipeId) return

    const res = await Taro.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除这个食谱吗？'
    })

    if (!res.confirm) return

    setLoading(true)
    try {
      // TODO: 调用 API 删除食谱
      // await deleteRecipe(recipeId)
      Taro.showToast({ title: '删除成功', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 1500)
    } catch (e) {
      Taro.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <View className='recipe-edit-page'>
        <View className='loading-mask'>
          <Text className='loading-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  if (!recipeId) {
    return (
      <View className='recipe-edit-page'>
        <View className='empty-card'>
          <Text className='empty-icon'>📝</Text>
          <Text className='empty-title'>无法编辑食谱</Text>
          <Text className='empty-desc'>请从识别结果页保存食谱后再编辑</Text>
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
            onInput={(e) => setName(e.detail.value)}
          />
        </View>

        <View className='form-item'>
          <Text className='label'>描述</Text>
          <Textarea
            className='textarea'
            placeholder='请输入食谱描述（可选）'
            value={description}
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
                onClick={() => setMealType(meal.id)}
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
            <Text className='summary-value'>{totalCalories}</Text>
            <Text className='summary-label'>热量 (kcal)</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>{totalProtein}</Text>
            <Text className='summary-label'>蛋白质 (g)</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>{totalCarbs}</Text>
            <Text className='summary-label'>碳水 (g)</Text>
          </View>
          <View className='summary-item'>
            <Text className='summary-value'>{totalFat}</Text>
            <Text className='summary-label'>脂肪 (g)</Text>
          </View>
        </View>
      </View>

      <View className='action-bar'>
        {recipeId && (
          <View className='danger-btn' onClick={handleDelete}>
            <Text className='danger-btn-text'>删除食谱</Text>
          </View>
        )}
        <View className='primary-btn' onClick={handleSave}>
          <Text className='primary-btn-text'>保存</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(RecipeEditPage)
