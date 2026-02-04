import { View, Text, Image, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { imageToBase64, uploadAnalyzeImage, analyzeFoodImage, AnalyzeResponse } from '../../utils/api'

import './index.scss'

/** 餐次（分析前选择，AI 将结合餐次分析） */
const MEAL_OPTIONS: Array<{ value: MealType; label: string; icon: string }> = [
  { value: 'breakfast', label: '早餐', icon: '🌅' },
  { value: 'lunch', label: '午餐', icon: '☀️' },
  { value: 'dinner', label: '晚餐', icon: '🌙' },
  { value: 'snack', label: '加餐', icon: '🍎' }
]

/** 饮食目标（状态一） */
const DIET_GOAL_OPTIONS: Array<{ value: DietGoal; label: string; icon: string }> = [
  { value: 'fat_loss', label: '减脂期', icon: '🔥' },
  { value: 'muscle_gain', label: '增肌期', icon: '💪' },
  { value: 'maintain', label: '维持体重', icon: '⚖️' },
  { value: 'none', label: '无', icon: '⚪' }
]

/** 运动时机（状态二） */
const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string; icon: string }> = [
  { value: 'post_workout', label: '练后', icon: '🏋️' },
  { value: 'daily', label: '日常', icon: '🚶' },
  { value: 'before_sleep', label: '睡前', icon: '🛌' },
  { value: 'none', label: '无', icon: '⚪' }
]

