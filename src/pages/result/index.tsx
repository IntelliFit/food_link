import { View, Text, Image, ScrollView, Slider, Swiper, SwiperItem } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { AnalyzeResponse, FoodItem, saveFoodRecord, saveCriticalSamples, getAccessToken, createUserRecipe, updateAnalysisTaskResult } from '../../utils/api'

import './index.scss'

const MEAL_OPTIONS = [
  { value: 'breakfast' as const, label: '早餐' },
  { value: 'lunch' as const, label: '午餐' },
  { value: 'dinner' as const, label: '晚餐' },
  { value: 'snack' as const, label: '加餐' }
]

const MEAL_ICONS = {
  breakfast: 'icon-zaocan',
  lunch: 'icon-wucan',
  dinner: 'icon-wancan',
  snack: 'icon-lingshi'
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
    fat: 0
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
  const [selectedMealType, setSelectedMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('breakfast')

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

  /** 保存记录：saveOnly=true 仅保存，false 保存后跳详情页 */
  const saveRecord = async (saveOnly: boolean, confirmedMealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack') => {
    // 从缓存获取分析时选择的状态
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    const savedDietGoal = Taro.getStorageSync('analyzeDietGoal')
    const savedActivityTiming = Taro.getStorageSync('analyzeActivityTiming')

    // 确定餐次：优先使用确认过的餐次，否则尝试从缓存读取，最后默认早餐
    let mealType = confirmedMealType
    if (!mealType) {
      const mealFromStorage = savedMealType && MEAL_OPTIONS.find((o) => o.value === savedMealType)
      mealType = (mealFromStorage?.value || 'breakfast') as 'breakfast' | 'lunch' | 'dinner' | 'snack'
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
          meal_type: mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack',
          image_path: imagePath || undefined,
          image_paths: imagePaths.length > 0 ? imagePaths : undefined,
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
    // 初始化选中的餐次：缓存 > 默认早餐
    const savedMealType = Taro.getStorageSync('analyzeMealType')
    if (savedMealType && ['breakfast', 'lunch', 'dinner', 'snack'].includes(savedMealType)) {
      setSelectedMealType(savedMealType as any)
    } else {
      setSelectedMealType('breakfast')
    }
    setShowMealSelector(true)
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
    const mealType = savedMealType && MEAL_OPTIONS.find((o) => o.value === savedMealType)
      ? savedMealType
      : undefined

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
          <View className='selector-title'>确认记录</View>

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
            <View
              className='cancel-btn'
              onClick={() => setShowMealSelector(false)}
            >
              取消
            </View>
            <View
              className='confirm-btn'
              onClick={handleConfirmMealType}
            >
              确定记录
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}

