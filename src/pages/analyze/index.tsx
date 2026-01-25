import { View, Text, Image, Textarea } from '@tarojs/components'
import { useState, useEffect } from 'react'
import Taro from '@tarojs/taro'
import { imageToBase64, analyzeFoodImage, AnalyzeResponse } from '../../utils/api'

import './index.scss'

export default function AnalyzePage() {
  const [imagePath, setImagePath] = useState<string>('')
  const [additionalInfo, setAdditionalInfo] = useState<string>('')
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

  const handleConfirm = async () => {
    if (!imagePath) {
      Taro.showToast({
        title: '图片不存在',
        icon: 'none'
      })
      return
    }

    setIsAnalyzing(true)
    Taro.showLoading({
      title: '分析中...',
      mask: true
    })

    try {
      // 将图片转换为base64
      const base64Image = await imageToBase64(imagePath)
      
      // 调用API分析
      const result: AnalyzeResponse = await analyzeFoodImage({
        base64Image,
        additionalContext: additionalInfo,
        modelName: 'qwen-vl-max'
      })

      // 保存分析结果和图片路径到存储，供结果页面使用
      Taro.setStorageSync('analyzeImagePath', imagePath)
      Taro.setStorageSync('analyzeResult', JSON.stringify(result))
      
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

      {/* 补充细节区域 */}
      <View className='details-section'>
        <View className='section-header'>
          <Text className='section-icon'>⚡</Text>
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
            <Text className='voice-icon'>🎤</Text>
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

