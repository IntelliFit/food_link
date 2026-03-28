import { View, Text, Image, ScrollView, Slider, Swiper, SwiperItem, Input, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { AnalyzeResponse, FoodItem, MealType, saveFoodRecord, getAccessToken, createUserRecipe, updateAnalysisTaskResult, submitAnalyzeTask, submitTextAnalyzeTask, type ExecutionMode, type AnalyzeRecognitionOutcome, type AllowedFoodCategory } from '../../utils/api'

import './index.scss'

const APP_LOGO_URL = 'https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/public-assets//logo.png'
const FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY = 'foodLibraryQuickUploadDraft'

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'snack' as const, label: '加餐' },
  { value: 'dinner' as const, label: '晚餐' },
]
type SelectableMealType = (typeof MEAL_OPTIONS)[number]['value']

const EXECUTION_MODE_META: Record<ExecutionMode, { title: string; desc: string; note: string }> = {
  strict: {
    title: '精准模式',
    desc: '本次结果更强调执行准确度，会更严格地判断食物性质与定量可信度。',
    note: '适合增肌/减脂阶段，建议搭配分开摆放和补充文字说明。'
  },
  standard: {
    title: '标准模式',
    desc: '本次结果更强调记录效率，适合快速记录日常餐食。',
    note: '若你正在严格控脂控碳，建议切到精准模式再分析一次。'
  }
}

const normalizeExecutionMode = (value: unknown): ExecutionMode => (
  value === 'strict' ? 'strict' : 'standard'
)

const normalizeTaskType = (value: unknown): 'food' | 'food_text' => (
  value === 'food_text' ? 'food_text' : 'food'
)

const normalizeRecognitionOutcome = (value: unknown): AnalyzeRecognitionOutcome => (
  value === 'soft_reject' || value === 'hard_reject' ? value : 'ok'
)

const normalizeAllowedFoodCategory = (value: unknown): AllowedFoodCategory => (
  value === 'carb' || value === 'lean_protein' ? value : 'unknown'
)

const FOOD_CATEGORY_LABEL: Record<AllowedFoodCategory, string> = {
  carb: '单纯碳水',
  lean_protein: '单纯瘦肉',
  unknown: '未命中精准白名单'
}

const RECOGNITION_OUTCOME_META: Record<AnalyzeRecognitionOutcome, { title: string; desc: string }> = {
  ok: {
    title: '符合精准模式',
    desc: '当前结果可作为本次精准执行的参考。'
  },
  soft_reject: {
    title: '不建议直接用于精准执行',
    desc: '主体大致可识别，但当前图片条件还不够理想，建议补拍后再确认。'
  },
  hard_reject: {
    title: '请分开拍或重拍',
    desc: '当前画面不符合精准模式要求，这次结果不应直接用于记录和执行。'
  }
}

const MEAL_ICONS = {
  breakfast: 'icon-zaocan',
  lunch: 'icon-wucan',
  snack: 'icon-lingshi',
  dinner: 'icon-wancan',
}

