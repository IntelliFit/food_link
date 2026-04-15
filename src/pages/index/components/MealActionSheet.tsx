import { View, Text } from '@tarojs/components'

interface MealActionSheetProps {
  visible: boolean
  onClose: () => void
  onEdit: () => void
  onPoster: () => void
}

export function MealActionSheet({ visible, onClose, onEdit, onPoster }: MealActionSheetProps) {
  if (!visible) return null

  return (
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className='record-menu-content'>
        <View className='record-menu-handle-bar' />
        <View className='record-menu-grid-v2'>
          <View
            className='record-menu-grid-card'
            style={{ backgroundColor: '#eff6ff' }}
            onClick={() => { onClose(); onEdit() }}
          >
            <View className='record-menu-grid-icon-wrap'>
              <Text className='iconfont icon-bianji' style={{ fontSize: '40rpx', color: '#3b82f6' }} />
            </View>
            <View className='record-menu-grid-text-wrap'>
              <Text className='record-menu-grid-label' style={{ color: '#3b82f6' }}>
                修改记录
              </Text>
            </View>
          </View>

          <View
            className='record-menu-grid-card'
            style={{ backgroundColor: '#ecfdf5' }}
            onClick={() => { onClose(); onPoster() }}
          >
            <View className='record-menu-grid-icon-wrap'>
              <Text className='iconfont icon-share' style={{ fontSize: '40rpx', color: '#00bc7d' }} />
            </View>
            <View className='record-menu-grid-text-wrap'>
              <Text className='record-menu-grid-label' style={{ color: '#00bc7d' }}>
                生成分享海报
              </Text>
            </View>
          </View>
        </View>

        <View className='record-menu-footer'>
          <View className='record-menu-close-btn' onClick={onClose}>
            <Text className='record-menu-close-text'>取消</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
