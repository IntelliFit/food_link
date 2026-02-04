import { View, Text, Image, ScrollView, Slider } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { AnalyzeResponse, FoodItem, saveFoodRecord, saveCriticalSamples, getAccessToken, createUserRecipe } from '../../utils/api'

import './index.scss'

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'dinner' as const, label: '晚餐' },
  { value: 'snack' as const, label: '加餐' }
]

/** 用户当前状态（确认记录时选择，≤6 项以满足微信 showActionSheet 限制） */
const CONTEXT_STATE_OPTIONS = [
  { value: 'post_workout', label: '刚健身完' },
  { value: 'fasting', label: '空腹/餐前' },
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无特殊' }
]

interface NutritionItem {
  id: number
  name: string
  weight: number // 当前重量（用户可调节）
  originalWeight: number // AI 初始估算重量（用于标记样本时计算偏差）
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
  const [pfcRatioComment, setPfcRatioComment] = useState<string | null>(null)
  const [absorptionNotes, setAbsorptionNotes] = useState<string | null>(null)
  const [contextAdvice, setContextAdvice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasSavedCritical, setHasSavedCritical] = useState(false)

  // 将API返回的数据转换为页面需要的格式（保留 originalWeight 用于标记样本时计算偏差）
  const convertApiDataToItems = (items: FoodItem[]): NutritionItem[] => {
    return items.map((item, index) => {
      const aiWeight = item.originalWeightGrams ?? item.estimatedWeightGrams
      return {
        id: index + 1,
        name: item.name,
        weight: item.estimatedWeightGrams,
        originalWeight: aiWeight,
        calorie: item.nutrients.calories,
        intake: item.estimatedWeightGrams,
        ratio: 100,
        protein: item.nutrients.protein,
        carbs: item.nutrients.carbs,
        fat: item.nutrients.fat
      }
    })
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
        setPfcRatioComment(result.pfc_ratio_comment ?? null)
        setAbsorptionNotes(result.absorption_notes ?? null)
        setContextAdvice(result.context_advice ?? null)
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

  /** 确认记录：若分析页已选餐次与状态则直接确认保存，否则先选状态再选餐次 */
  const handleConfirm = () => {
    const savedContextState = Taro.getStorageSync('analyzeContextState')
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const contextStateValue = savedContextState && typeof savedContextState === 'string' ? savedContextState : null
    const contextStateLabel = contextStateValue
      ? (CONTEXT_STATE_OPTIONS.find((o) => o.value === contextStateValue)?.label ?? contextStateValue)
      : null
    const mealFromStorage = savedMealType && MEAL_OPTIONS.find((o) => o.value === savedMealType)
    const mealLabel = mealFromStorage?.label ?? null
    const mealValue = mealFromStorage?.value ?? null

    const performSave = (stateValue: string, stateLabel: string, mealType: string, mealLabelText: string) => {
      Taro.showModal({
        title: '确认记录',
        content: `当前状态：${stateLabel}\n餐次：${mealLabelText}\n确定保存吗？`,
        success: async (res) => {
          if (!res.confirm) return
          setSaving(true)
          try {
            Taro.removeStorageSync('analyzeContextState')
            Taro.removeStorageSync('analyzeMealType')
            const payload = {
              meal_type: mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack',
              image_path: imagePath || undefined,
              description: description || undefined,
              insight: healthAdvice || undefined,
              items: nutritionItems.map((item) => ({
                name: item.name,
                weight: item.weight,
                ratio: item.ratio,
                intake: item.intake,
                nutrients: {
                  calories: item.calorie,
                  protein: item.protein,
                  carbs: item.carbs,
                  fat: item.fat,
                  fiber: 0,
                  sugar: 0
                }
              })),
              total_calories: nutritionStats.calories,
              total_protein: nutritionStats.protein,
              total_carbs: nutritionStats.carbs,
              total_fat: nutritionStats.fat,
              total_weight_grams: totalWeight,
              context_state: stateValue,
              pfc_ratio_comment: pfcRatioComment ?? undefined,
              absorption_notes: absorptionNotes ?? undefined,
              context_advice: contextAdvice ?? undefined
            }
            await saveFoodRecord(payload)
            Taro.showToast({ title: '记录成功', icon: 'success' })
            setTimeout(() => {
              Taro.navigateBack({ delta: 2 })
            }, 1500)
          } catch (e: any) {
            Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
          } finally {
            setSaving(false)
          }
        }
      })
    }

    // 分析页已选餐次与状态：直接确认保存，不再弹选择
    if (contextStateValue && contextStateLabel && mealValue && mealLabel) {
      performSave(contextStateValue, contextStateLabel, mealValue, mealLabel)
      return
    }
    // 仅有状态：选餐次后确认保存
    if (contextStateValue && contextStateLabel) {
      Taro.showActionSheet({
        itemList: MEAL_OPTIONS.map((o) => o.label),
        success: (mealRes) => {
          const meal = MEAL_OPTIONS[mealRes.tapIndex]
          if (!meal) return
          performSave(contextStateValue, contextStateLabel, meal.value, meal.label)
        }
      })
      return
    }
    // 都未选：先选状态再选餐次
    Taro.showActionSheet({
      itemList: CONTEXT_STATE_OPTIONS.map((o) => o.label),
      success: (stateRes) => {
        const contextState = CONTEXT_STATE_OPTIONS[stateRes.tapIndex]
        if (!contextState) return
        Taro.showActionSheet({
          itemList: MEAL_OPTIONS.map((o) => o.label),
          success: (mealRes) => {
            const meal = MEAL_OPTIONS[mealRes.tapIndex]
            if (!meal) return
            performSave(contextState.value, contextState.label, meal.value, meal.label)
          }
        })
      }
    })
  }

  /** 标记样本：将当前有重量偏差的项提交为偏差样本（参考 hkh 实现） */
  const handleMarkSample = async () => {
    if (hasSavedCritical) {
      Taro.showToast({ title: '已标记为偏差样本', icon: 'none' })
      return
    }
    const token = getAccessToken()
    if (!token) {
      Taro.showToast({ title: '请先登录以保存偏差样本', icon: 'none' })
      return
    }
    // 手动标记：只要有 1g 以上差异就记录（与 hkh 一致）
    const thresholdGrams = 1
    const samples = nutritionItems
      .filter((item) => item.originalWeight > 0 && Math.abs(item.weight - item.originalWeight) > thresholdGrams)
      .map((item) => {
        const diff = item.weight - item.originalWeight
        const percent = (diff / item.originalWeight) * 100
        return {
          image_path: imagePath || undefined,
          food_name: item.name,
          ai_weight: item.originalWeight,
          user_weight: item.weight,
          deviation_percent: Math.round(percent)
        }
      })
    if (samples.length === 0) {
      Taro.showToast({ title: '请先修改上方的重量数值，以便我们记录偏差', icon: 'none' })
      return
    }
    Taro.showModal({
      title: '确认标记样本',
      content: `确定将当前 ${samples.length} 个食物的偏差标记为样本吗？将用于后续优化 AI 估算。`,
      confirmText: '确定',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await saveCriticalSamples(samples)
          setHasSavedCritical(true)
          Taro.showToast({
            title: `已标记 ${samples.length} 个偏差样本`,
            icon: 'none'
          })
        } catch (e: any) {
          Taro.showToast({
            title: e?.message || '保存偏差样本失败',
            icon: 'none'
          })
        }
      }
    })
  }

  // 保存为食谱
  const handleSaveAsRecipe = () => {
    // 检查登录
    const token = getAccessToken()
    if (!token) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    // 获取餐次信息
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const mealType = savedMealType && MEAL_OPTIONS.find((o) => o.value === savedMealType)
      ? savedMealType
      : undefined

    // 弹窗输入食谱名称
    Taro.showModal({
      title: '保存为食谱',
      content: '请输入食谱名称',
      editable: true,
      placeholderText: '例如：我的标配减脂早餐',
      success: async (res) => {
        if (res.confirm && res.content) {
          const recipeName = res.content.trim()
          if (!recipeName) {
            Taro.showToast({ title: '请输入食谱名称', icon: 'none' })
            return
          }

          Taro.showLoading({ title: '保存中...', mask: true })
          
          try {
            // 构建食谱数据
            const recipeItems = nutritionItems.map(nutritionItem => ({
              name: nutritionItem.name,
              weight: nutritionItem.weight,
              ratio: nutritionItem.ratio,
              intake: nutritionItem.intake,
              nutrients: {
                calories: nutritionItem.calorie,
                protein: nutritionItem.protein,
                carbs: nutritionItem.carbs,
                fat: nutritionItem.fat,
                fiber: 0,
                sugar: 0
              }
            }))

            await createUserRecipe({
              recipe_name: recipeName,
              description: description || '',
              image_path: imagePath || undefined,
              items: recipeItems,
              total_calories: nutritionStats.calories,
              total_protein: nutritionStats.protein,
              total_carbs: nutritionStats.carbs,
              total_fat: nutritionStats.fat,
              total_weight_grams: totalWeight,
              meal_type: mealType,
              tags: ['自定义']
            })

            Taro.hideLoading()
            Taro.showModal({
              title: '保存成功',
              content: '食谱已保存，可在"我的"-"我的食谱"中查看和使用',
              showCancel: false
            })
          } catch (error: any) {
            Taro.hideLoading()
            Taro.showToast({
              title: error.message || '保存失败',
              icon: 'none'
            })
          }
        }
      }
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

        {/* AI 健康透视（含 PFC、吸收率、情境建议） */}
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
          {pfcRatioComment && (
            <View className='advice-box pro-box'>
              <Text className='advice-label'>📊 PFC 比例</Text>
              <Text className='advice-text'>{pfcRatioComment}</Text>
            </View>
          )}
          {absorptionNotes && (
            <View className='advice-box pro-box'>
              <Text className='advice-label'>🔬 吸收与利用</Text>
              <Text className='advice-text'>{absorptionNotes}</Text>
            </View>
          )}
          {contextAdvice && (
            <View className='advice-box pro-box'>
              <Text className='advice-label'>💡 情境建议</Text>
              <Text className='advice-text'>{contextAdvice}</Text>
            </View>
          )}
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
          <View className='confirm-btn' onClick={handleConfirm} style={{ opacity: saving ? 0.7 : 1 }}>
            <Text className='confirm-btn-text'>
              {saving ? '保存中...' : '确认记录并完成'}
            </Text>
          </View>
          
          {/* 保存为食谱按钮 */}
          <View className='save-recipe-btn' onClick={handleSaveAsRecipe}>
            <Text className='save-recipe-icon'>📖</Text>
            <Text className='save-recipe-text'>保存为食谱</Text>
          </View>
          
          <View
            className={`warning-section ${hasSavedCritical ? 'warning-section--done' : ''}`}
            onClick={hasSavedCritical ? undefined : handleMarkSample}
          >
            <Text className='warning-icon'>{hasSavedCritical ? '✓' : '⚠️'}</Text>
            <Text className='warning-text'>
              {hasSavedCritical ? '已标记为偏差样本' : '认为AI估算偏差大?点击标记样本'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

