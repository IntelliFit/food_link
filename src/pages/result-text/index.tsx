import { View, Text, ScrollView, Slider } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { AnalyzeResponse, FoodItem, MealType, saveFoodRecord } from '../../utils/api'

import './index.scss'

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'morning_snack' as const, label: '早加餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'afternoon_snack' as const, label: '午加餐' },
  { value: 'dinner' as const, label: '晚餐' },
  { value: 'evening_snack' as const, label: '晚加餐' }
]
type SelectableMealType = (typeof MEAL_OPTIONS)[number]['value']

const MEAL_ICONS = {
  breakfast: 'icon-zaocan',
  morning_snack: 'icon-lingshi',
  lunch: 'icon-wucan',
  afternoon_snack: 'icon-lingshi',
  dinner: 'icon-wancan',
  evening_snack: 'icon-lingshi'
}

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

type MacroField = 'protein' | 'carbs' | 'fat'

const MACRO_FIELDS: MacroField[] = ['protein', 'carbs', 'fat']

const MACRO_FIELD_META: Record<MacroField, { label: string; className: string }> = {
  protein: { label: '蛋白质', className: 'protein' },
  carbs: { label: '碳水', className: 'carbs' },
  fat: { label: '脂肪', className: 'fat' }
}

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10

const formatMacroDisplay = (value: number) => roundToSingleDecimal(value).toFixed(1)

