import { View, Text, Image, ScrollView, Slider, Swiper, SwiperItem, Input, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { AnalyzeResponse, FoodItem, MealType, Nutrients, UnitNutritionPer100g, saveFoodRecord, saveCriticalSamples, getAccessToken, createUserRecipe, updateAnalysisTaskResult, submitAnalyzeTask, searchFoodNutritionCandidates } from '../../utils/api'

import './index.scss'

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'morning_snack' as const, label: '早加餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'afternoon_snack' as const, label: '午加餐' },
  { value: 'dinner' as const, label: '晚餐' },
  { value: 'evening_snack' as const, label: '晚加餐' },
]
type SelectableMealType = (typeof MEAL_OPTIONS)[number]['value']

const MEAL_ICONS = {
  breakfast: 'icon-zaocan',
  morning_snack: 'icon-lingshi',
  lunch: 'icon-wucan',
  afternoon_snack: 'icon-lingshi',
  dinner: 'icon-wancan',
  evening_snack: 'icon-lingshi',
}

const toSelectableMealType = (value: unknown): SelectableMealType | undefined => {
  if (value === 'snack') return 'afternoon_snack'
  const hit = MEAL_OPTIONS.find((o) => o.value === value)
  return hit?.value
}

// 移除未使用的 CONTEXT_STATE_OPTIONS


interface NutritionItem {
  id: number
  name: string
  weight: number // 当前重量（用户可调节）
  originalWeight: number // AI 初始估算重量（用于标记样本时计算偏差）
  calorie: number // 基于 weight 的总热量
  unitCaloriesPer100g: number // 每100g热量
  intake: number // 实际摄入量 = weight × ratio
  ratio: number // 摄入比例（0-100%，独立调节）
  protein: number
  carbs: number
  fat: number
  unitProteinPer100g: number
  unitCarbsPer100g: number
  unitFatPer100g: number
  nutrients: Nutrients
  unitNutrientsPer100g: UnitNutritionPer100g
  matchedFoodName?: string | null
  isUnresolved?: boolean
  resolveStatus?: string | null
}

const createEmptyNutrients = (): Nutrients => ({
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  saturatedFat: 0,
  cholesterolMg: 0,
  sodiumMg: 0,
  potassiumMg: 0,
  calciumMg: 0,
  ironMg: 0,
  magnesiumMg: 0,
  zincMg: 0,
  vitaminARaeMcg: 0,
  vitaminCMg: 0,
  vitaminDMcg: 0,
  vitaminEMg: 0,
  vitaminKMcg: 0,
  thiaminMg: 0,
  riboflavinMg: 0,
  niacinMg: 0,
  vitaminB6Mg: 0,
  folateMcg: 0,
  vitaminB12Mcg: 0
})

const createUnitNutrients = (unit?: Partial<UnitNutritionPer100g> | null): UnitNutritionPer100g => ({
  ...createEmptyNutrients(),
  ...(unit || {})
})

const scaleNutrientsByWeight = (weight: number, unit: UnitNutritionPer100g): Nutrients => {
  const factor = (Number.isFinite(weight) ? weight : 0) / 100
  return {
    calories: Math.round(unit.calories * factor * 100) / 100,
    protein: Math.round(unit.protein * factor * 100) / 100,
    carbs: Math.round(unit.carbs * factor * 100) / 100,
    fat: Math.round(unit.fat * factor * 100) / 100,
    fiber: Math.round(unit.fiber * factor * 100) / 100,
    sugar: Math.round(unit.sugar * factor * 100) / 100,
    saturatedFat: Math.round(unit.saturatedFat * factor * 100) / 100,
    cholesterolMg: Math.round(unit.cholesterolMg * factor * 100) / 100,
    sodiumMg: Math.round(unit.sodiumMg * factor * 100) / 100,
    potassiumMg: Math.round(unit.potassiumMg * factor * 100) / 100,
    calciumMg: Math.round(unit.calciumMg * factor * 100) / 100,
    ironMg: Math.round(unit.ironMg * factor * 100) / 100,
    magnesiumMg: Math.round(unit.magnesiumMg * factor * 100) / 100,
    zincMg: Math.round(unit.zincMg * factor * 100) / 100,
    vitaminARaeMcg: Math.round(unit.vitaminARaeMcg * factor * 100) / 100,
    vitaminCMg: Math.round(unit.vitaminCMg * factor * 100) / 100,
    vitaminDMcg: Math.round(unit.vitaminDMcg * factor * 100) / 100,
    vitaminEMg: Math.round(unit.vitaminEMg * factor * 100) / 100,
    vitaminKMcg: Math.round(unit.vitaminKMcg * factor * 100) / 100,
    thiaminMg: Math.round(unit.thiaminMg * factor * 100) / 100,
    riboflavinMg: Math.round(unit.riboflavinMg * factor * 100) / 100,
    niacinMg: Math.round(unit.niacinMg * factor * 100) / 100,
    vitaminB6Mg: Math.round(unit.vitaminB6Mg * factor * 100) / 100,
    folateMcg: Math.round(unit.folateMcg * factor * 100) / 100,
    vitaminB12Mcg: Math.round(unit.vitaminB12Mcg * factor * 100) / 100
  }
}

