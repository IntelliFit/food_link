import { Text, View } from '@tarojs/components'

export function Chips<T extends string | number>({ options, value, onChange, small }: {
  options: Array<{ key: T; label: string }>
  value: T
  onChange: (key: T) => void
  small?: boolean
}) {
  return (
    <View className='rw-chips'>
      {options.map((option) => (
        <View
          key={String(option.key)}
          className={`rw-chip ${small ? 'rw-chip--small' : ''} ${option.key === value ? 'rw-chip--active' : ''}`}
          onClick={() => onChange(option.key)}
        >
          <Text>{option.label}</Text>
        </View>
      ))}
    </View>
  )
}

export function Field({ label, children }: { label: string; children: any }) {
  return (
    <View className='rw-field'>
      <Text className='rw-field__label'>{label}</Text>
      {children}
    </View>
  )
}

export function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <View className='rw-check' onClick={() => onChange(!checked)}>
      <View className={`rw-check__box ${checked ? 'rw-check__box--on' : ''}`} />
      <Text>{label}</Text>
    </View>
  )
}

export function ConsentCard({ onAccept }: { onAccept: () => void }) {
  return (
    <View className='rw-card rw-consent'>
      <Text className='rw-card__title'>研究数据授权</Text>
      <Text className='rw-consent__text'>
        你上传的照片、称重读数和手机型号将用于食探的中餐克重评测与算法改进，并可能以去除个人身份信息的形式公开发布于数据集或学术论文。照片中请不要出现人脸、证件或其他个人信息。你可以随时联系我们删除未公开的数据。
      </Text>
      <View className='rw-consent__button' onClick={onAccept}><Text>我已阅读并同意</Text></View>
    </View>
  )
}

export const formatGrams = (value: number | null) => (value === null ? '--' : `${value}g`)
