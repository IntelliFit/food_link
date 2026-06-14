import { View, Text } from '@tarojs/components'

export interface FeedActionSheetAction {
  id: string
  label: string
  iconClass?: string
  color?: string
  danger?: boolean
}

interface FeedActionSheetProps {
  visible: boolean
  title?: string
  actions: FeedActionSheetAction[]
  onClose: () => void
  onSelect: (id: string) => void
}

export function FeedActionSheet({ visible, title, actions, onClose, onSelect }: FeedActionSheetProps) {
  const handleItemClick = (id: string) => {
    onClose()
    onSelect(id)
  }

  return (
    <View className={`feed-action-sheet-overlay ${visible ? 'feed-action-sheet-overlay--visible' : ''}`} catchMove>
      <View className='feed-action-sheet-mask' onClick={(e) => { e.stopPropagation(); onClose() }} />
      <View className='feed-action-sheet-content'>
        <View className='feed-action-sheet-actions'>
          {title ? (
            <>
              <View className='feed-action-sheet-title'>
                <Text className='feed-action-sheet-title-text'>{title}</Text>
              </View>
              <View className='feed-action-sheet-divider' />
            </>
          ) : null}
          {actions.map((item, idx) => (
            <View key={item.id}>
              {idx > 0 ? <View className='feed-action-sheet-divider' /> : null}
              <View
                className={`feed-action-sheet-item ${item.danger ? 'feed-action-sheet-item--danger' : ''}`}
                onClick={() => handleItemClick(item.id)}
              >
                {item.iconClass ? (
                  <Text
                    className={`iconfont ${item.iconClass} feed-action-sheet-icon`}
                    style={item.color ? { color: item.color } : undefined}
                  />
                ) : null}
                <Text className='feed-action-sheet-label'>{item.label}</Text>
              </View>
            </View>
          ))}
        </View>
        <View className='feed-action-sheet-cancel' onClick={onClose}>
          <Text className='feed-action-sheet-cancel-text'>取消</Text>
        </View>
      </View>
    </View>
  )
}
