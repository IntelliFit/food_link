import { View, Text, Image, Textarea, ScrollView } from '@tarojs/components'
import { useState, useEffect, useMemo } from 'react'
import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { Calendar } from '@taroify/core'
import '@taroify/core/calendar/style'
import {
  getFoodRecordList,
  deleteFoodRecord,
  submitTextAnalyzeTask,
  getHomeDashboard,
  getAccessToken,
  getPublicFoodLibraryList,
  type FoodRecord,
  type PublicFoodLibraryItem
} from '../../utils/api'
import { IconCamera, IconText, IconClock } from '../../components/iconfont'

import './index.scss'

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  morning_snack: '早加餐',
  lunch: '午餐',
  afternoon_snack: '午加餐',
  dinner: '晚餐',
  evening_snack: '晚加餐',
  snack: '午加餐'
}

const MEAL_TYPE_ICONS: Record<string, string> = {
  breakfast: 'icon-zaocan',
  morning_snack: 'icon-lingshi',
  lunch: 'icon-wucan',
  afternoon_snack: 'icon-lingshi',
  dinner: 'icon-wancan',
  evening_snack: 'icon-lingshi',
  snack: 'icon-lingshi'
}

/** 饮食目标（状态一） */
const DIET_GOAL_OPTIONS = [
  { value: 'fat_loss', label: '减脂期' },
  { value: 'muscle_gain', label: '增肌期' },
  { value: 'maintain', label: '维持体重' },
  { value: 'none', label: '无' }
]

/** 运动时机（状态二） */
const ACTIVITY_TIMING_OPTIONS = [
  { value: 'post_workout', label: '练后' },
  { value: 'daily', label: '日常' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'none', label: '无' }
]

const RECORD_TEXT_LIBRARY_SELECTION_KEY = 'record_text_library_selection'
const RECORD_HISTORY_DATE_KEY = 'recordHistoryDate'

