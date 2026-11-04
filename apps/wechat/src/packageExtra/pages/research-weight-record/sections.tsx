import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { PhotoSlot } from '../research-weight/photo-slot'
import { Chips, Field, formatGrams } from '../research-weight/controls'
import {
  CONTAINERS,
  MAX_ITEMS,
  PRECISIONS,
  REFERENCES,
  SCENES,
  TARE_SOURCES,
  itemIncrements,
  newItem,
  tareSwitchPatch,
  type DraftItem,
  type EvalRole,
  type Library,
  type ResearchDraft,
} from '../research-weight/model'
import type { ResearchScene, ResearchTareSource } from '../../../utils/research-weight-api'

export interface SectionProps {
  draft: ResearchDraft
  library: Library
  update: (patch: Partial<ResearchDraft>) => void
  uploading: Record<string, boolean>
}

export function SetupSection({ draft, update, onSceneChange }: SectionProps & { onSceneChange: (scene: ResearchScene) => void }) {
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>这一顿</Text>
      <Field label='场景'><Chips options={SCENES} value={draft.scene} onChange={onSceneChange} /></Field>
      <Field label='吃的什么 *'>
        <Input className='rw-input' value={draft.dishName} maxlength={60} placeholder='如 宫保鸡丁套餐' onInput={(e) => update({ dishName: e.detail.value })} />
      </Field>
      <Field label='在哪吃的'>
        <Input className='rw-input' value={draft.venueName} maxlength={60} placeholder='店名或食堂名，可不填' onInput={(e) => update({ venueName: e.detail.value })} />
      </Field>
      <Field label='称法'>
        <Chips
          options={[{ key: 'multi' as const, label: '按盒/碗称' }, { key: 'itemized' as const, label: '分项累加称' }]}
          value={draft.mode}
          onChange={(mode) => update({ mode })}
        />
      </Field>
      <Text className='rw-tip'>
        {draft.mode === 'multi'
          ? '外卖、多个碗盘：每个盒子各称一次。嫌麻烦也可以把所有盒子一起放秤上，记成一盒。'
          : '食堂打菜、自己盛：容器放秤上，每加一样读一次数，自动算每项重量。'}
      </Text>
      <Field label='秤的精度'>
        <Chips small options={PRECISIONS.map((key) => ({ key, label: `${key}g` }))} value={draft.precision} onChange={(precision) => update({ precision })} />
      </Field>
    </View>
  )
}

export function PhotoSection({ draft, update, uploading, pickPhoto, clearPhoto }: SectionProps & {
  pickPhoto: (role: EvalRole) => void
  clearPhoto: (role: EvalRole) => void
}) {
  const slot = (role: EvalRole, label: string, hint?: string) => (
    <PhotoSlot label={label} hint={hint} photo={draft.photos[role]} uploading={uploading[role]} onPick={() => pickPhoto(role)} onClear={() => clearPhoto(role)} />
  )
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>1 · 先拍照（至少一张）</Text>
      <Text className='rw-tip rw-tip--warn'>盖子全打开，像平时吃饭那样摆好。别放在秤上，照片里不要出现秤的读数。</Text>
      <View className='rw-grid'>
        {slot('eval_top', '俯拍', '正对上方')}
        {slot('eval_angle', '斜着拍', '像平时拍照')}
      </View>
      <Field label='再拍一组带参照物的（可选）'>
        <Chips small options={REFERENCES} value={draft.reference} onChange={(reference) => update({ reference })} />
      </Field>
      {draft.reference !== 'none' ? (
        <View className='rw-grid'>
          {slot('eval_top_ref', '俯拍+参照物')}
          {slot('eval_angle_ref', '斜拍+参照物')}
        </View>
      ) : null}
    </View>
  )
}

export function ItemizedSection({ draft, library, update, uploading, pickTarePhoto, pickItemPhoto }: SectionProps & {
  pickTarePhoto: () => void
  pickItemPhoto: (index: number) => void
}) {
  const increments = itemIncrements(draft, library)
  const saved = Object.values(library)
  const updateItem = (index: number, patch: Partial<DraftItem>) =>
    update({ items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) })
  const pickSource = (tareSource: ResearchTareSource) => {
    if (tareSource === 'library' && saved.length === 0) {
      Taro.showToast({ title: '还没有常用容器', icon: 'none' })
      return
    }
    update({
      ...tareSwitchPatch(draft.tareSource, tareSource),
      tareSource,
      tareLibraryId: tareSource === 'library' ? draft.tareLibraryId || saved[0].id : draft.tareLibraryId,
    })
  }
  const weighsEmpty = draft.tareSource === 'measured' || draft.tareSource === 'after_meal'
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>2 · 称重</Text>
      <Field label='容器'><Chips small options={CONTAINERS} value={draft.container} onChange={(container) => update({ container })} /></Field>
      <Field label='空容器重量'><Chips small options={TARE_SOURCES} value={draft.tareSource} onChange={pickSource} /></Field>
      {draft.tareSource === 'library' ? (
        <View className='rw-library'>
          {saved.map((item) => (
            <View key={item.id} className={`rw-chip rw-chip--small ${draft.tareLibraryId === item.id ? 'rw-chip--active' : ''}`} onClick={() => update({ tareLibraryId: item.id })}>
              <Text>{item.name} · {item.grams}g</Text>
            </View>
          ))}
        </View>
      ) : (
        <View className='rw-reading'>
          <PhotoSlot label={draft.tareSource === 'zeroed' ? '归零读数' : '空容器读数'} required photo={draft.tarePhoto} uploading={uploading.tare} onPick={pickTarePhoto} onClear={() => update({ tarePhoto: undefined })} />
          {weighsEmpty ? (
            <View className='rw-reading__value'>
              <Input className='rw-input' type='digit' value={draft.tare} placeholder='空容器 g' onInput={(e) => update({ tare: e.detail.value })} />
              {draft.tareSource === 'after_meal' ? <Text className='rw-tip'>吃完再称也可以，先记下面的读数</Text> : null}
            </View>
          ) : <Text className='rw-reading__note'>拍下秤显示 0 的样子</Text>}
        </View>
      )}
      {draft.items.map((item, index) => (
        <View key={item.id} className='rw-item'>
          <View className='rw-item__head'>
            <Text className='rw-item__index'>第{index + 1}项</Text>
            <Text className='rw-item__gram'>{formatGrams(increments[index])}</Text>
            {draft.items.length > 1 ? <Text className='rw-item__remove' onClick={() => update({ items: draft.items.filter((_, i) => i !== index) })}>删除</Text> : null}
          </View>
          <View className='rw-reading'>
            <PhotoSlot label='加入后读数' required photo={item.photo} uploading={uploading[`item_${item.id}`]} onPick={() => pickItemPhoto(index)} onClear={() => updateItem(index, { photo: undefined })} />
            <View className='rw-reading__value'>
              <Input className='rw-input' value={item.name} maxlength={30} placeholder='名称，如 米饭' onInput={(e) => updateItem(index, { name: e.detail.value })} />
              <Input className='rw-input rw-input--number' type='digit' value={item.reading} placeholder='秤上累计读数 g' onInput={(e) => updateItem(index, { reading: e.detail.value })} />
            </View>
          </View>
        </View>
      ))}
      {draft.items.length < MAX_ITEMS ? (
        <View className='rw-add' onClick={() => update({ items: [...draft.items, newItem()] })}>
          <Text>+ 再加一样</Text>
        </View>
      ) : null}
    </View>
  )
}
