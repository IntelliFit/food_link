import { View, Text, Image, Textarea } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import { analyzeFoodText } from '../../utils/api'
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

  /** 文字记录：开始计算前确认 → 调大模型分析 → 跳转结果页 */
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
    Taro.showLoading({ title: '分析中...', mask: true })
    try {
      const result = await analyzeFoodText({
        text: inputText,
        diet_goal: textDietGoal as any,
        activity_timing: textActivityTiming as any
      })
      Taro.hideLoading()
      Taro.setStorageSync('analyzeTextResult', JSON.stringify(result))
      Taro.setStorageSync('analyzeTextSource', 'text')
      Taro.setStorageSync('analyzeDietGoal', textDietGoal)
      Taro.setStorageSync('analyzeActivityTiming', textActivityTiming)
      Taro.navigateTo({ url: '/pages/result-text/index' })
    } catch (e: any) {
      Taro.hideLoading()
      Taro.showToast({ title: e.message || '分析失败', icon: 'none' })
    } finally {
      setTextCalculating(false)
    }
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

    </View>
  )
}


