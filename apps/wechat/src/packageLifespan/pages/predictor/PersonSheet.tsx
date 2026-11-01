import { Button, Text, View } from '@tarojs/components'
import { useState } from 'react'
import {
  draftToPredictee, emptyDraft, predicteeToDraft, RELATIONS, validateDraft, type PersonDraft, type Predictee,
} from '../../model/people'
import { PersonForm } from './PersonForm'

interface PersonSheetProps {
  people: Predictee[]
  activeId: string
  onPick: (id: string) => void
  onSave: (person: Predictee) => void
  onDelete: (id: string) => void
  onClose: () => void
}

interface Editing {
  id: string | null
  draft: PersonDraft
}

export function PersonSheet({ people, activeId, onPick, onSave, onDelete, onClose }: PersonSheetProps) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState('')
  const active = people.find(person => person.id === activeId)

  const submit = () => {
    if (!editing) return
    const problem = validateDraft(editing.draft)
    if (problem) { setError(problem); return }
    onSave(draftToPredictee(editing.draft, editing.id ?? `p${Date.now()}`))
  }

  return (
    <View className='lp-sheet' catchMove>
      <View className='lp-sheet__mask' onClick={onClose} />
      <View className='lp-sheet__body' role='dialog' aria-label='换个人算'>
        <View className='lp-sheet__head'>
          <Text className='lp-sheet__title'>{editing ? (editing.id ? `修改${editing.draft.label}的信息` : '新建一个人') : '换个人算'}</Text>
          <Button className='lp-btn lp-btn--small lp-btn--line' onClick={editing ? () => { setEditing(null); setError('') } : onClose}>{editing ? '返回' : '关闭'}</Button>
        </View>
        {editing ? (
          <PersonForm
            draft={editing.draft}
            error={error}
            onChange={(next) => setEditing(prev => prev && { ...prev, draft: { ...prev.draft, ...next } })}
          />
        ) : (
          <View className='lp-people'>
            {people.map(person => (
              <View key={person.id} className={`lp-chip${person.id === activeId ? ' is-on' : ''}`} role='button' onClick={() => onPick(person.id)}>
                {person.label} · {person.age} 岁
              </View>
            ))}
            <View className='lp-chip' role='button' onClick={() => setEditing({ id: null, draft: emptyDraft(RELATIONS[0]) })}>＋ 新建一个人</View>
          </View>
        )}
        <Text className='lp-local'>这里填的信息只在这台手机上计算，不上传、不保存到食探账号。</Text>
        {editing ? (
          <Button className='lp-btn lp-btn--block' onClick={submit}>开始算</Button>
        ) : active && (
          <View className='lp-row'>
            <Button className='lp-btn lp-btn--line lp-grow' onClick={() => setEditing({ id: active.id, draft: predicteeToDraft(active) })}>修改{active.label}的信息</Button>
            {people.length > 1 && <Button className='lp-btn lp-btn--line lp-grow' onClick={() => onDelete(active.id)}>删除{active.label}</Button>}
          </View>
        )}
      </View>
    </View>
  )
}
