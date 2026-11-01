import { Button, Text, View } from '@tarojs/components'
import { useEffect, useRef, useState } from 'react'
import { getAccessToken, getHealthProfile } from '../../../utils/api'
import { DISCLAIMER } from '../../model/predictor'
import { basicsFilled, draftToPredictee, draftWithHealthProfile, emptyDraft, SELF_LABEL, validateDraft, type PersonDraft, type Predictee } from '../../model/people'
import { PersonForm } from './PersonForm'

interface FirstRunProps {
  onDone: (person: Predictee) => void
}

/** No records and no login needed: the health profile only saves typing when it exists. */
export function FirstRun({ onDone }: FirstRunProps) {
  const [draft, setDraft] = useState<PersonDraft>(() => emptyDraft(SELF_LABEL))
  const [filled, setFilled] = useState(0)
  const [error, setError] = useState('')
  const touched = useRef(false)

  useEffect(() => {
    if (!getAccessToken()) return undefined
    let cancelled = false
    getHealthProfile()
      .then((profile) => {
        if (cancelled || touched.current) return
        const next = draftWithHealthProfile(draft, profile, new Date())
        setDraft(next)
        setFilled(basicsFilled(next))
      })
      .catch(() => undefined)
    return () => { cancelled = true }
    // Runs once on open; later edits win over the profile through `touched`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = () => {
    const problem = validateDraft(draft)
    if (problem) { setError(problem); return }
    onDone(draftToPredictee(draft, 'me'))
  }

  return (
    <View>
      <View className='lp-hero'>
        <Text className='lp-hero__eyebrow'>寿命预测器</Text>
        <Text className='lp-hero__title'>同一个你，三种吃法，能活多久？</Text>
        <Text className='lp-hero__dim'>不用记录，选个大概就能算。算完每个习惯都能自己拖着试。</Text>
        <Text className='lp-hero__hint'>{DISCLAIMER}</Text>
      </View>
      <View className='lp-card'>
        <Text className='lp-card__title'>先算一次</Text>
        {filled === 4 && <Text className='lp-fine'>性别、年龄、身高、体重已从健康档案带入。习惯选个大概就行，之后都能调。</Text>}
        {filled > 0 && filled < 4 && <Text className='lp-fine'>已从健康档案带入一部分，空着的请补上。习惯选个大概就行，之后都能调。</Text>}
        <PersonForm
          draft={draft}
          error={error}
          onChange={(next) => {
            touched.current = true
            setError('')
            setDraft(prev => ({ ...prev, ...next }))
          }}
        />
        <Text className='lp-local'>这里填的信息只在这台手机上计算，不上传、不保存到食探账号。</Text>
        <Button className='lp-btn lp-btn--block' onClick={submit}>开始算</Button>
      </View>
    </View>
  )
}
