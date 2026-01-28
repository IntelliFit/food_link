import { View, Text, Image, ScrollView, Slider } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { AnalyzeResponse, FoodItem } from '../../utils/api'

import './index.scss'

interface NutritionItem {
  id: number
  name: string
  weight: number // AI 估算的食物总重量（可通过 +- 调节）
  calorie: number // 基于 weight 的总热量
  intake: number // 实际摄入量 = weight × ratio
  ratio: number // 摄入比例（0-100%，独立调节）
  protein: number
  carbs: number
  fat: number
}

export default function ResultPage() {
  const [imagePath, setImagePath] = useState<string>('')
  const [isFavorited, setIsFavorited] = useState(false)
  const [totalWeight, setTotalWeight] = useState(0)
  const [nutritionItems, setNutritionItems] = useState<NutritionItem[]>([])
  const [nutritionStats, setNutritionStats] = useState({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  })
  const [healthAdvice, setHealthAdvice] = useState('')
  const [description, setDescription] = useState('')

  // 将API返回的数据转换为页面需要的格式
  const convertApiDataToItems = (items: FoodItem[]): NutritionItem[] => {
    return items.map((item, index) => ({
      id: index + 1,
      name: item.name,
      weight: item.estimatedWeightGrams,
      calorie: item.nutrients.calories,
      intake: item.estimatedWeightGrams, // 初始摄入量等于估算重量
      ratio: 100, // 初始比例为100%
      protein: item.nutrients.protein,
      carbs: item.nutrients.carbs,
      fat: item.nutrients.fat
    }))
  }

  // 计算总营养统计
  const calculateNutritionStats = (items: NutritionItem[]) => {
    const stats = items.reduce(
      (acc, item) => {
        // 使用 ratio 来计算实际摄入的营养
        const ratio = item.ratio / 100
        return {
          calories: acc.calories + item.calorie * ratio,
          protein: acc.protein + item.protein * ratio,
          carbs: acc.carbs + item.carbs * ratio,
          fat: acc.fat + item.fat * ratio
        }
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    )
    setNutritionStats(stats)
    
    // 计算总摄入重量
    const total = items.reduce((sum, item) => sum + item.intake, 0)
    setTotalWeight(Math.round(total))
  }

  useEffect(() => {
    // 获取传递的图片路径和分析结果
    try {
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      if (storedPath) {
        setImagePath(storedPath)
      }

      const storedResult = Taro.getStorageSync('analyzeResult')
      if (storedResult) {
        const result: AnalyzeResponse = JSON.parse(storedResult)
        
        // 设置描述和健康建议
        setDescription(result.description || '')
        setHealthAdvice(result.insight || '保持健康饮食！')
        
        // 转换并设置食物项
        const items = convertApiDataToItems(result.items)
        setNutritionItems(items)
        
        // 计算营养统计
        calculateNutritionStats(items)
      } else {
        // 如果没有分析结果，提示用户
        Taro.showModal({
          title: '提示',
          content: '未找到分析结果，请重新分析',
          showCancel: false,
          confirmText: '确定',
          success: () => {
            Taro.navigateBack()
          }
        })
      }
    } catch (error) {
      console.error('获取数据失败:', error)
      Taro.showToast({
        title: '数据加载失败',
        icon: 'none'
      })
    }
  }, [])

  const handleFavorite = () => {
    setIsFavorited(!isFavorited)
    Taro.showToast({
      title: isFavorited ? '已取消收藏' : '已收藏',
      icon: 'none'
    })
  }

  // 调节食物估算重量（+- 按钮）
  const handleWeightAdjust = (id: number, delta: number) => {
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id === id) {
          // 调节的是 weight（AI 估算的食物总重量）
          const newWeight = Math.max(10, item.weight + delta) // 最小 10g
          // ratio 保持不变，重新计算 intake
          const newIntake = Math.round(newWeight * (item.ratio / 100))
          return {
            ...item,
            weight: newWeight,
            intake: newIntake
            // ratio 不变
          }
        }
        return item
      })
      
      // 重新计算营养统计
      calculateNutritionStats(updatedItems)
      
      return updatedItems
    })
  }

  // 调节摄入比例（滑块或其他控件）
  const handleRatioAdjust = (id: number, newRatio: number) => {
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id === id) {
          // 调节的是 ratio（摄入比例）
          const clampedRatio = Math.max(0, Math.min(100, newRatio)) // 0-100%
          // weight 保持不变，重新计算 intake
          const newIntake = Math.round(item.weight * (clampedRatio / 100))
          return {
            ...item,
            ratio: clampedRatio,
            intake: newIntake
            // weight 不变
          }
        }
        return item
      })
      
      // 重新计算营养统计
      calculateNutritionStats(updatedItems)
      
      return updatedItems
    })
  }

  const handleConfirm = () => {
    Taro.showToast({
      title: '记录成功',
      icon: 'success'
    })
    setTimeout(() => {
      Taro.navigateBack({
        delta: 2 // 返回记录页面
      })
    }, 1500)
  }

  const handleMarkSample = () => {
    Taro.showToast({
      title: '已标记样本',
      icon: 'none'
    })
  }

  return (
    <View className='result-page'>
      <ScrollView
        className='result-scroll'
        scrollY
        enhanced
        showScrollbar={false}
      >
        {/* 图片区域 */}
        <View className='image-section'>
          {imagePath ? (
            <Image
              src={imagePath}
              mode='aspectFill'
              className='result-image'
            />
          ) : (
            <View className='no-image-placeholder'>
              <Text className='placeholder-text'>暂无图片</Text>
            </View>
          )}
          <View className='favorite-btn' onClick={handleFavorite}>
            <Text className={`favorite-icon ${isFavorited ? 'favorited' : ''}`}>
              {isFavorited ? '❤️' : '🤍'}
            </Text>
          </View>
        </View>

        {/* AI 健康透视 */}
        <View className='health-section'>
          <View className='section-header'>
            <Text className='section-icon'>🌿</Text>
            <Text className='section-title'>AI 健康透视</Text>
          </View>
          {description && (
            <View className='advice-box' style={{ marginBottom: '20rpx' }}>
              <Text className='advice-text'>{description}</Text>
            </View>
          )}
          <View className='advice-box'>
            <Text className='advice-text'>{healthAdvice}</Text>
          </View>
        </View>

        {/* 营养统计 */}
        <View className='nutrition-section'>
          <View className='nutrition-header'>
            <Text className='nutrition-title'>营养统计</Text>
            <View className='total-weight'>
              <Text className='weight-label'>总预估重量</Text>
              <View className='weight-value-wrapper'>
                <Text className='weight-value'>{totalWeight}</Text>
                <Text className='weight-unit'>克</Text>
                <Text className='weight-arrow'>↕️</Text>
              </View>
            </View>
          </View>

          <View className='nutrition-grid'>
            <View className='nutrition-card'>
              <Text className='nutrition-icon'>🔥</Text>
              <Text className='nutrition-label'>热量</Text>
              <Text className='nutrition-value'>
                {Math.round(nutritionStats.calories * 10) / 10} kcal
              </Text>
            </View>
            <View className='nutrition-card'>
              <Text className='nutrition-icon'>💧</Text>
              <Text className='nutrition-label'>蛋白质</Text>
              <Text className='nutrition-value'>
                {Math.round(nutritionStats.protein * 10) / 10} g
              </Text>
            </View>
            <View className='nutrition-card'>
              <Text className='nutrition-icon'>⚡</Text>
              <Text className='nutrition-label'>总碳水</Text>
              <Text className='nutrition-value'>
                {Math.round(nutritionStats.carbs * 10) / 10} g
              </Text>
            </View>
            <View className='nutrition-card'>
              <Text className='nutrition-icon'>🩸</Text>
              <Text className='nutrition-label'>总脂肪</Text>
              <Text className='nutrition-value'>
                {Math.round(nutritionStats.fat * 10) / 10} g
              </Text>
            </View>
          </View>
        </View>

        {/* 包含成分 */}
        <View className='ingredients-section'>
          <View className='section-header'>
            <Text className='section-title'>包含成分 ({nutritionItems.length})</Text>
          </View>
          <View className='ingredients-list'>
            {nutritionItems.map((item) => (
              <View key={item.id} className='ingredient-item'>
                <View className='ingredient-header'>
                  <View className='ingredient-info'>
                    <Text className='ingredient-name'>{item.name}</Text>
                    <Text className='ingredient-weight'>估算: {item.weight} g</Text>
                  </View>
                  <View className='ingredient-actions'>
                    <View 
                      className='action-btn minus-btn'
                      onClick={() => handleWeightAdjust(item.id, -10)}
                    >
                      <Text className='action-icon'>−</Text>
                    </View>
                    <View 
                      className='action-btn plus-btn'
                      onClick={() => handleWeightAdjust(item.id, 10)}
                    >
                      <Text className='action-icon'>+</Text>
                    </View>
                    <Text className='divider'>|</Text>
                    <Text className='intake-text'>实际摄入: {item.intake}g</Text>
                  </View>
                </View>
                <View className='ingredient-footer'>
                  <View className='calorie-info'>
                    <Text className='calorie-value'>
                      {Math.round(item.calorie * (item.ratio / 100))} kcal
                    </Text>
                    <Text className='calorie-arrow'>↓</Text>
                  </View>
                  <View className='ratio-info'>
                    <Text className='ratio-label'>摄入比例</Text>
                    <View className='ratio-slider-wrapper'>
                      <Slider
                        className='ratio-slider'
                        value={item.ratio}
                        min={0}
                        max={100}
                        step={5}
                        activeColor='#10b981'
                        backgroundColor='#e5e7eb'
                        blockSize={24}
                        blockColor='#10b981'
                        showValue={false}
                        onChange={(e) => handleRatioAdjust(item.id, e.detail.value)}
                      />
                      <Text className='ratio-value'>{item.ratio}%</Text>
                    </View>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* 确认按钮 */}
        <View className='confirm-section'>
          <View className='confirm-btn' onClick={handleConfirm}>
            <Text className='confirm-btn-text'>确认记录并完成</Text>
          </View>
          <View className='warning-section' onClick={handleMarkSample}>
            <Text className='warning-icon'>⚠️</Text>
            <Text className='warning-text'>认为AI估算偏差大?点击标记样本</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

