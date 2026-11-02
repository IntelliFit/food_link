import { Input, Text, View } from '@tarojs/components'
import type { ResearchPhotoRole } from '../../../utils/research-weight-api'
import { PhotoSlot } from './photo-slot'
import {
  CONTAINERS,
  MAX_ITEMS,
  PRECISIONS,
  REFERENCES,
  SCENES,
  itemIncrements,
  netGrams,
  type DraftItem,
  type ResearchDraft,
} from './model'

type DraftRole = Exclude<ResearchPhotoRole, 'item_scale'>

export interface SectionProps {
  draft: ResearchDraft
  update: (patch: Partial<ResearchDraft>) => void
  uploading: Record<string, boolean>
  pickPhoto: (role: DraftRole) => void
  clearPhoto: (role: DraftRole) => void
}

interface WeighProps extends SectionProps {
  pickItemPhoto: (index: number) => void
  updateItem: (index: number, patch: Partial<DraftItem>) => void
  addItem: () => void
  removeItem: (index: number) => void
}

function Chips<T extends string | number>({ options, value, onChange }: {
  options: Array<{ key: T; label: string }>
  value: T
  onChange: (key: T) => void
}) {
  return (
    <View className='rw-chips'>
      {options.map((option) => (
        <View
          key={String(option.key)}
          className={`rw-chip ${option.key === value ? 'rw-chip--active' : ''}`}
          onClick={() => onChange(option.key)}
        >
          <Text>{option.label}</Text>
        </View>
      ))}
    </View>
  )
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <View className='rw-field'>
      <Text className='rw-field__label'>{label}</Text>
      {children}
    </View>
  )
}

const formatGrams = (value: number | null) => (value === null ? '--' : `${value}g`)

export function SetupSection({ draft, update }: SectionProps) {
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>1 · 这是什么</Text>
      <Field label='场景'><Chips options={SCENES} value={draft.scene} onChange={(scene) => update({ scene })} /></Field>
      <Field label='菜名 *'>
        <Input className='rw-input' value={draft.dishName} maxlength={60} placeholder='如 红烧牛肉面' onInput={(e) => update({ dishName: e.detail.value })} />
      </Field>
      <Field label='地点'>
        <Input className='rw-input' value={draft.venueName} maxlength={60} placeholder='食堂/餐厅名，可不填' onInput={(e) => update({ venueName: e.detail.value })} />
      </Field>
      <Field label='容器'><Chips options={CONTAINERS} value={draft.container} onChange={(container) => update({ container })} /></Field>
      <Field label='秤的精度'>
        <Chips options={PRECISIONS.map((key) => ({ key, label: `${key}g` }))} value={draft.precision} onChange={(precision) => update({ precision })} />
      </Field>
      <Field label='称量方式'>
        <Chips
          options={[{ key: 'whole' as const, label: '整份称' }, { key: 'itemized' as const, label: '分项累加称' }]}
          value={draft.mode}
          onChange={(mode) => update({ mode })}
        />
      </Field>
      <Text className='rw-tip'>
        {draft.mode === 'whole' ? '整份：称空容器，再连食物一起称。' : '分项：容器放秤上，每加一样食物读一次数，系统自动算每项重量。'}
      </Text>
    </View>
  )
}