const calculateCaloriesFromMacros = (protein: number, carbs: number, fat: number) => (
  roundToSingleDecimal(protein) * 4 + roundToSingleDecimal(carbs) * 4 + roundToSingleDecimal(fat) * 9
)

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

  // 餐次选择弹窗状态
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>('breakfast')

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
        const weightScale = item.weight > 0 ? newWeight / item.weight : 1
        const nextProtein = item.protein * weightScale
        const nextCarbs = item.carbs * weightScale
        const nextFat = item.fat * weightScale
        const newIntake = Math.round(newWeight * (item.ratio / 100))
        return {
          ...item,
          weight: newWeight,
          intake: newIntake,
          calorie: calculateCaloriesFromMacros(nextProtein, nextCarbs, nextFat),
          protein: nextProtein,
          carbs: nextCarbs,
          fat: nextFat
        }
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

  const updateMacroField = (
    id: number,
    field: MacroField,
    nextValue: number | ((currentValue: number) => number)
  ) => {
    setNutritionItems((items) => {
      const updated = items.map((item) => {
        if (item.id !== id) return item
        const resolvedValue = typeof nextValue === 'function' ? nextValue(item[field]) : nextValue
        const normalizedValue = Math.max(0, roundToSingleDecimal(resolvedValue))
        const nextItem = {
          ...item,
          [field]: normalizedValue
        } as NutritionItem
        return {
          ...nextItem,
          calorie: calculateCaloriesFromMacros(nextItem.protein, nextItem.carbs, nextItem.fat)
        }
      })
      calculateNutritionStats(updated)
      return updated
    })
  }

  const handleMacroEdit = (id: number, field: MacroField, currentValue: number) => {
    const meta = MACRO_FIELD_META[field]
    Taro.showModal({
      title: `修改${meta.label}(g)`,
      content: formatMacroDisplay(currentValue),
      // @ts-ignore
      editable: true,
      placeholderText: '请输入克数',
      success: (res) => {
        if (!res.confirm) return
        const nextText = String((res as any).content ?? '').trim()
        const parsed = Number(nextText)
        if (!nextText || !Number.isFinite(parsed) || parsed < 0) {
          Taro.showToast({ title: '请输入不小于0的数字', icon: 'none' })
          return
        }
        updateMacroField(id, field, parsed)
      }
    })
  }

  // 修改食物名称
  const handleEditName = (id: number, currentName: string) => {
    Taro.showModal({
      title: '修改食物名称',
      content: currentName,
      // @ts-ignore
      editable: true,
      placeholderText: '请输入新的食物名称',
      success: (res) => {
        if (res.confirm) {
          const newName = (res as any).content.trim()
          if (!newName) {
            Taro.showToast({ title: '名称不能为空', icon: 'none' }); return
          }
          setNutritionItems(items => items.map(item =>
            item.id === id ? { ...item, name: newName } : item
          ))
        }
      }
    })
  }

  /** 保存记录：saveOnly=true 仅保存，false 保存后跳详情页 */
  const saveRecord = async (saveOnly: boolean, confirmedMealType?: SelectableMealType) => {
    // 确定餐次
    let mealType = confirmedMealType || 'breakfast'

    setSaving(true)
    try {
      const payload = {
        meal_type: mealType as MealType,
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
      // @ts-ignore
      const saveResult = await saveFoodRecord(payload)

      if (saveOnly) {
        Taro.showToast({ title: '记录成功', icon: 'success' })
        setTimeout(() => {
          Taro.navigateBack({ delta: 1 })
        }, 1200)
        return
      }

      Taro.showToast({ title: '已保存，去分享', icon: 'success' })
      setTimeout(() => {
        Taro.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(saveResult.id)}` })
      }, 500)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  /** 点击保存按钮：打开餐次选择弹窗 */
  const handleConfirmAndShare = () => {
    // 默认选中
    setSelectedMealType('breakfast')
    setShowMealSelector(true)
  }

  /** 弹窗确认保存 */
  const handleConfirmMealType = () => {
    setShowMealSelector(false)
    saveRecord(false, selectedMealType)
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
        {/* 顶部 Hero 区域 (Text Version) */}
        <View className='hero-section'>
          <View className='hero-icon-wrapper'>
            <Text className='iconfont icon-jishiben'></Text>
          </View>
          <Text className='hero-title'>文字记录分析</Text>
          <View className='hero-overlay'></View>
        </View>

        <View className='content-container'>
          {/* 核心营养概览 */}
          <View className='nutrition-overview-card'>
            <View className='nutrition-header'>
              <View className='calories-main'>
                <Text className='calories-value'>{Math.round(nutritionStats.calories)}</Text>
                <View className='calories-unit-row'>
                  <Text className='calories-unit'>kcal</Text>
                  <Text className='calories-label'>总热量</Text>
                </View>
              </View>
              <View className='total-weight-badge'>
                <Text className='weight-icon iconfont icon-tianpingzuo'></Text>
                <Text className='weight-text'>约 {totalWeight}g</Text>
              </View>
            </View>

            <View className='macro-grid'>
              <View className='macro-item protein'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${Math.min((nutritionStats.protein / 50) * 100, 100)}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.protein * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>蛋白质</Text>
              </View>
              <View className='macro-item carbs'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${Math.min((nutritionStats.carbs / 100) * 100, 100)}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.carbs * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>碳水</Text>
              </View>
              <View className='macro-item fat'>
                <View className='macro-bar'>
                  <View className='macro-progress' style={{ height: `${Math.min((nutritionStats.fat / 40) * 100, 100)}%` }}></View>
                </View>
                <Text className='macro-value'>{Math.round(nutritionStats.fat * 10) / 10}<Text className='macro-unit'>g</Text></Text>
                <Text className='macro-label'>脂肪</Text>
              </View>
            </View>
          </View>

          {/* AI 健康透视 */}
          <View className='insight-card'>
            <View className='card-header'>
              <Text className='card-title'>
                <Text className='iconfont icon-a-144-lvye'></Text>
                AI 饮食透视
              </Text>
            </View>

            {description && (
              <View className='insight-item intro'>
                <View className='insight-icon-wrapper blue'>
                  <Text className='insight-icon iconfont icon-jishiben'></Text>
                </View>
                <Text className='insight-content'>{description}</Text>
              </View>
            )}

            <View className='insight-item highlight'>
              <View className='insight-icon-wrapper green'>
                <Text className='insight-icon iconfont icon-good'></Text>
              </View>
              <Text className='insight-content'>{healthAdvice}</Text>
            </View>

            {pfcRatioComment && (
              <View className='insight-item ratio'>
                <View className='insight-icon-wrapper orange'>
                  <Text className='insight-icon iconfont icon-tubiao-zhuzhuangtu'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>营养比例</Text>
                  <Text className='insight-content'>{pfcRatioComment}</Text>
                </View>
              </View>
            )}

            {absorptionNotes && (
              <View className='insight-item absorption'>
                <View className='insight-icon-wrapper purple'>
                  <Text className='insight-icon iconfont icon-huore'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>吸收与利用</Text>
                  <Text className='insight-content'>{absorptionNotes}</Text>
                </View>
              </View>
            )}

            {contextAdvice && (
              <View className='insight-item intro'>
                <View className='insight-icon-wrapper blue'>
                  <Text className='insight-icon iconfont icon-shizhong'></Text>
                </View>
                <View className='insight-body'>
                  <Text className='insight-label'>情境建议</Text>
                  <Text className='insight-content'>{contextAdvice}</Text>
                </View>
              </View>
            )}
          </View>

          {/* 包含成分 */}
          <View className='ingredients-section'>
            <View className='section-title-row'>
              <Text className='section-title'>包含成分</Text>
              <Text className='section-count'>共 {nutritionItems.length} 项</Text>
            </View>

            <View className='ingredients-list'>
              {nutritionItems.map((item) => (
                <View key={item.id} className='ingredient-card'>
                  <View className='ingredient-main'>
                    <View className='ingredient-header'>
                      <View className='edit-icon-wrapper' onClick={() => handleEditName(item.id, item.name)}>
                        <Text className='iconfont icon-bianji'></Text>
                      </View>
                      <Text className='ingredient-name'>{item.name}</Text>
                    </View>
                    <View className='ingredient-calories'>
                      <Text className='cal-val'>{Math.round(item.calorie * (item.ratio / 100))}</Text>
                      <Text className='cal-unit'>kcal</Text>
                    </View>
                  </View>

                  <View className='ingredient-controls'>
                    {/* 重量调节 */}
                    <View className='weight-control'>
                      <Text className='control-label'>估算重量</Text>
                      <View className='weight-adjuster'>
                        <View className='adjust-btn minus' onClick={() => handleWeightAdjust(item.id, -10)}>
                          -
                        </View>
                        <Text className='weight-display'>{item.weight}g</Text>
                        <View className='adjust-btn plus' onClick={() => handleWeightAdjust(item.id, 10)}>
                          +
                        </View>
                      </View>
                    </View>

                    {/* 比例调节 */}
                    <View className='ratio-control'>
                      <View className='ratio-header'>
                        <Text className='control-label'>实际摄入比例</Text>
                        <Text className='ratio-display'>{item.ratio}%</Text>
                      </View>
                      <Slider
                        className='ratio-slider-modern'
                        value={item.ratio}
                        min={0}
                        max={100}
                        step={5}
                        activeColor='#00bc7d'
                        backgroundColor='#e2e8f0'
                        blockSize={24}
                        blockColor='#ffffff'
                        showValue={false}
                        onChange={(e) => handleRatioAdjust(item.id, e.detail.value)}
                      />
                    </View>

                    <View className='macro-editor'>
                      <View className='macro-editor-grid'>
                        {MACRO_FIELDS.map((field) => {
                          const meta = MACRO_FIELD_META[field]
                          const intakeMacro = item[field] * (item.ratio / 100)
                          return (
                            <View key={`${item.id}-${field}`} className={`macro-editor-item ${meta.className}`}>
                              <View
                                className='macro-editor-chip'
                                onClick={() => handleMacroEdit(item.id, field, item[field])}
                              >
                                <Text className='macro-editor-item-label'>{meta.label}</Text>
                                <Text className='macro-editor-value'>{formatMacroDisplay(intakeMacro)}g</Text>
                              </View>
                            </View>
                          )
                        })}
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* 底部占位 */}
          <View style={{ height: '40rpx' }}></View>
        </View>
      </ScrollView>

      {/* 底部固定操作栏 */}
      <View className='footer-actions'>
        <View className='pba-safe-area'>
          <View className='action-grid'>
            <View className={`primary-btn ${saving ? 'loading' : ''}`} onClick={saving ? undefined : handleConfirmAndShare}>
              <Text className='btn-text'>{saving ? '保存中...' : '确认记录'}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 餐次选择弹窗 */}
      <View className={`meal-selector-overlay ${showMealSelector ? 'visible' : ''}`} onClick={() => setShowMealSelector(false)}>
        <View className='meal-selector-card' onClick={(e) => e.stopPropagation()}>
          <Text className='selector-title'>选择餐次</Text>

          <View className='meal-options-grid'>
            {MEAL_OPTIONS.map((option) => (
              <View
                key={option.value}
                className={`meal-option-item ${selectedMealType === option.value ? 'active' : ''}`}
                onClick={() => setSelectedMealType(option.value)}
              >
                <Text className={`option-icon iconfont ${MEAL_ICONS[option.value]}`}></Text>
                <Text className='option-label'>{option.label}</Text>
              </View>
            ))}
          </View>

          <View className='selector-actions'>
            <View className='cancel-btn' onClick={() => setShowMealSelector(false)}>
              取消
            </View>
            <View className='confirm-btn' onClick={handleConfirmMealType}>
              确认保存
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
