import { View, Text, Image, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { getFoodRecordList, submitTextAnalyzeTask, getHomeDashboard, getAccessToken, type FoodRecord } from '../../utils/api'
import { IconCamera, IconText, IconClock } from '../../components/iconfont'

import './index.scss'

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

const MEAL_TYPE_NAMES: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐'
}

const MEAL_TYPE_ICONS: Record<string, string> = {
  breakfast: 'icon-zaocan',
  lunch: 'icon-wucan',
  dinner: 'icon-wancan',
  snack: 'icon-lingshi'
}

export default function RecordPage() {
  const [activeMethod, setActiveMethod] = useState('photo')
  const [foodText, setFoodText] = useState('')
  const [foodAmount, setFoodAmount] = useState('')
  const [selectedMeal, setSelectedMeal] = useState('breakfast')
  const [textDietGoal, setTextDietGoal] = useState<string>('none')
  const [textActivityTiming, setTextActivityTiming] = useState<string>('none')

  const recordMethods = [
    { id: 'photo', text: '拍照识别', iconClass: 'photo-icon' },
    { id: 'text', text: '文字记录', iconClass: 'text-icon' },
    { id: 'favorites', text: '收藏食物', iconClass: 'favorites-icon' }
  ]

  const getMethodIconColor = (methodId: string) => {
    if (methodId === 'photo') return '#ffffff'
    return '#ffffff'
  }

  const handleMethodClick = (methodId: string) => {
    if (methodId === 'favorites') {
      Taro.navigateTo({ url: '/pages/recipes/index' })
      return
    }
    setActiveMethod(methodId)
  }

  const handleChooseImage = () => {
    Taro.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
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
    { id: 'lunch', name: '午餐', icon: 'icon-wucan', color: '#00c950' },
    { id: 'dinner', name: '晚餐', icon: 'icon-wancan', color: '#2b7fff' },
    { id: 'snack', name: '加餐', icon: 'icon-lingshi', color: '#ad46ff' }
  ]

  const commonFoods = [
    '米饭', '面条', '鸡蛋', '鸡胸肉', '苹果', '香蕉', '牛奶', '面包',
    '蔬菜', '水果', '鱼', '牛肉', '豆腐', '酸奶', '坚果', '更多'
  ]

  const handleMealSelect = (mealId: string) => {
    setSelectedMeal(mealId)
  }

  const handleCommonFoodClick = (food: string) => {
    if (food === '更多') {
      // 可以打开更多食物选择
      return
    }
    setFoodText(food)
  }

  const [textCalculating, setTextCalculating] = useState(false)

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

  // 历史记录：按日期从接口拉取
  const getTodayDate = () => new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(getTodayDate())
  const [historyRecords, setHistoryRecords] = useState<Array<{
    date: string
    meals: Array<{
      id: string
      mealType: string
      mealName: string
      time: string
      foods: Array<{ name: string; amount: string; calorie: number }>
      totalCalorie: number
    }>
    totalCalorie: number
  }>>([])
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
    const todayStr = today.toISOString().split('T')[0]
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
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
      setHistoryRecords([{ date, meals, totalCalorie }])
    } catch (e: any) {
      const msg = e.message || '获取记录失败'
      setHistoryError(msg)
      setHistoryRecords([])
    } finally {
      setHistoryLoading(false)
    }
  }

  // 处理从首页跳转过来的 tab 切换
  useDidShow(() => {
    const tab = Taro.getStorageSync('recordPageTab')
    if (tab) {
      setActiveMethod(tab)
      Taro.removeStorageSync('recordPageTab') // 用完即删，避免重复触发
    }
  })

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

  const handleEditRecord = (e: any, _recordId: string) => {
    e.stopPropagation()
    Taro.showToast({ title: '编辑功能开发中', icon: 'none' })
  }

  const handleDeleteRecord = (e: any, _recordId: string) => {
    e.stopPropagation()
    Taro.showModal({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      success: (res) => {
        if (res.confirm) {
          Taro.showToast({ title: '删除功能开发中', icon: 'none' })
        }
      }
    })
  }

  /** 生成最近 6 天的日期选项（微信 showActionSheet 最多 6 项） */
  const getDateOptions = () => {
    const options: { dateStr: string; label: string }[] = []
    const today = new Date()
    for (let i = 0; i < 6; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      options.push({ dateStr, label: formatDate(dateStr) })
    }
    return options
  }
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
              {method.id === 'favorites' && <IconClock size={40} color={getMethodIconColor(method.id)} />}
            </View>
            <Text className='method-text'>{method.text}</Text>
          </View>
        ))}
      </View>

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
            <Text className='history-entry-text'>查看识别历史</Text>
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

      {/* 历史记录区域 */}
      {activeMethod === 'history' && (
        <View className='history-section'>
          {/* 日期选择 */}
          <View className='date-selector'>
            <View className='date-card'>
              <Text className='date-label'>选择日期</Text>
              <View
                className='date-display'
                onClick={() => {
                  const options = getDateOptions()
                  Taro.showActionSheet({
                    itemList: options.map((o) => o.label),
                    success: (res) => {
                      const opt = options[res.tapIndex]
                      if (opt) setSelectedDate(opt.dateStr)
                    }
                  })
                }}
              >
                <Text className='date-text'>{formatDate(selectedDate)}</Text>
                <Text className='iconfont icon-shizhong date-icon'></Text>
              </View>
            </View>
            <View className='date-stats'>
              <View className='stat-item'>
                <Text className='stat-label'>总摄入</Text>
                <Text className='stat-value'>{historyRecords[0]?.totalCalorie ?? 0} kcal</Text>
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
          ) : historyRecords.length > 0 && historyRecords[0].meals.length > 0 ? (
            <View className='history-list'>
              {historyRecords[0].meals.map((meal) => (
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
                      <View className='meal-actions'>
                        <View className='action-icon edit-icon' onClick={(e) => handleEditRecord(e, meal.id)}>
                          <Text className='iconfont icon-ic_detail'></Text>
                        </View>
                        <View className='action-icon delete-icon' onClick={(e) => handleDeleteRecord(e, meal.id)}>
                          <Text className='iconfont icon-shangzhang delete-icon-rotate'></Text>
                        </View>
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