export default function RecordPage() {
  const [activeMethod, setActiveMethod] = useState('photo')
  const [foodText, setFoodText] = useState('')
  const [foodAmount, setFoodAmount] = useState('')
  const [selectedMeal, setSelectedMeal] = useState('breakfast')
  const [textDietGoal, setTextDietGoal] = useState<string>('none')
  const [textActivityTiming, setTextActivityTiming] = useState<string>('none')

  const recordMethods = [
    { id: 'photo', text: '拍照识别', iconClass: 'photo-icon' },
    { id: 'text', text: '文字记录', iconClass: 'text-icon' }
  ]

  const formatDateKey = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const getMethodIconColor = (methodId: string) => {
    if (methodId === 'photo') return '#ffffff'
    return '#ffffff'
  }

  const handleMethodClick = (methodId: string) => {
    setActiveMethod(methodId)
  }

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
        // 将图片路径存储到全局数据中
        Taro.setStorageSync('analyzeImagePath', imagePath)
        // 直接跳转到分析页面
        Taro.navigateTo({
          url: '/pages/analyze/index'
        })
      },
      fail: (err) => {
        if (err.errMsg.indexOf('cancel') > -1) {
          return
        }
        console.error('选择图片失败:', err)
        Taro.showToast({
          title: '选择图片失败',
          icon: 'none'
        })
      }
    })
  }


  const meals = [
    { id: 'breakfast', name: '早餐', icon: 'icon-zaocan', color: '#ff6900' },
    { id: 'morning_snack', name: '早加餐', icon: 'icon-lingshi', color: '#7b61ff' },
    { id: 'lunch', name: '午餐', icon: 'icon-wucan', color: '#00c950' },
    { id: 'afternoon_snack', name: '午加餐', icon: 'icon-lingshi', color: '#ad46ff' },
    { id: 'dinner', name: '晚餐', icon: 'icon-wancan', color: '#2b7fff' },
    { id: 'evening_snack', name: '晚加餐', icon: 'icon-lingshi', color: '#5b21b6' }
  ]

  const commonFoods = [
    '米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包',
    '蔬菜', '水果', '鱼', '牛肉', '豆腐', '酸奶', '坚果', '公共食物库'
  ]

  const handleMealSelect = (mealId: string) => {
    setSelectedMeal(mealId)
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

  const [textCalculating, setTextCalculating] = useState(false)
  const [showTextSourcePicker, setShowTextSourcePicker] = useState(false)
  const [textSourceType, setTextSourceType] = useState<'history' | 'library'>('history')
  const [textSourceLoading, setTextSourceLoading] = useState(false)
  const [textHistoryRecords, setTextHistoryRecords] = useState<FoodRecord[]>([])
  const [textLibraryItems, setTextLibraryItems] = useState<PublicFoodLibraryItem[]>([])

  const toSafeNutrients = (src?: { calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number; sugar?: number }) => ({
    calories: src?.calories ?? 0,
    protein: src?.protein ?? 0,
    carbs: src?.carbs ?? 0,
    fat: src?.fat ?? 0,
    fiber: src?.fiber ?? 0,
    sugar: src?.sugar ?? 0
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
      items: params.items
    }))
    Taro.setStorageSync('analyzeCompareMode', false)
    Taro.setStorageSync('analyzeMealType', params.mealType || selectedMeal || 'breakfast')
    Taro.setStorageSync('analyzeDietGoal', params.dietGoal || textDietGoal || 'none')
    Taro.setStorageSync('analyzeActivityTiming', params.activityTiming || textActivityTiming || 'none')
    Taro.removeStorageSync('analyzeSourceTaskId')
    Taro.navigateTo({ url: '/pages/result/index' })
  }

  const mapRecordToResult = (record: FoodRecord) => {
    const mappedItems = (record.items || []).map((it) => {
      const weight = Math.max(1, Number(it.weight ?? it.intake ?? 0) || 0)
      return {
        name: it.name || '食物',
        estimatedWeightGrams: weight,
        originalWeightGrams: weight,
        nutrients: toSafeNutrients(it.nutrients)
      }
    })
    openResultWithData({
      imagePaths: (record.image_paths && record.image_paths.length > 0 ? record.image_paths : (record.image_path ? [record.image_path] : [])) || [],
      mealType: record.meal_type,
      dietGoal: record.diet_goal || undefined,
      activityTiming: record.activity_timing || undefined,
      description: record.description || '',
      insight: record.insight || '参考历史记录生成',
      items: mappedItems
    })
  }

  const mapLibraryToResult = (item: PublicFoodLibraryItem) => {
    const mappedItems = (item.items || []).map((it) => {
      const weight = Math.max(1, Number(it.weight ?? 0) || 100)
      return {
        name: it.name || item.food_name || '食物',
        estimatedWeightGrams: weight,
        originalWeightGrams: weight,
        nutrients: toSafeNutrients(it.nutrients)
      }
    })
    const description = item.description || item.food_name || '来自公共食物库'
    const insight = item.insight || [item.merchant_name, item.merchant_address].filter(Boolean).join(' · ') || '来自公共食物库'
    openResultWithData({
      imagePaths: (item.image_paths && item.image_paths.length > 0 ? item.image_paths : (item.image_path ? [item.image_path] : [])) || [],
      description,
      insight,
      items: mappedItems
    })
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

  /** 文字记录：开始计算前确认 → 提交异步任务 → 跳转加载页 */
  const handleStartCalculate = async () => {
    const trimmed = foodText.trim()
    if (!trimmed) {
      Taro.showToast({ title: '请输入食物描述', icon: 'none' })
      return
    }
    const { confirm } = await Taro.showModal({
      title: '确认计算',
      content: '确定根据当前描述开始计算营养分析吗？'
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
        activity_timing: textActivityTiming as any
      })
      Taro.hideLoading()
      // 跳转到加载页面，传递任务 ID 和任务类型
      Taro.navigateTo({
        url: `/pages/analyze-loading/index?task_id=${task_id}&task_type=food_text`
      })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '提交任务失败', icon: 'none' })
    } finally {
      setTextCalculating(false)
    }
  }

  // 历史记录：按本地自然日拉取，避免凌晨受 UTC 跨天影响
  const getTodayDate = () => formatDateKey(new Date())
  const [selectedDate, setSelectedDate] = useState(getTodayDate())
  /** 日历弹层显隐，用于 Taroify Calendar 选择日期 */
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [historyMeals, setHistoryMeals] = useState<Array<{
    id: string
    mealType: string
    mealName: string
    time: string
    foods: Array<{ name: string; amount: string; calorie: number }>
    totalCalorie: number
  }>>([])
  const [historyTotalCalorie, setHistoryTotalCalorie] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  /** 目标卡路里：与首页一致，来自 getHomeDashboard().intakeData.target，未登录或请求失败时默认 2000 */
  const [targetCalories, setTargetCalories] = useState(2000)

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T12:00:00')
    const month = date.getMonth() + 1
    const day = date.getDate()
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    const weekday = weekdays[date.getDay()]
    const today = new Date()
    const todayStr = formatDateKey(today)
    const yesterday = new Date(today.getTime())
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = formatDateKey(yesterday)
    if (dateStr === todayStr) return `${month}月${day}日 今天`
    if (dateStr === yesterdayStr) return `${month}月${day}日 昨天`
    return `${month}月${day}日 周${weekday}`
  }

  const formatRecordTime = (recordTime: string) => {
    try {
      const d = new Date(recordTime)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    } catch {
      return '--:--'
    }
  }

  /** 统一按本地时区格式化为 YYYY-MM-DD，避免时区导致跨天显示错误 */
  const getLocalDateStr = (value: string) => {
    return formatDateKey(new Date(value))
  }

  const loadHistory = async (date: string) => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const { records } = await getFoodRecordList(date)
      const meals = records.map((r: FoodRecord) => ({
        id: r.id,
        mealType: r.meal_type,
        mealName: MEAL_TYPE_NAMES[r.meal_type] || r.meal_type,
        time: formatRecordTime(r.record_time),
        foods: (r.items || []).map((item: { name: string; intake: number; ratio?: number; nutrients?: { calories?: number } }) => {
          const ratio = (item as { ratio?: number }).ratio ?? 100
          const fullCal = (item.nutrients?.calories ?? 0)
          const consumedCal = fullCal * (ratio / 100)
          return {
            name: item.name,
            amount: `${item.intake ?? 0}g`,
            calorie: Math.round(consumedCal * 10) / 10
          }
        }),
        totalCalorie: Math.round((r.total_calories ?? 0) * 10) / 10
      }))
      const totalCalorie = meals.reduce((sum, m) => sum + m.totalCalorie, 0)
      setHistoryMeals(meals)
      setHistoryTotalCalorie(totalCalorie)
    } catch (e: any) {
      const msg = e.message || '获取记录失败'
      setHistoryError(msg)
      setHistoryMeals([])
      setHistoryTotalCalorie(0)
    } finally {
      setHistoryLoading(false)
    }
  }

  // 处理从首页跳转过来的 tab 切换
  useDidShow(() => {
    const tab = Taro.getStorageSync('recordPageTab') as string | undefined
    const historyDate = Taro.getStorageSync(RECORD_HISTORY_DATE_KEY) as string | undefined
    if (tab === 'photo' || tab === 'text' || tab === 'history') {
      setActiveMethod(tab)
      Taro.removeStorageSync('recordPageTab') // 用完即删，避免重复触发
    } else if (tab) {
      setActiveMethod('photo')
      Taro.removeStorageSync('recordPageTab')
    }
    if (historyDate) {
      setSelectedDate(historyDate)
      setActiveMethod('history')
      Taro.removeStorageSync(RECORD_HISTORY_DATE_KEY)
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
    path: '/pages/record/index'
  }))

  useShareTimeline(() => ({
    title: '食探 - 记录每一餐，健康看得见'
  }))

  useEffect(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      // @ts-ignore
      menus: ['shareAppMessage', 'shareTimeline']
    })
  }, [])

  useEffect(() => {
    if (activeMethod === 'history') {
      loadHistory(selectedDate)
      // 与首页一致：从首页仪表盘接口获取目标卡路里
      if (getAccessToken()) {
        getHomeDashboard()
          .then((res) => setTargetCalories(res.intakeData.target))
          .catch(() => { /* 失败保持默认 2000 */ })
      }
    }
  }, [activeMethod, selectedDate])

  /** 点击记录卡片：跳转识别记录详情页（通过 URL 参数传递记录 ID） */
  const handleRecordCardClick = (mealId: string) => {
    Taro.navigateTo({ url: `/pages/record-detail/index?id=${encodeURIComponent(mealId)}` })
  }

  /** 删除记录：不显眼入口，先 ActionSheet 再确认后删除并刷新 */
  const handleDeleteRecord = (e: { stopPropagation: () => void }, mealId: string) => {
    e.stopPropagation()
    Taro.showActionSheet({
      itemList: ['删除该记录', '取消'],
      success: (res) => {
        if (res.tapIndex !== 0) return
        Taro.showModal({
          title: '确认删除',
          content: '删除这条饮食记录后不可恢复，确定删除吗？',
          confirmText: '删除',
          confirmColor: '#e53e3e',
          success: async (modalRes) => {
            if (!modalRes.confirm) return
            try {
              await deleteFoodRecord(mealId)
              Taro.showToast({ title: '已删除', icon: 'success' })
              loadHistory(selectedDate)
            } catch (err: any) {
              Taro.showToast({ title: err.message || '删除失败', icon: 'none' })
            }
          }
        })
      }
    })
  }

  /** 将 Date 转为本地 YYYY-MM-DD，供 Calendar 确认后更新 selectedDate */
  const dateToDateStr = (d: Date) => formatDateKey(d)

  /** 日历可选范围：最近 6 个月到今天 */
  const calendarMinDate = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 6)
    return d
  }, [])
  const calendarMaxDate = useMemo(() => new Date(), [])
  /** 当前选中日期转成 Date 供 Calendar value 使用（中午 12 点避免时区偏差） */
  const calendarValue = useMemo(
    () => (selectedDate ? new Date(selectedDate + 'T12:00:00') : new Date()),
    [selectedDate]
  )

  const tips = [
    '拍照时请确保食物清晰可见，光线充足',
    '尽量将食物放在白色或浅色背景上',
    '一次可以识别多种食物，建议分开摆放',
    '识别结果可以手动调整和补充'
  ]

  return (
    <View className='record-page'>
      {/* 页面头部 */}
      <View className='page-header'>
        <Text className='page-title'>记录饮食</Text>
        <Text className='page-subtitle'>记录您的每一餐，让健康管理更简单</Text>
      </View>

      {/* 记录方式选择 */}
      <View className='record-methods'>
        {recordMethods.map((method) => (
          <View
            key={method.id}
            className={`method-card ${activeMethod === method.id ? 'active' : ''} ${method.id}-method`}
            onClick={() => handleMethodClick(method.id)}
          >
            <View className={`method-icon ${method.iconClass}`}>
              {method.id === 'photo' && <IconCamera size={40} color={getMethodIconColor(method.id)} />}
              {method.id === 'text' && <IconText size={40} color={getMethodIconColor(method.id)} />}
            </View>
            <Text className='method-text'>{method.text}</Text>
          </View>
        ))}
      </View>

      {activeMethod !== 'history' && (
        <View className='history-shortcut' onClick={() => setActiveMethod('history')}>
          <View className='history-shortcut-icon'>
            <IconClock size={18} color='#ad46ff' />
          </View>
          <Text className='history-shortcut-text'>查看历史记录</Text>
        </View>
      )}

      {/* AI拍照识别区域 */}
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
          <View
            className='history-entry'
            onClick={() => Taro.navigateTo({ url: '/pages/analyze-history/index' })}
          >
            <Text className='history-entry-text'>查看分析历史</Text>
          </View>
        </View>
      )}

      {/* Tips卡片 - 只在拍照识别页面显示 */}
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

      {/* 文字记录区域 */}
      {activeMethod === 'text' && (
        <View className='text-record-section'>
          <View className='text-source-card'>
            <Text className='config-label'>快速带入（同拍照识别结果页可编辑）</Text>
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

          {/* 输入主卡片 */}
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
                placeholder='例如：200g，一碗'
                placeholderClass='textarea-placeholder'
                value={foodAmount}
                onInput={(e) => setFoodAmount(e.detail.value)}
                maxlength={200}
                autoHeight
              />
            </View>

            {/* 快捷标签 */}
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

          {/* 配置选项卡片 */}
          <View className='config-card-premium'>
            <View className='config-item'>
              <Text className='config-label'>餐次</Text>
              <View className='meal-selector-row'>
                {meals.map((meal) => (
                  <View
                    key={meal.id}
                    className={`meal-option ${selectedMeal === meal.id ? 'active' : ''}`}
                    onClick={() => handleMealSelect(meal.id)}
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
                  {DIET_GOAL_OPTIONS.map(opt => (
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
                  {ACTIVITY_TIMING_OPTIONS.map(opt => (
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

          {/* 底部悬浮操作按钮 */}
          <View className='text-action-floating'>
            <View
              className={`analyze-btn-premium ${!foodText.trim() ? 'disabled' : ''} ${textCalculating ? 'loading' : ''}`}
              onClick={handleStartCalculate}
            >
              {textCalculating ? 'AI 分析中...' : '开始智能分析'}
            </View>
          </View>

          {/* 占位，防止底部按钮遮挡内容 */}
          <View style={{ height: '140rpx' }}></View>
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
            ) : (
              textLibraryItems.length > 0 ? (
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
              )
            )}
          </View>
        </View>
      )}

      {/* 历史记录区域 */}
      {activeMethod === 'history' && (
        <View className='history-section'>
          <View className='history-header-card'>
            <Text className='history-header-title'>饮食档案</Text>
            <Text className='history-header-subtitle'>按天查看已记录的餐食明细，支持进入详情和删除整条记录</Text>
          </View>
          {/* 日期选择：点击打开 Taroify 日历弹层 */}
          <View className='date-selector'>
            <View className='date-card'>
              <Text className='date-label'>选择日期</Text>
              <View className='date-display' onClick={() => setCalendarOpen(true)}>
                <Text className='date-text'>{formatDate(selectedDate)}</Text>
                <Text className='iconfont icon-shizhong date-icon'></Text>
              </View>
            </View>
            <Calendar
              className='record-calendar'
              style={{ '--calendar-active-color': '#00bc7d' } as React.CSSProperties}
              type='single'
              value={calendarValue}
              min={calendarMinDate}
              max={calendarMaxDate}
              poppable
              showPopup={calendarOpen}
              onClose={setCalendarOpen}
              onChange={(val) => setSelectedDate(dateToDateStr(val as Date))}
              onConfirm={(val) => {
                setSelectedDate(dateToDateStr(val as Date))
                setCalendarOpen(false)
              }}
            />
            <View className='date-stats'>
              <View className='stat-item'>
                <Text className='stat-label'>总摄入</Text>
                <Text className='stat-value'>{historyTotalCalorie} kcal</Text>
              </View>
              <View className='stat-item'>
                <Text className='stat-label'>目标</Text>
                <Text className='stat-value'>{targetCalories} kcal</Text>
              </View>
            </View>
          </View>

          {/* 记录列表 */}
          {historyLoading ? (
            <View className='empty-state'>
              <Text className='iconfont icon-jiazaixiao empty-icon'></Text>
              <Text className='empty-text'>加载中...</Text>
            </View>
          ) : historyError ? (
            <View className='empty-state'>
              <Text className='iconfont icon-jiesuo empty-icon'></Text>
              <Text className='empty-text'>{historyError}</Text>
              <Text className='empty-hint'>请先登录后查看历史记录</Text>
            </View>
          ) : historyMeals.length > 0 ? (
            <View className='history-list'>
              {historyMeals.map((meal) => (
                <View
                  key={meal.id}
                  className='history-meal-card'
                  onClick={() => handleRecordCardClick(meal.id)}
                >
                  <View className='meal-card-header'>
                    <View className='meal-header-left'>
                      <View className={`meal-type-icon ${meal.mealType}-icon`}>
                        <Text className={`iconfont ${MEAL_TYPE_ICONS[meal.mealType] || 'icon-shiwu'}`}></Text>
                      </View>
                      <View className='meal-header-info'>
                        <Text className='meal-card-name'>{meal.mealName}</Text>
                        <Text className='meal-card-time'>{meal.time}</Text>
                      </View>
                    </View>
                    <View className='meal-header-right'>
                      <Text className='meal-calorie'>{meal.totalCalorie} kcal</Text>
                      <View
                        className='meal-card-delete'
                        onClick={(e) => handleDeleteRecord(e as any, meal.id)}
                      >
                        <Text className='iconfont icon-shanchu meal-card-delete-icon' />
                      </View>
                    </View>
                  </View>
                  <View className='food-list'>
                    {meal.foods.map((food, index) => (
                      <View key={index} className='food-item'>
                        <View className='food-info'>
                          <Text className='food-name'>{food.name}</Text>
                          <Text className='food-amount'>{food.amount}</Text>
                        </View>
                        <Text className='food-calorie'>{food.calorie} kcal</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className='empty-state'>
              <Text className='iconfont icon-jishiben empty-icon'></Text>
              <Text className='empty-text'>暂无记录</Text>
              <Text className='empty-hint'>拍照识别并确认记录后，将显示在这里</Text>
            </View>
          )}
        </View>
      )}
    </View>
  )
}
