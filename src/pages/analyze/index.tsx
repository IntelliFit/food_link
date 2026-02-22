import { View, Text, Image, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { Switch } from '@taroify/core'
import { imageToBase64, uploadAnalyzeImage, submitAnalyzeTask, getAccessToken, MealType, DietGoal, ActivityTiming, getHealthProfile } from '../../utils/api'

import './index.scss'

/** 餐次（分析前选择，AI 将结合餐次分析） */
const MEAL_OPTIONS: Array<{ value: MealType; label: string; iconClass: string }> = [
  { value: 'breakfast', label: '早餐', iconClass: 'icon-zaocan1' },
  { value: 'lunch', label: '午餐', iconClass: 'icon-wucan' },
  { value: 'dinner', label: '晚餐', iconClass: 'icon-wancan' },
  { value: 'snack', label: '加餐', iconClass: 'icon-lingshi' }
]

/** 饮食目标（状态一） */
const DIET_GOAL_OPTIONS: Array<{ value: DietGoal; label: string; iconClass: string }> = [
  { value: 'fat_loss', label: '减脂期', iconClass: 'icon-huore' },
  { value: 'muscle_gain', label: '增肌期', iconClass: 'icon-zengji' },
  { value: 'maintain', label: '维持体重', iconClass: 'icon-tianpingzuo' },
  { value: 'none', label: '无', iconClass: 'icon-nothing' }
]

/** 运动时机（状态二） */
const ACTIVITY_TIMING_OPTIONS: Array<{ value: ActivityTiming; label: string; iconClass: string }> = [
  { value: 'post_workout', label: '练后', iconClass: 'icon-juzhong' },
  { value: 'daily', label: '日常', iconClass: 'icon-duoren' },
  { value: 'before_sleep', label: '睡前', iconClass: 'icon-shuijue' },
  { value: 'none', label: '无', iconClass: 'icon-nothing' }
]

export default function AnalyzePage() {
  const [imagePaths, setImagePaths] = useState<string[]>([])
  const [additionalInfo, setAdditionalInfo] = useState<string>('')
  const [mealType, setMealType] = useState<MealType>('breakfast')
  const [dietGoal, setDietGoal] = useState<DietGoal>('none')
  const [activityTiming, setActivityTiming] = useState<ActivityTiming>('none')
  const [isMultiView, setIsMultiView] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  useEffect(() => {
    // 1. 获取饮食目标
    const initDietGoal = async () => {
      try {
        const cachedGoal = Taro.getStorageSync('dietGoal')
        if (cachedGoal) {
          setDietGoal(cachedGoal as DietGoal)
        } else {
          // 本地无缓存，尝试请求
          if (getAccessToken()) {
            const profile = await getHealthProfile()
            if (profile.diet_goal) {
              setDietGoal(profile.diet_goal as DietGoal)
              Taro.setStorageSync('dietGoal', profile.diet_goal)
            }
          }
        }
      } catch (err) {
        console.error('初始化饮食目标失败:', err)
      }
    }
    initDietGoal()

    // 2. 从本地存储获取图片路径 (用于拍照后的跳转)
    try {
      const storedPath = Taro.getStorageSync('analyzeImagePath')
      if (storedPath) {
        setImagePaths([storedPath])
        // 清除存储，避免下次进入页面时误用
        Taro.removeStorageSync('analyzeImagePath')
      }
    } catch (error) {
      console.error('获取图片路径失败:', error)
    }
  }, [])

  const handleChooseImage = async () => {
    try {
      const res = await Taro.chooseMedia({
        count: 3 - imagePaths.length,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
      })
      const newPaths = res.tempFiles.map(f => f.tempFilePath)
      setImagePaths(prev => [...prev, ...newPaths])
    } catch (e) {
      // cancelled
      console.log('选择图片取消/失败', e)
    }
  }

  const handleRemoveImage = (index: number) => {
    setImagePaths(prev => {
      const newPaths = [...prev]
      newPaths.splice(index, 1)
      return newPaths
    })
  }

  const handleDietGoalSelect = (value: DietGoal) => {
    setDietGoal(value)
  }

  const handleActivityTimingSelect = (value: ActivityTiming) => {
    setActivityTiming(value)
  }

  const doAnalyze = async () => {
    if (!getAccessToken()) {
      Taro.showToast({ title: '请先登录后再使用识别功能', icon: 'none' })
      return
    }
    if (imagePaths.length === 0) {
      Taro.showToast({ title: '请先选择图片', icon: 'none' })
      return
    }

    setIsAnalyzing(true)
    Taro.showLoading({ title: '上传图片...', mask: true })

    try {
      // 1. 依次上传所有图片获取 URL
      const imageUrls: string[] = []
      for (const path of imagePaths) {
        const base64 = await imageToBase64(path)
        const { imageUrl } = await uploadAnalyzeImage(base64)
        imageUrls.push(imageUrl)
      }

      const primaryImageUrl = imageUrls[0]

      Taro.showLoading({ title: '提交任务...', mask: true })
      const { task_id } = await submitAnalyzeTask({
        image_url: primaryImageUrl,
        image_urls: imageUrls,
        meal_type: mealType,
        diet_goal: dietGoal,
        activity_timing: activityTiming,
        additionalContext: additionalInfo || undefined,
        modelName: 'gemini',
        is_multi_view: isMultiView
      })
      Taro.hideLoading()
      Taro.redirectTo({ url: `/pages/analyze-loading/index?task_id=${task_id}` })
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
    if (imagePaths.length === 0) {
      handleChooseImage() // 如果没图片，点击确认直接触发选择
      return
    }
    Taro.showModal({
      title: '确认分析',
      content: `确定开始分析这 ${imagePaths.length} 张图片吗？`,
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

  const handlePreviewImage = (current: string) => {
    Taro.previewImage({
      current,
      urls: imagePaths
    })
  }

  return (
    <View className='analyze-page'>
      {/* 图片预览区域 (Grid) */}
      <View className='image-preview-section'>
        {imagePaths.length > 0 ? (
          <View className='image-grid'>
            {imagePaths.map((path, index) => (
              <View key={index} className='grid-item'>
                <Image
                  src={path}
                  mode='aspectFill'
                  className='grid-image'
                  onClick={() => handlePreviewImage(path)}
                />
                <View className='remove-btn' onClick={(e) => {
                  e.stopPropagation()
                  handleRemoveImage(index)
                }}>
                  <Text className='close-icon'>×</Text>
                </View>
              </View>
            ))}
            {imagePaths.length < 3 && (
              <View className='grid-item add-btn' onClick={handleChooseImage}>
                <Text className='add-icon'>+</Text>
                <Text className='add-text'>添加</Text>
              </View>
            )}
          </View>
        ) : (
          <View className='no-image-placeholder' onClick={handleChooseImage}>
            <View className='placeholder-content'>
              <Text className='iconfont icon-xiangji' style={{ fontSize: '64rpx', color: '#9ca3af', marginBottom: '16rpx' }} />
              <Text className='placeholder-text'>点击拍摄/上传食物</Text>
              <Text className='placeholder-sub'>支持多图 (最多3张)</Text>
            </View>
          </View>
        )}
      </View>

      {/* 餐次（AI 将结合餐次分析） */}
      <View className='meal-section'>
        <View className='section-header'>
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
              <Text className={`meal-icon iconfont ${opt.iconClass}`} />
              <Text className='meal-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 多视角辅助模式 */}
      <View className='multiview-section'>
        <View className='section-header-row'>
          <View>
            <Text className='section-title'>多视角辅助模式</Text>
            <Text className='section-subtitle'>Multi-view Assist Mode</Text>
          </View>
          <Switch
            checked={isMultiView}
            onChange={setIsMultiView}
            style={{ '--switch-checked-background-color': '#00bc7d' } as React.CSSProperties}
          />
        </View>
        <Text className='section-hint'>
          开启后，模型将把上传的多张图片视为同一食物的不同视角，有助于更精准地估算分量。
        </Text>
      </View>

      {/* 饮食目标（状态一） */}
      <View className='state-section'>
        <View className='section-header'>

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
              <Text className={`state-icon iconfont ${opt.iconClass}`} />
              <Text className='state-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 运动时机（状态二） */}
      <View className='state-section'>
        <View className='section-header'>

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
              <Text className={`state-icon iconfont ${opt.iconClass}`} />
              <Text className='state-label'>{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 补充细节区域 */}
      <View className='details-section'>
        <View className='section-header'>

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
          className={`confirm-btn ${imagePaths.length === 0 || isAnalyzing ? 'disabled' : ''}`}
          onClick={!isAnalyzing ? handleConfirm : undefined}
        >
          <Text className='confirm-btn-text'>
            {isAnalyzing ? '提交中...' : (imagePaths.length === 0 ? '请先拍照' : `分析 ${imagePaths.length} 张图片`)}
          </Text>
        </View>
        <View
          className='history-link'
          onClick={() => Taro.navigateTo({ url: '/pages/analyze-history/index' })}
        >
          <Text className='history-link-text'>查看分析历史</Text>
        </View>
      </View>
    </View>
  )
}
