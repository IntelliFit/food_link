import { View, Text, ScrollView, Slider } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { AnalyzeResponse, FoodItem, saveFoodRecord } from '../../utils/api'

import './index.scss'

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'dinner' as const, label: '晚餐' },
  { value: 'snack' as const, label: '加餐' }
]



interface NutritionItem {
  id: number
  name: string
  weight: number
  calorie: number
  intake: number
  ratio: number
  protein: number
  carbs: number
  fat: number
}

export default function ResultTextPage() {
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
  const [noData, setNoData] = useState(false)

  const convertApiDataToItems = (items: FoodItem[]): NutritionItem[] => {
    return items.map((item, index) => ({
      id: index + 1,
      name: item.name,
      weight: item.estimatedWeightGrams,
      calorie: item.nutrients.calories,
      intake: item.estimatedWeightGrams,
      ratio: 100,
      protein: item.nutrients.protein,
      carbs: item.nutrients.carbs,
      fat: item.nutrients.fat
    }))
  }

  const calculateNutritionStats = (items: NutritionItem[]) => {
    const stats = items.reduce(
      (acc, item) => {
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
    const total = items.reduce((sum, item) => sum + item.intake, 0)
    setTotalWeight(Math.round(total))
  }

  useEffect(() => {
    try {
      const stored = Taro.getStorageSync('analyzeTextResult')
      if (!stored) {
        setNoData(true)
        return
      }
      const result: AnalyzeResponse = JSON.parse(stored)
      setDescription(result.description || '')
      setHealthAdvice(result.insight || '保持健康饮食！')
      setPfcRatioComment(result.pfc_ratio_comment ?? null)
      setAbsorptionNotes(result.absorption_notes ?? null)
      setContextAdvice(result.context_advice ?? null)
      const items = convertApiDataToItems(result.items)
      setNutritionItems(items)
      calculateNutritionStats(items)
    } catch {
      setNoData(true)
    }
  }, [])

  const handleWeightAdjust = (id: number, delta: number) => {
    setNutritionItems((items) => {
      const updated = items.map((item) => {
        if (item.id !== id) return item
        const newWeight = Math.max(10, item.weight + delta)
        const newIntake = Math.round(newWeight * (item.ratio / 100))
        return { ...item, weight: newWeight, intake: newIntake }
      })
      calculateNutritionStats(updated)
      return updated
    })
  }

  const handleRatioAdjust = (id: number, newRatio: number) => {
    const clamped = Math.max(0, Math.min(100, newRatio))
    setNutritionItems((items) => {
      const updated = items.map((item) => {
        if (item.id !== id) return item
        const newIntake = Math.round(item.weight * (clamped / 100))
        return { ...item, ratio: clamped, intake: newIntake }
      })
      calculateNutritionStats(updated)
      return updated
    })
  }


  /** 确认记录：选择餐次，保存 */
  const handleConfirm = () => {
    Taro.showActionSheet({
      itemList: MEAL_OPTIONS.map((o) => o.label),
      success: async (mealRes) => {
        const meal = MEAL_OPTIONS[mealRes.tapIndex]
        if (!meal) return
        const { confirm } = await Taro.showModal({
          title: '确认记录',
          content: `餐次：${meal.label}\n确定保存吗？`
        })
        if (!confirm) return
        setSaving(true)
        try {
          const payload = {
            meal_type: meal.value,
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
            pfc_ratio_comment: pfcRatioComment ?? undefined,
            absorption_notes: absorptionNotes ?? undefined,
            context_advice: contextAdvice ?? undefined
          }
          await saveFoodRecord(payload)
          Taro.showToast({ title: '记录成功', icon: 'success' })
          setTimeout(() => {
            Taro.navigateBack({ delta: 1 })
          }, 1500)
        } catch (e: any) {
          Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
        } finally {
          setSaving(false)
        }
      }
    })
  }

  if (noData) {
    return (
      <View className='result-text-page'>
        <View className='empty-state'>
          <Text className='empty-icon iconfont icon-nothing'></Text>
          <Text className='empty-text'>未找到分析结果</Text>
          <Text className='empty-hint'>请从记录页使用「文字记录」并点击「开始计算」</Text>
        </View>
      </View>
    )
  }

  if (nutritionItems.length === 0) {
    return (
      <View className='result-text-page'>
        <View className='empty-state'>
          <Text className='empty-icon iconfont icon-shizhong'></Text>
          <Text className='empty-text'>加载中...</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='result-text-page'>
      <ScrollView className='result-scroll' scrollY enhanced showScrollbar={false}>
        {/* 文字记录标题区（无图片） */}
        <View className='text-result-header'>
          <Text className='text-result-title'>
            <Text className='iconfont icon-jishiben' style={{ marginRight: 8, fontSize: 20 }}></Text>
            文字记录分析
          </Text>
        </View>

        {/* AI 健康透视（含 PFC、吸收率、情境建议） */}
        <View className='health-section'>
          <View className='section-header'>
            <Text className='section-icon iconfont icon-a-144-lvye'></Text>
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
              <Text className='advice-label'>
                <Text className='iconfont icon-tubiao-zhuzhuangtu' style={{ marginRight: 6 }}></Text>
                PFC 比例
              </Text>
              <Text className='advice-text'>{pfcRatioComment}</Text>
            </View>
          )}
          {absorptionNotes && (
            <View className='advice-box pro-box'>
              <Text className='advice-label'>
                <Text className='iconfont icon-huore' style={{ marginRight: 6 }}></Text>
                吸收与利用
              </Text>
              <Text className='advice-text'>{absorptionNotes}</Text>
            </View>
          )}
          {contextAdvice && (
            <View className='advice-box pro-box'>
              <Text className='advice-label'>
                <Text className='iconfont icon-shizhong' style={{ marginRight: 6 }}></Text>
                情境建议
              </Text>
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
              </View>
            </View>
          </View>
          <View className='nutrition-grid'>
            <View className='nutrition-card'>
              <Text className='nutrition-icon iconfont icon-huore'></Text>
              <Text className='nutrition-label'>热量</Text>
              <Text className='nutrition-value'>
                {Math.round(nutritionStats.calories * 10) / 10} kcal
              </Text>
            </View>
            <View className='nutrition-card'>
              <Text className='nutrition-icon iconfont icon-danbaizhi'></Text>
              <Text className='nutrition-label'>蛋白质</Text>
              <Text className='nutrition-value'>
                {Math.round(nutritionStats.protein * 10) / 10} g
              </Text>
            </View>
            <View className='nutrition-card'>
              <Text className='nutrition-icon iconfont icon-tanshui-dabiao'></Text>
              <Text className='nutrition-label'>总碳水</Text>
              <Text className='nutrition-value'>
                {Math.round(nutritionStats.carbs * 10) / 10} g
              </Text>
            </View>
            <View className='nutrition-card'>
              <Text className='nutrition-icon iconfont icon-zhifangyouheruhuazhifangzhipin'></Text>
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

        {/* 确认记录按钮 */}
        <View className='confirm-section'>
          <View
            className='confirm-btn'
            onClick={handleConfirm}
            style={{ opacity: saving ? 0.7 : 1 }}
          >
            <Text className='confirm-btn-text'>
              {saving ? '保存中...' : '确认记录'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
