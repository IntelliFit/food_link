import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import {
  IconCamera,
  IconAlbum,
  IconText,
  IconEdit,
  IconBreakfast,
  IconLunch,
  IconDinner,
  IconSnack,
  IconExercise,
  IconMicrophone,
  IconChevronRight
} from '../../../components/iconfont'

interface RecordMenuProps {
  visible: boolean
  onClose: () => void
}

// 顶部2x2网格功能
const GRID_FEATURES = [
  {
    id: 'camera',
    label: '拍照识别',
    subLabel: 'Scan Food',
    color: '#e85d75',
    bgColor: '#fef2f4',
    Icon: IconCamera,
  },
  {
    id: 'receipt',
    label: '小票识别',
    subLabel: 'Scan Receipt',
    color: '#10b981',
    bgColor: '#ecfdf5',
    Icon: IconEdit,
  },
  {
    id: 'label',
    label: '营养标签',
    subLabel: 'Nutrition Label',
    color: '#f59e0b',
    bgColor: '#fffbeb',
    Icon: IconText,
  },
  {
    id: 'bill',
    label: '账单识别',
    subLabel: 'Scan Food Bill',
    color: '#3b82f6',
    bgColor: '#eff6ff',
    isNew: true,
    Icon: IconAlbum,
  },
]

// 底部列表项
const LIST_ITEMS = [
  {
    id: 'breakfast',
    label: '早餐',
    iconType: 'meal',
    Icon: IconBreakfast,
    color: '#f59e0b',
  },
  {
    id: 'lunch',
    label: '午餐',
    iconType: 'meal',
    Icon: IconLunch,
    color: '#f59e0b',
  },
  {
    id: 'snack',
    label: '加餐',
    iconType: 'meal',
    Icon: IconSnack,
    color: '#f59e0b',
  },
  {
    id: 'dinner',
    label: '晚餐',
    iconType: 'meal',
    Icon: IconDinner,
    color: '#f59e0b',
  },
  {
    id: 'activity',
    label: '运动',
    iconType: 'activity',
    Icon: IconExercise,
    color: '#e85d75',
  },
]

export function RecordMenu({ visible, onClose }: RecordMenuProps) {
  if (!visible) return null

  const handleGridClick = (modeId: string) => {
    onClose()

    switch (modeId) {
      case 'camera':
        Taro.navigateTo({ url: '/pages/record/index?mode=simple' })
        break
      case 'receipt':
        Taro.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album'],
          success: (res) => {
            const imagePath = res.tempFilePaths[0]
            Taro.setStorageSync('analyzeImagePath', imagePath)
            Taro.setStorageSync('analyzeMode', 'receipt')
            Taro.navigateTo({ url: '/pages/analyze/index' })
          },
          fail: (err) => {
            if (err.errMsg?.includes('cancel')) return
            Taro.showToast({ title: '选择图片失败', icon: 'none' })
          }
        })
        break
      case 'label':
        Taro.navigateTo({ url: '/pages/record-text/index' })
        break
      case 'bill':
        Taro.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType: ['album'],
          success: (res) => {
            const imagePath = res.tempFilePaths[0]
            Taro.setStorageSync('analyzeImagePath', imagePath)
            Taro.setStorageSync('analyzeMode', 'bill')
            Taro.navigateTo({ url: '/pages/analyze/index' })
          },
          fail: (err) => {
            if (err.errMsg?.includes('cancel')) return
            Taro.showToast({ title: '选择图片失败', icon: 'none' })
          }
        })
        break
    }
  }

  const handleListClick = (itemId: string) => {
    onClose()

    switch (itemId) {
      case 'breakfast':
        Taro.navigateTo({ url: '/pages/record-manual/index?meal=breakfast' })
        break
      case 'lunch':
        Taro.navigateTo({ url: '/pages/record-manual/index?meal=lunch' })
        break
      case 'snack':
        Taro.navigateTo({ url: '/pages/record-manual/index?meal=snack' })
        break
      case 'dinner':
        Taro.navigateTo({ url: '/pages/record-manual/index?meal=dinner' })
        break
      case 'activity':
        Taro.navigateTo({ url: '/pages/exercise-record/index' })
        break
    }
  }

  return (
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className='record-menu-content'>
        {/* 顶部圆角指示条 */}
        <View className='record-menu-handle-bar' />

        {/* 2x2 功能网格 */}
        <View className='record-menu-grid-v2'>
          {GRID_FEATURES.map((feature) => {
            const IconComponent = feature.Icon
            return (
              <View
                key={feature.id}
                className='record-menu-grid-card'
                style={{ backgroundColor: feature.bgColor }}
                onClick={() => handleGridClick(feature.id)}
              >
                {feature.isNew && (
                  <View className='record-menu-new-badge'>
                    <Text className='record-menu-new-text'>NEW</Text>
                  </View>
                )}
                <View className='record-menu-grid-icon-wrap'>
                  <IconComponent size={40} color={feature.color} />
                </View>
                <View className='record-menu-grid-text-wrap'>
                  <Text className='record-menu-grid-label' style={{ color: feature.color }}>
                    {feature.label}
                  </Text>
                  <Text className='record-menu-grid-sublabel'>
                    {feature.subLabel}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* 底部功能列表 */}
        <View className='record-menu-list-v2'>
          {LIST_ITEMS.map((item) => {
            const IconComponent = item.Icon
            return (
              <View
                key={item.id}
                className='record-menu-list-item-v2'
                onClick={() => handleListClick(item.id)}
              >
                <View className='record-menu-list-left'>
                  <View className='record-menu-list-icon-wrap' style={{ backgroundColor: `${item.color}15` }}>
                    <IconComponent size={24} color={item.color} />
                  </View>
                  <Text className='record-menu-list-label-v2'>{item.label}</Text>
                </View>
                <View className='record-menu-list-right'>
                  <View className='record-menu-mic-btn'>
                    <IconMicrophone size={18} color='#9ca3af' />
                  </View>
                  <IconChevronRight size={16} color='#d1d5db' />
                </View>
              </View>
            )
          })}
        </View>

        {/* 底部安全区域 */}
        <View className='record-menu-safe-area' />
      </View>
    </View>
  )
}