const toSelectableMealType = (value: unknown): SelectableMealType | undefined => {
  if (value === 'snack' || value === 'morning_snack' || value === 'afternoon_snack' || value === 'evening_snack') return 'snack'
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
  intake: number // 实际摄入量 = weight × ratio
  ratio: number // 摄入比例（0-100%，独立调节）
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

export default function ResultPage() {
  const [taskType, setTaskType] = useState<'food' | 'food_text'>('food')
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imagePath, setImagePath] = useState<string>('') // Keep for compatibility/fallback logic
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
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('standard')
  const [recognitionOutcome, setRecognitionOutcome] = useState<AnalyzeRecognitionOutcome>('ok')
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [retakeGuidance, setRetakeGuidance] = useState<string[]>([])
  const [allowedFoodCategory, setAllowedFoodCategory] = useState<AllowedFoodCategory>('unknown')
  const [followupQuestions, setFollowupQuestions] = useState<string[]>([])

  // 餐次选择弹窗状态
  const [showMealSelector, setShowMealSelector] = useState(false)
  const [selectedMealType, setSelectedMealType] = useState<SelectableMealType>('breakfast')

  // 二次纠错抽屉状态
  const [showCorrectionDrawer, setShowCorrectionDrawer] = useState(false)
  const [correctionItems, setCorrectionItems] = useState<NutritionItem[]>([])
  const [additionalContext, setAdditionalContext] = useState('')
  const [isResubmitting, setIsResubmitting] = useState(false)

  const openQuickUpload = () => {
    const draftImageUrls = (imagePaths.length > 0 ? imagePaths : (imagePath ? [imagePath] : []))
      .map((path) => `${path || ''}`.trim())
      .filter(Boolean)

    const draft = {
      imageUrls: draftImageUrls,
      description: description || '',
      insight: healthAdvice || '',
      totalCalories: nutritionStats.calories,
      totalProtein: nutritionStats.protein,
      totalCarbs: nutritionStats.carbs,
      totalFat: nutritionStats.fat,
      items: nutritionItems.map((item) => ({
        name: item.name,
        weight: item.weight,
        nutrients: {
          calories: item.calorie,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: 0,
          sugar: 0
        }
      }))
    }

    Taro.setStorageSync(FOOD_LIBRARY_QUICK_UPLOAD_DRAFT_KEY, draft)
    Taro.navigateTo({
      url: '/pages/food-library-share/index?quick_upload=1'
    })
  }

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
      const storedPaths = Taro.getStorageSync('analyzeImagePaths')
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      const storedMode = Taro.getStorageSync('analyzeExecutionMode')
      const storedTaskType = normalizeTaskType(Taro.getStorageSync('analyzeTaskType'))
      setTaskType(storedTaskType)
      setExecutionMode(normalizeExecutionMode(storedMode))

      if (storedTaskType === 'food_text') {
        setImagePaths([])
        setImagePath('')
        Taro.removeStorageSync('analyzeImagePaths')
        Taro.removeStorageSync('analyzeImagePath')
      } else if (storedPaths && Array.isArray(storedPaths) && storedPaths.length > 0) {
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
        setRecognitionOutcome(normalizeRecognitionOutcome(result.recognitionOutcome))
        setRejectionReason(result.rejectionReason?.trim() || null)
        setRetakeGuidance(Array.isArray(result.retakeGuidance) ? result.retakeGuidance.filter(Boolean) : [])
        setAllowedFoodCategory(normalizeAllowedFoodCategory(result.allowedFoodCategory))
        setFollowupQuestions(Array.isArray(result.followupQuestions) ? result.followupQuestions.filter(Boolean) : [])
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

  const handleDefaultModeEdit = () => {
    Taro.navigateTo({ url: '/pages/health-profile-edit/index' })
  }

  const isStrictMode = executionMode === 'strict'
  const isStrictHardReject = isStrictMode && recognitionOutcome === 'hard_reject'
  const isStrictSoftReject = isStrictMode && recognitionOutcome === 'soft_reject'
  const shouldShowRecognitionCard = isStrictMode
  const shouldShowFollowupCard = taskType === 'food_text' && followupQuestions.length > 0
  const hasUploadableImage = taskType === 'food' && (imagePaths.length > 0 || !!imagePath)



  // 调节食物估算重量（+- 按钮）
  const handleWeightAdjust = (id: number, delta: number) => {
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
        if (item.id === id) {
          // 调节的是 weight（AI 估算的食物总重量）
          const newWeight = Math.max(10, item.weight + delta) // 最小 10g
          const weightScale = item.weight > 0 ? newWeight / item.weight : 1
          const nextProtein = item.protein * weightScale
          const nextCarbs = item.carbs * weightScale
          const nextFat = item.fat * weightScale
          // ratio 保持不变，重新计算 intake
          const newIntake = Math.round(newWeight * (item.ratio / 100))
          return {
            ...item,
            weight: newWeight,
            intake: newIntake,
            // 重量变化时，同步更新该食物对应的营养值
            calorie: calculateCaloriesFromMacros(nextProtein, nextCarbs, nextFat),
            protein: nextProtein,
            carbs: nextCarbs,
            fat: nextFat
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

  const updateMacroField = (
    id: number,
    field: MacroField,
    nextValue: number | ((currentValue: number) => number)
  ) => {
    setNutritionItems(items => {
      const updatedItems = items.map(item => {
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

      calculateNutritionStats(updatedItems)
      return updatedItems
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
          Taro.showToast({
            title: '请输入不小于0的数字',
            icon: 'none'
          })
          return
        }

        updateMacroField(id, field, parsed)
      }
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

  // 删除食物项
  const handleDeleteItem = (id: number, name: string) => {
    Taro.showModal({
      title: '删除食物',
      content: `确定要删除「${name}」吗？`,
      confirmText: '删除',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        setNutritionItems(items => {
          const updated = items.filter(item => item.id !== id)
          calculateNutritionStats(updated)
          return updated
        })
      }
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
                        nutrients: {
                          calories: item.calorie,
                          protein: item.protein,
                          carbs: item.carbs,
                          fat: item.fat,
                          fiber: 0,
                          sugar: 0
                        }
                      })),
                      pfc_ratio_comment: pfcRatioComment || undefined,
                      absorption_notes: absorptionNotes || undefined,
                      context_advice: contextAdvice || undefined,
                      recognitionOutcome,
                      rejectionReason: rejectionReason || undefined,
                      retakeGuidance: retakeGuidance.length > 0 ? retakeGuidance : undefined,
                      allowedFoodCategory,
                      followupQuestions: followupQuestions.length > 0 ? followupQuestions : undefined,
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
          image_path: hasUploadableImage ? (imagePath || undefined) : undefined,
          image_paths: hasUploadableImage && imagePaths.length > 0 ? imagePaths : undefined,
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

        Taro.showToast({ title: '记录成功', icon: 'success' })
        setTimeout(() => {
          Taro.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(saveResult.id)}` })
        }, 500)
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
    if (isStrictHardReject) {
      Taro.showModal({
        title: '当前结果不建议直接用于精准执行',
        content: `${rejectionReason || '当前结果不符合精准模式要求，建议优先重拍。'}\n如果你只是想先记一笔，也可以继续保存。`,
        confirmText: '仍要记录',
        cancelText: '先去重拍',
        success: (res) => {
          if (!res.confirm) return
          const savedMealType = Taro.getStorageSync('analyzeMealType')
          const normalized = toSelectableMealType(savedMealType)
          setSelectedMealType(normalized || 'breakfast')
          setShowMealSelector(true)
        }
      })
      return
    }
    if (isStrictSoftReject) {
      Taro.showModal({
        title: '本次结果不建议直接用于精准执行',
        content: `${rejectionReason || '当前图片条件一般，建议补拍后再确认。'}\n如果你只是想先记一笔，也可以继续保存。`,
        confirmText: '仍要记录',
        cancelText: '先去重拍',
        success: (res) => {
          if (!res.confirm) return
          const savedMealType = Taro.getStorageSync('analyzeMealType')
          const normalized = toSelectableMealType(savedMealType)
          setSelectedMealType(normalized || 'breakfast')
          setShowMealSelector(true)
        }
      })
      return
    }
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

  const handleOpenLibraryUpload = () => {
    if (!hasUploadableImage) {
      Taro.showToast({ title: '当前结果没有可上传的实物图片', icon: 'none' })
      return
    }
    if (isStrictHardReject) {
      Taro.showModal({
        title: '当前结果不建议上传',
        content: rejectionReason || '当前结果不符合精准模式要求，请先按提示重拍。',
        showCancel: false,
        confirmText: '我知道了',
      })
      return
    }

    if (isStrictSoftReject) {
      Taro.showModal({
        title: '当前图片条件一般',
        content: `${rejectionReason || '建议补拍后再确认。'}\n如果你确认这次样本也要上传到公共库，可以继续。`,
        confirmText: '继续上传',
        cancelText: '先去重拍',
        success: (res) => {
          if (!res.confirm) return
          openQuickUpload()
        }
      })
      return
    }

    openQuickUpload()
  }

  /** 弹窗确认保存 */
  const handleConfirmMealType = () => {
    setShowMealSelector(false)
    saveRecord(false, selectedMealType)
  }

  // 收藏食物（保存为可复用模板）
  const handleSaveAsRecipe = () => {
    if (isStrictHardReject) {
      Taro.showToast({ title: '请先重拍后再收藏', icon: 'none' })
      return
    }
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
        intake: 100,
        ratio: 100,
        protein: 0,
        carbs: 0,
        fat: 0
      }
    ])
  }

  // 提交二次纠正重新分析
  const handleSubmitCorrection = async () => {
    const isTextTask = taskType === 'food_text'

    if (!isTextTask && correctionItems.length === 0) {
      Taro.showToast({ title: '食物列表不能为空', icon: 'none' })
      return
    }

    // 检查是否有空名称
    if (!isTextTask && correctionItems.some(item => !item.name.trim())) {
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

          // 2. 获取原请求的基础配置
          const savedMealType = Taro.getStorageSync('analyzeMealType') as MealType | undefined
          const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
          const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')
          const savedExecutionMode = normalizeExecutionMode(Taro.getStorageSync('analyzeExecutionMode') || executionMode)
          const previousResult: AnalyzeResponse = {
            description,
            insight: healthAdvice,
            items: nutritionItems.map((item) => ({
              name: item.name,
              estimatedWeightGrams: item.weight,
              originalWeightGrams: item.originalWeight,
              nutrients: {
                calories: item.calorie,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
                fiber: 0,
                sugar: 0
              }
            })),
            pfc_ratio_comment: pfcRatioComment || undefined,
            absorption_notes: absorptionNotes || undefined,
            context_advice: contextAdvice || undefined,
            recognitionOutcome,
            rejectionReason: rejectionReason || undefined,
            retakeGuidance: retakeGuidance.length > 0 ? retakeGuidance : undefined,
            allowedFoodCategory,
            followupQuestions: followupQuestions.length > 0 ? followupQuestions : undefined,
          }
          const structuredCorrectionItems = correctionItems.map((item) => ({
            name: item.name.trim(),
            weight: Math.max(0, Math.round(item.weight || 0))
          })).filter((item) => !!item.name && item.weight > 0)

          // 图片模式：纠错清单是主输入；文字模式：纠错清单仅参考，不作为主输入下发
          const imageCorrectionsText = structuredCorrectionItems
            .map((item, idx) => `${idx + 1}. ${item.name} ${item.weight}g`)
            .join('; ')
          let imageFinalContext = imageCorrectionsText
            ? `用户在二次纠错中确认了以下食物和重量，请优先采用：${imageCorrectionsText}。`
            : '用户发起了图片模式二次纠错，请结合原图重新分析。'
          if (additionalContext.trim()) {
            imageFinalContext += `\n本轮补充说明：${additionalContext.trim()}`
          }

          let taskId = ''

          // 3. 区分是图片分析还是纯文字分析
          const shouldResubmitWithImage = taskType === 'food' && (imagePaths.length > 0 || !!imagePath)

          if (shouldResubmitWithImage) {
            // 图片分析
            const res = await submitAnalyzeTask({
              image_url: imagePaths[0] || imagePath,
              image_urls: imagePaths.length > 0 ? imagePaths : undefined,
              additionalContext: imageFinalContext,
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming,
              execution_mode: savedExecutionMode,
              previousResult,
              correctionItems: structuredCorrectionItems
            })
            taskId = res.task_id
          } else {
            // 纯文本分析
            const originalText = String(Taro.getStorageSync('analyzeTextInput') || '').trim()
            const previousCorrectionContext = String(Taro.getStorageSync('analyzeTextAdditionalContext') || '').trim()
            const currentResultSummary = nutritionItems
              .map((item, idx) => `${idx + 1}. ${item.name} ${item.weight}g`)
              .join('; ')
            const contextParts = [
              previousCorrectionContext ? `上一轮纠错/补充上下文：${previousCorrectionContext}` : '',
              additionalContext.trim() ? `本轮用户补充说明：${additionalContext.trim()}` : '',
              originalText ? `原始文字记录：${originalText}` : '',
              `当前结果页中用户已确认/已调整的食物结果：${currentResultSummary}。`
            ].filter(Boolean)
            const textPayload = originalText || currentResultSummary || imageCorrectionsText
            const res = await submitTextAnalyzeTask({
              text: textPayload,
              additionalContext: contextParts.join('\n'),
              meal_type: savedMealType,
              diet_goal: savedDietGoal,
              activity_timing: savedActivityTiming,
              execution_mode: savedExecutionMode,
              previousResult,
              correctionItems: undefined
            })
            taskId = res.task_id
          }
          Taro.removeStorageSync('analyzePendingCorrectionTaskId')
          Taro.removeStorageSync('analyzePendingCorrectionItems')

          Taro.hideLoading()
          setShowCorrectionDrawer(false)

          // 4. 跳转到 loading 页面重新走解析流程
          const nextTaskType = shouldResubmitWithImage ? 'food_image' : 'food_text'
          Taro.navigateTo({
            url: `/pages/analyze-loading/index?task_id=${taskId}&task_type=${nextTaskType}&execution_mode=${savedExecutionMode}`
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
            <View className='hero-placeholder logo-placeholder'>
              <Image
                src={APP_LOGO_URL}
                mode='aspectFit'
                className='placeholder-logo'
              />
              <Text className='placeholder-text'>未提供实物照片</Text>
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
          <View className={`mode-result-card ${executionMode}`}>
            <View className='mode-result-header'>
              <View className='mode-result-title-wrap'>
                <Text className='mode-result-label'>本次识别模式</Text>
                <Text className='mode-result-title'>{EXECUTION_MODE_META[executionMode].title}</Text>
              </View>
              <Text className='mode-result-action' onClick={handleDefaultModeEdit}>设为默认</Text>
            </View>
            <Text className='mode-result-desc'>{EXECUTION_MODE_META[executionMode].desc}</Text>
            <Text className='mode-result-note'>{EXECUTION_MODE_META[executionMode].note}</Text>
          </View>

          {shouldShowRecognitionCard && (
            <View className={`recognition-status-card outcome-${recognitionOutcome}`}>
              <View className='recognition-status-header'>
                <View className='recognition-status-title-wrap'>
                  <Text className='recognition-status-label'>精准模式判定</Text>
                  <Text className='recognition-status-title'>{RECOGNITION_OUTCOME_META[recognitionOutcome].title}</Text>
                </View>
                <View className={`recognition-chip chip-${recognitionOutcome}`}>
                  <Text className='recognition-chip-text'>{FOOD_CATEGORY_LABEL[allowedFoodCategory]}</Text>
                </View>
              </View>
              <Text className='recognition-status-desc'>{RECOGNITION_OUTCOME_META[recognitionOutcome].desc}</Text>
              {rejectionReason && (
                <Text className='recognition-reason'>{rejectionReason}</Text>
              )}
              {retakeGuidance.length > 0 && (
                <View className='recognition-guidance-list'>
                  {retakeGuidance.map((tip, idx) => (
                    <View key={`${tip}-${idx}`} className='recognition-guidance-item'>
                      <Text className='recognition-guidance-dot'>•</Text>
                      <Text className='recognition-guidance-text'>{tip}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {shouldShowFollowupCard && (
            <View className='followup-question-card'>
              <View className='followup-question-header'>
                <View className='followup-question-title-wrap'>
                  <Text className='followup-question-label'>还需要你补充的信息</Text>
                  <Text className='followup-question-title'>补充后再分析会更接近精准模式</Text>
                </View>
                <Text className='followup-question-action' onClick={openCorrectionDrawer}>去补充</Text>
              </View>
              <Text className='followup-question-desc'>
                当前结果先给你一个初步估算；如果你愿意继续补充下面这些信息，再点“重新智能分析”会更准确。
              </Text>
              <View className='followup-question-list'>
                {followupQuestions.map((question, idx) => (
                  <View key={`${question}-${idx}`} className='followup-question-item'>
                    <Text className='followup-question-dot'>{idx + 1}.</Text>
                    <Text className='followup-question-text'>{question}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

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
              {nutritionItems.map((item) => (
                <View key={item.id} className='ingredient-card'>
                  <View className='ingredient-main'>
                    <View className='ingredient-header'>
                      <Text className='ingredient-name'>{item.name}</Text>
                      <View className='edit-icon-wrapper' onClick={() => handleEditName(item.id, item.name)}>
                        <Text className='iconfont icon-shouxieqianming'></Text>
                      </View>
                      <View className='delete-icon-wrapper' onClick={() => handleDeleteItem(item.id, item.name)}>
                        <Text className='delete-icon'>×</Text>
                      </View>
                    </View>
                    <View className='ingredient-calories'>
                      <Text className='cal-val'>{Math.round(item.calorie * (item.ratio / 100))}</Text>
                      <Text className='cal-unit'>kcal</Text>
                    </View>
                  </View>

                  <View className='ingredient-controls'>
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

          {/* 底部操作区域 */}
          <View className='footer-actions'>
            <View className='pba-safe-area'>
              <View className='action-grid'>
                <View
                  className={`secondary-btn ${isStrictHardReject ? 'disabled' : ''}`}
                  onClick={isStrictHardReject ? undefined : handleSaveAsRecipe}
                >
                  <Text className='btn-text'>收藏餐食</Text>
                </View>
                <View
                  className={`primary-btn ${saving ? 'loading' : ''} ${(isStrictSoftReject || isStrictHardReject) ? 'soft-warning' : ''}`}
                  onClick={handleConfirmAndShare}
                >
                  <Text className='btn-text'>
                    {saving ? '保存中...' : ((isStrictSoftReject || isStrictHardReject) ? '仍要记录' : '记录')}
                  </Text>
                </View>
              </View>

              <View
                className={`feedback-link-row`}
              >
                <View className='correction-entry' onClick={openCorrectionDrawer}>
                  <View className='correction-entry-icon-box'>
                    <Text className='iconfont icon-shouxieqianming correction-icon'></Text>
                  </View>
                  <Text className='correction-text'>{shouldShowFollowupCard ? '补充这些信息，再重新分析' : '识别有误？点击纠错'}</Text>
                  <Text className='correction-arrow'>›</Text>
                </View>
                {hasUploadableImage ? (
                  <View
                    className={`library-upload-entry ${saving ? 'disabled' : ''}`}
                    onClick={saving ? undefined : handleOpenLibraryUpload}
                  >
                    <Text className='library-upload-text'>上传公共库</Text>
                    <Text className='library-upload-arrow'>›</Text>
                  </View>
                ) : null}
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
            {taskType === 'food_text' && (
              <View className='additional-context-wrapper'>
                <View className='context-label'>
                  <Text className='iconfont icon-jinggao'></Text>
                  <Text>文字纠错说明</Text>
                </View>
                <Text className='placeholder-text'>
                  名称和重量请先直接在结果页修改；这里主要补充“上一轮为什么不对、这次应该怎么理解”。如果上面列了待补充问题，也可以直接把答案写在这里。
                </Text>
              </View>
            )}
            <View className='correction-list'>
              {correctionItems.map((item, index) => (
                <View key={item.id} className='correction-row'>
                  <View className='correction-index'>{index + 1}.</View>
                  <View className='correction-inputs'>
                    <Input
                      className='correction-input name-input'
                      value={item.name}
                      placeholder='食物名称'
                      disabled={taskType === 'food_text'}
                      onInput={(e: any) => handleCorrectionNameChange(item.id, e.detail.value)}
                    />
                    <View className='weight-input-wrapper'>
                      <Input
                        className='correction-input weight-input'
                        type='number'
                        value={item.weight.toString()}
                        disabled={taskType === 'food_text'}
                        onInput={(e: any) => handleCorrectionWeightChange(item.id, e.detail.value)}
                      />
                      <Text className='weight-unit'>g</Text>
                    </View>
                  </View>
                  {taskType !== 'food_text' && (
                    <View className='correction-remove' onClick={() => handleRemoveCorrectionItem(item.id)}>
                      <Text className='correction-remove-icon'>×</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>

            {taskType !== 'food_text' && (
              <View className='add-correction-btn' onClick={handleAddCorrectionItem}>
                <Text className='iconfont icon-plus'></Text>
                <Text>添加食物</Text>
              </View>
            )}

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
