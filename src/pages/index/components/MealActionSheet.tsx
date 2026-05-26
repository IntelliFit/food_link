import { View, Text } from '@tarojs/components'

interface MealActionSheetProps {
  visible: boolean
  onClose: () => void
  onEdit: () => void
  onPoster: () => void
  onDelete: () => void
}

const GRID_ITEMS = [
  {
    id: 'edit',
    label: '修改记录',
    color: '#5c9ed4',
    backgroundColor: '#f0f7ff',
    borderColor: '#cce0f5',
    iconBackgroundColor: '#e0f0ff',
    iconClass: 'icon-edit',
  },
  {
    id: 'poster',
    label: '生成分享海报',
    color: '#00bc7d',
    backgroundColor: '#f0fdf9',
    borderColor: '#ccf5e6',
    iconBackgroundColor: '#e0fbf0',
    iconClass: 'icon-share',
  },
] as const

export function MealActionSheet({ visible, onClose, onEdit, onPoster, onDelete }: MealActionSheetProps) {
  if (!visible) return null

  return (
    <View className='record-menu-modal' catchMove>
      <View className='record-menu-mask' onClick={onClose} />
      <View className='record-menu-content'>
        <View className='record-menu-handle-bar' />

        {/* 修改记录 + 生成分享海报：2 列卡片 */}
        <View className='record-menu-grid-v2'>
          {GRID_ITEMS.map((item) => (
            <View
              key={item.id}
              className='record-menu-grid-card'
              style={{
                backgroundColor: item.backgroundColor,
                borderColor: item.borderColor,
              }}
              onClick={() => { onClose(); item.id === 'edit' ? onEdit() : onPoster() }}
            >
              <View
                className='record-menu-grid-icon-wrap'
                style={{ backgroundColor: item.iconBackgroundColor }}
              >
                <Text className={`iconfont ${item.iconClass}`} style={{ fontSize: '40rpx', color: item.color }} />
              </View>
              <View className='record-menu-grid-text-wrap'>
                <Text className='record-menu-grid-label' style={{ color: item.color }}>
                  {item.label}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* 删除：单独一行，纯文字红色 */}
        <View className='record-menu-footer'>
          <View className='record-menu-delete-row' onClick={() => { onClose(); onDelete() }}>
            <Text className='record-menu-delete-icon'>×</Text>
            <Text className='record-menu-delete-text'>删除</Text>
          </View>
        </View>
      </View>
    </View>
  )
}