export default function ResultPage() {
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imagePath, setImagePath] = useState<string>('') // Keep for compatibility/fallback logic
  const [totalWeight, setTotalWeight] = useState(0)
  const [nutritionItems, setNutritionItems] = useState<NutritionItem[]>([])
  const [nutritionStats, setNutritionStats] = useState({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    pendingItems: 0
  })
  const [healthAdvice, setHealthAdvice] = useState('')
  const [description, setDescription] = useState('')
  const [pfcRatioComment, setPfcRatioComment] = useState<string | null>(null)
  const [absorptionNotes, setAbsorptionNotes] = useState<string | null>(null)
  const [contextAdvice, setContextAdvice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasSavedCritical, setHasSavedCritical] = useState(false)

  // 餐次选择弹窗状态
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>('breakfast')

  // 二次纠错抽屉状态
  const [showCorrectionDrawer, setShowCorrectionDrawer] = useState(false)
  const [correctionItems, setCorrectionItems] = useState<NutritionItem[]>([])
  const [additionalContext, setAdditionalContext] = useState('')
  const [isResubmitting, setIsResubmitting] = useState(false)

  const calculateByUnit = (weight: number, unitPer100g: number): number => {
    const safeWeight = Number.isFinite(weight) ? weight : 0
    const safeUnit = Number.isFinite(unitPer100g) ? unitPer100g : 0
    return Math.round((safeWeight * safeUnit) / 100 * 100) / 100
  }

  const openQuickUpload = (recordId: string) => {
    Taro.navigateTo({
      url: `/pages/food-library-share/index?source_record_id=${encodeURIComponent(recordId)}&quick_upload=1`
    })
  }

  // 将API返回的数据转换为页面需要的格式（保留 originalWeight 用于标记样本时计算偏差）
  const convertApiDataToItems = (items: FoodItem[]): NutritionItem[] => {
    return items.map((item, index) => {
      const aiWeight = item.originalWeightGrams ?? item.estimatedWeightGrams
      const safeWeight = Number.isFinite(item.estimatedWeightGrams) ? item.estimatedWeightGrams : 0
      const fallbackUnit = createUnitNutrients({
        calories: safeWeight > 0 ? (item.nutrients.calories * 100) / safeWeight : 0,
        protein: safeWeight > 0 ? (item.nutrients.protein * 100) / safeWeight : 0,
        carbs: safeWeight > 0 ? (item.nutrients.carbs * 100) / safeWeight : 0,
        fat: safeWeight > 0 ? (item.nutrients.fat * 100) / safeWeight : 0,
        fiber: safeWeight > 0 ? (item.nutrients.fiber * 100) / safeWeight : 0,
        sugar: safeWeight > 0 ? (item.nutrients.sugar * 100) / safeWeight : 0,
        saturatedFat: safeWeight > 0 ? (item.nutrients.saturatedFat * 100) / safeWeight : 0,
        cholesterolMg: safeWeight > 0 ? (item.nutrients.cholesterolMg * 100) / safeWeight : 0,
        sodiumMg: safeWeight > 0 ? (item.nutrients.sodiumMg * 100) / safeWeight : 0,
        potassiumMg: safeWeight > 0 ? (item.nutrients.potassiumMg * 100) / safeWeight : 0,
        calciumMg: safeWeight > 0 ? (item.nutrients.calciumMg * 100) / safeWeight : 0,
        ironMg: safeWeight > 0 ? (item.nutrients.ironMg * 100) / safeWeight : 0,
        magnesiumMg: safeWeight > 0 ? (item.nutrients.magnesiumMg * 100) / safeWeight : 0,
        zincMg: safeWeight > 0 ? (item.nutrients.zincMg * 100) / safeWeight : 0,
        vitaminARaeMcg: safeWeight > 0 ? (item.nutrients.vitaminARaeMcg * 100) / safeWeight : 0,
        vitaminCMg: safeWeight > 0 ? (item.nutrients.vitaminCMg * 100) / safeWeight : 0,
        vitaminDMcg: safeWeight > 0 ? (item.nutrients.vitaminDMcg * 100) / safeWeight : 0,
        vitaminEMg: safeWeight > 0 ? (item.nutrients.vitaminEMg * 100) / safeWeight : 0,
        vitaminKMcg: safeWeight > 0 ? (item.nutrients.vitaminKMcg * 100) / safeWeight : 0,
        thiaminMg: safeWeight > 0 ? (item.nutrients.thiaminMg * 100) / safeWeight : 0,
        riboflavinMg: safeWeight > 0 ? (item.nutrients.riboflavinMg * 100) / safeWeight : 0,
        niacinMg: safeWeight > 0 ? (item.nutrients.niacinMg * 100) / safeWeight : 0,
        vitaminB6Mg: safeWeight > 0 ? (item.nutrients.vitaminB6Mg * 100) / safeWeight : 0,
        folateMcg: safeWeight > 0 ? (item.nutrients.folateMcg * 100) / safeWeight : 0,
        vitaminB12Mcg: safeWeight > 0 ? (item.nutrients.vitaminB12Mcg * 100) / safeWeight : 0
      })
      const unitNutrientsPer100g = createUnitNutrients(item.unit_nutrition_per_100g || fallbackUnit)
      const nutrients = scaleNutrientsByWeight(safeWeight, unitNutrientsPer100g)
      return {
        id: index + 1,
        name: item.name,
        weight: safeWeight,
        originalWeight: aiWeight,
        calorie: nutrients.calories,
        unitCaloriesPer100g: unitNutrientsPer100g.calories,
        intake: safeWeight,
        ratio: 100,
        protein: nutrients.protein,
        carbs: nutrients.carbs,
        fat: nutrients.fat,
        unitProteinPer100g: unitNutrientsPer100g.protein,
        unitCarbsPer100g: unitNutrientsPer100g.carbs,
        unitFatPer100g: unitNutrientsPer100g.fat,
        nutrients,
        unitNutrientsPer100g,
        matchedFoodName: item.matched_food_name,
        isUnresolved: item.is_unresolved,
        resolveStatus: item.resolve_status
      }
    })
  }

  // 计算总营养统计
  const calculateNutritionStats = (items: NutritionItem[]) => {
    const stats = items.reduce(
      (acc, item) => {
        // 使用 ratio 来计算实际摄入的营养
        const ratio = item.ratio / 100
        if (item.isUnresolved && item.intake > 0) {
          return {
            ...acc,
            pendingItems: acc.pendingItems + 1
          }
        }
        return {
          calories: acc.calories + item.calorie * ratio,
          protein: acc.protein + item.protein * ratio,
          carbs: acc.carbs + item.carbs * ratio,
          fat: acc.fat + item.fat * ratio,
          pendingItems: acc.pendingItems
        }
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0, pendingItems: 0 }
    )
    setNutritionStats(stats)

    // 计算总摄入重量
    const total = items.reduce((sum, item) => sum + item.intake, 0)
    setTotalWeight(Math.round(total))
  }

  useEffect(() => {
    // 获取传递的图片路径和分析结果
    try {
      const storedPaths = Taro.getStorageSync('analyzeImagePaths')
      const storedPath = Taro.getStorageSync('analyzeImagePath')

      if (storedPaths && Array.isArray(storedPaths) && storedPaths.length > 0) {
        setImagePaths(storedPaths)
        setImagePath(storedPaths[0]) // Primary for compatibility
      } else if (storedPath) {
        setImagePath(storedPath)
        setImagePaths([storedPath])
      }

      const storedResult = Taro.getStorageSync('analyzeResult')
      if (storedResult) {
        const result: AnalyzeResponse = JSON.parse(storedResult)
        setDescription(result.description || '')
        setHealthAdvice(result.insight || '保持健康饮食！')
        setPfcRatioComment(result.pfc_ratio_comment ?? null)
        setAbsorptionNotes(result.absorption_notes ?? null)
        setContextAdvice(result.context_advice ?? null)
        const items = convertApiDataToItems(result.items)
        setNutritionItems(items)
        calculateNutritionStats(items)
      } else {
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
            intake: newIntake,
            nutrients: scaleNutrientsByWeight(newWeight, item.unitNutrientsPer100g),
            // 由每100g单位值重新计算，避免累计误差
            calorie: calculateByUnit(newWeight, item.unitCaloriesPer100g),
            protein: calculateByUnit(newWeight, item.unitProteinPer100g),
            carbs: calculateByUnit(newWeight, item.unitCarbsPer100g),
            fat: calculateByUnit(newWeight, item.unitFatPer100g)
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

  // 修改食物名称
  const handleEditName = (id: number, currentName: string) => {
    // @ts-ignore
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
            Taro.showToast({
              title: '名称不能为空',
              icon: 'none'
            })
            return
          }

          // 确认保存修改
          Taro.showModal({
            title: '确认保存',
            content: `确定将食物名称修改为"${newName}"吗？`,
            success: async (confirmRes) => {
              if (confirmRes.confirm) {
                // 1. 更新本地状态
                const updatedItems = nutritionItems.map(item =>
                  item.id === id ? { ...item, name: newName } : item
                )
                setNutritionItems(updatedItems)

                // 2. 尝试同步更新后端 analysis_tasks 记录（如果有 taskId）
                const sourceTaskId = Taro.getStorageSync('analyzeSourceTaskId')
                if (sourceTaskId) {
                  try {
                    Taro.showLoading({ title: '同步中...' })

                    // 构建新的 result 对象（基于当前页面状态）
                    // 注意：后端 updateAnalysisTaskResult 接收整个 result 对象
                    // 我们尽量还原 AnalyzeResponse 的结构
                    const newResult: AnalyzeResponse = {
                      description,
                      insight: healthAdvice,
                      items: updatedItems.map(item => ({
                        name: item.name,
                        estimatedWeightGrams: item.weight,
                        originalWeightGrams: item.originalWeight,
                        nutrients: item.nutrients,
                        unit_nutrition_per_100g: item.unitNutrientsPer100g
                      })),
                      pfc_ratio_comment: pfcRatioComment || undefined,
                      absorption_notes: absorptionNotes || undefined,
                      context_advice: contextAdvice || undefined
                    }

                    await updateAnalysisTaskResult(sourceTaskId, newResult)

                    // 同时更新本地缓存的 analyzeResult，以免用户刷新后丢失修改
                    Taro.setStorageSync('analyzeResult', JSON.stringify(newResult))

                    Taro.hideLoading()
                    Taro.showToast({ title: '已更新并同步', icon: 'success' })
                  } catch (error) {
                    console.error('同步更新 analysis_tasks 失败:', error)
                    Taro.hideLoading()
                    // 即使后端同步失败，本地已经修改了，也提示成功但告知同步失败
                    Taro.showToast({ title: '本地已更新(同步失败)', icon: 'none' })
                  }
                } else {
                  // 没有 taskId，仅本地更新
                  Taro.showToast({ title: '已更新', icon: 'success' })
                }
              }
            }
          })
        }
      }
    })
  }

  const handleResolveByCandidate = async (id: number) => {
    const current = nutritionItems.find((x) => x.id === id)
    if (!current) return
    try {
      const { items } = await searchFoodNutritionCandidates(current.name, 6)
      if (!items || items.length === 0) {
        Taro.showToast({ title: '暂无近似食物，请手动输入', icon: 'none' })
        return
      }
      const labels = items.map((x) => `${x.canonical_name} (${Math.round(x.unit_nutrition_per_100g.calories)} kcal/100g)`)
      const tapIndex = await new Promise<number>((resolve, reject) => {
        Taro.showActionSheet({
          itemList: labels,
          success: (res) => resolve(res.tapIndex),
          fail: reject
        })
      })
      const selected = items[tapIndex]
      if (!selected) return
      setNutritionItems((prev) => {
        const updated = prev.map((x) => {
          if (x.id !== id) return x
          return {
            ...x,
            nutrients: scaleNutrientsByWeight(x.weight, createUnitNutrients(selected.unit_nutrition_per_100g)),
            unitNutrientsPer100g: createUnitNutrients(selected.unit_nutrition_per_100g),
            matchedFoodName: selected.canonical_name,
            unitCaloriesPer100g: selected.unit_nutrition_per_100g.calories,
            unitProteinPer100g: selected.unit_nutrition_per_100g.protein,
            unitCarbsPer100g: selected.unit_nutrition_per_100g.carbs,
            unitFatPer100g: selected.unit_nutrition_per_100g.fat,
            calorie: calculateByUnit(x.weight, selected.unit_nutrition_per_100g.calories),
            protein: calculateByUnit(x.weight, selected.unit_nutrition_per_100g.protein),
            carbs: calculateByUnit(x.weight, selected.unit_nutrition_per_100g.carbs),
            fat: calculateByUnit(x.weight, selected.unit_nutrition_per_100g.fat),
            isUnresolved: false,
            resolveStatus: 'manual_candidate'
          }
        })
        calculateNutritionStats(updated)
        return updated
      })
      Taro.showToast({ title: '已应用候选', icon: 'success' })
    } catch {
      // 用户取消或接口失败
    }
  }

  const handleManualUnitCaloriesInput = (id: number) => {
    // @ts-ignore
    Taro.showModal({
      title: '手动输入每100g热量',
      content: '',
      // @ts-ignore
      editable: true,
      placeholderText: '例如 156',
      success: (res) => {
        if (!res.confirm) return
        const value = Number((res as any).content || 0)
        if (!Number.isFinite(value) || value <= 0) {
          Taro.showToast({ title: '请输入大于0的数字', icon: 'none' })
          return
        }
        setNutritionItems((prev) => {
          const updated = prev.map((x) => {
            if (x.id !== id) return x
            return {
              ...x,
              nutrients: scaleNutrientsByWeight(x.weight, createUnitNutrients({ calories: value })),
              unitNutrientsPer100g: createUnitNutrients({ calories: value }),
              unitCaloriesPer100g: value,
              calorie: calculateByUnit(x.weight, value),
              unitProteinPer100g: 0,
              unitCarbsPer100g: 0,
              unitFatPer100g: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
              isUnresolved: false,
              resolveStatus: 'manual_kcal'
            }
          })
          calculateNutritionStats(updated)
          return updated
        })
      }
    })
  }

  /** 保存记录：saveOnly=true 仅保存，false 保存后跳详情页 */
  const saveRecord = async (saveOnly: boolean, confirmedMealType?: SelectableMealType) => {
    // 避免用户快速连续点击导致重复保存
    if (saving) return
    // 从缓存获取分析时选择的状态
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
    const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')

    // 确定餐次：优先使用确认过的餐次，否则尝试从缓存读取，最后默认早餐
    let mealType = confirmedMealType
    if (!mealType) {
      mealType = toSelectableMealType(savedMealType) || 'breakfast'
    }
    const mealLabel = MEAL_OPTIONS.find((o) => o.value === mealType)?.label || '早餐'

    // 饮食目标和时机，未找到默认无
    const dietGoal = savedDietGoal || 'none'
    const activityTiming = savedActivityTiming || 'none'

    const doSave = async () => {
      setSaving(true)
      try {
        // 清除相关缓存
        Taro.removeStorageSync('analyzeMealType')
        Taro.removeStorageSync('analyzeDietGoal')
        Taro.removeStorageSync('analyzeActivityTiming')

        const sourceTaskId = Taro.getStorageSync('analyzeSourceTaskId') || undefined
        const payload = {
          meal_type: mealType as MealType,
          image_path: imagePath || undefined,
          image_paths: imagePaths.length > 0 ? imagePaths : undefined,
          description: description || undefined,
          insight: healthAdvice || undefined,
          items: nutritionItems.map((item) => ({
            name: item.name,
            weight: item.weight,
            ratio: item.ratio,
            intake: item.intake,
            nutrients: item.nutrients
          })),
          total_calories: nutritionStats.calories,
          total_protein: nutritionStats.protein,
          total_carbs: nutritionStats.carbs,
          total_fat: nutritionStats.fat,
          total_weight_grams: totalWeight,
          diet_goal: dietGoal,
          activity_timing: activityTiming,
          pfc_ratio_comment: pfcRatioComment ?? undefined,
          absorption_notes: absorptionNotes ?? undefined,
          context_advice: contextAdvice ?? undefined,
          source_task_id: sourceTaskId
        }
        const saveResult = await saveFoodRecord(payload)
        if (sourceTaskId) Taro.removeStorageSync('analyzeSourceTaskId')

        if (saveOnly) {
          Taro.showToast({ title: '记录成功', icon: 'success' })
          setTimeout(() => {
            Taro.navigateBack({ delta: 2 })
          }, 1200)
          return
        }

        const hasUploadableImage = imagePaths.length > 0 || !!imagePath
        if (!hasUploadableImage) {
          Taro.showToast({ title: '记录成功', icon: 'success' })
          setTimeout(() => {
            Taro.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(saveResult.id)}` })
          }, 500)
          return
        }

        const { confirm } = await Taro.showModal({
          title: '记录成功',
          content: '要不要顺手上传到公共食物库？只需补充商家、位置或是否自制等信息。',
          confirmText: '去上传',
          cancelText: '先不用'
        })

        if (confirm) {
          openQuickUpload(saveResult.id)
          return
        }

        Taro.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(saveResult.id)}` })
      } catch (e: any) {
        Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
      } finally {
        setSaving(false)
      }
    }

    // 如果已经传了 confirmedMealType，说明是经过弹窗确认的，直接保存
    if (confirmedMealType) {
      await doSave()
    } else {
      // 否则走旧的确认流程（防止直接调用时没有确认）
      Taro.showModal({
        title: '确认记录',
        content: `餐次：${mealLabel}\n确定保存当前饮食记录吗？`,
        success: async (res) => {
          if (!res.confirm) return
          await doSave()
        }
      })
    }
  }

  /** 点击保存按钮：打开餐次选择弹窗 */
  const handleConfirmAndShare = () => {
    const openSelector = () => {
      // 初始化选中的餐次：缓存 > 默认早餐
      const savedMealType = Taro.getStorageSync('analyzeMealType')
      const normalized = toSelectableMealType(savedMealType)
      if (normalized) {
        setSelectedMealType(normalized)
      } else {
        setSelectedMealType('breakfast')
      }
      setShowMealSelector(true)
    }
    if (nutritionStats.pendingItems > 0) {
      Taro.showModal({
        title: '仍有待确认食物',
        content: `当前有 ${nutritionStats.pendingItems} 项未确认，未计入总热量。是否继续记录？`,
        confirmText: '继续记录',
        cancelText: '先处理',
        success: (res) => {
          if (res.confirm) openSelector()
        }
      })
      return
    }
    openSelector()
  }

  /** 弹窗确认保存 */
  const handleConfirmMealType = () => {
    setShowMealSelector(false)
    saveRecord(false, selectedMealType)
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

  // 收藏食物（保存为可复用模板）
  const handleSaveAsRecipe = () => {
    // 检查登录
    const token = getAccessToken()
    if (!token) {
      Taro.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    // 获取餐次信息
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const mealType = toSelectableMealType(savedMealType)

    // 弹窗输入收藏名称
    Taro.showModal({
      title: '收藏食物',
      content: '请输入收藏名称',
      // @ts-ignore
      editable: true,
      // @ts-ignore
      placeholderText: '例如：我的标配减脂早餐',
      success: async (res) => {
        if (res.confirm && (res as any).content) {
          const recipeName = (res as any).content.trim()
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
              nutrients: nutritionItem.nutrients
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
              title: '收藏成功',
              content: '已收藏，可在“我的食谱”中快速复用记录',
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

  // --- 二次纠错功能相关方法 ---

  // 打开纠错抽屉
  const openCorrectionDrawer = () => {
    // 拷贝当前营养项到纠错列表
    setCorrectionItems(JSON.parse(JSON.stringify(nutritionItems)))
    setAdditionalContext('')
    setShowCorrectionDrawer(true)
  }

  // 修改纠错项的名称
  const handleCorrectionNameChange = (id: number, val: string) => {
    setCorrectionItems(prev => prev.map(item => item.id === id ? { ...item, name: val } : item))
  }

  // 修改纠错项的重量
  const handleCorrectionWeightChange = (id: number, val: string) => {
    const num = parseInt(val, 10) || 0
    setCorrectionItems(prev => prev.map(item => item.id === id ? { ...item, weight: num } : item))
  }

  // 删除纠错项
  const handleRemoveCorrectionItem = (id: number) => {
    setCorrectionItems(prev => prev.filter(item => item.id !== id))
  }

  // 添加新的空白食物项
  const handleAddCorrectionItem = () => {
    setCorrectionItems(prev => [
      ...prev,
      {
        id: Date.now(), // 临时 ID
        name: '',
        weight: 100, // 默认 100g
        originalWeight: 100,
        calorie: 0,
        unitCaloriesPer100g: 0,
        intake: 100,
        ratio: 100,
        protein: 0,
        carbs: 0,
        fat: 0,
        unitProteinPer100g: 0,
        unitCarbsPer100g: 0,
        unitFatPer100g: 0,
        nutrients: createEmptyNutrients(),
        unitNutrientsPer100g: createUnitNutrients(),
        matchedFoodName: null,
        isUnresolved: false,
        resolveStatus: 'manual'
      }
    ])
  }

  // 提交二次纠正重新分析
  const handleSubmitCorrection = async () => {
    if (correctionItems.length === 0) {
      Taro.showToast({ title: '食物列表不能为空', icon: 'none' })
      return
    }

    // 检查是否有空名称
    if (correctionItems.some(item => !item.name.trim())) {
      Taro.showToast({ title: '请填写所有食物名称', icon: 'none' })
      return
    }

    Taro.showModal({
      title: '重新智能分析',
      content: '确定要根据当前的纠正内容重新进行饮食分析吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: async (modalRes) => {
        if (!modalRes.confirm) return

        try {
          setIsResubmitting(true)
          Taro.showLoading({ title: '提交分析中...', mask: true })

          // 1. 构建提示文本 context
          const correctionsText = correctionItems.map((item, idx) => `${idx + 1}. ${item.name} ${item.weight}g`).join('; ')
          let finalContext = `用户已将识别结果纠正为：${correctionsText}。请根据最新的列表和重量重新进行详细的营养分析。`

          if (additionalContext.trim()) {
            finalContext += `\n补充说明：${additionalContext.trim()}`
          }

          // 为了保留第一次分析带过来的上下文（例如菜谱偏好等），如果有 description 也可以带上，但更重要的是传上面构成的 finalContext

          // 2. 获取原请求的基础配置
          const savedMealType = Taro.getStorageSync('analyzeMealType') as MealType | undefined
          const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
          const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')

          let taskId = ''

          // 3. 区分是图片分析还是纯文字分析
          if (imagePaths.length > 0 || imagePath) {
            // 图片分析
            const res = await submitAnalyzeTask({
              image_url: imagePaths[0] || imagePath,
              image_urls: imagePaths.length > 0 ? imagePaths : undefined,
              additionalContext: finalContext,
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming
            })
            taskId = res.task_id
          } else {
            // 纯文本分析
            // 因为没有保留第一次的原始输入的完整的文本，我们可以直接用修正后的列表作为主 text
            const textPayload = `${correctionsText}\n${additionalContext.trim()}`
            const { submitTextAnalyzeTask } = await import('../../utils/api') // 如果没引入可以直接用
            const res = await submitTextAnalyzeTask({
              text: textPayload,
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming
            })
            taskId = res.task_id
          }

          Taro.hideLoading()
          setShowCorrectionDrawer(false)

          // 4. 跳转到 loading 页面重新走解析流程
          const taskType = (imagePaths.length > 0 || imagePath) ? 'food_image' : 'food_text'
          Taro.navigateTo({
            url: `/pages/analyze-loading/index?task_id=${taskId}&task_type=${taskType}`
          })

        } catch (e: any) {
          Taro.hideLoading()
          Taro.showToast({ title: e.message || '重新分析失败', icon: 'none' })
        } finally {
          setIsResubmitting(false)
        }
      }
    })
  }

  // 预览大图
  const handlePreviewImage = (current: string) => {
    if (imagePaths.length > 0) {
      Taro.previewImage({
        current,
        urls: imagePaths
      })
    }
  }

  return (
    <View className='result-page'>
      <ScrollView
        className='result-scroll'
        scrollY
        enhanced
        showScrollbar={false}
      >
        {/* 顶部图片区域 - 沉浸式设计 */}
        <View className='hero-section'>
          {imagePaths.length > 0 ? (
            <Swiper
              className='hero-swiper'
              circular
              indicatorDots={false}
              onChange={(e) => setCurrentImageIndex(e.detail.current)}
              current={currentImageIndex}
            >
              {imagePaths.map((path, index) => (
                <SwiperItem key={index} className='hero-swiper-item'>
                  <Image
                    src={path}
                    mode='aspectFill'
                    className='hero-image'
                    onClick={() => handlePreviewImage(path)}
                  />
                </SwiperItem>
              ))}
            </Swiper>
          ) : (
            <View className='hero-placeholder'>
              <Text className='placeholder-icon iconfont icon-paizhao-xianxing'></Text>
              <Text className='placeholder-text'>暂无图片</Text>
            </View>
          )}

          {/* Image Counter Badge */}
          {imagePaths.length > 1 && (
            <View className='image-counter'>
              <Text className='counter-text'>{currentImageIndex + 1}/{imagePaths.length}</Text>
            </View>
          )}

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
                  <Text className='calories-label'>已确认热量</Text>
                </View>
                {nutritionStats.pendingItems > 0 && (
                  <Text className='pending-summary'>+ {nutritionStats.pendingItems} 项待确认</Text>
                )}
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
                AI 饮食分析
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
              <View className='insight-item context'>
                <View className='insight-icon-wrapper teal'>
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
              <Text className='section-count'>{nutritionItems.length}种</Text>
            </View>

            <View className='ingredients-list'>
              {nutritionItems.some(item => item.isUnresolved) && (
                <View className='unresolved-notice'>
                  <Text>部分食物未命中数据库，已自动记录到待补全列表。你可以选择近似食物或手动输入每100g热量。</Text>
                </View>
              )}
              <View className='ingredients-table-header'>
                <Text className='th-food'>食物</Text>
                <Text className='th-weight'>重量(g)</Text>
                <Text className='th-unit-cal'>每100g热量</Text>
                <Text className='th-total-cal'>本次热量</Text>
              </View>
              {nutritionItems.map((item) => (
                <View key={item.id} className='ingredient-card'>
                  <View className='ingredient-main'>
                    <View className='ingredient-header'>
                      <View className='ingredient-name-wrapper'>
                        <Text className='ingredient-name'>{item.name}</Text>
                        {item.isUnresolved && (
                          <Text className='unresolved-tag'>未收录</Text>
                        )}
                      </View>
                      <View className='edit-icon-wrapper' onClick={() => handleEditName(item.id, item.name)}>
                        <Text className='iconfont icon-shouxieqianming'></Text>
                      </View>
                    </View>
                    <View className='ingredient-metrics-row'>
                      <View className='metric-cell metric-weight'>
                        <Text className='metric-label'>重量(g)</Text>
                        <Text className='metric-value'>{Math.round(item.weight)}</Text>
                      </View>
                      <View className='metric-cell metric-unit-cal'>
                        <Text className='metric-label'>每100g(kcal)</Text>
                        <Text className='metric-value'>{item.isUnresolved ? '--' : Math.round(item.unitCaloriesPer100g)}</Text>
                      </View>
                      <View className='metric-cell metric-total-cal'>
                        <Text className='metric-label'>本次(kcal)</Text>
                        <View className='ingredient-calories'>
                          {item.isUnresolved ? (
                            <Text className='pending-cal-text'>待确认</Text>
                          ) : (
                            <>
                              <Text className='cal-val'>{Math.round(item.calorie * (item.ratio / 100))}</Text>
                              <Text className='cal-unit'>kcal</Text>
                            </>
                          )}
                        </View>
                      </View>
                    </View>
                  </View>

                  <View className='ingredient-controls'>
                    {item.isUnresolved && (
                      <View className='resolve-actions'>
                        <View className='resolve-btn' onClick={() => handleResolveByCandidate(item.id)}>
                          <Text>选择近似食物</Text>
                        </View>
                        <View className='resolve-btn secondary' onClick={() => handleManualUnitCaloriesInput(item.id)}>
                          <Text>手动输入每100g热量</Text>
                        </View>
                      </View>
                    )}
                    <View className='weight-control'>
                      <Text className='control-label'>估算重量</Text>
                      <View className='weight-adjuster'>
                        <View
                          className='adjust-btn minus'
                          onClick={() => handleWeightAdjust(item.id, -10)}
                        >–</View>
                        <Text className='weight-display'>{item.weight}g</Text>
                        <View
                          className='adjust-btn plus'
                          onClick={() => handleWeightAdjust(item.id, 10)}
                        >+</View>
                      </View>
                    </View>

                    <View className='ratio-control'>
                      <View className='ratio-header'>
                        <Text className='control-label'>实际摄入</Text>
                        <Text className='ratio-display'>{item.ratio}%</Text>
                      </View>
                      <Slider
                        className='ratio-slider-modern'
                        value={item.ratio}
                        min={0}
                        max={100}
                        step={5}
                        activeColor='#00bc7d'
                        backgroundColor='#e5e7eb'
                        blockSize={16}
                        blockColor='#ffffff'
                        showValue={false}
                        onChange={(e) => handleRatioAdjust(item.id, e.detail.value)}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* 底部操作区域 */}
          <View className='footer-actions'>
            <View className='pba-safe-area'>
              <View className='action-grid'>
                <View className='secondary-btn' onClick={handleSaveAsRecipe}>
                  <Text className='btn-text'>收藏餐食</Text>
                </View>
                <View
                  className={`primary-btn ${saving ? 'loading' : ''}`}
                  onClick={handleConfirmAndShare}
                >
                  <Text className='btn-text'>{saving ? '保存中...' : '记录'}</Text>
                </View>
              </View>

              <View
                className={`feedback-link-row`}
              >
                <View className='correction-entry' onClick={openCorrectionDrawer}>
                  <Text className='iconfont icon-shouxieqianming correction-icon'></Text>
                  <Text className='correction-text'>识别有误？点击纠错</Text>
                </View>
                <View
                  className={`feedback-link ${hasSavedCritical ? 'disabled' : ''}`}
                  onClick={hasSavedCritical ? undefined : handleMarkSample}
                >
                  <Text className='feedback-text'>
                    {hasSavedCritical ? '已标记偏差样本 ✓' : '估算不准？点击标记样本'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 餐次选择弹窗 */}
      <View
        className={`meal-selector-overlay ${showMealSelector ? 'visible' : ''}`}
        onClick={() => setShowMealSelector(false)}
      >
        <View
          className='meal-selector-card'
          onClick={(e) => e.stopPropagation()}
        >
          <View className='selector-title'>选择餐次</View>
          <View className='meal-options-grid'>
            {MEAL_OPTIONS.map((meal) => (
              <View
                key={meal.value}
                className={`meal-option-item ${selectedMealType === meal.value ? 'active' : ''}`}
                onClick={() => setSelectedMealType(meal.value)}
              >
                <Text className={`iconfont ${MEAL_ICONS[meal.value]} option-icon`}></Text>
                <Text className='option-label'>{meal.label}</Text>
              </View>
            ))}
          </View>
          <View className='selector-actions'>
            <View className='cancel-btn' onClick={() => setShowMealSelector(false)}>取消</View>
            <View className='confirm-btn' onClick={handleConfirmMealType}>保存</View>
          </View>
        </View>
      </View>

      {/* 二次纠错抽屉弹窗 */}
      <View
        className={`correction-drawer-overlay ${showCorrectionDrawer ? 'visible' : ''}`}
        onClick={() => setShowCorrectionDrawer(false)}
      >
        <View
          className={`correction-drawer-content ${showCorrectionDrawer ? 'slide-up' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <View className='drawer-header'>
            <Text className='drawer-title'>二次分析纠正</Text>
            <View className='drawer-close' onClick={() => setShowCorrectionDrawer(false)}>
              <Text className='close-icon'>✕</Text>
            </View>
          </View>

          <ScrollView className='drawer-scroll' scrollY>
            <View className='correction-list'>
              {correctionItems.map((item, index) => (
                <View key={item.id} className='correction-row'>
                  <View className='correction-index'>{index + 1}.</View>
                  <View className='correction-inputs'>
                    <Input
                      className='correction-input name-input'
                      value={item.name}
                      placeholder='食物名称'
                      onInput={(e: any) => handleCorrectionNameChange(item.id, e.detail.value)}
                    />
                    <View className='weight-input-wrapper'>
                      <Input
                        className='correction-input weight-input'
                        type='number'
                        value={item.weight.toString()}
                        onInput={(e: any) => handleCorrectionWeightChange(item.id, e.detail.value)}
                      />
                      <Text className='weight-unit'>g</Text>
                    </View>
                  </View>
                  <View className='correction-remove' onClick={() => handleRemoveCorrectionItem(item.id)}>
                    <Text className='iconfont icon-close'></Text>
                  </View>
                </View>
              ))}
            </View>

            <View className='add-correction-btn' onClick={handleAddCorrectionItem}>
              <Text className='iconfont icon-plus'></Text>
              <Text>添加食物</Text>
            </View>

            <View className='additional-context-wrapper'>
              <View className='context-label'>
                <Text className='iconfont icon-jishiben'></Text>
                <Text>补充说明（可选）</Text>
              </View>
              <Textarea
                className='context-textarea'
                placeholder='例如：这碗饭大概有 300g，鸡腿是整只未去骨，我只吃了蛋白'
                value={additionalContext}
                onInput={(e: any) => setAdditionalContext(e.detail.value)}
                maxlength={200}
                autoHeight
              />
            </View>
          </ScrollView>

          <View className='drawer-footer'>
            <View
              className={`drawer-submit-btn ${isResubmitting ? 'loading' : ''}`}
              onClick={handleSubmitCorrection}
            >
              <Text className='iconfont icon-loading'></Text>
              <Text>{isResubmitting ? '提交中...' : '重新智能分析'}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
