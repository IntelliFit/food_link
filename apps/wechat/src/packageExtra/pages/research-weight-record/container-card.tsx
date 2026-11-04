import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { PhotoSlot } from '../research-weight/photo-slot'
import { Check, Chips, formatGrams } from '../research-weight/controls'
import { TARE_SOURCES, containerNet, type DraftContainer, type Library } from '../research-weight/model'
import type { ResearchTareSource } from '../../../utils/research-weight-api'

interface ContainerCardProps {
  index: number
  container: DraftContainer
  library: Library
  removable: boolean
  uploading: Record<string, boolean>
  onChange: (patch: Partial<DraftContainer>) => void
  onPickGross: () => void
  onPickTare: () => void
  onRemove: () => void
}

/** 一个外卖盒或一只碗：连盒读数，加上一种皮重来源。 */
export function ContainerCard({ index, container, library, removable, uploading, onChange, onPickGross, onPickTare, onRemove }: ContainerCardProps) {
  const saved = Object.values(library)
  const pickSource = (tareSource: ResearchTareSource) => {
    if (tareSource === 'library' && saved.length === 0) {
      Taro.showToast({ title: '还没有常用容器，称空盒时可以顺手存一个', icon: 'none' })
      return
    }
    onChange({ tareSource, libraryId: tareSource === 'library' ? container.libraryId || saved[0].id : container.libraryId })
  }
  const source = container.tareSource
  const weighsEmpty = source === 'measured' || source === 'after_meal'
  return (
    <View className='rw-box'>
      <View className='rw-box__head'>
        <Text className='rw-box__index'>第{index + 1}盒</Text>
        <Text className='rw-box__net'>{formatGrams(containerNet(container, library))}</Text>
        {removable ? <Text className='rw-box__remove' onClick={onRemove}>删除</Text> : null}
      </View>
      <Input className='rw-input rw-input--number' value={container.name} maxlength={30} placeholder='这一盒是什么，如 米饭' onInput={(e) => onChange({ name: e.detail.value })} />
      <View className='rw-reading'>
        <PhotoSlot label='连盒读数' required photo={container.grossPhoto} uploading={uploading[`${container.id}:gross`]} onPick={onPickGross} onClear={() => onChange({ grossPhoto: undefined })} />
        <View className='rw-reading__value'>
          <Input className='rw-input' type='digit' value={container.gross} placeholder='连盒放上秤的读数 g' onInput={(e) => onChange({ gross: e.detail.value })} />
          <Text className='rw-tip'>盖子拿掉再称</Text>
        </View>
      </View>
      <View className='rw-field'>
        <Text className='rw-field__label'>空盒重量</Text>
        <Chips small options={TARE_SOURCES} value={source} onChange={pickSource} />
      </View>
      {weighsEmpty ? (
        <View>
          {source === 'after_meal' && !container.tarePhoto ? <Text className='rw-box__waiting'>吃完或倒掉剩菜后，把空盒放上秤再拍</Text> : null}
          <View className='rw-reading'>
            <PhotoSlot label='空盒读数' required photo={container.tarePhoto} uploading={uploading[`${container.id}:tare`]} onPick={onPickTare} onClear={() => onChange({ tarePhoto: undefined })} />
            <View className='rw-reading__value'>
              <Input className='rw-input' type='digit' value={container.tare} placeholder='空盒读数 g' onInput={(e) => onChange({ tare: e.detail.value })} />
              <Check checked={container.saveToLibrary} label='存为常用容器' onChange={(saveToLibrary) => onChange({ saveToLibrary })} />
              {container.saveToLibrary ? (
                <Input className='rw-input rw-input--number' value={container.libraryName} maxlength={20} placeholder='容器名，如 750ml 圆盒' onInput={(e) => onChange({ libraryName: e.detail.value })} />
              ) : null}
            </View>
          </View>
        </View>
      ) : null}
      {source === 'zeroed' ? (
        <View className='rw-reading'>
          <PhotoSlot label='归零读数' required photo={container.tarePhoto} uploading={uploading[`${container.id}:tare`]} onPick={onPickTare} onClear={() => onChange({ tarePhoto: undefined })} />
          <Text className='rw-reading__note'>空容器放上秤按去皮，拍下显示 0 的样子，再装食物</Text>
        </View>
      ) : null}
      {source === 'library' ? (
        <View className='rw-library'>
          {saved.map((item) => (
            <View key={item.id} className={`rw-chip rw-chip--small ${container.libraryId === item.id ? 'rw-chip--active' : ''}`} onClick={() => onChange({ libraryId: item.id })}>
              <Text>{item.name} · {item.grams}g</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View className='rw-chips'>
        <View className={`rw-chip rw-chip--small ${container.containsBone ? 'rw-chip--active' : ''}`} onClick={() => onChange({ containsBone: !container.containsBone })}><Text>含骨</Text></View>
        <View className={`rw-chip rw-chip--small ${container.containsSoup ? 'rw-chip--active' : ''}`} onClick={() => onChange({ containsSoup: !container.containsSoup })}><Text>含汤</Text></View>
      </View>
    </View>
  )
}
