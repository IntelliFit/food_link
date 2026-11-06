import { Text, View } from '@tarojs/components'
import { useState } from 'react'
import { Chips, Field } from '../research-weight/controls'
import { PRECISIONS, RESEARCH_CONSENT_VERSION } from '../research-weight/model'
import { acceptConsent, readConsent } from '../research-weight/storage'
import type { JoinInput } from '../../../utils/campus-campaign-api'

interface JoinCardProps {
  source: JoinInput['join_source']
  busy: boolean
  onJoin: (input: JoinInput) => void
}

/** 加入活动：有没有秤、秤的精度，并确认研究数据授权。 */
export function JoinCard({ source, busy, onJoin }: JoinCardProps) {
  const [hasScale, setHasScale] = useState(false)
  const [precision, setPrecision] = useState(1)
  const [consented, setConsented] = useState(readConsent)

  const join = () => {
    if (busy) return
    if (!consented) {
      acceptConsent()
      setConsented(true)
    }
    onJoin({
      has_scale: hasScale, join_source: source, consent_version: RESEARCH_CONSENT_VERSION,
      ...(hasScale ? { scale_precision_grams: precision } : {}),
    })
  }

  return (
    <View className='rw-card'>
      <Text className='rw-card__title'>加入活动</Text>
      <Field label='你有食物秤吗'>
        <Chips options={[{ key: 'no', label: '没有，拍照记录' }, { key: 'yes', label: '有，用秤称' }]} value={hasScale ? 'yes' : 'no'} onChange={(key) => setHasScale(key === 'yes')} />
      </Field>
      {hasScale ? (
        <Field label='秤的精度'>
          <Chips<number> small options={PRECISIONS.map((key) => ({ key, label: `${key}g` }))} value={precision} onChange={setPrecision} />
        </Field>
      ) : (
        <Text className='rw-tip'>没秤也能参加：在食堂拍照记一餐，选上是哪道菜；社团办称重日时端着饭去称一下。</Text>
      )}
      <Text className='rw-consent__text cc-consent'>
        加入即表示同意：你上传的照片、称重读数和手机型号将用于食探的中餐克重评测与算法改进，并可能以去除个人身份信息的形式公开于数据集或学术论文。照片里请不要出现人脸和证件。
      </Text>
      <View className={`rw-submit ${busy ? 'rw-submit--disabled' : ''}`} onClick={join}>
        {busy ? <View className='loading-spinner' /> : <Text>同意并加入</Text>}
      </View>
    </View>
  )
}