export default function AnalyzePage() {
  const [imagePath, setImagePath] = useState<string>('')
  const [additionalInfo, setAdditionalInfo] = useState<string>('')
  const [mealType, setMealType] = useState<string>('breakfast')
  const [dietGoal, setDietGoal] = useState<string>('none')
  const [activityTiming, setActivityTiming] = useState<string>('none')
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  useEffect(() => {
    // 从本地存储获取图片路径
    try {
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      if (storedPath) {
        setImagePath(storedPath)
        // 清除存储，避免下次进入页面时误用
        Taro.removeStorageSync('analyzeImagePath')
      }
    } catch (error) {
      console.error('获取图片路径失败:', error)
    }
  }, [])

  const handleDietGoalSelect = (value: string) => {
    setDietGoal(value)
  }

  const handleActivityTimingSelect = (value: string) => {
    setActivityTiming(value)
  }

  const doAnalyze = async () => {
    setIsAnalyzing(true)
    Taro.showLoading({
      title: '分析中...',
      mask: true
    })

    try {
      // 1. 将图片转为 base64，先上传到 Supabase 获取公网 URL
      const base64Image = await imageToBase64(imagePath!)
      const { imageUrl } = await uploadAnalyzeImage(base64Image)

      // 2. 使用 URL 调用分析接口（AI 通过 URL 获取图片）
      const result: AnalyzeResponse = await analyzeFoodImage({
        image_url: imageUrl,
        additionalContext: additionalInfo,
        modelName: 'qwen-vl-max',
        meal_type: mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack',
        diet_goal: dietGoal as any,
        activity_timing: activityTiming as any
      })

      // 3. 保存分析结果与 Supabase 图片 URL，结果页/标记样本/保存记录均使用此 URL
      Taro.setStorageSync('analyzeImagePath', imageUrl)
      Taro.setStorageSync('analyzeResult', JSON.stringify(result))
      Taro.setStorageSync('analyzeMealType', mealType)
      Taro.setStorageSync('analyzeDietGoal', dietGoal)
      Taro.setStorageSync('analyzeActivityTiming', activityTiming)
      
      Taro.hideLoading()
      
      // 跳转到结果页面
      Taro.redirectTo({
        url: '/pages/result/index'
      })
    } catch (error: any) {
      Taro.hideLoading()
      setIsAnalyzing(false)
      
      Taro.showModal({
        title: '分析失败',
        content: error.message || '分析失败，请重试',
        showCancel: false,
        confirmText: '确定'
      })
    }
  }

  const handleConfirm = () => {
    if (!imagePath) {
      Taro.showToast({
        title: '图片不存在',
        icon: 'none'
      })
      return
    }
    Taro.showModal({
      title: '确认分析',
      content: '确定开始分析当前图片吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) doAnalyze()
      }
    })
  }

  const handleVoiceInput = () => {
    Taro.showToast({
      title: '语音输入功能',
      icon: 'none'
    })
  }

  return (
    <View className='analyze-page'>
      {/* 图片预览区域 */}
      <View className='image-preview-section'>
        {imagePath ? (
          <Image
            src={imagePath}
            mode='aspectFill'
            className='preview-image'
          />
        ) : (
          <View className='no-image-placeholder'>
            <Text className='placeholder-text'>暂无图片</Text>
          </View>
        )}
      </View>

      {/* 餐次（AI 将结合餐次分析） */}
      <View className='meal-section'>
        <View className='section-header'>
          <Text className='section-icon iconfont icon-canciguanli' />
          <Text className='section-title'>餐次</Text>
        </View>
        <Text className='section-hint'>
          选择本餐是早餐/午餐/晚餐/加餐，AI 将结合餐次给出建议。
        </Text>
        <View className='meal-options'>
          {MEAL_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`meal-option ${mealType === opt.value ? 'active' : ''}`}
              onClick={() => setMealType(opt.value)}
            >
              <Text className='meal-icon'>{opt.icon}</Text>
              <Text className='meal-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 饮食目标（状态一） */}
      <View className='state-section'>
        <View className='section-header'>
          <Text className='section-icon iconfont icon-shentinianling' />
          <Text className='section-title'>饮食目标</Text>
        </View>
        <Text className='section-hint'>
          选择您的饮食目标，AI 将结合目标给出更贴合的建议。
        </Text>
        <View className='state-options'>
          {DIET_GOAL_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`state-option ${dietGoal === opt.value ? 'active' : ''}`}
              onClick={() => handleDietGoalSelect(opt.value)}
            >
              <Text className='state-icon'>{opt.icon}</Text>
              <Text className='state-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 运动时机（状态二） */}
      <View className='state-section'>
        <View className='section-header'>
          <Text className='section-icon iconfont icon-canciguanli' />
          <Text className='section-title'>运动时机</Text>
        </View>
        <Text className='section-hint'>
          选择进食时机，AI 将结合时机给出针对性建议（如运动后补充蛋白、睡前避免碳水等）。
        </Text>
        <View className='state-options'>
          {ACTIVITY_TIMING_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`state-option ${activityTiming === opt.value ? 'active' : ''}`}
              onClick={() => handleActivityTimingSelect(opt.value)}
            >
              <Text className='state-icon'>{opt.icon}</Text>
              <Text className='state-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 补充细节区域 */}
      <View className='details-section'>
        <View className='section-header'>
          <Text className='section-icon iconfont icon-ic_detail' />
          <Text className='section-title'>补充细节</Text>
        </View>
        <Text className='section-hint'>
          提供更多上下文能显著提高识别准确率(如:这是我的500ml 标准便当盒)。
        </Text>
        
        <View className='input-wrapper'>
          <Textarea
            className='details-input'
            placeholder='例如:这是学校食堂的大份,或者额外加了辣油...'
            placeholderClass='input-placeholder'
            value={additionalInfo}
            onInput={(e) => setAdditionalInfo(e.detail.value)}
            maxlength={200}
            autoHeight
            showConfirmBar={false}
          />
          <View className='voice-btn' onClick={handleVoiceInput}>
            <Text className='voice-icon iconfont icon--yuyinshuruzhong' />
          </View>
        </View>
      </View>

      {/* 确认按钮 */}
      <View className='confirm-section'>
        <View 
          className={`confirm-btn ${!imagePath || isAnalyzing ? 'disabled' : ''}`}
          onClick={!isAnalyzing ? handleConfirm : undefined}
        >
          <Text className='confirm-btn-text'>
            {isAnalyzing ? '分析中...' : '确认并开始分析'}
          </Text>
        </View>
      </View>
    </View>
  )
}

