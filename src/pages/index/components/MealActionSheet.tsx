import { View, Text } from '@tarojs/components'

interface MealActionSheetProps {
  visible: boolean
  onClose: () => void
  onEdit: () => void
  onPoster: () => void
  onDelete: () => void
}

export function MealActionSheet({ visible, onClose, onEdit, onPoster, onDelete }: MealActionSheetProps) {
  if (!visible) return null

  return (
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className='record-menu-content'>
        <View className='record-menu-handle-bar' />
        <View className='record-menu-grid-v2'>
          <View
            className='record-menu-grid-card'
            onClick={() => { onClose(); onEdit() }}
          >
            <View className='record-menu-grid-icon-wrap'>
              <Text className='iconfont icon-edit' style={{ fontSize: '40rpx', color: '#5c9ed4' }} />
            </View>
            <View className='record-menu-grid-text-wrap'>
              <Text className='record-menu-grid-label' style={{ color: '#5c9ed4' }}>
                修改记录
              </Text>
            </View>
          </View>

          <View
            className='record-menu-grid-card'
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
          <View className='record-menu-close-btn record-menu-delete-btn' onClick={() => { onClose(); onDelete() }}>
            <Text className='record-menu-close-text record-menu-delete-text'>删除</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
