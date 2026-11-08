import { Image, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import type { DraftPhoto } from './model'
import { readingNote } from './reading'

interface PhotoSlotProps {
  label: string
  hint?: string
  required?: boolean
  photo?: DraftPhoto
  uploading?: boolean
  /** 秤的照片：下方显示自动读数。 */
  scale?: boolean
  /** 秤的照片：正在自动读数。 */
  reading?: boolean
  /** 秤的照片：旁边输入框里填的读数，和照片对不上时在照片下提醒。 */
  typed?: { value: string; precision: number }
  onPick: () => void
  onClear: () => void
}

/** 一个照片位：空时点击拍照，有图时可预览或重拍；秤的照片下方显示自动读数。 */
export function PhotoSlot(props: PhotoSlotProps) {
  const { photo, scale, reading, typed } = props
  if (!scale) return <PhotoTile {...props} />
  const note = readingNote(photo, typed)
  return (
    <View className='rw-photo-wrap'>
      <PhotoTile {...props} />
      {reading ? <Text className='rw-photo__note'>正在读秤上的数字</Text> : null}
      {!reading && note ? <Text className={`rw-photo__note ${note.warn ? 'rw-photo__note--warn' : ''}`}>{note.text}</Text> : null}
    </View>
  )
}

function PhotoTile({ label, hint, required, photo, uploading, onPick, onClear }: PhotoSlotProps) {
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
