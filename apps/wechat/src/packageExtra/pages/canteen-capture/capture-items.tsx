import { Image, Input, Text, View } from '@tarojs/components'
import type { CaptureItem } from '../../../utils/canteen-capture-api'
import { itemPriceText, itemStatusLabel, isSellable, orderCaptureItems } from './capture-view'

interface CaptureItemsProps {
  items: CaptureItem[]
  busyKey: string
  readOnly: boolean
  newDishName: string
  onNewDishNameChange: (value: string) => void
  onPhotograph: (item: CaptureItem) => void
  onAddDish: () => void
}

/** 第三步：识别出的菜品清单。每道菜点“拍实物”即绑定照片，不需要事后配图。 */
export default function CaptureItems({
  items, busyKey, readOnly, newDishName, onNewDishNameChange, onPhotograph, onAddDish,
}: CaptureItemsProps) {
  const ordered = orderCaptureItems(items)
  return (
    <View className='capture-card'>
      <Text className='capture-card-title'>菜品清单 · {items.filter(isSellable).length} 道</Text>
      <Text className='capture-hint'>给每道菜拍一张实物图可获得更高奖励。看不准的条目由平台核对，不需要你手动修改。</Text>
      {ordered.map(item => {
        const sellable = isSellable(item)
        const photos = item.dish_photo_urls || []
        return (
          <View key={item.key} className={`capture-item ${sellable ? '' : 'capture-item--muted'}`}>
            <View className='capture-item-main'>
              <Text className='capture-item-name'>{item.name}</Text>
              <Text className='capture-item-price'>{itemPriceText(item)}</Text>
              {item.option_groups?.map(group => (
                <Text key={group.title} className='capture-item-option'>{group.title ? `${group.title}：` : ''}{group.choices.join('、')}</Text>
              ))}
            </View>
            <View className='capture-item-side'>
              <Text className={`capture-item-status capture-item-status--${item.status}`}>{itemStatusLabel(item)}</Text>
              {photos.length > 0 && <Image className='capture-item-photo' src={photos[0]} mode='aspectFill' />}
              {sellable && !readOnly && (
                <View className={`capture-item-shoot ${busyKey === item.key ? 'disabled' : ''}`} onClick={() => onPhotograph(item)}>
                  {busyKey === item.key ? <View className='capture-spinner' /> : <Text>{photos.length ? '再拍' : '拍实物'}</Text>}
                </View>
              )}
            </View>
          </View>
        )
      })}
      {!readOnly && (
        <View className='capture-add-dish'>
          <Input className='capture-add-input' maxlength={40} placeholder='菜单上没有的菜，写菜名后拍照' value={newDishName}
            onInput={event => onNewDishNameChange(event.detail.value)}
          />
          <View className={`capture-item-shoot ${busyKey === '__new__' || !newDishName.trim() ? 'disabled' : ''}`} onClick={onAddDish}>
            {busyKey === '__new__' ? <View className='capture-spinner' /> : <Text>拍照添加</Text>}
          </View>
        </View>
      )}
    </View>
  )
}
