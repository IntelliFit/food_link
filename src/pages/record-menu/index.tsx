import { View, Text, Image } from '@tarojs/components'
import { useCallback, useEffect } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { getAccessToken } from '../../utils/api'
import { withAuth } from '../../utils/withAuth'
import { IconCamera, IconAlbum, IconText, IconEdit, IconHistory } from '../../components/iconfont'

import './index.scss'

// 主要功能模式
const MAIN_MODES = [
  {
    id: 'camera',
    label: '拍照识别',
    color: '#00bc7d',
    bgColor: 'rgba(0, 188, 125, 0.08)',
    Icon: IconCamera,
  },
  {
    id: 'album',
    label: '相册选择',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.08)',
    Icon: IconAlbum,
  },
  {
    id: 'text',
    label: '文字记录',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.08)',
    Icon: IconText,
  },
  {
    id: 'manual',
    label: '手动记录',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.08)',
    Icon: IconEdit,
  },
]

// 其他功能
const OTHER_MODES = [
  {
    id: 'history',
    label: '历史记录',
    desc: '查看以往识别记录',
    color: '#6b7280',
    Icon: IconHistory,
  },
]

function RecordMenuPage() {
  // 页面显示时隐藏底部 tabBar
  useDidShow(() => {
    Taro.hideTabBar({ animation: true }).catch(() => {})
  })

  // 检查登录状态
  const checkAuth = useCallback(() => {
    if (!getAccessToken()) {
      Taro.navigateTo({ url: '/pages/login/index' })
      return false
    }
    return true
  }, [])

  // 处理主要模式点击
  const handleMainModeClick = useCallback((modeId: string) => {
    if (!checkAuth()) return

    switch (modeId) {
      case 'camera':
        // 进入简化拍照模式
        Taro.navigateTo({ url: '/pages/record/index?mode=simple' })
        break
      case 'album':
        // 直接进入相册选择
        Taro.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album'],
          success: (res) => {
            const imagePath = res.tempFilePaths[0]
            Taro.setStorageSync('analyzeImagePath', imagePath)
            Taro.navigateTo({ url: '/pages/analyze/index' })
          },
          fail: (err) => {
            if (err.errMsg?.includes('cancel')) return
            Taro.showToast({ title: '选择图片失败', icon: 'none' })
          }
        })
        break
      case 'text':
        Taro.navigateTo({ url: '/pages/record-text/index' })
        break
      case 'manual':
        Taro.navigateTo({ url: '/pages/record-manual/index' })
        break
    }
  }, [checkAuth])

  // 处理其他模式点击
  const handleOtherModeClick = useCallback((modeId: string) => {
    if (!checkAuth()) return

    switch (modeId) {
      case 'history':
        Taro.navigateTo({ url: '/pages/analyze-history/index' })
        break
    }
  }, [checkAuth])

  // 关闭页面
  const handleClose = useCallback(() => {
    Taro.navigateBack({ delta: 1 }).catch(() => {
      Taro.switchTab({ url: '/pages/index/index' })
    })
  }, [])

  return (
    <View className='record-menu-page'>
      {/* 主功能网格 */}
      <View className='main-modes-grid'>
        {MAIN_MODES.map((mode) => {
          const IconComponent = mode.Icon
          return (
            <View
              key={mode.id}
              className='mode-card'
              style={{ backgroundColor: mode.bgColor }}
              onClick={() => handleMainModeClick(mode.id)}
            >
              <View className='mode-icon-wrap' style={{ backgroundColor: mode.color }}>
                <IconComponent size={32} color='#ffffff' />
              </View>
              <Text className='mode-label' style={{ color: mode.color }}>
                {mode.label}
              </Text>
            </View>
          )
        })}
      </View>

      {/* 分隔线 */}
      <View className='section-divider' />

      {/* 其他功能列表 */}
      <View className='other-modes-list'>
        <Text className='section-title'>其他功能</Text>
        {OTHER_MODES.map((mode) => {
          const IconComponent = mode.Icon
          return (
            <View
              key={mode.id}
              className='list-item'
              onClick={() => handleOtherModeClick(mode.id)}
            >
              <View className='list-icon-wrap' style={{ backgroundColor: 'rgba(107, 114, 128, 0.1)' }}>
                <IconComponent size={20} color={mode.color} />
              </View>
              <View className='list-content'>
                <Text className='list-label'>{mode.label}</Text>
                <Text className='list-desc'>{mode.desc}</Text>
              </View>
              <View className='list-arrow'>›</View>
            </View>
          )
        })}
      </View>

      {/* 底部取消按钮 */}
      <View className='menu-footer'>
        <View className='cancel-btn' onClick={handleClose}>
          <Text className='cancel-text'>取消</Text>
        </View>
      </View>
    </View>
  )
}

export default withAuth(RecordMenuPage)