export function WeighSection(props: WeighProps) {
  const { draft, update, uploading, pickPhoto, clearPhoto } = props
  const increments = itemIncrements(draft)
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>2 · 称重</Text>
      <Field label='去皮方式'>
        <Chips
          options={[{ key: 'measured' as const, label: '称了空容器' }, { key: 'zeroed' as const, label: '秤已归零去皮' }]}
          value={draft.tareMode}
          onChange={(tareMode) => update({ tareMode })}
        />
      </Field>
      <View className='rw-reading'>
        <PhotoSlot
          label={draft.tareMode === 'zeroed' ? '归零读数' : '空容器读数'}
          required
          photo={draft.photos.tare_scale}
          uploading={uploading.tare_scale}
          onPick={() => pickPhoto('tare_scale')}
          onClear={() => clearPhoto('tare_scale')}
        />
        {draft.tareMode === 'measured' ? (
          <View className='rw-reading__value'>
            <Input className='rw-input rw-input--number' type='digit' value={draft.tare} placeholder='空容器 g' onInput={(e) => update({ tare: e.detail.value })} />
          </View>
        ) : <Text className='rw-reading__note'>拍下秤显示 0 的样子</Text>}
      </View>
      {draft.mode === 'whole' ? (
        <View className='rw-reading'>
          <PhotoSlot label='连容器读数' required photo={draft.photos.gross_scale} uploading={uploading.gross_scale} onPick={() => pickPhoto('gross_scale')} onClear={() => clearPhoto('gross_scale')} />
          <View className='rw-reading__value'>
            <Input className='rw-input rw-input--number' type='digit' value={draft.gross} placeholder='秤上读数 g' onInput={(e) => update({ gross: e.detail.value })} />
          </View>
        </View>
      ) : (
        <View>
          {draft.items.map((item, index) => (
            <View key={item.id} className='rw-item'>
              <View className='rw-item__head'>
                <Text className='rw-item__index'>第{index + 1}项</Text>
                <Text className='rw-item__gram'>{formatGrams(increments[index])}</Text>
                {draft.items.length > 1 ? <Text className='rw-item__remove' onClick={() => props.removeItem(index)}>删除</Text> : null}
              </View>
              <View className='rw-reading'>
                <PhotoSlot label='加入后读数' required photo={item.photo} uploading={uploading[`item_${item.id}`]} onPick={() => props.pickItemPhoto(index)} onClear={() => props.updateItem(index, { photo: undefined })} />
                <View className='rw-reading__value'>
                  <Input className='rw-input' value={item.name} maxlength={30} placeholder='名称，如 米饭' onInput={(e) => props.updateItem(index, { name: e.detail.value })} />
                  <Input className='rw-input rw-input--number' type='digit' value={item.reading} placeholder='秤上累计读数 g' onInput={(e) => props.updateItem(index, { reading: e.detail.value })} />
                  <View className='rw-chips'>
                    <View className={`rw-chip rw-chip--small ${item.containsBone ? 'rw-chip--active' : ''}`} onClick={() => props.updateItem(index, { containsBone: !item.containsBone })}><Text>含骨</Text></View>
                    <View className={`rw-chip rw-chip--small ${item.containsSoup ? 'rw-chip--active' : ''}`} onClick={() => props.updateItem(index, { containsSoup: !item.containsSoup })}><Text>含汤</Text></View>
                  </View>
                </View>
              </View>
            </View>
          ))}
          {draft.items.length < MAX_ITEMS ? <View className='rw-add' onClick={props.addItem}><Text>+ 再加一样</Text></View> : null}
        </View>
      )}
      <View className='rw-net'>
        <Text className='rw-net__label'>净重</Text>
        <Text className='rw-net__value'>{formatGrams(netGrams(draft))}</Text>
      </View>
    </View>
  )
}

export function EvalSection({ draft, update, uploading, pickPhoto, clearPhoto }: SectionProps) {
  const slot = (role: DraftRole, label: string, required = false, hint?: string) => (
    <PhotoSlot label={label} hint={hint} required={required} photo={draft.photos[role]} uploading={uploading[role]} onPick={() => pickPhoto(role)} onClear={() => clearPhoto(role)} />
  )
  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>3 · 评测照片</Text>
      <Text className='rw-tip rw-tip--warn'>先把食物从秤上拿下来再拍，照片里不要出现秤的读数。</Text>
      <View className='rw-grid'>
        {slot('eval_top', '俯拍', true, '手机正对食物上方')}
        {slot('eval_angle', '斜45°', true, '像平时拍照那样')}
      </View>
      <Field label='再拍一组带参照物的（可选）'>
        <Chips options={REFERENCES} value={draft.reference} onChange={(reference) => update({ reference })} />
      </Field>
      {draft.reference !== 'none' ? (
        <View className='rw-grid'>
          {slot('eval_top_ref', '俯拍+参照物')}
          {slot('eval_angle_ref', '45°+参照物')}
        </View>
      ) : null}
    </View>
  )
}
