import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { DraftPhoto } from './model'

interface PhotoSlotProps {
  label: string
  hint?: string
  required?: boolean
  photo?: DraftPhoto
  uploading?: boolean
  onPick: () => void
  onClear: () => void
}

/** 一个照片位：空时点击拍照，有图时可预览或重拍。 */
export function PhotoSlot({ label, hint, required, photo, uploading, onPick, onClear }: PhotoSlotProps) {
  const handleTap = async () => {
    if (uploading) return
    if (!photo) {
      onPick()
      return
    }
    try {
      const { tapIndex } = await Taro.showActionSheet({ itemList: ['查看大图', '重拍', '删除'] })
      if (tapIndex === 0) Taro.previewImage({ urls: [photo.url], current: photo.url })
      if (tapIndex === 1) onPick()
      if (tapIndex === 2) onClear()
    } catch {
      // 取消操作时保持原样。
    }
  }

  return (
    <View className={`rw-photo ${photo ? 'rw-photo--filled' : ''}`} onClick={() => void handleTap()}>
      {photo ? <Image className='rw-photo__image' src={photo.url} mode='aspectFill' /> : null}
      {uploading ? <View className='rw-photo__mask'><View className='loading-spinner' /></View> : null}
      {!photo && !uploading ? (
        <View className='rw-photo__empty'>
          <Text className='iconfont icon-paizhao-xianxing rw-photo__icon' />
          <Text className='rw-photo__label'>{label}{required ? <Text className='rw-required'> *</Text> : null}</Text>
          {hint ? <Text className='rw-photo__hint'>{hint}</Text> : null}
        </View>
      ) : null}
      {photo && !uploading ? <Text className='rw-photo__tag'>{label}</Text> : null}
    </View>
  )
}
