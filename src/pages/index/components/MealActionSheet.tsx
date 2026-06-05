import { View, Text } from '@tarojs/components'

interface MealActionSheetProps {
  visible: boolean
  onClose: () => void
  onEdit: () => void
  onPoster: () => void
  onShare: () => void
  onDelete: () => void
}

const ACTION_ITEMS = [
  {
    id: 'edit',
    label: '修改记录',
    iconClass: 'icon-canciguanli',
    color: '#10b981',
    iconModifier: 'action-sheet-icon--record',
  },
  {
    id: 'poster',
    label: '生成分享海报',
    iconClass: 'icon-fenxiang',
    color: '#3b82f6',
    iconModifier: 'action-sheet-icon--share',
  },
  {
    id: 'share',
    label: '分享到公共食物库',
    iconClass: 'icon-shiwu',
    color: '#f97316',
    iconModifier: 'action-sheet-icon--library',
  },
] as const

export function MealActionSheet({ visible, onClose, onEdit, onPoster, onShare, onDelete }: MealActionSheetProps) {
  if (!visible) return null

  const handleItemClick = (id: string) => {
    onClose()
    if (id === 'edit') onEdit()
    else if (id === 'poster') onPoster()
    else if (id === 'share') onShare()
  }

  return (
    <View className='meal-action-sheet-overlay' catchMove>
      <View className='meal-action-sheet-mask' onClick={onClose} />
      <View className='meal-action-sheet-content'>
        <View className='meal-action-sheet-handle-bar' />
        <View className='meal-action-sheet-actions'>
          {ACTION_ITEMS.map((item, idx) => (
            <View key={item.id}>
              <View className='meal-action-sheet-item' onClick={() => handleItemClick(item.id)}>
                <Text
                  className={`iconfont ${item.iconClass} meal-action-sheet-icon ${item.iconModifier}`}
                  style={{ color: item.color }}
                />
                <Text className='meal-action-sheet-label'>{item.label}</Text>
              </View>
              {idx < ACTION_ITEMS.length - 1 && <View className='meal-action-sheet-divider' />}
            </View>
          ))}
          <View className='meal-action-sheet-divider' />
          <View className='meal-action-sheet-item meal-action-sheet-item--danger' onClick={() => { onClose(); onDelete() }}>
            <Text className='iconfont icon-shanchu meal-action-sheet-icon' />
            <Text className='meal-action-sheet-label'>删除</Text>
          </View>
        </View>
        <View className='meal-action-sheet-cancel' onClick={onClose}>
          <Text className='meal-action-sheet-cancel-text'>取消</Text>
        </View>
      </View>
    </View>
  )
}
