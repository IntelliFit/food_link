import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { IconCamera, IconAlbum, IconText, IconEdit, IconHistory } from '../../../components/iconfont'

interface RecordMenuProps {
  visible: boolean
  onClose: () => void
}

// 主要功能模式
const MAIN_MODES = [
  {
    id: 'camera',
    label: '拍照识别',
    color: '#00bc7d',
    bgColor: 'rgba(0, 188, 125, 0.08)',
    iconColor: '#ffffff',
    Icon: IconCamera,
  },
  {
    id: 'album',
    label: '相册选择',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.08)',
    iconColor: '#ffffff',
    Icon: IconAlbum,
  },
  {
    id: 'text',
    label: '文字记录',
    color: '#8b5cf6',
    bgColor: 'rgba(139, 92, 246, 0.08)',
    iconColor: '#ffffff',
    Icon: IconText,
  },
  {
    id: 'manual',
    label: '手动记录',
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.08)',
    iconColor: '#ffffff',
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

export function RecordMenu({ visible, onClose }: RecordMenuProps) {
  if (!visible) return null

  const handleMainModeClick = (modeId: string) => {
    onClose()

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
  }

  const handleOtherModeClick = (modeId: string) => {
    onClose()
    if (modeId === 'history') {
      Taro.navigateTo({ url: '/pages/analyze-history/index' })
    }
  }

  return (
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className='record-menu-content'>
        {/* 标题 */}
        <View className='record-menu-header'>
          <Text className='record-menu-title'>记录饮食</Text>
          <Text className='record-menu-subtitle'>选择记录方式</Text>
        </View>

        {/* 主功能网格 */}
        <View className='record-menu-grid'>
          {MAIN_MODES.map((mode) => {
            const IconComponent = mode.Icon
            return (
              <View
                key={mode.id}
                className='record-menu-card'
                style={{ backgroundColor: mode.bgColor }}
                onClick={() => handleMainModeClick(mode.id)}
              >
                <View
                  className='record-menu-icon-wrap'
                  style={{ backgroundColor: mode.color }}
                >
                  <IconComponent size={32} color={mode.iconColor} />
                </View>
                <Text className='record-menu-label' style={{ color: mode.color }}>
                  {mode.label}
                </Text>
              </View>
            )
          })}
        </View>

        {/* 分隔线 */}
        <View className='record-menu-divider' />

        {/* 其他功能列表 */}
        <View className='record-menu-list'>
          <Text className='record-menu-section-title'>其他功能</Text>
          {OTHER_MODES.map((mode) => {
            const IconComponent = mode.Icon
            return (
              <View
                key={mode.id}
                className='record-menu-list-item'
                onClick={() => handleOtherModeClick(mode.id)}
              >
                <View
                  className='record-menu-list-icon'
                  style={{ backgroundColor: 'rgba(107, 114, 128, 0.1)' }}
                >
                  <IconComponent size={20} color={mode.color} />
                </View>
                <View className='record-menu-list-content'>
                  <Text className='record-menu-list-label'>{mode.label}</Text>
                  <Text className='record-menu-list-desc'>{mode.desc}</Text>
                </View>
                <Text className='record-menu-list-arrow'>›</Text>
              </View>
            )
          })}
        </View>

        {/* 关闭按钮 */}
        <View className='record-menu-footer'>
          <View className='record-menu-close-btn' onClick={onClose}>
            <Text className='record-menu-close-text'>取消</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
