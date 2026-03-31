import { View, Text, Image, Textarea, ScrollView } from '@tarojs/components'
import { useEffect, useState } from 'react'
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import {
  getFoodRecordList,
  submitTextAnalyzeTask,
  getAccessToken,
  getPublicFoodLibraryList,
  type FoodRecord,
  type PublicFoodLibraryItem,
} from '../../utils/api'
import { IconCamera, IconText } from '../../components/iconfont'

import './index.scss'

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐',
}

const DIET_GOAL_OPTIONS = [
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无' },
]

const ACTIVITY_TIMING_OPTIONS = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' },
]

const RECORD_TEXT_LIBRARY_SELECTION_KEY = 'record_text_library_selection'

export default function RecordPage() {
  const [activeMethod, setActiveMethod] = useState<'photo' | 'text'>('photo')
  const [foodText, setFoodText] = useState('')
  const [foodAmount, setFoodAmount] = useState('')
  const [selectedMeal, setSelectedMeal] = useState('breakfast')
  const [textDietGoal, setTextDietGoal] = useState<string>('none')
  const [textActivityTiming, setTextActivityTiming] = useState<string>('none')
  const [textCalculating, setTextCalculating] = useState(false)
  const [showTextSourcePicker, setShowTextSourcePicker] = useState(false)
  const [textSourceType, setTextSourceType] = useState<'history' | 'library'>('history')
  const [textSourceLoading, setTextSourceLoading] = useState(false)
  const [textHistoryRecords, setTextHistoryRecords] = useState<FoodRecord[]>([])
  const [textLibraryItems, setTextLibraryItems] = useState<PublicFoodLibraryItem[]>([])

  const recordMethods = [
    { id: 'photo', text: '拍照识别', iconClass: 'photo-icon' },
    { id: 'text', text: '文字记录', iconClass: 'text-icon' },
  ] as const

  const meals = [
    { id: 'breakfast', name: '早餐', icon: 'icon-zaocan' },
    { id: 'morning_snack', name: '早加餐', icon: 'icon-lingshi' },
    { id: 'lunch', name: '午餐', icon: 'icon-wucan' },
    { id: 'afternoon_snack', name: '午加餐', icon: 'icon-lingshi' },
    { id: 'dinner', name: '晚餐', icon: 'icon-wancan' },
    { id: 'evening_snack', name: '晚加餐', icon: 'icon-lingshi' },
  ]

  const commonFoods = [
    '米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包',
    '蔬菜', '水果', '鱼', '牛肉', '豆腐', '酸奶', '坚果', '公共食物库',
  ]

  const toSafeNutrients = (src?: { calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; sugar?: number }) => ({
    calories: src?.calories ?? 0,
    protein: src?.protein ?? 0,
    carbs: src?.carbs ?? 0,
    fat: src?.fat ?? 0,
    fiber: src?.fiber ?? 0,
    sugar: src?.sugar ?? 0,
  })

  const openResultWithData = (params: {
    imagePaths?: string[]
    mealType?: string
    dietGoal?: string
    activityTiming?: string
    description?: string
    insight?: string
    items: Array<{ name: string; estimatedWeightGrams: number; originalWeightGrams: number; nutrients: ReturnType<typeof toSafeNutrients> }>
  }) => {
    const normalizedImagePaths = (params.imagePaths || []).filter(Boolean)
    Taro.setStorageSync('analyzeImagePaths', normalizedImagePaths)
    Taro.setStorageSync('analyzeImagePath', normalizedImagePaths[0] || '')
    Taro.setStorageSync('analyzeTaskType', normalizedImagePaths.length > 0 ? 'food' : 'food_text')
    if (normalizedImagePaths.length > 0) {
      Taro.removeStorageSync('analyzeTextInput')
      Taro.removeStorageSync('analyzeTextAdditionalContext')
    } else {
      const fallbackText = params.items.map((item) => `${item.name} ${item.estimatedWeightGrams}g`).join('；')
      Taro.setStorageSync('analyzeTextInput', params.description || fallbackText)
      Taro.removeStorageSync('analyzeTextAdditionalContext')
    }
    Taro.setStorageSync('analyzeResult', JSON.stringify({
      description: params.description || '',
      insight: params.insight || '保持健康饮食！',
      items: params.items,
    }))
    Taro.setStorageSync('analyzeCompareMode', false)
    Taro.setStorageSync('analyzeMealType', params.mealType || selectedMeal || 'breakfast')
    Taro.setStorageSync('analyzeDietGoal', params.dietGoal || textDietGoal || 'none')
    Taro.setStorageSync('analyzeActivityTiming', params.activityTiming || textActivityTiming || 'none')
    Taro.removeStorageSync('analyzeSourceTaskId')
    Taro.navigateTo({ url: '/pages/result/index' })
  }

  const mapRecordToResult = (record: FoodRecord) => {
    const mappedItems = (record.items || []).map((item) => {
      const weight = Math.max(1, Number(item.weight ?? item.intake ?? 0) || 0)
      return {
        name: item.name || '食物',
        estimatedWeightGrams: weight,
        originalWeightGrams: weight,
        nutrients: toSafeNutrients(item.nutrients),
      }
    })

    openResultWithData({
      imagePaths: (record.image_paths && record.image_paths.length > 0 ? record.image_paths : (record.image_path ? [record.image_path] : [])) || [],
      mealType: record.meal_type,
      dietGoal: record.diet_goal || undefined,
      activityTiming: record.activity_timing || undefined,
      description: record.description || '',
      insight: record.insight || '参考历史记录生成',
      items: mappedItems,
    })
  }

  const mapLibraryToResult = (item: PublicFoodLibraryItem) => {
    const mappedItems = (item.items || []).map((entry) => {
      const weight = Math.max(1, Number(entry.weight ?? 0) || 100)
      return {
        name: entry.name || item.food_name || '食物',
        estimatedWeightGrams: weight,
        originalWeightGrams: weight,
        nutrients: toSafeNutrients(entry.nutrients),
      }
    })
    const description = item.description || item.food_name || '来自公共食物库'
    const insight = item.insight || [item.merchant_name, item.merchant_address].filter(Boolean).join(' · ') || '来自公共食物库'

    openResultWithData({
      imagePaths: (item.image_paths && item.image_paths.length > 0 ? item.image_paths : (item.image_path ? [item.image_path] : [])) || [],
      description,
      insight,
      items: mappedItems,
    })
  }

  const getMethodIconColor = () => '#ffffff'

  const handleChooseImage = () => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }
    Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const imagePath = res.tempFilePaths[0]
        Taro.setStorageSync('analyzeImagePath', imagePath)
        Taro.navigateTo({ url: '/pages/analyze/index' })
      },
      fail: (err) => {
        if (err.errMsg.indexOf('cancel') > -1) return
        console.error('选择图片失败:', err)
        Taro.showToast({ title: '选择图片失败', icon: 'none' })
      },
    })
  }

  const handleCommonFoodClick = (food: string) => {
    if (food === '公共食物库') {
      if (!getAccessToken()) {
        Taro.navigateTo({ url: '/pages/login/index' })
        return
      }
      Taro.navigateTo({ url: '/pages/food-library/index?from=record' })
      return
    }
    setFoodText(food)
  }

  const openTextSourcePicker = async (type: 'history' | 'library') => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return
    }

    setTextSourceType(type)
    setShowTextSourcePicker(true)
    setTextSourceLoading(true)
    try {
      if (type === 'history') {
        const { records } = await getFoodRecordList()
        setTextHistoryRecords(records || [])
      } else {
        const { list } = await getPublicFoodLibraryList({ sort_by: 'latest', limit: 30, offset: 0 })
        setTextLibraryItems(list || [])
      }
    } catch (e: any) {
      Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      setTextSourceLoading(false)
    }
  }

  const handleStartCalculate = async () => {
    const trimmed = foodText.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入食物描述', icon: 'none' })
      return
    }

    const { confirm } = await Taro.showModal({
      title: '确认计算',
      content: '确定根据当前描述开始计算营养分析吗？',
    })
    if (!confirm) return

    let inputText = trimmed
    if (foodAmount.trim()) inputText += `\n数量：${foodAmount.trim()}`

    setTextCalculating(true)
    Taro.showLoading({ title: '提交任务中...', mask: true })
    try {
      Taro.setStorageSync('analyzeTextInput', inputText)
      Taro.removeStorageSync('analyzeTextAdditionalContext')
      const { task_id } = await submitTextAnalyzeTask({
        text: inputText,
        meal_type: selectedMeal as any,
        diet_goal: textDietGoal as any,
        activity_timing: textActivityTiming as any,
      })
      Taro.hideLoading()
      Taro.navigateTo({
        url: `/pages/analyze-loading/index?task_id=${task_id}&task_type=food_text`,
      })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '提交任务失败', icon: 'none' })
    } finally {
      setTextCalculating(false)
    }
  }

  useDidShow(() => {
    const tab = Taro.getStorageSync('recordPageTab') as string | undefined
    if (tab === 'photo' || tab === 'text') {
      setActiveMethod(tab)
      Taro.removeStorageSync('recordPageTab')
    } else if (tab) {
      setActiveMethod('photo')
      Taro.removeStorageSync('recordPageTab')
    }

    const picked = Taro.getStorageSync(RECORD_TEXT_LIBRARY_SELECTION_KEY)
    if (picked?.text) {
      setActiveMethod('text')
      setFoodText(picked.text)
      Taro.removeStorageSync(RECORD_TEXT_LIBRARY_SELECTION_KEY)
      Taro.showToast({ title: '已带入文字记录', icon: 'success' })
    }
  })

  useShareAppMessage(() => ({
    title: '食探 - 记录每一餐，健康看得见',
    path: '/pages/record/index',
  }))

  useShareTimeline(() => ({
    title: '食探 - 记录每一餐，健康看得见',
  }))

  useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      // @ts-ignore
      menus: ['shareAppMessage', 'shareTimeline'],
    })
  }, [])

  const tips = [
    '拍照时请确保食物清晰可见，光线充足',
    '尽量将食物放在白色或浅色背景上',
    '一次可以识别多种食物，建议分开摆放',
    '识别结果可以手动调整和补充',
  ]

  return (
    <View className='record-page'>
      <View className='page-header'>
        <Text className='page-title'>记录饮食</Text>
        <Text className='page-subtitle'>这里只负责新增记录，历史查看已经统一放到分析页。</Text>
      </View>

      <View className='record-methods'>
        {recordMethods.map((method) => (
          <View
            key={method.id}
            className={`method-card ${activeMethod === method.id ? 'active' : ''} ${method.id}-method`}
            onClick={() => setActiveMethod(method.id)}
          >
            <View className={`method-icon ${method.iconClass}`}>
              {method.id === 'photo' && <IconCamera size={40} color={getMethodIconColor()} />}
              {method.id === 'text' && <IconText size={40} color={getMethodIconColor()} />}
            </View>
            <Text className='method-text'>{method.text}</Text>
          </View>
        ))}
      </View>

      {activeMethod === 'photo' && (
        <View className='ai-recognition-section'>
          <View>
            <Text className='ai-title'>AI 拍照识别</Text>
            <Text className='ai-subtitle'>拍下您的食物，AI 帮您分析营养成分</Text>
          </View>

          <View className='upload-area' onClick={handleChooseImage}>
            <View className='upload-icon'>
              <Image
                src='/assets/page_icons/Take pictures-2.png'
                mode='aspectFit'
                className='upload-icon-image'
              />
            </View>
            <Text className='upload-text'>点击上传食物照片</Text>
            <Text className='upload-hint'>支持 JPG、PNG 格式，最大 10MB</Text>
          </View>

          <View className='record-scope-note'>
            <Text className='record-scope-note-text'>按天历史和查看明细，请到分析页的日历图进入。</Text>
          </View>
        </View>
      )}

      {activeMethod === 'photo' && (
        <View className='tips-section'>
          <View className='tips-header'>
            <View className='tips-badge'>
              <Text className='tips-badge-text'>Tips</Text>
            </View>
            <Text className='tips-title'>拍照识别技巧</Text>
          </View>
          <View className='tips-list'>
            {tips.map((tip, index) => (
              <View key={index} className='tip-item'>
                <Text className='tip-dot'>•</Text>
                <Text className='tip-text'>{tip}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {activeMethod === 'text' && (
        <View className='text-record-section'>
          <View className='text-source-card'>
            <Text className='config-label'>快速带入（结果页仍可继续编辑）</Text>
            <View className='text-source-actions'>
              <View className='text-source-btn' onClick={() => openTextSourcePicker('history')}>
                <Text className='text-source-btn-title'>从历史记录选择</Text>
                <Text className='text-source-btn-sub'>复用你已记录过的餐食</Text>
              </View>
              <View className='text-source-btn' onClick={() => openTextSourcePicker('library')}>
                <Text className='text-source-btn-title'>从公共食物库选择</Text>
                <Text className='text-source-btn-sub'>直接套用公共食物条目</Text>
              </View>
            </View>
          </View>

          <View className='text-input-card'>
            <View className='card-header'>
              <View className='card-title-wrapper'>
                <Text className='iconfont icon-shouxieqianming card-title-icon'></Text>
                <Text className='card-title'>描述您的饮食</Text>
              </View>
            </View>

            <View className='input-wrapper'>
              <Textarea
                className='food-textarea-premium'
                placeholder='今天吃了什么？例如：&#10;• 一碗红烧牛肉面&#10;• 一个苹果'
                placeholderClass='textarea-placeholder'
                value={foodText}
                onInput={(e) => setFoodText(e.detail.value)}
                maxlength={500}
                autoHeight
              />
              <View className='textarea-footer'>
                <Text className='char-counter'>{foodText.length}/500</Text>
              </View>
            </View>

            <View className='amount-wrapper'>
              <Text className='amount-label'>补充份量</Text>
              <Textarea
                className='amount-textarea-premium'
                placeholder='例如：200g；如果暂时不确定，也可以先写一碗、半份'
                placeholderClass='textarea-placeholder'
                value={foodAmount}
                onInput={(e) => setFoodAmount(e.detail.value)}
                maxlength={200}
                autoHeight
              />
              <Text className='precision-text-hint'>
                精准模式下，如果一段描述里主体太多或重量不清，系统会提示你拆开写或补充克数。
              </Text>
            </View>

            <View className='quick-tags-box'>
              <Text className='tags-label'>大家常吃:</Text>
              <View className='quick-tags-row'>
                {commonFoods.slice(0, 8).map((food, index) => (
                  <View
                    key={index}
                    className={`quick-tag-pill ${foodText.includes(food) ? 'active' : ''}`}
                    onClick={() => handleCommonFoodClick(food)}
                  >
                    {food}
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View className='config-card-premium'>
            <View className='config-item'>
              <Text className='config-label'>餐次</Text>
              <View className='meal-selector-row'>
                {meals.map((meal) => (
                  <View
                    key={meal.id}
                    className={`meal-option ${selectedMeal === meal.id ? 'active' : ''}`}
                    onClick={() => setSelectedMeal(meal.id)}
                  >
                    <Text className={`iconfont ${meal.icon} meal-icon`}></Text>
                    <Text className='meal-name'>{meal.name}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className='config-divider'></View>

            <View className='config-vertical-stack'>
              <View className='config-item'>
                <Text className='config-label'>目标</Text>
                <View className='options-row'>
                  {DIET_GOAL_OPTIONS.map((opt) => (
                    <View
                      key={opt.value}
                      className={`mini-chip ${textDietGoal === opt.value ? 'active' : ''}`}
                      onClick={() => setTextDietGoal(opt.value)}
                    >
                      {opt.label}
                    </View>
                  ))}
                </View>
              </View>

              <View className='config-divider'></View>

              <View className='config-item'>
                <Text className='config-label'>时机</Text>
                <View className='options-row'>
                  {ACTIVITY_TIMING_OPTIONS.map((opt) => (
                    <View
                      key={opt.value}
                      className={`mini-chip ${textActivityTiming === opt.value ? 'active' : ''}`}
                      onClick={() => setTextActivityTiming(opt.value)}
                    >
                      {opt.label}
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>

          <View className='text-action-floating'>
            <View
              className={`analyze-btn-premium ${!foodText.trim() ? 'disabled' : ''} ${textCalculating ? 'loading' : ''}`}
              onClick={handleStartCalculate}
            >
              {textCalculating ? 'AI 分析中...' : '开始智能分析'}
            </View>
          </View>

          <View style={{ height: '260rpx' }}></View>
        </View>
      )}

      {showTextSourcePicker && (
        <View className='text-picker-mask' onClick={() => setShowTextSourcePicker(false)}>
          <View className='text-picker-panel' onClick={(e) => e.stopPropagation()}>
            <View className='text-picker-header'>
              <Text className='text-picker-title'>{textSourceType === 'history' ? '选择历史记录' : '选择公共食物库条目'}</Text>
              <Text className='text-picker-close' onClick={() => setShowTextSourcePicker(false)}>✕</Text>
            </View>
            {textSourceLoading ? (
              <View className='text-picker-empty'>加载中...</View>
            ) : textSourceType === 'history' ? (
              textHistoryRecords.length > 0 ? (
                <ScrollView className='text-picker-list' scrollY>
                  {textHistoryRecords.map((record) => (
                    <View
                      key={record.id}
                      className='text-picker-item'
                      onClick={() => {
                        setShowTextSourcePicker(false)
                        mapRecordToResult(record)
                      }}
                    >
                      <Text className='text-picker-item-title'>{record.description || '历史记录'}</Text>
                      <Text className='text-picker-item-sub'>
                        {(MEAL_TYPE_NAMES[record.meal_type] || record.meal_type)} · {Math.round(record.total_calories || 0)} kcal
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View className='text-picker-empty'>暂无历史记录</View>
              )
            ) : textLibraryItems.length > 0 ? (
              <ScrollView className='text-picker-list' scrollY>
                {textLibraryItems.map((item) => (
                  <View
                    key={item.id}
                    className='text-picker-item'
                    onClick={() => {
                      setShowTextSourcePicker(false)
                      mapLibraryToResult(item)
                    }}
                  >
                    <Text className='text-picker-item-title'>{item.food_name || item.description || '公共食物库条目'}</Text>
                    <Text className='text-picker-item-sub'>
                      {[item.merchant_name, `${Math.round(item.total_calories || 0)} kcal`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View className='text-picker-empty'>公共食物库暂无可用条目</View>
            )}
          </View>
        </View>
      )}
    </View>
  )
}
